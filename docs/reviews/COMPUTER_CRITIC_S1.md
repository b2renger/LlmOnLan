# The Computer: critic report, series S, round 1 (2026-09-25)

**Verdict: NOT YET.** 0 blocker · 6 major · 10 minor.

The R-series fixed what the owner reported. S1 hunted what it missed. It found two families.

**1. After a run that did not do what was asked, the Computer says it did, or says nothing true.**
- **S1-1:** a run that was refused says every box is up to date. Its "Run everything again" then
  re-rolls boxes that were already finished.
- **S1-2:** the run bar's sentence stays after the run it describes.
- **S1-3:** a thinking model can spend the whole answer budget before writing a word.
- **S1-4:** when that happens, its unfinished thoughts come back as the answer.

**2. Two lesson steps cannot be done as they are written.**
- **S1-5:** lesson 2 says to drop the wire "onto the box". That makes no wire.
- **S1-6:** lesson 3 says to "click the arrow and type". That runs shortcuts instead.

## How this was checked

- **Code:** HEAD `1f584f0` (a doc commit on top of `8b84a7d`; no code change since R4).
- **Gates, re-run:**
  - `chat-unit`: 1493 passed, 0 failed.
  - `chat-lint`: 219 files, 0 violations.
- **Throwaway probes, real input, slot 7:** files `zz-critic-s1-{a..e}.mjs`, now deleted.
  - **Input:** CDP mouse and keys. Clicks on Run all, ▶, "Run everything again" and "Show me";
    typing into a prompt; Tab and Delete; drags from a port.
  - **Hidden window:** `h.setPageVisible(false)`, the hook the rig used.
  - **Mock:** `mock-echo`; nothing reached a real farm.
  - **Screenshots** (gitignored): `generated/shots/zz-critic-s1-*.png`.
- **Two read-only sweeps** covered docs against code, and lessons and menus against code. Every item
  below was re-checked in the code by me, and the lesson items were proven with real input.
- **Rig input:** the integrator's gemma4:12b run (09:03) gave the facts behind S1-3 and S1-13. I
  verified the code side of both.
- **Not re-reported:** anything R1–R4 fixed. R4-1, R4-2 and R4-3 are fixed:
  - `condition.mjs:136` sets `minH: 256`;
  - `insModelAutoNamed`;
  - `undo.mjs:102-110`.

## Findings

### Major

**S1-1. A run refused because the window was hidden reads "Nothing to run — every box is up to
date". It offers "Run everything again", which re-rolls the boxes that were already done.**
- **Where:**
  - `app/ask.mjs:222` refuses with `fail('busy', t('ask.hidden'))`.
  - `graph/parts/instruction.mjs:60` throws `parts.errBusy` and drops that sentence. The copies at
    `condition.mjs:113` and `filter.mjs:100` do the same.
  - `graph/runner.mjs:870, 900-906` makes it `yielded:true`, sets the box to `stale` with
    `error:null`, and discards the message. Nothing on the box says why.
  - `computer/runbar.mjs:109-115`: `nothingRan()` ignores `yielded`.
  - `computer/runbar.mjs:435-445`: `sayOutcome()` ignores `yielded`, `capped` and `limited`.
  - `computer/host.mjs:417-428` announces twice. The second `if` overwrites the first, so it says
    `runNothing` or `runDone` right after `runBusy`, `runErrors` or `runStopped`.
- **Probe:**
  1. Two Instructions, both run and done. Edit one, so it is stale. Hide the window. Click Run all.
  2. The report is `{ran:0, yielded:true}`, and 0 requests went out.
  3. The bar says **"Nothing to run — every box is up to date."** and shows **Run everything
     again**. The live region says **"Nothing to run — every part is up to date."**
  4. Show the window and click Run everything again. **2 requests** go out: the finished box is
     re-rolled too (seed 558620 → 894694) and loses its answer.
