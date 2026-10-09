"""One runnable check for the Classify and STT services' refusals and bookkeeping, and for the OCR
service's turn-taking on vision calls, with stub models.

  <any python with fastapi + httpx> farm/src/pysvc/check_services.py

Neither Laya nor Whisper is loaded: the startup hook (which loads them) only runs inside
`with TestClient(...)`, which this never uses. The OCR service's Ollama call and pymupdf are stubbed,
so no GPU and no OCR venv are needed. `node farm/test/run.js` runs it when the classify or stt venv
exists (and skips it otherwise).
"""

import asyncio
import contextlib
import io
import json
import os
import sys
import threading
import time
import types

os.environ.update(CLASSIFY_API_KEY="k", CLASSIFY_MAX_ITEMS="2", STT_API_KEY="k", STT_MAX_MB="1", EXTRACT_API_KEY="k")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient  # noqa: E402

import classify_server as cs  # noqa: E402
import stt_server as ss  # noqa: E402

KEY = {"Authorization": "Bearer k"}
failures = []


def check(name, ok):
    print(("ok   " if ok else "FAIL ") + name)
    if not ok:
        failures.append(name)


async def asgi(app, path, headers, body, disconnect_after_body):
    """One raw ASGI POST whose client leaves right after sending its body. Returns the status."""
    sent = {"body": False}
    status = {}

    async def receive():
        if not sent["body"]:
            sent["body"] = True
            return {"type": "http.request", "body": body, "more_body": False}
        if disconnect_after_body:
            return {"type": "http.disconnect"}
        await asyncio.sleep(3600)

    async def send(message):
        if message["type"] == "http.response.start":
            status["code"] = message["status"]

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
             "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": b"",
             "root_path": "", "client": ("10.0.0.9", 5000), "server": ("127.0.0.1", 8891),
             "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]}
    await app(scope, receive, send)
    return status.get("code")


# ---- Classify --------------------------------------------------------------------------------
class Router:
    calls = 0

    def predict(self, state, q):
        Router.calls += 1
        return {"answers": {"q": {"choice": "a", "answer_confidence": 0.9, "probabilities": {"a": 0.9, "b": 0.1}}}}


c = TestClient(cs.app)
body = {"items": ["one", "two"], "question": {"instructions": "Pick.", "options": ["a", "b"]}}
check("classify: no key -> 401", c.post("/classify", json=body).status_code == 401)
check("classify: warming -> 503", c.post("/classify", json=body, headers=KEY).status_code == 503)
cs.state.update(router=Router(), ready=True)
r = c.post("/classify", json=body, headers=KEY)
check("classify: answers each item", r.status_code == 200 and [a["choice"] for a in r.json()["answers"]] == ["a", "a"])
big = json.dumps({"items": ["x" * (cs.MAX_BODY + 10)], "question": body["question"]})
check("classify: a body over MAX_BODY -> 413", c.post("/classify", content=big, headers={**KEY, "Content-Type": "application/json"}).status_code == 413)
check("classify: three items over a cap of two -> 413", c.post("/classify", json={**body, "items": ["1", "2", "3"]}, headers=KEY).status_code == 413)
Router.calls = 0
raw = json.dumps(body).encode()
code = asyncio.run(asgi(cs.app, "/classify", {**KEY, "content-type": "application/json", "content-length": str(len(raw))}, raw, True))
check("classify: a client that left -> 499, no item predicted", code == 499 and Router.calls == 0)
code = asyncio.run(asgi(cs.app, "/classify", {**KEY, "content-type": "application/json"}, raw, False))
check("classify: a body that does not declare its length (chunked) -> 411, nothing read", code == 411 and Router.calls == 0)
check("classify: nothing left counted as waiting or in flight", cs.waiting["n"] == 0 and not cs.per_client)


# ---- STT -------------------------------------------------------------------------------------
class Whisper:
    yielded = 0

    def __init__(self, n=1, delay=0.0):
        self.n, self.delay = n, delay

    def transcribe(self, f, language=None, vad_filter=True):
        def segments():
            for i in range(self.n):
                time.sleep(self.delay)
                Whisper.yielded += 1
                yield types.SimpleNamespace(text=f" word{i} ")
        return segments(), types.SimpleNamespace(language=language or "en", duration=1.5)


s = TestClient(ss.app)
wav = {"file": ("a.wav", b"RIFF....", "audio/wav")}
check("stt: no key -> 401", s.post("/v1/audio/transcriptions", files=wav).status_code == 401)
check("stt: loading -> 503", s.post("/v1/audio/transcriptions", files=wav, headers=KEY).status_code == 503)
ss.state.update(model=Whisper(), ready=True)
r = s.post("/v1/audio/transcriptions", files=wav, data={"language": "fr"}, headers=KEY)
check("stt: transcribes", r.status_code == 200 and r.json()["text"] == "word0" and r.json()["language"] == "fr")
check("stt: no file -> 400", s.post("/v1/audio/transcriptions", data={"language": "fr"}, headers=KEY).status_code == 400)
check("stt: a declared body over the cap -> 413 before reading",
      s.post("/v1/audio/transcriptions", content=b"x", headers={**KEY, "Content-Length": str(ss.MAX_BYTES + ss.FORM_SLACK + 1),
                                                                   "Content-Type": "multipart/form-data; boundary=b"}).status_code == 413)
check("stt: a file over the cap -> 413",
      s.post("/v1/audio/transcriptions", files={"file": ("a.wav", b"x" * (ss.MAX_BYTES + 1), "audio/wav")}, headers=KEY).status_code == 413)
