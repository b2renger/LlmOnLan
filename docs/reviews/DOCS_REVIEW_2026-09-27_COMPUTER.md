# Docs review, 2026-09-27: the Computer

Scope: `shell/renderer/chat/{computer,graph,sandbox}/**`, the Computer's strings and CSS,
`shell/src/main/debugLog.ts`, the `LOL Studio (S0)` regions of `shell/src/main/index.ts`, the
`projects`/`debugLog` preload bridges, and the in-app and technical docs for the Computer. I reviewed
the **working tree**, which includes the uncommitted 2026-09-27 view-tools change (`onSurfaceKeyDown`,
the zoom cluster moved next to Select/Hand, and the run bar's zoom chip removed).

Gates I ran myself: `node shell/test/chat-lint.js` found 221 files and 0 violations (rule 15: 5
lessons, 2 templates). `node shell/test/chat-unit.js`: the first run gave 1564 passed and 1 failed,
and I did not capture which test failed. A full re-run gave **1565 passed, 0 failed**, so treat it as
a flake. I did not run the harness, because slot 0 is busy.

The rule I applied: the code is the truth unless it is a bug. For each mismatch, the section says
which side should change.

---

## A. Bugs in the implementation

### CA-1 (med): when the sandbox is paused, the message is wrong and nothing on screen says how to recover
- **Where:** `sandbox/host.mjs:291-303` (`onStall` → `blocked = true`, `note(t('sandbox.disabled'))`),
  `sandbox/host.mjs:242` (`boot()` returns false while blocked), `sandbox/host.mjs:635,656`
  (`compute`/`run` then fail with `sandbox.errDisabled`), `graph/parts/preview.mjs:393`.
- **Evidence:**
  - After three stalls within `REBUILD_WINDOW_MS` = 60 s (`sandbox/protocol.mjs:81-82`), every
    Code/p5/three/HTML box fails with `errDisabled` (`strings/sandbox.en.mjs:16`): *"The sandbox could
    not start, so nothing was run."* That is false: the sandbox did start. It is **paused** after the
    three stalls.
  - The sentence that explains the pause is `sandbox.disabled` (`:25`): *"The preview is off until you
    press Run again."* It is emitted as a `note` event (`host.mjs:90-92`), but **nothing in the
    Computer subscribes to it**. The only listener on the sandbox is the debug log
    (`computer/devlog.mjs:613-631`), and grepping for `type === 'note'` finds no consumer. So the
    reader never sees it.
  - The note also names a button that does not exist here: the canvas toolbar's Run button is hidden
    (`css/graph.css:91`). Only `host.start()` re-arms the sandbox (`computer/host.mjs:409-412`). That
    covers Run all, ▶, Ctrl+Enter and a Button's face. **Run code** and edit-draws do not re-arm.
  - The debug log keeps the kind but drops the words: `devlog.mjs:630` writes
    `` log(`sbx.${ev.type}`, {state, why, dropped}) ``, so a `sbx.note` line never carries `ev.text`.
  - LOLCHAT_RIG_CHECKLIST §15 expects the opposite: *"the sandbox goes quiet and says so"*.
- **Proposed fix:**
  1. In `sandbox/host.mjs`, while `blocked`, fail with a new key `sandbox.errPaused` instead of
     `errDisabled` (text in B-3).
  2. In `computer/host.mjs`, after the sandbox exists, subscribe once to `sandboxNow().on(...)` and
     toast `note` events whose level is `warn` or `error` through `app.dialogs.toast`.
  3. In `devlog.mjs:630`, add `level: ev.level, text: clip(String(ev.text || ''), 500)` for `note`.
- **Suggested test:** a unit test in the sandbox host suite: three watchdog stalls, then `run()`
  answers with `sandbox.errPaused`, and `compute({rearm:true})` works again. A harness scenario: a
  Code box with `while (true) {}`, run it three times inside a minute; the toast is visible, and
  **Run all** brings the sandbox back.

### CA-2 (low): **F** (fit) is the one zoom key that does not work from outside the canvas
- **Where:** `graph/canvas.mjs:2861-2877` (`onSurfaceKeyDown`) and `canvas.mjs:2790` (`onKeyDown`).
- **Evidence:**
  - `onKeyDown` fits on a plain **F**. `onSurfaceKeyDown` handles H, V, Ctrl+=/−, Ctrl+0 and
    Shift+1/2, but not F.
  - The Fit button's own tooltip advertises F: `canvas.mjs:519` gives *"Zoom to fit (F, Shift+1)"*.
  - The new tutorial paragraph (LOLCHAT_COMPUTER_TUTORIAL.md:365) says *"the zoom keys … work
    anywhere on the Computer"*, and its table lists F as the fit key (:355). COMPUTER_STATUS.md:96-97
    says the same.
  - So after a click on the run bar or the library, Shift+1 fits but F does nothing.
- **Proposed fix:** add one line before the Shift+1 line in `onSurfaceKeyDown`:
  `if (!mod && !ev.altKey && !ev.shiftKey && (ev.key === 'f' || ev.key === 'F')) { ev.preventDefault(); fit(); return; }`
  The `isTyping` guard above it already keeps F out of fields. If F should stay canvas-only, use the
  doc text in C-4 instead.
- **Suggested test:** extend `k12-view-tools` "…from anywhere…". Zoom to 200 % with Ctrl+=, click
  `.comp-run-counts`, press `f`, and assert that the view changed and equals `fit()`'s result.

---

## B. In-app text that is wrong or missing

- **B-1, `strings/parts-text.en.mjs:44` (`textTruncated`).** It promises a control the Text box does
  not have. The box's buttons are ↺ Clear, ✎ Edit, Copy and Lock (`graph/parts/text.mjs:291-319`).
  There is no Save…, and the right-click menu has none either (`canvas.mjs:3140-3146`). Copy does
  copy the whole text (`text.mjs:318`, `shown(live).text`). Replace with:
  `'Showing the first {kb} KB. The whole text still passes on, and Copy copies all of it.'`
- **B-2, `strings/graph.en.mjs:11` (`noDoc`).** It says *"press ＋ New"*, but the library button reads
  **New** (`computer.libNew`, `computer/library.mjs:362`). Replace with
  `'Open a graph from the library, or press New, to start building.'` (or give the button a ＋, and
  then the tutorial's two "＋ New" lines are right, see C-3).
- **B-3, `strings/sandbox.en.mjs:16, :25`** (goes with CA-1). Add
  `errPaused: 'The sandbox is paused: a sketch stopped answering three times in a minute. Press Run all (or ▶ on a box) to start it again, or wait a minute.'`
  and change `disabled` to
  `'The sandbox is paused after a sketch stopped answering three times in a minute. Press Run all or ▶ on a box to start it again.'`
- **B-4, `strings/drops.en.mjs:8` (`hint`) and `strings/graph.en.mjs:138` (`dropHint`).** They say a
  `.lolgraph.json` is dropped *"to open it"*. The drop actually **replaces the open graph**, after the
  `replaceTitle` question (`canvas.mjs:1609`, the `importGraphFile` path). Critic S1-11 renamed the
  toolbar button "Replace from file…" for exactly this reason. Replace with
  `'Drop a picture, a PDF, a sound file, a text file — or a .lolgraph.json to put it in place of this graph'`
  and `'Drop a .lolgraph.json file to put it in place of this graph.'`
- **B-5, `strings/palette.en.mjs:80` (`welcomeTourHint`).** It reads "about 90 seconds", but the tour
  declares `minutes: 2` (`tutorial/lessons/00-tour.mjs:24`), and the Learn shelf prints that as
  "2 min" (`tutorial/rail.mjs:185`). The two in-app claims should agree. Use `'about 2 minutes · no
  model needed'`, or set `minutes: 1.5` if the shelf can print it.

---

## C. Technical doc drift

### C-1: LOLCHAT_COMPUTER_TUTORIAL.md, "Opening it" (lines 32-38)
These lines are stale since today's change: the run bar no longer has a zoom button
(`computer/runbar.mjs:323-324, 355`), and Fit now sits inside the zoom cluster next to the tools
(`canvas.mjs:634-641`). Replace the two bullets with:
```
- **The run bar**, above the canvas: **Run all** (with **Stop** beside it while a run is going),
  counts of parts and generations, the generation cap, a sentence about the last run (and **Run
  everything again** when nothing needed a re-run), **?** (what is this?), and **● Record log** (see
  [COMPUTER_DEBUG_LOG.md](COMPUTER_DEBUG_LOG.md)).
- **The canvas**, with its toolbar: **＋ Add a box**, the **Select (V)** and **Hand (H)** tools, the
  zoom cluster (**−**, the zoom %, **+**, **Fit**), **Undo**, **Redo**, **Tidy**, **Export…**,
  **Replace from file…** and the **Cap** field.
```

### C-2: LOLCHAT_COMPUTER_TUTORIAL.md, Step 7 (lines 189-190)
It says both boxes are in the menu's first strip. The strip is `QUICK = ['p5','three','svg','html']`
(`graph/palette-menu.mjs:49`), so Write an SVG is not in it. Replace the parenthesis with:
*"(the SVG box is also one click away in the menu's first strip, *Draw with code — no farm needed*;
the Write-… boxes are only under *Think*)"*.

### C-3: LOLCHAT_COMPUTER_TUTORIAL.md, lines 27 and 88
"**＋ New**" should be "**New**", which is what the button reads (see B-2). Leave it as is only if the
button gains a ＋.

### C-4: LOLCHAT_COMPUTER_TUTORIAL.md, "Mouse and keyboard" (lines 361, 362, 365)
- Line 361 should use the menu's real labels (`strings/computer-canvas.en.mjs:46-54`,
  `canvas.mjs:3140-3159`): *"Right-click a box (**Copy text** when words are selected, **Edit**,
  **Duplicate**, **Copy box**, **Zoom to this box**, **Delete box**) or a wire (**Name this arrow**,
  **Unplug**)."*
