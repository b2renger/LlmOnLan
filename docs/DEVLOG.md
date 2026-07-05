# DEVLOG — LlmOnLan

A running, dated log of what was built, how it was tested, and decisions taken. Newest first.
Each milestone lands as one (or a few) granular commits; an entry here is written **before** the
commit so the history records that a feature was tested + documented before it was pushed.

---

## 2026-07-05 — Admin panel: connected-clients presence (count, idle time, versions)

The panel now answers "who's actually using this farm right now?". The farm's Node
process never sees chat traffic (LiteLLM proxies it), so presence comes from the
clients: a **heartbeat**, mirroring ComfyQ's `usersConnected`/`idleSec` usage block.

- **Client → farm heartbeat.** Every 10 s the shell fire-and-forget POSTs
  `/lol/client-ping` on its ACTIVE farm's `httpPort` with `{ id, name, platform,
  version, idleSec }` ([index.ts](../shell/src/main/index.ts) `startClientHeartbeat`):
  `id` is a stable per-install UUID persisted in settings (`clientId`); `idleSec` is
  Electron `powerMonitor.getSystemIdleTime()` — machine-wide input idle, i.e. "is a
  human at that seat", not just "is the app open". 3 s abort timeout, `unref`'d timer,
  never throws; farms without `httpPort` are skipped, an old farm 404s harmlessly.
- **Farm side.** `POST /lol/client-ping` is an **open** route ([selfServer.js](../farm/src/selfServer.js))
  like `/lol/self` — clients don't hold the admin token; the handler
  ([up.js](../farm/src/commands/up.js) `onClientPing`) length-caps every field,
  bounds the map at 200 entries, and normalizes the `::ffff:` IPv4-mapped remote IP.
  Entries are **TTL-filtered at read time** (fresh = seen ≤ 30 s ago, no sweeper);
  a closed client vanishes within ~30 s. `getAdminState` returns the full list
  (sorted most-active first); `liveHealth.clientsConnected` (updated per ping + each
  health tick so it decays) rides the snapshot as **`usage.clients`**.
- **UI.** The admin page gets a **Clients (N)** card — hostname, IP · platform ·
  version, and an "active now" (input < 60 s ago) vs "idle 12m" badge; the fleet
  popover's live line adds "N clients". Old-farm/old-client combos degrade to
  null/absent everywhere.
- **Tests** (54): the ping route is open + forwards body/remote-IP + 400s malformed
  JSON without reaching the handler; `usage.clients` mirrors `clientsConnected` and
  is null on the old-farm shape.

## 2026-07-04 — Farm admin, Phase 4: the client honors the farm's plugin world

Closes the plan — the desktop client now consumes what the farm advertises, and the
Blender *recommend* toggle (inert since P3) does something.

- **Farm advertises its admin port.** `snapshot.js` adds `httpPort` (`config.beacon.httpPort`),
  so a client can build the admin URL `http://<host>:<httpPort>/lol/admin` (the snapshot only had
  `proxyPort` before).
- **"Manage this farm" button.** [app.js](../shell/renderer/app.js) `renderPopover` gives each
  discovered farm (that advertises `httpPort`) a button that `openExternal`s its admin page — the
  desktop app gets an admin entry with **zero UI rebuild** (it just opens the farm-served page). The
  button `stopPropagation`s so it doesn't also trigger the row's select-farm.
- **Unified plugin surfacing.** Each farm row now shows its **on** plugins (search / voice / OCR, from
  `snapshot.plugins`) and its **recommendations** (`recommendedClientPlugins`, e.g. "recommends: Blender
  tools"). Farm plugins + the client's own Blender toggle (in Preferences, `[this PC]`) are the two
  halves of the unified model.
- **Client auto-applies recommendations.** New `applyFarmRecommendations(farm)` in
  [index.ts](../shell/src/main/index.ts) (called from `onFarms`, independent of the endpoint
  change-check): if the active farm recommends `blender` **and** the user hasn't made an explicit choice
  (`blenderMcpUserSet`) **and** mcpo isn't already on → enable it. It only ever turns a client plugin ON
  and never auto-disables (the user may rely on it); `set-blender-enabled` now records
  `blenderMcpUserSet:true` so a manual choice always wins. New `ShellSettings.blenderMcpUserSet`
  ([store.ts](../shell/src/main/store.ts), default false). Since Blender is on-by-default, this is a
  no-op today in practice — it's the correct, future-proof mechanism (and the surfacing is the visible
  win). `FarmSnapshot` gained `httpPort`/`plugins`/`recommendedClientPlugins` ([types.ts](../shell/src/main/types.ts)).

**Verified:** 52 farm tests pass (snapshot now asserts `httpPort`); `tsc --noEmit` clean; renderer
`node --check` clean. **Whole 4-phase plan now built** (admin control API + live model start/stop; farm-
plugin registry + live plugin toggles; the admin page; client integration). **Pending rig test** of P4
(open a client → fleet popover shows the farm's plugins + "Manage this farm"; recommend Blender in the
admin page → confirm a client with no explicit Blender choice honors it). Needs the farm on the new code
(`git pull` + `lol up`) so it advertises `httpPort`/`plugins`/`recommendedClientPlugins`, and a client
rebuild. Not released.

## 2026-07-04 — Farm admin, Phase 2+3: a farm-plugin registry + live plugin toggles in the page

Turned the three copy-pasted farm-service boot blocks (SearXNG / Kokoro / lol-extract) into a **plugin registry**
and wired the admin panel to **toggle plugins on/off live**, reflected on clients.

**Registry ([farm/src/plugins/registry.js](../farm/src/plugins/registry.js)).** A `FarmService` descriptor per
service that **delegates to the unchanged `searxng.js`/`kokoro.js`/`extract.js`** — the install/spawn/health
internals (rig-verified) are untouched; only the *orchestration* is unified. Each instance owns its child +
up-state + per-run ctx (the OCR bearer key). `start()` returns a `{ok, level, message}` the caller logs, so the
exact per-service wording is preserved. One `child.on('exit')` does double duty: flags a startup death, and
(once up) fires `onDown` (advertise-off). [up.js](../farm/src/commands/up.js) now iterates the registry for
boot, the health-timer re-probe, teardown (both shutdown paths), and the runtime pid record — the ~12
per-service touch-points collapsed to one descriptor. Snapshot back-compat is exact: the bespoke
`searxngUrl`/`ttsUrl`/`extract` fields still come from the same named `liveHealth` flags (set from
`svcById.<id>.up`), so [snapshot.js](../farm/src/snapshot.js) is unchanged there; it just **adds** a generic
`plugins: {id:{label,runsOn,enabled,healthy}}` map + `recommendedClientPlugins`.

**Live toggles.** `control.setPlugin(id, on)` spawns/kills a service child at runtime (`bringUp`/`bringDown`,
sharing the boot wiring), flips `config.<id>.enabled` (ephemeral, like model changes), and kicks the beacon so
clients pick up the change — a **new OCR toggle mints a fresh bearer key** so clients repoint. `setPlugin` is
serialized on the same `mutating` chain as `startModel`/`stopModel` (no racing a proxy restart).
`control.recommendClientPlugin('blender', on)` sets `config.recommendedClientPlugins` — the farm can't run a
per-client plugin, only advertise it. New routes in [selfServer.js](../farm/src/selfServer.js):
`POST /lol/admin/plugin/<id>/{enable,disable}` + `POST /lol/admin/plugin/recommend` (token-gated).

**Admin page ([farm/src/admin/index.html](../farm/src/admin/index.html)).** A **Plugins** card: each farm
plugin (Web search / Voice / OCR) has an Enable/Disable button + live status; Blender shows a **Recommend to
fleet** toggle labeled `[client]` (it runs on each user's machine — the farm only recommends it). One mental
model, honest about who executes what.

**Verified:** 52 farm tests pass — adds registry ids/gating, a `FarmService` lifecycle test (start→up, probe
reflects alive, child-exit fires onDown), `recommendedClientPlugins` default + snapshot advertisement, and the
plugin-toggle/recommend routes reaching a mock control (token-gated). `node --check` on every touched module +
the admin page's inline script. An **adversarial review** of the boot refactor caught 3 real defects (all
fixed): (1) a **self-heal regression** — the health timer guarded on `svc.pid`, which is null after a child
dies, so a plugin that crashed in the boot window (between the sync liveHealth capture and `onDown` being
wired, across the `detectHardware`/`gpuLiveStats` awaits) would be advertised dead forever; now guards on
`svc.wasUp` so `probe()` re-flips it (the old code self-healed because its guard was a never-nulled child ref);
(2) `setPlugin` turning a plugin ON that came up **alive-but-unhealthy** (SearXNG JSON off / Kokoro synth fail)
left the child orphaned → now tears it down + rolls back; (3) OCR `makeCtx` built the Ollama URL from raw
`config.ollama.hosts` instead of the normalized/reachable list. The exit-listener double-duty, TDZ/ordering,
`setPlugin` serialization, and snapshot parity were reviewed and **confirmed correct**. **Deferred to Phase
4 (client):** the desktop app auto-applying a farm's Blender *recommendation*, a unified plugins view, and a
"Manage this farm" button opening the admin page — so today the farm plugin toggles (search/voice/OCR) work
end-to-end, but the Blender *recommend* toggle is inert until P4 lands. Not released.

## 2026-07-04 — Startup-log noise triage (surfaced during admin-panel rig testing)

Rig test of the admin panel confirmed **everything works** (LiteLLM serving, SearXNG JSON 200, Kokoro healthy,
admin start/stop of `qwen3.6:35b` verified live) — but `lol up` prints a wall of `[litellm]`/`[searxng]`/
`[kokoro]` child-process log lines, one an alarming full traceback. Triaged all of it; **zero critical** — every
service is healthy. Fixed the two that were genuinely worth it:
- **SearXNG `ModuleNotFoundError: tzdata` traceback.** Windows Python's `zoneinfo` ships no IANA tz DB, so the
  `bilibili` engine's `ZoneInfo("Asia/Shanghai")` throws + dumps a full traceback at boot. New `ensureTzdata()`
  in [searxng.js](../farm/src/searxng.js) pip-installs `tzdata` (marker-guarded `.tzdata-ok`, so it applies once
  to an already-installed `.searxng/` without a full reinstall). Same class of Windows gotcha as the existing
  `import pwd` shim.
- **Kokoro logging at DEBUG** (per-request path scans + audio-chunk shapes = most of the volume). Set
  `API_LOG_LEVEL=WARNING` in `spawnKokoro` env ([kokoro.js](../farm/src/kokoro.js)) — confirmed the env name
  against the vendored `main.py:26` (`os.getenv("API_LOG_LEVEL", "DEBUG")`). Applies on the next `lol up`.
- **SearXNG onion engines** (`ahmia`, `torch`) error at boot because they need a Tor proxy we don't run —
  disabled them in the generated `settings.yml` ([buildSettingsYaml](../farm/src/searxng.js)); takes effect on a
  settings regen (`del farm\.searxng\settings.yml`).
