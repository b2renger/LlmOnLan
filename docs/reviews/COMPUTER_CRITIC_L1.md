# The Computer: critic report, round L1 — Live previews and hand-editing (2026-09-25)

**Verdict: NOT YET.** 0 blocker · 1 major · 4 minor.

The feature does what the owner asked, and I checked it with real input:
- Live three.js scenes orbit.
- p5 sketches see the mouse and the keys.
- The canvas stays still.
- One box is live at a time, and it pauses when hidden.
- The drawer's editor is roomy and follows the box both ways.

The security boundary holds, and I found no leak of frames, listeners or observers.

**What stops sign-off** is one seam: **a canvas drag released over a live frame never ends**. Its
worst form breaks S1-5's promise that a wire dropped on a box plugs in. It is one small fix, and
the four minor findings are small too.

## How this was checked

- **Code:** the uncommitted tree on top of `5cc3d4a`. I read every diff:
  - `sandbox/host.mjs`, `protocol.mjs`, `runner.html` (lol.orbit and the live mode);
  - `preview.mjs`, the `canvas.mjs` guard, `drawer.mjs`, `code-edit.mjs`, `unfence.mjs` and `creative.mjs`;
  - the strings and the docs;
  - `shell/src/main/index.ts` (the frame-navigation veto).
- **Gates:**
  - `chat-unit`: 1563 passed, 0 failed.
  - `chat-lint`: 221 files, 0 violations (rules 9, 12 and 14 green).
  - `--phase k11` on slot 7: 9 passed, 0 failed.
- **Throwaway real-input probes on slot 7** (`zz-critic-l1-{a..d}.mjs`, now deleted), all driven by
  `h.input.*` real mouse and keys:
  - takeover, then undo and redo;
  - delete the live box, then undo;
  - switch to another graph and back;
  - right-click and double-click over the frame and over the stage margin;
  - a marquee, a title drag and a wire drag that end over the frame;
  - Space and Tab inside the frame, and Escape;
  - a snapshot redraw while another box is live;
  - a run that lands while the person types in the drawer.

## What holds (checked, no finding)

- **Containment.** The live guest comes out of the same `makeFrame` as the snapshot guest.
  - It gets `sandbox="allow-scripts"`, `referrerpolicy=no-referrer`, `allow=''` and the runner's
    CSP with `connect-src 'none'`, so it has no modals, popups, downloads, fullscreen, forms or
    network.
  - It has its own nonce. `onLiveMessage` checks `ev.source === lframe.contentWindow` before the
    token.
  - The snapshot handler already ignores other sources (`sameSource`), so neither guest can speak
    for the other.
  - No other first-party `message` listener exists in the renderer.
  - The main-process veto (`index.ts:437-441`) lets `runner.html` load in any subframe and refuses
    every other navigation. So a live page's `<script>` (now woken by `wakeScripts`) cannot leave
    the runner. A `location.reload()` reboots into an untokened runner, which then goes quiet and
    is caught by the watchdog.
- **Keyboard ownership.** The runner installs its Escape listener before any guest code runs
  (capture phase, untracked), so a sketch cannot swallow Escape.
  - Probe: after Escape, focus is back on the box and the sketch keeps running.
  - Probe: Tab leaves the frame (it goes to the box's code field, Run code, Edit code, Save): there
    is no focus trap.
  - Probe: Space inside the frame leaves `spaceHeld` false. Focus entering the frame blurs the
    window, which releases a held Space.
- **The input guard.**
  - Right-click on the frame and on the stage margin opens neither menu.
  - Double-click on the frame opens no ＋ menu.
  - A wheel over the frame zooms the scene; over the margin it is swallowed.
  - A title drag of another box released over the frame commits normally, because the dragged box
    is under the pointer.
- **Lifecycle, counted as iframes in the page:**
  - live: 2 (the snapshot guest plus the live one);
  - takeover: 2;
  - delete the live box: 1, and Undo brings it back live: 2;
  - switch graph: 1, and back on the graph it resumes: 2.
  - The watchers are released on stop, destroy and graph switch: the IntersectionObserver and the
    bus handler go when the box stops wanting Live, and the ResizeObserver, `liveOffs` and `DREW`
    are always released.
- **The snapshot guest while a box is live.** Another box's Run code redraws its picture (a new PNG
  tile), the snapshot guest reads `ready`, and the live box keeps `running`.
