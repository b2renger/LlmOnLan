# Engine x model spike (multiuser plan 0.6)

**Question:** on one big box, how many people can be served at once, at good quality (reasoning + coding),
with 32k / 64k / 128k of context each, by vLLM and by llama.cpp, for a short list of models?

Results live in [RESULTS.md](RESULTS.md); raw JSON per run in `results/`, server start-up logs in `results/logs/`.

## Files

| File | What it is |
|---|---|
| `spike_bench.py` | The harness. Python 3.10+, stdlib + `aiohttp`. Any OpenAI-compatible server. Subcommands `bench`, `quality`, `kvlog`, `summarize`, `selftest`. |
| `quality_set.json` | The quality gate: 10 Python tasks (scored by running asserts), 7 reasoning items (exact answers), 11 OpenAI `tools` round-trips. |
| `install_vllm.sh` | vLLM into its own venv `~/lol-spike/.venv` (uv; x86_64 or arm64). |
| `download.sh` | The checkpoints into `~/lol-spike/hf/<name>`. |
| `serve_vllm.sh` / `stop_vllm.sh` | Start `vllm serve` with a stdin-EOF watchdog (kills its whole process group when its launcher dies); stop it. |
| `serve_llamacpp.ps1` | Start the farm's own `llama-server.exe` (b10670) with the farm's argv (`farm/src/llamacpp.js`), Windows. |
| `runs/*.sh` | The exact sequences run on the PRO 6000. |

## The harness

```bash
PY=~/lol-spike/.venv/bin/python        # any python with aiohttp
$PY spike_bench.py selftest            # every reference solution passes its own tests

# load sweeps (closed loop: c users, each sends --rounds requests back to back, staggered start)
$PY spike_bench.py bench   --base-url http://127.0.0.1:8100/v1 --label <box>-<engine>-<model> --profile chat
$PY spike_bench.py bench   ... --profile long                  # unique ~32k-token prompt per request
$PY spike_bench.py bench   ... --profile agent                 # shared ~8k prefix (rules + 9 tool schemas) + ~2k unique, tools on
$PY spike_bench.py bench   ... --profile chat --thinking off --natural    # model stops by itself: real answer lengths

# quality gate (c = 4 items in flight; items are independent, so concurrency only changes wall time)
$PY spike_bench.py quality --base-url http://127.0.0.1:8100/v1 --label <same label> --thinking on

# KV capacity from the server's start-up log
$PY spike_bench.py kvlog ~/lol-spike/logs/<run>.log

# tables
$PY spike_bench.py summarize results/*.json
```

### Profiles

| Profile | Prompt | Output | Notes |
|---|---|---|---|
| `chat` | ~4k tokens, unique per request (a session tag at the very start defeats the prefix cache) | 512 | an OWUI message with a pasted document |
| `long` | ~32k tokens, unique per request (`--prompt-tokens` changes it: 65536 / 131072 for the 64k / 128k rows) | 256 | worst case: no prefix-cache help |
| `agent` | ~8k shared prefix (coding-agent rules + 9 file-tool schemas, byte-stable) + ~2k unique (a code file + task), `tools` + `tool_choice: auto` | 1024 | the coding agent's tool steps; prefix caching should hit |
| `followup` | each user's unique context (`--prompt-tokens`, e.g. 30000 / 62000 / 120000) is loaded once (round 0, not scored); all users sync; every later round re-sends the same context + a new ~300-token question | 256 | a person deep into a 32k / 64k / 128k chat: what each turn costs once the context sits in the KV pool. Use `--rounds 3`. |

By default every request sets `ignore_eos: true` and `max_tokens` jittered +/-20 %, so output lengths are
comparable across models and users desynchronise. `--natural` lets the model stop by itself (no jitter):
use it to see real answer lengths, e.g. with `--thinking off`.

Prompt sizes are calibrated once per run with the server's own `/tokenize` (vLLM and llama-server both
have it); the real `prompt_tokens` of every request is recorded from the server's `usage`.

### What a level reports

- **TTFT** p50 / p95 (s): first streamed token of any kind (reasoning, content or a tool-call delta).
- **Per-user decode tok/s** median and p10: `(completion_tokens - 1) / (last token - first token)` per request.
- **Aggregate tok/s**: tokens per second over the *steady window* (from when the last user got its first
  token until the first user finished), falling back to tokens / wall time.
- Errors (HTTP errors, timeouts, empty streams), VRAM max and GPU utilisation (nvidia-smi every 2 s), and the
  server's own counters (`/metrics`: preemptions, prefix-cache hit rate, KV usage, running/waiting).
- **Pass** = no errors AND TTFT p95 < 5 s AND decode >= 15 tok/s, judged two ways: the p10 rule (90 % of
  requests at >= 15 tok/s) and the median rule. "People (latency-bounded)" = the largest passing level.

### Quality gate

28 items, fixed for every model, scored automatically:

- **code (10):** the reply's Python block plus the item's asserts run in a subprocess (`python -I`, temp
  dir, 30 s timeout, minimal environment). Not a security sandbox: it runs model-written code on the bench
  box. `eval_expr` blocks `eval`/`exec`.
