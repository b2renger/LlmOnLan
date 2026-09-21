# LOL Chat vNext: out-of-scope changes to discuss

> Status: **discussion list** for the owner. Date: 2026-09-14 (revision 2, after the critic review of the plan).
>
> The brief limits this work to the LOL Chat feature. Every item below is something we would like to
> change **outside** that scope. None of them is being built.
>
> - Scope rules: [LOLCHAT_PLAN.md](LOLCHAT_PLAN.md) §1.1.
> - Product rationale: [LOLCHAT_VISION.md](LOLCHAT_VISION.md) §C.
>
> **Reading an item:**
> - The **id** is `D-<area><n>`. Areas: **S** scope/docs, **C** client main/preload/renderer outside
>   chat, **X** CSP/security, **F** farm, **P** packaging/CI, **O** Open WebUI interplay,
>   **M** test infrastructure, **L** live verification.
> - **Effort:** S ≤ 1 day · M 2–4 days · L 1–2 weeks.
> - **Blocking?** Whether the LOL Chat release is blocked without the item. Today no item is blocking;
>   every one has an in-scope fallback, listed in the item.

---

## Summary

| Id | Change | Area | Effort | Blocking? | Our recommendation |
|---|---|---|---|---|---|
| D-S1 | Rewrite LOL Chat's role in CLAUDE.md (resolve the "reimplementing chat, RAG" tension) | docs | S | No, but should precede release | **Do** |
| D-S2 | Blender code-execution policy sign-off | policy | S | No (the conservative policy ships) | **Do** |
| D-C1 | Instant-start: open on LOL Chat while OWUI boots, remember last view | app.js / main | S–M | No | **Do next** |
| D-C2 | LOL Chat history under `DATA_DIR` (or an export/move API) | main + preload | M | No | **Decide** |
| D-C3 | Event-driven `publishFarm` + key for the fallback bridge branch | app.js | S | No | **Do** |
| D-C4 | Main-process `will-navigate` guard + default-session permission handler | main | S | No | **Do** |
| D-C5 | Save-file API in preload (if `<a download>` misbehaves in the packaged app) | main + preload | S | Depends on D-L1 | Only if needed |
| D-C6 | Screen-region capture ("snip into chat") | main | S–M | No | Later |
| D-C7 | Notification click should focus the window from main (+ AppUserModelID in dev runs) | main | S | No | Do |
| D-C8 | Open `mailto:` links from the main window-open handler (today only http(s)) | main | S | No | Decide |
| D-X1 | CSP decision: `media-src`/`img-src blob:`, `worker-src`, `'wasm-unsafe-eval'` | CSP | S (decision) | No | **Decide** |
| D-X2 | Worker/iframe CSP loophole: bless or close explicitly | CSP / main | S | No | **Decide** with D-X1 |
| D-F1 | Seat release endpoint / seats keyed by client id | farm | M | No | **Do** |
| D-F2 | `busy`/`queued`/`perf` for the Ollama engine | farm | M | No | Do |
| D-F3 | OCR should take a seat; stop broadcasting `extract.key` in cleartext | farm | M | No | **Do** (security) |
| D-F4 | Correct `supports_vision` / `supports_function_calling` flags | farm | S | No | Do |
| D-F5 | Trustworthy `contextPerSlot` (live farm advertises 1,048,576) | farm / ops | S | No | **Do** |
| D-F6 | CORS headers on seat-gate 429/502 | farm | S | No | Do (cheap) |
| D-F7 | OCR progress (pages done) for long documents | farm | S–M | No | Later |
| D-F8 | Farm-side page-fetch proxy for search on a closed LAN | farm | M | No | Later |
| D-F9 | Logprobs pass-through for `ollama_chat` | farm | M | No | Drop unless a feature needs it |
| D-F10 | Farm STT endpoint (dictation) | farm | M–L | No | Later |
| D-F11 | Update the live farm build to repo HEAD | ops | S | No | **Do** (quiet moment) |
| D-P1 | `npm` scripts + CI job for chat unit tests and the harness | package.json / .github | S | No | **Do** |
| D-P2 | Vendoring budget (pdf.js, Temml, grammars, onnxruntime, whisper) | packaging | decision | No | Decide per feature |
| D-P3 | Installer smoke test that LOL Chat loads (static imports verified in asar; dynamic `import()` re-probed at P0 kickoff) | CI | S | No | **Do** |
| D-O1 | "Continue in Open WebUI" handoff via OWUI's public import format | OWUI interplay | M | No | Later |
| D-O2 | OWUI and LOL Chat share one seat on the same laptop | OWUI + farm | — | No | Explain; fixed by D-F1 |
| D-O3 | Presence ping should know whether LOL Chat is in use | main | S | No | Later |
| D-M1 | Mock farm default `httpPort` 41997 → 41987 (affects e2e.js assumptions) | test infra | S | No | **Accept** (in scope, flagged) |
| D-M2 | Full `e2e.js` cannot run on the dev box; add a CI runner | CI | S | No | **Do** with D-P1 |
| D-M3 | Test hooks in product code (`window.__lolChatTestFlags`, `window.LolChat`, the loader's fakes) | renderer | — | No | **Accept** |
| D-M4 | Mock beacon gated by `LOL_MOCK_BEACON_OK=1`; legacy `e2e.js` flow only in CI / spare machines | test infra | S | No | **Accept** (in scope, flagged) |
| D-U1 | Sidebar month headings are the platform's (French) while the fixed ones are English | chat UI | S | No | Live with it until P4 i18n |
| D-U2 | "Bring over 1 remaining chats first" is not plural-safe | chat UI | S | No | **Reword** |
| D-U3 | The seat-wait row's Try now / Cancel are hover-revealed like every other message action | chat UI | S | No | **Settled at the P2 fix round: always visible on waiting + error rows** |
| D-U4 | `continueMode` is remembered under the model that wrote the partial | chat | S | No | Accept |
| D-U5 | A non-seat-gate 429 is retried up to 5 times, one per farm tick | chat / farm | S | No | Accept; watch on the rig |
| D-U6 | "Export all chats" now SKIPS ephemeral chats (the toast says how many) | chat UI | S | No | **Done** at the P2 fix round; confirm the wording |
| D-V1 | `controller.preview()` re-reads the whole thread path on every keystroke (needs a repo revision to cache on) | chat | S | No | **Do in P3** (the two cheap halves already landed) |
| D-L1 | Live verification session on a quiet farm (C-21 items) | ops | S | No | **Do** before release |

### D-U6: "Export all chats" leaves ephemeral chats out of the file
- **What:** `repo.listThreads()` merges the ephemeral backend, so the bulk export button wrote the
  temporary chats to disk — and `parseImport` forces `ephemeral:false`, so re-importing that file
  turned a "vanishes on quit" chat into a permanent one. Neither was told to the reader.
- **Done (P2 fix round):** `collectExportAll()` filters `th.ephemeral` out and returns how many it
  skipped; the toast reads "Exported {name} — N temporary chat(s) left out". The per-thread … menu
  still exports one, because that is an explicit choice about a named conversation.
- **Ask:** confirm the wording, and whether a bulk export should instead offer a checkbox
  ("include temporary chats") rather than always skipping them.

---

## S: Scope and policy

### D-S1: Rewrite LOL Chat's role in `CLAUDE.md`
- **The tension:**
  - `CLAUDE.md` lists "reimplementing chat, RAG, or model management" as out of scope.
  - The deleted `chat.js` header called LOL Chat a deletable A/B surface with "no RAG, no document
    upload, no tools".
  - The owner has now asked for an ambitious LOL Chat, and this release adds document upload (via farm
    OCR), images, web search, recipes and a human-approved Blender runner.
- **What we held back:**
  - no vector index, no embeddings, no retrieval (documents are injected whole or page-picked);
  - no autonomous tool loop;
  - no copy of OWUI's admin/library surfaces.
- **Proposed text** (replacing the out-of-scope bullet and the LOL Chat paragraph): *"LOL Chat is the
  farm-native, instant, studio-facing workbench beside Open WebUI: local IndexedDB history, farm-aware
  sending (seats, context budget), attachments via the sanctioned farm OCR, user-invoked SearXNG,
  recipes, and human-approved Blender execution. It deliberately has no RAG index, no embeddings, and no
  autonomous tools; Open WebUI remains the library (knowledge bases, OWUI tools, community features)."*
- **Where the plan records it:** [LOLCHAT_PLAN.md](LOLCHAT_PLAN.md) §0.1 states the tension first, so
  builders see it before anything else, and forbids "fixing" it by editing `CLAUDE.md`.
- **Also update in CLAUDE.md:**
  - the Data-flow section: LOL Chat history location (see D-C2);
  - the repo layout: `renderer/chat/`;
  - test harness mention: `shell/test/chat-harness/`.
- **Effort:** S. **Touches:** `CLAUDE.md`.

### D-S2: Blender code-execution policy sign-off
- **What ships:**
  - code runs only after an explicit Run click on an editable copy;
  - an always-visible neutral line ("Review the code before running it…") on every Run card;
  - a taint banner when the thread contains outside content (web search, documents, files, imported
    threads, scene info, imported non-built-in recipes);
  - no "always allow";
  - no automatic re-run after "Ask the model to fix".
- **Owner decisions needed:**
  1. Is the taint banner enough, or should Run be **disabled** in tainted threads?
  2. Should a future tool loop (vision F92) ever auto-call read-only Blender tools?
  3. Confirm that internet-facing BlenderMCP tools (PolyHaven, Hyper3D, Sketchfab) are never offered
     from LOL Chat. They break "no internet at runtime" and send data to third parties.
- **Possible follow-up:** filter those tools in `shell/src/main/mcpoSupervisor.ts` for OWUI too.
- **Effort:** S (policy), S–M if main-side filtering is wanted.

---

## C: Client outside the chat module

### D-C1: Instant-start handoff
- **Why:**
  - Since "close means close", every launch pays OWUI's ~10 s Python boot.
  - LOL Chat needs no sidecar and is usable as soon as the window exists and a farm is known.
- **Proposal:**
  - (a) remember the last view (OWUI vs LOL Chat) across launches;
  - (b) optionally open on LOL Chat while OWUI boots, with a subtle "Open WebUI ready" chip.
- **Touches:** `renderer/app.js` toggle logic (not additive), possibly `shell-settings.json` via main.
- **Interacts with:** the OWUI overlay logic (`renderSidecar`), and `NO_OWUI` builds.
- **Effort:** S for (a), M for (b).

### D-C2: Where LOL Chat history lives
- **Today** (unchanged by this release): LOL Chat data lives in the default Electron session under
  `%APPDATA%\LlmOnLan\` (IndexedDB `lol-chat`, plus the old v1 `Local Storage` key).
- **Not** in the user-chosen `DATA_DIR`. So:
  - the Preferences data-folder move and "start fresh" do not carry or clear LOL Chat history;
  - backups of `DATA_DIR` miss it;
  - all `file://` pages of the app share that storage origin.
- **Options:**
  1. **Keep it, document it.** The Settings → Storage panel already says where the data is and offers
     Export all / Import. Effort 0.
  2. **Export/import hooks in the data-folder move:** main asks the renderer for an export bundle
     before the move and writes it into `DATA_DIR/lolchat/`; the renderer re-imports on first run after
     the move. Effort M (main + preload + renderer).
  3. **Separate session partition rooted under `DATA_DIR`:** load the main window's chat storage from a
     partition whose path is inside `DATA_DIR`. This needs the main window to use a custom session and a
     relaunch on move. Effort M–L, with a migration from the default session.
- **Recommendation:** option 1 now, option 2 when the data-folder flow is next touched.
- **Related facts to record on the rig (checklist §1):** the Windows NSIS per-user uninstall normally keeps
  `%APPDATA%\LlmOnLan`, so history should survive a reinstall; a rollback to v0.1.45 keeps writing the v1
  localStorage key, which vNext merges by `(legacyId, legacyHash)` without deleting anything.
- **Prime directive #3:** already satisfied (data stays on the machine); this item is about the spirit
  ("the data folder is where your data lives").

### D-C3: `publishFarm` robustness
- **Why:**
  - In the OWUI build, `publishFarm` runs only on a 4 s interval and on toggle, so farm switches
    reach LOL Chat up to 4 s late.
  - The fallback branch (sidecar endpoint without a matching discovered farm, e.g. a `LOL_ENDPOINT` pin
    to a keyed farm) publishes no `apiKey`, so every chat request fails on a password farm.
- **Proposal:**
  - call `publishFarm()` from `onFarms` in both builds;
  - include `lastFarmKey` (or the key for the pinned endpoint) in the fallback branch.
- **Effort:** S. **Touches:** `renderer/app.js` (non-additive).

### D-C4: Main-process guards
- **Why:**
  - No `will-navigate` guard exists. A drop outside our `preventDefault` handler, or a future bug, could
    navigate the whole window to a file or URL. LOL Chat ships a document-level drop guard as a
    mitigation.
  - The default session has **no** permission request handler, so microphone, notifications,
    clipboard-read and others are implicitly granted. LOL Chat relies on notifications and clipboard
    write (both fine) but does not want an implicit mic grant.
- **Proposal:**
  - `win.webContents.on('will-navigate', e => e.preventDefault())` except for the app's own file URL;
  - a default-session `setPermissionRequestHandler` allowing `notifications` and `clipboard-sanitized-write`,
    denying the rest (mic only when dictation, D-F10, ever ships).
- **Warning (cross-reference):** LOL Chat's completion notifications (`Notification`) and Copy buttons
  (`navigator.clipboard.writeText`) currently work **because** the default session grants everything. A
  plain deny-by-default handler would silently break both. Any handler must allow at least
  `notifications` and `clipboard-sanitized-write` (and ideally be checked with `setPermissionCheckHandler`
  too, since `Notification.permission` and `permissions.query` go through the check path). Verify with the
  chat harness scenarios `p2-notify` and `p1-markdown` (Copy) after the change.
- **Effort:** S. **Touches:** `shell/src/main/index.ts`.

### D-C5: Save-file API
- **Why:** export uses `<a download>` on an object URL (falling back to a `data:` URL, then the
  clipboard). Electron with no `will-download` handler normally shows a save dialog. That is UNVERIFIED in
  the packaged app (D-L1).
- **Observed at the P2 landing (2026-09-15, Electron 42.5.1, Windows, the harness' `file://` page):**
  step 1 — the object-URL `<a download>` — IS the real path: `will-download` fired, a 3,032-byte
  `lol-chat-2026-09-15.lolchat.json` was written to the harness download directory with state
  `completed`, read back in Node and re-imported (`p2-export-import`). So on this platform the chain
  never reaches the `data:` or clipboard fallbacks, and those two branches are covered by **no test**
  (`flags.downloadMode` forces them, but nothing exercises them). What the PACKAGED app does — a save
  dialog, a silent write to Downloads, or nothing — is still open (D-L1 item 6).
- **Proposal:** if it misbehaves, add `window.lol.saveFile({suggestedName, bytes})` → `dialog.showSaveDialog`
  + `fs.writeFile`.
- **Effort:** S. **Touches:** main + preload.

### D-C6: Screen-region capture into chat
- **Why:** artists paste screenshots constantly; a "Snip" button in the attach menu would skip the OS
  tool.
- **Needs:** `session.setDisplayMediaRequestHandler` in main plus a crop UI.
- **Effort:** S–M. Later.

### D-C7: Notification click focus (Windows)
- **Why:**
  - On Windows a toast needs an AppUserModelID. The NSIS install sets one; unpacked/dev runs show no toast
    at all.
  - From a notification `onclick`, a renderer `window.focus()` often only flashes the taskbar button
    instead of bringing the window forward (Windows foreground-lock rules).
- **Proposal:**
  - a preload API `window.lol.focusWindow()` → main `win.show(); win.focus()` (plus `app.focus({steal:true})`
    on macOS), used by LOL Chat's notification click;
  - `app.setAppUserModelId('com.llmonlan.client')` early in main so dev runs behave like the installed app.
- **Effort:** S. **Touches:** `shell/src/main/index.ts`, `shell/src/preload/index.ts`.
- **In-scope fallback today:** best-effort `window.focus()` plus selecting the thread; the rig checklist
  records what actually happens.

### D-C8: `mailto:` links
- **Why:** the main window-open handler (`shell/src/main/index.ts:426`) forwards only `http(s)` URLs to
  `shell.openExternal`; every other URL is denied. A `mailto:` anchor in a reply would be a dead link, so
  LOL Chat renders `mailto:` as plain text.
- **Proposal:** allow `mailto:` in the handler (it opens the user's mail client, no network from the app).
- **Effort:** S. **Touches:** `shell/src/main/index.ts`. Then one line in `render/dom.mjs` (in scope).

---

## X: CSP and security posture

### D-X1: CSP additions (the `index.html` meta is off-limits to us)

| Directive | Unlocks | Current workaround |
|---|---|---|
| `media-src 'self' data: blob:` | `<audio>` for TTS playback, video previews | WebAudio `decodeAudioData` (works) |
| `img-src blob:` | cheap previews from Blobs without base64 | `data:` URLs (works, costs memory) |
| `worker-src 'self' blob:` | inline workers | file-based workers (work) |
| `'wasm-unsafe-eval'` | local pdf.js alternatives, local embeddings, whisper, tokenizers, sandboxed interpreters | farm OCR; no local STT; heuristic token estimator |

- **Recommendation:** decide together with D-P2 (vendoring). Nothing in this release needs any of them.
- **Effort:** S (decision + one-line change). **Risk:** WASM widens what an injection could run.

### D-X2: Worker and iframe CSP loophole
- **Finding (scout):** workers loaded from `file://` and our own iframes do not inherit the page CSP, so
  WASM/eval would run there.
- **This release does not use it** (enforced by `chat-lint.js`).
- **Decision:** bless it deliberately (and document it), or close it by setting CSP on those contexts
  from main (e.g. `session.webRequest.onHeadersReceived` cannot touch `file://`; a custom protocol for
  the renderer would be required).
- **Effort:** S (decision), M–L to close (custom protocol).

---

## F: Farm (explicitly excluded by the brief; listed for later)

### D-F1: Seat release and per-client seats
- **Why:**
  - A seat frees only after `seatIdleSec` (900 s) of idleness.
  - Seats are keyed by IP, so LOL Chat and this laptop's OWUI share one seat, and a colleague who is done
    still blocks a seat for 15 minutes.
  - LOL Chat's seat-wait works, but people wait longer than necessary.
- **Proposal:**
  - `POST /lol/seat/release` (authenticated like completions), called by the client on quit, on "I'm
    done", or after a thread goes idle;
  - and/or seats keyed by the presence-ping client id (header `x-lol-client`) instead of IP.
- **Effort:** M. **Touches:** `farm/src/seats.js`, `shell/src/main` ping, renderer.
- **P1 fix round 2 note:** deleting a chat mid-stream now aborts the request, so the socket closes and
  `seats.js` sees the client walk away — but that is still the only way LOL Chat can give a seat back
  early. Everything in this item stands.

### D-F2: Load signals for the Ollama engine
- **Why:** `busy`, `queued` and `perf` are null on the default engine. The strip, cost-gate seconds and
  the governor fall back to weaker signals (seats only, a local EMA).
- **Proposal:** derive `perf.lastPromptTokSec`/`genTokSec` from Ollama response timings in the gate, and
  `queued` from the gate's in-flight count.
- **Effort:** M. **Touches:** `farm/src/up.js`, `snapshot.js`, `seats.js`.

### D-F3: OCR seat accounting and key exposure
- **Why:**
  - Farm OCR calls Ollama directly, so a 300-page PDF uses the GPU while the seat gate reports the farm
    as free.
  - `extract.key` is broadcast in cleartext in the UDP beacon, so anyone on the LAN can use the extractor.
- **Proposal:**
  - route OCR through the seat gate (or count it as busy);
  - serve `extract.key` only via authenticated `/lol/self` (farm password) instead of the beacon.
- **Effort:** M. **Touches:** `farm/src/pysvc`, `snapshot.js`, `beacon.js`, shell main `farmExtract`.

### D-F4: Capability flags
- **Why:** LiteLLM `/model_group/info` reports `supports_vision:false` and `supports_function_calling:false`
  for models whose names don't match the farm's regex (e.g. nemotron, granite). LOL Chat treats `false`
  as *unknown* and learns from errors instead.
- **Proposal:** read real capabilities (Ollama `/api/show` → `capabilities`; llama.cpp `mmproj`
  presence) when generating the LiteLLM config.
- **Effort:** S. **Touches:** `farm/src/litellm.js`.

### D-F5: Trustworthy `contextPerSlot`
- **Why:** the live farm advertises 1,048,576 tokens per slot. LOL Chat clamps the budget to 262,144 and
  labels it "advertised". A wrong advertisement makes the context meter and trimming optimistic.
- **Proposal:** advertise the measured/verified window only; mark unverified values
  (`contextVerified:false`).
- **Effort:** S. **Touches:** `farm/src/snapshot.js`, `up.js` (and D-F11 to deploy).

### D-F6: CORS on seat-gate responses
- **Why:** the 429/502 bodies from `seats.js` carry no `Access-Control-Allow-Origin`. Harmless for
  Electron `file://` (CORS isn't enforced there), but any future web or non-Electron client would lose
  the readable message.
- **Effort:** S. **Touches:** `farm/src/seats.js`.

### D-F7: OCR progress
- **Why:** a single `PUT /process` gives no progress. LOL Chat shows an indeterminate "reading…" chip for
  minutes on big PDFs.
- **Proposal:** a job id plus `GET /process/<id>` progress, or a streamed NDJSON response.
- **Effort:** S–M. **Touches:** `farm/src/pysvc`.

### D-F8: Page-fetch proxy for search
- **Why:** on a closed LAN, fetching result pages from the client mostly fails. A farm proxy next to
  SearXNG could fetch and clean pages and centralise the SSRF guard.
- **Conflict:** CLAUDE.md's data-flow statement says result pages are fetched directly by the client;
  that would change.
- **Effort:** M. Later (vision F81 is BUILD LATER anyway).

### D-F9: Logprobs for `ollama_chat`
- **Why:** LiteLLM drops logprobs on the default engine, so confidence and alternative-token UIs are
  impossible there.
- **Recommendation:** drop unless a concrete feature needs it.
- **Effort:** M (possibly upstream LiteLLM).

### D-F10: Dictation
- **Why:** hands-free use while sculpting. The browser speech engine is cloud-only (forbidden).
- **Options:**
  - a farm STT endpoint (whisper on the GPU box, sanctioned like OCR);
  - in-renderer whisper, which needs D-X1 `'wasm-unsafe-eval'` plus 80–150 MB of vendored weights (D-P2).
- **Effort:** M–L.

### D-F11: Update the live farm build
- **Why:** the live farm lacks `capacity.seatIdleSec` and still advertises the 1 M context. LOL Chat must
  distrust fields it could trust.
- **Effort:** S. Needs a quiet moment on AN-A6000PRO (it serves real users).

---

## P: Packaging and CI

### D-P1: Test scripts and CI
- **Proposal:**
  - add `"test:chat": "node test/chat-unit.js && node test/chat-lint.js"` and
    `"test:chat-harness": "node test/chat-harness/run.js"` to `shell/package.json`;
  - add a CI job (Windows + Ubuntu with `xvfb-run`) running them plus `e2e.js` before `release.yml`
    publishes.
- **Effort:** S. **Touches:** `shell/package.json`, `.github/workflows/`.

### D-P2: Vendoring budget
- **Why:** everything under `renderer/**` ships inside every installer. Candidate libraries:

| Library | Size | Unlocks | Licence |
|---|---|---|---|
| Temml | ~250 kB | TeX math → MathML | MIT |
| pdf.js | ~3 MB | local PDF text (no OCR round trip) | Apache-2.0 |
| Extra highlighter grammars | ~100 kB | more languages | MIT |
| onnxruntime-web + MiniLM | ~35 MB + WASM | local embeddings / retrieval | MIT / Apache-2.0 |
| whisper (tiny/base) | 80–150 MB + WASM | local dictation | MIT |
| mermaid | ~3 MB | diagrams | MIT (DROPPED in vision) |

- **Decision needed:** installer growth tolerance, and whether large assets should be farm-served instead.
- **Effort:** decision.

### D-P3: Packaged-app smoke test
- **Status (revision 2):**
  - ES modules and CSS `@import` were verified from plain `file://` (planner probe).
  - **Static `.mjs` imports from inside an `app.asar`** were verified by the critic's probe.
  - The plan's loader uses **dynamic `import()`**; its behaviour inside asar is re-probed at the P0
    kickoff. If it fails, the loader switches to generated static imports (plan §3.1). The result goes
    here and in DEVLOG.
  - **RESULT (P0 landing, re-run 2026-09-15, Electron 42.5.1, Windows):** PASS. An `@electron/asar`-packed
    `app.asar` loaded with `loadFile()`, under the byte-identical renderer CSP: the classic `<script>`
    ran first, the `<script type="module">` with static `.mjs` imports loaded, **`import(m.path)` from a
    table resolved inside the asar** (the module's export was called), a missing path rejected with
    `Failed to fetch dynamically imported module: file:///…/app.asar/sub/nope.mjs` (exactly the loader's
    failure path), and CSS `@import` from a `<link>`ed stylesheet applied (`--probe-token` + the computed
    outline). **No static-import fallback is needed**; plan §3.1 stands as written. The probe still does
    not prove the SHIPPING installer: the packaged smoke test below and the rig item stay open.
  - Also found: `loadFile()` into an asar **with a query string** fails with `ERR_FAILED`. Product code
    must never rely on query params (the harness uses them, but it is not packed).
- **Proposal:** a CI step that launches the packaged app with a temp userData and checks
  `window.LolChat.ready`.
- **Fallback if it fails:** rename modules to `.js` (still ES modules via `type="module"`).
- **Effort:** S. **Touches:** `.github/workflows/`. Also listed on the rig checklist.

---

## O: Open WebUI interplay

### D-O1: "Continue in Open WebUI"
- **Why:** a LOL Chat thread that grows into a knowledge-base task should move to OWUI without
  copy-paste.
- **Constraint:** only through OWUI's **public** chat import (an exported JSON the user imports via OWUI's
  UI or `POST /api/v1/chats/import` from the authed webview). No DB access (invariants #1, #4).
- **Risk:** OWUI's import format changes across versions, which makes this a coupling point that
  contradicts invariant #5 unless it is kept user-driven (export a file the user imports by hand).
- **Effort:** M.

### D-O2: Shared seat on one laptop
- **Fact:** OWUI (including its title generation) and LOL Chat on the same laptop share one per-IP seat
  and compete for engine slots.
- **LOL Chat already avoids background generations.** The real fix is D-F1.
- **Nothing to build now;** the rig checklist §3 observes the effect.

### D-O3: Presence knows LOL Chat usage
- **Why:** the 10 s presence ping reports `idleSec` for the whole app. With LOL Chat active and OWUI idle,
  the farm's connected-clients view is still accurate, but it cannot tell which surface people prefer
  (useful for the original A/B question).
- **Proposal:** add `surface:'owui'|'lolchat'` to the ping.
- **Effort:** S. **Touches:** main + preload (the renderer would report the visible surface).

---

## M: Test infrastructure notes

### D-M1: Mock farm default `httpPort`
- **Change:** the mock snapshot's `httpPort` default moves from 41997 (the **live** farm's admin port on
  the dev box) to 41987.
- **Why:** a client that selected the mock was sending heartbeats and "Manage" clicks to the real farm.
- **Impact:** `e2e.js` does not assert on `httpPort`, so nothing breaks. This is in scope
  (`shell/test/**`) but flagged because it changes a default others may rely on.

### D-M2: `e2e.js` cannot run on the dev box
- **Why:** the single-instance lock, the owner's real `DATA_DIR`, and shared default-session storage
  would expose the owner's real LOL Chat history to the test.
- **Mitigation:** the chat harness (`p1-basic-stream`) mirrors e2e's chat assertions.
- **Proposal:** run `e2e.js` in CI (D-P1) and on the rig (checklist §0).

### D-M3: Test hooks in product code
- **Hooks:**
  - `window.__lolChatTestFlags` (read once at load; e.g. `forceMemoryStore`, `seatJitterMs`,
    `notifyAfterMs`);
  - `window.LolChat` (ready flag + debug accessors such as `paintStats`).
- **Why they exist:** they let the harness make deterministic assertions without timers of real
  length.
- **Risk:** they are inert unless something sets the flags before load. Nothing in the shipped app
  does.
- **Recommendation:** accept.

### D-M4: Mock beacon gate and the legacy `e2e.js` flow
- **Change:** `shell/test/mock-farm.js` creates its UDP beacon only when `LOL_MOCK_BEACON_OK=1` is set
  (and `--no-beacon` is absent).
- **Why:** the legacy mock beacons to `127.0.0.1:41998` as a **coordinator**. On a machine running the
  real client, that client listens there, prefers coordinators, and could switch to "Mock Farm" and
  restart its Open WebUI. The dev box runs the owner's real client.
- **Impact:** the documented `e2e.js` flow now needs `LOL_MOCK_BEACON_OK=1 node test/mock-farm.js --coordinator`,
  and must only run where no LlmOnLan client runs (CI, spare machine). `e2e.js` itself is unchanged; its
  header comment still shows the old command, which is updated only if the owner wants (a comment-only
  edit of a file the plan keeps byte-identical).
- **Effort:** S (in scope). Flagged because it changes a documented developer command.

### D-M5: A hidden harness window cannot be screenshotted — **SUPERSEDED by D-M8 (P1 landing)**
- **Finding (P0-U2, confirmed at the P0 landing):** `Page.captureScreenshot` never resolves in a
  `show:false` BrowserWindow on Electron 42.5.1 — a hidden window produces no compositor frames.
- **Mitigation (in scope, already landed):** `h.screenshot()` gives up after 6 s and returns `null`
  with a note; every landing takes its light/dark screenshots with `--show`, and `run.js` writes them
  to `chat-harness/generated/shots/` so they survive teardown.
- **Consequence for CI (D-P1):** a headless CI runner can run every scenario, but it cannot produce
  review screenshots — visual review stays a human step at each landing.

### D-M6: Anything LOL Chat renders outside `#lolchat` must carry `.chat-layer`
- **Finding (P0 review round):** every rule in `chat/css/base.css` was scoped under `#lolchat`. P1-U4's
  `createDialogs(app) -> {confirm, prompt, popover, toast}` normally mounts its layer on `document.body`
  precisely to escape the `overflow-y:auto` clipping of `.chat-messages` / `.chat-threads` — and there it
  would have inherited none of the shared primitives: unstyled native buttons, no focus ring, no
  `.visually-hidden`. Invisible in P0, because P0 renders nothing outside `#lolchat`.
- **Decision (taken at the review round, already landed):** the shared primitives — `.btn-accent`,
  `.btn-ghost`, `.chat-icon`, `.visually-hidden`, `.hidden`, `:focus-visible`, `box-sizing`, the
  reduced-motion block — are published under **`.chat-layer`** as well as `#lolchat`. The layout rules
  stay `#lolchat`-only. A node that has to live outside `#lolchat` puts `.chat-layer` on its root and
  positions itself `fixed`.
- **For the P1 kickoff:** `css/dialogs.css` is written against that rule, and `createDialogs` stamps
  `.chat-layer` on the body-level root it creates. If P1-U4 instead decides to mount inside `#lolchat`,
  say so at the kickoff — the `.chat-layer` selectors then cost nothing and can stay.

---

### D-M7: §3.8 now has FIVE documented refinements, not three (P0 fix round 2)

The plan's §3.8 lists three refinements that keep the restricted grammar a deterministic function of
one line (hr/table-delimiter candidacy capped at `HR_LIMIT`, the fence info string capped at
`INFO_MAX`, `===` never a setext underline). The fix round added two more, for the same reason and in
the same shape — **an uncapped run counter was the one thing that could make the streaming parser
super-linear**, and a model repetition loop produces exactly those runs:

4. **A run of more than `HR_LIMIT` (256) fence characters is paragraph text, never a fence** — opener
   and closer both (`md-block.mjs`). Measured before: `'`'.repeat(20000)` cost **2,502× the line** in
   scanned characters with a worst per-feed overhead of 20,002 (the budget allows 2,100); after:
   **1.45×**, worst 259, the same numbers `'-'` already had.
5. **A run of more than `TICK_MAX` (32) backticks never opens a code span** — it is literal text,
   consumed whole (`md-inline.mjs`). CommonMark agrees (a code-span opener is a MAXIMAL backtick run),
   and without it every position inside a run re-entered the opener logic.

P1's markdown work codes against these; they are frozen with the rest of the parser.

Two API facts that came out of the same round and that P1-U3 should use:

- `createInlineStream()` now exposes **`debug.scanned`** (characters handed to `tokenize`, summed over
  feeds) — the inline twin of the block parser's counter, so the render gate can bound inline work too.
- `emit()` inside `md-inline.mjs` carries a **`settled`** flag and an unsettled node calls `block()`.
  This is what makes the commit point sound: a node whose extent can still change (a bare autolink that
  has not met whitespace, a span whose closer a later backtick could steal via a code span, a citation
  that could still grow a `(`) must not freeze a boundary the full parse does not have. Two real
  divergences were found by an adversarial differential fuzz and are now pinned by
  `md.test.mjs: adversarial inline fuzz`.

**One bound that is still only wall-clock.** A pure backtick run cannot advance `safeEnd` at all (the
run itself may still grow, and committing inside it would let the tail re-read a short run as a span),
so `'`'.repeat(N)` stays O(N²) in character comparisons — measured **21 ms for 4,000 characters at
1-char chunks** (it was 9,273 ms for 3,000 before the fix). `mdwork.test.mjs` bounds it with a 2 s wall
clock and says why `debug.scanned` cannot see it. If a farm ever produces a 100k-character backtick
run this becomes visible again; the fix would be a commit point that leaves more than `TICK_MAX`
characters of the run behind it.

---

### D-M8: The hidden harness window paints after all — D-M5 is closed (P1 landing)

- **Finding (P1 landing):** the root cause behind D-M5 was never "screenshots"; it was that a
  `show:false` BrowserWindow has no frame **consumer**, so Chromium produces no compositor frames for
  it. The same cause drove `requestAnimationFrame` down to ~1 Hz — which made `h0-raf-runs` fail 3
  cold runs out of 4 (§2.6 T had called that intermittent) and made P1-U3 conclude that the perf group
  could only run under `--show`.
- **Fix (in scope, landed):** `run.js` opens a CDP screencast (`Page.startScreencast`, 64x64 jpeg
  q10) right after attaching and acks every frame. The window then runs at **61-62 rAF/s** and
  `Page.captureScreenshot` resolves normally. Command-line switches
  (`--disable-renderer-backgrounding`, `--disable-backgrounding-occluded-windows`,
  `--disable-background-timer-throttling`) and `Page.setWebLifecycleState{active}` were all tried
  first and made no difference.
- **Consequences:** the light/dark landing screenshots no longer need `--show` (the P1 landing's
  `p1-shots-{dark,light}` DEMAND a real PNG without it); the phase gate stays
  `--strict --phase perf`, with no `--show`; and **a headless CI runner CAN produce review
  screenshots** — which reverses D-M5's last bullet and is worth knowing for D-P1. A human still has
  to LOOK at them: both bugs found at this landing (§2.6 W) were visible in the image and invisible
  to every assertion, until the assertions were written afterwards from what the image showed.

### D-M9: Two stale `renderer/chat.js` comments outside the LOL Chat scope (P1 landing)

- **Finding:** `shell/renderer/chat.js` is deleted, but two comments still point at it:
  `shell/src/main/clientMode.ts:8` (and its build output `shell/build/main/clientMode.js:9`) —
  "the topbar-toggle alternative view (see renderer/chat.js)" — and `shell/renderer/app.js:843` —
  "re-derived in chat.js so there is exactly one source of truth for 'which farm'".
- **Why it was not fixed here:** `src/main/*` is outside §1.1's allowlist, and `chat-scope.js`
  deliberately allows `app.js` to change only inside the `window.__lolFarm` literal of
  `publishFarm()`. Both are stale comments, not behaviour.
- **Ask:** fold them into whatever P2+ unit next has a legitimate reason to touch those files, or let
  the owner take them in a one-line housekeeping commit. `clientMode.ts` should say
  "renderer/chat/", and `app.js` should say "re-derived by `chat/net/farm.mjs`".

### D-M10: Three §2.6 contract amendments from the P1 fix round (decided, need writing into the plan)

All three are already implemented and tested; they are listed here because §2.6 is the frozen contract
sheet other phases code against, and it lives in the plan, not in the code.

1. **`EV.THREAD_SELECTED` gains an optional `created` flag.** `controller.newThread()` emits
   `{threadId, created: true}`; `selectThread()` still emits `{threadId}`. It exists so the model
   picker can tell "the thread this send just created" from "a thread the reader clicked" — applying a
   held pick to the latter wrote `modelSource:'user'` onto stored history (a blocker-grade silent
   write, fixed). Additive: every existing listener reads `p.threadId` and is unaffected.
2. **`sidebar.render()` takes an optional `{rescan}`.** `render()` used to cursor the whole message
   store on every call (~12 µs/record; three calls per send). The whole-store scan now runs on a store
   **mode change** and when a caller asks for it; `main.mjs` asks once, after `repo.recoverInterrupted()`
   (§3.1 step 12), which is the only moment records change behind the sidebar's back. Callers that pass
   nothing keep working and simply cost nothing.
3. **`RequestDraft.meta.budget` is the token COUNT** (`FarmCaps.budget.tokens`), not the
   `{tokens, advertised, source}` object. `draftFromPath`'s JSDoc always said `number|null`; the
   controller was passing the object. P2-U2 (`planTrim`, `gateVerdict`) and the §3.9 meter all want the
   number, and the meter can read `source` off `app.farm.get().budget`. Pinned by a controller unit
   test so P2-U2 cannot code against the other shape by accident.

- **Ask:** fold 1–3 into §2.6 (and the §3.4 signature of `sidebar.render`) at the P2 kickoff.

### D-M11: `p1-persist` had pinned "a blank boot" as intended behaviour

The scenario asserted `'a fresh boot selects nothing on its own'`, which turned a missing feature —
nothing ever read or wrote §3.7's `ui:lastThreadId`, and no unit owned it — into a passing gate. v0.1.45
opened the newest chat at every launch, and since v0.1.45's "close means close" a relaunch is the
every-day experience, so P1's "parity, no regression" bar makes the blank boot a regression, not a
choice. `main.mjs` now restores `ui:lastThreadId` (falling back to the newest thread) and the assertion
is flipped.

- **Ask (owner):** if a blank boot IS wanted as a product choice, say so and the empty state should then
  offer the last chat **by name** rather than saying nothing. Until then, parity stands.

---

## U: LOL Chat wording and behaviour (raised at the P2 landing)

Small product questions the P2 units surfaced. None blocks anything; each ships with a defensible
default today, and the owner's answer would change a line or two.

### D-U1: One sidebar, two languages on a non-English machine
- **What:** the fixed group headings are English strings (`strings/library.en.mjs`: Pinned, Today,
  Yesterday, Previous 7 days), while a month bucket comes from `toLocaleDateString` — the platform's
  own month names. On this (French) box the sidebar reads "Previous 30 days" above "janvier 2026".
- **Why it is like that:** a month name is data, not a UI string, and hard-coding twelve English
  months would be worse for every non-English user.
- **Ask:** live with the mixture until P4's i18n pass (recommended), or force
  `toLocaleDateString('en')` so the sidebar is consistently English until the whole UI is localised.

### D-U2: "Bring over 1 remaining chats first"
- **What:** the v1-removal button's sentence is the plan's own phrasing and is not plural-safe.
- **Ask:** approve a reworded string ("1 chat" / "N chats", or "Bring the rest over first" with the
  count in the detail line). Trivial to change; it is a string, not a behaviour.

### D-U3: The waiting row's two buttons are hover-revealed — SETTLED (P2 fix round)
- **What:** **Try now** and **Cancel** on a seat-wait row are `MESSAGE_ACTIONS` items (§2.6 AG), so
  they lived in the row's action foot and appeared on hover like Copy or Regenerate.
- **Tension:** every other action row is an optional extra; this one is the only way to act on a row
  whose whole purpose is a decision. A reader who never hovers saw no buttons — and the phase's own
  screenshots showed a bordered paragraph saying the farm is full, with no affordance at all.
- **Settled:** the convention is kept everywhere EXCEPT the two states where the actions *are* the
  message. `css/thread.css` now pins `opacity: 1` on `.chat-actions` for `data-status='waiting'` and
  `data-status='error'`, gives the waiting row's buttons a real button skin (`--text` on
  `--surface-2` with a border), and the note's left edge breathes on a 1.8 s pulse (dropped under
  `prefers-reduced-motion`) so a fifteen-minute wait does not read as a dead thread. Asserted by
  `p2-seat-wait-deleted` (computed opacity is `'1'` without hovering) and re-shot in
  `p2-shots-waiting.png`.

### D-U4: `continueMode` is filed under the model that WROTE the partial
- **What:** the continue-discovery verdict is remembered as `continueMode:<underlying>` where
  `underlying` comes from the message being continued, falling back to its `model` id. If a reader
  switches model in the picker and only then presses Continue, the verdict is filed under the model
  that wrote the partial, not the one that answered the continuation.
- **Why it is like that:** resolving the model the way `controller.generate()` does would duplicate
  controller logic inside a feature.
- **Cost of being wrong:** one extra request, once, for that model pair. **Ask:** accept
  (recommended), or add a `controller.resolveModel(opts)` helper at P3 that both paths call.

### D-U5: A farm that answers 429 while advertising a free seat
- **What:** the seat wait re-sends when the snapshot says a seat is free. A farm whose 429 is NOT the
  seat gate (a rate limiter, a stale snapshot) therefore gets retried up to `MAX_ATTEMPTS` (5), one
  attempt per farm tick (~4 s in the app), before the row asks the reader to press Try now.
- **Why it is like that:** it is §4 P2-U1's decision table, bounded by the attempts cap — five
  requests over ~20 s is not a retry storm.
- **Ask:** nothing to change unless the live farm shows a 429 the client cannot tell from the seat
  gate. On the rig list.

---

## V: Deferred performance work (raised at the P2 fix round 2)

### D-V1: `controller.preview()` re-reads the whole path on every keystroke
- **What:** while the reader types, `app/context.mjs` schedules a preview every 250 ms, and each
  preview is `repo.getThread()` + `repo.getPath()` — a full read of every message in the thread —
  plus the whole REQUEST_TRANSFORMS chain and a token estimate per message. Nothing caches the path
  between previews even though it only changes when a message is written. At the sidebar's own
  measured ~12 µs/record this scales with thread length on exactly the laptops the client targets.
- **What the fix round DID do:** the two cheap halves. `'perf'` left `BUDGET_FIELDS`, so a stranger's
  generation finishing on a shared farm no longer triggers a preview at all; and the 500 ms draft
  write became `repo.updateThread(..., {silent: true})`, so typing no longer re-renders the sidebar
  and the thread header twice a second.
- **Why the rest was left:** caching the path needs a write counter (or a per-thread revision) the
  controller can key on — `repo` would have to expose it and `controller.preview()` would have to
  honour it. That is a §3.4 contract change, and a fix round running under a landing gate is the
  wrong place to invent one. No §3.8 invariant is broken today and the perf gate does not exercise
  typing, so this is a scaling risk, not a present regression.
- **Ask:** P3 owner decision — add `repo.revision(threadId)` (or an `EV.MESSAGE_PUT` counter the
  controller already sees) and cache `{threadId, revision} → path` inside `preview()`, rebuilding
  only the draft pseudo-message between keystrokes. **Effort:** S. **Recommendation: do it in P3**,
  where attachments make the path heavier still.

---

## L: Live verification (manual, needs real seats on a quiet farm)

### D-L1: Live checklist (vision C-21)

Each item ships with a fallback. The answers decide the defaults. They are mirrored as **(C-21)** items
in [LOLCHAT_RIG_CHECKLIST.md](LOLCHAT_RIG_CHECKLIST.md).

1. Does a trailing assistant message get continued (prefill) on Ollama gemma4 and on llama-server?
   Fallback: the "continue" user turn.
2. `think:false` / `reasoning_effort` / `chat_template_kwargs.enable_thinking` pass-through, for a future
   thinking toggle (vision F55, BUILD LATER).
3. `response_format: json_schema` on llama.cpp through LiteLLM. Fallback: the schema in the system prompt
   plus tolerant parsing.
4. Real mid-stream error format from LiteLLM → the renderer (an SSE error chunk vs. a socket reset).
5. `decodeAudioData` on Kokoro MP3 bytes. Fallback: WAV.
6. `<a download>` behaviour in the packaged app (D-C5).
7. The real mcpo `get_viewport_screenshot` response shape.
8. `.mjs` modules load from inside `app.asar` (D-P3): static imports verified by probe; the dynamic loader
   is re-probed at P0 kickoff and confirmed on the packaged app. The probe is committed as
   `node shell/test/asar-probe.js` (P0 review round), so only the REAL-installer half is still open.
9. `response_format: json_schema` on **Ollama gemma4 with thinking** through LiteLLM `ollama_chat` →
   `format`: clean content, JSON only in reasoning, or empty? Fallback: parse the reasoning, then
   "Retry without strict format" (prompt mode remembered per model).
10. Windows toast behaviour: installed vs unpacked build, and whether a notification click brings the window
    forward (D-C7).
11. Seat wait while the window is minimised: no send until restored.

**Effort:** S (one session with the owner, about 1–1.5 hours on a quiet farm).
