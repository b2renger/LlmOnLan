# The Computer — where the night got to (25 Sept, morning: K7 debug log, your eight bugs, the perf pass)

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

## NEWEST (02:05 on the 25th) — the perf pass you scheduled

The Computer is about **twice as fast on big graphs**, and panning is smooth. Measured on a
1000-box graph:
- a run costs 0.17 ms per box instead of 0.35;
- the longest freeze during it is 65 ms instead of 140;
- panning a 500-box graph does 1.5 ms of work a frame instead of 17–20.

The cause was the browser restyling and repainting boxes that are off screen. They now skip that
work until you scroll to them. The perf tests now have tight budgets, so a slow creep fails
loudly instead of passing quietly. You won't notice anything on a small graph; on a big one,
pan and zoom should feel instant. Details and before/after: [DEVLOG.md](DEVLOG.md).

## NEW (night of the 24th) — your eight bugs, fixed and checked by a critic until it was happy

Your list, and where each fix is:
1. **"We always get the same results — we want control of the seed."** Every Instruction now has a
   **Seed** row.
   - It is **new each run** by default, so ▶ twice gives two different answers.
   - Type a number or press 🎲 to pin one, and ✕ to go back to new each run.
   - After a run the box says *last run: seed N* with **Keep**, which pins the seed that produced
     the answer you are looking at.
   - When nothing needs re-running, the run bar offers **Run everything again**.
2. **"What does 'substitute short values in place' mean?"** It is now **"Fill in {names} with their
   values"**, with a one-line hint. It only appears when you have written a `{name}` in the prompt.
   It also had a real bug: it replaced bare words too ("topic" became "cats" everywhere). Now only
   `{braced}` names are filled.
3. **Resize** any box from its **bottom-right corner** (or Alt+Shift+arrows). Fields and prompts
   grow with the box, and the wires follow.
4. **Mouse and trackpad:**
   - two-finger scroll **pans**, pinch **zooms about your fingers**, and Ctrl+wheel zooms;
   - a scroll over a long answer scrolls the answer, not the canvas;
   - pan also with Space-drag, the middle button, or the **Hand** tool (H), next to **Select** (V);
   - the **% button** has Zoom to fit (⇧1), Zoom to selection (⇧2) and 100 % (Ctrl+0);
   - **right-click** a box or a wire for its menu.
5. **Unplug a wire:** drag its end off the input and let go on empty canvas, or hover the wire and
   press the **✕** on its label. Drop the end on another input to re-plug it. Ctrl+Z brings it
   back.
6. **Editing a Text box you made earlier:** **double-click** its words, press **✎ Edit** (it
   appears when you hover), or select the box and press **Enter/F2**. Typing into a box that has a
   wire coming in locks it, so the next run keeps your edit. It says so, and one Ctrl+Z takes both
   back. (The bug was the canvas swallowing the click. It was proven with a real mouse before it
   was fixed.)
7. **Copy text:** select words in a box with the mouse and press Ctrl+C, or press **Copy** on a Text
   or Document box. Ctrl+C copies boxes only when no text is selected. Plain text pasted onto the
   canvas becomes a Text box.
