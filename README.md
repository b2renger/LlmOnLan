# LlmOnLan (LOL)

> A desktop client + a LAN inference farm. The client bundles a **pinned, unmodified
> [Open WebUI](https://github.com/open-webui/open-webui)** and auto‑connects to the farm so
> anyone on the office Wi‑Fi can chat with a local model (`gemma4:12b`) with **zero setup**.
> All data stays on the user's machine.

LlmOnLan is a sibling of [ComfyQ](https://github.com/b2renger/ComfyQ): same visual language,
same Electron/auto‑update conventions, same dependency‑free UDP discovery. Where ComfyQ schedules
ComfyUI workflows, LOL gives a workshop a private, local‑first chat assistant.

> **New here? Start with [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)** — clone, set up a farm on a GPU
> box, install the client app, and connect. The quick starts below are the short version.

```
  ┌──────────────── your machine ────────────────┐        ┌──────── LAN ────────┐
  │  LOL shell (Electron) — ComfyQ-styled chrome  │        │  lol CLI on GPU box │
  │   topbar · settings · connection screen       │        │   UDP beacon ──┐    │
  │   ┌─ <webview> ─ Open WebUI (pinned, UNMOD) ─┐ │  chat  │   LiteLLM proxy │   │
  │   │  all chats / docs / RAG vectors live     │◄├────────┤   ├ Ollama #1    │   │
  │   │  HERE, in a folder you choose (DATA_DIR) │ │ only   │   └ Ollama #N    │   │
  │   └──────────────────────────────────────────┘ │        │  (gemma4:12b)   │   │
  └────────────────────────────────────────────────┘        └─────────────────┘
```

## The pieces

| Piece | What it is | Where |
|---|---|---|
| **`lol`** — farm CLI | Node CLI. Reads `lol.config.json`; ensures Ollama, generates + runs a LiteLLM proxy (one OpenAI‑compatible, load‑balanced endpoint), runs a UDP discovery beacon. **Where models are chosen.** | [`farm/`](farm/) |
| **Farm app** | Electron installer that runs the `lol` farm for a non‑technical operator: on first run it downloads its own Ollama + Python, pulls gemma4:12b, and hands over the farm **admin panel**. Self‑updating. | [`farm-app/`](farm-app/) |
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

**Shipped and self‑updating (v0.1.25, OWUI 0.10.2).** Milestones M0–M5 are done, plus: **full
multimodal** (image understanding + voice — local Whisper STT, on‑device); **web search** via a shared
farm‑hosted [SearXNG](https://docs.searxng.org), **on by default**, zero client setup, auto‑discovered;
**neural voice** via a shared farm‑hosted [Kokoro](https://github.com/remsky/Kokoro-FastAPI) TTS (opt‑in);
**document OCR** — a shared farm‑hosted extraction service ([Ollama‑OCR](https://github.com/imanoop7/Ollama-OCR)
vision‑model OCR for images + scanned PDFs, **on by default**, [details below](#document-ocr-optional));
**assistant tools** — drive a local **[Blender](#assistant-tools--control-blender-optional)** over MCP,
opt‑in per client ([how‑to below](#assistant-tools--control-blender-optional)); **multi‑box load
balancing** (least‑loaded client selection, `--coordinator` aggregation, `lol fleet`); **stable model
aliases** (swap the served model without breaking chats) with a startup **model picker**; a **farm admin
panel** at `http://<box>:41997/lol/admin` (token printed by `lol up`) — start/stop served models, set the
default model, adjust the context window live, toggle the web‑search / voice / OCR plugins, recommend
Blender to the fleet, and see connected clients with idle times; and workshop
tooling (`lol bench` load test, model keep‑warm). Progress, design decisions, and the debugging history are
in [`docs/DEVLOG.md`](docs/DEVLOG.md); current state + roadmap in [`implementation_plan.md`](implementation_plan.md).

## Run a farm — the desktop app (recommended, zero setup)

The easiest way to host a farm is the **[LlmOnLan Farm app](farm-app/)** — a downloadable,
self-updating installer that turns a GPU box into a running farm with **no terminal and no
prerequisites**. On first launch a wizard downloads its own Ollama + Python, pulls
**gemma4:12b**, builds the service venvs, and starts the farm; from then on the window IS the
farm's **admin panel**. Targets **Windows + NVIDIA**, **macOS Apple Silicon (≥16 GB)**, and the
**NVIDIA DGX Spark** (linux arm64). See [`farm-app/README.md`](farm-app/README.md).

## Quick start (farm operator, CLI)

Prefer the terminal? The `lol` CLI is the same farm the app manages:

```bash
cd farm
npm install
node bin/lol.js init           # scaffold lol.config.json
node bin/lol.js up             # ensure Ollama, generate+run LiteLLM, start the beacon
node bin/lol.js status         # health of hosts + proxy + loaded models
```

Prereqs: [Ollama](https://ollama.com) and [LiteLLM](https://docs.litellm.ai) installed on the GPU
box(es) (or `lol install` sets them up). See [`farm/README.md`](farm/README.md).

## Quick start (client, dev)

```bash
cd shell
npm install
npm run dev                    # boots the shell + OWUI sidecar, loads it in a webview
```

See [`shell/README.md`](shell/README.md) and [`sidecar/README.md`](sidecar/README.md).

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
[BlenderMCP](https://github.com/ahujasid/blender-mcp) server and registers it with Open WebUI through OWUI's
own supported API (`POST /api/v1/configs/tool_servers`, the call the admin UI's *verify & save* makes — not
the `TOOL_SERVER_CONNECTIONS` env var, which OWUI doesn't reliably surface). Nothing is exposed to the
network and OWUI is never modified. **You only enable the toggle and set up Blender.** (A farm operator can
also **recommend** Blender to the whole fleet from the admin panel — clients that never made an explicit
choice then enable it automatically.)

**Topology:** Blender + the LOL client run on the **user's own machine**; the GPU farm is unchanged, and
each person controls their own Blender.

### Set up Blender (your side, once)

1. Turn the feature on: Settings (⚙) → **Assistant tools** → check **Blender tools**.
2. Install the **BlenderMCP** add‑on — from [github.com/ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp)
   download the add‑on `.py`, then in Blender go **Edit ▸ Preferences ▸ Add‑ons ▸ Install…**, pick the file, and tick it on.
3. In the 3D viewport press **N** → open the **BlenderMCP** tab → **Connect / Start MCP Server**.
4. In the chat, ask e.g. *“add a red cube and a sun lamp,”* or *“what's in the current scene?”*

That's it — the client already wired Open WebUI to the tools. Blender must be **open with the server
started** for a tool call to succeed; otherwise the tools still show but a call replies that it can't reach
Blender (harmless — start Blender and retry). The **first time you enable Blender tools** the client
installs a small local helper (~1 min, needs internet); after that it starts instantly.

**Port:** the add‑on uses a socket port (default **9876**, shown in its panel). If yours differs, set the
same number in Settings (⚙) → **Assistant tools** → **Blender port** — a mismatch is the usual cause of
"could not connect."

To turn the feature back **off**: Settings (⚙) → **Assistant tools** → uncheck **Blender tools** (your
explicit choice always wins over a farm recommendation).

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
