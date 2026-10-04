Runs kept for the record but not used in RESULTS.md:
- pro6000-llamacpp-nemotron35L-q4km-p8__bench__* (13:18-13:21): client-side keep-alive race with llama-server
  ("ServerDisconnectedError" on 1-4 requests per level). Re-run with one connection per request (13:22+).
- pro6000-vllm030-qwen36-35b-a3b-nvfp4-seq192__bench__chat/agent (16:00, 16:04): no warm-up burst, so the first
  level (c=64) absorbed one-off JIT/autotune costs on a fresh server (chat TTFT p95 9.8 s vs 2.7 s), and no
  steady-state metrics. Re-run at 20:35/20:39 with both.
