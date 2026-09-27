# The Computer: critic report, round 1 (2026-09-24)

**Verdict: not ready for the owner's next session.** The eight reported problems are real, and most have one
root cause in code. Two of them were never going to work as shipped:
- Every Instruction answer is capped at **512 tokens**, silently. That is enough to break most p5, three.js and SVG answers.
- A re-run returns the **cached answer, bit for bit**. That includes a broken one, so pressing ▶ again replays the failure.

Neither shows in the harness. The harness never drives a real mouse and never talks to a real model.

Baseline at review time: `node shell/test/chat-unit.js` 1395 passed, 0 failed · `node shell/test/chat-lint.js`
0 violations. Branch `lolchat/vnext`, working tree includes the uncommitted K7 debug-log files.

**How the claims were checked.**
- Items 1, 2 and 8 were proven in Node with throwaway probes against the real modules:
  - `ask.text` sends `max_tokens: 512` and no `seed`/`temperature`.
  - A second identical ask sends **no** request (`cached:true`).
  - `finish_reason:"length"` comes back as `ok:true` with no flag.
  - Inline substitution turns "The topic of the essay is {topic}. Stay on topic." into "The cats of the essay is cats. Stay on cats."
  - `sanitizeSvg` passes an SVG with no `xmlns`, and an undeclared `xlink:`, through as `ok:true`.
  - A p5 answer fenced as ```html becomes the whole HTML document as the "sketch".
- Items 6 and 7 rest partly on Chromium's pointer-capture behaviour. I could not run Electron this round, so
  those are marked **(real-input probe required)**. The fix plan includes the harness helper that proves them.

---

## Part A: the owner's list

### A1. "When we rerun we need a new seed; we always get the same results; we want control about the seed"

**Root cause.** Three things stack.
1. **The request has no seed and no temperature.** `app/ask.mjs:187` builds `params = { max_tokens }` only. The
   whitelist in `net/request.mjs:26` already allows `seed` and `temperature`, but nothing ever sets them.
2. **Every re-run is served from the in-memory ask cache.**
   - The runner forces `cache: opts.cache !== false`, i.e. true (`graph/runner.mjs:290`, applied in `meteredAsk` `:467-475`).
   - Nothing on the Computer ever passes `cache:false`: `computer/host.mjs:284-291` `onRun`/`onPlay`/`onRaiseCap`, the run bar, the debug door.
   - The cache key is (farm, model, system, prompt, images, schema, maxTokens, salt) (`app/ask.mjs:309-324`). With no seed in it, ▶ on an unchanged Instruction hits `ask.mjs:475-479` and returns the *same* `AskResult` with `cached:true`, costing 0 generations.
   - Iteration 1 is deliberately unsalted (`runner.mjs:745-747`).
   - The cache is per window (`CACHE_CAP` 32), which is why answers only "change" after an app restart.
3. **Run all never re-runs a finished box.** `activeSet(...,{mode:'all'})` is the dirty closure (`graph/topo.mjs:453-465, 525`): a
   `done` part whose upstream is `done` is skipped. The bar then says "Nothing to run — every box is up to date"
   (`runbar.mjs:402`). There is no "run again" affordance at all.

**Correct behaviour.**
- ▶ on an Instruction, or a Run that re-executes it, makes a **new generation with a new seed**. That is the default, "New each run".
- A person can **pin a seed**, typing one or keeping the one that produced an answer they liked. The same seed on the same inputs gives the same answer, and may come from the cache: it is deterministic, so that is honest.
- A fan-out and a loop still give *different* generations per item and iteration, reproducibly under a pinned seed.
- Stop, yield and cap still "keep what you paid for": resuming a half-done fan replays the finished items for free.
- Run all with nothing stale offers **"Run everything again (new seeds)"** instead of a dead end.

**Fix plan (Package A).**
- `graph/parts/instruction.mjs` defaults: add `seed: ''`. `''` means new each run; a non-negative integer string means pinned. `defaults()` must list it, because `serialize` only exports declared keys.
- Seed UI: a compact row "Seed [ new each run ] 🎲 ✕" (🎲 pins a random number, ✕ goes back to new-each-run). After a new-each-run run, a chip "seed 48213 · keep" writes that number into `settings.seed` (one undo entry).
- `graph/runner.mjs`:
  - Mint `runNonce` per `run()` with `crypto.getRandomValues`.
  - Compute `seed` per activation and hand it to `spec.run(input)` as `input.seed`:
    - pinned `s`: `(s + k*7919 + (iteration-1)*104729) >>> 0`, so k=0 and iteration 1 is exactly `s`;
    - new each run: `hash32(runNonce, partId, k, iteration)`.
  - Keep a runner-lifetime `carry: Map<partId, runNonce>`. Set it when a part ends `yielded`/`capped`/`cancelled`; the next run uses the carried nonce for that part and deletes it on completion. That is what keeps "Stop keeps what you already paid for" true.
  - `meteredAsk` passes `given.seed` through untouched.
- `app/ask.mjs`: `normalise` accepts `seed` (uint32) and an optional `temperature`; `cacheKey` adds `seed`; `buildBody` sends it (PARAM_KEYS already allows it; LiteLLM maps it to Ollama `options.seed` and llama-server `seed`).
- `graph/parts/instruction.mjs` `run()` passes `seed: input.seed` in `call`, and records the seed actually used. Add `seed` to the `stats` normalisation in `graph/model.mjs` `patchPart`, `:~404`, or it is dropped.
- `graph/bind.mjs` `planFor`: `call.seed` is `'new each run'` or the number, so the transcript's declared request says it.
- `computer/transcript.mjs`: the call line shows `seed: 48213`, and whether the seed is pinned.
- `computer/runbar.mjs`: when `sayOutcome` would print `runNothing`, show a button **Run everything again** that runs `run({force:true})`. `force` exists in `activeSet`; it still excludes manual Buttons and inert parts.
- Rig check (add to the rig checklist): a pinned seed twice on `gemma4:12b` gives identical text, and two seeds give different text. With `OLLAMA_NUM_PARALLEL>1`, batched decoding can differ slightly, so the UI hint says "usually identical".

**Tests.**
- Unit, `computer-seed.test.mjs` (fake fetch): two ▶ in new-each-run mode make **2 requests** with different `seed`, none `cached`; pinned makes 1 request then a cached replay; a Repeat ×4 fan gets 4 distinct seeds (the same 4 when pinned); a yield mid-fan then a resume re-uses the carried nonce, so finished items are `cached`. Ask: the body carries `seed` and the cache key differs by seed.
- Harness: ▶ twice on an Instruction against the mock farm. The mock echoes the seed, and the two values must differ.

### A2. "What does 'substitute short values in place' mean? We need a better name"

**What it does.** `strings/parts.en.mjs:38` labels the `inlineVars` checkbox (`instruction.mjs:231-244`).
- When it is on, `assemblePrompt` (`bind.mjs:320-321`, `canInline` `:380-386`) removes a labelled input's `## heading` block from `# Inputs`, if that input is one short text value (≤200 chars, `INLINE_MAX`) that the instruction mentions.
- It then writes the value **into the instruction wherever the label appears**.

