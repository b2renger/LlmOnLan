# FARM_START_PLAN: a farm that is ready sooner, and says how long

**Status: approved by the owner, 2026-11-23** (12:11, *"yes on all those"*; step 3 is measured first, then installed if
the numbers hold). Size **S + S + M + S**, each step on its own. The owner
(2026-11-23, 11:25): *"it takes ages to start vllm and the farm basically. Can we do some improvements and
optimisations in this matter ?"*

## What a start costs today (measured, the PRO 6000, Qwen3.6 NVFP4 at 64k; DEVLOG 2026-11-23 11:41)

From the live farm's own logs (`farm.log`, `~/lol-vllm/logs/vllm.log`), this morning's second start, the ordinary
one:

| Step | Time |
|---|---|
| The farm's own services, one after the other (Ollama, document search, LiteLLM, SearXNG, OCR), *then* vLLM's job | 29 s (11:06:15 → 11:06:44) |
| The job checks this computer and launches `serve.sh` | 7 s |
| vLLM's processes start (Python imports, the engine) | ~24 s |
| The weights, 20 GB | 31 s (17 s when the disk cache is warm) + 8 s |
| torch.compile (from its cache) | 0.5 s |
| Profiling, FlashInfer's autotune, CUDA graphs | ~37 s |
| **From Start vLLM to ready** | **2 min 2 s**; from the Farm app's launch about 2 min 30 s |

**And a start that rebuilds FlashInfer's kernels** adds ~3 minutes in a silent log (168–250 s measured): today's first
start, which someone stopped from the panel at 5 min 7 s, about a minute before it would have been ready.

## Done already (approved in advance: a bug a run reproduced)

On the PRO 6000 the rebuilds came from the sessions' trial vLLM (`~/lol-vllm-033`, the same FlashInfer), which
rewrote production's kernel folder: every slow start since 2026-11-14 follows trials, every fast one does not. Since
2026-11-23 every root but production's builds in its own folder (`farm/vllm/serve.sh`, `test_scripts.sh`
*flashinfer*). A school's farm never had a second root: there a rebuild comes only with a first start or a vLLM update,
which step 3 is for.

## The steps

1. **vLLM starts with the farm, not after it (S).** The boot queues the start job at its very end (`up.js` 4361,
   after the panel and the watchers); it would queue it as soon as the check of this computer has answered, while
   Ollama, document search, LiteLLM, SearXNG and OCR come up. The farm still never waits for vLLM (D5): the gate says
   *starting* until it is ready. vLLM's memory is fixed by `--kv-cache-memory-bytes` (it *skipped memory profiling*),
   so what the other services load does not change its pool. **Saves ~29 s on every start with the farm.** To check:
   the job's supervision (`watchVllm`, the engine-down box), armed at the end today, must hold from the start; a test
   in `farm/test/run.js`, and a scratch farm timed before and after.
2. **The panel says what it does and for how long (S).** The phase gets its time beside it (*loading the model weights
   · 0:42*); the kernel phase stops saying *the first start takes a few minutes longer* (false on a rebuild) and says
   *building GPU kernels for this vLLM: up to 5 minutes, once after an install or an update* (built as *several minutes the
   first time with a model, or after vLLM is installed or updated*: Qwen3.8's first build took 7 min 34 s, and each model
   builds kernels of its own, review 2026-11-24); under the bar, one line:
   *a start takes about 2 minutes; the farm stops it by itself if it shows no progress for 10 minutes*. No time
   saved, but a start is no longer stopped a minute from ready. **Built 2026-11-23 by day** (the bar already showed
   *running for …* on a job that moves no bytes; what was missing was the truth): the kernel phase's words, and a job's
   `note` under its running bar (a vLLM start: *If vLLM writes nothing for 10 minutes, the farm stops it by itself.*);
   test first, farm 293/293. Seen on a real panel: J19's test farm, night n° 15.
