# The Computer — where the night got to (2026-09-24, K5 landed + its fix round)

> Branch `lolchat/vnext`, all of it committed and pushed. Every phase of
> [COMPUTER_PLAN.md](COMPUTER_PLAN.md) up to **K5** is done. K5 fixes your bug report ("I do not see
> the p5js / threejs / svg nodes anywhere") by giving those boxes **names in the ＋ menu and code
> editors of their own**. It also groups the ＋ menu and makes it searchable, and ships the tutorial
> mechanic with the Tour, four lessons and two templates. The K5 fix round (review findings) made the
> creative boxes visible the moment ＋ opens, made a reopened p5/three.js answer still draw, and made
> lesson steps impossible to tick by accident. **K6** (uploading PDFs and audio to boxes, gated by the
> model's capabilities) is next and not started.

---

## Open it

Close your installed client if it is running (single-instance lock), then:

```bash
cd shell && npx electron .
```

The topbar has a three-way segmented control: **Open WebUI · LOL Chat · Computer**. The Computer is
its own surface with its own library of graphs down the left; your old per-thread graphs were migrated
into it on first open.

*(A dev run shares `%APPDATA%\LlmOnLan` with your installed client, as before. The backup from the 21st
is still at `%APPDATA%\LlmOnLan-backup-20260921-*`.)*

## What works this morning

| | |
|---|---|
| **A surface of its own** | Library sidebar: create, open, rename, duplicate, delete, import/export a graph as a document. No chat involved anywhere. |
| **Arrows carry names** | Select a wire, press **F2** (or double-click the pill), type `societal research`. That label is the name the Instruction refers to in its prose — your museum graph, exactly. |
| **See the prompt before you pay** | The transcript drawer shows **Sent / Got / Cost** for any Instruction — including *before* you run it, so you can read the assembled prompt and fix the wording without spending a generation. |
| **Two ways to run** | **▶ on any box** runs it and everything downstream (and quietly runs any un-run ancestors it needs first). **Run** does the whole stale graph. **Stop**/Escape cancels either. |
| **Control flow** | Button, Condition (yes/no/maybe), Confirm, Dialog (pauses the run and asks you), Toggle (the gate that makes a loop legal), Timer/Interval. |
| **Loops that stop themselves** | A loop must contain a gate, and four ceilings bound it: iterations, generations, wall-clock, and a per-iteration cache salt. A run never outlives the graph it started on, or the question it asked. |
| **NEW — text boxes with input and output** | Wire an Instruction (or any box) into a **Text** box and the answer lands there, renders as markdown — headings, bold, lists, tables, code — and is passed on downstream. Click into it to edit the source; blur to see it rendered again. **Lock** means "keep what I typed": a locked box refuses an arrival, says so, and still passes its own text on. An arrival never paints over an editor you have open. A box with nothing wired in is exactly the note it always was. A very long arrival is rendered down to its first 64 KB with a line saying so — the whole text still passes on and Save… still writes all of it. |
| **NEW — drop a picture in** | Drop or paste an image on the canvas; it is downscaled and stored locally, and a wired **Image** goes to the farm's vision model (your gemma4:12b) as part of an Instruction. A farm that reports no vision says so instead of sending a request. A drop reads the FIRST picture only, and a file too big to decode is refused with a sentence rather than with the renderer's memory. |
| **NEW — Preview boxes** | markdown · SVG · html/css/js · three.js · p5.js. Markdown and SVG draw with **no iframe at all**; the three code modes come back as a picture from the one sandbox guest. Save… writes .md, .svg or .png. Errors name the line. |
| **NEW (K5) — creative boxes, by name** | Press **＋ Add a box** in the toolbar (or double-click / right-click empty canvas). The first thing in the menu is a strip, **Draw with code — no farm needed**: **p5.js sketch · three.js scene · SVG · HTML page**, one click each. The same boxes (and **Markdown view**) are also rows under **Show**. Each one draws its starter code as soon as it is placed, with no farm needed. Each has its own code editor and redraws as you type. Errors name the line, and clicking the error selects that line. **Keep my code** stops an answer on the wire from replacing your edit. It saves as .js/.svg/.html/.md/.png. |
| **NEW (K5) — "Write an SVG" and friends** | In the same menu under **Think**: **Write a p5.js sketch / three.js scene / SVG / HTML page**. Place "Write an SVG" beside an SVG box, wire them, and press ▶: the model's code arrives in the box with its fences and prose removed, and it draws. A fence the model left unclosed or glued to the last line is removed too, and when it sends several blocks the box takes the one in its own language. A p5/three.js answer still draws after the app is reopened or the graph is exported and imported. Unwire it (or Reset the lesson, or Undo) and the box goes back to its own code. |
| **NEW (K5) — a menu that explains itself** | The ＋ menu has five groups (Bring in · Think · Show · Control · Annotate). Each row has a glyph and a one-line description. Type to search; typos and whole sentences work ("skecth", "threejs", "draw a spinning cube"), and so do the words people use for a box that are not its name ("render", "viewer", "webpage", "prompt", "llm"). Arrow keys and Enter work too. |
| **NEW (K5) — a first-run offer** | A new, empty graph shows **Take the tour · Open a template · Add your first box**, plus one-click picks for Text, Instruction, p5.js, three.js and SVG. |
| **NEW (K5) — Learn** | The **Learn** shelf in the library sidebar lists the Tour (no farm needed) and four lessons: hello, farm · wires carry values · arrow labels are names · make a picture. It also lists two templates: **Research → problematic** (the shape of your museum graph) and **Creative coding**. A lesson opens as your own copy, with a step rail at the bottom-left that ticks when you actually do the step, and **Show me** points at what to click. It resumes after a restart. A step that asks you to change something only counts a change made after it asked, so nothing ticks by accident. With the farm busy or absent it offers the lesson's saved answer, clearly labelled *demo answer — not generated*. The **?** in the run bar leads to the same place. |
| **NEW — the warm look, and notes for the reader** | The §9 palette: a colour **and a glyph** on every port so the kinds read in both themes, bigger rounded cards, a 24 px grid. **Sticky** (five tints), **Section** (a dashed named region) and **Title** — all three are inert: they are never in a run, never counted, never spend anything. |

## What is NOT there yet

- **Uploading PDFs and audio files to boxes** (K6, next). It will be gated by what the connected model
  can read.
- **Lessons 5–12 and the other six templates** from plan §10.3/§10.5. The shelf takes them as data
  files, and stopping between any two leaves a coherent shelf.
- **"Open live" on a Preview box**: html/three/p5 (the named creative boxes included) come back as a
  *snapshot* of the first frame, not a running frame you can interact with. Moving the one sandbox guest into a box needs a seam in the panel's host that
  does not exist yet; nothing on the box claims to be live.
- **Parts inside a Section do not move with it.** The Section frames and names a group; dragging it
  does not carry its contents.
- **Wires still stroke grey**, not the colour of the kind they carry. The port dots and their glyphs
  carry the type system for now.
- Range, Switch, Data, Website, 3D Model, Camera, Speech — parked by your own scoping.
- No image, audio, speech or video **generation** — your decision, possibly via ComfyQ later.

## The numbers, re-run by me and not taken from the builders

`chat-unit` **1293 passed** · `unit` **5** · `chat-lint` **196 files / 0 violations** ·
`chat-scope` clean · `chat-harness --strict` **280 passed** · perf **9 passed** (after the K5 fix round).

Twenty-eight of those scenarios are K5's own. Each one reaches its feature **the way a person does**:
it clicks ＋ and then a row, double- or right-clicks the canvas, clicks a shelf row, or presses Show
me. None of them places a box through a debug door. The drawing scenarios run with the farm switched
off, and they decode the returned picture to prove it is not blank. The 500-part pan-work p95 is still
under 10 ms against a 16 ms budget.

Commits, newest first:

```
HEAD     K5 fix round: steps that cannot tick by accident, sketches that survive a reload, creative boxes on screen when ＋ opens
fdc311e  the Computer's boxes have names, its menu explains itself, and it teaches by building (K5)
d76f993  docs: can the Computer work with data, and should it train models?
ef13750  typing in a Text box survives the second keystroke
3ab1ec3  the Computer's text boxes receive, its pictures can be read, and it looks like the sketch
ebbbe3b  docs: where the night got to on the Computer
58fd91f  a run never outlives the question it asked, nor the graph it was started on
da9b461  the Computer runs — a play button on every box, six control parts, loops that stop themselves
468e525  the transcript stops guessing, and its budget stops growing
5e4a252  the Computer's arrows carry names, and the prompt is readable before you pay for it
00e5231  the Computer's toasts, its Escape, and the E2E test K1 quietly broke
3c43d7c  the Computer becomes a surface of its own, with a library of graphs
44ac372  docs: write down what the owner showed us of tldraw computer
```

## What only you can check (it needs the real farm and a real window)

The harness drives the renderer, not the whole client, and this box runs a production farm, so **none
of this was verified on real hardware**:

1. **Your bug report, on the real farm (K5).** Press **＋ Add a box**, type `svg`, and add **Write an
   SVG**. Add an **SVG** box the same way, drag a wire from Write an SVG into it, and press ▶. gemma4's
   SVG should land clean and draw. Do the same with **Write a p5.js sketch → p5.js sketch**. The
   Write-… prompts were only tested against the mock model, so this is the check that matters.
2. **The Tour and lesson 1, with the farm on.** Open **Learn** in the library sidebar and walk the Tour,
   then lesson 1. Check that the rail ticks when you do each step, and that **Show me** points at
   something you can see. The screenshots I looked at are
   `shell/test/chat-harness/generated/shots/k5-shots-{dark,light}.png` and `k5-creative-boxes-*.png`.
3. **The Research → problematic template**: does its shape match your museum graph? Does it run its
   eight generations on your farm in a time you would accept?
4. **A real Instruction into a Text box**, the K4 headline. Wire an Instruction's answer
   into a Text box and read whether gemma4's markdown report lands legibly: headings, lists, a table.
   Then click in, edit a line, click out, and re-run: your edit must survive if the box is **locked**
   and be replaced if it is not.
5. **A photo through the vision model** — drop a screenshot on the canvas, wire it into an Instruction,
   and see whether gemma4:12b reads it. This is the first time the Computer sends a picture anywhere.
6. **A three.js or p5 sketch in a Preview box** — whether the snapshot is worth looking at at the size
   the box gives it, and whether an error names a line you can find.
7. **The look, on your monitor** — five kinds, five glyphs, in both themes; and whether the sticky's
   title bar reads as a label or as chrome. The two screenshots I looked at are
   `shell/test/chat-harness/generated/shots/k4-shots-{dark,light}.png`.
8. **The segmented control itself** — three buttons, the Open WebUI webview surviving a switch, and the
   view you were on being remembered across a relaunch. The harness page has no topbar at all.
9. **Your migrated graphs** — that the ones from the per-thread era still open intact. The Text part
   replaced the old Note file but kept its type id, so they should; this is the check that proves it.
10. **A loop on the real farm**, watched with a colleague chatting, to see whether the ceilings and the
   background priority feel polite from the other seat.

[COMPUTER_PLAN.md](COMPUTER_PLAN.md) section 13 is the fuller rig checklist.

## If you want the tail finished

**K6**: uploading PDFs and audio files to boxes, gated by what the connected model can read. You asked
for it, and it is next.

Also sized and waiting, in the order I would take them: **Open live** (a p5/three box you can
interact with, instead of a picture of its first frame), **parts move with their Section**, **wires
in the kind's colour**, and lessons 5–12 with their templates.
