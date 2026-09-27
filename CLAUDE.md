# CLAUDE.md — LlmOnLan (LOL)

> **LlmOnLan** (short: **LOL**) is a desktop client + a LAN inference farm. The client
> bundles a **pinned, unmodified Open WebUI** and auto‑connects to the farm so a person on
> the office Wi‑Fi can chat with a local model with zero setup. All data stays on the user's
> machine.
>
> We do **not** hide that the chat UI is Open WebUI. The window chrome is LOL‑branded; the
> Open WebUI surface inside keeps its own name and branding. Think "LlmOnLan, powered by
> Open WebUI." The shell's own surfaces (topbar, settings, connection screen) follow
> **ComfyQ's visual language** for a consistent feel across the two tools.
>
> Reference project (visual + Electron/auto‑update conventions): https://github.com/b2renger/ComfyQ

---

## Build status (2026-09-27) — released: client `v0.1.45` · Farm app `farm-v0.0.38` · OWUI `0.10.2`

> `main` is ahead of both tags: LOL Chat vNext, the Computer and the 2026-09-27 review fixes (client and
> farm) are merged but unreleased until the next `v*` / `farm-v*` tag. The bullets below describe `main`.

The full plan is built, released and in multi-user testing; the dated build log with how
each piece was tested lives in [docs/DEVLOG.md](docs/DEVLOG.md), the rig‑verification state in
[docs/RIG_CHECKLIST.md](docs/RIG_CHECKLIST.md) (LOL Chat and the Computer: [docs/LOLCHAT_RIG_CHECKLIST.md](docs/LOLCHAT_RIG_CHECKLIST.md)),
and the version‑specific integration facts in [docs/INTEGRATION_BRIEF.md](docs/INTEGRATION_BRIEF.md)
(a dated snapshot — the pin has since moved). The last full consistency pass (code ↔ in‑app text ↔ these
docs) is `docs/reviews/DOCS_REVIEW_2026-09-27_{FARM,SHELL,COMPUTER}.md`. Snapshot:

