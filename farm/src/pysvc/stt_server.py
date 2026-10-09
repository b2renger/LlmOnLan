"""lol-stt: speech to text on the farm, by the OpenAI transcription contract (docs/ECOSYSTEM_PLAN.md v2 §3.3).

The Computer's Sound box, in Listen mode, and Open WebUI on each laptop (its microphone and Call mode)
send a recording and get its words back. faster-whisper (the same library and version Open WebUI uses on
the client, MIT code and weights): no torch. On the GPU (STT_DEVICE=cuda) with int8_float16 weights, Whisper
large-v3-turbo by default; on the CPU with int8 weights, "small" by default. When the GPU does not load
(a driver too old, the CUDA libraries missing), it loads STT_CPU_MODEL on the CPU instead and /health says
why (`fallback`).

Why our own wrapper: the same rules as the OCR and Classify services —
  - Authorization: Bearer $STT_API_KEY on every call but /health;
  - ONE transcription at a time, a short wait queue, one request in flight per client address,
    then 429 + Retry-After;
  - never logs or keeps the audio (a person's voice: transient to the farm, by the farm's rule) —
    it is read into memory, transcribed, and dropped;
  - loads the model at start; /health is 503 until it is ready.

Contract (OpenAI's POST /v1/audio/transcriptions, the part we use):
  multipart/form-data: file (required), language (optional, e.g. "fr"), model (ignored: one model)
  → 200 {"text": str, "language": str, "duration": float, "ms": int}
    401 bad key · 400 no file · 413 too big · 429 busy (Retry-After) · 503 loading
  The body may come chunked (Open WebUI streams the file without a length): it is read into memory up
  to the cap, never further, then parsed there.
"""

import asyncio
import io
import os
import sys
import threading
import time
from collections import defaultdict

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.formparsers import MultiPartParser

API_KEY = os.environ.get("STT_API_KEY", "")
MODEL = os.environ.get("STT_MODEL", "base")
DEVICE = os.environ.get("STT_DEVICE", "cpu")
COMPUTE = os.environ.get("STT_COMPUTE", "int8_float16" if DEVICE == "cuda" else "int8")
CPU_MODEL = os.environ.get("STT_CPU_MODEL", "") or MODEL
MODELS_DIR = os.environ.get("STT_MODELS_DIR") or None
CUDA_LIBS = [d for d in os.environ.get("STT_CUDA_LIBS", "").split(os.pathsep) if d]
THREADS = max(1, int(os.environ.get("STT_THREADS", "4")))
MAX_BYTES = max(1, int(os.environ.get("STT_MAX_MB", "25"))) * 1024 * 1024
MAX_WAITING = max(0, int(os.environ.get("STT_MAX_WAITING", "4")))
FORM_SLACK = 64 * 1024   # the multipart envelope around the file

# The upload stays in memory (never spooled to a temp file): a voice is not written to the farm's disk.
MultiPartParser.spool_max_size = MAX_BYTES + FORM_SLACK

app = FastAPI(title="lol-stt")
state = {"model": None, "ready": False, "error": None, "device": None, "name": None, "fallback": None}
gate = asyncio.Semaphore(1)
waiting = {"n": 0}
per_client = defaultdict(int)


def _cuda_libs():
    # The venv's CUDA wheels (stt.js cudaLibDirs). Linux reads LD_LIBRARY_PATH, set by stt.js before the start;
    # Windows needs the folders in the DLL search before CTranslate2 loads cuBLAS.
    if sys.platform == "win32":
        for d in CUDA_LIBS:
            if os.path.isdir(d):
                os.add_dll_directory(d)
        os.environ["PATH"] = os.pathsep.join(CUDA_LIBS + [os.environ.get("PATH", "")])


def _whisper(name, device, compute):
    from faster_whisper import WhisperModel
    kw = dict(device=device, compute_type=compute, cpu_threads=THREADS, download_root=MODELS_DIR)
    try:   # on disk already: no network call (a farm offline, or huggingface.co silently blocked, would wait)
        return WhisperModel(name, local_files_only=True, **kw)
    except FileNotFoundError:   # huggingface_hub's LocalEntryNotFoundError: not downloaded yet
        return WhisperModel(name, **kw)


def _warm(model):
    # One second of silence through the encoder: a GPU that cannot run it (cuBLAS missing, a driver too old) fails
    # here, at the start, not at a person's first recording.
    import numpy as np
    segments, _ = model.transcribe(np.zeros(16000, dtype=np.float32), language="en")
    list(segments)


def _load():
    """-> (model, device, name, fallback): the GPU when asked and it works, else the CPU model."""
    fallback = None
    if DEVICE == "cuda":
        try:
            _cuda_libs()
            m = _whisper(MODEL, "cuda", COMPUTE)
            _warm(m)
            return m, "cuda", MODEL, None
        except Exception as e:
            fallback = f"{type(e).__name__}: {e}"[:300]
    name = CPU_MODEL if DEVICE == "cuda" else MODEL
    return _whisper(name, "cpu", "int8"), "cpu", name, fallback


