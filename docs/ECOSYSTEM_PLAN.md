# LlmOnLan ecosystem plan

> **Status: v2 (2026-09-27, 19:00). v1 went through one critic loop (§9).** The plan was written from the
> owner's vision of 2026-09-27.
> **Built (local `main`, not released):** P1a, P1b, P1c (OWUI 0.11.4), P2 (Listen + Speak), P3a (the Send box
> and the outputs choke point; serial is P3a-2), each with its tests; the P1+P2 critic's findings are resolved
> ([reviews/P1P2_CRITIC_2026-09-27.md](reviews/P1P2_CRITIC_2026-09-27.md)). The running log: NIGHT_LOG_2026-09-27.md.
> The research facts are in [research/ECOSYSTEM_RESEARCH_2026-09-27.md](research/ECOSYSTEM_RESEARCH_2026-09-27.md). This document
> supersedes the forward-looking parts of LOLCHAT_STUDIO_VISION.md and COMPUTER_PLAN.md where they
> disagree. Their "as built" sections stay true.

---

## 0. The vision, in the owner's words (condensed)

- **Open WebUI** is the general chat: documents, workspaces and the rest. It stays **close to
  upstream**, so its updates can be taken without worry.
- **The Computer** is graph-based and agentic, geared to **building agentic workflows**.
  - A general surface, "a kind of n8n, but local".
  - **Advanced data analysis** through specialised models (Laya and others).
  - **Data visualisation**: p5, three.js and SVG, plus **d3** and the **graphify** skill.
  - **Connectors**: WebSocket, web fetch, free APIs (no paid APIs), **OSC** in and out, **DMX** out,
    **serial** to microcontrollers, **ESP32 over WebSocket**, **MQTT**, and **TTS/STT**. Google Home and
    Alexa come last.
  - "Connect the real world to AI": the local AI acts on the world and gains data from it.
- **LOL Chat** becomes a **specialised vibecoding harness** built on **DeepSeek Harness**.
  - Skills such as **ponytail** and **agent-skills**.
  - It builds web apps, three.js apps and autonomous agents, and **serves them locally**, under a LAN
    policy first.
  - GitHub diff, pull and push in the app: "a lightweight IDE made to fit in our ecosystem".
- **The purpose**: education and serious work, local first.

## 1. What we have today (on `main`, 2026-09-27)

