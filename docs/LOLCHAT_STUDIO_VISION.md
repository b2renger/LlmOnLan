# LOL Chat Studio — vision and release decision

> Written 2026-09-15 by the pragmatic, after the owner read `LOLCHAT_PLAN.md` §P3/§P4 and said:
> *"it feels like we are reinventing owui with a different stack… I was hoping for vibecoding with a
> specific harness, we code in js and also make some esp32 stuff and arduino stuff, I was hoping for
> mind maps, tools for designers assisted with a local model."*
>
> This document **replaces the release core of P3 and P4** and supersedes the earlier draft of this
> file. P0–P2 are landed and unchanged. `LOLCHAT_VISION.md` still describes the chat;
> `LOLCHAT_STUDIO_PLAN.md` is the engineering companion to this document — where the two disagree,
> the deltas are listed in §12 and **this document wins**.

---

## 1. The owner's complaint, answered

Open WebUI is a **conversation about work**. Studio is **the work, with a conversation attached**.
Five concrete differences, none of which OWUI has or is going to grow:

1. **The output is a file, not a message.** Every panel ends in something another program opens: a
   project folder with `sketch.mjs` in it, a `tokens.css` `:root{}` block, an `.svg`, a
   `platformio.ini` with the right board id, a markdown outline. OWUI ends in a code fence you copy
   by hand. This is why the owner sanctioned main-process file access, and it is the single biggest
   posture change in the pivot.
2. **Generated code runs, here, in under a second, in a proven box.** A sketch re-runs as the model
   writes it; when it throws, the error goes back to the model without you typing anything. OWUI
   renders code as text; it has no runtime, and it structurally cannot have one that is safe in a
   page that also holds your chats.
3. **We check the model's work in JavaScript.** Contrast ratios are computed, not asserted. Pin
   numbers are checked against a table, so "GPIO 6 is flash — this will not boot" is a red line
   under the code, not a hope about the model's memory. Palettes are quantised deterministically.
   Edits apply by exact anchor or visibly refuse. A 30B model is good at judgement and variety and
   bad at arithmetic and consistency; the product is built along that seam. OWUI, correctly for what
   it is, renders whatever the model said.
4. **The model is given local truth instead of asked to remember it.** The board pack, the library
   version actually in the project, the fonts we actually have — handed over as a few hundred tokens
   of fact. This is the highest-leverage fix available for a small model, and it is only possible
   because the tool lives on the machine with the facts on it.
5. **Space instead of a stepper.** P2 built a real branching message tree and renders it as
   `◀ 2/3 ▶`. Studio draws it. Ideas, images and branches sit on a canvas you and the model both
   edit. That is the shape designers already work in; a chat log is not.