- Line 362: *"**Edit code** on the box. **Ctrl+Enter** runs it (in the box's own code field too: there
  it redraws that box instead of running the graph, `preview.mjs:697-702`), **Tab** indents, **Esc**
  closes the editor."*
- Line 365, only if CA-2 is not fixed: *"The view keys — **V**, **H**, **Ctrl+= / Ctrl+−**, **Ctrl+0**,
  **Shift+1** and **Shift+2** — work anywhere on the Computer … **F** fits only while the canvas has
  the focus."*

### C-5: LOLCHAT_COMPUTER_TUTORIAL.md, "Edit the code, go Live" (line 214)
*"One box is Live at a time; ■ Stop puts the picture back."* leaves out how Live behaves when the box
goes out of view. Add: *"A Live box pauses when it scrolls off screen, when you switch to another
surface, or when the window is hidden, and it starts again when it is back. It is still Live when you
reopen the graph, until you press ■ Stop."* Code: `preview.mjs:1145-1166` (the IntersectionObserver
and the `EV.VISIBLE` watcher), `:1179-1188` (the `live` choice is saved with the document and is not
an undo step), `:1342` (it re-arms on mount).

### C-6: COMPUTER_STATUS.md
- **Title and lines 3-7.** "(25 Sept, morning …)", *"all of it committed and pushed"* and *"Every
  phase … up to K6 is done"* are stale. K7, the S1–S3 critic series, Live/Edit code (K-7..K-9) and the
  2026-09-27 view tools have landed (git log `main..HEAD`, 39 commits). Suggested header: *"The
  Computer — status on 27 Sept (before the merge to main). Every phase of COMPUTER_PLAN.md through K6,
  plus K7 (debug log), the S1–S3 critic series, Live previews and Edit code (COMPUTER_LIVE_PLAN.md),
  and the view tools (27 Sept) are built."*
