# Docs review 2026-09-27: client shell + LOL Chat (not the Computer)

Scope: `shell/src/**` (minus `debugLog.ts` and the `LOL Studio` regions), `renderer/app.js`, `index.html`,
`styles.css`, `tokens.css`, `renderer/chat/**` minus `computer/ graph/ sandbox/` and the Computer string
namespaces, packaging (`package.json`, `electron-builder.yml`, `scripts/`, `release.yml`), `sidecar/`.
Branch `lolchat/vnext` @ 011f867: `shell/package.json` 0.1.45 (tag `v0.1.45` + 39 commits), latest farm
tag `farm-v0.0.38`, `sidecar/OPENWEBUI_VERSION` 0.10.2. Locked toolchain: electron 42.5.1,
electron-builder 26.15.3, electron-updater 6.8.9. Gates run: `chat-lint.js` 0 violations over 221 files;
`chat-unit.js` 1565 passed, 0 failed.
LOL Chat was covered by five helper audits: PLAN §3–§5; VISION + RIG_CHECKLIST; user-facing strings; two
bug hunts. Each finding kept below was re-checked against the code, and uncitable ones were dropped.

## A. Bugs in the implementation

### A.1 Shell (main process + renderer chrome)

**SA-1 · Medium · `shell/src/main/sidecar.ts:187`: a crash-restart drops the adaptive-RAG input.**
`onChildExit` restarts with `{endpoint, dataDir, apiKey, defaultModel, searxngUrl, tts, extract}` and no
`contextPerSlot`, and `start()` stores `opts.contextPerSlot ?? null` (:55). So after any OWUI crash,
`buildSidecarEnv` sees `null` and sets `RAG_FULL_CONTEXT=true` (configBridge.ts:77) even on a 16k farm.
That is the exact ContextWindowExceededError the gate exists to prevent. Nothing repairs it: `onFarms`
compares against `currentCtxPerSlot` in index.ts, which did not change (index.ts:336-339).
Fix: pass `contextPerSlot: this.contextPerSlot`. Better, give the class one `private opts()` that
`start`, `setDataDir` and `onChildExit` all use.
Test: a unit test that spies on `start()` after a synthetic `onChildExit`, and asserts every field
round-trips.

**SA-2 · Medium · `shell/src/main/configBridge.ts:51-61`: `HF_HUB_OFFLINE` never turns on for a real install.**
- `hfModelsCached()` looks for `models--Systran--faster-whisper-base` in `~/.cache/huggingface/hub`. OWUI
  0.10.2 never downloads Whisper there. It uses `WHISPER_MODEL_DIR = f'{CACHE_DIR}/whisper/models'`,
  under DATA_DIR (packaged `open_webui/config.py:1516`), passed as `download_root` (`routers/audio.py:224`),
  which becomes faster-whisper's `cache_dir` (`faster_whisper/transcribe.py:684`).
- On this box, the hub holds MiniLM only; there is no Whisper in the hub.
- So the documented boot and closed-LAN protection (CLAUDE.md:97, DEVLOG:3513) is inert. Every boot runs
  with `HF_HUB_ETAG_TIMEOUT=2` instead.

Fix: `hfModelsCached(dataDir)` should check MiniLM in the hub (honoring `HF_HUB_CACHE`/`HF_HOME` when
set) and `<dataDir>/cache/whisper/models/models--Systran--faster-whisper-base/snapshots/*`. A "Start
fresh" data folder then correctly stays online until Whisper is fetched there.
Test: unit-test `buildSidecarEnv` with a temp HOME and a temp dataDir, seeding each folder in turn.

**SA-3 · Medium (code-read, not reproduced) · `shell/src/main/discovery.ts:184-187`: the farm host can flip, which loops the OWUI restart.**
- `merge()` overwrites `host` on every sighting.
- A beacon merges under the farm's advertised endpoint host (:264).
- `pollKnown` merges under the manual entry's host string (:212-220), and `pollActive` keeps whatever
  host is current (:202-206).
- `farmEndpoint()` is built from `_host` (index.ts:117-119), and an endpoint change repoints
  (index.ts:336-363). A new `OPENAI_API_BASE_URL` forces a restart (sidecar.ts:146-158).

Trigger: add a farm by hostname (for example `studio.local`) or by a secondary IP, on a LAN where its
beacon also arrives. `_host` then alternates every few seconds and OWUI never settles ("Reconnecting…").
This is the same class of failure that discovery.ts:256-263 fixed for Docker bridges.
Fix: in `merge()`, keep an existing, non-stale record's host. Adopt a new host only when the old one has
gone quiet.
Test: a Discovery unit test that merges the same snapshot as beacon `10.0.0.5` and as added
`studio.local`, alternately, and asserts that `_host` stays stable.

**SA-4 · Medium · `shell/src/main/index.ts:843-864` (`select-farm`): pinning saves only `lastEndpoint`.**
- `onFarms` persists the whole context: key, model, SearXNG, TTS, OCR and ctx/slot (index.ts:357).
  `select-farm` writes only `lastEndpoint` (:856).
- The next cold launch therefore boots the pinned farm with the previous farm's `lastFarmKey`/`lastFarm*`
  (index.ts:976-990).
- The key is not in `onFarms`' change check (:336-339). If the two farms differ only by password, OWUI
  401-loops behind a green pill until the user clicks the card again.
- Otherwise the first beacon forces a second OWUI boot, which breaks "the sidecar spawns once".

Fix: one `persistFarmContext(chosen)` shared by both paths, and keep a `currentKey` in the change check.
Test: harness with the mock's open and keyed farms (`--keyed-port`). Pin the keyed one, relaunch, and
assert one `[sidecar] spawning` and a 200 on `/v1/models`.

