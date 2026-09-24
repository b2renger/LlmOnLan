# The Computer: critic report, round 2 (2026-09-24)

**Verdict: NOT YET.** It is close. I checked every item from round 1 in the code, and every item the
owner could feel with real input:

- **Fixed in code:** all 8 of the owner's items. **Still owed:** the two rig checks below.
- **Fixed:** all 18 of round 1's other defects.

What stops me signing off is one new **major** regression. Boxes are now exactly the height stored in
the document (K-3), and nothing adjusted the boxes that already existed. The owner's saved graphs,
the shipped "Research → problematic" template, and lessons 1 and 2 open with Instruction boxes that
scroll inside. Their prompt is squeezed to its 48 px floor, and the new seed line is hidden. Even
the tour's title has a scrollbar. There are also four minor findings.

Two items cannot be signed from this machine; they need a rig session:
- **A1 on the real farm:** does `seed` reach Ollama through LiteLLM?
- **A8's live bar:** each Write-… preset draws at least 4 times out of 5 on `gemma4:12b`.

## How this was checked

- **Code** at HEAD `d4462c5`. The coordinator committed the working tree I reviewed while I worked,
  and the files are identical.
- **Gates (re-run):**
  - `chat-unit`: 1486 passed, 0 failed.
  - `chat-lint`: 219 files, 0 violations.
  - `--phase k8` on slot 7: 35 passed, 0 failed.
- **Throwaway real-input probes on slot 7** (CDP `Input` domain; written as `zz-critic-*.mjs`, now deleted):
  - reopen a graph, then click + Enter and double-click on a filled Text box;
  - edit a running box while `mock-slow` generates (78 s), then Undo;
  - marquee over Text boxes, then Ctrl+C;
  - drag-select text in the transcript drawer, then Ctrl+C;
  - Keep, then Run all;
  - the size of the main field in every lesson, every template and an old-size graph;
  - the run bar's zoom chip.
- **Screenshots** (gitignored), in `shell/test/chat-harness/generated/shots/zz-critic-r2-*.png`:
  `instruction-sizes`, `research-template`, `l01`, `l02`, `tour`, `runbar-zoom`.

## Status of every item from round 1

**The owner's list**

| # | Status | Evidence |
|---|---|---|
| A1 seed | **Fixed** (rig check pending) | See detail below. |
| A2 name | **Fixed** | The row is "Fill in {names} with their values", with a hint. Only the braced form is filled, so "Stay on topic." stays a sentence (`bind.mjs` `rewrite`). The row is shown only when a braced name is bound. |
| A3 resize | **Fixed**, but see **N1** | The corner handle writes `resizePart` as one undo entry, and `layoutPorts` moves the ports. Paste and Ctrl+D keep `w/h`. Alt+Shift+arrows resize. The box is exactly `part.h`. |
| A4 mouse / trackpad | **Fixed** | See detail below. |
| A5 unplug | **Fixed** | Dragging a plugged input picks its wire up; drop it to unplug or re-plug (one undo entry). Hovering a wire thickens it and shows ✕. The hit band is 8 px on screen at any zoom. The right-click menu offers "Unplug". |
| A6 edit an old Text box | **Fixed** | See detail below. |
| A7 copy text | **Fixed** | See detail below. |
| A8 SVG / p5 / three | **Fixed in code** (rig check pending) | See detail below. |

A1, the seed:
- ▶ twice sends two requests with two different seeds and neither is cached. A pinned seed sends one request, then answers from the cache. 🎲, ✕, Keep and "Run everything again" all work (`k8-gen-seed`).
- The runner mints a nonce per run and carries it across stop, yield and cap (`runner.mjs`). The seed is part of the ask cache key (`ask.mjs`).
- **Rig check:** the same pinned seed twice on `gemma4:12b` gives the same text, and two seeds give different text.