- **Same overwrite, other probes:**
  - A run with no farm leaves an Instruction in `error`, and the live region still says "Nothing to
    run…".
  - A hidden run where a Text box ran says "1 parts ran in 0.0s".
- **Correct behaviour:**
  - The bar says: "Paused: this window was in the background, so nothing was sent to the farm.
    Press Run all to carry on." When the seat was taken, it says "The farm was busy…".
  - Run everything again appears only after a run that truly found nothing to do.
  - Each run gets one sentence, the same in the bar and in the live region.
- **Fix:**
  - `graph/parts/common.mjs`: add one `failFromAsk(res)` to replace the three copies. It passes the
    ask's own `error.message` through for `busy`, `no_farm` and `no_vision` (see S1-7 and S1-13).
  - `app/ask.mjs:222`: return `{kind:'busy', hidden:true}`, so every control path stays the same.
  - `graph/runner.mjs`: the report gets `yieldedBy: {partId, message, hidden}`, taken from the first
    control failure.
  - `computer/runbar.mjs`:
    - add an exported, pure `outcomeOf(report)` that returns one string key and its vars;
    - `nothingRan()` answers false for a yielded report;
    - `sayOutcome()` uses `outcomeOf`.
  - `computer/host.mjs` `start()`: one `if/else` over the same outcome, and a plural for `runDone`.
- **Tests:**
  - **Unit:**
    - `nothingRan({ran:0, yielded:true}) === false`;
    - `outcomeOf` for every report shape: yielded (hidden and busy), errors with ran 0, cancelled,
      capped, planned limit, and nothing to do;
    - `failFromAsk` keeps `ask.hidden`.
  - **Scenario `k10-run-outcomes`:** the probe above. It asserts:
    - the hidden sentence is shown;
    - Run everything again is hidden;
    - `said()` is not `runNothing`;
    - once the window is visible, Run all sends exactly **1** request and the done box keeps its seed.

**S1-2. The run bar's sentence outlives its run. It says "every box is up to date" next to a stale
box, and after a ▶ run.**
- **Where:** `runbar.mjs:447-457`. Only `runAll()` writes the sentence or clears it.
  - Nothing clears it: not ▶, not the toolbar's Run, not a Button face, not an edit.
  - "Waiting for Dialog" from `showWaiting()` stays up for good too.
- **Probe:**
  1. Run all twice: the bar says "Nothing to run…", which is right.
  2. Type " Again." into the prompt. The box turns `stale` and Run everything again hides, but **the
     sentence stays**.
  3. Click the box's ▶. The run ends `done`, and the sentence **still** stays.
- **Fix:** in the runner listener (`runbar.mjs:470-490`):
  - `say('')` on `start`;
  - `say(outcomeOf(report))` on `done`, whatever door started the run;
  - clear the sentence in `paintNow()` when `doc.rev !== reportRev`;
  - drop the `runAll`-only call.
- **Test:** the probe as a scenario. After the edit the status is empty; after ▶ it shows that run's
  outcome.

**S1-3. Thinking models spend the answer budget on thinking.** On the rig, gemma4:12b drew SVG 2/5
and p5 1/5, and the box then gave the wrong advice.
- **Where:**
  - `graph/bind.mjs:61-62` sets `MAX_TOKENS_CODE = 4096` and `MAX_TOKENS_TEXT = 2048`.
  - `reasoning_content` counts toward `max_tokens`. All 7 failures ended at 4493–4551 tokens with
    `finish_reason: length`.
  - `ctx/budget.mjs:233` `budgetFor()` always reserves 4096 tokens, whatever `max_tokens` is.
  - `errCutOff` says "Ask for something smaller" (`computer-gen.en.mjs:32`), which is wrong when
    the tokens went on thinking.
