# LlmOnLan ecosystem plan

> **Status: v1 (2026-09-27, 18:00). Awaiting the critic's review (§9).** This is written from the
> owner's vision of 2026-09-27. The research facts are in
> [research/ECOSYSTEM_RESEARCH_2026-09-27.md](research/ECOSYSTEM_RESEARCH_2026-09-27.md). This document
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

## 3. Cross-cutting decisions (proposed)

1. **Placement rule.**
   - Models run **on the farm** (the GPU, shared once, weights downloaded once): LLMs, Laya, STT, TTS,
     OCR.
   - **The client's main process** does I/O with the local world: fetch, UDP (OSC, Art-Net), sockets,
     serial permission, files, git, and the local web server.
   - **The renderer** holds the UI, sandboxed user code, WebSocket/MQTT-over-WS clients and Web Serial.
   - **Nothing is ever stored on the farm.**
   - Exception: when data must not leave the laptop at all, a client-side model is allowed once it is
     mature enough (kevala-class engines; revisit in P4).
2. **Laya runs on the farm** as a plugin (`decide`), for four reasons:
   - it is GPU-fast;
   - the official `laya-serve` is mature;
   - weights are downloaded once;
   - it follows the OCR precedent.

   The client sends the *state* (text or JSON) and the questions, and nothing is stored. With no farm
   plugin, the Decide box says so and offers the Instruction box as the slower alternative.
3. **STT and TTS run on the farm.**
   - TTS: Kokoro is already there.
   - STT: a new plugin.
     - The **default engine is faster-whisper**, which works on every farm OS.
     - **R2T2 is an opt-in engine** on Linux or WSL, following the `external` pattern: the operator runs
       it, and we never ship its weights until its licence is read.
4. **The privacy boundary is re-stated.** "Transient to the farm, never stored" covers the chat
   context, OCR bytes, Laya states, STT audio and TTS text. CLAUDE.md, the data-flow section and the
   in-app texts change in the same commit as each feature.
5. **Real-world outputs are safe by default**: dry run until armed, per-output rate limits, a global
   panic stop in the run bar, and Confirm for model-decided actions.
6. **Skills are the extension unit** for LOL Chat and for the Computer's Agent box: `SKILL.md` folders
   under `DATA_DIR/skills`, seeded with ponytail, agent-skills and graphify.
7. **Education is first class.** Every new capability ships with a template or lesson on the Learn
   shelf, and works on the mock farm, so a class can try it with no GPU.

## 4. The amended target, per surface

### 4.1 Farm
- **New plugins**, each with its own venv, health check, advertisement and a concurrency cap with a
  429:
  - `decide` (laya-serve; CPU fallback when there is no CUDA);
  - `stt` (faster-whisper by default; R2T2 as an operator-run external).
- **Capacity**: the VRAM budget subtracts resident plugin models, and the admin panel lists each
  plugin's VRAM.
- Later: `graphify` enrichment calls go to the normal OpenAI endpoint; they need no plugin.

### 4.2 The Computer (local n8n + data + real world)
- **Data**: a **Fetch** box (main-process `net.fetch`, GET, ≤ 5 MB, 15 s, http(s) only). JSON is parsed
  in the existing Code box; CSV becomes a helper there when needed. d3 is vendored for Preview.
- **Decide** box (Laya): typed questions (choice, score, yes/no) over each item, with probabilities and
  a confidence threshold. It flags low-confidence items for a person, as Laya's own guidance says.
- **Speech**: **Listen** (STT: microphone or Sound box → text) and **Speak** (TTS: text → audio,
  played or saved).
- **Connectors**:
  - **Out**: OSC, Art-Net DMX, MQTT publish, WebSocket send, serial write, HTTP POST.
  - **In**, as triggers: OSC, MQTT subscribe, WebSocket, serial read, webhook, schedule.
- **Reactive runs**: an **Armed** graph keeps its triggers listening. Each event is an automatic Button
  press downstream, with the same run limits per event plus a rate limit.
- **Agent** box (later): a tool-calling loop whose tools are chosen boxes or connectors, bounded by the
  run limits and gated by Confirm.
- **graphify**: a box that runs graphify on a project folder and shows `graph.json` as a force graph
  (d3).

### 4.3 LOL Chat → a Studio IDE on DeepSeek Harness
- **Engine**: DeepSeek Harness **pinned and unmodified**, run as a second sidecar (Node), configured by
  env or config.
  - Model: the farm, through `llm-pi-ai`'s OpenAI-compatible route.
  - Skills from `DATA_DIR/skills`.
  - Workspace under `DATA_DIR/LOL Studio Projects/<project>`.
  - Sandbox: `sandbox-local` / `sandbox-windows-acl`.
