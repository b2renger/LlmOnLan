# The Computer — a tutorial

The Computer is a canvas inside a chat where you place **parts**, draw **wires** between them and
press **Run**. Values flow along the wires; the parts that think call the model on the farm, and the
parts that count run plain JavaScript on your own machine. It is a small visual program you assemble
in a minute and re-run all afternoon, because on our own farm re-running costs nothing.

It is **not** a mind map, not a chat with a diagram, and not a place to organise notes. There is no
free-form drawing, no cloud, no API key. Every part either holds a value, transforms one, or asks the
farm on the LAN for one.

Two worked examples ship with it, in [examples/](examples/):

| File | What it shows |
|---|---|
| [`palette-check.lolgraph.json`](examples/palette-check.lolgraph.json) | The model judges, JavaScript checks: a palette proposed by the model, its WCAG contrast computed exactly, a swatch sheet drawn, a `tokens.css` written. Seven parts, **one** generation. |
| [`fanout-pitches.lolgraph.json`](examples/fanout-pitches.lolgraph.json) | Fan-out: six topics, one Run, six generations, rejoined into one file. |

Both files are rebuilt from [`examples/build-examples.mjs`](examples/build-examples.mjs), which runs
them through the real graph engine, and both are run end to end by the harness scenario
[`shell/test/chat-harness/scenarios/examples.mjs`](../shell/test/chat-harness/scenarios/examples.mjs).
They are not illustrations; they work.

---

## Opening it

Open a chat first — **a graph belongs to a conversation**, one canvas per thread. Then either:

- press the **Computer** button in the chat header (its tooltip reads *Open Computer*), or
- press **Ctrl+1**, or
- click the **Computer** tab in the rail down the right-hand edge of the workbench column.

`Ctrl+\` cycles the three widths — **Chat**, **Split**, **Panel** — and there are three buttons for
the same thing at the top of the workbench. Build in **Split** so you can still see the conversation;
switch to **Panel** when the graph gets wide.

An empty canvas says *"Place a part to start. Wire it up, then press Run."*

---

## Part 1 — build the palette graph by hand

The point of this graph: **the model proposes colours, JavaScript decides whether they are legible.**
A 12B model cannot compute a contrast ratio and should never be asked to. It can have taste; the
arithmetic is ours.

You will build seven parts. It takes about ten minutes the first time. If you would rather see it
running first, skip to [Part 2](#part-2--import-the-fan-out-example) and import
`palette-check.lolgraph.json` instead — then come back and take it apart.

### Step 1 — the brief (Note)

Press **Add a part** in the toolbar. A menu drops down listing all eleven part types in palette
order: Note, From thread, Ask, Split, Repeat, Filter, Collect, To thread, Code, Render, File. Choose
**Note**. (The new part lands in the middle of the view, so pan to where you want it first.)

A box lands on the canvas with a text area in it. Type your brief — mine is:

```
Atelier Num is a small studio that does VR, projection and installation work.
The site is dark by default, reads as a workshop rather than an agency, and shows a lot of
photography. It needs a page background, a surface for cards, one accent for links and buttons,
and two text colours (body and muted).
```

**On screen now:** one box labelled *Note*, its state pill reading **Not run**, with your text in it.
A Note has no input port — it is a literal, and the left edge of most graphs. An unwired Note is just
a comment, which is a legitimate use.

### Step 2 — the ask (Ask)

**Add a part → Ask.** Drag it to the right of the Note (drag anywhere on the part except its own
controls; parts snap to a 10 px grid).

Wire them: put the pointer on the **small round port on the right edge of the Note**, press and
drag. A line follows the pointer. Drop it on the **port on the left edge of the Ask**, labelled
*Context in*. The wire snaps to the nearest input port if you are close, and the canvas announces
*"Note now feeds Ask"*.

If a wire is refused it snaps back and says why in one line — *"That would make a loop. Use Repeat
instead of feeding a value back."*, *"Those two are already wired together."*, or
*"Note produces text, which Look does not accept."* Wire refusals happen at draw time, never
silently at run time.

Now the Ask's settings, all on the part itself:

| Control | Set it to |
|---|---|
| The big text area (*Instruction*) | `Propose exactly five colours for this site. Give each one a short name, a six-digit hex value starting with #, and the role it plays. Do not explain them.` |
| *Model* | **Automatic** — let the farm's default model answer. Pick a specific one only when you mean to. |
| *Answer shape* | **JSON** |
| *Schema* | the JSON Schema below |

