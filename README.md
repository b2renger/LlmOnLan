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
  ┌──────────────── your machine ─────────────────┐      ┌─────────── GPU box (LAN) ───────────┐
  │  LOL shell (Electron) — ComfyQ-styled chrome  │      │  lol farm  ·  UDP beacon ──┐        │
  │   topbar · settings · connection screen       │      │                            │        │
  │   ┌─ <webview> ─ Open WebUI (pinned, UNMOD) ─┐│ chat │   LiteLLM proxy (one OpenAI endpoint)│
  │   │  all chats / docs / RAG vectors live     ││◄─────┤    ├─ llama-server  → the default    │
  │   │  HERE, in a folder you choose (DATA_DIR) ││ only │    │                  model (alias)  │
  │   └──────────────────────────────────────────┘│      │    └─ Ollama #1..#N → extra models,  │
  │   └─ or LOL Chat (topbar toggle, minimal UI) ─┘│      │                       OCR vision    │
  └───────────────────────────────────────────────┘      └──────────────────────────────────────┘
```

**Two inference engines, one endpoint.** `llama-server` serves the single model everyone chats with
(fastest path on a 12 GB card); Ollama serves the extra catalog + the OCR vision model. LiteLLM fronts
both, so the client sees one OpenAI‑compatible endpoint and never knows which answered. Details:
[`farm/README.md` ▸ Backends](farm/README.md#backends--llamacpp-default-and-ollama).

## The pieces

| Piece | What it is | Where |
|---|---|---|
| **`lol`** — farm CLI | Node CLI. Reads `lol.config.json`; runs **llama.cpp + Ollama**, generates + runs a LiteLLM proxy (one OpenAI‑compatible, load‑balanced endpoint), runs a UDP discovery beacon. **Where models are chosen.** | [`farm/`](farm/) |
| **Farm app** | Electron installer that runs the `lol` farm for a non‑technical operator: on first run it downloads its own Ollama + Python + the inference backend and weights, then hands over the farm **admin panel**. Settings carry the **model name users see**, the share‑with‑LAN toggle, and the context window. **Update checks are manual** (a notice + a Download button — no in‑place install). | [`farm-app/`](farm-app/) |
| **Client shell** | Electron + TypeScript. Supervises the bundled Open WebUI, discovers the farm, points OWUI at it, stores all data in a user‑chosen local folder. Owns the topbar / settings / connection screen. | [`shell/`](shell/) |
| **Open WebUI sidecar** | Vendored, version‑pinned, **unmodified**. We inherit all its features and never edit its source. | [`sidecar/`](sidecar/) |

## Prime directive (non‑negotiable)

1. **Open WebUI is vendored, version‑pinned, and UNMODIFIED** — zero OWUI source diffs in this repo, ever.
2. **We keep Open WebUI's branding** (license convenience + product choice).
3. **All persistent data stays on the client machine** under a user‑chosen `DATA_DIR`. The farm is stateless.
4. **We touch OWUI only through its public surface** (env vars + admin REST API).
5. **Upgrading OWUI is a version bump, not a merge** — no LOL code changes.

See [`CLAUDE.md`](CLAUDE.md) for the full invariants, the integration contract, and the design
rationale, and [`implementation_plan.md`](implementation_plan.md) for the milestone plan.

## Status

**Shipped — client `v0.1.33` (self‑updating), Farm app `farm-v0.0.20` (manual update check), OWUI `0.10.2`.**

*Chat + farm* — a **two‑engine farm**: [llama.cpp](farm/README.md#backends--llamacpp-default-and-ollama)
(`llama-server`) serves the one model everyone chats with, Ollama serves the extra catalog and the OCR
vision model, both behind a single load‑balanced LiteLLM endpoint. **Stable model aliases** mean the
operator can swap the checkpoint underneath without breaking a single existing chat, and can
[**name the model users see**](farm-app/README.md) from the Farm app's Settings. The client is the
bundled, unmodified **Open WebUI**, with a topbar toggle to **LOL Chat** — a minimal, Studio‑style chat
surface that talks straight to the farm.

*Features* — **full multimodal** (image understanding + voice; Whisper STT runs on‑device); **web
search** via a shared farm‑hosted [SearXNG](https://docs.searxng.org) (**on by default**, zero client
setup); **neural voice** via farm‑hosted [Kokoro](https://github.com/remsky/Kokoro-FastAPI) TTS
(opt‑in); **document OCR** — a shared farm service ([Ollama‑OCR](https://github.com/imanoop7/Ollama-OCR)
for images + scanned PDFs, **on by default**, [details below](#document-ocr-optional)); **assistant
tools** — drive a local **[Blender](#assistant-tools--control-blender-optional)** over MCP (opt‑in per
client); **multi‑box load balancing** (least‑loaded selection, `--coordinator` aggregation, `lol fleet`).

*Operating it* — a **farm admin panel** at `http://<box>:41997/lol/admin` (token printed by `lol up`):
start/stop Ollama models, toggle the web‑search / voice / OCR plugins, recommend Blender to the fleet,
and see **connected clients** with idle times. Plus workshop tooling (`lol bench` load test, model
keep‑warm) and [capacity guidance](farm/README.md#multiple-users--capacity) for a room full of people.

Progress, design decisions, and the debugging history are in [`docs/DEVLOG.md`](docs/DEVLOG.md); current
state + roadmap in [`implementation_plan.md`](implementation_plan.md).

## Run a farm — the desktop app (recommended, zero setup)

The easiest way to host a farm is the **[LlmOnLan Farm app](farm-app/)** — a downloadable
installer that turns a GPU box into a running farm with **no terminal and no
prerequisites**. (Its **update checks are manual**: it tells you a new build exists and links the
download — unlike the client, it never installs one for you. Check it after each client release so the
farm doesn't drift behind the fleet.) On first launch a wizard downloads its own Ollama + Python, the model weights and
the llama.cpp backend, builds the service venvs, and starts the farm — budget **~28 GB of downloads
and 30–45 minutes** on that first run ([breakdown](docs/GETTING_STARTED.md#first-run-download-both-routes)); from then on the window IS the farm's **admin panel**. Targets **Windows + NVIDIA**, **macOS Apple Silicon (≥16 GB)**, and the
**NVIDIA DGX Spark** (linux arm64). See [`farm-app/README.md`](farm-app/README.md).

> **Serving a group?** A farm answers **one request at a time** by default. Raise `llamacpp.parallel`
> (and `contextLength` with it) before a workshop — the sizing table is in
> [`docs/GETTING_STARTED.md` ▸ capacity](docs/GETTING_STARTED.md#4-a-room-full-of-people-capacity--multiple-gpu-boxes),
> the full reference in [`farm/README.md`](farm/README.md#multiple-users--capacity). It is a config edit,
> not a Farm-app setting, today.

## Quick start (farm operator, CLI)

Prefer the terminal? The `lol` CLI is the same farm the app manages:

```bash
cd farm
npm install
node bin/lol.js init           # scaffold lol.config.json
node bin/lol.js install        # Ollama + LiteLLM + models + the llama.cpp backend (several GB, once)
node bin/lol.js up             # start the engines + LiteLLM + the beacon
node bin/lol.js status         # health of hosts + proxy + loaded models
```

Prereqs: **Node ≥ 20** and a Python 3.9–3.13 — `lol install` sets up everything else (Ollama, LiteLLM,
the llama.cpp backend, the models). Then: [Backends](farm/README.md#backends--llamacpp-default-and-ollama)
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
(torch‑free — it reuses the vision model you already serve). The client needs nothing. Opt a box out with
`"ocr": { "enabled": false }` (or `lol up --no-ocr`), or toggle it live from the admin panel.

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
The uploaded file transits to the trusted‑LAN farm for extraction (same boundary as web
search); embedding still happens on the client.

## Assistant tools — control Blender (optional)

The chat can drive **Blender running on the same machine as the client** — create objects, run Python in
Blender, inspect the scene — over the [Model Context Protocol](https://modelcontextprotocol.io). It's
**opt‑in per client** (off by default): tick Settings (⚙) → **Assistant tools** → **Blender tools** and the
client configures everything automatically — it runs a **local** MCP→OpenAPI proxy
([`mcpo`](https://github.com/open-webui/mcpo)) in front of the
[BlenderMCP](https://github.com/ahujasid/blender-mcp) server and registers it through OWUI's own
supported **user‑settings API** (`POST /api/v1/users/user/settings/update`, appending to
`ui.toolServers` and selecting it via `ui.tools`) — not the `TOOL_SERVER_CONNECTIONS` env var, which
OWUI doesn't reliably surface. Nothing is exposed to the network and OWUI is never modified. **You only enable the toggle and set up Blender.** (A farm operator can
also **recommend** Blender to the whole fleet from the admin panel — clients that never made an explicit
choice then enable it automatically.)

**Topology:** Blender + the LOL client run on the **user's own machine**; the GPU farm is unchanged, and
each person controls their own Blender.

### Set up Blender (your side, once)

Three steps — enable the toggle, install the **BlenderMCP** add‑on, start its server — then ask the chat
for a red cube. The **step‑by‑step walkthrough, the port setting, and the troubleshooting live in one
place**: [`docs/GETTING_STARTED.md` ▸ Control Blender from the chat](docs/GETTING_STARTED.md#control-blender-from-the-chat-opt-in).

### Requirements & safety

- **Use a tool‑calling model.** Blender control is only as good as the model's function‑calling. `gemma4:12b`
  is weak at tools — serve a tool‑tuned model (e.g. a **Qwen 2.5/3** or **Llama 3.x**) from the farm
  (`lol up`, pick it) for usable results.
- **Local & private.** The tool server binds to `127.0.0.1` only (never the LAN), behind a random key, and
  BlenderMCP's telemetry is disabled. It can run arbitrary Python inside Blender, so treat it like any
  script you'd run on your own scene.
- Fuller walkthrough: [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md#control-blender-from-the-chat-opt-in).

## License

MIT (this repo's first‑party code). Open WebUI is bundled unmodified under its own license — see
its branding/attribution terms, which we deliberately keep. "Powered by Open WebUI."
