"""lol-classify: the farm's Laya decision model as ONE small service (docs/archive/plans/ECOSYSTEM_PLAN.md v2 §3.2).

The Computer's Classify box sends a list of items and ONE `choice` question; this answers each item
with the chosen option, its probability, and the full distribution. Laya (convaiinnovations/laya,
Apache-2.0) is a non-autoregressive "System 1" encoder: one forward pass per item, no prose. When the farm's own vLLM
serves Qwen3.6 or Qwen3.8, its decision endpoint answers instead, on the GPU (CLASSIFY_VLLM_PLAN, below); the reply's
`model` says which answered.

Why our own wrapper and not `laya-serve`: laya-serve has no auth, no concurrency cap and no batch
endpoint. This adds exactly those, in the OCR service's shape (farm/src/pysvc/server.py):
  - Authorization: Bearer $CLASSIFY_API_KEY on every call but /health;
  - ONE inference at a time (CPU), a short wait queue, then 429 + Retry-After; one request in
    flight per client address (a second one from the same address waits its turn, never doubles up);
  - never logs a request body (the items are a person's data, transient by the farm's rule);
  - warms the model at start: /health is 503 until the first forward pass is done (13.7 s cold on
    the dev box's CPU), so the farm only advertises a service that answers quickly.

Contract:
  GET  /health                      → 200 {"ready": true, "model": ...} | 503 {"ready": false}
  POST /classify  {items, question} → 200 {"answers": [{"choice", "confidence", "probabilities"}], "ms", "model"}
    items     list of strings or JSON objects (≤ CLASSIFY_MAX_ITEMS, each ≤ 4000 chars once serialised)
    question  {"instructions": str, "options": {key: description} | [key, ...]}  (2 ≤ options ≤ 20)
    401 bad key · 400 bad body · 413 too many items · 429 busy (Retry-After) · 503 warming
"""

import asyncio
import hmac
import json
import os
import time
import urllib.request
from collections import defaultdict

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

API_KEY = os.environ.get("CLASSIFY_API_KEY", "")
THREADS = max(1, int(os.environ.get("CLASSIFY_THREADS", "4")))
MAX_ITEMS = max(1, int(os.environ.get("CLASSIFY_MAX_ITEMS", "200")))
MAX_WAITING = max(0, int(os.environ.get("CLASSIFY_MAX_WAITING", "4")))
MAX_ITEM_CHARS = 4000
# The largest body worth reading: every item at its cap, JSON-escaped, plus the question.
MAX_BODY = MAX_ITEMS * MAX_ITEM_CHARS * 4 + 65536
MIN_OPTIONS, MAX_OPTIONS = 2, 20

# The farm's own vLLM, on this computer (CLASSIFY_VLLM_PLAN, approved 2026-11-26): when it serves a model measured on
# its decision endpoint, `/v1/systemone` answers instead of Laya, on the GPU (194 English and French headlines, 2026-11-26:
# Qwen3.6 73 % right, Qwen3.8 70 %, Laya 59 %; 31-47 ms an item). Gemma 4 is left out (66 %, and sure of nearly
# everything, so the box's "Sure above" would stop meaning anything); Nemotron and the rest were not measured. Asked on
# loopback, not through the seat gate: a decision read takes no seat, as Laya's never did. Anything else, or a vLLM
# that does not answer, and Laya answers, as before.
VLLM_URL = os.environ.get("CLASSIFY_VLLM_URL", "").rstrip("/")
VLLM_MODELS = ("qwen3.6", "qwen3.8")   # the farm's library ids (vLLM's --served-model-name) start so
VLLM_AT_ONCE = 8

app = FastAPI(title="lol-classify")
state = {"router": None, "ready": False, "model": "convaiinnovations/laya", "error": None}
gate = asyncio.Semaphore(1)          # one forward pass at a time: the CPU is the bottleneck
waiting = {"n": 0}
per_client = defaultdict(int)        # requests in flight or waiting, per client address