**SA-5 · Low-Medium · `shell/renderer/app.js:778,789`: a pin can never be removed.**
- Clicking a card, and also entering a farm's password, calls `selectFarm(f.id)`. These are the only two
  callers; `selectFarm(null)` is never called.
- `chooseActive` honors the pin first (index.ts:287-288). While the pinned farm is healthy, least-loaded
  spreading and the coordinator preference are off for good.
- On a password-protected fleet, every client pins to the first farm it typed a password for.

Fix: do not pin on password entry. Add an "Automatic (least busy)" row that calls `selectFarm(null)`, and
mark the pinned card.
Test: a unit test of `chooseActive` with the pin cleared.

**SA-6 · Low (Windows only; depends on timing) · `shell/src/main/sidecarManager.ts:172-181`: a staged chat-engine update can be lost.**
- `downloadOwuiUpdate` → `installFrom(pendingDir)` (:217) starts a detached-in-practice `compileall`
  that runs Python from inside `sidecar.pending` (:140, :151-161).
- `applyPendingSidecar` deletes the live sidecar and only then renames `pending` (:175-176).
- If "Restart to apply" is clicked while that `python.exe` still runs, the Windows rename fails and the
  catch leaves no sidecar. The boot then re-downloads the app version's (old) engine (index.ts:957-960),
  and the update lands one launch later.

Fix: swap `live→live.old`, then `pending→live`, and roll back on failure. Do not precompile the pending
tree (precompile after the swap instead).
Test: on Windows, hold a file open under `sidecar.pending` and assert `sidecarRoot()` survives.

### A.2 LOL Chat (paths under `shell/renderer/chat/`)

**SA-7 · Medium (macOS) · `shell/renderer/chat/ui/shortcuts.mjs:147-152`: Alt+←/→ steals Option-arrow word jumps.**
`branch-prev`/`branch-next` have no `when`. `focusIsOurs()` is true inside the composer (:80-87) and
`onKeyDown` calls `preventDefault()` (:180). On a Mac, Option+← in the composer or the inline editor
never moves the caret; it flips the last reply's version instead.
Fix: add a `when` that returns false while focus is in an input or textarea that has text, the same way
`edit-last` guards (:127-131).
Test: in chat-unit, with a focused non-empty textarea inside `app.root`, `handle({key:'ArrowLeft',
altKey:true})` must neither call `preventDefault` nor `switchSibling`.

**SA-8 · High · `app/controller.mjs:249-257, 385, 399-423`: Continue wipes the partial answer when it cannot run.**
Continue calls `generate({into: msg, mode:'continue'})` (`app/continue.mjs:148-152`), so `target` is the
existing partial reply (:385). When the farm is busy, has no password or is gone, `localNote()` overwrites
`target.content` with the busy note or `''` and **finalizes it to IndexedDB**. The text the user wanted
to continue is lost.
Fix: when `o.into` is set, leave `content`/`reasoning` alone and put the reason in `error` or a toast only.
Test: `continue.test.mjs` with keyMissing, no-farm and busy worlds; assert `content === PARTIAL` after.

**SA-9 · Medium-High · `ui/settings.mjs:232, 250`: the v1 import and "Remove the old v1 copy" run even when there is no database.**
Boot migrates only when `repo.mode === 'idb'` (`main.mjs:313`). The Settings buttons have no such guard
(`renderV1`, :194).
- In `memory-final` mode (IndexedDB could not open), "Bring over…" imports into RAM, and "Remove…" then
  deletes the `lol.chat.threads.v1` key (`state/migrate-v0.mjs:292-300`). The history is gone at quit.
- In `memory` mode, a slow open replays a duplicate import.

Fix: render and act only when `repo.mode === 'idb'`.
Test: `migrate.test.mjs` with a memory repo; `removeV1Copy` must be false and the storage untouched.

**SA-10 · Medium · `app/seat-wait.mjs:227, 272, 396-404`: a seat-wait resend that ends in a local note never leaves "waiting".**
The resend calls `generate({into: w.msg})`. The `localNote` exits (`controller.mjs:401, 408, 418`) return
without emitting `STREAM_END`, which is the only event that clears `waiting` and releases the governor
hold (:272). The composer then stays held (`controller.mjs:649`) until the user presses Stop.
Fix: `localNote` emits `STREAM_END {status}`, or `resend()`'s `finally` clears `waiting` and the hold when
the message is no longer `waiting`.
Test: `seatwait.test.mjs`: 429, then make the farm busy before the resend; assert `state()` is null and
the governor is idle.

**SA-11 · Medium-Low · `app/context.mjs:203, 315-322`: token calibration mixes units.**
`promptChars(req)` counts text only (`ctx/tokens.mjs:120-129`), but `usage.prompt_tokens` includes the
chat template and role tokens. Short prompts ("hi") pull the persisted `tokRatio:<underlying>` down toward
`MIN_RATIO` 1.5 (`ctx/tokens.mjs:24, 227-234`). Estimates then run up to 2.4× high, which produces false
"Too long for this farm" results and an early cost gate.
Fix: subtract the per-message and template allowance before calibrating, and skip samples under about
1,000 chars.

**SA-12 · Low-Medium · `app/controller.mjs:650`: every finished reply steals focus.**
`generate()`'s `finally` always calls `composer.focus()`. A sidebar rename saves on blur
(`ui/sidebar.mjs:617`), so a rename typed while a reply streams is committed half-typed. Search, the
inline edit and the system-prompt popover lose focus the same way.
Fix: focus only when `document.activeElement` is the body, the composer, Send or Stop.

**SA-13 · Low-Medium · `app/drafts.mjs:59, 80-87`: text typed before a chat opens is wiped.**
With no thread, `schedule()` stores nothing (:59). When `reopenLast()` (`main.mjs:294-303`) then selects
the last chat, a thread with no draft still runs `setText('')` because the composer has text (:85-87).
Fix: skip the restore when the previous selection was null and the composer has text.