- **"Open it" (line 21).** `npx electron .` runs `build/main/index.js` (`shell/package.json:8`).
  `build/` is gitignored, and this branch changes main (`debugLog.ts`, `index.ts`), so a fresh
  checkout needs a build first. Use `cd shell && npm run dev` (it runs `tsc`, then electron,
  `package.json:18`).
- **"The numbers" (line 268).** The counts are stale: 1386 unit tests and 212 lint files. Today it is
  `chat-unit` **1565 passed** and `chat-lint` **221 files / 0 violations**; the harness still needs a
  re-run.
- **"Commits, newest first" (lines 279-295).** The list stops at the K6 fix round. Either extend it
  (`98e9e42` K7 … `12cf37f` Live, `011f867`, plus today's commit), or replace it with *"see
  `git log main..lolchat/vnext`"*.
- **"What is NOT there yet".** Add: *"**Resuming a run after the app closed.** The plan's banner (§7.5,
  'The last run stopped when the app closed — N of M boxes finished · Resume') is not built. Its
  strings `computer.resumeBanner/resumeAction/resumeDismiss` are used nowhere. What does happen: boxes
  that were running come back **Needs a re-run** (`graph/model.mjs:282`), and **Run all** finishes the
  job without re-paying for finished boxes."* Evidence: grepping for `resumeBanner` finds only
  `strings/computer.en.mjs`.