| Area | Built and tested | Not built, or only half |
|---|---|---|
| **Farm** (`farm/`, Farm app) | <ul><li>three exclusive engines behind one OpenAI endpoint (Ollama default gemma4:12b, llama.cpp opt-in Qwen3.8-27B, external vLLM/SGLang)</li><li>measured auto context</li><li>seat gate (429 when full)</li><li>farm password</li><li>admin panel (engine switch, `.gguf` library, names, capacity, context, plugins)</li><li>plugins: SearXNG, OCR (`pysvc`, hybrid text/vision PDF), Kokoro TTS (off)</li><li>UDP beacon + `/lol/self`</li><li>fleet and bench</li><li>the Farm app (wizard, private by default, manual updates)</li></ul> | <ul><li>no decision model</li><li>no STT</li><li>plugins have no concurrency limit (the seat gate covers LLM completions only)</li><li>VRAM planning assumes one resident LLM, plus the OCR vision model on Ollama</li></ul> |
| **Client shell** | <ul><li>pinned, unmodified OWUI sidecar (env-authoritative)</li><li>discovery and automatic farm choice (pin, sticky, least busy)</li><li>Preferences</li><li>**all data in DATA_DIR** (today)</li><li>auto-update</li><li>five-leg CI</li><li>close means close</li></ul> | the owner still has to run the upgrade, installer and move checks on real machines (RIG_CHECKLIST) |
| **Open WebUI** | 0.10.2 pinned: RAG with local embeddings, farm web search and OCR, local Whisper STT, Kokoro TTS when the farm has it, the opt-in Blender tool server | upstream is at **0.11.4** (PyPI, 2026-09-27), one minor release ahead of our pin; the bump path (INTEGRATION_BRIEF) has not been exercised since 0.10.2 |
| **LOL Chat** | <ul><li>farm-direct chat with a message tree and branches</li><li>seat-aware sending (wait, try now)</li><li>context meter and budget</li><li>Continue, drafts, pins, system prompt, ephemeral chats</li><li>import and export</li><li>tok/s and TTFT per reply</li><li>IndexedDB store</li></ul> | <ul><li>**no agent tooling at all**: no files, no editor, no terminal, no git, no preview, no skills</li><li>the P3/P4 attachments, search and recipes were never built</li><li>the Studio workbench column is dead code (`studio.*`, `WORKBENCH_PANELS`)</li></ul> |
| **The Computer** | <ul><li>canvas: select/hand tools, zoom, undo, Tidy, export/import `.lolgraph.json`</li><li>21 box types + 9 presets: Text, Image, Document (OCR), Sound, File (→ `DATA_DIR/LOL Studio Projects`), Instruction (JSON-schema ladder, seeds, token caps), Split/Filter/Collect/Repeat, Preview (p5/three/SVG/HTML/Markdown), Code (JS in the sandbox), Button/Condition/Confirm/Dialog/Toggle/Timer, Sticky/Section/Title</li><li>runner: bounded runs (8 passes, 50 generations, 10 min, 2000 activations) and gated loops</li><li>ONE opaque-origin sandbox + one Live guest (mouse and keys, `lol.orbit`)</li><li>Edit code drawer</li><li>transcript (sent, got, cost)</li><li>Record log</li><li>Learn shelf: tour, lessons 1–4, 2 templates</li></ul> | <ul><li>**no fetch or any connector**</li><li>no data or table box</li><li>no d3</li><li>no specialised models</li><li>**no event-driven (reactive) runs**: every run starts from Run all, ▶, a Button press or a Timer inside a run</li><li>no agent (tool-calling) box</li><li>no speech</li><li>lessons 5–12 and the resume banner are not built</li></ul> |
| **Engineering** | <ul><li>chat harness (370 real-input scenarios over CDP, mock farm)</li><li>perf budgets</li><li>unit (1621), lint (15 rules, including vendored-libs-unmodified and one-iframe-maker), scope gates</li><li>critic loops</li><li>Record log for bug reports</li><li>farm unit tests (124)</li></ul> | <ul><li>no hardware-in-the-loop tests</li><li>no test that drives a real (non-mock) model in CI</li></ul> |

## 2. Critique: what we have, measured against where we want to go

### 2.1 What carries straight over (assets)
1. **The farm's plugin pattern** (a venv + a small HTTP service, advertised in the snapshot, discovered by
   clients, stateless) is exactly how new specialised models should arrive: Laya, STT and later others.
   OCR has proven it end to end.
2. **The Computer's runner, sandbox and box contract** are the right base for a local n8n: typed ports,
   bounded runs, gates, a Confirm box, a transcript of what was sent, seeds, and a debug log. The
   **Button** box already means "start the downstream from here with a value". An incoming event is an
   automatic Button press, so reactive runs need **no new runner**, only triggers (§4.2).
3. **The sandbox + Live + Edit code** is already a small p5/three/HTML IDE, and it is the natural
   preview for LOL Chat's vibecoding.
4. **"Everything in DATA_DIR" + project folders** (`LOL Studio Projects`, path-validated in main) is
   where vibecoded apps and data sets should live.
5. **The pinned, unmodified upstream** pattern (OWUI) is also how DeepSeek Harness should enter:
   pinned, run as a sidecar, never forked.

### 2.2 What does not fit the vision (misfits), and what we stop
1. **LOL Chat today is a second, thinner OWUI.** A farm-direct chat with branches is nice, but the vision
   makes LOL Chat an IDE. **Stop** investing in chat-only features; its chat core (tree, seat etiquette,
   budget) becomes the conversation pane of the IDE.
2. **The dead Studio workbench** (`WORKBENCH_PANELS`, `studio.*` strings, `ui/workbench.mjs`) is an old
   answer to the same question. **Delete it** once the IDE layout lands (ponytail: deletion over
   addition), or reuse its layout if the spike shows it fits.
3. **The Computer's run model is batch only.** "Connect AI to the real world" needs **long-lived, armed
   graphs**: listen on OSC/MQTT/serial, react, and act. Without them, connectors are toys.
4. **The Computer has no way in for data** other than a person dropping a file. A fetch is the first
   missing piece, and the owner's first goal needs it.
