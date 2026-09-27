# Docs review 2026-09-27: farm (`lol` CLI) and Farm app

Reviewer scope: `farm/**`, `farm-app/**`, `release-farm.yml`, `build-llamacpp-arm64.yml`; the in-app texts
(admin panel, Farm app wizard/Settings/status, CLI help and `lol up` messages); the farm parts of CLAUDE.md,
`farm/README.md`, `farm-app/README.md`, `docs/GETTING_STARTED.md` and `docs/RIG_CHECKLIST.md`.
Versions reviewed: `farm-app/package.json` 0.0.38, `farm/package.json` 0.1.0, llama.cpp pin `b10670`.
Farm unit tests (`node farm/test/run.js`, offline, ephemeral ports): **112 passed**. No farm, app or server was started.
The implementation is the reference, except where it is a bug. For each bug below, the doc describes the intended behavior.

---

## A. Bugs in the implementation

**FA-1 · Medium — With the external engine serving, the panel's Ollama, capacity and context controls stay live. They load Ollama models into the GPU the external server uses, and they report success for changes that do nothing.**
- Evidence: every exclusivity check tests only `config.llamacpp.enabled`, and external boot sets that to false (`up.js:427`). In the panel, `lcOn = be.engine === 'llama.cpp'` (`admin/index.html:392`), so under external the Ollama card says *"These are what this farm serves"* (`:429`) and shows Offer, Make default, Rename and Download. The slots, context and Apply rows render for every engine (`:276-312`). `applyFarmSettings` takes the Ollama path (`up.js:2241`, `:2306-2360`), so "People served at once" rewrites `ollama.numParallel` while seats keep using `external.parallel` (`snapshot.js:60`). `startModel`, `pullOllamaModel` and `setDefaultModel` warm models with `keep_alive: -1` (`up.js:1377`, `:2424`, `:1526`). An `auto` context triggers `resolveOllamaContext`, which does 2–4 full model loads (`up.js:594-651`). Ollama's own `OLLAMA_KEEP_ALIVE` only drops to `5m` for llama.cpp (`up.js:84`), and the pressure eviction only fires for llama.cpp (`perf.js:124`). The result: the OCR vision model and any warmed model stay pinned next to vLLM. The panel's own external banner says *"none of the engine controls below apply"* (`admin/index.html:216-220`).
- Fix: add one helper, `ollamaServes(config) = !config.llamacpp.enabled && !config.external.enabled`, and use it in `up.js` for every warm, probe, `setSlots`, `setContextLength`, `applyFarmSettings`, `setAdvertisedName`, `setModelAlias`, `startModel`, `setDefaultModel` and `pullOllamaModel` path. These should refuse with *"An external server is serving — set external.* in lol.config.json and restart"* when it is false. Use `5m` keep-alive and allow eviction whenever `!ollamaServes`. In the panel, treat `be.engine !== 'ollama'` as standby (not `=== 'llama.cpp'`), and hide the slots and context rows for external.
- Test: build an admin state with `backend.engine = 'external'` and render it in a DOM stub; assert there is no `#ctx-sel` or `#slots-sel` and no `data-act`/`data-dact` buttons. Add a unit test for `ollamaServes`.

**FA-2 · Medium — An engine switch does not carry a per-model Ollama name. Since 2026-08-31 that is the only way the panel names an Ollama model.**
- Evidence: `carryNameAcross` only reads and writes the global `modelAlias` (`up.js:1961-1973`). On Ollama, the panel's name field is hidden (`admin/index.html:265-272`) and the per-row **Rename** writes `models[].alias` (`up.js:2167-2204`). That alias outranks `modelAlias` (`litellm.js:58-59`). What happens: the operator renames the default to `tutor` and switches to llama.cpp. Clients then see `llamacpp.alias` (`assistant`), and chats bound to `tutor` ask to re-pick. After a switch back, `modelAlias='assistant'` is set but the own alias `tutor` wins, so a rename made in llama.cpp mode is lost. CLAUDE.md and `farm/README.md:125-126` promise the name survives the switch.
- Fix: going to llama.cpp, take the default entry's `servedName` from `servedEntries(config)`. If it is an alias (not the raw id), persist it as `llamacpp.alias`. Going back, write `llamacpp.alias` into the default entry's own alias when it has one, else into `modelAlias`.
- Test: make `carryNameAcross` a pure function in `litellm.js`. Assert that the default's served name before the switch equals the advertised id after it (`buildSnapshot(...).models[0].id`), in both directions.

**FA-3 · Medium — A fallback from llama.cpp or external to Ollama serves raw checkpoint ids, so every chat bound to the alias breaks for the whole fallback.**
- Evidence: the fallback paths set `llamacpp.enabled=false` or `external.enabled=false` in memory and never touch the names: `up.js:430-432` (external down at boot), `:437-442` (no prebuilt), `:842-846` (start failure) and `:801-806` (second crash). Switching to llama.cpp nulls `modelAlias` on disk (`up.js:1965-1968`). So with `modelAlias` null, `servedEntries` advertises `gemma4:12b` instead of `assistant` (`litellm.js:59`, `snapshot.js:171-174`). On a platform with no prebuilt and `llamacpp.enabled`, this happens on **every** boot.
- Fix: in each fallback, set in memory only (do not persist) `if (!config.modelAlias && !defaultHasOwnAlias) config.modelAlias = <the engine's alias>`.
- Test: config with `llamacpp.enabled:true, modelAlias:null`; simulate the fallback helper; assert `buildSnapshot(c,{}).models[0].id === 'assistant'`.