- **Fix:**
  - **The cap:** a ceiling, not a target. Code gets 16384; prose, list and json get 8192.
    - The number sent is `min(ceiling, trustedBudget(caps) − estimated prompt tokens − 256)`, with
      a floor of 512.
    - It is resolved once, in `planFor`, into `plan.call.maxTokens`. The Sent tab's `genTxParams`
      and the cut chip already read that field.
  - **The reserve:** `budgetFor(caps, {reserve: maxTokens})`, in both `planFor` and `planNow`.
  - **Flag the case:** `app/ask.mjs` adds `thought:true` when `finishReason === 'length'` and the
    content is empty or under about 10 % of the characters.
  - **The message:** a new `parts.errCutOffThinking`: "The model used all {n} tokens thinking
    before it finished. Run it again, or pick a model that thinks less in Model." Use it at
    `instruction.mjs:573, 584, 597`.
- **Tests:**
  - **Unit:** the clamp, e.g. a 16k slot and a 10k prompt give about 6k, never below 512; the
    reserve follows `maxTokens`.
  - **Mock:** a new `mock-think-length` sends reasoning only, then `finish_reason: length`. A code
    Instruction must end with `errCutOffThinking`.
  - **Rig:** on gemma4:12b, SVG, p5 and three each draw at least 4 times out of 5. Qwen3.8 stays
    at 5/5.

**S1-4. A thinking model cut off before it writes returns its unfinished thoughts as the answer.**
- **Where:**
  - `app/ask.mjs:529-541`: `text()` takes `raw = rawOf(content, reasoning)`. With empty content it
    returns the **reasoning** as `ok:true` with `finishReason:'length'`.
  - `attempt()` at `:427-432` does the same, then runs `extractJson` over the thoughts.
- **Scenario:**
  1. A prose Instruction on a thinking model uses up its tokens while still thinking.
  2. `instruction.mjs:578` makes the thoughts the box's value, and the box shows the cut chip.
  3. Every box downstream now reads the thoughts.
  4. A list or json Instruction can even parse an object the model was only *considering*.
- **Why it matters:** F8 ("JSON in `reasoning` with empty `content` has answered") holds for `stop`.
  It does not hold for `length`.
- **Fix:**
  - When `content.trim()` is empty and `finishReason === 'length'`, return `fail('empty',
    t('ask.cutThinking'))` with `finishReason:'length'` and `thought:true`. Never return the
    reasoning as the value.
  - The Instruction maps this to `errCutOffThinking` (S1-3).
- **Tests:**
  - `mock-think-length` on a prose Instruction ends in `error`, with **no value**.
  - Unit: a fake generation `{content:'', reasoning:'…', finishReason:'length'}` gives `ok:false`.
  - `mock-json-reasoning-only` (which ends with `stop`) still parses.

**S1-5. Lessons 2 and 4 say to drag the wire "onto the Instruction" or "onto the SVG box". A drop
on the box makes no wire and says nothing.**
- **Where:**
  - The step texts: `02-wires.mjs:58` and `04-draw.mjs:78`.
  - `canvas.mjs:2295-2301` wires only to `portUnder(ev)` (the 14 px input dot) or `d.snap` (within
    `SNAP_PX = 28`, `wires.mjs:25`).
  - When neither matches, nothing is announced.
- **Probe:** in lesson 2, drag from the Text box's dot to the middle of the Instruction's prompt.
  - Wires stay at 1.
  - The live region is empty.
  - The step stays at 0 of 4.
  - The tour words it right ("to the dot on the left edge", `00-tour.mjs:71`).
- **Fix:**
  - **Behaviour:** a wire dropped on a box's body connects to that box's first input that is free
    and accepts the kind. That is what the text promises, and what ComfyUI and tldraw do. A drop
    on nothing says "Drop the wire on a box's input dot" (new key in `computer-canvas.en.mjs`).
  - **Text:** both steps say "…onto the SVG box (its left dot)".
- **Test:** the probe as a scenario, in lessons 2 and 4. The wire exists and the step ticks.

