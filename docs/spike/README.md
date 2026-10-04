# Engine x model spike (multiuser plan 0.6)

**Question:** on one big box, how many people can be served at once, at good quality (reasoning + coding),
with 32k / 64k / 128k of context each, by vLLM and by llama.cpp, for a short list of models?

- Results: [RESULTS.md](RESULTS.md).
- Raw JSON per run, with every request's timings: `results/`.
- Server start-up logs: `results/logs/`.
- Runs kept but not used: `results/superseded/` (each one's reason is in its README).

## Files

| File | What it is |
|---|---|
| `spike_bench.py` | The harness. Python 3.10+, stdlib + `aiohttp`. Works with any OpenAI-compatible server, over TCP or a Unix socket. Subcommands: `bench`, `quality`, `kvlog`, `summarize`, `selftest`. |
| `quality_set.json` | The quality gate: 10 Python tasks (scored by running asserts), 7 reasoning items (exact answers), 11 OpenAI `tools` round-trips. |
| `install_vllm.sh` | Installs vLLM into its own venv `~/lol-spike/.venv` (uv; x86_64 or arm64) and pins the CUDA compiler packages FlashInfer's JIT needs. |
| `download.sh` | Downloads the checkpoints into `~/lol-spike/hf/<name>`. |
| `serve_vllm.sh` / `stop_vllm.sh` | Start `vllm serve` with a stdin-EOF watchdog, which kills the server's whole process group when its launcher dies; stop it. |
| `serve_llamacpp.ps1` | Starts the farm's own `llama-server.exe` (b10670) with the farm's argv (`farm/src/llamacpp.js`). Windows. |
| `runs/vllm_suite.sh` | Quality (thinking on), then chat, agent, cold 32k, chat with thinking off, cold 64k / 128k, then quality (thinking off). |
| `runs/vllm_extend.sh` | 64–192 users for chat and agent, then follow-ups at 32k / 64k / 128k. Use with `--max-num-seqs 192`. |
| `runs/vllm_all.sh` | `vllm_suite.sh` followed by `vllm_extend.sh` against one server. |
| `runs/followup_levels.sh` | Extra follow-up levels, for example with `--append`. |
| `runs/llamacpp_suite.sh` | The reduced llama.cpp suite. |
| `runs/round_stats.py` | Per-turn TTFT and decode statistics from a follow-up result. |

## The harness

```bash
PY=~/lol-spike/.venv/bin/python        # any python with aiohttp
$PY spike_bench.py selftest            # every reference solution passes its own tests

# Load sweeps. Closed loop: c users, each sends --rounds requests back to back, starting within --stagger s.
$PY spike_bench.py bench --base-url http://127.0.0.1:8100/v1 --label <box>-<engine>-<model> --profile chat
$PY spike_bench.py bench ... --profile agent        # shared ~8k prefix (rules + 9 tool schemas) + ~2k unique, tools on
$PY spike_bench.py bench ... --profile long --prompt-tokens 64000          # cold, unique prompt
$PY spike_bench.py bench ... --profile followup --prompt-tokens 120000 --rounds 3 --append --levels 4,8,16
$PY spike_bench.py bench ... --profile chat --thinking off --natural       # the model stops by itself

# Quality gate (4 items in flight; items are independent, so concurrency only changes wall time).
$PY spike_bench.py quality --base-url http://127.0.0.1:8100/v1 --label <same label> --thinking on

$PY spike_bench.py kvlog <server log>          # KV pool, max concurrency, people at 32k / 64k / 128k
$PY spike_bench.py summarize results/*.json    # markdown tables of every level
python runs/round_stats.py results/<followup result>.json   # first follow-up vs later ones
```

Useful options:

- `--uds <socket>` (or `SPIKE_UDS`): talk HTTP over a Unix socket.
- `--levels` / `--extend`: the levels to sweep, and extra levels tried only while the last level still passes.
- `--rounds`: requests per user per level.
- `--warmup-burst N`: N short concurrent requests before the sweep (default 32).
- `--no-save-requests`: leave out the per-request timings.
- `--cold-max-tokens`: output tokens of the follow-up's loading turn.
- `--template-kwargs '{...}'`: extra `chat_template_kwargs`.

### Profiles

| Profile | Prompt | Output | Notes |
|---|---|---|---|
| `chat` | ~4k tokens, unique per request (a session tag at the very start defeats the prefix cache) | 512 | an OWUI message with a pasted document |
| `agent` | ~8k shared prefix (coding-agent rules + 9 file-tool schemas, byte-stable) + ~2k unique (a code file + task), `tools` + `tool_choice: auto` | 1024 | the coding agent's tool steps; the prefix cache should hit |
| `long` | `--prompt-tokens` (default 32000), unique per request | 256 | cold: no prefix-cache help |
| `followup` | see below | 256 | what one turn costs a person deep into a 32k / 64k / 128k chat. Use `--rounds 3`. |

How `followup` works: each user's own context (`--prompt-tokens`, e.g. 30000 / 62000 / 120000) is loaded in round 0,
which isn't scored. All users then sync. Every later round sends a new question on that context:

- **Default:** the same document with the question *replaced*.
- **`--append`:** the whole history plus one new exchange, as Open WebUI sends a chat. Prefer `--append` for hybrid
  models (RESULTS.md, finding 10).

Every request sets `ignore_eos: true` and jitters `max_tokens` by ±20 %, so output lengths are comparable across
models and users drift out of step. `--natural` lets the model stop by itself, with no jitter. Prompt sizes are
calibrated once per run with the server's own `/tokenize`, and each request's real `prompt_tokens` is recorded.

### What a level reports

- **TTFT** p50 / p95 (s): the first streamed token of any kind (reasoning, content or a tool-call delta).
  - The **steady** variant counts rounds ≥ 1 only, after users have drifted out of step.
  - The **round-0** variant counts the synchronised start: everyone sends within `--stagger` s, as when a room
    presses Enter together.
- **Per-user decode tok/s**, median and p10, per request: `(completion_tokens - 1) / (last token - first token)`.
- **Aggregate tok/s**: tokens per second over the window when every user is active.
- **Errors**, **VRAM max** and **GPU utilisation** (nvidia-smi every 2 s).
- **The server's own counters** (`/metrics`): preemptions, prefix-cache hit rate, KV usage, running and waiting.
- **Pass** = no errors AND TTFT p95 < 5 s AND decode p10 ≥ 15 tok/s, checked over all requests
  (`pass_p10`), over steady turns (`pass_steady`) and with the median instead of p10 (`pass_median`). "People" is
  the largest passing level.

### Quality gate

28 items, fixed for every model, scored automatically:

- **code (10):** the reply's Python block plus the item's asserts run in a subprocess (`python -I`, a temp dir,
  30 s timeout, a minimal environment). This is not a security sandbox: it runs model-written code on the bench
  box. `eval_expr` blocks `eval` and `exec`.
- **exact (7):** the last `ANSWER:` line (or `\boxed{}`), compared as a number, a reduced fraction or text.
- **tool (11):** an agent loop of up to 5 steps with OpenAI `tools`.
  - Every `tool_calls` entry must name a given tool and carry JSON-object arguments.
  - Every expected call (name + argument matchers) must be made.
  - Canned results are fed back as `role: tool` messages.
  - The final text must contain the expected fact.
  - One item checks that the model answers *without* a tool when none is needed.
- **Sampling:** temperature 0.6, top_p 0.95, seed 1234, max_tokens 16384 (8192 with thinking off). The server's
  `generation_config` supplies `top_k` (20 for the Qwens). Everything is recorded in the JSON.

## Running the matrix

### vLLM (WSL2 on Windows, or native Linux)

```bash
bash install_vllm.sh                 # -> ~/lol-spike/.venv (vLLM 0.30.0 + torch 2.13.0+cu132 here)
bash download.sh                     # -> ~/lol-spike/hf/<name>
```

Run one model at a time. Each model's exact flags are in RESULTS.md. From Git Bash on Windows:

```bash
( while :; do sleep 5; echo || exit; done ) | MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- \
  bash /mnt/c/.../docs/spike/serve_vllm.sh qwen36 ~/lol-spike/hf/Qwen3.6-35B-A3B-NVFP4 \
  --served-model-name qwen3.6-35b-a3b-nvfp4 --uds ~/lol-spike/run/vllm.sock ...
```

The `echo` loop keeps the stdin pipe open. When the launcher dies, the watchdog kills the server's whole process
group, EngineCore included. To stop it yourself, run `bash stop_vllm.sh`, then check that `nvidia-smi` is back at
baseline and that `pgrep -af "vllm serve|EngineCore"` is empty.

**WSL2 only: serve on a Unix socket.** On this box (WSL 2.6.3, `networkingMode=mirrored`), vLLM's TCP listener on
127.0.0.1 never answered. SYNs timed out on 8100 and 8101, from WSL and from Windows, while plain Python listeners
on the same ports worked. This was not root-caused. The workaround:

- Serve with `vllm serve ... --uds ~/lol-spike/run/vllm.sock`.
- Run the harness as `SPIKE_UDS=~/lol-spike/run/vllm.sock python spike_bench.py ... --base-url http://localhost/v1`.

On a native Linux box (the Spark), use plain TCP.

**FlashInfer's JIT needs a consistent CUDA toolkit.** vLLM 0.30.0 JIT-compiles FlashInfer kernels for sm_120 at
first use (FP8 linears, attention prefill).

- `serve_vllm.sh` puts the venv's `ninja` and the pip `nvcc` on PATH, and sets `CUDA_HOME`.
- `serve_vllm.sh` also gives the linker unversioned `libcudart.so` / `libcublas*.so` / `libcuda.so` names through
  `FLASHINFER_EXTRA_LDFLAGS`.
- `install_vllm.sh` pins `nvidia-cuda-nvcc`, `nvidia-cuda-crt` and `nvidia-nvvm` to the CUDA runtime's minor version
  (13.2 here).

The four failures, in the order they appeared:

1. `FileNotFoundError: 'ninja'`.
2. `CUDA compiler and CUDA toolkit headers are incompatible` (nvcc 13.4 vs the 13.2 runtime).
3. `ptxas fatal: Unsupported .version 9.4; current version is '9.2'` (cicc from nvvm 13.4).
4. `ld: cannot find -lcudart / -lcuda / -lcublas`.

The first start compiles ~30 kernels (~3 min). Later starts reuse `~/.cache/flashinfer` and take 1.5–2.5 min.

**Size the KV pool with `--kv-cache-memory-bytes`.** It is an absolute size, and it skips the start-up memory
profiler, which aborts when another process changes VRAM. Never use `--gpu-memory-utilization`, which is a fraction
of TOTAL VRAM. Leave 6–8 GB of headroom.

```bash
$PY spike_bench.py kvlog ~/lol-spike/logs/<run>.log
SPIKE_UDS=... bash runs/vllm_all.sh <label> "<exact command>" http://localhost/v1     # needs --max-num-seqs 192
SPIKE_UDS=... bash runs/followup_levels.sh <label> 120000 4,8,16,24,32 http://localhost/v1 --append
```

### llama.cpp (Windows, the farm's b10670 build)

```powershell
powershell -File serve_llamacpp.ps1 -Model <gguf> -Parallel 16 -Ctx 2097152 -KvType q8_0 -Log results\logs\<run>.log
```

Then run `bash runs/llamacpp_suite.sh <label> "<notes>" 1,4,8,16` from WSL (mirrored networking reaches
Windows' 127.0.0.1). Stop it with `Stop-Process -Id (Get-Content $env:TEMP\lol-spike-llama.pid)`.

## Re-run on another box (DGX Spark)

1. Install `uv`, then run `bash install_vllm.sh 0.30.0`. arm64 wheels exist; record the versions it prints. If
   vLLM picks a different CUDA, the nvcc/crt/nvvm pin follows the runtime automatically.
2. Run `bash download.sh`, or point at an existing HF cache.
3. Serve each model with the flags in RESULTS.md.
   - Use `--host 127.0.0.1 --port 8100` instead of `--uds`.
   - Fit `--kv-cache-memory-bytes` to the Spark's unified 128 GB. Leave 10–15 GB for the OS and services.
   - The Spark has no separate VRAM, so watch `free -g` instead of nvidia-smi's memory column.
   - Expect the same **Marlin** MoE path: these NVFP4 checkpoints are W4A16 on their experts.
   - `--max-num-seqs 192` keeps the extension levels possible. On a bandwidth-bound box, expect them to fail
     early; the sweep aborts on its own.
4. Run the sequence used here, with a `spark-...` label:
   - `runs/vllm_all.sh`.
   - `runs/followup_levels.sh <label> 30000 <levels> ... --append`, and the same at 120000 for any model whose
     replace-mode follow-ups miss the cache (check `runs/round_stats.py`: round 1 far slower than round 2).
5. Run `python spike_bench.py summarize results/*.json` and add the rows to RESULTS.md's headline table.

**x86 / Windows-specific, not needed on the Spark:**

- `wsl.exe` relays and the stdin-pipe trick.
- `--uds`.
- Git Bash's `MSYS_NO_PATHCONV=1` and PowerShell quoting. `wsl.exe -- bash -lc '...'` expands `$VAR` and `|` before
  bash sees them, so use script files.
- The Windows llama-server build.
