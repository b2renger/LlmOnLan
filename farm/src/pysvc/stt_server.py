"""lol-stt: speech to text on the farm, by the OpenAI transcription contract (docs/ECOSYSTEM_PLAN.md v2 §3.3).

The Computer's Sound box, in Listen mode, sends a recording and gets its words back. faster-whisper
(the same library and version Open WebUI uses on the client, MIT code and weights) runs on the CPU
with int8 weights: no torch, a small install, and a model of 75–500 MB depending on `STT_MODEL`.

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
"""

import asyncio
import io
import os
import threading
import time
from collections import defaultdict

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.formparsers import MultiPartParser

API_KEY = os.environ.get("STT_API_KEY", "")
MODEL = os.environ.get("STT_MODEL", "base")
THREADS = max(1, int(os.environ.get("STT_THREADS", "4")))
MAX_BYTES = max(1, int(os.environ.get("STT_MAX_MB", "25"))) * 1024 * 1024
MAX_WAITING = max(0, int(os.environ.get("STT_MAX_WAITING", "4")))
FORM_SLACK = 64 * 1024   # the multipart envelope around the file

# The upload stays in memory (never spooled to a temp file): a voice is not written to the farm's disk.
MultiPartParser.spool_max_size = MAX_BYTES + FORM_SLACK

app = FastAPI(title="lol-stt")
state = {"model": None, "ready": False, "error": None}
gate = asyncio.Semaphore(1)
waiting = {"n": 0}
per_client = defaultdict(int)


def _load():
    from faster_whisper import WhisperModel
    return WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=THREADS)


@app.on_event("startup")
async def _startup():
    async def load():
        try:
            state["model"] = await asyncio.to_thread(_load)
            state["ready"] = True
        except Exception as e:
            state["error"] = f"{type(e).__name__}: {e}"
    asyncio.create_task(load())


@app.get("/health")
async def health():
    if state["ready"]:
        return {"ready": True, "model": MODEL}
    return JSONResponse({"ready": False, "error": state["error"]}, status_code=503)


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
    if declared <= 0:
        # A chunked upload does not say its size, and would reach the disk spool before any check.
        return JSONResponse({"detail": "the upload must declare its length"}, status_code=411)
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
        try:
            form = await request.form(max_files=1, max_fields=4, max_part_size=64 * 1024)
        except Exception:
            return JSONResponse({"detail": "the body is not a form"}, status_code=400)
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
