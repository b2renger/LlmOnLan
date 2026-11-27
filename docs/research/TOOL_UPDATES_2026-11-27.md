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
  Inkling. Question 2 of summary n° 18. Either needs the same scratch checks as b12751 got (speed, quality, the cancel
  test, the Spark's CI build).

Sources: `gh api repos/ggml-org/llama.cpp/releases/tags/v1.1.0` (body, assets, `target_commitish` 074f1f3f), `…/tags/b12774`
(assets); `gh api repos/<repo>/releases?per_page=3` for the others.