**The defect behind the confusion.**
- `rewrite()` replaces **every bare-word mention**, not only `{name}` (`bind.mjs:414`: `to = tgt.value` for braced *and* bare forms).
- Probe result: label `topic` = "cats" turns *"The topic of the essay is {topic}. Stay on topic."* into *"The cats of the essay is cats. Stay on cats."*
- So the option both has an opaque name and corrupts prose.
- The checkbox also has no tooltip, and it is shown even when no input is named in the instruction.

**Correct behaviour, name and hint.**
- Only the explicit `{name}` / `$name` forms are filled; a bare word is never replaced.
- Label: **"Fill in {names} with their values"**.
- Hint (the `title` and a one-line helper): *"Where your instruction writes {topic}, put the topic's text right there instead of listing it under Inputs. Only for short text (up to 200 characters)."*
- Hide the row unless at least one braced name is bound.

**Fix (Package A).** `bind.mjs`: `rewrite` substitutes braced forms only when inlining, and `canInline` requires a braced mention (a `mentionedBraced` flag on `BoundParam`). `parts.en.mjs`: `insInline` plus a new `insInlineHint`. `instruction.mjs`: set the title; hide the row when no braced name is bound.

**Tests.** `computer-bind.test.mjs`: the topic/cats sentence stays intact apart from `{topic}`; a bare mention with inline on is still listed under `# Inputs`; a braced mention is filled and not listed.

### A3. "We want to be able to resize boxes and prompts and text fields"

**What exists.**
- `graph/model.mjs:364-372` `resizePart` exists, clamps to at least 80×60, and is unit-tested. **No UI calls it**; only a test imports it.
- Boxes size via `style.minHeight = part.h` (`canvas.mjs:1413`), so content silently grows a box past `part.h`. The consequences:
  - ports sit at `portOffsetY(part.h)`, set **once** in `makeBox` (`canvas.mjs:1352-1369`) and never re-laid-out in `syncBox`;
  - `fitView` and `marqueeHits` use the stored `h`, so Fit cuts the bottom off tall boxes, and a marquee over the lower half of a tall box misses it.
- Text fields:
  - the Instruction prompt gets the generic `resize: none` (`css/graph.css:338-349`);
  - the Text source (`computer-text.css:85`) and the Preview code (`computer-preview.css:222`) have a native `resize: vertical` grip, but what it changes is **never saved** and moves no port.
- Copy/paste drops size. `toClipboard` writes `{i,type,x,y,settings}` with no `w/h` (`canvas.mjs:227-229`), so a pasted "p5.js sketch" (380×520) comes back as a 320×260 Preview.

**Correct behaviour.**
- Every box has a bottom-right resize handle, like tldraw: drag it, and one undo entry records the new `w/h`.
- The box is **exactly** `part.h` tall. Its main field (prompt, text, code, picture) grows and shrinks with it and scrolls inside.
- Ports and wire ends follow the new height.
- Copy/paste and duplicate keep the size.

**Fix plan.**
- Package B, `canvas.mjs`: a `.graph-part-resize` handle in `makeBox`; a drag kind `resize` that live-sets `node.style.width/height` and the port tops, then applies `resizePart` with `{label:'resize'}` on pointerup; `syncBox` sets `height` (not `minHeight`) and re-positions the ports when `last.h` changes; `toClipboard`/`fromClipboard`/`pasteText` carry `w/h`. Optional: Alt+Shift+arrows resize by the grid.
- Package B, `css/graph.css`: `.graph-part-body{flex:1 1 auto; min-height:0; overflow:auto}`. The Instruction textarea `.graph-ins-instruction{flex:1 1 auto; min-height:48px}` grows with the box.
- Package C, `computer-text.css`/`computer-preview.css`: remove the native `resize: vertical` grips (one handle, on the box); the source, body and code fields take `flex:1 1 auto; min-height:0`.

**Tests.** Unit: a pure `resizeRect(start, dx, dy, zoom, min)` (snap, minimum); a clipboard round trip keeps `w/h`. Harness, real input: drag an Instruction's handle by (+80, +120), and the doc's `w/h` grow by that (snapped), `.graph-port[data-dir=in]` `style.top` equals `portOffsetY(newH)`, and one undo restores it.

### A4. "Better interaction with mouse and touchpad (pan, zoom seamless); tldraw has canvas tools"

**Audit of `graph/canvas.mjs`.**
- `onWheel` `:1721-1730`:
  - ctrl/meta+wheel zooms about the cursor via `zoomAbout` ✓. Pinch arrives as ctrl+wheel in Chromium, so it works.
  - Plain wheel and two-finger scroll pan ✓. This is tldraw's default "wheel = pan".
- **Defect, major: the canvas eats every wheel event** (`ev.preventDefault()` on line 1722, unconditionally).
  - Nothing inside a box can be scrolled with a wheel or a trackpad: not a Document box's extracted text (`max-height:220px; overflow:auto`), not a long Text answer (`max-height:320px`), not a Preview code editor, not an Instruction prompt.
  - The canvas pans instead.
  - Combined with A7, where a press on the scrollbar drags the box, long content is unreachable in the box.
- Zoom maths: `Math.exp(-deltaY/400)` for every device. A mouse notch (±100/120) gives ×1.28-1.35 (fine); a trackpad pinch sends small deltas and feels sluggish; nothing clamps a burst; `deltaMode` 1 (lines) is ignored for pan and zoom.
- Every ctrl+wheel event calls `announce(saidZoom)` (`:1726`). The live region churns through the whole gesture.
- Limits: `MIN_ZOOM 0.25`, `MAX_ZOOM 2` (`:51-52`). `fitView` clamps to 0.25, so **Fit cannot fit a graph more than 4× the viewport**: parts stay off-screen.
- Middle-drag pans ✓ (`:1574`, but no `preventDefault`); space+drag pans ✓ (`:1770`). **`spaceDown` sticks** if the key is released outside `root` or the window loses focus (`keyup` only on root, `:1793-1795`). After that, every left-drag pans forever, and the marquee and moving boxes die until Space is pressed again.
- There is no inertia problem. The OS supplies momentum wheel events, and there is one rAF per frame (good).
- Controls: the only zoom tools are "Fit" (the canvas toolbar and the `F` key) and the run bar's "100%" button, which **fits**, not 100% (`runbar.mjs:182-186`), and has no tooltip. There is no zoom in/out, no 100%, no zoom to selection, and no keyboard zoom.

**Correct behaviour.**
- A wheel over a box that can scroll in that direction scrolls the box; at its end, or over empty canvas, the canvas pans.
- Pinch and ctrl+wheel zoom smoothly with a device-appropriate rate.
- Fit always fits.
- Space-pan cannot get stuck.

**Fix plan (Package B, `canvas.mjs`).**
1. `onWheel`, when not a ctrl zoom: walk from `ev.target` up to `.graph-part`. If an element has `overflow-y/x: auto|scroll` and can still scroll in the delta's direction, **return without preventDefault**. Normalise `deltaMode` 1 to ×16 px.
2. Zoom: `d = clamp(deltaY * (deltaMode===1?16:1), -60, 60); factor = exp(-d/120)`, tuned with a real pinch logged by the K7 recorder. Announce the zoom once, 300 ms after the gesture ends.
3. `MIN_ZOOM 0.1`, `MAX_ZOOM 4`.
4. Reset `spaceDown` on `window` `blur`, on root `focusout` out of root, and on any pointerdown with `ev.buttons` where space is no longer held. `preventDefault` a middle-button pointerdown.
5. A zoom cluster in the canvas toolbar: `−` `%` `+`, where the % menu offers Zoom to fit · Zoom to selection · 100%. Keys: `Ctrl+=`/`Ctrl+-`/`Ctrl+0`, `Shift+1` fit, `Shift+2` selection (the tldraw bindings). The window has no menu (`win.removeMenu()`, `src/main/index.ts:417`), so these keys are free. The run bar's "100%" becomes the same menu or reads "Fit".

