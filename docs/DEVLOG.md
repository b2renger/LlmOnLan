# DEVLOG — LlmOnLan

A running, dated log of what was built, how it was tested, and decisions taken. Newest first.
Each milestone lands as one (or a few) granular commits; an entry here is written **before** the
commit so the history records that a feature was tested + documented before it was pushed.

---

## 2026-06-29 — Adversarial review pass (correctness fixes)

A fresh-eyes adversarial review of the highest-logic code (shell main process + farm CLI) surfaced
real bugs; the genuine ones are fixed (the reviewer's "reviewed-OK / not-a-bug" items were left alone):
- **Sidecar restart races (HIGH)** — a crash auto‑restart could race a `repoint()`/`stop()` and orphan
  or duplicate an OWUI process. [sidecar.ts](../shell/src/main/sidecar.ts) now uses a **generation
  counter** (every `start()`/`stop()` bumps it; an in‑flight `start()` aborts at its awaits when
  superseded) + **child‑identity** comparison in the exit handler (only the current child's unexpected
  exit restarts), and `start()` reaps any existing child before spawning.
- **`lol down` orphaned a spawned Ollama (HIGH)** — [up.js](../farm/src/commands/up.js)'s child‑exit
  handler killed `oll.spawnedPids` **without awaiting** before `process.exit`. Now it awaits the kills
  and also tears down the health timer + beacon + self‑server first.
- **Dead `requiresKey ? null : null` ternary** — [index.ts](../shell/src/main/index.js) cleaned up;
  documented that keyed farms need a key‑entry UX we haven't built (so we don't send a wrong placeholder).
- **Discovery kept working after `stop()`** — [discovery.ts](../shell/src/main/discovery.js) added a
  `stopped` flag (checked in `sweep`/`pollKnown`/socket message) and tracks the socket‑reconnect timer so
  a stopped Discovery can't re‑emit or leak a bound socket.
- **No‑farm boot could reach public OpenAI** — [configBridge.ts](../shell/src/main/configBridge.js) now
  sets `ENABLE_OPENAI_API=false` when there's no farm endpoint (privacy intent: only the farm).
- **Stale webview after a same‑port repoint** — [app.js](../shell/renderer/app.js) forces a webview
  reload on the restarting→ready transition even when the URL is unchanged.
- **Overlapping health ticks** — up.js's health interval now skips a tick if the previous probe round is
  still running.

**Tested:** shell `tsc` clean; farm 10/10 unit tests; data‑migration 9/9; and a fresh smoke launch shows
**no regression** — discovery → OWUI spawned at the discovered endpoint → ready, pill reads "Dev Box
Farm" (active‑farm match intact after the lifecycle rewrite).

---

## 2026-06-29 — M5: packaging + auto-update (electron-builder + GitHub Releases)

