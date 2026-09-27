# LOL Chat — the Computer panel (spec delta)

> Written 2026-09-16 after the owner asked for *"something like https://computer.tldraw.com/"*, built for
> our own use, on the local model.
>
> **This replaces S1 "the map"** in [LOLCHAT_STUDIO_PLAN.md](LOLCHAT_STUDIO_PLAN.md). Everything else in
> that plan (S0 rails, S2 vibecode bench, S3 design/board) stands. Where this file and S1 disagree, this
> file wins. S0's ask spine, run queue and projects API are prerequisites and are unchanged.
>
> **Local only.** Every node that thinks runs on the farm on the LAN. There is no cloud path, no API key,
> no CDN, no "works better online" mode — see the prime directives in CLAUDE.md and §6 below.

---

## 1. What it is

An infinite canvas in the workbench column where you place **parts**, draw **wires** between them, and
press **Run**. Values flow along the wires; parts that think call the local model; the canvas computes.

It is not a mind map with an AI button, and not a chat with a diagram. It is a small visual program you
assemble in a minute and re-run all afternoon.

**Why this is worth building here, specifically:**

- **Re-running is free.** A graph that fans out over 40 references, four variants each, is 160 generations.
  On a metered API nobody presses that button twice. On our farm it is a coffee break, and that changes
  what you are willing to try. This is the one capability the office has that nobody else does.
- **The office already thinks in nodes.** TouchDesigner, Blender's shader/geometry nodes, ComfyUI — a
  wire from a box into another box is the native idiom here, not a novelty.
- **It composes with what we built.** Parts reuse the P1 stream controller, the P2 seat governor and
  budget, the S0 run queue, the S2 sandbox (for `Code` and `Render`) and the S0 projects API (for `File`).
  The Computer is mostly wiring existing machinery to a canvas, not a second application.

---

## 2. The model of computation

- A **graph** belongs to a thread (one canvas per thread, like the other panels). Persisted in IndexedDB,
  exported/imported as one JSON file.
- A **part** has: type, position/size, its own settings, zero or more **inputs** (named ports), one
  **output**, a cached **value**, and a **state** (`idle · stale · queued · running · done · error`).
- A **wire** connects one part's output to one input port of another. Multiple wires into the same port
  are allowed and arrive as an ordered list.
- **Run** = topological execution of the dirty subgraph. Editing a part marks it and everything downstream
  `stale`; `Run` recomputes only what is stale, so a 30-part graph costs one generation after a typo fix.
- **Cycles are rejected** at wire-draw time (the wire snaps back with a reason). Iteration is expressed by
  the `Repeat` part, not by feedback loops — a loop that can't terminate is the main way a visual program
  eats a GPU farm.
- **Values are typed but forgiving**: `text`, `image`, `list`, `json`, `file`. A part declares what it
  accepts; a mismatch is a visible error on the part, never a silent coercion. `list` into a part that
  wants `text` is the exception: it **fans out** (see below).

### Fan-out (the thing that makes it more than a prompt chain)

When a `list` arrives at a port that accepts `text`, the downstream part runs **once per item** and its
output becomes a `list` of the same length. Fan-out propagates until a `Collect` part joins it back.

- A fan-out shows `7/40` on the part while it runs, with per-item errors kept per item (one bad item never
  kills the run).
- **Cap:** a run that would exceed `computeMaxItems` (default **50** generations) stops at the cap and says
  so on the canvas, with a "raise the cap for this run" button. Not a silent truncation, not an unbounded
  bill of other people's seats.

### Etiquette (inherited, non-negotiable)

One farm request in flight at a time, through the S0 queue and the P2 governor: a running graph is a
**background** holder, so a human typing in the chat takes priority and the graph waits for the next slot.
`Stop` aborts the in-flight request and leaves every completed value cached. Closing the panel or the app
stops the run; values survive.

---

## 3. The parts (v1)

| Part | In | Out | What it does |
|---|---|---|---|
| **Note** | — | `text` | A literal: typed text. The input end of most graphs. Doubles as a comment when unwired. |
| **Image** | — | `image` | Dropped, pasted, or taken from a thread message. Stored in the existing attachments store, downscaled like P3-U1 does. |
| **Ask** | any (many) | `text` | The workhorse. Inputs become labelled context, its own text is the instruction, and it runs on the farm. Settings: model, thinking on/off, temperature, and output shape (`text` · `list` · `json` with a schema). |
| **Look** | `image` (+ optional `text`) | `text` | Vision: describe/critique/extract from an image with the served vision model. Separate from `Ask` because its prompting and its failure mode ("no vision model served") differ. |
| **Split** | `text` / `json` | `list` | Text → items, by lines, by numbered list, by JSON array, or by a separator. The entry point to fan-out. |
| **Collect** | `list` | `text` / `json` | Joins a fan-out back into one value: bullet list, numbered, JSON array, or a template per item. |
| **Filter** | `list` (+ criterion) | `list` | Keeps items matching a criterion. Deterministic mode (contains / matches / length) and model mode (one cheap yes/no per item, cached by item hash). |
| **Code** | any | any | Deterministic JavaScript, run in the S2 sandbox with no network and no file access. `(inputs) => value`. This is where arithmetic, parsing and sorting belong — not in the model. |
| **Render** | `text` / `json` | `image`-ish preview | Renders markdown, SVG or an HTML page in the sandbox, as a live tile on the canvas. Export to `.svg` / `.png` / file. |
| **File** | any | `file` | Writes the value into the thread's scratch project (S0 projects API), e.g. `out/names.md`. Shows the path; "Reveal in Explorer". |
| **Repeat** | any | `list` | Runs its input subgraph N times (N ≤ the cap) — the "four variants" button. Each pass gets a different seed and an index the parts can use. |
| **From thread** | — | `text` / `image` | Pulls the selected message (or the current answer) out of the conversation onto the canvas. The bridge between the chat and the graph. |
| **To thread** | any | — | Posts a value back into the conversation as a message, so a graph result becomes something you can talk about. |