**SA-14 · Low: LOL Chat never emits `EV.MESSAGE_PUT`.** Only `graph/parts/to-thread.mjs:154` does, while
`ui/sidebar.mjs:820` listens for it. The sidebar's "cut off" dot and search narrowing go stale after a
Continue or a delete. Fix: emit it from the repo's put, finalize and deleteSubtree paths.

**SA-15 · Low · `app/caps.mjs:62-76, 222` vs `app/ask.mjs:199-217, 265`: vision verdicts are stored and read under different names.**
They are stored under the model-group name (the alias) and read under the underlying checkpoint. On an
aliased farm, an image ask to a text-only model is not refused locally: it costs a seat and a 400. The
callers that send images today are the Computer's parts.
Fix: check both names, as `graph/parts/instruction.mjs` already does.

**SA-16 · Low · `render/dom.mjs:279`, `render/stream-dom.mjs:304`: a Markdown list starting at 0 renders from 1.** The `b.start && …` test treats 0 as absent. Fix: `b.start != null && b.start !== 1`.
*Latent:* `app/branching.mjs:303-322` copies attachments before `createThread`, so an ephemeral fork's
copies land in IndexedDB. LOL Chat has no attachments UI today.


## B. In-app text that is wrong or missing

- **B-1 `shell/renderer/index.html:84` (Preferences › Data location).** "Every chat, document, and vector
  lives here…" is false for LOL Chat. Its history is IndexedDB `lol-chat` in the app's own userData
  (default session, `state/schema.mjs:23-24`), which "Change folder…" neither shows nor moves; LOL Chat's
  own About already says so (`strings/library.en.mjs:59-60`). Replace with:
  `Open WebUI's chats, documents and vectors, and the Computer's projects, live here, on this machine. LOL Chat keeps its own history in the app's local storage on this machine (export it from LOL Chat › Settings). Nothing is stored on the server.`
- **B-2 `shell/renderer/chat/strings/net.en.mjs:31-32`.** Both strings send the user to "Preferences →
  Connection", but that section has no password field (index.html:100-124). The password goes on the farm
  card in the topbar popover (app.js:757-760). Replace with:
  `authBody: 'The farm did not accept the password this client is sending. Click the connection pill in the top bar and enter it again on the farm's card.'`
  `keyMissingBody: 'This farm needs a password. Click the connection pill in the top bar, enter it on the farm's card, then send again.'`
- **B-3 `shell/renderer/app.js:237`.** "Could not check (only available in an installed build)." appears
  whenever `latest` is null, which means GitHub was unreachable or rate-limited (sidecarManager.ts:205).
  That is the normal case on a closed LAN, and a dev build can in fact check. Replace with:
  `Could not reach GitHub to check for a chat-engine update. Check the internet connection and try again.`
  Also have `checkOwuiUpdate` return early when `!app.isPackaged`, like `checkForAppUpdate` does
  (updater.ts:344). A dev click today stages about 700 MB into an unused `userData/sidecar.pending`.
- **B-4 `shell/renderer/index.html:56-59` (popover empty state).** The Farm app is private by default
  (`farm-app/src/main/store.ts:21`), and that is the most common reason a client finds nothing. Replace
  with: `No servers found yet. Make sure a farm is running on this network — in the LlmOnLan Farm app, turn on “Share compute with the network” (or run <code>lol up</code>) — or add one by address below.`
- **B-5 `shell/renderer/app.js:92`.** Before the first download finishes, About shows "vunknown"
  (`bundledOwuiVersion()` returns `'unknown'`, paths.ts:328). Replace the line with:
  `prefs.verOwui.textContent = p.owuiVersion === 'unknown' ? 'not installed yet' : 'v' + p.owuiVersion;`
- **B-6 `chat/strings/net.en.mjs:35` `streamErrorBody`.** It says "What arrived is kept below.", but the
  note is inserted after the body (`render/thread-view.mjs:280`). Replace "kept below" with `kept above`.
- **B-7 `chat/strings/net.en.mjs:33` `contextOverflowBody`.** "…or remove some of what is attached": LOL
  Chat has no attachments. Replace with:
  `The farm ran out of context for this thread. Start a new chat, shorten your message, or stop keeping pinned messages in context.`
- **B-8 `chat/net/errors.mjs:136-137`.** A local throw is classified as `http` with no status, so the row
  reads "The farm answered : …" (`httpBody`, net.en.mjs:38) and blames the farm for this machine's
  failure. Add a `local` kind with the strings
  `localTitle: 'LOL Chat could not send this'` and
  `localBody: 'Something failed on this computer before the farm answered: {message}'`.
- **B-9 `chat/app/transfer-format.mjs:214-215`.** "Import chats…" shares a picker that accepts
  `.lolgraph.json` (`ui/transfer.mjs:279`). A graph file then fails with "unsupported export version:
  undefined". When `doc.lolchat === undefined`, say instead:
  `This is not a LOL Chat export — a .lolgraph.json is a Computer graph; open it from the Computer.`
- **B-10 `chat/strings/library.en.mjs:67`.** "Imported 1 chats": add `importedOne: 'Imported 1 chat'` and
  pick it when n = 1 (`ui/transfer.mjs:365`).
- **B-11 `chat/strings/render.en.mjs:32` `svgAlt` is never applied.** The drawn SVG `<img>` has no alt
  (`render/code.mjs:140`). Add `img.alt = t('render.svgAlt')`.
- **B-12 unreachable strings and a wrong comment.**
  - The `studio.*` workbench strings (`studio.en.mjs:27-39`) can never render: no workbench panel is
    registered.
  - `core.en.mjs:23` says noFarm, noModels, unreachable and passwordRefused are "harness only, never
    shown", but the model picker shows them (`ui/model-picker.mjs:37-40`). Fix the comment.