def _load_and_warm():
    import torch
    from laya import Router
    torch.set_num_threads(THREADS)
    router = Router()
    # One real forward pass: loads the English checkpoint so the first person does not pay 13 s.
    router.predict({"text": "warm up"}, {"q": {"type": "choice", "instructions": "Warm up.",
                                               "criteria": {"a": "first", "b": "second"}}})
    return router


@app.on_event("startup")
async def _startup():
    async def warm():
        try:
            state["router"] = await asyncio.to_thread(_load_and_warm)
            state["ready"] = True
        except Exception as e:  # the farm reads /health and keeps the plugin off
            state["error"] = f"{type(e).__name__}: {e}"
    asyncio.create_task(warm())


@app.get("/health")
async def health():
    if state["ready"]:
        return {"ready": True, "model": state["model"]}
    return JSONResponse({"ready": False, "error": state["error"]}, status_code=503)


def _criteria(options):
    """A question's options → Laya's criteria dict. Returns None when the shape is wrong."""
    if isinstance(options, list):
        opts = {str(o).strip(): str(o).strip() for o in options if str(o).strip()}
    elif isinstance(options, dict):
        opts = {str(k).strip(): str(v).strip() or str(k).strip() for k, v in options.items() if str(k).strip()}
    else:
        return None
    return opts if MIN_OPTIONS <= len(opts) <= MAX_OPTIONS else None


def _state_of(item):
    """An item → the state Laya reads (text or a JSON object), capped."""
    if isinstance(item, (dict, list)):
        text = json.dumps(item, ensure_ascii=False)
        return item if len(text) <= MAX_ITEM_CHARS else {"text": text[:MAX_ITEM_CHARS]}
    return {"text": str(item)[:MAX_ITEM_CHARS]}


def _answer(result):
    a = (result or {}).get("answers", {}).get("q", {}) if isinstance(result, dict) else {}
    probs = a.get("probabilities") or {}
    return {
        "choice": a.get("choice"),
        "confidence": round(float(a.get("answer_confidence", 0.0) or 0.0), 4),
        "probabilities": {k: round(float(v), 4) for k, v in probs.items()},
    }


def _http_json(url, body=None, timeout=30):
    """GET (no body) or POST JSON on loopback; the decoded answer, or raises."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="GET" if body is None else "POST",
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _vllm_model():
    """The model the farm's vLLM serves, when it is one measured for decisions; else None (or no vLLM)."""
    if not VLLM_URL:
        return None
    try:
        ids = [m.get("id", "") for m in _http_json(f"{VLLM_URL}/v1/models", timeout=2).get("data", [])]
    except Exception:
        return None
    return next((i for i in ids if i.startswith(VLLM_MODELS)), None)


def _vllm_one(model, item, instructions, criteria):
    """One item through vLLM's decision endpoint, thinking off, as measured; the answer in Laya's shape."""
    text = item if isinstance(item, str) else json.dumps(item, ensure_ascii=False)
    body = {"model": model, "state": text[:MAX_ITEM_CHARS], "chat_template_kwargs": {"enable_thinking": False},
            # an option given without words of its own is a bare label, as in the measurement
            "questions": {"q": {"type": "choice", "instructions": instructions,
                                "criteria": {k: (None if v == k else v) for k, v in criteria.items()}}}}
    a = _http_json(f"{VLLM_URL}/v1/systemone", body)["answers"]["q"]
    return {
        "choice": a.get("choice"),
        "confidence": round(float(a.get("confidence", 0.0) or 0.0), 4),
        "probabilities": {k: round(float(v), 4) for k, v in (a.get("probabilities") or {}).items()},
    }


