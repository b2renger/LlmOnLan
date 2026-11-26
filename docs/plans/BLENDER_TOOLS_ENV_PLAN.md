# BLENDER_TOOLS_ENV_PLAN: the Blender tools through Open WebUI's env, so Open WebUI 0.13.4 can come

**Status: approved by the owner, 2026-11-26** (summary n° 17, question 2: "yes", the chat 08:52; proposed night n° 12,
2026-11-21). The bump it unblocks goes to **0.13.5** (2026-11-25, security fixes), not 0.13.4. Size **S**.

## Why

The owner approved the Open WebUI 0.13.4 bump (2026-11-20 12:46). Night n° 12 found it would drop the **Blender
tools** from Open WebUI chats without an error (DEVLOG 2026-11-21 02:48; TOOL_UPDATES_2026-11-20, corrected):
- 0.13.4's CHANGELOG, *Changed*: "Direct connections move to Tether … tool servers … that users added in their own
  settings no longer appear"; `ENABLE_DIRECT_INTEGRATIONS` is gone.
- LlmOnLan registers Blender's mcpo as such a server: `renderer/app.js` `seedBlenderToolServer` writes it into
  `ui.toolServers` and selects it as `direct_server:<idx>` in `ui.tools`, through the user-settings API. 0.13.3 reads
  those (`utils/middleware.py` `metadata['tool_servers']`); 0.13.4 does not.
- The owner, 2026-11-14: "we should keep the document and blender tool working even with the new owui version".

Invariant 5 says an upgrade that forces a code change is a separation defect to redesign. Here is the redesign: put
Blender's server on the road that holds across versions, as the Computer's does.

## What exists (read 2026-11-21)

- The Computer's MCP server reaches Open WebUI by **env**: `TOOL_SERVER_CONNECTIONS` (`configBridge.ts:252`
  `computerToolServer`, `:565`), set before each spawn. 0.13.4 still reads it (`config.py:363`) and lists an OpenAPI
  entry as the tool `server:<id>` (`routers/tools.py:149`), an MCP one as `server:mcp:<id>` (`:193`).
- The Blender toggle is in Preferences ▸ *Assistant tools* (opt-in, off by default); mcpo runs on this computer.

## What would change

1. `configBridge.ts`: while the Blender toggle is on, `TOOL_SERVER_CONNECTIONS` carries a second entry beside the
   Computer's: `{type: "openapi", url: <mcpo>, path: "/openapi.json", auth_type: "bearer", key: <its key>,
   config: {enable: true}, info: {id: "lol-blender", name: "Blender", …}}`. Env only: the public config surface.
2. **Turning the toggle on or off restarts Open WebUI** (env is read at start; about 10–30 s, the chat stays). Today
   the toggle acts at once. The Preferences line says so.
3. Selection: `seedBlenderToolServer` writes `server:lol-blender` into `ui.tools` instead of `direct_server:<idx>`, and
   removes the old `ui.toolServers` entry once (the user-settings write it already makes; no new Open WebUI call).
   **To check first, on 0.13.4:** that a new chat preselects a `server:` id from `ui.tools` as it did a
   `direct_server:` one; if it does not, the person picks *Blender* in the chat's tool menu, as for the Computer.
4. Then the pin bump, to 0.13.5 (the owner, 2026-11-26; plans ▸ Now), with its smoke tests and `owui_doc_check.sh`
   (PASS on 0.13.4 already; run again on 0.13.5).
5. Tests: `buildSidecarEnv` with the toggle on and off; HUMAN_TESTS A27 (the Blender tools end to end) run again.

## Questions for the owner

1. **This plan, or stay on 0.13.3?** *Recommended:* this plan, then the bump: every Open WebUI after 0.13.3, its
   security fixes included, comes without a person's own tool servers, so without it LlmOnLan is held at 0.13.3. (The
   gain 0.13.4 advertises, no repeated skill and knowledge lists in long chats, is not shown for our chats: the relay
   of 2026-11-20 saw no such list in a chat with a document.) *Default if no answer:* Open WebUI stays at 0.13.3;
   nothing is built.
2. **A restart of Open WebUI when the Blender toggle changes** (step 2): acceptable? *Recommended:* yes, it is a
   setting a person changes rarely.

**Answered 2026-11-26** (the chat, 08:52, summary n° 17's question 2): yes to 1; 2 takes its recommendation.
