# LOL Chat Studio: build plan

> Status: **executable plan, revision 2** (after the owner settled §7 of the vision document).
> Date: 2026-09-16. Baseline: `lolchat/vnext` at `4fb3800` plus the landed P0–P2 working tree
> (P2 landed, fix rounds 1 and 2 green: `chat-unit` 472/0, harness `--strict` 101/0, perf 6/0,
> lint 0 over 74 files, scope clean over 179 paths — `LOLCHAT_PLAN.md` §2.6 **BC**).
>
> - Product decisions: [LOLCHAT_STUDIO_VISION.md](LOLCHAT_STUDIO_VISION.md). Every `R#` / `V#` / `C#` /
>   `D#` / `B#` id comes from there, and **where this plan and that document disagree, the vision
>   document wins** — except on the six points the owner settled on 2026-09-16, which are restated in
>   §7 below and are binding here.
> - The chat this builds on: [LOLCHAT_PLAN.md](LOLCHAT_PLAN.md) — its §0.2 (how phases, units and
>   integrators work), §1 (global rules), §2 (harness and gates), §2.6 (frozen contracts A…BC), §3
>   (architecture and contracts) and §4 (unit format) are **inherited whole**. This document states
>   only the deltas. Read it first; it is not optional context.
> - Human verification on real machines: §5 below — **additions only**. `LOLCHAT_RIG_CHECKLIST.md`,
>   `LOLCHAT_PLAN.md`, `LOLCHAT_VISION.md` and `LOLCHAT_DISCUSS.md` belong to the team that landed P2
>   and are **not edited by this plan** (one exception: §0.4).
>
> Owner's brief, 2026-09-15: *"it feels like we are reinventing owui with a different stack… I was
> hoping for vibecoding with a specific harness, we code in js and also make some esp32 stuff and
> arduino stuff, I was hoping for mind maps, tools for designers assisted with a local model."*

---

## 0. Read first

### 0.1 What this plan replaces

`LOLCHAT_PLAN.md` §4 **P3** (images, documents, web search, Blender) and §4 **P4** (recipes,
structured output, stretch) are **cancelled as the release core**. §6 of this document maps all eight
of their units to kept / cherry-picked / dropped. P0, P1 and P2 are landed and are **not touched**:
this plan is strictly additive to the tree they left behind, and every P0–P2 behaviour is a
regression gate (§8).

Four phases replace them:

| Phase | Name | What it is | Outside `shell/renderer/chat/`? |
|---|---|---|---|
| **S0** | Rails | the workbench column, the one-shot typed `ask`, the seat ledger and serial queue, and the scratch-projects API | yes — the four reviewed main/preload files (S0-U4) |
| **S1** | The map | the thinking canvas, the conversation as a map, the model ops, image intake and the moodboard | no |
| **S2** | The vibecode bench | the sandbox, live preview, the scratch project on disk, the edit engine, the opt-in repair loop | no |
| **S3** | Design and board | token forge, contrast, palette-from-photo, SVG, vision critique; board pack, pin linter, scaffolds | no |