## C. Technical doc drift

### C.1 CLAUDE.md (in my area; replacement paragraphs for the integrator)

**:17 header.** Stale versions (client v0.1.33, farm-v0.0.20). Replace with:
`## Build status (2026-09-27) — client \`v0.1.45\` (+ lolchat/vnext) · Farm app \`farm-v0.0.38\` · OWUI \`0.10.2\``
(Set the client number at release.)

**:55-56 "Pin facts … run via the `open-webui serve` console script".** A packaged sidecar runs
`<userData>/sidecar/python launcher.py serve` (paths.ts:254-259); only dev uses the venv console script.
The bundle is CPython 3.12 (build-sidecar.mjs:25). Replace with: `**OWUI \`0.10.2\`** (Python 3.11/3.12; the sidecar bundles standalone CPython 3.12 and runs \`python launcher.py serve\` — dev uses \`sidecar/.venv\`'s \`open-webui serve\`).`

**:80-103 the `shell/` bullet.** Replace from "Two surfaces:" to the end of the bullet with:
> **Three surfaces**, picked by the topbar's segmented control (Open WebUI · LOL Chat · Computer; the last
> choice is remembered in `localStorage['lol:view']`): OWUI; **LOL Chat** (`renderer/chat/main.mjs` + modules
> in `app/ core/ ctx/ net/ render/ state/ ui/ strings/ css/`; farm-direct; history in IndexedDB `lol-chat` v2,
> a one-way import reads the v1 `localStorage` history; no RAG, uploads or tools); and the Computer (its own
> section). Whether OWUI ships is `clientMode.ts` `OWUI_ENABLED` + the renderer's `NO_OWUI` (flip both; a
> no-OWUI build hides the Open WebUI button). Perf invariants: the CSP MUST carry `connect-src 'self' http: https:`;
> the whole farm context (endpoint, password, model, SearXNG, TTS, OCR, ctx/slot) is persisted so a cold launch
> spawns the sidecar **once**; follow-up/tags/autocomplete generation stay off. **Boot time:** `repoint`
> restarts only when the effective env differs; fresh trees are precompiled in the background;
> `HF_HUB_OFFLINE=1` is intended once MiniLM + whisper-base are cached (`HF_HUB_ETAG_TIMEOUT=2` until then —
> Whisper actually caches under `DATA_DIR/cache/whisper/models`, SA-2); health polling at 300 ms.
> **Close means close** (owner, 2026-09-04 + 2026-09-10): the X first asks "Quit LlmOnLan?" (Quit/Cancel),
> then quits everything on all platforms; cleanup gets 4 s, then the app exits regardless (index.ts:471-490,
> 1020-1044); "Restart & install" and the chat-engine relaunch skip the prompt. **Tests** (`shell/test/`, see
> `test/chat/README.md`): `npm run test:unit` (app.js capacity helpers); `node test/chat-unit.js` (LOL Chat
> suites); `chat-lint.js`, `chat-scope.js` (static/scope gates); `asar-probe.js`; `node test/chat-harness/run.js`
> (chat-only Electron over CDP against a non-beaconing `mock-farm.js`); legacy `npm test` = `e2e.js` (real app
> over CDP against a beaconing mock — spare box only).

**:108 packaging bullet.** Append:
`Installers: windows-x64, mac-arm64 + mac-x64 (Intel, macOS 14+, darwin-x64 sidecar substitutes onnxruntime 1.23.2), linux-x64 + linux-arm64; one \`owui-sidecar-<platform>-<arch>.tar.gz\` per platform.`

**:163 invariant #4 "(env vars + admin REST API)".** The shipped REST use is OWUI's *user-settings* API
plus two reads (app.js:405, 407, 412, 529), never the admin API. This is an owner decision; suggested
wording: `(env vars + its public REST API)`.

**:171-179 contract table.** Add a row:
`| Webview | The renderer reads the OWUI origin's \`localStorage.token\`, validates it with \`GET /api/v1/auths/\` (drop + reload, ≤4 tries) before revealing the webview, and reads \`/api/config\` before seeding web search; the \`persist:owui\` partition is granted mic/camera/clipboard only. | app.js:374-386, 399-419, 522-561; index.ts:508-520 |`

