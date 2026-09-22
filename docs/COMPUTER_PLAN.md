# The Computer, standalone: build plan

> Status: **executable plan, revision 2** (critic's pass applied — see §15 Revision notes).
> Date: 2026-09-22. Branch: `lolchat/vnext` at `a474b2c`.
> Owner's brief (2026-09-22, verbatim in §0.1). Reference images: [COMPUTER_REFERENCE_CAPTURE.md](COMPUTER_REFERENCE_CAPTURE.md).
> Build workflow, gates, harness and conventions: [LOLCHAT_PLAN.md](LOLCHAT_PLAN.md) §0.2, §1, §2, §2.6, §4 — **they apply here unchanged**,
> and this document is an extension of that plan's §2.6 frozen-contract discipline, not a replacement.
> What exists today and must be reused: [LOLCHAT_COMPUTER_SPEC.md](LOLCHAT_COMPUTER_SPEC.md) and §2.6 BG/BH/BI/BJ/BK.
>
> **Read §0.3 before writing any code. It is the list of things that are true in the tree right now
> and that three separate studies each got partly wrong.**

---

## 0. Read first

### 0.1 The brief

> *"The Computer is not a chat, I think it's a thing on its own. We want it as an autonomous tool like
> the owui interface and the lolchat interface. I think it's great. but I want it to be closer to
> tl;draw computer. It does not need to communicate with the chat. We should be able to do things like
> in the attached picture: we have text boxes were the user can take notes in md; we should create links
> from one to another using a keyword or a few keywords for the model to infer the relation between
> both; instruction boxes to actually call the llm to action that feeds the response in a new box. We
> should be able to import images to analyse them with a vision model, write html,css,js, threejs, p5js
> code, generate svgs and visualize those in specific boxes. We will not generate images, audio, speech
> or video just yet… I would also like you to build an interactive tutorial to follow directly in app
> for users… we will build something great for people to learn about agents, help them visualise them
> and even probably build some production workflows with it."*

Binding decisions taken from that brief and from the owner's follow-ups, restated so a builder never has
to re-derive them:

| # | Decision |
|---|---|
| B1 | The Computer is a **third top-level surface**, beside Open WebUI and LOL Chat. It has its own library of graph documents. The per-thread Computer panel is **removed**; existing per-thread graphs migrate into the library. |
| B2 | It does **not** talk to the chat. `from-thread` / `to-thread` become legacy: loadable, not in the palette. |
| B3 | **Arrow labels are named parameters.** A label on a wire is the name the instruction refers to in its prose. This is the headline feature. |
| B4 | Parts in this build: markdown **Note** · **Instruction** (the LLM call, vision included) · **Image** · **Preview** (markdown/svg/html/three/p5) · **Code** · and the control flow the owner picked: **Button · Condition · Confirm · Dialog · Toggle · Timer**. Range and the rest are later. |
| B5 | **No image/audio/speech/video generation.** Possibly via ComfyQ later. |
| B6 | Running is **both**: per-box ▶ (push, tldraw-style, run this and everything downstream) **and** Run-all (pull, the dirty closure). One Stop. |
| B7 | The look is **warmed-up ComfyQ**: the shell's tokens, radii and dark/light, but bigger rounded boxes, chunky visible ports, coloured sticky notes, generous spacing. Not tldraw's hand-drawn identity. |
| B8 | An **interactive in-app tutorial**: numbered lessons the user follows inside the app, on the canvas. |

### 0.2 Prime directives (a plan that breaks one is wrong)

1. **Local only.** Every model call goes to the farm on the LAN through `app/ask.mjs`. No cloud API, no
   CDN, no online fallback. A feature that needs one is cut, not degraded.
2. **All data stays on the machine** — IndexedDB (`lol-chat`) and the scoped scratch-projects folder.
   No server, no account, nothing leaves except a completion body to the farm.
3. **Open WebUI is untouched.** `farm/`, `farm-app/`, `sidecar/` are untouched. This is client work.
4. **No new npm dependencies, no renderer build step** (vanilla ES modules), **CSP-safe** (the renderer
   CSP meta stays byte-identical, and the sandbox's `RUNNER_CSP` stays byte-identical).
5. **Farm etiquette.** One foreground request at a time; graph runs at background priority; a visible
   generation cap; seat-aware waiting. **A canvas that can loop must not be able to hammer a shared GPU.**
6. Everything in LOLCHAT_PLAN §1.2 (safety) still holds: model text never becomes HTML, no `eval`, no
   `blob:`, no `fetch` outside the five allowed modules, no `/embeddings`, no `num_ctx`.

### 0.3 Facts verified in the tree on 2026-09-22 (builders: these override the studies)

| Fact | Where |
|---|---|
| `GraphWire` is `{id, from, to, port}`. **There is no `label` field.** | `core/types.mjs:266` |
| `normalisePart` **strips a value to `{kind, data}`** — `const value = isValue(raw.value) ? {kind, data} : null`. A `format`/`lang` facet that is not added here is lost on every reload. | `graph/model.mjs` (in `normalisePart`) |
| `normalisePart` already maps `running`/`queued` → `stale` on load (`model.mjs:146`). `waiting` must be added to that line, not only to `STATES` (`model.mjs:27`). | `graph/model.mjs:27,146` |
| `graph/store.mjs` `write()` and `put()` both **return early when `!doc.threadId`** — a library document silently persists nothing. | `graph/store.mjs` |
| `repo.deleteThread` cascades: it deletes every `graphs` row indexed to that thread. A migrated graph that keeps its `threadId` dies with its chat. | `state/repo.mjs:320-326` |
| `repo.listGraphs()` **with no argument already does `getAll('graphs')`** — a library listing needs no repo change. `putGraph` routes ephemeral by `isEph(doc.threadId)`, and `isEph(null) === false`, so a threadless graph persists correctly once the store stops refusing it. | `state/repo.mjs:147,510,517` |
| `GraphDoc` already carries `title` and `serialize.mjs` already exports it. Nothing writes it today. | `graph/model.mjs` `createDoc` |
| `core/app.mjs` `createApp({root, els})` is surface-agnostic; `state.visible = !root.classList.contains('hidden')`. | `core/app.mjs` |
| `app/ask.mjs` `once()` refuses with `busy` when `!(app.state.visible && app.state.pageVisible)`. **If a third root hides `#lolchat`, every Computer model call fails.** | `app/ask.mjs` (`ask.hidden`) |
| `net/governor.mjs` `freeSeat()` returns **false when the farm advertises no seats**, and `canStart('background')` therefore refuses. On a farm with no seat gate the Computer could never run. | `net/governor.mjs` |
| `BACKGROUND_LIMIT = 1`: one background acquisition in flight, ever. A foreground Send aborts every background call. | `net/governor.mjs` |
| `graph/parts/index.mjs` `partSpecs()` is the only place part types are named; 11 parts today. | `graph/parts/index.mjs` |
| `graph/topo.mjs` `wouldCycle` is used by `model.mjs:wireRefusal` to **refuse** any cycle. `order()` is Kahn, stable on document order. | `graph/topo.mjs`, `graph/model.mjs` |
| `runner.mjs` walks a **frozen `ids` array**, forces `priority:'background'`, counts the cap inside the ask wrapper, and returns an in-memory `report`. **Nothing persists a run journal.** | `graph/runner.mjs` |
| `inspect.mjs` renders into the chat column (`app.els.main`, before `els.form`). The standalone surface has no composer. Its pure `bodyText`/`headingText` are reusable; its host is not. | `graph/inspect.mjs` |
| `css/graph.css` is 708 lines, **106 selectors prefixed `#lolchat `**. `css/sandbox.css` has **0**. `css/base.css` has three rules that the `#lolchat ` (trailing space) rewrite would **miss**: `:19` `#lolchat, .chat-layer {--chat-panel…}`, `:20` `:root.light #lolchat, :root.light .chat-layer`, and `:37` `#lolchat.hidden, #lolchat .hidden, .chat-layer.hidden, .chat-layer .hidden {display:none!important}`. Missing `:37` means **nothing in the Computer tree would honour `.hidden` at all**. `base.css:6-12` documents the `.chat-layer` escape hatch, which is the intended fix. | `css/{graph,sandbox,base}.css` |
| `session.thread()` has **seven callers outside `panel.mjs`**: `runner.mjs:371` (`thread:` into every `spec.run()`) and `canvas.mjs:529` (copy), `:629` (paste), `:689` (export), `:733` (import), `:1004` (toolbar). Deleting it without touching those files makes **every part run throw** and export/import return early. | `graph/{runner,canvas}.mjs` |
| `renderSidecar()` toggles `els.overlay` and `els.webview` independently of any view state (`app.js:569-570,609,636-643,653-654`). `#overlay` is an absolutely-positioned sibling of `#lolchat` inside `.main`. A surface switch that touches only the webview lets the OWUI overlay sit on top of the Computer, and the next `renderSidecar()` un-hides the webview over it. | `renderer/app.js`, `renderer/index.html` |
| `net/farm.mjs` emits `FARM_CHANGE`/`FARM_TICK` on **the bus of the app it was constructed with** only. `app/caps.mjs` listens to `EV.FARM_CHANGE` on *its* app's bus and calls `app.farm.setCapResolver(...)` — installing `caps` on two apps overwrites one resolver with the other and doubles the `/model_group/info` GET. `app/ask.mjs` reads vision through `app.farm.cap(underlying,'vision')`, i.e. through the **shared farm's** resolver, so **one** caps install serves both surfaces. | `net/farm.mjs`, `app/caps.mjs`, `app/ask.mjs` |
| `window.__lolChatRefresh` exists solely to call `app.farm.update(window.__lolFarm)` (`chat/main.mjs`). With `farm` shared there is nothing a second hook could usefully do, and calling `update()` twice per publish emits two `FARM_TICK`s. | `chat/main.mjs` |
| `runner.mjs`'s `meteredAsk` forces `cache:true` and treats a cached answer as **free** (no generation, no cap). Without a per-iteration salt, a loop whose inputs have not changed returns the identical string for free, forever — `maxGenerations` never fires. `cacheSalt` already exists on the ask spine (the fan-out uses it). | `graph/runner.mjs`, `app/ask.mjs` |
| `gather()` returns `{error: errNoInput}` the instant an upstream part's `value` is not a value (`runner.mjs:141,146`). A ▶ pressed on a box whose ancestors have never run therefore **fails**, which is the commonest state of a fresh template, a forked lesson, or a reloaded graph. | `graph/runner.mjs` |
| `serialize.mjs:139` refuses a newer file outright: `if (version > FORMAT_VERSION) return {ok:false, errors:['unsupported-version']}`. Turning that into import-with-warning would be exactly the quiet field-loss this plan bans elsewhere. `serialize.mjs` also already supports `{values:false}` (it deletes `next.value`) — the "include results" door exists. | `graph/serialize.mjs` |
| `core/ids.mjs` exports `hash(str)` — FNV-1a 32-bit → 8 hex chars. The migration uses **that**, not a new one. | `core/ids.mjs` |
| `ctx/budget.mjs` exports `DEFAULT_BUDGET = 32768` and `DEFAULT_RESERVE = 4096` and already falls back to them when `caps.backend.contextPerSlot` is missing. §5.4 uses that function, not its own arithmetic. | `ctx/budget.mjs` |
| `tokens.css` makes `--blue` **identical to `--accent` and to a grey** in both themes (`#71717a` dark, `#52525b` light). A five-hue kind palette built on `--blue` collapses to grey. Only `--green`, `--amber`, `--danger` are real hues. | `renderer/tokens.css` |
| `chat-harness/page.html` has **no topbar, no `.viewseg`, no `<webview>`**, and never loads `app.js` — only a `publishFarm` slice via `generated/app-bridge.js`. Nothing about the segmented control, `aria-pressed`, the webview's survival or `localStorage['lol:view']` is harness-testable. | `chat-harness/{page.html,extract-app-bridge.js}` |
| `h.graph.*` appears **~470 times across 15 scenario files** (c1-canvas 56 · c1-run 37 · c1-shots 11 · c1-landing 5 · c2-bridges 34 · c2-canvas 22 · c2-fanout 40 · c2-fanout-parts 70 · c2-shots 17 · c3-canvas 56 · c3-landing 27 · c3-parts 61 · c3-shots 14 · examples 13 · perf-graph). `perf-graph.mjs:315,353,389` call `h.work('computer')`. `c2-bridges.mjs` exists **only** to prove From thread / To thread / `installCodeBridge`. `chat/unit/graph-store.test.mjs` tests a file this plan deletes. | `shell/test/**` |
| `chat-lint.js` rule 12: only `sandbox/host.mjs` may create an iframe. Rule 13: only `sandbox/host.mjs` may `setInterval`. Rule 3: **no colour literals in CSS** (`#`, `rgb(`, `hsl(`, named colours). | `shell/test/chat-lint.js` |
| `sandbox/protocol.mjs` `RUN_KINDS` already contains `'svg'`; `render.mjs` renders SVG **without the sandbox** (sanitised markup). | `sandbox/protocol.mjs`, `graph/parts/render.mjs` |
| `chat-scope.js` `checkPublishFarm` forbids any `app.js` hunk outside `function publishFarm`. The three-way toggle lives outside it. | `shell/test/chat-scope.js` |
| `chat-harness/extract-app-bridge.js:23` anchors on the literal comment `// OWUI is the primary surface`. Moving or rewording that line **breaks every harness run**. | `shell/test/chat-harness/extract-app-bridge.js` |
| `chat-harness/page.html` hardcodes `<section id="lolchat">` and loads only `chat/main.mjs`. | `shell/test/chat-harness/page.html` |
| Baseline at `a474b2c`: `chat-unit` 931 passed · `unit.js` 5 · `chat-lint` 0 over 133 files · `chat-scope` clean · harness `--strict` 197 · perf 9. | §2.6 BK-9 + the C4 door commit |

### 0.4 How this plan is organised

- **Five phases, K1 → K5.** Every phase ends with something the owner can open and use.
  - **K1–K3 are the must-have core.** K1 gives the surface and the library; K2 gives arrow labels and
    the Instruction, which is the owner's own research graph; K3 gives push-play and control flow,
    which is what makes it an agent canvas.
  - **K4–K5 are the "if the night goes well" tail.** K4 is images/vision, preview boxes and the look
    pass; K5 is the tutorial, the templates and the first-run panel.
  - **If we stop after K2 we still have a real product**: a standalone canvas with a library, notes,
    labelled arrows, instructions that bind them, code and preview parts, export/import, and Run-all.
- **≤ 3 units per phase.** Units run in parallel on disjoint files. A unit may read anything; it writes
  only its own files.
- **One integrator per phase**, doing a kickoff (contracts, loader/catalogue rows, mock, harness wiring)
  and a landing (shared-file wiring + the gates + a DEVLOG entry + screenshots).
- **Integrator-only files** (units NEVER edit them): `chat/main.mjs`, `chat/computer/main.mjs`,
  `chat/chat.css`, `chat/computer/computer.css`, `chat/core/**`, `chat/graph/parts/index.mjs`,
  `renderer/index.html`, `renderer/styles.css`, `renderer/app.js`, `shell/test/mock/**`,
  `shell/test/chat-harness/{page.html,run.js,helpers.js,extract-app-bridge.js}`, `docs/DEVLOG.md`.
- **"Done" for a unit** is the LOLCHAT_PLAN §0.2 definition, unchanged:
  `chat-unit.js <area>` · `chat-lint.js` · `chat-scope.js` · `chat-harness/run.js --only <its scenarios>`.
- **Slots.** Parallel builders share this box: `--slot <n>` on `run.js` and `mock-farm.js` (§2.6 A).

### 0.5 Where the three studies disagreed, and what we decided

| Question | Dataflow expert | Teaching designer | Scout | **Decision** |
|---|---|---|---|---|
| New tree location | — | `shell/renderer/computer/**` | `shell/renderer/chat/computer/**` | **`shell/renderer/chat/computer/**`.** A sibling of `graph/`, already inside the scope allowlist and already linted. No scope-gate row, no new lint config, relative imports stay short. The directory name is not user-visible; a later rename is a pure move. |
| The run journal's home | a new `runs` object store | — | "net-new, nothing persists a report" | **`kv`, one row per graph (`computer:runs:<graphId>`), last 5 runs, 200-event ring.** A DB version bump on the owner's live database during a one-night build is the wrong risk. A `runs` store is a clean later upgrade. |
| Live previews | — | — | snapshot + one live box (option 1) vs N iframes | **Snapshot + "Open live" (option 1).** Rule 12 stands, one guest process stands, the 500-part perf gate stands. SVG and markdown are live for free (no iframe). |
| The seat/etiquette lane | background, one at a time | — | "background is fatal on farms with no seats" | **Background, with one governor amendment (§3.5):** when the farm advertises **no** seats and the foreground is idle, allow the single background slot. Strictly politer than foreground, and bounded by `BACKGROUND_LIMIT = 1`. |
| Image bytes | — | — | "attachments store vs inline: a design decision" | **Inline in `part.settings`, downscaled to ≤ 1536 px JPEG q0.85, hard-capped at `MAX_VALUE_BYTES` (1 MB).** One file, no new store, export works. The attachments store is the later optimisation and is written down as such. |
| Lesson count | — | 12, split 1–7 / 8–12 | — | **12, shipped as two shelves** ("the basics" 1–7, "going further" 8–12), 1–3 marked *start here*. Answers the teaching designer's open question 1. |
| Tutorial in the topbar | — | "no third toggle state" | — | **Confirmed:** lessons are entries in the Computer's own library sidebar plus a `?` in its toolbar. |
| Demo answers | — | recorded answers + an honesty badge | — | **Confirmed**, with the badge `demo answer — not generated`, persisted and exported. Answers open question 2. |
| Lesson 11 (yielding) | — | needs a live chat | — | **They leave to LOL Chat and come back.** Progress is in `kv`; the surface toggle is one click. Answers open question 4. |

---

## 1. Global rules for this build

Everything in LOLCHAT_PLAN §1 applies. What is added or sharpened:

### 1.1 Scope

**Allowed** (the LOLCHAT_PLAN §1.1 list, unchanged, plus two widenings that the integrator makes at the
K1 kickoff and that are called out loudly here because they are scope-gate changes):

- `shell/renderer/chat/**` (the Computer tree lives here) — already allowed.
- `shell/renderer/index.html` — a third `<section id="lolcomputer">`, a third `<script type="module">`,
  and the topbar segmented control. **The CSP meta stays byte-identical.**
- `shell/renderer/styles.css` — the `.viewseg` segmented control **and the `body[data-view]` overrides
  that keep the OWUI overlay and webview out of the Computer's way** (§2.2a). This is the file that lets
  us leave `renderSidecar()` alone.
- `shell/renderer/app.js` — **SCOPE-GATE CHANGE (the only one).** `chat-scope.js` `checkPublishFarm`
  today forbids every hunk outside `function publishFarm`. The three-way surface switch lives in the
  toggle IIFE below it. The K1 integrator adds a **second allowed span** to `chat-scope.js`: the region
  from the literal line `// OWUI is the primary surface; the topbar toggle switches the main area to LOL`
  to end of file. Nothing else about the gate changes, and `--self-test` grows a case that an `app.js`
  hunk *above* `publishFarm` is still flagged.
  **`publishFarm` itself is NOT edited** (revision 2): there is no `__lolComputerRefresh`, because the
  `farm` object is shared and a second refresh hook would only double every `FARM_TICK` (§0.3, §2.5).
  **`renderSidecar` is NOT edited either** — the overlay problem is solved in CSS, so no third span is
  needed.
- `shell/test/**` — **a landmine, not a licence.**
  `chat-harness/extract-app-bridge.js` slices `publishFarm` out of the real `app.js` between literal
  anchors, and its `publishEnd` anchor is the comment `// OWUI is the primary surface`. That comment
  line **must survive byte-identical as the first line of the rewritten IIFE**, or every harness run
  throws. The K1 integrator changes `app.js` and re-reads `extract-app-bridge.js` in the same edit.
- `docs/**`.

**Forbidden, unchanged:** `shell/src/**`, `farm/**`, `farm-app/**`, `sidecar/**`, `.github/**`,
`CLAUDE.md`, `package.json`, the CSP meta, `shell/test/e2e.js` (byte-identical),
`shell/renderer/tokens.css`. **Surface persistence therefore does NOT go in `shell/src/main/store.ts`** —
it is `localStorage['lol:view']`, written from the toggle in `app.js`.

### 1.2 File conventions (additions)

- The Computer tree is `shell/renderer/chat/computer/<name>.mjs`, `// @ts-check` on line 1.
- Strings: `shell/renderer/chat/strings/computer.en.mjs` (the surface, library, drawer, errors),
  `strings/parts.en.mjs` grows the new parts (integrator-owned at each kickoff so two units never
  contend), `strings/lessons.en.mjs` (K5).
- CSS: `shell/renderer/chat/css/computer.css` is the Computer's own sheet, imported by a new
  `chat/computer/computer.css` entry sheet — **the Computer surface does not load `chat.css`**, because
  the chat's composer/thread/sidebar rules are dead weight there. `css/graph.css` and `css/sandbox.css`
  and `css/base.css` are shared and get re-scoped (§3.2).
- Class prefix stays `.graph-` for canvas internals (708 lines of it exist) and `.comp-` for everything
  new on the surface (`.comp-library`, `.comp-rail`, `.comp-drawer`, `.comp-runbar`).
- **No colour literals** (lint rule 3). Every new hue is a `color-mix()` of an existing token (§7).
- **No `setInterval`** outside `sandbox/host.mjs` (lint rule 13). The **Timer part therefore uses
  `setTimeout`**, one shot per tick, cancelled by Stop. Written down because "Timer" invites the wrong
  primitive.
- **No new iframe** (lint rule 12). §5 is the preview contract that makes that possible.

### 1.3 The five sentences a reviewer must be able to check at the end

1. **Push is pull with a forced-dirty seed** — one scheduler, one staleness, one loop.
2. **`bar` separates activation from value** — which is what makes the Toggle both a stop and a window.
3. **An ungated loop cannot be drawn**, and four independent ceilings bound every loop that can.
4. **No wired input is ever silently dropped** — not an unused label, not an empty value, not an
   over-budget input, not a duplicate label.
5. **Anything the farm was paid for is flushed before the next part starts.**

---

## 2. Surface plumbing — the third view

### 2.1 `index.html`

```html
<!-- topbar-right, replacing <button class="viewtoggle" id="view-toggle"> -->
<div class="viewseg" id="view-seg" role="group" aria-label="Surface">
  <button class="viewseg-btn" id="view-owui"     data-view="owui"     aria-pressed="true">Open WebUI</button>
  <button class="viewseg-btn" id="view-chat"     data-view="chat"     aria-pressed="false">LOL Chat</button>
  <button class="viewseg-btn" id="view-computer" data-view="computer" aria-pressed="false">Computer</button>
</div>
```

```html
<!-- inside .main, after #lolchat -->
<section id="lolcomputer" class="chat-layer hidden">
  <p class="chat-fallback">The Computer failed to load — see the developer console.</p>
</section>
...
<script type="module" src="chat/computer/main.mjs"></script>
```

**`class="chat-layer"` is load-bearing, not decoration.** `css/base.css:6-12` documents it as the escape
hatch for markup that lives outside `#lolchat`, and `base.css:19,20,37` already carry `.chat-layer` next
to `#lolchat` for the panel/bubble tokens, the light-theme override, and — critically —
`.chat-layer .hidden { display:none !important }`. Without it, nothing in the Computer tree honours
`.hidden` (§0.3). This is why the CSS re-scope of §3.2 touches **`graph.css` only**.

`styles.css` gains `.viewseg` / `.viewseg-btn` (ghost buttons on `--surface-2`, the pressed one on
`--accent`) and `#lolcomputer { display:flex; flex:1; min-width:0 }` / `#lolcomputer.hidden { display:none !important }`.

### 2.2 `app.js` — the switch (inside the second allowed span)

```js
// OWUI is the primary surface; the topbar toggle switches the main area to LOL     <-- ANCHOR, byte-identical
// Chat or the Computer and back. The webview keeps running while hidden, so
// switching back is instant and never re-authenticates.
(() => {
  const VIEWS = ['owui', 'chat', 'computer'];
  const chat = $('lolchat');
  const computer = $('lolcomputer');
  if (!chat || !computer) return;            // KEEP the guard: everything below, setInterval included,
  let view = 'owui';                         // dies with this IIFE if it throws (rev-2 fix).
  function show(next) {
    if (!VIEWS.includes(next)) next = 'owui';
    if (NO_OWUI && next === 'owui') next = 'chat';
    view = next;
    chat.classList.toggle('hidden', view !== 'chat');
    computer.classList.toggle('hidden', view !== 'computer');
    if (els.webview) els.webview.classList.toggle('hidden', view !== 'owui');
    document.body.dataset.view = view;       // §2.2a: CSS keeps #overlay/#owui out of the way
    for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    try { localStorage.setItem('lol:view', view); } catch (e) {}
    publishFarm();
  }
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => show(b.dataset.view));
  let saved = null; try { saved = localStorage.getItem('lol:view'); } catch (e) {}
  show(saved || (NO_OWUI ? 'chat' : 'owui'));
  setInterval(publishFarm, 4000);
})();
```

Rules frozen here:
- **The OWUI webview is never destroyed**, only hidden. Its boot is ~10 s.
- **The null guard is kept.** `app.js:886-888` has one today; dropping it would let a missing
  `#lolcomputer` throw here and take `setInterval(publishFarm, 4000)` — i.e. all farm republishing —
  down with it, silently.
- **`publishFarm()` is not edited.** `farm` is one shared object; `window.__lolChatRefresh` already
  updates it, and a second hook would emit a duplicate `FARM_TICK` on every publish (§0.3, §2.5).
- `NO_OWUI` builds hide the `view-owui` segment with `hidden` and start on `chat`.
- The surface choice **persists** — `localStorage['lol:view']`. A relaunch lands where you left.

### 2.2a The OWUI overlay, and why this is a CSS fix

`renderSidecar()` owns `#overlay` and `els.webview` and knows nothing about views. Switch to the Computer
during OWUI's ~10 s boot and *"Starting Open WebUI…"* covers the canvas; the next `renderSidecar()` then
does `els.webview.classList.remove('hidden')` **on top of** `#lolcomputer`. Today's two-way toggle has the
same latent bug; a third surface makes it certain, and it lands exactly at launch.

`renderSidecar` sits outside both allowed `app.js` spans, so editing it would cost a third scope-gate
span. It does not have to be edited. `show()` stamps `document.body.dataset.view`, and `styles.css`
(in scope, no gate) carries the two overrides:

```css
body[data-view="chat"]     #overlay, body[data-view="computer"] #overlay,
body[data-view="chat"]     #owui,    body[data-view="computer"] #owui    { display: none !important; }
```

`renderSidecar` keeps toggling its own classes; on `owui` nothing overrides it and it behaves exactly as
today. One declaration, no new gate span, and the bug is fixed for LOL Chat too.

### 2.3 Two apps, one spine — and why

`core/app.mjs` `createApp({root, els})` is surface-agnostic. The Computer builds its **own** `App` whose
`root` is `#lolcomputer`. That is not a nicety: `app/ask.mjs` refuses with `busy` when
`app.state.visible` is false, and `state.visible` is derived from the root's `hidden` class. One shared
app would make **every Computer model call fail the moment the chat is hidden** — which it always is.

The two apps **share** exactly three instances, constructed once in `chat/computer/boot.mjs`:

| Shared | Why |
|---|---|
| `repo` | one IndexedDB connection to `lol-chat`. Two would fight the journal and the migration. |
| `farm` | one snapshot model, one `__lolFarm` bridge, one capability cache. |
| `gov` | **mandatory.** Two governors each allow one background call → two in flight → the seat etiquette collapses. |

Each surface has its **own** `bus`, `registry`, `root`, `els`, `dialogs`, and its own `ask` install (so
`ask` reads *its* app's `state.visible`, and each surface has its own ask cache).

**The bus mirror (revision 2 — three events, not one).** `net/farm.mjs` emits on the bus of the app it
was constructed with, and `net/governor.mjs` likewise. `boot.mjs` mirrors **`GOV_CHANGE`, `FARM_CHANGE`
and `FARM_TICK`** onto whichever bus did not construct them. Mirroring only `GOV_CHANGE` would leave the
Computer's farm chip, its plan preview and (via `caps`) its vision verdict frozen at boot — and §6.3's
`errNoVision` hard error is built on exactly that verdict.

**`caps` is installed exactly once (revision 2).** `app/caps.mjs` calls `app.farm.setCapResolver(...)`
on the **shared** farm, so a second install overwrites the first's resolver and doubles the
`/model_group/info` GET. `app/ask.mjs` reads vision through `app.farm.cap(underlying,'vision')` — the
shared farm's resolver — so one install serves both surfaces. The `caps` row therefore leaves the
Computer's loader table (§3.3); `boot.mjs` installs it against the shared spine and refuses a second
install, so a Computer that boots without the chat still gets capability probing.

**Load order.** `chat/main.mjs` runs first (it is the earlier `<script type="module">`). `boot.mjs`
exposes `window.__lolSpine` as a promise resolving to `{repo, farm, gov, mirror}`; `computer/main.mjs`
awaits it. If the chat failed entirely, `boot.mjs` constructs the spine itself from the same factories —
the Computer must not die because the chat did.

**The `visible` rule, frozen (revision 2 — narrowed):**

> The Computer's `app.state.visible` is true while `#lolcomputer` is shown **or an activation of a run it
> started is currently executing**. It is **false while a run is merely suspended** on a Confirm, a
> Dialog or a Timer. `computer/main.mjs` owns that one line; `runner.executing()` (not `running()`) is
> the predicate.

Rationale: a run the human deliberately started, bounded by four ceilings, keeps its seat while they look
at something else in the same window — but a Dialog nobody answers must not hold `visible` open
indefinitely, because that is the exact condition `app/ask.mjs`'s hidden-means-idle rule exists to
enforce. A park resolves by clicking the part, which requires the surface to be shown anyway, so the
narrower rule costs nothing. **Parked time counts against `maxWallMs`** (§4.6), and a run whose parks
outlive it ends with *"nobody answered — the run stopped after 10 minutes"*.
`pageVisible` (a minimised window) still gates everything, unchanged.

### 2.4 `window.LolComputer`

Mirrors `window.LolChat`: `{ready, version, app, failed, fakes, migration, debug}`, with
`debug.computer` carrying the **same frozen key list** as `API_KEYS.graphDebug` plus the K1–K5
additions (§8.2). The harness drives the Computer through it.

---

## 3. Module layout and what moves

### 3.1 The tree

```
shell/renderer/chat/
  graph/          ← STAYS, shared engine. Grows bind.mjs, journal.mjs and the new parts.
  sandbox/        ← STAYS, shared verbatim. No change at all.
  core/ net/ app/ render/ state/ ui/dialogs.mjs projects/  ← STAYS, shared.
  computer/
    main.mjs      integrator-owned entry: mounts #lolcomputer, builds the app, loads the table
    boot.mjs      the shared spine (repo/farm/gov) + the bus mirror
    layout.mjs    the Computer skeleton DOM → its own `els`
    host.mjs      session + runner + canvas wiring (what graph/panel.mjs `create()` did)
    docstore.mjs  library-scoped graph persistence (replaces graph/store.mjs's thread keying)
    library.mjs   the document sidebar: list, open, new, rename, duplicate, delete, export, import
    migrate.mjs   per-thread graphs → library documents (copy, idempotent)
    drawer.mjs    the right-hand drawer: value inspector + the Sent/Got/Cost transcript
    runbar.mjs    Run all · Stop · the plan preview · the cap meter · the waits counter
    intake.mjs    image intake: pick/paste/drop → downscale → data URL
    welcome.mjs   first-run panel, template shelf
    computer.css  the entry sheet (@imports the shared sheets + its own)
    tutorial/
      rail.mjs      the step rail
      check.mjs     PURE: the checkpoint predicate evaluator
      registry.mjs  the ordered lesson list
      lessons/NN-slug.mjs   data modules
  css/computer.css      the surface + the warmed-up look
  strings/computer.en.mjs, strings/lessons.en.mjs
```

### 3.2 What moves out of the chat, exactly

| Today | Tomorrow |
|---|---|
| `graph/panel.mjs` registers `SLOTS.WORKBENCH_PANELS` and owns the session | `computer/host.mjs` owns the session. `graph/panel.mjs` is **deleted** at the K1 landing, and its `SLOTS.WORKBENCH_PANELS` row with it. The workbench keeps its other panels; the `computer` loader row in `chat/main.mjs` is removed. |
| `session.thread()`, called from `runner.mjs:371` and `canvas.mjs:529,629,689,733,1004` | **A compat shim, not a deletion** (revision 2). `host.mjs`'s session keeps `thread()` and it **returns `null`**. `runner.mjs` therefore keeps passing `thread: null` into `spec.run()` untouched, and the legacy From-thread/To-thread parts fail with one sentence exactly as §3.2 already promised. The **five `canvas.mjs` sites are re-pointed by K1-U1**, which owns the file for that edit: copy/paste/toolbar ask "is there a document" and become `session.docId()`; the export and import guards (`:689`, `:733`) are **deleted**, because a library document has no thread and K1-U2's export/import acceptance depends on them being gone. |
| `graph/store.mjs` keys by `threadId` | `computer/docstore.mjs` keys by `graphId`. `graph/store.mjs` is deleted with the panel. |
| `graph/inspect.mjs` renders into the chat column | `computer/drawer.mjs` hosts it. `inspect.mjs` keeps its pure `bodyText`/`headingText` and gains a `host` argument; the chat's use disappears with the panel. |
| `parts/from-thread.mjs`, `parts/to-thread.mjs` | **Legacy.** Removed from `partSpecs()`'s palette order but kept in `specMap()` so a migrated graph never trips `part:unknown-type`. They render a `legacy` badge and `run()` fails with one sentence when there is no thread. |
| `parts/code.mjs` `installCodeBridge` (the "Send to the Computer" chat-fence door) | **Removed.** It exists only to receive a code fence from a chat message (B2). `CODE_DECORATORS` / `MESSAGE_ACTIONS` rows go with it. |
| `css/graph.css` — 106 selectors `#lolchat …` | mechanical rewrite `#lolchat ` → `:is(#lolchat, #lolcomputer) `, **106 hits, asserted by count at the landing**. One integrator edit at the K1 kickoff, before any unit starts, so nobody rebases on top of it. |
| `css/base.css` and `css/sandbox.css` | **Untouched** (revision 2). `sandbox.css` has zero `#lolchat ` hits. `base.css`'s three rules that matter (`:19` tokens, `:20` light override, `:37` `.hidden`) are not of the form the rewrite matches — and they already list `.chat-layer` beside `#lolchat`, which is why `<section id="lolcomputer" class="chat-layer">` (§2.1) is the correct fix and a rewrite would be the wrong one. |
| `h.graph.*` in the harness resolves `window.LolChat.debug.computer` and probes `#lolchat .graph-*` | resolves `window.LolComputer.debug.computer` and probes `#lolcomputer .graph-*`. `h.work('computer')` becomes `h.view('computer')`. |

### 3.3 The loader table (`computer/main.mjs`, integrator-owned)

Same contract as `chat/main.mjs`: `{key, path, role:'component'|'feature', fake, phase}`, dynamic
`import()`, `flags.skipModules`, `--strict` at landings. Rows:

| key | path | role | phase |
|---|---|---|---|
| `host` | `./host.mjs` | component | K1 |
| `library` | `./library.mjs` | component | K1 |
| `migrate` | `./migrate.mjs` | component (`fake:null`) | K1 |
| `dialogs` | `../ui/dialogs.mjs` | component | K1 |
| `ask` | `../app/ask.mjs` | feature | K1 |
| `projects` | `../projects/bridge.mjs` | feature | K1 |
| `drawer` | `./drawer.mjs` | feature | K2 |
| `runbar` | `./runbar.mjs` | feature | K3 |
| `intake` | `./intake.mjs` | feature | K4 |
| `welcome` | `./welcome.mjs` | feature | K5 |
| `tutorial` | `./tutorial/rail.mjs` | feature | K5 |

**No `caps` row** (revision 2): `app/caps.mjs` owns the one cap resolver on the **shared** farm, so it is
installed exactly once by `boot.mjs` and never per surface (§2.3).

Leaves with no row (a static import of their consumer, so a typo surfaces as that consumer failing):
`graph/**`, `sandbox/**`, `computer/{boot,layout,docstore}.mjs`, every `strings/*.en.mjs`,
`tutorial/{check,registry}.mjs` and every lesson module.

### 3.4 The Computer's skeleton (`computer/layout.mjs`)

```
#lolcomputer
├── .comp-side           the library sidebar (resizable, collapsible, remembers width in kv)
│   ├── .comp-side-head    [＋ New]  [search]
│   ├── .comp-list         document cards: title · parts · last run · progress ring (lessons)
│   └── .comp-shelves      ▸ Lessons   ▸ Templates            (collapsed by default)
├── .comp-main
│   ├── .comp-runbar       Run all · Stop · plan preview · cap meter · waits · zoom · ?
│   ├── .graph             the existing canvas (unchanged markup)
│   └── .comp-rail         the tutorial step rail (K5, bottom-left, absolutely positioned)
└── .comp-drawer           the right-hand drawer (value inspector / Sent / Got / Cost), hidden
```

`els` = `{root, side, sideHead, list, shelves, main, runbar, canvas, drawer, rail, banner}`.
`ui/layout.mjs`'s `buildLayout` is the chat's and is **not** reused; `installDropGuard(document)` is
already installed by the chat and must not be installed twice — `boot.mjs` installs it once.

### 3.5 The one amendment to a shared file: `net/governor.mjs`

`freeSeat()` today returns **false when the farm advertises no seats**, and `canStart('background')`
therefore refuses. Every graph run is background. On a farm with no seat gate — an older farm build, an
`external` engine, a farm whose snapshot has not arrived yet — **the Computer could never run at all**.

The amendment, and nothing more:

```js
function freeSeat() {
  const seats = caps && caps.seats;
  if (!seats) return true;              // was: false. Seats unknown -> the ONE background slot is allowed.
  return Number(seats.used) < Number(seats.slots);
}
```

Why this is safe and why it is the polite choice:
- `BACKGROUND_LIMIT = 1` still bounds this client to **one** background request in flight, which is
  exactly what one human chatting would put on the farm.
- `canStart('background')` still requires `foreground === 'idle'`, and a foreground Send still
  **aborts** every background call. The reader always wins, unchanged.
- The alternative — running the Computer in the foreground lane — would block a colleague's chat instead
  of yielding to it. Strictly worse.

It is one line, it is a change to a file both surfaces share, and it therefore belongs to the **K1
integrator**, with `chat/unit/governor.test.mjs` growing two cases (seats unknown → one background call
allowed and a second refused; a foreground Send still aborts it) and the harness scenario
`k1-surface-no-seats` proving a Computer run works against a mock farm that advertises no seats.

### 3.6 One stylesheet per unit (revision 2)

§0.4 forbids two units writing one file, and revision 1 broke its own rule: K1-U2 and K1-U3 both owned
"sections" of `css/computer.css`. Corrected — **each unit owns its own sheet**, and the integrator-owned
entry sheet `computer/computer.css` `@import`s them in a fixed order:

```
computer/computer.css        (integrator: @imports, nothing else)
  ../css/computer-tokens.css   integrator, K1 kickoff: the kind colours, sticky tints, radii, the grid
  ../css/computer-shell.css    integrator, K1 kickoff: #lolcomputer, .comp-side, .comp-main layout
  ../css/computer-library.css  K1-U2
  ../css/computer-runbar.css   K1-U3, extended K3-U3
  ../css/computer-drawer.css   K1-U3, extended K2-U3
  ../css/computer-parts.css    K3-U2 (control parts), K4-U2 (previews)
  ../css/computer-states.css   K3-U3
  ../css/computer-look.css     K4-U3 (the whole of §9's part/wire/port treatment)
  ../css/computer-rail.css     K5-U1
```

Adding an `@import` line is an integrator edit at the kickoff of the phase that needs it. A unit never
touches `computer.css` and never touches another unit's sheet.

### 3.7 The harness re-point — a named integrator task, not a parenthesis (revision 2)

`h.graph.*` appears **~470 times across 15 scenario files** (§0.3). "Re-point the existing scenarios" is
therefore its own K1-landing task with a written per-file verdict, and it is the one place in this build
where **a frozen guarantee stops being tested**. §2.6's *amended, never loosened* gets a named exception
here, recorded in the DEVLOG:

| File | Calls | Verdict |
|---|---|---|
| `c1-canvas` · `c1-run` · `c1-shots` · `c1-landing` | 56 · 37 · 11 · 5 | **Re-point** — mechanical `h.work('computer')` → `h.view('computer')`, selectors `#lolchat .graph-*` → `#lolcomputer .graph-*`. No assertion changes. |
| `c2-canvas` · `c2-fanout` · `c2-fanout-parts` · `c2-shots` | 22 · 40 · 70 · 17 | **Re-point**, same. |
| `c3-canvas` · `c3-parts` · `c3-landing` · `c3-shots` | 56 · 61 · 27 · 14 | **Re-point**, plus: any assertion that drives the panel *through the workbench* is amended to drive the surface. |
| `c2-bridges` | 34 | **Mostly deleted.** It exists only to prove From thread / To thread / `installCodeBridge`, all three of which K1 deletes or demotes. What survives is one scenario asserting the **legacy** behaviour: a migrated `from-thread` part loads, badges, and fails with one sentence. **Guarantees BH-1, BH-6 and BH-7 leave the suite**, by decision, recorded by name in the DEVLOG and in §2.6. |
| `examples` | 13 | **Re-point.** |
| `perf-graph.mjs` | 3 × `h.work('computer')` | **Re-homed at the K1 landing** to `h.view('computer')`. It stays `perf-graph.mjs`; there is no `perf-computer.mjs` (revision 2). K3-U3 extends it with labelled wires. |
| `chat/unit/graph-store.test.mjs` | — | **Deleted** with `graph/store.mjs`; its assertions are re-expressed against `computer/docstore.mjs` in `computer-surface.test.mjs` (K1-U1). |

The landing does this pass **before** running the gates, and the DEVLOG entry states the three retired
guarantees and why.

---

---

## 4. The execution model

**One scheduler.** The whole of this section is the dataflow expert's specification, ratified and frozen.
It is restated here in the form a builder implements.

### 4.1 Vocabulary

| Term | Meaning |
|---|---|
| **activation** | one execution of one part inside one run. A part may activate several times (loops). |
| **active set `A`** | the parts this run intends to execute. **Mutable during the run** (merge, barriers). |
| **stale** | a property of the *value*, not of the schedule: computed from inputs or settings that have since changed, or never computed. |
| **ready** | in `A`, state `queued`, and no **forward**-upstream of it is in `A` in state `queued`/`running`/`waiting`. |
| **bar** | a completed part refuses to *activate* its downstream while still *publishing* its value. |
| **parked** | an activation suspended on a human or a clock; state `waiting`. Other branches continue. |

`STATES` becomes `['idle','stale','queued','running','waiting','done','error']`.
`model.mjs:146` becomes `state === 'running' || state === 'queued' || state === 'waiting' ? 'stale' : state`.

### 4.2 The three entry points

```js
run({ mode: 'all' })                       // Run-all: A = runSet(doc)                (pull, today's)
run({ mode: 'from', seeds: [partId] })     // a box's ▶, and a Button click            (push, tldraw)
run({ mode: 'all', force: true })          // shift-Run: A = every part
```

**`mode:'from'` is implemented as `markStale(doc, seeds)` followed by a run restricted to the stale
closure of the seeds, plus the prologue below.** There is no second code path. Every part in `A`
executes regardless of its stored state — pressing ▶ means *do this again* — and that is legitimate
because the seed's own re-execution genuinely stales everything downstream.

**The prologue: ▶ pulls its own missing ancestors (revision 2, frozen).**

```
A = unrunAncestors(seed) ∪ {seed} ∪ downstream(seed)
unrunAncestors(P) = the transitive forward-upstream parts of P whose stored `value` is not a value
```

Without it, `gather()`'s `errNoInput` (§0.3) fires the first time anyone presses ▶ on an Instruction in a
freshly imported template, a freshly forked lesson, or a graph reloaded after a crash — i.e. on the
headline button, on first use. tldraw's push works because its sources are literals that always hold a
value; ours are not. The prologue is a **pull**, so it costs nothing on a warm graph: an ancestor that
already holds a value is not re-run, only read. `manual:true` ancestors (an unpressed Button) are not
pulled either — they report *"Button — not pressed"* on the seed and the seed still runs with what it has.

This is still one scheduler: the prologue only widens `A` before the loop starts.

**Source parts are not re-run by Run-all.** A part with no inputs and state `done` (Note, Image, Dialog,
Button) stays `done`. Without this, Run-all re-interrogates every Dialog on every press.

**Manual roots.** A spec declaring `manual: true` (Button) is never placed in `A` by `mode:'all'`, even
when `idle`. The plan preview reports them: `2 buttons not pressed`.

**`force:true`** exists because a user whose graph is entirely `done` presses Run and expects something.
Without it, Run-all on an up-to-date graph says so in words — *"Everything is up to date. Press ▶ on a
box to run it again, or shift-click Run to run everything."* **Never a silently no-op button.**

### 4.3 The run loop (replaces the frozen `ids` walk)

```
run(seeds, opts):
  A       := activeSet(doc, seeds, opts)
  journal := openRun(...)
  markAll(A, {state:'queued', error:null, fanout:null})
  loop:
    if signal.aborted: break
    doc  := session.doc()
    rank := order(forwardEdgesOnly(doc))            // back edges removed
    if !rank.ok: refuse the run (a hand-edited file)
    next := first id in rank.ids with id ∈ A ∧ state=='queued'
              ∧ no forward-upstream of id is in A with state ∈ {queued,running,waiting}
    if next == null:
        if any part in A is 'waiting':
            journal.status='waiting'; flush()
            await Promise.race([parkResolved, abortSignal]);  continue      // SUSPEND, do not end
        break
    execute(next)
  finish()
```

- The scan is **deliberately O(n) per activation**. 500 parts is 250 000 integer comparisons across a
  whole run — unmeasurable next to one farm call. It buys a loop that is restartable, mergeable and
  loop-safe with no cursor. **A later optimiser must not reintroduce a cursor.**
- `order()` is recomputed every iteration: **editing during a run is allowed**, and lands at the next
  selection. A deletion drops silently. An edit that stales a part already executed this run does
  **not** re-queue it; the report says `left stale by edits: 2`.
- `YIELD_SLICE_MS = 8` and `breathe()` stay, and a loop now yields **between iterations** too.

### 4.4 A ▶ pressed mid-run: merge, never refuse

```
addToRun(seeds2):
  A2 := seeds2 ∪ downstream(seeds2)
  for P in A2:  if state(P)=='running' → mark requeue(P)
                else                   → A ∪= {P}; state(P) := 'queued'
```

`A2` is built with the same prologue as §4.2. The run keeps an **accumulated seed set**
`S = original seeds ∪ every merged seed`; §4.5 recomputes reachability from `S`, never from the original
seeds (revision 2 — otherwise the first barrier after a merge silently drops everything the merge added).

A merged seed topologically *behind* the cursor is picked up (there is no cursor). A merged part that
already completed this run runs again — its input changed. `requeue` on a running part marks it `queued`
on completion instead of `done`: **the user's press is never swallowed.** `run()` therefore never
returns `busy` for a ▶; it still returns `busy` for a *second* `mode:'all'`, and the Run button reads
Stop while a run is live.

### 4.5 Barriers (`bar`) — the generalised `STOP_EXECUTION`

The part contract grows one optional return shape, for control-flow parts only:

```js
return valueOf('text', '…')                 // bar:false, the common case, unchanged
return { value: <GraphValue|null>, bar: true }
```

On completion with `bar:true` of `P`:

```
A' := activeSet(doc with P's out-edges deleted, S)     // S = the run's ACCUMULATED seed set (§4.4)
for Q in A \ A' that has not executed this run:
    A -= {Q};  state(Q) := 'stale';  journal {kind:'bar', partId:Q, by:P}
```

Recomputing reachability rather than walking is deliberate: a part reachable by a **second**, unbarred
path must keep running. Barred parts go to `stale` — never `idle`, never `error`.

**Value still flows.** `gather()` reads `upstream.value` off the doc, so a part that runs for another
reason reads straight *through* a barred Toggle. That is, operationally, tldraw's *"stops the workflow
but still allows data to be pulled through it"*, and it needs no new machinery — only the discipline of
never conflating activation with value.

### 4.6 Cycles and loops

- **Cycles become legal but declared.** `wireRefusal` no longer returns `'cycle'`: a wire that would
  close a cycle is created with `wire.back = true`, drawn dashed with a `↺` glyph, and its target is a
  **loop head**. A self-wire (`from === to`) is still refused.
- **A loop must contain a gate — checked at draw time, O(V+E).** A cycle containing no Toggle,
  Condition, Confirm, Dialog, Button or Timer is **refused**, reason `loop-ungated`, with the fix in the
  same toast: *"A loop needs something that can stop it. Add a Toggle."* This is the strongest safety
  property in the build: it makes a whole class of runaway an impossible gesture.
- **Unit-delay on back edges.** `order()` runs on the graph with `back` edges removed. Therefore (a) a
  back edge never makes a part wait — otherwise a loop head deadlocks forever; (b) a part on a loop
  reads its loop-carried input from the value in the doc **at the moment it runs**, i.e. the previous
  iteration's. This is the classic unit-delay register of Max/MSP and TouchDesigner.
- **Iteration 1 has no previous value — and that is not an error (revision 2, frozen).** *A back edge
  whose source holds no value contributes nothing to `gather()`: it is skipped, not refused.* The part
  runs with whatever its forward inputs delivered. Only if that leaves a **required** port with zero
  arrivals does the existing `errNoInput` apply. Without this rule every shipped loop — lesson 10,
  lesson 11, template 7 — errors on its first iteration, which is exactly when a learner is watching.
- **A loop iteration is a new generation, not a cache hit (revision 2, frozen).** `meteredAsk` forces
  `cache:true` and treats a cached answer as free (§0.3). A critique loop re-activating an Instruction
  whose inputs have not changed would therefore get the identical string back for nothing, forever:
  `maxGenerations` would never fire, and the lesson whose *aha* is a loop would teach that loops do
  nothing. **Rule: on any activation whose iteration index is > 1 within the same run, `meteredAsk`
  passes `cacheSalt: <iteration>`.** Iteration 1 stays unsalted, so a re-run of a settled graph is still
  near-free (lesson 11 depends on that). The salt mechanism already exists — fan-out uses it.
- **Four independent ceilings, all enforced, all visible:**

| Ceiling | Default | Guards against |
|---|---|---|
| `maxIterations` — activations of one part in one run | **8** (raisable to 100) | a loop that spins |
| `maxGenerations` — the existing cap, counted in `meteredAsk` | **50** | spend on a shared GPU |
| `maxWallMs` — wall clock for one run, **parked time included** | **10 min** | a loop of *free* parts that spends nothing and grinds forever; **and an unanswered Dialog** (revision 2) |
| `maxActivations` — total part executions in one run | **2000** | many small loops, each under 8 |

  **Which one is expected to bite, and when** (revision 2 — say it so a stop is never a surprise):
  on every shipped template and every lesson, the intended stop is **`maxGenerations`** — it is the one
  that costs the farm and the one the run bar meters. `maxIterations` is the *loop brake* and is what
  ends lesson 10's runaway. `maxWallMs` only bites on a loop of free parts or an unanswered park.
  `maxActivations` should never bite on anything a human drew; note the arithmetic coincidence that
  `maxIterations 8 × 250 parts = 2000` exactly, so on a very large looping graph the two can land
  together — the report names whichever tripped first and both are raisable.

  Each is a **stop**, not an error: the run ends, the part goes `stale`, the report names the ceiling and
  the part, and offers one *"raise it for this run"* button — the same shape as today's `capped`.
- **The plan preview shows a range.** A graph with a loop reads **"6–48 generations"**, minimum one
  pass, maximum `maxIterations` per looping thinking part. On a shared farm that honesty is the point.
- **Timers are hard-capped.** `repeats` default 1, maximum `maxIterations`. **There is no "forever".** A
  run whose summed timer waits would exceed `maxWallMs` is refused **at plan time**, with the arithmetic
  shown.

### 4.7 Fan-out is not a scheduling construct

`fanout.mjs` is **untouched**. A `list` arriving at a port that accepts `text` makes one activation run
*n* times inside itself: it creates no nodes, changes no active set, crosses no part boundary. That
property is exactly what makes it safe next to push, and it is worth one comment in the code.

What changes is that it becomes **visible**: a fanning port draws a `⋮⋮` badge and the pre-run plan says
*"Instruction: 6 times"*. And **a fanning port that carries a label binds the label to the ITEM, not to
the list** (§5.2 rule 3's counterpart).

### 4.8 Stop

`stop()` aborts the in-flight farm request, rejects every park, clears `A`, and puts everything
`queued`/`running`/`waiting` back to `stale`. Every finished value is kept; the ask cache means the next
Run re-pays for at most the one interrupted call. One Stop button, both modes, `Esc`.

---

## 5. Arrow labels as named parameters

### 5.1 Data model

`GraphWire` gains `label: string` (default `''`). It is a **program** edit: undoable, `rev`-bumping,
marks `to` and everything downstream stale, exported, and part of `.lolgraph.json` **v2**.

```js
key(wire)  = label.trim().replace(/\s+/g,' ').toLowerCase()   // matching
name(wire) = label.trim().replace(/\s+/g,' ')                 // display + prompt heading
```

Matching is casefolded and whitespace-collapsed; **the user's own spelling is what the model sees**. A
65+ character label is accepted and truncated in the UI only.

### 5.2 The nine binding rules (frozen)

1. **Unlabelled arrow** → an *unnamed* input, supplied positionally as `## Input 1`, `## Input 2`, … —
   exactly today's `promptFrom` behaviour, so every existing graph keeps working and "draw an arrow, it
   works" survives.
2. **Duplicate labels** into the same part bind to **one parameter whose value is a list**, in wire
   order. **Never last-wins:** silently discarding one of six research reports is the quiet-loss failure
   this project bans. Rendered as one heading with numbered sub-blocks.
3. **A duplicated label is a JOIN, never a MAP.** It does not fan out. Only a value whose own `kind` is
   `list`, arriving at a port that accepts `text`, fans. This is the single most likely confusion in the
   design; it belongs in the tutorial and in the tooltip.
4. **A label the instruction never mentions** is still supplied — last, after the mentioned ones — and
   the box shows a grey `unused: country` chip. Not an error.
5. **A name mentioned with no arrow to supply it** is a warning chip (`budget — not wired`), never an
   error. People type the instruction before drawing the arrow.
6. **Spaces are normal.** `societal research` is the owner's actual usage. Phrase matching, not
   identifier matching. No camelCase, no `$` requirement.
7. **Labels and ports are different namespaces.** A wire always targets a declared port (`wire.port`,
   unchanged); the label names the *arrival* within that port. Instruction declares one port
   (`in`, `many:true`, `accepts:['any']`) and labels do all the distinguishing.
8. **A label that normalises to empty is an unlabelled arrow.**
9. **Parameter order in the prompt:** (a) labels mentioned in the instruction, *in order of first
   mention*; (b) labels not mentioned, in wire order; (c) unlabelled arrivals, in wire order.

**Mention detection is deterministic and free** — no model call. A label is *mentioned* when its `key`
occurs in the casefolded instruction at phrase boundaries (neither neighbour a letter or digit), or as
`{label}` or `$label`.

### 5.3 The prompt-assembly rule (exact, frozen)

A 12B local model follows **structure** far more reliably than instructions about structure. Therefore:

```
SYSTEM:
You are one component in a visual workflow. You are given named inputs and one instruction.
Use every input the instruction refers to by name. Reply with the result only — no preamble,
no restatement of the inputs, no commentary about the workflow.

USER:
# Inputs

## topic
accessibility in museums for autistic persons

## societal research
<the whole markdown report, verbatim>

## environmental research
### 1
<first arrow's value>
### 2
<second arrow's value, same label>

## Input 3
<an unlabelled arrival>

# Instruction
write a problematic about the topic taking into account: technological research,
environmental research, societal research, business research…
```

Frozen details:

- Headings are `##` + `name(wire)` — the user's own spelling.
- Value rendering by kind/format: `text/plain` verbatim · `text/markdown` verbatim · `text/code` in a
  fence tagged with `lang` · `text/svg|html` in a fence · `json` in a ` ```json ` fence · `list` as one
  `-` bullet per item · `file` its path, plus its contents in a fence when text-like and < 64 KB ·
  `image` **not in the text** — the heading reads `## <label> (image, attached)` and the bytes ride the
  ask body's `images` array.
- **An empty value still gets its heading**, with `*(empty)*` beneath. Never omitted.
- `{label}` / `$label` in the instruction are **replaced by the bare label word** before sending.
  Braces read to a model as an unsubstituted template and invite it to echo them.
- **Inline substitution** is an opt-in per-part toggle, default **off**: when on, any label whose value
  is text under 200 characters is substituted in place *and is then not repeated* under `# Inputs`.
- **The instruction is always last.** Recency is the strongest lever on a small model.
- Empty instruction with ≥ 1 input → the literal fallback *"Combine the inputs above into a single
  coherent result."* and the box shows "no instruction yet". No inputs and no instruction → the existing
  `errNoInstruction`.
- Output shape (`text` / `list` / `json`+schema) rides the existing ask-spine ladder unchanged.

### 5.4 The size budget

The assembled prompt is capped by **`ctx/budget.mjs`'s existing `budgetFor(caps)`** — which already reads
`caps.backend.contextPerSlot` and already falls back to `DEFAULT_BUDGET = 32768` / `DEFAULT_RESERVE =
4096` when a farm advertises nothing (§0.3). `bind.mjs` takes the number as an argument and does no
arithmetic of its own about farms; the caller passes `budgetFor(app.farm.get())`. When the fallback was
used, the `truncated` badge says **assumed** rather than quoting a farm that never said it. Over budget: **middle-out truncation per input,
proportional to size, longest first**, each cut marked inline `…[12 480 characters omitted]…`, and the
part shows a `truncated` badge with the numbers. **Never a silently dropped input.** The heading always
survives, so the model is told the input existed.

### 5.5 Labels elsewhere

A label on a wire into a non-Instruction part is **advisory**: it names the input in the Code part's
`inputs` object (`inputs["societal research"]`), it titles the block in a Collect, and it is otherwise
decoration. Never an error.

### 5.6 Where this lives

**`graph/bind.mjs`, PURE**, added to `chat-lint.js` `PURE_MODULES`. It exports:

```js
bindInputs(doc, partId, {specs})   → {params: [{name, key, mentioned, values, unlabelled}], unused: [], unwired: []}
assemblePrompt(params, instruction, {budget, inline}) → {system, prompt, images, truncated, words}
mentions(instruction, key)         → boolean
```

It touches no DOM and no farm. Its unit test is the single most important test in the build.

---

## 6. The part catalogue

`graph/parts/index.mjs` is integrator-owned. Palette order and grouping:

| Group | Parts |
|---|---|
| **Bring in** | Note · Image · File |
| **Think** | Instruction · Split · Filter · Collect · Repeat |
| **Show** | Preview · Code |
| **Control** | Button · Condition · Confirm · Dialog · Toggle · Timer |
| **Annotate** | Sticky · Section · Title |
| *(legacy, not in the palette)* | From thread · To thread · Render (aliased to Preview) |

### 6.1 Carried over unchanged

`note` (gains markdown rendering, §6.2) · `split` · `filter` · `collect` · `repeat` · `code` · `file`
(its scratch project is keyed by **graph id**, not thread id).

### 6.2 Note (markdown)

- In: none. Out: `text` with `format:'markdown'`. Settings: `text`, `colour` (one of five sticky tints),
  `locked` (tldraw's 🔒 — a locked note's text cannot be changed by an incoming value).
- Renders markdown live through `render/md-block.mjs` + `render/dom.mjs` (the only text→nodes path).
  Double-click switches to the raw textarea; blur switches back. Scrollable body.
- **A Note with an input** accepts `any` (many). **A run never writes the program** (revision 2): when it
  runs, the arriving text becomes the Note's **value**, and the body renders *the value when one exists*,
  falling back to `settings.text` when it does not. `settings.text` is only ever changed by the person
  typing.
  This matters because there is no legal door for the alternative: `session.patchPart` is documented
  *runtime fields only, never undoable, never stales anything*, and `setSettings` goes through
  `session.apply`, which is undoable, `rev`-bumping, and would stale its own downstream mid-run and then
  be counted as *"left stale by edits"* (§4.3). The value route needs no new machinery and is what makes
  the lesson-11 loop (`Instruction → game state note → Toggle → …`) behave as drawn.
  The body shows a small **from input** marker with a `↺ clear` action that drops the value and reveals
  the typed text again. A **locked** note (🔒) ignores arrivals and says so.

### 6.3 Instruction (absorbs `ask` and `look`)

- **Type id stays `ask`** so every stored graph loads; the label and file become `instruction`.
  `parts/look` never shipped, so there is nothing to alias.
- In: one port `in`, `many:true`, `accepts:['any']`. Labels do all the distinguishing (rule 7).
- Out: `text` (declared), really `text|list|json` per `shape`.
- Settings: `instruction` · `shape` (`text|list|json`) · `schema` · `model` · `inlineVars` (default off).
- Run: `bindInputs` → `assemblePrompt` → `app.ask.text|json` at `priority:'background'`.
- **Vision is not a separate box.** An `image` bound to a label rides `ask({images:[…]})`. If the farm
  advertises no vision → **hard error `errNoVision` naming the farm**. Never a silent text-only fallback.
- The box shows, permanently: a collapsed strip `sends 412 words · 3 named inputs · ⌄`, the `unused:`
  and `— not wired` chips, and a `truncated` badge when §5.4 fired.

### 6.4 Image

- In: optional `file`. Out: `image`. Settings: `dataUrl`, `name`, `w`, `h`.
  **The `image` *value* stays exactly `{dataUrl, name}`** — the shape `values.mjs` already normalises
  (§0.3). `w`/`h` are part settings for the box's own sizing and never travel on a wire, so `valueOf`,
  `coerce` and `preview` keep working unchanged.
- Intake: click, paste, or drop. `createImageBitmap` → `OffscreenCanvas` (long side ≤ 1536) →
  `convertToBlob('image/jpeg', 0.85)` → `FileReader.readAsDataURL`. **`FileReader` only** — `fetch` is
  forbidden outside five modules and `createObjectURL`/`blob:` outside `ui/transfer.mjs`.
  The downscale strips EXIF, which is also the privacy answer.
- Hard cap `MAX_VALUE_BYTES` (1 MB, already exported by `serialize.mjs`). Over → a refusal naming the
  size, with a "try a smaller image" sentence. The drop guard in `ui/layout.mjs` must keep **not**
  calling `stopPropagation`.

### 6.5 Preview (replaces Render in the palette)

- In: one `content`, `accepts:['text','json']`. Out: `null`. Settings: `mode`
  (`auto|markdown|svg|html|three|p5`), `w`, `h`, `live` (boolean).
- **markdown** and **svg** are **live and free**: markdown via `render/dom.mjs`, SVG via
  `design/svg-sanitize.mjs` (the XML-parsing allow-list sanitiser that already shipped). No iframe.
- **html / three / p5** render a **PNG snapshot** taken by the single sandbox guest — the existing
  `render.mjs` path — plus an **"Open live"** toggle that moves the one guest frame into this box.
  Exactly one box is live at a time; opening a second closes the first, visibly. §0.5 records why.
- `auto` picks from the incoming value's `format`/`lang`. **A Code part's output format is an explicit
  picker, never sniffed** — sniffing `<svg` is the kind of magic that fails once and is never trusted.
- Refusals name the port, the kind that arrived and the kinds accepted, **and the action they name must
  be one that exists** (revision 2 — an Image part is a source; you cannot wire an image *into* it):
  *"Preview: got an image on `content`, which takes text or json. To look at a picture, put it in an
  Image box; to ask about it, wire it into an Instruction."*

### 6.6 The six control parts

All six: one `any` input unless stated, output = the input passed through, `thinks:false` unless stated.

| Part | Ports / settings | Semantics |
|---|---|---|
| **Button** | in: none or `any` (many). out: the input, or `json:true` when unwired. `manual:true`. | Never in `A` for Run-all; the plan says `2 buttons not pressed`. Clicking it is `run({mode:'from', seeds:[id]})` — its face and its ▶ do the same thing. **A Button with inputs bars by default**: an upstream wave stops at it and it glows *"ready — click to continue"*. That is the manual gate that makes an expensive branch safe. |
| **Condition** | in: one `any`. settings: `branch ∈ {yes,no,maybe}`, `mode ∈ {text,model}`, `question`. | Classifies the input; `bar = (verdict !== branch)`. Three Conditions off one Instruction give the Yes/No/Maybe fan. **`mode:'text'` (default, free):** casefold, first match wins — `yes\|true\|y\|oui\|affirmative\|1` → yes; `no\|false\|n\|non\|0` → no; `maybe\|perhaps\|unsure\|unclear\|partly\|it depends` → maybe; JSON `true`/`false` → yes/no; JSON `null` → maybe; **anything unmatched → maybe**, never silently "no". **`mode:'model'`:** one cheap generation, schema `{verdict}`, cached by (input hash, question), costs 1 against the cap. The matched branch shows on the part **and on the wires** — barred wires go grey, and that grey is most of the teaching. |
| **Confirm** | settings: `message`, `timeoutSec?`. | Runs → `waiting`, with **OK / Cancel inline on the part, on the canvas**. A modal over a canvas is hostile and hides which box is asking. The run suspends **this branch only**. OK → `bar:false`; Cancel → `bar:true`, `done`, the part reads "cancelled"; a timeout counts as Cancel and says so. |
| **Dialog** | in: optional `any` (many, context). out: `text`. settings: `question`, `placeholder`, `multiline`, `default`, `askEveryRun` (default **false**). | Runs → `waiting`, question rendered *in the part* with a field and Send. `askEveryRun:false` needs no new machinery — the answer is `part.value`, so a `done` Dialog is simply not in `runSet`. `askEveryRun:true` maps to `volatile:true`, a spec flag meaning "never satisfied by a stored value". A ▶ on a Dialog always re-asks. Several may wait at once; the run bar shows `2 questions waiting` and pans to them. |
| **Toggle** | settings: `on`. | `on` → `bar:false`. `off` → `bar:true`, **and the value still flows**. Flipping it is a settings edit: marks downstream stale, does **not** auto-run. |
| **Timer** | settings: `seconds` (0.1–3600, default 3), `repeats` (1–`maxIterations`, default 1). | Runs → `waiting` for `seconds` via **`setTimeout`** (lint rule 13 forbids `setInterval` here), then `bar:false`. `repeats > 1` passes n times, re-activating downstream each time. Parked like Confirm; other branches continue; cancelled by Stop; killed by app close. |

### 6.7 Annotation parts

**Sticky** (square, five tints, no ports, purely annotative), **Section** (a labelled dashed region that
parts sit inside and move with), **Title** (canvas text at three sizes). All three: `output:null`, never
in `A`, never counted, never exported as values. They are what makes a lesson page and the owner's own
graph readable, and tldraw's templates are laid out entirely with them.

### 6.8 Types and coercion

**Kinds stay at five** — `text · image · list · json · file`. Kinds are the routing alphabet, and more
kinds means more refusals and more ways to tell a beginner "no". Instead `GraphValue` gains two
**advisory facets**:

```js
{ kind, data, format?, lang? }
// format: 'plain' | 'markdown' | 'code' | 'svg' | 'html' | 'css' | 'js'   (default 'plain')
// lang:   for format 'code'
```

`format` **never affects `accepts()`**. It drives three things only: which preview renders it, how it is
fenced in a prompt (§5.3), and what a Preview defaults to. `isValue()` is unchanged, so every stored
value loads with `format` absent, meaning `plain`. **`model.mjs:normalisePart` must be extended to carry
`format`/`lang` through** — see §0.3; this is the one line that silently loses the facet on reload.

**The whole facet contract lands in the K2 kickoff** (revision 2), not in K4: `core/types.mjs`,
`values.mjs` `valueOf`, `model.mjs` `normalisePart` and `serialize.mjs` are all touched by the integrator
in one commit. Revision 1 split it — `normalisePart` to K2-U1, `values.mjs` to K4-U2 — while K2's own
prompt fencing (`text/code` → a fence tagged with `lang`, §5.3) already depended on the facet existing,
and K4-U2's acceptance named a line it did not own. K4-U2 now only **consumes** facets.

- markdown = `text/markdown` (Note emits it) · code = `text/code` + `lang` · svg/html =
  `text/svg` / `text/html` · **boolean = `json` with `data === true|false`** (Condition already reads it;
  no new kind).
- `values.mjs:COERCE` is unchanged and stays **pure and synchronous**: `file → text` continues to yield
  the *path*. Reading contents is async and belongs to the parts that want contents.
- `text ← image` stays deliberately absent. With vision on Instruction that is no longer a dead end.

---

## 7. Storage, migration, export

### 7.1 The library document

No DB version bump. `graphs` already keys on `id` and indexes `updatedAt`, and `listGraphs()` with no
argument already returns them all. A **library document** is a `graphs` row with:

```
threadId: null          // THE marker of a library document
title: string           // already in the model and the export; nothing writes it today
folder: string | null   // reserved, unused in this build
```

`computer/docstore.mjs` replaces `graph/store.mjs`:
- `load(graphId)` → `repo.getGraph(id)` → `normaliseDoc`. **No thread keying, no early return on
  `!threadId`** (that early return is the bug in §0.3 that makes a library silently persist nothing).
- `put(doc)` / `flush()` — the same 500 ms debounce, the same "last doc wins".
- `list()` → `repo.listGraphs()` filtered to `threadId === null`, sorted by `updatedAt` desc.
- `create({title})`, `rename(id, title)`, `duplicate(id)`, `remove(id)`.
- `kv 'computer:lastGraphId'` mirrors `ui:lastThreadId`: a relaunch reopens the graph you left.

### 7.2 Migration from per-thread graphs

`computer/migrate.mjs`, run once after `repo.ready`, only when `repo.mode === 'idb'`, with its verdict on
`window.LolComputer.migration` — the `state/migrate-v0.mjs` precedent.

```
1. kv 'computer:migratedV1' set?  → {status:'already'}
2. rows = await repo.listGraphs()
3. for each row with row.threadId != null:
     derived = 'lib-' + hash(row.id)                  // core/ids.mjs hash(): FNV-1a 32-bit, 8 hex chars.
                                                      // STABLE, so a crash mid-loop cannot duplicate.
     if await repo.getGraph(derived) → skip
     thread = await repo.getThread(row.threadId)      // may be gone
     title  = row.title || ('From: ' + (thread?.title || '…')) 
     putGraph({...row, id: derived, threadId: null, title})       // COPY, never move
4. kv 'computer:migratedV1' = true; kv 'computer:migratedCount' = n
```

**Copy, never move**, for two reasons: `repo.deleteThread` cascades to `graphs` rows by `threadId`, so a
migrated graph that keeps its thread id **is destroyed when the user deletes that chat** (§0.3); and a
half-done migration must be safe to re-run. **The derived id is what makes step 3 idempotent** — without
it a crash mid-loop duplicates the library on the next launch.

`hash()` is `core/ids.mjs`'s FNV-1a 32-bit (§0.3) — **not a new one**. A 32-bit collision between two of
a person's own graphs is vanishingly unlikely and, if it happened, the `getGraph(derived) → skip` check
in step 3 makes the outcome "one of them is not migrated", never "one overwrites the other". The original
row is untouched in both cases, so nothing is lost.

The migrated document's `from-thread` / `to-thread` parts load, render a `legacy` badge, and fail with
one sentence at run time. They are never silently dropped: `part:unknown-type` would lose the reader's
work.

### 7.3 The run journal

`graph/journal.mjs`, backed by **`kv`**, one row per graph:

```js
kv['computer:runs:<graphId>'] = [ {
  id, startedAt, endedAt|null,
  mode: 'all'|'from'|'button', seeds: string[],
  status: 'running'|'waiting'|'done'|'stopped'|'error'|'capped'|'limited',
  cap, spent, tokens, model,
  iterations: {[partId]: n},
  waits: [{partId, kind, since, question?}],
  events: [{t, partId, kind:'start'|'done'|'error'|'bar'|'item'|'wait'|'resume'}],   // ring, last 200
  report
}, … ]   // last 5, pruned on write
```

Why it exists: this surface is **for learning what an agent is**, and *"show me what just happened"* is a
feature, not telemetry. It is also the crash-resume record and the per-run cost record. It never leaves
the machine.

### 7.4 Flush policy (frozen)

`state · value · error · stats · fanout` go through `patchPart` with **no `rev` bump** — a run is not an
edit of the program. The 500 ms debounce stands, **plus a forced flush on** (a) any part completion that
consumed a generation, (b) entering `waiting`, (c) run end.

> **Anything the farm was paid for is flushed before the next part starts.**

### 7.5 What survives a crash

- Every value already written. Parts left `queued`/`running`/`waiting` come back **`stale`**.
- The journal row comes back `status:'running'|'waiting'`, `endedAt:null`. Opening the graph shows:
  *"The last run stopped when the app closed — 12 of 19 boxes finished. **Resume**"*
- **Resume is literally `run({mode:'all'})`.** The dirty rule makes everything already done free; a
  `waiting` Dialog re-asks, because its answer was never stored.
- Stated honestly in the UI: the ask cache is in-memory and per window, so a resume after a crash
  re-pays for **at most the one call that was in flight**. Timers do not survive a close.

### 7.6 Export

`.lolgraph.json` **version 2**: adds `wire.label`, `value.format` / `value.lang`, and the new parts'
settings. A v1 file imports cleanly (no labels).

**A newer version is still REFUSED, not imported with a warning** (revision 2). `serialize.mjs:139`
already returns `{ok:false, errors:['unsupported-version']}` and it stays. Revision 1 proposed
import-with-warning; that is precisely the quiet field-loss §1.3 rule 4 bans one level up — a v3 file
carrying a part type or a wire property this build has never heard of would import as a subtly broken
graph. What changes is only the **sentence**: *"This graph was made with a newer version of the Computer.
Update LlmOnLan and open it again — nothing has been changed."*

**What export writes, honestly** (revision 2 — revision 1 contradicted itself and the code):
- `serialize.mjs` **already exports part values** under the 1 MB `MAX_VALUE_BYTES` cap, and already
  supports `{values:false}`, which deletes them. That is the door.
- The library's **Export…** therefore offers one checkbox, **"Include results"**, default **on** (what
  the code does today). Unticked, every part value is stripped — including a Dialog's typed answer, a
  person's own words, which is the case that motivated the rule.
- The **`demo answer — not generated`** badge is a part **flag** (`settings.demo = true`), not a value,
  so it survives export with the box ticked or not. §10.2's honesty promise and this section no longer
  disagree.
- Never exported at all, with or without values: farm address, API key, `threadId`, client id, absolute
  file paths. This is `serialize.mjs`'s existing allow-list discipline, unchanged.
- `ui/transfer.mjs`'s `pickImportFile` `accept` gains `.lolgraph.json`.

### 7.7 Determinism

Each run records the model id and a prompt hash per thinking part. The ask spine exposes no seed, so runs
are **not** reproducible. The journal UI says that plainly rather than implying replay.

---

## 8. Teaching affordances on the canvas

This is the highest-value section of the build. A node graph that hides what it sent to the model teaches
nothing; one that shows it teaches prompt engineering by accident.

### 8.1 The Transcript drawer — "what gets sent"

Every thinking part carries a permanent collapsed strip: `sends 412 words · 3 named inputs · ⌄`. Clicking
it (or `⌘/Ctrl`-clicking ▶) opens the drawer — right side, ~440 px, resizable, one at a time, Escape
closes. Three tabs:

- **Sent** — the assembled prompt **exactly as it goes on the wire**, nothing paraphrased. Each named
  parameter is a tinted card headed by its label in the wire's colour; the instruction last, in the
  accent colour; then `model: gemma4:12b · response_format: json_schema · max_tokens: 2048 · priority:
  background`. **This works BEFORE a run** — unresolved inputs render as `⟨topic — has not run yet⟩`. You
  can read your prompt, fix it, and read it again, for free. That single behaviour is worth more to a
  learner than any explanatory text we could write.
- **Got** — the raw reply, verbatim, plus the **repair ladder** when a shape was requested:
  `asked with schema → model returned prose with a fenced object → extracted → validated ✓`.
- **Cost** — `3.4 s · 612 tokens · not cached · farm: Studio Farm · seat held 3.4 s`, or the refusal
  reason in the same plain sentence the box shows.

The drawer also hosts the **value inspector** (`inspect.mjs`'s pure `bodyText`/`headingText`, new host).

**Escape precedence, frozen (revision 2).** Three things want `Esc`, and `inspect.mjs` already
`preventDefault`s it specifically so the inspector's close does not also stop the run. One ladder, first
match wins, each handler stopping propagation:

1. an open **popover or dialog** from `ui/dialogs.mjs`;
2. the **drawer**, if open;
3. an inline **part editor** with focus (a Note's textarea, a Dialog's field, a label pill);
4. **Stop**, if a run is in flight.

So Escape never stops a run you cannot see the state of, and stopping a run always takes exactly as many
Escapes as there are things open in front of it.

### 8.2 Values and labels on the wire

- Every wire carries an **editable label pill** at its midpoint. Empty pills draw as a dashed placeholder
  reading `name me` at 40 % opacity — an unnamed wire is the #1 cause of a mushy answer.
- After a run, a **value chip** sits before the arrowhead: `"forestry"` · `2.4 kB markdown` ·
  `list · 6 items` · `image 1280×720` · `json · 4 keys`. Hover → first ~200 characters. Click → the
  drawer's inspector.
- **Colour and glyph are the type system** (§9 — the shell's palette has three real hues, so colour alone
  cannot carry five kinds honestly). Port dots, wire strokes and value chips share one palette and one
  set of marks across the five kinds. A learner should distinguish a list from a text before they know
  why it matters — and the `type` refusal then says *"a list can't go into a port that wants one text — add a Collect, or let it
  fan out"*, naming the colours they already saw.

### 8.3 What running looks like

- **Queued**: dashed outline + `2nd in this run`. Waiting for a seat says so.
- **Running**: accent halo, a thin indeterminate bar at the top edge, pulsing ports, an elapsed counter,
  and an honest phase word — `thinking` / `reading image` / `repairing the answer` / `running in the sandbox`.
- **Done**: the last duration stays bottom-right (tldraw's habit, worth stealing), and **the delivering
  wire animates a single travelling dot** from source to target. One animation at a time, on the existing
  SVG layer. It is what makes "data flowed" legible to someone who has never seen a dataflow graph.
- **Stale**: a soft diagonal hatch and a `will re-run` marker — so "why did six boxes go grey when I
  fixed a typo" answers itself.
- **Waiting**: the part's own inline control (OK/Cancel, the question field, the countdown), and the run
  bar counts them.
- **The run bar**: `6 parts · 4 generations · 11.2 s · 2 cached`, **Run all · Stop**, the cap as a
  spent/limit meter (`12 / 50`) turning amber past 80 %. Clicking a part's clock explains the schedule in
  one sentence: *"this ran because its input `topic` changed at 14:02."*

### 8.4 Errors, in the language of the person who hit them

**One sentence for what happened, one for what to do, never a code, never a stack, and never at the cost
of the previous value** — a failed box keeps its last good value, greyed, behind the error strip.

| Situation | What the box says |
|---|---|
| no farm | **No farm found on the network.** The Computer needs a LlmOnLan farm to think — everything else on this canvas still works. `[Find a farm]` |
| busy / seat 429 | **The farm is busy — someone is chatting.** Your run paused and kept everything it had paid for. `[Run]` to continue. |
| capped | **This run reached its limit of 50 generations.** Nothing was lost. `[Raise it for this run]` `[Show me what spent it]` |
| invalid shape | **The model answered, but not in the shape you asked for.** Here's what it actually said → `[Show]` `[Loosen to text]` |
| empty | **The model returned nothing.** Usually the instruction is too vague, or nothing was wired in. |
| sandbox throw | the real exception line, then: *this ran in a sandbox with no network, no files and no access to the app.* |
| type refusal | **A list can't go into a port that wants one text.** Add a Collect to join them, or drop it on the part's body to fan out — one run per item. |
| newer file | **This graph was made with a newer version of the Computer.** Update LlmOnLan and open it again — nothing has been changed. |
| run stopped by the clock | **The run stopped after 10 minutes.** *(or, when it was a park:)* **Nobody answered the question in `<part>`, so the run stopped after 10 minutes.** `[Raise it for this run]` |
| loop-ungated | **A loop needs something that can stop it.** Put a Toggle in the way — see lesson 10. `[Open lesson 10]` |
| no vision | **This farm's model cannot read images.** It is serving `<alias>`. Switch the farm to a vision model, or remove the image. |

Every error naming a concept links to the lesson that teaches it. **The tutorial is the help system.**

### 8.5 The `?` card

Each part type's title bar carries a `?` dot opening a two-sentence card in the part's own voice — no docs
site, no scrolling. *"An **Instruction** is a prompt with holes. Everything wired into it fills a hole,
named by the wire's label — and you refer to that name in your prose."* Below it: `Used in lesson 3 →`.

---

## 9. The visual language — warmed-up ComfyQ

The shell's tokens are the palette (`renderer/tokens.css`, out of scope, unchanged). **No colour
literals** — lint rule 3. Every hue below is a `color-mix()` of an existing token, defined once at the top
of `css/computer.css`.

**The honest constraint (revision 2):** `tokens.css` gives us **three real hues** — `--green`, `--amber`,
`--danger`. `--blue` is byte-identical to `--accent` and to a grey in *both* themes (§0.3), and so is
`--grey`. Five kinds cannot be told apart by hue alone in this palette, and a gate that claims they can
would fail. So **the type system is colour *and* glyph**: every port dot, wire end and value chip carries
a one-character mark, and the colours are chosen for maximum separation among what we actually have.

| Kind | Colour | Glyph |
|---|---|---|
| text | `--muted` (grey) | `T` |
| list | `--green` | `≡` |
| json | `--amber` | `{}` |
| image | `--danger` | `▣` |
| file | `color-mix(in oklab, var(--danger) 55%, var(--muted))` — a desaturated rose, clearly off the saturated `--danger` | `⎘` |

```css
/* the five kinds — the type system, visible before it is understood */
--k-text:  var(--muted);
--k-list:  var(--green);
--k-json:  var(--amber);
--k-image: var(--danger);
--k-file:  color-mix(in oklab, var(--danger) 55%, var(--muted));

/* five sticky tints, legible in both themes */
--sticky-1: color-mix(in oklab, var(--amber)  18%, var(--surface));
--sticky-2: color-mix(in oklab, var(--green)  16%, var(--surface));
--sticky-3: color-mix(in oklab, var(--danger) 14%, var(--surface));
--sticky-4: color-mix(in oklab, var(--accent) 22%, var(--surface));
--sticky-5: var(--surface-2);
```

| Element | Spec |
|---|---|
| Part card | radius **14 px** (chat cards are 12), 1 px `--border`, `--surface` ground, 14 px padding, `--surface-2` title bar |
| Title bar | drag handle ⠿ · type name · `?` dot · 🔒 lock where relevant · **▶ run** |
| Ports | **10 px** filled dots straddling the edge, `--k-*` fill, 2 px `--bg` ring, 18 px hit target, **the kind's glyph beside the dot** (9 px, `--muted`). Chunky and visible — the owner asked for it |
| Wires | 2 px stroke in the source kind's colour; back edges dashed with `↺`; barred wires drop to 35 % opacity |
| Label pill | 7 px radius, `--surface-2`, 1 px border; empty = dashed, 40 % opacity, reads `name me` |
| Sticky / Section / Title | 10 px radius, no border, the five tints; Section is a dashed 1 px region with a label in `--muted` |
| Selected | 2 px `--accent` ring + a 4 px offset shadow in `color-mix(in oklab, var(--accent) 35%, transparent)` |
| Running | accent halo, a 2 px indeterminate bar at the top edge, ports pulsing (`prefers-reduced-motion` → no pulse, a static ring) |
| Stale | 6 px diagonal hatch at 8 % `--muted` |
| Error | a 2 px `--danger` left edge and an error strip under the body; the last value stays, greyed |
| Grid | dots at 24 px, `color-mix(in oklab, var(--border) 60%, transparent)`, so the first drag is legible |
| Spacing | the canvas default part gap is 80 px, tidy lays out on a 40 px grid. Generous, per B7 |
| Type | Inter / system-ui, 14 px base; part titles 12 px `--muted` uppercase-tracking; no monospace except code |

Dark and light are both shipped and both photographed at every landing (`h.screenshot`).

---

## 10. The tutorial

**Decision: a lesson is a real, editable graph document, forked into your library on first touch, with a
step rail and declarative checkpoints.** Not a read-only exhibit, not a modal wizard, not a spotlight
overlay (which fights the canvas's own pan/zoom and cannot survive the user moving a box).

You cannot learn a node graph by watching one. Every lesson opens as a normal canvas with normal parts —
the lesson's own furniture (the big number, the title, the sticky notes, the "next up" card) is made of
the same Sticky/Title parts the learner is about to use. Opening a lesson is already a worked example of
the medium.

### 10.1 The five mechanisms

1. **Copy-on-write fork.** Opening lesson 5 shows the pristine shipped graph. The first edit forks it into
   the library as *"Lesson 5 — the model can see"*; **Reset lesson** restores the shipped JSON at any
   moment. Nothing the learner does can break a lesson, so nothing is locked.
2. **The step rail** — a docked card, bottom-left, ~300 px, collapsible to a pill. **One step at a time**:
   `Step 2 of 4 · Name the arrows`, one sentence, and a `Show me` link. Completed steps collapse into a
   row of ticks. Lesson layouts are authored around the rail so it never covers the part it is about.
3. **Checkpoints — the app knows you did it.** Each step declares a **pure predicate over
   `(doc, lastRunReport)`**, evaluated on every doc revision and every run event. No polling, no
   heuristics, **no model call.** Four matcher shapes cover the whole curriculum:
   - `{ has: {type:'ask', setting:'instruction', nonEmpty:true} }`
   - `{ wire: {fromType:'note', toType:'ask', label:'nonEmpty'} }` (or `label:'topic'` exactly)
   - `{ ran: {partId:'p_fact', state:'done'} }` / `{ ran: {type:'code', state:'done'} }`
   - `{ report: {generations:'>=3'} }` / `{ report: {stopped:'capped'} }` — for the lessons where the
     *failure* is the lesson.
   A step may be `{manual:true}` with a **Got it** button. Some things genuinely cannot be detected, and
   pretending otherwise produces the worst UX in teaching software: a tick you cannot earn.
   `tutorial/check.mjs` is **PURE** and unit-tested against every lesson's steps.
4. **Wandering off is allowed.** Checkpoints latch by step id and never un-tick. Delete a part a later
   step needs and its `Show me` becomes **Put it back**, re-adding it at its authored position with a
   one-beat highlight. Progress lives in `kv['computer:tutorial']` →
   `{[lessonId]: {step, ticks[], forkedDocId, doneAt}}`. The library card carries a progress ring.
5. **Authoring is round-trip.** A lesson is one ES module at `computer/tutorial/lessons/NN-slug.mjs`:
   ```js
   export default {
     id:'l05-vision', n:5, title:'the model can see',
     subtitle:'Drop an image in; it reads pixels the same way it reads words.',
     idea:'Vision is the same call with an image attached.',
     needsFarm:'one',                      // 'no' | 'one' | 'few'
     doc:{ /* a normal exported graph — paste from the canvas's Export */ },
     steps:[ {id:'s1', text:'…', check:{…}, show:{partId:'p_img'}}, … ],
     demo:{ 'p_describe': {kind:'text', data:'…a recorded answer…'} },
     next:'l06-code',
   };
   ```
   You **build the lesson on the canvas**, press Export, paste the JSON into `doc`, add steps. A lint gate
   (`chat-lint.js` grows rule 15) asserts every lesson doc survives `normaliseDoc()`, every `check`/`show`
   names a part id that exists in that doc, and every `next` resolves.

### 10.2 When the farm is busy or absent — the lesson must not die

- `needsFarm` is declared per lesson and shown as a chip: **"needs the farm"** vs **"works offline"**. The
  Tour and the authoring steps of 2, 3, 4, 7, 10 complete offline; the library, canvas, wiring, sandbox
  and previews need no model at all.
- Every farm-needing lesson ships a **`demo` pack**: one recorded answer per thinking part. On a run that
  fails with `no-farm`, `busy` or a seat 429, the part offers *"The farm is busy. Continue with this
  lesson's saved answer?"* → one click injects the recorded value, marks the part `done`, and stamps a
  permanent **`demo answer — not generated`** badge that survives save and export. A `ran:` checkpoint
  accepts a demo tick and the rail says so. **We never let the app pretend it generated something.**
- This is also the CI story: the harness walks all twelve lessons against the mock farm in demo mode and
  asserts every checkpoint can be satisfied.

### 10.3 The curriculum — 12 lessons in three acts, two shelves

Before lesson 1 sits **the Tour** (unnumbered, ~90 s, no farm): pan/zoom, add a part, wire two, delete,
undo, open the library. It exists so lesson 1 can be about the model instead of about the mouse.

**Shelf "the basics" — Act I, the canvas is a program**

| # | Title | Idea | You DO | Aha |
|---|---|---|---|---|
| 1 | **hello, farm** | An Instruction is a prompt you can point at and run. | Type a haiku instruction, press ▶, watch `idle → queued → running → done`. | The model isn't in this window — the chip says **Studio Farm · gemma4:12b**. Your laptop asked a machine down the hall. |
| 2 | **wires carry values** | Forward dataflow; the note's text physically enters the prompt. | Wire a note into the instruction, run, then open **Sent**. | The prompt contains your note word for word. The model has no memory — only what the wires delivered. |
| 3 | **arrow labels are names** ⟵ *the hinge* | Named parameters. The whole idea of the tool. | Run it once with the labels **blank** (the prompt shows `Input 1 / Input 2`, the answer is mush), then name them and run again. | Renaming a wire changes the prompt **live in the preview**. The label is a variable, not decoration. |

**Act II — the shapes of agency**

| # | Title | Idea | You DO | Aha |
|---|---|---|---|---|
| 4 | **many in, many out** | Parallel work then a join; a joining part waits for **all** its inputs. | The owner's own graph in miniature: one topic → three labelled research Instructions → one "write a problematic". | You just built a research pipeline. The run bar says **4 generations** — the shape of the graph is the shape of the work. |
| 5 | **the model can see** | Vision is the same call with an image attached. | Two images labelled `before` / `after` → *"What changed, and what does it cost the user?"* | The labels made it a comparison. Nothing about the box changed — only the names on the wires. |
| 6 | **the model writes a tool** | An agent's output can be **executed** — and the boundary that makes that safe. | Ask for p5.js that draws one circle per sentence. Then deliberately ask for code that calls `fetch()`. | It draws. And the `fetch` **fails inside the sandbox**. The error itself teaches the fence. |
| 7 | **make the answer machine-readable** | Structured output, schemas, the repair ladder. | Run it as **text** first — the Split chokes. Switch to **json**, paste the schema, run again, read **Got**. | The runtime asked with a schema, the model half-obeyed, and the repair extracted the object — you can watch it happen. |

**Shelf "going further" — Act III, control, judgement, cost**

| # | Title | Idea | You DO | Aha |
|---|---|---|---|---|
| 8 | **a human in the loop** | Dialog and Confirm. | Run it and answer the dialog. Run it again and say **no** at the Confirm. | Saying no cost **zero generations**. Pausing is a feature, not a failure. |
| 9 | **judgement, and a branch** | The model as a classifier; Condition Yes/No/Maybe. | Run the **same** input three times. | It doesn't always answer the same. That's why **Maybe** exists and why the uncertain branch hands it to a person. |
| 10 | **a loop that stops** | Cycles via Toggle; the ceilings as a hard floor under you. | Flip the Toggle off and pull data through it. Then remove the brake on purpose and watch the cap stop the run. | The Toggle lets data through without causing a loop. A runaway graph cannot spend the farm, and it tells you **which parts spent it**. |
| 11 | **what a thought costs** | Cost, caching, seats, etiquette. No new parts. | Run lesson 4's graph. Run it again unchanged: **mostly cached, near-free.** Then start a generation in LOL Chat and press Run. | Your run paused instead of jumping the queue, and kept everything it had paid for. That is the difference between a tool and a nuisance on a shared farm. |
| 12 | **build one yourself** | Composition. | A brief: *"Take a project brief. Produce three design concepts, pick the strongest with a judged branch, and render a p5 sketch of it."* | You can now read the studio's real research graph — and extend it. |

**Why this order.** 1–3 gets a learner to "I made the machine do a thing" in under ten minutes (the
retention cliff). 4 is the owner's own use case, arriving early enough to feel earned. 6 and 7 are where
"chat" becomes "program". 8–10 are the three ways a workflow acquires agency (ask, judge, repeat), each
shipping with its own brake. 11 exists because this is a **shared** farm and politeness must be taught,
and it teaches best right after lesson 10 scared them.

### 10.4 First run

Not a modal. The library sidebar is open and empty; the canvas area holds one centred, calm panel:

> ### The Computer
> A canvas where you wire small programs out of notes, instructions and the model on your farm.
> *Everything stays on this machine. Every thought happens on **Studio Farm**.*
>
> **[ Take the tour ]** 90 seconds · no model needed
> **[ Start lesson 1 ]** hello, farm · 4 minutes
> **[ New blank canvas ]**

Below it, four template cards with tiny graph thumbnails, and a quiet line: *"12 lessons · 8 templates ·
your graphs stay in this app"*. Top-right, the **farm chip**: `Connected · Studio Farm · gemma4:12b` /
`Looking for a farm…` / `No farm found — the tour and most lessons still work`. Discovery status is stated
here, once, plainly, because "why is nothing happening" is the #1 first-run failure on a LAN tool.

**The empty canvas is never blank:** a dotted grid; a **ghost trio** at centre (`Note → Instruction →
Preview` at 30 % opacity with its wires) that materialises, wired, on one click with the instruction
focused; and one hint line: *"Double-click the canvas to add a part · press ? for keys"*.

### 10.5 Templates (K5, eight)

All studio-shaped, all runnable on one gemma4:12b, all inside the 50-generation cap, all shipping with
their labels pre-written (**the labels are the teaching**) and a pinned "what to change first" note.

1. **Research → problematic → concepts** — the owner's own graph, generalised. ~9 generations.
2. **Moodboard reader** — N images → vision Instructions labelled `palette`/`materials`/`composition`/
   `mood` → an art-direction one-pager → a Code box emitting an SVG swatch strip.
3. **Reference → three.js sketch** — a reference image + a brief → a json scene description → Code
   (three.js) → Preview. The most directly useful thing in the pack for this studio.
4. **Brief triage** — a classifier → Condition Yes/No/Maybe → auto-summary / a Dialog / a Confirm.
5. **Shot list from a script** — Split by scene → fan-out → Collect → a markdown table. It will hit the
   cap on a long script, **on purpose**, with the raise door right there.
6. **Blender-ready asset brief** — a concept → json against a schema a 3D artist needs → an HTML spec sheet.
7. **Critique loop** — Toggle → critique → revise → back, with a Timer between rounds.
8. **UI string localiser** — fan-out → json per string → Collect → a table. Dull, useful, and the cheapest
   possible demonstration that caching makes the second run nearly free.

Plus one canvas **action** (not a template): **Explain this graph** — one Instruction fed the serialized
doc, writing a plain-language description into a new note. One generation, and the fastest way for a
learner to check their mental model against the machine's.

---

## 11. Phases

Every phase: **kickoff** (integrator: contracts, catalogue/loader rows, strings, mock, harness wiring,
committed before units start) → **units in parallel** → **landing** (integrator: wire the shared files,
run the gates, screenshots both themes, DEVLOG entry, rig-checklist additions).

**Gates at every landing:**
```bash
node shell/test/chat-unit.js && node shell/test/unit.js && node shell/test/chat-lint.js && \
node shell/test/chat-scope.js && node shell/test/chat-harness/run.js --strict && \
node shell/test/chat-harness/run.js --strict --phase perf
```

---

### K1 — the third surface and the library  ·  **MUST-HAVE CORE**

**Goal.** The owner opens the client, clicks **Computer** in the topbar, and gets a standalone canvas with
a library of graph documents. Every existing part still works, runs, exports and imports. Their old
per-thread graphs are there. The chat is untouched and the Computer panel is gone from the workbench.

**Kickoff (integrator, before units):**
1. `index.html`: the `.viewseg` segmented control, `<section id="lolcomputer" class="chat-layer hidden">`
   (**the `chat-layer` class is load-bearing** — §2.1), the third module script. **CSP meta byte-identical.**
2. `app.js`: the switch of §2.2, **keeping `// OWUI is the primary surface` byte-identical as the first
   line of the IIFE**, **keeping the null guard**, and adding `document.body.dataset.view`.
   **`publishFarm` is not touched** and `renderSidecar` is not touched (§2.2a).
3. `chat-scope.js`: the second allowed `app.js` span, plus a `--self-test` case that a hunk above
   `publishFarm` is still flagged. Re-read `extract-app-bridge.js` and confirm the anchor still matches.
4. `styles.css`: `.viewseg`, `#lolcomputer`, **and the `body[data-view]` overlay/webview overrides of
   §2.2a** — this is what keeps the OWUI overlay off the Computer without editing `renderSidecar`.
5. **The CSS re-scope**, one mechanical edit, **`css/graph.css` only**: `#lolchat ` →
   `:is(#lolchat, #lolcomputer) `, **106 hits, count asserted**. `base.css` and `sandbox.css` are not
   touched (§3.2).
6. `computer/main.mjs` (the loader, §3.3), `computer/boot.mjs` (the spine, the **three-event** bus mirror,
   the single `caps` install, the single drop guard), `computer/layout.mjs`, `computer/computer.css` (the
   `@import` list of §3.6), `css/computer-tokens.css` + `css/computer-shell.css`.
7. `strings/computer.en.mjs`.
8. `graph/parts/index.mjs`: `fromThread`/`toThread` out of the palette, still in `specMap()`; `render`
   kept, aliased in the palette to `preview` at K4.
9. Harness: `page.html` gains `<section id="lolcomputer" class="chat-layer hidden">` and the third script
   (**CSP byte-identical**); `helpers.js` gains `h.view(name)` — which flips the two section classes, the
   only thing the harness page can do, since it has no topbar and never loads `app.js` (§0.3) — and
   re-points `h.graph.*` at `window.LolComputer.debug.computer` and `#lolcomputer .graph-*`;
   `h.work('computer')` is deleted and `perf-graph.mjs`'s three calls are re-homed.
10. `chat/main.mjs`: the `computer` loader row removed; `PHASE = 'K1'`.
11. `net/governor.mjs`: the `freeSeat()` amendment of §3.5 + two `governor.test.mjs` cases.

#### K1-U1: the surface, the app and the spine

Files owned: `computer/{host,docstore}.mjs` · `graph/canvas.mjs` (**the five `session.thread()` sites
only**) · `graph/parts/file.mjs` · `shell/test/chat/unit/computer-surface.test.mjs` ·
`shell/test/chat-harness/scenarios/k1-surface.mjs`

**Spec.**
- `host.mjs` is `graph/panel.mjs`'s `createSession` + `create()` body, re-homed: it owns the session, the
  undo stack, the runner, the canvas, the sandbox, and the `debug` door. **No `SLOTS.WORKBENCH_PANELS`,
  no `resolveThread`, no `installCodeBridge`.**
- **`session.thread()` is a compat shim returning `null`, not a deletion** (revision 2, §3.2). It has
  seven callers this unit does not want to rewrite — `runner.mjs:371` passes `thread:` into **every**
  `spec.run()`, and deleting the method would make every part run throw. The shim keeps `runner.mjs`
  untouched and makes the legacy From/To-thread parts fail with their one sentence for free.
- `canvas.mjs`'s five sites **are** re-pointed here: `:529` copy, `:629` paste and `:1004` toolbar mean
  "is there a document" and become `session.docId()`; the **export (`:689`) and import (`:733`) guards
  are deleted** — a library document has no thread, and K1-U2's export/import acceptance depends on
  their absence.
- `docstore.mjs` per §7.1. **The `!doc.threadId` early returns are the bug being fixed** (§0.3).
- The **`visible` rule** of §2.3 as narrowed in revision 2:
  `app.state.visible = shown || runner.executing()` — **not** `running()`, so a run parked on a Dialog
  does not hold a seat open. Owned by `computer/main.mjs`, asserted here.
- `parts/file.mjs`: its scratch project is keyed by **graph id**.
- `graph/panel.mjs` and `graph/store.mjs` are **deleted** at the landing, not by this unit.

**Acceptance.** *(Revision 2: the two scenarios about the topbar are gone. `chat-harness/page.html` has
no topbar, no `.viewseg` and no `<webview>`, and never loads `app.js` — segments, `aria-pressed`, the
webview's survival and `localStorage['lol:view']` are assertions about code the harness never executes.
They are rig items §13.1–4 instead, and the harness gates what it can actually see.)*
- `chat-unit.js computer-surface`: `docstore` writes and reads a `threadId:null` doc; `list()` excludes
  thread-owned rows; `create/rename/duplicate/remove` round-trip; **the visible predicate is true while an
  activation executes, false while the run is parked, false when hidden and idle**; `session.thread()`
  returns `null` and `session.docId()` returns the open document.
- Harness `k1-surface`:
  - `k1-surface-mount`: `h.view('computer')` flips the classes; `window.LolComputer.ready` resolves; the
    canvas mounts inside `#lolcomputer`; `#lolchat` is hidden and still in the DOM.
  - `k1-surface-two-apps`: `window.LolChat.app !== window.LolComputer.app`, and
    `window.LolChat.app.repo === window.LolComputer.app.repo` and the same for `farm` and `gov`.
  - `k1-surface-ask-not-hidden`: with `#lolchat` hidden, a Computer Instruction runs and **does not**
    refuse with `busy`. *(This is the scout's Risk 1 and the single most important scenario in K1.)*
  - `k1-surface-no-seats`: a Computer run succeeds against a mock farm advertising **no seats**
    (the §3.5 governor amendment).
  - `k1-surface-mirror`: a farm update emitted on the chat's bus reaches the Computer's bus as
    `FARM_CHANGE` **and** `FARM_TICK`, and `app.farm.cap()` answers on the Computer.
  - `k1-surface-park-idle`: a run parked on a Dialog leaves `app.state.visible` false while hidden.
  - `k1-surface-copy-export`: copy/paste and export/import work with **no thread at all** (the
    `session.thread()` shim and the deleted guards).

#### K1-U2: the library sidebar and the migration

Files owned: `computer/{library,migrate}.mjs` · `css/computer-library.css` (its **own** sheet, §3.6) ·
`ui/transfer.mjs` (the `accept` string only) ·
`shell/test/chat/unit/computer-library.test.mjs` · `scenarios/k1-library.mjs`, `scenarios/k1-migration.mjs`

**Spec.**
- The sidebar of §3.4: cards with title, part count, last-run time; **＋ New**; search; rename (inline),
  duplicate, delete (confirm), **Export…** / **Import…** (the existing `canvas.exportText/importText`
  minus the thread guard; `ui/transfer.mjs` `accept` gains `.lolgraph.json`).
- `kv 'computer:lastGraphId'`; the sidebar width in `kv`.
- `migrate.mjs` per §7.2, **copy + stable derived id + `threadId:null`**, verdict on
  `window.LolComputer.migration`.

**Acceptance.**
- `chat-unit.js computer-library`: the migration is idempotent across two runs (n rows, not 2n); a row
  whose thread is gone still migrates with a fallback title; a row already migrated is skipped by derived
  id; the kv marker gates the whole thing.
- Harness `k1-library`: create three graphs, rename one, duplicate one, delete one, reload → the list is
  right and the last-opened one reopens. Export → import → the same parts and wires, new ids.
- Harness `k1-migration`: seed two thread-owned graphs + one thread that is then **deleted** → after
  migration the library has both, and `repo.deleteThread` on the surviving thread does **not** remove the
  library copy. *(The scout's Risk 4, both halves.)*

#### K1-U3: the run bar, the drawer host and the legacy demotion

Files owned: `computer/{runbar,drawer}.mjs` · `graph/inspect.mjs` (host argument only) ·
`graph/parts/{from-thread,to-thread}.mjs` (legacy badge + refusal) ·
`css/computer-runbar.css` + `css/computer-drawer.css` (its **own** sheets, §3.6) ·
`shell/test/chat/unit/computer-drawer.test.mjs` · `scenarios/k1-runbar.mjs`

**Spec.**
- The run bar of §8.3, minus the parts K3 adds (plan range, waits): **Run all · Stop · N parts · N
  generations · the cap meter · zoom · `?`**.
- `drawer.mjs`: the right-hand drawer hosting `inspect.mjs`'s pure renderers. Escape closes; one at a
  time; resizable; width in `kv`.
- `from-thread`/`to-thread`: a `legacy` badge, and `run()` fails with one sentence.

**Acceptance.**
- `chat-unit.js computer-drawer`: `bodyText`/`headingText` unchanged against the existing fixtures.
- Harness `k1-runbar`: Run all on a three-part graph announces `3 parts`; Stop mid-run leaves values and
  puts the running part `stale`; the drawer opens on a value chip and closes on Escape; a migrated
  `from-thread` part shows the badge and fails with a sentence, and the rest of the run continues.

**K1 landing.** Delete `graph/panel.mjs` and `graph/store.mjs` (and `chat/unit/graph-store.test.mjs`);
remove the `computer` row from `chat/main.mjs`; remove `installCodeBridge` and its two registry rows from
`parts/code.mjs`; then the **harness re-point task of §3.7** — its own reviewed pass, with the per-file
verdict table, ~470 call sites, and a DEVLOG paragraph naming **BH-1, BH-6 and BH-7 as retired
guarantees** (the named §2.6 exception; everything else is amended, never loosened). Assert the graph.css
rewrite count (106). Gates. Screenshots both themes. DEVLOG.

> **After K1 the owner has a usable product**: a standalone Computer with a library, all eleven existing
> parts, Run-all, export/import, and their old graphs.

---

### K2 — arrow labels and the Instruction  ·  **MUST-HAVE CORE**

**Goal.** The owner can rebuild their own research graph exactly as they drew it: six labelled arrows out
of a topic note, six research Instructions, a convergence Instruction whose prose names
`societal research` and gets it. And they can **read the prompt before spending a generation**.

**Kickoff (integrator):**
1. `core/types.mjs`: `GraphWire.label`; `GraphValue.format`/`lang`; the `bind.mjs` typedefs.
   `API_KEYS.graphDebug` gains `label`, `preview`.
2. **The whole facet contract, in one commit** (revision 2, §6.8): `values.mjs` `valueOf` carries
   `format`/`lang`; `model.mjs` `normalisePart` stops stripping a value to `{kind, data}`;
   `serialize.mjs` writes and reads them. Revision 1 split this across K2-U1 and K4-U2, which left K2's
   own `text/code` fencing depending on a facet K4 had not shipped and gave K4-U2 an acceptance criterion
   about a line it did not own.
3. `chat-lint.js` `PURE_MODULES` gains `graph/bind.mjs`.
4. `strings/parts.en.mjs`: the Instruction's new strings (chips, truncation, no-vision).
5. `serialize.mjs`: `FORMAT_VERSION = 2`. **The `version > FORMAT_VERSION` refusal stays** (§7.6); only
   its sentence changes.
6. `css/computer.css` gains the `@import` for `css/computer-transcript.css` (K2-U3's own sheet).
7. Mock: a `mock-echo` variant that reports the assembled prompt's headings back, so a scenario can
   assert the wire body without a real model.

#### K2-U1: `wire.label` through the engine and the canvas

Files owned: `graph/{model,serialize,wires,canvas}.mjs` (label only) ·
`shell/test/chat/unit/computer-label.test.mjs` · `scenarios/k2-labels.mjs`

**Spec.**
- `model.mjs`: `label` on the wire; `addWire`/`setWireLabel` (undoable, `rev`-bumping, stales `to` and
  downstream); `normaliseDoc` cleans it. *(The facet half of `normalisePart` is the kickoff's, item 2.)*
- `wires.mjs`/`canvas.mjs`: the label pill of §8.2 — editable in place, dashed `name me` when empty,
  drawn on the existing SVG layer with no extra per-part work (the perf gate must not move).
- `serialize.mjs` v2. **The newer-version refusal is kept**, with §8.4's sentence.
- `topo.mjs`: unchanged in this unit.

**Acceptance.**
- `chat-unit.js computer-label`: `key()`/`name()` normalisation (case, runs of spaces, empty→unlabelled);
  a label edit stales `to` and downstream and bumps `rev`; a move does not; v1 round-trips; a v2 file
  keeps labels **and facets**; **a `version:3` file is REFUSED with `unsupported-version` and nothing is
  imported** (revision 2 — revision 1 asked for import-with-warning, which is the quiet loss §1.3 rule 4
  bans).
- Harness `k2-labels`: draw a wire, type `societal research` into the pill, reload → it is still there;
  the downstream Instruction went `stale`; **`perf-graph` still passes** (re-homed at the K1 landing;
  there is no `perf-computer.mjs` — revision 2).

#### K2-U2: `bind.mjs` and the Instruction part

Files owned: `graph/bind.mjs` · `graph/parts/instruction.mjs` (replaces `ask.mjs` wholesale) ·
`shell/test/chat/unit/computer-bind.test.mjs` · `shell/test/chat/fixtures/bind/**` · `scenarios/k2-instruction.mjs`

**Spec.** §5.2 (the nine rules), §5.3 (the exact prompt), §5.4 (the budget), §6.3.

**Acceptance.**
- `chat-unit.js computer-bind` — **the most important test file in the build**, one case per rule:
  unlabelled → `## Input 1`; two `research` arrows → one heading with `### 1` / `### 2` **in wire order**;
  a duplicated label does **not** fan; an unused label is supplied last and reported; a mentioned-but-
  unwired name is reported and is not an error; mention detection at phrase boundaries, and not inside a
  longer word; `{topic}`/`$topic` replaced by the bare word; parameter order = first mention, then
  unmentioned, then unlabelled; an empty value keeps its heading with `*(empty)*`; each kind/format's
  rendering; an image is **not** in the text and **is** in `images`; over-budget → middle-out per input,
  proportional, marked, headings surviving; inline substitution on/off.
- Harness `k2-instruction`: the owner's Graph B in miniature against `mock-echo` — three labelled notes
  into one Instruction whose prose names two of them → the echoed body carries `## societal research`
  before `## environmental research` (first-mention order) and the unnamed one last; the box shows
  `unused: country`; a farm with `vision:'no'` plus a wired image → the box says `errNoVision` and names
  the farm, and **no request went out**.

#### K2-U3: the transcript drawer

Files owned: `computer/transcript.mjs` (the three tabs, mounted *into* K1-U3's drawer through its
`mountPanel(name, node)` door — **not** an edit of `drawer.mjs`) · `css/computer-transcript.css` ·
`shell/test/chat/unit/computer-transcript.test.mjs` · `scenarios/k2-transcript.mjs`

**Spec.** §8.1. The **Sent tab works before a run** — unresolved inputs render `⟨topic — has not run yet⟩`
and the assembly is the same `bind.mjs` call, so what you read is what will be sent.

**Acceptance.**
- `chat-unit.js computer-transcript`: the pre-run placeholder rendering; the repair-ladder summary from a
  recorded `ask` result; the cost line's fields.
- Harness `k2-transcript`: open Sent on an Instruction that has never run → the prompt with placeholders;
  rename a wire → the drawer updates live; run → **Got** shows the raw reply and **Cost** the tokens;
  Escape closes.

**K2 landing.** `parts/index.mjs` swaps `ask` → `instruction` (same type id). Gates, screenshots, DEVLOG.

> **Stopping here is a real product**: a standalone canvas with a library, markdown notes, labelled
> arrows, instructions that bind them, code and SVG, a prompt you can read before you pay for it, and
> export/import.

---

### K3 — push play, control flow, loops  ·  **MUST-HAVE CORE**

**Goal.** It becomes an agent canvas: ▶ on any box, six control parts, loops that cannot run away, a run
journal, and a run bar that tells the truth before and after.

**Kickoff (integrator):**
1. `core/types.mjs`: `STATES` += `waiting`; the `bar` return shape on `PartSpec.run`; `manual`/`volatile`
   spec flags; the `RunJournal` typedef; `API_KEYS.graphDebug` gains `runFrom`, `journal`, `waits`.
2. `model.mjs:146`: the `running`/`queued` → `stale` mapping grows `waiting` (§0.3 — a separately
   verified line, and the kickoff's so no unit contends for it).
3. `graph/parts/index.mjs`: the six control rows (files land from U2).
4. `strings/parts.en.mjs` + `strings/computer.en.mjs`: the control parts, the four ceilings, the waits.
5. `css/computer.css` gains the `@import`s for `computer-parts.css` (U2) and `computer-states.css` (U3).
6. Mock: a scenario model that answers `yes`/`no`/`maybe` on demand, for Condition's model mode.

#### K3-U1: the scheduler and the journal

Files owned: `graph/{runner,topo}.mjs` · `graph/journal.mjs` ·
`shell/test/chat/unit/computer-sched.test.mjs` · `scenarios/k3-sched.mjs`

**Spec.** §4.2–§4.4, §4.6's ceilings and back-edge order, §4.8, §7.3–§7.5.
`topo.mjs` gains `forwardEdges(doc)`, `backEdges(doc)`, `gatedLoop(doc, cycle)`, `activeSet(doc, seeds,
opts)`, `manualRoots(doc, specs)`, and `runPlan` returns a **range** when loops exist.

**Acceptance.**
- `chat-unit.js computer-sched`:
  - **push, asserted by its properties, not by a tautology** (revision 2 — "`activeSet('from',[s])`
    equals `runSet(markStale(doc,[s]))` restricted to the closure" asserts `f(x) === f(x)` if `mode:'from'`
    *is* that expression, which §4.2 insists it is). Over 20 generated DAGs:
    (a) **nothing upstream of the seed runs** unless the §4.2 prologue pulled it, and then it runs exactly
    once and only because it held no value; (b) a part reachable from the seed **only** through a barred
    edge does not run; (c) a `done` part inside the closure **does** re-run; (d) a `manual:true` part
    inside the closure does **not**; (e) the prologue is idempotent — a second ▶ on a warm graph pulls
    nothing;
  - **`cacheSalt` on iterations**: a loop's second and later activations of a thinking part pass
    `cacheSalt: <iteration>`, spend against the cap, and therefore reach `maxGenerations`; iteration 1 is
    unsalted, so re-running a settled graph is still near-free;
  - **a back edge with no value contributes nothing** rather than refusing the part, and a loop head with
    one forward input runs on iteration 1;
  - Run-all does not re-run an input-less `done` source; `force:true` does; `manual:true` is never in `A`;
  - merge mid-run: a seed behind the cursor is picked up; a completed part is re-queued; a running part
    is re-queued on completion;
  - `bar`: a part reachable by a second unbarred path keeps running; barred parts go `stale`, not `error`;
    **`gather()` reads straight through a barred part**;
  - back edges: `order()` ignores them; a loop head never waits; the unit-delay value is the previous
    iteration's;
  - each of the four ceilings stops the run, names the part, and is raisable for that run;
  - a timer plan whose summed waits exceed `maxWallMs` is refused **at plan time**, with the arithmetic;
  - the journal: a ring of 200 events, 5 runs pruned, `waiting` status written, resume semantics.
- Harness `k3-sched`: ▶ on a mid-graph box runs it and everything downstream and **nothing upstream**;
  a second ▶ during a run merges; Stop returns everything to `stale` with values kept; reload mid-run →
  the resume banner, and Resume costs only the unfinished part.

#### K3-U2: the six control parts and the loop rules

Files owned: `graph/parts/{button,condition,confirm,dialog,toggle,timer}.mjs` ·
`graph/model.mjs` (`wireRefusal` → `back:true` + `loop-ungated` only) ·
`shell/test/chat/unit/computer-control.test.mjs` · `scenarios/k3-control.mjs`

**Spec.** §6.6 and §4.6's first two bullets.

**Acceptance.**
- `chat-unit.js computer-control`: Condition's text classifier table, **including "anything unmatched →
  maybe"**; a self-wire is still refused; a cycle is created with `back:true`; a cycle with no gate is
  refused `loop-ungated`; the owner's lesson-11 loop (`state → Toggle → Instruction → state`) is accepted;
  Toggle off bars and still publishes; Dialog `askEveryRun:false` is satisfied by a stored value and
  `true` is not; Timer's `repeats` clamp.
- Harness `k3-control`: the lesson-9 fan (one Instruction → three Conditions → three Confirms) — exactly
  one branch continues and the other two wires grey; a Confirm parks and **the other branch keeps
  running**; Cancel ends that branch and the report counts `barred`; two Dialogs wait at once and the bar
  says `2 questions waiting`; the text-adventure loop with the Toggle **off** advances exactly one step
  per ▶, and with it **on** stops at `maxIterations` with the ceiling named.

#### K3-U3: per-box ▶, the run bar, and the canvas states

Files owned: `graph/canvas.mjs` (▶, states, colour, the travelling dot) · `computer/runbar.mjs` ·
`css/computer-states.css` · `scenarios/k3-canvas.mjs` · `scenarios/perf-graph.mjs` (**extended, not
replaced** — revision 2: there is no `perf-computer.mjs`; `perf-graph.mjs` was re-homed to
`h.view('computer')` at the K1 landing and gains the 200 labelled wires here)

**Spec.** §8.2 (colour is the type system), §8.3, §8.4's table, and the plan preview's range.

**Acceptance.**
- Harness `k3-canvas`: ▶ in every part's title bar; the queued/running/waiting/stale/error looks are
  distinguishable by `data-state`; a barred wire is `data-barred`; the run bar shows the range on a looping
  graph; the cap meter turns amber past 80 %; every §8.4 message appears with its action button.
- Harness `perf-graph` (perf group, median of 3): 500 parts + 200 labelled wires — build ≤ 1500 ms,
  p95 pan work ≤ 16 ms, **0 parts transformed on pan**. The same three gates it has today, on the new
  surface, with the label pills added.

**K3 landing.** Gates, screenshots (a running graph, a parked Dialog, a barred branch, both themes),
DEVLOG, rig items.

---

### K4 — images, previews, and the look  ·  **TAIL (if the night goes well)**

**Goal.** Drop a screenshot on the canvas and ask about it. Write three.js and see it. And the surface
looks like the owner asked.

#### K4-U1: image intake and the Image part
Files: `computer/intake.mjs` · `graph/parts/image.mjs` · `shell/test/chat/unit/computer-intake.test.mjs` ·
`scenarios/k4-vision.mjs`. **Spec** §6.4. **Acceptance**: `fitWithin` golden numbers; a > 1 MB result is
refused by size with a sentence; **no `fetch`, no `createObjectURL`, no `blob:`** (lint proves it); the
drop guard still does not `stopPropagation`; a wired image reaches `ask({images})` and a `vision:'no'`
farm hard-errors without a request.

#### K4-U2: the Preview family
Files: `graph/parts/preview.mjs` (absorbs `render.mjs`) · `css/computer-parts.css` §preview ·
`shell/test/chat/unit/computer-format.test.mjs` · `scenarios/k4-preview.mjs`. **Spec** §6.5, §6.8.
*(Revision 2: `graph/values.mjs` and the facet contract are the **K2 kickoff's**, not this unit's — this
unit only consumes facets.)*
**Acceptance**: markdown and SVG render **with no iframe ever created** (`h.eval` counts them); html/three/p5
show a snapshot; "Open live" moves the single guest and opening a second closes the first; the Code part's
output format is the picker's, never sniffed; a `format` chosen in the picker survives save/reload/export.

#### K4-U3: the warmed-up look and the annotation parts
Files: `css/computer-look.css` (the whole of §9) · `graph/parts/{sticky,section,title}.mjs` ·
`scenarios/k4-shots.mjs`. **Acceptance**: `chat-lint` still reports **0 colour literals**; **the four
kind hues are measurably distinct in both themes and all five kinds carry their glyph** (revision 2 —
`--blue` is grey in this palette, so a five-hue gate would fail honestly; colour + glyph is the
contract); sticky/section/title never enter a run set and never appear in the plan; the shots scenario
measures before it photographs (nothing spills its frame, ports excepted).

---

### K5 — the tutorial and the templates  ·  **TAIL (if the night goes well)**

**Revision 2 — K5 is re-scoped, because it was the least bounded work in the plan and it is last.**
Twelve lessons plus eight templates, each hand-authored on a canvas, exported and pasted into ~21 data
modules, is not a one-night tail. The **shippable minimum is K5-U1**: the mechanic plus the Tour plus
lessons 1–3 (the ones that carry the whole idea) plus two templates. K5-U2 and K5-U3 are explicitly
**optional** and are written so that stopping between any two lessons leaves a coherent shelf — a lesson
is a data module and the registry lists what exists.

#### K5-U1: the mechanic, the Tour, lessons 1–3, two templates  ·  **the shippable minimum**
Files: `computer/tutorial/{rail,check,registry}.mjs` · `computer/tutorial/lessons/{00-tour,01-hello-farm,
02-wires,03-labels}.mjs` · `computer/templates/{research-problematic,moodboard-reader}.mjs` ·
`computer/welcome.mjs` · `strings/lessons.en.mjs` · `css/computer-rail.css` ·
`shell/test/chat/unit/computer-check.test.mjs` · `scenarios/k5-tutorial.mjs`.
**Spec** §10.1–§10.2, §10.4. `check.mjs` is **PURE** and in `PURE_MODULES`. `chat-lint` grows **rule 15**:
every lesson doc survives `normaliseDoc()`, every `check`/`show` names a part that exists, every `next`
resolves *or is absent on the last shipped lesson* (so a partial shelf still lints).
**Acceptance**: every matcher shape against fixture docs; a latched tick never un-ticks; a `manual` step
needs its button; the fork-on-first-edit and **Reset lesson**; the demo-pack fallback and the
`demo answer — not generated` badge, which is a part **flag** and therefore survives export with or
without values (§7.6); the harness walks the Tour and lessons 1–3 headlessly in demo mode.

#### K5-U2 *(optional)*: lessons 4–7 — the rest of "the basics"
Files: `computer/tutorial/lessons/{04-many-in-many-out,05-vision,06-code,07-json}.mjs` ·
`scenarios/k5-lessons-basics.mjs`.
**Acceptance**: the harness walks each lesson headlessly against the mock farm in **demo mode** and asserts
every checkpoint can be satisfied; the Tour and the authoring steps of 2, 3, 4 and 7 complete with the
farm **absent**.

#### K5-U3 *(optional)*: lessons 8–12, the remaining six templates, **Explain this graph**
Files: `computer/tutorial/lessons/{08..12}-*.mjs` · `computer/templates/*.mjs` ·
`scenarios/k5-lessons-further.mjs`. **Acceptance**: same walk; every template's plan preview is inside the
50-generation cap (or, for *Shot list*, deliberately over it with the raise door asserted); **Explain this
graph** costs exactly one generation and writes into a new note; leaving lesson 11 for LOL Chat and
returning preserves the step and the ticks.

---

## 12. What we are NOT building

- **No image, audio, speech or video generation.** Owner's decision; a ComfyQ bridge is a later
  conversation.
- **No Range, Switch, Website, Camera, 3D-Model or Data parts.** tldraw has them; the owner scoped them out.
- **No cloud model, no credit counter, no account, no sharing service.** Local only.
- **No live web fetching from a part.** `fetch` stays inside the five allowed modules.
- **No N live iframes.** One guest process; §6.5 is the answer.
- **No new IndexedDB version.** The journal rides `kv`; a `runs` store is a later upgrade.
- **No chat↔Computer bridge.** `from-thread` / `to-thread` are legacy; `installCodeBridge` is deleted.
- **No editing of Open WebUI, the farm, the farm app or the sidecar.** Untouched trees.
- **No new npm dependency and no renderer build step.** Vanilla ES modules, as today.
- **No hand-drawn tldraw identity**, no CSS injected into any webview, no colour literals.
- **No collaborative editing, no cloud sync, no versioned history beyond undo + export.**
- **No "forever" timer and no unbounded loop.** Four ceilings, always.
- **No spotlight-overlay tutorial**, no video, no generated-on-the-fly lesson.

---

## 13. Rig checklist — what the owner runs in the morning

On the real client, on this box and ideally on a second machine. Items marked **(C)** are the ones no
automated gate can prove.

**§0 — the surface.** *Items 1–4 carry more weight in revision 2: the harness page has no topbar and
never loads `app.js`, so the segmented control, `aria-pressed`, the webview's survival and the persisted
choice are **only** provable here (§0.3, K1-U1).*
1. Launch the client. The topbar shows three segments, `aria-pressed` on Open WebUI. **(C)**
2. Click **Computer** *while OWUI is still booting*. The canvas appears and **"Starting Open WebUI…"
   does not cover it**; when the sidecar finishes, the webview does **not** pop over the canvas either.
   *(§2.2a — this is the bug the `body[data-view]` CSS exists to kill, and launch is when it bites.)* **(C)**
3. Click **Open WebUI**: still logged in, instant, not re-authenticated. **(C)**
4. Quit and relaunch: the client comes back on **Computer**. **(C)**
5. In a `NO_OWUI` build the OWUI segment is absent and the client starts on LOL Chat. **(C)**

**§1 — the library and the migration**
6. The library lists your old per-thread graphs, titled `From: <chat title>`. Open one: the parts are
   there; `from-thread` parts carry a `legacy` badge. **(C)**
7. Delete the chat those graphs came from in LOL Chat. Return to the Computer: **the library copy is
   still there.** *(This is the destructive bug the migration exists to avoid.)*
8. New graph → rename → duplicate → delete → reload. The list is right.
9. Export a graph, import it into a new one: same parts and wires, new ids, no farm address and no key in
   the file. **(C)**

**§2 — arrow labels (the headline)**
10. Rebuild your own research graph: one topic note, six labelled arrows, six research Instructions, one
   convergence Instruction naming them in its prose. **(C)**
11. Before running the convergence, open **Sent**. Read the assembled prompt: every `##` heading is your
    own spelling, in first-mention order, the instruction last. **(C)**
12. Rename one wire. The Sent tab changes live and the box goes `stale`.
13. Run it. Count the generations in the run bar against what the plan preview predicted.
14. Run it again unchanged: mostly cached, near-free. **(C)**

**§3 — control flow**
15. ▶ on a mid-graph box: it and everything downstream run; nothing upstream does.
16. Press ▶ on a second box while the first is running: it merges, nothing is refused.
17. Build the lesson-9 fan: one Instruction → three Conditions → three branches. Exactly one continues;
    the other two wires go grey. **(C)**
18. A Confirm parks: say no. **Zero generations spent.** Say yes on a second run: the branch continues.
19. Draw a loop with no gate: it is refused with the Toggle suggestion. Add a Toggle: it is drawn dashed.
20. With the Toggle **on**, let it run away: it stops at `maxIterations` and names the part. **(C)**
21. Start a generation in LOL Chat while a graph run is going: **the run yields** and keeps what it paid
    for. Press Run: it resumes free. **(C)** *(The etiquette item. Do this on the real farm.)*
22. Kill the app mid-run. Relaunch, open the graph: the resume banner, and Resume re-pays for at most one
    call. **(C)**

**§4 — images, previews, look**
23. Drop a screenshot on the canvas, label the wire `screen`, ask *"list every affordance"*. **(C)**
24. On a farm serving a non-vision model, the same graph says so and sends nothing. **(C)**
25. Ask for p5.js, preview it, then "Open live". Ask for code that calls `fetch()`: it fails in the
    sandbox and says why. **(C)**
26. Toggle the theme. Both look right; the five kind colours are still distinguishable. **(C)**

**§5 — the tutorial**
27. First run on a fresh profile: the welcome panel, the farm chip telling the truth about discovery. **(C)**
28. Take the Tour with the farm **off**. It completes.
29. Do lesson 3 end to end. The ticks appear when you actually do the thing. **(C)**
30. Do a farm-needing lesson while the farm is busy: the demo answer offer, the honesty badge, the lesson
    continuing. **(C)**
31. Leave a lesson halfway, go to LOL Chat, come back: the progress ring and the right step. **(C)**

**§6 — the things that must not have broken**
32. LOL Chat still works end to end: send, stream, branch, settings, export.
33. Open WebUI still boots, still chats, still has your history.
34. `node shell/test/chat-harness/run.js --strict` and `--strict --phase perf` are green on this box.

**§7 — the things revision 2 added**
35. Import a `.lolgraph.json` you hand-edit to `"lolgraph": 3`. It is **refused** with the "newer
    version" sentence and nothing appears — not a half-imported graph. **(C)**
36. Press ▶ on an Instruction in a **freshly imported template**, before running anything else. It pulls
    its own ancestors and answers, rather than saying "needs an input". *(The §4.2 prologue.)* **(C)**
37. Run template 7 (**Critique loop**) with the Toggle on. Each round is a **different** critique, the
    generation meter climbs, and it stops at a named ceiling. *(The `cacheSalt` rule — without it every
    round returns the identical string for free and nothing ever stops.)* **(C)**
38. Open a graph with a Dialog, press Run, and **walk away without answering**. Switch to Open WebUI and
    chat: your chat is not refused, and the graph run has not eaten a seat. **(C)**
39. Export a graph with **Include results** unticked, open the file: no part values, and **no Dialog
    answer**. Export it ticked: the values are there and any `demo answer` badge survived both times. **(C)**
40. Squint at a graph carrying all five kinds. You can tell them apart — by colour **and** the port
    glyphs (`T ≡ {} ▣ ⎘`) — in dark and in light. **(C)**

---

## 14. Open questions for the owner

1. **The governor amendment (§0.5).** Today a farm that advertises no seats can never run a
   background call, which would make the Computer unusable on such a farm. The plan allows the single
   background slot when seats are unknown and the foreground is idle. Confirm — the alternative is to run
   the Computer in the *foreground* lane, which is strictly less polite to a colleague chatting.
2. **The `visible` rule (§2.3), narrowed in revision 2.** A run keeps its seat while you look at another
   surface in the same window — but **only while it is actually executing**; a run parked on a Dialog or a
   Confirm goes idle like anything hidden, and parked time counts against the 10-minute ceiling. Confirm
   that narrowing (the alternative, holding a seat for an unanswered question, is what the hidden-means-
   idle rule exists to prevent).
3. **Image bytes inline (§0.5, §6.4).** 1 MB cap per image, inside the document. A moodboard graph with
   eight references is ~4–6 MB in IndexedDB and in the exported file. Acceptable, or should images go to
   the `attachments` store with only a ref and a thumbnail in the doc?
4. **`Note` type id.** The Instruction keeps the type id `ask` so old graphs load. The palette says
   "Instruction". Confirm that the mismatch stays internal rather than costing a migration.
5. **K4/K5 ordering.** If the night runs short, would you rather have **images + previews (K4)** or **the
   tutorial (K5)**? The plan assumes K4 first because it unblocks your own moodboard work; the tutorial is
   the thing that makes it teachable.
6. **The eight templates (§10.5)** are named but not yet drawn. Any you would drop, and is *Research →
   problematic → concepts* faithful enough to your own graph to ship as the flagship? Revision 2 ships
   **two** of them in K5-U1 (*Research → problematic → concepts* and *Moodboard reader*) and makes the
   other six optional — say if you would rather have different two.
7. **K5 re-scoped (revision 2).** Twelve hand-authored lessons was not a one-night tail. The shippable
   minimum is now the mechanic + the Tour + lessons 1–3 + two templates, with 4–12 explicitly optional.
   Confirm that a three-lesson shelf that *says* it is three lessons is better than twelve half-built ones.
8. **The type glyphs (§9).** `--blue` in `tokens.css` is identical to `--accent` and to a grey in both
   themes, so five kinds cannot be told apart by hue in this palette. Revision 2 uses four hues **plus a
   one-character glyph** on every port and chip (`T ≡ {} ▣ ⎘`). Confirm — the alternative is adding a real
   blue to `tokens.css`, which is a shell-wide change and out of scope here.
9. **Retired test guarantees (§3.7).** Deleting the chat↔Computer bridges retires **BH-1, BH-6 and BH-7**
   from the suite. They are recorded by name in the DEVLOG rather than quietly dropped. Confirm that is
   the right trade for B2 ("it does not need to communicate with the chat").

---

## 15. Revision notes (revision 1 → revision 2)

A critic read revision 1 against the tree. Every finding below was checked against the source before it
was accepted or rejected; the line references are in §0.3, which grew by twelve rows as a result.

### Accepted and applied

| # | Finding | What changed |
|---|---|---|
| 1 | `session.thread()` has seven callers (`runner.mjs:371`, `canvas.mjs:529/629/689/733/1004`) and K1-U1 deleted it while owning neither file — every part run would have thrown. | §3.2, K1-U1: `thread()` becomes a **compat shim returning `null`** (so `runner.mjs` is untouched), and K1-U1 now **owns `canvas.mjs`'s five sites** — three become `session.docId()`, the export and import guards are deleted. |
| 2 | The CSS re-scope missed `base.css:19/20/37` (tokens, light override, **`.hidden`**) and named `sandbox.css`, which has zero hits. Nothing in the Computer tree would have honoured `.hidden`. | §2.1, §3.2: `<section id="lolcomputer" class="chat-layer">` — `base.css`'s own documented escape hatch — and the rewrite is **`graph.css` only, 106 hits, counted at the landing**. |
| 3 | `renderSidecar()` would put the OWUI overlay over the Computer at every launch, then un-hide the webview over it; and `renderSidecar` is outside both allowed `app.js` spans. | New **§2.2a**: `show()` stamps `document.body.dataset.view` and **`styles.css`** hides `#overlay`/`#owui` for non-`owui` views. `renderSidecar` is not edited, no third gate span, and the bug is fixed for LOL Chat too. New rig item 2. |
| 4 | Two K1-U1 scenarios asserted things the harness page cannot execute (no topbar, no webview, never loads `app.js`). | K1-U1's acceptance rewritten around what the harness can see; the segmented control, `aria-pressed`, the webview's survival and the persisted choice become **rig items 1–5**. |
| 5 | `net/farm.mjs` emits on one bus only, and installing `caps` twice clobbers the one shared `setCapResolver` — `errNoVision` was built on a verdict that would never refresh. | §2.3: the mirror carries **`GOV_CHANGE`, `FARM_CHANGE` and `FARM_TICK`**; the `caps` row leaves the Computer's loader table (§3.3) and `boot.mjs` installs it exactly once. New scenario `k1-surface-mirror`. |
| 6 | `__lolComputerRefresh` had no job and would double every `FARM_TICK`. | Deleted. **`publishFarm` is no longer edited at all**, which shrinks the scope-gate change to one span. |
| 7 | The ask cache makes every loop a fixed point: identical output, free, so `maxGenerations` never fires. | §4.6: **an activation with iteration index > 1 passes `cacheSalt: <iteration>`.** Iteration 1 stays unsalted so lesson 11's "run it again, near-free" still holds. Unit test + rig item 37. |
| 8 | Per-box ▶ fails with `errNoInput` on a fresh template, a forked lesson, or a reloaded graph — the headline button on first use. | §4.2: **the prologue** — `A = unrunAncestors(seed) ∪ {seed} ∪ downstream(seed)`. It is a pull, so a warm graph pays nothing. Rig item 36. |
| 9 | A back edge has no value on iteration 1, so every shipped loop errored immediately. | §4.6: **a back edge whose source holds no value contributes nothing** rather than refusing the part. |
| 10 | A parked Dialog held `visible` true forever, and parked time's relation to `maxWallMs` was unstated. | §2.3: `visible` is true only while an activation is **executing** (`runner.executing()`, not `running()`); **parked time counts against `maxWallMs`**, with its own error sentence. Rig item 38. |
| 11 | Two K1 units wrote `css/computer.css` in parallel, against §0.4's own rule. | New **§3.6**: one sheet per unit, `@import`ed by the integrator-owned `computer/computer.css`. Every unit's file list updated. |
| 12 | K2-U1 depended on `perf-computer.mjs`, which K3-U3 created; and `perf-graph.mjs` breaks at the K1 landing (`h.work`). | `perf-computer.mjs` **does not exist**. `perf-graph.mjs` is re-homed at the K1 landing and extended by K3-U3. |
| 13 | "Re-point the c1/c2/c3 scenarios" is ~470 calls across 15 files, one of which is invalidated outright. | New **§3.7**: a named integrator task with a per-file verdict table, and **BH-1/BH-6/BH-7 recorded as retired guarantees** in the DEVLOG — §2.6's named exception, not a parenthesis. |
| 14 | Turning `serialize.mjs`'s newer-version refusal into import-with-warning is the quiet loss §1.3 bans. | §7.6: **the refusal stays**; only the sentence changes (§8.4). K2-U1's acceptance inverted. Rig item 35. |
| 15 | The push ≡ pull test asserted `f(x) === f(x)`. | K3-U1: five **property** assertions instead (nothing upstream, barred-only unreachable, `done` re-runs, `manual` does not, the prologue is idempotent). |
| 16 | §4.5 recomputed reachability from the *original* seeds, so the first barrier after a merge dropped the merged parts. | §4.4/§4.5: the run keeps an **accumulated seed set `S`** and `bar` recomputes from `S`. |
| 17 | A Note that "replaces its text" had no legal write door — `patchPart` is runtime-only and `setSettings` is undoable and stales mid-run. | §6.2: **a run never writes the program.** The arriving text becomes the Note's **value**; the body renders the value when one exists, with a `↺ clear` action. |
| 18 | `format`/`lang` ownership was split across K2 and K4, and K4-U2's acceptance named a line it did not own. | The **whole facet contract moves into the K2 kickoff** (types, `values.mjs`, `normalisePart`, `serialize`). K4-U2 only consumes. |
| 19 | The rewritten `app.js` IIFE dropped today's null guard, which would take `setInterval(publishFarm, 4000)` down with it. | §2.2: the guard is kept, and why, in a comment. |
| 20 | "Never export a Dialog's answer" contradicted both the code and K5's demo badge. | §7.6 rewritten: export offers **"Include results"** (default on — today's behaviour, via `serialize.mjs`'s existing `{values:false}`), the demo badge is a part **flag** and survives either way. Rig item 39. |

### Optional improvements, accepted

- **The five kind colours would not have been distinguishable** — `--blue` is identical to `--accent` and
  to a grey in both themes. §9 now uses **four hues plus a per-kind glyph** (`T ≡ {} ▣ ⎘`), and K4-U3's
  gate measures four hues and asserts five glyphs. Open question 8 offers the alternative.
- **The `image` value shape** stays exactly `{dataUrl, name}` (§6.4); `w`/`h` are part settings.
- **§8.4's type-refusal sentence** no longer names an impossible action.
- **Escape precedence** is written as a four-rung ladder (§8.1).
- **`ctx/budget.mjs`** is named, with its real `DEFAULT_BUDGET`/`DEFAULT_RESERVE` fallback, and the
  badge says *assumed* when it fired (§5.4).
- **K5 is re-scoped** to a shippable minimum (mechanic + Tour + lessons 1–3 + two templates), with U2/U3
  optional. Open question 7.
- **The migration hash** is `core/ids.mjs`'s `hash()` (FNV-1a), cited, with collision behaviour stated
  (§7.2).
- **Which ceiling bites first** is stated, including the `8 × 250 = 2000` coincidence (§4.6).

### Rejected

Nothing in the critique was rejected outright. Two findings were **accepted with a different fix than the
one proposed**, and the difference is deliberate:

1. **Finding 3 (the overlay)** proposed making `renderSidecar()` view-aware and adding a third
   scope-gate span. **Rejected in favour of the CSS route** (§2.2a): `body[data-view]` overrides in
   `styles.css` need no gate change, no edit to a function the gate deliberately protects, and they fix
   the same latent bug for LOL Chat. Fewer moving parts in a file the harness slices by literal anchors.
2. **Finding 1 (`session.thread()`)** offered either a null-returning shim *or* adding `runner.mjs` and
   `canvas.mjs` to K1-U1. **Both, split:** the shim for `runner.mjs` (which only passes the value
   through to `spec.run()`, where the legacy parts already handle `null`), and real edits for
   `canvas.mjs` (whose two guards would otherwise silently break the export/import that K1-U2's
   acceptance depends on). A shim alone leaves export/import returning early; ownership alone means
   touching `runner.mjs` in K1 for no behavioural gain when K3-U1 rewrites it anyway.