5. **The privacy boundary will move.** Speech means audio leaves the laptop for the farm (today "a Sound
   is never sent"), and Laya means data goes to a farm model. Both are transient, like OCR, but the
   docs and invariants must say so **before** we ship them.
6. **Google Home and Alexa are cloud APIs**, which conflicts with "local only, never cloud". The only
   compatible route is a **local Home Assistant** bridge (it speaks MQTT/WebSocket locally). Treat
   them as "Home Assistant via MQTT/WS", last.

### 2.3 Gaps that are risks, not just missing features
1. **The farm's VRAM is planned for one LLM.** Laya (~0.8 GB), STT (R2T2 ~5 GB with KV, or
   faster-whisper ~1–3 GB) and TTS (~0.3 GB) stay resident beside it. The admin panel's capacity maths
   and "pressure eviction" must count them, or the auto context probe will overshoot.
2. **Plugins are not seat-gated.** A class of 25 running Laya-heavy graphs could starve each other.
   Each plugin needs a concurrency limit and a clear 429, in the same spirit as the seat gate.
3. **Acting on the world is a safety problem.** A model-driven DMX or serial output can blind someone
   or burn a motor. Outputs need a **dry run by default**, explicit arming, rate limits and a **panic
   stop**, and the Confirm box must stay one wire away.
4. **Local models are weak agents.** Qwen3.8-27B at IQ2 and gemma4:12b drive tool loops far worse than
   frontier models. The IDE and the agent box must be designed for **short, checkable steps**
   (ponytail, plan mode, small diffs), and measured on our farm before we promise anything.
5. **Two upstreams pinned in one client** (OWUI and dsh) doubles the "bump, rebuild, smoke-test" duty.
   dsh is a developer preview with breaking changes expected.

## 3. Cross-cutting decisions (v2)

1. **Where things run.**
   - **Models run on the farm**: LLMs, Laya, STT, TTS and OCR. The GPU and CPU are shared, and weights are
     downloaded once.
   - **The client's main process handles I/O with the world**: fetch, UDP (OSC, Art-Net), outbound
     sockets, files, git and the local web server. All of it goes through **one I/O bridge** with **one
     safety choke point**.
   - **The renderer** holds the UI, sandboxed user code, WebSocket and MQTT-over-WS clients, Web Serial,
     and `speechSynthesis`.
   - **Nothing is ever stored on the farm.**
   - A client-side model is allowed only once it is mature and measured on the office laptops. kevala is
     revisited when it is 3+ months old.
2. **Laya runs on the farm as a `classify` plugin.**
   - It is **CPU-first, off by default, and pinned** to an exact package version and weights revision.
   - It **preloads at plugin start**, because the first call took 13.7 s.
   - Threads are capped. It answers one **batched** request per run.
   - v1 supports **`choice` questions only**, with confidence shown as **"uncalibrated"**.
   - It is our own small FastAPI wrapper around `laya.Router`, following the OCR pattern: a venv, a port,
     a bearer key, a per-IP cap of 1 plus a global cap, a 429 with `Retry-After`, and **no request bodies
     in the logs**. `laya-serve` itself has no auth.
   - The box is called **Classify** (Condition already "decides").
   - With no plugin, the template falls back to the thinking model and says so.
3. **Speech.**
   - **Listen** is a *mode of the Sound box*: audio → text, with no new audio value kind.
     - It uses the OpenAI transcription contract (`POST /v1/audio/transcriptions`) against a farm `stt`
       plugin: **faster-whisper** by default (MIT code and weights).
     - **R2T2** is only an operator-run `external`, and **its weight licence is read before any use**.
     - The microphone starts only when a person presses it, and the recording state is always visible.
     - A clip is capped, and armed triggers may never listen continuously in v1.
   - **Speak** uses the OS voices through `speechSynthesis` (a platform feature, works offline), and the
     farm's Kokoro when present.
4. **The privacy boundary, restated before each feature ships.**
   - **Transient to the farm, never stored, never logged:** chat context, OCR bytes, Classify states,
     STT audio, TTS text.
   - **To third parties the person names:** Fetch URLs, MQTT brokers and git remotes.
   - The in-app text, CLAUDE.md's data flow and a classroom consent note change **in the same commit** as
     each feature.
   - **Plugin auth:** today the OCR key is broadcast in clear in the beacon.
     - v1 keeps the same pattern for `classify`, documented as LAN-trust.
     - A follow-up task derives plugin keys from the farm password when one is set (§5, P1b).