- **lol.orbit.** It is pure math under Node test. It is a no-op in a snapshot. The re-render of a
  scene drawn once fires only when no page frame ran and `lastRender.c === camera`.
  - So a scene with two cameras, a render target or a HUD pass is not broken; its orbit simply
    does not redraw it.
  - One theoretical case: `autoClear = false` with one draw would leave trails. Not listed.
- **Docs.** The tutorial and STATUS match what the code does (Edit code on every Preview mode, Run
  code or Ctrl+Enter, Tab, Shift+Tab, Esc, Live on p5/three/HTML, `lol.orbit`, the starters).

## Findings

### Major

**L1-1. A canvas drag released over a live frame never ends: the release goes to the sketch.**
- **Where:**
  - `graph/canvas.mjs:2232` `capture()` sets pointer capture on the canvas.
  - A live frame is a separate (sandboxed, cross-origin) document, and capture on the parent does
    not route its events. The pointer moves and the release over the frame are delivered to the
    sketch.
  - The canvas's drag ends only on the next trusted `pointermove` with no button, over the canvas
    (`canvas.mjs:2366`, "a release the canvas never heard").
- **Probes (real mouse):**
  - **Marquee.** Drag from empty canvas across a Text box and release over the live frame. The
    marquee stays drawn and 0 boxes are selected. When the pointer moves back over the canvas, it
    completes (selected: 2).
  - **Wire (the S1-5 promise).** Drag a wire from a Text box's dot and release it on the live
    Preview's picture. **No wire** is made and the canvas stays in `graph-wiring`. When the pointer
    moves off to empty canvas, the drag completes there: *"No wire made: drop it on a box…"*.
  - **The mechanism generalises.** A pending wire completes where the pointer re-enters the canvas.
    Re-entering over a box wires into that box, later, unasked. The same stall hits Hand, Space and
    middle-button pans and the resize handle whenever they end over a live frame.
- **Correct behaviour:**
  - A canvas gesture that started on the canvas owns the pointer until release, frame or not.
  - A wire released on a live box's picture plugs into that box, as on any other box's body.
- **Fix (canvas.mjs plus one CSS rule):**
  - While a canvas drag is armed (`capture()`), mark the canvas: `canvas.dataset.dragging = 'true'`.
  - Clear the mark in `onPointerUp`, `cancelDrag`, `onLostCapture` and `resetBoxes`.
  - Add `#lolcomputer .graph-canvas[data-dragging='true'] .sandbox-live-frame { pointer-events:
    none; }`.
  - The frame then sits outside hit-testing for the gesture. The release reaches the canvas.
    `partUnder` finds the stage, so `bodyTarget` resolves to the live box and `bodyDropPort` wires
    it, with the drop-target outline showing too.
- **Test:** a k11 scenario with real input:
  - a marquee released over the frame selects on release;
  - a wire released on a live Preview's picture makes the wire on release (`wires === 1`, not
    `graph-wiring`);
  - a Hand-tool pan released over the frame commits the view.

### Minor

**L1-2. A run that lands while the first drawer keystrokes are pending: the drawer shows the
arrival, the box keeps the typed text, and the next keystroke silently drops the typed edit.**
- **Where:**
  - `computer/drawer.mjs:581-592` `setSource` first calls `flush()`. That delivers the pending
    typing to the box: `onChange` → `preview.mjs onAreaInput`, and the box claims the code. Then
    `setSource` overwrites the drawer with the text it was handed, the arrival.
  - The Preview's `syncEditor` (`preview.mjs:1012`) has already recorded the claimed text as
    `editorText2`, so it never re-syncs.
- **Probe (real keys, run through the debug door):**
  1. Text "# first" is wired into a Markdown Preview. Open Edit code and type `X`.
  2. Within the 250 ms debounce, the Text becomes "# second" and runs.
  3. The drawer reads **`# second`**, while the box and the document read **`# firstX`**.
  4. Type `Y` in the drawer: the box becomes **`# secondY`**. The `X` edit is gone, with no sign.
- **Scope:** this is the owner's workflow (press ▶ on the Instruction, open Edit code while the
  model thinks, start typing). It hits only when the arrival lands during the first unflushed
  keystrokes, before the box has claimed the code.
- **Fix:** in `setSource`, when `flush()` delivered anything, return `false` without overwriting,
  since the box now holds the person's text and will say so. Make the Preview's `syncEditor`
  compare against the editor's real text (add a `text()` getter), not the last value it sent.
- **Test:** the probe as a k11 case. The drawer and the box agree after the run lands, and the
  typed `X` survives.