- **`farm/`** — the `lol` CLI (verified end-to-end: `lol up` → real `/v1/chat/completions`; status/down;
  beacon + `/lol/self`). **Three engines behind one LiteLLM endpoint, exactly one serving at a time**
  (owner decisions 2026-08-26/27, 09-07):
  - **Ollama — the default.** Serves the `models` catalog, default **`gemma4:12b`** (vision-native, also the
    OCR model; its sliding-window attention holds its native 262144 context in ~10 GB). `ollama.contextLength:
    'auto'` MEASURES the largest `num_ctx` that stays fully in VRAM: loads the default at 16k and 32k, takes
    the per-token slope from `/api/ps`, aims at min(model native max, VRAM − max(1 GB, 8%)) and verifies with one more
    load (one halving then 16k if that spills; 8k/4k if even 16k spills). The verdict caches per (model, VRAM,
    numParallel, kvCacheType). Per-arch KV math is deliberately NOT used (Gemma's sliding window makes it
    wildly over-estimate). It is applied as per-deployment `num_ctx` in the generated routing (+ the
    `OLLAMA_CONTEXT_LENGTH` seed). `kvCacheType` q8_0 and `numParallel` 2 only apply to an Ollama the farm
    starts; otherwise the panel flags capacity as unverified. Routed `keep_alive` MUST be a number — the
    string `'-1'` is refused by Ollama (`time: missing unit in duration`), hence `keepAliveValue()`.
  - **llama.cpp — opt-in (`llamacpp.enabled`), the speed pick.** `llama-server` build **b10670** serves ONE
    `.gguf` (`llamacpp.model`, default Unsloth Qwen3.8-27B-UD-IQ2_S) as `llamacpp.alias` (`assistant`).
    `contextLength: 'auto'` = min(native max, VRAM budget), both read from the real files (`gguf.js`).
    `kvUnified` (default true) = one KV pool shared by the `parallel` slots: a person alone gets the whole
    window, and `backend.contextPerSlot` advertises the ctx ÷ slots floor (`kvUnified:false` = the hard
    split, `--ctx-size 16384 --parallel 2` → 8192 each). `mtp` defaults false (Unsloth strips the MTP head
    below UD-Q2_K_XL and llama-server then refuses to start). Prebuilts: win-x64 (ggml-org, CUDA) and
    linux-arm64/DGX Spark (our `build-llamacpp-arm64.yml` → the `llamacpp-<build>` prerelease, fetched by
    `assetsFor()`); anywhere else set `llamacpp.binDir`. If it cannot start (no prebuilt, a failed download
    or load) `lol up` **falls back to Ollama for that run with the reason on the panel** instead of exiting;
    a crash mid-run gets one restart, a second within 5 min falls back too. While llama.cpp serves, NO local
    Ollama deployment is routed or advertised — the catalog is standby inventory (and the OCR vision model,
    which talks raw Ollama).
  - **external — opt-in, config file only (2026-09-07).** Routes to an OpenAI-compatible server the operator
    runs (vLLM/SGLang/TensorRT-LLM) for stacks we can never bundle; outranks llama.cpp. The farm NEVER
    installs/starts/restarts it. Health = `GET {baseUrl}/models`: unreachable at boot → fallback; dies later →
    the farm goes unhealthy and clients fail over. `contextLength`/`parallel` are operator DECLARATIONS (no
    portable endpoint reports them); they size the client RAG gate and the seats. While it serves, the panel's
    engine, capacity and context controls stand down; the Ollama catalog stays editable as standby edits.
  - A name the operator GAVE the served model (per-model Rename, `modelAlias`, `llamacpp.alias`) survives an
    engine switch and a fallback (`carryNameAcross`, `engineFallback`), so bound chats keep working. An
    unnamed default is served under its raw id on Ollama (`gemma4:12b`) and as `llamacpp.alias` on llama.cpp,
    so chats bound to it re-pick after a switch; non-default catalog models are never served under llama.cpp.
  - **Seat gate** (2026-09-04, `proxy.seatGate` default true): the public `proxy.port` is the farm's own
    streaming listener (`seats.js`) with LiteLLM on `127.0.0.1:proxy.internalPort` (default port+1). An IP's
    completions claim/refresh a seat (capacity = the serving engine's slots); a seat idle `proxy.seatIdleSec`
    (900 s) frees; a generation on a full farm gets an explicit 429 `lol_seats_full` instead of queueing
    behind idlers.
  - `proxy.masterKey` = the shared **farm password** (LiteLLM `master_key`; panel-settable; clients prompt
    once, verify, remember per farm). Discovery, `/health/liveliness` and the admin token stay separate.
  - **Admin panel** at `http://<box>:41997/lol/admin` (bearer = `admin.token`, or a per-run token printed by
    `lol up`; the Farm app pins one): the engine switch (llama.cpp ↔ Ollama); the `.gguf` library (add by
    URL — split files too — / Use this, with rollback); the name users see (llama.cpp) or per-model
    **Rename** (Ollama); people served at once, the context window (Automatic on both engines) and the farm
    password under ONE **Apply changes** (one restart); Ollama download/offer/stop/delete/Make default;
    plugin toggles and the Blender fleet recommendation; a Performance card (llama.cpp) and the clients with
    their seats. Long operations run as one job whose progress the panel polls. Everything persists to
    `lol.config.json` (`configFile.js` raw patch — never the schema-parsed config) **except** the plugin
    toggles and the Blender recommendation; Ollama's slot count applies after a farm restart.
  - **Plugins** (`plugins/registry.js`): web search (SearXNG, ON), document OCR (`farm/src/pysvc` +
    `extract.js`, ON — hybrid text/vision PDF extraction), Kokoro TTS (OFF). They bind to `proxy.host`.
  - Also: beacon group **`239.255.43.10:41998`** (+ httpPort `41997`), distinct from ComfyQ; coordinator mode;
    `lol fleet`/`lol bench`; `modelAlias` + the interactive picker in `lol up`; `lol install` (Ollama, the
    LiteLLM venv, `models` + `preinstall` — ships a ~8.6 GB staged Qwen3.8-27B — the SearXNG/OCR venvs, and
    the llama.cpp build + weights only when enabled). The farm's advertised `version` is the Farm app's
    (`LOL_FARM_VERSION`), falling back to `farm/package.json`.
- **`shell/`** (Electron + TS, **v0.1.45**) — boots the **unmodified** OWUI sidecar (config-bridge =
  env-authoritative, `ENABLE_PERSISTENT_CONFIG=false`), discovers the farm and auto-connects with **no
  URL typed**, full Preferences (data folder + move/fresh migration, connection, assistant tools,
  startup/updates, about). **Adaptive RAG**: whole-document injection (`RAG_FULL_CONTEXT=true`) on farms
  advertising `backend.contextPerSlot ≥ 24576` (or not advertising it), classic top-k (`RAG_TOP_K=8`) below —
  so a 16k farm can't context-overflow on an attachment; presence heartbeats to the farm (`POST
  /lol/client-ping` every 10 s: id/hostname/platform/version/idleSec); Blender/mcpo assistant tools are
  **opt-in** (off by default since v0.1.24; a farm recommendation can enable them for non-explicit users).
  **Three surfaces**, picked by the topbar's segmented control (Open WebUI · LOL Chat · Computer; the last
  choice is remembered in `localStorage['lol:view']`): OWUI; **LOL Chat** (`renderer/chat/main.mjs` + modules
  in `app/ core/ ctx/ net/ render/ state/ ui/ strings/ css/` — farm-direct, tok/s + TTFT per reply, a message
  tree, seat-aware sending, a context meter; history in the renderer's IndexedDB `lol-chat` v2 with a one-way
  import of the v1 `localStorage` history; no RAG, uploads or tools — those P3/P4 plans are NOT BUILT); and
  the **Computer** (next bullet). Whether OWUI ships is `src/main/clientMode.ts` `OWUI_ENABLED` + the
  renderer's `NO_OWUI` (flip both; a no-OWUI build hides the Open WebUI button).
  **All of the client's data is in DATA_DIR** (owner rule 2026-09-27): the main window runs on
  `session.fromPath(<DATA_DIR>/lol-client)` (`src/main/clientData.ts`), so LOL Chat's IndexedDB + the
  window's localStorage live there, next to OWUI's data. Before app `ready` the boot applies a pending
  Preferences move, falls back to `<userData>/lol-client` (with a toast) when the DATA_DIR cannot be
  written, and imports a v0.1.x profile ONCE from the default session under userData (left there as a
  backup; `legacyClientDataImported`). The OWUI `<webview>` keeps `persist:owui` (`userData/Partitions/owui`
  — only its token and caches).
  Perf invariants worth keeping: the renderer CSP MUST carry `connect-src 'self' http: https:` (else LOL
  Chat and the Computer cannot reach the LAN farm at all); the whole farm context (endpoint, password,
  model, SearXNG, TTS, OCR, ctx/slot) is persisted so a cold launch spawns the sidecar **once**; OWUI's
  follow-up/tags/autocomplete generation is disabled so background calls can't queue ahead of the user on
  llama-server's single slot. **Boot time** (the OWUI boot is ~10 s warm, dominated by OWUI's own Python
  import chain — untouchable): `repoint` restarts ONLY when the effective launch env differs (not when an
  input differs), `sidecarManager` precompiles the freshly-unpacked tree to bytecode in the background (a
  fresh install otherwise pays parse+compile for ~27k files on first launch), `HF_HUB_OFFLINE=1` when MiniLM
  (HF cache) + whisper-base (OWUI 0.10.2 keeps it under `DATA_DIR/cache/whisper/models`) are cached (OWUI
  otherwise asks huggingface.co on every boot — a hang on a closed LAN; `HF_HUB_ETAG_TIMEOUT=2` until then),
  and health polling at 300 ms.
  **Close means close** (owner decisions 2026-09-04 + 2026-09-10, replacing the keep-warm/tray behavior of
  v0.1.x–v0.1.43): the window's X asks "Quit LlmOnLan?" (Quit/Cancel), then quits EVERYTHING on all
  platforms (mac included — deliberate convention break); cleanup gets 4 s, then the app exits regardless.
  "Restart & install" and the chat-engine relaunch skip the prompt. A hidden-but-warm client kept
  heartbeating the farm and held a seat while nobody used it; reopening pays the OWUI boot again —
  accepted cost.
  **Tests** (`shell/test/`, see `test/chat/README.md`): `npm run test:unit` (app.js capacity helpers);
  `node test/chat-unit.js` (LOL Chat + Computer unit suites); `chat-lint.js` + `chat-scope.js` (static and
  scope gates); `asar-probe.js`; `node test/chat-harness/run.js [--slot n] [--phase p]` (a chat-only
  Electron driven over CDP against a NON-beaconing `mock-farm.js`; `--phase perf` = the perf budgets). The
  legacy `npm test` = `e2e.js` drives the real app against a beaconing mock — a spare box only (Electron's
  single-instance lock and the owner's real DATA_DIR make it unsafe on a box with a client open).
- **The Computer** (third client surface, `shell/renderer/chat/{computer,graph,sandbox}/`) — a node-graph
  canvas where boxes wired by **named arrows** make a small program, kept in a library of graphs. Boxes:
  Text, Image, Document, Sound, File (*bring*); Instruction (+ "Write a p5.js/three.js/SVG/HTML" presets),
  Split, Filter, Collect, Repeat (*think*); Preview (+ p5.js/three.js/SVG/HTML/Markdown presets) and Code
  (*show*); Button, Condition, Confirm, Dialog, Toggle, Timer (*control*); Sticky, Section, Title
  (*annotate*). Thinking boxes ask the farm **directly** (never through OWUI) on the background lane: one
  request in flight, they yield to a person's chat, and a hidden window sends nothing. Every run is bounded by
  `RUN_LIMITS` (`core/types.mjs`): 8 passes per box, 50 generations (the toolbar **Cap**), 10 min of wall
  clock including waits, 2000 activations; a loop is legal only through a gate box (`topo.mjs`
  `GATE_TYPES`). Code/p5/three/HTML run in ONE opaque-origin sandbox iframe (`sandbox/runner.html`,
  `allow-scripts` only, no network, vendored three r160 / p5; `sandbox/host.mjs` is the only iframe maker)
  plus at most one **Live** guest that gets the mouse and keys (`lol.orbit(camera)` is the first-party
  camera control); a Preview box's **Edit code** opens a drawer editor. View tools: Select (V) · Hand (H) · − % + Fit,
  answering from anywhere on the Computer, never while typing. What leaves the machine: prompt text and an
  Image's pixels inside the Instruction's chat completion to the farm; a Document's PDF bytes to the farm
  OCR for text only; a Sound is never sent; a **Fetch** box (2026-09-27) sends ONE GET to the address a person
  typed — run in main (): http(s), never loopback/link-local/farm ports, ≤ 1 MB text, keeps
  its last copy offline. Where data lives: all of it in DATA_DIR — graphs and their
  files in the renderer's IndexedDB (`lol-chat` → `graphs`, `attachments`), which is the main window's
  session at `<DATA_DIR>/lol-client`, and File-box outputs in `<DATA_DIR>/LOL Studio Projects/` (one
  project per graph); a data-folder move carries both. The opt-in **Record log** writes `%APPDATA%\LlmOnLan\logs\computer\*.jsonl`
  (25 MB per file; 15 recordings kept + up to 30 with a marked bug; keys redacted; `src/main/debugLog.ts`,
  [docs/COMPUTER_DEBUG_LOG.md](docs/COMPUTER_DEBUG_LOG.md)). Learn shelf: the tour, lessons 1–4 and 2
  templates. Not built: the resume-after-close banner, lessons 5–12. Docs: [the user tutorial](docs/LOLCHAT_COMPUTER_TUTORIAL.md),
  [status](docs/COMPUTER_STATUS.md), [plan](docs/COMPUTER_PLAN.md), [live plan](docs/COMPUTER_LIVE_PLAN.md).
- **`sidecar/`** — `build-sidecar` bundles a relocatable standalone CPython 3.12 + OWUI + `launcher.py`;
  `OPENWEBUI_VERSION` is the pin (**OWUI `0.10.2`**, Python 3.11/3.12). A packaged client runs
  `<userData>/sidecar/python launcher.py serve`; dev uses `sidecar/.venv`'s `open-webui serve`. NOT bundled
  into the installer — CI publishes it as `owui-sidecar-<platform>-<arch>.tar.gz` release assets and the
  packaged shell downloads it to `userData/sidecar` on first run (`sidecarManager.ts`); About ▸ "Check for
  chat-engine update" stages a newer one, applied on relaunch.
- **packaging** — electron-builder + electron-updater + a GitHub Actions release matrix; live
  auto-update verified across releases (v0.1.x series). Installers: windows-x64, mac-arm64 + mac-x64 (Intel,
  macOS 14+; the darwin-x64 sidecar substitutes onnxruntime 1.23.2), linux-x64 + linux-arm64; one
  `owui-sidecar-<platform>-<arch>.tar.gz` per platform.
- **health (M6)** — the farm advertises `host` (GPU/VRAM/RAM/cores) + `usage` (live GPU util/VRAM +
  connected clients) in the snapshot; `lol status`, the admin panel and the shell's farm cards show it.

**Verified on the live stack (single box, 2026-06-30):** a **full chat through the OWUI UI** (Playwright →
streamed gemma4 reply); **document‑locality** (a doc embedded into the local Chroma with **zero
`/v1/embeddings`** to the farm); **load‑balancing + transparent failover** across two Ollama hosts
(killing one → 10/10 completions still succeed, after tuning the router).

**Still needs real two‑machine / installer verification** (see [docs/RIG_CHECKLIST.md](docs/RIG_CHECKLIST.md)):
discovery across *physical* boxes / broadcast‑blocked Wi‑Fi, the full installer build + a live
GitHub‑Release auto‑update cycle on mac/win/linux (the upgrade test), the data‑folder move via the
native dialog, and the v0.1.45 → v0.2.0 upgrade of a profile with LOL Chat history (the one-time import
into `DATA_DIR/lol-client`, then a Preferences move + relaunch). When working here, keep honoring the **prime directive** below.

---

## What we are building (four pieces)

1. **`lol` — the farm CLI** (Node, npm‑style). Run on each GPU box (or one box). Reads a
   declarative `lol.config.json`, brings up the serving engine (Ollama by default; llama.cpp or an
   operator-run external server opt-in), generates and runs a LiteLLM proxy behind the farm's seat gate
   (one OpenAI‑compatible endpoint, load‑balanced across boxes), hosts the shared plugins and the admin
   panel, and runs a **UDP discovery beacon** (+ unicast `/lol/self`) so clients find the farm
   automatically. This is where models are chosen.
2. **The client shell** (Electron + TypeScript). Supervises a bundled, unmodified Open WebUI
   sidecar, discovers the farm on the LAN, points Open WebUI at it, and stores all data locally
   (OWUI's under a user‑chosen folder). Owns the topbar, settings/preferences, the connection overlay,
   and two first-party surfaces beside OWUI: **LOL Chat** and **the Computer**.
3. **Open WebUI** — vendored, version‑pinned, **unmodified**. We inherit all its features.
4. **The Farm app** (`farm-app/`, Electron) — the operator-facing sibling of the client: a first-run
   wizard downloads its own Python + Ollama, copies the farm code to `userData/farm`, pulls `gemma4:12b`,
   runs `lol install` (venvs + the staged preinstall model), then supervises `lol up --no-pick` and shows
   the admin panel as its window (token auto-seeded) — which is where the model, its name and the capacity
   are run. **Private by default** (`proxy.host` 127.0.0.1, beacon off) until Settings ▸ Share compute.
   Its Settings drawer holds only app-level things (share-with-LAN → `proxy.host`/`beacon.enabled`, theme,
   launch-at-login, update notifications + Check for updates, the panel access token, logs folder); it
   deliberately never re-applies model settings at boot, which used to overwrite the panel's.
   Released on `farm-v*` tags as GitHub prereleases (Windows x64, macOS arm64, Linux arm64 AppImage). No
   electron-updater: the app looks for a newer `farm-v*` release (at launch when enabled, or on demand) and
   opens its download page; **installing is manual**.

End‑user experience: install one app → open it → chatting in seconds. No URL, no account
ceremony, no Docker.

---

## Prime directive (non‑negotiable invariants)

If a task seems to require breaking one of these, **stop and flag it**.

1. **Open WebUI is vendored, version‑pinned, and UNMODIFIED.** Never edit, patch, or fork its
   source. It is fetched at build time at a pin and bundled as an opaque artifact. **Zero
   Open WebUI source diffs in this repo, ever.**
2. **We keep Open WebUI's branding/attribution.** No logo swap, no `WEBUI_NAME` that hides it.
   This is the explicit product choice *and* a license convenience: the v0.6.6+ branding clause
   only constrains deployments over **50 aggregate users / 30 days**; keeping branding means no
   constraint and no enterprise license at any scale. (https://docs.openwebui.com/license/)
3. **All persistent data stays on the client machine** — under a local `DATA_DIR` the user chooses:
   OWUI's chats, folders, knowledge bases, documents and RAG vectors, LOL Chat's history, and the
   Computer's graphs, media and projects. The farm is stateless and stores nothing.
4. **We touch Open WebUI ONLY through its public config surface** (env vars + admin REST API). If
   a behavior needs Open WebUI internals, we don't build it.
5. **Upgrading Open WebUI is a version bump, not a merge.** Bump one pin → rebuild the sidecar →
   run smoke tests. **No LOL code changes.** If an upgrade forces a code change in our shell,
   that's a separation defect to redesign, not absorb.

> **Open wording question for the owner (2026-09-27 review; invariant #4 is left verbatim):**
> - #4 says "admin REST API". The only shipped REST writes use OWUI's **user-settings** API, plus two
>   auth/config reads. The admin API is never used.

---

## The integration contract (the entire OWUI coupling)

| Direction | Mechanism | Notes |
|---|---|---|
| Lifecycle | Shell spawns the OWUI sidecar as a child process and supervises it. | Shell = process manager + window. |
| Config → OWUI | Env vars at **every** launch, made authoritative by `ENABLE_PERSISTENT_CONFIG=false` — repointing the farm restarts the sidecar with new env. **Two exceptions**, both written from the authed webview via OWUI's user‑settings API `POST /api/v1/users/user/settings/update`: web search defaulted ON (`ui.webSearch='always'`, one‑time via a `lolWebSearchSeeded` marker) and the opt‑in Blender tool server (`ui.toolServers` + `ui.tools`). Neither has a usable env. | See gotchas below. |
| Data | `DATA_DIR` → the user's chosen local folder; default local embeddings; telemetry off. | Enforces invariant #3. |
| Net out of OWUI | Chat completions to the farm endpoint; plus, when the farm advertises them: SearXNG queries (then direct page fetches), Kokoro TTS requests, and uploaded‑file bytes to the farm OCR extractor. | Embeddings always stay local. |
| Webview | The renderer reads the OWUI origin's `localStorage.token`, validates it with `GET /api/v1/auths/` (drop + reload, ≤4 tries) before revealing the webview, and reads `/api/config` before seeding web search; the `persist:owui` partition is granted mic/camera/clipboard only. | `renderer/app.js`, `src/main/index.ts`. |
| Everything else | None. OWUI is a black box. | No DB poking, no template/CSS edits, no internal imports. |

### Verified OWUI config surface (re‑verify per pinned version; authoritative list = `shell/src/main/configBridge.ts`)

Connection: `OPENAI_API_BASE_URL` + `OPENAI_API_KEY` (the farm is OpenAI‑compatible via LiteLLM;
`ENABLE_OLLAMA_API=false` so OWUI never talks to Ollama directly). The exact env the shell sets
(values from `configBridge.ts`):

- **Always:** `DATA_DIR`=<chosen, default `<userData>/owui-data`> · `WEBUI_SECRET_KEY`=<hex generated once
  into `<userData>/.webui-secret-key`> · `WEBUI_AUTH=false` · `ENABLE_PERSISTENT_CONFIG=false` ·
  `ENABLE_VERSION_UPDATE_CHECK=false` · `ENABLE_OLLAMA_API=false` · `RAG_FULL_CONTEXT` (**adaptive**:
  `'true'` — whole‑document answers — when the farm's `backend.contextPerSlot` ≥ 24576 or is not advertised,
  else `'false'`; full injection produced hard ContextWindowExceededErrors on small‑context farms) ·
  `RAG_TOP_K=8` (always set; read only in retrieval mode) · `ENABLE_LOCAL_WEB_FETCH=true` (OWUI's SSRF guard
  otherwise refuses attaching any LAN/intranet page — matrix‑verified) · `ENABLE_RETRIEVAL_QUERY_GENERATION=false`
  (with files attached OWUI otherwise runs a hidden extra LLM call whose output full‑context mode never uses;
  `ENABLE_SEARCH_QUERY_GENERATION` stays on) · `DEFAULT_MODEL_METADATA={"capabilities":{"vision":true}}`
  (+ `"web_search":true` with a farm SearXNG) · `AUDIO_STT_ENGINE=''` + `WHISPER_MODEL=base` (local STT) ·
  `AUDIO_TTS_ENGINE=''` · the **TTFT trio** `ENABLE_FOLLOW_UP_GENERATION`/`ENABLE_TAGS_GENERATION`/
  `ENABLE_AUTOCOMPLETE_GENERATION` = `false` (OWUI's background calls would otherwise queue ahead of the user
  on llama‑server's single slot; title generation stays ON) · `DEFAULT_LOCALE=en-US` (+ Chromium
  `--lang en-US`) · `ANONYMIZED_TELEMETRY=false` · `DO_NOT_TRACK=true` · `SCARF_NO_ANALYTICS=true` ·
  `HF_HUB_OFFLINE=1` when the models test as cached, else `HF_HUB_ETAG_TIMEOUT=2`.
- **With a farm:** `ENABLE_OPENAI_API=true` · `OPENAI_API_BASE_URL=http://<host we reached it at>:<proxyPort>/v1`
  · `OPENAI_API_KEY`=<farm password> or `sk-lol-lan` · `DEFAULT_MODELS`=<the farm's default id, when listed>.
  **Without:** `ENABLE_OPENAI_API=false` (a no‑farm boot must not fall back to api.openai.com).
- **SearXNG** (when advertised): `ENABLE_WEB_SEARCH=true` · `WEB_SEARCH_ENGINE=searxng` ·
  `SEARXNG_QUERY_URL=<url>/search?q=<query>` · `WEB_SEARCH_RESULT_COUNT=3` · `WEB_SEARCH_CONCURRENT_REQUESTS=10`.
- **Kokoro** (when advertised): `AUDIO_TTS_ENGINE=openai` · `AUDIO_TTS_OPENAI_API_BASE_URL=<ttsUrl>` ·
  `AUDIO_TTS_OPENAI_API_KEY=sk-lol-tts` · `AUDIO_TTS_MODEL=<ttsModel|kokoro>` · `AUDIO_TTS_VOICE=<ttsVoice|af_heart>`.
- **OCR** (when advertised): `CONTENT_EXTRACTION_ENGINE=external` · `EXTERNAL_DOCUMENT_LOADER_URL=<extract.url>`
  · `EXTERNAL_DOCUMENT_LOADER_API_KEY=<extract.key>`.
- The supervisor adds `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8` and otherwise inherits the shell's environment.

- **Gotcha #1 — persisted URLs beat env.** Connection URLs saved via the admin UI go to OWUI's DB
  and **take precedence over env on later starts.** The shipped strategy: `ENABLE_PERSISTENT_CONFIG=false`
  — env is authoritative on **every** launch, so repointing the farm is just a sidecar restart with new
  env, and no stale persisted URL can win. (OWUI's admin REST API is deliberately NOT used — it's
  session‑only while persistence is off. The two shipped writes both go to the user‑settings API
  `POST /api/v1/users/user/settings/update` from the authed webview: the one‑time web‑search default and
  the opt‑in Blender tool server.) Ref: https://docs.openwebui.com/reference/env-configuration/
- **Gotcha #2 — JSON config env.** `OPENAI_API_CONFIGS`/`OLLAMA_API_CONFIGS` historically weren't
  parsed from env at startup (open‑webui#19017). Use the simple `*_BASE_URL(S)` env as the seed.

Data locality:
- `DATA_DIR` → user‑chosen local folder (all persistent data lives here: OWUI's, and — in its `lol-client`
  subfolder, the main window's Chromium session — LOL Chat's history and the Computer's graphs and media;
  File-box outputs in `LOL Studio Projects/`).
- **Keep default local embeddings** — we set **neither** `RAG_EMBEDDING_ENGINE` **nor**
  `RAG_EMBEDDING_MODEL`, so OWUI's in‑process default applies (`all-MiniLM-L6-v2`,
  cached in the default HF_HOME — `~/.cache/huggingface`, deliberately NOT under `DATA_DIR` so a
  data‑folder move never re‑downloads it). Do **NOT** set `RAG_EMBEDDING_ENGINE=ollama` — that would
  ship document text to the farm for **embedding**. (Distinct from extraction: with the default‑on farm
  OCR, an uploaded file's raw bytes DO transit to the trusted‑LAN farm for text extraction; the
  extracted text then embeds locally.)
- **Single worker** (default). Default Chroma is a local SQLite client that is not fork‑safe — never
  raise worker/replica counts in the client.

Kiosk/privacy: `WEBUI_AUTH=false` (single‑user, no login — nothing to gate since data is local and
per‑user; first user is auto‑admin); set a stable `WEBUI_SECRET_KEY`; `ANONYMIZED_TELEMETRY=false`,
`DO_NOT_TRACK=true`, `SCARF_NO_ANALYTICS=true`. Do **NOT** enable OWUI's built‑in local inference
engine (inference must go to the farm, not the laptop).

---

## Backend: the `lol` farm CLI & config

Node CLI, npm‑style (mirrors ComfyQ's config‑driven Node server). Single source of truth is a
declarative config; the CLI orchestrates everything from it.

`lol.config.json` (example — every key has a default; the Farm app writes only what differs, while `lol init` /
`lol install` scaffold the full default):
```jsonc
{
  "name": "Studio Farm",                 // friendly name shown in the client
  "beacon": { "enabled": true, "group": "239.255.43.10", "port": 41998, "intervalSec": 5, "httpPort": 41997 },
  "proxy":  { "port": 4000, "host": "0.0.0.0",   // port = the seat gate; LiteLLM listens on 127.0.0.1:port+1
              "masterKey": null,                 // the shared farm password (null = open LAN)
              "seatGate": true, "seatIdleSec": 900 },
  "models": [ { "id": "gemma4:12b", "default": true } ],   // Ollama catalog = the DEFAULT engine's serving set
  "modelAlias": null,                            // optional stable name for the default Ollama model
  "preinstall": [ /* staged, never served — ships Qwen3.8-27B UD-IQ2_XXS + draft (~8.6 GB) */ ],
  "ollama": { "hosts": ["http://127.0.0.1:11434"], "numParallel": 2, "maxLoadedModels": 1,
              "flashAttention": true, "kvCacheType": "q8_0", "keepAlive": "-1",
              "contextLength": "auto" },         // probed per box; a number pins it
  "llamacpp": { "enabled": false,                // OPT-IN: ONE .gguf served as `alias`
                "alias": "assistant",
                "model": "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-UD-IQ2_S.gguf",
                "contextLength": "auto",         // min(native max, VRAM budget); a number pins it (over-size warns)
                "parallel": 1, "kvUnified": true,// one KV pool shared by the slots; false = hard split
                "kvCacheType": "q4_0", "mtp": false, "cacheRam": "auto" },   // mtp needs UD-Q2_K_XL+
  "external": { "enabled": false, "alias": "assistant", "baseUrl": "http://127.0.0.1:8000/v1",
                "contextLength": 32768, "parallel": 4 },   // operator-run vLLM/SGLang; DECLARED values
  "websearch": { "enabled": true }, "ocr": { "enabled": true }, "tts": { "enabled": false },
  "admin": { "token": null }                     // null = a fresh token per `lol up`, printed in the banner
}
```
Full reference, and the name-uniqueness rule (a per-model name may not duplicate another served name):
[farm/README.md](farm/README.md#config--lolconfigjson).

CLI commands:

| Command | Does |
|---|---|
| `lol init` | Scaffold a `lol.config.json`. |
| `lol up` / `serve` | Probe an external engine; ensure Ollama (start a local one if down); pick the Ollama models (prompt / `--model` / `--no-pick`); pull what's missing; start llama-server if enabled (fall back to Ollama on failure); size the Ollama context; generate `litellm/config.generated.yaml`; start LiteLLM on loopback + the seat gate on `proxy.port`; start the plugins; start the beacon, `/lol/self` and the admin panel; print the admin token. Foreground. |
| `lol models ls` / `add <id>` / `rm <id>` / `pull` | Manage the Ollama catalog in `models` (then `lol up --no-pick`). |
| `lol status` | Health of each Ollama host + the proxy + which models are loaded. |
| `lol down` / `stop` | Stop the proxy + `llama-server` + SearXNG/TTS/OCR + beacon (and any Ollama it started). |
| `lol install` / `setup` | One-time, idempotent bootstrap: Ollama, the LiteLLM venv, every `models` + `preinstall` entry, the SearXNG + OCR venvs, and (only when `llamacpp.enabled`) the llama.cpp build + weights. |
| `lol fleet` / `lol bench` | Every farm on the LAN; load-test N concurrent chats before a workshop. |

Notes:
- The CLI **generates** `litellm/config.generated.yaml` (routing least-busy, `num_retries` 3,
  `allowed_fails` 1, cooldown 60 s). On Ollama each host becomes a deployment of the same `model_name`
  (e.g. `gemma4:12b`), so LiteLLM load‑balances + fails over; with llama.cpp or external serving, one
  OpenAI deployment (+ coordinator peers) replaces the Ollama catalog. LOL never hand‑edits routing; it's
  derived from `lol.config.json`.
- Model choice = the admin panel (live), or edit `models` (or `lol models add`) + `lol up`. Clients see the
  catalog via the endpoint's `/v1/models`; OWUI's and LOL Chat's pickers handle per‑chat selection.
- Prereqs (documented in `farm/README.md`): Ollama installed per box; LiteLLM available (pip/binary) —
  `lol install` bootstraps both. The CLI spawns/supervises them; it doesn't reimplement them.
- The beacon is adapted from ComfyQ's `server/federation/beacon.js` (see Discovery).

---

## Client shell

Layout (mirrors ComfyQ's desktop shell): a sticky **topbar** (logo · "powered by Open WebUI" · connection
pill · surface switch Open WebUI / LOL Chat / Computer · theme · gear) over the OWUI `<webview>`
(`http://127.0.0.1:<port>`), LOL Chat or the Computer. **The pill** shows the farm and its free seats
(`· 2/3 free`); amber = connecting, seats full, not responding or password needed; red = a server problem.
Clicking it opens **Servers on your network**: farm cards with live load, password entry, "Manage this
farm ↗" (`/lol/admin`), add-by-address, auto-search and Rescan. **The connection overlay** covers OWUI
while it starts, reconnects, fails (Retry) or downloads the engine on first run. The gear opens
**Preferences**.

Main‑process responsibilities: sidecar supervisor (start/health‑wait/restart/stop), discovery,
config‑bridge (the only module that knows OWUI's env surface; the renderer's `app.js` holds the few REST
touches in the contract table), and the shell config store (a hand-rolled `userData/shell-settings.json`,
`store.ts`). The renderer hosts the chrome, the webview, the settings UI, LOL Chat and the Computer.

**Preferences panel** (LOL‑owned, ComfyQ‑styled), sections (data location · connection · **assistant
tools** · startup & updates · about):
- **Data location** — show the current `DATA_DIR` (everything: OWUI's data, LOL Chat's history, the
  Computer's graphs, media and projects); "Change folder…" (Electron `dialog.showOpenDialog`). The panel
  asks first and says the app restarts: **move** copies OWUI's data now (the sidecar stopped), saves
  `dataDir` + a `pendingClientMove` marker, and relaunches (no quit prompt) — the next boot moves
  `lol-client` before the window opens, then removes the old copy; **start fresh** saves `dataDir` and
  relaunches (the old data stays where it was). Default: `<userData>/owui-data`.
- **Connection** — "Auto-search the subnet", "Rescan now", the **Search range** (`a.b . c–d . e–f`), and
  "Add by address" + chips (ComfyQ pattern). The farm list and the choice of farm live in the topbar popover.
- **Assistant tools** — the opt‑in Blender/mcpo toggle, a "Test connection" button (checks both the
  local helper and whether Blender is listening), and the BlenderMCP socket port.
- **Startup & updates** — "Launch at login"; "Install app updates automatically"; "Check for app updates"
  → "Restart & install update"; a close-means-close note. There is no update channel.
- **About** — the app and Open WebUI versions, "Check for chat-engine update" (a staged sidecar update,
  applied on relaunch), and explicit "Powered by Open WebUI" attribution + link.

Model selection is intentionally **not** here — the served catalog lives farm‑side (lol.config.json, the
`lol up` interactive picker, or live via the admin panel at `http://<box>:41997/lol/admin`), and per‑chat
model choice lives in Open WebUI's own picker (and LOL Chat's).

---

## Discovery (ComfyQ‑style UDP beacon — not mDNS)

Adapted from ComfyQ's `beacon.js`. The **farm** broadcasts; the **client** listens. Chosen over
mDNS because ComfyQ proved multicast alone is flaky across consumer APs, and this is dependency‑free
(Node `dgram`).

- **Farm side (`lol` CLI):** every `intervalSec` (default 5s), plus an immediate kick on every change, send
  a small JSON snapshot (`farm/src/snapshot.js` — the same object `GET /lol/self` serves: id/name/proxyPort/
  httpPort/ips/endpoint/openaiBaseUrl/requiresKey/models[{id,underlying,default}]/healthy/version/coordinator,
  searxngUrl/ttsUrl/extract, plugins, recommendedClientPlugins, host/usage, backend {engine, model,
  contextLength, contextPerSlot, slots, slotsVerified}, capacity {slots, clients, seatsUsed, seatIdleSec,
  busy, queued}, busy (the admin job in flight) and perf) to **(a)** a multicast group, **(b)** each
  interface's **directed broadcast** (e.g. `10.10.16.255`), and **(c)** the limited broadcast
  `255.255.255.255`, deduped. `setBroadcast(true)`, `setMulticastTTL(4)`. Directed broadcast is what
  makes same‑subnet clients actually see the farm.
- **Use a multicast group/port distinct from ComfyQ's** (ComfyQ uses `239.255.42.99:41999`) so the two
  tools coexist on one LAN — e.g. LOL default `239.255.43.10:41998`.
- **Client side** (`discovery.ts`, `index.ts` `chooseActive`): beacons on `239.255.43.10:41998` + broadcast;
  a unicast `/lol/self` sweep of the **search range** (default: the first non-internal IPv4's subnet; every
  60 s, 48 parallel, 1.5 s timeout, ≤4096 hosts); manual `host[:httpPort]` peers (default 41997, kept even
  when stale). The active farm is re-polled every 2 s; stale after 12 s, dropped after 120 s. Choice
  (pure rules in `farmSelect.ts`; `index.ts` `connectTo()` saves the whole farm context, password included): the pinned
  farm → the current one (sticky) → last session's endpoint → the least-loaded healthy farm (coordinators
  first; load = clients/slots, else GPU%; ties within 15 points picked at random). Clicking a farm card pins
  it; the popover's "Automatic — least busy farm" row removes the pin; entering a password does not pin. A
  farm seen under two addresses keeps the one it was first reached at while that one answers (it moves
  only after 12 s of silence). The least-busy pick skips a password-protected farm
  without a verified stored password (re-checked ≤1/min); a pinned, current or last-session farm is used
  anyway, and after a rotated password main drops the stale key and the farm card asks again.
  `LOL_ENDPOINT` pins an endpoint (dev); `LOL_FED_GROUP/PORT/HTTP_PORT` override the group and ports.
- **Fallbacks (mirror ComfyQ's controls):** manual add‑by‑address and the subnet sweep ("search range") —
  unicast crosses subnets that block broadcast. There is no baked-in address.

---

## Visual design (match ComfyQ) — shell surfaces only

Applies to LOL's **own** chrome (topbar, settings, connection screen, toasts, cards). The embedded
Open WebUI keeps its native look — we do **not** inject CSS into OWUI (that would couple us to its DOM
and break invariants #1/#5). If chat‑surface theming is ever wanted, OWUI's supported theming is the
only route, and it reintroduces version coupling — avoid for the prototype.

Ship `shell/renderer/tokens.css` mirroring ComfyQ exactly:
```css
:root, :root.dark {
  --bg:#09090b; --surface:#18181b; --surface-2:#1f1f23; --border:#27272a;
  --text:#e4e4e7; --muted:#a1a1aa; --grey:#71717a;
  --accent:#71717a; --accent-hover:#a1a1aa; --on-accent:#fafafa;
  --green:#10b981; --blue:#71717a; --amber:#f59e0b; --danger:#ef4444;
  color-scheme: dark;
}
:root.light {
  --bg:#fafafa; --surface:#ffffff; --surface-2:#f4f4f5; --border:#e4e4e7;
  --text:#18181b; --muted:#71717a; --grey:#a1a1aa;
  --accent:#52525b; --accent-hover:#3f3f46; --on-accent:#fafafa;
  --green:#16a34a; --blue:#52525b; --amber:#ca8a04; --danger:#dc2626;
  color-scheme: light;
}
```
Conventions: **Inter** (system‑ui fallback), 14px base, antialiased. Radii: cards 12px, panels 10px,
buttons/inputs 8px, chips 7px, pills 999px. 1px `--border` everywhere. Accent buttons use
`filter: brightness(1.08)` on hover; secondary = ghost buttons on `--surface-2`. Status dots use
`color-mix` glow (green = ready, amber = waiting — connecting, seats full, not responding, password
needed — red = error, grey = idle). The theme toggle shows the **current** mode's icon (moon in dark, sun
in light), as ComfyQ does. Icons: inline Lucide‑style SVG (moon/sun, gear), no icon font.

---

## Electron packaging & auto‑update (adopt ComfyQ's recipe verbatim)

Stack: **electron‑builder** (^26) + **electron‑updater** (^6) + Electron ^42, Node ≥20 (CI: Node 22). Self‑updating on
mac/win/linux from **GitHub Releases**, no paid certificates (ad‑hoc mac signing).

Release flow (in `shell/`):
- `npm run dist` → unsigned installer for the host OS only (local testing, no upload).
- `npm run release:patch|minor|major` → `scripts/release.mjs`: refuses off `main` or with any tracked
  change, runs `npm version <type> --no-git-tag-version`, commits only `package.json`/lock, makes the
  annotated tag `vX.Y.Z`, and pushes `origin main --follow-tags` (npm's built‑in tagging proved
  unreliable, so the git half is done by hand).
- Pushing the tag triggers CI.

`electron-builder.yml` (the real file, comments trimmed):
```yaml
appId: com.llmonlan.client
productName: LlmOnLan
files: [build/**/*, renderer/**/*, assets/**/*, package.json]   # NO sidecar bundled — downloaded on first run
directories: { output: dist, buildResources: assets }
afterPack: scripts/afterPack.cjs          # ad-hoc code-signs the macOS .app (no Apple cert)
publish:
  provider: github
  owner: b2renger
  repo: LlmOnLan
  releaseType: release                    # drafts are ignored by the updater
win:   { target: nsis, icon: assets/icon.png }
nsis:                                     # per-user → silent updates, no UAC prompt
  oneClick: true
  perMachine: false
  allowToChangeInstallationDirectory: false
  artifactName: ${productName}-Setup-${version}-windows-x64.${ext}   # no spaces: GitHub dots them
mac:
  category: public.app-category.productivity
  icon: assets/icon.png
  target:                                 # arm64 + x64. Intel needs ONE packaging substitution
    - { target: dmg, arch: [arm64, x64] } #   (darwin-x64 sidecar ships onnxruntime 1.23.2, the last
    - { target: zip, arch: [arm64, x64] } #   Intel wheel — owner decision 2026-08-28). Intel macs need
                                          #   macOS 14+. zip REQUIRED for latest-mac.yml.
  artifactName: ${productName}-${version}-mac-${arch}.${ext}
  identity: null                          # electron-builder skips signing; afterPack does ad-hoc
  hardenedRuntime: false                  # ad-hoc + hardened fails to launch
linux:
  target: AppImage
  icon: assets/icon.png
  category: Network
  artifactName: ${productName}-${version}-linux-${arch}.${ext}
```

CI `.github/workflows/release.yml`: on `v*` tag → matrix `windows-latest`, `macos-latest` (arm64 +
cross-packaged x64 installers), `ubuntu-latest` (linux-x64), `ubuntu-24.04-arm` (linux-arm64),
`macos-15-intel` (`sidecarOnly`: the darwin-x64 sidecar), `max-parallel: 1`; Node 22, Python 3.12 →
`npm ci` + `npm run build` in `shell/` → the release is **pre‑created with `gh release create`**,
built with `electron-builder --publish never`, and every artifact uploaded via
`gh release upload --clobber` — electron‑builder's own GitHub publisher raced its parallel uploads
(422 already_exists, dropped assets), so it's deliberately not used for publishing. The sidecar tarballs
ride the same release. Public repo → the updater needs no token.

`scripts/afterPack.cjs` (macOS only): `codesign --force --deep --sign - <App>.app` so Apple Silicon
doesn't report the unsigned app as "damaged"; not notarized → first‑launch shows the gentler
"unidentified developer" prompt (right‑click → Open bypass). Disable electron‑builder's own signing
(`identity: null`) so there's one signing step we control.

> **Future hardening (out of prototype scope):** a real Apple Developer cert + notarization and a Windows
> code‑signing cert remove the Gatekeeper/SmartScreen warnings. Fine to skip for an internal LAN tool.

---

## Repo layout

```
LlmOnLan/
  shell/                 # Electron + TypeScript — first-party client code
    src/main/            #   index (boot/IPC/selection), sidecar, sidecarManager, configBridge, discovery,
                         #   store, paths, util, types, dataMigration, clientData (the window's session
                         #   in DATA_DIR/lol-client), updater, mcpoSupervisor,
                         #   farmSelect (pure farm choice), clientMode.ts; projects/projectsPath/debugLog = the Computer's
    src/preload/
    renderer/            #   index.html + app.js (topbar, webview host, prefs); tokens.css (ComfyQ palette)
      chat/              #   LOL Chat + the Computer — ES modules, no build; IndexedDB `lol-chat` (in DATA_DIR/lol-client)
        main.mjs         #     LOL Chat entry (+ app/ core/ ctx/ net/ render/ state/ ui/ strings/ css/)
        computer/        #     the Computer surface: layout, library, run bar, drawer (+ code editor),
                         #     host (session/runner/canvas), drops/intake/media, devlog + recorder,
                         #     tutorial/ (Learn shelf, rail, lessons), templates/
        graph/           #     engine + canvas: model, topo, runner, bind, undo, serialize, canvas.mjs,
                         #     wires, palette, parts/ (one file per box type)
        sandbox/         #     host.mjs (the ONLY iframe maker), runner.html (opaque-origin guest,
                         #     lol.orbit), protocol.mjs, lib/ (vendored three / p5 / matter)
    test/                #   unit.js, chat-unit.js (+chat/unit), chat-lint.js, chat-scope.js, asar-probe.js,
                         #   chat-harness/ (chat-only Electron over CDP), mock-farm.js (+mock/), e2e.js (legacy)
    assets/              #   icon.png / icon.svg
    scripts/             #   release.mjs, afterPack.cjs (adapted from ComfyQ)
    electron-builder.yml
  farm-app/              # the operator-facing Farm app (Electron) — installs + supervises `lol`
    src/main/            #   installer (setup wizard), farmSupervisor, runtimeManager, updater
    renderer/            #   status chrome + Settings + the admin panel in a <webview>
    electron-builder.yml #   ships `../farm` as an extraResource; tags are `farm-v*`
  sidecar/               # packaging of the pinned, UNMODIFIED Open WebUI
    OPENWEBUI_VERSION    #   single source of truth for the pin
    build-sidecar.*      #   fetches OWUI at the pin + bundles a self-contained executable
  farm/                  # the `lol` CLI (Node) + beacon — the backend, NOT shipped to clients
    bin/lol.js           #   CLI entry
    src/                 #   beacon.js, selfServer.js (+ admin/ panel page), snapshot.js, seats.js,
                         #   plugins/ (registry), pysvc/ (OCR service), extract.js, llamacpp.js/gguf.js,
                         #   litellm.js/ollama.js, configFile.js, commands/ (up/down/install/...)
    litellm/             #   generated config.generated.yaml lives here at runtime
    README.md            #   prereqs (Ollama, LiteLLM) + usage + the full config reference
  docs/                  # DEVLOG (dated build log), GETTING_STARTED, RIG_CHECKLIST, LOLCHAT_*, COMPUTER_*,
                         # reviews/ (critic + consistency reports), …
  .github/workflows/release.yml              # client, on `v*` tags
  .github/workflows/release-farm.yml         # Farm app, on `farm-v*` tags
  .github/workflows/build-llamacpp-arm64.yml # the Spark's llama-server tarball (on a pin bump)
  CLAUDE.md
  implementation_plan.md
```
`sidecar/` must never contain edited Open WebUI source — that enforces invariant #1 structurally.

---

## Data‑flow & privacy boundary

- **On the device, all under `DATA_DIR`:** every conversation, folder, prompt, document, and RAG vector
  (OWUI's); LOL Chat's history and the Computer's graphs and media (the main window's session,
  `DATA_DIR/lol-client`); the Computer's File-box outputs (`DATA_DIR/LOL Studio Projects`). Embeddings are
  computed locally. Outside DATA_DIR, under userData, only app plumbing: settings, the downloaded engine,
  OWUI's webview token/caches, logs, and — after an upgrade from v0.1.x — the old LOL Chat copy kept as a
  backup.
- **Over the network (all to the trusted‑LAN farm, which stores nothing):** the chat context per
  completion (from OWUI, LOL Chat, or a Computer Instruction — with an Image box's pixels when wired);
  web‑search queries to the farm's SearXNG (result pages are then fetched directly); TTS requests when
  the farm hosts Kokoro; and — with the default‑on farm OCR — an uploaded file's (or a Computer Document
  box's) raw bytes, for text **extraction only** (the extracted text embeds locally); presence heartbeats
  (`POST /lol/client-ping` every 10 s: hostname, platform, version, idle seconds).
- **To third parties a person names:** a Computer **Fetch** box's GET to the address typed in it (nothing
  from the graph is sent with it).
- **Beyond the farm (no user content):** GitHub, for the app update check and the chat-engine (sidecar)
  download/update check; huggingface.co, until MiniLM and whisper-base are cached (then `HF_HUB_OFFLINE=1`).
- **Never sent anywhere:** documents for **embedding** (local model), a Computer Sound box, and
  telemetry (off).

If a feature would move *stored* data off the device or persist anything server‑side, it breaks the
promise — flag it.

---

## Conventions & guardrails

**Code by the ponytail ladder** (owner, 2026-09-27; https://github.com/dietrichgebert/ponytail): after
reading the task and tracing the real flow, stop at the first rung that holds — does it need to exist →
already in this codebase → the standard library → a native platform feature → an installed dependency →
one line → only then the minimum that works. Root cause over symptom (fix the shared function once). No
unrequested abstractions, dependencies or boilerplate; deletion over addition; fewest files. Mark a
deliberate ceiling with a `ponytail:` comment naming it and the upgrade path. Never lazy about validation at
trust boundaries, error handling that prevents data loss, security, accessibility, or hardware calibration;
non-trivial logic leaves ONE runnable check.

**Do:** keep first‑party code in `shell/` and `farm/`; treat OWUI as an external product configured from
outside; re‑verify the config surface on each version bump; keep env authoritative every launch
(`ENABLE_PERSISTENT_CONFIG=false` — OWUI's user-settings REST API only for what env can't do: the
web-search default and the tool server; never the admin API);
default to local‑only; apply ComfyQ tokens to shell surfaces only.

**Don't:** edit/fork/patch OWUI source; store user data server‑side or send documents to the farm for
*embedding* (extraction via the farm OCR is the sanctioned exception — nothing is stored); rebrand
or hide Open WebUI; inject CSS into the OWUI webview; enable OWUI's built‑in local inference; raise
client worker counts; reimplement features OWUI already has; reuse ComfyQ's multicast port (pick a distinct one).

## Out of scope (prototype)

Modifying/forking Open WebUI; a shared/central knowledge base (needs central storage — conflicts with the
local‑data invariant); custom auth/SSO/multi‑tenant admin; notarization/paid signing; reimplementing chat,
RAG, or model management.
