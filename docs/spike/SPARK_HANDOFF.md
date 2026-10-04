# Spark spike — instructions for the Claude instance on the DGX Spark

You are picking up a measurement started on 2026-10-04 on the studio's RTX PRO 6000 (`AN-A6000PRO`).
Your job: run **the same harness, the same way**, on a DGX Spark, so the owner can compare the two boxes.
**Do not write farm or client code here.** This is measurement only.

## 1. Why this matters (read before anything else)

LlmOnLan is a desktop client plus a LAN inference farm (read `CLAUDE.md` at the repo root). The owner's
multi-user goal (2026-10-04) is **optimisation**: serve the most people at good quality (reasoning and
coding) with a high context, on the **fewest boxes**.

The studio may buy more Sparks, or one or two more RTX PRO 6000-class cards. Your numbers are half of that
purchase decision. Background: `multiuser_implementation_plan.md` §1b and §4a item 0.6 (the spike spec),
§9 (model research) and §11.2/§11.5 (Spark-specific notes).

**The question for this box:** how many people at once at 32k / 64k / 128k context per person, with the
quality gate passed, for each engine × model? Report two numbers:

- **People by KV capacity:** KV pool ÷ context per person.
- **Latency-bounded people:** the largest concurrency with TTFT p95 < 5 s **and** ≥ 15 tok/s per user.

## 2. Get the harness

- It's on GitHub, on branch **`multiuser-phase0`**:
  `git fetch origin && git checkout multiuser-phase0`. Everything is under **`docs/spike/`**:
  - `spike_bench.py`, `quality_set.json`;
  - `install_vllm.sh`, `download.sh`, `serve_vllm.sh`, `stop_vllm.sh`;
  - `runs/`, the suites;
  - `README.md` (exact usage, and a **"Re-run on another box (DGX Spark)"** section);
  - `RESULTS.md` (the PRO 6000 numbers and the exact flags that worked);
  - `results/`, the raw JSON.
- **Never rewrite the harness:** the two boxes must be measured identically.
- **Read `README.md` (especially "Re-run on another box") and `RESULTS.md` fully before starting.** Reuse
  the exact model ids, vLLM flags and parsers from RESULTS.md's "Exact install and launch commands that
  worked", changing only what the Spark forces. Note every change.

**The PRO 6000 headline you are comparing against** (vLLM 0.30.0, GPU exclusive, `every turn / steady`):

| Model | 32k | 64k | 128k |
| --- | --- | --- | --- |
| Qwen3.6-35B-A3B | 96 / 128 | 48 / 64 | 32 / 40 |
| Nemotron 3.5 Lightning | 160 / ≥ 192 | 16 / 64 | 24 / 48 |
| Qwen3.8-27B | 16 / 32 | ≥ 24 | ≥ 12 |

llama.cpp: Nemotron 4 / 8 at 32k, Qwen3.8 ≤ 1.

## 3. Rules on this box