**L1-3. Undo around a Live takeover leaves a box flagged live that is not.**
- **Where:**
  - `preview.mjs:1156` `setLiveChoice` writes `live` as an **undoable** edit, from both the pressed
    box (`:1179`) and the replaced one (`:1244`).
  - A replaced box never resumes by itself, because a resume never takes over (`goLive`
    `pressed:false`).
- **Probe (real clicks, Ctrl+Z on the canvas):**
  1. A is live and B takes over: the flags are `[false, true]`.
  2. **Ctrl+Z** gives `[true, true]` with only B live. The step undone was A's flag, not B's press,
     so nothing visible happens.
  3. **Ctrl+Z again** gives `[true, false]` with **nothing live**, while A says `live: true`.
  4. A only comes alive after leaving and re-entering the screen, or when the graph is reopened.
- **Also:** each Live or Stop press moves `rev`, which clears the run bar's outcome sentence (S1-2)
  and hides "Run everything again".
- **Fix:** treat Live as view state, like the zoom.
  - Write `live` with `undoable: false`. PartCtx `update` needs that option (`canvas.mjs:1845`, one
    line: pass `opt.undoable === false ? false : first`). Keep `stale: false`.
  - Or make the replaced box's write non-undoable and keep the press undoable. Either way, one
    Ctrl+Z never desyncs flag and frame.
- **Test:** the probe: after the takeover, Ctrl+Z and Ctrl+Y never leave a box with `live: true`
  and no frame.

**L1-4. Nothing shows that the live sketch holds the keyboard.**
- **Where:** `css/computer-preview.css` and `css/sandbox.css` have no `:focus` or `:focus-within`
  rule for the stage or the live frame. `.graph-part:focus` outlines the box only when the box
  itself has focus.
- **Scenario:**
  1. Click into a live sketch to orbit it. Select another box with a marquee from the canvas
     margin: the frame keeps the keyboard, because the marquee press does not take the focus.
  2. Press Delete. The key goes to the sketch and nothing is deleted, with no sign why. The note
     line's words are the only cue.
- **Fix:** `#lolcomputer .graph-preview-stage:focus-within { outline: 2px solid var(--accent-hover);
  outline-offset: 1px; }` (a token colour, lint rule 3). Optionally, the note switches to "Keys go
  to the sketch — Esc gives them back" only while it holds focus.
- **Test:** click the frame and read the stage outline; press Escape and the outline is gone.

**L1-5. `goLive` writes `live: true` before the sandbox is known to exist.**
- **Where:** `preview.mjs:1179`, then the "unavailable" path. When the sandbox cannot start,
  `setLiveChoice(false)` follows.
- **Scenario:** a sandbox that fails to start (CSP blocked, a missing runner) leaves **two** undo
  entries (`live: true`, `live: false`) and two `rev` bumps for a press that did nothing.
- **Fix:** solved by L1-3's non-undoable write. Otherwise, write the choice after
  `sandbox.live()` returns a handle that is not stopped.
- **Test:** unit, with `ctx.sandbox()` resolving null: the undo depth does not change.

## Smallest fix set (one builder)

1. **L1-1:**
   - `graph/canvas.mjs`: set `data-dragging` in `capture()`, and clear it in `onPointerUp`,
     `cancelDrag`, `onLostCapture` and `resetBoxes`.
   - `css/computer-preview.css`: `.graph-canvas[data-dragging='true'] .sandbox-live-frame {
     pointer-events: none }`.
   - A k11 scenario: a marquee, a wire and a Hand pan, each released over a live frame.
2. **L1-2:**
   - `computer/drawer.mjs` `setSource`: do not overwrite after a flush that delivered text, and add
     `text()` on the handle.
   - `graph/parts/preview.mjs` `syncEditor`: compare with `editor.text()`.
   - A k11 case.
3. **L1-3 and L1-5:**
   - `graph/canvas.mjs` PartCtx `update`: honour `undoable: false`.
   - `graph/parts/preview.mjs` `setLiveChoice`: pass it.
   - A k11 case for the takeover, then undo and redo.
4. **L1-4:** in `css/computer-preview.css`, add the `:focus-within` outline on `.graph-preview-stage`.

**Acceptance:** `chat-unit` and `chat-lint` green, `--phase k11`, `k10` and `k8` green on one slot,
and the four probes above as scenarios. With these in I expect to be HAPPY. **Owner check:** Live on
a three.js box on the owner's client, drag to orbit, then drop a wire onto it.

---

## Round L2 (2026-09-25): the L1 fix set

