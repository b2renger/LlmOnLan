# LlmOnLan shell (Electron + TypeScript)

The desktop client. It supervises a bundled, **unmodified** Open WebUI sidecar, points it at the
discovered LAN farm through OWUI's public config surface, keeps all data on the machine, and wraps
it in ComfyQ‑styled chrome (topbar · connection screen · preferences).

The main area has **three surfaces**, switched in the topbar: **Open WebUI** (RAG, documents, web
search, voice), **LOL Vibe** (named LOL Chat until 2026-09-27; the code keeps the old name: `renderer/chat/`,
entry `chat/main.mjs`) — straight to the farm's OpenAI endpoint, tok/s + TTFT per reply, a message tree,
seat-aware sending, a context meter; no RAG or uploads, and tools only in its IDE (the Project panel's coding agent); history in IndexedDB `lol-chat`, in the data folder — and the **Computer** (`renderer/chat/computer/`). The app
remembers the last surface (`localStorage['lol:view']`). Which surfaces ship is one constant —
`src/main/clientMode.ts` `OWUI_ENABLED` (with a matching `NO_OWUI` in `renderer/app.js`; flip both) —
so an OWUI-free build is a boolean flip, not a fork.

## Architecture

```
src/main/                       (TypeScript → build/ via tsc; Electron main process)
  index.ts        boot: window + IPC + orchestrates sidecar/discovery; presence heartbeat
                  (every 10 s POST /lol/client-ping to the active farm: id/host/version/idleSec)
  farmSelect.ts   which farm to use + the context OWUI runs with for it (pure; unit-tested)
  sidecar.ts      SidecarSupervisor — spawn/health-wait/restart/repoint/stop OWUI
  configBridge.ts the ONLY module that knows OWUI's config surface (env; the renderer's app.js
                  holds the few user-settings REST writes env cannot do)
  discovery.ts    LAN farm discovery — UDP beacon listener + subnet scan + manual peers
  webSearch.ts    OWUI's web search (web search v2): the farm's SearXNG → the top pages, read through io.ts
                  (public internet only) → their best passages; served at POST /web/search on mcp.ts's listener
  sidecarManager.ts first-run download + staged update of the OWUI sidecar tarball
  updater.ts      app self-update (electron-updater, GitHub releases)
  mcpoSupervisor.ts opt-in local Blender assistant-tools server (mcpo)
  dataMigration.ts move the OWUI data folder between locations (lol-client excluded: it moves at the next boot)
  clientData.ts   the main window's session in DATA_DIR/lol-client (LOL Vibe + the Computer): the boot-time
                  pending move, the writability fallback, the one-time v0.1.x import (pure fs; unit-tested)
  clientMode.ts   which surface this build ships (OWUI_ENABLED) — gates the whole sidecar lifecycle
  store.ts        shell settings (a hand-rolled userData/shell-settings.json) — incl. the last farm
                  context, which seeds the next cold boot so OWUI starts ONCE ("Launch time" below)
  paths.ts        resolve the sidecar exe (dev venv vs packaged) + default DATA_DIR
  util.ts         free-port, tree-kill, http GET/health-poll
  types.ts        shared types + the renderer IPC contract
  projects.ts / projectsPath.ts / debugLog.ts   the Computer's projects API and debug log
  mcp.ts          the Computer's MCP server on 127.0.0.1:41995 (also answers OWUI's web search and the home tools)
  homeAssistant.ts the Home Assistant a person linked: reading, and commands only once a person allowed them
  io.ts           the GETs main sends for the Computer (Fetch, Open data, an Agent's hosts) and web search's page reads
  outputs.ts / serial.ts  the Send box's one choke point (armed outputs) and USB serial (+ mic/camera grants)
  studio.ts / projectGit.ts  LOL Vibe's IDE: the coding agent (DeepSeek Harness on its own Node) and git per project
src/preload/index.ts            contextBridge `window.lol` API (no Node in the renderer)
renderer/                       index.html + app.js (topbar, webview host, prefs); tokens.css (ComfyQ palette)
  chat/                         LOL Vibe: main.mjs + app/ core/ ctx/ net/ render/ state/ ui/ strings/ css/
                                (chat/computer, graph, sandbox = the Computer)
test/                           unit.js, chat-unit.js (+chat/unit), chat-lint.js, chat-scope.js, asar-probe.js,
                                chat-harness/ (chat-only Electron over CDP), mock-farm.js (+mock/), e2e.js (legacy)
assets/                         icon.svg / icon.png
```

The shell's own renderer (`app.js`) is intentionally thin: chrome + the `<webview>` of
`http://127.0.0.1:<port>` (the local OWUI) + the settings UI; the shell's settings, discovery and the
sidecar live in the main process. LOL Vibe and the Computer (`renderer/chat/`) are the exception: they
keep their state in the renderer's IndexedDB — and the main window runs on
`session.fromPath(<DATA_DIR>/lol-client)`, so that state lives in the user's data folder with OWUI's
(owner rule 2026-09-27: all data in DATA_DIR). The OWUI `<webview>` keeps its `persist:owui` partition
under userData (its token and caches only).

**Data-folder changes restart the app.** Chromium holds the window's session open, so Preferences ▸
Data location copies OWUI's data right away (sidecar stopped), saves `dataDir` plus a
`pendingClientMove` marker, and relaunches without the quit prompt; the next boot — before app `ready`,
before any session exists — moves `lol-client` via a staging folder, clears the marker, removes the old
copy, and tells the user in a toast. A move that fails keeps the marker, opens the window on the
untouched source and retries at the next launch. A DATA_DIR that cannot be written falls back to
`<userData>/lol-client` for that session (toast + a line in Preferences); the first launch after an
upgrade from v0.1.x copies the default session's `IndexedDB`, `Local Storage` and `WebStorage` into
`lol-client` once and leaves the originals as a backup. Every step is logged to
`<userData>/logs/client-data.log`.

## How the OWUI coupling works (the whole contract)

We touch Open WebUI **only** through its public surface (invariant #4): env vars, plus the three
user‑settings API writes (and the auth token/settings reads they need) listed at the end.
`configBridge.buildSidecarEnv()` is the entire env side:

- **Connection** — `OPENAI_API_BASE_URL` (+ a key) point OWUI at the farm's OpenAI‑compatible endpoint.
  `ENABLE_OLLAMA_API=false` so OWUI never talks to Ollama directly.
- **Env stays authoritative** — `ENABLE_PERSISTENT_CONFIG=false`. OWUI's `OPENAI_*` are PersistentConfig
  (env seeds only the first boot, then the DB wins). Turning persistence off means **repointing the farm
  is just a sidecar restart with a new env** — no OWUI edits, no stale persisted URL winning (M1).
- **Data locality** — `DATA_DIR` → a user‑chosen local folder; default local embeddings (we never set
  `RAG_EMBEDDING_ENGINE`, so documents embed in‑process and never leave the device); a stable
  `WEBUI_SECRET_KEY`.
- **Kiosk + privacy** — `WEBUI_AUTH=false` (single‑user, auto‑admin); telemetry fully off;
  `ENABLE_VERSION_UPDATE_CHECK=false` (the app's own updater is the single source of update truth).
- **Adaptive document answers** — `RAG_FULL_CONTEXT=true` when the farm's per-slot context ≥ 24576 (or
  unknown), else top-k retrieval with `RAG_TOP_K=8`; plus `ENABLE_LOCAL_WEB_FETCH=true` and
  `ENABLE_RETRIEVAL_QUERY_GENERATION=false`.
- **Boot + closed LAN** — `RAG_EMBEDDING_MODEL_AUTO_UPDATE=false`: OWUI no longer asks huggingface.co for MiniLM's
  latest revision at every boot, a request with no timeout that cost 21 s a boot where the site is silently blocked.
  `HF_HUB_OFFLINE=1` once MiniLM (in the HF hub cache) and faster-whisper base (under
  `DATA_DIR/cache/whisper/models`, where the pinned OWUI puts it) are both whole on disk (`hfModelState`: the snapshot
  `refs/main` names, every file the loader reads, no dangling link); until then `HF_HUB_ETAG_TIMEOUT=2`. Before each
  start `sidecar.ts` repairs a half or damaged MiniLM (`repairMiniLm`: the hub's file list and dangling links, then
  the snapshots only if it is still half; never the blobs). While MiniLM is not on disk it asks huggingface.co once
  (a 3 s HEAD through Electron's `net.fetch`, so the system proxy applies; no probe behind an env proxy). No answer
  → that launch alone gets `HF_HUB_OFFLINE=1`: the chat opens in ~12 s, and a toast says document uploads need one
  start online.
- **Model preselection + capabilities** — `DEFAULT_MODELS` (the farm's advertised default) and
  `DEFAULT_MODEL_METADATA` (vision on; `web_search` when the farm hosts SearXNG).
- **Farm plugins ride the beacon** — when the farm advertises them: web search (`ENABLE_WEB_SEARCH`, 5
  results, `fetch_url` cut at 12000 characters; `WEB_SEARCH_ENGINE=external` → this app's main at
  `127.0.0.1:41995/web/search` while the MCP listener is up, else `SEARXNG_QUERY_URL` with `SEARXNG_LANGUAGE=auto`),
  neural voice (`AUDIO_TTS_*` → Kokoro), and document OCR
  (`CONTENT_EXTRACTION_ENGINE=external` + `EXTERNAL_DOCUMENT_LOADER_URL/_API_KEY`). Speech‑to‑text is
  always local (`AUDIO_STT_ENGINE=''` → faster‑whisper, `WHISPER_MODEL=base`).
- **Keeping the farm's slot for the user (TTFT)** — OWUI runs *extra* LLM calls around a chat, against
  the same farm endpoint. A farm has **few inference slots** — 2 per box on the default Ollama engine
  (`ollama.numParallel`), 1 on `llama-server` (`llamacpp.parallel`) — so anything in flight makes the
  user's own completion queue behind it. Since
  v0.1.31 we set `ENABLE_FOLLOW_UP_GENERATION=false` and `ENABLE_TAGS_GENERATION=false` (both
  default-ON upstream and fired after *every* response — exactly while the user types the next one),
  and pin `ENABLE_AUTOCOMPLETE_GENERATION=false` so a pin bump can't silently enable per-keystroke
  completions. Title generation stays ON: once per chat, and it's what names chats in the sidebar.
- **Task calls without thinking** — `TASK_MODEL_PARAMS={"chat_template_kwargs":{"enable_thinking":false},"think":false,"max_tokens":1000}`:
  title and web-search-query generation answer without thinking (OWUI 0.11 copies it onto those requests; 0.10.x
  ignores it). Chats are untouched.
- **The Computer as a tool server** — `TOOL_SERVER_CONNECTIONS` (type `mcp`, `http://127.0.0.1:41995/mcp`, the
  per-install bearer) while the Computer's MCP listener holds its port. It is set once at boot, before the first
  spawn, so it never makes a repoint restart OWUI.
- **Branding kept** — we never set `WEBUI_NAME`, so OWUI keeps its own name/branding (invariant #2).
- **Three non‑env exceptions**, all written from the authed webview through OWUI's own supported
  **user‑settings API** (`POST /api/v1/users/user/settings/update`) because none has a working env:
  1. **Web search back to off** — web search is off by default; the globe button turns it on for a
     chat. Clients up to v0.2.7 set `ui.webSearch='always'` once per profile (marked
     `ui.lolWebSearchSeeded`); `unseedWebSearch` switches that back to `null` (what OWUI's own toggle
     writes) **once**, only on a profile carrying that marker whose value is still `'always'`, and
     marks it `ui.lolWebSearchUnseeded` so a person who later picks "always" keeps it. Why off
     (2026‑10‑05): with it on, a chat cost ~2.5× the GPU work and got 1 of 4 fresh facts right.
     Web search v2 (2026‑10‑06: the client's `/web/search` and the date line) costs about the same
     as off (2.33 vs 2.4 generations per message) and got 17/18 fresh facts; it stays off until a
     check with a whole class searching from one school network.
  2. **The opt‑in Blender tool server** — appended to `ui.toolServers` and selected via a
     `direct_server:<idx>` entry in `ui.tools` (an env-configured tool server was unreliable upstream for this local
     helper, issue #18140; the Computer's MCP server, by contrast, is set through `TOOL_SERVER_CONNECTIONS`, above).
     Disabling it also renumbers the other `direct_server:<n>` selections, so a user's own OWUI tool
     servers keep pointing at the right entries.
  3. **The date line** — without it the model believes it is 2025 (it searches for "2025" and calls a
     2026 fact "the future"). `seedDateLine` writes `ui.system` = `Today is {{CURRENT_WEEKDAY}}
     {{CURRENT_DATE}}.` once per profile, only when the person's system prompt is empty, and marks
     `ui.lolDateLineSeeded` either way, so a prompt they wrote or later emptied is never touched. OWUI
     fills both variables at each message (chat requests only; title generation never sees it). No env:
     `DEFAULT_MODEL_PARAMS.system` never reaches a farm model's messages, and 0.11's
     `DEFAULT_INTERFACE_SETTINGS` is missing from 0.10 and comes back when a person empties it.

## Launch time (why OWUI boots once)

Until v0.1.31 a cold launch booted OWUI **twice**: the boot started the sidecar before the first
beacon arrived (so model / SearXNG / TTS / OCR were all `null`), then the first beacon differed from
what we booted with and forced a repoint — which is a full sidecar restart. What fixed it:

- the **farm context is persisted** alongside `lastEndpoint` (`lastFarmModel` / `lastFarmSearxng` /
  `lastFarmTts` / `lastFarmExtract` / `lastFarmCtxPerSlot` / `lastFarmKey`) and seeds the boot, so an
  unchanged farm *confirms* what we started with instead of contradicting it. The auto-connect and a
  pinned card go through the same `connectTo()`. There `farmSelect.ts` `connectPlan` decides two things
  apart: restart OWUI (the context differs from the one it runs) and save (the settings lack this context, password
  included). A boot that found its farm before OWUI started therefore saves it too; until 2026-10-07 it did not, and
  every later launch waited up to 4.5 s for discovery or booted OWUI twice;
- a page OWUI loaded while the farm was not answering lists no model until it is reloaded: `app.js`
  `reloadIfFarmBack` reloads it once when that farm answers (500 ms after the farm list, so a restart about to
  happen goes first);
- `chooseActive()` **stays with last session's farm** at cold boot while it's healthy — the
  load-scatter re-roll used to pick a different box on a multi-farm LAN, guaranteeing a repoint.
  Load-aware spreading still applies to first-ever connects and to failover.

Verifying a change here: watch for `[sidecar] spawning` in the console — a healthy cold launch prints
it **once**, with no `[sidecar] repoint` before it. A packaged client has no console: read
`<userData>/logs/boot.log` (each OWUI state with the seconds since launch — `starting`, `ready`, `restarting` with the
farm, `stopped` or an error; 1 MB, then `.1`). A healthy cold launch shows one `starting` and one `ready`. The
search-model repair and an offline start are not in it (console only).

## Choosing a farm

The pill's popover (**Servers on your network**) lists every farm found. **Clicking a card pins it**:
the client uses that farm whenever it is healthy. The **Automatic — least busy farm** row above the
cards removes the pin. Without a pin the client stays on the farm it is using while it works, picks
last session's farm on a cold boot, and otherwise the least busy healthy farm (coordinators first; load
= clients/slots, else GPU%; ties within 15 points picked at random). The least-busy pick skips a
password-protected farm until its password was entered on its card and verified; entering it does not
pin it. A pinned, current or last-session farm is used anyway, and when a stored password stops working
(the operator rotated it) the client drops it and the card asks again.

A farm seen under two names (its beacon and a hostname or second IP you added) keeps the address it
was first reached at while that address answers, so OWUI is not restarted every time the other name
answers.

## Run it (dev)

Prereqs: the OWUI sidecar venv exists (`sidecar/.venv` — see [`sidecar/`](../sidecar/)) and a farm is
running (`lol up` in [`farm/`](../farm/)), or set `LOL_ENDPOINT`.

```bash
cd shell
npm install
npm run dev          # tsc build + electron .
```

Useful env:
- `LOL_ENDPOINT=http://<farm-ip>:4000/v1` — pin the farm endpoint (overrides LAN discovery; while
  pinned, discovery is informational only).
- `LOL_SIDECAR_CMD=<path>` — override the sidecar executable (e.g. a different venv/binary).
- `LOL_SMOKE_SHOT=<png>` — boot, wait for OWUI, capture the window to a PNG, and quit (smoke test).
  With it: `LOL_SMOKE_WAIT=<ms>` (default 9000) after "ready", `LOL_SMOKE_CLICK=<element id>` (or
  `LOL_SMOKE_POPOVER=1` for the connection popover) before the capture, `LOL_SMOKE_RESIZE=<W>x<H>`,
  and `LOL_SMOKE_TIMEOUT=<ms>` (default 200000) to give up.
- `LOL_RELEASE_REPO=<owner/repo>` — where the sidecar tarball and chat-engine updates are fetched
  (default `b2renger/LlmOnLan`).
- `LOL_MCP_PYTHON=<python>` — the interpreter the Blender tools venv is built from.
- `LOL_FED_GROUP` / `LOL_FED_PORT` / `LOL_FED_HTTP_PORT` — the discovery multicast group, beacon port
  and `/lol/self` port (defaults `239.255.43.10` / `41998` / `41997`).

> **Gotcha:** if your environment has `ELECTRON_RUN_AS_NODE=1`, Electron runs as plain Node and the app
> errors with `Cannot read properties of undefined (reading 'setName')`. Unset it
> (`env -u ELECTRON_RUN_AS_NODE npm run dev`).

## Build

```bash
npm run build        # tsc → build/
npm run dist         # build + electron-builder installers
npm run release:patch|minor|major   # bump + tag + push → CI builds and publishes the release
```

Packaging + auto‑update (electron‑updater; installed apps update themselves from GitHub releases), the
data‑folder + connection Preferences, and LAN discovery are all shipped — see `updater.ts`,
`dataMigration.ts`, and `discovery.ts`.

## Test

Everyday gates, all dependency-free (Node ≥ 22), none of which starts the app or touches a farm
(`test/chat/README.md` has the details and the rules for a box that runs a live farm):

```bash
npm run test:unit                        # app.js capacity helpers (test/unit.js)
node test/chat-unit.js                   # LOL Vibe + Computer suites, and the compiled main process
                                         #   (chat/unit/shell-main.test.mjs — run `npm run build` first)
node test/chat-lint.js                   # static rules for renderer/chat/** (every string via t(), tokens only, …)
node test/chat-scope.js                  # the LOL Vibe branch's change set stays in its allowlist
node test/asar-probe.js                  # ES modules still load from a packed app.asar under the CSP
node test/chat-harness/run.js --slot N   # chat-only Electron over CDP against a NON-beaconing mock-farm.js
```

### Legacy E2E (the real app, a spare box only)

`test/e2e.js` drives the **real** app over the Chrome DevTools Protocol against a fake farm — no GPU, no
dependencies (Node ≥ 22 for the global `WebSocket`). It needs a machine with **no LlmOnLan client
running** (single-instance lock, CDP port 9222) because the mock beacons. Three terminals from `shell/`:

```bash
npm install && npm run build                         # 0. REQUIRED — build/ is gitignored
LOL_MOCK_BEACON_OK=1 node test/mock-farm.js --coordinator   # 1. beacon + endpoint — only on a box with no LlmOnLan client running
LOL_ENDPOINT=http://127.0.0.1:4009/v1 npx electron . --remote-debugging-port=9222   # 2. the app
npm test                                             # 3. assertions (= node test/e2e.js)
```

`npm test` is only step 3 — it drives an app that must already be running. Skip steps 1–2 and it
retries for ~45 s, then fails with
`E2E FAIL: no CDP page target after 45s — is electron running with --remote-debugging-port=9222?`

It asserts the chain a user hits: farm discovered → `/v1/models` fetched (the renderer CSP must allow
the LAN call) → the farm's advertised default preselected → the LOL Vibe toggle opens the surface → a
reply streams to completion with its stats row, fast enough to prove the render path isn't throttling
the stream. (A still-visible connection overlay only prints a warning — the sidecar isn't needed for
these assertions.)

`LOL_ENDPOINT` pins the client to the mock: with real farms on the LAN, the cold-boot stickiness above
beats even a coordinator mock — by design.

Two ways it fails for reasons unrelated to your change: it asserts a **render floor of >150 tok/s**
(the mock streams ~330/s, so a heavily loaded machine can dip under it) and it requires
`reasoning_content` deltas to render. Re-run on an idle machine before believing a red result.
