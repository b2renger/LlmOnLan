# Engine × model spike — results (multiuser plan 0.6)

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
    expectation; the Spark run decides.
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
