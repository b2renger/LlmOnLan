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
   - After the body renders, and at each resize, the canvas places that dot level with the middle of its row.
   - A dot with no row, or a box whose row is not drawn (folded), keeps today's even spacing.
   - The y it measured is kept on the box, and `wires.mjs` (`portPoint`, `wireEnds`) uses it, so a wire still ends on
     its dot.
   - The measurement runs at render and resize only, never while panning: the pan budget's measured margins
     (`computer-look.css:131-135`) are not touched.
   - Saved graphs are unaffected: a wire refers to its dot by name (`serialize.mjs:122`), not by position.
2. **Each row says which dot it is.**
   - On Classify, Filter and Code, every row a dot fills starts with the dot's name in small type: *items*,
     *question*, *options*; *items*, *criterion*; *inputs*, *code*.
   - Classify and Filter gain a first row for **items**, the input that has no field: *items — wire a list, or lines
     of text, here*. Once a run has read them, it becomes *5 items, from "Text"*.
   - The order of `inputs` follows the rows: Classify becomes `items`, `question`, `options`.
   - A wire dropped on the box's body still lands on `items` first (`bodyDropPort`, `canvas.mjs:329-343`, takes the
     first free input that accepts it).
3. **A field that a wire replaces says so.**
   - While its dot is wired, the field is read-only, dimmed, and reads *From the wire: "<the source box's name>"*.
   - What was typed stays underneath and comes back when the wire is unplugged.
   - The box learns this from the graph, as Code already does (`codeWired`, `parts/code.mjs:63-72`), not from the
     canvas.
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
  - With a measured y, `portPoint` and `wireEnds` use it; without one, the even spacing.
  - Classify's `inputs` order is `items`, `question`, `options`.
  - A body drop of a text wire lands on `items`.
- **Unit** (`classify-part.test.mjs`): a wired options dot makes the field read-only with the source's name, and
  unwiring brings the typed text back.
- **Harness, a new scenario** (the owner's case):
  - On Classify, Filter and Code, each dot is within 4 px of its row's middle, after a resize as well.
  - A Text box wired into `items` runs.
  - Wiring `options` dims the Options field.
  - Hovering a dot shows its name.
- **Harness, kept:** `k4-shots` (the glyph map) and `k8-input-canvas` (dots move with the box's height) pass,
  adjusted only where they pinned the old even spacing for these three boxes.
- **HUMAN_TESTS K19**, 5 minutes: the owner's J21 graph built again from nothing, without being told which dot is
  which.

## Done when

The tests above pass, `test:chat` and the full harness are whole, the lessons are checked, K19 is written, and the
plan's built section names the build the owner tests.
