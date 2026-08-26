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

## Build status (2026-08-25) — client `v0.1.33` · Farm app `farm-v0.0.20` · OWUI `0.10.2`

The full plan is built, released and in multi-user testing; the dated build log with how
each piece was tested lives in [docs/DEVLOG.md](docs/DEVLOG.md), the rig‑verification state in
[docs/RIG_CHECKLIST.md](docs/RIG_CHECKLIST.md), and the version‑specific integration facts in
[docs/INTEGRATION_BRIEF.md](docs/INTEGRATION_BRIEF.md) (a dated snapshot — the pin has since moved).
Snapshot:

- **`farm/`** — the `lol` CLI works end-to-end (verified: `lol up` → real `/v1/chat/completions` via
  LiteLLM→backend; status/down; UDP beacon + `/lol/self` received by a listener). **TWO inference
  engines behind one LiteLLM endpoint:** `llamacpp` (`llama-server`, **enabled by default**) serves
  ONE model — `llamacpp.model`, a .gguf URL, default Unsloth **Qwen3.8-27B-UD-IQ2_S** — under
  `llamacpp.alias` (default `assistant`). **The engines are EXCLUSIVE** (owner decision 2026-08-26):
  while llama.cpp serves, NO local Ollama deployment is routed or advertised — the catalog is standby
  inventory for an engine switch, and the OCR vision model (which talks raw Ollama, never the proxy).
  The advertised name carries across a switch (`carryNameAcross`), so chats survive it. On platforms
  with no prebuilt llama.cpp (linux-arm64 — the DGX Spark) or any llama.cpp boot failure, `lol up`
  **falls back to the Ollama engine with the reason in the panel** instead of exiting — and linux-arm64
  now HAS a prebuilt: our CI (`build-llamacpp-arm64.yml`) publishes a self-contained llama-server
  tarball on the `llamacpp-<build>` release tag, which `assetsFor()` downloads on the Spark.
  `llamacpp.contextLength` defaults to **'auto'** — min(model native max, VRAM budget), both read from
  the real files (`farm/src/gguf.js`). `proxy.masterKey` = the shared **farm password** (panel-settable;
  clients prompt once, verify, remember per farm; discovery + the admin token stay separate).
  `mtp` (`--spec-type draft-mtp`) defaults **false** —
  Unsloth strips the MTP head below UD-Q2_K_XL and llama-server then refuses to start. Ollama still
  serves `models` (`gemma4:12b`) + the OCR vision model. Pin facts:
  **OWUI `0.10.2`** (Python 3.11/3.12, run via the `open-webui serve` console script). Beacon group
  **`239.255.43.10:41998`** (+ httpPort `41997`), distinct from ComfyQ. On top: an **admin panel** at
  `http://<box>:41997/lol/admin` (bearer token printed by `lol up`; `config.admin.token`) with a live
  control API — **backend switch (llama.cpp ↔ Ollama), a `.gguf` model library (add by URL / Use this,
  with rollback), the advertised model name, slots (`llamacpp.parallel`), a context selector that
  targets the serving engine**, Ollama pull/offer/delete + "Make default", plugin toggles, Blender fleet
  recommendation, and a connected-clients list against the slot count. Everything but the plugin toggles
  **persists to `lol.config.json`** (`farm/src/configFile.js`); long fetches run as a single job whose
  progress the panel polls; a **plugin registry** (`farm/src/plugins/registry.js`)
  orchestrating web search (SearXNG, ON), document OCR (`farm/src/pysvc` + `extract.js`, ON — hybrid
  text/vision PDF extraction), and Kokoro TTS (off); `ollama.contextLength` (default **16384** — 65536
  spilled on the fleet's 12 GB cards; max 262144) applied via `OLLAMA_CONTEXT_LENGTH` **and**
  per-deployment `num_ctx` in the generated LiteLLM routing. The panel's context control routes to
  **whichever engine is serving**, so on a default farm it sets `llamacpp.contextLength` (default 16384,
  which llama.cpp **splits across `llamacpp.parallel` slots** — verified: `--ctx-size 16384 --parallel 2`
  → `n_ctx_slot = 8192`); coordinator mode +
  `lol fleet`/`lol bench`/`lol install` (which pre-fetches the llama.cpp build + weights); a stable
  **model alias** + interactive picker in `lol up`.
- **`shell/`** (Electron + TS, **v0.1.33**) — boots the **unmodified** OWUI sidecar (config-bridge =
  env-authoritative, `ENABLE_PERSISTENT_CONFIG=false`), discovers the farm and auto-connects with **no
  URL typed**, full Preferences (data folder + move/fresh migration, connection, startup/updates, about).
  Whole-document RAG (`RAG_FULL_CONTEXT=true`); presence heartbeats to the farm (`POST /lol/client-ping`
  every 10 s: id/hostname/platform/version/idleSec); Blender/mcpo assistant tools are **opt-in** (off by
  default since v0.1.24; a farm recommendation can enable them for non-explicit users). Two surfaces:
  OWUI + **LOL Chat** (`renderer/chat.js`, farm-direct, localStorage-only) behind a topbar toggle;
  which one ships is `src/main/clientMode.ts` `OWUI_ENABLED` (+ the renderer's `NO_OWUI` — flip both).
  Perf invariants worth keeping: the renderer CSP MUST carry `connect-src` (else LOL Chat cannot reach
  the LAN farm at all), the farm context is persisted so a cold launch spawns the sidecar **once**, and
  OWUI's follow-up/tags/autocomplete generation is disabled so background calls can't queue ahead of the
  user on llama-server's single slot. E2E harness: `shell/test/` (mock farm + CDP driver).
- **`sidecar/`** — `build-sidecar` bundles a relocatable standalone CPython + OWUI + `launcher.py`;
  `OPENWEBUI_VERSION` is the pin. NOT bundled into the installer — CI publishes it as
  `owui-sidecar-<platform>-<arch>.tar.gz` release assets and the packaged shell downloads it to
  `userData/sidecar` on first run (`sidecarManager.ts`).
- **packaging** — electron-builder + electron-updater + a GitHub Actions release matrix; live
  auto-update verified across releases (v0.1.x series).
- **health (M6)** — the farm advertises `host` (GPU/VRAM/RAM/cores) + `usage` (live GPU util/VRAM +
  connected clients) in the snapshot; `lol status`, the admin panel and the shell's farm cards show it.

**Verified on the live stack (single box, 2026-06-30):** a **full chat through the OWUI UI** (Playwright →
streamed gemma4 reply); **document‑locality** (a doc embedded into the local Chroma with **zero
`/v1/embeddings`** to the farm); **load‑balancing + transparent failover** across two Ollama hosts
(killing one → 10/10 completions still succeed, after tuning the router).

**Still needs real two‑machine / installer verification** (see [docs/RIG_CHECKLIST.md](docs/RIG_CHECKLIST.md)):
discovery across *physical* boxes / broadcast‑blocked Wi‑Fi, the full installer build + a live
GitHub‑Release auto‑update cycle on mac/win/linux (the upgrade test), and the data‑folder move via the
native dialog. When working here, keep honoring the **prime directive** below.

---

## What we are building (four pieces)

1. **`lol` — the farm CLI** (Node, npm‑style). Run on each GPU box (or one box). Reads a
   declarative `lol.config.json`, then launches/configures Ollama, generates and runs a
   LiteLLM proxy (one OpenAI‑compatible endpoint, load‑balanced across boxes), and runs a
   **UDP discovery beacon** so clients find the farm automatically. This is where models are
   chosen.
2. **The client shell** (Electron + TypeScript). Supervises a bundled, unmodified Open WebUI
   sidecar, discovers the farm on the LAN, points Open WebUI at it, and stores all data in a
   user‑chosen local folder. Owns the topbar, settings/preferences, and the connection screen.
3. **Open WebUI** — vendored, version‑pinned, **unmodified**. We inherit all its features.
4. **The Farm app** (`farm-app/`, Electron) — the operator-facing sibling of the client: it installs
   its own Ollama + Python + backend + weights, supervises `lol up`, and shows the admin panel as its
   window — which is where the model, its name and the capacity are run. Its own Settings drawer holds
   only app-level things (share-with-LAN → `proxy.host`/`beacon.enabled`, theme, launch-at-login,
   updates, logs folder); it deliberately no longer re-applies model settings at boot, which used to
   overwrite the panel's.
   Released on `farm-v*` tags; **update checks are manual** (no electron-updater).

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
3. **All persistent data stays on the client machine** — chats, folders, knowledge bases,
   documents, RAG vectors — under a local `DATA_DIR` the user chooses. The farm is stateless and
   stores nothing.
4. **We touch Open WebUI ONLY through its public config surface** (env vars + admin REST API). If
   a behavior needs Open WebUI internals, we don't build it.
5. **Upgrading Open WebUI is a version bump, not a merge.** Bump one pin → rebuild the sidecar →
   run smoke tests. **No LOL code changes.** If an upgrade forces a code change in our shell,
   that's a separation defect to redesign, not absorb.

---

## The integration contract (the entire OWUI coupling)

| Direction | Mechanism | Notes |
|---|---|---|
| Lifecycle | Shell spawns the OWUI sidecar as a child process and supervises it. | Shell = process manager + window. |
| Config → OWUI | Env vars at **every** launch, made authoritative by `ENABLE_PERSISTENT_CONFIG=false` — repointing the farm restarts the sidecar with new env. **Two exceptions**, both written from the authed webview via OWUI's user‑settings API `POST /api/v1/users/user/settings/update`: web search defaulted ON (`ui.webSearch='always'`, one‑time via a `lolWebSearchSeeded` marker) and the opt‑in Blender tool server (`ui.toolServers` + `ui.tools`). Neither has a usable env. | See gotchas below. |
| Data | `DATA_DIR` → the user's chosen local folder; default local embeddings; telemetry off. | Enforces invariant #3. |
| Net out of OWUI | Chat completions to the farm endpoint; plus, when the farm advertises them: SearXNG queries (then direct page fetches), Kokoro TTS requests, and uploaded‑file bytes to the farm OCR extractor. | Embeddings always stay local. |
| Everything else | None. OWUI is a black box. | No DB poking, no template/CSS edits, no internal imports. |

### Verified OWUI config surface (re‑verify per pinned version; authoritative list = `shell/src/main/configBridge.ts`)

Connection: `OPENAI_API_BASE_URL` + `OPENAI_API_KEY` (the farm is OpenAI‑compatible via LiteLLM;
`ENABLE_OLLAMA_API=false` so OWUI never talks to Ollama directly). The shipped env surface also carries:
`DEFAULT_MODELS` (farm's advertised default) + `DEFAULT_MODEL_METADATA` (vision on; `web_search` when the
farm hosts SearXNG), `RAG_FULL_CONTEXT=true` (whole‑document answers, not top‑k chunks),
`ENABLE_WEB_SEARCH`/`WEB_SEARCH_ENGINE=searxng`/`SEARXNG_QUERY_URL`, `AUDIO_STT_ENGINE=''` +
`WHISPER_MODEL=base` (local STT), `AUDIO_TTS_*` (farm Kokoro when advertised),
`CONTENT_EXTRACTION_ENGINE=external` + `EXTERNAL_DOCUMENT_LOADER_URL/_API_KEY` (farm OCR),
`ENABLE_VERSION_UPDATE_CHECK=false`, `DEFAULT_LOCALE`, `ENABLE_OPENAI_API` (true only with a farm — a
no‑farm boot must not fall back to api.openai.com), `WEB_SEARCH_RESULT_COUNT`/`_CONCURRENT_REQUESTS`,
and the **TTFT trio** `ENABLE_FOLLOW_UP_GENERATION`/`ENABLE_TAGS_GENERATION`/`ENABLE_AUTOCOMPLETE_GENERATION`
= `false` (OWUI's background calls would otherwise queue ahead of the user on llama‑server's single slot;
title generation stays ON).

- **Gotcha #1 — persisted URLs beat env.** Connection URLs saved via the admin UI go to OWUI's DB
  and **take precedence over env on later starts.** The shipped strategy: `ENABLE_PERSISTENT_CONFIG=false`
  — env is authoritative on **every** launch, so repointing the farm is just a sidecar restart with new
  env, and no stale persisted URL can win. (The admin REST API is deliberately NOT used for endpoint
  reconciliation — it's session‑only while persistence is off; its one shipped use is registering the
  opt‑in Blender tool server from the authed webview.) Ref: https://docs.openwebui.com/reference/env-configuration/
- **Gotcha #2 — JSON config env.** `OPENAI_API_CONFIGS`/`OLLAMA_API_CONFIGS` historically weren't
  parsed from env at startup (open‑webui#19017). Use the simple `*_BASE_URL(S)` env as the seed.

Data locality:
- `DATA_DIR` → user‑chosen local folder (all persistent data lives here).
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

`lol.config.json` (example):
```json
{
  "name": "Studio Farm",                 // friendly name shown in the client
  "beacon": { "enabled": true, "group": "239.255.43.10", "port": 41998, "intervalSec": 5 },
  "proxy":  { "port": 4000 },            // LiteLLM OpenAI-compatible endpoint
  // The DEFAULT backend: ONE model, served as `alias`, advertised as the fleet default.
  "llamacpp": {
    "enabled": true,
    "alias": "assistant",                // the id clients see + auto-select
    "model": "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-UD-IQ2_S.gguf",
    "contextLength": 16384,              // SPLIT across `parallel` slots; the farm CLAMPS a size
    "parallel": 1,                       //   that cannot fit VRAM (measured q4_0 ≈ 1.2 GB per 16k)
    "kvCacheType": "q4_0", "mtp": false  // mtp needs a UD-Q2_K_XL+ quant
  },
  "models": [                            // Ollama catalog: STANDBY while llamacpp serves (one engine at a time)
    { "id": "gemma4:12b", "default": true }
  ],
  "ollama": {
    "hosts": ["http://127.0.0.1:11434", "http://gpu-2.local:11434"],
    "numParallel": 2,                    // OLLAMA_NUM_PARALLEL per host
    "maxLoadedModels": 1,
    "flashAttention": true,
    "contextLength": 16384               // Ollama-side; llama.cpp has its own, above
  },
  "websearch": { "enabled": true },      // SearXNG, ON   |  "tts": { "enabled": false }  Kokoro, off
  "ocr": { "enabled": true },            // farm OCR, ON — loads a vision model on Ollama
  "preinstall": [ /* staged, never served */ ],
  "admin": { "token": null }
}

Full reference + the alias-collision rule: [farm/README.md](farm/README.md#config--lolconfigjson).
```

CLI commands:

| Command | Does |
|---|---|
| `lol init` | Scaffold a `lol.config.json`. |
| `lol up` / `lol serve` | Ensure each Ollama host is reachable, pull configured models, generate the LiteLLM config from `lol.config.json`, start LiteLLM, start the discovery beacon. |
| `lol models ls` / `lol models add <id>` / `lol models pull` | Manage the served model catalog (wraps `ollama pull` on each host). |
| `lol status` | Health of each Ollama host + the proxy + which models are loaded. |
| `lol down` | Stop the proxy + `llama-server` + SearXNG/TTS/OCR + beacon (and any Ollama it started). |
| `lol install` | One-time bootstrap: Ollama + LiteLLM venv + models + the llama.cpp build/weights + the plugin venvs. Idempotent. |
| `lol fleet` / `lol bench` | Every farm on the LAN; load-test N concurrent chats before a workshop. |

Notes:
- The CLI **generates** the LiteLLM `config.yaml` (each Ollama host becomes a deployment of the
  same `model_name`, e.g. `gemma4:12b`, so LiteLLM load‑balances + fails over). LOL never hand‑edits
  routing; it's derived from `lol.config.json`.
- Model choice = edit `models` (or `lol models add`) + `lol up`. Clients see the catalog via the
  endpoint's `/v1/models`; OWUI's model picker handles per‑chat selection.
- Prereqs (documented in `farm/README.md`): Ollama installed per box; LiteLLM available (pip/binary) —
  `lol install` bootstraps both. The CLI spawns/supervises them; it doesn't reimplement them.
- The beacon is adapted from ComfyQ's `server/federation/beacon.js` (see Discovery).

---

## Client shell

Layout (mirrors ComfyQ's desktop shell): a sticky **topbar** (LOL logo + connection status +
theme toggle + settings gear) over a main area that is an embedded **`<webview>` of the local
Open WebUI** (`http://127.0.0.1:<port>`). A **connection screen** shows while discovering or
disconnected ("Looking for your server…" / "Connected to {farm}" / "Enter address"). The gear opens
**Preferences**.

Main‑process responsibilities: sidecar supervisor (start/health‑wait/restart/stop), discovery,
config‑bridge (the only module that knows OWUI's config surface), and the shell config store
(`electron-store` or a JSON in `userData`). The renderer is thin — chrome + the webview + settings UI.

**Preferences panel** (LOL‑owned, ComfyQ‑styled), sections (data location · connection · **assistant
tools** · startup & updates · about):
- **Data location** — show the current `DATA_DIR`; "Change folder…" (Electron `dialog.showOpenDialog`).
  On change: offer to **move existing data** to the new folder or start fresh, then restart the sidecar
  pointing at the new `DATA_DIR`. Default to a sensible per‑user app‑data path.
- **Connection** — auto‑discovered farm(s) with status dots; a manual "Add by address" field +
  chips (ComfyQ pattern); a "Refresh / rescan" button; optional subnet "search range". Lets the user
  pick which farm if several are found.
- **Assistant tools** — the opt‑in Blender/mcpo toggle, a "Test connection" button (checks both the
  local helper and whether Blender is listening), and the BlenderMCP socket port.
- **Startup & updates** — launch at login; auto‑update channel/toggle (electron‑updater).
- **About** — LlmOnLan version, bundled Open WebUI version, and explicit "Powered by Open WebUI"
  attribution + link.

Model selection is intentionally **not** here — the served catalog lives farm‑side (lol.config.json, the
`lol up` interactive picker, or live via the admin panel at `http://<box>:41997/lol/admin`), and per‑chat
model choice lives in Open WebUI's own picker.

---

## Discovery (ComfyQ‑style UDP beacon — not mDNS)

Adapted from ComfyQ's `beacon.js`. The **farm** broadcasts; the **client** listens. Chosen over
mDNS because ComfyQ proved multicast alone is flaky across consumer APs, and this is dependency‑free
(Node `dgram`).

- **Farm side (`lol` CLI):** every `intervalSec` (default 5s) send a small JSON snapshot (see
  `farm/src/snapshot.js` for the full shape — id/name/endpoint/openaiBaseUrl/httpPort/models/healthy/
  coordinator, plus searxngUrl/ttsUrl/extract, plugins, recommendedClientPlugins, host/usage) to
  **(a)** a multicast group, **(b)** each
  interface's **directed broadcast** (e.g. `10.10.16.255`), and **(c)** the limited broadcast
  `255.255.255.255`, deduped. `setBroadcast(true)`, `setMulticastTTL(4)`. Directed broadcast is what
  makes same‑subnet clients actually see the farm.
- **Use a multicast group/port distinct from ComfyQ's** (ComfyQ uses `239.255.42.99:41999`) so the two
  tools coexist on one LAN — e.g. LOL default `239.255.43.10:41998`.
- **Client side:** listen for snapshots → present discovered farms → on select (or single result) hand
  the endpoint to the config‑bridge.
- **Fallbacks (mirror ComfyQ's controls):** manual add‑by‑address, subnet sweep ("search range"), and a
  baked‑in stable address. If the farm has a stable address/hostname, baking it in can replace discovery.

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
`color-mix` glow (green = serving, accent = connected, grey = idle). Theme toggle shows the icon for the
mode you'd switch *to*. Icons: inline Lucide‑style SVG (moon/sun, gear), no icon font.

---

## Electron packaging & auto‑update (adopt ComfyQ's recipe verbatim)

Stack: **electron‑builder** (^26) + **electron‑updater** (^6) + Electron ^42, Node ≥20. Self‑updating on
mac/win/linux from **GitHub Releases**, no paid certificates (ad‑hoc mac signing).

Release flow (in `shell/`):
- `npm run dist` → unsigned installer for the host OS only (local testing, no upload).
- `npm run release:patch|minor|major` → `npm version <type> --no-git-tag-version` then a
  `scripts/release.mjs` that **explicitly** commits the version files, makes an annotated tag `vX.Y.Z`,
  and pushes `--follow-tags` (npm's built‑in tagging proved unreliable; do the git half by hand). Guard:
  only release from `main`; stage only `package.json`/lock so a dirty `config.json` stays out.
- Pushing the tag triggers CI.

`electron-builder.yml` (adapt owner/repo/appId for LOL):
```yaml
appId: com.llmonlan.client
productName: LlmOnLan
files: [build/**/*, renderer/**/*, assets/**/*, package.json]   # NO sidecar bundled — downloaded on first run
directories: { output: dist }
afterPack: scripts/afterPack.cjs          # ad-hoc code-signs the macOS .app (no Apple cert)
publish:
  provider: github
  owner: b2renger
  repo: LlmOnLan
  releaseType: release                    # drafts are ignored by the updater
win:   { target: nsis, icon: assets/icon.png }
mac:
  target:                                 # arm64 ONLY — OWUI 0.10.2 pins onnxruntime==1.26.0,
    - { target: dmg, arch: [arm64] }      #   whose last macOS-x86_64 wheel was 1.23.2, so an Intel
    - { target: zip, arch: [arm64] }      #   build cannot resolve. zip REQUIRED for latest-mac.yml.
  identity: null                          # electron-builder skips signing; afterPack does ad-hoc
  hardenedRuntime: false                  # ad-hoc + hardened fails to launch
  icon: assets/icon.png
linux: { target: AppImage, icon: assets/icon.png }
nsis:  { oneClick: true, perMachine: false }   # per-user → silent updates, no UAC prompt
```

CI `.github/workflows/release.yml`: on `v*` tag → matrix `[windows-latest, macos-latest, ubuntu-latest]`
(`max-parallel: 1`) → `npm ci` in `shell/` → the release is **pre‑created with `gh release create`**,
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
    src/main/            #   supervisor, discovery (beacon listener), config-bridge, store,
                         #   clientMode.ts (which surface ships), sidecarManager, updater, mcpo
    src/preload/
    renderer/            #   topbar + webview host + settings UI; chat.js (LOL Chat);
                         #   tokens.css (ComfyQ palette)
    test/                #   mock-farm.js + e2e.js (drives the real app over CDP)
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
    src/                 #   beacon.js, selfServer.js (+ admin/ panel page), snapshot.js,
                         #   plugins/ (registry), pysvc/ (OCR service), extract.js,
                         #   litellm.js/ollama.js, commands/ (up/down/install/...)
    litellm/             #   generated config.yaml lives here at runtime
    README.md            #   prereqs (Ollama, LiteLLM) + usage
  docs/                  # DEVLOG (dated build log), GETTING_STARTED, RIG_CHECKLIST, …
  .github/workflows/release.yml        # client, on `v*` tags
  .github/workflows/release-farm.yml   # Farm app, on `farm-v*` tags
  CLAUDE.md
  implementation_plan.md
```
`sidecar/` must never contain edited Open WebUI source — that enforces invariant #1 structurally.

---

## Data‑flow & privacy boundary

- **On the device:** every conversation, folder, prompt, document, and RAG vector (under `DATA_DIR`);
  embeddings computed locally.
- **Over the network (all to the trusted‑LAN farm, which stores nothing):** the chat context per
  completion; web‑search queries to the farm's SearXNG (result pages are then fetched directly);
  TTS requests when the farm hosts Kokoro; and — with the default‑on farm OCR — an uploaded file's raw
  bytes, for text **extraction only** (the extracted text embeds locally).
- **Never sent anywhere:** documents for **embedding** (local model) and telemetry (off).

If a feature would move *stored* data off the device or persist anything server‑side, it breaks the
promise — flag it.

---

## Conventions & guardrails

**Do:** keep first‑party code in `shell/` and `farm/`; treat OWUI as an external product configured from
outside; re‑verify the config surface on each version bump; keep env authoritative every launch
(`ENABLE_PERSISTENT_CONFIG=false` — the admin API only for what env can't do, e.g. tool servers);
default to local‑only; apply ComfyQ tokens to shell surfaces only.

**Don't:** edit/fork/patch OWUI source; store user data server‑side or send documents to the farm for
*embedding* (extraction via the farm OCR is the sanctioned exception — nothing is stored); rebrand
or hide Open WebUI; inject CSS into the OWUI webview; enable OWUI's built‑in local inference; raise
client worker counts; reimplement features OWUI already has; reuse ComfyQ's multicast port (pick a distinct one).

## Out of scope (prototype)

Modifying/forking Open WebUI; a shared/central knowledge base (needs central storage — conflicts with the
local‑data invariant); custom auth/SSO/multi‑tenant admin; notarization/paid signing; reimplementing chat,
RAG, or model management.
