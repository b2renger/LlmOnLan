# The tools we pin, against their releases since 2026-11-20 (2026-11-21, night n° 12)

The owner's standing ask (2026-11-14). The previous pass: [TOOL_UPDATES_2026-11-20](TOOL_UPDATES_2026-11-20.md). Read
with `gh release list` / `gh release view` on 2026-11-21 at 06:15; the Ollama lines below are quoted from the release
body. The pins were checked in the repo the same minute.

| Tool | Our pin | Newer since 2026-11-20 | For us |
|---|---|---|---|
| vLLM | 0.33.0 | none (0.34.0 of 2026-11-16 was tried tonight: RESULTS 2026-11-21, no bump on its own) | — |
| Open WebUI | 0.13.3 | none (0.13.4 blocked: BLENDER_TOOLS_ENV_PLAN) | — |
| **Ollama** | v0.40.16 (`farm-app/src/main/runtimeManager.ts` `RUNTIME_PINS`) | **v0.40.17**, not a prerelease; GitHub's API gives `created_at` 2026-11-21T03:03:47Z and `published_at` 2026-11-10T22:25:00Z, and the body's compare link ends at `v0.40.17-rc3` (read 2026-11-22; the 2026-11-20 pass saw it as rc2) | Two fixes on the farm's path (below). Tried 2026-11-22: no bump on its own, nothing regressed |
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

### Read in Ollama's code, 2026-11-22 (night n° 13), before the trial

- **Thinking off** (ollama#19684, `model/renderers/thinking.go` at v0.40.17): an explicit `think: false` becomes the
  model's first listed level **only when the model cannot turn thinking off** (`!thinking.Supports(false)`); the
  routes add the same for Harmony models (gpt-oss: `low`, `medium`, `high`, no off). The renderers of the farm's Ollama
  models all list `false`: Gemma 4 `{false, true}`, Qwen3.5/3.8 `{false, …}`, Nemotron 3 Nano `{false, true[, "medium"]}`,
  Qwen3-Coder `{false}`. So for the farm's models this change should change nothing; the trial checks it.
- **Tool schemas** (ollama#19686): Ollama decoded a tool's parameters into a struct that knew only `type`,
  `description`, `enum`, `items`, `properties`, `required` and `anyOf`; any other keyword (`default`, `minimum`, …) was
  dropped before the prompt was built. Now kept; what a model sees depends on its renderer (corrected after the
  trial, which found the first reading wrong): Nemotron 3 Nano's and Flint's print every kept keyword, and so does
  Qwen3.5/3.8's (it marshals Ollama's own types, whose marshaller now adds them back: `qwen35.go`, `api/types.go`);
  **Gemma 4's prints only `nullable`**; Qwen3-Coder's change is cleanup (ollama#19686's diff). In our own code: the Computer's MCP
  tools (`shell/src/main/mcp.ts`) use only modeled keywords; the Agent box's `additionalProperties: false` is a
  `response_format`, not a tool, so it does not go this way. The coding agent's (dsh 0.1.7-rc.2) eight tools, read from
  requests captured in the trial, use one: `additionalProperties: false` on `todo_write`'s items.
- **Also in v0.40.17, missed by the first pass:** its bundled llama.cpp moves from b12177 to b12257 (ollama#19646).

### The trial, 2026-11-22: no bump on its own

[RESULTS, "Ollama 0.40.17 against 0.40.16"](../spike/RESULTS.md): gemma4:26b, the farm's default on Ollama, behind a
scratch farm. The same scores (28/28 thinking off on both; 27 and 28 of 28 thinking on; the coding agent 14 and 13 of
15, inside the noise), the same speed (within 2 %) and memory (within 8 MiB); 0 thinking with `think: false` on both;
the tool keywords reach Ollama through LiteLLM but not Gemma's prompt. Nothing regressed, nothing gained for the farm's
default model: the bump can ride with the next Farm app release; it is not a reason for one.