**What:** The self‑updating, one‑click install path (ComfyQ recipe, with the brief's §6 corrections).
- [`electron-builder.yml`](../shell/electron-builder.yml) — `com.llmonlan.client` / **LlmOnLan**; the
  bundled sidecar rides via **`extraResources`** (`../sidecar/build/sidecar` → `resources/sidecar/`,
  outside `app.asar` so it's executable); **win** NSIS `oneClick` + `perMachine:false` (silent per‑user
  updates, no UAC); **mac** `dmg` **+** `zip` for both arches (zip is required for Squirrel.Mac
  auto‑update) with ad‑hoc signing (`identity:null`, `hardenedRuntime:false`); **linux** AppImage;
  `publish: github b2renger/LlmOnLan releaseType:release`.
- [`scripts/afterPack.cjs`](../shell/scripts/afterPack.cjs) — macOS ad‑hoc `codesign --sign -` so the
  app isn't flagged "damaged" (no‑op elsewhere).
- [`scripts/release.mjs`](../shell/scripts/release.mjs) — `npm version --no-git-tag-version`, then commits
  ONLY the version files, makes an annotated `vX.Y.Z` tag, and pushes `--follow-tags` (the npm‑tagging‑is‑
  unreliable workaround); guarded to `main` + a clean tree. `release:patch|minor|major` scripts.
- [`updater.ts`](../shell/src/main/updater.js) — **electron‑updater 6.8.9** (a real runtime dep), wired
  in `index.ts`: checks on launch when enabled + packaged, downloads in the background, installs on quit;
  a no‑op in dev. The Preferences auto‑update toggle starts a check when flipped on.
- [`.github/workflows/release.yml`](../.github/workflows/release.yml) — on a `v*` tag, matrix
  `[windows, macos, ubuntu]` each builds the OWUI sidecar for its OS then runs
  `electron-builder --publish always` (`contents: write`, `CSC_IDENTITY_AUTO_DISCOVERY=false`).

**Tested:** `electron-updater@6.8.9` + `electron-builder@26.15.3` install clean (0 vulnerabilities); tsc
builds with the updater wiring. **`electron-builder --dir`** (against a stub sidecar) **packaged a real
`dist/win-unpacked/LlmOnLan.exe`** — confirming the config parses, the app packages, `afterPack` runs,
and `extraResources` places the sidecar at exactly `resources/sidecar/{launcher.py, python/}` where
`resolveSidecarCommand()` looks. `release.mjs`/`afterPack.cjs`/`build-sidecar.mjs` syntax‑check clean;
`release.yml` is valid YAML. The full installer (NSIS/dmg/AppImage) + the publish‑to‑Releases +
auto‑update cycle run in CI on a version tag — that's the upgrade test, not a single‑session step.

---

## 2026-06-29 — M0 (sidecar packaging): bundle the pinned OWUI

**What:** The build path that turns the pin into a self‑contained, shippable sidecar.
- [`OPENWEBUI_VERSION`](../sidecar/OPENWEBUI_VERSION) `= 0.10.1` — the single source of truth.
- [`launcher.py`](../sidecar/launcher.py) — drives OWUI's Typer app (`open_webui:app`) via argv, so the
  invocation is **path‑independent** (no pip console‑script shebang that breaks once the installer
  relocates the bundle). There is **no `python -m open_webui`** in 0.10.1, hence the launcher.
- [`build-sidecar.mjs`](../sidecar/build-sidecar.mjs) (+ `.sh`/`.ps1` wrappers) — downloads a relocatable
  **standalone CPython** (astral‑sh/python‑build‑standalone, latest release matched via the GitHub API
  so no tag rots), `pip install open-webui==<pin>` into it, drops in `launcher.py`, and stages
  `sidecar/build/sidecar/` (fixed name → same `extraResources from` on every OS). Chosen over PyInstaller
  because OWUI's built SvelteKit frontend + data files + torch/chromadb make a one‑file build fragile;
  a real interpreter with the package installed is the reliable path.
- [`resolveSidecarCommand`](../shell/src/main/paths.ts) updated: packaged runs
  `resources/sidecar/python(.exe) resources/sidecar/launcher.py serve --host --port`; dev keeps the
  `.venv` console script.
- [`sidecar/README.md`](../sidecar/README.md) documents the approach + the **upgrade test** (bump the
  pin → re‑build → smoke; pass = no LOL code changed).

**Tested:** the load‑bearing mechanism — **`python launcher.py serve` boots OWUI** (`/health` →
`{"status":true}`) against the existing self‑contained Python — is verified. The full multi‑GB
standalone‑Python bundle build (download + `pip install torch/…`) is heavy and runs on **CI / the build
machine**, not in this session; the script is written to be CI‑run (it's exercised by the release
workflow). This is the milestone the plan explicitly flags as a packaging spike.

---

## 2026-06-29 — M4: Preferences (data folder + connection + startup/updates + about)

**What:** A LOL‑owned, ComfyQ‑styled Preferences modal (the gear), with the four sections the plan
calls for.
- **Data location** — shows the current `DATA_DIR` (with a "(default)" tag), "Change folder…" via the
  native `dialog.showOpenDialog`. On change, if the old folder has data, the user chooses **Move my
  data** or **Start fresh**; the sidecar is stopped, the data copied (then the old removed), settings
  updated, and the sidecar restarts pointed at the new folder.
- **Connection** — auto‑search toggle, Rescan, a **subnet search‑range editor** (base + 3rd/4th octet
  from–to, defaulting to the machine's own subnet), Add‑by‑address, and removable manual‑peer chips —
  the richer counterpart to the topbar popover, all driving the M3 discovery module.
- **Startup & updates** — launch‑at‑login (`app.setLoginItemSettings`), an auto‑update toggle (the
  updater itself lands in M5), and version display.
- **About** — LlmOnLan version (`app.getVersion()`) + bundled Open WebUI version (read from
  `sidecar/OPENWEBUI_VERSION`, the single source of truth) + a "Powered by Open WebUI" link.
- Main: new module [dataMigration.ts](../shell/src/main/dataMigration.ts) (transactional copy‑then‑remove,
  reversible on failure, with self‑containment guards), `bundledOwuiVersion()` in paths, and IPC
  `get-prefs`/`choose-data-dir`/`set-data-dir`/`set-launch-at-login`/`set-auto-update`.

**Tested:** the modal renders all four sections (see [docs/img/m4-prefs.png](img/m4-prefs.png)) with the
data path, the search range **auto‑detected as `10.10.16–17.1–254`** (correctly spanning this /23 LAN),
versions (`v0.1.0` / `v0.10.1`), and the connected farm still shown in the pill. The data‑migration
helper has a focused unit test — **9/9** covering copy‑to‑dest, nested files, src‑removed‑after‑move,
copy‑leaves‑src, the refuse‑dest‑inside‑src guard, and empty‑src. (The folder *pick* itself is a native
dialog, a manual interaction; the migration core that moves the data is what's unit‑tested.)

---

## 2026-06-29 — M3 (client half): LAN discovery + connection UX (no URL typed)

**What:** The shell now finds the farm itself and points OWUI at it — zero config.
- **Discovery module** ([discovery.ts](../shell/src/main/discovery.ts), ported from ComfyQ's desktop
  discovery) — merges three sources into one farm map: (1) **UDP beacons** on `239.255.43.10:41998`,
  (2) **subnet sweep** probing `GET /lol/self` (the broadcast‑blocked‑LAN fallback), (3) **manual
  add‑by‑address**. Per‑farm staleness/TTL; de‑duped by farm `id` (survives DHCP IP changes).
- **Auto‑connect** ([index.ts](../shell/src/main/index.js)) — on first run, OWUI's boot waits a short
  grace period for discovery to surface a farm, then boots **pointed at the reachable LAN address**
  (`http://<reach-host>:<proxyPort>/v1`); `onFarms` keeps it repointed as the LAN changes. Pick logic
  is sticky (pinned choice → current‑if‑good → first healthy) to avoid flapping between equivalents.
- **Connection UX** ([renderer](../shell/renderer/)) — the topbar status pill shows the connected farm
  name (green) and opens a **connection popover**: the discovered‑servers list (health dot · source tag ·
  `host:port · models` · active checkmark, click to switch), an **Add by address** field, an
  **Auto‑search the subnet** toggle, and **Rescan** — mirroring ComfyQ's controls.
- IPC + persistence: `get-farms`/`select-farm`/`add|remove-manual-peer`/`set-auto-scan`/`set-scan-range`/
  `rescan`; manual peers, auto‑scan, scan range, and the pinned farm persist to shell settings;
  `lastEndpoint` is remembered as the pre‑discovery fallback.

**Tested — the actual app (see [docs/img/m3-discovery.png](img/m3-discovery.png)):** launched with **no
`LOL_ENDPOINT`**. Logs show `[discovery] listening 239.255.43.10:41998` and the sidecar spawning with
`endpoint=http://10.10.16.58:4000/v1` — i.e. it **discovered the farm and auto‑pointed OWUI at the LAN
address** with nothing typed. The capture shows the pill reading **"Dev Box Farm"** and the popover
listing it (BEACON source, `10.10.16.58:4000 · gemma4`, active ✓) with the add/rescan fallbacks. The
sweep + manual‑add paths reuse the same `/lol/self` fetch verified in the M3 farm half.

---

## 2026-06-29 — M0 + M1: Electron shell skeleton + config‑bridge (OWUI runs in the shell)

**What:** Built the client shell (`shell/`, Electron + TypeScript) and proved the prime‑directive
separation: an **unmodified** Open WebUI runs inside our chrome, pointed at the farm purely through
env vars.
- **Sidecar supervisor** ([sidecar.ts](../shell/src/main/sidecar.ts)) — spawns
  `open-webui serve --host 127.0.0.1 --port <free>` with the config‑bridge env, health‑waits on
  `/health`, auto‑restarts on crash (bounded), and `repoint()`s by restarting with a new endpoint.
- **config‑bridge** ([configBridge.ts](../shell/src/main/configBridge.ts)) — the ONLY module that
  knows OWUI's surface (M1). Strategy: **env‑authoritative** (`ENABLE_PERSISTENT_CONFIG=false`) so a
  changed farm URL is honored every launch with no stale persisted URL winning; `ENABLE_OLLAMA_API=false`;
  `DATA_DIR` local; default local embeddings (RAG engine unset); `WEBUI_AUTH=false`; telemetry off;
  branding untouched. *(HF model cache left at its default `~/.cache/huggingface` — shared across data
  folders so changing DATA_DIR doesn't re‑download the embedding model; still 100% local.)*
- **Shell chrome** — `renderer/` topbar (logo + connection‑status pill + theme toggle + gear) over a
  `<webview>` of the local OWUI, with a connection overlay until the sidecar is `ready`. ComfyQ
  `tokens.css` (verbatim) + light/dark via `nativeTheme`. New LOL logo ([icon.svg](../shell/assets/icon.svg)
  → `icon.png`, rendered via a headless‑Chromium screenshot): a chat bubble holding a LAN node‑graph.
- **store.ts / paths.ts / util.ts** — JSON settings store, dev‑venv‑vs‑packaged sidecar resolution,
  free‑port / tree‑kill / health‑poll helpers.

**Tested — the actual app, end to end (see [docs/img/m0-shell.png](img/m0-shell.png)):** `tsc` builds
clean; launched via a new `LOL_SMOKE_SHOT` hook (boot → wait for OWUI → capture the window → quit).
The capture shows the LOL topbar (green **Ready** pill) over **Open WebUI 0.10.1 running unmodified in
the webview**, its own branding intact. Logs confirm OWUI auto‑provisioned `admin@localhost`
(`WEBUI_AUTH=false`), served its SvelteKit frontend, and ran `get_all_models()` against the configured
farm endpoint. The earlier sidecar spike confirmed all user data (webui.db, `vector_db/chroma.sqlite3`,
uploads) lands under the local `DATA_DIR` and embeddings load **locally** (MiniLM in‑process) —
invariant #3.

**M0 sidecar spike result:** `open-webui==0.10.1` installs on Python 3.12; the launch command is the
console script `open-webui serve --host --port` (NOT `python -m open_webui`, which 0.10.1 doesn't
expose; and `--port`, not a `PORT` env). It boots with the privacy env to `/health → {"status":true}`.

**Bugs/gotchas fixed:**
- **`ELECTRON_RUN_AS_NODE=1`** in this session's environment made Electron run as plain Node →
  `require('electron')` returns a path string → `app` undefined. Launch with `env -u ELECTRON_RUN_AS_NODE`
  (documented in the shell README).
- Forced `PYTHONUTF8=1` for the OWUI child too (same Windows cp1252 class of bug as LiteLLM).

**Decision — combined commit.** M0 (skeleton) and M1 (config‑bridge) ship together: the shell can't
boot OWUI without the bridge providing its env, so splitting would leave a non‑functional intermediate.
Both milestones' acceptance criteria are documented above.

---

## 2026-06-29 — M3 (farm half): UDP discovery beacon + `/lol/self`

**What:** The farm now announces itself on the LAN two ways, both fed by the one
`buildSnapshot()` so they can't drift (mirroring ComfyQ).
- **UDP beacon** ([beacon.js](../farm/src/beacon.js)) — adapted from ComfyQ's `beacon.js`. Every
  `intervalSec` it sends the snapshot to the multicast group on each interface **+** each interface's
  directed broadcast **+** the limited broadcast `255.255.255.255` (deduped), with
  `setBroadcast(true)` + `setMulticastTTL(4)`. Group `239.255.43.10:41998` — distinct from ComfyQ.
- **Unicast `/lol/self`** ([selfServer.js](../farm/src/selfServer.js)) — a tiny `http` server on
  `41997` returning the snapshot JSON (CORS‑open). This is the fallback for managed/school Wi‑Fi that
  blocks broadcast+multicast between clients (where the UDP beacon never arrives but unicast works) —
  the shell's subnet sweep / "add by address" will probe it.
- Wired both into `lol up` ([up.js](../farm/src/commands/up.js)): a shared `getSnapshot()` closure
  over a `liveHealth` object that a 15s timer re‑probes (proxy liveness + per‑host reachability +
  loaded models), then re‑kicks the beacon — so advertised health stays honest. `shutdown` stops the
  beacon + self‑server + timer.

**Tested:** built [tools/listen.js](../farm/tools/listen.js) (a standalone listener that also doubles
as the reference for the shell's M3 client half). With `lol up` running: `GET /lol/self` returned the
snapshot, and the UDP listener **received the beacon** from `10.10.16.58` with the full snapshot
(`models=gemma4 healthy=true hostsUp=1/1`). Syntax‑checked all new modules; 10/10 unit tests still green.

**Still pending for M3:** the client half (beacon listener + connection UX) lives in the shell, built
alongside M0/M1.

---

## 2026-06-29 — M2: the `lol` farm CLI (+ integration research)

**What:** Built the whole farm backend (`farm/`) — a dependency‑light Node CLI that turns one
declarative `lol.config.json` into a running, OpenAI‑compatible, load‑balanced inference farm.
- **Config** ([config.js](../farm/src/config.js)) — a strict `zod` schema with materialized defaults;
  beacon group defaults to `239.255.43.10` (distinct from ComfyQ's `239.255.42.99`, per the spec).
- **LiteLLM generation** ([litellm.js](../farm/src/litellm.js)) — emits `model_list` as
  *models × hosts*, so every Ollama host is a deployment of the same `model_name` →
  LiteLLM's router load‑balances + fails over. Routing is **derived, never hand‑authored**.
- **Ollama client** ([ollama.js](../farm/src/ollama.js)) — `/api/version|tags|ps|pull` over plain
  HTTP, no SDK. `hasModel` tolerates an implicit `:latest`.
- **Commands** — `init`, `up`/`serve`, `down`, `status`, `models ls|add|rm|pull`. `up` runs in the
  foreground and writes `.lol-runtime.json` so `status`/`down` work from another shell; `down` clears
  that file *before* killing so a foreground `up` recognizes an intentional stop and exits 0 quietly.
- **Snapshot** ([snapshot.js](../farm/src/snapshot.js)) — the discovery contract built once
  (shared by the M3 beacon + `/lol/self`), `v:1 { id, name, proxyPort, ips, openaiBaseUrl, models,
  healthy, … }`. The beacon itself is **deferred to M3** per the plan (M2 only logs it).

**Tested — end‑to‑end on the dev box, real inference:**
- `npm test` → 10/10 unit tests (config validation, models×hosts generation, snapshot, helpers).
- `lol init` scaffolds a config in a fresh dir (and refuses to clobber an existing one).
- `lol up` → Ollama detected, `gemma4` present (no pull), LiteLLM config generated, proxy healthy,
  `/v1/models` lists `gemma4`. **`POST /v1/chat/completions` returned a real completion** routed
  LiteLLM → Ollama → gemma4. `lol status` (separate shell) shows the live proxy + loaded model;
  `lol down` stops it cleanly and `up` exits 0.

**Bug fixed (Windows):** LiteLLM crashed on startup with `UnicodeEncodeError` — its box‑drawing
banner can't encode on a cp1252 Windows console. Fix: spawn the proxy with `PYTHONUTF8=1` /
`PYTHONIOENCODING=utf-8` ([proc.js](../farm/src/proc.js)). This is a real, load‑bearing fix for any
Windows operator.

**Research landed:** a multi‑agent web‑research + fact‑check workflow produced
[docs/INTEGRATION_BRIEF.md](INTEGRATION_BRIEF.md). Headline facts the later milestones depend on:
- **Pin `open-webui==0.10.1`** (Python 3.11/3.12 only; run `open-webui serve --host --port` — the
  `PORT` env is *not* honored). Branding kept → license rider imposes nothing at any scale.
- **Config gotcha**: OWUI's `OPENAI_*` are PersistentConfig — env seeds only the *first* boot, then
  the DB wins. Decision for M1: **bake env + `ENABLE_PERSISTENT_CONFIG=false`** so env is always
  authoritative (the kiosk move), and set `ENABLE_OLLAMA_API=false`. Admin REST `POST /openai/config/update`
  exists but still needs an admin token even under `WEBUI_AUTH=false`, and only sticks while persistent
  config is on — so env‑authoritative is simpler and matches invariant #4.

**Decision — beacon group `239.255.43.10:41998`** (UDP) + `httpPort 41997` for the unicast `/lol/self`
fallback, all distinct from ComfyQ so both tools coexist on one LAN.

---

## 2026-06-29 — Scaffold (repo structure + tooling)

**What:** Bootstrapped the empty repo into the layout `CLAUDE.md` prescribes.
- `.gitignore` — excludes `node_modules`, build output, Python venvs, the generated LiteLLM
  config, the `lol.config.json` runtime file (example is kept), and — critically — any local
  `DATA_DIR` / `*.db` / `*.sqlite` so OWUI user data can **never** be committed (invariant #3).
- Root `README.md` — project overview, the three pieces, the prime directive, quick starts.
- `docs/DEVLOG.md` (this file) — the running build log.

**Environment confirmed on the dev box (Windows 11):**
- Node 24.14, npm 11.9 · Ollama 0.30.11 running on `127.0.0.1:11434` with `gemma4:latest` (9.6 GB).
- Python 3.12.10 available (used for LiteLLM + the OWUI sidecar; 3.14 is too new for OWUI).
- `gh` 2.92 authed to `b2renger/LlmOnLan`.

**Decision — work on `main`, granular commits.** This is a greenfield bootstrap, so per the
owner's "do everything in one path" direction the build proceeds on `main` with one tested +
documented commit per milestone (rather than per-feature PRs), so `git log` reads as the
milestone history.

**Tested:** structure only; nothing executable yet.

---
