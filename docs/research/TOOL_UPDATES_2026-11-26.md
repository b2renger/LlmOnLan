# The tools we pin: what changed since 2026-11-25 (night n° 17, 2026-11-26)

Read with `gh api …/releases` (00:50) and the `docs` explorer (00:55; its quotes are a summarizer's wording, capped near
125 characters: re-read a line before relying on it). **Checked** marks what this session read in the code itself.

| Tool | Our pin | New | For us |
|---|---|---|---|
| Open WebUI | 0.13.3 | **0.13.5** (2026-11-25), 0.13.4 (2026-11-17) | 0.13.5's page: *"Update … promptly to receive this release's security fixes"*, details *"once the fixes have CVE identifiers"*: no ID, severity or affected range yet. 0.13.4 (no security heading) removed Settings ▸ Connections and ▸ Tools, the user-added tool servers, for its Tether app: the path our shell uses for the Blender tools (the user-settings API, `shell/renderer/app.js:583`, `:619`, `:671`, **checked**), hence the pin ([BLENDER_TOOLS_ENV_PLAN](../plans/BLENDER_TOOLS_ENV_PLAN.md): the same tools through `TOOL_SERVER_CONNECTIONS`, env). Neither page names `TOOL_SERVER_CONNECTIONS`. 0.13.5 renames terminal connections to *Machines* (`MACHINE_CONNECTIONS`, *"the previous terminal variable names still work"*). |
| LiteLLM | 1.106.9 | 1.111.0, 1.109.5 (2026-11-25), 1.108.x | Six advisories after 1.106.9 (the advisories list, all 30 read): GHSA-w5h5-479w-p5hx (High, CVE-2026-93355, fixed 1.111.0: JWT/SSO e-mail fallback signs in as another user), GHSA-fjxr-j47c-4x2x and GHSA-2364-6whj-g7vx (`/spend/tags`, `/global/activity/cache_hits` show proxy-wide data, fixed 1.108.0), GHSA-wpm4-hgr2-xjwr (team admins' fallbacks, 1.108.0), GHSA-4xm2-x5g5-wc8q (userless virtual keys read others' metadata via `/key/info`, 1.106.12), GHSA-mpqq-3cc5-fgh2 (Low, its range malformed). **None is reachable on a farm (checked):** the seat gate, on by default (`farm/src/config.js:78`), forwards only an allowlist (`farm/src/seats.js:79–88`: the chat and completion routes, the model catalogue, `/model_group/info`, `/health/liveliness`), LiteLLM itself listens on loopback behind it, and the farm uses no SSO, JWT, team or virtual key. A bump stays worth a test at a quiet moment (J18's shape), not urgent. |
| llama.cpp | b12377 | b12751 (2026-11-25) | Not read tonight. |
| vLLM | 0.33.0 (farm), 0.34.0 (trial) | 0.34.0 still on PyPI (00:49); 0.34.1 not yet | Inkling 2 Mini waits (plans ▸ Next 20). |
| Ollama | v0.40.16 | v0.40.18 (read 2026-11-25) | Nothing new for us. |
| Electron | 45.5.0 (both apps on `main`) | 45.5.0 is `latest` | Nothing to do. |
| python-build-standalone | 20261124 (`main`) | — | Its Windows builds' expat is CPython's own (2.9.0): [RUNTIME_UPDATE_PLAN](../plans/RUNTIME_UPDATE_PLAN.md) ▸ *Built*. |

**For the owner:** Open WebUI 0.13.5's security fixes are the first reason since 2026-11-22 to move off 0.13.3, and the
way is BLENDER_TOOLS_ENV_PLAN first (summary n° 17's question). Not checked: whether 0.13.5's fixes touch anything a
LlmOnLan client exposes (Open WebUI listens on `127.0.0.1` in the client, `shell/src/main/sidecar.ts:18`, **checked**;
one person per install).

Sources: https://github.com/open-webui/open-webui/releases/tag/v0.13.5 · https://github.com/open-webui/open-webui/releases/tag/v0.13.4 ·
https://github.com/open-webui/open-webui/blob/main/CHANGELOG.md · https://github.com/BerriAI/litellm/security/advisories ·
https://github.com/BerriAI/litellm/releases/tag/v1.111.0 · https://github.com/BerriAI/litellm/releases/tag/v1.109.5
