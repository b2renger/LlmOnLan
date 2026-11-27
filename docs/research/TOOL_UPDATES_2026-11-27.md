# The tools we pin: new releases (night n° 18, 2026-11-27, read ~03:31 with `gh api …/releases`)

| tool | ours | newest stable | newest pre-release | for us |
|---|---|---|---|---|
| llama.cpp | b12377 (b12751 approved, after farm-v0.0.56) | **v1.1.0** = build **b12774** (2026-11-26) | b12803 (2026-11-27) | below |
| Ollama | 0.40.16 | 0.40.18 (2026-11-24) | 0.40.19-rc0 | not read tonight |
| LiteLLM | 1.106.9 | 1.108.19 (2026-11-26) | 1.113.0-dev.1 | not read tonight |
| python-build-standalone | 20261124 | 20261124 | — | nothing new |
| Electron | 45.5.0 | 45.5.0 | 46.0.0-alpha.14 | nothing new |
| vLLM | 0.33.0 (the farm's install) | 0.34.0 | — | 0.34.1 still not on PyPI |
| Open WebUI | 0.13.3 | 0.13.5 | — | does not start on Windows ([OWUI_0135_2026-11-27](OWUI_0135_2026-11-27.md)) |

## llama.cpp v1.1.0 (build b12774)

- **An official release** after a long line of numbered builds. The numbered builds are now marked pre-releases
  (b12801, b12803), and v1.1.0's own page carries only `nightly-tag.txt`, pointing at b12774, whose assets have the
  names the farm downloads (`llama-b12774-bin-win-cuda-13.5-x64.zip`, `cudart-llama-bin-win-cuda-13.5-x64.zip`; the
  farm's `CUDA_TAG` is already `cuda-13.5`).
- **Adds the Inkling 2 family** (base, Mini, DSpark; #32217, #32218, #32694) and RAON-1-mini, so plans ▸ Next 20's
  condition is met on llama.cpp. Measured the same night: RESULTS ▸ *Inkling 2 Mini on llama.cpp*.
- **Speculative decoding:** DFlash is split into `draft-dflash`, `draft-dflash2`, `draft-dspark` and `draft-lilicorr`
  (#32016). `draft-mtp`, the farm's, is not named among the changes, and Inkling ran with it off. Bonsai's draft
  was not run on b12774 tonight.
- **The old `llama_batch` API deprecated** (#32306): a library change; the farm runs `llama-server`.
- **For the approved bump (b12751, after farm-v0.0.56):** b12774 is 23 builds later, an official release, and carries
  Inkling. Question 2 of summary n° 18.
- **b12774 given b12751's scratch checks** (04:36–04:39, no farm code; the farm's `binDir`, the running binary checked).
  UD-IQ2_S, 4 slots sharing 64k:

  | | b12774 | b12751 (2026-11-26) |
  |---|---|---|
  | the 28-item check | 25/28 | 26/28 (b12377: 24, 23) |
  | one person | 109.5 tok/s, first token 1.05 s | 111.1 tok/s |
  | four at once, each / in all | 55.9 / 210.6 | 56.6–49.4 / 211 |
  | the card | 11.5–11.8 GB | 11.6 GB |

  The farm's cancel test (`LOL_CANCEL_ENGINE=llamacpp`, b12774's llama-server) **PASS** on all four paths: a generation
  released 16 to 990 ms after the abort. Within noise of b12751 on every line; the Spark's CI build is not tried (it
  builds at the bump). Results: `results/n18-lcpp-b12774-qwen38-ud-iq2s__*`.

## Ollama 0.40.17, 0.40.18 (and 0.40.19-rc0)

Read by the `docs` explorer (04:47–04:56, the release pages; its quotes are a fetch tool's relay, not checked byte for
byte). **Nothing for our NVIDIA boxes:**
- 0.40.17: a Windows fix for *integrated* GPUs' KV cache, Vulkan on iGPUs, *disabling thinking maps to the model's lowest
  reasoning level*, Inkling 2 Mini on Apple silicon only. Our scratch A/B of 2026-11-22 held the pin against it.
- 0.40.18: four Metal/MLX and llama.cpp-bump commits (the compare view lists exactly those four).
- No security advisory published.

## LiteLLM after 1.106.9

The same explorer. There is no stable 1.107.x; 1.108.x is marked LTS; 1.109.x, 1.110.x and 1.111.0 exist (1.110.x and
most of 1.111.0 not read). **Worth a scratch test** of the 1.108 line:
- `ollama_chat/` streams no longer give every parallel tool call index 0 (1.108.5, #50718): our Ollama route.
- A vLLM mid-stream abort no longer ends as a clean `stop` (1.108.19, #54466): our vLLM route.
- 1.109.0 changes stream endings: a stream without a finish reason fails, and a stalled read raises 408. That could move
  our cancel and stream tests.
- **Advisories:** GHSA-2364-6whj-g7vx (`/global/activity/cache_hits`) and GHSA-fjxr-j47c-4x2x (`/spend/tags`) affect
  1.106.9 (fixed in 1.108.0). Both routes are already refused by the farm's seat gate, checked and tested on 2026-11-26
  (`375432f`, `farm/test/run.js`). GHSA-2rwg-2wh4-7c4f is fixed in 1.106.9 itself.
- **Tried the same night, 05:03–05:24** (a scratch venv, `litellm[proxy]==1.108.19` with the farm's FastAPI range, which
  resolved to 0.140.6; no farm code; the suites take `LOL_LITELLM`):
  - `test/litellm-cancel.js` with fake engines: **PASS**, the same 32 checks as on 1.106.9 (cancels on every route,
    thinking off and the reply limit reaching `openai/`, `hosted_vllm/` and `ollama_chat/`);
  - with the real llama.cpp (b12377, UD-IQ2_S): **PASS**, four paths, released 15–997 ms after the abort;
  - **the whole vLLM lifecycle suite on it, under the Farm app's Electron 45: 184/184.**

  The bump (`install.js` and the Farm app's `LITELLM_PIN` together) is summary n° 18's question 3.

Sources: `gh api repos/ggml-org/llama.cpp/releases/tags/v1.1.0` (body, assets, `target_commitish` 074f1f3f), `…/tags/b12774`
(assets); `gh api repos/<repo>/releases?per_page=3` for the others.
