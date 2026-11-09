# LlmOnLan (LOL)

> A desktop client + a LAN inference farm. The client bundles a **pinned, unmodified
> [Open WebUI](https://github.com/open-webui/open-webui)** and auto‑connects to the farm so
> anyone on the office Wi‑Fi can chat with a local model with **zero setup** — no URL, no account,
> no Docker. All data stays on the user's machine.

LlmOnLan is a sibling of [ComfyQ](https://github.com/b2renger/ComfyQ): same visual language,
same Electron/auto‑update conventions, same dependency‑free UDP discovery. Where ComfyQ schedules
ComfyUI workflows, LOL gives a workshop a private, local‑first chat assistant.

> **New here? Start with [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)** — clone, set up a farm on a GPU
> box, install the client app, and connect. The quick starts below are the short version.

```
  ┌──────────────── your machine ─────────────────┐       ┌───────────── GPU box (LAN) ─────────────┐
  │  LOL shell (Electron) — ComfyQ-styled chrome  │       │  lol farm · UDP beacon · admin panel    │
  │   topbar · preferences · connection screen    │       │                                         │
  │   ┌─ <webview> ─ Open WebUI (pinned, UNMOD) ─┐│       │  seat gate → LiteLLM (one endpoint)     │
  │   │  all chats / docs / RAG vectors live     ││◄─────►│   ├─ Ollama → the default (gemma4:12b)  │
  │   │  HERE, in a folder you choose (DATA_DIR) ││  LAN  │   ├─ llama.cpp → opt-in, speed          │
  │   └──────────────────────────────────────────┘│       │   └─ vLLM → opt-in, many people at once │
  │   or LOL Vibe · or the Computer (the switch)  │       │  plugins: web search, OCR, document     │
  │                                               │       │  search, voice, speech to text, …       │
  └───────────────────────────────────────────────┘       └─────────────────────────────────────────┘
```

**What goes to the farm** (it keeps nothing): your messages and, when the farm offers them, an uploaded file
to read (OCR), a document's text to index (document search: the vectors come back and stay on your machine),
a recording to write down (speech to text), web searches and text to read aloud; and every 10 s a presence ping
(the laptop's name, for the panel's list of clients). The full list is in
[`CLAUDE.md`](CLAUDE.md) ▸ Data‑flow & privacy boundary.

**Inference engines, one endpoint.** By default the farm serves **`gemma4:12b` on Ollama** at its native
context (vision‑native, so one model covers chat and the OCR plugin). Two engines are **opt‑in from the farm
panel**: **llama.cpp** (one `.gguf`, the fastest for a few people) and **vLLM** (many people at once on a big
NVIDIA GPU; the farm installs, starts and stops it, on Windows inside WSL2). An `external` OpenAI‑compatible
server the farm does not run (SGLang, another machine) is a fourth option, set in the config file by a
developer. One engine serves at a time. LiteLLM fronts it behind the farm's seat gate, so the client sees one
OpenAI‑compatible endpoint and never knows which answered. Details:
[`farm/README.md` ▸ Backends](farm/README.md#backends--ollama-default-and-llamacpp),
[vLLM, run by the farm](farm/README.md#vllm-run-by-the-farm).

## The pieces

| Piece | What it is | Where |
|---|---|---|
| **`lol`** — farm CLI | Node CLI. Reads `lol.config.json`; runs **Ollama (default), llama.cpp or vLLM**, generates + runs a LiteLLM proxy (one OpenAI‑compatible, load‑balanced endpoint), runs a UDP discovery beacon. **Where models are chosen.** | [`farm/`](farm/) |
| **Farm app** | Electron installer that runs the `lol` farm for a non‑technical operator: on first run it downloads its own Ollama + Python + the inference backend and weights, then hands over the farm **panel** (where the model, its name and the capacity are run). Its own Settings carry the share‑with‑LAN toggle, theme, launch‑at‑login and updates. **Update checks are manual** (a notice + a Download button — no in‑place install). | [`farm-app/`](farm-app/) |
| **Client shell** | Electron + TypeScript. Supervises the bundled Open WebUI, discovers the farm, points OWUI at it, stores all data — OWUI's, LOL Vibe's and the Computer's — in a user‑chosen local folder. Owns the topbar / Preferences / connection screen, and two surfaces of its own: **LOL Vibe** and the **Computer**. | [`shell/`](shell/) |
| **Open WebUI sidecar** | Vendored, version‑pinned, **unmodified**. We inherit all its features and never edit its source. | [`sidecar/`](sidecar/) |

## Prime directive (non‑negotiable)

1. **Open WebUI is vendored, version‑pinned, and UNMODIFIED** — zero OWUI source diffs in this repo, ever.
2. **We keep Open WebUI's branding** (license convenience + product choice).
3. **All persistent data stays on the client machine** under a user‑chosen `DATA_DIR` — OWUI's, LOL Vibe's history, and the Computer's graphs, media and projects. The farm is stateless.
4. **We touch OWUI only through its public surface** (env vars + admin REST API).
5. **Upgrading OWUI is a version bump, not a merge** — no LOL code changes.

See [`CLAUDE.md`](CLAUDE.md) for the full invariants, the integration contract, and the design
rationale. Every other document is on the map, [`docs/README.md`](docs/README.md) (the first milestone plan, the v0.1
one of 2026-06 to 2026-08, is archived: [`docs/archive/plans/implementation_plan.md`](docs/archive/plans/implementation_plan.md)).

## Status

**Released — client `v0.2.16` (self‑updating, Open WebUI `0.11.4`) and Farm app `farm-v0.0.52` (manual update
check), 2026-11-09, for a phase of human testing:** what to check, in order, is the ★ list of
[`docs/HUMAN_TESTS.md`](docs/HUMAN_TESTS.md). What each release brought is in [`docs/DEVLOG.md`](docs/DEVLOG.md); the state of each piece is the build
status in [`CLAUDE.md`](CLAUDE.md).

*Chat + farm* — the farm serves **`gemma4:12b` on [Ollama](farm/README.md#backends--ollama-default-and-llamacpp)**
by default, with **llama.cpp** (the speed pick for a few people) and **vLLM** (many people on a big NVIDIA GPU,
installed and run by the farm) opt‑in from the panel; whichever serves sits behind a single load‑balanced LiteLLM
endpoint. **Stable model aliases** mean the operator can swap the checkpoint
underneath without breaking a single existing chat, and can **name the model users see** in the farm
panel. The client is the bundled, unmodified **Open WebUI**, with a topbar switch between Open WebUI,
**LOL Vibe** (a Studio‑style chat straight to the farm, with an **IDE**: a coding agent — DeepSeek Harness on the
farm's model — builds web projects you preview, version and push to GitHub; [guide](docs/LOLVIBE_IDE_GUIDE.md)) and
the **Computer** (boxes wired into small programs that read data, see, hear, speak and drive boards and lights;
[tutorial](docs/LOLCHAT_COMPUTER_TUTORIAL.md); to send a bug, [record a session](docs/COMPUTER_DEBUG_LOG.md)).

*Features* — **full multimodal** (image understanding + voice: the farm writes your words down when its **Speech
to text** plugin is on, else Whisper does it on the laptop; Open WebUI's **Voice mode** holds a spoken
conversation); **web search** via a shared farm‑hosted [SearXNG](https://docs.searxng.org) (hosted by default, zero
client setup; **off by default in each chat — the globe button turns it on for a chat**); **neural voice** via
farm‑hosted [Kokoro](https://github.com/remsky/Kokoro-FastAPI) TTS (opt‑in); **document OCR** — a shared farm
service ([Ollama‑OCR](https://github.com/imanoop7/Ollama-OCR) for images + scanned PDFs, **on by default**,
[details below](#document-ocr-optional)); **document search** on the farm (EmbeddingGemma 2, on by default with an
NVIDIA GPU: documents searched in any language, the vectors kept on the laptop); **assistant tools** — in Open WebUI,
the **LlmOnLan Computer** tool builds and runs the Computer's graphs, reads and (once you allow it) switches your
[Home Assistant](docs/HOME_ASSISTANT.md), and writes prompts for ComfyQ's workflows; a local
**[Blender](#assistant-tools--control-blender-optional)** over MCP (opt‑in per client); **multi‑box load
balancing** (least‑loaded selection, `--coordinator` aggregation, `lol fleet`).

*Operating it* — a **farm panel** at `http://<box>:41997/lol/admin` (token printed by `lol up`; the Farm
app shows it as its own window). It is where the farm is run: **presets** that set it up for a session in one
go (Balanced, the farm as it ships, or Documents, LOL Vibe, Computer, picked for this box), **switch engine** (Ollama, llama.cpp or vLLM,
which the panel installs itself), pick the served `.gguf` from a **model library** you can add any URL to, set the
**name users see** and the **context window**, choose **how many people it serves at once**, download / offer /
delete Ollama models, keep every model in one folder (**Model storage**), turn the plugins on or off (web search,
document OCR, document search, voice, speech to text, Classify, the message bus), recommend Blender to the fleet,
and see **connected clients** against the seats. The panel applies each change itself, restarting only what it
must (on vLLM it asks first), and keeps it in `lol.config.json` for the next start; Ollama's people served at once
applies after a farm restart, and the Blender recommendation lasts until the farm stops. **Plan capacity ↗** says
which hardware and model serve how many people. Plus workshop tooling (`lol bench` load test, model keep‑warm)
and [capacity guidance](farm/README.md#multiple-users--capacity) for a room full of people.

The map of every document is [`docs/README.md`](docs/README.md). Progress, design decisions, and the debugging
history are in [`docs/DEVLOG.md`](docs/DEVLOG.md); what a person must still check on real machines is in
[`docs/HUMAN_TESTS.md`](docs/HUMAN_TESTS.md); the next work, in order, is in
[`docs/plans/README.md`](docs/plans/README.md).

## Run a farm — the desktop app (recommended, zero setup)

The easiest way to host a farm is the **[LlmOnLan Farm app](farm-app/)** — a downloadable
installer that turns a GPU box into a running farm with **no terminal and no
prerequisites**. (Its **update checks are manual**: it tells you a new build exists and links the
download — unlike the client, it never installs one for you. Check it after each client release so the
farm doesn't drift behind the fleet.) On first launch a wizard downloads its own Ollama + Python and
the model weights, builds the service venvs, and starts the farm — budget **~18 GB of downloads plus
its own Python/Ollama runtime** on that first run (about 1.2 GB more on an NVIDIA box, for document search:
llama.cpp's build and a small model; the llama.cpp engine's own model is fetched only if you enable it later)
([breakdown](docs/GETTING_STARTED.md#first-run-download-both-routes)); from then on the window IS the farm's
**admin panel**. **It starts private to that computer**: turn on its Settings ▸ **Share compute with the
network** so the laptops find it. Targets **Windows + NVIDIA**, **macOS Apple Silicon (≥16 GB)**, and the
**NVIDIA DGX Spark** (linux arm64). See [`farm-app/README.md`](farm-app/README.md).

> **Serving a group?** The default farm (gemma4 on Ollama) answers **two requests at a time per box**
> (llama.cpp: one). Before a workshop, open the farm panel — the Farm app's window. The quickest way is the
> **Presets** card at the top: **Review…** then **Apply** sets the farm up for a session (**Documents**, **LOL
> Vibe** or **Computer**, picked for this box for the most people; **Balanced** is the farm as it ships). By hand: the serving engine's section ▸ **People served
> at once** (on Ollama it applies after a farm restart); on a big NVIDIA GPU, **vLLM** serves far more. The sizing table is in
> [`docs/GETTING_STARTED.md` ▸ capacity](docs/GETTING_STARTED.md#4-a-room-full-of-people-capacity--multiple-gpu-boxes),
> the full reference in [`farm/README.md`](farm/README.md#multiple-users--capacity).

## Quick start (farm operator, CLI)

Prefer the terminal? The `lol` CLI is the same farm the app manages:

```bash
cd farm
npm install
node bin/lol.js init           # scaffold lol.config.json
node bin/lol.js install        # Ollama + LiteLLM + models (several GB, once); see "Prereqs" below
node bin/lol.js up             # start the engines + LiteLLM + the beacon
node bin/lol.js status         # health of hosts + proxy + loaded models
```

Prereqs: **Node ≥ 20** and a Python 3.10–3.13 (3.9 is enough for LiteLLM alone, not for web search/OCR) — `lol install` sets up everything else (Ollama, LiteLLM,
the models, web search and OCR, document search on an NVIDIA box — Windows x64 or a DGX Spark: llama.cpp's build
and a ~0.6 GB model — and the llama.cpp engine's own model only when `llamacpp.enabled`; never vLLM, which the
panel installs). Then: [Backends](farm/README.md#backends--ollama-default-and-llamacpp)
· [Adding or changing models](farm/README.md#adding-or-changing-models) ·
[Multiple users & capacity](farm/README.md#multiple-users--capacity).

## Quick start (client, dev)

```bash
cd shell
npm install
npm run dev                    # boots the shell + OWUI sidecar, loads it in a webview
```

Needs the sidecar venv (`sidecar/.venv`) and a farm on the LAN (or `LOL_ENDPOINT=…`). See
[`shell/README.md`](shell/README.md) and [`sidecar/README.md`](sidecar/README.md).

## Document OCR (optional)

Turn on OCR and every client can upload an **image or a scanned PDF** and have its text extracted — both
**searchable** (ask questions about the document) and **transcribable** (ask for the full text back). It runs
as **one shared service on the farm box** (that's where the GPU + vision model already are) and every client
picks it up automatically over the beacon — no client setup.

**How it works:** the service ([`farm/src/pysvc/server.py`](farm/src/pysvc/server.py)) is what Open WebUI calls
its **external content‑extraction engine**. On each uploaded file it routes: **images + scanned/image‑only PDF
pages → a vision model** on the farm's local Ollama (via the vendored
[Ollama‑OCR](https://github.com/imanoop7/Ollama-OCR), MIT); **born‑digital PDFs / Word / text → fast local
extraction**. This is the only OWUI surface that receives an uploaded file's bytes, so it's how OCR must be
wired — a chat "tool" can't see uploads.

**On by default (farm operator):** the first `lol up` installs a small Python service into `farm/.extract/`
(torch‑free — it reuses the vision model you already serve). The client needs nothing. Turn it off on a box in the farm
panel's *Plugins* card (Document OCR ▸ **Disable**; the switch is kept for the next start). Developers:
`"ocr": { "enabled": false }`, or `lol up --no-ocr` for one run. The keys below are that developer reference.

```jsonc
"ocr": {
  "enabled": true,
  "port": 8890,
  // "model": "gemma4:12b", // omit `model` to auto-use the farm's served default vision model
  "format": "markdown",   // markdown | text | json | structured | key_value | table
  "pdfEngine": "auto",    // auto = text layer / vision‑OCR / BOTH on mixed text+image pages; vision | text
  "preprocess": false,    // cv2 binarization (usually worse for a vision LLM — leave off)
  "docling": false        // true = also install Docling for office formats (pptx/xlsx…); heavy (torch)
}
```

**Notes.** Enabling OCR routes **all** of OWUI's document ingestion through the farm — the light path handles
images, PDFs, `.docx`/`.pptx`/`.xlsx`, and plain text/HTML; legacy binary Office (`.doc`/`.ppt`/`.xls`) and
`.odt`/`.epub`/`.rtf` need `"docling": true` (a multi‑GB install).
Multi‑page scanned PDFs are N vision‑model passes, so they're slower than born‑digital PDFs (which use the
embedded text); pages that mix a text layer with **large images** (slides, design docs) get **both** — the
text plus a vision pass over the page — so figures aren't dropped (vector‑drawn charts aren't detected as
images; use `"pdfEngine": "vision"` for those). Each processed document logs one `[extract]` summary line on
the farm (pages, per‑engine routing, chars, seconds) — that line is the proof OWUI is using the farm OCR.
The uploaded file goes to the trusted‑LAN farm for extraction (the same boundary as web search). On a farm
with **document search** (on by default with an NVIDIA GPU), the document's text goes there too, to be turned into
vectors. The vectors come back and stay on the laptop, and the farm keeps nothing. A data folder that has never
met such a farm computes its vectors on the laptop. Once it has, it keeps the farm's model for good: on a farm
without document search, an upload fails with a message instead of mixing two models.

## Assistant tools — control Blender (optional)

The chat can drive **Blender running on the same machine as the client** — create objects, run Python in
Blender, inspect the scene — over the [Model Context Protocol](https://modelcontextprotocol.io). It's
**opt‑in per client** (off by default): tick Preferences (⚙) → **Assistant tools** → **Blender tools** and the
client configures everything automatically — it runs a **local** MCP→OpenAPI proxy
([`mcpo`](https://github.com/open-webui/mcpo)) in front of the
[BlenderMCP](https://github.com/ahujasid/blender-mcp) server and registers it through OWUI's own
supported **user‑settings API** (`POST /api/v1/users/user/settings/update`, appending to
`ui.toolServers` and selecting it via `ui.tools`) — not an env var: when this was built (Open WebUI 0.10.2), a tool
server set through env was not reliably shown (upstream issue #18140), and the user‑settings API adds or removes it
while the app runs, without restarting Open WebUI. (The Computer's MCP server, by contrast, is set at boot through
`TOOL_SERVER_CONNECTIONS`.) Nothing is exposed to the network and OWUI is never modified. **You only enable the toggle and set up Blender.** (A farm operator can
also **recommend** Blender to the whole fleet from the admin panel — clients that never made an explicit
choice then enable it automatically.)

**Topology:** Blender + the LOL client run on the **user's own machine**; the GPU farm is unchanged, and
each person controls their own Blender.

### Set up Blender (your side, once)

Three steps — enable the toggle, install the **BlenderMCP** add‑on, start its server — then ask the chat
for a red cube. The **step‑by‑step walkthrough, the port setting, and the troubleshooting live in one
place**: [`docs/GETTING_STARTED.md` ▸ Control Blender from the chat](docs/GETTING_STARTED.md#control-blender-from-the-chat-opt-in).

### Requirements & safety

- **Use a tool‑calling model.** Blender control is only as good as the model's function‑calling.
  `gemma4:12b` made 95% correct tool calls in a test with 8 tools (2026‑09‑27,
  [results](docs/research/agent-spike/RESULTS.md)); Blender's own tools were not measured. If results are
  hit‑or‑miss, serve a model that calls tools well (a **Qwen**, for example) from the farm panel.
- **Local & private.** The tool server binds to `127.0.0.1` only (never the LAN), behind a random key, and
  BlenderMCP's telemetry is disabled. It can run arbitrary Python inside Blender, so treat it like any
  script you'd run on your own scene.
- Fuller walkthrough: [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md#control-blender-from-the-chat-opt-in).

## License

MIT (this repo's first‑party code). Open WebUI is bundled unmodified under its own license — see
its branding/attribution terms, which we deliberately keep. "Powered by Open WebUI."
