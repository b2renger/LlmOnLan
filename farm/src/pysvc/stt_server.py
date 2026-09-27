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
import time
from collections import defaultdict

from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse

API_KEY = os.environ.get("STT_API_KEY", "")
MODEL = os.environ.get("STT_MODEL", "base")
THREADS = max(1, int(os.environ.get("STT_THREADS", "4")))
MAX_BYTES = max(1, int(os.environ.get("STT_MAX_MB", "25"))) * 1024 * 1024
MAX_WAITING = max(0, int(os.environ.get("STT_MAX_WAITING", "4")))

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


def _transcribe(data: bytes, language):
    segments, info = state["model"].transcribe(io.BytesIO(data), language=language or None, vad_filter=True)
    text = " ".join(s.text.strip() for s in segments).strip()
    return text, info.language, float(info.duration or 0.0)


@app.post("/v1/audio/transcriptions")
async def transcriptions(request: Request, file: UploadFile = File(None), language: str = Form(None), model: str = Form(None)):
    if not API_KEY or request.headers.get("authorization", "") != f"Bearer {API_KEY}":
        return JSONResponse({"detail": "bad key"}, status_code=401)
    if not state["ready"]:
        return JSONResponse({"detail": "loading the model"}, status_code=503, headers={"Retry-After": "5"})
    if file is None:
        return JSONResponse({"detail": "no file"}, status_code=400)
    data = await file.read(MAX_BYTES + 1)
    if not data:
        return JSONResponse({"detail": "empty file"}, status_code=400)
    if len(data) > MAX_BYTES:
        return JSONResponse({"detail": f"at most {MAX_BYTES // (1024 * 1024)} MB"}, status_code=413)
    client = request.client.host if request.client else "?"
    if per_client[client] >= 1 or (gate.locked() and waiting["n"] >= MAX_WAITING):
        return JSONResponse({"detail": "busy"}, status_code=429, headers={"Retry-After": "3"})
    per_client[client] += 1
    waiting["n"] += 1
    try:
        async with gate:
            waiting["n"] -= 1
            t0 = time.time()
            try:
                text, lang, duration = await asyncio.to_thread(_transcribe, data, language)
            except Exception as e:  # an unreadable file: say so, keep nothing
                return JSONResponse({"detail": f"could not read the audio ({type(e).__name__})"}, status_code=400)
            return {"text": text, "language": lang, "duration": round(duration, 2), "ms": round((time.time() - t0) * 1000)}
    finally:
        del data
        per_client[client] -= 1
        if per_client[client] <= 0:
            per_client.pop(client, None)