**tldraw-style tools, ranked by value per cost.**

| # | Tool | Value | Cost | Note |
|---|---|---|---|---|
| 1 | Zoom controls + zoom to selection + 100% + keys | high | low | pure view maths, `fitView` over the selection |
| 2 | Scroll inside boxes (the wheel fix above) | high | low | the owner's "seamless" |
| 3 | Resize handle (A3) | high | medium | |
| 4 | Duplicate `Ctrl+D`; paste at the cursor, not `+20` from the original (`canvas.mjs:1035`) | medium | low | today repeated pastes stack on one spot |
| 5 | Hand tool (`H`, and a toolbar toggle): left-drag on empty pans; the marquee is on Shift-drag or the Select tool | medium | low | for trackpad-only users who cannot middle-drag |
| 6 | Right-click menu on a box and on a wire (Duplicate · Delete · Run from here · Lock · Name wire · Delete wire) | medium | medium | also the answer to A5's discoverability |
| 7 | Snap/alignment guides while dragging | low-med | medium | |
| 8 | Minimap | low | medium | skip for now |

**Tests.**
- Unit, a pure `wheelIntent({deltaX, deltaY, deltaMode, ctrlKey}, scrollState)` returning `'scroll-inner'|'pan'|'zoom'` plus the factor; `fitView` of a 5000-px graph reaches below 0.25.
- Harness, real input: a wheel over a Document box with long text changes its `scrollTop` and not the view; the same wheel over empty canvas changes `view.y`; Ctrl+wheel keeps the world point under the cursor fixed (±1 px); Space down, window blur, release, then a left-drag on empty makes a marquee.

### A5. "We should be able to unplug a wire"

**What exists.**
- A press on empty canvas within `WIRE_HIT = 8` **world** units of a curve (`wires.mjs:21`) selects the wire (`canvas.mjs:1601-1613`). Delete/Backspace then removes it (`deleteSelection`, `:980-993`).
- The debug door's `unwire` (`host.mjs:495-505`) is not reachable by a person.
- It also bypasses `model.removeWire`: there is no `rev` bump and no stale marking of `to`, which drifts from the door's own promise, "Every entry is the SAME function the toolbar calls".

**Why a person cannot find it.**
- `.graph-wires` is `pointer-events:none` (`graph.css:147-154`), so there is no hover state and no cursor change.
- The hit band is 8 world units: 2 px at 25 % zoom.
- The **middle** of every wire, where people aim, is covered by the "name me" pill, which opens renaming.
- No string anywhere tells a person Delete works on wires.
- A drag from an **input** port does nothing wire-related: `onPointerDown` only starts a wire drag from `data-dir="out"` (`:1576`), so pressing an input port moves the box.

**Correct behaviour.**
1. **Drag the end off the port** (ComfyUI/tldraw feel). Pressing an input port that has a wire picks that wire's end up; the wire follows the pointer from its source.
   - Dropping it on another compatible input re-plugs it: one undo entry, remove plus add.
   - Dropping it on empty canvas unplugs it, with the live region saying "Wire from A to B removed" and an Undo hint.
2. **A hover affordance.** The wire under the pointer thickens, and its pill shows a small **✕** button that deletes. A selected wire shows the same ✕.
3. The hit band is in **screen** pixels: 8 px at any zoom, i.e. `WIRE_HIT / view.zoom`.
4. `debug.unwire` goes through `removeWire` and `session.apply`.

**Fix plan (Package B).**
- `canvas.mjs`: pointerdown on a wired `.graph-port[data-dir=in]` starts drag kind `rewire` `{wireId, from}`; pointermove reuses `wires.setPreview` from the source's out port; pointerup over an input or a snap target does `removeWire` + `addWire` in one `session.apply`, otherwise `removeWire` alone.
- Hover: a throttled `pointermove` with no drag runs `wireAt` and sets `data-hover` on the path and its pill.
- `wires.mjs`: add a `.graph-wire-x` button inside the pill (with `pointer-events:auto`, stopping pointerdown), shown when the wire is hovered or selected, calling `o.onDelete(wireId)`.
- `host.mjs:495-505`: use `removeWire`.
- `graph.en.mjs`: the ✕ title "Unplug this wire (Delete)", and `saidWireUnplugged`.

**Tests.**
- Unit, pure: `rewireOutcome(doc, wireId, target)` covers re-plug, unplug, and a refused type (the wire stays where it was, and the reason is announced).
- Harness, real input: drag from the input port of a wired Preview to empty space; `wires.length` goes down by one, and one undo restores it. Then hover the wire and click ✕.

### A6. "An issue with editing a textbox that was created before"

**Root cause (real-input probe required, high confidence).**
- A Text box that holds text shows its **rendered body**, not the textarea (`text.mjs:337-339`). Editing it depends on a `click` listener on `.graph-text-body` (`text.mjs:233-238`).
- A fresh, empty box shows its textarea directly, and that works. So the pattern is exactly "boxes created before can't be edited".
- Pressing the body goes through the canvas's part branch (`canvas.mjs:1580-1599`): the body is not "interactive", so the canvas calls `ev.preventDefault()` and then `canvas.setPointerCapture(pointerId)` (`:1622-1625`) on **every** press, even one that never moves.
- In Chromium, the `click` (and `dblclick`) that follows a captured press is dispatched to the **capture target**, the canvas. At best it goes to the common ancestor of the press and release targets, which is also the canvas.
- So the body's click listener never runs under a real mouse, and the box cannot be edited.
- **Side effect, same cause.** A double-click on a box's body produces a `dblclick` whose target is the canvas. `onEmptyGesture` (`:1827-1836`) tests `ev.target`, sees no `.graph-part`, and **opens the ＋ Add-a-box menu** on top of the box.
- **Why the tests are green.** `test/chat-harness/scenarios/k4-text.mjs:97-103` edits by calling `el.click()` directly on the body. That bypasses pointerdown and capture entirely. No scenario in `shell/test` drives real input (`sendInputEvent` / `Input.dispatchMouseEvent`: zero hits).
- **Secondary cause (logic, certain).** If a person edits the words of a Text box that has an incoming wire (an Instruction feeding it), the edit marks the box stale. The next Run re-adopts the upstream answer (`text.mjs:400-404`: `DISMISSED.delete(id); return adopt(arrivals)`), and the person's edit disappears. Only the Lock prevents that, and nothing tells them.

