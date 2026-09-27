# The Computer's debug log

You're exploring the Computer and something goes wrong. Record it into a file, hand the file over,
and whoever fixes the bug has everything that happened.

## Use it

1. In the Computer, the run bar has **● Record log** at its right-hand end. Press it.
   - The button turns red and counts events: **● Recording · 214 events**.
   - The recording also includes **the last ~2000 events from before you pressed it** (roughly the
     last few minutes). If you only thought of recording *after* the bug appeared, press it anyway.
2. Reproduce the bug, or just keep working.
3. When the bug shows, press **⚑ Mark bug**.
   - A screenshot is taken first.
   - Then a box asks *"What went wrong?"*. One sentence about what you expected helps the most.
     You can leave it empty.
   - The log gets a numbered marker with your note, the screenshot's file name, the whole graph,
     the runner's state, the sandbox's state and the last stored run.
4. Press the red button again to stop. The toast gives the file name. The **folder** button next to
   it opens Explorer with the file selected.
5. Hand over the `.jsonl` file and any `-mark-N.png` screenshots next to it. Or, on this machine,
   just say "look at the latest Computer log". The location is fixed (below), so it can be found.

**The switch is remembered.** A relaunch in the middle of chasing a bug keeps recording, into a new
file (its first line says `"why":"resume"`). Turn it off when you're done. The red dot is there so
you don't forget.

## Where the files are

```
%APPDATA%\LlmOnLan\logs\computer\
    computer-2026-09-24_21-15-03.jsonl          one recording, named by the local time it started
    computer-2026-09-24_21-15-03-mark-1.png     the screenshot for marker 1
```

