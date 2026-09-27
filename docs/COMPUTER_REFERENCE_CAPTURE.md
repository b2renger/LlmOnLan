# Reference capture — what the owner showed us (2026-09-22)

> The owner sent nine screenshots of **tldraw computer** (computer.tldraw.com) plus two of their own
> graphs built in it, and said: *"The Computer is not a chat — I think it's a thing on its own. We want
> it as an autonomous tool like the OWUI interface and the LOL Chat interface… I want it to be closer to
> tldraw computer. It does not need to communicate with the chat."*
>
> This file is the record of what was in those images, written by the only participant who could see
> them, so that every agent working on the standalone Computer designs against specifics rather than a
> paraphrase. **We are not cloning tldraw's look** (owner: *"I don't really want it to look like it, but
> we need a set of friendly look and friendly control"*). We are taking the MODEL and the TEACHING.

---

## 1. The owner's own graphs (what they actually want to do with it)

**Graph A — "accessibility in museums for autistic persons".** A single Text box holding the topic, with
**six labelled arrows** fanning out of it, every label reading `topic`, each into its own Instruction box:
*"Do some societal research on the topic"*, *"Do some environmental research on the topic"*,
*"Do some technological research on the topic"*, and so on. Each Instruction writes into a Text box
holding a full markdown report (headings, bold runs, bullet lists — the text boxes are scrollable and
render markdown).

**Graph B — the convergence.** Those five or six report boxes then feed a SINGLE Instruction box through
arrows labelled `technological research`, `societal research`, `environmental research`, …:
*"write a problematic about the topic taking into account: technological research, environmental
research, societal research, business research, existing companies, and existing technologies"*. Its
output (one dense paragraph) fans out again into two Instruction boxes *"Developp a design concept about
the problematic"*, one of which returns **JSON** (`{"title", "problem", "solutions": [...],
"visualRepresentation"}`) and the other prose.

**What this tells us, and it is the whole brief in one line:** the arrow label IS the variable name. The
instruction refers to `societal research` in its prose and the runtime must bind that phrase to the value
arriving on the arrow labelled `societal research`. Research → synthesis → concept, fanned out and back,
by hand, on a canvas. That is a small agentic workflow, built by a designer, with no code.

---

## 2. tldraw computer's component palette (left rail, as shown)

`Instruction · Text · Image · Model (3D) · Camera · Speech · Website · File · Range · Data · Button ·
Toggle · Condition · Switch · Timer · Interval · Dialog · Confirm`

The owner has scoped ours: **Button, Condition, Confirm, Dialog, Toggle, Timer/Interval** in this build;
Range and the rest "later"; **no image/audio/speech/video generation** (possibly later via ComfyQ).

## 3. The lessons, as tldraw teaches them (our tutorial's skeleton)

Each is a numbered page on one canvas: a big number, a title, a one-line subtitle in grey, sticky notes
pointing at the components, and a "Next up…" card in the corner linking the following lesson. The active
component is highlighted with a **yellow blob/halo** behind it, and a run button `▶` sits in each
component's title bar.

| # | Title | Subtitle, verbatim | What it shows |
|---|---|---|---|
| 1 | hello world | *Click the ▶ to run a component.* | Two Text boxes, one arrow. "When a component runs, it will send its data to any connected components." "A text component will display any text-like data that it receives." Tip: the 🔒 lock button prevents a text block's text from changing. |
| 3 | building a graph | *A component will run when its input components are finished running.* | Text → Image → Text. "When a component runs, it will run any components connected to it." |
| 4 | many inputs, many outputs | same subtitle | Text + Image both → one Image → Website AND Text. "A component can have many inputs of any type… and many outputs, too." Each component shows its elapsed seconds (`0.7s`, `10.7s`) bottom-right. |
| 5 | user prompts | *You can pause the workflow to ask the user a question* | A Dialog component whose text is the question; running it opens a real modal prompt, and the answer flows on. |
| 6 | instruction components | *The instruction component lets you create custom outputs from its inputs* | Text → Instruction ("Write the rules for the game.") → Instruction ("Write a newspaper article summarizing a championship game based on these rules.") → Text; a second branch feeds an Image. "If a component has more than one input component, it won't run until all of its inputs have finished running." |
| 7 | arrow labels | *Arrow labels work like named parameters, you can refer to them inside of instruction components.* | Text "United States" —`country`→ and Text "forestry" —`topic`→ into *"Write an interesting fact based on the country and topic."* |
| 9 | control flow | (repeats the arrow-label subtitle) | A Button ▶ starts it; Text → Instruction *"Is this song about love?"* → three Condition circles **Yes / No / Maybe**, each into a Confirm box. "Buttons need a click before they'll run their connected components." "Boolean components support yes, no, and maybe!" |
| 10 | timers | *You can use intervals to pause workflows* | Text → ⏱3 → Text → ⏱3 → Text. "You can edit a timer's time in seconds." |
| 11 | toggles | *You can use intervals to pause workflows* (sic) | A text-adventure loop: a green "game state" Text box —`game state`→ a Toggle → an Instruction *"Create a new game state based on the current game state"*, with a second green Text box —`user input`→ into it, and the Instruction's output wired BACK to the game state box. "When a toggle is set to false, it will stop the workflow but still allow data to be pulled through it." "In this example, the Instruction is still able to read the game state, but updating the game state doesn't cause the system to loop." |
| 12 | ranges | *Intervals are a way to interpolate between inputs.* | Two Text boxes (*"Crime and Punishment plot"*, *"101 Dalmatians plot"*) → a Range slider → a Text box holding the blended result. "A range component will blend its inputs according to the slider." |

There is also a **projects list** ("← Projects", a named graph *Story Generator*, a **Fork** button, a
`6/750` counter) and a worked template — *Story generator* — laid out in labelled **sections** across the
canvas: `Prompt | Outline | Chapters | Complete Story | Audio`, with dashed vertical rules between them,
a title written on the canvas, "Click here" hand-drawn arrows, and three Dialog boxes (*Who is this
character? / Where does the story take place? / What problem needs solving?*) feeding one Instruction.

## 4. Component chrome, as drawn

A box is a white card with a 1px border and a rounded corner. Its title bar carries a drag handle (⠿),
the type name in monospace, and on the right a 🔒 lock, a `?` help dot where relevant, and the `▶` run
button. The body is the content (editable text, an image, a slider). Bottom-right shows the last run's
duration. Ports are small filled dots on the box edge; arrows are hand-drawn-ish curves with an optional
label sitting on the curve. Sticky notes are square, yellow/orange/olive, and purely annotative.
Selected/running components get a thick offset shadow in the accent colour.

---

## 5. What we take, and what we deliberately do not

**Take:** arrow labels as named parameters · forward execution from any component's ▶ · "a component with
several inputs waits for all of them" · control flow as components (Button/Condition/Confirm/Dialog/
Toggle/Timer) · annotation as first-class canvas furniture (sticky notes, section headers, titles) ·
per-component elapsed time · numbered in-canvas lessons with a "next up" card · named, forkable projects.

**Do not take:** the hand-drawn visual identity (we use warmed-up ComfyQ tokens, owner's choice) · the
cloud model and the credit counter (`6/750`) · image/audio/video/speech generation · the 3D Model and
Camera components · Website scraping (offline LAN) · anything that talks to a service outside the farm.