**Correct behaviour.**
- A single click selects a box.
- A **double-click on its text** opens the editor. So do Enter or F2 with the box selected, and an explicit **✎ Edit** button in the Text head.
- Selecting text with a drag does not open the editor.
- Editing a box that receives a wire either locks it automatically (tldraw's "my words win" behaviour) or says so, e.g. *"This box is fed by Write a poem; the next run replaces your edit. 🔒 Lock to keep it."* The owner decides; the default recommendation is **auto-lock on first keystroke when the box is wired in**, as one undo entry with the text.

**Fix plan.**
- Package B, `canvas.mjs`:
  - **Defer pointer capture and `preventDefault` until the pointer has moved `DRAG_SLOP`.** Record the press on pointerdown, then capture and preventDefault on the first move past the slop. A click without movement is then an ordinary click on its real target.
  - `onEmptyGesture` decides "empty" with `document.elementFromPoint(ev.clientX, ev.clientY)`, not `ev.target`.
  - New optional `PartInstance.edit()` (contract K-2): the canvas calls it on dblclick inside a part body and on Enter/F2 when exactly one part is selected and no wire is.
- Package C, `text.mjs`: `edit()` = `startEdit()`; a ✎ button in `.graph-text-head` (a `<button>`, so it works whatever the canvas does); the body click opens the editor only when `getSelection().isCollapsed`; the auto-lock or the notice (strings in `parts-text.en.mjs`). `preview.mjs` and `sticky.mjs` implement `edit()` as "focus the code / text field".

**Tests.**
- Harness, real input (K-6): place a Text box, type, blur (the body shows), double-click the body: the textarea is visible and focused and no palette is open. Enter on a selected Text box does the same. A single click on the body selects the part and opens no palette.
- Harness: Instruction → Text; run; edit the Text; run again; the edit survives (auto-lock) and `settings.locked===true`.
- Unit: `text.mjs` `edit()` exists and seeds from what is shown.

### A7. "We should be able to copy / paste texts from the boxes"

**Root cause.**
1. `.graph-part { user-select: none }` (`css/graph.css:271`) is inherited by every rendered body: a Text answer (which even advertises `cursor: text`, `computer-text.css:73`), a Markdown view, an error strip, and the Document text (which sets `user-select: text`, `computer-document.css:114`, but see 2).
2. A press on any of them runs the part branch of `onPointerDown`: `preventDefault` plus pointer capture plus a move-drag (`canvas.mjs:1593-1599`, `:1622-1625`). Chromium does not start a text selection from a cancelled press, and dragging moves the box. Pressing a scrollbar inside a box also drags the box.
3. **Ctrl+C is hijacked.** `onCopy` (`:1805-1812`) returns early only when a *form field* is focused. With a part selected and some rendered text highlighted, it replaces the clipboard with the parts' JSON.
- Typing fields (textareas, inputs) are fine: `isTyping` lets native copy/paste through, and `onPaste` only takes our own `lolgraph` payload.

**Correct behaviour.**
- Rendered text in a box is selectable with a drag and copied with Ctrl+C / right-click.
- The box is dragged by its title bar and its chrome.
- Ctrl+C copies **parts** only when no text is selected.
- Ctrl+V of plain text on the empty canvas creates a Text box at the cursor, as tldraw does. This is optional but cheap.

**Fix plan.**
- Contract K-1, "selectable zones" (see the work split).
- Package B: `onPointerDown` selects the part and returns when `target.closest('[data-selectable]')`; `onCopy` returns when `getSelection()` is not collapsed. Optional: `onPaste` of non-lolgraph plain text with no focused field places a Text box holding it.
- Package C: mark `.graph-text-body`, the Preview markdown body, `.graph-doc-text` and the error strips `data-selectable="text"`, with `user-select:text` in their own CSS files.

**Tests.**
- Harness, real input: drag across a Text body's words, and `getSelection().toString()` is non-empty and the part did not move; Ctrl+C then leaves that text on the clipboard (`clipboard.readText` in main); with a part selected and the selection collapsed, Ctrl+C still yields a `lolgraph` payload.
- Unit: the pure half's `shouldCopyParts({selectionCollapsed, typing})`.

### A8. "Write SVG, p5.js and three.js do not work; the model needs more and better instructions"

**Root causes, most damaging first.**
1. **Every answer is cut at 512 tokens, silently.**
   - `ask.text` sets `o.maxTokens = max(512, o.maxTokens||0)` (`app/ask.mjs:473`). The Instruction's `call` passes no `maxTokens` (`instruction.mjs:378-385`); `planFor` declares `maxTokens: null` (`bind.mjs:639`).
   - A p5 spiral is about 350-600 tokens, a "floating shapes + soft light" three.js scene 600-1000, and a landscape SVG 400-800. They are truncated mid-program.
   - `finish_reason:"length"` is dropped in `once()` (`ask.mjs:253-262`), so the answer is `ok:true`.
   - The transcript even prints `max_tokens: automatic` (`transcript.mjs:145`), which contradicts §8.1.
2. **A broken answer is cached, and ▶ replays it** (A1). The person retries and gets byte-identical failure.
3. **The model is never told the sandbox's rules.** The system message is the one prose `SYSTEM` for every shape (`bind.mjs:38`, `parts.en.mjs:19-23`). The `writeAsk*` strings (`parts-creative.en.mjs`) say only "code only, 400×300, no imports". These are the mismatches with what `sandbox/runner.html` and `unfence.mjs` require:
   - *Strict mode.* The code runs in `new Function('lol','"use strict";\n'+code)` (`runner.html:271`). An undeclared `angle = 0` is a ReferenceError.
   - *p5 globals do not exist at top level.* The sketch body runs **before** `new p5()` binds globals (`runner.html:271-274`, `startP5` `:247-253`). A top-level `color(...)`, `random(...)`, `PI` or `width` throws "X is not defined". Models write `const palette = [color(...)]` constantly.
   - *No loading.* `connect-src 'none'`, `img-src data: blob:`. `preload()` with `loadImage`/`loadFont`/`loadJSON` never resolves, and `setup` never runs, so the picture is blank. No `p5.sound`.
   - *No `new p5(sketch)`.* Instance mode without the guest's node appends the canvas to `<body>`, outside `#root` which is where the snapshot looks, and escapes `reset()` (it is not in `sketches`). The result is a blank picture and a sketch that keeps running into the next run.
   - *three.js must be plain JS.*
     - A full HTML page with an import map or a `<script type="module">` is run as JavaScript: "Unexpected token '<'".
     - Code that waits for `window.onload`/`DOMContentLoaded` never runs.
     - `renderer.setAnimationLoop(fn)`, or a `requestAnimationFrame(animate)` never called once synchronously, paints nothing before the snapshot: the guest frame sits at `left:-20000px` (`css/sandbox.css:9-17`), where Chromium throttles an off-screen cross-origin frame's rAF.
   - *SVG must carry `xmlns`.* It is shown as `<img src="data:image/svg+xml,…">`. Without `xmlns="http://www.w3.org/2000/svg"`, or with an undeclared `xlink:` prefix, the image is **blank with no error**, because `sanitizeSvg` passes both through (`svg-sanitize.mjs:399-409`, probe confirmed). `<animate>` is dropped (the picture is still).
   - *Answer shape.* A p5 answer fenced as ```html (a page with an inline `<script>`) is taken whole as the sketch (`unfence`'s longest-block fallback). The result is a SyntaxError.
4. **The box's Width/Height fields do not size the drawing.**
   - `drawInGuest` passes `{width,height}` only as `lol.params` (`preview.mjs:331`). The guest frame is fixed at 640×480 (`sandbox.css:13-14`), and the canvas default size, `lol.size` and `window.innerWidth` all report 640×480 (`runner.html:224-245`).
   - The fields only rescale the photo. A person who sets 800×600 gets a 640×480 drawing, scaled.
   - The HTML-mode picture also renders in the default serif font: `PAGE_CSS` puts the font on `body`, which the foreignObject clone does not contain (`preview.mjs:96-105`, `runner.html:341-347`).

**Fix plan.**
- Package A:
  1. `planFor`: `call.maxTokens` is 4096 when `settings.code` is a code kind, and 2048 otherwise. `ask.text`/`ask.json` honour it and **return `finishReason`**. An Instruction with a code kind whose `finishReason==='length'` throws `partFail(t('parts.errCutOff', {n}))`: *"The answer was cut off after 4096 tokens, so the code is incomplete. Ask for something smaller."* A prose answer gets a "cut off" chip instead. The transcript's call line prints the real `max_tokens`.
  2. **Kind-specific system instructions.** `planFor` sets `assembled.system = SYSTEM + '\n\n' + CODE_SYSTEM[code]` for the four code kinds, so the transcript shows exactly what is sent. The Write-… preset instructions shrink to the *task* only. The drafts are below.
  3. `unfence.mjs` `codeFor`/`codeValue` for `p5`/`three`: when the picked block starts with `<`, take the largest inline `<script>` without `src` and without `type="importmap"`. `svgOf`: nothing more is needed, since the sanitizer gains namespace repair.
  4. `design/svg-sanitize.mjs` `sanitizeSvg`: add `xmlns="http://www.w3.org/2000/svg"` to the root when it is missing. Add `xmlns:xlink` when any `xlink:` attribute survives.
  5. A friendly guest error, in `preview.mjs`'s message path. That file is C's, so A supplies a pure `explainGuestError(message, mode)` in `unfence.mjs`:
     - `/^(\w+) is not defined$/` where the name is a p5 function or constant: *"color is a p5 function: call it inside setup() or draw(), not at the top of the sketch."*
     - Any other name: *"Declare angle with let at the top."*
  6. Update `templates/creative-coding.mjs`'s Instruction to the short task. The lesson `04-draw` demo is unaffected.
- Package C:
  1. `sandbox/host.mjs` `run(req)` accepts `size:{w,h}` and sets the frame's width and height before posting `run` (contract K-4). `preview.mjs` passes `s.w/s.h`. Now `windowWidth`, `innerWidth` and `lol.size` equal the box's Width×Height, and the fields tell the truth.
  2. A first-frame flush in `runner.html` `doRun`: record the callbacks queued through the wrapped `requestAnimationFrame` during the run, and call each once synchronously before sending `ran`. They re-queue themselves. This makes rAF-only three.js, and p5's scheduled draw, photograph correctly. Keep the p5 trailer.
  3. In `THREE_PRELUDE` (`unfence.mjs`, **A's file**; C requests it through the contract), the renderer subclass wraps `setAnimationLoop(cb)` to call `cb(performance.now())` once. A does this edit.
  4. `PAGE_CSS`: move the `font` onto `#root`.

**Drafted system instructions (append to SYSTEM when `settings.code` is set; written for gemma4:12b).**

`CODE_SYSTEM.svg`
````
You write ONE still SVG picture.
Reply with exactly one ```svg code block and nothing else — no words before or after it.
Rules:
1. Start with: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300"> and end with </svg>.
2. Valid XML: every attribute in double quotes, every element closed (<circle ... />).
3. Use only: rect, circle, ellipse, line, polyline, polygon, path, text, g, defs, linearGradient, radialGradient, stop, clipPath, mask, pattern, filter.
4. No <script>, no <foreignObject>, no <image>, no links, no web fonts, no animation (<animate>, <set>). It is a still picture.
5. Colours as #rrggbb. At most 80 elements.
Example:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
  <rect width="400" height="300" fill="#f5efe4"/>
  <circle cx="300" cy="80" r="40" fill="#f2b134"/>
  <path d="M0 240 Q100 150 200 225 T400 210 V300 H0 Z" fill="#5b8c5a"/>
</svg>
```
````

`CODE_SYSTEM.p5`
````
You write ONE p5.js sketch (p5.js 1.11, global mode). p5 is already loaded. There is no network.
Reply with exactly one ```javascript code block and nothing else.
Rules:
1. Plain JavaScript only: no HTML, no <script>, no import, no require, no new p5(...).
2. Define function setup() and function draw(). The first line of setup() is createCanvas(windowWidth, windowHeight).
3. At the top of the file only declare variables (let x;). Call p5 functions and use p5 constants (random, color, width, PI…) only inside setup() and draw().
4. Declare every variable with let or const.
5. Do not load anything: no preload, no loadImage, loadFont, loadJSON or loadSound. Draw everything with code. No p5.sound.
6. The first frame is saved as a picture: draw() starts with background(...) and paints the whole scene.
Skeleton:
```javascript
let t;
function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(HSB, 360, 100, 100);
  t = 0;
}
function draw() {
  background(230, 30, 15);
  // draw the scene here, using width and height
  t += 0.01;
}
```
````

`CODE_SYSTEM.three`
````
You write ONE three.js scene (three.js r160). THREE is already a global. There is no network.
Reply with exactly one ```javascript code block and nothing else.
Rules:
1. Plain JavaScript only: no HTML, no <script>, no import, no import map, no addons (no OrbitControls, no loaders), no textures or files.
2. Do not wait for window.onload or DOMContentLoaded: run everything at the top level.
3. Size: const W = window.innerWidth, H = window.innerHeight.
4. Build: scene, PerspectiveCamera(50, W / H, 0.1, 100), renderer = new THREE.WebGLRenderer({ antialias: true }), renderer.setSize(W, H), document.body.appendChild(renderer.domElement).
5. MeshStandardMaterial needs light: add an AmbientLight and a DirectionalLight.
6. Call renderer.render(scene, camera) once, then animate with requestAnimationFrame.
Skeleton:
```javascript
const W = window.innerWidth, H = window.innerHeight;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1f1f23);
const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
camera.position.z = 5;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
document.body.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(3, 4, 5); scene.add(sun);
const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1), new THREE.MeshStandardMaterial({ color: 0x66aaff }));
scene.add(mesh);
function animate() {
  requestAnimationFrame(animate);
  mesh.rotation.y += 0.01;
  renderer.render(scene, camera);
}
renderer.render(scene, camera);
animate();
```
````

