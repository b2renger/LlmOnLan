"""Stand-in for `vllm serve ... --uds <sock>`: no GPU. After FAKE_DELAY seconds it answers every GET on the Unix
socket with a /v1/models-like body. It starts an "EngineCore" child that ignores SIGTERM, as a real one once did, so
the KILL paths get exercised. FAKE_EXIT=<n> makes it exit with that status after the delay (a crash)."""
import http.server
import json
import os
import socketserver
import subprocess
import sys
import time

sock = sys.argv[1]
print(f"[fake-vllm] pid {os.getpid()} pgid {os.getpgid(0)} sock {sock} args {sys.argv[2:]}", flush=True)
subprocess.Popen([sys.executable, '-c',
                  'import signal, time\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\ntime.sleep(10**6)',
                  'VLLM::EngineCore', sock])
time.sleep(float(os.environ.get('FAKE_DELAY', '3')))
if os.environ.get('FAKE_EXIT'):
    print(f"[fake-vllm] exiting with {os.environ['FAKE_EXIT']}", flush=True)
    sys.exit(int(os.environ['FAKE_EXIT']))


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({'object': 'list', 'data': [{'id': 'fake'}]}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


class S(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def get_request(self):
        req, _ = super().get_request()
        return req, ('uds', 0)


print("[fake-vllm] listening", flush=True)
S(sock, H).serve_forever()
