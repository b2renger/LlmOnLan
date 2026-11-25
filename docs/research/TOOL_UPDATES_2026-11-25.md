# The tools we pin, against their releases since 2026-11-22 (2026-11-25, night n° 16)

The owner's standing ask (2026-11-14). The previous pass: [TOOL_UPDATES_2026-11-22](TOOL_UPDATES_2026-11-22.md). Read
with `gh release list` / `gh release view` and PyPI's JSON on 2026-11-25 at about 05:11; the pins read in the
repo the same minutes.

| Tool | Our pin | Newer since 2026-11-22 | For us |
|---|---|---|---|
| vLLM | 0.33.0 (`install.sh` `LOL_VLLM_VERSION`) | `v0.34.1rc0`, a tag only (2026-11-24 06:01 UTC; PyPI still 0.34.0) | It carries Inkling 2 Mini (plans ▸ Next 20 waits for 0.34.1 on PyPI). Tonight's `gpu-kernels` step already follows 0.34's FlashInfer 0.7.3 (DEVLOG 05:04) |
| Open WebUI | 0.13.3 | none (0.13.4 of 2026-11-17 still the latest, blocked: BLENDER_TOOLS_ENV_PLAN) | — |
| Ollama | v0.40.16 (`farm-app/src/main/runtimeManager.ts` `RUNTIME_PINS`) | **v0.40.18** (2026-11-24) | Its notes: MLX (Apple) work for Inkling, and its llama.cpp bumped to b12651 with JetPack 5 dropped. Nothing for our NVIDIA farms on its own; Inkling still runs on Metal only |
| LiteLLM | 1.106.9 (`LITELLM_PIN`) | none on our 1.106 line since 1.106.12 (read 2026-11-22); new lines 1.109.5, 1.110.4, 1.111.0 (2026-11-25) | Not read: our line's backports are what a bump would take |
| llama.cpp | b12377 (2026-11-14) | up to b12671 (2026-11-24) | Not read (Ollama v0.40.18 moved to b12651) |
| Electron | client **^45.5.0 since tonight** (was ^42.5.0); Farm app 42.6.0 | none since 45.5.0 | The client's bump: DEVLOG 03:41; the Farm app's: the next objective |
| python-build-standalone | 20261110 (CPython 3.12.16) | 20261123, 20261124: CPython still 3.12.16 | Library updates only: libffi 3.8.0 → 3.8.1, zstd 1.5.7 → 1.6.0, **expat 2.10.0 → 2.11.0**. expat's own changelog not read tonight: if 2.11.0 fixes a security issue, SearXNG's parsing of fetched pages goes through it, and a bump of `RUNTIME_PINS` is worth a Farm app release |

**expat 2.11.0, read the same night** (`expat/Changes` at `R_2_11_0`, released 2026-11-23): three security fixes.
CVE-2026-124317, "overread in unknown encoding decoder", "needs use of `XML_SetUnknownEncodingHandler`": Python's
`pyexpat` sets that handler, so a farm service parsing XML fetched from the web (SearXNG's engines) can reach it.
CVE-2026-128241 is the `xmlwf` command line (never run here). CVE-2026-134703, malformed UTF-16 with isolated
surrogates passed to handlers. **python-build-standalone 20261124 is worth having, but a pin bump alone reaches new
installs only:** `ensureRuntime` installs the bundled Python only when none is there (`farm-app/src/main/
runtimeManager.ts:275`), so an installed farm keeps its first Python, and its expat, for good. Reaching running farms
needs an update path for the bundled runtimes (as LiteLLM got one after an app update, J18): a plan, the question in
summary n° 16. *Measured 2026-11-26 (night n° 17), what this paragraph missed:* on **Windows** CPython builds its own expat, **2.9.0 in 20261110 and 20261124 alike**; only the Linux (and likely macOS) builds take it from pbs (Linux x64 2.10.0 → 2.11.0). And the PRO 6000's bundled Python is **CPython 3.12.14**, not 3.12.16. So the update path built that night ([RUNTIME_UPDATE_PLAN](../plans/RUNTIME_UPDATE_PLAN.md) ▸ *Built*) reaches Linux farms; the PRO 6000 needs a CPython bump.

**Nothing changed tonight** for these pins but Electron in the client. To read next: vLLM 0.34.1 when it reaches PyPI.