- **Line 237.** It says *"Save… still writes all of it"* for a Text box that has no Save (see B-1).
  Change it to *"Copy still copies all of it"*.

### C-7: COMPUTER_PLAN.md (top banner, lines 3-8)
The file still calls itself an "executable plan, revision 2" dated 2026-09-22. Add a status line
under it:
> *As built (2026-09-27): K1–K5 as planned, K5 without the optional U2/U3 (lessons 5–12, six of the
> eight templates, Explain this graph). K6 and K7 are specified as addenda in LOLCHAT_PLAN.md
> ("K6 addendum", "K7 addendum"), and Live/Edit code in COMPUTER_LIVE_PLAN.md. Not built: §7.5's
> Resume banner, §8.5's per-part `?` card (the run bar's single `?` stands in), and §8.4's
> lesson links (the loop notice offers its lesson button only once `l10-loops` ships,
> `canvas.mjs:840-853`). What works today is COMPUTER_STATUS.md.*

The code cites "COMPUTER_PLAN addendum KF/KG" (`debugLog.ts:1`, `preload/index.ts:84`), but those
addenda are in LOLCHAT_PLAN.md (lines 3509 and 3770). The banner above makes that findable without
touching code.

### C-8: LOLCHAT_COMPUTER_SPEC.md (top)
This file describes the 2026-09-16 per-thread panel. Several of its claims are no longer true:
- "a graph belongs to a thread"; graphs are library documents now (§7.1 of the plan);
- "cycles are rejected"; gated loops are legal (`graph/topo.mjs:323`);
- a **Look** part; it was never built;
- **From/To thread** and **Render**; they are legacy and cannot be placed (`graph/parts/index.mjs:89`);
- "`Esc` to stop"; Esc now walks a ladder.

Add this under the title:
> *Superseded (2026-09-22) by [COMPUTER_PLAN.md](COMPUTER_PLAN.md). The Computer is its own surface
> with a library, not a panel in a thread. Kept for its history: §1's reasons and §6's directives
> still stand. For today's behaviour read [LOLCHAT_COMPUTER_TUTORIAL.md](LOLCHAT_COMPUTER_TUTORIAL.md).*

