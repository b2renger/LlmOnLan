"""lol-classify: the farm's Laya decision model as ONE small service (docs/ECOSYSTEM_PLAN.md v2 §3.2).

The Computer's Classify box sends a list of items and ONE `choice` question; this answers each item
with the chosen option, its probability, and the full distribution. Laya (convaiinnovations/laya,
Apache-2.0) is a non-autoregressive "System 1" encoder: one forward pass per item, no prose.

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
import json
import os
import time
from collections import defaultdict

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

API_KEY = os.environ.get("CLASSIFY_API_KEY", "")
THREADS = max(1, int(os.environ.get("CLASSIFY_THREADS", "4")))
MAX_ITEMS = max(1, int(os.environ.get("CLASSIFY_MAX_ITEMS", "200")))
MAX_WAITING = max(0, int(os.environ.get("CLASSIFY_MAX_WAITING", "4")))
MAX_ITEM_CHARS = 4000
MIN_OPTIONS, MAX_OPTIONS = 2, 20

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


@app.post("/classify")
async def classify(request: Request):
    if not API_KEY or request.headers.get("authorization", "") != f"Bearer {API_KEY}":
        return JSONResponse({"detail": "bad key"}, status_code=401)
    if not state["ready"]:
        return JSONResponse({"detail": "warming up"}, status_code=503, headers={"Retry-After": "5"})
    try:
        body = await request.json()
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
        return JSONResponse({"detail": "busy"}, status_code=429, headers={"Retry-After": "2"})
    per_client[client] += 1
    waiting["n"] += 1
    try:
        async with gate:
            waiting["n"] -= 1
            q = {"q": {"type": "choice", "instructions": instructions, "criteria": criteria}}
            t0 = time.time()
            router = state["router"]
            answers = await asyncio.to_thread(lambda: [_answer(router.predict(_state_of(it), q)) for it in items])
            return {"answers": answers, "ms": round((time.time() - t0) * 1000), "model": state["model"]}
    finally:
        per_client[client] -= 1
        if per_client[client] <= 0:
            per_client.pop(client, None)
