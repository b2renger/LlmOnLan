# Implementation Plan — LlmOnLan (LOL)

> Read `CLAUDE.md` first — the invariants (unmodified Open WebUI, local data, config via public
> surface only, upgrade‑is‑a‑version‑bump), the farm CLI/config spec, the ComfyQ visual tokens, the
> ComfyQ packaging recipe, and the UDP‑beacon discovery design all live there and constrain every
> milestone below.

## Goal

A desktop client bundling a **pinned, unmodified Open WebUI** that **auto‑connects to a LAN GPU farm**
running `gemma4:12b`, stores all data on the user's machine, looks like a sibling of ComfyQ, and
self‑updates on mac/win/linux. End‑user flow: install → open → chat. No URL, no config, no Docker.

**Success criteria**
- Non‑technical user installs one package and is chatting within a minute on the office Wi‑Fi.
- All chats/folders/documents/vectors live only on the user's device, in a folder they can choose.
- The farm load‑balances across boxes and survives a node dying mid‑chat; models are chosen via the `lol` CLI.
- Shell chrome matches ComfyQ's look; the app self‑updates from GitHub Releases.
- Bumping the Open WebUI version is a one‑line change + rebuild, with **no LOL code changes**.

---

## Current status — shipped through v0.1.8 (2026‑07‑01)

**M0–M5 are all shipped; the app is packaged and self‑updating on Windows/macOS/Linux.** This is the
summary; the blow‑by‑blow (and every bug + fix) lives in [docs/DEVLOG.md](docs/DEVLOG.md).

**Working end‑to‑end**
- **Small installer** (~97 MB Win) that **downloads the OWUI sidecar on first run** (no longer bundled), then
  **self‑updates** from GitHub Releases (electron‑updater). App at **v0.1.8**; OWUI pinned at **0.10.2**.
- **Zero‑config connect**: UDP beacon + subnet sweep + manual add; the client auto‑points OWUI at a
  discovered farm (sticky, with a last‑known‑good / env fallback).
- **Farm**: `lol up` ensures Ollama, pulls the model, generates + runs the LiteLLM proxy, and beacons. Model
  pinned to **`gemma4:12b`** — natively multimodal (vision + audio + tools) and fits a 12 GB RTX 4070.
- **Full multimodal**: **image understanding** + **voice** (mic → local faster‑whisper STT → chat →
  client‑side Web‑Speech TTS), all on the client, no cloud, no farm audio load. Vision is on by default.