**Stop points that still leave a coherent product** (vision §4): after S1 (a workbench and a map —
already something Open WebUI does not do), after S2 (the owner's headline ask, complete), after S3.
A phase is never half-landed: one panel finished before the next is started (vision §10.1).

### 0.2 How this plan is organised (delta to `LOLCHAT_PLAN.md` §0.2)

Identical machinery: **4 phases, ≤ 4 units each, units in a phase own DISJOINT files, one integrator
per phase doing a kickoff and a landing.** The inherited integrator-only file list stands and grows:

- `shell/renderer/chat/main.mjs`, `chat/chat.css`, `chat/core/**`, `chat/ui/layout.mjs`;
- `shell/renderer/index.html`, `shell/renderer/styles.css`, `shell/renderer/app.js`;
- `shell/test/mock-farm.js`, `shell/test/mock/**`,
  `shell/test/chat-harness/{page.html,main.cjs,preload.cjs,run.js,helpers.js}`;
- **new:** `shell/test/chat-lint.js` and `shell/test/chat-scope.js` (S0 kickoff — §2.4, §2.5);
- **new:** `shell/renderer/chat/state/{schema,repo,backend-idb,backend-memory}.mjs` for the v2 store
  upgrade (S0 kickoff — §3.6);
- **new:** `shell/renderer/chat/app/transfer-format.mjs` (S1 kickoff — the `map` part type, the
  `studio` thread field and the `maps` array, §3.6.3);
- `docs/DEVLOG.md`.

**"Done" for a unit** is unchanged: its own `chat-unit` tests, `chat-lint`, `chat-scope` and its own
harness scenarios green; the landing re-runs everything with `--strict` plus the perf group.

**Freeze letters.** `LOLCHAT_PLAN.md` §2.6 runs A…BC. Every kickoff/landing freeze written for this
plan is lettered **S-A, S-B, …** in §2.7 of this document, so the two sets never collide.

### 0.3 Facts this plan relies on

Measured on this box (Windows 11 Pro, Electron 42.5.1, Node v24.14.0), 2026-09-15/16. Probe
artefacts are re-runnable under the scout's scratchpad (`sandprobe/`); nothing in the repo was
touched to obtain them.

| # | Fact | How verified |
|---|---|---|
| F1 | `<iframe src="./sandbox/runner.html">` (a sibling `file:` document) is governed **entirely by its own `<meta>` CSP**. `srcdoc`, `blob:` and `data:` iframes are not — they inherit the renderer CSP, which blocks their inline script. | scout probe 1–4 |
| F2 | `frame-src` falls back to `default-src 'self'` in the shipped renderer CSP, which **already matches the whole `file:` scheme** — so the sandbox needs **no change to `index.html`**, and a guest attempt to frame `https://example.com` or `http://127.0.0.1:41999/` is blocked by the host CSP. | scout probe 4 |
| F3 | With `sandbox="allow-scripts"` the frame runs in an **opaque origin and its own process**: a 1,500 ms guest busy loop stalls the host renderer for **12 ms** (same-origin: **1,501 ms**). `localStorage`, `top.location` and `parent.document` all throw `SecurityError`; `postMessage` works both ways. | scout probe |
| F4 | `sandbox="allow-scripts"` also makes `script-src 'self'` stop matching, so `<script src="./lib.js">` is **blocked** inside the runner. Libraries must arrive as **text over `postMessage`** and be evaluated inline. | scout probe |
| F5 | Under the runner CSP of §3.7: `eval`, `new Function`, inline `<script>`, canvas2d, **WebGL2** and blob `Worker`s all work; `fetch` to `file:`, `https:` and loopback are all refused; `<img src=file:…>` is refused. | scout probe 3–4 |
| F6 | `webContents.on('will-frame-navigate')` fires for subframes and `preventDefault()` vetoes the navigation; the guest survives the veto. | vision §11 probe |
| F7 | `response_format: {type:'json_schema', strict:true}` **survives LiteLLM's `drop_params:true` and is enforced**, streaming and non-streaming, against the live farm — while `supported_openai_params` reports `[]`, so **that field must never gate a feature**. | vision §11, live `curl` |
| F8 | The farm's model is a **reasoning** model: ~75 of 100 completion tokens went to reasoning on a two-field answer, and the JSON can arrive entirely inside `reasoning_content` with an empty `content`. | vision §11, live |
| F9 | IndexedDB quota on this box is 412.8 GB; a 20 MB Blob round-trips in 18 ms / 0 ms. `OffscreenCanvas`, `createImageBitmap`, `crypto.subtle`, `ctx.filter` and `ResizeObserver` are all present. VS Code is installed. | vision §11 |
| F10 | The renderer can already `fetch('file:///C:/Windows/win.ini')` → 200 under the shipped CSP. The projects API's value is therefore the **write** boundary and the absence of an execution primitive, not read secrecy. | scout probe |
| F11 | `CODE_DECORATORS` are additive: `thread-view` runs every matching decorator once per node (`data-deco`), so new decorators sit beside `code-chrome` and `code-svg` without editing `render/code.mjs`. | code read, `render/thread-view.mjs:120–138` |
| F12 | `fetch(` today appears in exactly three chat files: `core/fakes.mjs`, `net/farm.mjs`, `net/run.mjs`. | `grep` |
| F13 | `shell/` compiles the main process with `tsc -p tsconfig.json` to `shell/build/` (CommonJS). There is **no renderer build step** and this plan adds none. | `shell/package.json` |
| F14 | `ui/transfer.mjs` already exports `download(filename, text, mime, opts)` and is the only module allowed `blob:`/`createObjectURL` (lint rule 2). Studio exports reuse it as a **read-only static import**; changing it is a contract request. | code read |
| F15 | `GET /model_group/info` is a GET, so the farm's seat gate never counts it (`farm/src/seats.js:40–45`), and `net/farm.mjs` already exposes `setCapResolver(fn)` + `cap(underlying, name)` with `kv cap:<farmId>:<underlying>:vision` reserved. A capability check therefore costs **no seat** and needs **no POST**. | code read + `CLAUDE.md` |
| F16 | The farm is currently serving **vision-capable `gemma4:12b`** (owner, 2026-09-16), 262 k native context. The vision document's `supports_vision:false` snapshot is stale; O4 (§7) supersedes it. | owner |

**Unverified and load-bearing** — each has an owner and a settling step, and no unit may assume the
answer:

| # | Open question | Settled by |
|---|---|---|
| U1 | The anchored-edit (SEARCH/REPLACE) hit rate of the serving model on a 300-line sketch. **The default edit policy does not depend on the answer** (O3: whole-file under ~200 lines), but the switch does. | S2-U3's bench script, run by a human on the rig (§5 **S-R7**) |
| U2 | Whether `shell.openPath` on a project folder opens Explorer rather than an editor on this Windows build. | S0-U4 probe, recorded in DEVLOG (§5 **S-R4**) |
| U3 | Whether a 1,200-node DOM map holds its frame budget on the office laptops, not only this box. | rig §5 **S-R6** |
| U4 | Whether `will-frame-navigate` still fires after an Electron bump. | asserted by harness scenario `s2-sandbox-navigate`, so a bump shows up as a red |
| U5 | Actual byte size of the three vendored libraries as shipped in `app.asar`, and the effect on installer weight. | S2-U1 landing, measured and recorded (§7 O1) |

### 0.4 Branch, commits and the docs other teams own

Work continues on **`lolchat/vnext`**. `LOLCHAT_PLAN.md`, `LOLCHAT_VISION.md`, `LOLCHAT_DISCUSS.md`
and `LOLCHAT_RIG_CHECKLIST.md` are **not edited by this plan**. The one exception: each phase landing
appends **one** `DEVLOG.md` entry (integrator only, at the top, never a rewrite) — that is the
project's single build log and a silent phase is worse than a merge conflict.

Out-of-scope findings still go to `LOLCHAT_DISCUSS.md` **through the integrator**, who appends them
in one block at the landing.

The untracked `arm-list.txt` and `owui-arm.tar.gz` are never added, moved or deleted.

---

## 1. Global rules (delta to `LOLCHAT_PLAN.md` §1)

### 1.1 Scope

Everything in `LOLCHAT_PLAN.md` §1.1 still holds. **Four carve-outs are added, and nothing else.**

**Allowed, new:**

| Path | Owner | Limit |
|---|---|---|
| `shell/renderer/chat/sandbox/runner.html` | S2-U1 | the only `.html` in the chat tree; its CSP is byte-frozen by the lint (§2.4 rule 9); no `<script src>`, no `<link>`, no `<base>` |
| `shell/renderer/chat/sandbox/lib/**` | S2-U1 | vendored libraries, **byte-identical upstream builds** plus their licence files; nothing else may live here (§3.7.5) |
| `shell/src/main/projects.ts` | S0-U4 | new file; no `child_process`, no `shell.openExternal`, no renderer-supplied absolute path |
| `shell/src/main/projectsPath.ts` | S0-U4 | new file; the validator; imports **only** `node:path` |
| `shell/src/main/index.ts` | S0-U4 | **only** inside the two marked regions `// ---- LOL Studio (S0) ----` … `// ---- /LOL Studio ----`, additive; enforced by `chat-scope` (§2.5) |
| `shell/src/preload/index.ts` | S0-U4 | **only** additive lines inside a single `projects: { … }` property of the existing `lol` object; enforced by `chat-scope` |
| `shell/test/chat-lint.js`, `shell/test/chat-scope.js` | integrator | the new rules of §2.4 / §2.5, each with a self-test |

**Still forbidden, unchanged:** `farm/**`, `farm-app/**`, `sidecar/**`, `.github/**`, packaging
config, `CLAUDE.md`, `package.json` (**no new dependency, no new script**), any Open WebUI source or
CSS injection, **the CSP meta in `shell/renderer/index.html`** (`chat-scope`'s `checkCsp` stays
byte-frozen — F2 says we do not need a change), embeddings or any vector store, and anything that
moves stored user data off the machine.

**No new renderer build step.** Vanilla ESM, dynamic `import()`, hand-written CSS, no bundler, no
CDN, no runtime download. The main process keeps the `tsc` build it already has (F13); S0-U4's unit
tests run against `shell/build/main/*.js` and say so when the build is stale.

**The projects change set is reviewed separately** (vision §5.2; owner decision O5 says *build it now
and widen the gate*, §7). The four files in the table above land as **their own commit** with their
own security review, plain-Node tests and no harness dependency. They are S0-U4 precisely so that the
review happens before anything depends on it, and so that S1–S3 touch nothing outside
`shell/renderer/chat/**` and `shell/test/**`.

### 1.2 Safety (delta)

Everything in `LOLCHAT_PLAN.md` §1.2 holds — **including "no `eval`, no `new Function`, no inline
scripts"**, which is now enforced on HTML too (§2.4 rule 9) with exactly one exempt path. Added:

1. **The sandbox is the only place generated code runs**, and it runs there by construction: the
   renderer itself still cannot `eval` (the shipped CSP makes it an `EvalError`). Nothing outside
   `sandbox/host.mjs` creates an `<iframe>`; nothing outside `sandbox/host.mjs` and
   `sandbox/runner.html` calls `postMessage`.
2. **Model output is data — never code we run, never a path we open.** An id the model invents is
   dropped, never created. SVG is sanitised before it renders. A file path that came out of a message
   body needs an explicit user click before anything touches the disk, and is still validated
   main-side as if it were hostile.
3. **No chat module may pass a non-literal path to `fetch()`**, and `fetch`/`XMLHttpRequest`/
   `EventSource`/`sendBeacon` may appear **only** in `net/farm.mjs`, `net/run.mjs`, `core/fakes.mjs`
   and `sandbox/libs.mjs` (§2.4 rule 11; the fourth file's only argument is
   `new URL(LIB_FILES[name], import.meta.url)` with `LIB_FILES` a frozen same-file literal map).
4. **Exactly one module may name `window.lol`**: `projects/bridge.mjs` (§2.4 rule 10).
5. **Edits apply exactly or visibly refuse.** A near miss is "couldn't apply — here is the full
   rewrite", never a silent corruption of a file the user liked.
6. **Every farm call goes through the governor.** `app.ask` acquires exactly as a send does; a batch
   is a visible, cancellable, strictly serial queue; nothing starts while `#lolchat` is hidden or the
   page is not visible; a busy governor returns `{ok:false, kind:'busy'}` and **every panel renders
   that state**. Never probe a capability with a POST — a probe claims a seat (F15 gives the GET).
7. **One panel live at a time.** `hide()` suspends everything expensive (rAF, the watchdog, the
   sandbox iframe); `destroy()` runs when the thread goes away. Nothing survives the window closing.
8. **The model chooses, the code computes.** Contrast, quantisation, layout geometry, pin tables,
   slugs, file paths and edit application are our code. A unit that asks the model for arithmetic or
   consistency is wrong.
9. **Auto-apply and auto-fix are OFF** (O6). The model proposes; a human clicks. The repair loop is a
   per-project opt-in chosen at project creation, never a global switch, and always bounded and
   stoppable.

### 1.3 File conventions (delta)

Unchanged, plus:

- New areas, one directory each: `chat/map/`, `chat/preview/`, `chat/design/`, `chat/board/`,
  `chat/sandbox/`, `chat/projects/`, `chat/media/`.
- One i18n namespace per unit, first argument of `t()` a literal or a same-file literal map:
  `studio`, `ask`, `queue` (S0-U3 also takes over `etiquette`), `projects`, `map`, `media`,
  `sandbox`, `preview`, `design`, `critique`, `board`.
- One CSS file per unit under `chat/css/`, ComfyQ tokens only, class prefix `.chat-<area>-…`. The
  integrator adds the `@import` to `chat/chat.css` at the kickoff as a comment-only stub the unit
  replaces wholesale (§2.6 **AN**).
- **Data packs are `.mjs` modules exporting a frozen object, never `.json`.** JSON import assertions
  under `file:` and the renderer CSP are an unnecessary risk, and a `.mjs` pack is lintable and
  `import()`-able exactly like every other module.
- Unit tests `shell/test/chat/unit/<area>.test.mjs`; fixtures `shell/test/chat/fixtures/<area>/…`;
  harness scenarios `shell/test/chat-harness/scenarios/<phase>-<area>.mjs`.
- Every `.mjs` starts with `// @ts-check` on line 1 (lint rule 6). `runner.html` is HTML and carries
  a header comment instead.

---

## 2. Gates and harness (delta to `LOLCHAT_PLAN.md` §2)

The live-box rules are unchanged and absolute: never bind or bounce **4000, 4001, 41997, 41998,
8081, 8888, 8890, 11434**; **never start the mock with a beacon** (`LOL_MOCK_BEACON_OK` is never set
on this box, and the mock still creates its `dgram` socket only inside that branch); never run
`electron .` in `shell/`; **never send a completion to the live farm** — every one takes a
colleague's seat. Parallel builders use their assigned `--slot <n>` (all ports offset by `20n`).

One addition, because Studio writes files: **a harness run never writes outside its own
`--user-data-dir` temp**. The projects root under test is always `<tmp>/projects`, created by
`main.cjs`, deleted at teardown. A scenario that names an absolute path outside `<tmp>` fails the
run by construction (§2.2, `needsProjects`).

### 2.1 Unit tests

Unchanged runner (`node shell/test/chat-unit.js [filter…]`). New suites are listed per unit in §4.
Three conventions:

- **Pure modules are tested in Node, directly.** The `PURE_MODULES` list (lint rule 4) grows by the
  table below; a path whose file does not exist yet is skipped with a note, so the whole list can be
  written at the S0 kickoff and filled in as the phases land.

  | Phase | Added to `PURE_MODULES` |
  |---|---|
  | S0 | `app/json.mjs`, `app/studio-state.mjs`, `projects/memory.mjs` |
  | S1 | `map/doc.mjs`, `map/layout.mjs`, `map/format.mjs`, `map/from-thread.mjs`, `map/schemas.mjs`, `media/image.mjs` |
  | S2 | `sandbox/protocol.mjs`, `preview/edit.mjs`, `preview/knobs.mjs`, `preview/brief.mjs` |
  | S3 | `design/color.mjs`, `design/tokens.mjs`, `design/quantize.mjs`, `design/svg-sanitize.mjs`, `design/areas.mjs`, `board/select.mjs`, `board/lint.mjs`, `board/scaffold.mjs`, `board/pack/*.mjs` |

- **The projects API is tested in plain Node against the compiled main output.**
  `shell/test/chat/unit/projects-api.test.mjs` requires `shell/build/main/projects.js` and drives
  `createProjectsApi({rootDir, shellApi, fsApi})` with an injected fake `shell`, a real temp root and
  (for the failure cases) a fault-injecting `fsApi` — no Electron, no harness. If the build is
  missing or older than `projects.ts` it **fails** with `run: npm --prefix shell run build`.
  `projects-path.test.mjs` imports `shell/build/main/projectsPath.js` and is pure table-driven.
- **A pure module with a DOM-shaped job takes an injected factory**, as `render/dom.mjs` does. `map/
  layout.mjs` computes geometry from measured sizes handed to it; it never measures.

### 2.2 Harness additions

New helpers in `helpers.js` (integrator; the first three at the S0 kickoff, the rest at their phase's
kickoff):

```js
h.work(panelId | null)         // open a workbench panel via the tab rail; → {panel, width}
h.width('chat'|'split'|'work') // set the width state; → the resolved state
h.ask.log()                    // the ask spine's completed calls: [{task, mode, ok, ms, model}]
h.projects                     // the projects backend under test:
  .kind()                      //   'real' | 'memory'
  .root() / .list() / .files(id) / .read(id, rel)
h.files(id)                    // files actually on disk under <tmp>/projects/<id> (real backend only)
h.sandbox                      // proxy over window.LolChat.debug.sandbox (published by the live panel)
  .ready({timeout})            //   resolve when the runner reported `ready`
  .run(code, {template, libs, params})   // → the guest's `ran` envelope {ok, ms, error}
  .probe(exprSource)           //   evaluate an expression IN THE GUEST, return its JSON value
  .logs()                      //   the captured console/error envelopes
  .state()                     //   'idle'|'booting'|'running'|'stalled'|'disabled'
h.map                          // .nodes() / .edges() / .select(id) / .undo() / .layout()
```

`h.sandbox.probe` deliberately goes **through the panel's own protocol**, not through CDP: the guest
is an opaque origin, and a test that can reach it another way is not testing the shipped path.

**Scenario fields** are unchanged (`needsMock`, `allowFailedModules`, `perf`, `judge(medians, h)`,
`allowConsoleErrors`, `keepStorage`, `timeoutMs`). One is added at the S0 kickoff:

- `needsProjects: 'real' | 'memory'` — `'real'` is **skipped with an `ok/skipped` line** when
  `shell/build/main/projects.js` is absent, so a renderer-only builder still gets a green run; the
  landing runs with the build present and **0 skipped** is a landing gate.

`page.html` is unchanged (its CSP stays byte-identical to `index.html`'s — `h0-csp-identical`).
`main.cjs` gains, at the S0 kickoff:

- `ipcMain.handle('lol:projects:*')` wired to the **real** `createProjectsApi` when
  `build/main/projects.js` exists, rooted at `<tmp>/projects`; otherwise the handlers are absent and
  `window.lol.projects` is undefined in the page (which is exactly what an un-upgraded client looks
  like — the renderer must degrade, §3.5.3);
- the `will-frame-navigate` veto, **copied from the shipped main-process region** so the harness
  proves the real guard and not a stand-in (a comment in both places names the other);
- `preload.cjs` gains the same additive `projects: {…}` property shape as the real preload.

### 2.3 Mock farm additions

**No farm, `farm-app`, beacon or `/lol/self` change.** The mock stays beacon-free; the snapshot shape
is untouched (no `searxngUrl`, no `extract`, no `ttsUrl` — those belonged to the cancelled P3/P4).
Every addition below is a **scenario model** or a **state flag**, appended, never a rename.

Added at the **S0 kickoff**:

| Model | Behaviour |
|---|---|
| `mock-studio-json` | With `response_format.type==='json_schema'`: streams a **valid instance of the sent schema**, derived deterministically (strings `"s1","s2"…`, numbers `1`, booleans `true`, arrays of 3, `enum` takes its first value, `required` honoured, `additionalProperties:false` respected). Without it: prose plus a fenced ```json block holding the same instance. |
| `mock-json-empty` | With `response_format`: only `usage` and `[DONE]` — empty content and empty reasoning. The "never a silent empty result" path. |
| `mock-json-reasoning-only` | The JSON arrives only as `reasoning_content`; `content` stays empty. The reasoning-model trap of F8. |
| `mock-vision-echo` | Reports, as markdown `key: value` lines, how many `image_url` parts arrived, their approximate byte sizes and their mime types; with no image part it says `images: 0`. |
| `mock-vision-refuse` | 400 `{"error":{"message":"this model does not support image input"}}` whenever any `image_url` part is present; otherwise a normal stream. `state.visionRefuseAll` applies the same rule to **every** model. |

Mock **state** flags added at the S0 kickoff:

- `state.structuredDrop: true` — the proxy **strips `response_format` from the body** before dispatch
  and the model answers prose. This simulates LiteLLM's `drop_params` on a deployment that does not
  claim schema support, and is how the prompt-and-parse fallback is proven (§3.4.2).
- `state.askDelayMs` — a fixed delay before the first delta, for queue and cancellation scenarios.
- `state.modelGroupInfo` — the body `GET /model_group/info` returns, so a scenario can make the farm
  advertise `supports_vision:false` (the "needs a vision model" state of O4) without touching a POST.

Added at the **S1 kickoff**:

| Model | Behaviour |
|---|---|
| `mock-map-expand` | With `response_format`: `{"nodes":[{"id":"n-new-1","parentId":"<the first node id in the request>","text":"…"},{"id":"n-new-2","parentId":"n-does-not-exist","text":"…"}]}` — deliberately one **invented parent id**, so "ids the model invents are dropped" is testable. |
| `mock-map-cluster` | Returns groups referencing every id it was given **plus one it was not**, and leaves one given id out — the partial-result path. |
| `mock-moodboard` | With images present: one `{"images":[{"n":1,"tags":[…],"note":"…"}]}` entry per image, in order; with no images, an error-shaped refusal. |

Added at the **S2 kickoff**:

| Model | Behaviour |
|---|---|
| `mock-sketch` | A markdown reply with exactly one ```js fence: a deterministic canvas2d sketch that draws and calls `requestAnimationFrame`. Runs clean in the runner. |
| `mock-sketch-broken` | A ```js fence whose first frame throws `ReferenceError: ctxx is not defined`. **If the last user message contains the string `ctxx is not defined`, it streams the FIXED fence instead** — so the bounded repair loop is assertable end to end, including its stop condition. |
| `mock-sketch-loop` | A fence containing `while (Date.now() - t0 < 1500) {}` — the hang gate. |
| `mock-sketch-p5` | A fence using `setup()`/`draw()` and p5 globals — proves the vendored library actually reaches the guest. |
| `mock-edit` | Replies with two SEARCH/REPLACE blocks against the last fence in the request: one that matches exactly, one whose SEARCH text is absent — "applies exactly or visibly refuses" in one reply. |
| `mock-rewrite` | Replies with one full-file fence, 40 lines, deterministic — the default (whole-file) edit path. |

Added at the **S3 kickoff**:

| Model | Behaviour |
|---|---|
| `mock-tokens` | With `response_format`: a full ComfyQ token set. One pair (`--muted` on `--surface`) is deliberately **3.9:1**, below WCAG AA, so D3 always has something to catch. |
| `mock-svg` | Two ```svg fences: one valid, one carrying `<script>alert(1)</script>`, an `onload=` attribute, an external `<image href="https://…">` and a `javascript:` href — the sanitiser corpus. |
| `mock-critique` | With images: `{"findings":[{"area":"top-left","severity":"minor","note":"…"},…]}`, including one `area` outside the 3×3 vocabulary and one severity the schema does not allow — the "drop what does not typecheck" path. |
| `mock-compare` | Two findings that **agree** and two that **flip** when the image order is swapped (it keys off which image is first) — the order-bias filter of D8 is testable. |
| `mock-board` | Arduino/ESP32 prose with one ```cpp fence that uses **GPIO 6** (flash on the classic ESP32) and **GPIO 34** as an output (input-only) — two findings the deterministic linter must produce without the model's help. |

`GET /mock/last-body` (already present) is how every scenario asserts what was actually sent — the
schema, the `max_tokens` floor, the injected board slice, the brief block, the image count.

### 2.4 `chat-lint.js` — six new rules (integrator, S0 kickoff)

Today the lint reads only `.mjs` (rules 1–7) and `.css` (rule 3); rule 8 (control characters) reads
every file. **A `runner.html` full of `eval` would therefore ship silently.** The safety story stops
being decorative here. Each new rule ships with its own `--self-test` plant, as every existing rule
has, and rules 9–14 are written at the S0 kickoff even though their files land in S2 — a rule whose
target file does not exist yet passes with a printed note, and is reported as **active** the moment
the file appears.

- **Rules 1, 2 and 8 now apply to `**/*.html` in the chat tree**, with comment stripping adapted to
  `<!-- -->`. Exactly **one** path is exempt from rules 1 and 2: `sandbox/runner.html`. The exemption
  is a literal path match, not a pattern.
- **Rule 9 — the runner CSP is byte-frozen.** `sandbox/runner.html` must contain exactly one
  `<meta http-equiv="Content-Security-Policy" content="…">` whose `content` byte-matches the constant
  `RUNNER_CSP` in `chat-lint.js` (the string of §3.7.1). The file must contain no `<script src>`, no
  `<link>`, no `<base>`, and no `allow-same-origin`. The rule-1/2 exemption is only safe *because*
  the CSP cannot drift; this is the technique `chat-scope`'s `checkCsp` already uses on `index.html`.
- **Rule 10 — one door to the main process.** The tokens `window.lol`, `lol.projects` and
  `ipcRenderer` may appear only in `projects/bridge.mjs` (comment-stripped source).
- **Rule 11 — one door to the network.** `fetch(`, `new XMLHttpRequest`, `new EventSource` and
  `navigator.sendBeacon` may appear only in `net/farm.mjs`, `net/run.mjs`, `core/fakes.mjs` and
  `sandbox/libs.mjs`. In the first three, no `fetch(` argument may contain the token `file:`; in
  `sandbox/libs.mjs` the **only** permitted argument form is `new URL(LIB_FILES[<identifier>],
  import.meta.url)`, and `LIB_FILES` must be a frozen object literal in the same file whose values
  are string literals under `./lib/`.
- **Rule 12 — one door to the sandbox.** `createElement('iframe')`, the literal `<iframe`,
  `.contentWindow` and `postMessage` may appear only in `sandbox/host.mjs` (and, for `postMessage`,
  `sandbox/runner.html`). `sandbox/host.mjs` must contain the literal `'allow-scripts'` and must
  **not** contain the token `allow-same-origin`.
- **Rule 13 — no new clock.** `setInterval(` may appear only in `sandbox/host.mjs` (the watchdog,
  §3.7.4). Everything else wall-clock runs on `EV.FARM_TICK` (§3.9 of the inherited plan). `rAF` is
  not a clock and is unrestricted, but §1.2.7 still applies: a hidden panel cancels it.
- **Rule 14 — vendored libraries are untouched.** Every file under `sandbox/lib/` must be listed in
  `LIB_MANIFEST` (a table in `chat-lint.js`: path, sha256, licence file, upstream URL, version), and
  its sha256 must match. A library that changes byte-for-byte fails the lint until the manifest row
  is updated in the same change — which is what makes "vendored unmodified" checkable rather than
  promised. Licence files listed in the manifest must exist and be non-empty.

Rules 3 (colour literals) and 6 (`// @ts-check`) are unchanged and apply to every new `.css`/`.mjs`.

### 2.5 `chat-scope.js` — the widening, and only this widening (integrator, S0 kickoff)

`ALLOWED` gains exactly five rows. Nothing else under `shell/src/**` may change, and the existing
`checkCsp`, `checkE2e` and `checkPublishFarm` rules are untouched.

```js
{ re: /^shell\/src\/main\/projects\.ts$/,      why: 'the scratch-projects API (S0-U4)' },
{ re: /^shell\/src\/main\/projectsPath\.ts$/,  why: 'the pure path validator (S0-U4)' },
{ re: /^shell\/src\/main\/index\.ts$/,         why: 'the marked LOL Studio regions only',
  checkMarkedRegion: 'LOL Studio (S0)' },
{ re: /^shell\/src\/preload\/index\.ts$/,      why: 'the additive projects: {…} property only',
  checkPreloadProjects: true },
{ re: /^shell\/renderer\/chat\/sandbox\/lib\/.+$/, why: 'vendored libraries (S2-U1)',
  checkLibManifest: true },
```

- **`checkMarkedRegion`** parses the working-tree file for the anchors `// ---- LOL Studio (S0) ----`
  and `// ---- /LOL Studio ----`, computes their line spans (there are exactly two regions: the IPC
  handlers and the `will-frame-navigate` guard), and asserts that **every changed hunk lies inside a
  span and only adds lines** — the same machinery `checkAppJs` already uses for `publishFarm`.
- **`checkPreloadProjects`** asserts every added line lies inside a single `projects: {` … `},`
  property of the `contextBridge.exposeInMainWorld('lol', {…})` object, and that nothing is removed.
- **`checkLibManifest`** asserts that any changed file under `sandbox/lib/` is listed in the lint's
  `LIB_MANIFEST` with a matching sha256 — the same fact as lint rule 14, enforced at the diff level so
  a library cannot be edited in a change that skips the lint.
- `--self-test` gains six cases: a change to `shell/src/main/sidecar.ts` (must be flagged), an
  `index.ts` hunk outside both regions (flagged), a removal inside a region (flagged), a preload line
  outside the `projects` property (flagged), an unlisted file under `sandbox/lib/` (flagged), and one
  legal change in each allowed file (not flagged).

**What the gate still refuses, deliberately:** any other file under `shell/src/**`,
`shell/renderer/index.html`'s CSP, `shell/test/e2e.js` (byte-identical), `package.json`, and every
forbidden tree of §1.1. Widening the gate is a plan change with the owner's signature, not a builder
decision.

### 2.6 Inherited frozen contracts a Studio unit will trip over

These are not new. They are the ones this plan's surfaces walk straight into, with the
`LOLCHAT_PLAN.md` §2.6 letter they come from. **Read them before writing a line.**

| Ref | Contract |
|---|---|
| **I, AB** | Only a module `main.mjs` constructs or installs gets a loader row. Everything else is a **static import of its consumer** — and **write the leaf before you import it**, or you take the consumer down with it. |
| **AA** | Every feature exports `install(app)`, sees no bus event emitted during component construction (read `app.state` / `app.farm.get()` at install time *as well as* subscribing), must not throw, and reaches another feature's API (`app.branching`, `app.ask`, `app.work`) **lazily at run time**, never during its own install. |
| **AD** | The registry has **no change event**: a slot is inert until some module iterates it, and a host must build its item list **at render time**, never once at install. |
| **AE** | Region ownership: only a region's owner may `replaceChildren()` it. `els.strip`→`ui/strip.mjs`, `els.meter`→`ui/meter.mjs`, `els.header`→`ui/thread-header.mjs`, `els.sideTools`/`els.sideFoot`→P2-U4, `els.list`/`els.sideHead`→`ui/sidebar.mjs`, `els.banner`→loader + storeBanner, `.chat-msg*`→`thread-view`. **`els.work` is new and belongs to `ui/workbench.mjs` alone** (§3.5). Persistent per-message UI belongs in a `MESSAGE_ACTIONS` or `PART_RENDERERS` item, never in a node written into a row. |
| **AF** | `BEFORE_SEND` runs in the **composer**, gates then enrichers; the fingerprint excludes enrichment results; a gate that changes the Send label must use `setTimeout(…, 0)`. |
| **AC** | `controller.generate({extraTurns})` appends request-only turns; each carries `msgId: null`, and `planTrim` must never drop or list a null-`msgId` turn. |
| **AG, AU** | A seats-full 429 is a **waiting row** that HOLDS the governor; `gov.release` is a no-op while `foreground === 'streaming'`; a feature that paints a message the reader may have left guards its `view.upsert` with `msg.threadId === app.state.threadId` (BB-1 moved that guard into `controller.generate` itself). |
| **BB-2/3** | The governor has three states; `held` keeps Send on screen, disabled, wearing its holder's note (`gov.hold(who, {note})`, `gov.holdNote()`). There is **one** cancel door: `SLOTS.CANCEL_HANDLERS` → `controller.stop()`. |
| **BB-4** | Anything that **writes before it generates** asks `gov.canStart('foreground')` first, and again after its store read. |
| **BB-6** | Message parts are whitelisted per type in `app/transfer-format.mjs`. **A unit that adds a part type adds it there too**, or its parts do not survive an import (§3.6.3). |
| **BB-7** | `repo.updateThread(id, patch, {silent:true})` writes without emitting `THREADS_CHANGED` — for fields no list and no header renders. Anything that moves, renames or reorders a row emits. |
| **AZ-1** | Recompose a note from a **stored source**, never from the text you last wrote. |
| **AZ-2** | **Re-read the store before writing a captured message** (`stillThere()` per snapshot and again before any write). |
| **AZ-3** | `'streaming'` and `'waiting'` are never accepted from outside; every new door into the store coerces them. |
| **AZ-4** | `breakdown().images` is a **report, not a bucket** — `IMAGE_TOKENS` (1,600) is already inside `estimateMessage`. |
| **AZ-5** | Ephemeral threads are excluded from bulk operations and never journalled. |
| **§3.9** | Everything wall-clock runs on `EV.FARM_TICK`. "Being looked at" = `app.state.visible && app.state.pageVisible`. |
| **§3.10** | Model selection is farm-honest; there is deliberately no global last-model key. `app.ask` inherits it (it uses the thread's resolved model). |
| **BC** | The baseline no landing may regress: `chat-unit` **472/0**, `unit.js` **5**, `chat-lint` **0 over 74 files**, `chat-scope` clean over **179 paths**, harness `--strict` **101/0**, `--strict --phase perf` **6/0** (medians 1270–1788 render tok/s). |

### 2.7 Freeze protocol for this plan

Each phase integrator writes, at kickoff and again at landing, a numbered freeze block in **this
document** under §2.7, lettered `S-A`, `S-B`, … Every freeze item is a *precision or override*, never
new work, and where it conflicts with §3 or §4 it wins — exactly as `LOLCHAT_PLAN.md` §2.6 does for
the chat. A unit that believes it needs a contract change raises it to the integrator; it never edits
an integrator-owned file.

Reserved at the time of writing: **S-A** the S0 kickoff freeze (loader rows, slots, store v2, the
gate changes as landed, the measured `LIB_MANIFEST` shape), **S-B** the S0 landing freeze.

**S-A (written 2026-09-16) lives in `LOLCHAT_PLAN.md` §2.6 as addendum `BD`** — one freeze list for
the whole surface, as the phase instructions asked. Read BD before writing a line of S0; where it
conflicts with §2-§4 of this document (it does, in the places S1's cancellation touches), BD wins.

---

## 3. Architecture and contracts (delta to `LOLCHAT_PLAN.md` §3)

### 3.1 Loader rows

`main.mjs` stays integrator-owned and keeps the §3.1 table shape
(`{key, path, role:'component'|'feature', fake, phase}`). `PHASE` becomes `'S0'`, `'S1'`, `'S2'`,
`'S3'` at each kickoff. Every Studio module is a **feature** (`install(app)`, `fake:null`) — no new
component is created, so no new `app.<slot>` field is constructed by `main.mjs` and `--strict` keeps
its meaning. Features publish themselves on `app` under their own key (§2.6 **AQ**).

| Phase | key | path | unit | Publishes |
|---|---|---|---|---|
| S0 | `work` | `./ui/workbench.mjs` | S0-U1 | `app.work` |
| S0 | `ask` | `./app/ask.mjs` | S0-U2 | `app.ask` |
| S0 | `queue` | `./ui/queue.mjs` | S0-U3 | `app.queue` |
| S0 | `projects` | `./projects/bridge.mjs` | S0-U4 | `app.projects` |
| S1 | `mapPanel` | `./map/panel.mjs` | S1-U2 | `app.map` |
| S1 | `mapOps` | `./map/ops.mjs` | S1-U3 | — (registers `MAP_OPS`) |
| S1 | `media` | `./media/intake.mjs` | S1-U4 | `app.media` |
| S1 | `moodboard` | `./map/moodboard.mjs` | S1-U4 | — (registers `MAP_NODE_KINDS`, `MAP_OPS`) |
| S2 | `previewPanel` | `./preview/panel.mjs` | S2-U2 | `app.preview` |
| S2 | `codeActions` | `./preview/code-actions.mjs` | S2-U3 | — (registers `CODE_DECORATORS`, `MESSAGE_ACTIONS`) |
| S2 | `previewLoops` | `./preview/loops.mjs` | S2-U4 | — (extends `app.preview`) |
| S3 | `designPanel` | `./design/panel.mjs` | S3-U1 | `app.design` |
| S3 | `designMedia` | `./design/media.mjs` | S3-U2 | — (registers `DESIGN_SECTIONS`, `CODE_DECORATORS`) |
| S3 | `critique` | `./design/critique.mjs` | S3-U3 | — (registers `DESIGN_SECTIONS`, `MESSAGE_ACTIONS`) |
| S3 | `boardPanel` | `./board/panel.mjs` | S3-U4 | `app.board` |

**Leaves with no row** (static imports of their consumer, §2.6 **AB**): `app/json.mjs`,
`app/studio-state.mjs`, `projects/memory.mjs`, `map/{doc,layout,format,from-thread,schemas,view,a11y}.mjs`,
`media/{image,parts}.mjs`, `sandbox/{host,protocol,libs}.mjs`, `preview/{project,templates,brief,edit,knobs,apply}.mjs`,
`design/{color,tokens,quantize,svg-sanitize,areas,sheet,compare}.mjs`, `board/{select,lint,scaffold,pack/*}.mjs`,
and every `strings/*.en.mjs`. **Write the leaf before you import it.**

`sandbox/runner.html` is not a module and never appears in the table; `sandbox/host.mjs` resolves it
with `new URL('./runner.html', import.meta.url)` — **never** from `location`, because the harness page
and `index.html` sit at different depths.

### 3.2 New registry slots (S0 kickoff, `core/registry.mjs`, integrator)

Six slots are added. They are inert until their host renders them (§2.6 **AD**); the host column says
who that is and in which phase it arrives.

```js
WORKBENCH_PANELS: 'workbench.panels',
  // {id, order, icon, label, defaultWidth: 'split'|'work',
  //  available(app) -> boolean|{no: string},        // a reason string renders as the panel's empty state
  //  create(host, app) -> PanelInstance}            // host = {el, panelId, setTitle(s), setActions(items), request(width)}
MAP_OPS: 'map.ops',
  // {id, order, label, scope: 'node'|'branch'|'selection'|'map', needsFarm?: boolean,
  //  visible(sel, app) -> boolean, run(sel, app) -> Promise<void>}
MAP_NODE_KINDS: 'map.nodeKinds',
  // {kind, render(node, app) -> Node, size(node) -> {w, h}, edit?(node, app) -> Promise<void>}
PREVIEW_TEMPLATES: 'preview.templates',
  // {id, order, label, kind: 'canvas'|'dom'|'three'|'p5'|'svg', libs: string[],
  //  files() -> {path, text}[], brief: string, knobs?: Knob[]}
DESIGN_SECTIONS: 'design.sections',
  // {id, order, title, available(app) -> boolean|{no: string}, render(el, app) -> {refresh?, destroy?}}
BOARD_PACKS: 'board.packs',
  // {id, order, pack: BoardPack}     // §3.11; a pack is data, never code
```

| Slot | Host | Arrives |
|---|---|---|
| `WORKBENCH_PANELS` | `ui/workbench.mjs` | S0-U1 |
| `MAP_OPS`, `MAP_NODE_KINDS` | `map/panel.mjs` | S1-U2 |
| `PREVIEW_TEMPLATES` | `preview/panel.mjs` | S2-U2 |
| `DESIGN_SECTIONS` | `design/panel.mjs` | S3-U1 |
| `BOARD_PACKS` | `board/panel.mjs` | S3-U4 |
| **`ATTACH_SOURCES`, `ATTACH_HANDLERS`** (declared since P0, inert) | **`media/intake.mjs`** finally renders them into `composer.region('tools')` and handles drop/paste | S1-U4 |

`PALETTE` stays inert — the command palette was a cancelled P4 stretch (§6) and nothing in this plan
renders it.

### 3.3 New shared types (`core/types.mjs`, integrator, additive)

```js
/** @typedef {{ panel: string|null, width: 'chat'|'split'|'work', mapId: string|null,
 *   projectId: string|null, boardId: string|null, updatedAt: number }} StudioState   // thread.studio

/** @typedef {{ id, threadId, title, createdAt, updatedAt, rev,
 *   nodes: MapNode[], edges: MapEdge[], view: {x, y, zoom}, source: 'blank'|'thread'|'import' }} MapDoc
/** @typedef {{ id, kind: 'idea'|'note'|'image'|'message'|'group', text, attId?: string|null,
 *   parentId: string|null, x, y, w, h, color?: string|null, collapsed?: boolean,
 *   ghost?: boolean, origin: 'user'|'model'|'thread', ref?: {messageId?: string} }} MapNode
/** @typedef {{ id, from, to, kind: 'tree'|'link', label?: string }} MapEdge

/** @typedef {{ id, name, kind: 'canvas'|'dom'|'three'|'p5'|'svg'|'board', createdAt, updatedAt,
 *   settings: {autoApply: boolean, autoFix: boolean, editPolicy: 'auto'|'whole'|'anchored'},
 *   hidden?: boolean }} ProjectMeta          // mirrored in the `projects` store, authoritative on disk

/** @typedef {{ ok: boolean, value: any, mode: 'schema'|'prompt'|'text', raw: string,
 *   usage: object|null, ms: number,
 *   error: {kind: 'busy'|'no_farm'|'no_vision'|'empty'|'invalid'|'aborted'|'farm', message: string}|null }} AskResult

/** @typedef {{ id, label, kind: 'run'|'ran'|'error'|'log'|'pong'|'ready'|'frame'|'bye', … }} SandboxEnvelope  // §3.7.2

/** @typedef {{ name, code: string, lang: string, from: 'model'|'user'|'template' }} Revision
/** @typedef {{ id, label, type: 'number'|'color'|'boolean'|'select', value, min?, max?, step?, options? }} Knob

/** @typedef {{ id, name, mcu, verified: boolean, source: string,
 *   pins: BoardPin[], notes: {id, text, verified, source}[],
 *   arduino: {fqbn, core}, platformio: {board, framework, platform} }} BoardPack
/** @typedef {{ n: number, names: string[], caps: string[], warn?: {level:'error'|'warn', why: string, source: string} }} BoardPin
/** @typedef {{ pin: number, line: number, level: 'error'|'warn'|'info', message: string, source: string }} PinFinding
```

Additive only: nothing already in `types.mjs` changes shape. `Thread` gains the optional `studio`
field; `Part` gains `{type:'map', mapId, title}` (a map pinned into a conversation, §3.6.3).

### 3.4 The ask spine (`app/ask.mjs`, `app/json.mjs`, S0-U2)

Every panel needs one-shot typed answers. Without a shared spine we grow three send pipelines, three
retry policies and three ways to be rude to the farm.

#### 3.4.1 API

```js
app.ask = {
  json({task, schema, prompt, system, images, model, maxTokens, holder, signal, thread}) -> Promise<AskResult>,
  text({task, prompt, system, images, model, maxTokens, holder, signal, thread}) -> Promise<AskResult>,
  queue({label, items, run(item, i, signal) -> Promise<any>, onProgress})
      -> {promise: Promise<{done, results, cancelled}>, cancel(), state() -> {i, n, running}},
  mode(underlying) -> 'schema'|'prompt'|'unknown',
  vision(underlying) -> 'yes'|'no'|'unknown',
}
```

- **Never writes to the repo and never paints a message row.** An ask is not a turn; it belongs to the
  panel that asked. Panels persist results themselves (a map node, a token set, a finding list).
- **The model** is the thread's resolved model (§3.10 of the inherited plan), or `model` when the
  caller has a reason; there is still no global last-model memory.
- **Governor.** `ask` acquires the foreground exactly as a send does, with
  `holder = 'ask:' + task`, and refuses immediately (`{ok:false, error:{kind:'busy'}}`) when
  `gov.canStart('foreground')` is false. It never waits in a timer and never runs while
  `!(app.state.visible && app.state.pageVisible)`.
- **`queue`** runs items **strictly serially**, one governor acquire per item, cancellable, and emits
  `'ask:queue'` bus events that `ui/queue.mjs` renders (§3.5.4). A queue is refused while another
  queue is running: one batch at a time, per window.
- `max_tokens = max(512, 4 × expected JSON size estimate)` (vision §8.5); the caller may raise it,
  never lower it below the floor.
- `signal` is an `AbortSignal`; cancelling aborts the in-flight generation through `net/run.mjs` and
  releases the governor.

#### 3.4.2 The fallback ladder (R3)

1. **schema** — `response_format: {type:'json_schema', json_schema:{name, strict:true, schema}}` rides
   through `toOpenAIBody` (already supported: `req.responseFormat`). F7 says it survives the proxy.
2. **prompt** — on an invalid/empty result, or when `kv structuredMode:<farmId>:<underlying>` is
   already `'prompt'`, the schema is rendered into the system text ("answer with JSON only, matching
   this shape …") and the reply is parsed with `app/json.mjs`.
3. **text** — both failed: `{ok:false, mode:'text', raw}` with `error.kind:'invalid'`. **Every panel
   renders this as a visible row with a Retry button**; a silent empty result is a bug (§1.2).

`app/json.mjs` (pure) exports:

```js
extractJson(raw)            // -> {ok, value, how: 'body'|'fence'|'slice'|'none'}  first balanced object/array
validate(value, schema)     // -> {ok, value, errors: string[]}   subset of JSON Schema: type, enum, required,
                            //    properties, items, additionalProperties:false, minimum/maximum, maxLength
coerce(value, schema)       // -> value with unknown properties dropped, single values wrapped into arrays where
                            //    the schema says array, numeric strings coerced; NEVER invents a missing required field
promptFor(schema, {example})// -> the prompt-mode instruction text (deterministic, testable)
```

- **The reasoning trap (F8).** When `content` is empty, the parser reads `reasoning` before giving up.
  A model that put the JSON in its thinking is not a failure.
- **Verdict caching.** A successful schema call writes `kv structuredMode:<farmId>:<underlying> =
  'json'`; two consecutive schema failures write `'prompt'`. Panels never branch on
  `supported_openai_params` (F7).

#### 3.4.3 Capability checks without a seat (`app/caps.mjs`, S0-U2)

- `setCapResolver` is installed once: a `GET {proxyRoot}/model_group/info` (F15 — never counted by
  the seat gate), read into `cap(underlying, 'vision')` and cached in
  `kv cap:<farmId>:<underlying>:vision`.
- Refreshed on `EV.FARM_CHANGE` when `baseUrl`, `apiKey` or the model list changed. Never on a tick.
- A 400 classified `vision_unsupported` (`net/errors.mjs` already does) downgrades the cached verdict
  to `'no'` and returns `{ok:false, error:{kind:'no_vision'}}`, which every vision surface renders as
  one sentence naming what the operator has to switch on (O4) — not a spinner, not a dead button.

### 3.5 The workbench (S0-U1)

#### 3.5.1 Layout delta (`ui/layout.mjs`, integrator, S0 kickoff)

One region is added, as a sibling of `.chat-main` inside `#lolchat`:

```
#lolchat
  aside.chat-side          els.side      (unchanged)
  div.chat-main            els.main      (unchanged)
  div.chat-work            els.work      NEW — owned by ui/workbench.mjs alone
    .chat-work-rail        els.workRail  (the tab rail: Preview · Map · Design · Board)
    .chat-work-head        els.workHead  (title + panel actions + the width control)
    .chat-work-body        els.workBody  (the panel's own element; the ONLY node a panel owns)
  div.chat-live            els.live      (unchanged)
```

`css/base.css` grid becomes `grid-template-columns: 240px minmax(0, 1fr) var(--chat-work-w, 0px)`
(integrator, S0 kickoff, the one `base.css` edit of this plan). Three width states (vision §2):

| State | `--chat-work-w` | `.chat-main` |
|---|---|---|
| `chat` | `0px`, `els.work` `hidden` | full |
| `split` | `clamp(320px, var(--chat-work-user, 46%), 70%)`, drag-resizable, persisted in `kv ui:workWidth` | shrinks |
| `work` | `1fr` | collapsed to `0`; the composer docks under the panel as a one-line bar |

At `< 900 px` the split state collapses to `work` (a 320 px panel beside a 300 px chat is neither).
`prefers-reduced-motion` removes the width transition.

#### 3.5.2 Panel contract

```js
// registry.add(SLOTS.WORKBENCH_PANELS, {id, order, icon, label, defaultWidth, available, create})
PanelInstance = {
  show(ctx)      // ctx = {thread, studio: StudioState}; the panel becomes live: build DOM, start rAF
  hide()         // suspend EVERYTHING expensive: rAF, watchdog, sandbox iframe, in-flight ask (abort)
  destroy()      // the thread went away or the workbench is closing; release every resource
  onThread(ctx)  // the reader switched threads while this panel is live
  debug?         // published under window.LolChat.debug[panelId] for the harness
}
```

Rules, enforced by `s0-workbench` scenarios:

1. **Exactly one panel is live.** Switching tabs calls `hide()` on the old one before `show()` on the
   new one; the workbench never holds two live panels, even for a frame.
2. `els.workBody` is `replaceChildren()`-ed **by the workbench only**; a panel receives its own
   element and owns everything inside it (§2.6 **AE**).
3. **Hidden means idle.** `EV.VISIBLE` with `visible:false` or `pageVisible:false` calls `hide()`;
   returning calls `show()`. A panel that keeps an rAF or an in-flight ask while hidden fails
   `s0-workbench-hidden`.
4. **Thread switching** keeps the current panel if the new thread has content for it
   (`available(app)` true and the thread's `studio` names it), otherwise falls back to `chat` width
   with the panel closed. The panel is told through `onThread`, never re-created.
5. A panel whose module failed to load simply is not in the rail (the loader already records it).

#### 3.5.3 Per-thread studio state (`app/studio-state.mjs`, pure; R5)

`thread.studio` (§3.3) is read at `show()` and written with
`repo.updateThread(id, {studio}, {silent:true})` (§2.6 **BB-7**: no list and no header renders it).
Writes are debounced 500 ms, like drafts. The pure module owns the merge/validate/clamp logic
(unknown panel id → `null`, unknown width → `'chat'`, a `projectId`/`mapId` that no longer resolves →
dropped on read, never rewritten silently in the store).

Degradation is explicit: when `window.lol.projects` is absent (an older shell binary, or the harness
without the build), `app.projects.kind() === 'memory'` and every project surface shows one sentence —
"this build has no projects folder; sketches run but are not saved" — with the panel still usable.

#### 3.5.4 Seat ledger and the queue (S0-U3; R4)

`ui/strip.mjs` (taken over) renders, beside its existing fields, a **ledger**: `seats 1/2 · you 1 ·
queue 3`, built only from non-null fields (the existing rule) — `caps.seats.used/slots`, the
governor's own state, and `app.queue.state()`. `ui/queue.mjs` renders the running batch as a chip in
`els.strip`'s own region with a **Cancel** button, and mirrors it into `els.live` for screen readers.

- Nothing in this plan starts a batch without a visible queue chip.
- A queue item that is refused by the governor is retried on the **next `EV.FARM_TICK`**, at most 5
  times, then the queue stops with "the farm is busy — try again" (no timers; §3.9 inherited).
- The chip is the one place a user can stop a batch, and Escape (already bound to stop-then-close)
  reaches it through `CANCEL_HANDLERS`.

### 3.6 Storage

#### 3.6.1 IndexedDB `lol-chat` version **2** (S0 kickoff, integrator)

```js
// state/schema.mjs
export const DB_VERSION = 2;
export const STORES = Object.freeze({
  threads:     { keyPath:'id', indexes:{ updatedAt:'updatedAt', pinned:'pinned', legacy:['legacyId','legacyHash'] } },
  messages:    { keyPath:'id', indexes:{ threadId:'threadId', threadParent:['threadId','parentId'] } },
  attachments: { keyPath:'id', indexes:{ threadId:'threadId', threadSha:['threadId','sha256'] } },
  recipes:     { keyPath:'id', indexes:{ trigger:'trigger' } },
  kv:          { keyPath:'key', indexes:{} },
  maps:        { keyPath:'id', indexes:{ threadId:'threadId', updatedAt:'updatedAt' } },   // NEW
  projects:    { keyPath:'id', indexes:{ threadId:'threadId', updatedAt:'updatedAt' } },   // NEW (metadata mirror)
});
```

**Upgrade path** (`upgrade(db, oldVersion, tx)`, switch-fallthrough, never deletes a store):

```js
if (oldVersion < 1) { /* unchanged: the five v1 stores */ }
if (oldVersion < 2) { create 'maps' + its two indexes; create 'projects' + its two indexes; }
```

- A **fresh** profile goes straight to v2 through the same code path (`oldVersion === 0` runs both
  blocks). Tested both ways in `store-v2.test.mjs` (fake IDB) and in the harness against real
  IndexedDB (`s0-store-v2`, which opens v1 first, writes a thread, then reloads at v2 and asserts the
  thread survived and the new stores exist).
- The memory backend derives its stores from the same table, so nothing else changes.
- **Rollback safety:** a v0.1.45 client (DB v1) opening a v2 database gets a `VersionError`, which
  `repo` already maps to `mode:'memory-final'` with the "history can't be saved" banner — degraded but
  not destructive, and the user's v1 localStorage copy is still untouched. Recorded in DEVLOG at the
  S0 landing and in the rig list (**S-R2**).

#### 3.6.2 Repo additions (S0 kickoff, integrator; journalled like every other write)

```js
listMaps(threadId?) -> Promise<MapDoc[]>      getMap(id)    putMap(doc)    deleteMap(id)
listProjectRefs(threadId?)                    getProjectRef(id)  putProjectRef(ref)  deleteProjectRef(id)
```

- `deleteThread` cascades to `maps` and `projects` **rows**, and **never** to files on disk: the
  folder outlives the thread and the UI says so ("the folder is still at … — delete it yourself if you
  want it gone"). Deleting user files as a side effect of deleting a chat is not a behaviour this
  product gets to have.
- Ephemeral threads keep maps in the memory backend and never get a project ref (§2.6 **AZ-5**).
- Every new door coerces `status` fields it does not own (§2.6 **AZ-3**) — maps carry none, project
  refs carry none, and that is deliberate.

#### 3.6.3 Transfer format (S1 kickoff, integrator)

`app/transfer-format.mjs` stays at `LOLCHAT_FORMAT = 1` (an older build reads the file and ignores
the new keys; a newer build reads an older file unchanged) and gains:

- `THREAD_FIELDS` += `studio` — validated on import by `app/studio-state.mjs`'s own sanitiser, with
  `projectId` **dropped on import** (a project id from another machine points at nothing here).
- `PART_FIELDS.map = ['type', 'mapId', 'title']`, remapped like `attId` through the id maps.
- An optional top-level `maps: []`, exported with the threads they belong to, imported as **copies**
  with new ids and rewritten `threadId`/`node.attId` references — the same discipline as messages
  (§2.6 **BB-5**: one new id per record, repeats reported).
- `threadToMarkdown` gains nothing; `mapToMarkdown` lives in `map/format.mjs` (S1-U1).

#### 3.6.4 kv keys added (contract; built with `KV_KEYS`)

| Key | Owner | Meaning |
|---|---|---|
| `ui:workWidth` | S0-U1 | last split width in px, as a fraction string |
| `ui:workPanel` | S0-U1 | the last panel opened, used only for a brand-new thread |
| `structuredMode:<farmId>:<underlying>` | S0-U2 | `'json'` \| `'prompt'` (was already reserved) |
| `cap:<farmId>:<underlying>:vision` | S0-U2 | `'yes'` \| `'no'` (was already reserved) |
| `editPolicy:<underlying>` | S2-U3 | `'auto'` \| `'whole'` \| `'anchored'` — the O3 switch (default `'auto'`) |
| `anchorStats:<underlying>` | S2-U3 | `{tried, applied, refused}`, the rolling measurement behind `'auto'` |
| `pref:mapLayout` | S1-U2 | `'tidy'` (only value today; the key exists so a second layout is a one-file change) |
| `pref:queueMax` | S0-U3 | batch size cap, default 4 |

No key is read by two units; none is a global last-model memory (§3.10 inherited).

### 3.7 The sandbox (S2-U1) — exact specification

#### 3.7.1 Surface and CSP

The surface is **one `<iframe>`, created only by `sandbox/host.mjs`**:

```js
const url = new URL('./runner.html', import.meta.url);        // never from location (harness vs prod depth)
const fr = document.createElement('iframe');
fr.setAttribute('sandbox', 'allow-scripts');                  // NO allow-same-origin, ever (lint rule 12)
fr.setAttribute('referrerpolicy', 'no-referrer');
fr.setAttribute('allow', '');                                 // no permissions delegated
fr.src = url.href;
```

`sandbox="allow-scripts"` is **mandatory, not hardening** (F3): the opaque origin gets its own
process, so a generated infinite loop costs the host 12 ms instead of freezing the client that holds
the user's chats.

`runner.html` is a single self-contained file whose entire head is one comment, one `<meta charset>`,
one `<meta http-equiv="Content-Security-Policy">` and one `<style>`; its body is one `<div id="root">`
and one inline `<script>` (the bootstrap). **`RUNNER_CSP`, byte-frozen by lint rule 9:**

```
default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src blob:; worker-src blob:; font-src data:; form-action 'none'; base-uri 'none'
```

Note the absence of `'self'` anywhere: the runner can load **nothing** from disk (F4 makes
`script-src 'self'` useless in the opaque origin anyway, and `'self'` on a `file:` origin would let a
guest read arbitrary files through `<script src>` and leak them back out through `window.onerror`).
Everything the guest runs — the sketch, the vendored libraries, the project's own `lib/` files —
arrives as **text or a `data:` URL over `postMessage`** and is evaluated inline.

#### 3.7.2 Message protocol (`sandbox/protocol.mjs`, pure, shared by both sides)

Envelope: `{v: 1, tok, id, cmd | kind, …}`. `v` is the protocol version (a mismatch is a hard error,
never a best-effort parse). `tok` is a 16-byte random nonce minted by the host per iframe and handed
over in `boot`.

**Host → guest** (`postMessage(msg, '*')` — the opaque origin has no nameable origin; the nonce is the
compensating control, and a guest can only ever reach its own parent):

| `cmd` | Payload | Meaning |
|---|---|---|
| `boot` | `{tok, limits:{maxLogs, maxErrors, logBytes}}` | first message; the guest stores `tok` and replies `ready` |
| `libs` | `{libs:[{name, source}]}` | evaluate each library source in guest global scope, in order; reply `libsDone` with per-lib `{name, ok, error}` |
| `run` | `{id, code, kind, params, html?, css?}` | reset, then run |
| `params` | `{values}` | update the live knob values without a re-run |
| `snapshot` | `{id, maxPx}` | reply `frame` with a `data:image/png` of the first canvas (or the root element rasterised via `OffscreenCanvas` when there is no canvas), longest side ≤ `maxPx` |
| `stop` | `{}` | cancel rAF/timers/workers, clear the root, keep libraries loaded |
| `ping` | `{seq}` | reply `pong` |
| `dispose` | `{}` | reply `bye`; the host then removes the iframe |

**Guest → host:**

| `kind` | Payload |
|---|---|
| `ready` | `{v, ua: 'runner'}` |
| `libsDone` | `{results:[{name, ok, error}]}` |
| `ran` | `{id, ok, ms, error: {message, stack, line, col}|null}` |
| `error` | `{phase:'run'|'runtime'|'rejection'|'lib', message, stack, line, col, n}` |
| `log` | `{level:'log'|'info'|'warn'|'error', text, n}` |
| `frame` | `{id, dataUrl, w, h}` |
| `pong` | `{seq}` |
| `bye` | `{}` |

**Reset semantics of `run`** (the guest does all of this before evaluating a line of new code):
cancel every `requestAnimationFrame` handle it issued, `clearTimeout`/`clearInterval` every id it
issued (the guest wraps all four at boot), `terminate()` every `Worker` it created, remove every
event listener registered through its wrapped `addEventListener` on `window`/`document`, close every
`AudioContext`, `replaceChildren()` the root, and drop the previous scope object. Then:

```js
root.innerHTML = html || DEFAULT_HTML_FOR_KIND;   // the guest may innerHTML: it IS the containment boundary
styleEl.textContent = css || '';
const fn = new Function('lol', code);             // 'use strict' is prepended by the guest
fn(lolApi);                                       // lolApi = {params, onParams(fn), canvas, root, log, size}
```

`ran.ms` is measured around `fn(lolApi)` only (synchronous setup time); asynchronous failures arrive
later as `error` envelopes. **The host never evaluates guest-supplied text**, never `innerHTML`s it,
and treats every field as data (strings are capped and stringified before they reach the DOM).

**Host-side validation, on every message:** `event.source === fr.contentWindow`, `msg.v === 1`,
`msg.tok === tok`, `kind` in the table, payload fields coerced by type with hard caps
(`message`/`stack`/`text` 4 KB each, `dataUrl` 4 MB, arrays ≤ 64). Anything else is dropped and
counted; ten dropped messages in a row tear the frame down.
**Guest-side validation:** `event.source === window.parent`, `msg.v === 1`, and after `boot`,
`msg.tok === tok`.

#### 3.7.3 Error and console capture (the free-repair loop, V3)

The guest installs, at boot: `window.onerror`, `window.onunhandledrejection`, and wrappers around
`console.{log,info,warn,error}` whose arguments are stringified **in the guest** (depth 2, 2 KB per
entry). Both are rate-limited: at most `maxErrors` (20) and `maxLogs` (200) envelopes per `run`,
after which the guest coalesces (`{n: 47}` on the last one) and stops sending. Stacks are sanitised
guest-side — every `file:`/`blob:` URL is replaced by `sketch.js` — so a stack can never carry a path
back into the host UI or into a prompt sent to the farm.

The panel shows the first error inline under the preview with a **"Ask the model to fix it"** button
(O6: never automatic). What that button sends is the error `message` + the sanitised first three
stack frames + the current file — never the raw console dump.

#### 3.7.4 Watchdog and timeouts

- **Ping** every 1,000 ms (`setInterval` — the **only** one permitted in the chat tree, lint rule 13).
  Two consecutive missed `pong`s ⇒ state `stalled`.
- **Run timeout:** a `run` with no `ran` within `RUN_TIMEOUT_MS = 5000` ⇒ `stalled`.
- **Stalled ⇒ rebuild:** the host removes the iframe (returns in ~1 ms even mid-loop, F3), creates a
  new one with a fresh nonce, replays `libs`, and shows one row: "the sketch stopped responding — the
  preview was restarted". It does **not** re-run the sketch automatically (an infinite loop would loop
  again); the Run button is left armed.
- **Boot timeout:** no `ready` within 3,000 ms ⇒ state `disabled` with a visible reason; the panel
  still shows the code and the project.
- Three rebuilds within 60 s ⇒ `disabled` until the user clicks Run again. No silent retry storms.
- Every timer is cleared by `hide()` and `destroy()`.

#### 3.7.5 Vendored libraries (O1)

Shipped under `shell/renderer/chat/sandbox/lib/`, byte-identical upstream builds, each with its
licence file, each row in the lint's `LIB_MANIFEST` (path, sha256, version, upstream URL, licence
file) — lint rule 14 and scope's `checkLibManifest` make "unmodified" a checkable fact:

| Library | Version pin | Licence | Build | Why |
|---|---|---|---|---|
| **three.js** | r1xx (pinned at S2 kickoff) | MIT | `three.min.js` (UMD global `THREE`) | the office does VR/3D; the single most-asked-for creative-coding runtime here |
| **p5.js** | 1.x (pinned at S2 kickoff) | **LGPL-2.1** | `p5.min.js` (global mode) | the owner's own stack; a bench whose first run is a bare canvas gets opened once |
| **matter.js** | 0.20.x | MIT | `matter.min.js` | 2D physics, ~90 KB, the classic p5 companion; turns "make a sketch" into "make a toy" |

Rejected on purpose, so the list stays defensible: `lil-gui` (we ship knobs, §V5), `tone.js`
(~400 KB for a use case nobody asked for), `d3` (the design panel computes its own geometry),
`gsap` (non-free for some uses). **Four candidates considered, three shipped, cap of five kept.**

- **Total budget: ≤ 2.0 MB** of library text plus ≤ 40 KB of licence files, measured at the S2
  landing and recorded in DEVLOG (U5). If the pinned builds exceed it, matter.js is dropped first.
- **How they reach the guest:** `sandbox/libs.mjs` fetches `new URL(LIB_FILES[name], import.meta.url)`
  (the single sanctioned `fetch` outside `net/`, lint rule 11), caches the text in memory for the
  session, and the host sends it in a `libs` message. Nothing is downloaded at runtime; nothing is
  bundled; the files ship inside `app.asar` (`files: [renderer/**/*]` already covers them — **no
  packaging change**).
- **Per-project override:** if the project folder has `lib/<name>.js`, its text is used instead, with
  a visible "using this project's p5.js" note. That is how a user pins their own version without us
  shipping a version manager.
- **LGPL-2.1 obligations** (p5.js): shipped verbatim and unmodified, licence file included, the About
  section lists it with a link to the local licence file, and the user can replace it with their own
  build (the `lib/` override above *is* the relink freedom). Recorded for the packaging/licence page
  as a DISCUSS item at the S2 landing.

#### 3.7.6 What the guest cannot reach (asserted, not assumed)

| Reach | Blocked by | Proven by |
|---|---|---|
| the network (farm, LAN, internet) | `connect-src 'none'` | `s2-sandbox-isolation` (fetch to the mock's own port rejects) |
| the disk | no `'self'`: `fetch(file:)`, `<script src>`, `<img src=file:>` all refused | `s2-sandbox-isolation` |
| `localStorage` / `sessionStorage` / IndexedDB | opaque origin ⇒ `SecurityError` | `s2-sandbox-isolation` |
| the parent DOM, `window.lol`, the repo, the governor | cross-origin ⇒ `SecurityError`; `postMessage` only | `s2-sandbox-isolation` |
| navigation anywhere | `frame-src 'none'` inside; host CSP `frame-src`←`default-src 'self'` outside; **plus** the main-process `will-frame-navigate` veto | `s2-sandbox-navigate` |
| stalling the client | opaque origin ⇒ own process (F3) | `s2-sandbox-hang` (**a release gate**, vision §9) |
| surviving the panel | `hide()` suspends, `destroy()` removes the iframe | `s0-workbench-hidden`, `s2-sandbox-lifecycle` |

#### 3.7.7 Lifecycle

Created lazily on the first Run in a live panel; **never** while the panel is hidden or the page is
not visible; destroyed by `hide()` after a 10 s grace (so tab-flipping does not pay a rebuild),
immediately by `destroy()`, and always before the window closes. One iframe per live panel, maximum
one panel live (§3.5.2) ⇒ **at most one sandbox in the process**, which is also why the design
panel's component sheet reuses the same host rather than making a second one.

### 3.8 The scratch-projects API (S0-U4) — exact specification

#### 3.8.1 Main process (`shell/src/main/projects.ts`)

```ts
export function createProjectsApi(opts: {
  rootDir: string;                     // computed in MAIN, never from the renderer
  shellApi: { showItemInFolder(p: string): void; openPath(p: string): Promise<string> };
  fsApi?: typeof import('node:fs/promises');   // injectable for tests
  now?: () => number;
}): ProjectsApi;

type Ok<T> = {ok: true} & T;
type Err = {ok: false; code: ErrCode; message: string};
type ErrCode = 'E_ROOT'|'E_ID'|'E_PATH'|'E_EXT'|'E_SIZE'|'E_QUOTA'|'E_RATE'|'E_MISSING'|'E_LOCKED'|'E_CONFLICT'|'E_IO';

interface ProjectsApi {
  root(): Promise<Ok<{path: string; exists: boolean; writable: boolean}> | Err>;
  list(): Promise<Ok<{projects: ProjectMeta[]}> | Err>;
  create(input: {name: string; kind: ProjectKind; settings?: Partial<ProjectSettings>}): Promise<Ok<{project: ProjectMeta}> | Err>;
  meta(id: string): Promise<Ok<{project: ProjectMeta}> | Err>;
  update(id: string, patch: {name?: string; settings?: Partial<ProjectSettings>}): Promise<Ok<{project: ProjectMeta}> | Err>;
  forget(id: string): Promise<Ok<{}> | Err>;                       // hides it from the list; DELETES NOTHING
  listFiles(id: string): Promise<Ok<{files: {path: string; size: number; mtime: number}[]}> | Err>;
  read(id: string, rel: string): Promise<Ok<{text: string; size: number; mtime: number}> | Err>;
  readBinary(id: string, rel: string): Promise<Ok<{base64: string; size: number; mime: string}> | Err>;
  write(id: string, rel: string, text: string, o?: {ifMtime?: number}): Promise<Ok<{size: number; mtime: number}> | Err>;
  writeBinary(id: string, rel: string, base64: string): Promise<Ok<{size: number}> | Err>;
  remove(id: string, rel: string): Promise<Ok<{}> | Err>;          // FILES ONLY, never a directory
  reveal(id: string): Promise<Ok<{}> | Err>;                       // shell.showItemInFolder(<project dir>)
  open(id: string): Promise<Ok<{}> | Err>;                         // shell.openPath(<project dir>)
  path(id: string): Promise<Ok<{path: string}> | Err>;             // the absolute path, for "Copy path"
}
```

- **Nothing throws across IPC.** Every call resolves to `Ok` or `Err`; an unexpected exception is
  caught, logged main-side with the stack, and returned as `E_IO` with a generic message (a message
  that never contains a path outside the root).
- **`rootDir`** = `<dataDir>/LOL Studio Projects` where `dataDir` is the shell's existing setting,
  falling back to `app.getPath('userData')`. Computed once at wire-up inside the marked region of
  `index.ts`; the renderer can neither read nor set it (it only ever learns the string back from
  `root()`/`path()`, for display and clipboard).
- **Project directory** = `<rootDir>/<id>`, where `id = <slug(name, 48)>-<8 random base36>`, minted by
  `create` and matched thereafter against `^[a-z0-9][a-z0-9-]{0,47}-[a-z0-9]{8}$`. The renderer never
  invents an id; an id it did not get from `create`/`list` simply does not resolve.
- **Metadata** lives in `<project>/project.json` (`{v:1, id, name, kind, createdAt, updatedAt,
  settings, hidden}`). There is no central index file to corrupt; `list()` is a directory scan
  (`withFileTypes`, ≤ 200 entries, each read + JSON-parsed with a 64 KB cap, unparsable ⇒ skipped and
  counted). `forget` sets `hidden:true` and rewrites that file — it never deletes anything.

#### 3.8.2 Path validation (`shell/src/main/projectsPath.ts`, pure, table-tested)

```ts
export function validateId(id: string): {ok: true; id: string} | {ok: false; code: 'E_ID'};
export function validateRel(rel: string, o: {maxDepth?: number; maxLen?: number}):
  {ok: true; segments: string[]; ext: string} | {ok: false; code: 'E_PATH'|'E_EXT'};
export function resolveIn(root: string, id: string, rel: string):
  {ok: true; abs: string} | {ok: false; code: 'E_PATH'|'E_ID'};
export const TEXT_EXT: readonly string[];    // .html .htm .js .mjs .css .json .md .txt .svg .ino .h .hpp .c .cpp .ini .yml .yaml .csv .glsl .frag .vert
export const BIN_EXT:  readonly string[];    // .png .jpg .jpeg .gif .webp .ico .wav .mp3 .ogg .ttf .otf .woff2
```

`validateRel` refuses, in this order, each with `E_PATH` unless noted:

1. empty, longer than 200 chars, or containing a NUL or any C0 control character;
2. a backslash anywhere (Windows separators never arrive from the renderer — `/` only);
3. an absolute path, a drive letter (`c:`), a UNC prefix (`//`), or a leading `/`;
4. any segment equal to `.` or `..`;
5. more than `maxDepth` (4) segments, or any segment longer than 64 chars;
6. a segment containing `:` (NTFS alternate data streams), `*?"<>|`, or a trailing dot or space;
7. a segment whose name, **with any extension stripped**, matches a Windows reserved device name
   (`CON PRN AUX NUL COM0-9 LPT0-9`, case-insensitive) — `CON.txt` is still `CON`;
8. a leading `.` on the first segment other than the one allowed name `.gitignore` (no dotfile trees,
   no `.git` writes);
9. an extension not in `TEXT_EXT` (for text calls) or `BIN_EXT` (for binary calls) ⇒ `E_EXT`.

`resolveIn` then does the mechanical check that no clever encoding survives: `path.resolve(root, id,
...segments)`, and the result must satisfy `abs === root+sep+id` or `abs.startsWith(root+sep+id+sep)`
after both sides are normalised (and, on Windows, case-folded with `toLowerCase()` for the comparison
only — never for the path actually used).

In `projects.ts`, **every component of the resolved path is `lstat`-ed before use**: a symlink,
junction or reparse point anywhere under the project directory ⇒ `E_PATH` and the operation stops.
This is the check that makes the root a real boundary on a machine where the user can create
junctions.

#### 3.8.3 Quotas, rate limits, atomicity

| Limit | Value | Code |
|---|---|---|
| text file | 2 MB | `E_SIZE` |
| binary file | 8 MB | `E_SIZE` |
| files per project | 512 | `E_QUOTA` |
| bytes per project | 200 MB | `E_QUOTA` |
| projects | 200 (visible + hidden) | `E_QUOTA` |
| writes | 20/s per project, token bucket, burst 40 | `E_RATE` |

- **Writes are atomic:** write `<name>.<rand>.tmp` in the same directory, `fsync`, then `rename` over
  the target. A crash never truncates a sketch. Temp files older than an hour are swept on `list()`.
- **Optimistic concurrency:** `write(..., {ifMtime})` returns `E_CONFLICT` when the file changed since
  the caller read it — that is how "disk wins" (V7) is implemented without a watcher.
- **Reads** are `utf8` with a hard byte cap; a file that is not valid UTF-8 comes back as `E_IO` for
  text and is fine for `readBinary`.

#### 3.8.4 Failure modes, stated so the UI can be honest

| Situation | Behaviour |
|---|---|
| root missing | created lazily (`recursive:true`) on the first `create`; `root()` reports `exists:false, writable:false` before that |
| root cannot be created (permissions, missing drive, read-only) | every call returns `E_ROOT` with the path; the Preview panel shows "projects folder unavailable — <path>" + **Retry**, and falls back to the memory backend so sketches still run |
| project folder deleted behind our back | `E_MISSING`; the row is marked "folder missing" and offers **Forget** (never a silent re-create) |
| file open in another program (EPERM/EBUSY/EACCES on rename) | 3 retries at 50 ms, then `E_LOCKED` with "the file is open in another program" |
| antivirus/OneDrive delay on rename | the same retry ladder; the retry count is reported in DEVLOG at the S0 landing |
| disk full (ENOSPC) | `E_IO` with "the disk is full"; nothing is half-written (the temp file is removed) |
| path too long (ENAMETOOLONG or > 240 chars resolved) | refused **before** the call with `E_PATH`; `create` also refuses when `rootDir` itself is longer than 150 chars, with a message naming the data folder |
| the renderer sends a path that fails validation | `E_PATH`, logged main-side once per minute with the offending value truncated to 80 chars (a bug signal, not a user message) |

#### 3.8.5 IPC, preload and the renderer bridge

- Channels are `lol:projects:<op>`, one `ipcMain.handle` each, all inside the marked region of
  `index.ts`. Each handler validates arity and argument **types** before calling the API (a renderer
  compromise still cannot hand `write` a number).
- Preload adds exactly one property to the existing `lol` object:
  `projects: {root, list, create, meta, update, forget, listFiles, read, readBinary, write,
  writeBinary, remove, reveal, open, path}`, each a thin `ipcRenderer.invoke`. No event channels, no
  `on*` subscriptions — the renderer polls on its own actions, and there is no watcher (§V7 polls
  `BRIEF.md` on the existing `EV.FARM_TICK`).
- `projects/bridge.mjs` (the **only** module allowed to name `window.lol`, lint rule 10) exposes
  `app.projects` with the same method names plus `kind() -> 'real'|'memory'`, normalises every `Err`
  into `{ok:false, code, message}`, and falls back to `projects/memory.mjs` (a pure in-memory
  implementation of the same interface, with the same validator rules re-implemented as the same
  table) when `window.lol?.projects` is absent. **Every unit test and most scenarios run against the
  memory backend**; `needsProjects:'real'` scenarios run against the real one.
- **What is deliberately NOT exposed:** any absolute path as an *input*; directory creation or
  deletion as such (directories appear implicitly from a file path's segments and are never removed);
  `shell.openExternal`; `vscode://` (O2 — recorded as a separate one-line change for later review);
  `child_process`; watching; and any call that takes a path from a message body without a user click.

### 3.9 The edit engine policy (O3)

Default, per owner decision: **whole-file rewrite** for files under 200 lines, anchored SEARCH/REPLACE
above it, behind a measurable switch.

```js
// preview/edit.mjs (pure)
choosePolicy({lines, kv, underlying}) -> 'whole'|'anchored'   // kv editPolicy:<underlying> overrides ('auto' = the rule)
parseEdits(reply) -> {edits: [{search, replace, i}], full: string|null, lang}
applyEdits(text, edits) -> {ok, text, applied: number[], refused: [{i, why:'not-found'|'ambiguous'}]}
```

- **Anchored application is exact**: the `search` block must occur **exactly once** in the file (after
  newline normalisation only). Zero matches ⇒ `not-found`; two or more ⇒ `ambiguous`. No fuzzy
  matching, no whitespace-insensitive fallback, no "nearest line" heuristics.
- **A refusal is visible**: "2 of 3 edits applied — the third anchor was not found" with a **Rewrite
  the whole file** button. Nothing is written until the user accepts (O6: auto-apply off).
- `kv anchorStats:<underlying>` counts `{tried, applied, refused}` on every anchored attempt. `'auto'`
  starts at the 200-line rule and, once `tried ≥ 20`, switches the threshold: below a 80 % applied
  rate it stops choosing `anchored` at all (and says so in the panel's settings line). This is the
  switch U1/§5 **S-R7** measures against the live farm; the default does not wait for it.

### 3.10 Vision (O4)

The farm serves a vision-capable model (F16), so vision features are built for real. The gate stays,
one line of code and one sentence of UI:

- `app.ask.vision(underlying)` → `'yes' | 'no' | 'unknown'` from `app/caps.mjs` (§3.4.3, a GET, no
  seat).
- `'no'` ⇒ the surface renders **one sentence** naming what the operator has to switch on, and the
  non-vision half of the panel keeps working (palette-from-photo is pure JS and never gates).
- `'unknown'` ⇒ the feature is offered; a `vision_unsupported` 400 downgrades the verdict and shows
  the same sentence. We never spin forever and never pretend.
- **Image budget is real:** `IMAGE_TOKENS = 1600` each (§2.6 **AZ-4**). A moodboard batch sends **one
  image per request** (a queue of N asks, §3.4.1), never twelve in one — that is both the honest way
  to stay inside a context window and the only way the queue stays cancellable.
- Images are downscaled before they are sent: longest side ≤ 1,280 px, JPEG q0.82 (or PNG when the
  source has alpha), via `createImageBitmap` + `OffscreenCanvas` (F9). `media/image.mjs` (pure) owns
  the arithmetic; the original blob is what the attachment stores.

### 3.11 Board packs (S3-U4)

A pack is **data, not code**: a frozen object exported from `board/pack/<id>.mjs`, registered through
`BOARD_PACKS`. Shape in §3.3. Three rules:

1. **Every fact carries `source`** (datasheet name + section, or the vendor doc) and `verified:
   true|false`. The UI renders unverified facts in a muted style with the word "unverified" — vision
   §10.2: a wrong strapping-pin note is worse than no note.
2. **The linter reads the pack, never the model** (§B3): `board/lint.mjs` is pure, takes the sketch
   text and a pack, and returns `PinFinding[]`. Silence where unsure is mandatory — a rule that cannot
   parse the pin expression emits nothing rather than guessing.
3. **The injected slice is ≤ 300 tokens** (`board/select.mjs`, pure): only the pins the sketch
   mentions, plus the board's identity line and any note whose trigger words appear in the prompt.
   Never the whole table (§B2).

Three boards ship (vision §10.2): `esp32-devkitc-v4` (ESP32-WROOM-32), `esp32-s3-devkitc-1`,
`arduino-uno-r3`. Adding a fourth is one file plus one registry row plus its test table.

### 3.12 What the code computes, never the model (§1.2.8)

| Computation | Module | Test |
|---|---|---|
| WCAG 2.1 contrast ratio, relative luminance, AA/AAA verdicts | `design/color.mjs` (pure) | known-value table incl. the WCAG reference pairs |
| palette extraction from an image (median cut, k=6, deterministic) | `design/quantize.mjs` (pure) | fixed fixture → fixed hexes, byte-stable across runs |
| token set → CSS `:root{}` text in the ComfyQ shape | `design/tokens.mjs` (pure) | round-trip: parse(render(x)) === x |
| SVG sanitisation (element/attribute allow-list) | `design/svg-sanitize.mjs` (pure) | the `mock-svg` corpus + XSS corpus |
| tidy-tree geometry, collision-free, stable under insertion | `map/layout.mjs` (pure) | golden layouts, 1,200-node timing |
| markdown outline ⇄ map | `map/format.mjs` (pure) | round-trip |
| pin parsing and pin rules | `board/lint.mjs` (pure) | table per board |
| edit application | `preview/edit.mjs` (pure) | exact/ambiguous/not-found table |
| token estimates for anything we send | `ctx/tokens.mjs` (existing) | unchanged |

---

## 4. Phases

Every phase, unchanged from `LOLCHAT_PLAN.md` §4: **kickoff** (contract additions, loader rows, mock
additions, CSS stubs — committed before units start), **units in parallel on disjoint files**,
**landing** (wire `main.mjs`/`chat.css`/`page.html`, run every gate, light+dark screenshots, one
DEVLOG entry, DISCUSS and rig additions).

Landing gate command, unchanged:

```bash
node shell/test/chat-unit.js && node shell/test/unit.js && node shell/test/chat-lint.js && \
node shell/test/chat-scope.js && node shell/test/chat-harness/run.js --strict && \
node shell/test/chat-harness/run.js --strict --phase perf
```

From S0 on, the landing also runs `npm --prefix shell run build` first (so `needsProjects:'real'`
scenarios are not skipped) and asserts **0 skipped** scenarios.

---

### S0: Rails (workbench, ask spine, queue, projects API)

**Goal.** Everything the three panels stand on, and nothing a user sees except a third column that is
empty until S1. At the end of S0: the workbench opens and closes with the keyboard, an `ask` returns
typed JSON against the mock with a working prompt-and-parse fallback, a batch is visible and
cancellable with a seat ledger beside it, and a scratch project can be created, written and revealed
in Explorer.

Vision ids: R1, R2, R3, R4, R5; V2 (the API half).

**Kickoff (integrator):**

1. `core/registry.mjs`: the six new slots (§3.2).
2. `core/types.mjs`: `StudioState`, `MapDoc`, `MapNode`, `MapEdge`, `ProjectMeta`, `AskResult`,
   `Revision`, `Knob`, `BoardPack`, `BoardPin`, `PinFinding`; `Thread.studio?`; `Part` gains
   `{type:'map'}`; `KV_KEYS` gains the eight keys of §3.6.4.
3. `ui/layout.mjs` + `css/base.css`: `els.work` and the three-column grid (§3.5.1).
4. `state/{schema,repo,backend-idb,backend-memory}.mjs`: DB v2, the two stores, the six repo methods,
   the `deleteThread` cascade (§3.6.1–3.6.2).
5. `main.mjs`: `PHASE='S0'` and the four S0 loader rows (§3.1).
6. `chat/chat.css`: `@import` stubs for `css/{workbench,queue,projects}.css`.
7. `shell/test/chat-lint.js` + `chat-scope.js`: rules 9–14 and the five `ALLOWED` rows (§2.4, §2.5),
   each with self-tests; `PURE_MODULES` filled for all four phases.
8. Mock: the five S0 models and three state flags (§2.3); `helpers.js`: `h.work`, `h.width`,
   `h.ask.log`, `h.projects`, `h.files`, `needsProjects`; `main.cjs`/`preload.cjs`: the projects IPC
   and the `will-frame-navigate` veto (§2.2).
9. Freeze block **S-A** in §2.7.

#### S0-U1: The workbench

**Files owned**
- `shell/renderer/chat/ui/workbench.mjs`
- `shell/renderer/chat/app/studio-state.mjs` (pure)
- `shell/renderer/chat/css/workbench.css`
- `shell/renderer/chat/strings/studio.en.mjs`
- `shell/test/chat/unit/studio-state.test.mjs`
- `shell/test/chat-harness/scenarios/s0-workbench.mjs`

**Spec.** §3.5.1–§3.5.3 exactly.
- `install(app)` publishes `app.work = {open(panelId), close(), current(), width(state), panels(),
  request(panelId, width), on(fn)}`; renders the tab rail from `registry.list(WORKBENCH_PANELS)` **at
  render time** (§2.6 **AD**) and shows an empty rail (and no column) when the slot is empty — which
  is exactly the S0 state.
- Width control: a three-position segmented control in `els.workHead`, a drag handle between
  `.chat-main` and `.chat-work` (pointer events, `kv ui:workWidth`), and `SHORTCUTS` items:
  `Ctrl+\` cycles chat→split→work, `Ctrl+1..4` opens the n-th panel (only while `app.state.visible`
  and focus is inside `#lolchat` or on `<body>` — the existing rule).
- Lifecycle per §3.5.2, including the 10 s grace before a hidden panel is destroyed vs suspended, and
  the `EV.THREAD_SELECTED` handling (`created:true` ⇒ start closed, §2.6 **AP.1**).
- Accessibility: the rail is a `role="tablist"` with roving tabindex; the body is
  `role="tabpanel" aria-labelledby`; the width control is a `radiogroup`; every state change announces
  once in `els.live`.

**Provides.** `app.work`, the `WORKBENCH_PANELS` host, `thread.studio` persistence.

**Acceptance**
- `chat-unit studio-state`: merge/clamp/sanitise table — unknown panel, unknown width, stale
  `projectId`, `mapId` that does not resolve, debounce coalescing, and that a sanitise never mutates
  its input.
- Harness `s0-workbench` (with a **test-only** panel registered from the scenario through
  `app.registry`, since no real panel exists yet):
  - `s0-workbench-open`: `Ctrl+\` cycles the three widths; the grid column width changes; `kv
    ui:workWidth` persists across a reload.
  - `s0-workbench-single`: opening panel B while A is live calls `A.hide()` **before** `B.show()`
    (asserted through a call log on the test panels), and never has two live at once.
  - `s0-workbench-hidden`: hiding `#lolchat` calls `hide()`; the panel's rAF stops (a frame counter
    stops advancing); unhiding calls `show()`.
  - `s0-workbench-thread`: switching to a thread with no studio state closes the panel; switching back
    restores panel + width from `thread.studio`.
  - `s0-workbench-a11y`: tab roles, roving tabindex, one live-region announcement per change.
  - `s0-workbench-parity`: with the workbench closed, `p1-basic-stream` behaviour is unchanged (the
    scenario re-runs a send and asserts the same DOM shape) — the third column costs the chat nothing.

#### S0-U2: The ask spine and capability checks

**Files owned**
- `shell/renderer/chat/app/ask.mjs`
- `shell/renderer/chat/app/json.mjs` (pure)
- `shell/renderer/chat/app/caps.mjs`
- `shell/renderer/chat/strings/ask.en.mjs`
- `shell/test/chat/unit/{json,ask}.test.mjs`
- `shell/test/chat-harness/scenarios/s0-ask.mjs`

**Spec.** §3.4 exactly.
- `ask` builds its request through `net/request.mjs` (`toOpenAIBody`, with `responseFormat`) and runs
  it through `net/run.mjs` — **not** through `controller.generate` (an ask is not a turn and must
  never touch the repo or the view).
- Governor discipline per §1.2.6; `holder='ask:<task>'`; `signal` aborts.
- The ladder of §3.4.2 with the `kv structuredMode:` verdict, the reasoning fallback (F8), and the
  `max_tokens` floor.
- `app/caps.mjs` installs the `setCapResolver` GET (§3.4.3) and nothing else; it never POSTs.
- `queue` per §3.4.1: strictly serial, one batch at a time, `'ask:queue'` bus events
  (`{label, i, n, running, cancelled}`), `pref:queueMax` cap.

**Provides.** `app.ask` for every later panel; `app.ask.vision()`/`mode()` for the gates.

**Acceptance**
- `chat-unit json`: `extractJson` over a corpus (bare object, fenced, prose-then-fence, two objects,
  truncated, nested braces in strings, array root, BOM, CRLF); `validate` over type/enum/required/
  additionalProperties/min/max; `coerce` drops unknowns and **never** invents a required field;
  `promptFor` is deterministic.
- `chat-unit ask`: with a fake farm + fake `run`, the ladder takes schema → prompt → text in order,
  writes the kv verdict at the right moments, respects the `max_tokens` floor, refuses when the
  governor is busy, aborts on signal, and runs a 4-item queue strictly serially (never two in flight).
- Harness `s0-ask`:
  - `s0-ask-schema`: `mock-studio-json` returns a typed object; `/mock/last-body` shows
    `response_format.json_schema.strict === true` and `max_tokens ≥ 512`.
  - `s0-ask-drop`: `state.structuredDrop` ⇒ the schema is stripped upstream, the reply is prose, the
    fallback parses it, and `kv structuredMode:` flips to `'prompt'` after the second failure.
  - `s0-ask-reasoning-only` / `s0-ask-empty`: `mock-json-reasoning-only` parses from reasoning;
    `mock-json-empty` returns `{ok:false, error:{kind:'empty'}}` and the scenario asserts a visible
    Retry affordance in the test host, never a silent resolve.
  - `s0-ask-busy`: while a normal send streams, an ask returns `{kind:'busy'}` immediately and issues
    **zero** POSTs.
  - `s0-ask-queue`: a 4-item queue issues exactly 4 POSTs, never overlapping (`/mock/log` timestamps),
    cancel mid-queue stops after the in-flight item, and nothing runs while `#lolchat` is hidden.
  - `s0-ask-vision-cap`: `state.modelGroupInfo` with `supports_vision:false` ⇒ `app.ask.vision()` is
    `'no'` after one **GET** and **zero** POSTs; `mock-vision-refuse` on an unknown model downgrades
    the cached verdict to `'no'`.

#### S0-U3: Seat ledger, batch queue chip

**Files owned**
- `shell/renderer/chat/ui/strip.mjs` (takes over from P2-U1)
- `shell/renderer/chat/ui/queue.mjs`
- `shell/renderer/chat/css/queue.css`
- `shell/renderer/chat/strings/etiquette.en.mjs` (takes over) and `strings/queue.en.mjs`
- `shell/test/chat/unit/queue.test.mjs`
- `shell/test/chat-harness/scenarios/s0-queue.mjs`

**Spec.** §3.5.4. The strip keeps every existing field and behaviour (`p2-strip` must stay green
unchanged); the ledger is additive and still **never prints a dash for a missing value**. The queue
chip renders `label · i/n` with a Cancel button, is announced once in `els.live` when it starts and
when it ends, and disappears when idle. Registered as a `CANCEL_HANDLERS` item (active only while a
batch runs) so Escape and Stop reach it (§2.6 **BB-3**: one cancel door).

**Provides.** `app.queue` (a thin read-only view over `app.ask.queue` state) and the ledger.

**Acceptance**
- `chat-unit queue`: the pure state reducer over `'ask:queue'` events — start, progress, cancel,
  error, end; two starts are refused; the chip's text is stable for equal states (no churn).
- Harness `s0-queue`: a 3-item batch shows the chip, cancel stops it (the mock log shows no further
  POST), the ledger shows `seats 1/2` from the default snapshot and hides the seat field when
  `capacity` is null, and `p2-strip` is re-run unchanged as part of this scenario file's setup check.

#### S0-U4: The scratch-projects API (separately reviewed change set)

**Files owned**
- `shell/src/main/projects.ts`, `shell/src/main/projectsPath.ts`
- the two marked regions in `shell/src/main/index.ts`; the `projects: {…}` property in
  `shell/src/preload/index.ts`
- `shell/renderer/chat/projects/bridge.mjs`, `shell/renderer/chat/projects/memory.mjs` (pure)
- `shell/renderer/chat/strings/projects.en.mjs`, `shell/renderer/chat/css/projects.css`
- `shell/test/chat/unit/{projects-path,projects-api,projects-bridge}.test.mjs`
- `shell/test/chat-harness/scenarios/s0-projects.mjs`

**Spec.** §3.8 exactly, plus the `will-frame-navigate` veto in the second marked region:

```ts
// ---- LOL Studio (S0) ---- (navigation veto; mirrored in shell/test/chat-harness/main.cjs)
win.webContents.on('will-frame-navigate', (e) => {
  if (e.isMainFrame) return;                     // the app's own navigation is unaffected
  if (e.url.startsWith(runnerUrl)) return;       // the runner loading itself, once
  e.preventDefault();
});
// ---- /LOL Studio ----
```

- This change set gets its **own commit and its own security review** before S1 starts (§1.1). The
  review checklist is §5 **S-R1**.
- `bridge.mjs` is the only `window.lol` consumer; `memory.mjs` mirrors the same validator table so a
  test can prove both backends refuse the same paths.

**Provides.** `app.projects` for S2 and S3; the navigation belt for the sandbox.

**Acceptance**
- `npm --prefix shell run build` succeeds and `npm --prefix shell run lint`-equivalent type-checking
  (`tsc`) is clean.
- `chat-unit projects-path`: a table of ≥ 60 rejected inputs — `..`, `../..`, `a/../../b`, `/abs`,
  `C:\x`, `\\unc\x`, `a\b`, `con`, `CON.txt`, `nul.ino`, `com1/x.js`, `LPT9.h`, `a .`/`a.`, `a:b`,
  `a*b`, 5-deep, 65-char segment, 201-char path, `.git/config`, `x.exe`, `x.bat`, `x.ps1`, `x.lnk`,
  empty, NUL byte, CR, and the accepted set (`sketch.js`, `lib/p5.js`, `src/main.cpp`, `.gitignore`,
  `assets/img/a.png`).
- `chat-unit projects-api` (against `shell/build/main/projects.js`, a temp root, a fake `shell`):
  create → write → read → listFiles → reveal → path; id regex enforced; `resolveIn` escape attempts
  refused; a symlinked component refused (skipped with a note if the test process cannot create a
  symlink on this box, and then covered by a junction case); quota, rate-limit, `E_CONFLICT` on a
  stale `ifMtime`, atomic write (a fault injected at rename leaves the original intact), `E_LOCKED`
  after the retry ladder with an injected EBUSY, `E_ROOT` when the root cannot be created, `forget`
  hides and **deletes nothing**, `remove` refuses a directory, `list` skips an unparsable
  `project.json` and counts it.
- `chat-unit projects-bridge`: the memory backend answers identically for every accepted and rejected
  path in the table above; `kind()` reports `'memory'` when `window.lol.projects` is absent.
- Harness `s0-projects` (`needsProjects:'real'`): create a project from the page, write two files,
  `h.files(id)` shows them on disk with the expected bytes, `reveal` records a `showItemInFolder` call
  in `main.cjs`'s spy (nothing is actually opened in the test), a path-escape attempt from the page is
  refused and logged, and a second scenario with `needsProjects:'memory'` proves the fallback UI
  sentence appears when the IPC is absent.

**Landing (integrator).** Gates green including `--strict` with the build present (0 skipped);
screenshots of the empty workbench in light and dark; DEVLOG entry recording the **U2 probe result**
(`shell.openPath` on a folder), the antivirus/rename retry count, and the projects root path shape;
freeze block **S-B**.

---

### S1: The map (thinking canvas, conversation as a map, model ops, images)

**Goal.** The first panel, finished: a map you and the model both edit, the P2 message tree finally
drawn instead of stepped through, four model operations that arrive as ghosts you keep or drop,
markdown/JSON export and import, and image intake good enough for the moodboard (and reused by S3).

Vision ids: C1, C2, C3, C4, C5, C6; the cherry-picked P3-U1 intake.

**Kickoff (integrator):** `PHASE='S1'`; the four S1 loader rows; `app/transfer-format.mjs` gains the
`map` part type, the `studio` thread field and the `maps` array (§3.6.3); `chat.css` stubs for
`css/{map,media}.css`; the three S1 mock models; `helpers.js` gains `h.map`; freeze **S-C**.

#### S1-U1: Map core (pure)

**Files owned**
- `shell/renderer/chat/map/{doc,layout,format,from-thread,schemas}.mjs` (all pure)
- `shell/test/chat/unit/{map-doc,map-layout,map-format}.test.mjs`
- `shell/test/chat/fixtures/map/**`

**Spec.**
- `doc.mjs`: the document model and **every** mutation as a pure operation returning a new doc plus an
  inverse — `addNode, editNode, moveNode, removeNode(+subtree), link, unlink, setKind, group,
  ungroup, applyGhosts(accept|reject)`. An `undo` stack of 100 steps lives in the panel; `doc.mjs`
  only produces `{doc, inverse}`. Invariants enforced here, not in the UI: ids are minted by
  `core/ids.mjs`, a parent must exist (an unknown `parentId` from the model is **dropped**, never
  created — vision §8.6), no cycles, `text` capped at 4,000 chars, node count capped at 2,000 with a
  refusal above it.
- `layout.mjs`: tidy-tree (Reingold–Tilford, variable node sizes handed in, stable ordering by
  `(createdAt, id)`), plus `pack(freeNodes)` for user-dragged nodes; returns positions only, measures
  nothing, and is deterministic.
- `format.mjs`: `toMarkdown(doc)` (nested `-` outline, one heading per root), `fromMarkdown(text)`,
  `toJson(doc)`/`fromJson(text)` for `.lolmap.json` — with the same import discipline as threads (ids
  re-minted, unknown fields dropped, sizes clamped).
- `from-thread.mjs`: `mapFromThread(thread, messages)` → a read-mostly `MapDoc` over `state/tree.mjs`
  (`indexNodes`, `siblingsOf`), one node per message, `ref.messageId` set, branches as siblings, role
  in `kind`, first 120 chars of text; deterministic and **pure** (the panel resolves live text).
- `schemas.mjs`: the four JSON Schemas for the model ops (expand, cluster, summarise, gaps), with
  `additionalProperties:false` everywhere and a `promptFor` example each.

**Acceptance.** `chat-unit map-doc map-layout map-format`:
- every operation has a tested inverse (`apply(inverse(apply(op)))` deep-equals the original);
- invented parent ids are dropped and reported; cycles refused; caps enforced;
- layout: golden fixtures for 1, 2, 50 nodes; no overlapping boxes for 500 random trees (seeded);
  inserting a node never moves an unrelated subtree by more than its own width;
- `toMarkdown`/`fromMarkdown` round-trip on three fixtures; `.lolmap.json` import re-mints ids and
  rejects a 20 MB file;
- `mapFromThread` over a P2 branching fixture produces the right sibling structure and is stable
  across two calls.

#### S1-U2: Map panel (canvas, editing, undo, a11y)

**Files owned**
- `shell/renderer/chat/map/{panel,view,a11y}.mjs`
- `shell/renderer/chat/css/map.css`
- `shell/renderer/chat/strings/map.en.mjs`
- `shell/test/chat-harness/scenarios/{s1-map,perf-map}.mjs`

**Spec.**
- A `WORKBENCH_PANELS` entry `{id:'map', order:200, defaultWidth:'work'}`; the host of `MAP_OPS` and
  `MAP_NODE_KINDS`; publishes `app.map = {doc(), apply(op), select(ids), focus(id), refresh(),
  debug}`.
- **Rendering is positioned DOM nodes in one transformed layer** (vision §4): a single
  `transform: translate() scale()` wrapper, nodes as absolutely positioned `<article>`s, edges in one
  `<svg>` sibling. Pan (space-drag / middle-drag / wheel), zoom (ctrl+wheel, 0.2–3), fit, and
  `content-visibility:auto` on nodes.
- **Above 400 nodes** detail rendering stops: nodes become title-only chips, edges become straight
  lines, and a line in the header says so (vision §4's guard). Above 2,000 the doc refuses to grow.
- Editing: double-click or Enter edits in place (`contenteditable=false`; a real `<textarea>`
  overlay), Tab adds a child, Enter adds a sibling, Delete removes a subtree with a confirm,
  drag moves (and detaches from the tidy layout — `node.pinned`), one undo stack (`Ctrl+Z`/`Ctrl+Y`,
  100 steps), autosave to `repo.putMap` debounced 500 ms.
- **Conversation mode (C1)**: when the thread's map is `source:'thread'`, the panel renders
  `mapFromThread` live, is read-mostly (no node editing), and clicking a node selects that message —
  `controller.selectThread` is not enough: it calls `app.branching.switchSibling`/`view.scrollToMessage`
  so the map is a second view of the same tree, never a divergent copy. **The `◀ 2/3 ▶` stepper keeps
  working and stays the primary path** (§8 parity).
- **Accessibility ships in this landing, not after** (vision §8.9): a `role="tree"` mirror of the same
  document, kept in sync, fully keyboard-navigable, with the canvas marked `aria-hidden` when the
  mirror has focus; every model op announces its result in `els.live`.

**Acceptance**
- Harness `s1-map`:
  - `s1-map-edit`: create → type → Tab → Enter → drag → `Ctrl+Z` ×3 → the doc matches the expected
    shape; a reload restores it from IndexedDB.
  - `s1-map-thread`: a P2 branching thread renders one node per message; clicking a sibling node
    switches the branch and the messages pane follows; the stepper still works.
  - `s1-map-a11y`: the tree mirror lists every node; arrow keys move; Enter edits; the live region
    announces once per op.
  - `s1-map-guard`: 500 nodes ⇒ simplified rendering and the header sentence; 2,001 nodes refused
    with a visible message.
  - `s1-map-lifecycle`: hiding the panel stops its rAF; a thread switch swaps documents without
    leaking listeners (a listener count is asserted through `debug`).
- Perf `perf-map` (`perf:true`, median of 3, judged): **1,200 nodes** — `layout()` ≤ 120 ms,
  first paint ≤ 400 ms, a pan of 30 frames with p95 frame ≤ 16 ms in simplified mode, memory stable
  across two layouts. Plus the inherited rule: **no existing perf row may regress by more than 15 %**.

#### S1-U3: Model operations on the map

**Files owned**
- `shell/renderer/chat/map/ops.mjs`
- `shell/renderer/chat/strings/mapops.en.mjs`
- `shell/test/chat/unit/map-ops.test.mjs`
- `shell/test/chat-harness/scenarios/s1-map-ops.mjs`

**Spec.** Four `MAP_OPS` items, all through `app.ask.json` with the S1-U1 schemas:
`expand` (a node → 3–6 children), `cluster` (a selection → groups), `summarise` (a branch → one
node), `gaps` ("what's missing" → ghost siblings). Rules:
- Results arrive **ghosted** (`node.ghost:true`, dashed, not persisted until accepted); Accept/Drop
  are per-node and per-batch; Escape drops the batch.
- Ids the model invents that do not resolve are **dropped and counted** ("2 of 5 suggestions referred
  to nodes that do not exist and were dropped").
- Each op sends ≤ 300 tokens of map context (the node, its ancestors' titles, its siblings' titles) —
  never the whole map; the exact selector is pure and tested.
- Busy governor ⇒ the op is refused with the standard sentence and no POST.

**Acceptance**
- `chat-unit map-ops`: the context selector's token budget and shape; ghost merge (accept/drop/partial)
  against `map/doc.mjs`; invented-id dropping with the count.
- Harness `s1-map-ops`: `mock-map-expand` ⇒ one ghost accepted, one invented-parent ghost dropped with
  the counted sentence; `mock-map-cluster` ⇒ groups only over ids that exist; a busy governor ⇒ zero
  POSTs and the refusal sentence; cancelling mid-op leaves the doc untouched.

#### S1-U4: Image intake and the moodboard

**Files owned**
- `shell/renderer/chat/media/{intake,image,parts}.mjs` (`image.mjs` pure)
- `shell/renderer/chat/map/moodboard.mjs`
- `shell/renderer/chat/css/media.css`
- `shell/renderer/chat/strings/media.en.mjs`
- `shell/test/chat/unit/media-image.test.mjs`
- `shell/test/chat-harness/scenarios/s1-media.mjs`

**Spec.**
- **The intake is the host of `ATTACH_SOURCES` and `ATTACH_HANDLERS`** (inert since P0): a composer
  tools button ("Add image"), plus drop and paste on `#lolchat` (the document drop guard already
  `preventDefault`s without `stopPropagation` — lint rule 7 keeps it that way).
- Pipeline: `File|Blob` → type/size check (≤ 25 MB, `image/*`) → `createImageBitmap` → downscale per
  §3.10 → `putAttachment` (deduped by `(threadId, sha256)`, the existing behaviour) → a
  `{type:'image', attId}` draft part with a thumbnail. **`PART_RENDERERS` `image`** renders user-row
  thumbnails (`fillParts` is user-rows-only, §1.9 of the scout sheet — assistant-side imagery is not
  attempted).
- Budget honesty: adding an image updates the existing meter through the existing estimator
  (`IMAGE_TOKENS`); nothing new is charged (§2.6 **AZ-4**).
- **Moodboard**: `MAP_NODE_KINDS` `image` (thumbnail node, click to open a lightbox) plus `MAP_OPS`
  `describe` — a **queue** (§3.4.1) of one ask per image against the vision model, writing tags and a
  one-line note into each node, cancellable, with the seat ledger visible. Group-by-tag is a pure
  regroup over the returned tags (our code, not the model's, decides the layout).
- `app.media = {ingest(fileOrBlob, {threadId}), thumb(attId), dataUrl(attId, {maxPx})}` — S3 reuses it
  and never re-implements downscaling.

**Acceptance**
- `chat-unit media-image`: the downscale arithmetic (aspect preservation, cap, alpha ⇒ PNG, no
  upscaling), mime sniffing, the size/type refusals, and a deterministic `sha256` over a fixture.
- Harness `s1-media`:
  - `s1-media-drop`: dropping a PNG on `#lolchat` creates a thumbnail part; sending it puts exactly
    one `image_url` part on the wire (`/mock/last-body`), and the OWUI-era drop guard still lets the
    drop through.
  - `s1-media-dupe`: the same file twice ⇒ one attachment row.
  - `s1-media-moodboard`: three images on a map, `describe` issues **three** POSTs, strictly serial,
    cancellable, each with exactly one image; tags land on the nodes; grouping is stable.
  - `s1-media-novision`: `state.modelGroupInfo` with `supports_vision:false` ⇒ the describe op shows
    the one-sentence "needs a vision model" state and issues zero POSTs.

**Landing.** Gates; light/dark screenshots of the map in `work` and `split`; DEVLOG; freeze **S-D**.

---

### S2: The vibecode bench

**Goal.** The owner's headline ask, complete: the model writes, the sketch runs in a proven box, the
errors come back on a click, the project is a folder you can open in VS Code, and a bad sketch cannot
freeze the client.

Vision ids: V1, V2 (renderer half), V3, V4, V5, V6, V7.

**Kickoff (integrator):** `PHASE='S2'`; the three S2 loader rows; `chat.css` stubs for
`css/{sandbox,preview}.css`; the six S2 mock models; `helpers.js` gains `h.sandbox`; the
`LIB_MANIFEST` rows for the three pinned libraries (§3.7.5) with their sha256; freeze **S-E**.

#### S2-U1: The sandbox

**Files owned**
- `shell/renderer/chat/sandbox/runner.html`
- `shell/renderer/chat/sandbox/{host,protocol,libs}.mjs` (`protocol.mjs` pure)
- `shell/renderer/chat/sandbox/lib/**` (the three vendored builds + licence files)
- `shell/renderer/chat/css/sandbox.css`
- `shell/renderer/chat/strings/sandbox.en.mjs`
- `shell/test/chat/unit/sandbox-protocol.test.mjs`
- `shell/test/chat-harness/scenarios/{s2-sandbox,perf-sandbox}.mjs`

**Spec.** §3.7 exactly — surface, CSP, protocol, reset semantics, capture, watchdog, libraries,
lifecycle. `host.mjs` exports `createSandbox({doc, onEvent})` → `{mount(el), boot(), run(job),
params(v), snapshot(o), stop(), state(), destroy()}` and is the **only** file in the tree that makes
an iframe or calls `postMessage` (lint rule 12).

**Acceptance**
- `chat-unit sandbox-protocol`: envelope encode/decode; every malformed envelope rejected (bad `v`,
  bad `tok`, unknown kind, oversize field, array too long); the caps truncate rather than drop;
  the pure reducer that turns guest events into panel state (`idle|booting|running|stalled|disabled`)
  covers the two-missed-pong and run-timeout paths.
- Harness `s2-sandbox`:
  - `s2-sandbox-run`: `h.sandbox.run('return 40+2')` ⇒ `{ok:true}`; a throwing snippet ⇒ `ok:false`
    with the message; a `setTimeout` error arrives as an `error` envelope.
  - `s2-sandbox-libs`: after `boot`, `h.sandbox.probe('typeof THREE')` is `'object'` and
    `typeof createCanvas` is `'function'` (p5); the manifest's sha256 for each shipped file matches
    (read in Node by the scenario's setup).
  - `s2-sandbox-isolation` (**the containment gate**): inside the guest, `fetch('http://127.0.0.1:<mock>/v1/models')`
    rejects, `fetch('file:///C:/Windows/win.ini')` rejects, `localStorage` throws, `parent.document`
    throws, `top.location.href` throws, `window.lol` is undefined, and an `<img src="file:…">` fails
    to load. Every one asserted from **inside** the guest through `probe`.
  - `s2-sandbox-navigate`: a guest attempt to set `location.href` to another `file:` path and to an
    `https:` URL is vetoed; the main process records the veto; the guest still answers `ping` (U4).
  - `s2-sandbox-hang` (**a release gate**, vision §9): with `mock-sketch-loop` running, the host
    renderer answers a CDP round-trip in ≤ 100 ms, the watchdog reports `stalled` within 3 s, the
    frame is rebuilt, and the visible row says so.
  - `s2-sandbox-lifecycle`: hiding the panel removes the iframe within the grace window; `destroy`
    removes it immediately; no iframe survives a thread switch; three rebuilds in 60 s ⇒ `disabled`.
- Perf `perf-sandbox`: boot + `libs` (all three) + first `run` ≤ 1,200 ms median on this box; a
  rebuild after a hang ≤ 300 ms; the host's own frame budget during a guest animation p95 ≤ 16 ms.

#### S2-U2: Preview panel and the project on disk

**Files owned**
- `shell/renderer/chat/preview/{panel,project,templates,brief}.mjs` (`brief.mjs` pure)
- `shell/renderer/chat/css/preview.css`
- `shell/renderer/chat/strings/preview.en.mjs`
- `shell/test/chat/unit/preview-brief.test.mjs`
- `shell/test/chat-harness/scenarios/s2-preview.mjs`

**Spec.**
- `WORKBENCH_PANELS` entry `{id:'preview', order:100, defaultWidth:'split'}`; publishes
  `app.preview = {project(), files(), open(id), run(), revisions(), debug}`; hosts
  `PREVIEW_TEMPLATES`.
- **Project creation is explicit and per-thread**: "Start a project" asks for a name, a kind
  (`canvas`/`dom`/`three`/`p5`/`svg`) and the two opt-ins (auto-apply, auto-fix — **both off by
  default**, O6, chosen here and stored in `project.settings`, never globally). It writes the template
  files through `app.projects`, mirrors a `ProjectMeta` into the repo and onto `thread.studio`.
- File list + editor-free viewer (the model writes; the human reads and clicks — a full editor is not
  in this release); **Reveal in Explorer** and **Copy path** (O2) are the two disk affordances.
- **Run** loads the current files into the sandbox: `run` with the entry file's text, the kind's
  template HTML/CSS, and the kind's libraries (project `lib/` overrides first, §3.7.5).
- **`BRIEF.md` (V7)**: the project's brief lives on disk; the panel reads it when the panel opens and
  on `EV.FARM_TICK` while visible (no watcher, no new timer); **disk wins** — an on-disk change
  replaces the in-memory copy, and the brief rides into every preview ask as a request block.
- Degradation: `app.projects.kind() === 'memory'` ⇒ everything still runs, one sentence explains that
  nothing is saved, and Reveal/Copy path are hidden (not disabled-with-a-tooltip).

**Acceptance**
- `chat-unit preview-brief`: brief parsing/normalisation, the token cap, and the disk-wins merge rule
  (same mtime ⇒ keep memory; newer mtime ⇒ take disk, even mid-edit).
- Harness `s2-preview` (`needsProjects:'real'` for the disk half, a `'memory'` twin for the rest):
  - `s2-preview-create`: creating a project writes the template files to disk (`h.files`), mirrors the
    meta, and stores `thread.studio.projectId`; reopening the thread restores it.
  - `s2-preview-run`: `mock-sketch` ⇒ a fence appears, Run draws (a `snapshot` returns a non-blank
    PNG), the sandbox reports `ok`.
  - `s2-preview-p5`: `mock-sketch-p5` runs with the vendored p5 and draws.
  - `s2-preview-brief`: writing `BRIEF.md` on disk changes the next request body (`/mock/last-body`
    contains the brief text) within one tick.
  - `s2-preview-memory`: without the real backend, the panel still runs a sketch and shows the
    one-sentence warning; Reveal is absent.

#### S2-U3: The edit engine, knobs, and code actions

**Files owned**
- `shell/renderer/chat/preview/{edit,knobs,apply,code-actions}.mjs` (`edit.mjs`, `knobs.mjs` pure)
- `shell/renderer/chat/strings/edit.en.mjs`
- `shell/test/chat/unit/{preview-edit,preview-knobs}.test.mjs`
- `shell/test/chat-harness/scenarios/s2-edit.mjs`
- `shell/test/bench/anchor-hit-rate.mjs` (the O3 measurement; **manual, live farm, never run by CI**)

**Spec.**
- §3.9 exactly: `choosePolicy`, `parseEdits`, `applyEdits`, the visible refusal, `kv editPolicy:` and
  `kv anchorStats:`.
- `code-actions.mjs` registers `CODE_DECORATORS` (order 300, after `code-chrome`/`code-svg`): a
  **Run in preview** and an **Apply to project** button on any `js`/`html`/`css`/`svg` fence whose
  fence has closed (the streaming tail is never decorated, F11), plus a `MESSAGE_ACTIONS` "Send to
  preview" for a whole reply. Applying is always one explicit click (O6), shows a diff summary
  (added/removed line counts, never a silent overwrite), and writes through `app.projects.write` with
  `ifMtime`.
- `knobs.mjs` (V5): parses a `// @knob name = 0..10 step 0.5` comment convention out of the sketch,
  renders sliders/colour inputs, and pushes values through the sandbox `params` message without a
  re-run. Values persist per project file.
- **The bench** (`anchor-hit-rate.mjs`): a stand-alone Node script that takes a farm base URL and a
  key, sends 20 anchored-edit requests and 20 whole-file requests against three fixture sketches
  (120, 300, 800 lines), applies each reply with the real `applyEdits`, and prints a table:
  attempted / applied exactly / refused / wrong-but-applied (manually judged). It **refuses to run
  without an explicit `--yes-live-farm` flag** and prints the seat warning first.

**Acceptance**
- `chat-unit preview-edit`: `parseEdits` over a corpus (one block, two blocks, CRLF, fence inside the
  replace body, missing separator, no blocks, a full-file reply); `applyEdits` exact/ambiguous/
  not-found; `choosePolicy` at 199/200/201 lines and with each kv override; `anchorStats` maths.
- `chat-unit preview-knobs`: the `@knob` grammar, clamping, defaults, round-trip through params.
- Harness `s2-edit`: `mock-rewrite` ⇒ whole-file apply writes the file (`h.files` byte check);
  `mock-edit` ⇒ one hunk applied, one refused with the sentence and the Rewrite button, and **nothing
  written until the click**; a knob drag re-renders without a new `run`; `p1-*` code-fence rendering
  is unchanged (the decorator is additive).

#### S2-U4: The repair loop and Vary

**Files owned**
- `shell/renderer/chat/preview/{loops,vary,settings}.mjs`
- `shell/renderer/chat/strings/loops.en.mjs`
- `shell/test/chat/unit/preview-loops.test.mjs`
- `shell/test/chat-harness/scenarios/s2-loops.mjs`

**Spec.**
- **Repair (V3), off by default** (O6). With the project's `autoFix` opt-in on, a runtime error offers
  one click: "Ask the model to fix it". With it off, the same button appears and does the same thing —
  **the opt-in only controls whether the first attempt fires automatically after a failed Run**, and
  even then: maximum 3 attempts, stop on an identical error signature (message + first frame), stop on
  any user edit, one visible Stop, and every attempt is a queue item with the seat ledger showing.
  Nothing runs while hidden.
- **Vary (V6)**: N = 4 (capped by `pref:queueMax`), strictly serial through `app.ask`, each variant a
  thumbnail (a `snapshot` from the sandbox after its run), pick one to keep — the others are dropped,
  not stored. Visible queue, one Stop.
- `settings.mjs` renders the per-project settings (the two opt-ins, the edit policy, the entry file)
  inside the panel — **never** a global `SETTINGS_SECTIONS` toggle for auto-apply/auto-fix (O6).

**Acceptance**
- `chat-unit preview-loops`: the repair state machine (attempt cap, identical-signature stop, user-edit
  stop, error-signature hashing); Vary's serialisation and drop policy.
- Harness `s2-loops`: with `mock-sketch-broken`, one click produces exactly one retry, the fixed fence
  runs, and the loop stops; with the error made permanent (`state` forcing the broken fence), the loop
  stops at 3 attempts with a visible message and **no further POSTs**; auto-fix off ⇒ zero POSTs
  without a click; Vary issues exactly 4 serial POSTs with a visible, cancellable queue; hiding the
  panel mid-loop stops it.

**Landing.** Gates, including `s2-sandbox-hang` (a red there stops the release, vision §9);
screenshots; DEVLOG recording the measured library sizes (U5) and the LGPL note for the packaging
page; a DISCUSS entry for the `vscode://` allowlist (O2) as a separate one-line change; freeze
**S-F**.

---

### S3: Design and board

**Goal.** The two remaining benches: a design panel that produces the exact artefact two apps in this
office already consume (a ComfyQ token block) and checks its own work in JavaScript, plus a board
panel that hands a small model local truth and then verifies what it wrote.

Vision ids: D1, D2, D3, D4, D5, D7, D8 (the last two ungated by O4); B1, B2, B3, B4, B5.

**Kickoff (integrator):** `PHASE='S3'`; the four S3 loader rows; `chat.css` stubs for
`css/{design,board}.css`; the five S3 mock models; freeze **S-G**.

#### S3-U1: Token forge, component sheet, contrast

**Files owned**
- `shell/renderer/chat/design/{panel,tokens,color,sheet}.mjs` (`tokens.mjs`, `color.mjs` pure)
- `shell/renderer/chat/css/design.css`
- `shell/renderer/chat/strings/design.en.mjs`
- `shell/test/chat/unit/{design-color,design-tokens}.test.mjs`
- `shell/test/chat-harness/scenarios/s3-design.mjs`

**Spec.**
- `WORKBENCH_PANELS` entry `{id:'design', order:300, defaultWidth:'work'}`; host of
  `DESIGN_SECTIONS`; publishes `app.design = {tokens(), setTokens(t), sheet(), debug}`.
- **Token forge (D1)**: `app.ask.json` with a schema covering the full ComfyQ token set (both themes),
  seeded by the current tokens plus a brief ("warmer, more contrast, a print feel") and an optional
  "fonts we have" free-text field (D10 is dropped — `queryLocalFonts()` needs a secure context and the
  renderer is `file:`; the manual field is its replacement).
- **Component sheet (D2)**: rendered **inside the S2 sandbox** (one box, two uses — the design panel
  asks `sandbox/host.mjs` for an instance the same way the preview does), a fixed sheet of buttons,
  inputs, cards, chips, a table and a status row, repainted on every token change, both themes side by
  side. The sheet's source is **ours** (a template in `sheet.mjs`), never model HTML.
- **Contrast (D3)**: every foreground/background pair in the set is scored by `color.mjs`; failures
  are listed with the measured ratio and the required one; a button asks the model to *explain and
  propose a fix* for the failing pairs only — and the proposal is re-scored before it can be applied.
- **Export**: writes `tokens.css` into the thread's project when there is one (§3.8), always offers
  "Copy CSS", and uses `ui/transfer.mjs`'s existing `download()` for a file (F14 — read-only import).

**Acceptance**
- `chat-unit design-color`: contrast against the WCAG reference table; hex/rgb/hsl parsing; `color-mix`
  free (we compute in JS); AA/AAA verdicts at the 4.5/3.0/7.0 boundaries exactly.
- `chat-unit design-tokens`: parse ⇄ render round-trip; a set missing a token is completed from the
  ComfyQ defaults; an unknown token from the model is dropped and counted.
- Harness `s3-design`: `mock-tokens` ⇒ tokens land, the sheet repaints in both themes, the deliberate
  3.9:1 pair is listed as a failure with its ratio, an applied fix is re-scored, and exporting writes
  `tokens.css` to the project (`h.files`).

#### S3-U2: Palette from a photo, SVG studio

**Files owned**
- `shell/renderer/chat/design/{media,quantize,svg-sanitize,svg}.mjs` (`quantize.mjs`,
  `svg-sanitize.mjs` pure)
- `shell/renderer/chat/strings/designmedia.en.mjs`
- `shell/test/chat/unit/{design-quantize,design-svg}.test.mjs`
- `shell/test/chat-harness/scenarios/s3-designmedia.mjs`

**Spec.**
- **Palette from a photo (D4)**: drop an image (reusing `app.media`, never a second intake) →
  deterministic median-cut quantiser → 6 swatches with proportions → the model is asked only to *name*
  them and suggest roles; the numbers are ours. Feeds D1 with one click. **Works with no vision model**
  (naming degrades to hex labels).
- **SVG (D5)**: promotes the existing `code-svg` decorator (~70 % shipped) with a sanitiser and an
  export. `svg-sanitize.mjs` allow-lists elements (`svg g path rect circle ellipse line polyline
  polygon text tspan defs linearGradient radialGradient stop clipPath mask use title desc`) and
  attributes (geometry, `fill`, `stroke*`, `opacity`, `transform`, `viewBox`, `d`, `style` filtered to
  a property allow-list), strips every `on*`, every `href`/`xlink:href` that is not a same-document
  `#id`, `<script>`, `<foreignObject>`, `<image>`, entities and DOCTYPEs, and caps the source at
  `SVG_MAX` (200 KB, the existing `render/dom.mjs` constant). Rendering still goes through
  `H.svgImg()` — the one sanctioned `<img>` path — so nothing new can inject markup.
- Export writes `<name>.svg` into the project and offers Copy. **D6 (click-to-select editing) is
  deliberately not built** (vision §12.6).

**Acceptance**
- `chat-unit design-quantize`: fixed fixture ⇒ fixed hexes, twice, and across a re-scale; proportions
  sum to 1; a 1-colour image returns 1 swatch, not 6.
- `chat-unit design-svg`: the `mock-svg` corpus plus the P0 XSS corpus — every script, handler,
  external reference and entity is removed while the geometry survives; an oversize SVG is refused;
  the output re-parses.
- Harness `s3-designmedia`: dropping a photo produces swatches without a farm call; naming uses one
  ask; `mock-svg` renders the safe fence, refuses the hostile one with a visible reason, and export
  writes the file.

#### S3-U3: Vision critique and A/B compare

**Files owned**
- `shell/renderer/chat/design/{critique,compare,areas}.mjs` (`areas.mjs` pure)
- `shell/renderer/chat/strings/critique.en.mjs`
- `shell/test/chat/unit/design-critique.test.mjs`
- `shell/test/chat-harness/scenarios/s3-critique.mjs`

**Spec.**
- **Critique (D7)**: an image (dropped, pasted, or a `snapshot` from the preview sandbox) →
  `app.ask.json` with a findings schema whose `area` is constrained to the **3×3 vocabulary**
  (`top-left … bottom-right`, plus `whole`). Findings outside the vocabulary or with an unknown
  severity are **dropped and counted**. The panel draws a 3×3 overlay and highlights the named cell —
  **never a pixel coordinate from the model** (vision §3.4).
- **Compare (D8)**: two images, asked **both ways round** (A,B then B,A) as two serial queue items;
  only findings that **agree in both orders** are reported as findings; the rest are shown separately
  as "order-dependent, treat with suspicion". That is the whole order-bias trick, and it is why compare
  costs two asks.
- Both gate on `app.ask.vision()`; `'no'` ⇒ the one-sentence operator message (O4), with palette and
  tokens unaffected.

**Acceptance**
- `chat-unit design-critique`: the area vocabulary mapping and overlay geometry; the agreement filter
  (a fixture of two finding lists ⇒ agreed/disagreed split); invalid findings dropped with a count.
- Harness `s3-critique`: `mock-critique` ⇒ findings render with the overlay, the invalid two are
  dropped with the sentence; `mock-compare` ⇒ exactly **two** serial POSTs with swapped image order,
  only the agreeing findings in the main list; `supports_vision:false` ⇒ the sentence and zero POSTs.

#### S3-U4: The board bench

**Files owned**
- `shell/renderer/chat/board/{panel,select,lint,scaffold}.mjs` (`select`, `lint`, `scaffold` pure)
- `shell/renderer/chat/board/pack/{index,esp32-devkitc-v4,esp32-s3-devkitc-1,arduino-uno-r3}.mjs`
- `shell/renderer/chat/css/board.css`
- `shell/renderer/chat/strings/board.en.mjs`
- `shell/test/chat/unit/{board-select,board-lint,board-scaffold,board-pack}.test.mjs`
- `shell/test/chat-harness/scenarios/s3-board.mjs`

**Spec.**
- `WORKBENCH_PANELS` entry `{id:'board', order:400, defaultWidth:'split'}`; host of `BOARD_PACKS`;
  publishes `app.board = {board(), setBoard(id), lint(text), scaffold(target)}`.
- **B1 pack**: three boards, §3.11's rules (every fact sourced, unverified marked unverified).
- **B2 injection**: a `REQUEST_TRANSFORMS` item at **order 100** (the position the cancelled P4-U1
  recipe transform reserved, §6) that appends the ≤ 300-token board slice to `systemAppend` **only
  when a board is selected for this thread**, never otherwise, and never the whole table.
- **B3 linter**: `lint.mjs` parses pin expressions out of the sketch (`pinMode`, `digitalWrite`,
  `analogRead`, `attachInterrupt`, `ledcAttachPin`, `Serial1.begin(..,..,rx,tx)`, `#define X n` +
  usage) and applies the pack's rules: flash pins, strapping pins, input-only pins, ADC2-with-WiFi,
  5 V tolerance, PWM/DAC availability. Findings are rendered **under the code fence** via a
  `CODE_DECORATORS` item, each with its source line, and a finding whose expression could not be
  parsed is **not emitted** (silence where unsure, §3.11.2).
- **B4 scaffold**: writes an Arduino folder (`<name>/<name>.ino`, matching folder and sketch names) or
  a PlatformIO project (`platformio.ini` with the pack's `board`/`framework`/`platform`, `src/main.cpp`)
  into the thread's project through `app.projects`, then offers Reveal/Copy path. **We stop where the
  toolchain starts**: no serial, no flashing, no build (vision §3.5).
- **B5 pin map**: a static table/diagram rendered from the pack, with the unverified rows marked.

**Acceptance**
- `chat-unit board-pack`: every pack validates against the `BoardPack` shape; every pin has `caps`;
  every note and every warned pin has a non-empty `source`; ids are unique; the three packs together
  are under 80 KB of source.
- `chat-unit board-select`: the slice for a sketch mentioning 4 pins is ≤ 300 tokens (measured with
  `ctx/tokens.mjs`) and contains exactly those pins plus the identity line; an empty sketch yields the
  identity line only.
- `chat-unit board-lint`: per board, a table of sketches ⇒ expected findings, including **no finding**
  for computed pin numbers it cannot resolve, for a commented-out line, and for a string containing
  `pinMode`.
- `chat-unit board-scaffold`: the generated `.ino`/`platformio.ini` text for each board (golden files),
  including the folder/sketch name rule and a name that needs slugging.
- Harness `s3-board`: selecting a board injects the slice (`/mock/last-body` shows it, and shows it is
  absent with no board); `mock-board` ⇒ the two findings (GPIO 6 flash, GPIO 34 output) appear under
  the fence with their lines; scaffolding writes the folder (`h.files`) and Reveal is offered.

**Landing.** Gates; screenshots of all four panels, light and dark; a DEVLOG entry; the release
checklist of §8.

---

## 5. Rig checklist additions (human tests, real machines, real farm)

These are **additions**, kept here because `LOLCHAT_RIG_CHECKLIST.md` is owned by the team that landed
P2. Ids are `S-R#` so they never collide. Every item names the machine it must run on; "**(C-21)**"
marks the ones that must be ticked before release, in the inherited convention.

| # | Phase | Test | Pass condition |
|---|---|---|---|
| **S-R1** | S0 | **Security review of the projects change set** (a second pair of eyes, not the author): read `projectsPath.ts` and `projects.ts` line by line against §3.8; confirm no `child_process`, no `openExternal`, no renderer-supplied absolute path, no directory deletion, no path from a message body without a click; confirm the two marked regions in `index.ts` are the only main-process change. **(C-21)** | signed off in DEVLOG, by name |
| **S-R2** | S0 | **Store v2 upgrade on a real profile**: take a copy of a real user profile at DB v1, launch the new client, confirm history intact and the new stores present; then launch **v0.1.45** against the upgraded profile and confirm it degrades to the "history can't be saved" banner rather than losing data. **(C-21)** | both observed, screenshots in DEVLOG |
| **S-R3** | S0 | **Data folder move**: change the data folder in Preferences while a project exists; the projects root follows; the old folder is left intact; the panel reports the new path. | observed on Windows |
| **S-R4** | S0 | **U2 — `reveal` / `open`**: click Reveal in Explorer and Copy path on a real project; confirm Explorer opens the folder (not an editor) and the clipboard holds the absolute path. | observed; result recorded (U2) |
| **S-R5** | S0 | **Windows path hostility, by hand**: create projects named `CON`, `aux.test`, `a.` and a 60-character name; put a file at `lib/sub/deep/one/two.js`; confirm the refusals are legible and nothing lands outside the root. | no escape, messages legible |
| **S-R6** | S1 | **U3 — map on office hardware**: open a 1,200-node map on a mid-range office laptop (not this box); pan, zoom, edit a node. | interaction stays usable; numbers recorded |
| **S-R7** | S2 | **O3 — anchor hit rate against the live farm**: run `node shell/test/bench/anchor-hit-rate.mjs --yes-live-farm` **out of office hours** (it takes seats), 20 anchored + 20 whole-file edits over three sketch sizes. **(C-21)** | table recorded in DEVLOG; `kv editPolicy` default revisited in writing |
| **S-R8** | S2 | **The hang, for real**: ask the live model for a sketch with an infinite loop, run it, and keep typing in the chat. | the client stays responsive; the preview reports the restart |
| **S-R9** | S2 | **VS Code round trip**: open the project folder in VS Code, edit `sketch.js` and `BRIEF.md` on disk, return to LOL. | disk wins on the brief; the file list shows the edit; an apply over a changed file refuses with `E_CONFLICT`, not a silent overwrite |
| **S-R10** | S2 | **Vendored libraries on a fresh install**: install the packaged client on a clean machine with **no internet**, run a three.js and a p5 sketch. | both run; nothing is fetched (verified with the network cable out) |
| **S-R11** | S2 | **Seat etiquette with two people**: a colleague chats on the same farm while a Vary batch of 4 and a repair loop run here. | their replies never stall behind our batch; the ledger shows the truth; Stop works |
| **S-R12** | S3 | **Vision on the live `gemma4:12b`**: critique a real render, compare two versions, describe a 6-image moodboard. **(C-21)** | findings are about the image; the 3×3 overlay matches what is said; compare reports only agreeing findings |
| **S-R13** | S3 | **Vision off**: point the farm at a text-only llama.cpp alias (or set the catalogue so `supports_vision` is false) and open every vision surface. | one clear sentence each, no spinner, no dead button; palette and tokens still work |
| **S-R14** | S3 | **Board truth**: check every pin and note in the three packs against the vendor datasheet, with a second person. **(C-21)** | every unverified fact marked unverified in the UI; no wrong strapping-pin note |
| **S-R15** | S3 | **Arduino/PlatformIO round trip**: scaffold both targets, open them in the Arduino IDE and in PlatformIO, and build (not flash). | both compile for the selected board |
| **S-R16** | all | **Offline**: run the whole product with the machine off the internet (LAN farm only). | nothing is fetched; no console error about a blocked request |
| **S-R17** | all | **Close means close**: with a map, a sketch and a batch running, hit the window's X. | everything stops; no orphan process; the farm shows the seat freed |
| **S-R18** | all | **Keyboard-only pass** over all four panels with a screen reader on Windows (Narrator). | every panel reachable, every op announced, Escape always means stop-then-close |

---

## 6. What we cancelled, and why

The old P3/P4 units, one row each. "Cherry-picked" means the spec was adopted where it is named.

| Old unit | Was | Verdict | Where it went |
|---|---|---|---|
| **P3-U1** images, vision, intake router | drop/paste → downscale → attachment → image block, vision cap probe | **cherry-picked whole** | S1-U4 (`media/`), §3.10; the cap probe became `app/caps.mjs` (S0-U2) |
| **P3-U2** documents, farm OCR, page picker | upload a PDF, extract via the farm, inject pages | **dropped** | Open WebUI is one toggle away and does it properly; the farm OCR stays for OWUI. No client code. |
| **P3-U3** web search, Sources card, citations | SearXNG queries, citation rendering | **dropped** | same reason; the `CITATIONS` slot stays inert |
| **P3-U4** Blender bridge, Run-in-Blender card | mcpo tool server, scene attachments, taint | **dropped** (owner deferred) | the shell's opt-in Blender toggle is untouched; nothing in LOL Chat |
| **P4-U1** recipes engine and composer integration | recipe files, `/trigger`, a recipe transform at order 100 | **the slot only** | the transform position is reused by the board-pack injection (S3-U4 B2); no recipe UI, no recipe store surface |
| **P4-U2** structured output (response format, cards, table) | `response_format`, `kv structuredMode`, `extractJson`, a card deck renderer | **cherry-picked** as R3 | S0-U2 (`app/ask.mjs`, `app/json.mjs`); the **card deck and table renderers are dropped** — panels render their own results |
| **P4-U3** syntax highlight, rewrite-from-selection, params drawer | stretch | **dropped** | highlighting is a library we will not add; the params drawer never had a transform anyway |
| **P4-U4** command palette, Kokoro read-aloud | stretch | **dropped** | `PALETTE` stays inert; TTS belongs to OWUI |
| **P2-U4** export/import discipline | `.lolchat.json`, copies on import | **extended, not rebuilt** | §3.6.3 adds `maps`, the `map` part and the `studio` field to the existing format |

**Net effect on the release core:** four surfaces the owner asked for, instead of four surfaces Open
WebUI already has.

---

## 7. Owner decisions — settled (2026-09-16)

The vision document's §7 asked six questions. All six are answered; these answers are binding and are
implemented where the table says. (The vision document is not edited; this section is the record.)

| # | Question | Decision | Implemented in |
|---|---|---|---|
| **O1** | Vendor three.js and/or p5.js? | **Vendor three.js AND p5.js, plus any other small library that genuinely helps.** The plan ships **three**: three.js (MIT), p5.js (LGPL-2.1), matter.js (MIT); `lil-gui`, `tone.js`, `d3` and `gsap` considered and rejected, cap of five kept. Each byte-identical, licence shipped, sha256 in `LIB_MANIFEST` (lint rule 14), overridable by the project's `lib/`. **Budget ≤ 2.0 MB**, measured at the S2 landing (U5). The LGPL-2.1 obligation is recorded for the packaging/licence page as a DISCUSS item. | §3.7.5, S2-U1, §2.4 rule 14 |
| **O2** | "Open in VS Code"? | **Reveal in Explorer + Copy path ship now.** The `vscode://` allowlist is **not** in this release; it is recorded as a separate one-line change (`shell.openExternal`'s `^https?://` gate) for its own review. | §3.8.5, S2-U2, S2 landing DISCUSS entry |
| **O3** | Measure the edit engine before writing it? | **The default does not wait for the measurement**: whole-file rewrite under ~200 lines, anchored above, behind `kv editPolicy:<underlying>` with rolling `anchorStats`. The measurement is a rig item that can revise the default in writing. | §3.9, S2-U3, rig **S-R7** |
| **O4** | Vision on the farm? | **The farm serves vision-capable `gemma4:12b`: build the vision features for real.** A cheap, seat-free capability check (a GET) plus a one-sentence "needs a vision model" state stays, for the day an operator switches to a text-only alias. | §3.4.3, §3.10, S1-U4, S3-U3, rig **S-R12/S-R13** |
| **O5** | Separate change set, or widen `chat-scope.js`? | **Build the projects API now and widen the gate by exactly the named files** — four `shell/src/**` paths, two of them region-checked, plus the vendored-library manifest row. Everything else outside the LOL Chat scope still fails the gate. The change set still lands as its own reviewed commit. | §1.1, §2.5, S0-U4, rig **S-R1** |
| **O6** | Auto-apply / auto-fix defaults? | **Both ship OFF, opt-in per project, chosen at creation.** There is deliberately **no** global switch and no `SETTINGS_SECTIONS` toggle for them. The model proposes; a human clicks; a thrown error is offered back on a click. | §1.2.9, §3.9, S2-U2, S2-U4 |

Two further judgements this plan makes, in the same spirit, so no builder has to guess:

- **D10 (type pairing from installed fonts) stays dropped**: `queryLocalFonts()` needs a secure
  context and the renderer is a `file:` origin. The manual "fonts we have" field in D1 replaces it.
- **The conversation map never becomes the only way to reach a sibling** — the `◀ 2/3 ▶` stepper and
  every P2 branching action stay primary and are re-tested at every landing (§8).

---

## 8. Definition of release

**Automated, on `lolchat/vnext`, all green:**

```bash
npm --prefix shell run build                                  # projects API compiled, 0 skipped scenarios
node shell/test/chat-unit.js && node shell/test/unit.js && node shell/test/chat-lint.js && \
node shell/test/chat-scope.js && node shell/test/chat-harness/run.js --strict && \
node shell/test/chat-harness/run.js --strict --phase perf
```

- **Baseline that must not regress** (§2.6 **BC**): `chat-unit` ≥ 472 passing with 0 failures,
  `unit.js` 5, `chat-lint` 0 violations (now over the `.html` files too, with its self-tests green),
  `chat-scope` clean, harness `--strict` ≥ 101 passing with 0 failures and **0 skipped**, perf 6 +
  the new rows.
- **No perf row regresses by more than 15 %** against the recorded medians (1270–1788 render tok/s).
  A landing that slows the chat to make a panel nicer is rejected.
- **`s2-sandbox-hang` and `s2-sandbox-isolation` are release gates.** Red there ⇒ the Preview panel
  does not ship, whatever else is green.

**Parity, explicitly re-tested at every landing** (the P0–P2 product must be untouched with the
workbench both closed and open): branching (`◀ 2/3 ▶`, edit-user, regenerate, fork, delete-subtree);
seat-wait rows and their resend/schedule/wait/giveup decisions; the budget meter, its cost gate and
`.chat-outside` dimming; store-mode degradation (`idb → memory → memory-final`) and late-attach
journal replay; export/import round-trip; interrupted-stream recovery; the sidebar's search, menus
and ephemeral threads; the model picker's farm-honest selection.

**Data safety:** no new door into the store accepts `'streaming'`/`'waiting'` from outside; every
captured message is re-read before it is written; bulk operations still filter `ephemeral`; the
projects API has its own pure Node suite covering every Windows device name, `CON.txt`, ADS, symlinked
components and the quota ladder; **deleting a chat never deletes a file on disk**.

**Human:** rig items **S-R1 … S-R18**, with every **(C-21)** ticked by the owner.

**Documentation:** one DEVLOG entry per landing; the DISCUSS entries for the `vscode://` allowlist
(O2) and the p5 LGPL notice (O1) filed; `LOLCHAT_STUDIO_VISION.md` §7 answered here in §7 rather than
edited.

---

## 9. How this fails, and the three cheapest guards

The vision document's §10 lists three failure modes. Each gets one mechanical guard in this plan, so
the failure is visible early rather than at the end:

1. **Four half-panels.** Guard: a phase does not land until its panel passes its own scenarios *and*
   the parity list of §8 — and the phase order is a stop-point order (§0.1). A release stopped after
   S2 is a success.
2. **Curation debt pretending to be a feature.** Guard: `board-pack.test.mjs` fails a pack whose fact
   has no `source`, and the UI renders `verified:false` as the word "unverified". Three boards, two
   people, one datasheet check (**S-R14**).
3. **Antisocial defaults.** Guard: auto-apply and auto-fix off (O6), every batch serial through one
   governor with a visible ledger from S0 onward, nothing runs while hidden, and `s0-ask-queue` /
   `s2-loops` assert all three in CI rather than in a code review.