- **The Spark serves a live LlmOnLan farm.** Its engine (llama.cpp or Ollama) lives in the same 128 GB
  of **unified** memory you need, so measuring beside it is meaningless and can push the box into OOM.
  **Ask the owner before stopping the farm.** Write down exactly what was running (`lol status`, or the
  Farm app's window, `nvidia-smi`, `free -g`), and restart it when you are done, or tell the owner you
  didn't.
- **Before you start:** run `ps aux | grep -E "vllm|llama-server|ollama|python"`, `nvidia-smi` and
  `free -g`, and record the baseline. Only kill processes **you** started.
- **Unified memory:** the OS, the farm's plugins and your engine share 128 GB.
  - Size vLLM with an explicit **`--kv-cache-memory-bytes`**. Start from a total of about 85–95 GB for
    weights plus KV, leaving 15–20 GB for the OS.
  - `--gpu-memory-utilization` is a fraction of the shared pool, and NVIDIA's examples (0.85–0.91)
    leave too little.
  - Watch `free -g` during the first start. Never `--enforce-eager`.
- **Ports:** never use the farm's (4000, 4001, 41997, 8081, 11434, 1883, 8893, 9001). Use **8100** for
  vLLM and **8190** for llama-server, as on the PRO 6000.
- **Thermals:** one report had a Spark hard-power-off under sustained full load (§11.5).
  - Log `nvidia-smi --query-gpu=temperature.gpu,clocks.sm,power.draw --format=csv -l 10` to a file
    during every sweep.
  - If the temperature climbs without levelling off, stop the sweep and report.
  - Don't lock clocks without the owner.
- **Downloads:** reuse the checkpoints named in `RESULTS.md`. Ask the owner before downloading more than
  ~75 GB in total. gpt-oss-120b (~65 GB) is an optional extra **only with the owner's OK**: the Spark
  is the one box where it fits.
- **Don't commit or push.** Leave the results in `docs/spike/results/` and `RESULTS.md`, and tell the
  owner.

## 4. Install vLLM (linux-arm64, GB10 / CUDA 13)

**Use the same version as the PRO 6000: vLLM 0.30.0**, via the spike's own script, so the comparison is
fair. Install `uv`, then:

```bash
bash docs/spike/install_vllm.sh 0.30.0
```

It builds `~/lol-spike/.venv` (Python 3.12) and pins nvcc/crt/nvvm to the CUDA runtime's minor version.
arm64 wheels exist; record the versions it prints. The pins and the link shim in `serve_vllm.sh` exist
because FlashInfer JIT-compiles kernels on first use. On the PRO 6000 (sm_120), four toolchain failures
came before those pins. Expect the same on sm_121.

Only if the venv route fails after a real attempt, fall back to a container: NVIDIA's NGC vLLM image or
`vllm/vllm-openai` aarch64/cu130, at the closest version. Then say so in the results, since it's a
different build.

Then `bash docs/spike/download.sh` (the same three NVFP4 checkpoints, ~67 GB), or point at an existing HF
cache.

Spark-specific notes from the research (§11.5; verify, don't trust):

- vLLM ≥ 0.27.1 for Nemotron 3.5 Lightning and ≥ 0.28.0 for Qwen3.6 NVFP4.
- On GB10, some NVFP4 MoE models run W4A16 through Marlin; Nemotron's recipe uses
  `--moe-backend marlin`.
- Hybrids need `--mamba-cache-mode align` for prefix caching (experimental on Qwen3.6).
- Make sure CUDA graphs cover batch sizes 10–16.
- FP8 KV only with checkpoints shipping calibrated KV scales, and run one long generation as a sanity
  check, because repetition loops were reported on GB10.

## 5. The matrix (keep it identical to the PRO 6000 run)

**vLLM:** follow README.md's "Re-run on another box (DGX Spark)" steps exactly. For each model, in this
order, Qwen3.6-35B-A3B → Nemotron 3.5 Lightning → Qwen3.8-27B:

1. **Serve** through `serve_vllm.sh` with RESULTS.md's common and per-model flags, with two changes:
   - **TCP** (`--host 127.0.0.1 --port 8100`), not `--uds`. The socket was a WSL workaround.
   - **`--kv-cache-memory-bytes` fitted to unified memory.** The PRO 6000 ran 62277025792 (58 GiB). On
     the Spark, start near 85 GB (≈ 91000000000) for one model's ~20 GB of weights, and lower it if
     `free -g` drops under ~10 GB free during start-up or a sweep. Record the value you used.

   Keep `--max-num-seqs 192`, `--max-model-len 131072`, `--enable-prefix-caching`,
   `--mamba-cache-mode align`, `--enable-auto-tool-choice`, and the same reasoning/tool parsers.
2. **Record** the start-up log's **"GPU KV cache size"** and **"Maximum concurrency for N tokens per
   request"** lines, and which MoE backend it picked. Expect **Marlin**: the experts are W4A16.
3. **Run the suites with a `spark-…` label:** `runs/vllm_all.sh` (quality via the `quality` subcommand,
   chat, agent, cold, thinking off), then `runs/followup_levels.sh <label> 30000 <levels> … --append` (and
   at 120000 where `runs/round_stats.py` shows round 1 much slower than round 2). The sweeps abort on their
   own when a level fails. On a bandwidth-bound box, expect the high levels to fail early.
4. **Summarize** with `python docs/spike/spike_bench.py summarize docs/spike/results/spark-*.json`.

**llama.cpp baseline:**

- Use the farm's own linux-arm64 llama-server, build b10670 from our CI's `llamacpp-b10670` release. The
  Spark farm has usually already downloaded it: look under the farm's install (Farm app `userData/farm`
  or the repo's `farm/`) for the extracted `llama-server`. **Read only**: copy it if needed, never
  modify the farm's files.
- Use local GGUFs only: the farm's `.models/` and Ollama blobs (`ollama show --modelfile <name>` → the
  `FROM` path). **Don't load models through the shared Ollama.**
- Flags: `--parallel 8` and `16`, `--kv-unified`, ctx ≥ 32k per slot where it fits, `--cache-reuse 256`,
  `--jinja`, flash attention on, port 8190.
- Run the same quality set and the reduced sweeps (chat + agent, c = 1, 4, 8, 16).

**After every server stop,** verify that `nvidia-smi` and `free -g` return to the baseline and that no
`vllm`/`EngineCore`/`llama-server` processes of yours are left.

## 6. Hand back

- Results JSON in `docs/spike/results/spark-<engine>-<model>-<date>.json`.
- Add the Spark rows to `docs/spike/RESULTS.md`, in the same table format as the PRO 6000 rows.
- Write a short **"PRO 6000 vs Spark"** section:
  - People per box at 32k/64k/128k for the best config on each.
  - Quality-gate scores.
  - What differed in setup.
  - Anything that suggests buying one over the other, with the caveat that it rests on one run per box.
- Report: versions (vLLM, torch, CUDA, driver), exact launch commands, what broke and the workaround,
  thermals, and the state you left the box in (farm restarted or not, memory baseline, no leftover
  processes).