- **In‑app OWUI updates**: About → *Check for chat‑engine update* → download → apply on restart. The app is
  the **single source of truth** for the OWUI version (OWUI's own upstream toast is disabled).

**Troubles we hit + fixed** (each detailed in the DEVLOG)
- **Chat auth race** — OWUI first‑painted before its auto‑login token landed (sparse features + 401 on chat)
  → overlay‑until‑authed + token‑validated reload.
- **Vision broke in *two* layers** — LiteLLM's `drop_params` silently **stripped images** from any model it
  didn't know was vision‑capable (all our Ollama tags), *and* OWUI defaults OpenAI‑connection models to
  **vision‑OFF** (so it sent a `<file>` RAG reference, not pixels). Fixed with per‑model `supports_vision` in
  the generated LiteLLM config **and** `DEFAULT_MODEL_METADATA={"capabilities":{"vision":true}}`. Diagnosed
  layer‑by‑layer on the box: Ollama saw the image, the old proxy dropped it, the fixed proxy described it.
- **Voice did nothing** — the Electron `<webview>` was never granted microphone permission (Electron denies
  media by default) → `setPermissionRequestHandler` on the OWUI partition.
- **Misleading "new OWUI version" toast** — OWUI's built‑in *upstream* check disagreed with our "up to date"
  button (which tracks the version *we* package) → `ENABLE_VERSION_UPDATE_CHECK=false`; we ship OWUI updates.
- **Packaging/CI** — webview sized by flex not `%` (guest viewport stuck at 150 px → black bar); Linux CUDA
  `torch` bloat (swap CPU wheel + drop nvidia deps); Windows `tar` drive‑colon; `npm version` skipping its
  git tag; CI publish race → pre‑create release + `gh release upload --clobber`.

---

## Architecture

```
  ┌──────────────────── user's machine ─────────────────────┐
  │  LOL shell (Electron/TS)  — ComfyQ-styled chrome         │
  │   topbar · settings (data folder, connection, updates)   │
  │   beacon listener · config-bridge · sidecar supervisor   │
  │   └─ embeds <webview> ──────────────┐                    │
  │  Open WebUI sidecar (pinned, UNMOD) │  DATA_DIR (local,   │
  │   all chats/folders/docs/vectors    │  user-chosen)       │
  └─────────────────│ chat completions only │────────────────┘
                    ▼
        ┌──── LAN ──────────────────────────────────────────┐
        │  `lol` CLI on GPU box(es):                         │
        │   UDP beacon  ──► announces { endpoint, models }   │
        │   LiteLLM proxy (one OpenAI endpoint, balanced)    │
        │     ├─ Ollama #1 (gemma4:12b)                      │
        │     └─ Ollama #N (gemma4:12b)                      │
        └────────────────────────────────────────────────────┘
```

---

## Locked decisions (do not relitigate)

- Client shell: **Electron + TypeScript**; main area is a webview onto local Open WebUI.
- Chat app: **Open WebUI, unmodified + pinned** — we inherit all features; we don't hide it's OWUI.
- **Local data + local embeddings**; the data folder is **user‑selectable**. Inference only → farm.
- Backend: **`lol` Node CLI** reading **`lol.config.json`**; orchestrates **Ollama + LiteLLM**; model `gemma4:12b`. Model choice lives in the config/CLI.
- Discovery: **ComfyQ‑style UDP beacon** (multicast + directed/limited broadcast) + subnet sweep + manual add. Distinct multicast port from ComfyQ.
- Visual language: **ComfyQ tokens** on shell surfaces only (no CSS injection into OWUI).
- Packaging/auto‑update: **electron‑builder + electron‑updater + GitHub Releases + GH Actions matrix**, ad‑hoc mac signing (ComfyQ recipe).

---

## Open questions to resolve early

1. **Config‑injection mechanism for the pin** (M1): confirm env seeds first‑run connection and the admin
   REST API can update it later (endpoint + auth under `WEBUI_AUTH=false`). Fallback `ENABLE_PERSISTENT_CONFIG=false`.
2. **Sidecar packaging** (M0/M6): PyInstaller vs uv‑bundled interpreter for a self‑contained OWUI executable per OS.
3. **Discovery on the target Wi‑Fi** (M3): confirm directed broadcast reaches clients; if the network blocks it, lead with the baked‑in stable address.
4. **LiteLLM runtime** (M2): native process vs container on the GPU boxes (nvidia toolkit?). Pick the simplest the operator can run.

---

## Milestones

### M0 — Skeleton & separation proof
**Goal:** Prove unmodified‑OWUI‑in‑a‑shell works end to end, with ComfyQ chrome from day one.
- **In:** Electron + TS app boots; `sidecar/build-sidecar` fetches OWUI at a pin and bundles it; shell
  spawns the sidecar with a local `DATA_DIR`, waits for health, loads it in a webview; topbar + `tokens.css`
  applied; connection set to **one hardcoded** endpoint.
- **Out:** discovery, farm CLI, preferences, installers.
- **Deliverables:** running dev app; `sidecar/OPENWEBUI_VERSION`; documented env set; `tokens.css`.
- **Acceptance:** OWUI runs in the shell with **zero source edits**; a chat completes against the endpoint;
  chat data lands under the local `DATA_DIR` (verify on disk); shell chrome matches ComfyQ palette/typography.
- **Risks:** packaging the Python sidecar — timebox a spike first.

### M1 — Config bridge (own the connection cleanly)
**Goal:** The shell owns the inference endpoint via OWUI's public surface; the value lives in one place.
- **In:** env seed on first run; on‑launch reconcile via admin REST API (or `ENABLE_PERSISTENT_CONFIG=false`
  if the API proves impractical); verify across restarts and when the endpoint changes.
- **Deliverables:** `config-bridge` module; documented decision; the verified config surface updated in `CLAUDE.md` for the pin.
- **Acceptance:** changing the endpoint in one place repoints OWUI with **no OWUI edits**; a changed endpoint is honored next launch (no stale persisted URL winning).
- **Risks:** Gotcha #1 (persisted‑URL precedence); admin auth in single‑user mode.

### M2 — Farm CLI & config (`lol`, npm‑style)
**Goal:** One command brings up a model‑serving, balanced, discoverable farm from a declarative config.
- **In:** `lol.config.json` schema; `lol init/up/down/status/models`; the CLI ensures Ollama hosts, pulls
  `gemma4:12b`, **generates** the LiteLLM `config.yaml` (each host = a deployment of one model_name →
  load‑balance + failover), starts LiteLLM, applies Ollama concurrency env (`OLLAMA_NUM_PARALLEL`, etc.).
- **Out:** the beacon (M3) beyond a stub; autoscaling.
- **Deliverables:** `farm/` CLI + `server/README` (prereqs + usage); a sample `lol.config.json`; generated LiteLLM config.
- **Acceptance:** `lol up` on a box → `/v1/models` lists `gemma4:12b` → a client (or curl) gets completions through LiteLLM; `lol models add` + `lol up` changes the served catalog; killing one Ollama host fails over via LiteLLM.
- **Risks:** LiteLLM runtime/prereqs on GPU boxes; under‑provisioning (size by concurrent in‑flight generations, not headcount).

### M3 — LAN discovery (ComfyQ beacon) + connection UX
**Goal:** Remove the last manual step — the client finds the farm by itself.
- **In:** Farm beacon (adapt ComfyQ `beacon.js`): JSON snapshot `{name, endpoint, proxyPort, models, healthy, version}`
  to multicast + each interface's directed broadcast + limited broadcast, deduped; distinct port from ComfyQ.
  Client beacon listener → discovered‑farms list → feeds the config‑bridge. Fallback chain: baked‑in stable
  address → last‑known‑good → manual add‑by‑address (chips) → subnet sweep (search range), mirroring ComfyQ's controls.
- **Deliverables:** beacon in `farm/`; listener + connection screen in the shell (ComfyQ‑styled).
- **Acceptance:** fresh install on the Wi‑Fi → open → chatting, **no URL typed**; when broadcast is blocked, the app degrades to a clear fallback, not a dead end; multiple farms can be chosen between.
- **Risks:** enterprise Wi‑Fi client/AP isolation/VLANs block broadcast — hence the stable‑address fallback.

### M4 — Client shell UX & preferences (incl. data‑folder)
**Goal:** A polished, ComfyQ‑consistent client with the settings users actually need.
- **In:** topbar (logo + connection status + theme toggle + gear); Preferences panel — **Data location**
  (current `DATA_DIR`, "Change folder…" via `dialog.showOpenDialog`, with move‑existing‑data‑or‑start‑fresh on
  change and a sidecar restart), **Connection** (discovered farms, manual add, rescan, search range),
  **Startup & updates** (launch at login, update channel/toggle, version display), **About** (LOL version +
  bundled OWUI version + "Powered by Open WebUI"); light/dark theme; shell config store (`electron-store`).
- **Out:** model selection (stays in OWUI + the `lol` config).
- **Deliverables:** preferences UI; data‑folder change + migration flow; persisted shell settings.
- **Acceptance:** user picks a custom data folder and existing chats follow (or a clean start, their choice); the app reconnects/repoints without manual URL work; settings persist across restarts; visuals match ComfyQ.
- **Risks:** data‑migration edge cases (folder in use, partial copy) — make it transactional and reversible.

### M5 — Packaging & auto‑update (ComfyQ recipe)
**Goal:** The one‑click, self‑updating install promise becomes real on all three OSes.
- **In:** `electron-builder.yml` (LOL appId/owner/repo) bundling shell **+ the OWUI sidecar**; `scripts/release.mjs`
  + `scripts/afterPack.cjs` (ad‑hoc mac sign); `.github/workflows/release.yml` matrix (win/mac/linux) →
  `electron-builder --publish always`; electron‑updater auto‑update from GitHub Releases; mac dmg+zip arm64+x64;
  NSIS per‑user oneClick; AppImage; first‑run handling of the local embedding‑model download.
- **Out:** notarization / paid code‑signing (future hardening).
- **Deliverables:** installers for all three OSes; an install one‑pager; CI that builds the sidecar from the pin.
- **Acceptance:** double‑click installer → working app, data local, connected on the Wi‑Fi; a published `vX.Y.Z`
  auto‑updates an installed app; **the upgrade test passes** (bump `OPENWEBUI_VERSION` + rebuild → works, no LOL code changed).
- **Risks:** installer size (bundled Python); first‑run model download latency; unsigned‑app OS warnings (documented; right‑click→Open on mac).

### M6 — Hardening & polish (optional / later)
- Real Apple notarization + Windows signing (removes OS warnings); multi‑farm switching polish; connection/health
  indicators; richer `lol status`. **Out:** any shared/central knowledge base (conflicts with the local‑data invariant unless deliberately reconsidered).

---

## Load balancing across boxes & clients (how it works today, and the gap)

There are **two independent layers** — keep them straight:

**Layer 1 — within one farm, across Ollama hosts (works, with failover).**
`lol.config.json`'s `ollama.hosts: [...]` can list many Ollama endpoints (the local box + remote GPU boxes).
`writeLitellmConfig` emits one LiteLLM *deployment* per `model_name × host`; the router (`simple‑shuffle`)
spreads each request randomly across them, retries on other deployments (`num_retries: 3`), and ejects a dead
host for 60 s (`allowed_fails: 1`, `cooldown_time: 60`). So **one farm pointed at N Ollama boxes = real load
balancing + HA**. Prereq: each remote box runs `ollama serve` bound to the LAN (`OLLAMA_HOST=0.0.0.0`) with the
concurrency env set; `lol up` only auto‑starts a *local* Ollama, never a remote one.

**Layer 2 — across independent farms, across clients (this is the gap).**
If each GPU box runs its own `lol up`, every box is a *separate* farm with its own LiteLLM + beacon. The client
picks **one** farm — pinned, else sticky‑current, else **first healthy** (`chooseActive` in
[shell/src/main/index.ts](shell/src/main/index.ts)) — and sends all its traffic there. There is **no automatic
spreading of clients across farms**: if every client discovers farms in the same order, they all land on the
same "first healthy" one and saturate it while the others sit idle. The only control today is manually pinning
each client to a different farm.

**Capacity note.** One Ollama serves `OLLAMA_NUM_PARALLEL` (default **2**) concurrent generations before
queueing; `OLLAMA_MAX_LOADED_MODELS=1`. A box's real ceiling is ~2 simultaneous chats — **size the fleet by
concurrent in‑flight generations, not headcount**, and raise `numParallel` where VRAM allows.

**Recommended today:** for multiple boxes, run **one coordinator farm** whose `ollama.hosts` lists every GPU
box, and let all clients auto‑discover that single farm — LiteLLM then balances every request across the whole
fleet with failover (Layer 1). Trade‑off: the coordinator box is a single point of coordination.

## What's next (roadmap)

**✅ Shipped (2026‑07‑01) — multi‑box load balancing (was items 1–3):**
1. **Least‑loaded client selection** — `pickLeastLoaded` (`shell/src/main/index.ts`) picks the lowest‑GPU‑util
   healthy farm from the telemetry the beacon already carries, scattering ties randomly (15‑pt band) so a fleet
   booting at once doesn't stampede one box. Only at connect/failover; a healthy current farm stays sticky.
2. **Coordinator farm** — `lol up --coordinator` (or `coordinator:true`) discovers peers (new
   `farm/src/peerListener.js`) and folds each into the LiteLLM config as an `openai/<model>` deployment, so one
   endpoint balances the whole fleet; it advertises `coordinator:true` and clients prefer it. Static at boot.
3. **`lol fleet`** — CLI view of every farm on the LAN (load, VRAM, hosts, backends, loaded models, role).

**Still open (ordered by value / effort):**
4. **More models.** The catalog + beacon already support multiple models; add e.g. `qwen2.5‑coder` for code
   and let users pick in OWUI. Mind `OLLAMA_MAX_LOADED_MODELS` / VRAM — model swaps cost latency.
5. **Voice polish.** Optionally bundle a local neural TTS (Piper/Kokoro) for nicer voices than Web‑Speech;
   surface the first‑run Whisper download; explore gemma4's native **audio** capability for spoken input.
6. **Dynamic coordinator membership.** Today the coordinator captures peers at boot (a box added later → restart).
   Live add/remove needs either a debounced proxy restart or LiteLLM's `/model/new` admin API (which needs a
   master key → would force keys on clients). Revisit if fleets churn often.
