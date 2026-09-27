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
> review): the view tools, Live pausing, and the boxes and buttons it had left out.

---

## Opening it

The topbar has a three-way switch: **Open WebUI · LOL Chat · Computer**. Press **Computer**. The
app remembers which one you were on, so the next launch opens there again.

What you see, left to right:

- **The library** (sidebar). **New** makes an empty graph, **Import…** adds a graph from a
  `.lolgraph.json` file, and the search box filters the list. Each graph is a card with its title,
  how many boxes it has and when it last ran. Hover a card for **Rename**, **Duplicate**,
  **Export…** and **Delete**. Below the list is the **Learn** shelf. Drag the sidebar's right edge
  to make it wider.
- **The run bar**, above the canvas: **Run all** (with **Stop** beside it while a run is going),
  counts of parts and generations, the generation cap, a sentence about the last run (and **Run
  everything again** when nothing needed a re-run), **?** (what is this?), and **● Record log** (see
  [COMPUTER_DEBUG_LOG.md](COMPUTER_DEBUG_LOG.md)).
- **The canvas**, with its toolbar: **＋ Add a box**, the **Select (V)** and **Hand (H)** tools, the
  zoom cluster (**−**, the zoom %, **+**, **Fit**), **Undo**, **Redo**, **Tidy**, **Export…**,
  **Replace from file…** and the **Cap** field.
