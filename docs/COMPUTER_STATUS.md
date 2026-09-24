# The Computer — where the night got to (2026-09-24, K6 landed)

> Branch `lolchat/vnext`, all of it committed and pushed. Every phase of
> [COMPUTER_PLAN.md](COMPUTER_PLAN.md) up to **K6** is done. K6 answers your request — *"upload pdfs
> or audio files to nodes … conditional to the box we are connected to and the models it serves and
> these model capabilities"*: a **Document** box and a **Sound** box, a canvas that turns any dropped
> file into the right box, and a **"takes:" line** on every box that holds a file, saying whether what
> it holds can be used where it is wired — and, when it cannot, why and what would change that.
> The short version of what the farm allows today: **a PDF works** (the farm's OCR reads it, the text
> comes back and flows on); **a sound file is kept and played but not sent** — nothing on this farm
> can listen yet, and the box says so. A farm transcription service is written up for you to decide
> (DISCUSS D-F12).

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

## NEW (K6) — a PDF or a sound file in a box, step by step

**A PDF.**
1. Drag the PDF from Explorer onto an empty part of the canvas. While you drag, the canvas says
   *"Drop a picture, a PDF, a sound file, a text file — or a .lolgraph.json to open it"*. Let go and a
   **Document** box appears where you dropped it. (Or: **＋ Add a box → Bring in → Document**, then drop
   the PDF on the box, click its face to choose one, or paste one while the box is selected.)
2. The box names the file and says *"Kept on this computer. The farm reads its text only when the graph
   runs, and only the text comes back."* **Nothing has been sent.** Its line reads **takes: PDF ✓**
   when your farm advertises document reading.
3. Wire it into an Instruction ("summarise this") and press ▶. The box says *"Reading field-notes.pdf on
   the farm…"*, then shows the extracted text, page by page, scrolling inside the box. That text is
   what the Instruction receives. Run it again, or drop the same file into another box: the farm is not
   asked twice. Past 60 pages it says *"First 60 of 120 pages. The rest was not passed on; split the
   PDF to use it."* on the box and in what it passes on.
4. **When it cannot:** if the farm is connected but its Document OCR service is off or down, the box's
   line reads **takes: PDF ✗** with *"This farm does not offer document reading right now (its Document
   OCR service is off or down), so the PDF stays here and nothing is sent. Whoever runs the farm can
   turn Document OCR on in its admin panel."* A PDF dropped on the box anyway is refused, in red, with
   *"report.pdf was not kept, and nothing was sent. Drop it again once the farm reads documents."* —
   nothing is kept. A PDF dropped on the canvas in that state is refused with the farm's sentence as a
   toast, and no box is placed.
   With no farm at all the box keeps the file and reads it on the first run with a farm that can.

**A sound file.**
1. Drag a .wav / .mp3 / .ogg / .m4a / .flac onto the canvas (or **＋ → Bring in → Sound**, then drop it
   on the box or click its face to choose). A **Sound** box appears with the file's name, its length,
   and **▶ Play** / **■ Stop** — it plays right there, one sound at a time. Over 25 MB or 10 minutes, or
   a file Chromium cannot decode, is refused with a sentence and not kept.
2. Wire it into an Instruction. Its line reads **takes: sound ✗** with, on your farm today: *"This farm
   runs its models through Ollama, which has no way to pass sound on, so the sound is not sent. Its name
   and length go along as text."* (On an engine that could pass it on, the sentence names the model the
   farm does not say can listen instead.) The Instruction shows `gemma4:12b: pictures ✓ · sound ? · PDF
   directly ?` while a picture or a sound is wired in.
3. Press ▶: the Instruction gets *"Sound file "interview.wav" (0:02, 0.0 MB). The sound itself was not
   sent: …"* — honest text, never the sound, never a wasted request.

**Anything else** dropped on the canvas (a program, a zip…) is refused with a toast naming the file
and what the Computer does take. Text files (.txt/.md/.csv/.json) become Text boxes with their
contents; pictures become Image boxes, which now carry the same "takes:" line.

## What works this morning