**:181-199 env list.** Not exact: values are missing, RAG_TOP_K is described wrongly, and the HF_* flags
are absent. Replace with (values from configBridge.ts:78-276):
> **Always:** `DATA_DIR`=<chosen, default `<userData>/owui-data`> · `WEBUI_SECRET_KEY`=<hex generated once into
> `<userData>/.webui-secret-key`> · `WEBUI_AUTH=false` · `ENABLE_PERSISTENT_CONFIG=false` ·
> `ENABLE_VERSION_UPDATE_CHECK=false` · `ENABLE_OLLAMA_API=false` · `RAG_FULL_CONTEXT`=`'true'` if the farm's
> `backend.contextPerSlot` ≥ 24576 or is not advertised, else `'false'` · `RAG_TOP_K=8` (always set; read only in
> retrieval mode) · `ENABLE_LOCAL_WEB_FETCH=true` · `ENABLE_RETRIEVAL_QUERY_GENERATION=false` ·
> `DEFAULT_MODEL_METADATA={"capabilities":{"vision":true}}` (+ `"web_search":true` with a farm SearXNG) ·
> `AUDIO_STT_ENGINE=''` · `WHISPER_MODEL=base` · `AUDIO_TTS_ENGINE=''` · `ENABLE_AUTOCOMPLETE_GENERATION` /
> `ENABLE_FOLLOW_UP_GENERATION` / `ENABLE_TAGS_GENERATION` = `false` · `DEFAULT_LOCALE=en-US` (+ Chromium
> `--lang en-US`, index.ts:35) · `ANONYMIZED_TELEMETRY=false` · `DO_NOT_TRACK=true` · `SCARF_NO_ANALYTICS=true` ·
> `HF_HUB_OFFLINE=1` if the models test as cached, else `HF_HUB_ETAG_TIMEOUT=2`.
> **With a farm:** `ENABLE_OPENAI_API=true` · `OPENAI_API_BASE_URL=http://<host we reached it at>:<proxyPort>/v1` ·
> `OPENAI_API_KEY`=<farm password> or `sk-lol-lan` · `DEFAULT_MODELS`=<farm default id, when listed>.
> **Without:** `ENABLE_OPENAI_API=false`. **SearXNG:** `ENABLE_WEB_SEARCH=true` · `WEB_SEARCH_ENGINE=searxng` ·
> `SEARXNG_QUERY_URL=<url>/search?q=<query>` · `WEB_SEARCH_RESULT_COUNT=3` · `WEB_SEARCH_CONCURRENT_REQUESTS=10`.
> **Kokoro:** `AUDIO_TTS_ENGINE=openai` · `AUDIO_TTS_OPENAI_API_BASE_URL=<ttsUrl>` · `AUDIO_TTS_OPENAI_API_KEY=sk-lol-tts` ·
> `AUDIO_TTS_MODEL=<ttsModel|kokoro>` · `AUDIO_TTS_VOICE=<ttsVoice|af_heart>`. **OCR:** `CONTENT_EXTRACTION_ENGINE=external` ·
> `EXTERNAL_DOCUMENT_LOADER_URL=<extract.url>` · `EXTERNAL_DOCUMENT_LOADER_API_KEY=<extract.key>`. The supervisor
> adds `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8` and otherwise inherits the shell's environment (sidecar.ts:77-84).

**:201-205 Gotcha #1 parenthetical.** It says the admin API's "one shipped use is registering the …
Blender tool server". There are two shipped writes, both through the user-settings API. Replace with:
`(OWUI's admin REST API is deliberately not used — session-only while persistence is off. The two shipped writes both go to the user-settings API \`POST /api/v1/users/user/settings/update\` from the authed webview: the one-time web-search default and the opt-in Blender tool server.)`

**:297-301 Layout / connection screen.** "Looking for your server…" appears only in the no-OWUI build
(app.js:612); "Connected to {farm}" is a toast (app.js:789); "Enter address" does not exist. Replace with:
> A sticky **topbar** (logo · "powered by Open WebUI" · connection pill · surface switch · theme · gear) over
> the OWUI `<webview>`, LOL Chat or the Computer. **The pill** shows the farm and its free seats (`· 2/3 free`);
> amber = connecting, seats full, not responding or password needed; red = a server problem. Clicking it
> opens **Servers on your network**: farm cards with live load, password entry, "Manage this farm ↗"
> (`/lol/admin`), add-by-address, auto-search and Rescan. **The connection overlay** covers OWUI while it
> starts, reconnects, fails (Retry) or downloads the engine on first run (app.js:567-679).

**:303-305 main-process.** Replace `(\`electron-store\` or a JSON in \`userData\`)` with
`(a hand-rolled \`userData/shell-settings.json\`, store.ts)`. After "the only module that knows OWUI's
config surface", add: `(env; the renderer's app.js holds the few REST touches above)`.

**:311-321 Preferences.** Replace the Connection, Startup and About items with:
> - **Connection**: "Auto-search the subnet", "Rescan now", the **Search range** (`a.b . c–d . e–f`),
>   "Add by address" plus chips. The farm list and the choice of farm live in the topbar popover, not here.
> - **Startup & updates**: "Launch at login"; "Install app updates automatically"; "Check for app
>   updates" → "Restart & install update"; a close-means-close note. There is no update channel.
> - **About**: the app and Open WebUI versions, "Check for chat-engine update" (a staged sidecar update,
>   applied on relaunch), and "powered by Open WebUI".

**:323-325.** After "per‑chat model choice lives in Open WebUI's own picker", add: `(and LOL Chat's own picker)`.

**:342-346 Discovery, client side + fallbacks.** No baked-in address exists and the selection rules are
missing. Replace with:
> **Client side** (`discovery.ts`, `index.ts` `chooseActive`): beacons on `239.255.43.10:41998` + broadcast; a
> unicast `/lol/self` sweep of the **search range** (default: the first non-internal IPv4's subnet; every 60 s,
> 48 parallel, 1.5 s timeout, ≤4096 hosts); manual `host[:httpPort]` peers (default 41997, kept even when
> stale). The active farm is re-polled every 2 s; stale after 12 s, dropped after 120 s. Choice: the pinned
> farm → the current one (sticky) → last session's endpoint → the least-loaded healthy farm (coordinators
> first; load = clients/slots, else GPU%; ties within 15 points picked at random). A password-protected farm
> qualifies only with a verified stored password (re-checked ≤1/min). `LOL_ENDPOINT` pins an endpoint (dev);
> `LOL_FED_GROUP/PORT/HTTP_PORT` override the group and ports.

**:375-377 dots and theme icon.** There is no "accent" dot, and the icon shows the **current** mode,
exactly as ComfyQ does (styles.css:52-56, 71-74; `e:\ComfyQ\desktop\renderer\styles.css:86-89`). Replace
with: `Status dots: green = ready, amber = waiting (connecting, seats full, not responding, password needed), red = error, grey = idle. The theme toggle shows the current mode's icon (moon in dark, sun in light), as ComfyQ does.`

