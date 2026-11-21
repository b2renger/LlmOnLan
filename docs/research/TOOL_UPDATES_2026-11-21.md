# The tools we pin, against their releases since 2026-11-20 (2026-11-21, night n° 12)

The owner's standing ask (2026-11-14). The previous pass: [TOOL_UPDATES_2026-11-20](TOOL_UPDATES_2026-11-20.md). Read
with `gh release list` / `gh release view` on 2026-11-21 at 06:15; the Ollama lines below are quoted from the release
body. The pins were checked in the repo the same minute.

| Tool | Our pin | Newer since 2026-11-20 | For us |
|---|---|---|---|
| vLLM | 0.33.0 | none (0.34.0 of 2026-11-16 was tried tonight: RESULTS 2026-11-21, no bump on its own) | — |
| Open WebUI | 0.13.3 | none (0.13.4 blocked: BLENDER_TOOLS_ENV_PLAN) | — |
| **Ollama** | v0.40.16 (`farm-app/src/main/runtimeManager.ts` `RUNTIME_PINS`) | **v0.40.17**, a full release since 2026-11-21 03:03 UTC (the 2026-11-20 pass saw it as rc2) | Two fixes on the farm's path (below): worth a bump trial |
| LiteLLM | 1.106.9 (`farm/src/commands/install.js` `LITELLM_PIN`) | 1.108.14 (2026-11-20 23:43), 1.111.0-rc.3 | Not read; the 2026-11-20 pass found nothing for us on these lines |
| llama.cpp | b12377 (`farm/src/llamacpp.js` `PINNED_BUILD`) | up to b12602 (2026-11-21 04:28) | Not read |
| Electron | ^42.5.0 | none since 45.4.1 (2026-11-19) | 45 stays plans ▸ Next 14 |
| python-build-standalone | 20261110 | none | Current |

## Ollama v0.40.17

Quoted from the release body ("What's Changed"), the lines that touch a farm on Ollama:
- "Disabling thinking now maps to the model's lowest supported reasoning level rather than being ignored." The client
  turns thinking off with `think: false` on the Computer's structured, code and conversation calls
  (`shell/renderer/chat/net/request.mjs:178-181`, from `app/ask.mjs`, `graph/runner.mjs`, `graph/parts/converse.mjs`);
  on a model whose lowest reasoning level is not "none", such a call may now get a short reasoning pass, where it got
  the model's default before. Not measured: a trial
  would ask the same questions with thinking off on 0.40.16 and 0.40.17 (`spike_bench.py quality --thinking off`) and
  compare the tokens and the first-word time.
- "Tool definitions passed through the API keep JSON schema keywords Ollama doesn't model instead of dropping them."
  The Computer's MCP tools and Open WebUI's tools reach Ollama through LiteLLM with their JSON schemas; keywords that
  were dropped now reach the model. Not checked which of our tools' schemas use such keywords.
- "Changing the context shift setting no longer reloads the model." The farm does not change it.
- The rest is Apple silicon (Inkling 2 Mini, "supported on Apple silicon only in this release"), Vulkan and Windows
  iGPUs, and the `ollama launch` integrations: nothing for the farm's NVIDIA boxes.

A bump is a change to `RUNTIME_PINS` (the Farm app's own Ollama) and so a Farm app release: a plan or the owner's
word, not a session's own. Nothing was changed tonight.