- **The drawer**, on the right, when something is open in it: a value you clicked, or what a box
  sent and got (see [Read the prompt before you pay](#step-4--read-the-prompt-before-you-pay)).
  Drag its left edge to resize it.

A new, empty graph offers **Take the tour · Open a template · Add your first box**, plus one-click
picks for the most common boxes.

---

## The fastest way in: the Learn shelf

The **Learn** shelf in the sidebar holds a tour, four lessons and two templates. A lesson opens as
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
| **Research → problematic** (template) | One topic, five angles of research, one problematic, two design concepts. | about 8 |
| **Creative coding** (template) | A brief becomes a p5.js sketch you can run, read and edit. | about 1 |
| **Read the news** (template) | The Hacker News front page, labelled by the model from **your** categories, counted by code, charted as an SVG that answers **your** question. A copy of the page ships with it, so it runs offline too. | about 2 |

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

The **?** in the run bar explains the Computer in two sentences and leads to the same shelf.

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
free input that takes what the wire carries. The canvas says *"Text now feeds Instruction"*.

A wire that cannot be made is refused **on the spot**, in one sentence: *"Those two are already
wired together."*, *"A part cannot feed itself."*, a kind the box does not accept, or a loop with
nothing in it that can stop it (see [Loops](#loops-and-the-limits-of-a-run)). Let go on empty
canvas and nothing is made; the canvas says to drop the wire on a box or its dot.

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
instruction does not mention is flagged on the box (*unused: …*), and so is a name the instruction
mentions but no arrow carries.

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
and whether it came from the cache.

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
behind all five: its *Read it as* menu (**Automatic**, **Markdown**, **SVG**, **Web page**,
**three.js**, **p5.js**) picks how to show what arrives.

### No need to write the code yourself

A Code box does not have to be written by you:

- **＋ → Think → Write code** is an Instruction you give in plain words (*count how many items there are in
  each category*). Wire the data into it too, so the model sees its shape, and wire its answer into the
  Code box's **code** port (the data goes into **Inputs** as usual). On **Run all** the model writes the
  program and the Code box runs it, with numbers computed from the data, never typed by the model. The Code
  box shows the program it ran. Type in it and it becomes **yours** (the model's next version is then
  ignored); **Use the model's code** gives it back to the model.
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

- **Image.** Stored on this computer, downscaled. Wired into an Instruction, the picture goes to
  **that Instruction's model** as part of the prompt. When the farm does not list that model as
  able to see pictures, the box says so and nothing is sent; pick a model that can in the box's
  **Model** menu.
- **Document (PDF).** Kept on this computer. When a run needs the text, the farm's document reader
  reads it once, and only the text comes back and flows on. A PDF that states more than 60 pages is
  refused when you drop it; nothing is kept or sent.
- **Sound.** Kept and playable in the box (**▶ Play** / **■ Stop**). A sound wired into an Instruction
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
to be spoken). **Automatic** uses the farm's voice when there is one. **Stop** stops the voice.
Together with Listen, a graph can hear a question and answer it aloud: Sound (Listen) → Instruction →
Speak.

### Acting on the world: the Send box

**＋ → Show → Send** hands what arrives to a device. **Send by** picks the transport:

| Send by | The target you type | What the value becomes |
|---|---|---|
| **OSC (UDP)** | host, port (9000), OSC address (`/lol`) | a number, a word, true/false — or a list of them as the arguments |
| **DMX over Art-Net** | host (a node, or a broadcast address), port (6454), universe | a list of channel levels (channel 1 first) or `{"12": 255}` |
| **MQTT publish** | broker host, port (1883), topic | the text, or the JSON of anything else |
| **WebSocket** | `ws://…` address (an ESP32, for instance) | the text, or the JSON |
| **HTTP POST** | `http://…` address | the text, or the JSON, as the body |

The target is always typed by you in the box: an arrow only brings the **value**, so a model can never
choose where a graph sends. And the rules are the same for every graph, even one someone gave you:

- **Dry run by default.** Until you arm the outputs, a Send box only shows **Dry run — would send: …**
  and nothing leaves. A graph always opens as a dry run, and so does the Computer after a restart.
- **Arming asks first.** The run bar's **Outputs: dry run** button (it appears when the graph has a Send
  box) asks before arming and lists every target of the graph. Armed, it reads **Outputs: LIVE**; press
  it again to go back to a dry run.
- **Panic** (next to it while armed) stops everything at once and sends a **blackout** to every DMX
  universe the graph lit.
- **Limits:** at most 20 messages a second to one target, and DMX at most **3 frames a second** — nothing
  a graph sends may flash a light faster than that. A message over the limit is held back, and the box
  says so.
- Never the farm's own ports. This computer is allowed: OSC to TouchDesigner or Max on `127.0.0.1` is a
  normal target.

### Data from the web: the Fetch box

**＋ → Bring in → Fetch** reads a web address you type: an open API (JSON) or a page. Press ▶: a JSON
answer flows on as data a **Code** box can pick apart; anything else flows on as text. Only that request
leaves this computer. The rules, so a graph someone hands you cannot misuse it:

- only **http://** and **https://**; no user name or password in the address;
- never this computer, a link-local address, or the farm's own ports (reach the farm through its boxes);
- at most **1 MB** of text, in at most 15 seconds;
- when the network is gone, the box keeps the **last copy** it read and says **Offline — kept the last
  copy**. A refusal or an error from the site never falls back.

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
technical), so glance at the result. Its confidence is not calibrated, and the box says so.

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
| **Toggle** | A switch: off lets values through without running what follows. |
| **Timer** | Waits a few seconds, and can repeat. |

A box that is waiting for you says **Waiting for you**, and the run bar counts the questions
waiting, with **Show me** to go to the oldest one.

The **Annotate** group holds boxes for the reader of the graph:

| Box | What it does |
|---|---|
| **Sticky** | A coloured note for the reader. Never runs. |
| **Section** | A labelled region to group the parts of one idea (its parts do not move with it yet). |
| **Title** | Big words on the canvas. Never runs. |

### Loops and the limits of a run

A wire that closes a loop is allowed only when the loop passes through something that can stop it
— a Toggle, Condition, Confirm, Dialog, Button or Timer. Otherwise the wire is refused when you
draw it.

Every run has four limits, so no graph can quietly spend the farm or run for ever: **8** passes
through any one box, **50** generations, **10 minutes** (time spent waiting for you included), and
**2000** box runs in all. The generation cap is the **Cap** field in the toolbar, which remembers
what you set. When a run stops at a limit, a notice above the canvas says which one, keeps every
answer, and offers **Raise it for this run** (for the generation cap: **Raise the cap for this
run** and **Show me what spent it**). A plan whose Timers alone would outlast the time limit is
refused before it starts, with the arithmetic.

### Sharing the farm

A run asks the farm at **background priority**. When someone chats, they go first: the run pauses
and the run bar says so; press **Run all** to carry on, and nothing already finished is asked again.
A run also sends nothing while the Computer's window is in the background.

---

## Writing files

A **File** box writes what arrives into a file in **this graph's own project folder** on your
machine — one folder per graph, made on its first write (a duplicated graph gets its own). Set
*Path in the project*, for example `out/tokens.css`. After a run it says *Wrote out/tokens.css* and
offers **Reveal in Explorer**. Running again overwrites the same file.

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
| A wire will not connect | The canvas refused it and said why in one line: a duplicate, a kind the box does not accept, or a loop with nothing that can stop it. | Read the line. Put a Toggle (or another control box) in a loop. |
| The pictures stay home | The farm does not list the Instruction's model as able to see pictures. | Pick a model that can in that box's **Model** menu. |
| A lesson step will not tick | The rail ticks what you really did, in order, and a change only counts after the step asked for it. | Press **Show me**. If the farm cannot answer, use the saved answer the rail offers. |

To report a bug: press **● Record log**, reproduce it, press **⚑ Mark bug**, and hand over the file
([COMPUTER_DEBUG_LOG.md](COMPUTER_DEBUG_LOG.md)).

---

## What is not built yet

- **Lessons 5–12** and the other templates from the plan. The shelf takes them as data files.
- **A sound reaching a model**, and **a PDF sent to a model as a PDF** (a PDF always goes as text
  read by the farm).
- **Boxes inside a Section do not move with it**, and **wires are grey**, not the colour of what
  they carry.
- **No image, audio or video generation**, **no web search or fetch box**, **no sub-graphs**, and
  no editing by several people at once.