@app.on_event("startup")
async def _startup():
    async def load():
        try:
            model, device, name, fallback = await asyncio.to_thread(_load)
            state.update(model=model, device=device, name=name, fallback=fallback, ready=True)
        except Exception as e:
            state["error"] = f"{type(e).__name__}: {e}"
    asyncio.create_task(load())


@app.get("/health")
async def health():
    if state["ready"]:
        return {"ready": True, "model": state["name"], "device": state["device"], "fallback": state["fallback"]}
    return JSONResponse({"ready": False, "error": state["error"]}, status_code=503)


async def _body(request: Request, cap: int):
    """The whole body in memory, or None once it passes `cap` (the rest is never read)."""
    buf = bytearray()
    async for chunk in request.stream():
        buf += chunk
        if len(buf) > cap:
            return None
    return bytes(buf)


async def _form(request: Request, body: bytes):
    async def once():
        yield body
    return await MultiPartParser(request.headers, once(), max_files=1, max_fields=4, max_part_size=64 * 1024).parse()


def _transcribe(data: bytes, language, cancel: threading.Event):
    segments, info = state["model"].transcribe(io.BytesIO(data), language=language or None, vad_filter=True)
    parts = []
    for s in segments:   # segments decode lazily: a cancel between them stops the work
        if cancel.is_set():
            return None
        parts.append(s.text.strip())
    return " ".join(parts).strip(), info.language, float(info.duration or 0.0)


@app.post("/v1/audio/transcriptions")
async def transcriptions(request: Request):
    # Every refusal that needs no audio comes BEFORE the audio is read: a wrong key, a model still
    # loading, a body declared too big or a busy farm never costs a 25 MB upload.
    if not API_KEY or request.headers.get("authorization", "") != f"Bearer {API_KEY}":
        return JSONResponse({"detail": "bad key"}, status_code=401)
    if not state["ready"]:
        return JSONResponse({"detail": "loading the model"}, status_code=503, headers={"Retry-After": "5"})
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared = 0
    # A chunked upload (no length: Open WebUI streams its file) is read below up to the cap, in memory.
    if declared > MAX_BYTES + FORM_SLACK:
        return JSONResponse({"detail": f"at most {MAX_BYTES // (1024 * 1024)} MB"}, status_code=413)
    client = request.client.host if request.client else "?"
    if per_client[client] >= 1 or (gate.locked() and waiting["n"] >= MAX_WAITING):
        detail = "one recording at a time from this computer" if per_client[client] >= 1 else "the farm is busy transcribing"
        return JSONResponse({"detail": detail}, status_code=429, headers={"Retry-After": "3"})
    per_client[client] += 1
    waiting["n"] += 1
    queued = True   # counted in `waiting` until the gate is ours; a cancelled wait must not leak it
    data = b""
    try:
        body = await _body(request, MAX_BYTES + FORM_SLACK)
        if body is None:
            return JSONResponse({"detail": f"at most {MAX_BYTES // (1024 * 1024)} MB"}, status_code=413)
        try:
            form = await _form(request, body)
        except Exception:
            return JSONResponse({"detail": "the body is not a form"}, status_code=400)
        finally:
            del body
        file, language = form.get("file"), form.get("language")
        if file is None or isinstance(file, str):
            return JSONResponse({"detail": "no file"}, status_code=400)
        data = await file.read(MAX_BYTES + 1)
        await form.close()
        if not data:
            return JSONResponse({"detail": "empty file"}, status_code=400)
        if len(data) > MAX_BYTES:
            return JSONResponse({"detail": f"at most {MAX_BYTES // (1024 * 1024)} MB"}, status_code=413)
        async with gate:
            waiting["n"] -= 1
            queued = False
            t0 = time.time()
            cancel = threading.Event()
            work = asyncio.ensure_future(asyncio.to_thread(_transcribe, data, language if isinstance(language, str) else None, cancel))
            while not work.done():
                await asyncio.wait({work}, timeout=0.5)
                if not work.done() and await request.is_disconnected():
                    cancel.set()   # Stop was pressed: the thread quits at the next segment
            try:
                out = work.result()
            except Exception as e:  # an unreadable file: say so, keep nothing
                return JSONResponse({"detail": f"could not read the audio ({type(e).__name__})"}, status_code=400)
            if out is None:
                return JSONResponse({"detail": "the client left"}, status_code=499)
            text, lang, duration = out
            return {"text": text, "language": lang, "duration": round(duration, 2), "ms": round((time.time() - t0) * 1000)}
    finally:
        if queued:
            waiting["n"] -= 1
        del data
        per_client[client] -= 1
        if per_client[client] <= 0:
            per_client.pop(client, None)