- **UI**: the chat pane (today's tree and seat etiquette) plus a file tree, editor (`code-edit.mjs`),
  diff view, terminal output and the sandbox preview. Whether we drive dsh through its **SDK** or
  embed its web UI like OWUI is **decided by a spike**.
- **Serve locally**: a static server in main per project, on loopback by default; LAN exposure is an
  explicit toggle (the farm's private/share pattern).
- **Git**: the system `git` when present (platform feature), else isomorphic-git. GitHub push uses the
  user's own credentials in the OS keychain (`safeStorage`). This is hosting, not inference, so it is
  compatible with local-first.

### 4.4 Open WebUI
- Stays pinned, unmodified and env-configured. **Bump the pin quarterly**, following the bump
  procedure (INTEGRATION_BRIEF), with the smoke tests.
- No new OWUI coupling. Speech and data features go to the Computer, not into OWUI.

## 5. Phases, with risks

Each phase ends with gates green, a harness scenario on the mock farm, a rig check on the real farm,
docs, and a Learn-shelf item.

| Phase | Scope | Exit | Main risks (likelihood × impact → mitigation) |
|---|---|---|---|
| **P0 Plan** (tonight) | this plan, research, decisions, critic loop | v2 committed | — |
| **P1 Data** (tonight) | Fetch box; farm `decide` plugin (Laya); Decide box; the template "Read the news" (HN → parse → Laya → Qwen, steered by the reader's instructions → SVG chart); d3 vendored | the template runs on the mock farm (the harness) and against a real `laya-serve`; farm unit tests for the plugin | <ul><li>Laya zero-shot accuracy is near chance on some tasks (high × med → confidence threshold, "check these" list, `choice` questions with few options, lesson text honest about it)</li><li>the fetch as SSRF (med × med → http(s) only, caps, a visible URL, user-started)</li><li>VRAM (low × med → CPU fallback, ~0.8 GB)</li></ul> |
| **P2 Speech** | farm `stt` plugin (faster-whisper; R2T2 external); Listen and Speak boxes; microphone capture; the privacy text | a Sound box → Listen → text on the mock and real farm; Speak → playback | <ul><li>R2T2 licence and Linux-only (high × med → opt-in external)</li><li>audio privacy (med × high → the boundary rewritten first; farm stores nothing)</li><li>latency on CPU farms (med × low)</li></ul> |
| **P3 Connectors + armed graphs** | an I/O bridge in main (UDP OSC/Art-Net, WS server, MQTT/TCP), renderer WS/MQTT-over-WS/Web Serial; trigger boxes; Armed mode; output safety | an ESP32 or simulator round trip; OSC in → model → DMX out in dry run and armed; panic stop | <ul><li>execution-model bugs (med × high → triggers reuse the Button path; per-event limits)</li><li>inbound listeners as an attack surface (med × high → off by default, bound to one interface, token)</li><li>hardware variance and testing (high × med → loopback simulators in the harness, then a rig kit)</li></ul> |
| **P4 Agents + graphify** | Agent box; `DATA_DIR/skills`; graphify box + d3 force view; schedules | an agent completes a bounded task on the local model | weak local tool calling (high × high → small tool sets, plan-first, Confirm) |
| **P5 Studio IDE (LOL Chat)** | dsh spike → pinned sidecar; IDE layout; local serve; git | build and serve a three.js app from a prompt, diff it, commit it | <ul><li>dsh preview churn (high × med → pin, smoke test)</li><li>shell access (high × high → dsh sandbox policy + our allow-list)</li><li>size on disk</li><li>Windows ACL sandbox maturity</li></ul> |
| **P6 Home and polish** | Home Assistant over MQTT; OWUI pin bumps; lessons 5–12 | — | cloud creep (→ HA local only) |

## 6. Tonight

1. P0: this plan, the critic loop, v2.
2. P1: Fetch → Laya plugin (farm) → Decide box → the template → d3 if time allows.
3. P2 start: the STT placement written up, and the farm `stt` plugin skeleton if time allows.

## 7. Open questions for the owner

1. **Laya on the farm** (proposed) versus in the client (kevala, days old)? We start on the farm.
2. **Audio to the farm** for STT: acceptable under the same rule as OCR (transient, never stored)?
3. **The R2T2 weight licence**: read it before any bundling, and default to faster-whisper?
4. **DeepSeek Harness as a second pinned upstream**: do we accept the churn of a developer preview?
5. **Git hosting**: GitHub only, or also a LAN Gitea (fully local)?
6. **Google Home and Alexa → Home Assistant** (local) instead of cloud skills?

## 8. Feature list (target), by surface

- **Farm**: engines (have) · seat gate (have) · plugins: search, OCR, TTS (have) · **decide (Laya)** ·
  **STT** · plugin concurrency caps · VRAM accounting for plugins.
- **The Computer**:
  - have: canvas and tools; 21 boxes; sandbox and Live; lessons.
  - to add:
    - data: **Fetch** · **Decide** · **d3** · a table view · CSV;
    - speech: **Listen** · **Speak**;
    - connectors: **OSC in/out** · **DMX out** · **MQTT** · **WebSocket in/out** · **Serial** ·
      **Webhook in** · **Schedule**;
    - runs: **Armed** runs · output safety;
    - agents and graphs: **Agent** · **graphify** · skills;
    - Learn shelf: a template per capability.
- **LOL Chat / Studio**:
  - have: chat tree; seat etiquette; budget.
  - to add: **DeepSeek Harness** engine; skills (ponytail, agent-skills); file tree, editor, diff;
    terminal output; sandbox preview; **local serve (LAN policy)**; **git** (diff, commit, pull, push);
    app templates (web, three.js, agent).
- **OWUI**: pinned; quarterly bumps.

## 9. Feedback loop
*(v1 → critic → v2: the critic's findings and what changed, recorded here)*