### C-9: LOLCHAT_RIG_CHECKLIST.md, §13–§17
- **§13–§15 test the per-thread panel**, which K1 removed. Examples:
  - "in the workbench rail", "Check a second thread has its OWN empty graph", "press **Run**" (hidden,
    `graph.css:91`), and "Split and Panel width" (§13);
  - "The farm went to someone else" (§13, §14), which is `graph.runBusy`. The Computer no longer uses
    it; it says `computer.runOutcomeBusy`, *"Paused: the farm was busy with someone else. Press Run
    all to carry on."*;
  - "From thread / To thread" and "The value inspector beside the conversation" (§14);
  - "**Send a model's code to the Computer**" (§15). The chat-fence bridge went out at K1
    (`strings/parts.en.mjs:218-219`);
  - "the thread's project folder" (§15). It is per graph now (`graph/parts/file.mjs:31-35`);
  - "a **From thread** part … no message id" (§15b).

  Add under each of §13–§15: *"Written for the per-thread panel (before K1). Items that name a thread,
  From/To thread, Render, the toolbar's Run or 'Send to the Computer' no longer apply. Run the
  equivalent in the Computer surface, or skip them."*
- **§16, "Close the app with a question open".** It expects *"the run listed as unfinished"*, and
  nothing lists it (C-6). Change the expectation to: *"boxes that were running come back as **Needs a
  re-run**; **Run all** re-runs only those, and nothing already answered is paid for again."*
- **Missing.** There are no rig items for K4–K6, Live or the view tools. COMPUTER_STATUS "What only
  you can check" 1–12 covers K4–K6. Add a pointer §18: *"The Computer after K4: see COMPUTER_STATUS.md
  'What only you can check' 1–12, plus: ▶ Live on a three.js box, drag, scroll and right-drag over it
  (the canvas must not pan); Edit code, then Ctrl+Enter, then Esc, and the focus is back on the box;
  press H and V after a click on the run bar and the library."*

### C-10: COMPUTER_DEBUG_LOG.md
- **Kinds table (lines 58-74).** Add the kinds the code writes but the table leaves out:
  - `log.live`: switch on, with the backlog count (`devlog.mjs:252`);
  - `log.attached`: the host/runner wiring, and any modules that failed (`:740`);
  - `log.error`: main refused to start the file (`:244`);
  - `sbx.note`: the sandbox's own notice; it carries its text once CA-1 is fixed;
  - `main.preload-error` (`src/main/index.ts:449-451`).

  `http.quieted` appears only in the prose; add it to the `http.*` row.
- **Line 78-79, redaction.** *"Any field named like a key, token, password…"* overstates it. The rule
  matches **exact** field names, case-insensitively (`devlog-format.mjs:13-14`). `apiKey`,
  `masterKey`, `key` and `token` are redacted; a field like `adminToken` would not be. Replace with:
  *"Any field whose name is exactly one of authorization, cookie, password, secret, token,
  access_token, refresh_token, bearer, key, api_key/apiKey, x-api-key, master_key or farm_key (any
  case) is written as `[redacted]` — the farm password lives in `caps.apiKey` and the OCR key in
  `ocr.key`, both covered — and so is any `Bearer …` string."*

### C-11: COMPUTER_LIVE_PLAN.md, decision 1 (lines 24-28)
The plan says Live runs *"until … the box leaves the screen, the Computer is hidden or the window is
hidden"*. As built, those three **pause** Live, and it resumes when the box is back. Only ■ Stop, a
takeover by another box, a stall, a mode change or an error ends the choice (`preview.mjs:129`
`liveEndsChoice`, `:1154`, `:1162`). The choice is saved with the graph (critic L1-3/L1-5). Append:
*"As built: leaving the screen, the Computer being hidden or the window being hidden pause the box and
it resumes when visible again; the Live choice is saved with the graph."*

