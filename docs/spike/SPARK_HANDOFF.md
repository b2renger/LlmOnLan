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

- The harness, quality set and PRO 6000 results are in the repo under **`docs/spike/`**:
  `spike_bench.py`, `quality_set.json`, `README.md` (exact usage), `RESULTS.md` (the PRO 6000 rows and
  the vLLM flags that worked there) and `results/*.json`.
- **If `docs/spike/` is missing from your checkout,** the owner hasn't pushed it yet. Stop and ask for
  the branch (expected: `multiuser-phase0`) or a copy of the folder. Never rewrite the harness: the two
  boxes must be measured identically.
- **Read `docs/spike/README.md` and `RESULTS.md` fully before starting.** Reuse the exact model ids,
  vLLM flags and parsers that worked on the PRO 6000, changing only what the Spark's architecture
  forces. Note every change.

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

Pick ONE, record the exact version, and say why:

1. **A container**, often the least friction on DGX OS: NVIDIA's NGC vLLM image (`nvcr.io/nvidia/vllm`,
   the latest tag compatible with the installed driver), or the official `vllm/vllm-openai` aarch64/cu130
   image. Run it with `--gpus all --network host --ipc host`, mount the HF cache, and use the flags below.
2. **A venv** in `~/lol-spike/.venv` with an aarch64 CUDA-13 wheel, if one is published for the current
   release.

Spark-specific notes from the research (§11.5; verify, don't trust):

- vLLM ≥ 0.27.1 for Nemotron 3.5 Lightning and ≥ 0.28.0 for Qwen3.6 NVFP4.
- On GB10, some NVFP4 MoE models run W4A16 through Marlin; Nemotron's recipe uses
  `--moe-backend marlin`.
- Hybrids need `--mamba-cache-mode align` for prefix caching (experimental on Qwen3.6).
- Make sure CUDA graphs cover batch sizes 10–16.
- FP8 KV only with checkpoints shipping calibrated KV scales, and run one long generation as a sanity
  check, because repetition loops were reported on GB10.

## 5. The matrix (keep it identical to the PRO 6000 run)

**vLLM:** for each model in `RESULTS.md`, in this order, Qwen3.6-35B-A3B → Nemotron 3.5 Lightning →
Qwen3.8-27B:

1. Start with `--enable-prefix-caching`, the explicit `--kv-cache-memory-bytes`, `--max-model-len 131072`
   (or the model max), `--max-num-seqs 64`, and the same reasoning and tool parsers as on the PRO 6000.
2. Record the start-up log's **"GPU KV cache size"** and **"Maximum concurrency for N tokens per
   request"** lines.
3. Run the quality set (`--quality`), then the sweeps exactly as `docs/spike/README.md` says: chat,
   long, agent, plus chat with thinking off.

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
