# The Computer: the node-graph surface

> Moved verbatim from CLAUDE.md on 2026-11-12 (the split into context modules). It describes `main` unless a line
> names a release or says *not released yet*. Keep it true: a change to the code it describes changes this file in the same commit.

- **The Computer** (third client surface, `shell/renderer/chat/{computer,graph,sandbox}/`) — a node-graph
  canvas where boxes wired by **named arrows** make a small program, kept in a library of graphs. Boxes:
  Text, Image (+ **Take a picture**: one frame of this computer's webcam), Document, Sound (+ **● Record**: this computer's
  microphone, and a **Listen** switch: the farm's speech to text writes it down) — mic and camera through ONE door,
  `graph/parts/capture.mjs` (lint rule 16), granted by main only to the window's own `file://` page (`serial.ts`
  `grantRequest`); the take is kept like a dropped file — File, **Fetch**, **Open data**
  (a data.gouv.fr dataset from a pasted link: its description, the whole-file column profile data.gouv.fr computed,
  a sample of ≤ 1000 rows — `graph/parts/opendata.mjs`, data.gouv.fr's public API v2 + tabular API only, every GET
  through `io.ts`), **Receive**
  (a board's lines over USB serial — Web Serial in the page, the port picked by a person through main's
  `select-serial-port`, `src/main/serial.ts` + `net/serial.mjs` — or a topic of the farm's message bus through
  its WebSocket hub, `net/bus.mjs`, the one file allowed a WebSocket), **Home** (2026-10-09, `graph/parts/home.mjs`: the
  Home Assistant devices a PERSON ticked with Choose… — states, a weather's forecast, a calendar's next 24 h, up to 168 h
  of history thinned to 240 points, ≤ 720 device-hours a read, one history read per 5 s, ≤ 8 MB, never for person/
  device_tracker/zone — read by main's `homeAssistant.ts` `read`; no coordinate or place; ONLY with no home linked it
  hands on the copy it holds, so a template's made-up reading never drives a real device) (*bring*); Instruction (+ "Write a p5.js/three.js/SVG/HTML"
  and "Describe a picture" presets, plus "Write code" — a model writes a Code box's program into its **code**
  port — and "Write a Laya question" — a model writes Classify's question + options into its **question**
  port), **Classify** (Laya on the farm: one multiple-choice question per item,
  with a confidence; unsure below 0.6; no Laya → every item passed on unsure; the unsure items' text rides a `check` list for a
  second opinion), **Agent** (P4, 2026-09-27, `graph/parts/agent.mjs`: a model in ≤ 12 short steps, each ONE tool —
  `run_code` in the sandbox over the labelled inputs and earlier results, `fetch` on hosts a PERSON listed on the box
  (exact names, through `io.ts`), `laya`, `answer` — JSON mode through the same ask door, one generation per step on
  the Cap (the plan quotes `1–N` via `mostGenerations`); a failed or malformed step is fed back; the answer carries
  every step and its result; no output tool, never arms), **Converse** (2026-10-12, `graph/parts/converse.mjs` + the pure
  `graph/voice.mjs`, [docs/archive/plans/COMPUTER_VOICE_PLAN.md](../../docs/archive/plans/COMPUTER_VOICE_PLAN.md): a spoken conversation with the farm's model, for
  designing voice interaction — a person's **● Start** on THAT box opens the microphone through `capture.mjs`
  `openListening` (the press is Button's registry plus a 15 s freshness, so a queued or stale press asks again; Run all
  never runs it, `manual`; the title-bar ▶, a Trigger, a wave from upstream and MCP `run_graph` are refused); an energy
  detector per animation frame (calibration, a noise floor that follows the room, an end-of-turn silence and a sensitivity
  a person sets, a raised threshold ×4 ≥ 0.07 while the bot speaks for barge-in); each turn cut out of a MediaRecorder take
  and sent as a 16 kHz WAV to the farm's speech to text (one retry after its Retry-After); the answer streamed (`app.ask`
  `onText`, `history` of the last 8 turns, `thinking:false`) and said sentence by sentence by Kokoro (n+1 made while n
  plays) or `speechSynthesis`; talking over it aborts the ask and the voice; ■ End finishes the sentence, Stop cuts it, and
  leaving the Computer (`EV.COMPUTER_SHOWN`) or hiding the window ENDS it and closes the microphone. Its events go to
  whatever Preview is ▶ Live — the face — as `lol.on(type|'*', fn)` / `lol.voice` in the sketch (sandbox `event` command,
  the live handle's `send`); one generation per answered turn on the Cap (`mostGenerations` = turns at most); the value is
  the transcript with each turn's timings, never sound), Split, Filter, Collect,
  Repeat (*think*); Preview (+ p5.js/three.js/SVG/HTML/Markdown presets, and since 2026-09-28 **Graph**: node-link
  JSON — graphify's `graph.json` — as a d3-force map by ONE viewer, `sandbox/graph-view.mjs`, which the IDE reuses;
  since 2026-09-27 it hands on a
  **PNG** of what it drew — SVG rasterised in the renderer — so a vision model can see its own work) and
  Code (a plain-words **What it does** line, and a fold that hides the program behind it), **Speak** (says text with the farm's voice or this computer's) and **Send** (OSC, Art-Net DMX, MQTT,
  WebSocket, HTTP POST, USB serial to a device — through ONE choke point in main (USB: main decides, the page writes), `src/main/outputs.ts`: DISARMED by default
  and after every reload so a run is a dry run, arming asks and lists every target, a target from the
  box's settings only (never from a wire), never the farm's ports, 20 msg/s per target, DMX ≤ 3 frames/s, Panic blacks out every universe lit) and
  **Home command** (2026-10-09: ONE action on ONE device, both a person's pick, its details only its own **With** — what arrives is the go signal; main's
  `command(…, {outputsArmed})` makes it a DRY RUN unless the Computer's outputs are armed — read in main — AND home commands
  are allowed, with every rule of the MCP home tools; the arming question names each one (id first, details shown) and
  refuses while a run is going; Panic disarms but undoes nothing)
  (*show*); Button, Condition, Confirm, Dialog, Toggle, Timer, **Trigger** (starts runs by itself on a bus message or
  a schedule, ONLY while a person armed the outputs and the Computer is on screen; one run per `gapSec`, latest wins;
  `perHour` runs at most) (*control*); Sticky, Section, Title
  (*annotate*). **A graph that came from a file** (library Import…, a dropped file, Replace from file…, or boxes pasted
  from elsewhere: a paste this window did not copy) keeps its settings, marked `doc.settings.handed` when it holds
  anything only a person chooses (`graph/person-only.mjs`; never read from the file); the first run, whichever way it
  starts (`host.mjs` `createHandedGate`, inside `start`), lists them in one question, and Cancel runs nothing. MCP
  `run_graph` refuses until a person said yes; shipped templates and examples pass `shipped: true` (owner 2026-11-06,
  v0.2.16). Thinking boxes ask the farm **directly** (never through OWUI) on the background lane: one
  request in flight, they yield to a person's chat, and a hidden window sends nothing. The toolbar's **Think all**
  (default off) decides thinking: off, lists, JSON, agent steps and **code answers** (an Instruction with a code kind:
  p5, three, SVG, HTML, a Code box's program; owner 2026‑11‑14, widening decision 9) send thinking off from
  `runner.mjs` `meteredAsk`; yes/no decisions and prose keep the model's default. Every run is bounded by
  `RUN_LIMITS` (`core/types.mjs`): 8 passes per box, 50 generations (the toolbar **Cap**), 10 min of wall
  clock including waits, 2000 activations; a loop is legal only through a gate box (`topo.mjs`
  `GATE_TYPES`). Code/p5/three/HTML run in ONE opaque-origin sandbox iframe (`sandbox/runner.html`,
  `allow-scripts` only, no network, vendored three r160 / p5 / matter, and d3 7.9 (2026-09-27, loaded for code that names
  `d3.`); `sandbox/host.mjs` is the only iframe maker)
  **WebRTC out** (2026-11-06, v0.2.16; its CSP never governed WebRTC, and Chromium ignores `webrtc 'block'` here: a guest sent UDP and a TURN TCP connection to an address it chose, and an `<iframe srcdoc>` is a fresh realm): the window has `nodeIntegrationInSubFrames`, so `src/preload/index.ts` runs in every frame before its scripts, gives the `lol` door to the main frame alone (`process.isMainFrame === true`) and strips `RTC*` from every other; `setWebRTCIPHandlingPolicy` is the backstop for UDP; harness `c3-sandbox-webrtc`. Plus at most one **Live** guest that gets the mouse and keys (`lol.orbit(camera)` is the first-party
  camera control); a Preview box's **Edit code** opens a drawer editor. View tools: Select (V) · Hand (H) · − % + Fit,
  answering from anywhere on the Computer, never while typing. What leaves the machine: prompt text and an
  Image's (or a Preview's rendered) pixels inside the Instruction's chat completion to the farm; a Document's PDF bytes to the farm
  OCR for text only; a Classify box's items (text) to the farm's Laya for one forward pass each; a Sound
  box's recording ONLY when a person turns on its **Listen** switch (an imported graph always opens with it off) — to the farm's speech-to-text, written down
  and dropped (never logged or kept); a **Converse** box's turns ONLY after a person's ● Start on it and ONLY while the
  Computer is on screen — each turn's sound (the speech plus 250 ms before and 150 ms after, a 16 kHz WAV) to the farm's
  speech-to-text, written down and dropped, no take kept or logged (the Record log gets its events and timings as
  `voice.*`, never sound); its words and the last 8 turns to the model like an Instruction's prompt; each sentence of the
  answer to the farm's Kokoro (or this computer's voice, which sends nothing); the transcript stays the box's value in
  DATA_DIR; a **Speak** box's text to the farm's Kokoro when it uses the farm voice
  (its own-computer voice, `speechSynthesis`, sends nothing); a **Fetch** box (2026-09-27) sends ONE GET to the address a person
  typed — run in main (`src/main/io.ts`): http(s), never loopback/link-local/farm ports, ≤ 1 MB text, keeps
  its last copy offline; an **Open data** box sends GETs to www.data.gouv.fr and tabular-api.data.gouv.fr only,
  derived from the dataset link a person pasted (nothing from the graph), each through the same `io.ts`; an **Agent** box's prompts (its task, a sketch of its inputs and
  results) go to the farm like an Instruction's, and its `fetch` steps GET addresses the MODEL picks, but only on the hosts a
  person listed on the box, through `io.ts` (a URL can carry what the model read — the listed hosts are the boundary). Where data lives: all of it in DATA_DIR — graphs and their
  files in the renderer's IndexedDB (`lol-chat` → `graphs`, `attachments`), which is the main window's
  session at `<DATA_DIR>/lol-client`, and File-box outputs in `<DATA_DIR>/LOL Studio Projects/` (one
  project per graph); a data-folder move carries both. The opt-in **Record log** writes `%APPDATA%\LlmOnLan\logs\computer\*.jsonl`
  (25 MB per file; 15 recordings kept + up to 30 with a marked bug; keys redacted; `src/main/debugLog.ts`,
  [docs/COMPUTER_DEBUG_LOG.md](../../docs/COMPUTER_DEBUG_LOG.md)). Learn shelf: the tour, lessons 1–14 (5 = code counts,
  the model names; 6 = a loop that stops; 7 listen and speak, 8 a picture to a model, 9 act on the world, 10 hear the
  world, 11 an agent with tools, 12 open data — 2026-09-28, all walkable on the mock farm; 13 read the room, 14 switch the
  home — 2026-10-09, walkable with no home) and 12 templates (Research a problematic, Creative coding, Read the news, **Analyse a
  dataset**, **Ask a dataset**, **Ask out loud**, **Talk to a board**, **A board on Wi-Fi** — the last five 2026-09-27/28; the board ones generated by `scripts/gen-board-templates.cjs`;
  **Morning briefing**, **Comfort advisor**, **Energy report** — 2026-10-09, each with a saved reading, `templates/home-readings.mjs`;
  **Voice persona** — 2026-10-12: a French museum guide's persona, Converse in French with Kokoro's `ff_siwis`, the **Voice
  face** p5 preset to ▶ Live, and an Instruction that reads the transcript),
  and since 2026-09-27 an **MCP server** (`src/main/mcp.ts`, 127.0.0.1:41995,
  a per-install bearer, JSON responses over Streamable HTTP; since 2026-10-05 the same listener, Host check and bearer
  also answer Open WebUI's web search, `POST /web/search` → `src/main/webSearch.ts`): Open WebUI's models list, build and run graphs
  through `computer/mcp-tools.mjs` — the Computer's own debug doors; no tool arms the outputs, and while a person has
  them armed NO tool changes or runs a graph (reading stays open); what only a person chooses (a Fetch address, an Open data
  link, an Agent's hosts, a USB board, Listen, a Home box's devices, a Home command's device/action/data) is dropped from a model's settings and reported as left for a person. Since 2026-09-30 the same
  server also answers **Home Assistant** itself, in main (`src/main/homeAssistant.ts`, [docs/HOME_ASSISTANT.md](../../docs/HOME_ASSISTANT.md)), listed only
  while a home is linked in **Preferences ▸ Home Assistant** (a person-typed address + long-lived token, the token `safeStorage`-encrypted in
  `<userData>/home-assistant.json`, never handed back to the page): `home_devices`, `home_state`, `home_command` — reading free, a command a
  DRY RUN until a person clicks **Allow commands…** (main's native dialog listing exactly the devices, naming ≤ 30 per kind and counting the rest; forgotten at close, on a relink that lands — a
  link generation refuses an allow that raced one — and on a window reload/crash like the outputs; the top bar shows **Home commands on · N**,
  one click stops); one device per command and only an action on `ACTIONS`' per-domain ALLOWLIST (HA registers a service per script, and
  `scene.apply`, `play_media`, `send_command` reach past the device — a security review found the first, 2026-09-30); never unlock/open a
  lock, disarm/trigger an alarm, sound a siren, open a valve, or open a cover unless HA says it is a blind/curtain/shade/shutter/awning/window;
  helpers/number/select stay commandable and the dialog says a switch, button, helper, scene or script does whatever the home wired;
  never a coordinate to a model (`HIDDEN_ATTRS`: latitude/longitude/gps_accuracy/altitude, a camera's token), never a street
  address (a sensor with a place attribute reads `(hidden: a place)`, `isPlace`), and a person's or a tracker's state reads
  home or not_home, never a zone's name (`readableState`, owner 2026-11-09); a redirect is refused, never
  followed; a command unconfirmed in 20 s is "sent, not confirmed" (HA shields the call, so it may still run); ≤ 1/s per device and 30/min.
  The MCP composition is `withHome()` (tested through `handleRpc`). The Computer's Home boxes reach the same module through
  `lol:home:read/entities/actions/command` (`projects/bridge.mjs` `homeDoor`); tests `home-boxes.test.mjs` (main),
  `home-part.test.mjs`, harness `k26-home` (with `LOL_HARNESS_HA` = the demo home's creds file, the live half). Since 2026-11-02 the same
  server also answers **prompts for ComfyQ** (owner: "a tool to write prompts", nothing more — it never reaches ComfyQ or looks for a machine;
  the student pastes the text into ComfyQ's form), in main (`src/main/comfyqPrompts.ts`, composed by `withComfyq()`, always listed):
  `comfyq_models` (ComfyQ's workflows that take a text prompt, grouped by ComfyQ's own kinds, an optional kind) and `comfyq_prompt_guide`
  (`model` = an id or a name; one workflow's prompt guides — the official links and tips the bundle carries, none invented where it has none —
  its form's text fields with the shipped text as an example, the negative prompt, switches, choices and sizes/durations, then what to write;
  a name matching several gives the candidates, never a guess). PURE DATA, no network, nothing about the person: `src/main/comfyqPrompts.json`,
  GENERATED by `scripts/gen-comfyq-prompts.cjs <ComfyQ checkout>` from its `workflows/*/*.meta.json` (54 with a prompt, 36 of them with a
  guide, 14 without a prompt, from ComfyQ 5d19e35) — re-run it when ComfyQ's workflows change; `comfyq-prompts.test.mjs` keeps the
  committed file equal to the generator's output for the commit it names. Also a **? on every box** that opens that box's example (`computer/examples/`: one per ＋
  menu entry, a Sticky with what it does / inputs / output / how to use it next to a working setup, imported
  as a library graph once and reopened after). A run cut short by the app's close is offered again when its graph opens (the **resume banner**, host.mjs: Resume = Run all, only unfinished boxes re-run; Dismiss closes it — 2026-09-28). Docs: [the user tutorial](../../docs/LOLCHAT_COMPUTER_TUTORIAL.md); the built
  plans, archived: [plan](../../docs/archive/plans/COMPUTER_PLAN.md), [live plan](../../docs/archive/plans/COMPUTER_LIVE_PLAN.md),
  [voice plan](../../docs/archive/plans/COMPUTER_VOICE_PLAN.md), [ecosystem plan](../../docs/archive/plans/ECOSYSTEM_PLAN.md); a dated
  [status report](../../docs/archive/COMPUTER_STATUS.md) to 12 Oct; their leftovers go to [docs/plans/README.md](../../docs/plans/README.md).