### C-12: CLAUDE.md (for the integrator to apply)
CLAUDE.md never mentions the Computer, and its client description is stale in two places:
- "**Two surfaces:** OWUI + **LOL Chat** (`renderer/chat.js`, …, localStorage-only)" (line 87-88).
  `renderer/chat.js` does not exist; the entry is `renderer/chat/main.mjs`
  (`renderer/index.html:212`). The topbar has three views (`renderer/app.js:890`).
- Line 445 of the repo layout says "chat.js (LOL Chat)".

**Proposed "Build status" bullet**, after the `shell/` bullet:
> - **The Computer** (third client surface, `shell/renderer/chat/{computer,graph,sandbox}/`; topbar
>   `Open WebUI · LOL Chat · Computer`, remembered) — a node-graph canvas where boxes wired by
>   **named arrows** make a small program. The boxes are Text, Instruction (+ "Write a p5.js/three.js/SVG/HTML"
>   presets), Split/Filter/Collect/Repeat, Code, Preview (+ p5.js/three.js/SVG/HTML/Markdown presets),
>   File, Image, Document, Sound, six control boxes and Sticky/Section/Title. Thinking boxes ask the farm
>   **directly** (never through OWUI): background priority, one request in flight, they yield to a
>   person's chat, and a hidden window sends nothing. Every run is bounded by `RUN_LIMITS`
>   (`core/types.mjs`): 8 passes per box, 50 generations (the toolbar **Cap**), 10 min of wall clock
>   including waits, and 2000 activations. A loop is legal only through a gate box (`topo.mjs`
>   `GATE_TYPES`). Code/p5/three/HTML run in ONE opaque-origin sandbox iframe
>   (`sandbox/runner.html`, `allow-scripts` only, no network, vendored three r160 / p5) plus at most
>   one **Live** guest; `lol.orbit(camera)` is the first-party camera control, and **Edit code** opens
>   a drawer editor. What leaves the machine: prompt text, and an Image's pixels inside the
>   Instruction's chat completion to the farm; a Document's PDF bytes go to the farm OCR for text
>   only; a Sound is never sent. Where data lives: graphs and their files are in the renderer's
>   IndexedDB (`lol-chat` → `graphs`, `attachments`) under the app's userData, **not** DATA_DIR, so a
>   data-folder move does not carry them (the same gap as LOL Chat, LOLCHAT_VISION C-2). File-box
>   outputs go to `<DATA_DIR>/LOL Studio Projects/` (one project per graph). The opt-in debug log goes
>   to `%APPDATA%\LlmOnLan\logs\computer\*.jsonl` (25 MB per file; 15 recordings kept, plus up to 30
>   with a marked bug; keys redacted; `src/main/debugLog.ts`). Learn shelf: the tour, lessons 1–4 and
>   2 templates. Docs: [docs/LOLCHAT_COMPUTER_TUTORIAL.md](docs/LOLCHAT_COMPUTER_TUTORIAL.md) (user),
>   [docs/COMPUTER_STATUS.md](docs/COMPUTER_STATUS.md), COMPUTER_PLAN.md, COMPUTER_LIVE_PLAN.md,
>   COMPUTER_DEBUG_LOG.md.

**Replace line 87-88's sentence** with: *"Three surfaces: OWUI, **LOL Chat** (`renderer/chat/`,
farm-direct, IndexedDB) and the **Computer** (below), behind a topbar switch; …"*

**Repo layout.** Replace the `renderer/` line (445) with:
```
    renderer/            #   topbar + webview host + settings UI; tokens.css (ComfyQ palette)
      chat/              #   LOL Chat + the Computer — ES modules, IndexedDB `lol-chat`
        computer/        #     the Computer surface: layout, library, run bar, drawer (+ code editor),
                         #     host (session/runner/canvas), drops/intake/media, devlog + recorder,
                         #     tutorial/ (Learn shelf, rail, lessons), templates/
        graph/           #     engine + canvas: model, topo, runner, bind, undo, serialize, canvas.mjs,
                         #     wires, palette, parts/ (one file per box type)
        sandbox/         #     host.mjs (the ONLY iframe maker), runner.html (opaque-origin guest,
                         #     lol.orbit), protocol.mjs, lib/ (vendored three / p5 / matter)
```
Also add `debugLog.ts` and `projects.ts` to the `src/main/` comment (line 440-441).