```json
{"type":"object","properties":{"palette":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"hex":{"type":"string"},"role":{"type":"string"}},"required":["name","hex","role"],"additionalProperties":false}}},"required":["palette"],"additionalProperties":false}
```

The shape matters. With **Text** you get prose you would have to parse; with **JSON** the answer is
validated against your schema before it becomes a value, and everything downstream can rely on it.
(*List* is the third shape — a plain array of strings, which is what you want when the next part
should run once per item.)

**On screen now:** Note → Ask, one wire, both **Not run**. Wired inputs arrive in the prompt as
labelled context, above your instruction — so the Ask sees your brief whether or not you repeat it.

### Step 3 — the arithmetic (Code)

**Add a part → Code.** Wire **Ask → Code** (port *Inputs in*).

A Code part is `(inputs) => value` and nothing more. `inputs.in` is an **array** — several wires can
land on one port — so the object from the Ask is `inputs.in[0]`. It runs in the sandbox: no network,
no file access, a watchdog for infinite loops. Returning a string gives a `text` value, an object
gives `json`, an array gives a `list`.

Type (or paste) the contrast maths. The copy in
[`examples/build-examples.mjs`](examples/build-examples.mjs) is the one that is tested; the shape of
it is:

```js
const first = inputs.in[0];
const list = Array.isArray(first) ? first
  : (first && Array.isArray(first.palette) ? first.palette : null);
if (!list || !list.length) {
  throw new Error('No palette arrived. Wire the Ask part into this one and set its shape to JSON.');
}
// sRGB -> relative luminance -> (L1 + 0.05) / (L2 + 0.05)
// #000 against #fff is 21:1;  #777 against #fff is 4.48:1
```

It returns `{threshold, checked, failing, rows, table}` — a row per colour with its ratio against
black and against white, a boolean verdict against 4.5:1, and a markdown table you can read.
A colour it cannot parse is **flagged**, not guessed at: that is the whole reason this is JavaScript
and not a second question to the model.

**Press Run now** (the button, or `Ctrl+Enter`). The Ask goes **Waiting**, then **Running**, then
**Done**; the Code follows within milliseconds. Under each part that has finished, a cost line:
`1.8s · 412 tokens`. The Code part's is `0.0s · 0 tokens` — deterministic work costs nothing, which
is the point.

**Click the value preview** at the bottom of the Code part. The full value opens in the chat column
on the left, headed *From Code*. That column is the inspector: the canvas is the program, the
conversation is where you read things at full size. Close it and the graph is unchanged.

If the graph is now wider than the window, press **Fit** (or the `f` key). To zoom by hand, ctrl-wheel;
to pan, hold space and drag, middle-drag, or just wheel.

### Step 4 — the picture (Code → Render)

The report is data; a swatch sheet is a picture. **Add a part → Code** again, wire **contrast Code →
this Code**, and have it return an SVG string — again, the tested copy is in the generator. Then
**Add a part → Render**, wire the new Code into it, and set *Read as* → **SVG**. The *Width* and
*Height* fields disappear when you do: an SVG brings its own size, and the part will not pretend
otherwise. (They come back for Markdown and HTML page, which need a drawing surface.)

Press **Run**. Only the two new parts run: everything upstream is already **Done**, and Run
recomputes only what is stale. The Render part becomes a tile showing the sheet, with **Save as SVG**
and **Save as PNG** under it.

SVG mode never goes near the sandbox — an SVG already is a picture, so it is sanitised and shown as
it is, and *Save as SVG* gives you back the exact bytes. **Markdown** and **HTML page** modes draw in
the sandbox and hand back a raster.

### Step 5 — the file (Code → File)

**Add a part → Code** a third time, wire **contrast Code → this Code**, and return a `:root{}` block:
one `--custom-property` per readable colour, with the measured ratio in the comment, and a comment
line for anything it had to reject. Then **Add a part → File**, wire that Code into it, and set
*Path in the project* to `out/tokens.css`.

