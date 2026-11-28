# COMPUTER_DOTS_PLAN: a box's input dots sit beside the fields they fill, and say their names

**Status: approved by the owner, 2026-11-27.**
- Day question 3, "yes", the chat 14:23.
- The owner's words, 14:22: "the inputs should be in the same order of the fields in the box, we should have a clearer
  connection on how they relate. Maybe we should add tooltips when hovering the inputs / outputs".
- The timing, 14:23: "We should do all that before releasing new farm and new client".
- The design below is the session's. The owner may overturn it before the build.

Size **M**. The client only (`shell/renderer/chat/graph/`, three part specs, their strings and CSS). No new dependency.

## Why (HUMAN_TESTS J21, 2026-11-27; DEVLOG 14:10)

The owner wired a Text box into the Classify box twice, and twice into the wrong dot.
- The dots are spaced evenly down the box's left edge in the order of the spec's `inputs`, regardless of what the box
  shows (`portOffsetY`, `graph/wires.mjs:29-34`). For Classify that order is `items`, `options`, `question`
  (`parts/classify.mjs:129-134`), while its fields read Question, Options, *Sure above* from the top. `items` has no
  field at all.
- A dot shows only its kind's glyph. Classify's are `{}`, `T`, `{}` (`css/computer-look.css:170, 202-203`), so the Text
  box's `T` output looks as if it belongs in the `T` dot, which is `options`.
- The names exist, but only in a native tooltip (`title`, `graph/canvas.mjs:1931`), which appears after a second's
  pause on a 14 px dot.
- A field that a wire replaces stays editable, with nothing on it (`classify.mjs:193-203`), so typing into it seems to
  do nothing.

The boxes with more than one input are **Classify** (items, options, question), **Filter** (items, criterion) and
**Code** (in, code). Every other box has one input or none.

## The change

1. **A dot can belong to a row of its box.**
   - An input in a spec may name `row`, a selector for the element in the box's body that the dot fills.
   - The canvas places that dot level with the middle of its row:
     - when the body is first laid out, and whenever anything in the body changes size: one ResizeObserver watches every
       child of the box's body wrapper. A row moves without resizing when a line above it appears, such as Code's
       *whose* line;
     - at a resize, measured at once inside `layoutPorts`;
     - when the body scrolls.
   - **Per dot, not per box** (the advisor, 2026-11-28): a dot whose row is not drawn (Filter's criterion in *Length*
     mode, a folded Code's editor) goes below the last measured dot. The other dots stay on their rows. With nothing
     measured, a box keeps today's even spacing. A row scrolled out of the body is clamped to the box's edge.
   - The y it measured is kept in a map beside the boxes (cleared with them when a lesson reuses ids).
     - `wires.mjs` takes it as an optional lookup: `portPoint`, `wireEnds`, `wireAt` and the wire layer.
     - The canvas routes every geometry call through one function that closes over that lookup: the snap targets,
       the body-drop preview and the hit tests. So a wire is drawn, clicked and snapped where its dot is.
   - The measurement never runs while panning or zooming: the pan budget's measured margins
     (`computer-look.css:131-135`) are not touched.
   - Saved graphs are unaffected: a wire is saved as `{from, to, port}`, with the dot's name (`serialize.mjs:122`,
     checked 2026-11-27), not its position.
   - The examples and the Computer's MCP name the dots too (*"Classify's question port"*, `examples/think.mjs:107`;
     `mcp-tools.mjs:56`), never their position.
2. **Each row says which dot it is.**
   - On Classify, Filter and Code, every row a dot fills starts with the dot's name in small type: *items*,
     *question*, *options*; *items*, *criterion*; *inputs*, *code*.
   - Classify and Filter gain a first row for **items**, the input that has no field: *items — wire a list, or lines
     of text, here*. Once a run has read them, it becomes *5 items, from "Text"*.
   - The order of `inputs` follows the rows: Classify becomes `items`, `question`, `options`.
   - A wire dropped on the box's body still lands on `items` first: `bodyDropPort` (`canvas.mjs:329-343`, checked)
     takes the first free input, in order, that accepts it.
   - **The second drop changes, on purpose.** A second Text box dropped on Classify's body now becomes the
     *question* (it was the options). That is the order the rows read in, and the names show while the wire is dragged
     (step 4). A unit test pins it.
   - Classify's and Code's port labels take a capital, as Filter's do (*Items*, *Question*, *Options*, *Code*), so a
     row, a dot's name and the box's other captions read alike. No test or saved graph uses a label: wires are saved
     by name.