---

## D. Undocumented features

Each item is shipped and reachable, but documented in neither layer, or in only one of them.

- **D-1, Live pauses and resumes, and the choice is saved with the graph** (`preview.mjs:1145-1188,
  1342`). Neither layer mentions it. Proposed text is in C-5.
- **D-2, "Run everything again"** (`runbar.mjs:345-351`, `computer.genRunAgain*`). It appears when a
  run found nothing stale, and it re-runs every box with new seeds. COMPUTER_STATUS covers it
  (item 1); the tutorial does not. It is covered by C-1's text; also add one line after the tutorial's
  "Two ways to run" list: *"When nothing needs a re-run, the run bar offers **Run everything again**:
  every box runs, and Instructions on 'new each run' get new seeds."*
- **D-3, the Text box's ↺ Clear** (`text.mjs:291`, *"Show what you typed instead of what arrived"*).
  Neither layer mentions it. Add to tutorial Step 6: *"**↺ Clear** shows what you typed again instead
  of what arrived."*
- **D-4, the first keystroke in a wired Text box locks it** (`text.mjs:55-58`, `parts.textAutoLocked`).
  COMPUTER_STATUS covers it (item 6); the tutorial does not. Add to Step 6's Lock bullet: *"Typing into
  a box that has a wire coming in locks it for you, and says so; one Ctrl+Z takes both back."*
