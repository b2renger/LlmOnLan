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

## Build status (2026-10-08) — released: client `v0.2.9` (OWUI `0.11.4`) · Farm app `farm-v0.0.43`

> v0.2.0 brought LOL Vibe vNext and the Computer (Fetch, Classify, Listen/Speak, Send, a ? on every box); v0.2.1
> adds USB serial, the farm's message bus + Trigger, Open data (data.gouv.fr), the Agent box and the Computer as an
> MCP server; v0.2.2 the bus and MCP hardening, lessons 5–6 and "Ask out loud"; v0.2.3 the IDE (LOL Vibe's Project
> panel + the coding agent, history, LAN share, GitHub), mic and camera, lessons 7–12, the resume banner and a full
> review of every in-app text with tooltips; v0.2.4 the project server stops following symbolic links out of a project; v0.2.5 the coding agent compacts on small context windows; v0.2.6 agent loops (Keep going until done, schedules, Use the Computer), agent pages and the syntax check; v0.2.7 Home Assistant — ask, command, and agents that act on the home, reviewed by two critics; v0.2.8 + farm-v0.0.42 the multi-user work (multiuser_implementation_plan.md): the seat gate checks the password before a seat and forwards only the routes clients use, Stop reaches the engine, honest waits on every surface, an external vLLM routed through `hosted_vllm/` with its metrics read, a reply limit and Qwen's presence penalty against runaway replies, web search v2 (off by default, the client's search-and-read service, the date line), the Computer's yes/no decisions think, and the vLLM recipe with autostart; v0.2.9 + farm-v0.0.43: vLLM run by the farm (installed, started, stopped, configured and switched from the panel, and the take-over of an operator-run vLLM), the capacity page with usage scenarios, Open WebUI booting once, and the search model's repair and offline start (docs/DEVLOG.md; the manual rig lists are docs/TEST_SCENARIOS_v0.2.md, sections 7d and 7e).
> The bullets below describe `main` (= `multiuser-phase0`, 2026-10-08).

The full plan is built, released and in multi-user testing; the dated build log with how
each piece was tested lives in [docs/DEVLOG.md](docs/DEVLOG.md), the rig‑verification state in
[docs/RIG_CHECKLIST.md](docs/RIG_CHECKLIST.md) (LOL Vibe and the Computer: [docs/LOLCHAT_RIG_CHECKLIST.md](docs/LOLCHAT_RIG_CHECKLIST.md)),
and the version‑specific integration facts in [docs/INTEGRATION_BRIEF.md](docs/INTEGRATION_BRIEF.md)
(a dated snapshot — the pin has since moved). The last full consistency pass (code ↔ in‑app text ↔ these
docs) is `docs/reviews/DOCS_REVIEW_2026-09-27_{FARM,SHELL,COMPUTER}.md`. Snapshot:

- **`farm/`** — the `lol` CLI (verified end-to-end: `lol up` → real `/v1/chat/completions`; status/down;
  beacon + `/lol/self`). **Four engines behind one LiteLLM endpoint, exactly one serving at a time**
  (owner decisions 2026-08-26/27, 09-07, 10-07), resolved by `engineOf` (`litellm.js`: external > vllm > llama.cpp >
  Ollama); the panel switches between Ollama, llama.cpp and vLLM:
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
  - **vLLM — opt-in from the panel (`vllm.enabled`), run BY THE FARM** (owner 2026-10-07, replacing the 2026-09-07
    rule "the farm never installs/starts/restarts an external server" and the 2026-10-06 recipe-plus-autostart;
    [docs/VLLM_MANAGED_PLAN.md](docs/VLLM_MANAGED_PLAN.md)). For many people on a big NVIDIA GPU (48 at 64k on the
    PRO 6000): Windows x64 inside WSL2, Linux x64/arm64. `src/vllm.js` (shaped like `llamacpp.js`; pure planning +
    the process half) drives the scripts in `farm/vllm/` (`serve.sh` with the farm's whole argv in
    `LOL_VLLM_ARGS_B64`, `stop.sh`, `install.sh`, the read-only `status.sh`; on Windows through `wsl.exe` with a
    timeout on every call). The panel installs it (the **download slot**: outside the job slot and `serialize`,
    never `busy`, resumable), keeps a list of the three measured NVFP4 models (Download / Use this / Remove / Add
    by Hugging Face name), and sets people at once, context per person and GPU memory for conversations
    (Automatic: measured seats capped by what the pool holds; the pool from free memory less the model, ~4 GB,
    9 GB for OCR and an 8 % margin, never `--gpu-memory-utilization`) under the one Apply, which dry-runs and
    confirms only a restart. The boot never waits for it: a PLANNED start keeps the farm healthy + `busy`
    "Starting vLLM" and the gate answers 503 `lol_engine_starting`; an unplanned death, Stop and the memory guard
    make it unhealthy. Three missed answers → look; one restart; a second stop in 5 min → Ollama with the reason.
    Stopped on purpose only (`lol down`, Ctrl-C, the Farm app's Quit/Stop, Stop, a switch, a restarting Apply);
    a crash of `lol up` or the Farm app leaves it running and the next `lol up` ADOPTS it when its SETTINGS match
    (D9: Automatic accepts the running value). `<root>/run/managed-by-farm` (serve.sh's marker) makes the old
    launchers no-ops; the orphan rule stops a marked vLLM at boot when another engine is chosen. **Take-over**
    (2026-10-07): a farm whose `external` server is a vLLM on this computer from `farm/vllm` is OFFERED "Let the
    farm run vLLM" (a person clicks; never automatic): `vllm.takeOverPlan` builds the vllm block from what runs
    (other flags in `extraArgs`), `configFile.takeOverFile` copies `lol.config.json.before-managed-vllm` then
    swaps the blocks, the marker is written, the server is adopted and LiteLLM NOT restarted (routing equal apart
    from api_key); Undo until a setting changes or a restart. A farm-v0.0.42 refuses a file with a `vllm` block
    (strict zod). The review fixes (2026-10-08): `lol down` stops only the farm's own vLLM (the one it serves
    with, or one carrying its marker), never an operator's in a folder it downloaded into; the scripts own a pid
    file only when its leader runs from their root (WSL reuses pids after a reboot); a start refuses a port another
    program answers on and counts only once `serve.sh` logged it ready; Ollama never loads beside a vLLM whose stop
    failed (the farm stays on vLLM, stopped); the check needs a C compiler (`build-essential`); Install/Download
    check the disk and leave 10 GB free; the take-over writes llama.cpp off. The leftovers (2026-10-08): a GPU no
    model of the list fits (`vllm.gpuFit`, document reading's 9 GB included: an RTX 4070/4080/4090) is said on the
    vLLM button before any check, on Windows before anything about WSL, and offered nothing; WSL with no answer at
    boot queues the start (which keeps a server running with these settings, `keepRunning`) instead of Ollama all
    day; Automatic memory waits until freed memory stops rising (`systemInfo.untilSteady`); the runtime file `lol
    down` removed is never written back and a vLLM stopping after it is not restarted; an install's time limit stops
    its whole process group (on Linux `hf` kept downloading). A DGX Spark checklist: the plan's §11.6. Tests:
    `farm/test/vllm-lifecycle.js` (`LOL_VLLM_FAKE=1`, `test/fake-vllm` inside WSL, 23 steps).
  - **external — config file only, for servers the farm cannot run** (SGLang/TensorRT-LLM/another machine/a vLLM
    run by hand; 2026-09-07). The farm never installs/starts/stops it. Its panel button shows only while the file
    holds an `external` block (a developer wrote it); switching away from it works from the panel. Health = `GET
    {baseUrl}/models`: unreachable at boot → fallback; dies later → the farm goes unhealthy and clients fail over.
    `contextLength`/`parallel` are operator DECLARATIONS (no portable endpoint reports them); they size the
    client RAG gate and the seats. Both vLLM routes go through `serverRoute` as LiteLLM `hosted_vllm/`
    (2026-10-05), not `openai/`: the OpenAI SDK's per-chunk work held one LiteLLM core full from ~50 streams.
  - A name the operator GAVE the served model (per-model Rename, `modelAlias`, `llamacpp.alias`, `vllm.alias`,
    `external.alias`) survives an engine switch and a fallback (`carryNameAcross(config, from, to)` over the four
    engines, `engineFallback`), so bound chats keep working. An
    unnamed default is served under its raw id on Ollama (`gemma4:12b`) and as `llamacpp.alias` on llama.cpp,
    so chats bound to it re-pick after a switch; non-default catalog models are never served under llama.cpp.
  - **Seat gate** (2026-09-04, `proxy.seatGate` default true): the public `proxy.port` is the farm's own
    streaming listener (`seats.js`) with LiteLLM on `127.0.0.1:proxy.internalPort` (default port+1). An IP's
    completions claim/refresh a seat (capacity = the serving engine's slots); a seat idle `proxy.seatIdleSec`
    (900 s) frees; a generation on a full farm gets an explicit 429 `lol_seats_full` instead of queueing
    behind idlers. The gate checks the farm password BEFORE a seat (401), gates every generation route, forwards
    only the routes clients use, and its own 401/429/502 carry CORS headers (agent pages read them); Retry-After =
    the soonest a seat can free.
  - `proxy.masterKey` = the shared **farm password** (LiteLLM `master_key`; panel-settable; clients prompt
    once, verify, remember per farm). Discovery, `/health/liveliness` and the admin token stay separate.
  - **Admin panel** at `http://<box>:41997/lol/admin` (bearer = `admin.token`, or a per-run token printed by
    `lol up`; the Farm app pins one): the engine switch (Ollama, llama.cpp, vLLM, and External only while configured) and the vLLM card (its checklist, Install, the model list, Start/Stop, the log, the take-over offer); the `.gguf` library (add by
    URL — split files too — / Use this, with rollback); the name users see (llama.cpp, vLLM) or per-model
    **Rename** (Ollama); people served at once, the context window (Automatic on Ollama and llama.cpp; on vLLM the
    context is a number, and people at once and GPU memory for conversations are Automatic) and the farm
    password under ONE **Apply changes** (one restart; on vLLM a dry run first, and vLLM restarts only for a new
    model, context, memory or request cap), and **Free an idle seat after** (`proxy.seatIdleSec`,
    1–60 min, the workshop setting — alone it applies live, no restart); Ollama download/offer/stop/delete/Make default;
    plugin toggles and the Blender fleet recommendation; a Performance card (llama.cpp, or a vLLM) and the clients with
    their seats. Long operations run as one job whose progress the panel polls. vLLM's install and model downloads
    run beside it in a second slot, the download slot, with their own bar and Stop. A Stop of vLLM is not kept: the
    next farm start starts vLLM again. Everything persists to
    `lol.config.json` (`configFile.js` raw patch — never the schema-parsed config) **except** the plugin
    toggles and the Blender recommendation; Ollama's slot count applies after a farm restart. The header's
    **Plan capacity ↗** opens `/lol/capacity` (2026-10-07, `farm/src/capacity/`, open like `/lol/self`, offline):
    the capacity explorer with this farm's box and model marked, and usage scenarios (documents for 5, vibe-coding
    for 10, a class of 30, …) whose picks come from the spike's measurements and the calibrated estimator
    (`scenarios.js`; the GeForce cards count as one-person boxes; the model served now comes first when it covers).
  - **Plugins** (`plugins/registry.js`): web search (SearXNG, ON), document OCR (`farm/src/pysvc` +
    `extract.js`, ON — hybrid text/vision PDF extraction), Kokoro TTS (OFF), and since 2026-09-27 **Classify**
    (Laya on the CPU, `classify.js` + `pysvc/classify_server.py`, OFF) and **speech to text** (faster-whisper on
    the CPU, `stt.js` + `pysvc/stt_server.py`, OFF), and the **message bus** (`bus.js`, Node stdlib, OFF: an MQTT
    3.1.1 broker :1883, a WebSocket hub :8893 and an OSC relay :9001 sharing one topic space, tied to the farm
    password — MQTT user `lol`, `?key=`, `/lol/listen <filter> <pw>`; never logs a payload). They bind to `proxy.host`; the Python ones share one
    shape (own venv, a Bearer key that stays the same across runs — an HMAC of `farm/.lol-secret` and the farm
    password — one job at a time + 429, no body ever logged). **Plugin keys are
    tied to the farm password** (2026-09-27): on an open farm the key rides the snapshot; with a password
    it is `null` there and a client holding the password fetches it from `GET /lol/plugin-keys`
    (`selfServer.js`; the client side is `farmSelect.ts` `applyPluginKeys` + `index.ts`).
  - Also: beacon group **`239.255.43.10:41998`** (+ httpPort `41997`), distinct from ComfyQ; coordinator mode;
    `lol fleet`/`lol bench`; `modelAlias` + the interactive picker in `lol up`; `lol install` (Ollama, the
    LiteLLM venv, `models` + `preinstall` — ships a ~8.6 GB staged Qwen3.8-27B — the SearXNG/OCR venvs, and
    the llama.cpp build + weights only when enabled). The farm's advertised `version` is the Farm app's
    (`LOL_FARM_VERSION`), falling back to `farm/package.json`.
- **`shell/`** (Electron + TS, **v0.2.9**) — boots the **unmodified** OWUI sidecar (config-bridge =
  env-authoritative, `ENABLE_PERSISTENT_CONFIG=false`), discovers the farm and auto-connects with **no
  URL typed**, full Preferences (data folder + move/fresh migration, connection, assistant tools, Home Assistant,
  startup/updates, about). **Adaptive RAG**: whole-document injection (`RAG_FULL_CONTEXT=true`) on farms
  advertising `backend.contextPerSlot ≥ 24576` (or not advertising it), classic top-k (`RAG_TOP_K=8`) below —
  so a 16k farm can't context-overflow on an attachment; presence heartbeats to the farm (`POST
  /lol/client-ping` every 10 s: id/hostname/platform/version/idleSec); Blender/mcpo assistant tools are
  **opt-in** (off by default since v0.1.24; a farm recommendation can enable them for non-explicit users).
  **Three surfaces**, picked by the topbar's segmented control (Open WebUI · LOL Vibe · Computer; the last
  choice is remembered in `localStorage['lol:view']`): OWUI; **LOL Vibe** (`renderer/chat/main.mjs` + modules
  in `app/ core/ ctx/ net/ render/ state/ ui/ strings/ css/` — farm-direct, tok/s + TTFT per reply, a message
  tree, seat-aware sending, a context meter; history in the renderer's IndexedDB `lol-chat` v2 with a one-way
  import of the v1 `localStorage` history; no RAG, uploads or tools — those P3/P4 plans are NOT BUILT; and
  since 2026-09-28 the **IDE** (P5 v1, [docs/IDE_PLAN.md](docs/IDE_PLAN.md)): the workbench's **Project** panel binds a
  thread to a folder in `DATA_DIR/LOL Studio Projects/`, and that thread's replies come from **DeepSeek Harness**
  (dsh 0.1.7-rc.2) run by main (`src/main/studio.ts`) over its SDK on its OWN Node (its addon refuses Electron 42),
  with a profile patch written from the current farm: 9 file tools, no shell/web/subagents, no DeepSeek cloud row,
  telemetry off, skills only from `DATA_DIR/skills`; and **the project fence** — a PreToolUse command hook
  (`FENCE_JS`) that refuses any file tool outside the project, because dsh itself confines writes only (on Windows
  dsh runs hooks through PowerShell: the command needs `&` and `; exit $LASTEXITCODE`, else it silently passes); and
  **the syntax check** (2026-09-30) — a PostToolUse hook (`CHECK_JS`) after every write/edit that parses the file's
  JavaScript (a .js/.mjs or each inline `<script>` of an .html) with `node:vm`, never running it, and on a SyntaxError
  exits 2 so the model reads the line and fixes it in the same reply. dsh's hook sandbox forbids writing outside the
  project AND starting a process (EPERM): a temp file or `node --check` would pass silently.
  Skills shipped (seeded one by one into `DATA_DIR/skills`): **ponytail**, **agent-page** (agent pages, below), and **graphify** (`assets/skills/graphify`,
  adapted from Graphify-Labs/graphify v0.9.71, Apache-2.0 + NOTICE: the model writes `graphify-out/graph.json` with
  file tools only — no Python; the panel draws it with the Computer's graph viewer). History = git per project
  (`src/main/projectGit.ts`, isomorphic-git); **Share on the LAN** and **GitHub push/pull** are a person's clicks.
  **Keep going until done** (2026-09-29, [IDE_PLAN §6](docs/IDE_PLAN.md)): a person's per-project switch (off by
  default, forgotten at restart) that turns on dsh's own goal loop — the model sets a goal, dsh starts round after round
  until the model marks it complete — as ONE reply (`◎ Round n of 10`), ≤ 10 rounds (`GOAL_ROUNDS`), maxTokens 16384,
  lowered on small windows so dsh can still compact (`studio.ts` `agentMaxTokens`);
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
  **Tests** (`shell/test/`, see `test/chat/README.md`): `npm run test:unit` (app.js capacity helpers);
  `node test/chat-unit.js` (LOL Vibe + Computer unit suites); `chat-lint.js` + `chat-scope.js` (static and
  scope gates); `asar-probe.js`; `node test/chat-harness/run.js [--slot n] [--phase p]` (a chat-only
  Electron driven over CDP against a NON-beaconing `mock-farm.js`; `--phase perf` = the perf budgets). The
  legacy `npm test` = `e2e.js` drives the real app against a beaconing mock — a spare box only (Electron's
  single-instance lock and the owner's real DATA_DIR make it unsafe on a box with a client open).
- **The Computer** (third client surface, `shell/renderer/chat/{computer,graph,sandbox}/`) — a node-graph
  canvas where boxes wired by **named arrows** make a small program, kept in a library of graphs. Boxes:
  Text, Image (+ **Take a picture**: one frame of this computer's webcam), Document, Sound (+ **● Record**: this computer's
  microphone, and a **Listen** switch: the farm's speech to text writes it down) — mic and camera through ONE door,
  `graph/parts/capture.mjs` (lint rule 16), granted by main only to the window's own `file://` page (`serial.ts`
  `grantRequest`); the take is kept like a dropped file — File, **Fetch**, **Open data**
  (a data.gouv.fr dataset from a pasted link: its description, the whole-file column profile data.gouv.fr computed,
  a sample of ≤ 1000 rows — `graph/parts/opendata.mjs`, data.gouv.fr's public API v2 + tabular API only, every GET
  through `io.ts`), **Receive**
  (a board's lines over USB serial — Web Serial in the page, the port picked by a person through main's
  `select-serial-port`, `src/main/serial.ts` + `net/serial.mjs` — or a topic of the farm's message bus through
  its WebSocket hub, `net/bus.mjs`, the one file allowed a WebSocket) (*bring*); Instruction (+ "Write a p5.js/three.js/SVG/HTML"
  and "Describe a picture" presets, plus "Write code" — a model writes a Code box's program into its **code**
  port — and "Write a Laya question" — a model writes Classify's question + options into its **question**
  port), **Classify** (Laya on the farm: one multiple-choice question per item,
  with a confidence; unsure below 0.6; no Laya → every item passed on unsure; the unsure items' text rides a `check` list for a
  second opinion), **Agent** (P4, 2026-09-27, `graph/parts/agent.mjs`: a model in ≤ 12 short steps, each ONE tool —
  `run_code` in the sandbox over the labelled inputs and earlier results, `fetch` on hosts a PERSON listed on the box
  (exact names, through `io.ts`), `laya`, `answer` — JSON mode through the same ask door, one generation per step on
  the Cap (the plan quotes `1–N` via `mostGenerations`); a failed or malformed step is fed back; the answer carries
  every step and its result; no output tool, never arms), Split, Filter, Collect,
  Repeat (*think*); Preview (+ p5.js/three.js/SVG/HTML/Markdown presets, and since 2026-09-28 **Graph**: node-link
  JSON — graphify's `graph.json` — as a d3-force map by ONE viewer, `sandbox/graph-view.mjs`, which the IDE reuses;
  since 2026-09-27 it hands on a
  **PNG** of what it drew — SVG rasterised in the renderer — so a vision model can see its own work) and
  Code (a plain-words **What it does** line, and a fold that hides the program behind it), **Speak** (says text with the farm's voice or this computer's) and **Send** (OSC, Art-Net DMX, MQTT,
  WebSocket, HTTP POST, USB serial to a device — through ONE choke point in main (USB: main decides, the page writes), `src/main/outputs.ts`: DISARMED by default
  and after every reload so a run is a dry run, arming asks and lists every target, a person-typed target
  only, never the farm's ports, 20 msg/s per target, DMX ≤ 3 frames/s, Panic blacks out every universe lit)
  (*show*); Button, Condition, Confirm, Dialog, Toggle, Timer, **Trigger** (starts runs by itself on a bus message or
  a schedule, ONLY while a person armed the outputs and the Computer is on screen; one run per `gapSec`, latest wins;
  `perHour` runs at most) (*control*); Sticky, Section, Title
  (*annotate*). Thinking boxes ask the farm **directly** (never through OWUI) on the background lane: one
  request in flight, they yield to a person's chat, and a hidden window sends nothing. Every run is bounded by
  `RUN_LIMITS` (`core/types.mjs`): 8 passes per box, 50 generations (the toolbar **Cap**), 10 min of wall
  clock including waits, 2000 activations; a loop is legal only through a gate box (`topo.mjs`
  `GATE_TYPES`). Code/p5/three/HTML run in ONE opaque-origin sandbox iframe (`sandbox/runner.html`,
  `allow-scripts` only, no network, vendored three r160 / p5 / matter, and d3 7.9 (2026-09-27, loaded for code that names
  `d3.`); `sandbox/host.mjs` is the only iframe maker)
  plus at most one **Live** guest that gets the mouse and keys (`lol.orbit(camera)` is the first-party
  camera control); a Preview box's **Edit code** opens a drawer editor. View tools: Select (V) · Hand (H) · − % + Fit,
  answering from anywhere on the Computer, never while typing. What leaves the machine: prompt text and an
  Image's (or a Preview's rendered) pixels inside the Instruction's chat completion to the farm; a Document's PDF bytes to the farm
  OCR for text only; a Classify box's items (text) to the farm's Laya for one forward pass each; a Sound
  box's recording ONLY when a person turns on its **Listen** switch (an imported graph always opens with it off) — to the farm's speech-to-text, written down
  and dropped (never logged or kept); a **Speak** box's text to the farm's Kokoro when it uses the farm voice
  (its own-computer voice, `speechSynthesis`, sends nothing); a **Fetch** box (2026-09-27) sends ONE GET to the address a person
  typed — run in main (`src/main/io.ts`): http(s), never loopback/link-local/farm ports, ≤ 1 MB text, keeps
  its last copy offline; an **Open data** box sends GETs to www.data.gouv.fr and tabular-api.data.gouv.fr only,
  derived from the dataset link a person pasted (nothing from the graph), each through the same `io.ts`; an **Agent** box's prompts (its task, a sketch of its inputs and
  results) go to the farm like an Instruction's, and its `fetch` steps GET addresses the MODEL picks, but only on the hosts a
  person listed on the box, through `io.ts` (a URL can carry what the model read — the listed hosts are the boundary). Where data lives: all of it in DATA_DIR — graphs and their
  files in the renderer's IndexedDB (`lol-chat` → `graphs`, `attachments`), which is the main window's
  session at `<DATA_DIR>/lol-client`, and File-box outputs in `<DATA_DIR>/LOL Studio Projects/` (one
  project per graph); a data-folder move carries both. The opt-in **Record log** writes `%APPDATA%\LlmOnLan\logs\computer\*.jsonl`
  (25 MB per file; 15 recordings kept + up to 30 with a marked bug; keys redacted; `src/main/debugLog.ts`,
  [docs/COMPUTER_DEBUG_LOG.md](docs/COMPUTER_DEBUG_LOG.md)). Learn shelf: the tour, lessons 1–12 (5 = code counts,
  the model names; 6 = a loop that stops; 7 listen and speak, 8 a picture to a model, 9 act on the world, 10 hear the
  world, 11 an agent with tools, 12 open data — 2026-09-28, all walkable on the mock farm) and 8 templates (Research a problematic, Creative coding, Read the news, **Analyse a
  dataset**, **Ask a dataset**, **Ask out loud**, **Talk to a board**, **A board on Wi-Fi** — the last five 2026-09-27/28; the board ones generated by `scripts/gen-board-templates.cjs`),
  and since 2026-09-27 an **MCP server** (`src/main/mcp.ts`, 127.0.0.1:41995,
  a per-install bearer, JSON responses over Streamable HTTP; since 2026-10-05 the same listener, Host check and bearer
  also answer Open WebUI's web search, `POST /web/search` → `src/main/webSearch.ts`): Open WebUI's models list, build and run graphs
  through `computer/mcp-tools.mjs` — the Computer's own debug doors; no tool arms the outputs, and while a person has
  them armed NO tool changes or runs a graph (reading stays open); what only a person chooses (a Fetch address, an Open data
  link, an Agent's hosts, a USB board, Listen) is dropped from a model's settings and reported as left for a person. Since 2026-09-30 the same
  server also answers **Home Assistant** itself, in main (`src/main/homeAssistant.ts`, [docs/HOME_ASSISTANT.md](docs/HOME_ASSISTANT.md)), listed only
  while a home is linked in **Preferences ▸ Home Assistant** (a person-typed address + long-lived token, the token `safeStorage`-encrypted in
  `<userData>/home-assistant.json`, never handed back to the page): `home_devices`, `home_state`, `home_command` — reading free, a command a
  DRY RUN until a person clicks **Allow commands…** (main's native dialog listing exactly the devices, naming ≤ 30 per kind and counting the rest; forgotten at close, on a relink that lands — a
  link generation refuses an allow that raced one — and on a window reload/crash like the outputs; the top bar shows **Home commands on · N**,
  one click stops); one device per command and only an action on `ACTIONS`' per-domain ALLOWLIST (HA registers a service per script, and
  `scene.apply`, `play_media`, `send_command` reach past the device — a security review found the first, 2026-09-30); never unlock/open a
  lock, disarm/trigger an alarm, sound a siren, open a valve, or open a cover unless HA says it is a blind/curtain/shade/shutter/awning/window;
  helpers/number/select stay commandable and the dialog says a switch, button, helper, scene or script does whatever the home wired;
  never a coordinate to a model (`HIDDEN_ATTRS`: latitude/longitude/gps_accuracy/altitude, a camera's token); a redirect is refused, never
  followed; a command unconfirmed in 20 s is "sent, not confirmed" (HA shields the call, so it may still run); ≤ 1/s per device and 30/min.
  The MCP composition is `withHome()` (tested through `handleRpc`). Also a **? on every box** that opens that box's example (`computer/examples/`: one per ＋
  menu entry, a Sticky with what it does / inputs / output / how to use it next to a working setup, imported
  as a library graph once and reopened after). A run cut short by the app's close is offered again when its graph opens (the **resume banner**, host.mjs: Resume = Run all, only unfinished boxes re-run; Dismiss closes it — 2026-09-28). Docs: [the user tutorial](docs/LOLCHAT_COMPUTER_TUTORIAL.md),
  [status](docs/COMPUTER_STATUS.md), [plan](docs/COMPUTER_PLAN.md), [live plan](docs/COMPUTER_LIVE_PLAN.md).
- **`sidecar/`** — `build-sidecar` bundles a relocatable standalone CPython 3.12 + OWUI + `launcher.py`;
  `OPENWEBUI_VERSION` is the pin (**OWUI `0.11.4`** since 2026-09-27, Python 3.11/3.12; the bump notes are in INTEGRATION_BRIEF). A packaged client runs
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
native dialog, and the v0.1.45 → v0.2.0 upgrade of a profile with LOL Vibe history (the one-time import
into `DATA_DIR/lol-client`, then a Preferences move + relaunch); the v0.2.8 / farm-v0.0.42 rig list on installed
builds (docs/TEST_SCENARIOS_v0.2.md, 7d); and for v0.2.9 / farm-v0.0.43 (TEST_SCENARIOS 7e): vLLM run by the farm
from the installed Farm app on Windows + RTX (a fresh WSL, a card too small, Launch at login after a reboot) and on
a DGX Spark ([docs/VLLM_MANAGED_PLAN.md](docs/VLLM_MANAGED_PLAN.md) §11.6, never run on one), the production
take-over and its reboot test (§9.6, §11.5), and the installed client's first start without huggingface.co (its
toast) and its repair of a half-downloaded search model. When working here, keep honoring the **prime directive** below.