**S1-6. Lesson 3 says "click the arrow … and type before". A click selects the arrow; the typed
keys are canvas shortcuts, and `f` runs Fit.**
- **Where:**
  - The step text: `03-labels.mjs:63`. The sticky `n_try` says the same at `:42` ("click an arrow to
    name it").
  - A press on the line only selects the arrow (`canvas.mjs:2141-2152`).
  - The name editor opens only from the "name me" pill, from F2/Enter (`:2503-2507`), or from the
    right-click menu.
- **Probe:** in lesson 3, click the busy street's arrow 20 % along its path, then type `before`.
  - The label stays `""`.
  - The live region says **"Fitted to the graph"**.
  - The step cannot be completed as written.
- **Fix:**
  - **Text:** in the step and in `n_try`: "click the “name me” tag on the arrow from the busy street
    (or select the arrow and press F2) and type before".
  - **"Show me":** for s2 and s5, reveal the pill, not the two boxes.
  - **Optional:** a printable key typed while exactly one arrow is selected opens its name editor
    with that key.
- **Test:** the probe as a scenario. Click the pill, type `before`, press Enter; the label is
  `before` and the step ticks.

### Minor

**S1-7. A farm that still needs its password shows "No farm is connected".**
- **Where:** `ask.mjs:219` refuses with `fail('no_farm', t('ask.keyMissing'))`. `instruction.mjs:59`,
  `condition.mjs:112` and `filter.mjs:102` then throw `parts.errNoFarm`.
- **Effect:** every box blames the connection, while the topbar shows the farm connected.
- **Fix:** `failFromAsk` (S1-1).
- **Test:** unit on `failFromAsk`.

**S1-8. "Show me" beside "1 question waiting" does not show the question.**
- **Where:** `runbar.mjs:315-327` only calls `canvas.select`. Its header promises that it "puts the
  canvas on the oldest one", and `canvas.reveal()` exists.
- **Probe:** a Dialog at (3000, 2000) is asking. Its box sits at (3260, 2088) before and after the
  click, off a 1004×707 canvas.
- **Fix:** call `c.reveal(partId)` and focus the answer field.
- **Test:** after the click, the box intersects the canvas.

**S1-9. Tab focuses and selects a box that is off screen, and the view does not follow. Delete then
removes a box nobody can see.**
- **Where:** `canvas.mjs:2570-2576` `onFocusIn`. The focus scroll is undone by `onCanvasScroll`
  (`:2437`).
- **Probe:** Text A at (40, 40), Text B at (3000, 2000).
  1. Click A's title, then press Tab.
  2. B has the focus and is selected, but it is still off screen.
  3. Press Delete: **B is gone**.
- **Fix:** when the focused box is outside the viewport, pan the least distance that brings it in.
- **Test:** the probe as a scenario.

**S1-10. A Timer plan that is refused before it starts says "The run stopped after 10 minutes."**
- **Where:**
  - `runner.mjs:1039-1044` sets `limited.planned`.
  - `canvas.mjs:680-712` `setLimited` ignores `planned`.
  - `computer.limitTimerPlan`, the sentence that has the arithmetic, is used nowhere.
- **Probe:** a Timer at 3600 s. The notice reads "The run stopped after 10 minutes." and the bar
  reads "Nothing to run — every box is up to date." (S1-1), after 0 ms.
- **Fix:** use `limitTimerPlan` with `minutes = reached/60000` and `limitMinutes = limit/60000`.
- **Test:** the probe as a scenario.

**S1-11. The two Export… and two Import… buttons of one graph disagree.**
- **Export, toolbar** (`canvas.mjs:489-495`):
  - "Include the values it has already computed" starts **unchecked**.
  - Its note "Pictures it has already made are saved inside the file" shows even when the box is
    unchecked.
- **Export, library card** (`library.mjs:617-636`): "Include results" starts **checked**, "default
  on (§7.6)".
- **Import:**
  - The library's Import… makes a new graph.
  - The toolbar's Import… **replaces** the open graph.
  - Its confirm says "This conversation already has {n} parts" (`graph.en.mjs:135`), in a
    Computer that has no conversation.
- **Fix:**
  - One default (on) and one label for both exports: the canvas reuses `computer.libExportValues`.
  - Show the pictures note only while the box is checked.
  - Rename the toolbar button "Replace from file…", and word its confirm "This graph already has
    {n} boxes…". Both go in new keys in `computer-canvas.en.mjs`.
- **Test:** open both export popovers; the boxes agree, and the note hides when unchecked.

**S1-12. Sentences that promise something that isn't there.** Each item was checked in the code.

| Sentence | Where | What is true | Fix |
|---|---|---|---|
| "…see lesson 10" / "Open lesson 10" | `computer.en.mjs:122-123` | Only lessons 0–4 ship, so the button is disabled forever (`canvas.mjs:730`) | Drop the lesson reference until `l10-loops` ships |
| "…copy the text into a Note" | `computer.en.mjs:127` | That box is called Text | "…into a Text box" |
| Condition: "Sends what arrives down Yes, No or Maybe." | `palette.en.mjs:34` | One output; it lets the value through only when the verdict matches the one chosen branch (`condition.mjs:137-139, 229-230`) | "Lets what arrives through when it reads as your chosen yes, no or maybe." |
| "That picture is {mb} MB once resized, over the {capMb} MB a box may carry" | `parts-image.en.mjs:17` | One string serves three checks (`intake.mjs:214, 225, 240`). A 40 MB PNG reads "40 MB once resized, over the 32 MB a box may carry": it was never resized, and a box carries 1 MB | Three keys: file too big to open, too many pixels, too big after resizing |
| Preview: "Kept your code… Unlock to draw it." | `parts-preview.en.mjs:51` | A Preview has no Unlock; its control is "Keep my code" | "…Press “Keep my code” again to draw it." |
| A newer file "needs a newer LOL Chat" | `graph.en.mjs:139` | This is the Computer; the library's version already says so (`computer.en.mjs:44`) | Name the Computer |
| Lesson 2, s4: "press ▶ on the Text box" with no farm | `02-wires.mjs:76`; the rail promises "You can still finish this lesson" | After using the saved answer, ▶ on the Text box re-runs the story, which fails again. The only way out, ▶ on the title, is never mentioned | Add the hint "No farm? Use the saved answer, then press ▶ on the title." |

- **Test:** a lint (or unit) rule that every "lesson N" mentioned in a string resolves in `LESSONS`.
  The rest are string edits.

**S1-13. Model names and seeds promised as facts.**
- **Vision.** Two sentences name one model and send the person to the farm:
  - `ask.noVision` (`ask.en.mjs:24`): "Switch the farm to a vision model (gemma4:12b)". The Instruction
    shows it through `failFrom`'s `errFarm` branch.
  - `parts.errNoVision` (`parts.en.mjs:64`): "It is serving {alias}".
  - But each Instruction has its own Model menu listing every farm model, and `{alias}` is this box's
    model. The `takes.*` rule is "the farm does not list X as able to see".
- **Seed.** The seed hints do not say where the sameness comes from:
  - `genSeedHint` ("the same inputs usually give the same answer") and `genSeedKeepTitle` ("the next
    run can give this answer again").
  - What is guaranteed is the in-window ask cache (`ask.mjs:340-357`).
  - Asking the farm again with the same seed gave identical answers on Qwen3.8, and different ones
    on gemma4:12b through Ollama (rig, 09:03).
- **Fix:**
  - `errNoVision`: "The farm does not list {model} as able to see pictures. Pick one that can in this
    box's Model menu." `failFromAsk` maps `no_vision` to it.
  - `ask.noVision`: drop the model id.
  - Seed hint: "A number: the same seed every time. While this window is open the Computer re-uses
    the answer it already has. Asked again, most models repeat it, but some still vary."
  - Keep: "Pin this seed: the next run re-uses this answer instead of asking again."
- **Test:** a unit check that no `ask.*` or `parts.*` string holds a model id.

**S1-14. The toolbar's "Run" is the run bar's "Run all" under another name.**
- **Where:** `canvas.mjs:408` sits under `runbar.mjs:178`. Both call `host.start()` with no options.
  The screenshot shows "Run all" directly above "Run".
- **Fix:** in `#lolcomputer`, hide `.graph-run` and `.graph-stop`; the run bar is the Computer's run
  door, and the chat surface keeps its buttons. Or label the toolbar button "Run all".
- **Test:** `#lolcomputer .graph-run` is not rendered.

**S1-15. Two keys that do the wrong thing.**
- **Ctrl+0 on AZERTY.** "Zoom to 100% (Ctrl+0)" does nothing on a French keyboard.
  - `canvas.mjs:2493` tests `ev.key === '0'`, and that key reports `à` there. Shift+1 and Shift+2,
    two lines below, use `ev.code` for exactly this reason.
  - Fix: `ev.code === 'Digit0'`.
- **Ctrl+Enter in a Dialog's multi-line answer.** It sends the answer, and it also reaches the
  canvas.
  - The canvas starts a Run before its typing guard (`canvas.mjs:2456`). The host refuses it and
    announces "The farm went to someone else…" (`host.mjs:386-396`), which is false.
  - Fix: `dialog.mjs:99-106` stops the key, and `host.mjs` announces a new "A run is already going."
- **Test:** unit on the key predicate; a scenario for the Dialog's Ctrl+Enter.

**S1-16. Docs that are now false.**
- **`docs/LOLCHAT_COMPUTER_TUTORIAL.md`** describes the Computer before K1. Rewrite it; patches will
  not do. It says:
  - it is a panel in a chat, opened with Ctrl+1;
  - the menu has eleven parts, with the old names Note, Ask, Render and From/To thread;
  - there are no image parts;
  - values open in the chat column;
  - there is one folder per thread;
  - troubleshooting starts with "open a chat".
- **`docs/COMPUTER_STATUS.md`:**
  - L92: "a pinned seed gives the identical answer twice through LiteLLM" is true on Qwen3.8 only.
  - L166-167 and L200: "a wired Image goes to the farm's vision model (your gemma4:12b)". It goes to
    the box's model, which on Automatic is the farm default, Qwen3.8.
  - L77-79, 278, 287, 290-291: rig steps that assume gemma4.
  - L198: the fourth ceiling is not "a cache salt"; it is `maxActivations` = 2000.
- **`docs/LOLCHAT_PLAN.md` addenda.** Mark these superseded in place:
  - KE-3 L3311-3314: the code rules ride the system message now.
  - KD-6 L3118-3119: "Open live" was not built.
  - KD-4 L3072-3073: a click selects; a double-click edits.
  - KF-5 L3599, 3610-3612: a PDF over 60 pages is refused, not cut, when the page count is known.
  - KF-2 L3556-3557: see S1-13.
  - KC-9 L2847-2855: parks are real.
- **`docs/COMPUTER_DEBUG_LOG.md`:** correct. Only four event kinds are missing from its table:
  `ui.auxclick`, `mark.cancelled`, `log.full` and `sbx.log-dropped`.

**Looked at and fine:**
- **The perf pass.** `content-visibility:auto` breaks no measurement, hit test, focus, menu or
  tooltip inside a box: none is fixed-position, and none sticks out more than 16 px. The only thing
  it clips is the image and file port glyphs (7.5 and 7.1 px wide), which lose about 1.5 px at their
  outer edge. That is cosmetic and not listed. The `POSITIONS` index verifies every hit.
  `BIG_RUN` only adds a yield.
- **The library card.** Its meta for the open graph stays in step with the canvas: it updates 400 ms
  after an edit, and after a run.
- **Every other keyboard shortcut, right-click menu and ＋ menu name** matches its handler.

## Builder packages (file ownership does not overlap)

### Package A: run outcomes, asks and sentences (S1-1, 2, 3, 4, 7, 8, 12, 13, S1-15 Dialog half)
- **Owns:**
  - app: `app/ask.mjs`, `ctx/budget.mjs` (only if `budgetFor` must change)
  - graph: `graph/runner.mjs`, `graph/bind.mjs`,
    `graph/parts/{common,instruction,condition,filter,dialog}.mjs`
  - computer: `computer/host.mjs`, `computer/runbar.mjs`, `computer/intake.mjs`
  - strings: `strings/{ask,graph,computer,computer-gen,parts,parts-image,parts-preview,palette}.en.mjs`
  - `shell/test/mock/scenario-models.js`, to add `mock-think-length`
  - new files: `shell/test/chat/unit/computer-s1.test.mjs` and
    `shell/test/chat-harness/scenarios/k10-run-outcomes.mjs`
- **Acceptance:**
  - `chat-unit` and `chat-lint` green; `--phase k8`, `--phase k9` and `--phase k10` green.
  - S1-1: the hidden sentence, no Run everything again, `said()` is not `runNothing`; then 1
    request, and the done box keeps its seed.
  - S1-2: the status clears on an edit and reports after ▶.
  - S1-3 and S1-4, on `mock-think-length`: `errCutOffThinking` and no value. The Sent tab shows the
    clamped `max_tokens`.
  - S1-8: after "Show me" the Dialog intersects the canvas.
  - The unit checks of S1-1, S1-7, S1-12 and S1-13 pass.
  - **Rig (integrator):** gemma4:12b draws each Write-… preset at least 4/5; Qwen3.8 stays at 5/5.

### Package B: canvas, lessons, library and docs (S1-5, 6, 9, 10, 11, 14, 16, S1-15 Ctrl+0 half)
- **Owns:**
  - `graph/canvas.mjs`
  - `computer/library.mjs`
  - `computer/tutorial/lessons/*.mjs`, including the S1-12 lesson 2 hint
  - `css/graph.css` and `css/computer-*.css`
  - `strings/computer-canvas.en.mjs`: any new canvas words go here, never in a Package A file
  - `docs/LOLCHAT_COMPUTER_TUTORIAL.md`, `docs/COMPUTER_STATUS.md`, `docs/COMPUTER_DEBUG_LOG.md`
  - `docs/LOLCHAT_PLAN.md`, for annotations only
  - new file: `shell/test/chat-harness/scenarios/k10-canvas-lessons.mjs`
- **Acceptance:**
  - `chat-unit`, `chat-lint` and `--phase k8`/`k9`/`k10` green, and `rule 15` (lessons) green.
  - S1-5: a drop on the box body wires it; in lessons 2 and 4 the step ticks. A drop on nothing is
    announced.
  - S1-6: pill click, type `before`, Enter gives label `before` and the step ticks. "Show me" puts
    the pill in view.
  - S1-9: after a real Tab, the off-screen box intersects the canvas.
  - S1-10: a Timer at 3600 s shows the `limitTimerPlan` sentence.
  - S1-11: both export boxes default on.
  - S1-14: no second "Run" in `#lolcomputer`.
  - S1-15: Ctrl+0 works by `ev.code`.
  - The changed doc lines are re-read against the code.

**Order:** A and B can run in parallel. Package A's `outcomeOf` is the only sentence the run bar
speaks, and B's canvas notice (S1-10) is separate from it, so neither waits for the other.

## Notes for the re-review (S2)
- Re-run the five probes above as the new scenarios. Check that "Run everything again" never
  appears after a refused, capped or limited run.
- Watch for the risk in S1-3: `max_tokens` above the slot. The clamp must hold on a 16k farm with
  `parallel 2`.
- The rig results for gemma4 and Qwen3.8 decide S1-3.
