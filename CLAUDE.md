# CLAUDE.md — LlmOnLan (LOL)

> **LlmOnLan** (short: **LOL**) is a desktop client + a LAN inference farm. The client
> bundles a **pinned, unmodified Open WebUI** and auto‑connects to the farm so a person on
> the office Wi‑Fi can chat with `gemma4:12b` with zero setup. All data stays on the user's
> machine.
>
> We do **not** hide that the chat UI is Open WebUI. The window chrome is LOL‑branded; the
> Open WebUI surface inside keeps its own name and branding. Think "LlmOnLan, powered by
> Open WebUI." The shell's own surfaces (topbar, settings, connection screen) follow
> **ComfyQ's visual language** for a consistent feel across the two tools.
>
> Reference project (visual + Electron/auto‑update conventions): https://github.com/b2renger/ComfyQ

---

## What we are building (three pieces)

1. **`lol` — the farm CLI** (Node, npm‑style). Run on each GPU box (or one box). Reads a
   declarative `lol.config.json`, then launches/configures Ollama, generates and runs a
   LiteLLM proxy (one OpenAI‑compatible endpoint, load‑balanced across boxes), and runs a
   **UDP discovery beacon** so clients find the farm automatically. This is where models are
   chosen.
2. **The client shell** (Electron + TypeScript). Supervises a bundled, unmodified Open WebUI
   sidecar, discovers the farm on the LAN, points Open WebUI at it, and stores all data in a
   user‑chosen local folder. Owns the topbar, settings/preferences, and the connection screen.
3. **Open WebUI** — vendored, version‑pinned, **unmodified**. We inherit all its features.

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
| Config → OWUI | Env vars at launch (first‑run seed) **+** admin REST API after boot (reconcile the discovered endpoint each launch). | See gotchas below. |
| Data | `DATA_DIR` → the user's chosen local folder; default local embeddings; telemetry off. | Enforces invariant #3. |
| Net out of OWUI | Only to the discovered farm endpoint, for chat completions. | Embeddings stay local. |
| Everything else | None. OWUI is a black box. | No DB poking, no template/CSS edits, no internal imports. |

### Verified OWUI config surface (re‑verify per pinned version in M1)

Connection: `OPENAI_API_BASE_URL` + `OPENAI_API_KEY` (preferred — the farm is OpenAI‑compatible
via LiteLLM), or `OLLAMA_BASE_URLS` (space‑separated) if pointing at Ollama directly.

- **Gotcha #1 — persisted URLs beat env.** Connection URLs saved via the admin UI go to OWUI's DB
  and **take precedence over env on later starts.** To keep the *discovered* endpoint authoritative
  (the IP can change via DHCP): preferred = seed via env on first run + reconcile via the **admin
  REST API** each launch (surgical). Blunt fallbacks: `ENABLE_PERSISTENT_CONFIG=false` (env always
  wins, globally) or `RESET_CONFIG_ON_START=true`. Validate the admin endpoint + auth flow (esp.
  under `WEBUI_AUTH=false`) for the pin. Ref: https://docs.openwebui.com/reference/env-configuration/