5. **Outputs to the world are safe by default.**
   - A dry run until a person arms the graph.
   - Per-output limits, set by the person.
   - DMX flashing is capped at 3 Hz.
   - A global panic stop, which keeps sending a safe DMX frame.
   - Confirm stays one wire away from any model-decided action.
   - An imported or reloaded graph opens **disarmed**, and lists every host and output before its first run.
6. **Numbers never come from a model.**
   - The model outputs labels and enum chart specs, joined to the data by item id.
   - Code computes every number and every coordinate.
   - Items the model or Laya are unsure of are listed for a person.
7. **Skills belong to the IDE in v1** (`DATA_DIR/skills`, pinned, with their licence files). The
   Computer's Agent box waits for a measured tool-calling rate.
8. **Education.**
   - Every capability lands as one of the **unbuilt lessons 5–12**, or as a template on the one Learn
     shelf (not a parallel track).
   - It works on the mock farm with no GPU.
   - Each phase's exit names its lesson.
9. **Stay close to upstream OWUI:** the pin bump 0.10.2 → 0.11.4 moves **forward** into tonight's queue
   (P1c).

## 4. The amended target, per surface

### 4.1 Farm
- **Plugins**:
  - `classify` (Laya, CPU, off by default);
  - later `stt` (faster-whisper; R2T2 external);
  - Kokoro TTS (exists).
- Each plugin has a concurrency cap plus a 429 and logs no bodies. Boxes read the snapshot's `plugins`
  map **at run time**, because the client can switch farms between runs.
- **Before any plugin defaults to on**, measure `lol bench` tok/s with Classify or STT busy (CPU
  contention).
- VRAM accounting waits until a plugin is on the GPU.