**:388-391 release flow.** `release:*` runs `scripts/release.mjs`, which calls `npm version` itself
(release.mjs:39). It refuses to run if there are any tracked changes (:33) and pushes `origin main` (:54).
Replace with:
`\`npm run release:patch|minor|major\` → \`scripts/release.mjs\`: refuses off \`main\` or with any tracked change, runs \`npm version <type> --no-git-tag-version\`, commits only \`package.json\`/lock, makes annotated tag \`vX.Y.Z\`, pushes \`origin main --follow-tags\`.`

**:395-418 the yml block.** Missing lines:
- `directories.buildResources: assets` (yml:21);
- `nsis.allowToChangeInstallationDirectory: false` (:45);
- `mac.category` (:53) and `linux.category: Network` (:80);
- the three `artifactName` lines, which give the asset names users download (:50, :71, :82):
  `${productName}-Setup-${version}-windows-x64.${ext}`, `${productName}-${version}-mac-${arch}.${ext}` and
  `${productName}-${version}-linux-${arch}.${ext}`.

Paste the real file.

**:420-425 CI.** The matrix now has five legs (release.yml:57-74). Replace the matrix clause with:
`matrix \`windows-latest\`, \`macos-latest\` (arm64 + cross-packaged x64 installers), \`ubuntu-latest\` (linux-x64), \`ubuntu-24.04-arm\` (linux-arm64), \`macos-15-intel\` (\`sidecarOnly\`: the darwin-x64 sidecar), \`max-parallel: 1\`; Node 22, Python 3.12; \`npm run build\` before \`electron-builder --publish never\``.

**:439-449 repo layout, `shell/` rows.** Replace with:
```
    src/main/            #   index (boot/IPC/selection), sidecar, sidecarManager, configBridge, discovery,
                         #   store, paths, util, types, dataMigration, updater, mcpoSupervisor,
                         #   clientMode.ts; projects/projectsPath/debugLog = the Computer's
    renderer/            #   index.html + app.js (topbar, webview host, prefs); tokens.css (ComfyQ palette);
                         #   chat/ (LOL Chat: main.mjs + modules; chat/computer, graph, sandbox = the Computer)
    test/                #   unit.js, chat-unit.js (+chat/unit), chat-lint.js, chat-scope.js, asar-probe.js,
                         #   chat-harness/ (chat-only Electron over CDP), mock-farm.js (+mock/), e2e.js (legacy)
```

**:477 "On the device".** Add:
`LOL Chat's history lives in the app's own IndexedDB (userData), not under DATA_DIR; the Computer's projects live in DATA_DIR/LOL Studio Projects (index.ts:552).`

### C.2 Other technical docs

- **README.md:54** status line. Change the client and farm numbers to match C.1 (the farm-engine prose at
  :27-30 and :56-60 belongs to the farm reviewer; it still says llama.cpp is the default).
  **:23 and :61-62** "topbar toggle to LOL Chat". Replace with: `a topbar switch between Open WebUI, **LOL Chat** (a Studio-style chat straight to the farm) and the **Computer**`.
- **shell/README.md:7-13.** "two surfaces", `renderer/chat.js`, "keeps its conversations in
  `localStorage`". Replace with: `The main area has **three surfaces**, switched in the topbar: **Open WebUI** (RAG, documents, web search, voice), **LOL Chat** (\`renderer/chat/\`, entry \`chat/main.mjs\`) — straight to the farm's OpenAI endpoint, tok/s + TTFT per reply, a message tree, seat-aware sending, a context meter; no RAG, uploads or tools; history in IndexedDB \`lol-chat\` — and the **Computer** (\`renderer/chat/computer/\`).`
  - **:37-39.** Use the C.1 layout rows.
  - **:61-62.** "`RAG_FULL_CONTEXT=true`". Replace with: `**Adaptive document answers** — \`RAG_FULL_CONTEXT=true\` when the farm's per-slot context ≥ 24576 (or unknown), else top-k retrieval with \`RAG_TOP_K=8\`; plus \`ENABLE_LOCAL_WEB_FETCH=true\` and \`ENABLE_RETRIEVAL_QUERY_GENERATION=false\`.`
  - **:94-95.** Add `lastFarmCtxPerSlot` and `lastFarmKey` to the persisted list (types.ts:169-177).
  - **:144.** The mock beacons only with `LOL_MOCK_BEACON_OK=1` (mock-farm.js:17, mock/index.js:160).
    Replace with: `LOL_MOCK_BEACON_OK=1 node test/mock-farm.js --coordinator   # 1. beacon + endpoint — only on a box with no LlmOnLan client running`.
  - **:137-164.** Add the test entry points listed in C.1.
- **docs/GETTING_STARTED.md:181-183** (installers). The names and "Intel not supported" are stale
  (electron-builder.yml:50, 71, 82; build-sidecar.mjs:97-125). Replace with:
  `- **Windows** — \`LlmOnLan-Setup-<version>-windows-x64.exe\` (SmartScreen: More info → Run anyway).`
  `- **macOS** — \`LlmOnLan-<version>-mac-arm64.dmg\` (Apple Silicon) or \`…-mac-x64.dmg\` (Intel, macOS 14+). First launch: right-click → Open → Open.`
  `- **Linux** — \`LlmOnLan-<version>-linux-x64.AppImage\` (or \`-linux-arm64\`, e.g. DGX Spark) → \`chmod +x\`; Ubuntu/Mint may need \`libfuse2\`.`
  - **:205-207.** "(`assistant` by default — the Farm app's Settings ▸ Model name …)". The default is the
    Ollama `gemma4:12b`, and the name is set in the farm panel (farm/src/admin/index.html:265, 414).
    Replace with: `shown under the name the operator gives it in the farm panel (the model id, e.g. \`gemma4:12b\`, unless renamed)`.
  - **:208-210.** Replace with: `**Three surfaces** — the topbar switch picks **Open WebUI** (documents, RAG, web search, voice, history), **LOL Chat** (a fast chat straight to the farm; no documents) or the **Computer**; the app remembers your last choice.`
  - **:213.** "answers use the **whole document**". Replace with: `on farms with a large context window (≥ 24k tokens per chat) answers read the whole document; on smaller ones, the 8 most relevant passages`.
  - **:216.** "`localStorage`". Replace with: `its own local database (IndexedDB in the app's user-data folder — not the Data location folder; export from LOL Chat › Settings)`.
  - **:401-403.** Add as the first bullet: `**Farm app?** It is private until the operator turns on Settings ▸ **Share compute with the network**.`
    Extend "Different subnets" with: `…or set Settings ▸ Connection ▸ **Search range** to cover the farm's subnet (unicast crosses subnets that block broadcast).`
