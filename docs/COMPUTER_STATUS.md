# The Computer — where the night got to (2026-09-23, K4 landed)

> Branch `lolchat/vnext`, all of it committed and pushed. The three **must-have core** phases of
> [COMPUTER_PLAN.md](COMPUTER_PLAN.md) are done, and so is **K4** — text boxes that receive, images
> and vision, the preview family, and the warmed-up look. The remaining tail is **K5**, the in-app
> tutorial and the templates, which is **not built**.

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
| **NEW — the warm look, and notes for the reader** | The §9 palette: a colour **and a glyph** on every port so the kinds read in both themes, bigger rounded cards, a 24 px grid. **Sticky** (five tints), **Section** (a dashed named region) and **Title** — all three are inert: they are never in a run, never counted, never spend anything. |

## What is NOT there yet

- **The interactive tutorial and the templates** (K5) — the lesson mechanic, the Tour, lessons 1–12.
  K5's own shippable minimum is the mechanic plus the Tour plus lessons 1–3.
- **"Open live" on a Preview box** — html/three/p5 come back as a *snapshot*, not a running frame you
  can interact with. Moving the one sandbox guest into a box needs a seam in the panel's host that
  does not exist yet; nothing on the box claims to be live.
- **Parts inside a Section do not move with it.** The Section frames and names a group; dragging it
  does not carry its contents.
- **Wires still stroke grey**, not the colour of the kind they carry. The port dots and their glyphs
  carry the type system for now.
- Range, Switch, Data, Website, 3D Model, Camera, Speech — parked by your own scoping.
- No image, audio, speech or video **generation** — your decision, possibly via ComfyQ later.

## The numbers, re-run by me and not taken from the builders

`chat-unit` **1184 passed** · `unit` **5** · `chat-lint` **175 files / 0 violations** ·
`chat-scope` clean · `chat-harness --strict` **251 passed** · perf **9 passed**.

Perf is worth a line: the new look cost pan work, and it was paid back. At 500 parts the pan-work p95
is **4.7 ms** against a 16 ms budget (a first version of the sheet was at 17.6 ms and was rewritten),
and a run costs **0.28 ms per part** against 0.4.

Commits, newest first:

```
HEAD     the Computer's text boxes receive, its pictures can be read, and it looks like the sketch
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

1. **A real Instruction into a Text box** — the headline of this phase. Wire an Instruction's answer
   into a Text box and read whether gemma4's markdown report lands legibly: headings, lists, a table.
   Then click in, edit a line, click out, and re-run: your edit must survive if the box is **locked**
   and be replaced if it is not.
2. **A photo through the vision model** — drop a screenshot on the canvas, wire it into an Instruction,
   and see whether gemma4:12b reads it. This is the first time the Computer sends a picture anywhere.
3. **A three.js or p5 sketch in a Preview box** — whether the snapshot is worth looking at at the size
   the box gives it, and whether an error names a line you can find.
4. **The look, on your monitor** — five kinds, five glyphs, in both themes; and whether the sticky's
   title bar reads as a label or as chrome. The two screenshots I looked at are
   `shell/test/chat-harness/generated/shots/k4-shots-{dark,light}.png`.
5. **The segmented control itself** — three buttons, the Open WebUI webview surviving a switch, and the
   view you were on being remembered across a relaunch. The harness page has no topbar at all.
6. **Your migrated graphs** — that the ones from the per-thread era still open intact. The Text part
   replaced the old Note file but kept its type id, so they should; this is the check that proves it.
7. **A loop on the real farm**, watched with a colleague chatting, to see whether the ceilings and the
   background priority feel polite from the other seat.

[COMPUTER_PLAN.md](COMPUTER_PLAN.md) section 13 is the fuller rig checklist.

## If you want the tail finished

**K5**: the lesson mechanic plus the Tour plus lessons 1–3 is the shippable minimum, and the remaining
lessons are additive after it — stopping between any two leaves a coherent shelf.

Three K4 follow-ups are sized and waiting, in the order I would take them: **Open live** (the one that
changes what a Preview *is*), **parts move with their Section**, and **wires in the kind's colour**.