| | |
|---|---|
| **NEW (K6) — PDFs, sound, and a line that says what a box can take** | See the section above. The Document box sends its PDF to the farm's OCR only when a run needs the text, once per file ever; the Sound box keeps and plays, and says why nothing listens; every file-holding box says **takes: … ✓ / ✗ / ?** with a sentence whenever the answer is not yes — `?` when the farm does not say, never a guess. |
| **A surface of its own** | Library sidebar: create, open, rename, duplicate, delete, import/export a graph as a document. No chat involved anywhere. |
| **Arrows carry names** | Select a wire, press **F2** (or double-click the pill), type `societal research`. That label is the name the Instruction refers to in its prose — your museum graph, exactly. |
| **See the prompt before you pay** | The transcript drawer shows **Sent / Got / Cost** for any Instruction — including *before* you run it, so you can read the assembled prompt and fix the wording without spending a generation. |
| **Two ways to run** | **▶ on any box** runs it and everything downstream (and quietly runs any un-run ancestors it needs first). **Run** does the whole stale graph. **Stop**/Escape cancels either. |
| **Control flow** | Button, Condition (yes/no/maybe), Confirm, Dialog (pauses the run and asks you), Toggle (the gate that makes a loop legal), Timer/Interval. |
| **Loops that stop themselves** | A loop must contain a gate, and four ceilings bound it: iterations, generations, wall-clock, and a per-iteration cache salt. A run never outlives the graph it started on, or the question it asked. |
| **NEW — text boxes with input and output** | Wire an Instruction (or any box) into a **Text** box and the answer lands there, renders as markdown — headings, bold, lists, tables, code — and is passed on downstream. Click into it to edit the source; blur to see it rendered again. **Lock** means "keep what I typed": a locked box refuses an arrival, says so, and still passes its own text on. An arrival never paints over an editor you have open. A box with nothing wired in is exactly the note it always was. A very long arrival is rendered down to its first 64 KB with a line saying so — the whole text still passes on and Save… still writes all of it. |
| **NEW — drop a picture in** | Drop or paste an image on the canvas; it is downscaled and stored locally, and a wired **Image** goes to the farm's vision model (your gemma4:12b) as part of an Instruction. A farm that reports no vision says so instead of sending a request. Since K6 a drop of several files places one box per file (up to 8), side by side; a file too big to decode is refused with a sentence rather than with the renderer's memory. |
| **NEW — Preview boxes** | markdown · SVG · html/css/js · three.js · p5.js. Markdown and SVG draw with **no iframe at all**; the three code modes come back as a picture from the one sandbox guest. Save… writes .md, .svg or .png. Errors name the line. |
| **NEW (K5) — creative boxes, by name** | Press **＋ Add a box** in the toolbar (or double-click / right-click empty canvas). The first thing in the menu is a strip, **Draw with code — no farm needed**: **p5.js sketch · three.js scene · SVG · HTML page**, one click each. The same boxes (and **Markdown view**) are also rows under **Show**. Each one draws its starter code as soon as it is placed, with no farm needed. Each has its own code editor and redraws as you type. Errors name the line, and clicking the error selects that line. **Keep my code** stops an answer on the wire from replacing your edit. It saves as .js/.svg/.html/.md/.png. |
| **NEW (K5) — "Write an SVG" and friends** | In the same menu under **Think**: **Write a p5.js sketch / three.js scene / SVG / HTML page**. Place "Write an SVG" beside an SVG box, wire them, and press ▶: the model's code arrives in the box with its fences and prose removed, and it draws. A fence the model left unclosed or glued to the last line is removed too, and when it sends several blocks the box takes the one in its own language. A p5/three.js answer still draws after the app is reopened or the graph is exported and imported. Unwire it (or Reset the lesson, or Undo) and the box goes back to its own code. |
| **NEW (K5) — a menu that explains itself** | The ＋ menu has five groups (Bring in · Think · Show · Control · Annotate). Each row has a glyph and a one-line description. Type to search; typos and whole sentences work ("skecth", "threejs", "draw a spinning cube"), and so do the words people use for a box that are not its name ("render", "viewer", "webpage", "prompt", "llm"). Arrow keys and Enter work too. |
| **NEW (K5) — a first-run offer** | A new, empty graph shows **Take the tour · Open a template · Add your first box**, plus one-click picks for Text, Instruction, p5.js, three.js and SVG. |
| **NEW (K5) — Learn** | The **Learn** shelf in the library sidebar lists the Tour (no farm needed) and four lessons: hello, farm · wires carry values · arrow labels are names · make a picture. It also lists two templates: **Research → problematic** (the shape of your museum graph) and **Creative coding**. A lesson opens as your own copy, with a step rail at the bottom-left that ticks when you actually do the step, and **Show me** points at what to click. It resumes after a restart. A step that asks you to change something only counts a change made after it asked, so nothing ticks by accident. With the farm busy or absent it offers the lesson's saved answer, clearly labelled *demo answer — not generated*. The **?** in the run bar leads to the same place. |
| **NEW — the warm look, and notes for the reader** | The §9 palette: a colour **and a glyph** on every port so the kinds read in both themes, bigger rounded cards, a 24 px grid. **Sticky** (five tints), **Section** (a dashed named region) and **Title** — all three are inert: they are never in a run, never counted, never spend anything. |

## What is NOT there yet

- **A sound reaching a model.** Nothing on this farm can listen: the default engine drops sound on the
  way to the model, and no model reports it can hear. The farm-side fix is a transcription service
  (whisper on the GPU box, the same sanctioned shape as the OCR), written up as DISCUSS **D-F12** —
  yours to decide. Until then a Sound box passes on its name and length as text.
