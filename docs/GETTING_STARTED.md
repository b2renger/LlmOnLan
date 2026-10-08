# Getting started with LlmOnLan

LlmOnLan has **two pieces**:

- **The farm** — the `lol` CLI (or the Farm app) running on one or more **GPU boxes**. It serves the model(s) over the LAN — through **Ollama** by default (`gemma4:12b` with its full **262k context**, vision included), the opt-in **llama.cpp** speed engine, or **vLLM** for many people at once on a big NVIDIA card (Windows with WSL, or Linux such as a DGX Spark; installed and run by the farm), all chosen in the farm's panel — hosts shared **web search**, **document OCR** and **document search** (and, opt-in, **neural voice**), and **broadcasts itself** so clients find it automatically.
- **The client app** — a desktop app (bundled, unmodified Open WebUI) that people install on their laptops. It **auto-discovers the farm** on the same network — no URL, no config — and keeps all chat data on their own machine.

You set up the farm once per GPU box, and everyone else just installs the client app.

---

## 1. Set up a farm (on a GPU box) — pick a route

|  | **Route A — the Farm app** | **Route B — the `lol` CLI** |
|---|---|---|
| For | anyone; no terminal, no prerequisites | operators comfortable in a terminal |
| Gets you | a running farm + the admin panel in a window | the same farm, driven directly |
| **Required if you want to** | — | — (the Farm app's window is the admin panel: model, picker and capacity are all there) |

### First-run download (both routes)

| What | Size |
|---|---|
| `gemma4:12b` — the chat model everyone gets (vision included; also drives OCR) | ~8 GB |
| The staged `preinstall` model + its draft module (on by default) | ~8.6 GB |
| LiteLLM / SearXNG / OCR venvs | ~1 GB |
| **Total, one time** | **~18 GB, 20–30 min** on a normal office line |
| *Only if you enable the llama.cpp engine:* its build + CUDA runtime + `.gguf` weights | *+~10 GB, fetched at enable time* |
| *Only if you choose vLLM in the panel (Windows with WSL, or Linux such as a DGX Spark):* vLLM and its GPU libraries, then the model you pick | *~8 GB + the model, about 45 min, when you press Install vLLM* |

Everything is cached afterwards.

**Want to skip the staged ~8.6 GB?** It's a model kept ready for the admin panel to start on demand —
nothing else uses it. Removing it means scaffolding the config *before* installing, which only Route B
can do (Route A writes its config and installs in one unattended pass):

```bash
cd farm && npm install
node bin/lol.js init          # writes farm/lol.config.json
# edit it: "preinstall": []
./install.ps1                 # macOS/Linux: ./install.sh
```

### Route A — the Farm app (recommended)

Download the newest **`farm-v…`** build from **[the releases page](https://github.com/b2renger/LlmOnLan/releases)**.

> **Look past the top of the page.** Farm builds are published as **pre-releases**, so they are *not*
> the big "Latest" box — scroll to the newest entry tagged `farm-v…`.

- **Windows + NVIDIA** — `LlmOnLan-Farm-Setup-<version>.exe`
- **macOS Apple Silicon** (≥ 16 GB) — `LlmOnLan-Farm-<version>-arm64.dmg`
- **NVIDIA DGX Spark / Linux arm64** — `LlmOnLan-Farm-<version>-arm64.AppImage`
- **Linux x64** — no Farm app build: use Route B (the `lol` CLI).

Run it and follow the wizard; leave the window open — that *is* the farm. Full details:
[`farm-app/README.md`](../farm-app/README.md).

> **The first run downloads ~18 GB** (see the table above) **plus its own Python/Ollama runtime**. The screen
> narrates each step and shows download percentages. **Do not press "Start the farm" while a download
> is running** — that kills it and starts the download over.

Then jump to **[§4](#4-a-room-full-of-people-capacity--multiple-gpu-boxes)** if a group will use it —
the default (gemma4 on Ollama) serves **two people at a time** per box, and that number is a control
in the panel (*Backend* ▸ **People served at once**).

### Route B — the `lol` CLI

Clone the repo on the **GPU box** (client users install a prebuilt app — they don't clone anything):

```bash
git clone https://github.com/b2renger/LlmOnLan.git
cd LlmOnLan
```

#### Prerequisites (Route B)
- **[Node.js ≥ 20](https://nodejs.org)** (LTS).
- **[Python 3.10–3.13](https://python.org)** — for the LiteLLM proxy (3.9 is enough for it alone), the **default-on** web search and document OCR (these need 3.10+), and (if you enable it) voice. `lol install` will **not** install Python for you. On Windows, `py -3.12` works after installing Python.
- **[git](https://git-scm.com)** (you already used it to clone).
- **[Ollama](https://ollama.com)** and **LiteLLM** are installed **for you** by the next step — and the **llama.cpp** backend too, only if you enable it.
- **GPU:** the shipped defaults target an **NVIDIA card with ≥ 12 GB VRAM**. The llama.cpp bootstrap is automatic on **Windows x64 + NVIDIA** and on the **DGX Spark** (linux-arm64 — our CI publishes the binary). Anywhere else the farm serves via **Ollama automatically** (no config edit needed); installing llama.cpp yourself and setting `llamacpp.binDir` re-enables the fast engine.

### Bootstrap (one command)

```powershell
cd farm
./install.ps1          # Windows  (macOS/Linux: ./install.sh)
```

This installs the CLI's Node deps, then runs `lol install`, which:
- installs **Ollama** (winget on Windows / brew on macOS / the official script on Linux),
- creates a local Python venv with **LiteLLM**,
- **pulls the Ollama models** in your config (`gemma4:12b` by default — the model everyone chats with) — several GB on first run,
- **fetches the llama.cpp backend** *only if you enabled it* (`llamacpp.enabled: true`) — the pinned
  `llama-server` build + CUDA runtime + `.gguf` weights — so the first `lol up` doesn't stall on it,
- sets up **shared web search** (SearXNG) — **on by default**, so every client that connects can search the web with zero setup (off in each chat until the globe button turns it on),
- sets up **shared document OCR** — **on by default**: scanned PDFs and photographed documents become readable + searchable in every client's chat (a small torch-free Python service that reuses the vision model you already serve),
- sets up **document search** — **on when the computer has an NVIDIA GPU**: the farm turns the text of the laptops' documents into numbers Open WebUI can search, in any language (EmbeddingGemma 2 on llama.cpp, about 0.6 GB to download and 1.2 GB of GPU memory). The laptops keep what comes back; the farm keeps nothing.

So a fresh install already gives you a working farm with the model downloaded and web search + document OCR ready — no config editing required. (Neural **voice** is the one extra you opt into — see below — because its install is multi-GB.)

> Prefer the CLI directly? `node bin/lol.js install` does the same. `npm link` in `farm/` puts `lol` on your PATH so it's just `lol install`.

### Configure (optional: the panel does it once the farm runs)

The defaults already give you a working farm (model + web search). Change them in the farm panel (§5), not in a file: the engine (Ollama, llama.cpp or vLLM), the name users see, people served at once, the context window, the password, the Ollama catalog and the plugins are all there, and the panel writes `farm/lol.config.json` for you (the plugin switches last until the farm restarts). The keys below are the developer reference, for what the panel does not have (ports, several Ollama hosts, coordinator mode); every key is in [`farm/README.md`](../farm/README.md#config--lolconfigjson):

```jsonc
{
  "name": "Studio Farm",                 // shown in the client
  "llamacpp": {                          // the OPT-IN speed engine (off by default —
    "enabled": true,                     //   the default farm serves gemma4:12b on Ollama at 262k context)
    "alias": "assistant",                //   the name users see — rename it to anything you like
    "model": "https://…/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-UD-IQ2_S.gguf",
    "contextLength": "auto",             //   DEFAULT: the largest that fits this GPU (a number pins it); one pool shared by the slots below (kvUnified)
    "parallel": 1                        //   how many people it answers at once — see §4
  },
  "modelAlias": null,                    // stable id for the default OLLAMA model (used when
                                         //   llamacpp is disabled); swap the model underneath freely
  "models": [ { "id": "gemma4:12b", "default": true },          // the Ollama catalog — standby (not in the
              { "id": "qwen2.5-coder:14b", "alias": "coder" } ],  //   picker) while llamacpp serves; alias = role name
  "websearch": { "enabled": true, "port": 8888 },   // ON by default → every client can search the web
                                                    //   (set enabled:false to turn it off)
  "tts":       { "enabled": false, "port": 8880, "voice": "af_heart", "model": "kokoro" }, // set true to opt in
  "ocr":       { "enabled": true, "port": 8890 },   // ON by default → scanned docs/images readable on every client
  "embed":     { "enabled": "auto", "port": 8894 }, // document search: "auto" = on with an NVIDIA GPU
  "ollama":    { "hosts": ["http://127.0.0.1:11434"], "numParallel": 2, "keepAlive": "-1",
                 "contextLength": "auto" },         // window for the OLLAMA models — probed per box (a number pins it).
                                                    //   Measured: 65536 spills on a 12 GB card —
                                                    //   raise it on a big-VRAM box
  "coordinator": false                   // for multi-box: aggregate LAN peers behind one endpoint
}
```

**Web search and document OCR are on by default** on the farm, and **document search** too when it has an NVIDIA GPU (each chat still starts with web search off; the globe button turns it on) — turn any of them on or off in the panel's *Plugins* card (**Enable** / **Disable**); the panel keeps that until the farm restarts (to keep a plugin on or off for good, a developer sets it in the file). **Voice (TTS) is off by default** because its install is multi-GB; turn it on the same way. See the full reference in [`farm/README.md`](../farm/README.md).

### Run it

```powershell
./run.ps1              # = `lol up`  (foreground; Ctrl-C stops)
```

On start, `lol up`:
1. ensures Ollama is up,
2. **prompts you to pick which installed Ollama model(s) to serve** (press Enter for the default; or `lol up --model gemma4:12b --no-pick` to skip the prompt),
3. if llama.cpp is the engine, starts **`llama-server`** (downloading the backend + weights if `lol install` didn't already); if vLLM is, keeps a vLLM already running with the same settings or starts it ("Starting vLLM" in the panel, about 2 minutes, once the farm is up); else sizes the Ollama context,
4. generates + runs the **LiteLLM proxy** that fronts the serving engine as one endpoint (behind the farm's seat gate),
5. if enabled, **installs (first run) and starts SearXNG + document OCR + Kokoro voice**; document search starts before step 3 when it is already downloaded (so the engine sizes its memory around it), else here,
6. starts the **discovery beacon** so clients find it.

> **First run of web search / voice installs them.** SearXNG is small. **Kokoro voice pulls a multi-GB PyTorch build** — expect a few minutes the first time (it auto-detects your GPU: 4070/4090/Blackwell all work, and it falls back to CPU). Everything is auxiliary — if an install fails, the farm still comes up without that feature.

### Verify

```bash
lol status     # Ollama + proxy + loaded model health
lol fleet      # every farm on the LAN (this box + peers): load, VRAM, model, search/voice
```

When it's up you'll see the OpenAI endpoint (`http://<box-ip>:4000/v1`) and, if enabled, the search/voice URLs.
Clients auto-select the farm's default model — `gemma4:12b` on the default Ollama engine (or its alias
if you set one); with llama.cpp enabled, `llamacpp.alias` (`assistant`) is the only model they see (one
engine at a time; the Ollama catalog is standby). Confirm what's actually served with
`curl http://<box-ip>:4000/v1/models`.

The banner also prints the **admin panel** URL — `http://<box-ip>:41997/lol/admin` — plus an access
**token** (regenerated each run; set a fixed one with `"admin": { "token": "…" }` in `lol.config.json`).
From any browser on the LAN, that panel is where the farm is run: which **engine** serves (Ollama,
llama.cpp or vLLM, which the panel installs and starts itself) and which model it loads, the **name users
see**, **how many people** it serves at once, the **context window**, the farm **password**, the **Ollama
catalog** (download / offer / delete), the web search / OCR / document search / voice **plugins**, and who is **connected** right
now. **Plan capacity ↗** (open without the token, at `/lol/capacity`) says which hardware and model serve how
many people. Everything except the plugin toggles and the Blender recommendation is kept for the next start.

§5 walks through the common changes.
> **Firewall:** the first time the farm (and SearXNG/Kokoro) binds to the network, Windows may prompt to allow it — **allow it** so clients can reach it.

---

## 2. Install the client app (on each laptop)

### Option A — download the installer (for everyone)

Go to **[the latest release](https://github.com/b2renger/LlmOnLan/releases/latest)** and grab the small installer for your OS:

- **Windows** — `LlmOnLan-Setup-<version>-windows-x64.exe` (SmartScreen: **More info → Run anyway**).
- **macOS** — `LlmOnLan-<version>-mac-arm64.dmg` (Apple Silicon) or `…-mac-x64.dmg` (Intel, macOS 14+). First launch: **right-click → Open → Open** (unsigned-app bypass).
- **Linux** — `LlmOnLan-<version>-linux-x64.AppImage` (or `-linux-arm64`, e.g. DGX Spark) → `chmod +x`; Ubuntu/Mint may need `sudo apt install libfuse2`.

On **first launch** the app downloads the chat engine (Open WebUI, ~700 MB, from GitHub) once. Then it **auto-discovers your farm** on the LAN and drops you into a chat. A farm with **document search** (the first farm update after farm-v0.0.43 brings it; on by default with an NVIDIA GPU) indexes your documents, so nothing more is downloaded for them. On an older farm, Open WebUI's first start downloads its own search model instead (about 92 MB, from huggingface.co); if huggingface.co does not answer (no internet, or a network that blocks it), chat still opens, and a message says document uploads need one start with internet access: quit and reopen the app once the computer is online. It **auto-updates** itself from GitHub Releases after that.

### Option B — run from source (for developers)

```bash
cd shell
npm install
npm run dev            # builds + launches the app against the discovered farm
```

Two prerequisites the app will otherwise error on: the **OWUI sidecar venv** must exist
(`sidecar/.venv` — see [`sidecar/`](../sidecar/)), and `ELECTRON_RUN_AS_NODE` must be **unset**
(some shells export it, which makes Electron run as plain Node and die on `app.setName`). Pin a farm
with `LOL_ENDPOINT=http://<box-ip>:4000/v1` if discovery isn't available.

---

## 3. Using it

- **Model** — pick it in the top-left dropdown. It's preselected for you: everyone lands on the farm's
  model, shown under the name the operator chose in the farm panel (`gemma4:12b` by default;
  `assistant` on a llama.cpp or vLLM farm). That name is a stable id, so the operator can swap the
  checkpoint underneath without breaking your existing chats.
- **Three surfaces** — the topbar switch picks **Open WebUI** (documents, RAG, web search, voice,
  history), **LOL Vibe** (a fast chat straight to the farm; no documents — and its **IDE**, below) or the
  **Computer** (boxes wired into small programs: data, pictures, the microphone and webcam, sound, boards and
  lights — [the tutorial](LOLCHAT_COMPUTER_TUTORIAL.md), and the Learn shelf inside it); the app remembers your
  last choice.
- **The connection pill** (top bar) shows the farm and its free seats (`· 2/3 free`), and how many messages
  are queued at the model when the farm reports it (`· 12 waiting`: a new message waits its turn, so its first
  word is slow). Amber means wait — connecting, every seat busy, messages queued, the farm not responding, or
  a password needed; red means a problem on the server. Click it for **Servers on your network**: one card per farm (seats, engine and model, plugins,
  **Manage this farm ↗** for the operator's panel), the password field of a protected farm, add‑by‑address
  and Rescan. **Clicking a card pins that farm**; the **Automatic — least busy farm** row above the cards
  lets the app choose again.
- **Web search** — if the farm hosts it, it's **off by default; the globe button turns it on for a chat** (in Open WebUI 0.11: **Integrations** under the message box ▸ **Web Search**). Then ask something current and it searches + cites pages.
- **Today's date** — in Open WebUI, the model is told the date by your system prompt (Settings ▸ General ▸ **System Prompt**), which goes with every message; without it, it assumes an older year. If that prompt is empty, the first launch writes `Today is {{CURRENT_WEEKDAY}} {{CURRENT_DATE}}.` there, once; it is yours to edit or empty, and the app never touches it again. If you wrote your own prompt, add `{{CURRENT_DATE}}` to it.
- **Voice** — click the microphone to talk (allow the mic prompt the first time). Speech-to-text runs **on your laptop** (Whisper; its first use downloads the model, about 150 MB, from huggingface.co, so it needs internet access once); read-aloud uses the farm's **Kokoro** neural voice if enabled, otherwise your OS voices.
- **Documents** — attach a PDF or a photo of a document and ask about it. Scanned pages and images are OCR'd by the farm's vision model; on farms with a large context window (≥ 24k tokens per chat) answers read the whole document; on smaller ones, the 8 most relevant passages. On a farm with **document search**, the farm reads each document for search, in any language (ask in English about a French document), and your laptop keeps the result. The first time a laptop meets such a farm, its documents switch to that model for good, and the app says once how to bring older documents along: in Open WebUI, **Admin Panel ▸ Settings ▸ Documents ▸ Reindex** (next to "Reindex Knowledge and Memory Vectors"); a file attached straight to an older chat is simply attached again. After that, on a farm without document search, uploading a document fails (with a message saying why) rather than mixing two models, and chat works. On an older farm, before any switch, uploads need the search model on your laptop (about 92 MB, downloaded once at a start with internet access); until it is there, the app says so when it opens, and chat works without it.
- **Where your data lives** — everything sits in one folder on **your** machine (by default
  `…/LlmOnLan/owui-data` in your user app‑data; Settings ⚙ ▸ **Data location** shows it and can move
  it): Open WebUI's chats, documents and RAG vectors; LOL Vibe's conversations and the Computer's graphs
  with the pictures, PDFs and sounds in them (in its `lol-client` subfolder — the app's own local
  database, so they don't appear in Open WebUI); and the files the Computer's File boxes write
  (`LOL Studio Projects`). Changing the folder restarts the app: **Move my data** carries all of it,
  **Start fresh** leaves the old folder as it was. Updating from v0.1.x copies your LOL Vibe history
  into that folder once, on the first launch, and keeps the old copy in the app's user-data folder as a
  backup. With farm OCR on, an uploaded file's bytes go to the trusted‑LAN farm for text
  extraction, and with document search, the document's text goes there to be turned into the numbers
  search uses, which come back to your laptop; the farm keeps nothing of either.
- **LOL Vibe** — reopens your last chat on launch. Each reply shows tok/s and time to first token.
  A message's icons (hover one to see what it does): **Regenerate**, **Regenerate with…** (**More creative** /
  **More precise**), **Edit**, **Fork from here**, **Delete from here**, **Keep in context** (always sent, even
  when older turns no longer fit); ◀ ▶ walk a reply's versions; **Continue** picks up a reply that was cut
  short. The chat header sets a **System prompt** for this chat. The meter beside **Send** shows how much of
  what the model can read at once this chat fills (click it for the details). On a full farm the reply waits
  for a seat (**Try now** / **Cancel**) instead of failing.
  Keys: **Esc** stops a reply (or cancels a seat wait), **↑** in an empty box edits your last
  message (**Ctrl+Enter** saves the edit), **Alt+← / Alt+→** walk the last reply's versions,
  **Ctrl+Shift+O** (⌘⇧O) starts a new chat. **LOL Vibe › Settings** holds Storage (space used, **Export
  all chats**, **Import chats…** — `.json` / `.lolchat.json`, new ids, up to 512 MB), the send‑cost gate
  (**Ask before sending more than N tokens**), **Tell me when a long reply is done**, and About; each
  chat's … menu exports Markdown or `.lolchat.json`.
- **LOL Vibe's IDE** — a chat's **Project** button ties it to a project folder: a coding agent (DeepSeek Harness,
  thinking with the farm's model) writes and edits the files as you ask, and the panel shows the **Preview**, the
  **Code**, the **Changes** and the **History** (go back to any version). A project can be shared read-only on the
  LAN, or pushed to GitHub. The agent is a one-time ~120 MB install from the panel; it only touches files inside its
  project. **Ctrl+1** opens or closes the panel. See [LOLVIBE_IDE_GUIDE.md](LOLVIBE_IDE_GUIDE.md).
- **Closing the window quits** — the app asks "Quit LlmOnLan?" first, then stops the chat engine; your seat on
  the farm frees once it has been idle a while. Reopening takes about 12 seconds while Open WebUI starts again
  (about 30 the first time after the computer restarts). If it is much slower, send the operator `boot.log` from
  the app's logs folder (Windows: `%APPDATA%\LlmOnLan\logs`; macOS: `~/Library/Application Support/LlmOnLan/logs`;
  Linux: `~/.config/LlmOnLan/logs`): it lists each step of the start with the seconds since launch.
- **Updates** — the app updates itself (Settings ▸ Startup & updates). The chat engine is separate:
  Settings ▸ About ▸ **Check for chat‑engine update** downloads a newer Open WebUI, applied on the next
  launch (**Restart to apply**).
- **No login, by design** — the chat surface is single‑user with authentication off, because the data is
  already local and per‑machine. Anyone who can use the laptop can read its chats: on a **shared**
  machine, use separate OS accounts.
- **Web search is off by default; the globe button turns it on for a chat.** With it on, a message costs
  the farm about as much work as with it off, but the first word comes a few seconds later (a search
  takes about 2 s) and the model reads a few thousand more tokens of search results per chat. It stays
  off by default until it has been checked with a whole class searching from one school network. To have
  it on in every chat, pick **Always** in Open WebUI's own settings (Interface ▸ **Web Search in
  Chat**); the client keeps your choice.
  Clients up to v0.2.7 turned it on for every chat; the first launch of a newer one switches that back
  off once, and only if you had not changed it.

---

## Control Blender from the chat (opt-in)

The assistant can drive **Blender running on your own machine** (create objects, run scripts, inspect the
scene). This is **opt-in, off by default**: turn it on in Settings (⚙) ▸ **Assistant tools** ▸ check
**Blender tools**, and the client configures everything else automatically — it runs a local helper and
registers it with Open WebUI for you. (A farm admin can also **recommend** it to the whole fleet from the
admin panel; clients that never made an explicit choice then enable it automatically.)

**In Blender (your side, once):**
1. Install the **BlenderMCP** add-on (from [github.com/ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) — download the add-on `.py`, then Blender ▸ Edit ▸ Preferences ▸ Add-ons ▸ Install, and tick it on).
2. Open its panel: in the 3D viewport press **N** ▸ the **BlenderMCP** tab ▸ **Connect / Start MCP Server**.
3. In the chat, ask something like *“add a red cube and a sun lamp.”*

**Notes:**
- **Enabling Blender tools the first time** installs a small local helper (~1 min, needs internet); after that it's instant.
- It only works while **Blender is open with the MCP server started** — otherwise the tools are listed but a call returns a "can't reach Blender" message.
- **Port:** the add-on talks on a socket port (default **9876**, shown in its panel). If yours shows a different number, set the same value in Settings (⚙) ▸ **Assistant tools** ▸ **Blender port** — a mismatch here is the usual cause of "could not connect."
- **Test connection** (Settings ▸ Assistant tools) checks both hops at once: the local helper, and whether Blender is actually listening on the port. Use it to tell "helper not up" from "Blender not started / wrong port."
- Use a model that's **good at tool calling** (e.g. a Qwen or Llama tool-tuned model). `gemma4:12b` is weak at tools, so results will be hit-or-miss with it. OWUI defaults to **Native** tool calling; if the model chats but never calls a tool, try switching **Function Calling** to **Legacy** (Chat Controls → Advanced Params) — some models served via Ollama need the prompt-based path.
- **Privacy & safety:** the tool server runs on **localhost only** (never exposed to the LAN) and the Blender helper's telemetry is turned **off**. It can run arbitrary Python inside Blender, so treat it like any automation on your own scene.
- Changed your mind? Uncheck **Blender tools** in the same place — your explicit choice always wins over a farm recommendation.

## 4. A room full of people (capacity) & multiple GPU boxes

> ### Serving a group? Check one setting first.
> Out of the box the farm (gemma4 on Ollama) answers **two requests at a time**; raise it in the panel
> (*Backend* ▸ **People served at once**; on Ollama it applies after a farm restart). On llama.cpp the
> default is 1, and the slots share one context pool: a person alone gets the whole window. On a big NVIDIA
> card (an RTX PRO 6000, a DGX Spark), pick **vLLM** in the panel: it serves many people at once (48 at 64k on a
> PRO 6000, 8 on a Spark, measured), and *Automatic* sets how many. See
> [farm/README.md ▸ vLLM, run by the farm](../farm/README.md#vllm-run-by-the-farm). When every seat is taken, a
> new question gets a clear "all seats in use" until someone has been idle 15 min (*Backend* ▸ **Free an idle
> seat after**; 2 min suits a workshop). **Plan capacity ↗** at the top of the panel says which hardware and
> model serve how many people.

**How many people can one box serve at once?** As many requests as it has slots — `ollama.numParallel`
(2) per box on Ollama, `llamacpp.parallel` (1) on llama.cpp. With one slot, the second person's
question waits for the first answer to finish; throughput is fine, but their *time to first token* is
however long that answer takes.

**`parallel` is simultaneous *requests*, not people.** In a class, people read, type and think at
different moments, so a room of 12 rarely has more than a handful of answers generating at once —
`parallel: 4` serves a workshop far better than the number of students suggests. Someone who already
holds a seat waits for a free slot; a newcomer only gets "all seats in use" when every seat is held.

On the llama.cpp engine, shapes that fit (VRAM totals for the shipped quant):

| People in the room | Card | Setting | Uses |
|---|---|---|---|
| 1–2 | 12 GB | People served at once **2**, Context window **32k** | ~10.2 GB |
| 3–6 | 16 GB | People served at once **4**, Context window **64k** | ~12.6 GB |
| 6–12 | 24 GB+ | People served at once **8**, Context window **128k** | ~17.4 GB |
| 12+ | 24 GB+ | People served at once **8** **and a second GPU box** (see below), or vLLM on a big card — or accept short queues at busy moments | |

> **⚠ On a 12 GB card, document uploads and the chat model compete.** Those figures are the chat model
> alone. Document OCR is **on by default** and loads a *second* model — `gemma4:12b`, ~7.6 GB — onto the
> same GPU the moment someone uploads an image or a scanned PDF. On 12 GB the two do not fit, and the
> box tips into CPU offload: everything gets ~5–10× slower and stays that way (this is
> [§7 cause 2](#7-if-its-slow)). Pick one before the workshop:
>
> - **turn OCR off on this box** — the panel's *Plugins* card ▸ Document OCR ▸ **Disable** (no scanned-document reading; it comes back when the farm restarts);
> - **give OCR a smaller vision model** — not in the panel yet: a developer sets `ocr.model` ([`farm/README.md`](../farm/README.md));
> - **run OCR on a second box**;
> - **or use a ≥ 16 GB card**, where both fit comfortably.
>
> Full reference: [`farm/README.md` ▸ Multiple users & capacity](../farm/README.md#multiple-users--capacity).

On llama.cpp the slots **share one context pool** (`kvUnified`, the default): a person alone gets the
whole window, and under full contention each is guaranteed the context window ÷ people served at once. So
for a group, set **both** in the panel (*Backend* ▸ **People served at once** and **Context window**, then one
**Apply changes**): for example 2 people and 32k gives 2 busy people 16k each, which fits 12 GB.

…and check it still fits VRAM — the whole KV cache is allocated at load. Rough budget for the shipped
quant: ~7.8 GB of weights plus **~1.2 GB per 16k** of total `contextLength`, so 4 × 16k (`parallel: 4,
contextLength: 65536`) needs a **16 GB** card, and 8 × 16k needs 24 GB. Remember farm OCR loads a second
(vision) model on the same GPU when someone uploads a document. Then **measure instead of guessing**:

```bash
lol bench --users 8 --rounds 3     # first-token latency p50/p95 + tokens/s under real concurrency
```

There are **no accounts to manage**: every client is a single-user app that keeps its own chats and
documents locally, so "multi-user" here is purely a capacity question — how many people the box can
answer at once, which you set in the panel (*Backend* ▸ **People served at once**).

Both ends show how full a box is. The panel's **Clients** card reads *"N of M seats in use"* and lists
who is on (hostname, app version, idle time); each farm card in the desktop client shows the free
seats (and how many are connected, when that differs), in amber once every seat is taken. When every
seat is taken, a new question gets a clear "all seats in use" until someone has been idle 15 min — so
the next person can pick a different box. Full reference:
[`farm/README.md` ▸ Multiple users & capacity](../farm/README.md#multiple-users--capacity).

**More GPU boxes** — run the farm on each and clients spread across them automatically:

- **Simplest:** the Farm app on every GPU box, with Settings ▸ **Share compute with the network** on → each broadcasts itself; clients pick the **least-loaded** one. (Route B: `lol up` on each.)
- **One endpoint:** run `lol up --coordinator` on one box → it aggregates the others behind a single balanced endpoint that clients prefer.
- **One farm, many GPUs:** list every box in `ollama.hosts` on a single farm → LiteLLM load-balances the **Ollama** models across them. (`llama-server` is per-box: each farm runs its own.)

`lol fleet` shows the whole LAN, and one Ollama serves `numParallel` (default 2) generations per host.

---

## 5. Change the model, the name, or the capacity

All of this lives in **one place**: the farm panel. In the Farm app that is the main window; from any
other machine on the LAN it's `http://<box-ip>:41997/lol/admin` with the token the farm printed. Changes
apply live *and* are remembered across restarts.

The panel opens on a **Backend** card that answers the two questions that used to need a config file:
what users' model is called, and which engine is behind it.

**Rename what users see.** On llama.cpp or vLLM: *Backend* ▸ **Name users see** → type e.g. `Studio Assistant`
→ Apply changes. On Ollama: the **Rename** button on the model's row.
Because the name *is* the model id that clients request, renaming takes a few seconds and chats started
under the old name will ask their user to re-pick the model; new chats are unaffected.

**Name each model.** Every model in *Models · Ollama* is offered under its **checkpoint name**
(e.g. `gemma4:12b`) until you press its **Rename** button — give each one whatever people should see
(`tutor`, `coder`, …); empty puts the checkpoint name back. Duplicates are refused (the name is the id
clients request).

**Swap the model everyone gets.** On the default Ollama engine: *Models · Ollama* ▸ **Download a model**
if it is not there yet, then its **Make default** (the ★ one is what clients auto-select). While
llama.cpp serves, the *Model · llama.cpp* card (shown only then) ▸ pick an entry and press **Use
this**. To serve something not in the list, paste a `.gguf` link into **Add a model** first — on
Hugging Face that is the file's *download* link (`…/resolve/main/….gguf`), not the page you were
reading. The first **Use this** on a new model downloads several GB and shows progress; afterwards it
is cached and switching back is quick. On llama.cpp the alias stays the same, so existing chats keep
working.

If the weights don't load, **the farm goes back to the model that was working** and says why. The two
usual causes:

- **`mmproj` must match the new model family** — it's the vision projector. A library entry carries the
  right one; for a hand-pasted URL, take it from the same repo as the weights or leave it empty for a
  text-only model.
- **MTP only works on `UD-Q2_K_XL`-or-above quants.** Below that Unsloth strips the head the feature
  needs and llama-server refuses to start. Picking a library entry handles this for you.
  See [the quant rule](../farm/README.md#backends--ollama-default-and-llamacpp).

**Switch engine.** *Backend* ▸ the engine buttons: **Ollama**, **llama.cpp** and **vLLM** (a fourth, *External
server*, appears only when a developer set one up). **One engine serves at a time**: llama.cpp serves its one
model as fast as the hardware can, for a few people; vLLM serves one model to many people at once on a big NVIDIA
card (Windows with WSL, or Linux such as a DGX Spark; its button checks this computer first, and its card installs
vLLM and its models, about 45 minutes the first time); Ollama serves the catalog below it, so people can choose
between several models. The others go **standby** — invisible to clients; in the panel the *Models ·
Ollama* card carries a *standby* badge while llama.cpp or vLLM serves, and the *Model · llama.cpp* card is
hidden while Ollama serves. A name you gave the model (**Rename** / **Name users see**) survives the
switch, so existing chats keep working; an unnamed default is served under its raw id on Ollama
(`gemma4:12b`) and under the engine's own name (`assistant`) on llama.cpp and vLLM, so name the model first if
chats should survive a switch. About a minute for Ollama or llama.cpp, about 2 minutes for vLLM (longer the very
first time). While it runs, every client shows "*switching…*"
instead of an error.

**Context window.** On Ollama and llama.cpp, leave it on **Automatic** (the default): each box serves
the largest context it holds for the current model — on llama.cpp with the shipped Qwen quant a 12 GB
card lands around 36k, a 16 GB card near 78k, the Spark gets the model's full native window. On the
Ollama engine the farm *measures* instead of computing (it loads the model at 16k and at 32k, aims at
what the VRAM holds, verifies that with one more load — halving once if it spilled to system RAM —
and remembers the answer; e.g. gemma4:12b probes straight to its native 262k on a big card). Pick a
number only to trade context for more slots. On vLLM the row is **Context per person**, a number (64k by
default, at most what the model reads; a longer one fits fewer people), and there **People served at once** and
**GPU memory for conversations** are Automatic; **Plan capacity ↗** shows what each choice serves.

**Attachments follow the context.** Clients read the farm's per-chat window from the beacon: with
**24k or more** they inject attached documents *whole* (best answers); under that they fall back to
classic top-passages retrieval so a big attachment can never overflow the model and error out.
More context on the farm = better document answers on every client, automatically.

**Password-protect the farm.** *Backend* ▸ **Farm password** → Apply. Every client then asks for
it once (with a 🔒 on the farm card) and remembers it. **Remove** (next to the field) takes it off. Details:
[`farm/README.md` ▸ Password-protecting a farm](../farm/README.md#password-protecting-a-farm).

**Serve more people at once.** *Backend* ▸ **People served at once** (on Ollama: per box, applied after
a farm restart). On llama.cpp the slots share one context pool; the panel shows the guaranteed share per
person. On vLLM, *Automatic* takes the number measured on this card, or what its memory holds; Apply asks first
when a change would restart vLLM (about 2 minutes without chat). Raise the context window alongside it if you need both — and check it still fits VRAM:
[`farm/README.md` ▸ Multiple users & capacity](../farm/README.md#multiple-users--capacity).

**Manage the Ollama catalog.** *Models · Ollama* ▸ **Download a model** → an Ollama tag such as
`qwen2.5-coder:14b`. These serve (and appear in users’ pickers) **when Ollama is the selected
engine**; while llama.cpp or vLLM is the engine the card reads *standby*. **Delete** removes one from the box.
(Developers: the CLI path is in [`farm/README.md` ▸ Adding or changing models](../farm/README.md#adding-or-changing-models).)

> **Everything above is in the panel; you never need to edit a file.** From another computer, open
> `http://<box-ip>:41997/lol/admin` (with **Share compute** on) and paste the token from the Farm app's Settings
> (**Panel access token**). Developers: the panel writes `farm/lol.config.json`, documented key by key in
> [`farm/README.md`](../farm/README.md).

---

## 6. If a client can't find the farm

- **Farm app?** It is private until the operator turns on Settings ▸ **Share compute with the network**.
- **Same Wi-Fi/LAN?** Discovery is automatic. Give it a few seconds after the farm starts.
- **Managed / school Wi-Fi** often blocks broadcast. The client also **sweeps the subnet** for the farm, and you can **add it by address**: click the connection pill ▸ **Servers on your network** and add the farm's `<box-ip>` there, or use Settings ⚙ ▸ **Connection** ▸ **Add by address**. (To check the laptop can reach it, open `http://<box-ip>:41997/lol/self` in a browser: a page of text about the farm means it answers.)
- **Different subnets** only work if the network routes between them — otherwise put the boxes and clients on one LAN — or set Settings ▸ Connection ▸ **Search range** to cover the farm's subnet (unicast crosses subnets that block broadcast).

---

## 7. If it's slow

Work down this list — the first two causes account for most reports.

1. **Several people at once, few slots** (Ollama default 2 per box, llama.cpp default 1): the rest
   queue, or get "all seats in use" once every seat is held. This looks exactly like "the model is
   slow" but the tokens/s of any single answer is normal. Fix: [§4](#4-a-room-full-of-people-capacity--multiple-gpu-boxes).
2. **The model spilled to the CPU.** If the weights + KV cache don't fit VRAM, llama.cpp runs part of
   the model on the CPU and throughput collapses (think 5–10× slower, and it never recovers on its own).
   Usual causes: the **Context window** raised too far, **People served at once** raised without checking
   VRAM, or a bigger model swapped in. Look at the panel's **This box** card: if VRAM is full and the GPU
   is *not* busy, that's the signature. Fix: lower the **Context window** (or set it back to Automatic), or pick a smaller model.
3. **Something else is on the GPU.** Farm OCR loads a *second* (vision) model on Ollama whenever
   someone uploads an image or scanned PDF, and a browser or a game will take VRAM too. Watch it during
   a slow moment: `lol status` and the admin panel both show what's loaded.
4. **Web search is on in that chat.** It is off by default; the globe button turns it on for a chat,
   and then the model may search, read pages and search again before it answers, so the first word
   comes a few seconds later (about 2 s per search). If replies are slow to *start* but fast once they
   begin, turn the globe off and compare. (Clients up to v0.2.7 turned it on for every chat; a newer one switches that back off.)
5. **A big document is attached.** Whole-document mode sends the entire text with every message, so a
   long PDF makes every turn in that chat slower. Start a new chat when you're done with it.
6. **Measure it** rather than guessing — on the farm box:
   ```bash
   lol bench --users 4 --rounds 3     # first-token latency p50/p95 + tokens/s
   ```
   Compare a single-user run (`--users 1`) with a concurrent one: if single-user is fine and
   concurrent is not, it's cause 1; if both are slow, it's cause 2 or 3.

---

## Known rough edges (v1)

Four behaviors the v1 acceptance audit chose to ship **documented** rather than blocked on:

- **A very slow first install can show an error over a working farm.** The wizard gives up after
  5 silent minutes but keeps the bootstrap running; if it then finishes, the running screen is fine
  but the wizard's error stays. On a slow connection: wait it out or restart the app — clicking
  **Retry** there bounces a farm that may already be serving (~1–2 min of downtime).
- **After the operator changes the farm password**, already-connected clients keep a green pill while
  their chats fail, until each person re-enters the password on the farm's card (click the pill →
  the farm list). The app forgets the stale password by itself; it just can't know the new one.
- **A hiccuping farm can log a client out of its password** (the client treats "the farm answered
  but not OK" as "wrong password"). Re-entering the same password fixes it.
- **One password per farm.** A fleet of separately-passworded farms means entering each box's
  password by hand, and a coordinator skips passworded peers. To keep automatic spreading on a
  passworded fleet, run it as ONE farm (all boxes in `ollama.hosts`, one password) or
  coordinator + open peers on a trusted LAN.

## Glossary

Terms that show up in the config and in this guide.

| Term | What it means here |
|---|---|
| **GGUF** | The single-file format the chat model ships in (`llamacpp.model` points at one). |
| **quant**(isation) | A compressed version of a model — smaller and faster, slightly less accurate. `UD-IQ2_S`, `UD-Q2_K_XL` etc. are Unsloth's quants of the same model, listed smallest-first. Which one you use decides both VRAM and whether `mtp` works. |
| **context window** (`contextLength`, `num_ctx`) | How much text the model can consider at once — your question, the conversation so far, and any attached document. Bigger = longer documents, more VRAM. |
| **KV cache** | The memory the model uses to hold that context while generating. It's allocated **in full when the model loads**, which is why the context window costs VRAM even on an idle farm. |
| **slot** (`parallel`) | One generation the server runs at a time. llama.cpp slots share one context pool by default (`kvUnified`). |
| **alias** | The model name clients see. The default Ollama farm serves `gemma4:12b` with no alias (clients see the raw id); `assistant` is the default alias on llama.cpp and vLLM. It's a stable stand-in for the real checkpoint, so you can swap the model underneath without breaking chats. |
| **`mmproj`** | The "vision projector" file that lets a model read images. Must come from the same repo as the weights. |
| **`ngl`** | How many model layers go on the GPU. `999` = all of them; anything less spills to CPU and is dramatically slower. |
| **MTP** (`mtp`) | Speculative decoding — the model drafts several tokens then checks them, which is faster. Only works on quants that still carry the extra "head" it needs (`UD-Q2_K_XL` and above). |
| **TTFT** | Time to first token — how long you wait before the answer starts appearing. |
| **beacon** | The small UDP broadcast the farm sends so clients find it with no URL typed. |
| **coordinator** | A farm started with `--coordinator` that fronts the other farms on the LAN behind one endpoint clients prefer. |

---

For the design rationale, the full config reference, and the development history, see [`README.md`](../README.md), [`farm/README.md`](../farm/README.md), [`implementation_plan.md`](../implementation_plan.md), and [`docs/DEVLOG.md`](DEVLOG.md).