Press **Run**. The File part shows *Wrote out/tokens.css* and offers **Reveal in Explorer**. It wrote
into **this conversation's own scratch project folder** on your machine — one project per thread,
created on first write. A second run overwrites the same path; you never get `tokens (3).css`.

### Step 6 — tidy, and what it looks like finished

Press **Tidy**. The parts lay out left to right in columns: Note, Ask, contrast Code, the two
formatting Codes stacked, then Render and File. Tidy never runs on its own — it is a button, and one
**Undo** (the toolbar button, or `Ctrl+Z`) puts everything back where you had it.

Undo covers the program, not the run: placing, wiring, deleting, editing a setting and importing are
all undoable in one step each. Values a run computed are not undone, because they are not edits.

**Change one word in the Note and press Run again.** Everything downstream goes **Needs a re-run**
and recomputes; nothing else does. That is the loop this panel exists for.

### When a part goes red

A failed part turns red, its state pill reads **Error**, and it carries a sentence in plain English —
never a stack trace, never a file path off your disk. Fix the cause, press **Run**: only the failed
part and what depends on it will run again. Every case I hit is in
[troubleshooting](#troubleshooting) below.

---

## Part 2 — import the fan-out example

Press **Import…** in the toolbar and choose
[`docs/examples/fanout-pitches.lolgraph.json`](examples/fanout-pitches.lolgraph.json). (You can also
just drag the file onto the canvas — the canvas shows *"Drop a .lolgraph.json file to open it here."*)
If the canvas already has parts on it, it asks first: *"This conversation already has 6 parts.
Importing replaces them; one undo takes it back."* One **Undo** really does take it back.

You get five parts: **Note** (six topics, one per line) → **Split** (by lines) → **Ask** (one
paragraph per topic) → **Collect** (numbered list) → **File** (`out/pitches.md`).

Press **Run**.

### What fan-out actually is

The Split part turns the Note's text into a **list** of six items. The Ask part's Context port accepts
`text`, not `list` — and that mismatch is not an error, it is the fan: **the Ask runs once per item**,
and its output becomes a list of the same length. Fan-out keeps propagating downstream until a
**Collect** part joins it back into one value.

So: **one Run, six generations.** While it runs:

- the Run button is replaced by **Stop**, which reads `Running 3/5 · item 4/6` — which part of the
  graph, and which item of the fan;
- the Ask part itself shows `4/6` and ticks up;
- the cost line on the Ask, when it finishes, reads something like `11.4s · 2130 tokens · 6 calls`.

**One failing item does not take the others down.** Each item keeps its own error; the part shows
`2 of 6 items failed` and lists them, and the five that worked keep their answers. Collect joins what
there is.

### The cap

A run that would spend more than **50 generations** stops and says so, rather than quietly eating the
farm:

> **This run stopped at 50 generations** — 3 parts were left for later, so a graph cannot quietly
> spend the farm.

with a **Raise the cap for this run** button next to it. That raises it **for that run only** —
enough to finish the fan, never "unlimited" — and answers already computed are cached, so raising the
cap only pays for the items it never asked. If you want a different standing limit, the **Cap** field
in the toolbar sets it and remembers it.

Try it: paste sixty lines into the Note and press Run.

### Stop, and why a colleague goes first

**Stop** (the button, or `Esc`) aborts the one request in flight and leaves every completed value
cached. Press Run again and it picks up from there.

While a graph runs it holds the farm at **background priority**. If someone — including you — types a
message in the chat, the human goes first: the graph yields, and the run line says *"The farm went to
someone else — press Run to pick up where it stopped."* This is not a failure and nothing is lost.
It is also the reason a forty-item fan-out is socially acceptable on a shared farm at all: it is
always at the back of the queue.

Closing the panel or the app stops the run. The values survive.

---

## Part 3 — three things to try next

**1. Four variants of one thing.** Note (a brief) → **Repeat** (*Times* = 4) → Ask ("rewrite this
headline") → Collect (*Join as* → Numbered list). Repeat turns one value into a list of four
deliberate copies, so the Ask fans out into four genuinely separate generations rather than one
cached answer reused four times.

**2. Sift a long list without reading it.** Note (thirty lines) → Split (*Split by* → Lines) →
**Filter** (*Keep when* → **The model says yes**, *Criterion* = "is this about hardware?") → Collect.
Filter's model mode spends one small generation per item and caches the verdict by item, so re-running
after an edit downstream costs nothing.

**3. Pull the conversation in, and push the result back.** **From thread** (*Take* → The last answer)
→ Code (count the sentences, or strip the headings) → **To thread** (*Post as* → The assistant). The
graph result lands in the conversation as a message you can then talk about — which is usually where
a good result wants to end up.

---

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| The Ask is red: *"No farm is connected, so this part cannot run."* | The client has not found a farm on the LAN. | Check the farm strip under the chat's top line — it says `farm silent` or `password needed` when there is nothing to talk to. Nothing in the graph runs without a farm; there is no cloud fallback, by design. |
| The Ask is red: *"The farm is busy with someone else. Press Run again in a moment."*, or the run line says *"The farm went to someone else…"* | Every seat on the farm is in use, or a human took priority. | Press **Run** again — everything already done keeps its value. The farm strip tells you how many seats are in use (`2/2 seats`). |
| A part is red with a sentence, everything downstream is **Needs a re-run** | One part failed; the engine stopped that branch rather than passing nothing along. | Fix the part, press **Run**. Only the failed part and its dependants run again. |
| *"The answer did not match the shape you asked for."* | The model's JSON did not validate against your schema. | Simplify the schema (fewer required fields, no nesting), or shorten the instruction. A 12B model does better with a flat object. |
| *"Answer shape is JSON, so this part needs a schema."* / *"That schema is not valid JSON."* | The Ask is set to JSON with an empty or broken schema. | Paste valid JSON Schema into *Schema*. A bad schema never reaches the farm — it costs nothing to get wrong. |
| The palette graph runs but every colour is flagged *"not a colour I can read"* | The model returned names or prose where hex values were asked for. | That is the Code part doing its job. Re-run — or tighten the instruction ("a six-digit hex value starting with #"). Never move this check into the model. |
| The Code part shows a **Line 7** chip and *"Line 7: x is not defined"* | Your JavaScript threw. | Click the chip; the editor points at that line. Remember `inputs.in` is an **array**, and a list arrives **whole** (Code never fans out — fan before it if you want per-item work). |
| *"That code returned nothing…"* | The body fell off the end without a `return`. | Return text, a number, an array or an object. "No value" is a failure here, never a state. |
| The Render part: *"That text does not start with `<svg>`, so it cannot be drawn as SVG."* | *Read as* is SVG but the input is markdown or JSON. | Switch *Read as* to Markdown, or make the upstream part return SVG source. |
| The File part: *"Type a path, like out/value.md, before writing."* or *"The file was not written: …"* | The path is empty, escapes the project (`..`), or has an extension that is not allowed. | Use a relative path inside the project, like `out/tokens.css`. Paths are validated in the main process, not by renderer politeness — `..` is refused there and always will be. |
| *"A picture needs a picture file name — end the path with .png."* | A Render tile wired into a File with a `.md` path. | End the path with `.png` for the raster, or `.svg` to write the vector source. |
| A wire snaps back | The canvas refused it: a loop, a duplicate, or a type the target does not accept. | Read the line it printed. Loops are rejected on purpose — iteration is **Repeat**, not feedback. |
| *"Open a chat to build a program — a graph belongs to a conversation."* | The panel is open with no thread selected. | Start or select a conversation first. |

---

## What is not built yet

Being honest about the edges, so you do not go looking:

- **No image parts.** The spec's `Image` and `Look` (vision) parts are not in the catalogue — they
  wait on the attachment intake work. There is no way to get a picture *into* a graph yet, only out
  of one via Render.
- **No image generation**, and there never will be until the farm serves an image model.
- **No web search or fetch part.** SearXNG is a farm plugin the chat uses; the Computer has no
  network part at all, deliberately.
- **No sub-graphs**, no graph-as-a-part, no scripting language, no multi-user editing.
- **The other benches are not built**: the vibecode bench (S2), the design bench and the board bench
  (S3) from [LOLCHAT_STUDIO_PLAN.md](LOLCHAT_STUDIO_PLAN.md) are still on paper. The Computer is the
  first real workbench panel and currently the only one.

The full design, including what was deliberately left out and why, is in
[LOLCHAT_COMPUTER_SPEC.md](LOLCHAT_COMPUTER_SPEC.md).