A4, mouse and trackpad:
- The pure `wheelIntent` sends a wheel to one of three places: scroll inside the box, pan, or zoom (a pinch). It latches for 120 ms, so one gesture keeps its target.
- Zoom runs from 10 % to 400 %. A pinch follows the fingers one to one.
- Space can no longer stick: it is released on window blur, on focus leaving, and on a keyup anywhere.
- New tools: the Select and Hand tools, the − % + zoom cluster with its menu, the zoom keys, and Ctrl+D. All covered by `k8-input-canvas`.

A6, editing a Text box made earlier:
- Pointer capture is taken only once the pointer has moved past the drag threshold, so a click reaches the box.
- A Text box now has ✎ Edit and Copy. Double-click, Enter or F2 opens the editor (K-2).
- The first keystroke in a box something is wired into locks it, and the box says why.
- **My probe:** after switching away and reopening the graph, click + Enter and a double-click both open the editor with the caret in it. No ＋ menu opens. The edit is saved.

A7, copying text:
- Text answers, Markdown views and Document text are selectable zones (K-1).
- `shouldCopyParts` leaves a highlighted selection to the browser.
- The clipboard listeners sit on the document. Plain text pasted on the canvas becomes a Text box.
- **My probes:** a marquee over two Text boxes selects the boxes and no text, and Ctrl+C copies the parts. Drag-select in the transcript drawer, then Ctrl+C, copies the text; nothing hijacks it.

A8, code answers:
- `max_tokens` is 4096 for code and 2048 for prose, and it is on the wire and in the Sent tab.
- `finish_reason: "length"` becomes `errCutOff` for code and a "cut off" chip for prose.
- Each code kind sends its own system message, shown in the Sent tab. The four presets now carry only the task.
- The engine now also:
  - takes the `<script>` out of an answer that came back as an HTML page;
  - rewrites the page-load listeners, so a sketch waiting on them still starts;
  - hands an instance-mode p5 sketch to the guest;
  - flushes the first frame of `setAnimationLoop`;
  - repairs a missing SVG `xmlns` or `xlink` namespace;
  - explains the guest's error in the words of the fix.
- The guest is sized to the box's Width × Height (K-4), and the first `requestAnimationFrame` frame is flushed (`k8-boxes-sandbox`).
- **Rig check:** each Write-… preset draws at least 4 times out of 5.

**Round 1's other defects**

| # | Status | Evidence |
|---|---|---|
| B1 undo rewinds runtime | **Fixed** | Undo is now `restoreProgram`: the program comes from the snapshot; the present's runtime, title and view stay; changed parts are marked stale (`undo.mjs`). "Run, move, undo" keeps the answers (`k8-input-session`). |
| B2 edit while running lost | **Fixed** | My probe (real keys during `mock-slow`): the box ends `stale` with the edited prompt. An Undo afterwards also leaves it stale, which is harmless. |
| B3 click the open card | **Fixed** | `openDoc` returns early for the open id (`host.mjs`); `k8-input-session`. |
| B4 delete the open graph during a run | **Fixed** | The docstore has a `gone` set, the library switches away first and then waits for the run to settle, and the journal key is deleted; `k8-input-session`. |
| B5 log records LOL Chat | **Fixed** | `summarizeRequest(…, {deep: runnerActive && shown()})` (`devlog.mjs:414`). |
| B6 tour delete step | **Fixed** | A sticky note shows its words in a read-only field until a double-click or Enter; `k8-boxes-tour` passes with real clicks. |
| B7 Escape ladder | **Fixed** | Escape while typing only blurs. The canvas walks the host's cancel ladder, and the drawer is a cancel handler at order 100; `k8-input-session`. |
| B8 boxes survive a switch | **Fixed** | `resetBoxes()` runs on a `loaded` event; `k8-input-session`. |
| B9 model picker | **Fixed** | `modelSig` is stored after the rebuild. |
| B10 debug door | **Fixed** | Goes through `removeWire`/`movePart`. |
| B11 open race | **Fixed** | Epoch bump on "come back" (`host.mjs`). |
| B12 writes without a document | **Fixed** | The `persist()` guard; history is cleared in the same block that swaps the document. |
| B13 card "last run" | **Fixed** | Read from the journal; a duplicate drops `stats`. |
| B14 migrated graphs return | **Fixed** | `computer:migratedSources` marker. |
| B15 log claims success | **Fixed** | Stop and Mark toasts read the result (`recorder.mjs:102-138`). |
| B16 sound pinned in memory | **Fixed** | `bufferFor(…, wanted)`. |
| B17 drop races | **Fixed** | `docId` is re-checked before placing (drops and paste), `spareFresh` on delete, a `takeSeq` per box. |
| B18 dead code | **Fixed** | `mode:'button'` removed, the unused string removed, comments corrected. |