**Assessed as benign, left alone:** LiteLLM cost-map warning (no $ tracking on a LAN) + its banner/access logs;
Kokoro's pydub-ffmpeg + torch deprecation warnings (synthesis works); SearXNG `limiter.toml missing` +
per-request `X-Forwarded-For` (limiter is off — trusted LAN). 49 farm tests pass (adds an onion-engines-disabled
assertion to the settings test).

## 2026-07-04 — Farm admin panel, Phase 1: live model start/stop over a token-gated control API

First slice of a planned farm **admin panel** (start/stop models + toggle plugins, reflected on clients). Today
the farm is read-only — `GET /lol/self` + a one-way UDP beacon — so this is a **net-new authenticated control
API living inside the long-lived `lol up` process** (the only holder of live state). Delivered: **start/stop a
served model from a farm-served web page, reflected on every connected client within ~5s.**

**Decision that shaped it — LiteLLM has no live model API here.** Verified against the installed **litellm
1.90.0**: `POST /model/new` does `if prisma_client is None: raise HTTPException(500, "No DB Connected")`
([model_management_endpoints.py:1344](../farm/.venv/Lib/site-packages/litellm/proxy/management_endpoints/model_management_endpoints.py)) — the runtime add/delete-model routes **require a Postgres/Prisma DB**, which the config-only workshop farm
deliberately doesn't run. So changing the served set = **regenerate `config.generated.yaml` + bounce the
LiteLLM child in place** (`restartProxy`). Brief blip (in-flight requests drop for the few seconds it restarts)
— acceptable for an infrequent admin action; documented.

**Farm side.** New `AdminSchema` (`admin.token`, [config.js](../farm/src/config.js)) — null → `lol up`
generates an ephemeral token per run and prints it in the banner. [selfServer.js](../farm/src/selfServer.js)
grew from "only `GET /lol/self`" into a small router: `GET /lol/admin` serves a **self-contained static admin
page** ([farm/src/admin/index.html](../farm/src/admin/index.html), zinc-themed, no bundler); `GET
/lol/admin/state` + the `POST /lol/admin/model/{start,stop}` routes require `Authorization: Bearer <token>`
(constant-time compare, length-checked); `GET /lol/self` stays open. [up.js](../farm/src/commands/up.js) builds
a `control` closure (`getAdminState`/`startModel`/`stopModel`) bound to the live `config`/`liveHealth`/`child`/
`beacon` and hands it to selfServer. **The restart is crash-safe:** `child` became a `let`, the proxy-exit
handler is a named `onProxyExit(c, code)` guarded by `restartingProxy` (deliberate bounce) + identity (`c !==
child`, a superseded old child) so a control-triggered restart never triggers the farm-teardown path;
`writeRuntimeState()` re-records the NEW pid so `lol down` from another shell still targets the live proxy.
"Start" = add to the in-memory catalog + `warmModel` (Ollama `/api/generate keep_alive:-1`); "stop" = remove +
`evictModel` (`keep_alive:0`) — new helpers in [ollama.js](../farm/src/ollama.js). Guards: can't stop the last
model; stopping the default promotes a new one; start validates the model is installed on a reachable host.
Catalog changes are **ephemeral** (in-memory, matching the `lol up` picker which deliberately never persists).
Every change ends with `beacon.kick()` → the snapshot already advertises `servedEntries(config)`, so clients
repoint and OWUI's `/v1/models` reflects it with zero client code.

**Verified:** 49 farm tests pass (adds: admin token default + strict-reject; an **integration test** that spins
up selfServer with a mock control and asserts `/lol/self` is open, the admin page serves, and every
`/lol/admin/*` route is 401 without/with a wrong token and only reaches `control` with the right one);
`node --check` on all touched modules. An **adversarial review** of the restart state-machine caught 5 real
bugs (all fixed): a failed restart could leave a **zombie proxy** + stale pid → now `applyModels` rolls back
to the last-good set and `restartProxy` kills a proxy that never came up; the child-**identity guard was dead
code** (a bare `onProxyExit(child,…)` reads the `let` at call time) → now `bindProxyExit(c)` captures the
instance; a **SIGINT mid-restart** could orphan a fresh proxy → `restartProxy` checks `stopping` before spawn +
after health-wait; the runtime **pid was recorded too late** for a concurrent `lol down` → now written
immediately after spawn; and **concurrent admin calls** could race the shared `restartingProxy` and tear the
farm down → start/stop are **serialized** on one in-flight chain. Auth + the empty-`control` startup window
were reviewed and confirmed safe. **Pending rig test** (`lol up` → open `http://<box>:41997/lol/admin`,
enter the token → Start a model → it appears in a client's OWUI picker + `ollama ps` shows it warmed → Stop →
gone + evicted, without tearing the farm down). **Next phases (planned, not built):** P2 farm-plugin registry +
live plugin toggles; P3 the full page (plugin toggles + fleet); P4 client honors farm plugin *recommendations*
(e.g. Blender) + a unified plugins view. Not released.

## 2026-07-04 — Document OCR: one shared farm-side extraction service (Ollama-OCR + optional Docling)

Added **OCR / document extraction** as a shared farm service, discovered + wired exactly like SearXNG and
Kokoro (beacon → client env, zero client setup). **Why this shape:** an adversarial source-check against
**OWUI v0.10.2** proved the tempting "Ollama-OCR as a tool the model calls" design is **impossible** — external
OpenAPI tool servers receive **only the model's JSON args**, never the uploaded file bytes
(`utils/tools.py` `execute_tool_server` sends `params=kwargs`, `extra_params={}`; only *native* tools get
`__files__` via `middleware.py:2680`). The **only** OWUI surface that receives an uploaded file is the
**content-extraction engine**, and there's exactly **one** slot. So both goals the owner asked for
("searchable scanned docs" **and** "vision-model OCR transcripts") funnel through **one** farm service that
OWUI sees as `CONTENT_EXTRACTION_ENGINE=external` and which **routes internally**.

