# Engine × model spike — results (multiuser plan 0.6)

Two boxes, the same harness, the same flags:
- the **RTX PRO 6000** (2026-10-04), the sections from here down to *Not done, and why*;
- a **DGX Spark** (2026-10-05/06), the section [DGX Spark (GB10)](#dgx-spark-gb10) and
  [PRO 6000 vs Spark](#pro-6000-vs-spark) at the end;
- two more models on the RTX PRO 6000 (2026-10-09), with the farm's own launch and a reduced suite:
  [Gemma 4 12B and Qwen3-Omni](#gemma-4-12b-and-qwen3-omni-rtx-pro-6000-2026-10-09);
- Recursive's Flint for coding (2026-10-23), beside the live farm with most of its experts in system RAM, and the IDE's
  coding agent on five tasks against the farm's Qwen3.6: [Flint](#flint-for-coding-rtx-pro-6000-shared-gpu-2026-10-23),
  the last section.

**Box:** `AN-A6000PRO`: one NVIDIA RTX PRO 6000 Blackwell Workstation Edition, 96 GB (97,887 MiB), sm_120,
~1.8 TB/s, driver 596.36 (CUDA 13.2), Windows 11 + WSL2 Ubuntu 26.04 (16 vCPU and 94 GB RAM given to WSL).
**Date:** 2026-10-04. **The GPU was exclusive** (ComfyUI and the live farm were stopped), so these are ceiling
numbers. The Windows desktop holds 1.7 GB of VRAM at idle, and every VRAM figure below includes it.

**Engines:**
- **vLLM 0.30.0** (torch 2.13.0+cu132, CUDA 13.2, FlashInfer 0.6.18.post1, Python 3.12.13) in its own venv in WSL2.
- **llama.cpp b10670** (`llama-b10670-bin-win-cuda-13.3-x64`, the Farm app's own build), native Windows.

**Models:**
- **Qwen3.6-35B-A3B**: hybrid GatedDeltaNet MoE.
- **Nemotron 3.5 Lightning 30B-A3B**: Mamba-2 + MoE, with 6 attention layers out of 52.
- **Qwen3.8-27B**: dense, with hybrid attention.

vLLM ran NVIDIA's NVFP4 checkpoints. llama.cpp ran the Q4_K_M GGUFs already in Ollama. There was no Qwen3.6 GGUF
on the box, so that cell is empty.

Harness, profiles and rules: [README.md](README.md). Raw JSON (every request's timings): `results/`. Server
logs: `results/logs/`. Tables of every level: `python spike_bench.py summarize results/*.json`.

## How to read "people"

A level **passes** when all three hold: no errors, **TTFT p95 < 5 s**, and **per-user decode p10 ≥ 15 tok/s**
(90 % of requests stream at 15 tok/s or more). "People" is the largest passing concurrency. It is given two ways,
as `every turn / steady`:

- **every turn** counts all requests, including each user's first. Every user starts within 3 s of the others: a
  room pressing Enter together, or the first question after everyone loaded a long document.
- **steady** counts later turns only, once users are out of step (normal office use).

**Profiles:**

| Profile | Prompt | Output |
|---|---|---|
| **chat** | one 4k-token message | 512 tokens |
| **agent** | the coding agent's tool step: an 8k shared prefix with 9 tool schemas + 2k unique, `tools` on | 1024 tokens |
| **at 32k / 64k / 128k** | the `followup` profile: each person's own ~30k / ~62k / ~120k-token conversation is already in the KV pool, and they ask a new question. This is what each turn costs someone deep into a long chat. | 256 tokens |
| **cold** | a brand-new, unique prompt of that size (worst case: pasting a whole document) | 256 tokens |

Output lengths are fixed (`ignore_eos`). So thinking on or off changes *how many* tokens a reply needs, not the
per-token speed. The quality column shows that token bill.

**KV capacity** = the engine's KV pool ÷ the context per person. For vLLM this is its own start-up figure. For
llama.cpp it is the pool ÷ context, capped by `--parallel`.

> **Correction (2026-10-06, `ESTIMATES_2026-10-05.md` § Method):** for the hybrid models, the vLLM figures in the
> "People by KV capacity" columns overstate capacity, on both boxes.
> - **The cause:** they are the pool's tokens ÷ the window. vLLM 0.30 also charges every request its recurrent
>   state in pages: 6 blocks (128.8 MB) per person for Qwen3.6 and 8 (102.6 MB) for Nemotron, rounded up to whole
>   2,096- or 4,176-token blocks.
> - **The real capacity at the 58 GiB pool:**
>   - Qwen3.6: **132 / 76 / 42** people at 32k / 64k / 128k, not 168 / 84 / 42.
>   - Nemotron: **303 / 202 / 121**, not 485 / 243 / 121.
>   - Qwen3.8 holds **46.6** conversations of 30k. That is exactly why it collapsed at 48 users (footnote ³): 48 ×
>     26 = 1,248 blocks is more than its 1,212. It is not an early collapse.
> - **What doesn't change:** the measured "people" columns, and the conclusion that throughput, not KV, binds
>   first on the 96 GB card and on the Spark.

## Headline table (RTX PRO 6000, GPU exclusive)

People are given as `every turn / steady`. **≥ N** means N was the highest level tested and it passed.

| Engine · model (weights) | Context per person | **People at this context** | People by KV capacity | 4k chat message | Agent step | Cold prompt of this size | Quality gate: thinking on / off (tokens used) | VRAM used |
|---|---|---|---|---|---|---|---|---|
| **vLLM · Qwen3.6-35B-A3B** (NVFP4, experts W4A16 via Marlin) | 32k | **96 / 128** | 168 | 64 / 160 | 64 / ≥ 192 | 4 | **27/28 (77k) / 28/28 (12k)** | 85.0–87.0 GB |
| | 64k | **48 / 64** | 84 | | | 2 | | |
| | 128k | **32 / 40** ¹ | 42 | | | 0 (8.0 s alone) | | |
| **vLLM · Nemotron 3.5 Lightning** (NVFP4, experts W4A16 via Marlin) | 32k | **160 / ≥ 192** | 485 | 64 / ≥ 192 | 96 / ≥ 192 | 4 / 16 | 25/28 (68k) / 26/28 (7k) | 86.3–87.2 GB |
| | 64k | **16 / 64** ² | 243 | | | 2 / 4 | | |
| | 128k | **24 / 48** | 121 | | | 0 (5.7 s alone) | | |
| **vLLM · Qwen3.8-27B** (NVFP4 W4A4 dense, native FP4 GEMM) | 32k | **16 / 32** ¹ ³ | 54 | 16 / 32 | 32 / 96 | 2 / 4 | 26/28 (55k) / **28/28 (11k)** | 85.2–88.8 GB |
| | 64k | **≥ 24 / ≥ 24** | 27 | | | 0 (8.1 s alone) | | |
| | 128k | **≥ 12 / ≥ 12** | 13 | | | 0 (20.9 s alone) | | |
| **llama.cpp · Nemotron 3.5 Lightning** (Q4_K_M), `--parallel 16`, 2M-token unified pool | 32k | **4 / 8** | 16 (slots) | 8 / 16 | 4 / 16 | 1 | 26/28 (65k) | 36.7 GB |
| | 128k | **0 / ≥ 4** ⁴ | 16 (slots) | | | — | | |
| **llama.cpp · Qwen3.8-27B** (Q4_K_M), `--parallel 8` / `16` | 32k | ≤ 1 ⁵ | 8 / 16 (slots) | 1 | 1 | 0 | 26/28 (48k) | 28.6 / 39.8 GB |
| | 64k / 128k | ≤ 1 | 8 / 4 (pool 524k) | | | — | | |

¹ Measured with the `--append` follow-up (each turn re-sends the history and adds one exchange, as Open WebUI does).
With the question *replaced* instead of appended, these two cases miss vLLM's hybrid prefix cache on the first
follow-up (see *What broke*).
² At 64k with 32 users, the first turn after the documents loaded has a TTFT p95 of 5.15 s, just over the line.
Every later turn passes up to 64.
³ Qwen3.8 at 32k collapses at 48 users: the KV pool peaks at 92 % and cached conversations get evicted. It is
KV-bound well before the 54 the start-up log promises.
⁴ llama.cpp at 128k: the first follow-up after the document loads re-prefills the whole context, even with the
history appended (12.4 s at 2 users). Later turns hit (0.4 s at 4 users). Its pool covers 16 slots × 128k.
⁵ Qwen3.8 on llama.cpp passes only alone. Its aggregate tops out at ~175–196 tok/s, and a 32k cold prefill takes
10.6 s.

**Server commands** for each row are under *Exact install and launch commands that worked*. Every vLLM row ran
with `--kv-cache-memory-bytes 62277025792` (58 GiB), which left 9.1–12.9 GB of the card free.

## Findings

1. **Best config for "max people × quality × context": vLLM + Qwen3.6-35B-A3B NVFP4.** On one PRO 6000 it serves
   **96–128 people at 32k, 48–64 at 64k and 32–40 at 128k** each, with the best quality score (27/28 thinking on,
   28/28 thinking off). It also has vision, which Nemotron lacks.
2. **Nemotron 3.5 Lightning carries the most people:** 160–192 at 32k and 24–48 at 128k, with a 15.9M-token KV
   pool (3× Qwen3.6's). It decodes at 240 tok/s for one person and reaches 4,959 tok/s aggregate (agent, 192
   users). It scored slightly lower: 25/28 thinking on, where three coding answers ran out of thinking budget, and
   26/28 thinking off. The vendor's coding scores agree (§9: SWE-V 52.8 against Qwen3.6's 73.4). That makes it the
   model for the Computer and for high head counts, not the coding default.
3. **The dense Qwen3.8-27B serves 4–6× fewer people than the 3B-active MoEs at 32k (16–32), and 2–3× fewer at
   64k (24) and 128k (12).** Its causes are 62 tok/s single-stream, 9.8k tok/s prefill, and a 1.77M-token pool.
   The measured KV cost per token, from vLLM's pool ÷ tokens: Qwen3.8 ~35 KB, Qwen3.6 ~11 KB, Nemotron ~3.9 KB
   (fp8, hybrid state included). Its quality is not better on this gate: 26/28 thinking on, 28/28 thinking off.
4. **vLLM vs llama.cpp (same model, Nemotron): 160 vs 4 people at 32k on every turn, 192 vs 8 in steady use: 24–40×.** The cause is not
   single-stream speed: llama.cpp decodes slightly faster alone (283–318 vs 240 tok/s, and 67–73 vs 62 for
   Qwen3.8). The gap comes from three places:
   - **Aggregate throughput:** llama.cpp flattens at ~600 tok/s, while vLLM reaches ~5,000.
   - **Prefill:** vLLM's is 3× faster (30k vs 9.6k tok/s at 32k).
   - **Admission:** llama.cpp admits only `--parallel` users and queues the rest.

   For Qwen3.8 the gap is **1 vs 16–32 people**. The farm's current engine and model (llama.cpp, a Qwen3.8 GGUF)
   are the worst cell in the matrix.
5. **The KV pool is not the binding limit on the MoE hybrids. Throughput and TTFT bind first.** Qwen3.6 holds 42
   people at 128k by capacity and passes 32–40. Nemotron holds 121 and passes 24–48. The dense Qwen3.8 is the
   exception: KV binds it (finding 3, footnote ³).
6. **Turning thinking off is the cheapest lever, and it cost no quality here.** All three models scored as well
   or better with `enable_thinking: false`, using **5–9× fewer tokens** (Qwen3.6: 77k → 12k; Qwen3.8: 55k → 11k;
   Nemotron: 68k → 7k). With thinking on, the misses were runaway reasoning hitting the 16k cap, not wrong
   answers. Caveat: this is a 28-item smoke gate, not a benchmark.
7. **What a "person" costs depends on how people arrive, more than on context.**
   - **When everyone presses Enter within 3 s**, the TTFT tail binds: 64 people for a 4k chat on any of the MoEs.
   - **In steady use**, the same box holds 160–192 people. For example, Nemotron chat at 192 users: TTFT p95
     0.84 s, decode p10 15.8 tok/s.
   - The gap between those two numbers (64 vs 160–192) is what admission control could recover: a fair queue
     that spreads the first prefills (plan §1.2). Not measured.
8. **Cold long prompts are the real limiter.** A unique 128k prompt takes 5.7–8.0 s (MoEs) or 20.9 s (Qwen3.8) for
   *one* person, so a 128k document never meets TTFT < 5 s cold. Concurrent cold 32k prompts arriving together
   pass only up to ~4 people (16 for Nemotron once out of step). Long contexts are affordable only when they are built up turn by turn on a warm prefix cache.
9. **NVFP4 on sm_120:**
   - **Native FP4 GEMM works** (Qwen3.8's dense linears ran on `FlashInferCutlassNvFp4LinearKernel`).
   - **Both MoE checkpoints are W4A16 for their experts** (`hf_quant_config.json`: `"quant_algo": "W4A16_NVFP4"` on
     161 groups for Qwen3.6). vLLM therefore runs their experts through **Marlin** (weight-only FP4,
     dequantised).
   - Forcing a native FP4 MoE backend fails by design: *"NvFp4 MoE backend 'FLASHINFER_CUTLASS' does not support
     the deployment configuration since kernel does not support quantization scheme
     QuantKey(u8,scale(f8e4m3fn,static,GroupShape(row=1, col=16)),scale2(f32,static,per_tensor),symmetric)xNone"*
     (`xNone` means no activation quantization).
   - vLLM's warning "Your GPU does not have native support for FP4 computation" is misleading here: the cause is
     the checkpoint, not the card. The Spark will take the same Marlin path (NVIDIA's own Spark recipes say
     `--moe-backend marlin`).
10. **Hybrid prefix caching in vLLM 0.30 (`--mamba-cache-mode align`) only reuses a context that the next request
    extends.** That is the normal chat case, and with it every model hit the cache on the first follow-up. If a
    request *rewrites* the end of the previous prompt (regenerate, edit-and-resend), a GatedDeltaNet hybrid
    (Qwen3.6, Qwen3.8) re-prefills the whole context once, depending on where the last block boundary falls.
    Nemotron's 4,176-token blocks made that rare. `--mamba-cache-mode all` is refused for these models ("falling
    back to 'align' mode"). For the farm, this means an OWUI regenerate on a 128k Qwen chat costs a full 8–20 s
    prefill.
11. **The purchase case for tomorrow's Spark run:** compare people at 32k/128k from the same harness. A PRO 6000
    with vLLM serves **96–128 (Qwen3.6) or 160–192 (Nemotron) people at 32k**. The Spark has ~15 % of the PRO
    6000's memory bandwidth (273 vs ~1,800 GB/s) and ~1.3× its memory. If its people-per-box land near that
    bandwidth ratio, one PRO 6000-class card does the work of ~6 Sparks for these models, and the decision becomes
    price per seat. The Spark's extra memory only helps where KV binds (dense models, 128k). This is an
    expectation; the Spark run decides. **Measured (see [PRO 6000 vs Spark](#pro-6000-vs-spark)): the gap
    is wider than bandwidth alone predicted. One PRO 6000 serves 6–16× more people than one Spark.**
12. **vLLM in WSL2 worked for the whole spike**, with three workarounds: Unix-socket serving, the FlashInfer
    toolchain pins, and the stdin-EOF watchdog (*What broke*). Its overhead against native Linux on this card was
    not measured. The native-Linux Spark should need only the toolchain pins.

## Detail per configuration

### vLLM · Qwen3.6-35B-A3B NVFP4

The server picked the **MARLIN** NVFP4 MoE backend, FlashInfer FP8 linears, FlashInfer attention (`xqa` decode),
a 2,096-token attention block (padded to the mamba page size), `max_num_batched_tokens` 8192, and no speculative
decoding. Weights 20.4 GiB. KV pool **5,510,722 tokens** (58 GiB, fp8), which is **42.0×** at 128k.

| Profile | c=1 | c=8 | c=16 | c=32 | c=64 | c=96 | c=128 | c=160 | c=192 |
|---|---|---|---|---|---|---|---|---|---|
| chat, decode p10 (tok/s) | 193 | 110 | 58 | 50 | 34 | 24 | 19 | 15.9 | 13.7 |
| chat, TTFT p95 every turn / steady (s) | 0.14 | 0.25 | 3.1 | 1.8 | 2.7 / 0.40 | 5.6 / 0.50 | 8.2 / 0.56 | 11.2 / 0.79 | 14.3 / 0.83 |
| agent, decode p10 | 192 | 115 | 85 | 59 | 36 | 26 | 22 | 18 | 15.2 |
| agent, TTFT p95 every turn / steady | 0.15 | 0.27 | 0.38 | 1.3 | 4.0 / 0.49 | 7.6 / 0.56 | 10.7 / 0.51 | 14.2 / 0.62 | 17.8 / 0.70 |
| aggregate tok/s (agent) | 190 | 941 | 1,445 | 2,050 | 2,642 | 2,852 | 3,206 | 3,341 | 3,431 |

Chat with thinking off and natural lengths passes up to the 64 tested. Cold prefill: 32k in 1.13 s (28k tok/s),
64k in 3.0 s, 128k in 8.0 s. Follow-ups:

| Context | Users | TTFT p95, first follow-up (s) | TTFT p95, later follow-ups (s) | Decode p10 later (tok/s) |
|---|---|---|---|---|
| 32k | 96 | 3.3 | 0.41 | 19 |
| 32k | 128 | 4.3 | 0.45 | 15.4 |
| 64k | 48 | 4.3 | 0.65 | 21 |
| 64k | 64 | 5.8 | 0.69 | 16.4 |
| 128k (append) | 32 | 4.9 | 1.1 | 19 |
| 128k (append) | 40 | 6.5 | 0.80 | 15.7 |

### vLLM · Nemotron 3.5 Lightning NVFP4

The server picked **MARLIN** MoE, the FlashInfer mamba SSU backend, FlashInfer attention, and a 4,176-token block.
The checkpoint ships calibrated FP8 KV scales; vLLM warns that it falls back to `q_scale = 1.0`. Weights 17.8 GiB.
KV pool **15,905,587 tokens** (58 GiB), which is **121×** at 128k.

| Profile | c=1 | c=8 | c=16 | c=32 | c=64 | c=96 | c=128 | c=160 | c=192 |
|---|---|---|---|---|---|---|---|---|---|
| chat, decode p10 | 243 | 121 | 85 | 53 | 31 / 37 | 22 / 27 | 19 / 22 | 15.8 / 18 | 13.7 / 15.8 |
| chat, TTFT p95 every turn / steady | 0.12 | 0.20 | 0.24 | 1.1 / 0.26 | 3.6 / 0.53 | 7.8 / 0.53 | 10.2 / 0.50 | 13.6 / 0.68 | 17.0 / 0.84 |
| agent, decode p10 | 242 | 132 | 95 | 68 | 46 | 35 | 30 | 26 | 23 |
| agent, TTFT p95 every turn / steady | 0.09 | 0.14 | 0.15 | 0.27 | 1.3 / 0.29 | 3.3 / 0.30 | 5.0 / 0.29 | 7.1 / 0.38 | 9.1 / 0.45 |
| aggregate tok/s (agent) | 240 | 1,082 | 1,563 | 2,289 | 3,257 | 3,774 | 4,300 | 4,681 | 4,959 |

Follow-ups at 32k pass on every turn up to 160 users (first turn 4.6 s, later 0.64 s, decode p10 18–20). At 192
users the later turns pass (0.56 s, p10 17.6). At 128k, 24 pass on every turn; 48 pass on later turns (1.9 s,
p10 18.7). Cold prefill: 32k in 1.07 s (30k tok/s), 128k in 5.7 s.

### vLLM · Qwen3.8-27B NVFP4

The server picked **FlashInferCutlassNvFp4LinearKernel** (native FP4) for the NVFP4 linears, FlashInfer FP8
linears, FlashInfer attention, and a 1,568-token block. The FP8 KV is uncalibrated (`kv_cache_quant_algo: null`).
Weights 19.9 GiB. KV pool **1,765,102 tokens** (58 GiB), which is **13.5×** at 128k.

| Profile | c=1 | c=8 | c=16 | c=32 | c=48 | c=64 | c=96 | c=128 |
|---|---|---|---|---|---|---|---|---|
| chat, decode p10 | 64 | 46 | 34 | 22 / 25 | | 13 / 14.98 | 8.7 | 7.1 |
| chat, TTFT p95 every turn / steady | 0.33 | 0.82 | 2.5 / 0.65 | 7.5 / 0.98 | | 15.8 / 1.4 | 26.8 / 1.3 | 34.9 / 1.8 |
| agent, decode p10 | 63 | 51 | 43 | 31 | 22 / 24 | 19 / 21 | 13.6 / 15.2 | 11.2 |
| agent, TTFT p95 every turn / steady | 0.26 | 0.58 | 1.5 | 4.8 / 0.53 | 8.7 / 0.79 | 10.8 / 0.79 | 18.1 / 0.96 | 24.4 / 1.1 |

Follow-ups: 32k (append) passes at 16 users on every turn and at 32 on later turns; it collapses at 48 (KV 92 %).
64k passes at 24 users on every turn (TTFT p95 3.8 s, p10 15.5). 128k passes at 12 (2.8 s, p10 17.2). Cold
prefill: 32k in 3.25 s (9.8k tok/s), 64k in 8.1 s, 128k in 20.9 s.

### llama.cpp b10670 (the farm's argv: `-fa 1`, q8_0 KV, `--kv-unified`, `--cache-reuse 256`, `--jinja`)

| Model, slots, pool | Weights + KV (VRAM) | Single-stream decode | Cold 32k TTFT | Aggregate peak | Chat people | Agent people |
|---|---|---|---|---|---|---|
| Nemotron Q4_K_M, p8, 1M | 31.0 GB | 283–318 tok/s | 3.3 s | ~590 tok/s | 8 | 4 |
| Nemotron Q4_K_M, p16, 2M (each slot capped at the model's native 1M) | 36.7 GB | 304–318 tok/s | 3.4 s | ~600 tok/s | 8 / 16 | 4 / 16 |
| Qwen3.8 Q4_K_M (no mmproj), p8, 262k | 28.6 GB | 67–74 tok/s | 10.6 s | ~180 tok/s | 1 (4 with thinking off) | 1 |
| Qwen3.8 Q4_K_M, p16, 524k (each slot capped at 262k) | 39.8 GB | 72–74 tok/s | — | ~196 tok/s | 1 | 1 |

Follow-ups (Nemotron, `--append`, 16 slots):
- **32k:** 4 people pass on every turn; the first follow-up re-prefills (TTFT 3.8 s). 8 pass on later turns
  (0.34 s, decode p10 53 tok/s). 16 fail (decode p10 12).
- **128k:** the first follow-up after loading re-prefills the whole context (12.4 s at 2 users, 26.3 s at 4).
  Later turns hit the slot cache (0.3–0.5 s, decode p10 66–107).

Each extra request beyond `--parallel` waits for a free slot. For Nemotron at 24 and 32 users the steady TTFT is
10–21 s, so llama.cpp's people number equals its slot count at best.
- **Qwen3.8:** llama-server disables `--cache-reuse` ("cache_reuse is not supported by this context").
- **Nemotron:** cache reuse stays on.
- **Cold prompts:** concurrent 32k cold prompts collapse decode for everyone: 1.6–6 tok/s at 8–16 users, because
  prefill and decode share the batch.

## What broke, and the workaround

1. **FlashInfer JIT on sm_120 (vLLM 0.30.0 installs FlashInfer without prebuilt sm_120 kernels).** The first
   request on the FP8 linears and the attention prefill compiles ~30 kernels. Four failures appeared in a row:
   1. `FileNotFoundError: 'ninja'`: the venv was not on PATH.
   2. `CUDA compiler and CUDA toolkit headers are incompatible`: pip resolved `nvidia-cuda-nvcc` 13.4.92 next to
      the 13.2 runtime headers.
   3. `ptxas fatal: Unsupported .version 9.4; current version is '9.2'`: `cicc` comes from `nvidia-nvvm` 13.4.
   4. `ld: cannot find -lcudart / -lcuda / -lcublas / -lcublasLt`: the pip toolkit ships only versioned `.so.13`
      files.

   **Fix:** pin `nvidia-cuda-nvcc`, `nvidia-cuda-crt` and `nvidia-nvvm` to the runtime's minor version
   (`install_vllm.sh`). Put the venv's `bin` and the pip CUDA's `bin` on PATH, set `CUDA_HOME`, and point
   `FLASHINFER_EXTRA_LDFLAGS` at a directory of unversioned symlinks (`serve_vllm.sh`). The first start then takes
   ~3 min; later starts take 1.5–2.5 min (torch.compile and FlashInfer caches).
2. **vLLM's TCP listener was unreachable under WSL2 mirrored networking.** It was in LISTEN on 127.0.0.1:8100
   (and 8101), but SYNs timed out from WSL and from Windows. Plain Python listeners on the same ports worked, even
   while vLLM ran. Not root-caused. **Fix:** `vllm serve --uds ~/lol-spike/run/vllm.sock` and the harness's
   `SPIKE_UDS`. A stale socket file then blocked the next start (`EADDRINUSE`), so `serve_vllm.sh` deletes it
   first.
3. **llama-server and HTTP keep-alive:** 1–4 requests per level failed with `ServerDisconnectedError` when aiohttp
   reused a connection that llama-server had closed. **Fix:** one connection per request. Those runs are in
   `results/superseded/`.
4. **Hybrid prefix cache, `align` mode:** see finding 10. `--mamba-cache-mode all` is not supported for GatedDeltaNet
   models in vLLM 0.30. **Fix:** in the harness, `followup --append` (the realistic chat). For the farm, regenerate
   and edit on long Qwen chats pay a full prefill once.
5. **No native FP4 MoE:** finding 9. Marlin is the only path for these checkpoints. `--moe-backend
   flashinfer_cutlass` refuses to start.
6. **The first measured level after a fresh vLLM start** paid one-off autotune costs (chat c=64 TTFT p95 9.8 s,
   against 2.7 s warm). **Fix:** the harness sends a 32-request warm-up burst before every sweep. At first that
   burst reused the profile's own prompts, which meant 32 × 120k tokens before the 128k follow-ups. That cost a few
   minutes on vLLM, without affecting the measured levels, and 15+ min on llama.cpp, whose run was killed, its
   server restarted, and the run repeated. The burst now uses short prompts.
7. **Box plumbing:**
   - `wsl.exe -- bash -lc '...'` expands `$VAR` and splits on `|` before bash sees them, so the spike drives WSL
     with script files.
   - The PowerShell tool's background tasks are killed after their timeout, and that took a running `uv pip
     install` with them. It was rerun.
   - The Hugging Face downloads ran at ~10–16 MB/s, and xet buffers chunks in memory: a "stalled" `.incomplete`
     file was still downloading. I killed one download needlessly.
   - Downloads: 23.5 GB in 2,105 s, 21.6 GB in 1,899 s, 22.0 GB in 1,959 s.

## Exact install and launch commands that worked

```bash
# WSL2 Ubuntu (x86_64). On the Spark the same, native.
bash docs/spike/install_vllm.sh 0.30.0    # uv venv (Python 3.12) + vllm==0.30.0 --torch-backend=auto (torch 2.13.0+cu132)
                                          # + aiohttp, huggingface_hub + nvcc/crt/nvvm pinned to the CUDA runtime minor
bash docs/spike/download.sh               # nvidia/Qwen3.6-35B-A3B-NVFP4, nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4,
                                          # nvidia/Qwen3.8-27B-NVFP4 -> ~/lol-spike/hf/<name>
```

vLLM: each server through `serve_vllm.sh` (watchdog, PATH/CUDA_HOME/link shim, `HF_HUB_OFFLINE=1`). From Git Bash
on Windows:

```bash
( while :; do sleep 5; echo || exit; done ) | MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /mnt/c/.../docs/spike/serve_vllm.sh <run> <model dir> <args>
```

Common args for every model:

```
--uds ~/lol-spike/run/vllm.sock          # on a native Linux box: --host 127.0.0.1 --port 8100
--max-model-len 131072 --max-num-seqs 192 --kv-cache-memory-bytes 62277025792
--enable-prefix-caching --mamba-cache-mode align --enable-auto-tool-choice
```

Per model:

```
Qwen3.6-35B-A3B-NVFP4:  --served-model-name qwen3.6-35b-a3b-nvfp4 --kv-cache-dtype fp8 \
                        --reasoning-parser qwen3 --tool-call-parser qwen3_xml
Nemotron-3.5-Lightning: --served-model-name nemotron-3.5-lightning-30b-a3b-nvfp4 --kv-cache-dtype fp8 \
                        --mamba-backend flashinfer --reasoning-parser nemotron_v3 --tool-call-parser qwen3_coder
Qwen3.8-27B-NVFP4:      --served-model-name qwen3.8-27b-nvfp4 --kv-cache-dtype fp8_e4m3 \
                        --reasoning-parser qwen3 --tool-call-parser qwen3_coder
```

The first Qwen3.6 suite ran with `--max-num-seqs 64`. Its levels ≤ 64 match the 192 server's within noise.

Stop: `bash docs/spike/stop_vllm.sh`, then check `nvidia-smi` (≈ 1.7 GB) and that
`pgrep -af "vllm serve|EngineCore"` is empty.

llama.cpp (Windows): `powershell -File docs/spike/serve_llamacpp.ps1 -Model <gguf> -Parallel 16 -Ctx 2097152
-KvType q8_0 -Log <log>` starts this:

```
llama-server.exe --model <gguf> --alias <name> --host 127.0.0.1 --port 8190 --ctx-size <N> --n-gpu-layers 999
  --parallel <8|16> --jinja --no-webui --metrics -fa 1 --cache-type-k q8_0 --cache-type-v q8_0
  --cache-reuse 256 --cache-ram 24576 --kv-unified --slot-prompt-similarity 0.4
```

The binary is the Farm app's own, read in place:
`%APPDATA%\LlmOnLan Farm\farm\.llamacpp\bin\llama-server.exe` (`.installed-build` = b10670).

The suites: `runs/vllm_suite.sh` (quality, chat, agent, cold 32k/64k/128k, chat thinking-off, quality
thinking-off), `runs/vllm_extend.sh` (64–192 users, follow-ups), `runs/followup_levels.sh` (extra follow-up
levels, `--append`), `runs/llamacpp_suite.sh`, and `runs/round_stats.py` (per-turn follow-up statistics).

**x86 / Windows-specific, not needed on the Spark:** `wsl.exe` and the stdin pipe, `MSYS_NO_PATHCONV=1`, `--uds`
(TCP should work natively), the Windows llama-server build, and Git Bash/PowerShell quoting. **Needed on the Spark
too:** the nvcc/crt/nvvm pins and the link shim, if FlashInfer JIT-compiles for sm_121.

## Not done, and why

- **Qwen3.6 on llama.cpp:** no Qwen3.6 GGUF was on the box, and the download budget went to the three NVFP4
  checkpoints.
- **Ollama as a reference:** the shared daemon must not load models (box rule).
- **The co-tenant case** (ComfyUI's ~45 GB resident, plan 0.6): not measured. These are ceiling numbers with an
  exclusive GPU. With a 50 GB budget, the KV pool would shrink from 58 GiB to ~20 GiB: Qwen3.6 ~1.9M tokens
  (14 people at 128k), Nemotron ~5.5M (42 at 128k). Throughput would be unchanged until KV binds. That is an
  estimate, not a measurement.
- **Speculative decoding** (MTP for Qwen3.6, DSpark for Nemotron): not tested. It helps single-stream speed, and
  the plan's research says acceptance falls at 10–16 users.
- **Quality gate (a), the coding agent's ~10 IDE tasks over dsh:** not run. Only the 28-item smoke set (b) was
  run. Its tool round-trips show every engine/parser pair returns well-formed OpenAI `tool_calls` (11/11 on all
  configs, except one empty final answer on Qwen3.6 with thinking on).
- **Per-OWUI-message generation count, the seat gate, distinct source addresses:** engine-only spike; this is
  plan 0.5's bench.
- **Qwen3.8's llama.cpp follow-up runs, and llama.cpp quality with thinking off:** skipped. Qwen3.8 on llama.cpp
  passes only alone: at 4 users the TTFT p95 is 5.05 s, and its aggregate tops out at ~190 tok/s.
- **The `followup` profile at 64k with `--append` for Nemotron and Qwen3.6:** not rerun. Their replace-mode runs
  hit the cache at the ideal rate (0.65 of 0.667), so append would not change them.

---

# DGX Spark (GB10)

**Box:** `spark-59f9`, an NVIDIA DGX Spark (Founders Edition): GB10, sm_121, 128 GB unified LPDDR5x (121 GiB
visible), ~273 GB/s, 20 Grace cores. DGX OS 7.5.0, kernel 6.17.0-1032-nvidia, driver 580.173.02 (CUDA 13.0). Native
Linux, no WSL. **Dates:** 2026-10-05 13:51 to 2026-10-06 11:37.

**The engine had the GPU to itself.**
- **Paused for the run:** OpenClaw's gateway, Agent Studio and their timers.
- **Ollama:** the daemon stayed up, idle with no model loaded.
- **Still resident (~2.7 GB):** the Farm app's stt/classify sidecars.

**Engines:**
- **vLLM 0.30.0** (torch 2.13.0+cu132, CUDA 13.2, FlashInfer 0.6.18.post1, Python 3.12.13): the same versions as the
  PRO 6000, from the same `install_vllm.sh`.
- **llama.cpp b10670**, `llama-b10670-bin-linux-cuda-arm64`: the Farm app's own build, read in place.

**Same models, flags and suites as the PRO 6000**, including the KV pool: `--kv-cache-memory-bytes 62277025792`
(58 GiB). Every "people by KV capacity" figure therefore matches the PRO 6000's. See *What differed* for why the
Spark's extra memory was not used.

Raw JSON: `results/spark-*.json`. KV figures: `results/spark-*__kv.json`. Temperature, clock, power and memory every
10 s: `results/logs/spark_guard_thermal_memory.csv`. Driver: `runs/spark_matrix.sh`.

## Headline table (DGX Spark)

People are `every turn / steady`, with the same pass rule: TTFT p95 < 5 s and decode p10 ≥ 15 tok/s.

| Engine · model (weights) | Context per person | **People at this context** | People by KV capacity | 4k chat message | Agent step | Cold prompt of this size | Quality gate: thinking on / off (tokens used) | Memory used (unified) |
|---|---|---|---|---|---|---|---|---|
| **vLLM · Qwen3.6-35B-A3B** (NVFP4, experts W4A16 via Marlin) | 32k | **8 / 8** | 168 | 8 / 16 | 8 / 16 | 0 (6.1 s alone) | **27/28 (89k) / 26/28 (12k)** | ~90–96 GB |
| | 64k | **8 / 8** | 84 | | | 0 (15.2 s alone) | | |
| | 128k | **4 / 4** ¹ | 42 | | | 0 (38.7 s alone) | | |
| **vLLM · Nemotron 3.5 Lightning** (NVFP4, experts W4A16 via Marlin) | 32k | **16 / 16** | 485 | 8 / 16 | 16 / 16 | 0 (5.7 s alone) | 26/28 (61k) / **27/28 (7k)** | ~85–95 GB |
| | 64k | **< 8** ² | 243 | | | 0 (13.0 s alone) | | |
| | 128k | **4 / 4** | 121 | | | 0 (29.8 s alone) | | |
| **vLLM · Qwen3.8-27B** (NVFP4 W4A4 dense, native FP4 GEMM) | 32k / 64k / 128k | **0** ³ | 54 / 27 / 13 | 0 | 0 | 0 (14.7 / 36.7 / 93.2 s alone) | 26/28 (24k) / **28/28 (11k)** | ~90–108 GB |
| **llama.cpp · Nemotron 3.5 Lightning** (Q4_K_M), `--parallel 16`, 2M-token pool | 32k | **2 / 2** ¹ | 16 (slots) | 1 / 4 | 1 / 4 | 0 (15.4 s alone) | 26/28 (62k) | ~48 GB |
| | 128k | **1 / 1** ¹ | 16 (slots) | | | — | | |
| **llama.cpp · Qwen3.8-27B** (Q4_K_M), `--parallel 8` / `16` | 32k | **0** ³ | 8 / 16 (slots) | 0 | 0 | 0 (47.0 s alone) | 25/28 (18k) | ~40–52 GB |

¹ The `--append` follow-up, where each turn re-sends the history plus one exchange.
- As on the PRO 6000, a *replaced* question misses Qwen3.6's hybrid prefix cache at 128k: 105 s at 4 users.
- Qwen3.6 at 128k collapses at 40 users (TTFT p95 227 s), near the pool's 42 × 128k.

² 64k: the sweep started at 8 users. Those 8 missed by a hair (TTFT p95 6.0 s, decode p10 15.6 tok/s), so 4–6
probably pass, but they were not measured.

³ **Qwen3.8 fails the 15 tok/s bar with one user:**
- vLLM decodes 12.1 tok/s alone, llama.cpp 11.7. It is bandwidth-bound: ~14 GB of weights read per token at
  ~273 GB/s.
- **At a 10 tok/s bar, vLLM would serve about 4 people** (chat c=4: p10 10.2, TTFT p95 4.6 s; agent c=4: p10 10.7,
  3.1 s).
- Its KV binds as on the PRO 6000: follow-ups collapse at 48 users at 32k and at 16 users at 128k.

## Detail (DGX Spark)

| vLLM, agent step: decode p10 tok/s · TTFT p95 every turn / steady (s) · aggregate tok/s | c=1 | c=4 | c=8 | c=16 | c=32 | c=64 | c=128 | c=192 |
|---|---|---|---|---|---|---|---|---|
| Qwen3.6 | 74 · 1.6 · 73 | 41 · 1.6 · 171 | 28 · 2.4 · 237 | 18 · 7.2 / 1.3 · 309 | 11 · 17 / 1.6 · 391 | 6.7 · 40 / 2.1 · 475 | 3.9 · 85 / 5.3 · 559 | (160: 3.3 · 585) |
| Nemotron | 69 · 0.42 · 68 | 40 · 0.83 · 167 | 28 · 1.1 · 235 | 18 · 3.0 / 0.54 · 300 | 12 · 8.0 / 0.90 · 417 | 8.3 · 18 / 1.5 · 573 | 5.4 · 41 / 1.6 · 751 | 4.1 · 68 / 2.4 · 858 |
| Qwen3.8 | 12 · 3.8 · 12 | 11 · 3.1 · 43 | 9.4 · 5.4 · 78 | 7.7 · 13 / 1.7 · 128 | 5.5 · 30 / 3.1 · 189 | 3.5 · 67 / 3.9 · 243 | (96: 2.6 · 272) | |

| Follow-ups, decode p10 · TTFT p95 (s) | 2 | 4 | 8 | 16 | 32 |
|---|---|---|---|---|---|
| Qwen3.6, 32k (append) | | 35 · 0.83 | **22 · 1.5** | 14 · 2.9 | 7.7 · 5.7 |
| Qwen3.6, 64k | | | **17 · 3.0** | 9.7 · 5.8 | 5.2 · 12 |
| Qwen3.6, 128k (append) | 32 · 2.0 | **21 · 1.5** | 12 · 2.7 | 6.8 · 5.1 | 3.6 · 9.1 |
| Nemotron, 32k (append) | | 37 · 0.82 | 24 · 1.5 | **16 · 2.9** | 9.8 · 5.3 |
| Nemotron, 64k | | | 15.6 · 6.0 | 8.9 · 12 | 5.3 · 24 |
| Nemotron, 128k (append) | 39 · 2.2 | **24 · 3.6** | 14 · 7.2 | 7.5 · 15 | 4.2 · 29 |
| llama.cpp Nemotron, 32k (append) | **39 · 2.7** | 22 · 5.6 | 11 · 8.4 | 5.4 · 20 | |

**llama.cpp on the Spark:**
- **Nemotron:** 73 tok/s alone, but the aggregate flattens at ~95–130 tok/s against vLLM's ~860.
- **Concurrent cold 32k prompts** collapse decode for everyone: 8.9 tok/s at 2 users, 1.5 at 8.
- **Qwen3.8:** ~11 tok/s alone, and an aggregate of ~34 tok/s at 8 users.

## What differed from the PRO 6000 run, and what broke

1. **The same KV pool (58 GiB), not a bigger one.**
   - The Spark could hold ~75 GiB of KV next to one model. We kept 58 GiB so the box keeps ~25–30 GB spare.
   - **Reason:** a unified-memory OOM is what wedged this GPU (item 2).
   - **It changes nothing in the people numbers.** Compute and bandwidth bind long before the KV pool on every MoE.
     Qwen3.8 is KV-bound too, but it already fails at 1 user on speed.
2. **The GPU was stuck at 702 MHz when the spike started.** NVIDIA's forums report the same bug (threads 376039,
   366590, 361294).
   - **When:** since a unified-memory OOM and two hard resets on 2026-09-16.
   - **What it looked like:** 11–14 W at 92–96 % utilisation, no throttle reason, and power limits reading N/A.
   - **Fix:** a warm reboot did not fix it. A **cold drain** did: power off, unplug the brick at the wall,
     30 s on the power button, wait, boot.
   - **After:** 2,464 MHz and 71 W under load, prefill 2.6× and decode 1.8× faster.
   - **Every Spark number here was taken after the drain.** The clock held 2.4–2.48 GHz throughout.
   - The 702 MHz numbers were deleted.
3. **Python headers.**
   - `uv` built the venv on the system Python 3.12.3, which has no `Python.h`. Triton's JIT helper failed to
     compile, and vLLM aborted with `Model architectures ['Qwen3_5MoeForConditionalGeneration'] failed to be
     inspected`.
   - **Fix (no sudo):** rebuild the venv on uv's own Python with
     `UV_PYTHON_PREFERENCE=only-managed bash install_vllm.sh 0.30.0`. That is Python 3.12.13, the PRO 6000's
     version.
4. **Qwen3.8's start-up tripped the memory guard.**
   - FlashInfer JIT-compiles the native-FP4 CUTLASS kernels with one job per core (20). With the 58 GiB pool,
     memory went from 35 to 116 GB used in 30 s.
   - `runs/spark_guard.sh` stopped it at 5 GB free.
   - **Fix:** `MAX_JOBS=4` (in `runs/spark_matrix.sh`). The start-up peak was then 108 GB.
   - The MoE models do not JIT those kernels: they use Marlin.
5. **Plain TCP**, with no `--uds` and no watchdog pipe trick. The pins and link shim in `serve_vllm.sh` worked
   unchanged on sm_121.
6. **Thermals:** 80–88 °C at sustained full load, levelling off, with no clock drop and no power-off. The guard's
   90 °C stop never fired.

**Exact commands:**

```bash
UV_PYTHON_PREFERENCE=only-managed bash docs/spike/install_vllm.sh 0.30.0
bash docs/spike/download.sh
bash docs/spike/runs/spark_guard.sh ~/lol-spike/logs/guard.csv 8 90 &      # memory/thermal guard + log
bash docs/spike/runs/spark_matrix.sh                                       # every engine x model below
```

`spark_matrix.sh` serves each model in turn, then runs `vllm_all.sh` and the `--append` follow-ups at 32k and 128k.
- **vLLM:** `serve_vllm.sh <run> <model dir>` with RESULTS.md's common and per-model flags, `--port 8100` in place
  of `--uds`.
- **llama.cpp:** `serve_llamacpp.sh <gguf> <parallel> <ctx> <log>`, the Linux twin of `serve_llamacpp.ps1` with the
  same farm argv, on port 8190.

# PRO 6000 vs Spark

The same harness, flags and KV pool on both boxes, one run each. **Best config on each box: vLLM, with Qwen3.6
(quality) or Nemotron (head count).**

| People per box (every turn / steady) | RTX PRO 6000 | DGX Spark | Ratio |
|---|---|---|---|
| Qwen3.6, 32k | 96 / 128 | 8 / 8 | 12–16× |
| Qwen3.6, 64k | 48 / 64 | 8 / 8 | 6–8× |
| Qwen3.6, 128k | 32 / 40 | 4 / 4 | 8–10× |
| Nemotron, 32k | 160 / ≥ 192 | 16 / 16 | 10–12× |
| Nemotron, 128k | 24 / 48 | 4 / 4 | 6–12× |
| Qwen3.8 (dense), 32k | 16 / 32 | 0 (12 tok/s alone) | — |
| llama.cpp Nemotron, 32k | 4 / 8 | 2 / 2 | 2–4× |

| Raw speed (vLLM) | PRO 6000 | Spark | Spark ÷ PRO 6000 |
|---|---|---|---|
| One user's decode (Qwen3.6 / Nemotron / Qwen3.8) | 193 / 243 / 64 tok/s | 76 / 69 / 12 | 0.39 / 0.28 / 0.19 |
| Peak aggregate, agent step (Qwen3.6 / Nemotron) | 3,431 / 4,959 tok/s | 585 / 858 | 0.17 |
| Cold 32k prefill (Qwen3.6 / Nemotron / Qwen3.8) | 1.1 / 1.1 / 3.3 s | 6.1 / 5.7 / 14.7 s | 4.5–5.4× slower |
| Cold 128k prefill | 5.7–20.9 s | 30–93 s | ~5× slower |

**Quality:** the same on both boxes, within the noise of a 28-item gate. It is a property of the
checkpoint, not the box.

| Model (vLLM) | PRO 6000, thinking on / off | Spark, thinking on / off |
|---|---|---|
| Qwen3.6 | 27/28 / 28/28 | 27/28 / 26/28 |
| Nemotron | 25/28 / 26/28 | 26/28 / 27/28 |
| Qwen3.8 | 26/28 / 28/28 | 26/28 / 28/28 |

**What this means for the purchase (one run per box, so a caveat on every number):**

1. **For multi-user serving, one PRO 6000 does the work of roughly 8–16 Sparks** on the 3B-active MoEs at 32k,
   and 6–12 at 128k.
   - The pre-run expectation was ~6×, from the bandwidth ratio (0.15).
   - Single-user decode lands better than bandwidth (0.28–0.39×). The batched aggregate (0.17×) and prefill (~0.2×)
     land at or below it, and those are what set head counts.
   - **Price per seat** (prices from `ESTIMATES_2026-10-05.md`): a Spark at €6,600 for 8 people (Qwen3.6) costs
     **€825 per seat** at 32k and at 64k. A PRO 6000 at €17,680 costs €138–184 per seat at 32k and €276–368 at 64k,
     plus its host. **The PRO 6000 is 4.5–6× cheaper per seat at 32k and 2.2–3× at 64k.** With Nemotron, the
     Spark comes to €413 per seat at 32k.
2. **The Spark's 128 GB does not buy people.**
   - With the same 58 GiB pool, its KV capacity is identical to the PRO 6000's (168 / 485 people at 32k for
     Qwen3.6 / Nemotron), and it serves 8–16.
   - Throughput binds ~10× before memory does.
   - Its memory matters only for *fitting* a model the PRO 6000 can't: gpt-oss-120b class, or several models
     resident at once. That was not measured.
3. **Dense models are a non-starter on the Spark** for this gate. Qwen3.8-27B decodes 12 tok/s for one person.
   Use a 3B-active MoE.
4. **On a Spark, use vLLM, not llama.cpp,** as on the PRO 6000. Nemotron serves 16 vs 2 people at 32k, and the
   aggregate is ~860 vs ~130 tok/s. The gap is smaller than on the PRO 6000 (24–40×), because the Spark's vLLM is
   itself bandwidth-limited.
5. **A Spark fits a small group.** It holds ~8 people on Qwen3.6, or ~16 on Nemotron at 32k, with steady TTFT
   under 2 s, for example one workshop table.
6. **Spark operations risk:** a unified-memory OOM can latch the GPU at ~700 MHz until a cold power drain. NVIDIA
   has no fix yet, and it happened on this box.
   - A farm Spark needs a memory guard and headroom (sizing `--kv-cache-memory-bytes`, never
     `--gpu-memory-utilization`).
   - It also needs a clock check after any crash: under load, clocks.sm should be ≥ 1,400 MHz and power ≥ 40 W.

# Gemma 4 12B and Qwen3-Omni (RTX PRO 6000, 2026-10-09)

Two models added to the farm's vLLM list on the owner's request (2026-10-09), measured with the same harness and pass
rule as above, on the same box, with three differences:

- **The farm's own launch.** Each server was started by `farm/vllm/serve.sh` with the argv the farm builds
  (`vllm.js argvFor`, read back in each log's `non-default args`), from a scratch install (`install.sh` with
  `LOL_VLLM_ROOT=~/lol-vllm-scratch`, vLLM 0.30.0 with its sound extras) on a scratch port; `--max-model-len 65536`
  (the farm's default context), `--max-num-seqs 192`.
- **The GPU was shared.** The Ollama app held 17.9–22.9 GB of the card throughout (another person's), so the pools are
  smaller than the spike's 58 GiB, and every run kept 6 GB or more free (a watchdog stopped the scratch server
  otherwise; it never had to).
- **A reduced suite:** chat (1–64 users), follow-ups at 30k and 62k with `--append` (as Open WebUI sends a chat), the
  28-item quality gate with thinking off and on, and functional checks (one stream, a picture, a tool call, sound in
  a chat message in French and in English, and `/v1/audio/transcriptions`) by `runs/probe.js` (its media in
  `runs/media/`). No agent profile, no cold prefill, no Spark.

Results: `results/pro6000-vllm030-gemma4-12b-nvfp4__*` and `results/pro6000-vllm030-qwen3omni-30b-a3b-fp8__*`, the
functional checks in `results/probes/`, each server's start-up lines in `results/logs/*.log.cmd`.

## Gemma 4 12B · `unsloth/gemma-4-12b-it-NVFP4`

The checkpoint: Unsloth's NVFP4 of Google's Gemma 4 12B (Apache 2.0): NVFP4 MLPs, FP8 attention projections and
calibrated FP8 KV scales; 9.34 GB on disk, **9.25 GiB loaded**. There is no NVIDIA or Google NVFP4 of the 12B (NVIDIA
publishes the 26B-A4B and 31B; Google publishes a QAT W4A16 `google/gemma-4-12B-it-qat-w4a16-ct`, slower to batch on
Blackwell than W4A4). The 12B is the encoder-free "Unified" model (`Gemma4UnifiedForConditionalGeneration`): pictures
and sound go straight into the decoder.

Flags (vLLM's Gemma 4 recipe): `--kv-cache-dtype fp8 --enable-prefix-caching --reasoning-parser gemma4
--enable-auto-tool-choice --tool-call-parser gemma4 --limit-mm-per-prompt {"image":4,"audio":1,"video":0}`. The
checkpoint's own chat template carries the tool protocol (the recipe's `--chat-template` is an older copy of it).
vLLM picks **Triton attention** (the 256/512 head sizes rule out FA4) and forces `--disable_chunked_mm_input`. Pool
52 GiB (`--kv-cache-memory-bytes 55834574848`).

| Chat 4k | c=1 | c=8 | c=16 | c=32 | c=64 |
|---|---|---|---|---|---|
| decode p10 (tok/s) | 91 | 73 | 52 | 39 | 24 |
| TTFT p95 every turn / steady (s) | 0.20 | 0.37 / 0.27 | 1.7 / 0.42 | 2.3 / 0.69 | 7.0 / 1.2 |

Follow-ups (`--append`), TTFT p95 (s) / decode p10 (tok/s), per round (`runs/round_stats.py`):

| Follow-up | c=8 | c=16 | c=24 | c=32 | c=48 | c=64 |
|---|---|---|---|---|---|---|
| 30k, round 1 (the first after loading) | 0.46 / 70 | 2.6 / 42 | | 5.0 / 22 | 10.7 / 17 | 7.8 / 20 |
| 30k, round 2 | 0.14 / 71 | 0.26 / 61 | | 0.28 / 35 | 0.40 / 29 | 0.49 / 26 |
| 62k, round 1 | 1.0 / 61 | 7.4 / 24 | 7.3 / 16 | 13.9 / 12 | 15.4 / 11 | |
| 62k, round 2 | 0.56 / 63 | 0.58 / 49 | 0.52 / 24 | 0.84 / 22 | 0.68 / 20 | |

**People:** chat **32 / 64** (every turn / steady); follow-ups **16 / ≥ 64 at 32k** and **8 / ≥ 48 at 64k**. Every
miss is the **first follow-up after the documents loaded** (round 1): its TTFT p50 is 2.9 s at 32 users at 30k and
7.0 s at 24 at 62k, while round 2 stays under 1 s everywhere. The same shape as Qwen3.6's replace-mode follow-ups
(finding 10): the first follow-up re-reads part of the history, later ones hit the prefix cache. One user alone:
**91–92 tok/s**, TTFT 0.20 s on a 4k message; aggregate up to 1,876 tok/s (chat, 64 users).

**Memory per person, measured:** 64 people at ~30.5k filled 51.8 % of the 52 GiB pool, ~450 MB each: 8,192 B a token
for the 8 global layers plus ~168 MB for the 40 sliding-window layers, whatever the length (the catalog's figures;
the farm's `facts()` counts the 168 MB since this run). The pool holds **~130 people at 32k and ~79 at 64k**: the
throughput binds first, as for the MoEs. vLLM's own start-up line (*Maximum concurrency for 65,536 tokens: 16.46x*)
ignores the sliding window and is 5× too low.

**Quality gate:** thinking off **26/28** (11k tokens: 8/10 code, 7/7 exact, 11/11 tools); thinking on **22/28** (155k
tokens): all six misses ran out of the 16k budget while thinking, the pattern of the other models.

**Functional:** a picture (a red circle, a blue square, the text "LOL 42") described as *a pink circle and a blue
square, with the text "LOL 42"*; a tool call `get_weather({"city": "Lyon"})` in 0.17 s; **sound in a message**
(`input_audio`, 16 kHz WAV) written back word for word in French (*Bonjour, je voudrais réserver la salle de réunion
pour jeudi à 15h pour six personnes.*) and English, with the request understood; thinking on, the reasoning comes
apart from the answer (the `gemma4` parser). `/v1/audio/transcriptions`: **404** (Gemma 4 is not a transcription
model in vLLM 0.30.0; the chat route is its way in).

## Qwen3-Omni 30B-A3B · `Qwen/Qwen3-Omni-30B-A3B-Instruct`, FP8 at load

The checkpoint: Qwen's own Instruct (Apache 2.0), the only first-party one: BF16, 70.5 GB, with the talker that
speaks (10 % of it), which vLLM does not serve: vLLM 0.30.0 serves the **thinker** (`Qwen3OmniMoeThinkerForConditional
Generation`: text, pictures, sound and video in; text out). No Qwen or NVIDIA FP8/NVFP4/AWQ exists; the community's
quantizations were left out (the owner's rule: first-party checkpoints only). So vLLM quantizes the weights to FP8 as
it loads them (`--quantization fp8`): **30.91 GiB loaded**, and the load never held the BF16 size (samples every 30 s never showed
more than 35 GB: it quantizes layer by layer).

Flags: `--quantization fp8 --kv-cache-dtype fp8 --enable-prefix-caching --enable-auto-tool-choice --tool-call-parser
hermes --limit-mm-per-prompt {"image":4,"audio":1,"video":0}` and Qwen's sampling (temperature 0.6, top_p 0.95, top_k
20, from Qwen's vLLM example: the checkpoint's `generation_config.json` holds only the talker's), merged by the farm
with the reply cap into one `--override-generation-config`. Pool **30 GiB** (all the shared GPU allowed): 655,360
tokens, 49,152 B a token (48 full-attention layers × 4 KV heads × 128 × 2), **20 people at 32k and 10 at 64k by
memory**. On a PRO 6000 of its own, the farm's Automatic pool (~42 GiB beside document reading) holds ~30 and ~14.

Two fixes found here, both in the farm now:
- **Tools:** Qwen3-Omni's chat template is only its processor's (`chat_template.json`), and vLLM uses the tokenizer's
  for a request with `tools`: every tool call answered 400 (*default chat template is no longer allowed*).
  `install.sh` now writes it as `chat_template.jinja`, which the tokenizer reads (transformers 5.19).
- **The thinking switch:** the client sends `chat_template_kwargs: {"enable_thinking": false}` for titles and the
  Computer's lists; this template then appends an empty think block the Instruct model never saw, and it answered
  `<|im_start|>user` (4 of the 11 tool items failed that way). The farm's route to a vLLM model with no thinking
  parser now drops `chat_template_kwargs` (LiteLLM 1.90 `additional_drop_params`): **28/28** through it.

| Chat 4k | c=1 | c=8 | c=16 | c=32 | c=64 | c=96 | c=128 |
|---|---|---|---|---|---|---|---|
| decode p10 (tok/s) | 170 | 79 | 54 | 42 | 26 | 18 | 17 |
| TTFT p95 every turn / steady (s) | 0.11 | 0.17 | 1.2 / 0.20 | 0.67 / 0.22 | 3.6 / 0.32 | 7.2 / 0.42 | 8.4 / 0.44 |

Follow-ups (`--append`), TTFT p95 (s) / decode p10 (tok/s), round 1 and round 2 alike here (no sliding window, no
hybrid cache: the first follow-up hits too):

| Follow-up | c=8 | c=10 | c=16 | c=20 | c=24 | c=32 |
|---|---|---|---|---|---|---|
| 30k | 0.46 / 51 | | 0.79 / 33 | 0.99 / 29 | | 58 / 5 (over the pool: preempted) |
| 62k | 0.81 / 34 | 0.96 / 31 | 92 / 3.5 (over the pool) | | 145 / 3.8 | |

**People:** chat **64 / 128**; follow-ups **20 at 32k and 10 at 64k**, every turn and steady alike, **both the pool's
limit** (the next level spills it and collapses); decode at those levels is still 29–31 tok/s, so a bigger pool carries
more. One user alone: **170 tok/s**, TTFT 0.10 s on a 4k message (the fastest of the five for one person, an MoE with
3B active); aggregate up to 2,491 tok/s (chat, 128 users).

**Quality gate** (it does not think): **28/28** (8k tokens) through the farm's route; 23/28 straight to vLLM with the
thinking switch (above).

**Functional:** the picture: *a red circle, a blue square, and the black text "LOL 42"*; the tool call
`get_weather({"city": "Lyon"})`; **sound in a message**, French and English, written back word for word (*Bonjour. Je
voudrais réserver la salle de réunion pour jeudi à quinze heures, pour six personnes.*) and the request understood;
the same through LiteLLM (the farm's route passes `input_audio` parts unchanged). The first message with sound
after the start took 8.4 s (the audio encoder's first use), later ones 0.03–0.05 s.

**`/v1/audio/transcriptions` works** for Qwen3-Omni in vLLM 0.30.0 (the thinker is a `SupportsTranscription` model):
French and English written down word for word in **0.12–0.18 s** for 7–8 s of speech, the language given or not
(`{"text": "Bonjour, je voudrais réserver la salle de réunion pour jeudi à quinze heures pour six personnes.",
"usage": {"type": "duration", "seconds": 8}}`). Its feature extractor reads up to 300 s at a time (4.8 M samples at
16 kHz); longer recordings were not tried. It is vLLM's
route, not the farm's: the seat gate forwards only the routes clients use, and LiteLLM has no transcription route
configured for it, so a client reaches it only through a change there (the voice work's call).

## What these two mean for the farm

- **Gemma 4 12B on vLLM** is the small model that sees and hears: 9 GB of weights leave room for many people's
  memory (~130 at 32k on a PRO 6000), but a dense 12B on Triton attention decodes slower than the 3B-active MoEs
  under load: **16 people at 32k on every turn** (Qwen3.6: 96), **≥ 64 in steady use**. It is the only model of the
  list that fits a 16 or 24 GB card (with document reading off) or a 32 GB one (beside it).
- **Qwen3-Omni** is fast for one person and good on the gate, but its full attention costs 4.8× Qwen3.6's memory a
  token: **memory binds first** (20 at 32k in 30 GiB, ~30 on a PRO 6000 of its own). It is the one model whose vLLM
  writes down speech (`/v1/audio/transcriptions`), which a voice mode could use instead of a separate speech-to-text.

# Flint for coding (RTX PRO 6000, shared GPU, 2026-10-23)

The owner's question (2026-10-23): should Recursive's **Flint** (`RecursiveSI/flint`, released 2026-10-21) be the
farm's model for coding, above all for the IDE's coding agent? Measured on this box beside the owner's farm, which
kept serving Qwen3.6 on vLLM (~78 GB of the card) the whole time: **at most ~11 GB of the GPU was mine** (a watchdog
stopped my runs below 6 GB free or if the farm turned busy; it never had to), so Flint ran with most of its experts in
system RAM. That makes this the **small-GPU / laptop-farm data point**. The whole-GPU numbers are HUMAN_TESTS J12–J13.

**The model.** A 39.8B MoE, ~2.5B active (256 routed experts, top 6, plus 2 shared; 2 dense layers then 47 MoE layers),
35 sliding-window (513) and 14 full-attention layers, 262,144 context, text only, a reasoning model trained for coding
agents. Unsloth's GGUFs (`unsloth/flint-GGUF`, revision `20468edf`): **UD-Q4_K_XL** (25.05 GB, sha256 `63c2ecc4…`) and
**Q8_0** (42.30 GB, `5df42b56…`), both checked. From the GGUF itself:
- `general.architecture = flint`: llama.cpp knows it from **b11803** (PR #30928, 2026-10-21); b11512 refuses it with
  *unknown model architecture: 'flint'*, which the panel turns into "newer than the farm's llama.cpp build". The farm
  now pins b11836 (DEVLOG 2026-10-23).
- **23.05 of the 25.05 GB are the routed experts** (0.42–0.65 GB a layer); everything else is ~1.7 GB. The experts are
  what goes to system RAM (`--n-cpu-moe N` keeps the first N layers' experts there).
- KV: 28 KiB a token in f16 (only the 14 full-attention layers grow with the context; vLLM's blog gives the same
  figure), ~15 KiB in q8_0: **64k of context costs ~1 GB**.
- `general.sampling.temp = 1`, `top_p = 0.95`, `top_k = 20`: llama-server takes these as its defaults
  (`common_init_sampler_from_model`; `/props` shows them, min_p stays llama.cpp's 0.05). A request that names no
  sampling — the coding agent's — gets Flint's recommended sampling with no farm change.
- `general.license = other`, `general.license.name = flint-preview`, `general.name = Flint Preview`, while the Hugging
  Face card and Recursive's page say Apache 2.0 (the page also links separate "Model Terms"). **Unknown: which one
  governs** — a question to settle before shipping it.

**The chat template** (the same in the GGUF and the BF16 repo): GLM-4.x-style tool calls
(`<tool_call>name<arg_key>k</arg_key><arg_value>v</arg_value></tool_call>`, results as `<|observation|>`), **no
thinking switch** (it always thinks; `chat_template_kwargs.enable_thinking: false` changes nothing), and every earlier
assistant message's `reasoning_content` is put back as `<think>…</think>`. llama-server b11836 with `--jinja` says
*"chat template supports preserving reasoning, it is enabled by default"*, returns the reasoning apart from the answer,
and turns the calls into OpenAI `tool_calls`. Over the ~1,100 agent steps below, **one** tool call was malformed
(left in the reasoning, see the agent findings); every other one parsed.

**The farm's route keeps what Flint asks for** (seat gate → LiteLLM `openai/` → llama-server, the farm's own
`buildLitellmConfig`, on scratch ports): an earlier assistant message's `reasoning_content` reaches the prompt (58 vs 24
prompt tokens with and without it; in a tool loop 175 vs 149), and `top_k` arrives (`top_k: 1` at temperature 1.5 gave
two identical answers; without it, two different ones). The vLLM route to Qwen3.6 keeps the reasoning too (346 vs 321).
**The coding agent sends its reasoning back** on every earlier step (pi-ai's openai-completions; a tap between dsh and
the farm saw `reasoning_content` on every assistant message of every request), sends **no temperature, top_p or
top_k**, and sends `max_completion_tokens` = the IDE's reply room: 8192 for a model LOL Vibe does not know
(`renderer/chat/projects/models.mjs`, by model id; on the owner's farm every model is called `assistant`).

**`--cache-reuse` is off for Flint** (*"cache_reuse is not supported by this context"*: the sliding window). An agent's
history only grows, so the exact-prefix cache does the work: in one task 56,112 prompt tokens came from the cache and
6,223 were computed.

## Speed, one person, experts in system RAM

UD-Q4_K_XL on b11836 with the farm's own argv (`argsFor`: `--jinja --metrics -fa 1 --kv-unified --cache-ram …`), q8_0
KV, plus `--n-cpu-moe N` (and `-b/-ub`) through `extraArgs`; a cold, unique prompt, 512 tokens out (`ignore_eos`), two
runs each (the second shown; the first of a pair is 10–40 % slower). Nothing else of mine on the GPU; the farm's vLLM
served the office beside it.

| Experts on the GPU | Context, slots | Batch | GPU memory | Decode (tok/s) | Prompt (tok/s) | TTFT 3.3k | TTFT 24.8k | TTFT 31.4k |
|---|---|---|---|---|---|---|---|---|
| none (`--n-cpu-moe 49`) | 32k, 1 | `-ub 512` (default) | 3.0 GB | 43–45 | 456–533 | 7.3 s | 46.6 s | |
| none | 32k, 1 | `-b 2048 -ub 2048` | **3.3 GB** | **43–45** | 1,173–1,612 | **2.9 s** | **15.5 s** | |
| 10 of 47 layers (`--n-cpu-moe 39`) | 32k, 1 | 2048 | 7.5 GB | 51–53 | 1,404–1,917 | 2.4 s | 13.0 s | |
| 12 of 47 (`--n-cpu-moe 37`) | 32k, 1 | 512 | 8.0 GB | 54–56 | 578–678 | 5.7 s | 36.6 s | |
| 12 of 47 | 32k, 1 | 2048 | 8.3 GB | 53–55 | 1,468–2,006 | 2.3 s | 12.4 s | |
| 12 of 47 (**the agent runs below**) | 64k, 2 | 2048 | 9.0 GB | 52–55 | 1,499–2,035 | 2.3 s | | 15.5 s |
| **Q8_0**, none | 64k, 2 | 2048 | 4.0 GB | 30–32 | 661–927 | 5.1 s | | 34.0 s |

- **`-ub 2048` is what makes experts-in-RAM usable:** each batch of prompt tokens copies the experts' weights over PCIe,
  so a 4× bigger batch reads prompts ~3× faster for +0.3 GB of GPU. The farm's argv leaves `-ub` at llama.cpp's 512
  (right for a model held whole on the GPU).
- **Decode is the CPU's:** 16 threads reading ~0.5 GB of experts a token from RAM give ~44 tok/s; a quarter of the
  experts on the GPU adds only ~20 %. Q8_0 reads twice the bytes a token: 30–32 tok/s, and prompts at roughly half the
  speed (its 39 GB of experts cross PCIe per batch).
- **The laptop-farm data point:** a card with ~4 GB free runs Flint UD-Q4_K_XL at ~44 tok/s for one person with 32k of
  context (a 24.8k-token paste answered in ~15 s), given ~25 GB of free system RAM for the experts. A first reading
  taken while my own quality gate ran on the farm was 17.5 tok/s: on such a box the CPU is shared with everything else.
- llama.cpp admits only `--parallel` people (the rest wait), and with the experts on the CPU two people share its RAM
  bandwidth: two agents at once here took each task ~1.5× longer.

## The coding agent: five tasks, Flint vs Qwen3.6

The IDE's agent as LOL Vibe runs it: `shell/build/main/studio.js` `createStudio` (its profile patch, the project fence,
the syntax check) and the installed dsh runtime (0.1.7-rc.2); one fresh project per task; the reply room LOL Vibe sends
(8192) unless said; the farm's context per person (65,536). The runner and the tasks: `docs/spike/ide/`. Each task's
`check.js` runs what the agent left (the agent has no shell: it cannot run the tests itself):
- **t1-median** — fix the bug so `node stats.test.js` passes, tests unchanged (two bugs: a string sort, the even case).
- **t2-p5** — a p5.js page: a speed slider (0–10, starts at 3) and a Reset button; checked by running `sketch.js`
  against a p5 stub (speed 6 moves twice as far as 3, 0 stands still, Reset centres the ball).
- **t3-tests** — write `node:test` tests for `slugify.js`: they pass, hold ≥ 6 assertions, and fail on at least 4 of 5
  mutants (no lowercase, accents kept, no trimming, the separator option or maxLength ignored).
- **t4-refactor** — move two duplicated helpers out of two files into `money.js`; `node check.js` still passes.
- **t5-tdd** — write `wordfreq.js` from a given test file (Unicode letters, inner apostrophes, ties in order).

Flint: UD-Q4_K_XL on b11836, 12 of 47 expert layers on the GPU, `-ub 2048`, q8_0 KV, 64k, 2 slots, behind the farm's
own seat gate and LiteLLM route (scratch ports). Qwen3.6: the owner's farm itself (`http://127.0.0.1:4000/v1`: vLLM
0.30, NVFP4, 48 seats at 64k, `presence_penalty` 1.5 from the route), one request at a time. "Fence off" = the first
batches, whose data folder was on F: — where, it turned out, dsh runs no hook (DEVLOG 2026-10-23), so the fence and
the syntax check were off for both models alike.

| Runs (reply room 8192 unless said) | t1 | t2 | t3 | t4 | t5 | **all** | wall a task (median) | steps (median) | tool calls (median) | failed tool calls (all) | output tokens a task (median) | ended on max-tokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Qwen3.6, fence off (F:) | 2/3 | 2/3 | 1/3 | 3/3 | 2/3 | **10/15** | 13 s | 10 | 10 | 14 of 152 (9 %) | 2275 | 0 |
| Qwen3.6, fence on | 3/3 | 3/3 | 1/3 | 3/3 | 1/3 | **11/15** | 21 s | 9 | 8 | 21 of 126 (17 %) | 2156 | 0 |
| Flint, fence off (F:) | 3/3 | 0/3 | 3/3 | 3/3 | 3/3 | **12/15** | 168 s | 12 | 16 | 78 of 390 (20 %) | 8084 | 3 |
| Flint, fence on (as shipped) | 2/3 | 1/3 | 1/3 | 2/3 | 2/3 | **8/15** | 171 s | 15 | 18 | 103 of 274 (38 %) | 8399 | 2 |
| Flint, fence on, standing mode allowed | 3/3 | 0/3 | 1/3 | 3/3 | 2/3 | **9/15** | 255 s | 9 | 14 | 50 of 228 (22 %) | 5590 | 4 |
| Flint, same, 32768-token replies | 2/2 | 2/2 | 2/2 | 1/2 | 1/2 | **8/10** | 234 s | 13 | 15 | 64 of 287 (22 %) | 10922 | 0 |
| Flint Q8_0 (every expert in RAM), same, 32768 | 1/1 | 0/1 | 1/1 | 1/1 | 1/1 | **4/5** | 209 s | 7 | 10 | 13 of 54 (24 %) | 5964 | 0 |

The batch "standing mode allowed" ran beside Flint's quality gate, and the first 32,768 round beside it in turn (two
agents or an agent and the gate on one server): their wall times are ~1.5× what one person sees. Every run's record
(the check, steps, each tool call's name and target, failed calls, tokens): `results/ide/*.json`. The Q8_0 round's miss
is its own bug (`speedSlider.value` without the call: NaN in a real browser too).

What the runs show:
- **The reply room decides the p5 task for Flint.** At LOL Vibe's 8192 tokens Flint ran out on t2 in 8 of its 9 runs
  (one step thought past 8k tokens and ended on `max-tokens`, the page untouched); with 32,768 it passed
  2 of 2 (22,345 output tokens in one run). Qwen3.6 never came near the limit (1–5k tokens a task). Flint's makers ask
  for ≥ 32,768. LOL Vibe picks the room by model id, and on the owner's farm every model is `assistant`.
- **The fence as shipped refused most of Flint's writes:** it adds `sandbox_permissions: "workspace-write"` with a
  `justification` to 75 of its 130 writes and edits (a Codex-style habit; it is the mode the agent already runs in,
  which dsh grants with no question). The fence refused any `sandbox_permissions`; Flint then probed with test files,
  wrote outside the project, or stopped to ask the person — 8/15, 38 % of its tool calls failed. **Allowing the standing
  mode** (committed on this branch; any other value is still refused, the path still decides): no such refusal left,
  9/15 at 8192 (t2's room unchanged), 8/10 at 32,768.
- **Flint's own failure modes:** edits that change nothing (`old_string and new_string must differ`, 47 in one batch;
  one t3 run went 145 steps / 14 min before passing), re-reading the same file 4–6 times, an edit whose text is not
  there, asking for a shell (`read "node --version"`), reading the projects folder above its own, editing a file it was
  told to keep (2 of the 40 runs with the fence), and **one malformed tool call**
  (`Let<arg_key>read<arg_key>path</arg_key>…</tool_call>`, no opening tag, left in the reasoning; the turn ended
  without the fix the syntax check had asked for).
  **Qwen3.6's:** wrong expectations in the tests it writes (t3: miscounted characters for maxLength, 1/3 in both
  batches), an `Object.create(null)` result against `deepStrictEqual` (t5), the numeric sort missed once (t1), changed
  the tests once (t5), and `exit_plan_mode` outside plan mode 11–18 times a batch (refused, harmless).
- **Time:** Flint took 2.5–4 min a task here (its experts in RAM, ~53 tok/s, 5–8k output tokens a task with its
  reasoning), Qwen3.6 13–21 s on the farm's vLLM (~2k tokens). Fence on or off moved Qwen3.6 from 10 to 11 and Flint from
  12 to 9 (8192, standing mode allowed): with temperature 1.0 and three runs a task, ±2 is noise.

## The quality gate (28 items)

| | code | exact | tool | total | completion tokens | wall |
|---|---|---|---|---|---|---|
| Qwen3.6, the farm itself, thinking on (16k replies) | 8/10 | 7/7 | 11/11 | **26/28** | 80,021 | 483 s |
| Qwen3.6, the farm itself, thinking off (8k) | 10/10 | 7/7 | 11/11 | **28/28** | 10,633 | 70 s |
| Flint UD-Q4_K_XL, its sampling, 32k replies | 10/10 | 7/7 | 10/11 | **27/28** | 21,260 | 720 s |
| Flint Q8_0 (every expert in RAM), the same, 2 at once | 10/10 | 7/7 | 10/11 | **27/28** | 22,857 | 701 s |

Concurrency 1 on the farm (gentle) and on Flint's server (which ran an agent beside it). Qwen3.6's misses: a wrong
`parse_duration`, and an `eval_expr` program that did not finish in time (the spike's run straight to vLLM on 2026-10-04:
27/28 and 28/28). Flint's: `tool_write_file` — after writing the file it read it back four times and gave no answer
within 5 steps (its re-reading habit; the gate's tool loop also drops `reasoning_content` from the history, against
Flint's instructions). **Flint thinks a quarter as much as Qwen3.6 with thinking on** for one more point. A 28-item smoke
gate, not a benchmark: both models are at its ceiling. Raw: `results/pro6000-farm-v0.0.48-vllm-qwen36-nvfp4__quality__*`
and `results/pro6000-shared-llamacpp-b11836-flint-*`.

## Recursive's claims

On the model card (BF16; temperature 1.0, top-p 0.95, top-k 20; average pass@1 over ≥ 5 attempts): **Terminal-Bench 2.1
54.9 %** (Terminus 2), **SWE-bench Pro v2 89.7 %** and **SWE-bench Verified 74.2 %** (both mini-swe-agent). Recursive's
own blog names the benchmarks and the setups but prints no number in its text, does not define "SWE-bench Pro v2", says
nothing about contamination, and cites no independent run; no third-party rerun was found on 2026-10-23. SWE-bench Pro was
built to be harder than Verified (longer, multi-file, contamination-resistant tasks), and published models score well
below their Verified score on it (a public leaderboard snapshot, benchlm.ai, puts its 12th place at 64 %); 89.7 on Pro
against 74.2 on Verified inverts that. Until someone reruns it, the Pro figure says nothing; the Verified figure
(Qwen3.6's makers report 73.4) puts Flint level with Qwen3.6, which is what the five tasks above show too. Also
claimed: >125 tok/s on an M4 Pro, >150 tok/s on a 64 GB "RTX Spark" at short contexts, NVFP4 within 0.7 points of
BF16; vLLM's day-0 post: ~485 tok/s for one request on a GB200. The llama.cpp PR notes its expert scaling costs 10–30 %
speed for now (follow-up PRs).

## What this means for the farm

- **Flint does the IDE agent's job about as well as Qwen3.6 on these tasks, not clearly better:** given the room it
  needs, 8/10 (32,768) against Qwen3.6's 11/15; 12/15 against 10/15 with the fence off; 27/28 against 26/28 on the gate
  with a quarter of the thinking. Its makers' own SWE-bench Verified (74.2) is level with Qwen3.6's (73.4). It fails
  differently: Flint loops and over-checks, Qwen3.6 writes wrong expectations quickly.
- **It is not the farm's model today.** A farm serves one engine at a time, and on the PRO 6000 that is vLLM with Qwen3.6
  for 48 people at 64k, with vision and document reading. Flint is text only and always thinks (Open WebUI's titles and
  the Computer's "thinking off" lists would think anyway). It runs on the farm's llama.cpp only — vLLM's support is a
  day-0 Docker image (`vllm/vllm-openai:flint`) and an open PR (#62938), not a release the farm can install — and on
  llama.cpp people at once are `--parallel` slots with a shared ceiling (this spike: ~600 tok/s aggregate, 4–8 people).
- **Where it fits is a second, small farm for coding:** the one strong coding model here that runs well with its experts
  in system RAM — 3.3 GB of GPU, ~44 tok/s, a 25k-token paste answered in 15 s for one person; a 12–16 GB office card can
  hold a third of the experts as well (~55 tok/s). A developer's LOL Vibe would connect to it for its projects.
- **Quant: UD-Q4_K_XL** (25 GB): Q8_0 scored the same on the gate (27/28, the same miss) at 60 % of the speed with the
  experts in RAM; Q8_0 is worth it only where it fits whole on the GPU, if J12 shows a difference there.
- **Engine: llama.cpp b11836** (this branch's pin) now; vLLM once a release carries #62938 — then J12 again on vLLM,
  whose multi-user ceiling on this card is 10–40× llama.cpp's (finding 4).
- **What the IDE needs before Flint is offered** (none of it is built, except the first):
  1. the fence's standing-mode rule (`sandbox_permissions: "workspace-write"` allowed; on this branch);
  2. a reply room of ≥ 32,768 for it — LOL Vibe chooses by model id, and the farm names every model `assistant`, so it
     needs the snapshot's `underlying` name to tell;
  3. for a small-GPU farm, MoE offload in the farm's argv: `--n-cpu-moe` sized from the free memory like
     `contextLength: 'auto'`, and `-b 2048 -ub 2048` when experts are in RAM;
  4. a `flint` line in `projects/models.mjs` (after J13), and the licence question settled.
- **Still unknown:** the whole-GPU speed and people at once (J12); the agent at full speed against Qwen3.6 (J13); longer
  work than five small tasks (a real project, Keep going); Q8_0 in the agent beyond one round (4/5); an independent
  check of Recursive's numbers, the SWE-bench Pro v2 figure above all; which licence governs the weights.

**Recommendation:** not now as the farm's model or default; keep Qwen3.6 on vLLM for the office and the IDE. Merge the pin
(document search is 2.4× faster and the abandoned-call bug is gone, whatever the model) and the two fence fixes (the
second-drive hole matters whatever the model), run J12–J13 at a quiet moment, and if Flint holds up at full speed, offer
it as an opt-in llama.cpp coding model (UD-Q4_K_XL) with a 32k reply room — on a second, small farm first.
