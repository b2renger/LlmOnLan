"""Stand-in for `vllm serve <model> ... --uds <sock>`: no GPU. Used by farm/vllm/test_scripts.sh and by
farm/test/vllm-lifecycle.js (through serve.sh, as the farm runs it).

Over FAKE_DELAY seconds (default 3) it prints the lines a real vLLM 0.30 start prints, the ones the farm reads its
phases from (vllm.js startPhase), progress bars written with \\r included. Then it answers on the Unix socket:
/health, /v1/models ({id: --served-model-name, root: the model, max_model_len}), /metrics (vllm: series and the
context pool in cache_config_info) and a tiny /v1/chat/completions, streamed or not. It starts an "EngineCore"
child that ignores SIGTERM, as a real one once did, so the KILL paths get exercised.

Failure modes, from the environment or from <root>/fake.env (the vllm wrapper reads it: a farm passes only its own
variables):
  FAKE_EXIT=<n>       exit with that status after the delay (a crash while starting)
  FAKE_OOM=1          print CUDA's out-of-memory error after the weights load, and exit 1
  FAKE_SLOW_MODELS=1  /v1/models answers after 12 s (a busy server); so does a file <root>/fake-slow-models,
                      read at each request
  a file <root>/fake-linger when it is stopped: a copy of it in a session of its own keeps answering on the TCP
  port (LOL_VLLM_PORT) once the relay has gone (a port still held after vLLM stopped)
"""
import http.server
import json
import os
import signal
import socket
import socketserver
import subprocess
import sys
import time

sock = sys.argv[1]
argv = sys.argv[2:]   # serve <model> <flags...>
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # <root>/.venv/bin/fake_vllm.py


def flag(name, default=None):
    v = default
    for i, a in enumerate(argv):
        if a == name and i + 1 < len(argv):
            v = argv[i + 1]
    return v


MODEL = argv[1] if len(argv) > 1 and argv[0] == 'serve' else '?'
SERVED = flag('--served-model-name', 'fake')
MAX_LEN = int(flag('--max-model-len', '8192'))
POOL = int(os.environ.get('FAKE_POOL_TOKENS', '50000'))
DELAY = float(os.environ.get('FAKE_DELAY', '3'))
counters = {'gen': 0, 'prompt': 0, 'running': 0}

pid = os.getpid()
print(f"[fake-vllm] pid {pid} pgid {os.getpgid(0)} sock {sock} args {argv}", flush=True)
engine = subprocess.Popen([sys.executable, '-c',
                           'import signal, time\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\ntime.sleep(10**6)',
                           'VLLM::EngineCore', sock])
E = f"(EngineCore pid={engine.pid})"
A = f"(APIServer pid={pid})"


def say(s, end='\n'):
    sys.stdout.write(s + end)
    sys.stdout.flush()


step = DELAY / 6
say(f"{A} INFO 10-07 17:45:53 [model.py:692] Resolved architecture: FakeForCausalLM")
say(f"{A} INFO 10-07 17:45:53 [model.py:2030] Using max model len {MAX_LEN}")
time.sleep(step)
for k, pct in ((0, 0), (1, 33), (2, 67), (3, 100)):
    say(f"{E} Loading safetensors checkpoint shards: {pct:3d}% Completed | {k}/3 [00:00<00:00,  1.00it/s]")
    time.sleep(step / 3)
say(f"{E} INFO 10-07 17:46:47 [model_runner.py:428] Model loading took 0.10 GiB memory and 1.0 seconds")
if os.environ.get('FAKE_OOM'):
    say(f"{E} ERROR 10-07 17:46:48 [core.py:1] torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB.")
    engine.kill()
    sys.exit(1)
time.sleep(step)
say(f"{E} INFO 10-07 17:47:03 [kv_cache_utils.py:2395] GPU KV cache size: {POOL:,} tokens, "
    f"Maximum concurrency for {MAX_LEN:,} tokens per request: {POOL / MAX_LEN:.2f}x")