That is `C:\Users\<you>\AppData\Roaming\LlmOnLan\logs\computer\`. A dev run (`npx electron .`) and
the installed client write to the same folder.

Limits, so a switch left on can't fill the disk:
- **25 MB per file.** At the limit, one last line says so, the recording stops and a toast tells you.
- **The 15 newest recordings are kept.** Older ones, and their screenshots, are deleted when a new
  recording starts. A recording with a marked bug is kept longer: up to 30 of those are kept on top of
  the 15, so a string of relaunches can't delete the one that holds your bug.
- **40 screenshots per recording.**

## What is in a file

One JSON object per line. Every line starts with:
- `n`: the event number;
- `ts`: local time;
- `ms`: milliseconds since the page loaded;
- `k`: the kind.

Lines recorded before you pressed the switch also carry `"pre":1`. The main process's own lines
(`log.main`, `log.end`, `main.*`) carry only `ts` and `k`. The first line (`log.start`)
carries a `readme` with this same key, so a file explains itself.

| kind | what |
|---|---|
| `log.start`, `log.main` | Header: when, which build, the window, the theme. Then what only the main process knows: app / Electron / Chrome versions, OS, CPU count, RAM |
| `snap` | The whole state when the recording started: farm (keys redacted), store mode, runner state, the open graph, the sandbox, what is waiting, modules that failed to load |
| `ui.click` `ui.dblclick` `ui.menu` `ui.auxclick` `ui.key` `ui.drag` `ui.wheel` `ui.drop` `ui.paste` `ui.change` `ui.edit` | What you did, while the Computer was on screen (`ui.auxclick` is a middle-button click; a right-click is `ui.menu`). The **target** is named in words: the element, the one or two boxes around it, the part id and type, the wire, the port, and the button label you saw |
| `ui.toast` `ui.prompt` `ui.confirm` (+ `.answer`) | What you were told, and what you answered |
| `doc.open` `doc.edit` `doc.select` `doc.view` | A graph opened (the whole document). Each edit says what changed: parts added / removed / moved / resized, settings with their new values, wires added / removed, labels, the title. Also undo / redo |
| `run.start` `run.part` `run.end` `run.capped` `run.parked` … | The runner: the plan, every part's state change (with the value for small graphs, the error for a failed part), the end report |
| `http.req` `http.res` `http.body` `http.fail` | Every request the page makes and its answer. For a chat request: the model, each message's role and clipped text, and picture sizes (never the bytes). A failing answer's body is included. The farm's `/models` poll is logged once a minute unless it fails. The same request repeated in a burst (a fan-out) is written 20 times per 10 s, and the rest are counted in `http.quieted`. Failures are always written |
| `err.uncaught` `err.rejection` `err.resource` `err.csp` `err.store` | Runtime errors, with message, file:line and stack |
| `con.error` `con.warn` `con.info` `con.log` | The console |
| `sbx.state` `sbx.error` `sbx.log` `sbx.log-dropped` `sbx.gone` | The sandbox that runs p5 / three / HTML: its state, the guest's errors and console (20 lines/s; the lines over that are counted in one `sbx.log-dropped` per second) |
| `bus.farm` `bus.gov` `bus.visible` `bus.store` | The farm changed, the seat governor changed, the Computer was shown or hidden |
| `perf.frame` | A frame longer than 100 ms, with the three scripts that took longest (file, function, what invoked them). Only while recording: watching frames costs a little on every frame, so an idle recorder does not |
| `mark` `mark.cancelled` | A bug marked by hand: the note, the screenshot, the whole state and graph, the last run. If the note box is cancelled, no marker is saved: one `mark.cancelled` line names the screenshot already on disk |
| `main.renderer-gone` `main.unresponsive` `main.responsive` | Written by the main process when the page crashed or hung, which the page cannot report itself |
| `log.pagehide` `log.stop` `log.full` `log.end` | How the file ended (`log.full` is the main process's line at the 25 MB limit; `log.end` is its last line) |

## What is never in a file

- **The farm password and the OCR key.** Any field named like a key, token, password, secret,
  cookie or authorization is written as `[redacted]`, and so is any `Bearer …` string. No request
  header is logged except the file name an OCR upload carries.
- **What you type in a password field**: no value, no length and no key (AltGr characters
  included). Other fields are summarised once per edit, not per keystroke. The value is clipped to
  600 characters.
- **Picture, PDF or sound bytes.** A `data:` URI is written as its type and size.
- **Anything while you're in LOL Chat or Open WebUI.** Interactions are recorded only while the
  Computer is on screen. Errors and requests are global, because a bug doesn't care which tab
  you're on.

The file stays on this computer. Nothing is sent anywhere; handing it over is your choice.

## For whoever reads it

- **Start from the `mark` lines.** Each marker's `note` says what was expected, and its `doc` is
  the graph at that moment. The lines just before it are how it got there.
- To rebuild a graph: take `mark.doc` (or `snap.doc` / `doc.open.doc`). It is the document in the
  store's shape, with long strings clipped and pictures reduced to their size.
- Quick reads:
  ```bash
  grep -n '"k":"err\.\|"k":"con.error\|"k":"sbx.error\|"k":"http.fail' computer-*.jsonl
  grep -n '"k":"mark"' computer-*.jsonl | cut -c1-400
  ```
- `perf.frame` lines point straight at the slow function (`scripts[0].src` / `fn`).

## How it is built (for the next builder)

- `renderer/chat/computer/devlog.mjs`: the flight recorder. It's installed at module evaluation in
  `computer/main.mjs`, before anything else loads. `attach(app)` wires the host, runner, bus and
  dialogs.
- `renderer/chat/computer/devlog-format.mjs`: **pure**. Redaction, clipping, the edit diff, the
  request summary and the target description. It's pinned by
  `test/chat/unit/computer-devlog.test.mjs`.
- `renderer/chat/computer/recorder.mjs`: the three buttons. They're hidden when the shell has no
  debug-log door.
- `renderer/chat/projects/bridge.mjs` `debugLogDoor()`: the one door to main (lint rule 10).
- `shell/src/main/debugLog.ts`: the writer. Main picks the folder and the file name. The renderer
  can only start, append text, stop, ask for a screenshot and ask to be shown the file. The
  channels are `lol:debugLog:*` in a marked region of `src/main/index.ts`, and the preload has one
  additive `debugLog` property.
- End-to-end: `test/chat-harness/scenarios/k7-recorder.mjs`. Run it with `K7_KEEP=<path>` to keep
  the recording it makes and read it.
