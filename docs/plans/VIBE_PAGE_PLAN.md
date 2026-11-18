# VIBE_PAGE_PLAN: a page from an answer, its code beside it, edited live, in a window of its own

**Status: approved by the owner, 2026-11-18** (asked in the chat: "improve the way errors in the code are shown in LOL
Vibe, I want a better preview, it should be detachable and we should be able to see the result and the code side by
side, and edit the code with live reload"; then three choices, each the recommended one: the side column **and** a
pop-out window; edits **kept with the thread**; **the Computer's editor**, no new dependency). Size **M**, in two
steps, each useful alone.

## Why

LOL Vibe runs a web page from an answer since 2026-11-14 (`render/code.mjs` `code-page`): Preview runs it inside the
message, in the chat's own sandbox. Three things are missing:
- **An error is one line of text** above the page (*The page stopped on an error: x is not defined*): no line, no
  block, and the console is thrown away. The line the guest reports is likely wrong for a page's scripts (the runner
  subtracts the offset of the Computer's `new Function` wrapper, which a page's inline scripts do not have), and
  nothing says which of the answer's blocks it came from (`render/page.mjs` joins every JS block into the page).
- **The code and the result are never seen together**: Preview and Code are tabs of one block, and a page made of three
  blocks (html, css, js) shows one of them.
- **The code cannot be changed**: a student who wants a different colour asks the model again.

## What a person sees

1. On a page's code block, beside Preview / Code: **Open beside the chat**. The side column (the workbench, where the
   IDE's Project panel lives) opens a **Page** panel:
   - left, the editor, one tab per block of the answer (`index.html`, `style.css`, `script.js` as the model labelled
     them, else *HTML*, *CSS*, *JavaScript*), with line numbers;
   - right, the page running;
   - under the page, a strip: **errors** (each says its block and line; a click puts the caret on that line, in that
     block's tab, and marks the line in the gutter) and **the console** (`console.log` lines, warnings, errors);
   - the column's width is the reader's (drag), as for the Project panel; narrow, the page goes under the editor.
2. **Live reload:** a pause in typing (≈ 700 ms) runs the page again with the new code. **Ctrl+Enter** runs now. A switch
   **Run as I type** (on by default) turns the timer off. A loop that never ends stops the page (the sandbox's
   watchdog, as today), the strip says so, and the next edit starts a new page.
3. **Edits are kept with the thread**, on this computer: the answer's text never changes; the edited blocks are saved
   on the answer's own record (IndexedDB `lol-chat`, field `pageEdits`), deleted with the thread, exported with it.
   **Back to the model's code** throws the edits away (asks first). The block in the message shows *edited* when there
   are edits, and its Preview runs the edited page.
4. **Pop out:** a button in the panel moves the page to **its own window** (a second screen, a projector), with the same
   editor, page and strip; the panel in the side column closes and says *open in its own window*. Closing the window
   brings nothing back by itself; Open beside the chat again does. The window closes with the app.

## How

**Step 1, the side column (renderer only).**
- *Errors that point:* `pageOf` gives each script it appends a `//# sourceURL=lol-block-<n>.js` (n = the fence's index
  in the answer), and the runner, for an error whose source names a block, sends that block and its own line, never
  subtracting `LINE_OFFSET`. Measured first (a page with a known throwing line), since Chromium's line and source for a
  dynamically inserted script decide the design. Errors in the HTML block's own `<script>`s map to the HTML block.
- *The editor:* the Computer drawer's editor (`computer/drawer.mjs`: gutter, error band, Tab/Enter, Ctrl+Enter, caret
  position; its rules in `computer/code-edit.mjs`) is moved out into one module both use, so there is one editor.
  `selectLine` in `graph/parts/code.mjs` becomes its `gotoLine`.
- *The panel:* a `WORKBENCH_PANELS` row, `page` (`render/page-panel.mjs`), one live panel at a time and idle when hidden
  (the workbench's rules). It runs the page with `sandbox.live()` in the chat's sandbox: one page at a time, so the
  message's own Preview goes back to Code when the panel runs.
- *Reload:* a fresh `live()` for each run (stop, then start), not `restart()`: a page's top-level `let`/`const` would
  be declared twice in the same frame, and `restart()` cannot change the CSS. Checked with a two-run test first.
- *Logs:* the live guest already emits `log` events; the strip shows them (capped as the guest caps them).

**Step 2, the window (main + a small renderer page).**
- A `BrowserWindow` on the same session as the main window, loading `renderer/page-window.html`: `contextIsolation`,
  `sandbox`, no Node, a preload that exposes only this window's channel, a CSP no looser than `index.html`'s.
- **The main window's protections, applied to it too**: the frame veto (`will-frame-navigate`), `will-navigate`, the
  window-open handler (links to the system browser). Today they are attached to the main window's `webContents` only;
  they become one function applied to both. The sandbox inside is the same module (`sandbox/host.mjs`, lint rule 12),
  so its walls are the same: opaque origin, no network, no disk.
- The blocks go in over IPC; edits come back the same way and are saved by the main window's renderer (one writer of
  `lol-chat`). One window at a time; a second Pop out replaces its page.

## Tests

- Unit: `pageOf`'s block names; the error-to-block mapping; the edits' save and reset; the shared editor's rules (the
  existing `computer-code-edit` tests keep passing unchanged).
- Harness (`test/chat-harness`): an answer with html + css + js whose JS throws on a known line → the strip names the
  block and the line, a click selects it; an edit that fixes it → the page redraws, no error; the edit is still there
  after switching threads and back; Back to the model's code. The Computer's k11 editor scenarios pass unchanged.
- The window: a harness scenario if CDP reaches the second window, else a HUMAN_TESTS entry (and one on a Mac anyway).

## Limits, said up front

- No syntax colours (the owner chose the Computer's editor, no new dependency).
- Python and pages that need the internet still do not run (as today).
- One page runs at a time in the chat (the message, the panel or the window).
- The edits are the person's: the model does not see them unless they paste them (a later "send my edits" is a plan).

## Built

*(nothing yet)*