**FA-4 · Medium — The Farm app's "private" mode leaves web search, and voice if enabled, listening on the LAN.**
- Evidence: private mode only rebinds `proxy.host` and turns the beacon off (`installer.ts:199-206`). The plugins hard-code `0.0.0.0`: SearXNG at `searxng.js:301`, OCR at `extract.js:107`, Kokoro at `kokoro.js:188`. SearXNG (on by default) has no auth; OCR needs a bearer key, so it is covered. The app tells the operator *"No one else on the network can reach or use it."* (`farm-app/renderer/app.js:207`, `types.ts:59-62`, `farm-app/README.md:87-90`).
- Fix: bind every plugin to `config.proxy.host`. Clients only learn the URLs through the beacon, which is off when private anyway.
- Test: pass a spy to `spawnSearxng`, `spawnExtract` and `spawnKokoro` and assert the bind address follows `proxy.host`.

**FA-5 · Low-Medium — Under llama.cpp, a panel Download or Delete of an Ollama model restarts the proxy for nothing and pins the model in VRAM.**
- Evidence: `pullOllamaModel` calls `applyModels`, which calls `restartProxy` (`up.js:2419`). That kills LiteLLM, so in-flight chats drop and the gate returns 502 `lol_upstream_down` while the proxy restarts. Yet the routing does not change under llama.cpp (`litellm.js:163`). It then warms the model with `keep_alive -1` next to llama-server (`up.js:2424`). `removeOllamaModel` also restarts the proxy through `stopModel` (`up.js:2447`). The panel says the model is *"downloaded and offered to clients"* (`admin/index.html:432`).
- Fix: when `!ollamaServes` (see FA-1), update `config.models` and persist without `restartProxy` and without warming.
- Test: pure check that `buildLitellmConfig` gives the same output with and without the added model when `llamacpp.enabled` (this passes today); put the no-restart guard behind that.

**FA-6 · Low — Every farm advertises version `0.1.0`, so builds can't be told apart.**
- Evidence: `snapshot.js:15,195` and `lol --version` (`bin/lol.js:55`) read `farm/package.json`, which has been `0.1.0` since the first commit. `farm-app/scripts/release.mjs` only bumps `farm-app/package.json`. `lol fleet` prints `farm v0.1.0` for every box (`fleet.js:33`). This is the diagnosis gap behind the "old farm on AN-VR-01" confusion.
- Fix: in `farmSupervisor.ts`, pass `LOL_FARM_VERSION=app.getVersion()` in the env; in `snapshot.js`, use `process.env.LOL_FARM_VERSION || PKG_VERSION`. Or have `release.mjs` bump `farm/package.json` too.
- Test: set the env var and assert `buildSnapshot(...).version` matches it.

**FA-7 · Low — `lol models add|rm|pull` break the farm's own config rules.**
- Evidence: `add` and `rm` write the **schema-parsed** config back (`models.js:56-59`, `:66-71`). That freezes every default into the operator's file, which `configFile.js:11-14` names as the thing never to do. `pull` fetches `m.id` for derived (`source`) models (`models.js:88-93`), which 404s (`install.js:209-212` explains why).
- Fix: use `patchConfigFile(p, raw => { raw.models = …; })`, and pull `m.source || m.id`.
- Test: temp config `{ "models":[…] }`; after `add`, assert that no key other than `models` appears in the file.

**FA-8 · Low — Deriving a `source` model sends `num_ctx: "auto"` to Ollama.**
- Evidence: `Object.assign({ num_ctx: config.ollama.contextLength }, m.params)` runs at `up.js:279` and `install.js:243`, and `'auto'` is the default (`config.js:131`). It then goes straight into `/api/create` (`ollama.js:286`) or a Modelfile `PARAMETER` (`ollama.js:407`). The shipped `preinstall` hides this because it pins `num_ctx: 8192` (`config.js:449`); any operator-added `source` model without its own `num_ctx` hits it.
- Fix: include `num_ctx` only when `typeof contextLength === 'number'`, since the routed per-request `num_ctx` governs anyway.
- Test: a pure helper `deriveParams(config, m)` must not include the string `'auto'`.

**FA-9 · Low — On a multi-host Ollama farm, "People served at once" shows the total but writes it back as the per-host value.**
- Evidence: the select shows and compares `be.slots = numParallel × hostsUp` (`snapshot.js:107-108`, `admin/index.html:282-284`). Apply stores the number as `ollama.numParallel` (`up.js:2323`) and treats it as unchanged when it equals `numParallel` (`:2253`). With 2 hosts × 2, picking "2" says "Nothing changed", and picking "8" gives 16.
- Fix: on Ollama, send and compare `numParallel` (per host) and label the row "per box".
- Test: DOM-stub render with `backend.slots=4, ollama.numParallel=2, hosts=2`; the selected option must be `2`.

---

## B. In-app text that is wrong or missing