3. **Precompiled kernels (M, a new dependency: the owner's yes).** vLLM warns at every start that FlashInfer's
   precompiled kernels are missing (`flashinfer-cubin`, `flashinfer-jit-cache` not installed). Installed with vLLM by
   `install.sh` (and by Update vLLM), no farm would compile them: a new farm's first start, and the first after each vLLM
   update, would take about 3 minutes less. **Found (2026-11-23, 12:20):** `flashinfer-jit-cache` 0.7.2.post1+cu130 is a
   4.5 KB shim that requires one wheel per GPU family; ours is **`flashinfer-jit-cache-sm120f`** (sm_120 and the Spark's
   sm_121), **194 MB** for x86_64 and 188 MB for aarch64, on FlashInfer's GitHub release `v0.7.2.post1` and its index
   `https://flashinfer.ai/whl/cu130`; `flashinfer-cubin` 0.7.2.post1 (1.67 GB) is there too, not on PyPI. **To measure
   first, on a trial root (nothing of production touched):** a cold Qwen3.6 start in an empty kernel folder, then the
   sm120f wheel alone (`--no-deps`) and the same start again; `flashinfer-cubin` only if the first leaves a build.
   **Measured (night n° 15, 2026-11-24, `~/lol-vllm-033`: vLLM 0.33.0, torch 2.14 on CUDA 13.2, FlashInfer 0.7.2.post1;
   each start from an empty kernel folder, through `trial_serve.sh`, the GPU free):**

   | Cold start, empty kernel folder | Start → ready | Profiling/warmup | Kernels built |
   |---|---|---|---|
   | Qwen3.6 64k, without | 331 s | 168 s | 6 |
   | Qwen3.6 64k, **with the wheels** | **125 s** | **17 s** | 1 (`trtllm_utils`) |
   | Qwen3.8 32k (J19's farm start, without) | 605 s | 253 s | 10 |
   | Qwen3.8 32k, **with the wheels** | **251 s** (torch.compile 31 s again: the trial's flags missed the farm's cache) | **18 s** | 5 (`trtllm_utils`, 4 of its head ratio) |

   **The numbers hold:** 3½ to 4 minutes off a first start, for a **195 MB** download (371 MB installed). What to
   install: the shim `flashinfer-jit-cache==<FlashInfer's version>+cu130` and the one provider for the card,
   `flashinfer-jit-cache-sm120f` (sm_120 and the Spark's sm_121), **both `--no-deps`**: the shim requires all six
   providers (sm80, sm89, sm90a, sm100a, sm103a, sm120f). The CUDA label follows FlashInfer's own rule
   (`flashinfer/__main__.py` `_resolve_jit_cache_cuda_version`: the newest of 12.9, 13.0, 13.4 at or below torch's, so
   13.2 → cu130); shim, provider and FlashInfer must carry the same version, or FlashInfer only warns and builds
   (`flashinfer/jit/env.py` `_get_aot_providers`). Seen working: FlashInfer lists the provider (`sm120f`, 566 modules).
   Left as it was: the autotune (its cache lives in the kernel folder), `flashinfer-cubin` (1.67 GB, not tried: what is still
   built, with the autotune, took 30 s on Qwen3.6 and about 1½ minutes on Qwen3.8). **A model's first start builds kernels of its own** (Qwen3.6 and Qwen3.8 share 5
   of their modules), which the wheels mostly cover too. For the build (session n° 16): `install.sh` after vLLM, the
   card's architecture from `nvidia-smi --query-gpu=compute_cap`; Update vLLM the same; no wheel for a card it has none
   for (the farm builds, as today).
4. **The weights from a cold disk (S, research).** 31 s cold against 17 s warm for 20 GB. Measure vLLM's
   `--safetensors-load-strategy` options on a trial root; adopt one only if it saves 10 s or more, in the model's
   flags (the farm owns them).
   **Measured (night n° 15, 2026-11-24, Qwen3.6 on `~/lol-vllm-033`, vLLM 0.33.0, which offers `lazy` (the default),
   `eager` and `prefetch`; the weights' 15 files evicted from Linux's page cache before each cold run with
   `posix_fadvise(DONTNEED)`, 2 GB left in the cache):**

   | *Loading weights took* | Cold disk (two runs) | Warm (the weights in memory) |
   |---|---|---|
   | the default | 30.8 s, 30.4 s | 11.6 s |
   | `eager` | 87.8 s, 87.4 s | — |
   | **`prefetch`** | **15.2 s, 14.3 s** | 11.9 s |

   **`prefetch` saves ~16 s on a cold disk and nothing is lost warm: adopt it** (`--safetensors-load-strategy prefetch` in
   each built-in's flags, session n° 16). `eager` is three times slower here. Windows may still cache the WSL disk
   image under Linux, so a true first start after a reboot may differ. With step 3's wheels and every cache warm,
   Qwen3.6 was ready 80 s after its start (`trial_serve.sh`, no farm around it).

**Not proposed:** fewer CUDA graphs (~15 s, but slower answers with 48 people); keeping vLLM running when the Farm
app quits (the card stays taken; the farm already takes over a vLLM it finds running).

## What it gives

An ordinary start: ~2 min 30 s from the Farm app's launch → **~2 min** (step 1), a little less with step 4. A first
start or the first after a vLLM update: ~5 min 30 s → **~2 min** (step 3). And a person who knows what the bar is
doing (step 2).

## Answered

The owner, 2026-11-23 12:11: yes to steps 1, 2 and 4, and to step 3 measured first (DECISIONS).
