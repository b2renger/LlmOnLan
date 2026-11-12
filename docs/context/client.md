# The client shell: Open WebUI's host, LOL Vibe and the IDE

> Moved verbatim from CLAUDE.md on 2026-11-12 (the split into context modules). It describes `main` unless a line
> names a release or says *not released yet*. Keep it true: a change to the code it describes changes this file in the same commit.

- **`shell/`** (Electron + TS; its version is the build status's) — boots the **unmodified** OWUI sidecar (config-bridge =
  env-authoritative, `ENABLE_PERSISTENT_CONFIG=false`), discovers the farm and auto-connects with **no
  URL typed**, full Preferences (data folder + move/fresh migration, connection, assistant tools, Home Assistant,
  startup/updates, about). **Adaptive RAG**: whole-document injection (`RAG_FULL_CONTEXT=true`) on farms
  advertising `backend.contextPerSlot ≥ 24576` (or not advertising it), classic top-k (`RAG_TOP_K=8`) below —
  so a 16k farm can't context-overflow on an attachment; **document search on the farm** (2026-10-08,
  `configBridge.ts` `EMBEDDING_CONTRACTS`): a data folder adopts the farm's contract the first time it meets a farm
  advertising one this client knows (`DATA_DIR/lol-embedding.json`), then Open WebUI's `openai` embedding engine points
  at the farm's service; never MiniLM again for that folder (on a farm without it the engine points at
  `http://127.0.0.1:0/v1`, so an upload fails, nothing is indexed with another model, and a toast says why); a folder
  MiniLM had indexed is told once to press Reindex (Admin Panel ▸ Settings ▸ Documents) — the app never calls the
  admin API; presence heartbeats to the farm (`POST
  /lol/client-ping` every 10 s: id/hostname/platform/version/idleSec); Blender/mcpo assistant tools are
  **opt-in** (off by default since v0.1.24; a farm recommendation can enable them for non-explicit users).
  **Three surfaces**, picked by the topbar's segmented control (Open WebUI · LOL Vibe · Computer; the last
  choice is remembered in `localStorage['lol:view']`): OWUI; **LOL Vibe** (`renderer/chat/main.mjs` + modules
  in `app/ core/ ctx/ net/ render/ state/ ui/ strings/ css/` — farm-direct, tok/s + TTFT per reply, a message
  tree, seat-aware sending, a context meter; history in the renderer's IndexedDB `lol-chat` v2 with a one-way
  import of the v1 `localStorage` history; no RAG, uploads or tools — those P3/P4 plans were cancelled on 2026-09-16
  (docs/archive/plans/LOLCHAT_STUDIO_PLAN.md §6: Open WebUI does documents and search); and
  since 2026-09-28 the **IDE** (P5 v1, [docs/plans/IDE_PLAN.md](../../docs/plans/IDE_PLAN.md)): the workbench's **Project** panel binds a
  thread to a folder in `DATA_DIR/LOL Studio Projects/`, and that thread's replies come from **DeepSeek Harness**
  (dsh 0.1.7-rc.2) run by main (`src/main/studio.ts`) over its SDK on its OWN Node (its addon refuses Electron 42),
  with a profile patch written from the current farm: 9 file tools, no shell/web/subagents, no DeepSeek cloud row,
  telemetry off, skills only from `DATA_DIR/skills`; and **the project fence** — a PreToolUse command hook
  (`FENCE_JS`) that refuses any file tool outside the project, and a write or edit to `project.json` or `.git/` (the
  remote a person's Push sends to; 2026-10-09), because dsh itself confines writes only (on Windows
  dsh runs hooks through PowerShell: the command needs `&` and `; exit $LASTEXITCODE`, else it silently passes; and
  dsh runs a hook only where its sandbox starts — elsewhere it lets every call through, so on Windows `sandboxBlocked`
  tries dsh's own runner first and the agent does not start on a folder whose permissions a person cannot change, a
  second drive or a USB stick, 2026-10-23; a `sandbox_permissions` naming the standing `workspace-write` passes); and
  **the syntax check** (2026-09-30) — a PostToolUse hook (`CHECK_JS`) after every write/edit that parses the file's
  JavaScript (a .js/.mjs or each inline `<script>` of an .html) with `node:vm`, never running it, and on a SyntaxError
  exits 2 so the model reads the line and fixes it in the same reply. dsh's hook sandbox forbids writing outside the
  project AND starting a process (EPERM): a temp file or `node --check` would pass silently.
  Skills shipped (seeded one by one into `DATA_DIR/skills`): **ponytail**, **agent-page** (agent pages, below), and **graphify** (`assets/skills/graphify`,
  adapted from Graphify-Labs/graphify v0.9.71, Apache-2.0 + NOTICE: the model writes `graphify-out/graph.json` with
  file tools only — no Python; the panel draws it with the Computer's graph viewer). History = git per project
  (`src/main/projectGit.ts`, isomorphic-git); **Share on the LAN** and **GitHub push/pull** are a person's clicks.
  **Keep going until done** (2026-09-29, [IDE_PLAN §6](../../docs/plans/IDE_PLAN.md)): a person's per-project switch (off by
  default, forgotten at restart) that turns on dsh's own goal loop — the model sets a goal, dsh starts round after round
  until the model marks it complete — as ONE reply (`◎ Round n of 10`), ≤ 10 rounds (`GOAL_ROUNDS`), maxTokens 16384,
  lowered on small windows so dsh can still compact (`studio.ts` `agentMaxTokens`); a model `projects/models.mjs` has no
  profile of asks for the farm's reply limit (`backend.replyTokens`, 32768 by default; branch `presets`, 2026-10-27:
  every model is called `assistant`, so a heavy thinker like Flint was cut at 8192), shrunk the same way on a small window;
  the goal plugins stay OFF otherwise. **On a schedule** (same day, `renderer/chat/projects/schedule.mjs`): a person's per-project
  form — every N ≥ 5 min or each day at HH:MM, and a message — sent by the app itself (marked ⏰) into the chat it was set
  from, only while the app is open, forgotten at restart, skipped while a reply runs (dsh's own scheduler needs its web host). **Use the Computer** (same
  day): a person's per-project switch that adds the Computer's MCP server to the agent's profile (an `mcp-client` row;
  the bearer via `!!js` from `LOL_MCP_TOKEN` in the runtime env, never in the patch file) — the agent builds and runs
  graphs; devices stay a dry run until a person arms the outputs (mcp.ts rules). **Agent pages** (2026-09-30, IDE_PLAN §5 A):
  the Preview's loopback server serves `/lol-agent.mjs` (the loop library, `assets/agent-page/`) and `/lol-farm.json`
  (the farm's address and default model, never its password) — never on the LAN share — and the **agent-page** skill has the agent write
  pages whose own JavaScript runs a step loop with the farm's model and the page's tools. The patch also fits compaction to small windows (v0.2.5: with dsh's 65536-token
  default headroom a 32k window never compacted). dsh sessions die with the process (no resume): a new one gets a
  recap of the thread. Preview = a static server per project on 127.0.0.1 (main's frame veto lets exactly that
  origin in). The agent is NOT in the installer: CI builds `dsh-runtime-<platform>-<arch>.tar.gz` (`shell/dsh/`:
  a pinned Node + `npm ci` of a committed lockfile, 110–133 MB, boot-tested; dry run: `build-dsh-runtime.yml`) and the panel's **Install the coding agent** fetches it
  into `<userData>/dsh-runtime`; in dev, `LOL_DSH_DIR` (+ `LOL_DSH_NODE` when that folder has no Node of its own)); and
  the **Computer** (next bullet). **LOL Vibe was named LOL Chat until 2026-09-27** (owner): only what a person
  reads changed; the code and the data keep the old name (`renderer/chat/`, `#lolchat`, the `lol-chat` IndexedDB,
  the `chat` view value, `.lolchat.json` exports), so no history moves and old exports still import. Whether OWUI ships is `src/main/clientMode.ts` `OWUI_ENABLED` + the
  renderer's `NO_OWUI` (flip both; a no-OWUI build hides the Open WebUI button).
  **All of the client's data is in DATA_DIR** (owner rule 2026-09-27): the main window runs on
  `session.fromPath(<DATA_DIR>/lol-client)` (`src/main/clientData.ts`), so LOL Vibe's IndexedDB + the
  window's localStorage live there, next to OWUI's data. Before app `ready` the boot applies a pending
  Preferences move, falls back to `<userData>/lol-client` (with a toast) when the DATA_DIR cannot be
  written, and imports a v0.1.x profile ONCE from the default session under userData (left there as a
  backup; `legacyClientDataImported`). The OWUI `<webview>` keeps `persist:owui` (`userData/Partitions/owui`
  — only its token and caches).
  Perf invariants worth keeping: the renderer CSP MUST carry `connect-src 'self' http: https:` (else LOL
  Chat and the Computer cannot reach the LAN farm at all); the whole farm context (endpoint, password,
  model, SearXNG, TTS, OCR, ctx/slot) is persisted so a cold launch spawns the sidecar **once** — saved
  whenever the settings lack it (`farmSelect.ts` `connectPlan`), not only when OWUI restarts (until
  2026-10-07 a client that found its farm during the boot never saved it); OWUI's
  follow-up/tags/autocomplete generation is disabled so background calls can't queue ahead of the user on
  llama-server's single slot. **Boot time** (the OWUI boot is ~10–12 s warm, ~30 s when its files are cold
  after a reboot, dominated by OWUI's own Python import chain — untouchable): `repoint` restarts ONLY when
  the effective launch env differs (not when an input differs), `sidecarManager` precompiles the
  freshly-unpacked tree to bytecode in the background (a fresh install otherwise pays parse+compile for
  ~27k files on first launch), `RAG_EMBEDDING_MODEL_AUTO_UPDATE=false` (OWUI otherwise asks huggingface.co
  for MiniLM's latest revision on every boot, a request with no timeout: 21 s per boot where the site is
  silently blocked), `HF_HUB_OFFLINE=1` when MiniLM (HF cache) + whisper-base (OWUI 0.10.2 and 0.11.4 keep
  it under `DATA_DIR/cache/whisper/models`) are cached (`HF_HUB_ETAG_TIMEOUT=2` until then), and health
  polling at 300 ms. "Cached" is judged as huggingface_hub judges it (`configBridge.ts` `hfModelState`: the
  snapshot `refs/main` names, every file the loader needs, no dangling link). Before each start
  (`sidecar.ts`) a damaged MiniLM is repaired (`repairMiniLm`: the hub's file list and dangling links go;
  the snapshots too only if it is still half-downloaded, so the loader fetches up to ~92 MB; never the
  blobs) — with update checks off, a first download cut off half-way otherwise broke every upload for good.
  And while MiniLM is not on disk, one HEAD to huggingface.co (3 s, Electron's `net.fetch` so the system
  proxy applies; none behind an env proxy): no answer → that launch alone gets `HF_HUB_OFFLINE=1`, the chat
  opens in ~12 s instead of the hub's 123-466 s of retries, and a toast says uploads need one start online
  (all 2026-10-08, measured with the bundled sidecar). A page OWUI loaded while the farm was not answering lists no model until reloaded:
  the renderer reloads it once when that farm answers (`app.js` `reloadIfFarmBack`). Each OWUI state, with
  the seconds since launch, goes to `<userData>/logs/boot.log` (1 MB, then `.1`): the timeline a slow-load
  report needs. It holds the states only (`starting`, `ready`, `restarting`, `stopped`, an error, with the farm in
  use). The search-model repair and an offline start are printed to the console, which a packaged client does not
  keep: a repair leaves no trace there, and an offline start only its toast.
  **Close means close** (owner decisions 2026-09-04 + 2026-09-10, replacing the keep-warm/tray behavior of
  v0.1.x–v0.1.43): the window's X asks "Quit LlmOnLan?" (Quit/Cancel), then quits EVERYTHING on all
  platforms (mac included — deliberate convention break); cleanup gets 4 s, then the app exits regardless.
  "Restart & install" and the chat-engine relaunch skip the prompt. A hidden-but-warm client kept
  heartbeating the farm and held a seat while nobody used it; reopening pays the OWUI boot again —
  accepted cost.
  **Tests** (`shell/test/`, see `test/chat/README.md`): `npm run test:unit` (app.js: the capacity pill and cards, the
  web-search undo, the date line, the first authed load, the one reload when the farm answers again); `npm run
  test:chat` (2026-11-05) = `npm run build`, then `node test/chat-unit.js` (LOL Vibe, the Computer and the main-process suites,
  against build/main: build first) and `chat-lint.js` (the static gate); `chat-scope.js` was LOL Chat vNext's phase
  gate (2026-09): it flags every change outside that phase's allowlist — the farm, CLAUDE.md, most of main — so it is
  not a gate today; `asar-probe.js`; `node test/chat-harness/run.js [--slot n] [--phase p]` (a chat-only
  Electron driven over CDP against a NON-beaconing `mock-farm.js`; `--phase perf` = the perf budgets). The
  legacy `npm test` = `e2e.js` drives the real app against a beaconing mock — a spare box only (Electron's
  single-instance lock and the owner's real DATA_DIR make it unsafe on a box with a client open).

## Client shell

Layout (mirrors ComfyQ's desktop shell): a sticky **topbar** (logo · "powered by Open WebUI" · connection
pill · surface switch Open WebUI / LOL Vibe / Computer · theme · gear) over the OWUI `<webview>`
(`http://127.0.0.1:<port>`), LOL Vibe or the Computer. **The pill** shows the farm and its free seats
(`· 2/3 free`, plus `· 12 waiting` with a tooltip when the engine reports a queue); amber = connecting, seats full,
a queue at the engine, not responding or password needed; red = a server problem.
Clicking it opens **Servers on your network**: farm cards with live load, password entry, "Manage this
farm ↗" (`/lol/admin`), add-by-address, auto-search and Rescan. **The connection overlay** covers OWUI
while it starts, reconnects, fails (Retry) or downloads the engine on first run. The gear opens
**Preferences**.

Main‑process responsibilities: sidecar supervisor (start/health‑wait/restart/stop), discovery,
config‑bridge (the only module that knows OWUI's env surface; the renderer's `app.js` holds the few REST
touches in the contract table), and the shell config store (a hand-rolled `userData/shell-settings.json`,
`store.ts`). The renderer hosts the chrome, the webview, the settings UI, LOL Vibe and the Computer.

**Preferences panel** (LOL‑owned, ComfyQ‑styled), sections (data location · connection · **assistant
tools** · **Home Assistant** · startup & updates · **usage report** · about):
- **Data location** — show the current `DATA_DIR` (everything: OWUI's data, LOL Vibe's history, the
  Computer's graphs, media and projects); "Change folder…" (Electron `dialog.showOpenDialog`). The panel
  asks first and says the app restarts: **move** copies OWUI's data now (the sidecar stopped), saves
  `dataDir` + a `pendingClientMove` marker, and relaunches (no quit prompt) — the next boot moves
  `lol-client` before the window opens, then removes the old copy; **start fresh** saves `dataDir` and
  relaunches (the old data stays where it was). A move goes into an empty folder only: a folder that holds data is
  refused before Open WebUI stops and offered only as it is, **Use this folder** (`dataMigration.ts` `NOT_EMPTY`;
  2026-11-05, v0.2.16). Default: `<userData>/owui-data`.
- **Connection** — "Auto-search the subnet", "Rescan now", the **Search range** (`a.b . c–d . e–f`), and
  "Add by address" + chips (ComfyQ pattern). The farm list and the choice of farm live in the topbar popover.
- **Assistant tools** — the opt‑in Blender/mcpo toggle, a "Test connection" button (checks both the
  local helper and whether Blender is listening), and the BlenderMCP socket port.
- **Home Assistant** (2026-09-30) — address + long-lived token → **Link** (tested before anything is kept), **Test
  connection**, **Forget**, and **Allow commands…** / **Stop commands** (main's native dialog lists the devices).
- **Startup & updates** — "Launch at login"; "Install app updates automatically" (off: a downloaded update installs
  only on "Restart & install", 2026-11-05, v0.2.16); "Check for app updates"
  → "Restart & install update"; a close-means-close note. There is no update channel.
- **Usage report** (2026-11-12, not released yet; `docs/plans/INSIGHTS_PLAN.md` §6.5) — what the app counts, in plain
  words, and **Save a usage report…**: the day-by-day counts as JSON (`chat/core/usage.mjs` `report`, built from its
  frozen lists, never copied from storage), saved through `ui/transfer.mjs` `download`. Nothing is sent.
- **About** — the app and Open WebUI versions, "Check for chat-engine update" (a staged sidecar update,
  applied on relaunch), and explicit "Powered by Open WebUI" attribution + link.

Model selection is intentionally **not** here — the served catalog lives farm‑side (lol.config.json, the
`lol up` interactive picker, or live via the admin panel at `http://<box>:41997/lol/admin`), and per‑chat
model choice lives in Open WebUI's own picker (and LOL Vibe's).