## New findings

### Major

**N1. Exact box heights shipped without adjusting the boxes that already exist. Lessons, a template and every saved graph open cramped.**
- **Where:**
  - `graph.css` (end of file): `.graph-part-body{flex:1 1 auto; min-height:0; overflow:auto}`.
  - `canvas.mjs:1752`: `style.height = part.h`.
  - The Instruction's controls now include a seed row (`instruction.mjs:258-350`).
  - Only the defaults moved: Instruction to 300×340, Preview to 360×400, Document to 280. Stored heights did not.
- **What a person sees:**
  - **A graph saved before R1:** an Instruction at the old default 300×260 has a body scrollbar and a prompt at the 48 px floor. The "last run: seed … · Keep" line and the "sends N words" strip are below the fold (screenshot `instruction-sizes`, right box).
  - **The "Research → problematic" template:** all 8 Instructions (320×260, and 300×260) have scrollbars, and each prompt field is at the floor. A long prompt shows about 3 lines (`research-template`).
  - **Lesson 1:** step 1 says "Click into the Instruction and type…" and that box (`01-hello-farm.mjs:31`, 300×260) scrolls (`l01`).
  - **Lesson 2:** both Instructions (`02-wires.mjs:38,42`, 240×260) cut their prompt mid-sentence behind a scrollbar (`l02`).
  - **The tour:** the title "The tour" (`00-tour.mjs:31`, h 88) overflows by 8 px. A scrollbar sits beside it on the first screen a new user sees (`tour`).
  - It also affects A4 in dense old graphs: a two-finger pan that starts over one of these boxes scrolls the box body instead of the canvas.
- **Fix:** make the content fit the old sizes rather than growing the boxes. Growing them would overlap dense layouts: the research template stacks its Instructions 270 px apart.
  - (a) Compact the Instruction: put Model and Answer shape on ONE row, and fold the seed field and the last-run line into one row. A 300×260 box must then show a prompt of at least 60 px with no body overflow.
  - (b) Fix the leftovers in the shipped data: the tour's title height and any lesson or template box still overflowing.
  - (c) Check that a Title at the sizes it ships with does not overflow.
- **Tests:**
  - A harness scenario opens every lesson and every template, plus a legacy document containing every part type at its pre-R1 default size.
  - For every box it asserts `body.scrollHeight − body.clientHeight ≤ 1` and an Instruction prompt ≥ 60 px.
  - A unit or lint check that lesson and template part heights are at least what their type needs.

### Minor

**N2. The run bar's zoom chip opens the zoom menu off-screen.**
- **Where:** `canvas.mjs:998-1004`, plus `graph.css` `.graph-zoom-menu-floating{transform:translateY(-100%)}`. This was an integration change.
- **Scenario:** click "100%" in the run bar. The menu's top is at y = −49 px: "Zoom to fit" is off the window, "Zoom to selection" is cut in half, the key hints are clipped at the right edge, and the menu covers "Record log" (screenshot `runbar-zoom`). The toolbar's own % button works.
- **Why:** the chip sits above the canvas root. The top is clamped to 8 px inside the root and then translated up by the menu's own height.
- **Fix:** open the floating menu below the chip, in window coordinates (`position: fixed; top: chip.bottom + 4; right-aligned; clamped to the window`), with no `translateY(-100%)`.
- **Test:** click the chip; the menu's rectangle is inside the window, and hit-testing its first row returns that row.

