"""One runnable check for the Classify and STT services' refusals and bookkeeping, with stub models.

  <any python with fastapi + httpx> farm/src/pysvc/check_services.py

Neither Laya nor Whisper is loaded: the startup hook (which loads them) only runs inside
`with TestClient(...)`, which this never uses. `node farm/test/run.js` runs it when the classify or
stt venv exists (and skips it otherwise).
"""

import asyncio
import json
import os
import sys
import time
import types

os.environ.update(CLASSIFY_API_KEY="k", CLASSIFY_MAX_ITEMS="2", STT_API_KEY="k", STT_MAX_MB="1")
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
code = asyncio.run(asgi(cs.app, "/classify", {**KEY, "content-type": "application/json"}, json.dumps(body).encode(), True))
check("classify: a client that left -> 499, no item predicted", code == 499 and Router.calls == 0)
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
check("stt: nothing left counted as waiting or in flight", ss.waiting["n"] == 0 and not ss.per_client)

print(f"{'FAILED ' + str(len(failures)) if failures else 'all passed'}")
sys.exit(1 if failures else 0)
