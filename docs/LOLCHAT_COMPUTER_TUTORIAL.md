# The Computer — a tutorial

The Computer is a canvas where you place **boxes**, draw **wires** between them and run them. What
a box makes travels along its wires to the next box. The boxes that think ask a model on the farm;
the others (text, pictures, code, views, controls) do their work on your own machine. It is a
small visual program you assemble in a few minutes and re-run all afternoon, because on our own
farm re-running costs nothing.

It is **not** a mind map and not a chat with a diagram. There is no cloud and no API key. Every
graph you make is saved on this computer, in the Computer's own library — which lives in your data
folder (Settings ⚙ ▸ **Data location**) with the pictures, PDFs and sounds in its boxes and the files
its File boxes write, so moving that folder takes all of it along.

> Rewritten on 2026-09-25 (critic S1-16) to describe the Computer as it is now: its own surface
> with a library, the ＋ menu's boxes by their current names, pictures, PDFs and sounds in boxes,
> the drawer on the right, and the Learn shelf. The design is in
> [COMPUTER_PLAN.md](COMPUTER_PLAN.md); what works today and what does not is in
> [COMPUTER_STATUS.md](COMPUTER_STATUS.md). Checked against the code again on 2026-09-27 (docs
> review): the view tools, Live pausing, and the boxes and buttons it had left out; and on 2026-09-28
> with the in-app texts (the v0.2.3 review): lessons 7–12, the Outputs control with a Trigger, the
> resume banner, tooltips.

---

## Opening it

The topbar has a three-way switch: **Open WebUI · LOL Vibe · Computer**. Press **Computer**. The
app remembers which one you were on, so the next launch opens there again.

What you see, left to right:

- **The library** (sidebar). **New** makes an empty graph, **Import…** adds a graph from a
  `.lolgraph.json` file, and the search box filters the list. Each graph is a card with its title,
  how many boxes it has and when it last ran. Hover a card for **Rename**, **Duplicate**,
  **Export…** and **Delete**. Below the list is the **Learn** shelf. Drag the sidebar's right edge
  to make it wider.
