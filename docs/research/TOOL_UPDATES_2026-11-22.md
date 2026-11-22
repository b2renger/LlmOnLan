# The tools we pin, against their releases since 2026-11-21 (2026-11-22, night n° 13)

The owner's standing ask (2026-11-14). The previous pass: [TOOL_UPDATES_2026-11-21](TOOL_UPDATES_2026-11-21.md) (its
Ollama v0.40.17 trial ran tonight: RESULTS, "Ollama 0.40.17 against 0.40.16"). Read with `gh release list` /
`gh release view` on 2026-11-22 at about 04:10; the pins checked in the repo the same minute.

| Tool | Our pin | Newer since 2026-11-21 | For us |
|---|---|---|---|
| vLLM | 0.33.0 | none (0.34.0 of 2026-11-16 tried 2026-11-21) | — |
| Open WebUI | 0.13.3 | none (0.13.4 blocked: BLENDER_TOOLS_ENV_PLAN) | — |
| Ollama | v0.40.16 | none (v0.40.17 tried tonight: no bump on its own) | — |
| **LiteLLM** | 1.106.9 (`farm/src/commands/install.js` `LITELLM_PIN`) | **1.106.10, .11, .12 on our own line** (backports), 1.108.15 | Nothing that reaches the farm (below) |
| llama.cpp | b12377 (`farm/src/llamacpp.js` `PINNED_BUILD`) | up to b12626 (2026-11-22 01:11 UTC) | Not read |
| Electron | ^42.5.0 (locked 42.5.1 in `shell/`, 42.6.0 in `farm-app/`) | none since 45.4.1 / 44.11.5 / 43.8.12 (2026-11-18) | The 42 line's last release is 42.11.18 (2026-10-21); plans ▸ Next 14 (45 after v0.2.20) stands |
| python-build-standalone | 20261110 | none | Current |

## LiteLLM 1.106.10 to 1.106.12

Quoted from the release bodies:
- 1.106.10: "Fixed Google MCP servers asking users to sign in again when the access token expires". The farm's
  LiteLLM serves no MCP server.
- 1.106.11: "Fixed GPT-6.2 prompt caching for system prompts …". A cloud model; the farm routes none.
- 1.106.12: the same caching fix; "Fixed `/key/info` letting a key with no user read other userless keys by hash or
  alias"; newer dnspython, tornado, filelock, soupsieve and opentelemetry; a newer Docker base image. **The `/key/info`
  fix does not reach the farm:** its LiteLLM keeps no key store (no `database_url`; the only key is the farm password as
  `master_key`, `farm/src/litellm.js`), listens on loopback only, and the seat gate answers 404 to any route outside its
  list (`farm/src/seats.js` `refusal`: the chat routes and the model list).

A bump to 1.106.12 would bring the library updates and nothing the farm uses; not worth a Farm app release on its own.
Nothing changed tonight.