**N3. Keep marks the box and everything downstream stale, so the next Run all quietly regenerates downstream answers.**
- **Where:** Keep calls `setSeed`, then `ctx.update({seed})` (`instruction.mjs:299, 320`), then `setSettings`, which always calls `markStale` (`model.mjs:396`).
- **Scenario (probe):** Instruction A feeds Instruction B, both "new each run".
  - Run all. Press Keep on A: **both** A and B turn stale.
  - Run all again: 1 new generation. B gets a new seed (816897 became 271412) and a **different answer**, although the person only asked to keep A's.
- **Fix:** pinning the seed that produced the value on screen changes nothing that was computed. Keep should write `settings.seed` as an undoable edit that does **not** stale: a `setSettings(…, {stale:false})` option, used only when `stats.seed === value`. A typed seed or 🎲 still stales.
- **Test:** the probe above. After Keep, both boxes stay `done`; Run all sends 0 requests and says "Nothing to run".

**N4. Tour step 1 tells people to drag the empty canvas to move. Under the default Select tool that draws a marquee.**
- **Where:** `00-tour.mjs` step `s-look`. This predates R1 (K5), and R1's new tools make it visible.
- **Fix:** reword it, e.g. "Look around: scroll with two fingers (or the mouse wheel) to move, pinch or Ctrl+scroll to zoom. To drag the canvas, hold Space or pick the ✋ Hand tool (H)."

**N5. One Ctrl+V can place two boxes.**
- **Where:** `canvas.mjs:2650-2665` `onPaste` never checks `ev.defaultPrevented`.
- **Why:** `intake.mjs:376-385` listens on `#lolcomputer`, so it runs first, adopts a pasted picture and calls `preventDefault`. The canvas's document-level listener then still reads `text/plain` and creates a Text box.
- **Scenario:** a clipboard carrying a picture file *and* text, such as cells copied from Excel (a bitmap plus tab-separated values), or a picture with its caption from Word. Ctrl+V on the canvas gives an Image box **and** a Text box.
- **Fix:** `if (ev.defaultPrevented) return;` at the top of `onPaste`, and the same in `onBeforePaste`.
- **Test:** dispatch a `paste` whose `DataTransfer` carries an image File plus `text/plain`; exactly one box appears.

**Count: 0 blocker · 1 major · 4 minor.** Both rig checks are still owed (A1 on the farm; A8 at 4 of 5).

## The smallest fix set that would make me HAPPY

One builder can do all of it. The files do not overlap with anything open. The harness gets one new scenario and the probes above become tests.

1. **N1, fit.** Touches `graph/parts/instruction.mjs`, `css/graph.css` (the Instruction rows), `tutorial/lessons/00-tour.mjs`, `01-hello-farm.mjs`, `02-wires.mjs`, `templates/research-problematic.mjs` (sizes only where still needed), and the Title CSS or data.
   - Put Model and Answer shape on one row.
   - Fold the seed field and the last-run line into one row.
   - Test: a new `k9-fit` scenario opens every lesson, every template and a legacy document at the pre-R1 defaults, and finds no box body that scrolls and no prompt under 60 px.
2. **N2.** In `canvas.mjs` `openZoomMenu`, place the floating menu below the chip in window coordinates; drop `translateY(-100%)` in `graph.css`. Test: the menu is inside the window.
3. **N3.** A `setSettings(…, {stale:false})` option in `model.mjs`, used by Keep in `instruction.mjs` when `stats.seed === value`. Test: Keep, then Run all, sends 0 requests.
4. **N4.** Reword step `s-look` in `00-tour.mjs`.
5. **N5.** Add the `ev.defaultPrevented` guard to `onPaste` and `onBeforePaste` in `canvas.mjs`, with a unit or harness test.
6. **Rig session** (owner or rig checklist):
   - A pinned seed twice gives the same text, and two seeds give different text, on `gemma4:12b` through LiteLLM.
   - Each Write-… preset (SVG, p5, three, HTML) draws in at least 4 of 5 runs, with "new each run".

With 1–5 landed, green gates and a passing rig session, I would sign off.