- **The run bar**, above the canvas: **Run all** (with **Stop** beside it while a run is going),
  counts of boxes and generations, how much of the Cap the last run used, a sentence about the last
  run (and **Run everything again** when nothing needed a re-run), **Outputs** when the graph has a
  Send or a Trigger box and **Panic** with a Send (see [the Send box](#acting-on-the-world-the-send-box)), **?**
  (what is this?), and **● Record log** (see [COMPUTER_DEBUG_LOG.md](COMPUTER_DEBUG_LOG.md)). Hover
  any button for what it does.
- **The canvas**, with its toolbar: **＋ Add a box**, the **Select (V)** and **Hand (H)** tools, the
  zoom cluster (**−**, the zoom %, **+**, **Fit**), **Undo**, **Redo**, **Tidy**, **Export…**,
  **Replace from file…**, the **Cap** field and the **Think all** box. The model is left to think
  (its own default; the measured models do) before a yes/no decision (a **Condition** or a **Filter** that asks the model) and before it writes
  text or code. Unticked, it answers lists, JSON and agent steps straight away: faster and lighter on
  the farm, and nearly as right on those in a measurement. Ticked, it thinks before all of them: more careful, but
  several times slower. It starts unticked, the app remembers it, and it applies from the next run.
- **The drawer**, on the right, when something is open in it: a value you clicked, or what a box
  sent and got (see [Read the prompt before you pay](#step-4--read-the-prompt-before-you-pay)).
  Drag its left edge to resize it.

A new, empty graph offers **Take the tour · Open a template · Add your first box**, plus one-click
picks for the most common boxes.

---

## The fastest way in: the Learn shelf

The **Learn** shelf in the sidebar holds a tour, twelve lessons and eight templates. A lesson opens as
**your own copy** of a small graph, with a **step rail** docked at the bottom-left of the canvas.
The rail shows one step at a time and **ticks it when you have really done it**: nothing is typed
for you, and nothing ticks by accident.

| On the shelf | What it teaches | Farm |
|---|---|---|
| **The tour** | Move around, add a box, wire two together, run, delete, undo. | not needed |
| **1. hello, farm** | An Instruction is a prompt you can point at and run. | one generation |
| **2. wires carry values** | A box runs when the boxes that feed it have finished. | two per pass |
| **3. arrow labels are names** | Name an arrow, and the Instruction can use that name. | one per run |
| **4. make a picture** | Ask the model for an SVG, and watch it drawn. | one |
| **5. code counts, the model names** | A Code box adds up a table; the model says what the totals show, in words only. | one per run |
| **6. a loop that stops** | Close a ring of boxes through a Toggle: the run stops by itself at its ceiling, and the Toggle is the brake. | not needed |
| **7. listen and speak** | Record a question with ● Record, turn on **Listen**, and a model answers; **Speak** says it — then with this computer's own voice, which sends nothing. A farm whose Speech to text is off gets a saved transcript. | one |
| **8. a picture to a model** | **Take a picture** with the webcam, wire it into an Instruction: the picture travels inside the request to a model that can see. Then ask the same picture something else. | one per run |
| **9. act on the world** | A **Send** box does a dry run first; arming the outputs is your choice in a dialog that lists every target; then a real OSC message goes to port 9000 of this computer, and **Panic** stops it all. No hardware needed. | not needed |
| **10. hear the world** | A **Trigger** on a clock runs the graph by itself — only while the outputs are armed and the Computer is on screen, at most one run every few seconds. (On a farm with the message bus, a board's message can start it instead.) | not needed |
| **11. an agent with tools** | An **Agent** works in steps: code in the sandbox over the readings you wire in, then the answer, with every step under *How it got there*. **Steps at most** is its brake. | one per step |
| **12. open data** | An **Open data** box reads a data.gouv.fr dataset (a copy ships with the lesson, so it runs offline); code charts a column with data.gouv.fr's counts; a model that can see says what the chart shows, in words. | one per run |
| **Research → problematic** (template) | One topic, five angles of research, one problematic, two design concepts. | about 8 |
| **Creative coding** (template) | A brief becomes a p5.js sketch you can run, read and edit. | about 1 |
| **Read the news** (template) | The Hacker News front page, labelled by the model from **your** categories, counted by code, charted as an SVG that answers **your** question. A copy of the page ships with it, so it runs offline too. | about 2 |
| **Analyse a dataset**, **Ask a dataset** (templates) | A data.gouv.fr dataset read, explained, charted and questioned — the second through an Agent. See [French open data](#french-open-data-the-open-data-box) below. | about 3 · up to 8 |
| **Ask out loud** (template) | Lesson 7 as a ready graph. | about 1 |
| **Talk to a board**, **A board on Wi-Fi** (templates) | An Arduino or ESP32 on the USB cable or the farm's message bus, both ways. | no generation (Wi-Fi: the farm's bus) |

On the rail:

- **Show me** moves the canvas to what the step is about and flashes it. If you deleted that box,
  the button reads **Put it back** and restores it where the lesson had it.
- A step you can only read (like "read what will be sent") has **Got it**.
- **Reset lesson** asks, then puts the lesson's graph back as it shipped. One Undo takes the reset
  back.
- **No farm, or the farm too busy?** When a box cannot get an answer, the rail offers **Use the
  saved answer**. The box then shows the lesson's recorded answer with a *demo answer — not
  generated* badge, and you can finish the lesson.
- The **–** folds the rail to a pill. A lesson resumes where you left it, even after a restart.

The **?** in the run bar explains the Computer in a few sentences and leads to the same shelf.

### Every box has an example: its own **?**

Each box has a small **?** in its title bar, next to ▶. It opens that box's **example**: a small graph in
your library with a yellow note saying what the box does, what goes in, what comes out and how to use it
on the Computer (with short snippets), next to a tiny setup that already works. Press **Run all** to watch
it (the note says what to press when Run all is not enough: ▶ on a drawing box, a Button's face, arming
the outputs for a Trigger), and change anything to try your own idea. The graph is titled
*Example — <the box's name>*. The **?** opens the same example graph next time; delete it
from the library and the next **?** makes a fresh one. There is one for every box in the **＋** menu,
including the presets (a p5.js sketch, *Write code*, *Describe a picture*…).

---

## Part 1 — build a graph by hand

You will make: a brief in a **Text** box → an **Instruction** that writes from it → the answer in a
second **Text** box, and then a picture. About ten minutes the first time.

### Step 1 — a new graph, and a Text box

Press **New** in the library. The new graph opens on the canvas; double-click its card (or hover
it and press **Rename**) to name it.

Press **＋ Add a box** in the toolbar (or **double-click** an empty spot of the canvas, or
**right-click** it: the box then lands where you clicked). The menu is grouped — **Bring in ·
Think · Show · Control · Annotate** — and you can type to search ("picture", "model", "p5"). Pick
**Text** under *Bring in*.

Click into the Text box and type your brief, for example:

```
A small studio that does VR, projection and installation work. Dark by default, reads as a
workshop rather than an agency, shows a lot of photography.
```

**On screen now:** one box titled *Text*, its state reading **Not run**, your words in it. A Text
box with nothing wired into it is simply the text you typed.

### Step 2 — an Instruction, and a wire

**＋ Add a box → Think → Instruction.** Move it to the right of the Text box: drag it by its
title bar. Boxes snap to a grid.

Wire them: put the pointer on the **dot on the right edge of the Text box**, press, and drag. A
line follows the pointer. Let go **on the Instruction** — on its left dot, or anywhere on the box:
the box it will plug into is outlined while you hover it, and the wire goes into that box's first
free input that takes what the wire carries. The wire stays drawn between them (a screen reader
hears *"Text now feeds Instruction"*).

A wire that cannot be made is refused **on the spot**: it snaps back, and a short message says why and
what to do instead: the input already has that wire (or takes only one), a box cannot feed itself, the box cannot
take what the other one hands on, or a loop with nothing in it that can
stop it (see [Loops](#loops-and-the-limits-of-a-run)). Let go on empty
canvas and nothing is made.

To unplug a wire, drag its end off the input and let go on empty canvas, or hover the wire and
press the **✕** beside its name. Drop the end on another box (or its dot) instead, and it is
re-plugged there. **Ctrl+Z** undoes any of it.

### Step 3 — name the arrow, then write the instruction

Every wire carries a dashed **name me** tag at its middle. **Click the tag**, type `brief`, press
**Enter**. (Or select the wire by clicking its line and press **F2**, or just start typing.)

Now click into the Instruction's text area and write what you want, using that name:

```
From the brief, propose five colours for this studio's website: a background, a surface for cards,
one accent, and two text colours. Give each a name and a hex value.
```

Why name it: the model receives each wired input under a heading. A named arrow arrives as
`## brief`; an unnamed one as `## Input 1`, and the model has to guess what it is. A name the
instruction does not mention is flagged on the box (*not named, still sent: …* — it still goes to the
model, under its heading), and so is a name the instruction mentions but no arrow carries.

The Instruction's own controls:

| Control | What it does |
|---|---|
| **Model** | **Automatic** (the farm's default model) or any model the farm serves. Each Instruction has its own. |
| **Answer shape** | **text**, **list** (an array of items — the next box then runs once per item) or **JSON** (checked against the **JSON schema** you paste before it becomes a value). |
| **Seed** | Empty: a new seed every run, so ▶ again gives a new answer. A number (type one, or 🎲): the same seed every time. After a run the box shows *last run: …* with **Keep**, which pins the seed of the answer you are looking at. While this window is open the Computer re-uses the answer it already has; asked again, most models repeat it, but some still vary. |
| **Fill in {names} with their values** | Appears when your instruction writes a name in braces, like `{brief}`: that short text is put right there instead of under its heading. |

### Step 4 — read the prompt before you pay

Under the instruction, a grey line reads something like *sends 64 words · 1 named input*. **Click
it.** The drawer opens on the right on the **Sent** tab: the system message, each input under its
heading, your instruction, and the call's settings — exactly what will be sent, before anything is
spent. After a run, **Got** shows the reply word for word and **Cost** shows the time, the tokens
and whether it is a *new answer* or an *answer reused, nothing sent*.

### Step 5 — run it

Press **▶** in the Instruction's title bar. It goes **Queued → Running → Done**: a model on the
farm is writing, not this laptop. When it is done, the box shows the start of the answer and a cost
line such as `1.8s · 412 tokens`. **Click the answer** to read the whole of it in the drawer.

Two ways to run:

- **▶ on a box** runs that box and everything after it — and first any box before it that has not
  run yet, because it needs their values.
- **Run all** in the run bar runs every box that has not run or needs a re-run (**Needs a re-run**
  is what a box says after something it depends on changed). **Ctrl+Enter** on the canvas does the
  same.

When nothing needs a re-run, the run bar offers **Run everything again**: every box runs, and
Instructions on *new each run* get new seeds.

**Stop** (in the run bar, or **Esc** on the canvas when nothing else is open) ends the run. Every
box that finished keeps its answer.

### Step 6 — land the answer in a Text box

Add a second **Text** box and wire the **Instruction → Text**. Press ▶ on the Instruction again.
The answer lands in the Text box, **rendered** — headings, bold, lists, tables, code — and is passed
on to whatever that box feeds.

- **Double-click** its words (or press **✎ Edit**, or select the box and press **Enter**) to edit
  the markdown source.
- **Lock** means "keep what I typed": a locked box does not let the next answer replace it. Typing
  into a box that has a wire coming in locks it for you, and says so; one **Ctrl+Z** takes both back.
- **↺ Clear** shows what you typed again instead of what arrived.
- **Copy** copies its text — all of it, even when a very long text shows only its first 64 KB. You
  can also select words with the mouse and press **Ctrl+C**.

### Step 7 — a picture

**＋ Add a box → Think → Write an SVG**, and **＋ Add a box → Show → SVG** (the SVG box is also one
click away in the menu's first strip, *Draw with code — no farm needed*; the Write-… boxes are only
under *Think*). The SVG box draws its own starter code straight away, and redraws as you edit its
code.

Wire **Write an SVG → SVG** (drag from its right dot onto the SVG box), write what to draw in the
Write an SVG box, and press **▶ on the SVG box**: the Instruction runs first, then the box draws
the model's picture instead of your code. **Keep my code** makes the box draw your own code again,
whatever arrives. **Save .svg** / **Save .png** write the picture to a file.

The same pairs exist for **p5.js sketch**, **three.js scene** and **HTML page**. Those three run in
the sandbox — no network, no access to your files — and come back as a picture of their first
frame, until you press **▶ Live** (below). SVG and **Markdown view** draw directly, without the
sandbox.

Two more boxes sit under *Show*. **Code** runs plain JavaScript in the sandbox on what arrives
(`inputs.in` is an array; return text, a number, an array or an object). **Preview** is the box
behind all six: its *Read it as* menu (**Automatic**, **Markdown**, **SVG**, **Web page**,
**three.js**, **p5.js**, **Graph (JSON)**) picks how to show what arrives.

### No need to write the code yourself

A Code box does not have to be written by you:

- **＋ → Think → Write code** is an Instruction you give in plain words (*count how many items there are in
  each category*). Wire the data into it too, so the model sees its shape, and wire its answer into the
  Code box's **code** port (the data goes into **Inputs** as usual). On **Run all** the model writes the
  program and the Code box runs it. The model is *told* to compute every number from the data; nothing
  forces it, so the Code box shows the program it ran: read it. Type in it and it becomes **yours** (the model's next version is then
  ignored); **Use the model's code** gives it back to the model. **d3** (v7) is there for any code that
  uses it: its scales and shapes turn counted numbers into an SVG chart a Preview draws.
- **What it does** at the top of every Code box is a line of plain words. **Hide the code** folds the
  program away behind it, so a graph reads as a list of steps, not a wall of JavaScript. **Show the code**
  opens it again. Folding changes nothing a run computes.

### Let the model see what it drew

A Preview hands on a **picture** of what it drew: an SVG, a p5.js sketch, a three.js scene or a web page,
as a PNG (a Markdown page hands on nothing). Wire it into **＋ → Think → Describe a picture** — an
Instruction that asks a model that can see (a vision model, like the farm's gemma4) to describe the picture
and list what to change. That is a **feedback loop**: *Write an SVG* → Preview → *Describe a picture* →
back into the writer's next attempt. When the writer returns new code, ▶ on it redraws the Preview (a Live
box restarts with it) and the describing model looks at the new picture. The picture goes to the farm
inside that Instruction's request, like an Image box's.

### Edit the code, go Live, orbit the camera

- **Edit code** on any of these boxes opens its code in the drawer on the right: a big editor with
  line numbers. It is the box's own code — typing in either place changes both — and the box
  redraws as you type. **▶ Run code** (or **Ctrl+Enter**) redraws it now. **Tab** indents
  (**Shift+Tab** takes it back), **Enter** keeps the indentation, **Ctrl+Z** undoes, and **Esc**
  closes the editor and puts you back on the box.
- **When the code fails**, the sentence appears under the editor with **Go to line N**, and that line
  is marked in the margin.
- **▶ Live** (p5.js, three.js, HTML) runs the box's code for real, inside the box: it animates and
  hears the mouse and the keyboard. Click in it to give it the keys; **Esc** or a click outside gives
  them back. One box is Live at a time; **■ Stop** puts the picture back. A Live box pauses when it
  scrolls off screen, when you switch to another surface, or when the window is hidden, and it starts
  again when it is back. It is still Live when you reopen the graph, until you press **■ Stop**.
- **Orbit the camera.** The three.js starter calls `lol.orbit(camera)`: when Live, drag to turn around
  the cube, use the wheel (or pinch) to zoom, right-drag or Shift-drag to pan. Put the same line after
  the camera in your own scenes; the **Write a three.js scene** Instruction tells the model to. In
  p5.js, `mouseX`, `mouseY`, `mouseIsPressed` and `keyPressed()` work when Live: the starter's ball
  follows the pointer while you hold the button, and any key turns it back.

### A map of a project: the Graph box

**＋ → Show → Graph** draws a graph from JSON: nodes, and the links between them. Its code is the JSON
itself — the starter is a small graph of six nodes — and it reads **graphify's `graph.json`**, the file
the IDE's **graphify** skill makes a model write for a project (`graphify-out/graph.json`), as well as
any `{nodes, links}` or `{nodes, edges}` (a node needs an `id`; a link a `source` and a `target`).

- **Colour is the community** (the group a node belongs to); the best-connected nodes are labelled (all
  of them in a graph of up to 150). A **solid** link is *EXTRACTED* (written in the source), a
  **dashed** one *INFERRED*, a **dotted** one *AMBIGUOUS* — graphify's confidence.
- It is drawn in the sandbox with the d3 that ships with the app — nothing is loaded from the web — and
  comes back as a picture, fitted to the box's Width × Height. **▶ Live** lets you **drag the nodes**
  (the others follow), zoom with the wheel and pan by dragging the paper.
- Wire in whatever holds the JSON — a Code box that builds it, a Fetch box, an Instruction that writes
  it — and the box draws that instead of its own. **Save .json** writes the JSON, **Save .png** the
  picture; like every Preview, it hands the picture on to *Describe a picture*.
- A broken JSON says so and names its line (**Go to line N**). A graph bigger than **1000 nodes or
  5000 links** shows a sentence instead of a drawing: split it, or keep one community.

### Step 8 — tidy, undo, change one word

- **Tidy** lays the boxes out left to right. It only ever happens when you press it, and one
  **Undo** puts everything back.
- **Undo/Redo** (the buttons, **Ctrl+Z** / **Ctrl+Shift+Z** or **Ctrl+Y**) cover what you built:
  placing, moving, resizing, wiring, naming, editing a setting, importing. Answers a run computed
  are not undone, because they are not edits.
- **Change one word in the brief and press Run all.** Everything after it goes **Needs a re-run**
  and runs again; nothing else does. That is the loop the Computer exists for.

---

## Part 2 — import the examples

Two worked examples ship in [examples/](examples/):

| File | What it shows |
|---|---|
| [`palette-check.lolgraph.json`](examples/palette-check.lolgraph.json) | The model judges, JavaScript checks: a palette proposed by the model, its WCAG contrast computed exactly by **Code** boxes, a swatch sheet drawn, a `tokens.css` written by a **File** box. **One** generation. |
| [`fanout-pitches.lolgraph.json`](examples/fanout-pitches.lolgraph.json) | Fan-out: six topics, one run, six generations, joined back into one file. |

Both are rebuilt by [`examples/build-examples.mjs`](examples/build-examples.mjs) and run end to end
by the harness scenario
[`shell/test/chat-harness/scenarios/examples.mjs`](../shell/test/chat-harness/scenarios/examples.mjs).

**To open one:** press **Import…** in the library and choose the file. It becomes a **new graph** in
the library; nothing you had open changes.

The canvas toolbar's **Replace from file…** is different: it puts the file **in place of the open
graph**, after asking — *"This graph already has 4 boxes. The file replaces them; one undo takes it
back."* Dropping a `.lolgraph.json` onto the canvas does the same, with the same question.

*The palette example was made before the Preview family: its swatch sheet is drawn by a **Render**
box, which still loads and draws but is no longer in the ＋ menu. Today you would use an **SVG** box.*

### What fan-out is

In the pitches graph, **Split** turns the Text box's six lines into a **list** of six items. The
Instruction takes text, not a list — and that is not an error, it is the fan: **the Instruction
runs once per item**, and what it makes is a list of the same length. The fan carries on until a
**Collect** box joins it back into one value (*Join as*: bullet list, numbered list, JSON array or a
template per item).

While it runs, the Instruction counts `4/6`, and its cost line then reads something like
`11.4s · 2130 tokens · 6 calls`. **One failing item does not stop the others**: the box lists the
items that failed, by number, and the rest keep their answers.

Other boxes for lists: **Filter** keeps the items that match (*Contains*, *Matches*, *Length is*,
or *The model says yes*, which asks the model about each one), and **Repeat** runs what comes after it several times, for variations.

### Save a graph to a file

**Export…** — on a library card, or in the canvas toolbar for the open graph — asks one thing:
**Include results**, ticked by default. Ticked, the file carries the answers and pictures the graph
already made (so it is bigger); unticked, only the program.

---

## Part 3 — pictures, PDFs and sounds

Drop a file on an empty part of the canvas, and it becomes the right box where you dropped it: a
picture becomes an **Image** box, a PDF a **Document** box, a sound file a **Sound** box, a text
file (.txt, .md, .csv, .json) a **Text** box. Anything else is refused with a sentence. You can
also add the box from **＋ → Bring in** and then drop a file on it, click it to choose one, or paste
one while it is selected.

Every box that holds a file has a **takes:** line saying whether what it holds can be used where it
is wired: ✓, ✗ with the reason, or ? when the farm does not say.

- **Image.** Stored on this computer, downscaled. **Take a picture** shows this computer's camera in
  the box; **Capture** keeps one frame and the camera goes off at once (**Cancel** keeps nothing). Wired into an Instruction, the picture goes to
  **that Instruction's model** as part of the prompt. When the farm does not list that model as
  able to see pictures, the box says so and nothing is sent; pick a model that can in the box's
  **Model** menu.
- **Document** (a PDF). Kept on this computer. When a run needs the text, the farm's document reader
  reads it once, and only the text comes back and flows on. A PDF that states more than 60 pages is
  refused when you drop it; nothing is kept or sent.
- **Sound.** **● Record** records this computer's microphone until you press **■ Stop** (at most
  10 minutes, like a dropped file); the recording then works like a dropped sound file. It is kept and playable in the box (**▶ Play** / **■ Stop**). A sound wired into an Instruction
  passes on only its name and length, as text, and the box says so — unless you turn on **Listen: write
  down what is said**. Then, on a run, the recording goes to the farm's **speech to text**, which writes
  down what is said and keeps nothing, and the **words** flow on instead of the sound. The farm's
  operator turns speech to text on in the farm panel (it is off by default); on a farm without it the box
  says so and nothing is sent. A graph someone hands you always opens with Listen **off**: only you
  decide that your recordings leave this computer.

### Saying it out loud: the Speak box

**＋ → Show → Speak** says what arrives, out loud, and passes the same text on, so a graph can carry on
afterwards. Its **Voice** is either **this computer's** (the voices your operating system has: it works
offline and sends nothing) or **the farm's** (Kokoro, when the farm offers it: the text goes to the farm
to be spoken). **Automatic** uses the farm's voice when there is one. **▶ Say it again** repeats it; the run bar's **Stop** stops the voice.
Together with Listen, a graph can hear a question and answer it aloud: Sound (Listen) → Instruction →
Speak — **Learn → Templates → Ask out loud** is that graph, ready to record into.

### Acting on the world: the Send box

**＋ → Show → Send** hands what arrives to a device. **Send by** picks the transport:

| Send by | The target you type | What the value becomes |
|---|---|---|
| **OSC (UDP)** | host, port (9000), OSC address (`/lol`) | a number, a word, true/false — or a list of them as the arguments |
| **DMX over Art-Net** | host (a node, or a broadcast address), port (6454), universe | a list of channel levels (channel 1 first) or `{"12": 255}` |
| **MQTT publish** | broker host, port (1883), topic | the text, or the JSON of anything else |
| **WebSocket** | `ws://…` address (an ESP32, for instance) | the text, or the JSON |
| **HTTP POST** | `http://…` address | the text, or the JSON, as the body |
| **USB serial (Arduino, ESP32)** | the board you pick with **Choose the board…**, and its speed (115200) | one line: the text, or the JSON of anything else |
| **The farm's message bus** | a topic, like `lol/board1/led` (no `+` or `#`) | the text, or the JSON of anything else ([below](#boards-on-wi-fi-the-farms-message-bus-and-the-trigger-box)) |

The target is always typed by you in the box: an arrow only brings the **value**, so a model can never
choose where a graph sends. And the rules are the same for every graph, even one someone gave you:

- **Dry run by default.** Until you arm the outputs, a Send box only shows **Dry run — would send: …**
  and nothing leaves. A graph always opens as a dry run, and so does the Computer after a restart.
- **Arming asks first.** The run bar's **Outputs: dry run** button (it appears when the graph has a Send
  or a Trigger box) asks before arming and lists every target of the graph. Armed, it reads **Outputs:
  LIVE**; press it again to go back to a dry run. Opening another graph disarms.
- **Panic** (next to it whenever the graph has a Send box, armed or not) stops the run and every output
  at once, sends a **blackout** to every DMX universe the graph lit, and goes back to a dry run.
  Quitting the app does the same.
- **Limits:** at most 20 messages a second to one target, and DMX at most **3 frames a second per
  universe**, whatever address you send it to. That does **not** limit a fixture's own strobe channel, or
  lights you drive over OSC, MQTT, WebSocket or HTTP: keep strobes off. A message over the limit is held back, and the box
  says so.
- Never the farm's own ports. This computer is allowed (the arming question marks such a target *this
  computer*): OSC to TouchDesigner or Max on `127.0.0.1` is a
  normal target.

### Let Open WebUI build graphs for you

Open WebUI (the chat that comes with LlmOnLan) can use the Computer as a **tool**. In a chat, open the
**tools** menu under the message field and turn on **LlmOnLan Computer**, then ask in plain words: *"On my
Computer, make a graph titled Weather that fetches … and draws …"*. The model can list your graphs, open or
create one, add boxes, draw the arrows, change settings and run the graph, and it reads the results back to
answer you. You watch the graph appear on the Computer.

What it can never do: arm the outputs. A graph with Send boxes stays a dry run, and while you have the
outputs armed, the model can still read your graphs but cannot change or run one. What only you choose —
a Fetch address, an Open data link, the web hosts an Agent may read, a USB board, Listen — is left out of
what the model sets, and it tells you so. The connection stays on this computer (127.0.0.1): no other
machine can drive your Computer.

### A board on the USB cable: Send by USB serial, and the Receive box

An Arduino or an ESP32 plugged into this computer talks with a graph both ways, **one line = one message**:

- **Send** with *Send by: USB serial* writes a line to the board (a typed number, `led 1`, or JSON), with the
  same rules as every output: a dry run until you arm the outputs.
- **＋ → Bring in → Receive** hands on what the board writes: **the latest message** (its last line), or
  **every new message since the last run** (a list). A line that is JSON, like `{"light": 512}`, flows on as data, so a Code box reads
  `inputs.in[0].light`. Its face shows the last line live. Reading sends nothing anywhere.
- **Choose the board…** (on both) lists the boards plugged in; you pick one. Close the Arduino IDE's Serial
  Monitor first: only one program can hold a board.

The code to put on the board is in the repo, [`docs/examples/arduino/lol_serial`](examples/arduino/lol_serial/lol_serial.ino)
(an Uno, a Nano or an ESP32; it sets its LED from a number and sends its light sensor every half second).
The **Talk to a board** template on the Learn shelf carries the same sketch in a Text box to copy, and shows
the **round trip**: the board reports its light, a Code box decides "dark? LED on", and a Send writes it back.

### Boards on Wi-Fi: the farm's message bus, and the Trigger box

When the farm's operator turns on the **Message bus** (farm panel ▸ Plugins), the farm becomes a meeting
point on your network: an ESP32 on Wi-Fi (MQTT), TouchDesigner or Max (OSC) and every Computer (WebSocket)
publish and listen on the same **topics**, like `lol/board1/light`.

- **Receive** with *From: the farm's message bus* listens to a topic (`+` is any one level, `#` anything
  below: `lol/+/light` hears every board's light) and hands on `{topic, data}`.
- **Send** with *Send by: the farm's message bus* publishes on a topic (a dry run until you arm the outputs).
- **＋ → Control → Trigger** starts a run **by itself**, on each message on a topic (a board's button) or
  every few seconds. It only does so **while you have armed the outputs and the Computer is on screen**; at
  most one run every few seconds (the messages in between only update what it hands on: the latest wins),
  and at most so many runs an hour. Its face counts events, runs and skipped messages, and says why nothing
  starts.

The ESP32 side is [`docs/examples/arduino/lol_mqtt`](examples/arduino/lol_mqtt/lol_mqtt.ino): it publishes
its light sensor and sets its LED from a topic. With a farm password, the board and the bus need it too.
**Learn → Templates → A board on Wi-Fi** wires the round trip: a Trigger on `lol/+/light` runs the graph on
each reading, a Code box decides (dark → LED on) and a Send writes `lol/board1/led` back; the sketch rides
along in a Text box.

### Data from the web: the Fetch box

**＋ → Bring in → Fetch** reads a web address you type: an open API (JSON) or a page. Press ▶: a JSON
answer flows on as data a **Code** box can pick apart; anything else flows on as text. Only that request
leaves this computer. The rules, so a graph someone hands you cannot misuse it:

- only **http://** and **https://**; no user name or password in the address;
- never this computer, a link-local address, or the farm's own ports (reach the farm through its boxes);
- at most **1 MB** of text, in at most 15 seconds;
- when the network is gone, the box keeps the **last copy** it read and says **Offline — kept the last
  copy**. A refusal or an error from the site never falls back.

### French open data: the Open data box

**＋ → Bring in → Open data** reads a dataset of **data.gouv.fr**, the French government's open-data portal.
Open a dataset on www.data.gouv.fr (or one of its files), copy the address from the browser, paste it in the
box and press ▶. It hands on:

- the dataset's **description** (title, publisher, licence, last update, its page);
- its **columns**, with what data.gouv.fr counted over the **whole file**: how many values are empty, how
  many are different, the ten most common with their counts, the smallest and largest numbers;
- a **sample** of its rows (*Rows to read*, 200 by default, at most 1000).

It reads CSV and Excel files that data.gouv.fr has turned into tables; for another file it says which formats
the dataset has. Only requests to data.gouv.fr leave this computer (the public API that the datagouv-client
library also uses), each checked like Fetch's, and offline it keeps its last copy.

**Learn → Templates → Analyse a dataset** makes it a small project: paste a link, write your question, press
**Run all**. Code turns data.gouv.fr's counts into facts; a model **reads them** (what the data is, what stands
out, which questions it can answer — in words); the page adds a table of every column with data.gouv.fr's own
numbers; a model **chooses the column to chart** and code draws it; and for **your own question** a model
writes a small program that the Code box runs over the sample (its answer says how many rows it saw). As in
*Read the news*, every number you see comes from data.gouv.fr or from the code: a digit a model writes becomes
**…**. A copy of the festivals list ships with the template, so it also runs offline.

### A model that works in steps: the Agent box

**＋ → Think → Agent** is for a task that takes a few moves: *which 5 regions had the most museum visitors,
all years together?* Write the task in plain words, wire in what it needs (each arrow under its name), and
press ▶. Each **step** the model picks ONE tool and sees what came back:

- **run_code** — JavaScript in the Computer's sandbox (no network), over what is wired in and every earlier
  result. This is how numbers get computed: the agent is told to compute, never to guess.
- **fetch** — ONE web address, only on the hosts **you** list in *Web hosts it may read* (exact names, e.g.
  `tabular-api.data.gouv.fr`). Empty: no web at all. The same checks as the Fetch box apply.
- **laya** — the farm's Classify, over a list an earlier step made (when the farm has Laya).
- **answer** — the end.

The box's face says what it is doing (*Step 2 of 6: reading the web…*). Its answer comes with **How it got there**:
every step, and what its tool gave back, so you can check where each number came from. A step that goes
wrong (bad code, a host you did not list, an answer that is not the JSON asked for) is shown to the model,
which usually fixes it on the next step. *Steps at most* (6) bounds it: each step is one generation on the
run's Cap, and the run bar says *1–6 generations*. The agent has **no output tool**: it never sends to a
device and never arms anything.

Tip, from the rig: for data.gouv.fr, wire an **Open data** box into the agent, allow
`tabular-api.data.gouv.fr`, and say in the task that `…/api/resources/<file id>/data/?<column>__groupby&<column>__sum`
groups and sums the **whole** file on data.gouv.fr's side — gemma4 then answers in about three steps.
**Learn → Templates → Ask a dataset** is exactly that, ready to use: paste a data.gouv.fr link, ▶ the Open data
box, write your question, ▶ the Agent. When a site refuses a request, the box shows what the site said (for
example *Page size exceeds allowed maximum: 200*), and the agent reads it too.

### Sorting many items fast: the Classify box

**＋ → Think → Classify** asks **Laya**, a small decision model on the farm, ONE multiple-choice question
about every item of a list: *what is this about?* with the options you list (or wire a Text box into
**options**). A model can write the question for you: **＋ → Think → Write a Laya question** reads your
topics (and a look at the data) and answers with the question and its options; wire it into Classify's
**question** port. Classify then says what it asked. Its answers list the items Laya was unsure of under **check**, with
their words, so a model can give a second opinion from Classify's answers alone — and never re-reads an
item Laya was sure of. It answers all of them in one call, in about a fifth of a second per item, with a
**confidence**. It is not a generation and takes no seat. Laya is a fast *first pass*: on 104 real story
titles it got about 3 in 4 right; two thirds of them came above **Sure above** (0.6 by default), and 4 in 5
of those were right. Every answer below the threshold is passed on as **unsure** for a thinking model or a
person to check — but about one item in eight is confidently wrong (it likes to say *ai* about anything
technical), so glance at the result. Its confidence is only a rough guide, and the hint on **Sure above** says so.

Classify needs the farm's **Classify (Laya)** plugin, which is **off by default** (the operator turns it on
in the farm panel). On a farm without it, nothing is sent: every item comes out unsure, and a graph built
for Laya still runs — the model behind it labels everything.

The **Read the news** template shows the pattern to copy, with no code to write: **no model ever writes a
number**. The **Website**, your **Topics** and **Your question** are three separate boxes. A model reads
the website and your topics and writes Laya's question (your topics are its answers, exactly as you wrote
them); Laya labels every story; the stories it was unsure of go to the model for a second opinion; the
model then chooses how to chart (which measure, which order, which topic to highlight, the words). The two
**Code** boxes, folded behind a line of plain words, count and draw every bar. The chart's footer says how
many stories each one labelled, and the stories nobody was sure of are listed under it. Change the topics
or the question and press **Run all**. Another website has another shape: add **＋ → Think → Write code**,
say what to count, and wire it into the Count box's **code** port.

---

## Part 4 — control, loops and limits

The **Control** group holds the boxes that decide **whether and when** the rest runs:

| Box | What it does |
|---|---|
| **Button** | Nothing after it runs until you press it. Pressing it runs what comes after. |
| **Condition** | Lets what arrives through when it reads as your chosen yes, no or maybe. It reads the words for free, or asks the model (one generation). |
| **Confirm** | Stops and asks you **OK** or **Cancel** before going on. |
| **Dialog** | Stops and asks you a question; your answer flows on. |
| **Toggle** | A switch: while it is off, the boxes after it do not run. |
| **Timer** | Waits a few seconds (once, or several times in a row), then lets what follows run. |

A box that is waiting for you says **Waiting for you**, and the run bar counts the boxes
waiting, with **Show me** to go to the oldest one.

The **Annotate** group holds boxes for the reader of the graph:

| Box | What it does |
|---|---|
| **Sticky** | A coloured note for the reader. Never runs. |
| **Section** | A labelled region to group the boxes of one idea (the boxes inside do not move with it yet). |
| **Title** | Big words on the canvas. Never runs. |

### Loops and the limits of a run

A wire that closes a loop is allowed only when the loop passes through something that can stop it
— a Toggle, Condition, Confirm, Dialog, Button or Timer. Otherwise the wire is refused when you
draw it.

Every run has four limits, so no graph can quietly spend the farm or run for ever: **8** passes
through any one box, **50** generations, **10 minutes** (time spent waiting for you included), and
**2000** box runs in all. The generation cap is the **Cap** field in the toolbar, which remembers
what you set. When a run stops at a limit, a notice above the canvas says which one, keeps every
answer, and offers **Raise it for this run** (for the generation cap: **Raise the Cap for this
run** and **Show me what spent it**). A plan whose Timers alone would outlast the time limit is
refused before it starts, with the arithmetic.

### Sharing the farm

A run asks the farm at **background priority**. When someone chats, they go first: the run pauses
and the run bar says so; press **Run all** to carry on, and nothing already finished is asked again.
A run also sends nothing while the Computer's window is in the background.

### When the app closed during a run

Quit the app (or lose it to a crash) in the middle of a run, and the next time you open that graph a
banner above the canvas says so: *The last run stopped when the app closed — 3 of 7 boxes finished.*
**Resume** is **Run all**: the boxes that finished keep their answers and are not asked again, only the
rest run. **Dismiss** hides the banner for good; nothing runs and nothing is deleted, and **Run all**
finishes the other boxes whenever you like.

---

## Writing files

A **File** box writes what arrives into a file in **this graph's own project folder** on your
machine — one folder per graph, made on its first write (a duplicated graph gets its own). Set
*Path in the project*, for example `out/tokens.css`. After a run it says *Wrote out/tokens.css* and
offers **Show folder**. Running again overwrites the same file. The folders are in your data folder,
under **LOL Studio Projects**.

---

## Mouse and keyboard

| To… | Do this |
|---|---|
| Move around | Two-finger scroll or the mouse wheel; Space-drag; the middle button; or the **Hand** tool (**H**). **V** goes back to **Select**. Both buttons sit at the left of the canvas toolbar, with their key on them. |
| Zoom | Pinch, or Ctrl+wheel. **+ / −** (right after the Select/Hand tools) and **Ctrl+= / Ctrl+−**. The zoom % button between them: *Zoom to fit* (**F** or **Shift+1**), *Zoom to selection* (**Shift+2**), *100 %* (**Ctrl+0**). |
| Select | Click a box; Shift- or Ctrl-click to add; drag on empty canvas for a selection box; **Ctrl+A** for all. **Tab** goes from box to box, and the view follows. |
| Move / resize | Drag a box by its title bar, or **arrow keys** (10 px; **Shift** 1 px). Resize from the bottom-right corner, or **Alt+Shift+arrows**. |
| Copy, paste, duplicate | **Ctrl+C / Ctrl+V** (a paste lands at the pointer), **Ctrl+D**. Words pasted onto the canvas become a Text box; a picture becomes an Image box. |
| Delete | **Delete** or **Backspace** — the selected boxes, or the selected wire. |
| Edit a box / name an arrow | **Enter** or **F2** with one box selected opens its editor; with a wire selected it names the wire (typing does too). |
| Every action, with the mouse | Right-click a box (**Copy text** when words are selected, **Edit**, **Duplicate**, **Copy box**, **Zoom to this box**, **Delete box**) or a wire (**Name this arrow**, **Unplug**). |
| Edit a box's code in the drawer | **Edit code** on the box. **Ctrl+Enter** runs it: it redraws that box (or restarts it when Live), in the drawer and in the box's own code field alike — never the whole graph, which is what Ctrl+Enter does on the canvas. **Tab** indents, **Esc** closes the editor. |
| Leave a field | **Esc**. Pressed again it closes a menu, then the drawer, then stops a run, then clears the selection. |

The view keys — **V**, **H**, **F** and the other zoom keys — work anywhere on the Computer, even after you have clicked the run bar or the library. They never fire while you type in a field. The keys that change boxes (Delete, Ctrl+C, arrows) only act when the canvas has the focus.

---

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| An Instruction is red and says the farm is not connected, or needs its password | The client has not found a farm on the LAN, or has not been given the farm's password. | Check the farm pill in the topbar. Nothing that thinks runs without a farm; there is no cloud fallback, by design. Boxes that do not think (Text, SVG, Code, views) still run. |
| The run bar says the farm was busy, or the run paused | Every seat on the farm is in use, or a person took priority. | Press **Run all** again in a moment. Everything already done keeps its value. |
| A box is red with a sentence; the boxes after it say **Needs a re-run** | One box failed; its branch stopped rather than passing nothing along. | Fix what the sentence says, press **Run all**. Only the failed box and what depends on it run again. |
| The answer did not match the shape you asked for | The model's JSON did not validate against your schema. | Simplify the schema (fewer required fields, no nesting), or shorten the instruction. |
| A code answer was cut off | The model ran out of room before it finished — a thinking model can spend it all on thoughts. | Run it again, or pick a model that thinks less in the box's **Model** menu. The box says which of the two happened. |
| A Code box shows a **Line 7** chip | Your JavaScript threw. | Click the chip to go to that line. `inputs.in` is an **array**, and a list arrives whole. |
| A box says *"The sandbox is paused"* | A sketch or a Code box stopped answering three times in a minute (usually an endless loop), so the sandbox stopped restarting itself. | Fix the loop, then press **Run all** or the **▶** in a box's title bar: that starts the sandbox again. Editing the code, **▶ Live** or **Run code** alone does not. |
| A wire will not connect | The canvas refused it and said why in one line: the input is taken, the box cannot take what arrives, or a loop with nothing that can stop it. | Read the line: it says what to do. Put a Toggle (or another control box) in a loop. |
| The pictures stay home | The farm does not list the Instruction's model as able to see pictures. | Pick a model that can in that box's **Model** menu. |
| A Send box says **Dry run — would send: …** | The outputs are not armed, so nothing left this computer. That is the default for every graph, and after every restart. | Press **Outputs: dry run** in the run bar, read the list of targets, and arm. |
| A Trigger never starts a run | A Trigger starts runs only while the outputs are armed and the Computer is on screen; its face says which is missing. | Arm the outputs in the run bar and stay on the Computer. |
| A Sound box sends only its name and length | **Listen** is off (a graph someone hands you always opens with it off), or the farm's speech to text is off. | Turn on **Listen** on the box; if the box says the farm cannot listen, ask the farm's operator. |
| A lesson step will not tick | The rail ticks what you really did, in order, and a change only counts after the step asked for it. | Press **Show me**. If the farm cannot answer, use the saved answer the rail offers. |

To report a bug: press **● Record log**, reproduce it, press **⚑ Mark bug**, and hand over the file
([COMPUTER_DEBUG_LOG.md](COMPUTER_DEBUG_LOG.md)).

---

## What is not built yet

- **The other templates from the plan.** The shelf takes them as data files.
- **A sound reaching a model as sound** (with **Listen** on, the farm writes it down and the words go
  on), and **a PDF sent to a model as a PDF** (a PDF always goes as text read by the farm).
- **Boxes inside a Section do not move with it**, and **wires are grey**, not the colour of what
  they carry.
- **No image, audio or video generation**, **no web search box** (a **Fetch** box reads one address
  you type), **no sub-graphs**, and no editing by several people at once.
