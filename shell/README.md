# LlmOnLan shell (Electron + TypeScript)

The desktop client. It supervises a bundled, **unmodified** Open WebUI sidecar, points it at the
discovered LAN farm through OWUI's public config surface, keeps all data on the machine, and wraps
it in ComfyQ‑styled chrome (topbar · connection screen · preferences).

The main area has **two surfaces**, switched by a topbar toggle: **Open WebUI** (the product — RAG,
documents, web search, voice, history) and **LOL Chat** (`renderer/chat.js`) — a minimal chat that
talks *straight* to the farm's OpenAI endpoint, with per-message tok/s and TTFT. LOL Chat has no RAG,
no uploads, no tools, and keeps its conversations in `localStorage`; it exists to compare a
Studio-style UX against OWUI on the same backend. Which surface ships is one constant —
`src/main/clientMode.ts` `OWUI_ENABLED` (with a matching `NO_OWUI` in `renderer/app.js`) — so an
OWUI-free build is a boolean flip, not a fork.

## Architecture

```
src/main/                       (TypeScript → build/ via tsc; Electron main process)
  index.ts        boot: window + IPC + orchestrates sidecar/discovery; presence heartbeat
                  (every 10 s POST /lol/client-ping to the active farm: id/host/version/idleSec)
  sidecar.ts      SidecarSupervisor — spawn/health-wait/restart/repoint/stop OWUI
  configBridge.ts the ONLY module that knows OWUI's config surface (env vars)
  discovery.ts    LAN farm discovery — UDP beacon listener + subnet scan + manual peers
  sidecarManager.ts first-run download + staged update of the OWUI sidecar tarball
  updater.ts      app self-update (electron-updater, GitHub releases)
  mcpoSupervisor.ts opt-in local Blender assistant-tools server (mcpo)
  dataMigration.ts move the OWUI data folder between locations
  clientMode.ts   which surface this build ships (OWUI_ENABLED) — gates the whole sidecar lifecycle
  store.ts        shell settings (JSON in userData) — incl. the last farm context, which seeds the
                  next cold boot so OWUI starts ONCE (see "Launch time" below)
  paths.ts        resolve the sidecar exe (dev venv vs packaged) + default DATA_DIR
  util.ts         free-port, tree-kill, http GET/health-poll
  types.ts        shared types + the renderer IPC contract
src/preload/index.ts            contextBridge `window.lol` API (no Node in the renderer)
renderer/                       static — topbar + <webview> + connection overlay
  index.html  tokens.css  styles.css  app.js
  chat.js                       LOL Chat — the alternative, farm-direct chat surface
test/                           dependency-free E2E: mock-farm.js (beacon + streaming endpoint)
                                + e2e.js (drives the real app over CDP) — see "Test" below
assets/                         icon.svg / icon.png
```

The renderer is intentionally thin: chrome + the `<webview>` of `http://127.0.0.1:<port>` (the local
OWUI) + the settings UI. Everything stateful lives in the main process.

## How the OWUI coupling works (the whole contract)

