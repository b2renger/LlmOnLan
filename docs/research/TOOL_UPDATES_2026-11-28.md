# The tools we pin: new releases (night n° 19, 2026-11-28, read ~04:10 with `gh api …/releases` and PyPI's JSON)

| tool | ours | newest stable | for us |
|---|---|---|---|
| llama.cpp | b12377 (b12774 approved, after farm-v0.0.56) | v1.1.0 = b12774 (2026-11-26) | nothing new since [n° 18](TOOL_UPDATES_2026-11-27.md) |
| Ollama | 0.40.16 | **0.40.19** (2026-11-26) | below |
| LiteLLM | 1.106.9 (1.108.19 approved, after farm-v0.0.56) | **1.108.20** (2026-11-27 21:37, LTS) | below |
| mcpo (the client's Blender helper) | 0.0.20, pinned tonight with FastAPI 0.139.0 | **0.0.21** (2026-11-25) | below |
| Electron | 45.5.0 | 45.5.0 (2026-11-24) | nothing new |
| vLLM | 0.33.0 (the farm's install) | 0.34.0 (2026-11-16) | 0.34.1 still not on PyPI, so Inkling on vLLM still waits |
| Open WebUI | 0.13.3 | 0.13.5 (2026-11-25) | nothing newer; 0.13.5 does not start on Windows ([OWUI_0135_2026-11-27](OWUI_0135_2026-11-27.md)) |
| python-build-standalone | 20261124 | not read: GitHub's API timed out on that repository | |

## Ollama 0.40.19

Its notes ([v0.40.19](https://github.com/ollama/ollama/releases/tag/v0.40.19)):
- *inkling2: faster short histories, draft proposals and conv snapshots* (#19881);
- *mlxrunner: compact Engram history buffers* (#19913, Apple's MLX runner);
- *bump llama-server* (#19917).

**For us:** the farm pins 0.40.16. 0.40.17 and 0.40.18 were read in n° 18's DEVLOG. A bump is a plan and the
owner's question, measured like the others (the 28-item check, the cancel test). It matters if the class farm moves
to Inkling 2 on Ollama, which no plan says.

## LiteLLM 1.108.20 (LTS)

Its notes ([v1.108.20](https://github.com/BerriAI/litellm/releases/tag/v1.108.20)), "7 PRs. 3 fixed":
- **Anthropic:** a tool message with a non-string `tool_call_id` no longer reaches Anthropic, a fault since 1.108.19;
- **the Responses API:** cancelled `/v1/responses` streams billed wrongly;
- **keys and teams:** `GET /audit` answering 500.

**For us:** none of these is on the farm's routes. The gate refuses `/v1/responses`, and the farm has no Anthropic
model and no keys or teams. The approved 1.108.19 stands. 1.108.20 can replace it at the bump only if its own notes or
a later patch give a reason.

## mcpo 0.0.21

**What changed for us:** it stops passing `ssl_certfile` and `ssl_keyfile` to `FastAPI()` (its `main.py`, read in the
wheel tonight), and keeps `disabledTools`.

**Why it matters:**
- 0.0.20 with FastAPI 0.165.0 (2026-11-18) cannot start: `FastAPI.__init__() got an unexpected keyword argument
  'ssl_certfile'`, seen in a fresh scratch venv.
- The client now pins `mcpo==0.0.20` with `fastapi==0.139.0`, the pair that ran on this computer
  (BLENDER_LAB_MCP_PLAN).
- 0.0.21 alone is the upgrade path. **Run here the same night** (04:16):
  - a scratch venv with `mcpo==0.0.21` and the shipped wheel, which pulled FastAPI 0.165.0 and mcp 1.30.0;
  - started the client's way (the compiled `helperConfig`/`helperEnv`): "Filtered out 6", 20 tools at `/blender`;
  - `search_manual_docs` answered; 401 without the key.
- **For us:** the pin can move to `mcpo==0.0.21` with no FastAPI pin, once a release has carried 0.0.20 or the owner
  prefers the newer one. A one-line change plus its test.