- **D-5, Sticky, Section and Title** (the palette's *Annotate* group, `parts/index.mjs:162-164`). The
  tutorial names only Section's limitation, and COMPUTER_STATUS has one line. Add a short table to the
  tutorial's Part 4, using the palette's own words: *"**Sticky** — a coloured note for the reader,
  never runs. **Section** — a labelled region to group the parts of one idea (its parts do not move
  with it yet). **Title** — big words on the canvas, never runs."*
- **D-6, the Code box and the plain Preview box** as ＋ entries (*Show* group,
  `parts/index.mjs:154-155`). The tutorial mentions Code only through the example and the
  troubleshooting row, and Preview (with **Read it as: Automatic / Markdown / SVG / Web page /
  three.js / p5.js**) not at all. Add to Step 7: *"**Code** runs plain JavaScript in the sandbox on
  what arrives (`inputs.in` is an array; return text, a number, an array or an object). **Preview**
  is the box behind all five: its *Read it as* menu picks how to show what arrives."*
- **D-7, a Condition can spend a generation.** *Decide by → asking the model (1 generation)*
  (`strings/parts.en.mjs:248`). The tutorial's Control table describes only the free reading. Append
  to its Condition row: *"It reads the words for free, or asks the model (one generation)."*
- **D-8, debug-log kinds and redaction scope.** These are in the code only; see C-10.

---

## E. Checked and consistent

- The keyboard claims in the tutorial table match `canvas.mjs` `onKeyDown` (2719-2829): the Esc
  ladder, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Ctrl+A, Ctrl+D, Ctrl+=/−, Ctrl+0 by key position (AZERTY
  safe), Shift+1 / Shift+2, F2/Enter on a wire or a box, typing names a selected wire, Delete and
  Backspace, Space-pan, arrows 10 px (`GRID = 10`), Shift 1 px, Alt+Shift resize.
- Ctrl+Enter on the canvas runs `start()`, which is `mode:'all'` (`runner.mjs:325`), the same as Run
  all.
- `onSurfaceKeyDown` is quiet while typing, in a `<dialog>` or `role=menu|dialog|listbox`, and when
  the Computer is hidden. Delete, arrows and copy/paste stay canvas-only, and the clipboard handlers
  are gated by `ownsClipboard`.
- The new toolbar order and the tool keys (`<kbd>`, `aria-keyshortcuts`) match `k12-view-tools`. No
  stale `.comp-run-zoom` or `computer.runZoom` reference is left outside `k12`, which asserts it is
  absent.
- Palette ↔ tutorial: all 21 palette parts plus the 9 presets were checked against
  `strings/palette.en.mjs`. The tutorial's Control table repeats `desc*` verbatim. Gaps are listed in
  D-5 to D-7.
- The tour and lessons 1–4 were checked against current labels: "＋ Add a box", "Fit", "Hand tool
  (H)", "Keep my code", "name me", the grey "sends … words" line, Lock, ▶, and Show me / Put it back /
  Got it / Reset lesson / "–". All still exist with the same names, and rule 15 lint is green.
- Welcome picks (`welcome.mjs:29`) match the tutorial and STATUS. The Learn shelf's contents and the
  generation counts (tour, lessons 1–4, templates with 8 and 1) match the registry and the templates.
- Run limits 8 / 50 / 10 min / 2000 (`core/types.mjs:549-554`), `DEFAULT_MAX_ITEMS` 50, the gate list
  (`topo.mjs:323`) and the limit and cap notice buttons (`canvas.mjs:756-825`) match tutorial Part 4.
- File limits match STATUS: PDF 60 pages and a 5-minute cooldown (`document.mjs:50,58`,
  `extract.mjs:35`); Sound 25 MB, 10 min and a 256 KB probe (`audio.mjs:42-51`); Text and Document
  render 64 KB; up to 8 files per drop; graph file 8 MB (`serialize.mjs:76`); inline fill 200
  characters (`bind.mjs:55`).
- Token ceilings `MAX_TOKENS_CODE` 16384, `_TEXT` 8192 and floor 512 (`bind.mjs:74-77`). No doc in
  scope states a number that contradicts them.
- Edit code: Tab and Shift+Tab, Enter keeps the indent, Ctrl+Enter, Esc returns the focus, Go to
  line N, and the gutter mark (`code-edit.mjs`, `drawer.mjs:496-575`). The strings `computer.code*`
  agree.
- Live: `LIVE_MODES` = html/three/p5, one live guest at a time (`sandbox/host.mjs:708-713`).
  `lol.orbit` drags, zooms with the wheel or a pinch, and pans with right-drag or Shift/Ctrl-drag
  (`runner.html:315-605`). The three.js system message and the starter call `lol.orbit`, and
  OrbitControls is aliased (`unfence.mjs:244-251`). A Live HTML page runs its own `<script>`s
  (`runner.html:617-664`); the HTML system message still says "no JavaScript" for the snapshot, which
  is by design.
- The debug log: path `%APPDATA%\LlmOnLan\logs\computer\` (`app.setName('LlmOnLan')`, `index.ts:28,66`),
  25 MB, 15 recordings plus 30 marked, 40 screenshots, 2 MB per append (`debugLog.ts:20-25`), a
  2000-event backlog marked `pre:1`, a 100 ms long-frame threshold, 20 sandbox lines per second,
  bursts of 20 per 10 s, the `/models` poll once a minute, and a 600-character edit clip
  (`devlog.mjs:40-55,494`). The IPC channels and preload match the doc's "How it is built".
- The Record switch texts (`computer.rec*`) match `recorder.mjs` and COMPUTER_DEBUG_LOG steps 1–5,
  including the size-limit toast and the folder button after a stop.
- The main side: the navigation veto for `runner.html` is an exact match (`index.ts:427-442`), the
  projects root is `<DATA_DIR>/LOL Studio Projects` (`:552`), and the argument-typed handlers match
  the preload comments.
- COMPUTER_STATUS "What is NOT there yet" is still true: sound never sent, PDF only as text, Section
  does not carry its boxes, wires are grey (`graph.css:161-163`), and lessons 5–12 are unbuilt.
