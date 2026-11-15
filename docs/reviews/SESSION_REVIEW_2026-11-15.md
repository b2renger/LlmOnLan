# Session review of 2026-11-15 (night n° 5)

*The fifth session's adversarial review (the skill `lol-review`), the first of its kind: no earlier `SESSION_REVIEW_*`.
Scope: the 65 commits not yet released (`origin/main..main`, sessions n° 1 to n° 4), with the area taken in depth
being **what a student meets on Tuesday** (n° 4's objective for tonight): LOL Vibe, its page Preview and a
proof-of-concept web application, the Computer's Tour and lesson 1, Open WebUI 0.13.3, the class sheets, and the UX/UI
audit of every surface. The next review takes the farm in depth (rotation: farm → client shell and Open WebUI's contract
→ LOL Vibe and the IDE → the Computer → the Farm app and releases).*

**How it ran:** a dev client from this checkout (`electron .`, Electron 42.5.1, a fresh profile in the session's scratch
folder, Open WebUI **0.13.3** from a scratch venv through `LOL_SIDECAR_CMD`, CDP on 9341) on the **live farm** (vLLM
0.33.0, Qwen3.6 35B-A3B NVFP4, 48 seats, the owner's laptop connected and idle), driven like a student: real clicks,
drags and keys on the Computer; the live farm panel read only, through a headless Edge on a scratch profile (no button
pressed). Two read-only explorers compared the guides and the lessons with the code; each of their claims used below was
checked again by hand. Screenshots: [shots-2026-11-15/](shots-2026-11-15/) (only those that show no network address).

**Suites at the start (02:00):** farm `node test/run.js` 288 passed; farm-app `npm test` 11 + 3; shell `npm run test:chat`
1969 passed, 1 skipped, lint 0 violations.

## Findings, by severity

Each finding: where · what is wrong · the proof · the fix, and **when**: *before the freeze* (small, sure, for night n° 6
before the releases) or *after* (a plan line).

### High

**H1 · Fixed tonight · `shell/src/main/index.ts:571-578` (and its copy `shell/test/chat-harness/main.cjs:329-334`) ·
The sandbox could not start whenever the app's folder came with a lowercase drive letter.**
The frame veto lets a subframe load only when its URL is exactly `RUNNER_URL`, built with
`pathToFileURL(app.getAppPath())`. `pathToFileURL` keeps the case it is given (`c:\…` → `file:///c:/…`); Chromium names
the same frame `file:///C:/…`. So a client started from a folder spelt `c:\…` refuses its own runner: every Preview, every
Computer code box and every chat page says *The sandbox could not start* / *did not answer while starting up*.
*Proof:* the same dev client, profile and code, started with the app path `C:\…\shell`: a sandboxed frame on
`runner.html` loads in 39 ms; started with `c:\…\shell`: no `load` in 2.5 s, CDP shows `Network.loadingFailed
net::ERR_ABORTED canceled: true` (the veto's `preventDefault`), while a `srcdoc` frame loads in 34 ms. `pathToFileURL`
of `c:\Users\x\runner.html` is `file:///c:/Users/x/runner.html` (Node 26).
*Fix (tonight):* `util.ts sameFileUrl` compares file URLs without regard to case on Windows (query and hash aside); the
veto and its harness copy use it. *Check:* `shell-main` unit test *the sandbox runner is the app's own file whatever the
case of the drive letter* (85/85); the dev client started from `c:\…` after the fix: the runner loads in 41 ms and the
class sheet's page runs (`s37-fixed-both.png`).
*What it explains:* the harness's sandbox failures recorded as "order-dependent" on 2026-11-12, 11-13 (k11) and 11-14
(Electron 45's `--phase c` 57/73). **Proven for the harness:** `node c:/…/shell/test/chat-harness/run.js --slot 1 --only
c3-sandbox-isolation` with the committed `main.cjs`: *the sandbox booted: got false* (3.2 s); with the fixed one: passes
(252 ms). Whether a run failed depended on how the command spelt the folder, not on the order of scenarios (tonight's
first full run failed from its first sandbox scenario on). **The full harness with the fix: 415 passed, 0 failed**
(`node test/chat-harness/run.js`, 02:28–02:44), against the k family's 174–175 of 217 on 2026-11-12 to 14. The installed app's path comes
from its shortcut: the owner's installed client, started by its updater (`--updated`), runs as
`C:\Users\…\AppData\Local\Programs\llmonlan-shell\LlmOnLan.exe` (`Win32_Process`, read only), so installed clients
probably never met it: **not proven for the installed app**. *Trust boundary (TRUST-7):* comparing without regard to case
widens nothing: Chromium percent-encodes non-ASCII in the URL, so only ASCII letters can differ, and on Windows they name
the same file; `c3-sandbox-navigate` passes. plans ▸ Next 14 (Electron 45) should be measured again with the fix before its cause is sought further.

**H2 · Fixed tonight · `shell/renderer/chat/sandbox/runner.html:709` · A chat answer's web page is not laid out as
written: the class sheet's own example draws its button at the left edge.**
The runner puts the page's markup into its `#root` with `innerHTML`, which drops `<html>` and `<body>`; the page's own
`body { display: flex; align-items: center; … }` then applies to the runner's body, whose only child is `#root`
(`width: 100%`), so the page's elements stay at the left. *Proof:* the class sheet's prompt ("a small website: a page with
a button that changes the background colour", Qwen3.6, 1769 tokens at 226 tok/s): title centred, badge and button
against the left edge (`s08-vibe-preview.png`); `#root` computed `display: block; width: 778px`; setting
`display: contents` on it in the live guest centred everything (as the model wrote). *Fix (tonight):* in `page` mode
only, `#root` gets `display: contents` (reset for any other run), so p5, three.js and the Computer are untouched.
*Check:* harness scenario `c3-sandbox-page-layout` (a 100 px button in a 600 px page whose body centres it must sit at
x≈250); the real app: `s37-fixed-both.png`. *Known limit:* `display: contents` fixes layout, not selectors: a page rule
`body > main` still misses, since `main`'s parent is `#root`. A real document per page is the full fix, after the class
(plans ▸ Next 15).

**H3 · Before the freeze (n° 6, owner's action) · the class Wi-Fi's Sparks · A laptop that never had LlmOnLan picked a
Spark with 2 seats, not the PRO 6000.**
`farmSelect.ts pickLeastLoaded`: load is clients/slots, farms within `LOAD_BAND` 15 points are "equally free" and one is
picked at random. An empty Spark (0/2 = 0) and the PRO 6000 with one laptop (1/48 = 2) tie, so about half the students'
first picks land on a Spark, until it holds one person (50). The owner's answer of 2026-11-14 ("I will gate them with a
password") would skip them (a password farm without a stored key is never picked); at 02:00 on Sunday both Sparks
(`spark-2cb5`, `spark-59f9`) were open. *Proof:* the fresh dev client's farm button read `spark-2cb5 Farm · 2/2 free`
(`s02-connected.png`); `/lol/self` of both Sparks `requiresKey: false`. *Fix:* BEFORE_TUESDAY **4b** (written tonight):
set the Sparks' passwords **before** test 5 (a laptop keeps the farm it last used). The rule itself (prefer the farm with
the most free seats) stays the after-the-class plan of n° 3's question 5.

**H4 · Fixed tonight · `farm-app/src/main/index.ts:289`, `installer.ts refreshFarmCodeIfUpdated` · After an
update, the Farm app waits for pip before the farm starts, and the window invites a Start meanwhile.**
Since 9038485 the start awaits `pip install litellm[proxy]==1.106.9 …` (600 s cap). Meanwhile the supervisor's state is
`idle`: the overlay says *Starting the farm…* with no spinner, the top button says **Start** and is enabled
(`renderer/app.js` `renderFarmState`, `transient()` false for idle). A Start then runs `startFarm` beside pip, on the venv
pip is rewriting. Offline, `farmCodeVersion` stays unset, so this repeats at **every** launch until pip succeeds.
*Proof:* the same pip command against an unreachable index: 20 s (connection refused, 5 retries), **98 s** (a network that
drops packets); online it took 26 s on the PRO 6000 (n° 4). This is J18's path on Monday. *Fix (tonight):*
`FarmSupervisor.announce(message)` sets `starting` with its message, only from rest (`idle`, `stopped`, `error`, no
child), and `start()` clears it; `refreshFarmCodeIfUpdated` calls it only past its version check, so an ordinary launch
never shows it; pip `--retries 1 --timeout 10`: offline 5 s (refused) and 20 s (dropped). Also L7 (the two literal line
breaks) in the same file. *Check:* `farm-app` `npm test` 12 + 3 (the new supervisor test). **Unit-tested only:** the Farm
app cannot run beside the live one here; J18 step 1 now says what the window must show.

### Medium

**M1 · Before the freeze · `shell/renderer/chat/core/usage.mjs` + `computer/host.mjs:478` · The usage report loses its box
counts after a restart.** `setBoxTypes` is called only when a Computer run ends, and `report()` lists box types from that
list, so a report saved in a launch with no Computer run has `boxesRun: {}` though the counts are stored. *Proof:*
`rv5/usage_relaunch.mjs` (scratch): same launch `{"text":1,"instruction":1}`, next launch `{}`, stored
`{"text":1,"instruction":1}`. *Fix:* in `chat/main.mjs`, `lolUsage.save` loads the parts registry when it is
pressed (`const { specMap } = await import('./graph/parts/index.mjs')`) and calls `usage.setBoxTypes([...specMap().keys()])`
before `report()`: nothing more at start-up, and the names still come from the code, never from storage. The script
(`createUsage` twice on one storage) becomes the unit test, next to the usage tests. BEFORE_TUESDAY 3 now restarts the app before a second save.

**M2 · Before the freeze if small, else plans ▸ Next 15 · `shell/src/main/studio.ts:1018` · A project's page loses what it
kept in the browser at every restart.** The Preview server listens on port 0, so each launch serves the project from a
new origin, and `localStorage` is per origin. *Proof:* the POC below kept its list across reloads (2 books after a
reload); after a restart of the client the Preview was on `127.0.0.1:61588` (was 54582) and the list empty,
`localStorage.getItem('readingList')` null (`s33-relaunch-list.png`). *Fix:* a stable port per data folder
(`findFreePort(preferred)`, the preferred one remembered in settings), so "the list stays when I reload" also survives
tomorrow. The share-on-the-LAN server is not concerned.

**M3 · Before the freeze · `shell/renderer/chat/projects/models.mjs:18` · The class's model is introduced to every
student as untried.** A new project says *"Nobody has tried Qwen3.6 35B-A3B · NVFP4 on code edits yet: it may do well, or
not."* (`s13-project-done.png`), while the farm panel's LOL Vibe preset calls it "a model proven with the agent" and
LOLVIBE_IDE_GUIDE:21 "11 of 15". Gemma 4 26B is `good` on 12/15. *Proof:* tonight, the coding agent's five tasks on the
live Qwen3.6 (`docs/spike/ide/run.js`, 64k, maxTokens 8192): **3/5** (median, p5 sketch and refactor pass; the two
test-writing tasks fail), in 9–27 s each; the POC below in 20.5 s. *Fix:* the words only. **Not** `edits: 'good'`:
`pickEditor` (`models.mjs:30-37`) keeps a project chat on a `good` model, so on a farm serving both, Qwen3.6 would no
longer give way to Gemma 4 26B, LOL Vibe's coding model since 2026-11-09 (owner). A measured-but-mixed line for a model
whose profile carries a `measured` text, e.g. *"Tried on code: 3 of 5 tasks on 15 November (10–11 of 15 before). Ask
for one change at a time."* (`strings/project.en.mjs:80`, chosen at `ui/project-panel.mjs:331-332` where `modelUnknown` is today).

**M4 · Before the freeze · the Computer's Text box (lesson 1) · Line breaks in an answer disappear.** The Text box renders
the value as Markdown into a `<p>` with `white-space: normal`, so single newlines collapse: lesson 1's own example, a
haiku, shows as one line (`s27-l1-done.png`; the value holds `"Cool waves touch the shore\nSalt wind…"`). *Fix:*
`white-space: pre-line;` in `#lolcomputer .graph-text-body p` (`css/computer-text.css:139`): the Text box uses the chat's
own safe Markdown path, and its paragraph keeps the `\n`. Tried in the real app with an in-page style (not saved): the
haiku took its 3 lines. A check in the lessons' harness shots (k5) or a CSS assertion.

**M5 · Before the freeze if time allows, else after · `graph/canvas.mjs:1289-1292` · The Tour's new Text box lands on top
of the Markdown view.** Step 2 (*＋ Add a box ▸ Text*) placed the box over the Markdown view's left half, its output dot
90 px from the Markdown view's input dot, which it half covers (`s22-tour-step4.png`): step 4 (*wire it*) is fiddly on a
trackpad. It worked with exact coordinates. A box added from the toolbar lands at the centre of the visible canvas; the
Tour's view is at world x 620–960 (`00-tour.mjs:37`). By arithmetic, not measured, at zoom 1: a ~840 px canvas (a
1,100 px window) puts the 260 px box at 290–550, clear; tonight's ~1,000 px at 370–630, the dots meeting; a ~1,660 px
canvas (1,920 px) at 700–960, right on top. Moving the view in the lesson cannot suit every width. *Fix:* in
`placeEntry`, when the centre spot overlaps a box, step down by the grid until it is free (bounded tries), with a canvas
harness check.

**M6 · Before the freeze · `shell/renderer/styles.css:136` · 13 buttons in Preferences and the connection popover are
square native buttons.** `.btn-ghost` alone (never with `.btn`, checked in `index.html` and `app.js`) sets colours only:
computed radius 0, padding 1px 6px, the browser's 13.33 px font, against design.md's 8 px buttons
(`s17-prefs-usage.png`; *Change folder…*, *Rescan now*, *Apply*, *Test connection*, *Check for app updates*, *Save a usage
report…*, *Check for chat-engine update*…). *Fix:* the chat already defines this button (`chat/css/base.css:139-153`:
radius 8 px, padding 8px 14px, 13 px / 500, `appearance: none`, cursor, a disabled state), scoped to `#lolchat` and
`.chat-layer`; give the shell's `.btn-ghost` (`styles.css:136`) the same declarations. The scoped rule keeps winning
inside the chat (`ui/dialogs.mjs`, `ui/settings.mjs`…), and the Computer uses no `.btn-ghost`.

**M7 · Fixed tonight · `docs/CLASS_SHEETS.md` · Three statements made false by Open WebUI 0.13.3 and LiteLLM 1.106.9.**
The model menu is now in the message box, not at the top (`s05-owui.png`); a *What's New* window opens at the first start
(`s02-connected.png`, *Okay, Let's Go!*); "33 to 95 tokens a second each" becomes about 88 (30 people) and 67 (48)
(RESULTS ▸ *LiteLLM 1.106.9 against 1.97.0*).

### Low

- **L1 · after** · the farm panel: a finished job's bar stays until the next job, at the top, sticky: on Sunday
  *Updating vLLM — vLLM 0.33.0 is installed, with Qwen3.8 27B · NVFP4* while Qwen3.6 serves (`panel-0.png`;
  `admin/index.html:238` draws `s.job` and `s.download` whatever their age). Drop a done bar after a few minutes.
- **L2 · after** · LOL Vibe: the chat Preview keeps its first width when the Project panel opens (horizontal scroll in
  Split), a known ponytail (`render/code.mjs`).
- **L3 · after (Next 15)** · LOL Vibe's empty chat offers no example and says "Chat directly with the farm"; the context
  meter's "advertised" and a "Thought for 0s" row on a reply that did not think are jargon for a student; the agent ends
  with "Open index.html in a browser to try it out" while the Preview shows it.
- **L4 · after** · the Computer: the *＋ Add a box* menu covers the lesson card (the step's text is hidden while choosing).
- **L5 · before the freeze (words)** · `00-tour.mjs:97` says "the library on the left", the heading reads **Graphs**;
  `examples/show.mjs:127` names a "▶ Say it again" control (the ▶ is titled *Run this box and everything after it*);
  `examples/bring.mjs:173,181` quotes *From: the farm's message bus*, the box shows the label *From* and the option *the
  farm's message bus*.
- **L6 · before the freeze (words)** · LOLVIBE_IDE_GUIDE: line 24 says gemma4 "thinks itself out of room" and line 25
  that the panel calls Qwen3.6 "untried"; the panel's words are *is weak at editing code* and *Nobody has tried*
  (`strings/project.en.mjs:79-80`); line 163's fix names models the message itself does not (`strings/agent.en.mjs:31`).
- **L7 · fixed tonight** · `farm-app/src/main/installer.ts:162-163` and `:194-196`: two `\n` in template literals had
  become literal line breaks in the source (the tool-escape trap): same strings, odd source.
- **L8 · low** · RESULTS ▸ *llama.cpp b11836 against b12377* ends "A bump … is worth its test after the class": the bump
  was made the same day (`PINNED_BUILD = 'b12377'`).
- **L9 · after (words)** · the farm button has three names: *the connection pill* in LOL Vibe's messages
  (`strings/net.en.mjs:35`, `composer.en.mjs:18`), *the farm button* in CLASS_SHEETS, *the pill* in GETTING_STARTED.

## Questions (suspicions not proven)

- Did the installed client ever start from a lowercase path (a shortcut, the updater's relaunch, *Launch at login*)? If a
  student or the owner ever saw *The sandbox could not start* on an installed client, H1 is the likely cause; nothing
  tonight proves it.
- After H1, does Electron 45 still fail the harness? (plans ▸ Next 14.)

## Checked and found sound (not to redo)

- **The chat Preview's walls** (model-written JavaScript, from inside the guest): `parent.document` and `top.location`
  blocked (SecurityError); `fetch` to the farm's gate, to the farm's `/lol/self` and to the internet all blocked
  (`connect-src 'none'`); the guest's `window.lol` is the sandbox's own API (canvas, params, a read-only voice state), not
  the app's bridge. LiteLLM listens on `127.0.0.1:4001` only; the gate on `0.0.0.0:4000`.
- **Open WebUI 0.13.3** in the client: chat answers (2 s); after the client moved from a Spark to the PRO 6000 before any
  chat, the model menu said *assistant*; Settings ▸ Integrations shows *External Tool Servers* and *Open Terminal*
  (Direct Integrations on, `s18-owui-integrations.png`). Documents: n° 4's check stands (not redone).
- **LOL Vibe, the proof-of-concept web application** (plans ▸ Next 15's facts): *Project ▸ New project "reading-list"*,
  then "Make a small reading list app: a form to add a book (title and author), the list of books under it, a delete
  button on each book, and the list stays when I reload the page. Put the style in style.css and the code in app.js.":
  index.html, style.css and app.js in **20.5 s, 5 steps**, the Preview opened by itself; adding 3 books, deleting 1 and
  reloading kept 2 (`s13-project-done.png`). The stumbles: M2, M3, L2, L3.
- **The Computer:** Creative coding ▸ Run all with *Think all* off: 4.3 s, the sketch draws (`s15-creative.png`). **The
  Tour, 8/8, and lesson 1, 4/4,** walked with real clicks, drags and keys (the Instruction answered in 6.1 s).
- **The Computer's lessons and examples against the code** (explorer, 68 steps; each claim used here checked): 67 steps
  fine; L5's three wordings.
- **Dark theme:** the shell's three surfaces and Open WebUI follow it (`s29-dark-vibe.png`).
- **States:** LOL Vibe waiting for a seat (the harness's `p2-shots-waiting.png`: who holds the seats, when one frees,
  *Try now* and *Cancel*, the composer's *Waiting for a seat…*) is plain and complete; the farm-full, model-down and
  password messages (`strings/net.en.mjs:16-35`) say what to do next. The top bar's own states are not photographed by
  the harness (it has no `app.js`) and were not provoked on the live farm.
- **The farm panel** (read only): Presets, Serving, vLLM, Performance, Access (*Free an idle seat after* offers 1 min, as
  CLASS_SHEETS asks; *Farm password* and *Apply changes*, as BEFORE_TUESDAY 4b says), Model storage, Plugins, Clients:
  each control says what it does and what it costs (a restart, a minute of no chat); only L1's stale bar.
- **The changed code read for failure:** `farm/src/pysvc/server.py` (the OCR caps, the client-left watcher, with their
  `check_services.py` tests), `selfServer.js` (a 400 ms cost per wrong token), `up.js routingChanged` and the vLLM
  update guard, `litellm.js`'s master-key setting, `sidecar.ts keepDbBeforeEngine`, `configBridge.ts`'s 0.13 env,
  `usage.mjs` (M1), `render/page.mjs` and `render/code.mjs` (a first Preview's `await import` lets a quick *Code* click
  leave one hidden page running until the thread is left: too small to list).

- **The new install's downloads** (the Farm app's pins of 2026-11-14): every file name `runtimeManager.ts` builds exists
  on its pinned release, HTTP 200 on `releases/download/<tag>/<file>` (the wizard's own route): CPython 3.12.16 +
  20261110 for the five platform keys, and Ollama v0.40.16's four archives (Windows, macOS, Linux x64 and arm64).

## Not checked

The Farm app's wizard and window, neither run nor read (it cannot run beside the live Farm app; its update path is
H4's, unit-tested only); a fresh install's download; macOS; Stop in LOL Vibe tonight (n° 4 measured it); a PDF in Open
WebUI 0.13.3 tonight (n° 4 did); any panel button (read only); the top bar's farm-full and not-responding states.