**The standard every unit is held to.** Local is not a feature we argue for, it is the ground this
product stands on: the farm in the next room is the only inference this client may use, there is no
cloud path and there will not be one (owner, 2026-09-16: *"I want local no api so forget it if it is
not local"*). So the kickoff test is not a comparison with anything — it is simply: **does this unit
make someone's afternoon better?** What the farm buys us on top is that running something twenty
times costs nothing but time, which is why the repair loop, "run four variants", and the Computer's
fan-out over dozens of items are all built as if compute were free. Here, it is.

---

## 2. The surfaces — decided

**The thread is the home.** Not the chat, not the canvas: the thread. A thread already carries
messages, a branch tree, attachments and settings; Studio adds to it a map, a project folder and a
board card. Everything persists per thread, and the sidebar keeps being the one list of everything.

**One window, one layout, three widths.**

```
#lolchat
  aside.chat-side     the thread list                     (unchanged)
  div.chat-main       the conversation                    (unchanged)
  div.chat-work       NEW — els.work, the workbench       <- the pivot
  div.chat-live       aria-live                           (unchanged)
```

The grid gains one column: `240px minmax(0,1fr) var(--chat-work-w, 0px)`. `--chat-work-w` has
**three states**, on one control and one shortcut:

| State | What it looks like | Default for |
|---|---|---|
| **Chat** (`0`) | exactly LOL Chat as it ships today | a thread with nothing in the workbench |
| **Split** (drag-resizable, persisted in `kv ui:workWidth`) | model writes on the left, sketch runs on the right | Preview, Board |
| **Work** (`1fr`, `.chat-main` collapsed to 0) | the panel is the page; the composer docks under it as a one-line bar | Map, Design |

This is the decision between "chat is the page" and "a surface rail replaces chat": **neither**.
Work state *is* the surface rail's payoff — the panel owns the window, chat is a margin — without a
new surface contract, a second composer, or a second place that looks like the chat. Split state is
what vibecoding actually wants, because watching the model write while the sketch re-runs is the
whole point. One `Els` key, one owner, no amendment to the §2.6 AE region rule beyond adding the
region.

**Moving between them.** A tab rail down the left edge of the workbench (Preview · Map · Design ·
Board), plus `Ctrl+\` to cycle Chat → Split → Work, plus `Ctrl+1..4` to open a panel directly — all
through the existing `SHORTCUTS` slot, all only while `#lolchat` is visible. Opening a panel from a
message action (*Open in Preview*, *Map this thread*) sets that panel's default width state.
Switching threads keeps the panel you were in if the new thread has content for it, otherwise falls
back to Chat.

**The sidebar is unchanged in this release.** Same list, same menus, same search. It gets one
addition and no more: a small glyph on a thread row when that thread carries a map, a project or a
board card. (A separate "browse projects" list is `LATER` — projects are reachable from the panel and
from Explorer, and two lists of the same thing is how this gets confusing.)

**Exactly one panel is live at a time.** Hidden panels tear down their sandbox, cancel their
animation frame and stop listening. A WebGL sketch, a 400-node map and a component sheet all alive at
once is how a laptop starts dropping frames.

---

## 3. The decision matrix

Value = for **this** office (designers + creative coders, offline LAN, VR/3D, Windows).
Effort: S ≤ 200 lines · M ≤ 600 · L ≤ 1,200 · XL > 1,200. Risk = chance it lands badly or eats a phase.

### 3.1 Rails and etiquette

| # | Feature | Value | Effort | Risk | Verdict | Why |
|---|---|---|---|---|---|---|
| R1 | Workbench host + panel slot + three widths | — | M | L | **BUILD NOW** | Everything else mounts in it. |
| R2 | `app/ask.mjs` one-shot typed question | — | S | L | **BUILD NOW** | Map, design and board all need it; without it we grow three send pipelines. |
| R3 | Structured output + prompt-and-parse fallback | H | S | M | **BUILD NOW** | Verified live through LiteLLM; the fallback is what stops a farm bump breaking six features. |
| R4 | Seat ledger in the strip (yours / farm / queue, cancellable) | H | S | L | **BUILD NOW** | Precondition for every batch feature. Two slots, ten people: without it we quietly starve a colleague. |
| R5 | Per-thread studio state (which panel, which project, which board) | M | S | L | **BUILD NOW** | Cheap; without it every thread switch loses your place. |
| R6 | Packs: import/export a board book, rubric or token set as one file | M | S | M | **LATER** | The honest answer to "no shared memory", but it is an injection surface and it can wait until one real pack exists. |

### 3.2 Vibecode bench (Preview panel)

| # | Feature | Value | Effort | Risk | Verdict | Why |
|---|---|---|---|---|---|---|
| V1 | Sandboxed runner + live preview, re-runs on each accepted revision | H | L | M | **BUILD NOW** | The owner's first ask; the sandbox is measured, not guessed. |
| V2 | Scratch project on disk (create / write / list / reveal) | H | M | M | **BUILD NOW** | "A folder you can open in VS Code" is the whole point of a desktop client. |
| V3 | Errors auto-fed back to the model, bounded repair loop | H | M | M | **BUILD NOW** | The one thing that needs the local GPU. Off by default, max 3 attempts, identical-stack stop, one visible Stop. |
| V4 | Anchored edits instead of whole-file rewrites | H | M | **H** | **BUILD NOW, measured first** | Decides whether V1 is a tool or a demo — and the hit rate is unmeasured. See §7-O3. |
| V5 | Parameter knobs: model names its constants, we render sliders | H | S | L | **BUILD NOW** | Cheapest answer to "iterating with a 30B is slow": iterate with the knob it gave you. |
| V6 | Vary: N=4 serialised, visible, cancellable variants | M | S | M | **BUILD NOW** | One instance of multi-sample, priced honestly against 2 slots. Needs R4. |
| V7 | Brief lives as `BRIEF.md`, disk wins, polled on the existing tick | M | S | L | **BUILD NOW** | No new timer, no watcher; makes the bench scriptable by habits this office already has. |
| V8 | Vendored p5/three on the shelf | M | S | M | **OWNER (§7-O1)** | Default: ship none, read from the project's `lib/`. p5 is LGPL-2.1 and ~1 MB. |
| V9 | Frame Zero — vision asks "is anything drawn?" | M | S | M | **LATER** | The farm reports no vision today. Cheap when that changes. |
| V10 | Self-critique pass after a clean run | L | S | M | **LATER** | Drifts into "consider adding comments" without a sharp rubric. |
| V11 | Time-travel scrubber over revisions | L | M | L | **LATER** | Worthless until revisions are plentiful. |
| V12 | Headless overnight soak | L | M | H | **DROP** | Dies at the X (close-means-close) and holds a shared seat while nobody watches. |
| V13 | Variant wall of 16 live sketches | M | L | H | **DROP** | Sixteen WebGL contexts, two farm slots. V6 is the affordable 80%. |

### 3.3 Canvas (Map panel)

| # | Feature | Value | Effort | Risk | Verdict | Why |
|---|---|---|---|---|---|---|
| C1 | Conversation as a map (read-mostly view over the message tree) | H | M | L | **BUILD NOW, first** | Zero new state, pure view over `state/tree.mjs`; finally shows the tree P2 paid for. The hedge if the canvas turns out hard. |
| C2 | Thinking canvas: create / edit / move / link nodes, one undo stack | H | L | M | **BUILD NOW** | The owner's ask (a); the map is the document. |
| C3 | Model ops: expand · cluster · summarise branch · what's missing | H | M | M | **BUILD NOW** | Four schemas through `ask`; results arrive ghosted, the user keeps or drops them. Invented ids are dropped, never resurrected. |
| C4 | Export to markdown outline + `.lolmap.json`, re-import | M | S | L | **BUILD NOW** | Output-is-a-file, applied to thinking. |
| C5 | One layout (tidy tree) + free drag, DOM nodes, ~400-node guard | — | M | M | **BUILD NOW** | Decision, see §4. Four layout algorithms and a canvas renderer with LOD is a library-sized project we are not doing. |
| C6 | Moodboard: drop images, model describes / tags / clusters | H | M | M | **LATER (farm-gated)** | The clearest "we can, a cloud can't" — and it cannot run at all until the farm serves vision. |
| C7 | Whiteboard photo → node graph | H | M | H | **LATER (farm-gated)** | Same gate; and expect 50% and sell it as a head start. |
| C8 | Wire the context — incoming edges *are* the prompt | H | XL | **H** | **LATER** | The most original idea in the catalogue and the one most likely to eat the release. Revisit as a mode of C2 once C2 is real. |
| C9 | Silent background cartographer | L | M | H | **DROP** | Ambient generation on a shared, seat-gated farm is antisocial. |
| C10 | Live-sketch nodes on the canvas | M | L | M | **DROP (this release)** | An iframe cannot live in the node layer without a positioned overlay; that is its own unit. |

### 3.4 Designer bench (Design panel)

| # | Feature | Value | Effort | Risk | Verdict | Why |
|---|---|---|---|---|---|---|
| D1 | Token forge: model proposes palette + type scale in the ComfyQ token shape | H | M | L | **BUILD NOW** | Produces the *exact* artefact two apps in this office already consume. |
| D2 | Component sheet, repainted live on token change, both themes | H | S | L | **BUILD NOW** | How the ComfyQ palette was actually debugged. Reuses the V1 sandbox — one box, two uses. |
| D3 | Contrast computed in JS, failures listed, model explains the fix | H | S | L | **BUILD NOW** | The critique nobody can argue with, because it is measured. |
| D4 | Palette from a photo — deterministic quantiser, model names the colours | H | S | L | **BUILD NOW** | ~60 lines of pure, unit-testable code; survives the no-vision farm; feeds D1. |
| D5 | SVG export + sanitise, promoted from the existing `code-svg` decorator | M | S | L | **BUILD NOW** | ~70% already shipped and nobody noticed; export plus a sanitiser is the missing bit. |
| D6 | SVG studio: click a shape, edit the source, keep the selection | M | L | M | **LATER** | Needs V4's anchored edits proven first, or it degrades to full rewrites every turn. |
| D7 | Vision critique of a render, findings pinned to a 3×3 area vocabulary | H | M | M | **LATER (farm-gated)** | No vision on the farm today. Never draw a model's pixel coordinates as if they were true. |
| D8 | Two-up compare, run both ways, report only agreement | H | S | M | **LATER (farm-gated)** | Same gate. The order-bias trick is correct and cheap when it can run. |
| D9 | House rubric as an editable file | M | S | M | **LATER** | Lands with R6 packs, once there is a critique to apply it to. |
| D10 | Type pairing from fonts installed on this machine | M | M | H | **DROP (this release)** | `queryLocalFonts()` needs a secure context; the renderer is a `file:` origin. Unmeasured and probably impossible — fold the manual "fonts we have" field into D1. |
| D11 | Icon forge, 24 at once | M | M | M | **LATER** | 24 generations on 2 slots. Revisit after V6 proves the queue behaves. |

### 3.5 Board bench (Board panel)

| # | Feature | Value | Effort | Risk | Verdict | Why |
|---|---|---|---|---|---|---|
| B1 | Board pack — **3 boards**, curated, marked verified/unverified | H | M | M | **BUILD NOW** | Highest-leverage fix for "plausible Arduino code that doesn't work". Three boards from the drawer, not eight from a forum. |
| B2 | Lexical injection of the relevant slice (~300 tokens, never 4k) | H | S | L | **BUILD NOW** | No retrieval, no embeddings; a selector and a hard cap. A 30B ignores a 4k pin table and reads a 300-token one. |
| B3 | **Deterministic pin linter** — parse pins from the sketch, check the table | H | M | L | **BUILD NOW** | Injection is hope; a parser plus a lookup table is trust. Pure, unit-testable, no farm. Silent where unsure. |
| B4 | Scaffold + export an Arduino/PlatformIO folder (board id from the pack) | H | S | L | **BUILD NOW** | The owner's exact ask and the honest boundary: we stop where your toolchain starts. |
| B5 | Pin map view for the selected board | M | S | L | **BUILD NOW** | Static table/SVG from the pack; makes the curation visibly worth it. |
| B6 | Boot-loop / backtrace post-mortem (pasted, not read from serial) | M | S | M | **LATER** | Honours "no serial monitor" and is cheap; ships once the pack has proven itself. |
| B7 | Library-aware prompting from the user's `Arduino/libraries` | H | M | H | **LATER** | Genuinely desktop-only, but it wants a *second*, read-only root outside the projects root. Separate capability, separate review. |
| B8 | Wiring diagram SVG from the same pin assignment | M | M | M | **LATER** | Good idea, host must own the layout; after B3 proves the parser. |
| B9 | Logic simulation of a sketch in the sandbox | L | L | H | **DROP** | A green simulation that lies about hardware is worse than none. |
| B10 | Two-target (firmware + p5 twin), kept in sync | L | M | H | **DROP** | Sync is unsolved; generating both once and letting them diverge is not worth a panel. |

### 3.6 Cancelled P3/P4 — what is kept

| From | Kept as | Verdict |
|---|---|---|
| P3-U1 image/vision intake (drop/paste → downscale → attachment → image block) | spec adopted **as written**, built when C6/D7 ungate | **LATER (farm-gated)** |
| P4-U2 structured-output spine (`response_format`, `kv structuredMode`, `extractJson`) | R3 | **BUILD NOW** |
| P4-U1 recipe transform position (order 100) | the slot only — it becomes B2's fact injection | **BUILD NOW** |
| P2-U4 export/import discipline | extended by C4 and R6, not rebuilt | **BUILD NOW (C4)** |
| documents/OCR, web search, Kokoro read-aloud, recipe library UI, structured-card deck, Blender tools | — | **DROP** — OWUI is one toggle away and does them properly; the owner deferred Blender |

---

## 4. The BUILD NOW release

Five landings, each shippable, each leaving the previous ones working. **One panel finished before
the next is started.**

| # | Landing | Contents | Renderer lines | Outside the renderer |
|---|---|---|---|---|
| **S0** | Rails | `ui/workbench.mjs` + `els.work` + `WORKBENCH_PANELS` + three widths · `app/ask.mjs` + `app/json.mjs` (R2/R3) · seat ledger in `ui/strip.mjs` (R4) · per-thread studio state (R5) · `strings/studio.en.mjs` · settings section · the gate changes of §5.3 | ~900 | gate decision only |
| **S1** | Map | C1 conversation-as-map first, then C2 editing + undo, C3 the four model ops, C4 export/import, C5 tidy-tree layout | ~1,600 | repo schema v2 (`maps` store) |
| **S2** | Preview | `sandbox/runner.html` · sandbox host + protocol + watchdog · project bridge (V2) · anchored edits (V4) · repair loop (V3) · knobs (V5) · Vary (V6) · `BRIEF.md` polling (V7) | ~2,100 | **projects API + navigation veto** |
| **S3** | Design | D1 token forge · D2 component sheet in the same sandbox · D3 contrast · D4 palette-from-photo · D5 SVG export/sanitise | ~950 | none |
| **S4** | Board | B1 pack (3 boards) · B2 injection · B3 pin linter · B4 scaffold/export · B5 pin map | ~900 + ~60 KB of pack JSON | reuses S2's API |

**Totals: ~6,450 lines of new vanilla JS/CSS in the renderer, ~450 lines of main-process + preload
(as a separate change set), ~1,200 lines of tests** — ten new pure suites in `chat-unit` and nine new
harness scenarios. No new dependencies, no build step, no bundler, no CDN.

**Stop points that still leave a coherent product:** after S1 (a workbench and a map — already
something OWUI does not do, and not one line outside `shell/renderer/chat/`); after S2 (the owner's
headline ask, complete); after S3.

### Four decisions inside the release worth stating plainly

- **The map renders as positioned DOM nodes in one transformed layer**, not to a `<canvas>`. Text
  editing, focus, hit-testing, selection and the `role=tree` a11y mirror all come free; a canvas
  renderer with a spatial index, LOD and a text-metrics cache is a library-sized project. Guard:
  above ~400 nodes the map stops drawing detail and says so.
- **One layout algorithm** (tidy tree) plus free drag. Not four. Radial, layered and force-directed
  are `LATER`, one file each when wanted.
- **Every vision feature is gated on the farm.** The live farm serves `nemotron-3.5-lightning:30b`
  and reports `supports_vision:false`. No panel ships a spinner that never resolves: where a vision
  feature would be, there is one sentence naming what the operator has to switch on — and the
  non-vision half of the Design panel (D1–D5) is what ships.
- **Multi-sample ships once, small.** V6 Vary, N=4, strictly serial through the governor, a visible
  queue, one Stop. Sixteen-wide walls are not affordable on a 2-slot farm, and pretending otherwise
  would make the tool antisocial in week one.

### Deliberately NOT in this release

The canvas as a wired dataflow graph (C8) · live-sketch nodes on the map (C10) · the moodboard and
every vision critique (C6, C7, D7, D8) · the SVG studio's click-to-select editing (D6) · icon forge
(D11) · type pairing from installed fonts (D10) · library-aware prompting (B7) · wiring diagrams
(B8) · logic simulation (B9, B10) · background or ambient generation of any kind (C9) · overnight
soak (V12) · the 16-tile variant wall (V13) · packs and the house rubric (R6, D9) · a projects
browser in the sidebar · syntax highlighting · and anything at all in `farm/`, `farm-app/`,
`sidecar/`, `.github/` or the packaging config.

---

## 5. Carve-outs from the scope rules — three, each minimised

### 5.1 The sandbox surface

`shell/renderer/chat/sandbox/runner.html`, mounted as
`<iframe sandbox="allow-scripts" src="…/sandbox/runner.html">` (resolved from `import.meta.url`, not
from `location` — the harness and production pages sit at different depths), with **its own** meta
CSP and no `'self'` anywhere in it:

```
default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline';
img-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src blob:;
form-action 'none'; base-uri 'none';
```

**`sandbox="allow-scripts"` is mandatory, not hardening.** Measured on this box: a 1,500 ms
`while(true)` in a plain same-origin `file:` iframe stalls the host renderer for **1,501 ms**; in the
sandboxed frame it costs **12 ms**, because the opaque origin gets its own process. A local model
writing an accidental infinite loop must not be able to freeze the client that holds your chats.

**No `'self'`** means the runner can load nothing from disk at all. The sketch, the project's `lib/`
files and every asset arrive as **text or a `data:` URL over `postMessage`** and are evaluated
inline. That is the price of the isolation and it is worth paying: with `script-src 'self'` on a
`file:` origin, the guest could `<script src="file:///…/anything.js">` and leak file contents back out
through `window.onerror`.

**What generated code CAN do:** `eval`, `new Function`, inline `<script>`, canvas2d and WebGL2, blob
Workers (and terminate them), read the text the host sent it, `postMessage` back to the host, run its
own timers.

**What it CANNOT do:** any network request (`connect-src 'none'` — no farm, no LAN, no internet); any
disk read (`fetch(file:…)`, `<script src>`, `<img src=file:…>` all blocked); `localStorage`,
`sessionStorage` or IndexedDB (opaque origin ⇒ SecurityError); reach the parent DOM, the repo, the
governor or `window.lol` (cross-origin — postMessage only); navigate anywhere (braces: `frame-src
'none'`; belt: a `will-frame-navigate` veto in main, measured working, guest survives the veto);
survive a panel hide, a thread switch or the window closing; stall the host.

**Watchdog:** the host pings; a runner that misses two pings is removed and rebuilt, with a visible
"the sketch stopped responding" row. Removing the iframe mid-loop returns in ~1 ms.

**No change to `shell/renderer/index.html`'s CSP.** `frame-src` falls back to `default-src 'self'`,
which already matches the whole `file:` scheme. `chat-scope.js`'s `checkCsp` stays byte-frozen and
untouched. This was measured, not assumed.

### 5.2 The scratch-projects main/preload API

One root, computed in main from `dataDir` (or `app.getPath('userData')`), never supplied by the
renderer: `<dataDir>/LOL Studio Projects/`. Exposed as `window.lol.projects` with
`root · list · create · meta · rename · forget · listFiles · read · readBinary · write · writeBinary ·
remove · reveal · open` and nothing else. Every id is minted by `create` and matched against
`^[a-z0-9][a-z0-9-]{0,47}-[a-z0-9]{8}$`; every relative path is validated segment by segment (no
`..`, no absolute path, no drive letter, no backslash, no `:`/ADS, no trailing dot or space, no
Windows device name **including with an extension** — `CON.txt` is still `CON`; depth ≤ 4, joined
length ≤ 200), then re-checked with `path.resolve(...).startsWith(root + sep)`, then `lstat`-ed for
symlinks on every component. Text and binary extension allow-lists; 2 MB per text file, 8 MB per
binary, 200 MB and 512 files per project, 200 projects, 20 writes per second; atomic temp-and-rename
writes so a crash never truncates a sketch.

**Never:** `child_process`, any execution, deleting a directory, `shell.openExternal` of a local
path, or acting on a path that came out of a message body without an explicit user click.
`reveal`/`open` take a **project id**, land on the project *directory*, and are the only new Electron
surfaces (`shell.showItemInFolder`, `shell.openPath`).

**Honest security framing.** The renderer can already `fetch('file:///C:/Windows/win.ini')` today
(200, measured) — the shipped CSP allows it. So this API's value is not read secrecy; it is the
**write** boundary, the bounded root, and the absence of any execution primitive. The matching rule
is therefore mechanical, not a hope: **no chat module may pass a non-literal path to `fetch()`**, and
exactly one module may name `window.lol.projects`. Both are lint rules (§5.3).

**It ships as a separate, security-reviewed change set**, not by widening `chat-scope.js`. Different
audience, different tests (plain Node, no harness), and it is exactly the kind of code that must not
be approved as a side effect of reviewing a chat feature. S2 is blocked on that review — which is why
S2 is third, not first.

### 5.3 CSP edits

**None.** The only new CSP in this release is the runner's own `<meta>`, inside the sandbox. In
exchange `chat-lint.js` grows three rules, so that the safety story stops being decorative: apply
rules 1 (no `eval`/`new Function`/inline script), 2 (no `blob:`) and 8 to `**/*.html` in the chat
tree — today the lint never reads HTML at all, so a `runner.html` full of `eval` would ship silently;
exempt exactly one path, `sandbox/runner.html`, from rules 1 and 2; and byte-freeze the runner's CSP
string in the lint, the same technique `checkCsp` uses on `index.html`. The exemption is only safe
*because* the CSP cannot drift. Each new rule gets a self-test, as every existing rule has.

---

## 6. Prime directives — intact, checked one by one

- **Open WebUI untouched.** Zero OWUI source diffs, no CSS injection, no new env var, no admin API
  call. Studio lives entirely inside `#lolchat`, the other half of a toggle that already exists.
- **All data local.** Threads, maps, attachments and projects live in IndexedDB and under the
  projects root on this machine. Nothing new is uploaded; the only bytes that leave are the
  completion request itself, to the LAN farm, exactly as P0–P2 already send them.
- **Offline.** No CDN, no font fetch, no telemetry, no update ping, no library downloaded at runtime.
  The sandbox literally cannot reach the network.
- **Farm untouched.** No `farm/`, no `farm-app/`, no new endpoint, no config change. Studio consumes
  what the beacon already advertises and the OpenAI-compatible endpoint already serves.
- **No RAG.** No embeddings, no vector store, no chunking. The board pack is ~60 KB of JSON with a
  lexical selector and a hard token cap.
- **No new dependencies, no build step.** Vanilla ESM, dynamic `import()`, ComfyQ tokens,
  hand-written CSS. (Vendoring a library into the sandbox is an owner decision, §7-O1, and even then
  it is a file copied in, not a dependency.)
- **Seat etiquette.** One foreground generation, batches strictly serialised, nothing runs while the
  window is hidden, close means close.

---

## 7. Owner decisions needed

- **O1 — vendor three.js and/or p5.js?** Default: **no**; libraries come from the project's `lib/`
  folder, injected as text. three.js is MIT (~650 KB); p5.js is **LGPL-2.1** (~1 MB) and the owner
  did not ask for a licence obligation. The counter-argument deserves a hearing: this office writes
  p5, and a bench whose first run is a bare DOM canvas may only be opened once. If the answer is yes,
  the minimum is three.js, shipped unmodified with its licence file, overridable by a `lib/` copy.
- **O2 — "Open in VS Code"?** `shell.openPath` on the folder (Explorer) ships now. A real editor
  launch needs `vscode://file/<abs>` through a gate that is `^https?://` today. Recommendation:
  Explorer plus "Copy path" now; the `vscode://` allowlist as its own one-line, separately reviewed
  change. VS Code *is* installed on this box.
- **O3 — before S2's edit engine is written, measure it.** Fire 20 real schemas and 20
  SEARCH/REPLACE edits at a 300-line sketch against the live farm and publish the hit rate. If exact
  anchors land under ~80% on this reasoning model, the policy becomes whole-file rewrites under 200
  lines (which is most sketches) and V4 shrinks to a fallback. This is the one load-bearing number
  nobody has measured.
- **O4 — vision on the farm.** Half of the Design panel and all of the moodboard wait on an operator
  serving a vision model (the catalogue's `gemma4:12b`, or per-thread model choice). Until then they
  are not built. This is a farm/ops call the client cannot make and must not paper over.
- **O5 — the separate change set** for the projects API (recommended in §5.2) versus widening
  `chat-scope.js`. S2 cannot start until this is answered.
- **O6 — auto-apply and auto-fix defaults.** Both ship **off**. If the owner wants the full
  live-vibecoding feel by default, it should be a per-project default chosen at creation from the
  project kind, never a global switch.

---

## 8. Non-negotiables for builders

1. **One panel live at a time.** `hide()` suspends everything expensive; `destroy()` runs when the
   thread goes away. No panel keeps a timer, an rAF or a fetch alive while hidden.
2. **No new heartbeat.** The only clock is `EV.FARM_TICK` (~4 s) plus the browser's own events. A
   unit that wants polling uses the tick.
3. **Every farm call goes through the governor.** `app.ask` acquires like a send does; a batch is a
   visible, cancellable, strictly serial queue; nothing runs while `#lolchat` is hidden; a busy
   governor returns `{ok:false, kind:'busy'}` and **every panel renders that state** — no dead ends.
4. **The model chooses, the code computes.** Contrast, quantisation, layout geometry, pin tables,
   slugs, file paths and edit application are our code. If a unit asks the model for arithmetic or
   consistency, the unit is wrong.
5. **A structured ask always has a fallback.** `response_format` → prompt-and-parse → raw text with a
   Retry. Never a silent empty result. `max_tokens ≥ 4× the expected JSON, floor 512` — this farm is
   a reasoning model and spent 75 of 100 completion tokens thinking about a two-field answer.
6. **Model output is data — never code we run, never a path we open.** Ids the model invents are
   dropped, not created. SVG is sanitised before it renders. A path from a message body needs an
   explicit user click. No `fetch()` of a non-literal path, ever.
7. **Anchored edits apply exactly or visibly refuse.** A near-miss is "couldn't apply — here is the
   full rewrite", never a silent corruption of a file the user liked.
8. **Region ownership holds.** `els.work` has exactly one owner. No unit `replaceChildren()`s a
   region it does not own, and no unit edits `main.mjs`, `layout.mjs` or the mock farm — those are
   contract requests to the integrator.
9. **Keyboard and screen reader on every surface.** The map ships its `role=tree` mirror in the same
   landing as the canvas, not after. Escape keeps meaning stop-then-close.
10. **ComfyQ tokens only.** No colour literals anywhere, including the component sheet and the
    sandbox's own chrome. One i18n namespace per unit, literal keys.
11. **Nothing survives the window closing.** No tray, no daemon, no background work after the X.

---

## 9. The regression bar

Everything P0–P2 shipped keeps working, unchanged, with the workbench closed **and** open:

- **Gates green at every landing:** `chat-unit.js` (462 baseline + the new pure suites, 0 failures),
  `chat-lint.js` (0 over the tree, now including HTML, with self-tests for the new rules),
  `chat-scope.js` (clean — and `checkCsp` byte-identical), `chat-harness/run.js --strict` (100/0 plus
  the new scenarios), `--strict --phase perf` (6/0 plus the new rows).
- **Render throughput.** The streaming markdown renderer stays far above the 150 tok/s floor — the
  perf group measures 1,260–1,813 render tok/s today, and **no perf row may regress by more than 15%**
  against the recorded baseline. A landing that slows the chat to make a panel nicer is rejected.
- **Parity behaviours, explicitly retested:** branching (`◀ 2/3 ▶`, edit-user, regenerate, fork,
  delete-subtree — the map must never become the only way to reach a sibling); seat-wait rows and
  their resend/schedule/wait/giveup decisions; the budget meter, its cost gate and `.chat-outside`
  dimming; store-mode degradation (`idb → memory → memory-final`) and the late-attach journal replay;
  export/import round-trip; interrupted-stream recovery; the sidebar's search, menus and ephemeral
  threads.
- **Seat etiquette, tested not asserted:** a harness scenario asserts that a hidden window starts no
  generation, that a batch never has two requests in flight, and that a seats-full 429 still becomes
  a waiting row that holds the governor.
- **Data safety:** no new store door accepts `'streaming'`/`'waiting'` from outside; every captured
  message is re-read before it is written; bulk operations still filter `ephemeral`; the projects API
  has its own pure Node suite covering every Windows device name, `CON.txt`, ADS, and a symlinked
  path component.
- **The hang test is a gate, not a note:** `s2-sandbox-hang` asserts the host stays responsive through
  a guest `while(true)`. If that scenario ever goes red, the Preview panel does not ship.

---

## 10. How this fails

Three ways, all avoidable:

1. **Four half-panels.** Each direction has a 200-line version that is useless (a map you cannot
   keyboard-navigate, a preview that freezes the app, a palette with no contrast check, a board pack
   copied off a forum) and a 1,200-line version that is the reason someone opens LOL instead of Open
   WebUI. Ship one panel completely before starting the next: a release stopped after S2 is a
   success, a release with four 60% panels is not.
2. **Curation debt pretending to be a feature.** A wrong strapping-pin note is worse than no note.
   Three boards, checked against datasheets, and anything unverified marked unverified in the UI.
3. **Antisocial defaults.** Ten people, two slots. Auto-fix off, auto-apply off, batches serial and
   visible, the seat ledger in the strip from S0 onward. The first time someone's render stalls
   because a colleague's sketch is quietly repairing itself, the tool is finished.

---

## 11. The measured facts this rests on

All measured on this box, 2026-09-15 (probes re-runnable; detail in `LOLCHAT_STUDIO_PLAN.md` §2):

- Sandboxed-iframe host stall during a 1,500 ms guest busy loop: **12 ms** (vs **1,501 ms**
  same-origin). Inside it, `eval`, `new Function`, inline script, WebGL2 and blob Workers all work;
  network, disk and storage are all blocked.
- `will-frame-navigate` fires on subframes and `preventDefault()` vetoes them; the guest survives.
- `response_format: {type:'json_schema', strict:true}` **survives LiteLLM's `drop_params:true` and is
  enforced**, streaming and non-streaming — while `supported_openai_params` reports `[]`, so that
  field must never gate a feature.
- The live farm serves **`nemotron-3.5-lightning:30b`**, 2 slots, `contextPerSlot 1048576`, and
  reports **`supports_vision:false`**. It is a reasoning model: 75 of 100 completion tokens went to
  reasoning on a two-field answer.
- The renderer can already `fetch('file:///…')` → 200. IndexedDB quota 412.8 GB; a 20 MB Blob
  round-trips in 18 ms / 0 ms. `OffscreenCanvas`, `createImageBitmap`, `crypto.subtle`, `ctx.filter`
  and `ResizeObserver` are all present. VS Code is installed.
- p5.js is **LGPL-2.1** (~1 MB); three.js is MIT (~650 KB).

---

## 12. Where this overrules the engineering plan

`LOLCHAT_STUDIO_PLAN.md` stays the engineering companion — its sandbox measurements, `app/ask.mjs`
design, path validation, protocol and verification matrix are adopted whole. Six deltas:

1. The workbench is **three widths** (Chat / Split / Work), not a dock that always leaves the
   conversation the larger half. Map and Design open in Work; Preview and Board open in Split.
2. The map renders as **DOM nodes with one layout** (tidy tree), not a `<canvas>` with a spatial
   index, LOD, a metrics cache and four algorithms.
3. **The seat ledger (R4) is in S0**, as a precondition for any batch feature — it was absent.
4. **The deterministic pin linter (B3) is in the release** — the plan injected the board pack and
   then never checked the model's output against it.
5. **Vary (V6) ships**: one serialised, visible, cancellable batch of four. The plan's "one
   generation at a time" is restated as *one at a time, serialised* — the invariant is serialisation,
   not singularity.
6. Direction C ships **only its non-vision half** (D1–D5); the board pack ships **3 boards, not 8**;
   the SVG studio's click-to-select editing waits for V4's measured hit rate.