3. **A field that a wire replaces says so.**
   - While its dot is wired, the field is read-only, dimmed, and reads *From the wire: "<the source box's name>"*.
   - What was typed stays underneath and comes back when the wire is unplugged.
   - **The box asks the canvas** (changed 2026-11-28, at the build): `PartCtx.wiredFrom(port)` gives the names of the
     boxes wired into that dot.
     - Why not from the graph, as Code's `codeWired` does (`parts/code.mjs:63-72`): the box must show the source
       box's *name*, and only the canvas knows names (`titleFor`, the specs).
     - A ctx without it (a box example, the drawer) means *unknown*, and the fields are left alone, as `codeWired`
       treats a missing document.
   - **A question wire that brought its own options** (＋ → Think → *Write a Laya question*) replaces the typed
     options too (`classify.mjs` `run`). After such a run, the Options field says so as well, for as long as that wire
     is plugged in.
   - Code's editor stays editable while its `code` dot is wired: typing into the model's code makes it the person's,
     Code's own rule (`code.mjs:228-234`).
4. **Hovering a dot names it at once.**
   - The `::after` that draws the glyph shows the glyph and the name together on `:hover`, so no new element is
     needed: *`{}` items*, or *T options (replaces the Options field)*.
   - An output dot shows its kind: *output: a list*.
   - While a wire is being dragged, the dots of the box under the pointer all show their names, which is the moment
     a person chooses.
   - The `title` stays, for the slower native tooltip and for screen readers.
5. **Help and lessons.** Classify's and Filter's hint strings name the dots by their new places. HUMAN_TESTS J21 step 2
   is rewritten. The Computer's tutorial lessons that tell a person which dot to use are checked against the new
   order.

## Tests

- **Unit** (`graph-canvas.test.mjs`):
  - With a measured y, `portPoint`, `wireEnds` and `wireAt` use it; without one, the even spacing.
  - `rowOffsets`: measured dots where they measured, the others below the last one, all inside the box.
- **Unit** (`computer-s1-canvas.test.mjs`): Classify's `inputs` order is `items`, `question`, `options`; three Text
  boxes dropped on its body land on items, question, options.
- **Unit** (`classify-part.test.mjs`, the runner's DOM shim):
  - A wired Options dot makes the field read-only with the source's name, and unwiring brings the typed text back.
  - The items row names its source, then what a run read.
  - A question wire that brought options dims the Options field after the run.
  - A ctx without `wiredFrom` dims nothing.
- **Harness, a new scenario** (the owner's case):
  - On Classify, Filter and Code, each dot is within 4 px of its row's middle, after a resize as well.
  - A Text box wired into `items` runs.
  - Wiring `options` dims the Options field.
  - Hovering a dot shows its name.
- **Harness, kept:** `k4-shots` (the glyph map) and `k8-input-canvas` (dots move with the box's height) pass,
  adjusted only where they pinned the old even spacing for these three boxes.
- **HUMAN_TESTS A32** (a client test, beside A10, the Computer's), 5 minutes: the owner's J21 graph built again from
  nothing, without being told which dot is which.

## Done when

The tests above pass, `test:chat` and the full harness are whole, the lessons are checked, A32 is written, and the
plan's built section names the build the owner tests.

## Built (night n° 19, 2026-11-28)

- **The code:**
  - `graph/wires.mjs` (`rowOffsets`, an optional measured y in `portPoint`, `wireEnds` and `wireAt`);
  - `graph/canvas.mjs` (the measured-row map, one ResizeObserver, `PartCtx.wiredFrom`, every geometry call through
    the lookup);
  - `parts/fields.mjs` (`portRow`, `wireField`, `wiredNames`);
  - Classify, Filter and Code; the CSS; the strings.
- **Found while building:** the hover name was styled but not painted.
  - Each box's paint containment (`graph.css`, the perf pass's `content-visibility` with
    `overflow-clip-margin: 16px`) cut it to its last letter.
  - The hovered box, or the box a wire is dragged over, gets a 160 px clip margin. Only that box, so the pan budget
    does not move.
  - `k19-dots` now checks the label is painted whole, which a check of the CSS `content` alone missed.
- **Classify's rows fit its 230 px box as before:** 4 px gaps and a 52 px Options field. A box after a run is 1 px
  over (measured).
- **Tests:**
  - unit: `graph-canvas` (2 tests), `computer-s1-canvas` (the body-drop order), `classify-part` (the wired fields);
  - `test:chat` **1999** passed (1 skipped), lint 0;
  - the harness **426/427**: the new `k19-dots` ×2 pass. The one failure, `p2-groups-pin-rename`, also failed in
    the baseline before this work, and passes 3/3 alone (a flake of the full run).
- **The lessons:** checked. None depends on the old order. The one sentence naming a dot's place (`examples/think.mjs:82`,
  Code's "upper dot") stays true.
- **After the advisor** (`58e3969`):
  - The perf gate passes 9/9 (`perf-graph-500` pan p95 1.0 ms). Its fixtures hold Text boxes only; the load-time
    measure is a marked ceiling.
  - Code's *whose* sentence moved into its Code row: as a line of its own it left one line of editor for a program
    from a wire; now three, as before.
  - `k19-dots` checks that Filter and Code fit.
  - The full harness: 427/428, the p2 full-run flake again.
- **The build for the owner:** `shell\dist\LlmOnLan-Setup-0.2.21+n19-windows-x64.exe` (03:15, from `58e3969`), for
  HUMAN_TESTS A32.