---

## What we are building (four pieces)

1. **`lol` — the farm CLI** (Node, npm‑style). Run on each GPU box (or one box). Reads a
   declarative `lol.config.json`, brings up the serving engine (Ollama by default; llama.cpp or vLLM opt-in from
   the panel, vLLM installed, started and stopped by the farm; an external server a developer configures), generates and runs a LiteLLM proxy behind the farm's seat gate
   (one OpenAI‑compatible endpoint, load‑balanced across boxes), hosts the shared plugins and the admin
   panel, and runs a **UDP discovery beacon** (+ unicast `/lol/self`) so clients find the farm
   automatically. This is where models are chosen.
2. **The client shell** (Electron + TypeScript). Supervises a bundled, unmodified Open WebUI
   sidecar, discovers the farm on the LAN, points Open WebUI at it, and stores all data locally
   (OWUI's under a user‑chosen folder). Owns the topbar, settings/preferences, the connection overlay,
   and two first-party surfaces beside OWUI: **LOL Vibe** and **the Computer**.
3. **Open WebUI** — vendored, version‑pinned, **unmodified**. We inherit all its features.
4. **The Farm app** (`farm-app/`, Electron) — the operator-facing sibling of the client: a first-run
   wizard downloads its own Python + Ollama, copies the farm code to `userData/farm`, pulls `gemma4:12b`,
   runs `lol install` (venvs + the staged preinstall model), then supervises `lol up --no-pick` and shows
   the admin panel as its window (token auto-seeded) — which is where the model, its name and the capacity
   are run. **Private by default** (`proxy.host` 127.0.0.1, beacon off) until Settings ▸ Share compute.
   Its Settings drawer holds only app-level things (share-with-LAN → `proxy.host`/`beacon.enabled`, theme,
   launch-at-login, update notifications + Check for updates, the panel access token, logs folder); it
   deliberately never re-applies model settings at boot, which used to overwrite the panel's. Its Quit and Stop run
   `lol down` FIRST (so the vLLM the farm runs stops too), then tree-kill `lol up` as a backstop; the share toggle
   restarts the farm keeping vLLM (`keepEngine`: only `lol up`'s own pid is killed, never its tree); Quit keeps the
   window up ("Stopping the farm…", status `stopping`, Start waits) until `lol down` is done; a crash
   restart reaps the dead run's recorded pids first (`reapStaleFarm`, which never stops vLLM). Launch at login on
   Linux writes an XDG autostart entry for the AppImage (`farm-app/test/supervisor.test.js` checks all of it). An app
   update copies the farm code into userData FILE BY FILE (`copyTree.ts`, 2026-10-08): a file that differs is moved
   aside into `farm/.replaced` (allowed while a running vLLM's bash holds it; cleared at the next refresh), then the
   new one is written, and one failure never stops the rest. Electron 42's `fs.cpSync` deleted first, left a held
   `serve.sh` "delete pending" and skipped every later file (farm-v0.0.43 on the PRO 6000). A failed refresh is
   written to `farm.log` and retried at the next launch; a missing `farm/vllm` script is said as such on the panel
   (`vllm.js` `spawnScript`), never as "WSL did not answer". `farm-app/test/copytree.test.js` runs under Electron.
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
   OWUI's chats, folders, knowledge bases, documents and RAG vectors, LOL Vibe's history, and the
   Computer's graphs, media and projects. The farm is stateless and stores nothing.
4. **We touch Open WebUI ONLY through its public config surface** (env vars + admin REST API). If
   a behavior needs Open WebUI internals, we don't build it.
5. **Upgrading Open WebUI is a version bump, not a merge.** Bump one pin → rebuild the sidecar →
   run smoke tests. **No LOL code changes.** If an upgrade forces a code change in our shell,
   that's a separation defect to redesign, not absorb.

> **Open wording question for the owner (2026-09-27 review; invariant #4 is left verbatim):**
> - #4 says "admin REST API". The only shipped REST writes use OWUI's **user-settings** API, plus the
>   auth check and the user-settings read. The admin API is never used.

---

## The integration contract (the entire OWUI coupling)

| Direction | Mechanism | Notes |
|---|---|---|
| Lifecycle | Shell spawns the OWUI sidecar as a child process and supervises it. | Shell = process manager + window. |
| Config → OWUI | Env vars at **every** launch, made authoritative by `ENABLE_PERSISTENT_CONFIG=false` — repointing the farm restarts the sidecar with new env. **Three exceptions**, all written from the authed webview via OWUI's user‑settings API `POST /api/v1/users/user/settings/update`: switching web search back off, once, on a profile a client up to v0.2.7 turned on (`ui.webSearch` 'always' → null, only while its `lolWebSearchSeeded` marker is there and the value is still 'always'; marked `lolWebSearchUnseeded`) — web search is off by default; the globe button turns it on for a chat; the **date line** (2026‑10‑05: the model otherwise believes it is 2025): `ui.system` = `Today is {{CURRENT_WEEKDAY}} {{CURRENT_DATE}}.`, once per profile and only when the person's system prompt is empty (marked `lolDateLineSeeded` either way, so a prompt they wrote or emptied is never touched; OWUI fills the variables at each message, on chat requests only, not title generation); and the opt‑in Blender tool server (`ui.toolServers` + `ui.tools`). None has a usable env (`DEFAULT_MODEL_PARAMS.system` never reaches a farm model's messages; 0.11's `DEFAULT_INTERFACE_SETTINGS` is missing from 0.10 and comes back when a person empties it). | See gotchas below. |
| Data | `DATA_DIR` → the user's chosen local folder; default local embeddings; telemetry off. | Enforces invariant #3. |
| Net out of OWUI | Chat completions to the farm endpoint; plus, when the farm advertises them: web searches, Kokoro TTS requests, and uploaded‑file bytes to the farm OCR extractor; and MCP tool calls to the Computer on 127.0.0.1 (this machine) — which answers the home tools against the Home Assistant a person linked. **Web search v2** (2026-10-05): OWUI's searches go to this app's main on 127.0.0.1 (`POST /web/search` on the MCP listener, OWUI's external-search env); main sends the query to the farm's SearXNG and itself reads the top pages of each search — up to 6 automatic GETs, public internet only (`webSearch.ts` through `io.ts`) — instead of OWUI fetching only the pages the model picks; a page the model still fetches itself (`fetch_url`) is OWUI's own GET. That is native tool calling, OWUI's default; a chat set to Legacy function calling gets main's results too, but OWUI then loads those pages itself (its web loader). When that port is taken, OWUI queries SearXNG directly, as before. | Embeddings always stay local. |
| Webview | The renderer reads the OWUI origin's `localStorage.token`, validates it with `GET /api/v1/auths/` (drop + reload, ≤4 tries) before revealing the webview, and reads the user's settings once per session to undo the old web‑search seed and write the date line (a failed read writes nothing); a page that loaded while the farm in use was not answering is reloaded once, 500 ms after that farm answers (`reloadIfFarmBack`: OWUI reads the model list only as its page loads, measured on 0.11.4; re-check on a pin bump); the `persist:owui` partition is granted mic/camera/clipboard only. | `renderer/app.js`, `src/main/index.ts`. |
| Hugging Face cache | Before each start, main repairs a half or damaged MiniLM in huggingface_hub's cache, never OWUI's own files. `repairMiniLm` removes the hub's file list and dangling links, and the snapshots only if the model is still half there; the blobs always stay. While MiniLM is not on disk, main also sends huggingface.co one HEAD (3 s) to choose `HF_HUB_OFFLINE` for that launch. "Whole" (`hfModelState`) copies huggingface_hub 1.33's local lookup and the files MiniLM's loader reads: re-check both on every pin bump. | `configBridge.ts`, `sidecar.ts`. |
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
  on llama‑server's single slot; title generation stays ON) · `TASK_MODEL_PARAMS={"chat_template_kwargs":
  {"enable_thinking":false},"think":false,"max_tokens":1000}` (owner decision 9, 2026‑10‑04: title and
  web‑search‑query generation answer without thinking — OWUI 0.11 copies it onto those requests; `max_tokens`
  restates the title default it would otherwise drop; chats untouched; 0.10.x ignores it — the Computer's
  lists, JSON and agent steps send the same pair unless a person ticks the canvas toolbar's **Think all**
  box, `pref:computeThink`, default `DEFAULT_THINK` = off, MCP runs included; its yes/no decisions, Condition
  and Filter, think either way, `THINKING_TASKS`, owner 2026‑10‑05 from a measurement) · `DEFAULT_LOCALE=en-US`
  (+ Chromium `--lang en-US`) · `ANONYMIZED_TELEMETRY=false` · `DO_NOT_TRACK=true` · `SCARF_NO_ANALYTICS=true` ·
  `RAG_EMBEDDING_MODEL_AUTO_UPDATE=false` (no per-boot huggingface.co revision check; a missing MiniLM is still
  downloaded, and a half-downloaded one is repaired before the start so it is too) · `HF_HUB_OFFLINE=1` when the
  models test as cached (every needed file in the snapshot `refs/main` names), else `HF_HUB_ETAG_TIMEOUT=2` —
  plus, per launch and outside `buildSidecarEnv` (so `repoint`'s env comparison never sees it), `HF_HUB_OFFLINE=1`
  when MiniLM is not on disk, no proxy is set in the environment (`HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`, either
  case), and huggingface.co does not answer a 3 s HEAD sent through Electron's `net.fetch` (the system proxy);
  `HF_HUB_ETAG_TIMEOUT=2` stays set beside it.
- **With a farm:** `ENABLE_OPENAI_API=true` · `OPENAI_API_BASE_URL=http://<host we reached it at>:<proxyPort>/v1`
  · `OPENAI_API_KEY`=<farm password> or `sk-lol-lan` · `DEFAULT_MODELS`=<the farm's default id, when listed>.
  **Without:** `ENABLE_OPENAI_API=false` (a no‑farm boot must not fall back to api.openai.com).
- **SearXNG** (when advertised): `ENABLE_WEB_SEARCH=true` · `WEB_SEARCH_RESULT_COUNT=5` ·
  `WEB_SEARCH_CONCURRENT_REQUESTS=10` · `WEB_FETCH_MAX_CONTENT_LENGTH=12000`; then, while the MCP listener is up
  (web search v2, 2026-10-05): `WEB_SEARCH_ENGINE=external` · `EXTERNAL_WEB_SEARCH_URL=http://127.0.0.1:41995/web/search`
  · `EXTERNAL_WEB_SEARCH_API_KEY`=<per-install mcpToken>; else `WEB_SEARCH_ENGINE=searxng` ·
  `SEARXNG_QUERY_URL=<url>/search?q=<query>` · `SEARXNG_LANGUAGE=auto`. No external page loader
  (`WEB_LOADER_ENGINE` stays unset): attaching a LAN page keeps working through `ENABLE_LOCAL_WEB_FETCH`.
- **Kokoro** (when advertised): `AUDIO_TTS_ENGINE=openai` · `AUDIO_TTS_OPENAI_API_BASE_URL=<ttsUrl>` ·
  `AUDIO_TTS_OPENAI_API_KEY=sk-lol-tts` · `AUDIO_TTS_MODEL=<ttsModel|kokoro>` · `AUDIO_TTS_VOICE=<ttsVoice|af_heart>`.
- **OCR** (when advertised): `CONTENT_EXTRACTION_ENGINE=external` · `EXTERNAL_DOCUMENT_LOADER_URL=<extract.url>`
  · `EXTERNAL_DOCUMENT_LOADER_API_KEY=<extract.key>` (the key fetched through the farm password on a keyed farm;
  `sk-lol-ocr` when there is none, because OWUI's loader needs a non-empty key). The URL is sent without trailing slashes.
- **The Computer's MCP server** (2026-09-27, when its port is free): `TOOL_SERVER_CONNECTIONS=[{type:"mcp",
  url:"http://127.0.0.1:41995/mcp", auth_type:"bearer", key:<per-install mcpToken>, config:{enable:true},
  info:{id:"lol-computer", name:"LlmOnLan Computer", description:"Build and run graphs on the LlmOnLan Computer (this computer only)."}}]`
  — OWUI 0.11.4's own tool-server setting (config.py), no OWUI change. Set once at boot, before the first spawn, so it
  never makes `repoint`'s env differ.
- The supervisor adds `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8` and otherwise inherits the shell's environment.

- **Gotcha #1 — persisted URLs beat env.** Connection URLs saved via the admin UI go to OWUI's DB
  and **take precedence over env on later starts.** The shipped strategy: `ENABLE_PERSISTENT_CONFIG=false`
  — env is authoritative on **every** launch, so repointing the farm is just a sidecar restart with new
  env, and no stale persisted URL can win. (OWUI's admin REST API is deliberately NOT used — it's
  session‑only while persistence is off. The three shipped writes all go to the user‑settings API
  `POST /api/v1/users/user/settings/update` from the authed webview: the one‑time undo of the old web‑search‑on
  default, the one‑time date line in an empty system prompt, and the opt‑in Blender tool server.) Ref: https://docs.openwebui.com/reference/env-configuration/
- **Gotcha #2 — JSON config env.** `OPENAI_API_CONFIGS`/`OLLAMA_API_CONFIGS` historically weren't
  parsed from env at startup (open‑webui#19017). Use the simple `*_BASE_URL(S)` env as the seed.

Data locality:
- `DATA_DIR` → user‑chosen local folder (all persistent data lives here: OWUI's, and — in its `lol-client`
  subfolder, the main window's Chromium session — LOL Vibe's history and the Computer's graphs and media;
  File-box outputs in `LOL Studio Projects/`).
- **Keep default local embeddings** — we set **neither** `RAG_EMBEDDING_ENGINE` **nor**
  `RAG_EMBEDDING_MODEL`, so OWUI's in‑process default applies (`all-MiniLM-L6-v2`,
  cached in the default HF_HOME — `~/.cache/huggingface`, deliberately NOT under `DATA_DIR` so a
  data‑folder move never re‑downloads it; `SENTENCE_TRANSFORMERS_HOME`, `HF_HUB_CACHE`, `HF_HOME` or `XDG_CACHE_HOME`
  in the inherited environment move it, as `hfHubDir` and `miniLmRoot` read them). The app writes there only to repair
  MiniLM before a start: a half or damaged copy loses the hub's file list and its dangling links, and its snapshots too
  while it is still half-downloaded, so Open WebUI's loader fetches it again (~92 MB). The downloaded bytes (`blobs/`)
  stay. Do **NOT** set `RAG_EMBEDDING_ENGINE=ollama` — that would
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
  "vllm": { "enabled": false, "root": null,      // OPT-IN from the panel: vLLM run by the farm (in WSL2 on Windows)
            "port": 8100, "alias": "assistant", "model": "qwen3.6-35b-a3b",   // a library id (3 measured NVFP4)
            "contextLength": 65536, "parallel": "auto", "kvCacheGib": "auto" },
  "external": { "enabled": false, "alias": "assistant", "baseUrl": "http://127.0.0.1:8000/v1",
                "contextLength": 32768, "parallel": 4 },   // a server the farm does not run; DECLARED values
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
| `lol up` / `serve` | Probe an external engine; ensure Ollama (start a local one if down); pick the Ollama models (prompt / `--model` / `--no-pick`); pull what's missing; start llama-server if enabled (fall back to Ollama on failure); check vLLM if it is the engine (keep a matching one, else queue its start); size the Ollama context; generate `litellm/config.generated.yaml`; start LiteLLM on loopback + the seat gate on `proxy.port`; start the plugins; start the beacon, `/lol/self` and the admin panel; print the admin token; start vLLM as the job "Starting vLLM". Foreground. |
| `lol models ls` / `add <id>` / `rm <id>` / `pull` | Manage the Ollama catalog in `models` (then `lol up --no-pick`). |
| `lol status` | Health of each Ollama host + the proxy + which models are loaded. |
| `lol down` / `stop` | Stop the proxy + `llama-server` + SearXNG/TTS/OCR + beacon (and any Ollama it started), and the vLLM the farm runs (from the runtime file, else the config; never an operator's vLLM the farm only downloaded a model for). |
| `lol install` / `setup` | One-time, idempotent bootstrap: Ollama, the LiteLLM venv, every `models` + `preinstall` entry, the SearXNG + OCR venvs, and (only when `llamacpp.enabled`) the llama.cpp build + weights. Never vLLM: the panel's vLLM card installs it. |
| `lol fleet` / `lol bench` | Every farm on the LAN; load-test N concurrent chats before a workshop. |

Notes:
- The CLI **generates** `litellm/config.generated.yaml` (routing least-busy, `num_retries` 3,
  `allowed_fails` 1, cooldown 60 s — none when no model has a second deployment to fail over to). On Ollama
  each host becomes a deployment of the same `model_name`
  (e.g. `gemma4:12b`), so LiteLLM load‑balances + fails over; with llama.cpp, vLLM or an external server serving, one
  OpenAI‑compatible deployment (+ coordinator peers) replaces the Ollama catalog. LOL never hand‑edits routing; it's
  derived from `lol.config.json`.
- Model choice = the admin panel (live), or edit `models` (or `lol models add`) + `lol up`. Clients see the
  catalog via the endpoint's `/v1/models`; OWUI's and LOL Vibe's pickers handle per‑chat selection.
- Prereqs (documented in `farm/README.md`): Ollama installed per box; LiteLLM available (pip/binary) —
  `lol install` bootstraps both. The CLI spawns/supervises them; it doesn't reimplement them.
- The beacon is adapted from ComfyQ's `server/federation/beacon.js` (see Discovery).

---

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
tools** · **Home Assistant** · startup & updates · about):
- **Data location** — show the current `DATA_DIR` (everything: OWUI's data, LOL Vibe's history, the
  Computer's graphs, media and projects); "Change folder…" (Electron `dialog.showOpenDialog`). The panel
  asks first and says the app restarts: **move** copies OWUI's data now (the sidecar stopped), saves
  `dataDir` + a `pendingClientMove` marker, and relaunches (no quit prompt) — the next boot moves
  `lol-client` before the window opens, then removes the old copy; **start fresh** saves `dataDir` and
  relaunches (the old data stays where it was). Default: `<userData>/owui-data`.
- **Connection** — "Auto-search the subnet", "Rescan now", the **Search range** (`a.b . c–d . e–f`), and
  "Add by address" + chips (ComfyQ pattern). The farm list and the choice of farm live in the topbar popover.
- **Assistant tools** — the opt‑in Blender/mcpo toggle, a "Test connection" button (checks both the
  local helper and whether Blender is listening), and the BlenderMCP socket port.
- **Home Assistant** (2026-09-30) — address + long-lived token → **Link** (tested before anything is kept), **Test
  connection**, **Forget**, and **Allow commands…** / **Stop commands** (main's native dialog lists the devices).
- **Startup & updates** — "Launch at login"; "Install app updates automatically"; "Check for app updates"
  → "Restart & install update"; a close-means-close note. There is no update channel.
- **About** — the app and Open WebUI versions, "Check for chat-engine update" (a staged sidecar update,
  applied on relaunch), and explicit "Powered by Open WebUI" attribution + link.

Model selection is intentionally **not** here — the served catalog lives farm‑side (lol.config.json, the
`lol up` interactive picker, or live via the admin panel at `http://<box>:41997/lol/admin`), and per‑chat
model choice lives in Open WebUI's own picker (and LOL Vibe's).

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
`color-mix` glow (green = ready, amber = waiting — connecting, seats full, a queue at the engine, not responding,
password needed — red = error, grey = idle). The theme toggle shows the **current** mode's icon (moon in dark, sun
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
      chat/              #   LOL Vibe + the Computer — ES modules, no build; IndexedDB `lol-chat` (in DATA_DIR/lol-client)
        main.mjs         #     LOL Vibe entry (+ app/ core/ ctx/ net/ render/ state/ ui/ strings/ css/)
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
    src/main/            #   installer (setup wizard) + copyTree (the update's copy), farmSupervisor + farmProcess (lol down, the reap), runtimeManager, updater
    test/                #   supervisor.test.js (npm test: lol down before the kill, keepEngine, the reap, the Linux autostart entry),
                         #   copytree.test.js (the update's copy over a held file, run under Electron's own Node)
    renderer/            #   status chrome + Settings + the admin panel in a <webview>
    electron-builder.yml #   ships `../farm` as an extraResource; tags are `farm-v*`
  sidecar/               # packaging of the pinned, UNMODIFIED Open WebUI
    OPENWEBUI_VERSION    #   single source of truth for the pin
    build-sidecar.*      #   fetches OWUI at the pin + bundles a self-contained executable
  farm/                  # the `lol` CLI (Node) + beacon — the backend, NOT shipped to clients
    bin/lol.js           #   CLI entry
    src/                 #   beacon.js, selfServer.js (+ admin/ panel page, capacity/ the Plan capacity page), snapshot.js, seats.js,
                         #   plugins/ (registry), pysvc/ (OCR service), extract.js, llamacpp.js/gguf.js, vllm.js,
                         #   litellm.js/ollama.js, configFile.js, commands/ (up/down/install/...)
    contract/            #   snapshot.schema.json — the beacon / GET /lol/self shape; farm + shell tests check it
    vllm/                #   the vLLM scripts the farm drives (serve/stop/install/status.sh, relay.py) — also the
                         #   operator recipe (start-windows.ps1, lol-vllm.service); test/fake-vllm stands in for vLLM
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
  (OWUI's); LOL Vibe's history and the Computer's graphs and media (the main window's session,
  `DATA_DIR/lol-client`); the Computer's File-box outputs (`DATA_DIR/LOL Studio Projects`). Embeddings are
  computed locally. Outside DATA_DIR, under userData, only app plumbing: settings, the downloaded engine,
  OWUI's webview token/caches, logs (`logs/boot.log`, `logs/client-data.log`, the Computer's opt-in recordings), and
  — after an upgrade from v0.1.x — the old LOL Vibe copy kept as a backup. Outside both, the machine's Hugging Face
  cache (`~/.cache/huggingface`, shared by every data folder) holds MiniLM, the search model: no user content. The
  app repairs a half-downloaded copy there before a start.
- **Over the network (all to the trusted‑LAN farm, which stores nothing):** the chat context per
  completion (from OWUI, LOL Vibe, or a Computer Instruction — with an Image box's or a Preview's rendered pixels when wired);
  web‑search queries to the farm's SearXNG — since web search v2 sent by this app's main, which then itself
  reads the top pages of each search (up to 6 GETs, to the public internet only, never the LAN; nothing kept),
  while a page the model picks is fetched by OWUI as before (main's page reads are for OWUI's native tool calling,
  its default; a chat set to Legacy function calling still has OWUI load the result pages itself); TTS requests when
  the farm hosts Kokoro (and a Computer Speak box's text, with the farm voice); a Computer Sound box's
  recording, only in **Listen** mode, to be written down by the farm's speech-to-text (never logged or
  kept); and — with the default‑on farm OCR — an uploaded file's (or a Computer Document
  box's) raw bytes, for text **extraction only** (the extracted text embeds locally); presence heartbeats
  (`POST /lol/client-ping` every 10 s: hostname, platform, version, idle seconds).
- **To third parties a person names:** a Computer **Fetch** box's GET to the address typed in it (nothing
  from the graph is sent with it); an **Open data** box's GETs to data.gouv.fr for the dataset pasted in it; an **Agent** box's GETs, only to hosts a person listed on it; a **Send** box's message to the device typed in it, only once a person
  armed the outputs (a dry run otherwise); the **Home Assistant** a person linked (states and actions read when a model asks — and what a model read can leave with its other
  tools in the same chat, e.g. Open WebUI's `fetch_url` when a person turns web search on, so the docs say to leave it off there; a
  command only while a person allowed home commands). A board on this computer's USB cable (Send by USB, Receive) stays
  on this computer; the farm's message bus carries what a graph publishes (armed) to whoever subscribed on the
  LAN, and keeps nothing.