- **exact (7):** the last `ANSWER:` line (or `\boxed{}`), compared as a number, a reduced fraction or text.
- **tool (11):** an agent loop of up to 5 steps with OpenAI `tools`: every `tool_calls` entry must name a
  given tool and carry JSON-object arguments; the expected calls (name + argument matchers) must all be
  made; canned results are fed back as `role: tool` messages; the final text must contain the expected
  fact. One item checks the model answers *without* a tool when none is needed.
- Sampling: temperature 0.6, top_p 0.95, seed 1234, max_tokens 16384, thinking on (all recorded in the JSON).

## Running the matrix

### vLLM (WSL2 on Windows, or native Linux)

```bash
bash install_vllm.sh                 # -> ~/lol-spike/.venv (vLLM 0.30.0 at the time of writing)
bash download.sh                     # -> ~/lol-spike/hf/<name>
```

Start one model at a time (see RESULTS.md for each model's exact flags). From Git Bash on Windows:

```bash
( while :; do sleep 5; echo || exit; done ) | MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- \
  bash /mnt/c/.../docs/spike/serve_vllm.sh qwen36 ~/lol-spike/hf/Qwen3.6-35B-A3B-NVFP4 \
  --served-model-name qwen3.6-35b-a3b-nvfp4 --host 127.0.0.1 --port 8100 ...
```

The `echo` loop keeps the stdin pipe open; when the launcher dies the watchdog kills the server's whole
process group (EngineCore included). Stop it explicitly with `bash stop_vllm.sh`, then check
`nvidia-smi` is back at baseline and `pgrep -af "vllm serve|EngineCore"` is empty.

**WSL2 only — serve on a Unix socket.** On this box (WSL 2.6.3, `networkingMode=mirrored`) vLLM's TCP listener
on 127.0.0.1 never answered (SYNs timed out on 8100 and 8101, from WSL and from Windows), while plain Python
listeners on the same ports worked. Not root-caused. The workaround: `vllm serve ... --uds ~/lol-spike/run/vllm.sock`
and `SPIKE_UDS=~/lol-spike/run/vllm.sock python spike_bench.py ... --base-url http://localhost/v1`. On a native
Linux box (the Spark) use plain TCP.

**FlashInfer JIT needs a consistent CUDA toolkit.** vLLM 0.30.0 JIT-compiles FlashInfer kernels for sm_120 at
first use (FP8 linears, attention prefill). `serve_vllm.sh` puts the venv's `ninja` and pip `nvcc` on PATH,
sets `CUDA_HOME`, and gives the linker unversioned `libcudart.so`/`libcublas.so`/`libcuda.so` names
(`FLASHINFER_EXTRA_LDFLAGS`); `install_vllm.sh` pins `nvidia-cuda-nvcc`, `nvidia-cuda-crt` and `nvidia-nvvm` to
the CUDA runtime's minor version (13.2 here). The four failures, in the order they appeared:
`FileNotFoundError: 'ninja'` → `CUDA compiler and CUDA toolkit headers are incompatible` (nvcc 13.4 vs
runtime 13.2) → `ptxas fatal: Unsupported .version 9.4; current version is '9.2'` (cicc from nvvm 13.4) →
`ld: cannot find -lcudart / -lcuda / -lcublas`. The first start compiles ~30 kernels (~3 min); later starts
reuse `~/.cache/flashinfer`.

Size the KV pool with `--kv-cache-memory-bytes` (absolute; skips the start-up memory profiler that aborts
when another process changes VRAM), never `--gpu-memory-utilization` (a fraction of TOTAL VRAM). Leave
6-8 GB of headroom. Then:

```bash
$PY spike_bench.py kvlog ~/lol-spike/logs/qwen36.log      # GPU KV cache size, max concurrency, people at 32k/64k/128k
bash runs/vllm_suite.sh <label> "<exact command>"          # quality + chat + long + agent + chat thinking-off
```

### llama.cpp (Windows, the farm's b10670 build)

```powershell
powershell -File serve_llamacpp.ps1 -Model <gguf> -Parallel 8 -Ctx 1048576 -KvType q8_0 -Log results\logs\<run>.log
```
then from WSL (mirrored networking reaches Windows' 127.0.0.1): `bash runs/llamacpp_suite.sh <label> "<notes>" 1,4,8,16`.
Stop with `Stop-Process -Id (Get-Content $env:TEMP\lol-spike-llama.pid)`.

## Re-run on another box (DGX Spark)

1. `uv` installed; `bash install_vllm.sh` (arm64 wheels exist for vLLM 0.30.0; record the versions it prints).
2. `bash download.sh` (or point at an existing HF cache).
3. Serve each model with the flags in RESULTS.md, adapting `--kv-cache-memory-bytes` to the Spark's
   unified 128 GB (leave 10-15 GB for the OS and services; the Spark has no separate VRAM, so nvidia-smi's
   memory column may read N/A: watch `free -g` instead). On GB10, NVIDIA's recipes use
   `--moe-backend marlin` (W4A16) for these NVFP4 checkpoints.
4. Run the same `runs/vllm_suite.sh` with a `spark-...` label; everything else is identical.
5. `python spike_bench.py summarize results/*.json` and add the rows to RESULTS.md.

x86 / Windows-specific bits (not needed on the Spark): `wsl.exe` relays, the stdin pipe trick, Git Bash's
`MSYS_NO_PATHCONV=1`, PowerShell quoting, and the Windows llama-server build.