- **A PDF sent to a model as a PDF.** It always goes as text read by the farm's OCR; no model on this
  farm says it reads PDFs directly, and none is assumed to.
- **A Data / table box, and any training** — see `docs/research/COMPUTER_DATA_AND_TRAINING.md`, awaiting
  you.
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

`chat-unit` **1370 passed** · `unit` **5** · `chat-lint` **211 files / 0 violations** ·
`chat-scope` clean · `chat-harness --strict` **295 passed** · perf **9 passed** (after the K6 landing).

Fifteen of those scenarios are K6's own. Each reaches its feature **the way a person does**: it
places the box by clicking ＋ and then Bring in → Document / Sound, and brings the file in with a real
drop event on the box or on the canvas. Every refusal is read off the screen as a sentence. Every
scenario checks that nothing reached the farm that should not have: no OCR request on a drop, exactly
one per file on a run, never a sound part. The mock farm is used for all of it, never your farm.

Commits, newest first:

```
HEAD     PDFs and sound files go into the Computer's boxes, and every box says what it can be used for (K6)
43a94ac  K5 fix round: steps that cannot tick by accident, sketches that survive a reload, creative boxes on screen when ＋ opens
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

1. **A real PDF through the real farm OCR (K6).** Drop a PDF you know on the canvas, wire it into an
   Instruction, press ▶. Check that the box's text matches the document (a scanned page goes through the
   farm's vision model, so it can take a minute), and that running again does not ask the farm twice.
   Only the mock extractor was used here, because this box's farm serves real users. Screenshots:
   `shell/test/chat-harness/generated/shots/k6-shots-document-{dark,light}.png` and
   `k6-shots-refused-drop.png`.
2. **A real drag from Explorer, and a sound you can hear (K6).** The harness drops with synthetic
   events and plays silent WAVs on purpose. Drag an .mp3 from Explorer, press ▶ Play, and listen; then
   check an .m4a and a .flac decode (only WAV was decoded here).
3. **Your bug report, on the real farm (K5).** Press **＋ Add a box**, type `svg`, and add **Write an
   SVG**. Add an **SVG** box the same way, drag a wire from Write an SVG into it, and press ▶. gemma4's
   SVG should land clean and draw. Do the same with **Write a p5.js sketch → p5.js sketch**. The
   Write-… prompts were only tested against the mock model, so this is the check that matters.
4. **The Tour and lesson 1, with the farm on.** Open **Learn** in the library sidebar and walk the Tour,
   then lesson 1. Check that the rail ticks when you do each step, and that **Show me** points at
   something you can see. The screenshots I looked at are
   `shell/test/chat-harness/generated/shots/k5-shots-{dark,light}.png` and `k5-creative-boxes-*.png`.
5. **The Research → problematic template**: does its shape match your museum graph? Does it run its
   eight generations on your farm in a time you would accept?
6. **A real Instruction into a Text box**, the K4 headline. Wire an Instruction's answer
   into a Text box and read whether gemma4's markdown report lands legibly: headings, lists, a table.
   Then click in, edit a line, click out, and re-run: your edit must survive if the box is **locked**
   and be replaced if it is not.
7. **A photo through the vision model** — drop a screenshot on the canvas, wire it into an Instruction,
   and see whether gemma4:12b reads it. This is the first time the Computer sends a picture anywhere.
8. **A three.js or p5 sketch in a Preview box** — whether the snapshot is worth looking at at the size
   the box gives it, and whether an error names a line you can find.
9. **The look, on your monitor** — five kinds, five glyphs, in both themes; and whether the sticky's
   title bar reads as a label or as chrome. The two screenshots I looked at are
   `shell/test/chat-harness/generated/shots/k4-shots-{dark,light}.png`.
10. **The segmented control itself** — three buttons, the Open WebUI webview surviving a switch, and the
   view you were on being remembered across a relaunch. The harness page has no topbar at all.
11. **Your migrated graphs** — that the ones from the per-thread era still open intact. The Text part
   replaced the old Note file but kept its type id, so they should; this is the check that proves it.
12. **A loop on the real farm**, watched with a colleague chatting, to see whether the ceilings and the
   background priority feel polite from the other seat.

[COMPUTER_PLAN.md](COMPUTER_PLAN.md) section 13 is the fuller rig checklist.

## If you want the tail finished

**D-F12** (farm transcription, so a Sound box can actually be heard) is a farm change and needs your
yes first; the client half would then be one small unit shaped exactly like the Document box.

Also sized and waiting, in the order I would take them: **Open live** (a p5/three box you can
interact with, instead of a picture of its first frame), **parts move with their Section**, **wires
in the kind's colour**, and lessons 5–12 with their templates.