check("stt: the upload is kept in memory, never spooled to disk", ss.MultiPartParser.spool_max_size >= ss.MAX_BYTES)
ss.state["model"] = Whisper(n=20, delay=0.2)
Whisper.yielded = 0
form = (b"--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
        b"RIFF....\r\n--b--\r\n")
code = asyncio.run(asgi(ss.app, "/v1/audio/transcriptions", {**KEY, "content-type": "multipart/form-data; boundary=b",
                                                               "content-length": str(len(form))}, form, True))
check("stt: a client that left -> 499, stopped well before the 20th segment", code == 499 and Whisper.yielded < 10)
ss.state["model"] = Whisper()
Whisper.yielded = 0
code = asyncio.run(asgi(ss.app, "/v1/audio/transcriptions", {**KEY, "content-type": "multipart/form-data; boundary=b"}, form, False))
check("stt: an upload that does not declare its length (chunked, as Open WebUI sends) is transcribed", code == 200 and Whisper.yielded == 1)
Whisper.yielded = 0
big = (b"--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
       + b"x" * (ss.MAX_BYTES + ss.FORM_SLACK) + b"\r\n--b--\r\n")
code = asyncio.run(asgi(ss.app, "/v1/audio/transcriptions", {**KEY, "content-type": "multipart/form-data; boundary=b"}, big, False))
check("stt: a chunked upload over the cap -> 413, nothing transcribed", code == 413 and Whisper.yielded == 0)
check("stt: nothing left counted as waiting or in flight", ss.waiting["n"] == 0 and not ss.per_client)

# The GPU, and the CPU when the GPU does not load (stt.js asks for cuda on an NVIDIA farm).
loads = []


def fake_whisper(name, device, compute):
    loads.append((name, device, compute))
    if device == "cuda" and fail_gpu:
        raise RuntimeError("Library cublas64_12.dll is not found or cannot be loaded")
    return object()


real_whisper, real_warm, real_libs = ss._whisper, ss._warm, ss._cuda_libs
ss._whisper, ss._warm, ss._cuda_libs = fake_whisper, (lambda m: None), (lambda: None)
ss.DEVICE, ss.MODEL, ss.COMPUTE, ss.CPU_MODEL = "cuda", "large-v3-turbo", "float16", "small"
fail_gpu = False
_, device, name, fallback = ss._load()
check("stt: on the GPU, the GPU model in float16", (device, name, fallback) == ("cuda", "large-v3-turbo", None)
      and loads == [("large-v3-turbo", "cuda", "float16")])
fail_gpu, loads[:] = True, []
_, device, name, fallback = ss._load()
check("stt: a GPU that does not load -> the CPU model in int8, and why", (device, name) == ("cpu", "small")
      and loads[-1] == ("small", "cpu", "int8") and "cublas" in fallback)
ss.DEVICE, ss.MODEL, loads[:] = "cpu", "small", []
_, device, name, fallback = ss._load()
check("stt: on the CPU, never tries the GPU", loads == [("small", "cpu", "int8")] and fallback is None)
ss._whisper, ss._warm, ss._cuda_libs = real_whisper, real_warm, real_libs


# ---- OCR (server.py): vision calls take turns -----------------------------------------------
class VisionModel:
    """Stands in for the Ollama vision call: notes how many run at once, and in what order."""

    def __init__(self, **_):
        self.lock, self.running, self.peak, self.order = threading.Lock(), 0, 0, []

    def process_image(self, path, format_type=None, preprocess=None):
        with self.lock:
            self.running += 1
            self.peak = max(self.peak, self.running)
            self.order.append(path)
        time.sleep(0.2)
        with self.lock:
            self.running -= 1
        return f"text of {path}"


sys.modules["pymupdf"] = types.ModuleType("pymupdf")   # only the PDF path uses it
sys.modules["ocr_processor"] = types.SimpleNamespace(OCRProcessor=VisionModel)
import server as ocr  # noqa: E402

text = {}
ocr._vision_turn.acquire()   # a scan holds the turn …
try:
    t = threading.Thread(target=lambda: text.update(r=ocr._extract(b"hello", "a.txt", "text/plain")), daemon=True)
    t.start()
    t.join(2)
    check("ocr: a text file never waits for a vision turn", "r" in text and text["r"][0]["page_content"] == "hello")
finally:
    ocr._vision_turn.release()
pages = {}
threads = [threading.Thread(target=lambda i=i: pages.update({i: ocr._ocr_image(f"p{i}")})) for i in range(5)]
for t in threads:
    t.start()
    time.sleep(0.02)   # five scans arrive one after another, all while the first is being read
for t in threads:
    t.join()
check("ocr: one vision call at a time by default", ocr.OCR.peak == 1)
check("ocr: every scan waited for its turn and got its text (no refusal)", pages == {i: f"text of p{i}" for i in range(5)})
check("ocr: turns go in arrival order", ocr.OCR.order == [f"p{i}" for i in range(5)])
out = io.StringIO()
with contextlib.redirect_stdout(out):
    r = TestClient(ocr.app).put("/process", content=b"hello", headers={**KEY, "X-Filename": "Salaries%202026.txt", "Content-Type": "text/plain"})
check("ocr: the log line counts pages, never the file's name",
      r.status_code == 200 and "1 page(s)" in out.getvalue() and "Salaries" not in out.getvalue())

print(f"{'FAILED ' + str(len(failures)) if failures else 'all passed'}")
sys.exit(1 if failures else 0)
