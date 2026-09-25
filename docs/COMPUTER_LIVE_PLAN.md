# The Computer: live, interactive previews and hand-editing (plan, 2026-09-25)

> *"In the threejs, p5js and svg examples it would be cool to be able to edit the code by hand and
> then rerun to see the changes. I also noticed that the key events, or mouse events are not passed
> on the canvas, for instance in the threejs it would be cool to have a camera control and be sure it
> works when we interact with the node."* — the owner

## What is true today (probed with real input)

- **Hand-editing works, but it is cramped.** Typing in a Preview's code field redraws it about a
  second later, and ▶ keeps the edit (the "first keystroke claims it" rule, plus "Keep my code").
  But the field is about 6 lines tall and scrolls sideways, and nothing tells you that typing
  redraws.
- **A preview is a PHOTO.** Every p5 / three / HTML box is drawn in the Computer's ONE sandbox
  iframe, and a snapshot is shown (§2.6 BJ, lint rule 12). Nothing animates on the box, and no
  mouse, wheel or key event can reach the sketch. The Preview's `live` setting exists in
  `defaults()` but nothing uses it.
- three.js is the vendored **r160 global build** (`THREE`). The official OrbitControls ship only as
  an ES module that imports `'three'`, so using them would mean editing a vendored file, which
  rule 14 forbids.

## Decisions

1. **Live is a switch per box, and ONE box is live at a time.** A **▶ Live** button on a p5, three.js
   or HTML Preview runs that box's code for real, inside the box's picture area, until **■ Stop**,
   until another box goes live, or until the box leaves the screen, the Computer is hidden or the
   window is hidden. The other boxes keep their snapshots. SVG and Markdown have nothing to interact
   with, so they have no Live button.
2. **A second guest frame, owned by `sandbox/host.mjs`.** The snapshot guest is unchanged. A LIVE
   guest is created INSIDE the live box's picture element, so it pans and zooms with the canvas for
   free. It has the same runner, the same CSP, the same `sandbox` attributes, no network, and a
   watchdog. Rule 12 still holds: only `sandbox/host.mjs` makes an iframe. The one-iframe rule
   (§2.6 BJ) becomes "one snapshot guest, plus at most one live guest".
3. **Input goes to the sketch.** Pointer, wheel and keys over the live frame reach the guest (they
   are in its document, not the canvas's). The canvas must not pan, zoom, drag or select because of
   them. Clicking the frame gives it keyboard focus, and Escape or a click outside hands focus back.
   The box stays movable by its title bar.
4. **Camera controls: `lol.orbit(camera, opts?)`, first-party, in the runner.** Drag rotates about a
   target, the wheel or a pinch zooms, and right-drag or Shift-drag pans. It has damping and returns
   `{target, update(), dispose()}`. In a snapshot it is a harmless no-op. p5 needs nothing: in live
   mode `mouseX`, `mouseIsPressed`, `keyPressed()` and the rest work natively.
5. **Editing:**
   - an **Edit code** button opens a large editor in the right-hand drawer (line numbers, the
     box's own source, two-way with the box's field);
   - **Run code** and Ctrl+Enter in either editor redraw the snapshot, or restart the live guest,
     with the edited code;
   - errors point at their line ("Go to line N" already exists);
   - editing claims the code exactly as today.
6. **The model is told.** The three.js system message says to call `lol.orbit(camera)` so the scene
   can be explored. The p5 message says `mouseX`/`mouseY` and key handlers work when the box is live.
   The three.js starter uses `lol.orbit`, and the p5 starter reacts to the mouse.

## Frozen contracts (both builders code against these)

- **K-7 `lol.orbit(camera, opts?)`**, in `sandbox/runner.html`, available whenever THREE is loaded.
  `opts`: `{target?: [x,y,z], damping?: number}`. It listens on the guest's canvas (or `document`).
  It returns `{target, update(), dispose()}`. `update()` is called automatically from the guest's rAF
  flush, so a model that forgets to call it still works.
- **K-8 `app.drawer.editCode({partId, title, mode, source, onChange(text), onRun()})`**, returning
  `{close(), setSource(text), setError({line, message}|null)}`. It is implemented in
  `computer/drawer.mjs`, and the Preview's **Edit code** button calls it. Only one code editor is
  open at a time.
- **K-9 the live guest API**, in `sandbox/host.mjs`: `sandbox.live({mount, mode, code, size, inputs})`
  returns `{stop(), restart(code), focus(), state()}`, and `sandbox.liveNow()` returns the live
  handle or null. Starting a second live guest stops the first.

## Work split

| | Builder L: the live guest and input | Builder E: editing and instructions |
|---|---|---|
| Owns | `sandbox/host.mjs`, `sandbox/protocol.mjs`, `sandbox/runner.html` (incl. `lol.orbit`), `graph/parts/preview.mjs` (Live / Stop / Run code / Edit code buttons, Ctrl+Enter), `css/computer-preview.css`, `css/sandbox.css`, `strings/parts-preview.en.mjs`, `strings/sandbox.en.mjs`, and `graph/canvas.mjs` for the input guard only | `computer/drawer.mjs` (K-8), `css/computer-drawer.css`, `graph/parts/creative.mjs` (starters), `graph/unfence.mjs` (prelude, if needed), `strings/computer-gen.en.mjs` (system messages), `strings/parts-creative.en.mjs`, `docs/LOLCHAT_COMPUTER_TUTORIAL.md`, `docs/COMPUTER_STATUS.md` |
| Proves | Real input: Live on a three.js box, a drag over it rotates the camera (the pixels change) and the canvas does not pan; a wheel over it zooms the scene, not the canvas; a p5 box sees `mouseX`; a key reaches the sketch and not the canvas shortcuts; one live box at a time; hiding stops it; lint rules 9 / 12 / 14 green | Real input: Edit code opens the drawer editor with the box's code; typing there changes the box; Ctrl+Enter redraws; an error line is reachable; the starters use `lol.orbit` and the mouse; a model's three.js answer that calls `lol.orbit` runs |

After both land: integration, the full gates, one critic pass, and a check on the owner's client.
