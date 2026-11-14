# The tools we pin, against their latest releases (2026-11-14)

The owner's standing ask of 2026-11-14: each session's research covers the updates of the tools we already pin. This is
the first pass. Read from the release pages and advisories by three read-only explorers (their fetches went through a
summariser: quotes are close, not byte-exact); the facts about our own code were checked in the repo. **Verdict per tool
at the end of each section.** Nothing here was to change before the class of 17 November except vLLM; **the same afternoon the
owner asked for the other updates now** ("No not after the class, i want now the updates for llama.cpp, LiteLLM,
Electron, Open WebUI and Python"): the section *Done the same afternoon* at the end. Ollama stays for after the class;
Electron 45 was tried and dropped.

| Tool | Our pin | Latest (date) | For us |
|---|---|---|---|
| vLLM | 0.30.0 live, 0.33.0 offered (`farm/vllm/install.sh` `VER`) | **0.33.0** (2026-11-02) | **Updated on the live farm today** (J14); measured below and in RESULTS |
| llama.cpp | b11836 (`farm/src/llamacpp.js` `PINNED_BUILD`) | v1.0.0 (2026-11-13, no binaries); builds up to **b12377** (2026-11-14) | **Bumped the same afternoon** (owner: "now"): b12377 with `CUDA_TAG` 13.5; document search's vectors identical; the Spark build started |
| Ollama | v0.33.0 (`farm-app/src/main/runtimeManager.ts` `RUNTIME_PINS`) | **v0.40.16** (2026-11-09) | **Bumped the same evening** (owner: "now"), for new installs; Ollama's cloud turned off on every farm (below) |
| LiteLLM | 1.97.0 (`farm/src/commands/install.js:148`) | **1.109.1** (2026-11-12) | **Bumped the same afternoon to 1.106.9**, and installed farms are brought to it on an update (below) |
| Open WebUI | 0.11.4 (`sidecar/OPENWEBUI_VERSION`) | **0.13.3** (2026-11-08) | **Bumped the same afternoon**, two env values keep documents and the Blender tools (INTEGRATION_BRIEF's note) |
| Electron | ^42.5.0 (`shell/` and `farm-app/package.json`) | **45.3.2** (2026-11-13) | **Tried the same afternoon and dropped**: the sandbox fails on 45 in the harness (below); after the class |
| python-build-standalone | 20260825, CPython 3.12.14 (`runtimeManager.ts:50,85`) | **20261110**, CPython 3.12.16 | **Bumped the same afternoon** for new Farm app installs; the client's bundle takes the latest at CI time |

## vLLM: 0.33.0 is the newest

- Releases after 0.30.0: 0.31.0 (2026-10-05), 0.32.0 (2026-10-18), 0.33.0 (2026-11-02, the GitHub object's tag reads
  `v0.33.0rc3` but its name `v0.33.0`, not a prerelease; PyPI lists 0.33.0 as the newest). https://github.com/vllm-project/vllm/releases
- What could touch us: 0.32.0 "`max_tokens` is treated as an upper bound on output rather than reserved from the
  context window" (#57035; what it returns when prompt + max_tokens > the window is not said: our clients clamp anyway,
  2026-11-14 night n° 3); 0.33.0 "unsupported `vllm serve` flags and request fields fail instead of being ignored"
  (#62431…): a launch flag of `serve.sh` vLLM no longer knows would stop the start. Both were passed on the live
  farm today (below). CUDA 13.0 wheels only; no driver minimum stated.
- **Today:** the panel's Update vLLM took about 1 minute (its packages were in uv's cache from the 2026-11-02 trial),
  the first start 382 s (kernels), and Qwen3.6 35B-A3B at 64k with Automatic seats gave 48 people. Two farm bugs were
  found on the way (DEVLOG 2026-11-14 afternoon). Numbers: RESULTS ▸ *30 people for the class*, the vLLM 0.33.0 row.

## llama.cpp: "v1" is a library version

- v1.0.0 (2026-11-13, marked Latest) carries **no binaries** (only `nightly-tag.txt` and the sources). The Hugging Face
  post: "Today we release libraries `v1.0.0`"; major versions now mark C API/ABI breaks. https://huggingface.co/blog/ggml-org/llama-cpp-v1
- The binaries still come from `bNNNNN` builds (marked Pre-release); the newest, b12377 (2026-11-14).
- **A pin bump alone fails:** b12377's Windows CUDA zips are `cuda-12.4` and `cuda-13.5`; the farm asks for
  `cuda-13.4` (`farm/src/llamacpp.js:43`, `:70-71`). The bump is `PINNED_BUILD` and `CUDA_TAG` together, with the arm64
  CI workflow (`llamacpp.js:39-41`).
- v1.0.0's notes remove `--defrag-thold` (the farm does not pass it; checked: `farm/src/llamacpp.js:163-219`) and add
  `--allow-unauthenticated-tools`. Whether NVFP4/MTP/Qwen3.x/batching changes landed after b11836 was not established.
- **Measured the same day** (RESULTS ▸ *llama.cpp b11836 against b12377*): both builds run on this driver; the same
  80 tok/s alone; with 16 at once b12377's first token p95 is 1.8 s against 5.1 s; 8k conversations at 16 still fail
  (5.8 s against 9.2 s). **Verdict:** a real gain under load, but llama.cpp cannot serve 30 here (16 seats at most), so
  it is not on the class's path: bump `PINNED_BUILD` and `CUDA_TAG` together after the class, with the farm's tests.

## Ollama

- v0.33.0 (2026-08-21) → v0.40.16 (2026-11-09, Latest). `ollama-windows-amd64.zip` keeps its name. v0.40.2: "If you
  later downgrade to a version older than 0.40, you'll need to re-pull those models." v0.34.1: GGUF creation from
  safetensors needs llama.cpp's tools. https://github.com/ollama/ollama/releases
- **Verdict:** after the class, on a scratch Ollama (skill `lol-scratch-farm`): Gemma 4 26B and Qwen3.x speed against
  v0.33.0, and the re-pull rule for a way back.

## LiteLLM: a Critical advisory, out of reach here

- **GHSA-7hp6-4w63-5g45 / CVE-2026-114612** (Critical, 2026-09-30): "An authenticated user with `internal_user`
  privileges can escalate to `proxy_admin`"; affected >=1.91.0 <1.100.4: **our 1.97.0 is in range.**
  https://github.com/advisories/GHSA-7hp6-4w63-5g45
- **Why it cannot occur here (checked in our code):** the farm's LiteLLM has no database, so no users or roles: a
  `master_key` only when the farm has a password, none otherwise (`farm/src/litellm.js`; corrected the same afternoon,
  this line first said "one master_key"), and it listens on loopback only, behind the seat gate
  (`farm/src/commands/up.js:1709-1710`). There is no `internal_user` to escalate from.
- Other advisories (2026-10-01, 10-27, 11-12) had no readable affected ranges. A malicious `litellm==1.107.0` was on
  PyPI on 2026-10-21 for two hours; we pin an explicit older version.
- **Verdict:** bump to a patched line (1.106.x or 1.109.x) after the class, re-checking the fastapi bound of
  `install.js:128-171` in a clean venv.

## Open WebUI

- 0.11.4 is the last 0.11.x. Latest 0.13.3 (2026-11-08); 0.12.5, 0.13.0 and 0.13.1 say "contains security fixes".
  0.13.1: `RAG_TOP_K` defaults to 10 (from 3); "Full Context Mode" is now labelled "Always Use Full Text"; attached
  files need "Preload files" in the model's capabilities. 0.13: "rolling updates are not supported" (schema).
  https://github.com/open-webui/open-webui/releases
- **Verdict:** a pin bump is invariant 5's job (bump, rebuild the sidecar, smoke tests, no LOL code change). The
  attached-files change may need an env setting; check our `RAG_FULL_CONTEXT` path against 0.13 before. After the class.

## Electron

- 42's end of life was 2026-10-20 (the schedule, no tentative mark); supported now: 43, 44, 45 (latest 45.3.2).
  The highest 42.x seen: 42.11.14 (2026-10-14). https://releases.electronjs.org/schedule
- **Verdict:** a major bump for both apps, after the class; the dsh agent already runs on its own Node (its addon
  refuses Electron 42: `docs/context/client.md`).

## python-build-standalone

- 20261110 (2026-11-11) ships CPython 3.12.16, "an expedited security release" (CVEs in Expat and tarfile).
  https://www.python.org/downloads/release/python-31216/
- **Verdict:** bump `RUNTIME_PINS` and `PY_PINNED` together, after the class (a fresh Farm app install path).

## Done the same afternoon (2026-11-14, owner: "now")

- **llama.cpp b12377** (`PINNED_BUILD`, `CUDA_TAG` cuda-13.5, the arm64 workflow): installed through the farm's own
  path; document search's vectors equal on both builds (cosine 1.000000, five texts), so no laptop re-indexes;
  `litellm-cancel.js` with the real engine passes. The Spark's `llamacpp-b12377` built by the workflow (dispatched
  on `night`, the owner's yes): it must be on the repo's releases before a Farm app with this pin is tagged.
- **LiteLLM 1.106.9**, not 1.109.1: the smallest step out of GHSA-7hp6-4w63-5g45 and of **GHSA-2rwg-2wh4-7c4f** (High,
  published 2026-11-12, affects everything below 1.106.9 on that line). Two things found on the way: **1.106 refuses to
  start with no master key** (a farm without a password, the default, would not have started: the generated config now
  says so on purpose), and **an installed farm never got a LiteLLM bump** (`lol install` and the Farm app now bring the
  venv to the pin; the Farm app's step is asynchronous and retried at the next start if it fails). The cancel test
  passes on 1.106.9 (fake engine and llama.cpp) and on 1.97.0 with the new config line.
- **Open WebUI 0.13.3**: see INTEGRATION_BRIEF's note of this date (two env values; the chats copied before the
  one-way migration; a chat and an attached document through the live farm in the client's window).
- **Electron 45.3.2: tried, dropped for the class.** No API we call was removed (a read of 43, 44 and 45's breaking
  changes against our code; the sync `safeStorage` calls go in 46; 43's dialogs open in Downloads), and the unit suites
  pass on it, but the harness's sandbox stops booting in a long-running window on 45 (`--phase c` 57/73 twice) and not
  on 42 (73/73, same tree). Plans ▸ Next 14.
- **LiteLLM 1.106.9's cost, measured on the live vLLM:** each person about 6 % slower at 30 (88 against 95 tok/s) and
  9 % at 48 (67 against 74), first token unchanged; kept for the security fix.
- **CPython 3.12.16** (`RUNTIME_PINS` 20261110): new Farm app installs; an installed farm keeps its runtime.
- **Ollama v0.40.16** (the same evening, owner: "ollama 40 now before the tests"): the farm's document reading 5/5 on
  both versions, warm 1.6–4.1 s against 1.3–2.1 s; chat 140 against 129 tok/s alone and 134 against 93 with two;
  the cancel test passes; new installs only. **Ollama's cloud features were on by default** on every farm: now off
  (`OLLAMA_NO_CLOUD=1`). DEVLOG 2026-11-14 19:20.