| # | Where | Now | Replace with |
|---|---|---|---|
| B-1 | `farm/src/admin/index.html:291` | `…stay open on the LAN. Apply an empty field to remove it.` (an empty field means "unchanged", `:582-583`; removal is the **Remove** button, `:294`) | `…stay open on the LAN. Use <b>Remove</b> to take it off.` |
| B-2 | `admin/index.html:508` | `Everything here applies to the running farm and is remembered across restarts.` (the plugin toggles and the Blender recommendation are session-only, `up.js:1719-1756`; Ollama slots need a farm restart, `up.js:2090-2093`) | `Changes apply to the running farm and are saved to lol.config.json, except the plugin toggles and the Blender recommendation (this session only) and Ollama's "people served at once" (after a farm restart).` |
| B-3 | `admin/index.html:427-429` | For any engine other than llama.cpp: `These are what this farm serves. The ★ one is what clients auto-select.` (false under external) | Key the hint on `be.engine !== 'ollama'`: `<b>Not served right now</b> — one engine at a time, and ${engineName} is serving. These stay installed for an engine switch, and document reading uses its model from here.` |
| B-4 | `admin/index.html:432` | `…it is downloaded and offered to clients` | `…downloaded to this box and offered to clients while Ollama is the engine` |
| B-5 | `admin/index.html:251` | `One model, fastest. Speculative decoding, quantised KV cache.` (`mtp` defaults to false; the default quant has no MTP head, `config.js:271`) | `One model, fastest. Quantised KV cache; speculative decoding (MTP) on quants that keep their MTP head.` |
| B-6 | `farm/src/commands/up.js:2109` and `:1691` | `${want} slot(s), ${perSlot} tokens of context each` / `(${perSlot} per slot across N slots)`: wrong under `kvUnified` (the default, `config.js:266`) | When `kvUnified !== false`: `${want} slot(s) sharing one ${ctxNum}-token context pool (${perSlot} guaranteed each).` / `Context window is ${want} tokens, one pool shared by ${parallel} slots (${perSlot} guaranteed each).` Keep the current text for `kvUnified:false`. |
| B-7 | `up.js:867` | `Generated LiteLLM routing → … (${models} model × ${hosts} host deployments)`, printed even when llama.cpp or external is the only deployment | Print the engine: `(llama.cpp :${port})`, `(external ${baseUrl})` or `(${models} model × ${hosts} host)`, plus `+ N peer` |
| B-8 | `farm/src/commands/bench.js:126` | `Reminder: one Ollama runs ${numParallel} generation(s)…` (also printed under llama.cpp) | Under llama.cpp: `Reminder: llama-server runs ${llamacpp.parallel} generation(s) at once (llamacpp.parallel); more queue.` |
| B-9 | `farm/src/commands/init.js:32-33` | `models + ollama.contextLength are preset for 12 GB cards … raise contextLength and pick a higher quant.` (the context is `'auto'`, `config.js:131`) | `Context sizes itself per box ("auto"). The default preinstall stages a ~8.6 GB Qwen3.8-27B: set "preinstall": [] before \`lol install\` to skip it.` |
| B-10 | `farm/bin/lol.js:11-12`, `:17` | `install Ollama + LiteLLM and pull the configured models.` · `--model <id[,id]>` | `install Ollama + LiteLLM, pull models + preinstall, build the web-search/OCR venvs (+ llama.cpp when enabled).` · `--model <id[=alias][,…]> (-m)` (`modelPicker.js:73`) |
| B-11 | `farm-app/renderer/index.html:41-42` | `Downloads its own AI engines (llama.cpp + Ollama)` · `around 28 GB in total` (llama.cpp is off by default and `install.js:288` skips it) | `Downloads its own AI engine (Ollama) and helpers` · `Fetches gemma4:12b plus a staged Qwen3.8-27B: about 18 GB in total` (sizes from `config.js:426` and `GETTING_STARTED.md:24-27`) |
| B-12 | `farm-app/src/main/installer.ts:46` | `deps: 'Services — proxy, search, OCR'` (this phase also pulls `preinstall` plus its draft, ~8.6 GB, through `lol install`, `install.js:208`) | `deps: 'Services — proxy, search, OCR + staged model (~8.6 GB)'` |
| B-13 | `farm-app/renderer/app.js:207` | `No one else on the network can reach or use it.` | Correct once FA-4 is fixed. Until then: `…can't reach its chat or discovery (web search on :8888 stays reachable).` |

---

## C. Technical doc drift

### CLAUDE.md (the integrator applies these)

