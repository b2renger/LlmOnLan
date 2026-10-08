# llama.cpp: a non-streaming request is not cancelled while another slot streams

**For the owner, to post in your own words.** llama.cpp forbids AI-written issues and comments, and forbids
agents from posting on someone's behalf:
- CONTRIBUTING.md, AI Usage Policy, item 5: "It is strictly prohibited to use AI to write your posts for you".
  Undisclosed AI use can get an account banned.
- The issue template: "copypasting language model outputs is strictly prohibited".
- AGENTS.md lists `gh issue create` and `gh pr comment` as forbidden agent actions.

So nothing was posted. Below are the facts, the machine output and a reproduction script. The output and
the script can be pasted as they are. AI-written code is allowed when disclosed: say that an AI assistant
read the source and wrote the script, and that you ran it. Write the prose yourself.

**Where to post.** Open PR [#29707](https://github.com/ggml-org/llama.cpp/pull/29707) already contains the
exact fix: a deadline computed once, plus `wait_until`, in `tools/server/server-queue.cpp`. One maintainer
approved it, and the change another asked for was made. It is framed as a router-mode fix and has no linked
issue and no reproduction. CONTRIBUTING asks that a bug-fix PR come with a reproducible issue. A short
comment there, showing that it also fixes a plain server under concurrent load, is the most useful
contribution. Another option is a short "Misc. bug" issue that links the PR.

Found and measured 2026-10-05 (DEVLOG 08:30 and today). Title used in the draft: "Misc. bug: llama-server does not cancel a non-streaming request after client disconnect while another slot is streaming".

---

### Name and Version
```
$ llama-server --version
version: 0.5.0-dev (build 11406, commit 8216c8462)
built with Clang 20.1.8 for Windows x86_64
```
Also reproduced on: version: 0.3.0-dev (build 10670, commit d077b4c21), Clang 20.1.8 for Windows x86_64. Both are the official win-cuda release zips (13.4 / 13.3). Still there in version: 0.6.0-dev (build 11512, commit a11f57ba9), the official win-cuda-13.4 zip, 2026-10-08 (measured with the farm's `farm/test/litellm-cancel.js` on Qwen3.8-27B, not this script: the non-streaming request was released 19.6 s after its client left, at n_tokens 2071).

### Operating systems
Windows (Windows 11 Pro 10.0.26200; NVIDIA RTX PRO 6000 Blackwell Workstation Edition 96 GB, driver 596.36)

### Which llama.cpp modules do you know to be affected?
llama-server

### Command line
```shell
llama-server -m granite-4.2-8b-Q4_K_M.gguf --port 18191 --parallel 2 -c 16384 -ngl 99
python repro_nonstream_cancel.py 127.0.0.1:18191
```

### Problem description & steps to reproduce
[owner: write in your own words. Facts:]
- With --parallel 2, a non-streaming /v1/chat/completions whose client disconnects gets `cancel task` about 0.5 s later. This holds when the other slot is idle or runs another NON-streaming request.
- If the other slot is STREAMING, the disconnected non-streaming request is never cancelled. There is no `cancel task` line, and the slot is released only after all 2000 tokens (n_tokens = 2027), ~9.5 s after the disconnect. A 1-token probe request waits for it.
- Streams themselves stop on disconnect, because they check should_stop on every chunk.
- Reading master e5983d6:
  - server_response_reader::next() checks should_stop only when recv_with_timeout() returns nullptr (tools/server/server-queue.cpp:550-557).
  - recv_with_timeout() calls condition_results.wait_for(lock, seconds(timeout)) inside a loop (server-queue.cpp:462).
  - server_response::send() calls notify_all() for every result of any task (server-queue.cpp:489).
  - So each streamed token from another slot wakes the waiter, which finds no result of its own and starts a new full 1 s wait. The timeout never fires while anything else streams faster than one token per second.
  - The non-stream path waits in rd.wait_for_all(req.should_stop) at server-context.cpp:4571, with HTTP_POLLING_SECONDS = 1 (server-context.cpp:40).
  - server-queue.h:215 says should_stop 'will be called each polling_interval_seconds'.
- Expected: cancellation within ~1 s whatever the other slots do.
- Suggestion only: compute the deadline once per recv_with_timeout() call and wait_until() it, so other tasks' wake-ups do not extend it. Open PR #29707 contains exactly this change, framed as a router fix. This repro shows it also matters with no router.
- Context (one line): we run llama-server with --parallel N behind a proxy for classes of 20-30 people. An abandoned non-streaming call (a background title or JSON request) holds a slot until it ends.
- AI disclosure [owner, in his words]: an AI assistant read the server source and wrote the repro script; I ran it and checked the logs.

Repro script (Python 3 stdlib):
```python
#!/usr/bin/env python3
# llama-server: a non-streaming request whose client disconnects is not cancelled
# while another slot is streaming. Python 3 stdlib only.
#
#   llama-server -m model.gguf --parallel 2 -c 16384 -ngl 99 --port 8080
#   python repro_nonstream_cancel.py 127.0.0.1:8080
#
# Each trial: start a long "neighbour" request (none / non-streaming / streaming),
# then a 2000-token non-streaming "target", disconnect the target's client after 1.5 s,
# then send a 1-token "probe". With --parallel 2 both slots are busy, so the probe
# waits until the target's slot is released. Compare with the server log lines
# "cancel task, id_task = N" and "release: ... | task N | stop processing: n_tokens = ...".
import json, socket, sys, threading, time

host, port = (sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1:8080").rsplit(":", 1)
port = int(port)
T0 = time.time()


def ts():
    return "%7.2fs" % (time.time() - T0)


def send(stream, max_tokens):
    body = json.dumps({
        "messages": [{"role": "user", "content": "Count from 1 to 10000, separated by commas."}],
        "stream": stream, "max_tokens": max_tokens, "temperature": 0, "ignore_eos": True,
    }).encode()
    s = socket.create_connection((host, port))
    s.sendall(b"POST /v1/chat/completions HTTP/1.1\r\nHost: %s\r\nContent-Type: application/json\r\n"
              b"Content-Length: %d\r\nConnection: close\r\n\r\n" % (host.encode(), len(body)) + body)
    return s


def drain(s):
    try:
        while s.recv(65536):
            pass
    except OSError:
        pass
    s.close()


def trial(neighbour):
    print("\n=== target (non-stream, 2000 tokens) aborted after 1.5 s; neighbour: %s" % neighbour, flush=True)
    nb = None
    if neighbour != "none":
        nb = send(neighbour == "stream", 4000)
        threading.Thread(target=drain, args=(nb,), daemon=True).start()
        time.sleep(1.0)
    target = send(False, 2000)
    print(ts(), "target sent", flush=True)
    time.sleep(1.5)
    target.close()  # the client gives up
    t_abort = time.time()
    print(ts(), "target client disconnected", flush=True)
    if neighbour != "none":
        probe = send(False, 1)
        drain(probe)
        print(ts(), "probe answered %.1f s after the disconnect (a slot was free again)" % (time.time() - t_abort), flush=True)
        nb.close()
    time.sleep(12)  # let the server settle before the next trial


for n in ("none", "non-stream", "stream"):
    trial(n)
```

### First Bad Commit
Not a regression as far as the source shows. The wait has restarted on every wake-up since recv_with_timeout was added in #11285 (f30f099, 2025-01-18). server-queue.cpp is unchanged between b10670 and master. Older builds were not tested.

### Relevant log output
<details>
<summary>Logs</summary>

Script output (b11406):
```console
=== target (non-stream, 2000 tokens) aborted after 1.5 s; neighbour: none
   0.00s target sent
   1.50s target client disconnected

=== target (non-stream, 2000 tokens) aborted after 1.5 s; neighbour: non-stream
  14.50s target sent
  16.01s target client disconnected
  16.58s probe answered 0.6 s after the disconnect (a slot was free again)

=== target (non-stream, 2000 tokens) aborted after 1.5 s; neighbour: stream
  29.58s target sent
  31.08s target client disconnected
  40.64s probe answered 9.6 s after the disconnect (a slot was free again)
```
Server log (b11406, grep launch_slot_/cancel task/release):
```console
0.09.378.474 I slot launch_slot_: id  1 | task 0 | processing task, is_child = 0
0.11.395.373 W srv          stop: cancel task, id_task = 0
0.11.395.857 I slot      release: id  1 | task 0 | stop processing: n_tokens = 314, truncated = 0
0.22.890.944 I slot launch_slot_: id  1 | task 289 | processing task, is_child = 0
0.23.883.203 I slot launch_slot_: id  0 | task 471 | processing task, is_child = 0
0.25.891.648 W srv          stop: cancel task, id_task = 471
0.25.897.477 I slot      release: id  0 | task 471 | stop processing: n_tokens = 286, truncated = 0
0.25.908.821 I slot launch_slot_: id  0 | task 663 | processing task, is_child = 0
0.25.953.725 I slot      release: id  0 | task 663 | stop processing: n_tokens = 28, truncated = 0
0.26.963.311 W srv          stop: cancel task, id_task = 289
0.26.967.556 I slot      release: id  1 | task 289 | stop processing: n_tokens = 611, truncated = 0
0.37.956.061 I slot launch_slot_: id  0 | task 878 | processing task, is_child = 0
0.38.957.820 I slot launch_slot_: id  1 | task 1087 | processing task, is_child = 0
0.49.952.757 I slot      release: id  1 | task 1087 | stop processing: n_tokens = 2027, truncated = 0
0.50.007.467 I slot launch_slot_: id  1 | task 1374 | processing task, is_child = 0
0.50.013.795 I slot      release: id  1 | task 1374 | stop processing: n_tokens = 28, truncated = 0
0.50.026.549 W srv          stop: cancel task, id_task = 878
0.50.035.312 I slot      release: id  0 | task 878 | stop processing: n_tokens = 2238, truncated = 0
```
Task 1087 (the disconnected target, while task 878 streams) has no cancel line and runs to n_tokens = 2027. Task 471 (same setup, with a non-streaming neighbour) is cancelled about 0.5 s after the disconnect.
</details>