### 4.2 The Computer (a local n8n, data and the real world)
- **Data (P1a, P1b)**
  - **Fetch** box:
    - main-process `net.fetch`, GET only;
    - capped at **1 MB** (a stored value can't exceed `MAX_VALUE_BYTES`) and 15 s;
    - http(s) only, and a person types the host;
    - it refuses loopback, link-local and the farm's own ports;
    - it **keeps the last response** in the box, so templates work offline and can be demonstrated;
    - a graph carries no keys or credentials.
  - JSON is parsed in the existing **Code** box.
  - **Classify** box (Laya): it takes the list whole, shows its call in the transcript (sent, got, ms),
    and stops on Stop.
- **Visualisation**:
  - Code draws SVG (bars and dots in ~40 lines, which is also the lesson).
  - **d3 needs an owner decision.** The sandbox library budget is 2.0 MB, with 1774 KB already used. Either
    raise it, or vendor only `d3-scale` + `d3-shape` (+ `d3-force` for graphify) and drop matter.js.
- **Speech (P2)**: Sound → Listen mode (STT); **Speak** box.
- **Connectors (P3)**:
  - **P3a outputs first**: one **Send** box with presets (OSC, Art-Net DMX, MQTT publish, WebSocket send,
    serial write, HTTP POST), through the single choke point.
  - **P3b triggers**: one **Trigger** box with presets (OSC in, MQTT subscribe, WebSocket (outbound
    client), serial read, schedule).
  - **Cut from v1**: webhook-in and the WebSocket *server* (inbound listeners). An ESP32 reaches us
    through MQTT, or we connect out to its WebSocket.
- **Armed runs (P3b)**: this **does need runner work**. `run()` refuses while busy, `ask` refuses while
  the Computer is hidden, and a Button carries no payload today. The policy:
  - a trigger keeps only its **latest** event while a run is busy;
  - an armed graph runs **only while the Computer is shown**;
  - each graph has an **hourly generation budget**;
  - **nothing stays armed after a quit**.
- **Agent box (P4)**: only if the spike measures **≥ 80%** correct tool calls on our farm.
- **graphify**: an **IDE skill** run by dsh (P5), because the client has no Python of its own besides
  OWUI's sidecar, which must stay untouched. The Computer gets a `graph.json` view later (d3-force).

### 4.3 LOL Chat → a Studio IDE on DeepSeek Harness (P5, after a spike)
- **A spike first** (P5-0), with exit criteria:
  1. dsh runs against the farm through `llm-pi-ai`'s OpenAI-compatible route;
  2. ponytail and agent-skills load from a folder;
  3. on Qwen3.8 or gemma4, a small task (a three.js page in a project folder) finishes with **≥ 80%**
     correct tool calls;
  4. the SDK can drive a session headless.

  If it fails, the fallback is named in advance: **our own minimal loop** (read, edit, preview tools; no
  shell), borrowing dsh's minimal-mode design.
- **v1 IDE**: dsh pinned (exact version plus a lockfile hash), **no shell tool** in the first cut, a
  workspace in `DATA_DIR/LOL Studio Projects/<project>`, and skills from `DATA_DIR/skills`. It has a file
  tree, the editor (`code-edit.mjs`), a diff view and the sandbox preview.
- **Local serving**: a static server per project on loopback, with LAN exposure as an explicit toggle.
- **Git**: any git remote over HTTPS (GitHub, or a LAN Gitea for fully local use), through **one** code
  path chosen in the spike. Credentials go in the OS keychain (`safeStorage`). v1 builds no GitHub-only
  features.
- **LOL Chat's chat** is **not** deleted before the IDE works. If the spike embeds dsh's web UI, the tree
  and seat etiquette are replaced, not reused, and this section will say so.

### 4.4 Open WebUI
- **P1c (tonight if time allows)**: bump 0.10.2 → 0.11.4.
  1. Read the changelog for env and config changes.
  2. Build the sidecar.
  3. Smoke-test it **standalone** on a free port with a temporary DATA_DIR. The owner's client on this box
     must not be touched.
  4. Re-verify the configBridge env surface.
- Then bump on each upstream minor release.

## 5. Phases, with risks

Each phase ends with gates green, a mock-farm harness scenario, a rig check, docs, and **its lesson on the
Learn shelf**.

| Phase | Scope | Exit | Main risks → mitigation |
|---|---|---|---|
| **P0 Plan** | v1 → critic → v2 (this) | v2 committed | — |
| **P1a Data, client only** (tonight) | Fetch box; the template "Read the news" with **Instruction labels** and a Code-drawn SVG; the reader's instructions in a Text box; the "check these" list | runs on the mock farm with a fixture HN copy (the harness), and on the owner's farm | <ul><li>SSRF → caps, a typed host, loopback/link-local/farm ports refused</li><li>value size → 1 MB</li><li>hallucinated numbers → the model outputs labels only</li></ul> |
| **P1b Laya** (tonight) | farm `classify` plugin (CPU, off by default, pinned, preloaded, batched, capped, key); Classify box; the template upgraded to Laya → Qwen for the unsure items | farm unit tests; the plugin run standalone against the spike's Laya; the harness against a mock `/classify`; the template on the mock farm | <ul><li>Laya accuracy (≈7–8/10 on topics) → threshold 0.6 plus "check these", lesson text honest; confirm on 100+ titles</li><li>farm CPU contention → off by default, `lol bench` before any default-on</li><li>plugin key in the beacon → documented, follow-up</li></ul> |
| **P1c OWUI 0.11.4** (tonight, if time) | pin bump, sidecar build, standalone smoke test, env surface re-verified | the bump notes in INTEGRATION_BRIEF; gates | breaking env changes → read the changelog first; roll back the pin if the smoke test fails |
| **P2 Speech** | farm `stt` (faster-whisper); Sound → Listen; Speak (`speechSynthesis`, Kokoro); consent and privacy text | a Sound box → text on the mock and real farm; Speak plays | <ul><li>audio privacy → press-to-record, visible state, a cap, texts first</li><li>R2T2 licence → external only, licence read first</li></ul> |
| **P3a Outputs** | an I/O bridge in main; Send box presets; the choke point; panic; dry run and arming; disarmed on import | a UDP/WS sink in the harness receives exact packets; panic sends a safe DMX frame | <ul><li>hardware harm → dry run, limits, 3 Hz, panic</li><li>multi-NIC Art-Net → an explicit interface choice</li></ul> |
| **P3b Triggers + armed runs** | Trigger box presets; runner work (latest-event, shown-only, hourly budget, not after quit) | OSC in → model → Send (dry run) round trip in the harness | runner regressions → per-event limits, reuse the Button path, harness coverage |
| **P4 Agents** | Agent box, **only if** the spike measures ≥ 80% | a bounded task done on the farm | weak local tool calling → small tool sets, Confirm |
| **P5 Studio IDE** | P5-0 dsh spike → v1 IDE (no shell), local serve, git | build, serve and commit a three.js app from a prompt | <ul><li>dsh churn → pin plus fallback</li><li>shell → none in v1</li><li>Windows paths and ACLs → a rig on a non-admin account</li></ul> |
| **P6 Home** | Home Assistant through MQTT (comes with P3); lessons 5–12 completed | — | cloud creep → HA local only |

Windows rig items the critic added: the firewall prompt (OSC-in, LAN serve), USB-serial drivers
(CH340/CP210x need admin), paths with spaces in git and dsh, and Art-Net interface choice on multi-NIC
laptops.

## 6. Tonight (v2)

1. **P1a**: Fetch box → template "Read the news" (labels from the Instruction box, a Code-drawn SVG, the
   reader's instructions) → mock-farm fixture → harness scenario → docs and lesson text.
2. **P1b**: farm `classify` plugin → Classify box → the template upgraded → tests → docs.
3. **P1c** if time allows: the OWUI 0.11.4 bump spike.
4. Report in the night log. P2 is next, but only after P1 is done and reviewed.

## 7. Open questions for the owner (with recommendations)

1. **Laya**: on the farm, CPU-first, off by default. *(Recommended, and started.)*
2. **Audio to the farm** under the OCR rule, with press-to-record, a visible state, a cap and a consent
   note. *(Recommended.)*
3. **R2T2**: licence read before any use; faster-whisper is the default. *(Recommended.)*
4. **dsh** as a second pinned upstream: only if the spike's exit criteria pass, with the minimal-loop
   fallback. *(Recommended.)*
5. **Git**: any HTTPS remote; Gitea documented as the fully local option. *(Recommended.)*
6. **Google Home and Alexa** → Home Assistant over MQTT, local only. *(Recommended.)*
7. **d3**: raise the sandbox's 2.0 MB library budget, or vendor only `d3-scale`/`d3-shape`/`d3-force` and
   drop matter.js? *(Needs your call.)*
8. **Plugin keys**: accept the beacon's clear-text plugin key on a trusted LAN for now, or tie plugin keys
   to the farm password? *(Recommended: the latter, as a follow-up.)*

## 8. Feature list (target), by surface

- **Farm**:
  - have: engines, seat gate, search, OCR, TTS;
  - to add: **classify (Laya)** · **STT** · plugin caps + 429 · no body logging · plugin keys tied to the
    farm password.
- **The Computer**:
  - have: canvas; 21 boxes; sandbox and Live; lessons 1–4;
  - data: **Fetch** · **Classify** · **d3** (if decided) · a table view later;
  - speech: **Sound → Listen** · **Speak**;
  - connectors: **Send** (OSC, DMX, MQTT, WS, serial, HTTP) · **Trigger** (OSC, MQTT, WS client, serial,
    schedule);
  - runs: **armed runs** · output safety · disarmed import;
  - agents and graphs: **Agent** (gated on the spike) · a graph.json view;
  - lessons: 5–12 as the capabilities land.
- **LOL Chat / Studio**: the **dsh spike** · IDE v1 (tree, editor, diff, preview) · skills · local serve ·
  git over HTTPS.
- **OWUI**: 0.11.4 bump · bump on each upstream minor.

## 8b. P3b design notes (written 2026-09-27 after P3a, for the next session)

**How a trigger starts a run.** `computer/host.mjs` `start({mode:'from', seeds:[partId]})` runs a box and
everything after it. Pressed mid-run, it **merges** its seeds into the live run (`runner.addToRun`) rather
than being refused. An event is therefore an automatic ▶ on the Trigger box. No new scheduler is needed.

**The Trigger box.** A "bring" box with a transport select:
- OSC in (a UDP port), MQTT subscribe (broker, topic), WebSocket (an outbound client to a device's
  `ws://`), and schedule (every N seconds).
- Serial read waits for the Web Serial work (P3a-2).

The listener lives in the **main process**, beside `outputs.ts` (a new `inputs.ts`: dgram / net / the
global WebSocket), so there is one place that opens sockets. Main pushes events to the renderer on one
channel (`lol:io:event`, a preload `onEvent` with the id-scoped payload).

**The policy** (plan §4.2, critic must-change 7):
1. Listeners run only while the graph is **armed**, the same arming as the outputs, and only while the
   Computer is **shown**. Hiding it or closing the window stops them.
2. A trigger keeps only its **latest** event while a run is busy. The merge carries the newest value, and
   older ones are dropped and counted on the face ("12 events, 11 merged").
3. Each armed graph has an **hourly generation budget** (default 60, a run-bar field). Past it, events
   still update the Trigger's value but start nothing, and the bar says why.
4. **Nothing stays armed after a quit**: main disarms on every reload, as P3a does.
5. **Inbound listeners bind only to the interface a person picks** (loopback by default). The Trigger face
   shows "listening on 0.0.0.0:9001" in plain words when the person chose the LAN.

**Tests.** A harness scenario sends a real OSC packet to the Trigger's port, and checks that the run
happens and that the downstream Send (dry run) reports the value. A second one hammers 50 events in a
second: exactly one run is live at a time, the last value wins, and the budget stops runs at its limit.

## 8c. Owner additions (2026-09-27 evening)

- **Done, in v0.2.0:** models write the code (Write code → a Code box's `code` port; a fold behind plain
  words) and Laya's question (Write a Laya question → Classify's `question` port); "Read the news" reshaped
  to Website + Topics → a model writes Laya's prompt → Laya; d3 in the sandbox; plugin keys tied to the farm
  password; a **?** on every box opening its example (38, one per ＋ menu entry).
- **Next: LOL Chat becomes "LOL Vibe"** in everything a person reads (topbar, docs, in-app text). The internal
  names stay (`renderer/chat/`, the `lol-chat` IndexedDB, `lol:view` values), so no history moves.
- **Planned: an MCP server for the Computer** ("control it from OWUI, or from apps vibecoded in LOL Vibe").
  - Where: the client's main process, Streamable HTTP on 127.0.0.1 only, behind a per-install token.
  - Tools: list, open and create graphs; add boxes; wire; change settings; run all / from a box; read values;
    list the box examples (the ? content is the tool documentation).
  - OWUI reaches it the way the opt-in Blender tool server does (`ui.toolServers` via the user-settings API):
    no OWUI change (invariants #1, #4).
  - Rules: an MCP caller can NEVER arm the outputs (arming stays a person's click, P3a); runs count against the
    same caps; a hidden window still sends nothing to the farm; every call is logged in the Record log.
  - Depends on: the rename (the MCP client in LOL Vibe), P5's IDE for "apps that use it".

## 9. Feedback loop

**v1 → critic** ([reviews/ECOSYSTEM_PLAN_CRITIC_2026-09-27.md](reviews/ECOSYSTEM_PLAN_CRITIC_2026-09-27.md))
**→ v2 (this).** The critic's verdict: "not tonight as written; yes once must-changes 1–4 are in." All 11
must-changes were taken; where v2 applies them is listed below.

| Must-change | Where v2 applies it |
|---|---|
| 1 (split P1) | §5, §6 |
| 2 (Laya: CPU, off, pinned, preloaded, batched, choice only, "uncalibrated") | §3.2 |
| 3 (labels and enum specs only; Code computes) | §3.6, template |
| 4 (Fetch: 1 MB, typed host, refusals, last response kept, no keys, lint door) | §4.2 |
| 5 (disarmed import) | §3.5 |
| 6 (speech via the Sound box, `speechSynthesis`, OpenAI STT contract, press-to-record) | §3.3 |
| 7 (armed runs need runner work, plus the policy) | §4.2 |
| 8 (P3a outputs before P3b triggers; one Send/Trigger box; one choke point; no inbound listeners; safe-DMX panic; 3 Hz) | §4.2, §5 |
| 9 (third parties in the privacy text; no body logging; plugin-key decision) | §3.4, §7.8 |
| 10 (OWUI bump now) | §3.9, P1c |
| 11 (dsh spike with ≥ 80% exit; skills IDE-only; no shell) | §4.3 |

Should-changes taken: d3 out of P1 (now an owner question), **Classify** as the name, Classify bounded
and visible like a generation, the test fixtures, the Windows rig items, graphify as an IDE skill, one git
path, the CPU-contention bench, one Learn shelf, LOL Chat kept until the IDE works, and capabilities read
per run. None were rejected.

**The next loop** runs after P1b ships. The critic reviews the built template against §3.6 and the
spike's accuracy on 100+ real titles.