**Verdict: HAPPY.** L1-1 to L1-5 are fixed, and I checked each one with real input. The new
`VIEW_SETTINGS` rule in `graph/undo.mjs` keeps the seed rules from R3-4 and R4-3 intact. One minor
item is left (L2-1); it does not block. The owner check still stands: Live on a three.js box on the
owner's client, orbit it, then drop a wire onto it.

**How this was checked**
- **Gates on this tree:**
  - `chat-unit`: 1565 passed, 0 failed (including `computer-r3` R3-4/R4-3 and the new `undo` cases).
  - `chat-lint`: 221 files, 0 violations.
  - `--phase k11` on slot 7: 12 passed, 0 failed.
- **Real-input probes on slot 7** (`zz-critic-l2-a.mjs`, now deleted). They re-ran every L1 probe and
  added the undo cases: takeover then Undo and Redo, Ctrl+D on the live box, deleting the live box,
  and export then import.

| # | Status | Evidence |
|---|---|---|
| L1-1 a drag released over a live frame hangs | **Fixed** | See the details below this table. |
| L1-2 the editor races a run | **Fixed** | The L1 probe again: type `X` in the drawer while a run lands. Both the drawer and the box now read `# firstX`, and `Y` gives `# firstXY` in both. |
| L1-3 undo around a takeover | **Fixed** | After B takes over, Ctrl+Z and Ctrl+Y leave the Live flags and the live frame exactly as they were: they undo program edits only. `restoreProgram` keeps the present's `live` (except for an `import` entry) and ignores it when deciding what is stale. The seed rule is unchanged: `programSettings` drops `seed` exactly as `withoutSeed` did. |
| L1-4 no sign the sketch has the keys | **Fixed** | Click into the sketch and the stage gets `data-keys="sketch"`, drawn as an outline. Escape removes it. `:focus-within` cannot see focus inside an iframe, so the window blur/focus route is the right one. |
| L1-5 two undo entries for a failed start | **Fixed** | `setLiveChoice` writes with `undoable: false`, so a Live press never creates an undo entry. |

L1-1 in detail:
- **Marquee:** released over the frame, it selects on release (2 boxes). No marquee is left drawn,
  and `data-dragging` is cleared.
- **Wire:** dropped on the live Preview's picture, it plugs in on release: "Text now feeds p5.js
  sketch", no longer wiring.
- **Pan:** a Hand-tool pan released over the frame commits.
- **Afterwards:** a hit test lands on the iframe again, so the sketch still takes the pointer.

**On the question "a Live/Stop press still bumps `rev`":** it does not matter much.
- Its only visible effect is that the run bar's sentence clears and "Run everything again" hides.
- Nothing is marked stale, and the next Run all says "Nothing to run" and brings the button back.
- If it is ever wanted, `setSettings` can skip `bump()` for a patch that touches only
  `VIEW_SETTINGS`.

**L2-1 (minor): the Live flag can be copied onto boxes that are not live.**
- **Where:**
  - `settings.live` travels with the box wherever its settings go: Ctrl+D or paste, an undone delete
    (which rightly restores the deleted box whole), and export then import.
  - A box that resumes never takes over (`preview.mjs` `goLive` with `pressed: false`), so the copy
    stays flagged `live: true` while it is not live.
- **Probe:**
  - Ctrl+D on the live box gives flags `[false, true, true]`, and only the original is live.
  - Delete the live box, press Live on another, then Ctrl+Z: two boxes are flagged and one is live.
  - Export then import: the file carries `[true, true, true]`. On opening, the **second** box went
    live: whichever box's observer fires first wins.
- **Effect:**
  - The buttons stay honest, because they read the frame, not the flag. ▶ Live stays ▶ on the
    copies.
  - Only "which box comes back live when the graph is reopened" is arbitrary.
- **Fix (two lines):**
  - When a resume finds another box live, write this box's own flag false, with
    `undoable: false, stale: false`, so the flags converge on the truth.
  - Optionally, drop `live` from `toClipboard` copies.
- **Test:** a k11 case: Ctrl+D on a live box, then reopen the graph. Exactly one box is flagged, and
  it is the one that goes live.

**Sign-off.**
- **The owner's two asks are met and proven with real input:**
  - edit three.js, p5 and SVG code by hand and rerun it: the drawer's editor, Run code, Ctrl+Enter;
  - key and mouse events reach the sketch, and a three.js camera can be orbited on the node:
    `lol.orbit`, Live.
- **What else holds:**
  - The sandbox boundary is the same as the snapshot guest's.
  - I found no leak.
  - The canvas neither steals the sketch's input nor loses its own drags to the frame.
- **Before or after committing:** L2-1 can ride with this commit or the next polish pass.