Deliberately **not** in v1: image *generation* (no image model on the farm), web fetch/search nodes (offline
LAN; SearXNG is a later carve-out), sub-graphs as parts, multi-user editing, a scripting language.

---

## 4. The canvas itself

- **Rendering:** DOM parts inside one transformed layer, wires in a single SVG layer beneath. DOM parts
  keep text selection, inputs, focus and screen-reader semantics for free; the SVG layer is one element,
  so it stays cheap. Target: **500 parts** pannable at 60 fps, which is far past any real graph — the perf
  scenario asserts it.
- **Interaction:** drag to move, drag from a port to wire, click a wire to delete, marquee select, `Delete`,
  copy/paste (including pasting a graph as JSON), undo/redo (the canvas owns its own undo stack), pan with
  space/middle-drag/wheel, zoom with ctrl-wheel, `f` to fit, `Run` on `ctrl+enter`, `Esc` to stop.
- **Reading values:** each part shows a truncated preview; click the value to open it full-size in the
  chat column (the panel is the program, the conversation column is the inspector). A `done` part shows
  its cost: tokens and seconds, from the same stats the chat uses.
- **Layout help:** "tidy" (layered left-to-right, ~200 lines of code), never automatic — nobody wants their
  canvas rearranged under them.
- **Styling:** ComfyQ tokens only, like every other LOL Chat surface. Part states read as colour + label,
  never colour alone.

---

## 5. How it is stored and shared

- New IndexedDB store `graphs` (one row per thread) + the existing `attachments` for images. Migration is
  additive; existing threads open with an empty canvas.
- **Export** writes one `.lolgraph.json` (parts, wires, settings, cached values optional, images inlined as
  data URLs or referenced by hash). **Import** drops it onto any thread. That is the sharing story on a
  stateless farm: a file on a USB stick or in Slack, no server, no account.
- A graph never stores a farm address, an API key or anything about who ran it.

---

## 6. Prime directives, checked

- **Local only.** Every thinking part calls the farm's LAN endpoint through the existing controller. There
  is no other network call in this panel; `Code` and `Render` run in a sandbox that is *proven* offline by a
  harness assertion, not by intention.
- **Data stays on the machine.** Graphs, values and images live in the user's IndexedDB; files go only to
  the user's own scratch project folder.
- **Open WebUI untouched.** Nothing here reaches the webview.
- **The farm is untouched.** No farm, fleet or orchestration code changes. The Computer is a client that
  behaves itself: one request at a time, background priority, hard item cap.

---

## 7. Tests (what "done" means)

**Unit (pure, in Node):** topological order and cycle rejection · dirty-marking and the stale set · fan-out
and re-join semantics · the cap · value coercion rules · graph JSON round-trip and schema validation ·
`Split`/`Collect`/`Filter` deterministic modes · undo/redo stack.

**Harness (real Electron, mock farm):** build a graph by driving the DOM → run it → assert the model was
called the expected number of times with the expected bodies · fan-out of 5 runs 5 completions and one
failing item leaves the other four `done` · `Stop` mid-run aborts exactly one request and keeps cached
values · a stale edit re-runs only the dirty subgraph · seat-wait: a graph run yields to a chat message ·
the cap stops at 50 and offers to raise · `Code` in the sandbox cannot reach the network or the filesystem ·
`File` writes inside the project root and refuses `..` · export → import → identical graph · 500-part canvas
pans at 60 fps (perf group).

**Rig (human, real farm — additions to the rig checklist):** a real 40-item fan-out against gemma4 and what
it costs in wall-clock and seats while a colleague is chatting · a vision `Look` part on a real render ·
a graph left running while the app is closed · export/import between two machines.

---

## 8. Build order

1. **S0 rails** (unchanged, from the studio plan): workbench column, ask spine, run queue, projects API.
2. **C1 — canvas + graph engine:** parts, wires, persistence, run/stop, `Note`/`Ask`/`Collect`, undo.
3. **C2 — fan-out and the rest of the parts:** `Split`/`Filter`/`Repeat`/`From thread`/`To thread`, caps,
   per-item errors, costs.
4. **C3 — sandbox parts and files:** `Code`, `Render`, `File`, export/import, tidy layout, perf pass.
5. Then the studio plan's **S2 vibecode bench** (shares the sandbox) and **S3 design/board**.