- **Beyond the farm (no user content):** GitHub, for the app update check and the chat-engine (sidecar)
  download/update check, and the IDE's coding-agent runtime when a person clicks Install; huggingface.co, until
  MiniLM and whisper-base are cached (then `HF_HUB_OFFLINE=1`): Open WebUI's downloads and, while MiniLM is not on
  disk, one HEAD from this app's main before each Open WebUI start (3 s, through the system proxy, none behind an env
  proxy; nothing about the person) to decide whether that launch starts offline. The coding agent itself talks only to the farm's
  `/v1` (its cloud, web and telemetry rows are off; checked with a netstat watch, 2026-09-28) — and, with **Use the
  Computer** on, to the Computer's MCP server on 127.0.0.1 (this machine).
- **The IDE's publishing, only on a person's click:** **Push** sends a project's committed files to the https git
  server a person typed (GitHub or a LAN Gitea), with a token kept encrypted by the OS (`safeStorage`,
  `<userData>/git-tokens.json`, never handed back to the page); **Pull** brings that server's commits here
  (fast-forward only, local work committed first). **Share on the LAN** serves one project read-only to the LAN
  until it is turned off or the app closes. A project's history (`.git`, isomorphic-git) stays in its folder in
  DATA_DIR.
- **Never sent anywhere:** documents for **embedding** (local model), a Computer Sound box's recording
  unless its Listen switch is on, and telemetry (off).

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
(`ENABLE_PERSISTENT_CONFIG=false` — OWUI's user-settings REST API only for what env can't do: undoing
the old web-search-on default, the date line, and the tool server; never the admin API);
default to local‑only; apply ComfyQ tokens to shell surfaces only.

**Don't:** edit/fork/patch OWUI source; store user data server‑side or send documents to the farm for
*embedding* (extraction via the farm OCR is the sanctioned exception — nothing is stored); rebrand
or hide Open WebUI; inject CSS into the OWUI webview; enable OWUI's built‑in local inference; raise
client worker counts; reimplement features OWUI already has; reuse ComfyQ's multicast port (pick a distinct one).

## Out of scope (prototype)

Modifying/forking Open WebUI; a shared/central knowledge base (needs central storage — conflicts with the
local‑data invariant); custom auth/SSO/multi‑tenant admin; notarization/paid signing; reimplementing chat,
RAG, or model management.