time.sleep(step)
bar = ''.join(f"Capturing CUDA graphs (PIECEWISE): {p:3d}%|          | {n}/3 [00:00<00:00]\r" for n, p in ((0, 0), (1, 33), (2, 67), (3, 100)))
say(f"{E} {bar}")
time.sleep(step)
say(f"{E} INFO 10-07 17:47:19 [core.py:372] init engine (profile, create kv cache, warmup model) took {DELAY:.2f} s")
if os.environ.get('FAKE_EXIT'):
    say(f"[fake-vllm] exiting with {os.environ['FAKE_EXIT']}")
    engine.kill()
    sys.exit(int(os.environ['FAKE_EXIT']))


def metrics():
    lab = f'{{engine="0",model_name="{SERVED}"}}'
    return '\n'.join([
        f'vllm:num_requests_running{lab} {counters["running"]}',
        f'vllm:num_requests_waiting{lab} 0',
        f'vllm:kv_cache_usage_perc{lab} 0.01',
        f'vllm:generation_tokens_total{lab} {counters["gen"]}',
        f'vllm:inter_token_latency_seconds_sum{lab} {counters["gen"] * 0.01}',
        f'vllm:prefix_cache_queries_total{lab} {counters["prompt"]}',
        f'vllm:prefix_cache_hits_total{lab} 0',
        f'vllm:cache_config_info{{block_size="16",kv_cache_size_tokens="{POOL}",num_gpu_blocks="{POOL // 16}",engine="0"}} 1',
    ]) + '\n'


class H(http.server.BaseHTTPRequestHandler):
    def send(self, code, body, ctype='application/json'):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        p = self.path.split('?')[0]
        if p == '/health':
            return self.send(200, b'', 'text/plain')
        if p in ('/v1/models', '/models'):
            if os.environ.get('FAKE_SLOW_MODELS') or os.path.exists(os.path.join(ROOT, 'fake-slow-models')):
                time.sleep(12)
            return self.send(200, {'object': 'list', 'data': [{'id': SERVED, 'object': 'model', 'owned_by': 'vllm', 'root': MODEL, 'max_model_len': MAX_LEN}]})
        if p == '/metrics':
            return self.send(200, metrics().encode(), 'text/plain; version=0.0.4')
        self.send(404, {'error': 'not found'})

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        try:
            body = json.loads(self.rfile.read(n) or b'{}')
        except ValueError:
            body = {}
        if self.path.split('?')[0] != '/v1/chat/completions':
            return self.send(404, {'error': 'not found'})
        counters['gen'] += 2
        counters['prompt'] += 5
        base = {'id': 'chatcmpl-fake', 'created': int(time.time()), 'model': SERVED}
        if not body.get('stream'):
            return self.send(200, {**base, 'object': 'chat.completion',
                                   'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': 'fake reply'}, 'finish_reason': 'stop'}],
                                   'usage': {'prompt_tokens': 5, 'completion_tokens': 2, 'total_tokens': 7}})
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        for delta, fin in (({'role': 'assistant', 'content': ''}, None), ({'content': 'fake reply'}, None), ({}, 'stop')):
            chunk = {**base, 'object': 'chat.completion.chunk', 'choices': [{'index': 0, 'delta': delta, 'finish_reason': fin}]}
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")

    def log_message(self, *a):
        pass


class S(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def get_request(self):
        req, _ = super().get_request()
        return req, ('uds', 0)


class T(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def on_term(*_):
    if os.path.exists(os.path.join(ROOT, 'fake-linger')) and os.fork() == 0:
        # The lingering copy: a session of its own (out of reach of the process group's KILL), on the TCP port
        # once the relay has let it go. It never returns into the Unix server below.
        os.setsid()
        port = int(os.environ.get('LOL_VLLM_PORT', '8100'))
        for _ in range(600):
            try:
                srv = T(('127.0.0.1', port), H)
                break
            except OSError:
                time.sleep(0.1)
        else:
            os._exit(0)
        say(f"[fake-vllm] lingering on 127.0.0.1:{port} as pid {os.getpid()}")
        srv.serve_forever()
        os._exit(0)
    os._exit(143)


signal.signal(signal.SIGTERM, on_term)
say("[fake-vllm] listening")
S(sock, H).serve_forever()