1. **Build-status header.** `Farm app farm-v0.0.20` → `Farm app farm-v0.0.38` (`farm-app/package.json:3`).
2. **Farm bullet in "Build status".** Stale claims: "TWO engines" (there are three); a self-contradictory linux-arm64 prebuilt sentence; Ollama `auto` with a "262144 cap, cache per (model, VRAM, parallel), floor 16384" (the truth: cap = the model's native max, the cache key includes `kvCacheType`, and it walks down to 8192/4096, `up.js:582,612,617-623`); "llama.cpp splits contextLength across slots" (with `kvUnified` on by default it is one pool, `config.js:266`, `llamacpp.js:203`); "`lol install` pre-fetches llama.cpp" (only when enabled, `install.js:288`); an incomplete panel list; "everything but plugin toggles persists" (the Blender recommendation doesn't either, `up.js:1748-1756`). Replace the whole bullet with:

   > - **`farm/`** — the `lol` CLI (verified end-to-end: `lol up` → real `/v1/chat/completions`; status/down; beacon + `/lol/self`). **Three engines behind one LiteLLM endpoint, exactly one serving at a time** (owner decisions 2026-08-26/27, 09-07):
   >   - **Ollama — the default.** Serves the `models` catalog, default `gemma4:12b` (vision-native, also the OCR model). `ollama.contextLength: 'auto'` MEASURES the largest `num_ctx` that stays fully in VRAM: it loads the default at 16k and 32k, takes the per-token slope from `/api/ps`, aims at min(model native max, VRAM − 8%), and verifies with one more load (one halving and then 16k if that spills; 8k/4k if even 16k spills). The verdict is cached per (model, VRAM, numParallel, kvCacheType). Per-arch KV math is deliberately not used (Gemma's sliding window). `kvCacheType` q8_0 and `numParallel` 2 only apply to an Ollama the farm starts; otherwise the panel flags capacity as unverified. Routed `keep_alive` must be a number (`keepAliveValue()`).
   >   - **llama.cpp — opt-in (`llamacpp.enabled`).** `llama-server` build **b10670** serves ONE `.gguf` (`llamacpp.model`, default Unsloth Qwen3.8-27B-UD-IQ2_S) as `llamacpp.alias` (`assistant`). `contextLength: 'auto'` = min(native max, VRAM budget) from the GGUF header (`gguf.js`). `kvUnified` (default true) is one KV pool shared by the `parallel` slots: a person alone gets the whole window, and `backend.contextPerSlot` advertises the ctx/slots floor. `mtp` defaults to false (Unsloth strips the MTP head below UD-Q2_K_XL). Prebuilts: win-x64 (ggml-org, CUDA 13.3) and linux-arm64/DGX Spark (our `build-llamacpp-arm64.yml` → the `llamacpp-<build>` prerelease); anywhere else, set `llamacpp.binDir`. If it cannot start (no prebuilt, a failed download or load), the farm **falls back to Ollama for that run** and shows the reason on the panel. A crash mid-run gets one restart; a second crash within 5 min falls back too.
   >   - **external — opt-in, config file only (2026-09-07).** Routes to an OpenAI-compatible server the operator runs (vLLM/SGLang/TensorRT-LLM), and outranks llama.cpp. The farm never installs, starts or restarts it. Health = `GET {baseUrl}/models`: unreachable at boot → fallback; dies later → the farm goes unhealthy and clients fail over. `contextLength`/`parallel` are declarations; they size the client RAG gate and the seats.
   >   - The advertised name survives an engine switch and a fallback (`carryNameAcross`), so bound chats keep working.
   >   - **Seat gate** (`proxy.seatGate`, default true): the public `proxy.port` is the farm's own streaming listener (`seats.js`), with LiteLLM on `127.0.0.1:proxy.internalPort` (default port+1). An IP's completions claim or refresh a seat; capacity = the serving engine's slots. A seat idle for `proxy.seatIdleSec` (900 s) frees. A completion on a full farm gets 429 `lol_seats_full`.
   >   - `proxy.masterKey` = the shared **farm password** (LiteLLM `master_key`). Discovery, `/health/liveliness` and the admin token stay separate.
   >   - **Admin panel** at `http://<box>:41997/lol/admin`, with bearer = `admin.token`, or a per-run token printed by `lol up` (the Farm app pins one). It covers:
   >     - the engine switch (llama.cpp ↔ Ollama)
   >     - the `.gguf` library: add by URL (split files too) / Use this, with rollback
   >     - the name users see (llama.cpp) or per-model **Rename** (Ollama)
   >     - people served at once, the context window (Automatic on both engines) and the farm password, all under one **Apply changes** that costs one restart
   >     - Ollama download / offer / stop / delete / Make default
   >     - plugin toggles and the Blender recommendation
   >     - a Performance card (llama.cpp) and clients with their seats
   >
   >     Long operations run as a single job whose progress the panel polls. Everything persists to `lol.config.json` (`configFile.js` raw patch) **except** the plugin toggles and the Blender recommendation. Ollama's slot count applies after a farm restart.
   >   - **Plugins** (`plugins/registry.js`): web search (SearXNG, ON), document OCR (`pysvc` + `extract.js`, ON, hybrid text/vision PDF), Kokoro TTS (OFF).
   >   - Also: coordinator mode, `lol fleet`/`lol bench`, `modelAlias` + the `lol up` picker, and `lol install` (Ollama, the LiteLLM venv, `models` + `preinstall` (ships a ~8.6 GB staged Qwen3.8-27B), the SearXNG/OCR venvs, and llama.cpp only when enabled).

   *Apply the "name survives" sentence only together with the FA-2/FA-3 fixes. Until then, use: "An engine switch carries the global name (`modelAlias` ↔ `llamacpp.alias`); a per-model Ollama name and a boot/crash fallback do not carry yet."*
3. **"What we are building" #1.** Replace the second sentence with: `Reads a declarative lol.config.json, brings up the serving engine (Ollama by default; llama.cpp or an operator-run external server opt-in), generates and runs a LiteLLM proxy behind the farm's seat gate (one OpenAI-compatible endpoint, load-balanced across boxes), hosts the shared plugins and the admin panel, and runs a UDP discovery beacon (+ unicast /lol/self) so clients find the farm automatically.`
4. **"What we are building" #4 (Farm app).** It says "update checks are manual" and gives an incomplete Settings list. In fact the check runs automatically at launch when "Notify me about updates" is on (`updater.ts:82-87`, `index.ts:241`) and only the install is manual; Settings also shows the panel access token (`renderer/index.html:118`). Replace with: `The Farm app (farm-app/, Electron) — the operator-facing sibling of the client: a first-run wizard downloads its own Python + Ollama, copies the farm code to userData/farm, pulls gemma4:12b, runs lol install (venvs + the staged preinstall model), then supervises lol up --no-pick and shows the admin panel as its window (token auto-seeded). Private by default (proxy.host 127.0.0.1, beacon off) until Settings ▸ Share compute. Its Settings drawer holds only app-level things (share-with-LAN → proxy.host/beacon.enabled, theme, launch-at-login, update notifications + Check for updates, the panel access token, logs folder); it deliberately never re-applies model settings at boot. Released on farm-v* tags as GitHub prereleases (Windows x64, macOS arm64, Linux arm64 AppImage). No electron-updater: the app looks for a newer farm-v* release (at launch when enabled, or on demand) and opens its download page; installing is manual.`
5. **`lol.config.json` example.** It omits external, seat-gate, host and masterKey; shows `llamacpp.contextLength: 16384` against an `auto` default; comments `proxy.port` as the "LiteLLM endpoint" (it is the seat gate, `up.js:880-882`); and leaves `Full reference…` *inside* the code fence. It also cites an "alias-collision rule" that no longer exists: engines are exclusive in routing (`litellm.js:124,163`), and `carryNameAcross(false)` *sets* `modelAlias = llamacpp.alias` on purpose (`up.js:1969-1971`). Replace the block with:
   ```jsonc
   {
     "name": "Studio Farm",
     "beacon": { "enabled": true, "group": "239.255.43.10", "port": 41998, "intervalSec": 5, "httpPort": 41997 },
     "proxy":  { "port": 4000, "host": "0.0.0.0",   // port = the seat gate; LiteLLM listens on 127.0.0.1:port+1
                 "masterKey": null,                  // the shared farm password (null = open LAN)
                 "seatGate": true, "seatIdleSec": 900 },
     "models": [ { "id": "gemma4:12b", "default": true } ],   // Ollama catalog = the DEFAULT engine's serving set
     "modelAlias": null,                             // optional stable name for the default Ollama model
     "preinstall": [ /* staged, never served — ships Qwen3.8-27B UD-IQ2_XXS + draft (~8.6 GB) */ ],
     "ollama": { "hosts": ["http://127.0.0.1:11434"], "numParallel": 2, "maxLoadedModels": 1,
                 "flashAttention": true, "kvCacheType": "q8_0", "keepAlive": "-1",
                 "contextLength": "auto" },          // probed per box; a number pins it
     "llamacpp": { "enabled": true,                  // OPT-IN (default false): ONE .gguf served as `alias`
                   "alias": "assistant",
                   "model": "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-UD-IQ2_S.gguf",
                   "contextLength": "auto",          // min(native max, VRAM budget); a number pins it (over-size warns)
                   "parallel": 1, "kvUnified": true, // one KV pool shared by the slots; false = hard split
                   "kvCacheType": "q4_0", "mtp": false, "cacheRam": "auto" },   // mtp needs UD-Q2_K_XL+
     "external": { "enabled": false, "alias": "assistant", "baseUrl": "http://127.0.0.1:8000/v1",
                   "contextLength": 32768, "parallel": 4 },   // operator-run vLLM/SGLang; DECLARED values
     "websearch": { "enabled": true }, "ocr": { "enabled": true }, "tts": { "enabled": false },
     "admin": { "token": null }                      // null = a fresh token per `lol up`, printed in the banner
   }
   ```
   After the closing fence: `Full reference and the name-uniqueness rule (a per-model name may not duplicate another served name, up.js:2173-2179): [farm/README.md](farm/README.md#config--lolconfigjson).`
6. **CLI commands table.** It misses `models rm`, the aliases (`setup`, `serve`, `stop`) and most of `lol up` (`bin/lol.js:60-79`). Replace these rows:
   - `lol install` / `setup`: `One-time, idempotent bootstrap: Ollama, the LiteLLM venv, every models + preinstall entry, the SearXNG + OCR venvs, and (only when llamacpp.enabled) the llama.cpp build + weights.`
   - `lol up` / `serve`: `Probe an external engine; ensure Ollama (start a local one if down); pick the Ollama models (prompt / --model / --no-pick); pull what's missing; start llama-server if enabled (fall back to Ollama on failure); size the Ollama context; generate litellm/config.generated.yaml; start LiteLLM on loopback + the seat gate on proxy.port; start the plugins; start the beacon, /lol/self and the admin panel; print the admin token. Foreground.`
   - `lol down` / `stop`: keep the current text.
   - `lol models ls | add <id> | rm <id> | pull`: `Manage the Ollama catalog in models (then lol up --no-pick).`
7. **"Backend" notes.** `The CLI generates the LiteLLM config.yaml` → `The CLI generates litellm/config.generated.yaml (routing least-busy, num_retries 3, allowed_fails 1, cooldown 60 s — litellm.js:230-239); with llama.cpp or external serving, one OpenAI deployment (+ coordinator peers) replaces the Ollama catalog.` In the repo layout, `generated config.yaml` → `generated config.generated.yaml`.
8. **Discovery, snapshot fields.** The list misses the fields clients rely on (`snapshot.js:175-281`). Replace the parenthesis with: `(farm/src/snapshot.js — the same object GET /lol/self serves: id/name/proxyPort/httpPort/ips/endpoint/openaiBaseUrl/requiresKey/models[{id,underlying,default}]/healthy/version/coordinator, searxngUrl/ttsUrl/extract, plugins, recommendedClientPlugins, host/usage, backend {engine, model, contextLength, contextPerSlot, slots, slotsVerified}, capacity {slots, clients, seatsUsed, seatIdleSec, busy, queued}, busy (the admin job in flight) and perf)`. Also add: `sent every intervalSec plus an immediate kick on every change`.

### farm/README.md

| Line | Stale claim | Truth (citation) | Replacement |
|---|---|---|---|
| 17-20 | The Farm app "has no UI for `llamacpp.parallel`, so serving a group still means editing the config" | The panel (the app's window) has "People served at once" (`admin/index.html:276-284`, `up.js:2082`) | Delete that sentence. |
| 62 | `lol install` "downloads the pinned llama-server … weights" | Only when enabled (`install.js:288-291`) | Prefix the row with `Only when llamacpp.enabled:` |
| 186, 487 | "ships with the three quants" | Four entries, including an NVFP4+MTP Blackwell build (`config.js:196-241`) | `ships with four: the three 12 GB-class Qwen3.8-27B quants measured here, plus an NVFP4+MTP build for Blackwell cards (16 GB+)` |
| 223-224, 476-477 | The Backend card's **Name users see** sets `modelAlias` when llama.cpp is off | The field is llama.cpp-only; on Ollama you name models with per-row **Rename** → `models[].alias` (`admin/index.html:265-272`, `up.js:2167`) | `Set it in the panel: on llama.cpp, Backend ▸ Name users see (llamacpp.alias); on Ollama, the Rename button on each model row (models[].alias). modelAlias is config-file only.` |
| 240-241 | Download is "immediately offered to clients" | Only while Ollama is the engine (`litellm.js:163`) | `…pulled onto every local host and offered to clients while Ollama is the engine.` |
| 285-290 | Exceptions: plugin toggles, Ollama slots | Also the Blender recommendation (`up.js:1748-1756`) | `- **Plugin toggles** and the **Blender recommendation** are for this session only.` |
| 300-317 | "Raising it splits the context window … `--parallel 2 → n_ctx_slot = 8192` … raise both" | `kvUnified` is on by default: one shared pool (`config.js:260-266`, `llamacpp.js:203`) | `llama.cpp serves llamacpp.parallel requests at once (default 1). With kvUnified (the default) the slots share ONE context pool: a person alone gets the whole window, and under full contention each is guaranteed contextLength ÷ parallel (what the beacon advertises as contextPerSlot). For N busy users at a W-token window, set contextLength ≈ N × W and check VRAM. kvUnified:false restores the hard split (--ctx-size 16384 --parallel 2 → 8192 each).` |
| 337-344, 459 | Ollama auto "loads at a VRAM-tiered candidate … per (model, VRAM, parallel) … floor 16384" | Two-point slope (16k/32k) plus a verify load; cap = native max; key includes kvCacheType; walks down to 8192/4096 (`up.js:582-653`) | `…loads the default model at 16k and 32k, derives the per-token cost from /api/ps, aims at min(native max, VRAM − 8%) and verifies with one more load (one halving, then 16k, if it spills). The verdict is cached per (model, VRAM, numParallel, kvCacheType). If even 16k spills it walks down to 8192/4096.` Line 459: `floor 16384` → `4096 if even 16k spills` |
| 385-389 | Capacity is "advisory — the farm never turns anyone away past slots, it queues them" | The seat gate (default on) returns 429 when every seat is held (`seats.js:98-109`) | `Past slots the seat gate refuses NEW generations with a clear 429 ("All N seats … in use") until a seat has been idle proxy.seatIdleSec (15 min). The panel's Clients card reads "N of M seats in use". Set proxy.seatGate:false to go back to queueing.` |
| 402-403 | "Apply with the field empty to remove it" | Empty = unchanged; the **Remove** button clears it (`admin/index.html:571,582-588`) | `To remove it, press Remove next to the field (it asks to confirm).` |
| 424 | `modelAlias` "MUST NOT equal llamacpp.alias — see the warning below" (there is no warning below) | Engines are exclusive in routing; `carryNameAcross(false)` sets `modelAlias = llamacpp.alias` on purpose (`up.js:1969-1971`) | `// stable name for the default OLLAMA model (null = raw id); copied from llamacpp.alias on an engine switch` |
| 581, 603 | "(llama.cpp, on by default)"; the port list | Off by default; the seat gate also takes port+1 (`up.js:881`) | `(llama.cpp, if enabled)`; add a step `2b. (Ollama engine) size the context ("auto" probe)` and a step `7b. Start the seat gate on proxy.port (LiteLLM on 127.0.0.1:port+1)`; ports `4000 / 4001 / 41997 / 8081 / 8888 / 8890` |

### farm-app/README.md

| Line | Stale | Replacement (citations) |
|---|---|---|
| 22 | Services "pre-fetches the llama.cpp backend … (~8.7 GB)" | `lol install builds the LiteLLM / SearXNG / OCR venvs (and pre-fetches the llama.cpp backend only if llamacpp.enabled — off by default).` (`install.js:288`, `installer.ts:115-125`) |
| 30 | "~28 GB and typically 30–45 minutes" | `~18 GB (gemma4:12b + the staged model + venvs) plus the Python/Ollama runtime` (matches `GETTING_STARTED.md:27`) |
| 47-48, 58-59 | Settings = share, theme, launch-at-login, updates, logs | Add `the panel access token (Copy)` and write `update notifications + Check for updates` (`renderer/index.html:115-121`) |
| 61-65 | Naming renames `llamacpp.alias` "or the global `modelAlias` when llama.cpp is off" | `…renames the served id: on llama.cpp, Backend ▸ Name users see; on Ollama, each model row's Rename (models[].alias).` (`admin/index.html:265-272`) |
| 71-79 | "one request at a time out of the box (`llamacpp.parallel: 1`) … splits its context window across slots" · "1 of 2 slots in use" | `Out of the box the farm serves gemma4:12b on Ollama, 2 requests at a time (ollama.numParallel, applied after a farm restart). On llama.cpp the default is 1; its slots share one context pool (kvUnified). Past capacity, new generations get a clear "all seats in use" until a seat is idle 15 min.` (`config.js:85,250,266`; `seats.js:98-109`) |
| 81-83 | "A fresh install starts at a 16k context window" | `A fresh install starts on Automatic: the farm measures the largest window this GPU holds and caches it.` (`store.ts:20`, `installer.ts:122`) |
| 98-100 | "no per-device allow-list yet (needs `proxy.masterKey` plus a key-entry screen)" | `To limit who uses a shared farm, set a farm password (panel ▸ Backend ▸ Farm password); clients prompt for it once.` (`up.js:2212`) |
| 108-111 | "the app writes `ollama.contextLength` from its own Settings, default 64k" | `…the app seeds ollama.contextLength ("auto") once, at setup; the panel owns it afterwards.` (`index.ts:249-253`) |

### docs/GETTING_STARTED.md

| Line | Stale | Replacement |
|---|---|---|
| 18 | Route B is "Required if you want to change the chat model, add models to the picker, or serve more than one person" | `—` for both columns. The Farm app's window is the admin panel, which does all three (`admin/index.html:249-312,431-434`) |
| 57 | "downloads ~28 GB and takes 30–45 minutes" | `downloads ~18 GB (see the table above) plus its own Python/Ollama runtime` |
| 112 | contextLength "SPLIT across the slots below" | `one pool shared by the slots below (kvUnified)` |
| 139-145, 157-160 | Step 3 "starts llama-server…"; "Clients auto-select the llama.cpp model … `assistant`" | Step 3: `if llama.cpp is enabled, starts llama-server (else sizes the Ollama context)`. And: `Clients auto-select the farm's default model — gemma4:12b on the default Ollama engine (or its alias if you set one); with llama.cpp enabled, llamacpp.alias ("assistant") is the only model they see.` |
| 205-206 | "`assistant` by default — the Farm app's Settings ▸ **Model name**, or `llamacpp.alias`" | `the name the operator chose in the farm panel (gemma4:12b by default; assistant on a llama.cpp farm)` |
| 252-262, 289-294, 309-313 | "answers one request at a time … raise `llamacpp.parallel` … not in the Farm app yet"; "splits the context window"; "advisory — nobody is turned away" | `Out of the box the farm (gemma4 on Ollama) answers two requests at a time; raise it in the panel (Backend ▸ People served at once; on Ollama it applies after a farm restart). On llama.cpp the default is 1, and the slots share one context pool: a person alone gets the whole window. When every seat is taken, a new question gets a clear "all seats in use" until someone has been idle 15 min.` Keep the VRAM table as totals. |
| 334-336 | Rename via "Name users see" | `On llama.cpp: Backend ▸ Name users see. On Ollama: the Rename button on the model's row.` |
| 377-378 | "Empty + Apply removes it" | `Remove (next to the field) takes it off.` |
| 381-384, 465 | "the context window is split across slots" · glossary "slot" | `the slots share one context pool; the panel shows the guaranteed share per person` · glossary: `slot (parallel) — one generation the server runs at a time. llama.cpp slots share one context pool by default (kvUnified).` |
| 411-413 | Cause 1: "The default `llamacpp.parallel: 1`" | `Several people at once, few slots (Ollama default 2 per box, llama.cpp default 1): the rest queue, or get "all seats in use" once every seat is held.` |

### docs/RIG_CHECKLIST.md

| Line | Stale | Replacement |
|---|---|---|
| 88-89 | "`lol up` starts its own with `OLLAMA_CONTEXT_LENGTH=65536`" | `…starts its own Ollama (OLLAMA_CONTEXT_LENGTH seed 16384) and the "auto" probe settles the served num_ctx (the "Context: auto → N" log line)` (`up.js:89,572-666`) |
| 105-107 | "★ the app self-updates via the farm channel (farm.yml)" | `★ Manual update check: with farm-v0.0.N installed, publish farm-v0.0.N+1 as a prerelease → at launch (Notify on) the app shows "Version … is available" and Download opens the release page; the client's v* auto-update is unaffected` (`updater.ts`, `release-farm.yml:38`) |
| (new) | — | Add unchecked items for: the seat gate (two source IPs, 1 seat → 429 `lol_seats_full`); an external engine killed mid-run → the farm goes unhealthy and clients fail over; llama.cpp on the DGX Spark from the `llamacpp-b10670` tarball; an engine switch that keeps the served name (FA-2) |

---

## D. Undocumented features (shipped and reachable)

- **llama-server crash supervision:** one automatic restart, then a fallback to Ollama if it dies twice within 5 min (`up.js:773-808`). It is documented in neither layer; only the panel reason "crashed twice in 5 minutes" shows it.
- **Pressure eviction:** under llama.cpp, Ollama models are evicted when VRAM is ≥92% and the GPU is ≤20% busy (`perf.js:123-129`, `up.js:1207-1218`). This is in-app only (`admin/index.html:342`).
- **"Capacity is unverified":** with an Ollama the farm did not start, `slotsVerified:false`, and the panel shows the exact env line to fix it (`snapshot.js:121-136`, `admin/index.html:493-499`). This is in-app only; the README only mentions the CLI printout.
- **A reachable Ollama is required** even when llama.cpp or external serves: `lol up` exits if no host answers (`up.js:206-208,445-446`). This is in neither layer.
- **Farm app port relocation:** SearXNG and OCR move off a taken 8888/8890 by patching `lol.config.json` before each start (`installer.ts:178-193`). This is in neither layer.
- **Farm app "Panel access token"** (copy, to drive the panel from another browser) (`renderer/index.html:118-119`). This is in-app only.
- **One "Apply changes"** batches name, slots, password and context into a single restart (`/lol/admin/apply`, `up.js:2239`). This is in-app only; the docs still describe per-field Apply.
- **Admin HTTP API:** `/lol/admin/apply`, `/model/alias`, `/model/default`, `/context` and `/plugin/recommend` are missing from the route header in `selfServer.js:1-16` and from every doc.

## E. Checked and consistent

- Beacon group, port and httpPort `239.255.43.10:41998` / `41997` match everywhere (`config.js:57-62`).
- The beacon sends multicast + directed broadcast + limited broadcast, deduped, with `setBroadcast` and TTL 4 (`beacon.js:37-74`); this matches CLAUDE.md "Discovery".
- Plugin defaults: websearch ON, OCR ON, TTS OFF (`config.js:328,352,337`).
- Ollama defaults: `kvCacheType` q8_0, `numParallel` 2, `maxLoadedModels` 1, `flashAttention` true, `keepAlive` "-1", `contextLength` "auto" (`config.js:84-131`).
- llama.cpp defaults: enabled false, alias `assistant`, UD-IQ2_S URL, context `auto`, parallel 1, q4_0, kvUnified, cacheRam auto, mtp false, port 8081 (`config.js:155-277`).
- external defaults and behavior: `/models` probe, fallback at boot, unhealthy on death, no panel switch (`config.js:298-319`, `up.js:113-134,421-434,1185-1194,1896`).
- Seat gate: `seatGate` true, `seatIdleSec` 900 (min 60), `internalPort` = port+1, LiteLLM on loopback, 429 `lol_seats_full` (`config.js:78-80`, `up.js:880-886`, `seats.js:98-109`).
- Admin token: null → a random token per run, printed in the banner; the Farm app pins and seeds it (`up.js:383,1252`, `installer.ts:73-79`, `index.ts:63-69`).
- `keep_alive` is coerced to a number in routing and warm-up (`litellm.js:49-51,190`, `ollama.js:162`).
- Engine exclusivity holds in both routing and the snapshot (`litellm.js:124,163`, `snapshot.js:171-174`).
- The CLI command set in `bin/lol.js:60-79` matches the `farm/README.md` Commands table.
- llama.cpp pin `b10670`: `llamacpp.js:37` = `build-llamacpp-arm64.yml:27`; the tarball name and the prerelease `llamacpp-<build>` tag match (`llamacpp.js:58,75`, workflow `:87,95-101`).
- Prebuilt matrix: win-x64 (ggml-org, cuda-13.3) and linux-arm64 (ours); otherwise `binDir` or fallback (`llamacpp.js:59-79`, `up.js:437-442`). This matches `farm/README.md:128-140`.
- Farm releases: a `farm-v*` tag creates a prerelease with Win x64 NSIS, mac arm64 dmg+zip and linux arm64 AppImage; artifact names match `GETTING_STARTED.md:50-52` (`release-farm.yml`, `electron-builder.yml`).
- Farm app updates: a GitHub API query for the newest `farm-v*` (prereleases included) plus a Download button; no electron-updater (`updater.ts`). This matches `farm-app/README.md:144-157`.
- Share mode maps to `proxy.host` + `beacon.enabled` (`installer.ts:199-206`).
- The Farm app no longer re-applies name or context at boot (`index.ts:249-254`).
- `/lol/self` is open with CORS; every `/lol/admin/*` route needs the bearer, compared in constant time (`selfServer.js:40-49,71-101`).
- Client presence: `/lol/client-ping`, 30 s TTL, 200-entry cap (`up.js:1051-1090`). This matches the README.
- The mtp rule and the automatic MTP-off on a library swap (`llamacpp.js:179,400-401`, `up.js:2005-2008`) match the README.
- Split-GGUF fetch (`llamacpp.js:221-325`) matches README and panel.
- An over-size context is honored with a loud warning (`up.js:719-726`), which matches the README.
- Farm password = LiteLLM `master_key`; a coordinator skips passworded peers (`litellm.js:253-255`, `up.js:335-342`), which matches the README and GETTING_STARTED rough edges.
- `lol up` flags `--model[=alias]`, `--no-pick`/`-y`, `--alias`/`--no-alias`, `--coordinator`, and `--websearch`/`--tts`/`--ocr` with their `--no-*` forms (`up.js:371-380`, `modelPicker.js:17-34`) match the README.
- Farm unit tests: 112/112 passed offline.