**Farm side** — new `farm/src/extract.js` (clone of `searxng.js`: own venv under `.extract/`, `ensureExtract`
/`spawnExtract`/`waitForExtract`/`extractAlive`) runs `farm/src/pysvc/server.py`, a small **FastAPI**
implementing OWUI's **verified** External Document Loader contract: `PUT /process` with the **raw file bytes**
as the body, `Authorization: Bearer <key>`, `X-Filename`, → returns a JSON **list** of
`{page_content, metadata:{page}}`. Router: **images + scanned/image-only PDF pages → Ollama-OCR** (a vision
model on the farm's **local** Ollama `/api/generate`); **born-digital PDFs / docx / text/html → fast local
extraction** (PyMuPDF/python-docx); **office formats via Docling** when `ocr.docling:true`. Ollama-OCR's
`OCRProcessor` is **vendored** into `farm/src/pysvc/ocr_processor.py` (MIT, see `LICENSE-ollama-ocr`; debug
prints stripped) rather than `pip install ollama-ocr` — that package pulls `python-magic` (native libmagic; a
Windows landmine) + streamlit + transformers, none of which the core path needs. Default install is
**torch-free** (fastapi/uvicorn/requests/pymupdf/opencv-headless/numpy/python-docx/tqdm) and **reuses the
farm's already-loaded vision model** (no new 8 GB pull) — the OCR model defaults to the served default vision
model's real Ollama tag via `resolveOcrModel` (config `ocr.model` overrides). Docling is the heavy opt-in
(torch + models). Lifecycle mirrors SearXNG/Kokoro exactly: `OcrSchema` in `config.js` (**off by default** — it
reroutes all of OWUI's document ingestion through the farm), `--ocr/--no-ocr` run-flags, per-run bearer key
(`crypto.randomBytes`) advertised in the snapshot only when `enabled && extractUp && extractKey`, `extractPid`
recorded + tree-killed in both `up.js` shutdown paths and `down.js`, health-timer re-probe + advertise-off on
exit, `depsSignature` install marker (a docling toggle forces reinstall), and `lol install` pre-installs only
when enabled.

**Client side is pure env** (no renderer seeding, unlike Blender): `extract:{url,key}` threaded through
`types.ts` → `index.ts` (`farmExtract`, `onFarms`/`select-farm`/`set-data-dir`/`restart`/boot) → `sidecar.ts`
(start/repoint change-check/setDataDir/crash-restart) → `configBridge.ts`, which sets
`CONTENT_EXTRACTION_ENGINE=external` + `EXTERNAL_DOCUMENT_LOADER_URL` (loader **base**; OWUI appends `/process`)
+ `EXTERNAL_DOCUMENT_LOADER_API_KEY`. Absent farm OCR → nothing set → OWUI's built-in default extractor,
byte-for-byte as before. The raw file transits to the trusted-LAN farm for extraction (that's where the GPU is,
same boundary as SearXNG receiving queries); embedding still happens locally (`RAG_EMBEDDING_ENGINE` stays
unset).

**Trade-off (documented):** with `external` engine on, ALL uploads route through our service; the light path
covers images/PDF/docx/pptx/xlsx/text/html, and only legacy binary Office (`.doc`/`.ppt`/`.xls`) +
`.odt`/`.epub`/`.rtf` `415` unless `ocr.docling` is on. **Two robustness fixes from an adversarial review**
(4 dimensions × verify): (1) the vendored Ollama-OCR `requests.post` had **no timeout** — a stalled Ollama
would hold a Starlette threadpool worker forever and, at enough concurrency, stall all `/process` uploads;
added `request_timeout=(10, 600)` (env `OCR_HTTP_TIMEOUT`) so a hang surfaces as a 502 and frees the worker.
(2) office formats OWUI extracted natively would `415` under the external engine — added light `python-pptx`
/`openpyxl` extractors so `.pptx`/`.xlsx` keep working without Docling. **Verified:** farm tests **46 pass**
(config defaults, strict-enum reject, snapshot advertise/omit, `resolveOcrModel`, depsSignature); `tsc
--noEmit` clean; `py_compile` clean; all edited modules load. **Pending live rig test** (`lol up --ocr` →
`/health` 200 → hand-crafted `PUT /process` with a JPG/scanned-PDF/docx → OWUI upload E2E). Not yet released.

## 2026-07-03 — MCP marked experimental · model-per-box in the fleet view · OWUI clipboard fix

Three small UX items:
- **OWUI copy buttons now reach the system clipboard.** In the Electron webview,
  `navigator.clipboard.writeText` requests the `clipboard-sanitized-write` permission,
  which our `persist:owui` handlers were denying (they only allowed media/mic — so
  copy silently failed). Added `clipboard-read` + `clipboard-sanitized-write` to
  `OWUI_ALLOWED_PERMS` ([index.ts](../shell/src/main/index.ts); both the request and
  check handlers already share the set, which Electron requires for clipboard).
- **Fleet view shows the real model per box.** The snapshot's `models` advertised only
  the SERVED name — the alias (e.g. "assistant"), identical on every box. Added
  `underlying` (the real Ollama model behind the alias, from `servedEntries`) to each
  `models` entry ([snapshot.js](../farm/src/snapshot.js)); the connection popover now
  renders "assistant (qwen3.6:30b) ★" ([app.js](../shell/renderer/app.js)). Backward
  compatible (falls back to the served id if `underlying` is absent). Needs the farm
  updated (git pull + `lol up`) to populate it.
- **Blender assistant tools labelled "experimental"** in Settings (badge + hint) — its
  reliability depends on the model and the user's Blender setup.

Client ships **v0.1.21**; the model-per-box display lights up once the farm is on the
new snapshot (git pull). farm tests 41 pass; tsc clean.

## 2026-07-03 — Blender tools: the ACTUAL fix — select the tool server (ui.tools), not just register it

An adversarial multi-agent audit of v0.1.19 against OWUI v0.10.2 source (5 agents, one per claim) caught a
**blocking bug before the rig test**: writing `settings.toolServers` makes a tool server **available** but
never **selected**, and OWUI only sends **selected** direct servers to the model. Cited: `Chat.svelte:157` +
`447-453` (a new chat's `selectedToolIds` seeds from `$settings.tools` == `ui.tools`, **never** from
`ui.toolServers`), `Chat.svelte:2521-2569` (the request's `tool_servers` is filtered to selected ids),
`middleware.py:2715` (backend registers only servers present in the payload). So the completion's
`tool_servers` was empty → the model got zero Blender tools → *"which 3D software are you using?"*.

**Fix:** the seed now also writes the **selection** — appends `'direct_server:<idx>'` to `ui.tools` (idx =
position among `config.enable` tool servers), which OWUI uses to seed each new chat. `unseed` prunes it
(shifting higher indices down). **Dropped** the `function_calling='native'` write — the audit proved native
is OWUI's **default** (the mode gate is `!= 'legacy'`), so it was a no-op; and if native tool-calls prove
unreliable for qwen3 via LiteLLM→Ollama, the fallback is **`legacy`** (prompt injection), *not* native.

Audit **CONFIRMED** (no change): the connection shape (gate is `config.enable`; no top-level `type`;
leading-slash `path`), and that `ui.{toolServers,tools,params}` persist (WEBUI_AUTH=false → admin bypasses
the `settings.interface` / `features.direct_tool_servers` gates that would otherwise strip `toolServers`). It
also flagged that **Test connection verifies availability plumbing only** — it can't see selection, call-time
bearer auth (`/openapi.json` is public, so the key isn't checked at test time), or the function_calling mode.
Ships as v0.1.20.

## 2026-07-03 — Blender tools: register as a USER tool server (auto-attach) + Test button

Rig report: tools "installed" but the model had **none** — it replied "which 3D software are you using?".
Root cause, confirmed from OWUI docs + [issue #18074](https://github.com/open-webui/open-webui/issues/18074):
I registered the server via the **global/admin** config (`POST /api/v1/configs/tool_servers`). **Global tool
servers are hidden behind the chat "+" menu and must be toggled on per-chat** — they don't auto-attach.
**User** tool servers (`settings.toolServers`) attach to every chat automatically. I seeded it in the wrong
place.

**Fix:** seed the connection into the user's `settings.toolServers` instead — via
`/api/v1/users/user/settings/update` (the same authed-webview path as `seedWebSearchDefault`), shape per the
v0.10.2 frontend (`{ url, auth_type:'bearer', key, path:'/openapi.json', config:{enable:true},
info:{id:'lol-blender'} }`). Also default the model's **Function Calling to `native`**
(`ui.params.function_calling`, only if unset) — needed for a model to actually emit tool calls for external
tools. Applied once per session; the old global registration self-clears (env-authoritative → not reloaded).

**Also — the requested "Test connection" button** (Settings ▸ Assistant tools). It probes **both hops**:
GET the local mcpo `/openapi.json` (helper up + tool count) and a **TCP connect to 127.0.0.1:BLENDER_PORT**
(is the add-on actually listening?), so a failure reads as "helper ✗" vs "Blender ✗ on port N" at a glance.
New `test-blender-connection` IPC + `tcpProbe()` util. Verified headless: `tcpProbe` returns true on a
listening port, false on a closed one; tsc clean; `node --check app.js`. Ships as v0.1.19.

## 2026-07-03 — Blender tools: make the add-on socket port (BLENDER_PORT) configurable

Rig feedback: the tools were now visible (checkbox present, add-on installed) but still **"could not
connect" to Blender**. Root cause is the *second* port in the chain. There are two: (1) **mcpo's OpenAPI
port** (OWUI ↔ proxy — auto-assigned, internal, never touched); (2) **BLENDER_PORT** — blender-mcp ↔ the
BlenderMCP add-on socket, default **9876**, and exactly the number the add-on panel shows. I'd hardcoded
(2), so if the add-on runs on any other port, blender-mcp (stuck on 9876) never reaches it.

**Fix:** a **Blender port** setting (Settings ▸ Assistant tools; `shell-settings.blenderPort`, default
9876). `mcpoSupervisor` now spawns blender-mcp with `BLENDER_HOST=127.0.0.1` + `BLENDER_PORT=<setting>`;
`setBlenderPort()` restarts mcpo when it changes (env is fixed at spawn), and the renderer re-registers the
tool server if the proxy port shifted on restart (`blenderSeeded` resets on any non-ready transition). New
`set-blender-port` IPC + preload; `get-blender-state`/`get-prefs` carry the port; a number input in the
settings panel.

**Verified end-to-end (not on faith):** drove the real mcpo+blender-mcp with `BLENDER_PORT=9999` against a
dummy TCP listener — blender-mcp logged `Connected to Blender at 127.0.0.1:9999` (not 9876), and the dummy
saw the connection, proving the env threads supervisor → mcpo → the blender-mcp subprocess (mcpo does pass
its env down). Also confirms blender-mcp connects at **startup**, so once the add-on is running on the
matching port it links immediately. tsc clean; `node --check app.js`. Ships as v0.1.18.

## 2026-07-03 — Blender tools: fix the OWUI wiring + make it default-on

Field report from the rig: the Blender tools **didn't show up in OWUI**, and the Settings toggle was
friction the owner didn't want — it should be **on by default**, with OWUI configured automatically so the
user only starts Blender. Both were real; the first was my mistake.

**Root cause (verified against OWUI's own source, not guessed).** I wired the tool server via the
`TOOL_SERVER_CONNECTIONS` **env var**. That's a *PersistentConfig*, and OWUI does **not** reliably surface
env-configured tool servers — an OWUI maintainer says so outright in
[issue #18140](https://github.com/open-webui/open-webui/issues/18140) ("editing directly is not a supported
method"). So the connection never became usable tools. The **supported** path is the one the admin UI's
*verify & save* uses: `POST /api/v1/configs/tool_servers` with `{ TOOL_SERVER_CONNECTIONS: [...] }`
(confirmed by reading the v0.10.2 SPA's own `setToolServerConnections` in `src/lib/apis/configs`).

**Fix.** Register the tool server through that API from the **authed webview**, mirroring the existing
`seedWebSearchDefault()` (reads `localStorage.token`, POSTs with `Authorization: Bearer`). New
`seedBlenderToolServer()` / `unseedBlenderToolServer()` / `maybeSeedBlender()` in
[app.js](../shell/renderer/app.js): once per session, keyed by `info.id === 'lol-blender'` (idempotent,
leaves any other tool servers untouched), fired when the webview is authed **and** the local mcpo reports
`ready` (on first launch mcpo installs for ~1 min, so it's usually the mcpo-ready push that seeds), then a
one-shot webview reload surfaces the tools. Removed on disable. **Dropped the env approach entirely** —
`configBridge` no longer emits `TOOL_SERVER_CONNECTIONS`, and the `mcpo` threading through the sidecar
start/repoint was reverted (toggling Blender no longer restarts OWUI — the tool server is added/removed via
the live API). New `get-blender-connection` IPC gives the renderer mcpo's url + bearer key.

**Default-on.** `blenderMcp` now defaults `true` ([store.ts](../shell/src/main/store.ts)); boot brings mcpo
up in the background. The Settings toggle stays as an **off** switch.

**Auth chain verified from source (the thing most likely to 401 silently):** OWUI sends `auth_type:'bearer'`
+ `key`; mcpo's `get_verify_api_key` uses `HTTPBearer` and checks `token == api_key` — so
`Authorization: Bearer <key>` matches. Without `--strict-auth`, tool routes are key-protected (per-route
`Depends`) while `/openapi.json` stays public, so OWUI can fetch the spec unauthenticated and authorize the
calls. **Verified headless:** tsc clean; `node --check app.js`; endpoint + body shape match the v0.10.2 SPA;
mcpo bearer check read from its source. **Rig-check:** the actual OWUI round-trip (tools appear + a cube
lands) — still needs the GUI + Blender, but the wiring is now OWUI's supported path, not the unsupported env.
Ships as v0.1.17.

## 2026-07-03 — Control Blender from the chat (local MCP tools, opt-in)

Let the assistant drive **Blender running on the user's own machine** — create objects, run Python in
Blender, inspect the scene — while keeping the invariants: **OWUI stays unmodified** (pure env wiring) and
**nothing is exposed to the network** (localhost only). The user owns the Blender side (install the
BlenderMCP add-on + Start its server); we make OWUI turnkey — one toggle in Settings.

**How it works.** OWUI added native MCP (streamable-HTTP) support, and it also consumes **OpenAPI tool
servers** via `TOOL_SERVER_CONNECTIONS`. The Blender MCP server (`blender-mcp`) is stdio, so we front it
with OWUI's own **`mcpo`** proxy (stdio→OpenAPI). A new **client-side supervisor**
([shell/src/main/mcpoSupervisor.ts](../shell/src/main/mcpoSupervisor.ts), mirroring the OWUI
SidecarSupervisor) installs both into a **dedicated venv** under `userData/mcp-tools/` (reusing the
sidecar's bundled standalone CPython — it ships pip — so no new runtime; kept out of the OWUI env so it
can't perturb it) **on first activation** (opt-in, like the farm's SearXNG/Kokoro), then runs
`mcpo --host 127.0.0.1 --api-key <random> -- blender-mcp` and health-waits `/openapi.json`.
[configBridge.ts](../shell/src/main/configBridge.ts) injects `TOOL_SERVER_CONNECTIONS` pointing at it
(`ENABLE_PERSISTENT_CONFIG=false` keeps env authoritative every launch); the mcpo connection is threaded
through the sidecar exactly like the farm's SearXNG/TTS (all six start/repoint sites) so a farm change
never drops the tool server. Toggle + status live in **Settings → Assistant tools**
([index.ts](../shell/src/main/index.ts) IPC `get/set-blender-enabled` + a `blender-state` push;
[preload](../shell/src/preload/index.ts); [renderer](../shell/renderer/app.js)); persisted as
`blenderMcp` in shell-settings.

**A live spike before writing a line hardened the design + caught two things a "ship on faith" path would
have missed** (all re-verified against the compiled supervisor end-to-end):
- **mcpo defaults to bind `0.0.0.0`.** Since `execute_blender_code` is arbitrary code execution, we bind
  **`127.0.0.1` + a random `--api-key`** (this machine drives its own Blender; OWUI sends the key via the
  connection). Confirmed: mcpo logs "API Key: Provided", server reachable only on loopback.
- **blender-mcp phones home** — it POSTs telemetry to a Supabase endpoint. Source-verified the opt-out and
  set **`DISABLE_TELEMETRY=true`** in the child env; the run now logs
  `Telemetry disabled via environment variable` and makes no such POST. Honors the privacy invariant.
- **The tool schema serves even with Blender down** (blender-mcp connects per-call, lazily) → the tool
  server registers immediately, so the user can flip the toggle first and Start Blender whenever.

**Verified (headless, on this box):** `tsc` clean; a stubbed-electron unit check that `configBridge` emits
`TOOL_SERVER_CONNECTIONS` **only** when mcpo is present, with the exact OWUI shape; and a full drive of the
**real compiled `McpoSupervisor`** — venv create → pip install mcpo+blender-mcp → spawn (localhost+key+
telemetry-off, all confirmed in the log) → `GET /openapi.json` 200 → `getConnection()` → `stop()` cleans
up. **Rig-checks (need a GUI / Blender):** (1) the Blender tools actually appear + are callable in an OWUI
chat via env-injected `TOOL_SERVER_CONNECTIONS` (watch for OWUI's "verify & save" quirk — should be moot
with persistent-config off); (2) a real round-trip with Blender + the BlenderMCP add-on running; (3)
**tool-calling model** — `gemma4:12b` is weak at tools; serve a tool-capable model (Qwen2.5/3, Llama 3.x)
for usable results. Not released yet — dev-run (`cd shell && npm run dev`) to try it.

## 2026-07-03 — Web search is now ON by default (set up at farm install)

Owner call: a fresh farm should give clients web search with **no config editing** — the same way it already
auto-pulls `gemma4:12b`. Two changes make "on the farm install, download the model **and** activate web search"
literally true:

1. **`websearch.enabled` now defaults to `true`** ([farm/src/config.js](../farm/src/config.js)). The scaffold
   `lol install` writes (from `defaultConfig()`) therefore shows `websearch:{enabled:true,port:8888}` explicitly,
   and any config that omits the block inherits on. Opt out with `"websearch":{"enabled":false}` or
   `lol up --no-websearch`. (TTS stays **off** by default — its torch install is multi-GB and the owner only
   asked for web search on.)
2. **SearXNG is pre-installed at `lol install`**, not lazily on first `lol up`
   ([farm/src/commands/install.js](../farm/src/commands/install.js) → new `ensureWebsearch(config)` step). It's
   the existing idempotent `ensureSearxng()`, gated on the now-default-on flag and **non-fatal** (auxiliary — a
   hiccup just warns and `lol up` retries; chat still serves). So the first `lol up` starts instantly instead of
   stalling on a first-run source-tarball + venv + pip install.

**Verified:** `node farm/test/run.js` green (the `websearch config defaults` test now asserts `enabled===true`;
the snapshot gating test still toggles explicitly, unaffected). Example config + [GETTING_STARTED.md](GETTING_STARTED.md)
+ [farm/README.md](../farm/README.md) updated so the docs no longer read "optionally flip on web search." No client
change — the client already auto-wires web search whenever the farm advertises `searxngUrl`.

## 2026-07-03 — Neural TTS: shared Kokoro on the farm (the "nicer voices" upgrade)

Replaced OWUI's robotic Web-Speech voices with **Kokoro-82M** neural TTS, hosted once on the farm box and
auto-wired into every client — same beacon pattern as SearXNG (STT stays client-local via Whisper; TTS only
re-synthesizes the farm-generated response, so farm-hosting leaks nothing new and gets GPU speed with zero
per-client weight). Off by default (heavy install).

**Design (a Plan agent researched it; the decisive call is GPU-agnostic):** use **Kokoro-FastAPI (PyTorch)**,
NOT the ONNX path — `onnxruntime-gpu` has no Blackwell sm_120 kernels, so it would run the flagship box on CPU,
whereas **`torch==2.8.0+cu128` carries BOTH Ada (sm_89: 4070/4090) AND Blackwell (sm_120) in one wheel** →
"install once, runs on the whole fleet" (and CPU-torch fallback for GPU-less boxes). espeak-ng needs **no
native install**: the `espeakng-loader` pip dep ships the shared library; we point `PHONEMIZER_ESPEAK_LIBRARY`
at it.

**Live-proven on the box, every link:** installed Kokoro-FastAPI v0.5.0 from a source tarball into its own
venv (torch cu128 auto-selected via `nvidia-smi`, model .pth from the stable v0.1.4 asset, 67 voices ship in
the tarball) → `torch.cuda.is_available()` **True on the Blackwell** → the server boots on native Windows and
`POST /v1/audio/speech` returns a **valid 23 KB MP3 on GPU**. Then `lol up` with the new wiring spawns it and
`/lol/self` advertises `ttsUrl=…:8880/v1` + `ttsVoice`/`ttsModel`. Finally, a standalone OWUI given the exact
client env (`AUDIO_TTS_ENGINE=openai` + that base URL) **proxied read-aloud to Kokoro — 28 KB MP3 via OWUI**.
So farm advertises → client sets `AUDIO_TTS_*` → OWUI plays Kokoro audio, confirmed end-to-end.

**Farm** ([farm/src/kokoro.js](../farm/src/kokoro.js), new — mirrors searxng.js with the SearXNG-review
idempotence lessons baked in: `.installed-tag`/`.src-tag` markers, GPU auto-detect + a post-install
`cuda.is_available()` check that falls back to `USE_GPU=false`): `ensureKokoro`/`spawnKokoro`/`waitForKokoro`
(health + a real synthesis probe)/`kokoroAlive`. Wired into [up.js](../farm/src/commands/up.js) as a sibling
child (health-wait, pid in `.lol-runtime.json`, `child.on('exit')` clears `ttsUp` + kicks the beacon, health
timer re-probes, killTree on shutdown + in [down.js](../farm/src/commands/down.js)); config `tts:{enabled,
port:8880, voice:'af_heart', model:'kokoro'}` + `lol up --tts/--no-tts`; snapshot advertises
`ttsUrl`/`ttsVoice`/`ttsModel` gated on `enabled && ttsUp`; `lol fleet` shows it.

**Client** — thread the farm's TTS through the sidecar exactly like `searxngUrl` (a `{url,voice,model}` object
through start/repoint/setDataDir/crash-restart + the repoint change-check + **all six** index.ts call sites —
the two the last review caught for searxng included). [configBridge](../shell/src/main/configBridge.ts) sets
`AUDIO_TTS_ENGINE=openai` + base URL + model + voice when the farm has TTS (overriding the empty client-side
default); no farm TTS → unchanged (Web Speech).

**Tested:** farm suite 41 pass (tts config defaults + snapshot gating); shell `tsc` clean; the full live chain
above. Enabled on the dev box; `farm/.kokoro/` gitignored. Farm-side reaches boxes via `git pull` + the
first-run install; client ships in the next release. GPU-agnostic claim: Blackwell proven live; the same cu128
wheel officially carries Ada sm_89, so 4090/4070 are covered (a real-box smoke is still worth doing).

---

## 2026-07-02 (c) — Web search ON by default

Web search was available but off — students had to find the toggle each chat. Making it default-on is a
per-user setting, not an env: OWUI stores `settings.ui.webSearch = 'always'` (PR #9370; confirmed by grepping
the installed frontend — `webSearch === 'always'` gates each message), and there is deliberately **no env
var** for it (open feature request; a maintainer only offered a `/?web-search=true` URL param).

**Fix** ([shell/renderer/app.js](../shell/renderer/app.js)): the auth-bootstrap already runs JS in the authed
webview to validate the token; it now also **seeds the web-search default** from inside OWUI via its own API —
`GET /api/config`, and if `features.enable_web_search` is true (which the client sets from the beacon's
`searxngUrl`), `POST /api/v1/users/user/settings/update` with `{ ui: { …, webSearch: 'always',
lolWebSearchSeeded: true } }`. Three properties: (1) **gated** on the farm actually hosting search, so we
never force it on with no engine; (2) **one-time** via the `lolWebSearchSeeded` marker (`UserSettings.ui` is
an `extra='allow'` dict, so the marker persists) — after the first seed we never touch it again, so a user
who turns it off stays off; (3) if just set, one webview reload so the SPA's already-loaded `$settings` picks
it up.

**Verified end-to-end (not on faith):** ran the real client against the live farm, then read OWUI's SQLite
directly — `user.settings.ui.webSearch = "always"` and `lolWebSearchSeeded = true`. That the seed fired at all
proves `config.features.enable_web_search` was true (the exact flag name) and the settings API round-tripped.
Renderer-only; ships in v0.1.14.

---

## 2026-07-02 (b) — Adversarial review of the web-search batch → 5 fixes

Ran a multi-agent adversarial review over the whole batch diff (4 review dimensions → each finding refuted by
an independent verifier). It **refuted 4** plausible-but-wrong findings (bench SSE parser drops the last
frame — no, LiteLLM SSE always ends with a blank line; percentile off-by-one — a convention, not a bug;
tokens/s clamp poisons the median — median is outlier-robust; alias-collision misrouting — not reachable on a
realistic config) and **confirmed 5**, now fixed:

- **HIGH — [index.ts](../shell/src/main/index.ts) `set-data-dir`**: changing the data folder called
  `sidecar.start()` without `defaultModel`/`searxngUrl`, so both reset to null → **web search + the default
  model silently died** with no self-heal (the module globals stayed set, so `onFarms`' change-check never
  repointed to restore them). Now threads both; same fix applied to `install-sidecar` (same class).
- **MED — [index.ts](../shell/src/main/index.ts) `select-farm`**: pinning a farm called
  `repoint(endpoint, null)` and never updated `currentModel`/`currentSearxng`, so it dropped `DEFAULT_MODELS`
  (re-introducing the every-message model re-pick) with no recovery. Now passes the pinned farm's model +
  SearXNG and updates the globals.
- **MED — [searxng.js](../farm/src/searxng.js)** SHA-pin idempotence: the source re-fetch was guarded on the
  src tree merely *existing*, while `.installed-sha` was stamped with `PINNED_SHA` unconditionally — so
  **bumping the pin silently kept running the old commit** (and the master fallback lied that the pin was
  satisfied). Now a `.src-sha` marker records what's actually extracted (re-fetch when it ≠ the pin), and
  `.installed-sha` records what's actually installed (a master fallback stores `master`, which never
  satisfies the pin, so a later run re-attempts it). Bumping is now just "change the constant + re-run".
- **LOW — [up.js](../farm/src/commands/up.js)** SearXNG staleness: `searxngUp` was captured once at boot and
  never refreshed, so a SearXNG that crashed mid-session kept being advertised (clients' web search then
  fails silently). Now the health timer re-probes `/healthz` (new `searxngAlive()`), and a `child.on('exit')`
  flips it off immediately + kicks the beacon.
- **LOW — [modelPicker.js](../farm/src/modelPicker.js)** `toEntry` carried a picked model's config `alias`
  but not its explicit `vision` flag; since `selectModels` REPLACES `config.models`, picking a model with
  `vision:true` (id the tag-regex can't infer) dropped it → images silently stripped at the proxy. Now
  carried (with a regression test).

**Verified:** farm suite **39 pass** (+ the vision-flag regression); shell `tsc` clean; `ensureSearxng()`
idempotent on the live install (40 ms, no reinstall). Shell fixes ship in v0.1.13; farm fixes reach boxes via
`git pull`.

---

## 2026-07-02 — Web search on every client + fleet view + workshop tooling + multi-model aliases

The batch completing the approved plan (SearXNG was the farm half, previous entry). Four pieces:

**1. Client web search (ships in v0.1.12).** The client reads `searxngUrl` from the discovered farm and
threads it through the sidecar exactly like `defaultModel` (start/repoint/setDataDir/crash-restart + the
repoint change-check, so a farm toggling websearch repoints clients live). [configBridge](../shell/src/main/configBridge.ts)
sets `ENABLE_WEB_SEARCH` / `WEB_SEARCH_ENGINE=searxng` / `SEARXNG_QUERY_URL=<url>/search?q=<query>` and adds
the **`web_search` capability** to `DEFAULT_MODEL_METADATA` (same mechanism as the vision fix — it gates
OWUI's per-message web-search toggle). No farm SearXNG → no env → feature hidden, exactly as before.

**2. Fleet view in the client (v0.1.12).** Renderer-only: the connection popover's farm rows now show
badges (source / **coordinator** / **web search**), the default-model star, and a live line (GPU% ·
VRAM used/total · loaded models · backends · hosts up); the topbar pill appends the active farm's live GPU
load ("Dev Box Farm · 1% GPU").

**Proof for 1+2 (smoke screenshot against the live farm):** `[sidecar] repoint … (model null → assistant,
search null → http://10.10.16.58:8888)` in the log — the real app picked BOTH up from the beacon — and the
`LOL_SMOKE_POPOVER` capture shows the pill with live load + the farm card with BEACON/WEB SEARCH badges,
`assistant ★`, `1% GPU · 15.7/96GB VRAM · loaded: gemma4:12b`, and the hardware line.

**3. Workshop tooling (farm).** `ollama.keepAlive` (default **`-1`**) → `OLLAMA_KEEP_ALIVE` on any Ollama
the CLI starts, so the model stays in VRAM instead of unloading after Ollama's 5-min default (the first
student after a pause otherwise eats a ~30-60s 35B reload); advisory log for externally-started Ollamas.
New **`lol bench`**: N concurrent **streaming** completions per round → per-request first-token latency
(the perceived wait), tokens/s, aggregate + p50/p95. Live run on the box: 3 concurrent users → TTFT
5.6-7.5s (cold), ~132 tok/s per user, 3/3 ok.

**4. Multi-model aliases (farm).** `servedEntries()` no longer collapses to one model: every picked model
serves, named by its per-model **`alias`** (role names: "coder"), else the global `modelAlias` (default
model only), else the raw id. The **snapshot now derives from the same `servedEntries()`** as the LiteLLM
generator, so routing and advertising can't drift. Picker syntax `--model id=alias,id2` attaches aliases;
interactive picks keep config aliases. Docs refreshed (farm README commands/flags/config walkthrough, main
README status, plan roadmap).

**Tested:** farm suite **38 pass** (websearch defaults + settings gotchas, searxngUrl advertising, keepAlive
default, multi-alias servedEntries/litellm/snapshot alignment, `id=alias` parsing); shell `tsc` clean;
`lol bench` live; the smoke screenshot above. The farm on the box is running the full stack (assistant alias
+ SearXNG) right now.

---

## 2026-07-01 (i) — Web search: one shared SearXNG on the farm, zero-setup for clients (farm half)

Owner's top ask: **web search available by default in every client, via SearXNG**. Architecture: the search
*feature* runs client-side (each OWUI queries the engine and fetches/embeds result pages locally — the
local-data invariant holds), but **SearXNG itself is ONE shared instance on the farm box**, orchestrated by
`lol` and advertised through the beacon (`snapshot.searxngUrl`) so clients auto-configure with zero setup.

**Farm implementation** (new [farm/src/searxng.js](../farm/src/searxng.js)): config block
`websearch: { enabled (default false), port (8888) }` + `lol up --websearch/--no-websearch`. First run
installs SearXNG: **source tarball at a pinned commit SHA** (the repo has no tags) → own venv (SearXNG
`==`-pins httpx/flask/jinja2, which would fight LiteLLM in the shared venv) → `pip install -r
requirements.txt` **then** the editable install → generated `settings.yml` (random secret — the webapp
refuses the default; `formats: [html, json]` — OWUI 403s without json; `limiter: false` — skips the Valkey
dependency on a trusted LAN). Runs as a sibling child of LiteLLM (`<venv python> -m searx.webapp`, bound
0.0.0.0), health-waited on `/healthz` + a one-shot `format=json` probe, pid in `.lol-runtime.json`, killed by
`lol down`/shutdown. **Auxiliary by design**: any install/boot failure warns and the farm still comes up.
`lol fleet` shows the search URL.

**Three real Windows walls hit live, all fixed:**
1. **Git can't check out the searxng repo on NTFS at all** — it ships uwsgi/nginx templates named
   `searxng.conf:socket` (colons are invalid on Windows). Sparse checkout didn't dodge it either. Fix: fetch
   the **GitHub tarball** and extract with `--exclude "*/utils/*"` — the bad files are never written, and the
   git prerequisite disappears entirely.
2. **pip metadata generation crashed** (`ModuleNotFoundError: msgspec`): SearXNG's `setup.py` imports
   `searx/__init__.py` at build time, so `requirements.txt` must be installed **before** the package.
3. **`import pwd` crash at boot** — `searx/valkeydb.py` imports the POSIX-only `pwd` module top-level, though
   it's only used in a valkey-error log line (a path we never exercise: no valkey, limiter off). Fix:
   `patchWindowsCompat()` rewrites it to a conditional import after extraction (editable install → live);
   idempotent, no-op if upstream fixes it.

**Verified on the box**: install completes; `python -m searx.webapp` boots on native Windows; `/healthz` 200;
`/search?q=…&format=json` 200 with **16 real results** for a test query. Farm suite **34 pass** (websearch
defaults, settings.yml content incl. the json-format gotcha, `searxngUrl` advertised only when enabled AND
healthy). Enabled in the dev box's `lol.config.json`; `farm/.searxng/` gitignored.

**Client half** (next commit): read `searxngUrl` from the discovered farm → OWUI env
(`ENABLE_WEB_SEARCH`/`WEB_SEARCH_ENGINE=searxng`/`SEARXNG_QUERY_URL`) + the `web_search` model capability.

---

## 2026-07-01 (h) — Default the UI language to English

The app came up in French because OWUI's i18n detector reads the webview's
`navigator.language`, which is the OS locale. Set Chromium's locale to **en-US** via
`app.commandLine.appendSwitch('lang', 'en-US')` ([index.ts](../shell/src/main/index.ts), before app
`ready`) — that's what the frontend detector actually reads — plus `DEFAULT_LOCALE=en-US`
([configBridge.ts](../shell/src/main/configBridge.ts)) as the backend fallback. It's a **default, not a
lock**: a user who picks another language in OWUI's settings still wins (that choice caches in localStorage,
which beats navigator). tsc clean; ships in the next client release. Note: an existing install that already
cached French in localStorage keeps it until changed once in OWUI → Settings → General → Language.

---

## 2026-07-01 (g) — Stable model alias: switch models without breaking OWUI chats

**The (f) DEFAULT_MODELS fix didn't cure it — so I stopped guessing and tested the component directly.** A
chat completion through the proxy for the model OWUI had (`ornith:35b`) returned **`Invalid model name`**,
while `/v1/models` and `/lol/self` now showed a *different* model, **`qwen3.6:35b`** (which chatted fine). So
the real cause, proven not inferred: **the operator switching the served model (via the picker) invalidates
every OWUI chat pinned to the previous model id** — OWUI sends `model=<old id>` on each message, LiteLLM
rejects it, OWUI makes you re-pick. DEFAULT_MODELS helps *new* chats but can't save a chat bound to a
now-removed model.

**Fix (owner chose "stable alias"): decouple the client-facing id from the Ollama tag.** New nullable config
`modelAlias` ([config.js](../farm/src/config.js)); when set, the farm exposes **ONE fixed `model_name`** (e.g.
`assistant`) backed by the default picked model — `servedEntries()` in [litellm.js](../farm/src/litellm.js)
emits `model_name: assistant → ollama_chat/<real model>`, and [snapshot.js](../farm/src/snapshot.js) advertises
`assistant` as the id. So OWUI chats bind to `assistant`, which never changes; **swap the underlying model with
the `lol up` picker anytime and no chat breaks, no one re-picks.** Off by default (null → real names, unchanged
for other setups); enable with `modelAlias` in config or `lol up --alias <name>` / `--no-alias`. Coordinator
peer-matching keys on the served name too, so an aliased fleet shares the alias.

**Client:** none needed — the v0.1.10 client already feeds the advertised default (now `assistant`) into OWUI's
`DEFAULT_MODELS`, so it auto-selects the alias and follows it across restarts. Farm-only → reaches the box via
`git pull` + restart.

**Tested:** farm suite **31 pass** (alias collapses to one stable id backed by the default model; LiteLLM
exposes the alias routed to the real model; snapshot advertises the alias and keeps it constant when the
underlying model changes). Live preview off the box config: `model_name: assistant → ollama_chat/gemma4:12b`,
beacon `[{id:"assistant",default:true}]`. **On-box:** `lol down` + `lol up`, pick a model, then start a **new**
chat (old chats bound to `ornith`/`qwen3.6` real names stay broken — a one-time transition).

---

## 2026-07-01 (f) — OWUI auto-selects the farm's model (fix: re-picking the model every message)

**Symptom (reported):** after switching the served model (gemma4 → `ornith:35b` via the new picker), OWUI made
the user pick the model on every message. Their hunch was a box-side signalling bug.

**Investigation (box ruled out with evidence):** on the box, `/v1/models` returned `ornith:35b` on every poll
(no flap), `/lol/self` showed `healthy=true`, one model, one IP, steady over 6 polls, and `lol fleet` found
**one** farm on the LAN — so no model-list instability and no multi-farm switching by the v0.1.9 least-loaded
client. The client also never told OWUI a model (a grep found only `DEFAULT_MODEL_METADATA`). So the model
*signals* fine; what changed was *which* model.

**Root cause:** OWUI had **no default model** over its OpenAI connection. With one steady model it happened to
keep working; once the served model changed, OWUI's remembered selection went stale with nothing to fall back
to → it prompts for a model. The box does advertise its default in the beacon (`models:[{id,default}]`), but
the client wasn't using it.

**Fix (client feeds the farm's model to OWUI):** the client now reads the active farm's advertised default
model (`farmDefaultModel` in [index.ts](../shell/src/main/index.ts)) and sets OWUI's **`DEFAULT_MODELS`** via
[configBridge](../shell/src/main/configBridge.ts), so OWUI auto-selects whatever the farm serves. Threaded
through the sidecar supervisor ([sidecar.ts](../shell/src/main/sidecar.ts)): `start`/`repoint`/`setDataDir`/
crash-restart all carry `defaultModel`, and it's part of `repoint`'s change-check so **switching the served
model (same endpoint) still restarts OWUI to re-default it**. Env-authoritative each launch
(`ENABLE_PERSISTENT_CONFIG=false`), so it tracks the farm with zero clicks. tsc clean.

**Ships in the next client release; needs on-box confirmation** — I couldn't reproduce OWUI's UI from here, so
if re-picking persists after updating, the next thing to check is whether a *new* chat also starts model-less
(vs only pre-existing chats that stored the old model id).

---

## 2026-07-01 (e) — Choose the served model at `lol up` (installed-Ollama picker)

`lol up` always served the fixed `config.models`. Now the operator can **pick which installed Ollama model(s)
to serve at startup**, from what's actually on the box.

- **New [farm/src/modelPicker.js](../farm/src/modelPicker.js)** — `selectModels(config, hosts, args)` resolves
  the run's catalog: (1) `--model <id[,id]>` / `-m` → serve those, no prompt (pulls if absent); (2) `--no-pick`
  / `--yes` / **no TTY** (scripts, CI, `npm run`) → `config.models` unchanged, so nothing existing breaks;
  (3) otherwise an **interactive picker** — lists installed models with param + disk size (via new
  `ollama.listModelsDetailed`, off `/api/tags`), defaulting to the config's default, Enter to accept, or a
  number / comma-separated list.
- **Wired into [up.js](../farm/src/commands/up.js)** right after Ollama is confirmed reachable and before the
  pull/config steps: the choice replaces `config.models` **in memory** for this run, so it flows through the
  pull, the generated LiteLLM routing, the beacon snapshot, and (coordinator) peer matching. `lol.config.json`
  is left untouched — the persistent catalog is still managed with `lol models add/rm`.
- Purely farm-side (no client change) → reaches the boxes via `git pull`, no release.

**Tested:** farm suite 27 pass (`parseModelFlag` for `--model`/`-m`/`--model=`/comma-lists + not swallowing a
following flag; `selectModels` honours `--model`, `--no-pick`, and the no-reachable-models/non-interactive
fallback). Live: `installedModels` against the box's Ollama listed `gemma4:12b` (11.9B/7.6 GB),
`gemma4:latest` (8.0B/9.6 GB), `ornith:9b` (9.0B/5.6 GB) with sizes.

---

## 2026-07-01 (d) — Multi-box load balancing: least-loaded selection, coordinator farm, `lol fleet`

Closed the Layer-2 gap from the plan (several GPU boxes + several clients → no automatic spreading). Three
pieces, one design that unifies two deployment styles:

- **#1 Least-loaded client selection** ([shell/src/main/index.ts](../shell/src/main/index.ts)) — `chooseActive`
  no longer picks "first healthy"; a new `pickLeastLoaded` sorts by the GPU utilisation the beacon **already**
  broadcasts (`usage.gpuUtil`; unknown → treated as mid-load) and **scatters ties randomly** within a 15-point
  band so a fleet booting at once (all boxes idle) doesn't stampede one box. It runs **only when choosing** —
  first connect / failover — so a healthy current farm stays sticky and we never repoint OWUI mid-session over
  a load blip. Zero new infra: it turns N independent farms into a self-balancing pool.
- **Peer discovery for the CLI** ([farm/src/peerListener.js](../farm/src/peerListener.js)) — the farm can now
  *hear* other farms (it only sent beacons before). Mirrors the shell's discovery: UDP multicast + directed/
  limited broadcast, **plus** a unicast `/lol/self` subnet sweep for broadcast-blocked Wi-Fi; peer registry
  keyed by farm id, self excluded. Shared by the next two.
- **#2 Coordinator farm** (`lol up --coordinator`, or `coordinator:true` in config) — at boot it discovers peer
  farms and folds each into the generated LiteLLM config as an `openai/<model>` deployment of the same
  `model_name` ([farm/src/litellm.js](../farm/src/litellm.js) `buildLitellmConfig(config, peers)`), so **one
  endpoint shuffle-balances across the whole fleet** (each peer proxy then balances its own Ollama) with the
  same failover. It advertises `coordinator:true` in its beacon; the client's `pickLeastLoaded` **prefers a
  coordinator when one exists** — so with no coordinator clients balance client-side (#1), and with one present
  they route through it (#2). Static at boot (a box added later → restart the coordinator); dynamic add is a
  noted follow-up (a proxy restart mid-flight is disruptive, and live `/model/new` needs a master key that
  would force keys on clients).
- **#3 `lol fleet`** ([farm/src/commands/fleet.js](../farm/src/commands/fleet.js)) — listens + sweeps for ~7 s
  and prints every farm on the LAN (this box + peers): health, GPU %, VRAM, hosts up, backends, loaded models,
  model catalog, coordinator role, last-seen. The telemetry was already in the beacon; this renders it.

**Capacity reminder unchanged:** one Ollama serves `OLLAMA_NUM_PARALLEL` (default 2) concurrent generations —
size the fleet by in-flight generations, not headcount.

**Tested:** farm suite 23 pass (peer aggregation adds openai deployments + preserves `supports_vision`; skips a
peer that doesn't serve the model; coordinator config default false; snapshot carries `coordinator`/
`deployments`). Shell `tsc` clean. `lol fleet` smoke-run on the box renders self correctly (hardware, 0% GPU,
loaded/idle) and reports no peers on a single-farm LAN. Client change ships in the next release; the farm
changes reach the boxes via `git pull`.

---

## 2026-07-01 (c) — Multimodal verified + OWUI update procedure (the misleading toast)

**Multimodal confirmed working on the box.** Proved the vision chain layer-by-layer with live tests on the
dev/GPU box: `gemma4:12b` reports `vision` capability and describes a test image directly via Ollama; the
*running* proxy (old `gemma4`, no flag) DROPPED the image ("Please provide the image"); a throwaway proxy on
the regenerated config (`gemma4:12b` + `supports_vision`) DESCRIBED it ("a blue circle… on a red field").
After `lol up` + updating a client to v0.1.7, **image description and webcam work by default** — the
`DEFAULT_MODEL_METADATA` vision baseline flips OWUI on with no per-model toggle (owner-confirmed). Also
pinned the farm to `gemma4:12b` (was `gemma4` → `:latest`) so the 12B multimodal build that fits the 4070 is
what's served. Voice was already confirmed live.

**The misleading OWUI update toast.** On startup OWUI popped "a new version (v0.10.2) is available" while our
own **About → Check for chat-engine update** said "up to date (v0.10.1)." Both were right from their own
vantage: the toast is OWUI's **built-in upstream check** (it queries the OWUI GitHub), whereas our button
compares the installed sidecar to the OWUI version in **our latest release's** `owui-sidecar-manifest.json`
(0.10.1, the sidecar we built + shipped). We manage OWUI by pinning + repackaging it as a sidecar tarball and
updating through the app (sidecarManager: check → download to `.pending` → apply on next launch), so OWUI's
own toast advertises versions we haven't packaged yet — contradicting our button.

**Fix (two parts):**
- **Single source of truth** ([configBridge.ts](../shell/src/main/configBridge.ts)): set
  `ENABLE_VERSION_UPDATE_CHECK=false` so OWUI stops its upstream check/toast. The app's own update flow is now
  the only OWUI-version signal the user sees.
- **Bump the pin + prove the pipeline** ([sidecar/OPENWEBUI_VERSION](../sidecar/OPENWEBUI_VERSION)):
  0.10.1 → **0.10.2** (verified on PyPI as latest; `requires_python >=3.11,<3.13` satisfied by our sidecar's
  Python 3.12). Cutting the release rebuilds the sidecar tarball + manifest at 0.10.2, so existing clients'
  **Check for chat-engine update** will see 0.10.2 > 0.10.1, download it, and apply it on restart — which
  exercises the whole in-app OWUI update procedure end-to-end.

---

## 2026-07-01 (b) — Vision, take 2: OWUI defaulted models to vision-OFF

**Field report after v0.1.6:** voice mode worked (mic fix confirmed live), but attaching an image still got
"my interaction mode does not include vision processing capabilities," AND the **webcam** couldn't be
accessed in call mode.

**Root cause (the webcam clue nailed it):** the LiteLLM `supports_vision` fix (take 1) was necessary but
not sufficient — it stops the *proxy* dropping images, but **OWUI wasn't sending them in the first place**.
Over an OpenAI-style connection OWUI can't introspect a model's capabilities (the farm's `/v1/models`
returns names only), so it defaults **vision OFF**, and a vision-off model means OWUI neither sends attached
images inline NOR enables camera/webcam vision input. The mic worked because STT is capability-independent —
which is exactly why voice was fine but *both* image and webcam failed. One gate, two symptoms.

**Fix** ([configBridge.ts](../shell/src/main/configBridge.ts)): set OWUI's official
`DEFAULT_MODEL_METADATA={"capabilities":{"vision":true}}` (a v0.10.0+ env; we pin 0.10.1). It's a baseline
that flips vision on for every model, env-authoritative every launch (`ENABLE_PERSISTENT_CONFIG=false`), so
it's **zero-config across all clients** — no per-model toggle to click on each machine. Harmless for
text-only models: OWUI sends the image, but the farm's per-model `supports_vision` still gates whether
LiteLLM forwards it to Ollama, so a text-only model just has its image dropped at the proxy.

**Full working chain now:** OWUI (vision on → sends image_url + enables camera) → LiteLLM (supports_vision →
forwards image) → Ollama (gemma4, multimodal → describes it). tsc clean. Needs a client release; the farm
half still needs `lol up` on the box to regenerate the proxy config.

---

## 2026-07-01 — Multimodal: image understanding + voice mode (STT/TTS)

**Symptoms (reported):** attaching an image to a chat produced no description, and voice mode did nothing.

**Root causes (traced through the stack, farm → LiteLLM → Ollama, and shell → webview → OWUI):**

1. **Images silently dropped by the LiteLLM proxy.** The farm serves `gemma4`, which *is* natively
   multimodal — so the model was never the problem. But the generated LiteLLM config
   ([farm/src/litellm.js](../farm/src/litellm.js)) declared each model with only `model_name` +
   `litellm_params` and **no `model_info`**, and `litellm_settings.drop_params: true` is on. LiteLLM's cost
   map doesn't know our Ollama tags, so it treats the model as text-only and, with `drop_params`, **strips
   the `image_url` content before forwarding to Ollama**. OWUI sent the picture; the proxy threw it away.
   (This is the well-known OWUI + LiteLLM + Ollama "image attached but ignored" issue.)

2. **Microphone never granted to the webview.** The Electron main process
   ([shell/src/main/index.ts](../shell/src/main/index.ts)) created the OWUI `<webview>` (partition
   `persist:owui`) but installed **no permission handler**. Electron denies camera/mic by default, so voice
   mode's `getUserMedia()` was silently refused. (The origin itself is fine — OWUI loads from `127.0.0.1`,
   a secure context, so the only block was the missing grant.)

3. **No local speech engine configured.** [configBridge.ts](../shell/src/main/configBridge.ts) set no audio
   env, so STT/TTS fell to OWUI defaults that expect a cloud key — dead on a closed LAN.

**Fixes:**

- **Vision passthrough** ([farm/src/litellm.js](../farm/src/litellm.js)): infer image support from the tag
  (`gemma-4|llava|*-vl|*-vision|minicpm-v|moondream|…`, overridable by an explicit `vision:` on the model)
  and emit `model_info: { supports_vision: true }` for those deployments. LiteLLM then keeps the images
  *and* advertises the capability on `/v1/models` (so OWUI lights up the image UI). Added an optional
  `vision` field to the model schema ([farm/src/config.js](../farm/src/config.js)). **Needs `lol up` on the
  GPU box** to regenerate the config — it's derived, never hand-edited.
- **Mic permission** ([shell/src/main/index.ts](../shell/src/main/index.ts)):
  `configureWebviewPermissions()` sets a request + check handler on the `persist:owui` session that grants
  **only** `media`/`audioCapture`/`videoCapture` (scoped to the OWUI partition, nothing app-wide).
- **Local voice engines** ([configBridge.ts](../shell/src/main/configBridge.ts)): `AUDIO_STT_ENGINE=''` →
  OWUI's built-in **faster-whisper on the client CPU** (offline; `WHISPER_MODEL=base` keeps the one-time
  download ~150 MB); `AUDIO_TTS_ENGINE=''` → **client-side Web-Speech voices** (offline, zero bundle cost).
  These are env-authoritative every launch (`ENABLE_PERSISTENT_CONFIG=false`), so they can't be un-set by a
  stale persisted setting.
- **Ship the STT dep** ([sidecar/build-sidecar.mjs](../sidecar/build-sidecar.mjs)): explicitly
  `pip install faster-whisper` after OWUI (CTranslate2, not torch → no CUDA weight; a no-op if OWUI already
  bundles it) so voice works even if OWUI makes audio an optional extra.

**Tested:** farm unit tests extended (19 pass) — vision inferred from tag, explicit flag overrides,
`supports_vision` present for `gemma4` and absent for `qwen2.5-coder`; shell `tsc --noEmit` clean. **Still to
verify on the GPU box + a client build** (I can't reach the rig from here): (a) `lol up`, then attach an
image and ask "describe this" → expect a real description; (b) a fresh client build → voice mode records
(mic prompt), transcribes locally, and speaks the reply.

**Note:** vision needs a client that talks to a farm running the regenerated config; voice needs a new
client release (shell + sidecar changes). Both are LAN-local — no cloud, no farm audio load (STT/TTS run on
the client).

---

## 2026-06-30 — Fix: OWUI cramped at the top with a black bar (webview not filling)

**Symptom (reported, with a screenshot):** OWUI rendered squished into the top of the window with a large
black area below — model picker + greeting + input crammed together, input not at the bottom.

**Root cause (reproduced + measured):** the embedded `<webview>` was sized with `width/height:100%`. A
harness that loads OWUI and resizes the window showed the precise failure: the **webview *element*** fills
`.main` correctly (e.g. 745px → 355px on resize), but the **embedded guest's viewport stays stuck at its
intrinsic 150px** — so OWUI lays out in a 150px-tall page and the element's background shows below it
(the black bar). Percentage height on an Electron `<webview>` doesn't propagate to the guest viewport and
never re-tracks a window resize; `position:absolute;inset:0` had the same flaw.

**Fix** ([shell/renderer/styles.css](../shell/renderer/styles.css)): size the webview by **flex** instead
— `.main { display:flex }` + `webview { flex:1 1 auto; align-self:stretch; min-width:0 }` (no
width/height). With flex stretch the guest viewport tracks the element at every size (harness: guest
innerHeight 745 → 355 = fills). The absolute overlay (`inset:0`) is out of flex flow, so it's unaffected.

**Tested:** the resize harness goes from a 150px guest (black bar) to a fully-filling guest with flex; and
a real packaged app launched + resized to a short window (added a `LOL_SMOKE_RESIZE` smoke option) renders
OWUI filling the whole window, no black bar. Shipping as the next patch.

---

## 2026-06-30 — Small installer: download Open WebUI on first run + in-app updates

The bundled-OWUI installer was ~740 MB (Win) / ~1.3 GB (Linux). Switched to a **small installer
(~120 MB) that downloads the OWUI sidecar on first run**, plus in-app update buttons for both the app and
the chat engine.

- **Installer** ([shell/electron-builder.yml](../shell/electron-builder.yml)) — dropped `extraResources`
  (the sidecar). win-unpacked fell from ~1.5 GB to **357 MB** (→ ~120 MB NSIS). Also set
  `nsis.artifactName: ${productName}-Setup-${version}.${ext}` — electron-builder's default name has spaces
  that GitHub turns into dots on upload (`LlmOnLan.Setup.0.1.3.exe`), which breaks electron-updater's
  filename match in `latest.yml`.
- **Sidecar as a release asset** ([.github/workflows/release.yml](../.github/workflows/release.yml)) — CI
  still builds the per-OS sidecar, then packs it as `owui-sidecar-<platform>-<arch>.tar.gz` (+ a tiny
  `owui-sidecar-manifest.json` with the OWUI version) and uploads it via `gh release upload`. (Bonus: this
  also sidesteps the 2 GB asset limit that the bundled Linux AppImage kept hitting — the small AppImage and
  the sidecar tarball are each well under it.)
- **Download on first run** ([shell/src/main/sidecarManager.ts](../shell/src/main/sidecarManager.ts)) — a
  packaged app with no `userData/sidecar` downloads the matching tarball (redirect-following `https`, byte
  progress), extracts it with the system `tar` (relative paths to dodge the Windows drive-colon bug), and
  swaps it into place. [paths.ts](../shell/src/main/paths.ts) `resolveSidecarCommand` now points at
  `userData/sidecar` (packaged); the renderer shows a "Setting up the chat engine (~700 MB, one-time)"
  progress overlay with a Retry on failure.
- **In-app updates** ([Preferences](../shell/renderer/index.html)) — **Check for app updates**
  ([updater.ts](../shell/src/main/updater.ts) `checkForAppUpdate`/`quitAndInstallUpdate`; downloads in the
  background, "Restart & install" when ready) and **Check for chat-engine update** (compares the installed
  OWUI version to the latest release's manifest; downloads a newer sidecar to `userData/sidecar.pending`,
  applied on the next launch by `applyPendingSidecar()` so a running OWUI isn't disturbed — "Restart to
  apply").

**Tested:** tsc + renderer clean; the small `--dir` build has no `resources/sidecar` (357 MB). End-to-end
first-run download verified against a real release asset — a fresh-userData small build downloaded the
778 MB sidecar, extracted it, ran OWUI from `userData/sidecar`, and reached the authenticated chat.
**Shipped as v0.1.4** (single clean release, all 4 jobs green): installers `LlmOnLan-Setup-0.1.4.exe`
**97 MB** / `…-arm64.dmg` 111 MB / `….AppImage` 120 MB (down from ~740 MB / ~1.3 GB), the per-OS
`owui-sidecar-*.tar.gz` (777/702/1231 MB) + manifest, and `latest*.yml` whose `path` matches the
hyphenated installer name (so electron-updater resolves it).

---

## 2026-06-30 — Farm bootstrap: `lol install` (one command to set up, one to run)

A fresh checkout on a GPU box was a multi-step manual setup (install Ollama, `pip install litellm`, point
the config at the venv, pull models). Collapsed that into **one command to install, one to run**, the way
the desktop client is one installer.

- **`lol install`** ([farm/src/commands/install.js](../farm/src/commands/install.js)) — idempotent
  bootstrap: (1) scaffold `lol.config.json` if absent; (2) install **Ollama** if missing —
  `winget install Ollama.Ollama` on Windows, `brew install ollama` on macOS, the official `install.sh`
  on Linux (detected as "present" if the CLI is on PATH or a local daemon answers, so it never reinstalls);
  (3) create `farm/.venv` with the operator's Python 3.9–3.13 and `pip install "litellm[proxy]"`;
  (4) pull every configured model over Ollama's HTTP API. Each step is skipped if already satisfied, and a
  missing auto-installer (no winget/brew/curl/Python) prints the exact manual step instead of failing.
- **`farm/.venv` is auto-used** ([farm/src/proc.js](../farm/src/proc.js) `resolveLitellmCommand`): with the
  default `litellm.command:"litellm"`, the farm prefers `farm/.venv`'s litellm if `lol install` made one,
  else falls back to PATH — so a fresh pull needs **no config editing**. An explicit absolute command still
  wins.
- **Wrapper scripts** for the literal two commands: [farm/install.ps1](../farm/install.ps1) /
  [install.sh](../farm/install.sh) (`npm install` + `lol install`) and [farm/run.ps1](../farm/run.ps1) /
  [run.sh](../farm/run.sh) (`lol up`). So a fresh GPU box is: `cd farm; ./install.ps1; ./run.ps1`.

**Tested:** `lol install` on the dev box runs the full happy path idempotently (detects Ollama, the venv,
and the pulled model — exit 0); `where`/`py -3.12` probes resolve (winget + Python 3.12 present); 16/16
farm unit tests pass incl. two new ones for `resolveLitellmCommand` (explicit path wins; default →
`.venv`-or-PATH). The actual installer invocations follow each tool's official method; the model-pull
reuses the existing HTTP `pullModel`. Docs: [farm/README.md](../farm/README.md) gains a "Quick start
(fresh pull) — two commands" section + a `lol install` breakdown.

---

## 2026-06-30 — M5 release: published to GitHub Releases (v0.1.1 → v0.1.3, validated)

First real packaged release — the "streamline testing with several clients + one GPU box" goal: install
the client on each machine, all pointing at the one farm, with **auto-update** from GitHub Releases.

**Two build fixes were needed before the first release could be trusted:**
- **`OPENWEBUI_VERSION` wasn't staged into the bundle** — `paths.bundledOwuiVersion()` reads
  `resources/sidecar/OPENWEBUI_VERSION` (About panel), but `build-sidecar` only copied `launcher.py` +
  `python/`. Now copies the pin too.
- **`tar` Windows drive-colon** — GNU/MSYS `tar` reads `C:\…\python.tar.gz` as a remote `host:path`
  ("Cannot connect to C:"), so extraction failed wherever GNU tar is first on PATH (a CI windows-latest
  risk too, since Git ships GNU tar). `build-sidecar` now runs `tar` from `workDir` with **relative**
  paths, which both GNU tar and Windows' bundled bsdtar handle.

**Validated locally before tagging (so the first public release isn't broken):**
1. Built the full `win32-x64` sidecar — standalone CPython (python-build-standalone) + `open-webui==0.10.1`
   (torch/chromadb/transformers, ~1.5 GB).
2. Ran the bundle directly: `python launcher.py serve` → `/health 200`, `/api/config` `v0.10.1`.
3. `electron-builder --dir` pack → launched the **packaged** `LlmOnLan.exe`: it resolved the bundled
   sidecar (`[sidecar] spawning (packaged): …/resources/sidecar/python/python.exe …launcher.py serve`),
   booted OWUI, and rendered the **authenticated** UI — the "What's new in Open WebUI" modal + full
   sidebar (signed-in admin), confirming the auth-reveal fix in a real packaged build
   ([docs/img/packaged-app.png](img/packaged-app.png)). (`app-update.yml ENOENT` in a `--dir` pack is
   expected — that file is emitted by the NSIS target in CI, not `--dir` — and the updater catches it.)

**Release flow:** `npm run release:patch` → bumps `shell/package.json`, tags `vX.Y.Z`, pushes →
`.github/workflows/release.yml` matrix (windows/macos/ubuntu) each builds its own sidecar then
`electron-builder --publish always` to the GitHub Release. Clients with auto-update on (default) pull the
next version from there. The chat-auth fix above ships in this release.

**The real CI run then surfaced four more bugs (fixed; the local `--dir` pack couldn't catch any of them):**
- **`release.mjs` ENOENT on Windows** — `execFileSync('npm', …)` can't spawn `npm.cmd` without a shell;
  pass `shell:true` (git is a real `.exe`, unaffected).
- **CI never compiled TypeScript** — the workflow ran `electron-builder` directly, not the `dist` script
  that chains `npm run build`, so the app.asar shipped without `build/main/index.js` and every OS failed
  the packager's entry-file sanity check. Added an explicit `npm run build` step. *(After this, Windows
  built + published a working 741 MB installer + `latest.yml`.)*
- **Linux AppImage > 2 GB** — on Linux the PyPI `torch` is the **CUDA** build, which pulls **~3–4 GB of
  `nvidia-*`/`cuda-toolkit` wheels** (cudnn, nccl, cublas, …) as dependencies, blowing past GitHub's 2 GB
  asset limit (Windows/mac get CPU torch by default). v0.1.2's first attempt swapped the torch *binary* for
  the CPU wheel but `--no-deps` left the multi-GB nvidia packages behind — still > 2 GB. **v0.1.3** fixes it
  for real: swap torch → CPU **and** `pip uninstall` the orphaned `nvidia-*`/`cuda-*` packages (CPU torch
  never loads them). The client only needs CPU embeddings; the GPU box runs the farm.
- **electron-builder's GitHub publisher is unusable across a matrix** — it uploads a release's assets in
  parallel and each upload that finds no release creates its own, which (a) 422'd `already_exists`, dropping
  assets, and (b) it *ignores a pre-made published release* and makes its own draft → **two non-draft v0.1.3
  releases with assets split between them**. `max-parallel:1` (cross-job) and a `create-release` pre-make job
  both helped but neither cured it. **Final fix: stop publishing via electron-builder.** Build with
  `--publish never` (which still emits the `latest*.yml` manifests + blockmaps in `dist/`), then upload with
  `gh release upload "$TAG" … --clobber` to the release the `create-release` job pre-made. `gh` doesn't
  create-race, `--clobber` makes re-runs idempotent, and `max-parallel:1` keeps uploads from overlapping.
  Also dropped the mac **x64** target — the sidecar is built for the runner's arch (arm64), so an Intel dmg
  would ship an arm64 Python (re-add once `build-sidecar` emits both arch bundles).

So **v0.1.1** was the Windows-only first attempt; **v0.1.2** got Windows (NSIS) + macOS (arm64 dmg+zip)
clean (the serialize fix landed the mac assets) but Linux still 2 GB; **v0.1.3** is the fully-green
release — Windows, macOS, and Linux (AppImage) all published with their auto-update manifests.

---

## 2026-06-30 — Fix: embedded OWUI rendered unauthenticated (no chat stream, sparse features)

**Symptom (reported):** the shell connects to a farm and the model is selectable, but **chat answers
never stream back** and **many Open WebUI features are missing**.

**Root cause (found via systematic debugging, evidence at every boundary):** the whole stack was
healthy — the farm streams (`curl` to `:4000` ✅), and OWUI→farm→Ollama works end‑to‑end in a normal
browser (Playwright drove a full streamed reply with all features ✅). The break was **webview‑specific
and timing‑based**:
- OWUI's SvelteKit SPA fetches `GET /api/config` and **first‑paints before** the `WEBUI_AUTH=false`
  auto‑login writes its token. Unauthenticated, `/api/config` returns the **sparse** feature set
  (7 keys vs 37) → "features missing", and any chat `POST /api/chat/completions` **401s** → "no answer".
  Once the token lands, a single reload re‑bootstraps the SPA fully authenticated.
- It bites **nearly every launch**, not just the first: `localStorage` is keyed by origin, and the
  sidecar takes a **fresh ephemeral port** whenever its preferred `8080` is busy ([util.ts](../shell/src/main/util.ts)
  `findFreePort`), so each boot is a new origin with empty storage that loses the race again. (A normal
  browser happened to win the race, which is why it only reproduced inside the `<webview>`.)

Proven with a minimal Electron `<webview>` harness: probe at first paint → `hasToken:false`, 7 features,
chat `401`; after waiting for the token + **one reload** → `hasToken:true`, 37 features, chat `200` with
streamed chunks.

**Fix** ([shell/renderer/app.js](../shell/renderer/app.js)): keep the "Starting your local chat…" overlay
up until OWUI is authenticated, never flashing the degraded UI. On the webview's `did-finish-load`,
`ensureAuthenticated()` checks `localStorage.token`; if absent it waits (≤20 s) for the auto‑login token,
then **reloads once**. A `webviewAuthed` gate drives the reveal and `authReloadPending` prevents reload
loops; both reset when the OWUI origin changes (repoint / new port), so every fresh origin re‑bootstraps
cleanly.

**Tested:** the `<webview>` harness goes sparse→full + chat `200` after the reload; an isolated real‑app
instance (own `--user-data-dir`, fresh partition → exercises the race) boots straight to the **full,
authenticated** OWUI — "Bonjour, User", model picker, sidebar (chats/search/notes/workspace), voice — with
no stuck overlay ([docs/img/owui-auth-fixed.png](img/owui-auth-fixed.png)). Renderer‑only change; no `tsc`.

---

## 2026-06-30 — M6: farm health indicators (GPU/VRAM/RAM + live util)

Richer health surfaced from the farm all the way to the client — the M6 "connection/health indicators +
richer `lol status`" goal.
- **Farm** ([systemInfo.js](../farm/src/systemInfo.js)) — dependency‑free hardware detection: RAM/CPU
  from `os`, GPU/VRAM from `nvidia-smi` (degrades to `Unknown GPU` on non‑NVIDIA boxes; swap in
  `systeminformation` if AMD/Apple detection is ever needed). `detectHardware()` runs once at boot;
  `gpuLiveStats()` (util% + VRAM used/total) is refreshed on the health timer.
- **Snapshot** ([snapshot.js](../farm/src/snapshot.js)) now carries `host` `{gpu, vramGb, ramGb, cpuCores}`
  + `usage` `{gpuUtil, vramUsedGb, vramTotalGb, loaded}` — flowing through the beacon + `/lol/self` to the
  client with no schema migration (older farms simply omit them; the client treats them as optional).
- **`lol status`** ([status.js](../farm/src/commands/status.js)) prints a Hardware line:
  *NVIDIA RTX PRO 6000 Blackwell · 96GB VRAM · 126GB RAM · 32 cores · 1% util · 2/96GB VRAM used*.
- **Shell** — the farm popover row shows the live busy indicator on the meta line (`gemma4 · 1% GPU`) +
  the GPU name/VRAM beneath ([docs/img/m6-farm-health.png](img/m6-farm-health.png)). `FarmSnapshot` type
  extended with optional `host`/`usage`.

**Tested:** 14/14 farm unit tests (added snapshot host/usage + systemInfo tests; the runner now awaits
async tests); `lol status` + `/lol/self` show the real hardware on the rig; the shell capture shows the
farm card with `1% GPU` + the GPU name. Shell `tsc` clean.

---

## 2026-06-30 — Failover verified + LiteLLM router tuned for transparent failover

Stood up a **two‑Ollama** farm to test load‑balancing + failover (the rig had a 96 GB GPU, so a second
`ollama serve` on `:11435` held a second copy of `gemma4` easily).
- **Load‑balancing:** the generated config produced two `gemma4` deployments (one per host); 8/8 chat
  completions succeeded and **both** hosts loaded the model — LiteLLM's `simple-shuffle` spread the
  traffic.
- **Failover (first pass) found a real gap:** killing `:11435` mid‑operation gave **7/8** — one request
  (and its retries) hit the dead host before the circuit‑breaker cooled it out, surfacing an
  `APIConnectionError` to the caller. Not transparent enough.
- **Fix → re‑verified:** tuned the generated `router_settings`
  ([litellm.js](../farm/src/litellm.js)) — `num_retries 2→3`, `allowed_fails 2→1` (cool a dead host out
  after a *single* failure), `cooldown_time 30→60`. Re‑ran the same kill‑a‑host test: **10/10
  completions succeeded** — failover is now transparent (a node death is invisible to the user). 10/10
  unit tests still pass.

Ticks the RIG_CHECKLIST failover item.

---

## 2026-06-30 — Rig verification: full chat E2E + document-locality (Playwright)

Two of the biggest open [RIG_CHECKLIST](RIG_CHECKLIST.md) items, verified on the live stack by driving
a real OWUI instance (pointed at a running `lol up` farm) with Playwright.

**Full chat end-to-end** ([docs/img/e2e-chat.png](img/e2e-chat.png)) — drove the actual OWUI UI:
auto‑signed‑in under `WEBUI_AUTH=false`; OWUI's `/api/models` returned **`gemma4`** (fetched from the
farm's `/v1/models`); selected the model, typed *"what does LAN stand for?"*, and got a **real streamed
response from gemma4: "LAN stands for Local Area Network."** Since `ENABLE_OLLAMA_API=false`, the farm
(LiteLLM→Ollama) is OWUI's *only* possible inference path, so this is a definitive
**OWUI → farm → gemma4** round‑trip through the real chat surface.

**Document-locality (invariant #3)** — uploaded a doc containing a unique canary phrase
(`ZQX-PINEAPPLE-42`) via OWUI's API, then checked both ends:
- **Local:** the file landed in `DATA_DIR/uploads/`, and the **canary phrase is present in the local
  `vector_db/chroma.sqlite3`** — the document was embedded + stored on the device.
- **Farm:** the farm's LiteLLM access log shows **ZERO `/v1/embeddings` requests** (only the 4
  chat/completions from the chat above). The embedding ran on the **local MiniLM** (loaded in‑process at
  OWUI startup) — the document text never left the machine. Exactly the privacy promise: documents embed
  locally; only chat context reaches the farm at request time.

Checklist items ticked: "a full chat in the embedded webview end‑to‑end" and "document‑locality RAG test".

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