- **Gotcha #2 — JSON config env.** `OPENAI_API_CONFIGS`/`OLLAMA_API_CONFIGS` historically weren't
  parsed from env at startup (open‑webui#19017). Use the simple `*_BASE_URL(S)` env as the seed.

Data locality:
- `DATA_DIR` → user‑chosen local folder (all persistent data lives here).
- **Keep default local embeddings** (`RAG_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2`,
  cached under `DATA_DIR`). Do **NOT** set `RAG_EMBEDDING_ENGINE=ollama` — that would ship document
  text to the farm. With the default, documents never leave the device.
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
  "models": [
    { "id": "gemma4:12b", "default": true }
  ],
  "ollama": {
    "hosts": ["http://127.0.0.1:11434", "http://gpu-2.local:11434"],
    "numParallel": 2,                    // OLLAMA_NUM_PARALLEL per host
    "maxLoadedModels": 1,
    "flashAttention": true
  }
}
```

CLI commands:

| Command | Does |
|---|---|
| `lol init` | Scaffold a `lol.config.json`. |
| `lol up` / `lol serve` | Ensure each Ollama host is reachable, pull configured models, generate the LiteLLM config from `lol.config.json`, start LiteLLM, start the discovery beacon. |
| `lol models ls` / `lol models add <id>` / `lol models pull` | Manage the served model catalog (wraps `ollama pull` on each host). |
| `lol status` | Health of each Ollama host + the proxy + which models are loaded. |
| `lol down` | Stop the proxy + beacon. |

Notes:
- The CLI **generates** the LiteLLM `config.yaml` (each Ollama host becomes a deployment of the
  same `model_name`, e.g. `gemma4:12b`, so LiteLLM load‑balances + fails over). LOL never hand‑edits
  routing; it's derived from `lol.config.json`.
- Model choice = edit `models` (or `lol models add`) + `lol up`. Clients see the catalog via the
  endpoint's `/v1/models`; OWUI's model picker handles per‑chat selection.
- Prereqs (documented in `server/README`): Ollama installed per box; LiteLLM available (pip/binary).
  The CLI spawns/supervises them; it doesn't reimplement them.
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

**Preferences panel** (LOL‑owned, ComfyQ‑styled), sections:
- **Data location** — show the current `DATA_DIR`; "Change folder…" (Electron `dialog.showOpenDialog`).
  On change: offer to **move existing data** to the new folder or start fresh, then restart the sidecar
  pointing at the new `DATA_DIR`. Default to a sensible per‑user app‑data path.
- **Connection** — auto‑discovered farm(s) with status dots; a manual "Add by address" field +
  chips (ComfyQ pattern); a "Refresh / rescan" button; optional subnet "search range". Lets the user
  pick which farm if several are found.
- **Startup & updates** — launch at login; auto‑update channel/toggle (electron‑updater); show
  current shell version + bundled Open WebUI version.
- **About** — LlmOnLan version, bundled Open WebUI version, and explicit "Powered by Open WebUI"
  attribution + link.

Model selection is intentionally **not** here — the farm catalog is set by the `lol` CLI, and per‑chat
model choice lives in Open WebUI's own picker.

---

## Discovery (ComfyQ‑style UDP beacon — not mDNS)

Adapted from ComfyQ's `beacon.js`. The **farm** broadcasts; the **client** listens. Chosen over
mDNS because ComfyQ proved multicast alone is flaky across consumer APs, and this is dependency‑free
(Node `dgram`).

- **Farm side (`lol` CLI):** every `intervalSec` (default 5s) send a small JSON snapshot
  `{ name, endpoint, proxyPort, models, healthy, version }` to **(a)** a multicast group, **(b)** each
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

Stack: **electron‑builder** (^25) + **electron‑updater** (^6) + Electron ^42, Node 22. Self‑updating on
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
files: [main.js, preload.js, renderer/**, assets/**]   # plus the bundled OWUI sidecar
directories: { output: dist }
afterPack: scripts/afterPack.cjs          # ad-hoc code-signs the macOS .app (no Apple cert)
publish:
  provider: github
  owner: <your-org>
  repo: LlmOnLan
  releaseType: release                    # drafts are ignored by the updater
win:   { target: nsis, icon: assets/icon.png }
mac:
  target:
    - { target: dmg, arch: [arm64, x64] }
    - { target: zip, arch: [arm64, x64] } # zip REQUIRED for latest-mac.yml (auto-update)
  identity: null                          # electron-builder skips signing; afterPack does ad-hoc
  hardenedRuntime: false                  # ad-hoc + hardened fails to launch
  icon: assets/icon.png
linux: { target: AppImage, icon: assets/icon.png }
nsis:  { oneClick: true, perMachine: false }   # per-user → silent updates, no UAC prompt
```

CI `.github/workflows/release.yml`: on `v*` tag → matrix `[windows-latest, macos-latest, ubuntu-latest]`
→ `npm ci` in `shell/` → `npx --no-install electron-builder --publish always` with
`GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` (public repo → updater needs no token).

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
    main/                #   supervisor, discovery (beacon listener), config-bridge, store
    preload/
    renderer/            #   topbar + webview host + settings UI; tokens.css (ComfyQ palette)
    assets/              #   icon.png / icon.svg
    scripts/             #   release.mjs, afterPack.cjs (adapted from ComfyQ)
    electron-builder.yml
  sidecar/               # packaging of the pinned, UNMODIFIED Open WebUI
    OPENWEBUI_VERSION    #   single source of truth for the pin
    build-sidecar.*      #   fetches OWUI at the pin + bundles a self-contained executable
  farm/                  # the `lol` CLI (Node) + beacon — the backend, NOT shipped to clients
    bin/lol              #   CLI entry
    beacon.js            #   adapted from ComfyQ server/federation/beacon.js
    litellm/             #   generated config.yaml lives here at runtime
    README.md            #   prereqs (Ollama, LiteLLM) + usage
  .github/workflows/release.yml
  CLAUDE.md
  implementation_plan.md
```
`sidecar/` must never contain edited Open WebUI source — that enforces invariant #1 structurally.

---

## Data‑flow & privacy boundary

- **On the device:** every conversation, folder, prompt, document, and RAG vector (under `DATA_DIR`);
  embeddings computed locally.
- **Over the network:** only the chat context for a single completion, to the discovered farm endpoint.
  The farm is stateless.
- **Never sent anywhere:** documents for embedding (local model) and telemetry (off).

If a feature would move stored data off the device or send document contents to the farm, it breaks the
promise — flag it.

---

## Conventions & guardrails

**Do:** keep first‑party code in `shell/` and `farm/`; treat OWUI as an external product configured from
outside; re‑verify the config surface on each version bump; prefer the admin API for surgical config and
env for first‑run seeds; default to local‑only; apply ComfyQ tokens to shell surfaces only.

**Don't:** edit/fork/patch OWUI source; store user data server‑side or send documents to the farm; rebrand
or hide Open WebUI; inject CSS into the OWUI webview; enable OWUI's built‑in local inference; raise
client worker counts; reimplement features OWUI already has; reuse ComfyQ's multicast port (pick a distinct one).

## Out of scope (prototype)

Modifying/forking Open WebUI; a shared/central knowledge base (needs central storage — conflicts with the
local‑data invariant); custom auth/SSO/multi‑tenant admin; notarization/paid signing; reimplementing chat,
RAG, or model management.
