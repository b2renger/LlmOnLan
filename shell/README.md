# LlmOnLan shell (Electron + TypeScript)

The desktop client. It supervises a bundled, **unmodified** Open WebUI sidecar, points it at the
discovered LAN farm through OWUI's public config surface, keeps all data on the machine, and wraps
it in ComfyQ‑styled chrome (topbar · connection screen · preferences).

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
  store.ts        shell settings (JSON in userData)
  paths.ts        resolve the sidecar exe (dev venv vs packaged) + default DATA_DIR
  util.ts         free-port, tree-kill, http GET/health-poll
  types.ts        shared types + the renderer IPC contract
src/preload/index.ts            contextBridge `window.lol` API (no Node in the renderer)
renderer/                       static — topbar + <webview> + connection overlay
  index.html  tokens.css  styles.css  app.js
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
- **Branding kept** — we never set `WEBUI_NAME`, so OWUI keeps its own name/branding (invariant #2).
- **The one non‑env exception** — the opt‑in Blender tool server can't ride env
  (`TOOL_SERVER_CONNECTIONS` is unsupported upstream); the renderer registers it through OWUI's own
  API (`POST /api/v1/configs/tool_servers`) from the authed webview.

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