async def _vllm_answers(request, model, items, instructions, criteria):
    """Every item through vLLM, VLLM_AT_ONCE at a time; None as soon as one fails (Laya then answers them all), or
    "left" when the person stopped."""
    answers = []
    for i in range(0, len(items), VLLM_AT_ONCE):
        if request is not None and await request.is_disconnected():
            return "left"
        try:
            answers += await asyncio.gather(*(asyncio.to_thread(_vllm_one, model, it, instructions, criteria)
                                              for it in items[i:i + VLLM_AT_ONCE]))
        except Exception:
            return None
    return answers


@app.post("/classify")
async def classify(request: Request):
    # Constant time, as the OCR service; as bytes (Starlette reads headers as latin-1), so an odd header is a 401, not a 500.
    got = request.headers.get("authorization", "").encode("latin-1")
    if not API_KEY or not hmac.compare_digest(got, f"Bearer {API_KEY}".encode("latin-1")):
        return JSONResponse({"detail": "bad key"}, status_code=401)
    if not state["ready"]:
        return JSONResponse({"detail": "warming up"}, status_code=503, headers={"Retry-After": "5"})
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared = 0
    if declared <= 0:
        # A body that does not say its size (chunked) is refused before a byte is read: the size checks
        # below would otherwise only run after the whole body sat in memory.
        return JSONResponse({"detail": "the body must declare its length"}, status_code=411)
    if declared > MAX_BODY:
        return JSONResponse({"detail": "the body is too big"}, status_code=413)
    try:
        raw = await request.body()
        if len(raw) > MAX_BODY:
            return JSONResponse({"detail": "the body is too big"}, status_code=413)
        body = json.loads(raw)
    except Exception:
        return JSONResponse({"detail": "the body is not JSON"}, status_code=400)
    items = body.get("items") if isinstance(body, dict) else None
    question = body.get("question") if isinstance(body, dict) else None
    if not isinstance(items, list) or not items or not isinstance(question, dict):
        return JSONResponse({"detail": "need items (a list) and question (an object)"}, status_code=400)
    if len(items) > MAX_ITEMS:
        return JSONResponse({"detail": f"at most {MAX_ITEMS} items per call"}, status_code=413)
    criteria = _criteria(question.get("options"))
    instructions = str(question.get("instructions", "")).strip()
    if criteria is None or not instructions:
        return JSONResponse({"detail": f"the question needs instructions and {MIN_OPTIONS}–{MAX_OPTIONS} options"}, status_code=400)

    client = request.client.host if request.client else "?"
    if per_client[client] >= 1 or (gate.locked() and waiting["n"] >= MAX_WAITING):
        detail = "one request at a time from this computer" if per_client[client] >= 1 else "the farm is busy classifying"
        return JSONResponse({"detail": detail}, status_code=429, headers={"Retry-After": "2"})
    per_client[client] += 1
    waiting["n"] += 1
    queued = True   # counted in `waiting` until the gate is ours; a cancelled wait must not leak it
    try:
        async with gate:
            waiting["n"] -= 1
            queued = False
            q = {"q": {"type": "choice", "instructions": instructions, "criteria": criteria}}
            t0 = time.time()
            model = await asyncio.to_thread(_vllm_model)
            if model:
                got = await _vllm_answers(request, model, items, instructions, criteria)
                if got == "left":
                    return JSONResponse({"detail": "the client left"}, status_code=499)
                if got is not None:
                    return {"answers": got, "ms": round((time.time() - t0) * 1000), "model": model}
            router = state["router"]
            answers = []
            for it in items:
                # A person who pressed Stop frees the farm now, not after the whole batch.
                if await request.is_disconnected():
                    return JSONResponse({"detail": "the client left"}, status_code=499)
                answers.append(_answer(await asyncio.to_thread(router.predict, _state_of(it), q)))
            return {"answers": answers, "ms": round((time.time() - t0) * 1000), "model": state["model"]}
    finally:
        if queued:
            waiting["n"] -= 1
        per_client[client] -= 1
        if per_client[client] <= 0:
            per_client.pop(client, None)