- **docs/INTEGRATION_BRIEF.md** (a dated snapshot; add NOTEs, not rewrites):
  - **:101/:246.** The client never uses `OFFLINE_MODE`. It sets `HF_HUB_OFFLINE` itself, and MiniLM stays
    in the default HF cache, not DATA_DIR (configBridge.ts:195-212). Note SA-2.
  - **:249** "(it likely doesn't)" touch AV devices. It does: the webview is granted mic and camera
    (index.ts:508-520), voice is a headline feature, and the locked electron-builder is 26.15.3 (≥ 26.0.13).
    Turn this into a rig check (next bullet).
  - **:23** "Build/run against 3.11". The bundle uses 3.12 (build-sidecar.mjs:25).
- **docs/RIG_CHECKLIST.md:53-65.** "mac **arm64 only**", the sidecar list, and "Intel Mac: NOT
  SUPPORTED" are all stale. Replace with:
  `NSIS (win x64), dmg+zip (mac arm64 + x64), AppImage (linux x64 + arm64); sidecars darwin-arm64, darwin-x64 (onnxruntime 1.23.2 substitution), win32-x64, linux-x64, linux-arm64`,
  plus an unchecked item: `[ ] Intel Mac (macOS 14+): first run downloads the darwin-x64 sidecar; local embeddings + a chat work`.
  - **:120** "the popover shows 'N clients'". Replace with: `the farm card shows seats ("N of M seats free", plus "K connected" when that differs)` (app.js:353-366).
  - Add: `[ ] macOS ad-hoc build: OWUI voice (mic) and camera prompt and work`, and `[ ] Pin a farm, relaunch: one sidecar spawn, no 401` (SA-4).
- **docs/LOLCHAT_TESTING.md**
  - **:54 and :165-167.** "once it is pushed" / "Nothing is committed". The branch is committed and
    pushed (39 commits over main). Replace §6's first paragraph with: `The work is committed on \`lolchat/vnext\` and pushed to \`origin/lolchat/vnext\`.`
  - **:59.** Replace with: `Press **LOL Chat** in the topbar's three-way switch.`
  - **:85-86.** "the **Computer** tab in the workbench column … `Ctrl+\` cycles panels". No workbench panel
    is registered anywhere; the Computer is a top-level surface (computer/host.mjs:7; workbench.mjs:380-386).
    Replace with: `Open the **Computer** from the topbar's three-way switch.`
- **docs/LOLCHAT_PLAN.md:4251.** The heading says "version 1", but `DB_VERSION = 2` (schema.mjs:24, adding
  `graphs` and `projects`). Replace with: `### 3.7 IndexedDB: database \`lol-chat\`, version 2 (v2 = \`graphs\` + \`projects\`, S0)`.
  - **:4262-4268 kv list.** Missing `ui:workWidth`, `ui:workPanel`, `pref:queueMax` and the Computer's
    keys. Point to `core/types.mjs:803` `KV_KEYS` as the authoritative list instead of copying it.
  - **:4222-4234 §3.6.3 transforms.** Nine rows; three are registered (`app/context.mjs:169`,
    `app/controller.mjs:113`, `ui/thread-header.mjs:28`). Mark rows 100/300/350/380/400/500 `NOT BUILT (P3/P4)`.
  - **P3/P4 phase headings.** Add `NOT BUILT`: there are no `attach/`, `blender/`, `recipes/` or `voice/`
    modules, and `net/extract.mjs` serves only the Computer.
  - **:5857.** "ticks §0–§11". The RIG checklist now runs to §17, and §5 (images/documents/search), §6
    (Blender) and §9 (recipes) test unbuilt features. Replace with: `ticks §0–§4, §7, §8, §10–§17`.
- **docs/LOLCHAT_VISION.md**
  - Add under B.2: `Shipped (2026-09): P0–P2 + S0; P3/P4 (F50–F52, F70, F72–F74, F80, F90–F91) not built.`
  - **:99 F41.** "another recipe / temperature". Shipped are only "More creative" (1.0) and "More precise"
    (0.2) (`ui/message-actions.mjs:98-103`).
  - **:160 F105.** Now shipped (not an out-of-scope change): the view memory as `localStorage['lol:view']` (app.js:908-915), with a three-way switch, and the other surfaces are usable while OWUI boots (styles.css:339-340).
- **docs/LOLCHAT_RIG_CHECKLIST.md**
  - **:92.** The wrong key `lolchat.threads.v1`; the code uses `lol.chat.threads.v1` (`state/migrate-v0.mjs:29`).
    A tester following it corrupts nothing and so tests nothing.
  - **§5, §6, §9 and :358-359 (read aloud).** These features are not shipped. Mark the items
    `NOT SHIPPED` rather than failing them.
  - **§12 (:399-462).** No workbench panel is registered anywhere, so the rail and width items are
    untestable. The §12.1 queue chip is untestable because nothing calls `app.ask.queue`.
  - **:54-55.** Say "the three-way switch" and note that the last surface is remembered.