We touch Open WebUI **only** through env vars (invariant #4). `configBridge.buildSidecarEnv()` is the
entire coupling:

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
- **Whole‑document answers** — `RAG_FULL_CONTEXT=true`: attached documents are injected whole instead of
  top‑k chunks (the farm serves a matching context window via `ollama.contextLength`).
- **Model preselection + capabilities** — `DEFAULT_MODELS` (the farm's advertised default) and
  `DEFAULT_MODEL_METADATA` (vision on; `web_search` when the farm hosts SearXNG).
- **Farm plugins ride the beacon** — when the farm advertises them: web search
  (`ENABLE_WEB_SEARCH`/`SEARXNG_QUERY_URL`), neural voice (`AUDIO_TTS_*` → Kokoro), and document OCR
  (`CONTENT_EXTRACTION_ENGINE=external` + `EXTERNAL_DOCUMENT_LOADER_URL/_API_KEY`). Speech‑to‑text is
  always local (`AUDIO_STT_ENGINE=''` → faster‑whisper, `WHISPER_MODEL=base`).
- **Keeping the farm's slot for the user (TTFT)** — OWUI runs *extra* LLM calls around a chat, against
  the same farm endpoint. The farm's `llama-server` has **one inference slot** by default
  (`llamacpp.parallel`), so anything in flight makes the user's own completion queue behind it. Since
  v0.1.31 we set `ENABLE_FOLLOW_UP_GENERATION=false` and `ENABLE_TAGS_GENERATION=false` (both
  default-ON upstream and fired after *every* response — exactly while the user types the next one),
  and pin `ENABLE_AUTOCOMPLETE_GENERATION=false` so a pin bump can't silently enable per-keystroke
  completions. Title generation stays ON: once per chat, and it's what names chats in the sidebar.
- **Branding kept** — we never set `WEBUI_NAME`, so OWUI keeps its own name/branding (invariant #2).
- **Two non‑env exceptions**, both written from the authed webview through OWUI's own supported
  **user‑settings API** (`POST /api/v1/users/user/settings/update`) because neither has a working env:
  1. **Web search defaulted ON** — `ui.webSearch='always'` (there is no env for OWUI's per‑user
     interface setting). Written **once**, guarded by a `ui.lolWebSearchSeeded` marker so a user who
     turns it back off keeps it off, and only when the farm actually advertises a SearXNG.
     Consequence worth knowing: while on, **every message** runs a search + page fetch + local embed.
  2. **The opt‑in Blender tool server** — appended to `ui.toolServers` and selected via a
     `direct_server:<idx>` entry in `ui.tools` (`TOOL_SERVER_CONNECTIONS` is unsupported upstream).
     Disabling it also renumbers the other `direct_server:<n>` selections, so a user's own OWUI tool
     servers keep pointing at the right entries.

## Launch time (why OWUI boots once)

Until v0.1.31 a cold launch booted OWUI **twice**: the boot started the sidecar before the first
beacon arrived (so model / SearXNG / TTS / OCR were all `null`), then the first beacon differed from
what we booted with and forced a repoint — which is a full sidecar restart. Two things fixed it:

- the **farm context is persisted** alongside `lastEndpoint` (`lastFarmModel` / `lastFarmSearxng` /
  `lastFarmTts` / `lastFarmExtract`) and seeds the boot, so an unchanged farm *confirms* what we
  started with instead of contradicting it;
- `chooseActive()` **stays with last session's farm** at cold boot while it's healthy — the
  load-scatter re-roll used to pick a different box on a multi-farm LAN, guaranteeing a repoint.
  Load-aware spreading still applies to first-ever connects and to failover.

Verifying a change here: watch for `[sidecar] spawning` in the console — a healthy cold launch prints
it **once**, with no `[sidecar] repoint` before it.

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

## Test (E2E against a mock farm)

`test/` drives the **real** app over the Chrome DevTools Protocol against a fake farm — no GPU, no
dependencies (Node ≥ 22 for the global `WebSocket`). Three terminals from `shell/`:

```bash
npm install && npm run build                         # 0. REQUIRED — build/ is gitignored
node test/mock-farm.js --coordinator                 # 1. UDP beacon + OpenAI streaming endpoint
LOL_ENDPOINT=http://127.0.0.1:4009/v1 npx electron . --remote-debugging-port=9222   # 2. the app
npm test                                             # 3. assertions (= node test/e2e.js)
```

`npm test` is only step 3 — it drives an app that must already be running. Skip steps 1–2 and it
retries for ~45 s, then fails with
`E2E FAIL: no CDP page target after 45s — is electron running with --remote-debugging-port=9222?`

It asserts the chain a user hits: farm discovered → `/v1/models` fetched (the renderer CSP must allow
the LAN call) → the farm's advertised default preselected → the LOL Chat toggle opens the surface → a
reply streams to completion with its stats row, fast enough to prove the render path isn't throttling
the stream. (A still-visible connection overlay only prints a warning — the sidecar isn't needed for
these assertions.)

`LOL_ENDPOINT` pins the client to the mock: with real farms on the LAN, the cold-boot stickiness above
beats even a coordinator mock — by design.

Two ways it fails for reasons unrelated to your change: it asserts a **render floor of >150 tok/s**
(the mock streams ~330/s, so a heavily loaded machine can dip under it) and it requires
`reasoning_content` deltas to render. Re-run on an idle machine before believing a red result.
