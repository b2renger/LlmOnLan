# Getting started with LlmOnLan

LlmOnLan has **two pieces**:

- **The farm** — the `lol` CLI running on one or more **GPU boxes**. It serves the model(s) over the LAN and (optionally) hosts shared **web search** and **neural voice**, and it **broadcasts itself** so clients find it automatically.
- **The client app** — a desktop app (bundled, unmodified Open WebUI) that people install on their laptops. It **auto-discovers the farm** on the same network — no URL, no config — and keeps all chat data on their own machine.

You set up the farm once per GPU box, and everyone else just installs the client app.

---

## 0. Clone the repo

You only need the repo on the **GPU box(es)** (to run the farm). Client users install a prebuilt app — they don't clone anything.

```bash
git clone https://github.com/b2renger/LlmOnLan.git
cd LlmOnLan
```

---

## 1. Set up a farm (on a GPU box)

### Prerequisites
- **[Node.js ≥ 20](https://nodejs.org)** (LTS).
- **[Python 3.10–3.12](https://python.org)** (for the LiteLLM proxy, and — if you enable them — web search / voice). On Windows, `py -3.12` should work after install.
- **[git](https://git-scm.com)** (you already used it to clone).
- **[Ollama](https://ollama.com)** and **LiteLLM** are installed **for you** by the next step.

### Bootstrap (one command)

```powershell
cd farm
./install.ps1          # Windows  (macOS/Linux: ./install.sh)
```

This installs the CLI's Node deps, then runs `lol install`, which:
- installs **Ollama** (winget on Windows / brew on macOS / the official script on Linux),
- creates a local Python venv with **LiteLLM**,
- **pulls the default model** (`gemma4:12b`) — this can be several GB on first run,
- sets up **shared web search** (SearXNG) — **on by default**, so every client that connects gets web search with zero setup.

So a fresh install already gives you a working farm with the model downloaded and web search ready — no config editing required. (Neural **voice** is the one extra you opt into — see below — because its install is multi-GB.)

> Prefer the CLI directly? `node bin/lol.js install` does the same. `npm link` in `farm/` puts `lol` on your PATH so it's just `lol install`.

### Configure (optional but recommended)

The defaults already give you a working farm (model + web search). `lol install` scaffolds a **`farm/lol.config.json`** (see [`lol.config.example.json`](../farm/lol.config.example.json) for the shape) — edit it only if you want to change the defaults. The interesting knobs:

```jsonc
{
  "name": "Studio Farm",                 // shown in the client
  "modelAlias": "assistant",             // clients see ONE stable model id; swap the real model
                                         //   underneath anytime without breaking existing chats
  "models": [ { "id": "gemma4:12b", "default": true },
              { "id": "qwen2.5-coder:14b", "alias": "coder" } ],  // per-model role name
  "websearch": { "enabled": true, "port": 8888 },   // ON by default → web search on every client
                                                    //   (set enabled:false to turn it off)
  "tts":       { "enabled": true, "port": 8880, "voice": "af_heart", "model": "kokoro" }, // opt-in neural voice
  "ollama":    { "hosts": ["http://127.0.0.1:11434"], "numParallel": 2, "keepAlive": "-1" },
  "coordinator": false                   // for multi-box: aggregate LAN peers behind one endpoint
}
```

**Web search is on by default** — turn it off with `"websearch": { "enabled": false }` (or `lol up --no-websearch`). **Voice (TTS) is off by default** because its install is multi-GB; enable it with `"tts": { "enabled": true }`. See the full reference in [`farm/README.md`](../farm/README.md).

### Run it

```powershell
./run.ps1              # = `lol up`  (foreground; Ctrl-C stops)
```

On start, `lol up`:
1. ensures Ollama is up,
2. **prompts you to pick which installed model(s) to serve** (press Enter for the default; or `lol up --model gemma4:12b --no-pick` to skip the prompt),
3. generates + runs the **LiteLLM proxy**,
4. if enabled, **installs (first run) and starts SearXNG + Kokoro voice**,
5. starts the **discovery beacon** so clients find it.

> **First run of web search / voice installs them.** SearXNG is small. **Kokoro voice pulls a multi-GB PyTorch build** — expect a few minutes the first time (it auto-detects your GPU: 4070/4090/Blackwell all work, and it falls back to CPU). Everything is auxiliary — if an install fails, the farm still comes up without that feature.

### Verify

```bash
lol status     # Ollama + proxy + loaded model health
lol fleet      # every farm on the LAN (this box + peers): load, VRAM, model, search/voice
```

When it's up you'll see the OpenAI endpoint (`http://<box-ip>:4000/v1`) and, if enabled, the search/voice URLs.

> **Firewall:** the first time the farm (and SearXNG/Kokoro) binds to the network, Windows may prompt to allow it — **allow it** so clients can reach it.

---

## 2. Install the client app (on each laptop)

### Option A — download the installer (for everyone)

Go to **[the latest release](https://github.com/b2renger/LlmOnLan/releases/latest)** and grab the small installer for your OS:

- **Windows** — `LlmOnLan-Setup-<version>.exe`. SmartScreen may warn on first download → **More info → Run anyway**.
- **macOS** — `LlmOnLan-<version>-arm64.dmg` (Apple Silicon). First launch: **right-click → Open → Open** (unsigned-app bypass).
- **Linux** — `LlmOnLan-<version>.AppImage` → `chmod +x` then run. On Ubuntu/Mint you may need `sudo apt install libfuse2`.

On **first launch** the app downloads the chat engine (Open WebUI, ~700 MB) once, then **auto-discovers your farm** on the LAN and drops you into a chat. It **auto-updates** itself from GitHub Releases after that.

### Option B — run from source (for developers)

```bash
cd shell
npm install
npm run dev            # builds + launches the app against the discovered farm
```

---

## 3. Using it

- **Model** — pick it in the top-left dropdown. With a `modelAlias` set, everyone sees a stable name (e.g. `assistant`) that keeps working even when you swap the underlying model.
- **Web search** — if the farm hosts it, it's **on by default**; just ask something current and it searches + cites pages.
- **Voice** — click the microphone to talk (allow the mic prompt the first time). Speech-to-text runs **on your laptop** (Whisper); read-aloud uses the farm's **Kokoro** neural voice if enabled, otherwise your OS voices.
- All your chats, uploads, and documents stay **on your machine**.

---

## Control Blender from the chat (on by default)

The assistant can drive **Blender running on your own machine** (create objects, run scripts, inspect the
scene). This is **on by default and configured for you** — the client runs a local helper and registers it
with Open WebUI automatically. **You only set up Blender.**

**In Blender (your side, once):**
1. Install the **BlenderMCP** add-on (from [github.com/ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) — download the add-on `.py`, then Blender ▸ Edit ▸ Preferences ▸ Add-ons ▸ Install, and tick it on).
2. Open its panel: in the 3D viewport press **N** ▸ the **BlenderMCP** tab ▸ **Connect / Start MCP Server**.
3. In the chat, ask something like *“add a red cube and a sun lamp.”*

**Notes:**
- The **first client launch** installs a small local helper (~1 min, needs internet); after that it's instant.
- It only works while **Blender is open with the MCP server started** — otherwise the tools are listed but a call returns a "can't reach Blender" message.
- **Port:** the add-on talks on a socket port (default **9876**, shown in its panel). If yours shows a different number, set the same value in Settings (⚙) ▸ **Assistant tools** ▸ **Blender port** — a mismatch here is the usual cause of "could not connect."
- **Test connection** (Settings ▸ Assistant tools) checks both hops at once: the local helper, and whether Blender is actually listening on the port. Use it to tell "helper not up" from "Blender not started / wrong port."
- Use a model that's **good at tool calling** (e.g. a Qwen or Llama tool-tuned model). `gemma4:12b` is weak at tools, so results will be hit-or-miss with it. In OWUI, if the model chats but never calls a tool, set its **Function Calling** mode to **Native**.
- **Privacy & safety:** the tool server runs on **localhost only** (never exposed to the LAN) and the Blender helper's telemetry is turned **off**. It can run arbitrary Python inside Blender, so treat it like any automation on your own scene.
- Don't use Blender? Turn it off in Settings (⚙) ▸ **Assistant tools** ▸ uncheck **Blender tools**.

## 4. Multiple GPU boxes (a first look)

Run the farm on each box and clients spread across them automatically:

- **Simplest:** `lol up` on every GPU box → each broadcasts itself; clients pick the **least-loaded** one.
- **One endpoint:** run `lol up --coordinator` on one box → it aggregates the others behind a single balanced endpoint that clients prefer.
- **One farm, many GPUs:** list every box in `ollama.hosts` on a single farm → LiteLLM load-balances across them.

`lol fleet` shows the whole LAN. Sizing rule: one Ollama serves `numParallel` (default 2) chats at once — use `lol bench --users N` to measure a box before a workshop.

---

## 5. If a client can't find the farm

- **Same Wi-Fi/LAN?** Discovery is automatic. Give it a few seconds after the farm starts.
- **Managed / school Wi-Fi** often blocks broadcast. The client also **sweeps the subnet** for the farm, and you can **add it by IP**: client **⚙ Settings → add the farm's `<box-ip>`**. (Confirm reachability first: `curl http://<box-ip>:4000/v1/models` from the laptop.)
- **Different subnets** only work if the network routes between them — otherwise put the boxes and clients on one LAN.

---

For the design rationale, the full config reference, and the development history, see [`README.md`](../README.md), [`farm/README.md`](../farm/README.md), [`implementation_plan.md`](../implementation_plan.md), and [`docs/DEVLOG.md`](DEVLOG.md).