- **Code-comment drift** (not user-facing; fix while there):
  - clientMode.ts:8 and app.js:842 still point at `renderer/chat.js` (already logged as D-M9 in LOLCHAT_DISCUSS).
  - mcpoSupervisor.ts:4 says "config-bridge injects TOOL_SERVER_CONNECTIONS", which configBridge.ts:278-283 contradicts.
  - e2e.js:1 says "E2E for the no-OWUI shell".

## D. Undocumented features (shipped and reachable)

| Feature | Code | In-app | Tech docs |
|---|---|---|---|
| Quit confirmation on the window X; 4 s forced exit | index.ts:471-490, 1025-1035 | the dialog only | none (CLAUDE.md says "quits EVERYTHING") |
| Surface choice remembered across launches | app.js:908-915 | — | none |
| Farm pinning by card click or password entry; no way to unpin | app.js:778, 789; index.ts:287 | toast "Connecting to…" | none (see SA-5) |
| Pill states: free seats, amber when full, "not responding", "problem on the server", the admin busy label | app.js:267-310 | yes | none |
| Farm card: seats, engine and model, plugins, "recommends", "Manage this farm ↗" (/lol/admin) | app.js:726-753 | yes | none |
| "Check for chat-engine update" (a staged OWUI swap on relaunch) | sidecarManager.ts:202-224; index.html:166 | yes | sidecar/README only |
| Auth-bootstrap gate over OWUI's token (an OWUI coupling) | app.js:374-386, 522-561 | spinner "Finishing sign-in…" | none (C.1 row added) |
| Webview mic/camera/clipboard grants | index.ts:500-520 | OS prompt | none |
| LOL Chat shortcuts: Esc stop/cancel wait, ↑ edit last, Alt+←/→ versions, Mod+Shift+O new chat, Ctrl+Enter saves an edit | ui/shortcuts.mjs:108-166; edit-inline.mjs:111 | none (labels are registered but never rendered: shortcuts.mjs:175 is the only reader) | VISION/PLAN/RIG only |
| LOL Chat settings: Storage (usage, export all, import, remove v1 copy), Context gate threshold, "Tell me when a long reply is done", About | ui/settings.mjs:74-253; app/context.mjs:460; ui/notify.mjs:107 | yes | only the cost gate (TESTING:76) |
| Export `.md` / `.lolchat.json`, export all, import `.json`/`.lolchat.json`/`.lolgraph.json` (≤512 MB, new ids), clipboard fallback | ui/transfer.mjs:198-279; app/transfer-format.mjs:15-32 | yes | VISION/RIG only |
| Per-chat system prompt; "Delete from here"; reopen the last chat on launch | strings/tree.en.mjs:22, 41-47; main.mjs:283-304 | yes | PLAN only |
| Dev env vars `LOL_SMOKE_CLICK/POPOVER/RESIZE/WAIT/TIMEOUT`, `LOL_RELEASE_REPO`, `LOL_MCP_PYTHON`, `LOL_FED_*` | index.ts:868-912; sidecarManager.ts:23; paths.ts:289; discovery.ts:16-18 | — | shell/README lists only `LOL_SMOKE_SHOT` |
| Dead: workbench `Ctrl+\`, `Ctrl+1..4` and `studio.en.mjs:31-39` (no panel is ever registered) | ui/workbench.mjs:380-386, 622-640 | — | TESTING:85-86 still describes them |

## E. Checked and consistent

- `tokens.css` = the CLAUDE.md palette byte for byte · `FULL_CONTEXT_MIN_CTX = 24576`, unknown → full (configBridge.ts:69, 77) · CSP `connect-src 'self' http: https:` (index.html:9-10; harness page identical) · `OWUI_ENABLED`/`NO_OWUI` flipped together (clientMode.ts:17, app.js:9).
- Close means close on all platforms (index.ts:1038-1044); login item re-registered without `--hidden` (:926-933) · Preferences = the five documented sections in order (index.html:81-173) · Assistant tools toggle / two-hop "Test connection" / port 9876 (index.html:126-141; index.ts:651-664).
- Heartbeat every 10 s with id/name/platform/version/idleSec (index.ts:171-193) · one-time web-search seed via `lolWebSearchSeeded` (app.js:399-419) · Blender via `ui.toolServers` + `ui.tools` with index renumbering (app.js:434-505) · persisted cold-boot context (index.ts:969-990) · env-diff `repoint`, 300 ms health poll, background precompile (sidecar.ts:108, 141-154; sidecarManager.ts:151-162).
- Toolchain matches CLAUDE.md (electron 42.5.1, electron-builder 26.15.3, electron-updater 6.8.9 as a runtime dep, Node ≥ 20) · yml appId/productName/files (no sidecar)/afterPack/publish `releaseType: release`/NSIS oneClick+perMachine:false/mac identity:null+hardenedRuntime:false/dmg+zip · `afterPack.cjs` ad-hoc codesign, darwin only · release.yml pre-create + `--publish never` + `gh release upload --clobber`, `contents: write`, `max-parallel: 1`.
- Release guard `main` only (release.mjs:31) — **heads-up:** it also refuses today's dirty tracked files (:33) · sidecar downloaded per platform from `v<app>` else latest (sidecarManager.ts:185-200); About reads `OPENWEBUI_VERSION` 0.10.2 (paths.ts:321-329) · discovery `239.255.43.10:41998` + HTTP 41997, distinct from ComfyQ (discovery.ts:16-18) · farm password verified before storing, a rotated one dropped within ≤60 s (index.ts:228-246, 702-727).
- LOL Chat: chat-lint + chat-unit green; v1 import non-destructive (migrate-v0.mjs:7-8, 300); seat wait gives up at 15 min / goes manual after 5 attempts (seat-wait.mjs:33, 37); e2e.js selectors all exist; ephemeral chats are memory-only (state/repo.mjs:73, 139).
