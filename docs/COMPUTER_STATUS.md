# The Computer — where the night got to (2026-09-23, 07:15)

> Branch `lolchat/vnext`, all of it committed and pushed. The three **must-have core** phases of
> [COMPUTER_PLAN.md](COMPUTER_PLAN.md) are done. The two tail phases — images/previews/the warm look
> (K4) and the in-app tutorial (K5) — are **not built**.

---

## Open it

Close your installed client if it is running (single-instance lock), then:

```bash
cd shell && npx electron .
```

The topbar now has a three-way segmented control: **Open WebUI · LOL Chat · Computer**. The Computer is
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
| **Two ways to run** | **▶ on any box** runs it and everything downstream (and quietly runs any un-run ancestors it needs first, so ▶ works on a graph that has never run). **Run** does the whole stale graph. **Stop**/Escape cancels either. |
| **Control flow** | Button, Condition (yes/no/maybe), Confirm, Dialog (pauses the run and asks you), Toggle (the gate that makes a loop legal), Timer/Interval. |
| **Loops that stop themselves** | A loop must contain a gate, and four ceilings bound it: iterations, generations, wall-clock, and a per-iteration cache salt so a loop can't quietly become a free fixed point. A run also never outlives the graph it started on, or the question it asked. |

## What is NOT there yet

- **Images and vision** (K4-U1) — you cannot drop a photo in and have the vision model read it yet.
- **Preview boxes** for html/css/js, three.js, p5.js and SVG (K4-U2). The `code` and `render` parts from
  the earlier build still exist, but the friendly preview family does not.
- **The warmed-up look and the sticky notes** (K4-U3) — the canvas still wears the plainer chrome.
- **The interactive tutorial and the templates** (K5) — the lesson mechanic, the Tour, lessons 1–12.
- Range, Switch, Data, Website, 3D Model, Camera, Speech — parked by your own scoping.

## The numbers, re-run by me and not taken from the builders

`chat-unit` **1116 passed** · `unit` 5 · `chat-lint` 161 files / **0 violations** · `chat-scope` clean ·
`chat-harness --strict` and the perf group were green at each landing (the full sweep is re-running as I
write this; if it finds anything I will fix it before you are properly awake).

Commits, newest first:

```
58fd91f  a run never outlives the question it asked, nor the graph it was started on
da9b461  the Computer runs — a play button on every box, six control parts, loops that stop themselves
468e525  the transcript stops guessing, and its budget stops growing
5e4a252  the Computer's arrows carry names, and the prompt is readable before you pay for it
00e5231  the Computer's toasts, its Escape, and the E2E test K1 quietly broke
3c43d7c  the Computer becomes a surface of its own, with a library of graphs
44ac372  docs: write down what the owner showed us of tldraw computer
```

## What only you can check (it needs the real farm and a real window)

The harness drives the renderer, not the whole client, so **none of this was verified on real hardware**:

1. The **segmented control itself** — three buttons, the Open WebUI webview surviving a switch, and the
   view you were on being remembered across a relaunch. The harness page has no topbar at all.
2. **A real Instruction against gemma4** — whether a 12B model actually honours `societal research` the
   way the frozen prompt assembly assumes. This is the single most important thing to try, and the
   transcript drawer is there to show you what it received.
3. **Your migrated graphs** — that the ones from the per-thread era opened intact in the new library.
4. **A loop on the real farm** — a Toggle loop, watched with a colleague chatting, to see whether the
   ceilings and the background priority feel polite from the other seat.
5. **Condition on real prose** — the model answering "yes"/"no"/"maybe" reliably enough to branch on.

Build [COMPUTER_PLAN.md](COMPUTER_PLAN.md) section 13 is the fuller rig checklist.

## If you want the night's tail finished

K4 then K5, in that order — K4 makes it look and feel like the thing you sketched (images, previews,
sticky notes, the warm chrome), K5 makes it teach. K5's own shippable minimum is the lesson mechanic plus
the Tour plus lessons 1–3; the remaining lessons are additive after that.