`CODE_SYSTEM.html`
````
You write ONE small web page fragment. It is shown as a still picture, window.innerWidth pixels wide. There is no network and no JavaScript.
Reply with exactly one ```html code block and nothing else.
Rules:
1. Write only what goes inside <body>: no <!DOCTYPE>, <html>, <head> or <body> tags.
2. Put all CSS in one <style> element at the top. Use system fonts (font-family: system-ui, sans-serif).
3. No <script>, no onclick or other handlers, no external links, images, fonts or iframes. Use CSS colours, gradients, emoji or inline <svg> instead of pictures.
4. Keep it to one screen.
Skeleton:
```html
<style>
  .card { font-family: system-ui, sans-serif; padding: 20px; background: #fbf7ef; border-radius: 12px; }
  h1 { margin: 0 0 8px; color: #b0452f; }
</style>
<div class="card">
  <h1>Title</h1>
  <p>One short paragraph.</p>
</div>
```
````

**New preset instructions** (the *task* only; the rules above ride the system message):
- write-p5: "A slow, colourful spiral that turns."
- write-three: "A few floating shapes in soft light."
- write-svg: "A simple landscape: a sun, two hills and a house."
- write-html: "A small page introducing a museum exhibition: a title, a short paragraph and three highlights."

**Tests.**
- Unit, A: `planFor` with `code:'svg'` has `system` containing `xmlns="http://www.w3.org/2000/svg"` and `call.maxTokens===4096`; a fake ask with `finishReason:'length'` makes the Instruction throw `errCutOff`; `sanitizeSvg('<svg viewBox="0 0 1 1">…')` output starts `<svg xmlns="http://www.w3.org/2000/svg"`, and an `xlink:href` gains `xmlns:xlink`; `codeValue(htmlPageWithInlineScript, 'p5')` returns only the script body; `explainGuestError("color is not defined", 'p5')` names setup/draw.
- Harness, C: a p5 sketch that only paints inside a `requestAnimationFrame` loop, and a three.js scene using only `setAnimationLoop`, both photograph non-blank (a PNG byte variance check). A Preview set to 500×200 photographs 500×200.
- **Live acceptance on the rig** (owner or rig checklist): each Write-… preset, run 5 times with new seeds on `gemma4:12b`, draws without an error at least 4 times out of 5.

---

## Part B: other defects (beyond the owner's list)

Severity: **blocker** = data loss or a dead surface; **major** = a wrong result or behaviour hit in ordinary
use; **minor** = an edge case, misleading UI, or contract drift. IDs are for re-review.
- **Verification.** Two parallel read-only reviews covered the library/session files and the K7 log/media files.
  - Their findings below were spot-checked against the code before inclusion: B3, B4, B5, B16 and B17 were verified line by line.
  - The K7 files (`devlog*.mjs`, `recorder.mjs`) were being edited by another run during the review. B5 and B15 match the on-disk state at 2026-09-24 evening.
- **Found while tracing Part A and counted there:** the wheel eats inner scroll (A4); silent truncation and the transcript's `max_tokens: automatic` (A8); the Preview's Width/Height fields lie (A8); stuck Space-pan (A4); paste loses size (A3); Fit cannot fit a large graph (A4).

### Major

**B1. Undo and Redo rewind run results, the document title and the view.**
- Where: `computer/host.mjs:142-159` (`doc = e.doc`, a whole-document snapshot, `graph/undo.mjs`).
- The contract says runtime writes are "never undoable" (`COMPUTER_PLAN.md:883`, `:1603`).
- Scenarios:
  - (a) Move a box, press Run all, then Ctrl+Z the move: **every answer vanishes** and the boxes go back to idle.
  - (b) Move a box *during* a run, let it finish, then undo: the boxes return to `running`/`queued` and spin until a reload.
  - (c) Undo during a run: the Instruction's old settings come back, then the runner's `mark(done, V2)` lands on them. The box shows the old prompt with the new answer, marked Done.
  - (d) Rename the open graph (`host.mjs:428-431`, `undoable:false`), then undo any earlier edit: the stored title reverts. The card keeps the new title until the next render (`library.mjs:428-437` `syncOpenMeta` never writes `.comp-card-title`). `view` reverts the same way.
- Fix, a pure `restoreProgram(current, snapshot, {label})` in `graph/undo.mjs`, used by `session.undo`/`redo`:
  - take the snapshot's program (part set, `type/x/y/w/h/settings`, wires) and keep the current `title` and `view` (except for an `import` entry);
  - graft the current runtime fields onto parts that survive, mapping any `running/queued/waiting` to `stale`;
  - `markStale` the parts whose settings or incoming wires differ between the two.
  - `syncOpenMeta` also updates the title.
- Tests: unit on `restoreProgram` for (a) through (d); a harness run, move, undo keeps the values.

**B2. An edit made while its box is running is silently lost.**
- `topo.mjs:149-162` makes the running part `stale`. When the answer returns, `runner.complete` writes `done` over it (`runner.mjs:594`), with the value from the *old* settings.
- Scenario: fix a typo in a running Instruction. The old prompt's answer arrives, the box reads Done, and Run all says "Nothing to run".
- Fix: in `complete()`/`resumeParked()`, if `stateOf(id) !== 'running'`, write the value with `state:'stale'` and do not count it as `ran`.
- Test: unit with a gated fake ask and `setSettings` while the request is pending.

**B3. Clicking the card of the graph that is already open stops the live run and rejects its questions.**
- Where: the card's `click` (and each click of the rename `dblclick`) calls `openDocument(row.id)` (`library.mjs:451-452`, `596-606`), which reaches `host.openDoc` (`host.mjs:446-451`). That calls `runner.stop(); cancelParks(); clearPresses()` *unconditionally*, before `session.open` returns early for the same id (`:209`). `tutorial/rail.mjs:112` does the same.
- Scenario: during a slow run, or with a Dialog waiting, click the highlighted card. The run stops, the farm call is wasted, and the question is gone.
- Fix: `openDoc` returns early, with no stop, when `graphId === session.docId()` and no other open is in flight. `library.open` skips `host.open` for the open id.
- Test: harness, run, click the open card; `running()` stays true.

**B4. Deleting the open graph during a run brings it back.**
- Where: `library.mjs:553-558` removes the row first and switches away after. Meanwhile the live runner's `mark()` still passes `ownsDoc()` and calls `store.put(A)`. `docstore.remove` (`:190-199`) only dropped the write queued *at that moment*, so the next timer or `flush()`, the first line of `session.open` (`host.mjs:214`), rewrites A.
- The run journal `computer:runs:<id>`, which includes Dialog questions, is never deleted, contradicting "This cannot be undone".
- Fix:
  - switch away first (stop, then flush), then remove;
  - `docstore` keeps a set of deleted ids that `put`/`write` refuse;
  - delete the journal key.
- Test: unit on docstore (put after remove is refused); harness, delete during a run, reload, and the card is gone.

**B5. The debug log records LOL Chat conversations, while its guide says it never does.**
- Where: the K7 `fetch` wrapper replaces `window.fetch` for the whole renderer (`devlog.mjs:383-414`). `summarizeRequest` stores up to 40 messages × 1500 characters per chat request (`devlog-format.mjs:233-262`).
- That lands in the always-on ring, and in the file once Record is pressed (the pre-roll). The switch survives relaunches.
- `COMPUTER_DEBUG_LOG.md:82-84` promises "Anything while you're in LOL Chat…" is never in a file.
- Every request body up to 4 MB is also `JSON.parse`d a second time on the main thread, recording or not.
- Fix: record message text only while the Computer is shown *and* its runner is executing. Otherwise log method, URL, model, message count and bytes, with no parse. Correct the guide.
- Test: unit on `summarizeRequest` with a `{computer:false}` flag (no `msgs`); harness, a LOL Chat send then Record gives no `msgs` in the file.

### Minor

- **B6. A tour step is impossible as written.**
  - `00-tour.mjs:81`: "click it once to select it, then press Delete". A sticky note's face is one textarea (`sticky.mjs:53-60`), so the click puts a caret in it and Delete edits the text. Ctrl+Z in the next step is the textarea's own undo.
  - Fix: A6's "click selects, double-click edits" for Sticky (`readOnly` until `edit()`), or reword the step to "click its title bar".
  - Test: real-input run of the two steps.
- **B7. Escape does not follow §8.1's ladder.**
  - `canvas.mjs:1743-1747` calls `o.onStop()` *before* checking `typing`, so Escape to leave a text field stops a 3-minute run.
  - With the drawer open and focus on the canvas, Escape stops the run and leaves the drawer open. The drawer only listens on itself (`drawer.mjs:192-200`).
  - Fix: while typing, Escape only blurs. The canvas routes Escape through the host's cancel ladder. The drawer registers a cancel handler ordered before `computer-run`.
- **B8. Boxes survive a graph switch when ids repeat.**
  - `renderParts` reuses `boxes.get(part.id)` across a `loaded` event (`canvas.mjs:1474-1478`). Lessons reuse `n_title`/`n_sub`/`n_next`.
  - Per-box closures cross documents: a Preview's `live`, edit timers, a Text box's `editing`.
  - Fix: on `ev.loaded`, destroy every box before rendering.
- **B9. The model picker can stay stale.** `refreshModels` stores the new signature *before* bailing out on a focused select (`instruction.mjs:196-203`). Assign it after the rebuild.
- **B10. The debug door is not the shipped path.** `debug.unwire`/`debug.move` hand-edit the doc (`host.mjs:495-514`): no `rev`, no stale marking. The header comment `:483-484` claims otherwise. Use `removeWire`/`movePart`.
- **B11. The open race.**
  - Scenario: A is open, click B, then click A before B loads. `open(A)` returns early (`host.mjs:209`) without bumping `epoch`, so B still lands. The canvas shows B while the sidebar highlights A (`library.mjs:598-604` sets `openId` before resolving).
  - Fix: bump `epoch` and clear `opening` in the early return. Set `openId` from `session.docId()` after the open resolves.
- **B12. Writes without an open document.**
  - `undoStack.clear()` runs *before* `await store.load` (`host.mjs:243-249`), so an async adoption that lands mid-load pushes graph A onto B's history.
  - `apply`/`patchPart`/`setView` always `store.put` (`:109-141`), and `commitView` has no `hasDoc()` guard (`canvas.mjs:801-804`). A wheel before the first open (the migration wait is up to 5 s) saves the placeholder as an "Untitled" row, which `open(null)` may then pick as the newest.
  - Fix: clear the history and selection in the same block as `doc = out.doc`. `put` only when `doc.id === docIdOpen`. `commitView` guards on `hasDoc()`.
- **B13. The card's "last run" is really the last edit.** `library.mjs:62-73` uses `updatedAt`, and `docstore.duplicate` keeps `stats`, so a never-run copy says "last run just now". Read the journal's newest run, and strip `stats` on duplicate.
- **B14. Deleted migrated graphs come back on each launch while the migration is still retrying** (`migrate.mjs:107-135` only checks whether the derived id exists). Keep a per-source "migrated" marker.
- **B15. The debug log reports success it did not have.**
  - `E_IO`/`E_NONE` only increment `failures` (`devlog.mjs:153-164`). The "Log saved" and "Marker saved" toasts show regardless (`recorder.mjs:99-100`, `128-129`).
  - The marker's graph snapshot is taken *after* the note dialog closes (`recorder.mjs:112-133`), and Cancel still saves the marker.
  - The ring holds whole `doc` objects, image data URLs included (`devlog.mjs:600`).
  - Fix: toast on the result; snapshot at `shot()` time; scrub at log time.
- **B16. A decoded sound stays pinned after its box is gone.** `bufferFor` always assigns the module `cached` (`audio.mjs:191-205`). A destroy or replace before the decode ends leaves up to about 230 MB referenced. Re-check `destroyed`/`fileId` before caching.
- **B17. Drop races.**
  - A slow drop lands in whichever graph is open when it finishes (`drops.mjs:194-247`, `intake.mjs:346-366`). Re-check `docId()` before placing.
  - `library.remove` sweeps without `spareFresh` (`library.mjs:227-228`), deleting a file a pending drop just stored.
  - Two drops on one Sound, Document or Image box race, and the slower one wins (`audio.mjs:456-468`, `document.mjs:638-660`, `image.mjs:249-268`). Fix with a per-box sequence number.
- **B18. Dead or misleading code.**
  - `graph.deleteParts` is never used.
  - `run({mode:'button'})` is accepted but never passed (`runner.mjs:291`, `topo.mjs:511`).
  - The comment "The canvas stops the event it handles itself" (`host.mjs:323`) is false.

**Part B count: 0 blocker · 5 major · 13 minor.**

---

## Work split: three independent builder packages

**Ownership rules.**
- File ownership does not overlap. Existing string keys are edited only by the file's owner.
- A new key goes in a **new** per-package strings file registered into the same namespace, as the project already does (`parts-*.en.mjs`): A gets `strings/computer-gen.en.mjs`, B gets `strings/computer-canvas.en.mjs`.
- Contracts K-1 to K-6 are frozen before anyone starts.

**Frozen contracts.**
- **K-1 Selectable zone.** An element with `data-selectable="text"` inside a part:
  - pointerdown there selects the part but starts no drag, no `preventDefault` and no capture;
  - `onCopy` leaves a non-collapsed selection alone;
  - `onWheel` lets it scroll when it can.
- **K-2 `PartInstance.edit?(): boolean`.** The canvas calls it on `dblclick` inside `.graph-part-body`, and on Enter/F2 with exactly one part selected and no wire.
- **K-3 Box geometry.** The box is exactly `part.w × part.h`. `.graph-part-body{flex:1;min-height:0;overflow:auto}`. Each part's main field is `flex:1 1 auto;min-height:0`. Only the canvas resizes.
- **K-4 Guest size.** `sandbox.run({…, size:{w,h}})` makes `innerWidth/innerHeight`, `lol.size` and the default canvas equal `w×h`.
- **K-5 Seed and length.**
  - `spec.run(input)` gets `input.seed` (uint32).
  - `ask.text/json` accept `seed`, `maxTokens` and `temperature?`, and return `finishReason`.
  - `patchPart` keeps `stats.seed`.
  - Undo grafts *all* runtime fields generically.
- **K-6 Harness real input.** `h.input.click|dblclick(target)`, `drag(from,to,{steps})`, `wheel({x,y,dx,dy,ctrl})`, `key(k,{ctrl,shift})`. `target` is a selector or `{x,y}` client px. It is built on `webContents.sendInputEvent` (`test/chat-harness/main.cjs` + `run.js`).

### Package A: Generation (seed, length, prompts, code answers)
- **Owns:**
  - `app/ask.mjs`, `graph/runner.mjs`, `graph/bind.mjs`, `graph/model.mjs`, `graph/unfence.mjs`, `design/svg-sanitize.mjs`;
  - `graph/parts/instruction.mjs`, `graph/parts/creative.mjs`;
  - `computer/transcript.mjs`, `computer/runbar.mjs`, `computer/templates/*`;
  - `strings/parts.en.mjs`, `strings/parts-creative.en.mjs`, `strings/ask.en.mjs`, the new `strings/computer-gen.en.mjs`;
  - their unit tests.
- **Does:**
  - A1 and A2;
  - A8, engine side: max tokens, `finishReason` and `errCutOff`, CODE_SYSTEM and task-only presets, the template, `<script>` salvage, svg `xmlns`/`xlink` repair, `explainGuestError`, `setAnimationLoop` in `THREE_PRELUDE`;
  - B2, B9, and B18's runner part.
- **Acceptance:**
  - unit: the seed matrix; braced-only fill ("topic/cats" intact); `planFor` system and `maxTokens` per kind; `errCutOff`; sanitizer namespace repair; script salvage; `explainGuestError`; a running edit stays stale;
  - harness, with the mock farm echoing `seed`/`max_tokens`: ▶ twice gives two seeds and zero cached; a pinned seed gives one request; "Run everything again" is offered when nothing is stale;
  - rig: each Write-… preset draws in 4 of 5 runs on `gemma4:12b`.

### Package B: Canvas, session and library (mouse, trackpad, wires, geometry, undo, documents)
- **Owns:**
  - `graph/canvas.mjs`, `graph/wires.mjs`, `graph/undo.mjs`, `graph/palette-menu.mjs`, `graph/journal.mjs`;
  - `computer/host.mjs`, `computer/library.mjs`, `computer/docstore.mjs`, `computer/migrate.mjs`, `computer/drawer.mjs`;
  - `css/graph.css`, `strings/graph.en.mjs`, the new `strings/computer-canvas.en.mjs`;
  - `test/chat-harness/main.cjs` + `run.js` (K-6);
  - their unit tests and scenarios `k8-input-*.mjs`.
- **Does:**
  - A3 (the handle, height and ports, clipboard `w/h`, the Instruction field CSS);
  - A4 and A5, all of them;
  - A6, canvas side (deferred capture, `elementFromPoint`, the K-2 calls);
  - A7, canvas side (K-1, `onCopy`, optional plain-text paste);
  - B1, B3, B4, B7, B8, B10, B11, B12, B13, B14, B17's library sweep, B18's comment and dead string.
- **Acceptance:**
  - unit: `restoreProgram` (a)-(d), `wheelIntent`, `resizeRect`, `rewireOutcome`, clipboard `w/h`, `shouldCopyParts`, docstore refuses writes after remove;
  - harness, real input:
    - resize moves the ports;
    - a wheel over a Document box scrolls its text, not the view;
    - pinch keeps the cursor point fixed;
    - drag a wire end off to unplug it, and one undo restores it;
    - hover ✕ deletes a wire;
    - a double-click on a box does not open the ＋ menu;
    - run, move, undo keeps the answers;
    - clicking the open card keeps the run;
    - delete during a run, then reload: the graph stays deleted;
    - stuck-Space regression.

### Package C: Boxes, media, sandbox and the debug log
- **Owns:**
  - parts: `graph/parts/text.mjs`, `graph/parts/preview.mjs`, `graph/parts/sticky.mjs`, `graph/parts/document.mjs`, `graph/parts/audio.mjs`, `graph/parts/image.mjs`;
  - computer: `computer/drops.mjs`, `computer/intake.mjs`, `computer/devlog.mjs`, `computer/devlog-format.mjs`, `computer/recorder.mjs`;
  - sandbox: `sandbox/runner.html`, `sandbox/host.mjs`, `sandbox/protocol.mjs`;
  - CSS: `css/computer-text.css`, `css/computer-preview.css`, `css/computer-document.css`, `css/computer-look.css`, `css/sandbox.css`;
  - strings: `strings/parts-text.en.mjs`, `strings/parts-preview.en.mjs`, `strings/sandbox.en.mjs`, `strings/computer.en.mjs`;
  - `computer/tutorial/lessons/00-tour.mjs`, `docs/COMPUTER_DEBUG_LOG.md`;
  - tests and scenarios `k8-boxes-*.mjs`.
- **Coordination:** the K7 files are live in another run. If that run is still active, hand B5 and B15 to it instead.
- **Does:**
  - A6, box side (`edit()`, the ✎ button, selection-aware click, auto-lock on the first keystroke of a wired Text box);
  - A7, box side (`data-selectable` plus `user-select:text`);
  - A3, fields fill the box (the native grips go);
  - A8, guest side (the iframe sized to `w×h`, the first-frame rAF flush, `PAGE_CSS` font on `#root`, the Preview shows `explainGuestError`);
  - B5, B6, B15, B16, B17 (the drop and box races).
- **Acceptance:**
  - unit: `text.edit()` seeds from what is shown; the Preview passes `size`; `summarizeRequest` without chat text; the audio cache is released after destroy;
  - harness, real input:
    - a double-click on a filled Text body edits;
    - drag-select plus Ctrl+C copies the rendered text;
    - editing a wired Text survives the next run;
    - a rAF-only three.js scene and a p5 sketch photograph non-blank;
    - a 500×200 Preview gives a 500×200 picture;
    - the tour's Delete and Undo steps work with real clicks;
    - a drop, then a graph switch mid-decode, places nothing in the new graph.

**Order.**
- A, B and C build in parallel against K-1 to K-6.
- C's real-input scenarios are written against the K-6 names and run once B's helper lands.
- Then one integrated harness run, then critic round 2.

---

## Re-review checklist (round 2)
- **A1:** seed matrix; pinned versus new; carried nonce; "Run everything again".
- **A2:** braced-only fill; new label and hint.
- **A3:** handle; ports; exact box height; paste size.
- **A4:** inner scroll; zoom maths and limits; stuck Space; zoom cluster and keys.
- **A5:** drag to unplug; ✕; screen-px hit band.
- **A6:** real-input double-click and Enter edit; no palette on a box; auto-lock.
- **A7:** select and copy rendered text; `onCopy` guard.
- **A8:** `max_tokens` on the wire and in the transcript; `finishReason`; CODE_SYSTEM visible in the Sent tab; svg namespace; script salvage; guest size; rAF flush; 4 of 5 live.
- **B1 to B18** as listed.

---

## Integrator addendum (2026-09-24, 22:10): A6 and A7 PROVEN with real input; K-6 already built

- **K-6 is built and landed by the integrator.** It is NOT Package B's job any more. `h.input.{click, dblclick,
  drag, wheel, key, type, move, point, selection, hit}` in `test/chat-harness/helpers.js`, on CDP's
  `Input` domain (trusted events, with hit testing, focus, default actions and pointer capture). No
  change to `main.cjs`/`run.js` was needed. Self-check: `h0-real-input` (trusted, dblclick, drag with
  buttons held, wheel scrolls, pinch = wheel+ctrl, a click focuses, keys + typed text land, chords
  carry modifiers).
- **A6, proven.** A Text box filled with text is placed and set. A REAL click on
  `.graph-text-body` hits the `<p>` inside it, but the source textarea stays hidden and
  `document.activeElement` stays BODY. `End` + typing " ZZ" changes nothing. After a reload it is
  the same. The existing scenarios passed only because `el.click()` bypasses the canvas's pointer
  capture.
- **A7, proven.** A real drag across a filled Text body MOVES THE BOX, and
  `window.getSelection()` stays `""`.
- **B5 and B15 are fixed by the integrator** (in the K7 landing), so Package C does not touch
  `computer/devlog*.mjs` or `computer/recorder.mjs`.