7. **Fleet view in the client UI.** Surface the `coordinator` badge + per‑farm load in the connection screen
   (the data's already on `DiscoveredFarm`); a GUI sibling to `lol fleet`.
8. **Hardening (M6).** Apple notarization + Windows signing (kill SmartScreen/Gatekeeper warnings);
   model keep‑warm to cut cold‑start; a real multi‑box load test.
9. **Keyed farms.** If proxy auth is wanted, build the key‑entry UX (today a `requiresKey` farm gets a null key).

---

## Cross‑cutting risks & mitigations

- **OWUI config‑surface drift across versions.** → Re‑verify on every bump; coupling only via env + admin API; the upgrade test catches breakage.
- **Broadcast blocked on managed Wi‑Fi.** → Stable‑address fallback can replace discovery; ship manual add + subnet sweep.
- **Beacon collision with ComfyQ on the same LAN.** → Use a distinct multicast group/port (CLAUDE.md).
- **Installer weight / first run.** → One‑time local embedding‑model download; never switch embeddings to the farm; consider Tauri later if size hurts.
- **Local Chroma not fork‑safe.** → Single worker in the client, always.
- **Farm under‑provisioning.** → Size by concurrent in‑flight generations; load‑test in M2/M3.
- **Unsigned‑app warnings.** → Ad‑hoc mac sign now (no "damaged"); document the bypass; notarize later (M6).
- **License creep.** → Keep Open WebUI branding; no enterprise license needed at any user count.

---

## Testing strategy

- **Smoke (per build):** shell boots → sidecar healthy → webview loads → one chat completes against the farm → data appears under `DATA_DIR`.
- **The upgrade test (prime‑directive guard):** bump `OPENWEBUI_VERSION`, rebuild sidecar, run smoke. **Pass = no LOL code changed and everything works.** Failure = separation leak; redesign, don't patch.
- **Discovery test:** with broadcast working the client connects automatically; with it blocked, the fallback path connects cleanly; two farms → user can choose.
- **Failover test:** kill a farm Ollama host mid‑stream; the client recovers via LiteLLM.
- **Locality test:** upload a document + build a knowledge base; confirm vectors/files are on the device and no document content was sent to the farm (only chat context at request time).
- **Data‑folder test:** change `DATA_DIR` to a new folder; verify migrate‑or‑fresh works and the sidecar restarts cleanly.
- **Auto‑update test:** publish a higher `vX.Y.Z`; an installed app updates itself on next launch (mac zip present, NSIS per‑user, AppImage).
- **Visual test:** shell chrome matches ComfyQ tokens/typography in light + dark.