8. **Write SVG / p5.js / three.js:**
   - The model now gets instructions per kind, in the system message, written around what the
     sandbox really provides (first tuned on gemma4:12b; your farm's default is now Qwen3.8).
   - The deeper cause: every answer was **silently cut at 512 tokens**, so most sketches arrived
     half-written. Code answers now get far more room (critic S1-3 resizes the budget to what the
     farm's slot can hold, because a thinking model spends it on thoughts first), and a cut-off
     answer says so instead of drawing nothing.
   - The sandbox is sized to the box, and sketches that only draw inside their animation loop now
     photograph properly. Guest errors are explained in words.

**How it was checked.** A critic agent read the Computer's code and traced your eight items plus
18 other defects. Three builders fixed them in parallel. The critic re-reviewed four times until it
had nothing blocking left. Reports: `docs/reviews/COMPUTER_CRITIC_R1.md` → `R2.md` → `R3.md` (with
Round 4). The harness now drives a **real mouse and keyboard**; about 40 new scenarios do.

**Checked on your real farm on the 25th, 08:30** (its default model is now Qwen3.8, not gemma4):
- on **Qwen3.8**, a pinned seed gave the identical answer twice through LiteLLM. On **gemma4:12b**
  through Ollama it did not (rig, 09:03): the same seed can still vary there. What is guaranteed
  everywhere is narrower — while the window is open, the Computer re-uses the answer it already has;
- each Write-… preset drew 5 times out of 5 on Qwen3.8. On gemma4:12b, SVG drew 2/5 and p5 1/5
  (its thinking used up the answer budget) — critic S1-3.

The full account of the night is in [NIGHT_REPORT_2026-09-25.md](NIGHT_REPORT_2026-09-25.md).

## NEW (K7, evening of the 24th) — a debug log you can switch on

At the right end of the run bar there's a new **● Record log** button.
1. Press it. It turns red and counts events.
2. Explore. When something breaks, press **⚑ Mark bug**. It takes a screenshot, asks one sentence
   about what went wrong, and saves the whole graph and state with it.
3. Press the red button again to stop. The folder button opens the file in Explorer.

The file is `%APPDATA%\LlmOnLan\logs\computer\computer-<date>_<time>.jsonl`, with the screenshots
next to it. It records:
- what you clicked and typed (per field, not per key), with the button labels you saw;
- every graph edit (settings with their new values);
- the run, box by box, and every request to the farm, with the model and the prompt's text but
  never the password;
- every error, the console, and the sandbox's errors;
- frames slower than 100 ms, with the function that was slow.

It also keeps **the few minutes before you pressed the button**, so pressing it *after* you see a
bug still works. The switch survives a relaunch. Full guide and file format:
[COMPUTER_DEBUG_LOG.md](COMPUTER_DEBUG_LOG.md). To hand one over, just say "look at the latest
Computer log". The folder is fixed, so I can find it.

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
   **A PDF that says it has more than 60 pages** (most simple writers state it in the file) is refused
   the moment you drop it, before anything is kept or sent: *"thesis.pdf has 300 pages. A Document box
   passes on at most 60, and the farm would read all 300, so it was not kept and nothing was sent. Split
   it into PDFs of 60 pages or fewer."* — the farm reads every page it is given, and would spend its GPU
   on 240 pages nobody gets. (Fix round.)
   **Stop, or a read that took over 5 minutes:** the farm keeps reading after LOL stops waiting, so the
   same PDF waits 5 minutes before it may be sent again. The box says *"The farm may still be reading
   this PDF from the last try. A new run waits about 5 min, so it is not read twice at once."*, and a
   run in that window is refused in a sentence and sends nothing. (Fix round; the farm-side fix is
   DISCUSS D-F13.)
   **Run all** leaves out a Document box that is not wired to anything — pressing it for another branch
   never sends a PDF nobody uses. Its own ▶ still reads it. (Fix round.)
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
   a file Chromium cannot decode, is refused with a sentence and not kept. The 10-minute check reads the
   length from the file's own header first (WAV, MP3, OGG/Opus, FLAC, M4A, AAC), so a one-hour podcast
   is refused — *"“podcast.mp3” lasts 60:00, longer than the 10:00 a Sound box keeps…"* — without
   being decoded into a gigabyte of memory first; a WebM is judged from its first 256 KB. (Fix round.)
2. Wire it into an Instruction. Its line reads **takes: sound ✗** with, on your farm today: *"This farm
   runs its models through Ollama, which has no way to pass sound on, so the sound is not sent. Its name
   and length go along as text."* (On an engine that could pass it on, the sentence names the model the
   farm does not say can listen instead.) The Instruction shows its OWN model's line — for example
   `gemma4:12b: pictures ✓ · sound ? · PDF directly ?` — while a picture or a sound is wired in. That
   model is whatever the box's Model menu says; on Automatic it is the farm's default.
3. Press ▶: the Instruction gets *"Sound file "interview.wav" (0:02, 0.0 MB). The sound itself was not
   sent: …"* — honest text, never the sound, never a wasted request.

**Several files dropped on one box** (not on the canvas): the box takes one — the first PDF, or the
first sound — and a toast says *"Only thesis.pdf went into this box (1 more dropped with it did not).
Drop those on an empty part of the canvas and each gets its own box."* (Fix round.)

**The "takes:" line looks through** a Button, a Condition, a Confirm, a Toggle, a Timer or a Repeat to
the Instruction behind it, so Image → Repeat → Instruction says what THAT model can see. A box wired
only to boxes that are not models (a Preview, a Split) says *"What this is wired to does not pass it to
a model…"* instead of "Nothing uses this yet". (Fix round.)

**Files you replace or remove** are deleted from this computer the next time a graph is opened (every
start of the Computer, every switch of graph) — but never one that Undo or Redo could still bring back.
(Fix round.)

**Anything else** dropped on the canvas (a program, a zip…) is refused with a toast naming the file
and what the Computer does take. Text files (.txt/.md/.csv/.json) become Text boxes with their
contents; pictures become Image boxes, which now carry the same "takes:" line.

## What works this morning

| | |
|---|---|
| **NEW (K6) — PDFs, sound, and a line that says what a box can take** | See the section above. The Document box sends its PDF to the farm's OCR only when a run needs the text, once per file ever; the Sound box keeps and plays, and says why nothing listens; every file-holding box says **takes: … ✓ / ✗ / ?** with a sentence whenever the answer is not yes — `?` when the farm does not say, never a guess. |
| **A surface of its own** | Library sidebar: create, open, rename, duplicate, delete, import/export a graph as a document. No chat involved anywhere. |
| **Arrows carry names** | Click the **name me** tag on a wire (or select the wire and press **F2**, or just start typing), type `societal research`, press Enter. That label is the name the Instruction refers to in its prose — your museum graph, exactly. |
| **See the prompt before you pay** | The transcript drawer shows **Sent / Got / Cost** for any Instruction — including *before* you run it, so you can read the assembled prompt and fix the wording without spending a generation. |
| **Two ways to run** | **▶ on any box** runs it and everything downstream (and quietly runs any un-run ancestors it needs first). **Run all** in the run bar does the whole stale graph (the canvas toolbar no longer has a second Run — critic S1-14). **Stop**/Escape cancels either. |
| **Control flow** | Button, Condition (yes/no/maybe), Confirm, Dialog (pauses the run and asks you), Toggle (the gate that makes a loop legal), Timer/Interval. |
| **Loops that stop themselves** | A loop must pass through something that can stop it (a Toggle, Condition, Confirm, Dialog, Button or Timer), and four ceilings bound every run: 8 passes through one box, 50 generations, 10 minutes of wall clock (waiting included), and 2000 box runs in all (`maxActivations`). Each is raisable for one run from the notice that names it. A run never outlives the graph it started on, or the question it asked. |
| **NEW — text boxes with input and output** | Wire an Instruction (or any box) into a **Text** box and the answer lands there, renders as markdown — headings, bold, lists, tables, code — and is passed on downstream. Click into it to edit the source; blur to see it rendered again. **Lock** means "keep what I typed": a locked box refuses an arrival, says so, and still passes its own text on. An arrival never paints over an editor you have open. A box with nothing wired in is exactly the note it always was. A very long arrival is rendered down to its first 64 KB with a line saying so — the whole text still passes on and Save… still writes all of it. |
| **NEW — drop a picture in** | Drop or paste an image on the canvas; it is downscaled and stored locally, and a wired **Image** goes, as part of an Instruction, to **that Instruction's model** — whatever its Model menu says; on Automatic, the farm's default (Qwen3.8 on your farm today), not a separate "vision model". When the farm does not list that model as able to see, the box says so and sends nothing; pick one that can in the box's Model menu. Since K6 a drop of several files places one box per file (up to 8), side by side; a file too big to decode is refused with a sentence rather than with the renderer's memory. |
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

`chat-unit` **1386 passed** · `unit` **5** · `chat-lint` **212 files / 0 violations** ·
`chat-scope` clean · `chat-harness --strict` **297 passed** · perf **9 passed** (after the K6 fix round).

Seventeen of those scenarios are K6's own. Each reaches its feature **the way a person does**: it
places the box by clicking ＋ and then Bring in → Document / Sound, and brings the file in with a real
drop event on the box or on the canvas. Every refusal is read off the screen as a sentence. Every
scenario checks that nothing reached the farm that should not have: no OCR request on a drop, exactly
one per file on a run, never a sound part. The mock farm is used for all of it, never your farm.

Commits, newest first:

```
HEAD     K6 fix round: a PDF cannot hold the farm GPU for nobody, a long sound is refused before it is decoded, removed files are swept
edc0be1  PDFs and sound files go into the Computer's boxes, and every box says what it can be used for (K6)
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
   SVG**. Add an **SVG** box the same way, drag a wire from Write an SVG onto it, and press ▶. The
   model's SVG should land clean and draw — on Automatic that is the farm's default (Qwen3.8 today);
   to check gemma4:12b, pick it in the Write an SVG box's Model menu. Do the same with **Write a p5.js sketch → p5.js sketch**. The
   Write-… prompts were only tested against the mock model, so this is the check that matters.
4. **The Tour and lesson 1, with the farm on.** Open **Learn** in the library sidebar and walk the Tour,
   then lesson 1. Check that the rail ticks when you do each step, and that **Show me** points at
   something you can see. The screenshots I looked at are
   `shell/test/chat-harness/generated/shots/k5-shots-{dark,light}.png` and `k5-creative-boxes-*.png`.
5. **The Research → problematic template**: does its shape match your museum graph? Does it run its
   eight generations on your farm in a time you would accept?
6. **A real Instruction into a Text box**, the K4 headline. Wire an Instruction's answer
   into a Text box and read whether the model's markdown report lands legibly: headings, lists, a table.
   Then click in, edit a line, click out, and re-run: your edit must survive if the box is **locked**
   and be replaced if it is not.
7. **A photo through a model that can see** — drop a screenshot on the canvas, wire it into an
   Instruction, and see whether that box's model reads it. On Automatic it is the farm's default; pick
   a model the farm lists as able to see (gemma4:12b is one) in the box's Model menu. This is the first
   time the Computer sends a picture anywhere.
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
**D-F13** (the farm's document reader: a page cap and stopping when the client gives up) is a small
farm change; until then the client guards it as above, but only for PDFs that state their page count.

Also sized and waiting, in the order I would take them: **Open live** (a p5/three box you can
interact with, instead of a picture of its first frame), **parts move with their Section**, **wires
in the kind's colour**, and lessons 5–12 with their templates.
