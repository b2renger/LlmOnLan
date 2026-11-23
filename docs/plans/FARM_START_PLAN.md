# FARM_START_PLAN: a farm that is ready sooner, and says how long

**Status: proposed, for the owner** (2026-11-23, by day). Size **S + S + M + S**, each step on its own. The owner
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
   *building GPU kernels for this vLLM: up to 5 minutes, once after an install or an update*; under the bar, one line:
   *a start takes about 2 minutes; the farm stops it by itself if it shows no progress for 10 minutes*. No time
   saved, but a start is no longer stopped a minute from ready.
3. **Precompiled kernels (M, a new dependency: the owner's yes).** vLLM warns at every start that FlashInfer's
   precompiled kernels are missing (`flashinfer-cubin`, `flashinfer-jit-cache` not installed). Installed with vLLM by
   `install.sh` (and by Update vLLM), no farm would compile them: a new farm's first start, and the first after each vLLM
   update, would take about 3 minutes less. **To measure first, on a trial root (nothing of production touched):** the
   wheels' size (a school's network did ~6 MB/s), that they hold the RTX PRO 6000's sm_120 and the Spark's sm_121
   kernels, and the time saved.
4. **The weights from a cold disk (S, research).** 31 s cold against 17 s warm for 20 GB. Measure vLLM's
   `--safetensors-load-strategy` options on a trial root; adopt one only if it saves 10 s or more, in the model's
   flags (the farm owns them).

**Not proposed:** fewer CUDA graphs (~15 s, but slower answers with 48 people); keeping vLLM running when the Farm
app quits (the card stays taken; the farm already takes over a vLLM it finds running).

## What it gives

An ordinary start: ~2 min 30 s from the Farm app's launch → **~2 min** (step 1), a little less with step 4. A first
start or the first after a vLLM update: ~5 min 30 s → **~2 min** (step 3). And a person who knows what the bar is
doing (step 2).

## Questions

1. Steps 1, 2 and 4: build them? *Recommended:* yes.
2. Step 3, a new dependency of the farm's vLLM install: measure it on a trial root, then decide with the numbers?
   *Recommended:* yes, measure first.
