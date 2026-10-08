# `lol` — the LlmOnLan farm CLI

A small Node CLI that turns one declarative `lol.config.json` into a running, LAN‑discoverable
inference farm. It brings up one inference engine at a time — **[Ollama](https://ollama.com)** (the multi‑model
catalog, and the **default** — serving `gemma4:12b` at its native 262k context out of the box),
**[llama.cpp](https://github.com/ggml-org/llama.cpp)** (`llama-server`, one model, fastest for a few people)
or **[vLLM](https://docs.vllm.ai)** (many people at once on a big NVIDIA GPU, installed and run by the farm) —
**generates** a [LiteLLM](https://docs.litellm.ai) proxy config that fronts it as one OpenAI‑compatible,
load‑balanced endpoint, runs the proxy, and broadcasts a UDP discovery beacon so clients find it with
no URL typed. The engine and the model are chosen in the admin panel, which writes them to the config;
the CLI never hand‑edits routing.

> **New to the engines?** Read [Backends](#backends--ollama-default-and-llamacpp) first, then
> [vLLM, run by the farm](#vllm-run-by-the-farm) for a big NVIDIA GPU. They decide where you add a model
> and what a client actually gets.

> **Not comfortable in a terminal?** The **[LlmOnLan Farm app](../farm-app/)** is a downloadable
> installer for Windows x64, macOS on Apple Silicon and Linux arm64 (the DGX Spark). There is no Linux x64
> build: a Linux x64 box runs this CLI. The app runs this exact CLI for you — it downloads its own Ollama + Python, fetches the
> backend + weights, and gives you the admin panel, with zero prerequisites. (**Unlike the client it
> does not update itself** — it shows a notice and a Download button; check it after each client
> release.) This README is for driving
> the farm directly (or understanding what the app does under the hood). The app sets `$LOL_PYTHON`
> so the venv builds below use its bundled interpreter, and `$LOL_FARM_VERSION` so the farm advertises
> the app's release (a bare CLI checkout advertises `farm/package.json`). Before every start it also
> moves SearXNG / OCR off a taken port (8888 / 8890 — JupyterLab's 8888 is common on a DGX) by patching
> `websearch.port` / `ocr.port` in its `lol.config.json`; clients follow, since the port rides the beacon.

## Quick start (fresh pull) — two commands

On a GPU box with a fresh checkout you need **[Node ≥ 20](https://nodejs.org)** and
**[Python 3.10–3.13](https://python.org)** (3.9 is enough for the LiteLLM proxy alone; the default-on web
search and OCR need 3.10+) — `lol install` builds the LiteLLM proxy into a venv but will
**not** install Python for you (without it the bootstrap stops at *"Bootstrap incomplete"* and the farm
has no proxy). Everything else — Ollama, LiteLLM, the models, web search and OCR (and the llama.cpp
backend, only when enabled) — one command installs; one runs the farm.

**Windows (PowerShell):**
```powershell
cd farm
./install.ps1     # node deps + `lol install`: installs Ollama (winget) + LiteLLM, pulls models
./run.ps1         # = `lol up` — starts the farm in the foreground (Ctrl-C stops)
```

**macOS / Linux:**
```bash
cd farm
./install.sh      # node deps + `lol install`: installs Ollama (brew / official script) + LiteLLM, pulls models
./run.sh          # = `lol up`
```

That's it — the farm is now serving an OpenAI‑compatible endpoint and broadcasting itself on the LAN, so
the desktop clients auto‑discover it. To change which models are served, open the admin panel
(`http://<box>:41997/lol/admin`, token in the `lol up` banner): see
[Adding or changing models](#adding-or-changing-models). Editing `models` in
[`lol.config.json`](lol.config.example.json) (or `lol models add <id>` then `lol up --no-pick`) also works, over SSH.

> Prefer to drive the CLI directly? `node bin/lol.js install` then `node bin/lol.js up` do the same
> (and `npm link` puts `lol` on your PATH so it's just `lol install` / `lol up`).

### What `lol install` sets up

| Piece | How | Skipped if already present |
|---|---|---|
| **Ollama** | Windows → `winget install Ollama.Ollama`; macOS → `brew install ollama`; Linux → the official `install.sh`. | CLI on PATH **or** a local daemon answering. |
| **LiteLLM** | A local `farm/.venv` (your Python 3.9–3.13) with `litellm[proxy]==1.97.0` (pinned — the version the farm is tested with) + the required fastapi bound. The farm auto‑uses this venv — no config edit. | `farm/.venv` already has `litellm`. |
| **Config** | Scaffolds `farm/lol.config.json` from the defaults (named after this host) if none exists. | A config is already there. |
| **Models** | Pulls every model in `models` **and `preinstall`** on the local Ollama (over its HTTP API), derives `source` models with their `params`, and fetches any `draft` module. | Model already pulled. (`lol up` also pulls anything missing.) |
| **Web search + OCR** | Builds the SearXNG and document-OCR venvs (both default-on) so the first `lol up` starts instantly. Non-fatal: `lol up` retries. | Already installed. |
| **llama.cpp backend** | Only when `llamacpp.enabled`: downloads the pinned `llama-server` build + CUDA runtime into `farm/.llamacpp/` and the `.gguf` weights + vision projector into `farm/.models/` (several GB). Non‑fatal: `lol up` retries. | Build marker matches **and** the weights are cached. |

If an auto‑installer isn't available (no winget/brew/curl, or no Python), `lol install` prints the exact
manual step and you re‑run it — it's **idempotent**, so re‑running only does what's left.

## Manual setup (alternative to `lol install`)

The pieces `lol install` automates, done by hand:

| Tool | Why | Install |
|---|---|---|
| **Ollama** | Serves the models. One instance per GPU box. | https://ollama.com |
| **LiteLLM** | The OpenAI‑compatible proxy that load‑balances + fails over across boxes. | `pip install "litellm[proxy]==1.97.0" "fastapi>=0.136.3,<0.140.7"` (Python 3.9–3.13; a venv is fine — drop it at `farm/.venv` and the farm finds it, or point `litellm.command` at it). **The fastapi bound is mandatory** — outside it the proxy dies at startup with `ImportError: cannot import name 'get_flat_dependant'` and the farm never comes up. |
| **Node ≥ 20** | Runs this CLI. | https://nodejs.org |

```bash
cd farm
npm install
# optional: link `lol` onto your PATH
npm link        # then just `lol <cmd>` anywhere
```

> The CLI **spawns and supervises** Ollama + LiteLLM; it does not reimplement them.

## Commands

| Command | Does |
|---|---|
| `lol install` / `setup` | One‑time bootstrap: install Ollama + LiteLLM, pull every `models` + `preinstall` entry, set up shared web search (SearXNG) + document OCR (both on by default), and — only when `llamacpp.enabled` — fetch the llama.cpp build + weights. Idempotent. |
| `lol init [--force]` | Scaffold a `lol.config.json` in the current directory. |
| `lol up` / `lol serve` | Ensure Ollama, **pick the Ollama model(s) to serve** (interactive, from what's installed; Enter = default), pull anything missing, start `llama-server` if enabled (fetching build + weights on first run), generate + run the LiteLLM proxy behind the seat gate, start SearXNG + OCR (if enabled) + the beacon + the admin panel, then (vLLM) start or keep vLLM as a job. Foreground; Ctrl‑C stops (vLLM too). |
| `lol down` | Stop the proxy + `llama-server` + SearXNG + TTS + OCR + beacon (and any Ollama this CLI started), and the vLLM the farm runs (from the runtime file, or the config when that file is gone). |
| `lol status` | Health of each Ollama host + the proxy + which models are loaded. Works from any shell. It does not report vLLM or llama.cpp: the panel's Backend card does. |
| `lol fleet` | Every farm on the LAN (this box + peers): health, GPU load, VRAM, loaded models, roles, search URL. |
| `lol bench` | Load‑test before a workshop: N concurrent chats → first‑token latency (p50/p95) + tokens/s, and how many the seat gate turned away. `--users N --rounds R --model id --url … --people --cancel F --out file.json` (see [Multiple users & capacity](#multiple-users--capacity)). |
| `lol models ls` | List configured models + presence on each host. |
| `lol models add <id>` / `rm <id>` | Edit the served catalog, then run **`lol up --no-pick`** — on the OLLAMA engine, plain `lol up` prompts and pressing Enter serves only the default, dropping what you just added (with llama.cpp serving there is no prompt: the catalog is standby). There is no alias flag: to give the model a stable role name, add `"alias": "…"` to its entry in `models` by hand. |
| `lol models pull` | Pull every configured model on every host. |

**`lol up` flags:** `--model <id[=alias][,…]>` (also `-m`, `--model=…`) serve exactly these (no prompt;
pulls if missing) · `--no-pick` (also `--yes`, `-y`) skip the prompt, use the config catalog · `--alias <name>` / `--no-alias` override the global
model alias · `--coordinator` aggregate LAN peer farms into one balanced endpoint (clients prefer it) ·
`--websearch` / `--no-websearch` override the SearXNG toggle · `--tts` / `--no-tts` override the Kokoro
voice toggle (off by default) · `--ocr` / `--no-ocr` override the document‑OCR toggle (on by default).

## Backends — Ollama (default) and llama.cpp

A farm knows **three** built-in engines — Ollama, llama.cpp (this section) and
[vLLM](#vllm-run-by-the-farm), each switched to from the panel — plus an [`external`](#config--lolconfigjson)
server a developer configures (SGLang, TensorRT-LLM, another machine), and serves through **one at a time**.
Knowing which one is serving is the thing to understand before changing models or sizing for a group.

| Computer | Ollama | llama.cpp | vLLM |
|---|---|---|---|
| Windows x64 + NVIDIA (Farm app) | yes | yes, downloaded by the farm | inside WSL2, on a card of about 35 GB or more (25 GB with document reading off, but the panel's Plugins switch lasts only until the farm restarts): an RTX PRO 6000 or PRO 5000, not an RTX 4070, 4080 or 4090 |
| DGX Spark, Linux arm64 (Farm app) | yes | yes, this repository's build | yes: 8 people at 64k on Qwen3.6 |
| Linux x64 + NVIDIA (this CLI only, no Farm app) | yes | only with a llama-server you build (`llamacpp.binDir`) | yes, with the same size rule |
| macOS, Apple Silicon (Farm app) | yes | no ready-made build (`llamacpp.binDir`) | no |

The panel says the same on each engine's button, in plain words.

| | **llama.cpp** (`llama-server`) | **Ollama** |
|---|---|---|
| On by default | no — opt-in (`llamacpp.enabled: true`) | **yes — the default engine** (gemma4:12b at its native 262k context) |
| Serves | **exactly one** model — `llamacpp.model`, a `.gguf` URL | every entry in `models` — **only while it is the selected engine** |
| Client-facing name | `llamacpp.alias` (default `assistant`) | each model's `alias`, else its raw id |
| Visible to clients? | **yes** — the only model, while it is the engine | only when Ollama is the engine — otherwise **standby** (not routed, not advertised) |
| Why it exists | explicit KV-cache quantization + flash attention, so a good quant stays fully GPU-resident on a 12 GB card (Ollama spills there) | multi-model catalog, load balancing across boxes, the OCR vision model |

Both live behind the same LiteLLM proxy, but **one engine serves at a time**: while llama.cpp is the
engine, its alias is the only model routed or advertised, and the Ollama catalog is **standby** —
installed and ready for an engine switch, and used internally by document OCR (which talks raw Ollama,
never the proxy). Two engines advertising at once read as "both are running", and on a 12 GB card a
client picking an Ollama model next to a resident llama-server overcommitted VRAM and crawled. A
**name you gave the model** (**Rename** / **Name users see**) **survives an engine switch and a
fallback** (`carryNameAcross`), so bound chats keep working: switching to llama.cpp makes the Ollama
default's served name (its own **Rename**, else `modelAlias`) the `llamacpp.alias`; switching back
writes `llamacpp.alias` onto the default's own name if it has one, else into `modelAlias`. An
**unnamed** default is served under its raw id on Ollama (`gemma4:12b`) and under `llamacpp.alias`
(`assistant`) on llama.cpp — a raw checkpoint id is never carried — so chats bound to it re-pick after
a switch (and a switch back names it `llamacpp.alias` via `modelAlias`); name the model first if chats
should survive a switch. The other catalog models are never served under llama.cpp. A fallback gives
an unnamed Ollama default the failed engine's alias **for that run only** (never written to the file).

**A reachable Ollama is required even when llama.cpp, vLLM or an external server serves.** `lol up` exits
with *"No reachable Ollama host"* if none answers: Ollama is the fallback engine, and document OCR
drives its vision model there. With another engine serving, a farm-started Ollama keeps models warm
for only 5 minutes, and **pressure eviction** unloads Ollama models when VRAM is ≥ 92 % full and the
GPU ≤ 20 % busy (never mid-extraction) — the farm log says so, and on llama.cpp or vLLM (the farm's own, or an external one)
so does the panel's Performance card.

**If llama.cpp cannot start, the farm does not die.** No prebuilt exists for this platform (prebuilts
cover win-x64 and linux-arm64/the Spark today), the download failed, the weights would not load:
`lol up` logs the reason, **falls back to the Ollama engine for the run**, and the panel shows why on
the Backend card. The config keeps `llamacpp.enabled`, so a later boot (or a `binDir` pointing at a
hand-built llama.cpp) picks the fast engine back up. **A crash mid-run** (OOM, driver reset) gets one
automatic restart; a second crash within 5 minutes falls back to Ollama the same way (the panel reason
reads *"llama-server crashed twice in 5 minutes"*). In both windows the beacon flips the farm unhealthy
at once, so clients fail over instead of chatting into a dead port.

**What `lol up` bootstraps for it** (automatic on win-x64 with NVIDIA **and on the DGX Spark** —
linux-arm64 has no upstream prebuilt, so our own CI builds one and the farm downloads it from this
repo's `llamacpp-<build>` release; nothing to compile, no Docker): the pinned `llama-server` build
plus the matching CUDA runtime into `farm/.llamacpp/`, then the weights + vision projector into
`farm/.models/`. That is a **multi-GB first run** — `lol install` pre-fetches it so `lol up` doesn't
stall on it later. On any other platform, install llama.cpp yourself and point `llamacpp.binDir` at the
folder holding `llama-server`; the farm says so rather than failing obscurely.

**Which one is running, and switching between them.** The admin panel
(`http://<box>:41997/lol/admin`, and the Farm app's own window) opens on a **Backend** card that
names the model users see, the engine behind it, the actual `.gguf` or Ollama tag, and how many
people it serves at once. The engines are buttons (Ollama, llama.cpp, vLLM); picking another one stops the
current engine, loads the model and regenerates the routing, in about a minute (about 2 for vLLM). It is also written to `lol.config.json`, so it
survives a restart.

Clients see the same thing from the outside: each farm card in the desktop app shows
`llama.cpp · Qwen3.8-27B-UD-IQ2_S` under the farm name, so a user can tell two boxes apart without
asking anyone.

**From the config** — `"llamacpp": { "enabled": false }`. Ollama then serves everything, and the
default model is named by its own `alias` (the panel's **Rename**), else the global `modelAlias` (not
`llamacpp.alias`).

> **Quant ↔ `mtp` rule.** `mtp: true` adds `--spec-type draft-mtp` (speculative decoding via the GGUF's
> built-in MTP head). Unsloth **strips that head** from every quant below `UD-Q2_K_XL`, and llama-server
> then exits with *"model doesn't contain MTP layers"* — a loud failure we deliberately don't paper over.
> The shipped default quant (`UD-IQ2_S`) is one of those, so `mtp` defaults to **false**. Turn it on only
> together with a `UD-Q2_K_XL`-or-above `model`.

## vLLM, run by the farm

On a big NVIDIA card, vLLM serves far more people than llama.cpp. On the studio's RTX PRO 6000 (96 GB), the spike
([docs/spike/RESULTS.md](../docs/spike/RESULTS.md)) measured Qwen3.6-35B-A3B NVFP4 on vLLM at **96–128 people at
32k of context each, 48–64 at 64k and 32–40 at 128k**, where the best llama.cpp configuration served 4–8 at 32k;
a DGX Spark serves 8 at 64k. Since 2026-10-07 vLLM is the farm's third built-in engine (the owner: "I want the farm
operator to be able to do everything from the app. No config file etc."): the farm installs it, starts it, sizes
it, watches it and stops it, and the operator does all of it from the panel. The design, with its decisions, is
[docs/VLLM_MANAGED_PLAN.md](../docs/VLLM_MANAGED_PLAN.md). The farm drives the scripts in `farm/vllm/`
(`serve.sh`, `stop.sh`, `install.sh`, `status.sh`); it does not re-implement them.

**Where it runs:** Windows x64 inside WSL2 (Ubuntu), and Linux x86_64 or arm64 (the DGX Spark), with an NVIDIA GPU
and its driver (on Windows, the Windows driver serves WSL too). Not on a Mac. The panel's **vLLM** button checks
this computer and says what is missing, in plain words:
- **WSL** is installed by an administrator, once: `wsl --install -d Ubuntu` in an administrator PowerShell, a
  restart, then Ubuntu opened once from the Start menu to choose a user name. The panel says exactly that; it has
  no button that asks for administrator rights (the owner's question (d), 2026-10-07).
- WSL 2 (not 1), the GPU visible inside it, a 64-bit processor, `curl`, a C compiler (`sudo apt install
  build-essential`: vLLM builds a small GPU launcher with it at every start, and a fresh Ubuntu in WSL has none),
  and free disk: about 10 GB for vLLM and the model's size. On Windows the free disk is the smaller of WSL's own (a
  virtual disk that reports up to 1 TB) and the Windows drive that holds it. Install, Update and Download check it
  before they start, and leave 10 GB free beside what they fetch: WSL's disk grows on drive C: and never gives the
  space back.
- A card no model of the list fits is refused, with llama.cpp or Ollama named as its engine: the smallest model's
  weights, ~4 GB of vLLM's own, 8 % of the card, 1 GB for conversations, and the 9 GB kept for document reading
  while that is on (`vllm.ocrReserveGib`) must fit an empty card: about 35 GB with document reading, 25 GB
  without. So the studio's RTX 4070 (12 GB), 4080 (16 GB) and a 4090 (24 GB) never get an Install or a start;
  a 32 GB card fits only with document reading off, and the panel says so. On Windows the size Windows itself
  sees comes first, before anything about WSL, and so does a PC with no NVIDIA GPU at all. A card older than
  compute capability 12.0 (Blackwell) gets a warning: the list's NVFP4 checkpoints were measured on Blackwell only.

**Install vLLM** (the vLLM card) runs `install.sh` into the vLLM folder (`vllm.root`, default `~/lol-vllm`; an
existing install in `~/lol-vllm` or `~/lol-spike` is used as it is): `uv` if missing (user-local, no sudo), a
Python 3.12 environment of uv's own, vLLM 0.30.0 and its GPU libraries (about 8 GB), the CUDA compiler packages
FlashInfer's kernel build needs, a GPU check, then the chosen model. About 45 minutes on a typical connection. It
runs in the farm's **download slot**: the farm keeps serving meanwhile, clients do not see it as busy, and Stop
keeps what was fetched (Install again continues). An install refuses while vLLM runs from that folder. At its
time limit (6 hours) the farm stops `install.sh`'s whole process group, its download included (killing only its
own child left `hf` downloading on Linux). A download's meter is its folder on disk, which Hugging Face's
downloader fills in large pieces, late: the bar says so and shows how long it has run, so a number that sits low
for minutes and then jumps does not read as stuck. `lol install` does not install vLLM.

**The models** are a list in the vLLM card: the three NVFP4 checkpoints the spike measured, with the flags it ran
them with.

| Model | Sees images | Measured |
|---|---|---|
| Qwen3.6 35B-A3B (the default) | yes | 48 people at 64k on an RTX PRO 6000, 8 on a DGX Spark |
| Nemotron 3.5 Lightning 30B-A3B | no | 160 at 32k on an RTX PRO 6000, 16 on a DGX Spark |
| Qwen3.8 27B | yes | 16 at 32k on an RTX PRO 6000; too slow on a Spark |

**Download** fetches one once vLLM is installed (in the download slot, while vLLM serves another; it uses vLLM's own
`hf`), **Use this** serves it (vLLM restarts
with it), **Remove** takes it off the list and, asked again, deletes its files. **Add a model** takes a Hugging
Face name or link (`owner/name`) and gives it its family's flags (Qwen3.5/3.6, Qwen3.8, Nemotron, other Qwen3);
a model of no known family gets prefix caching only, and the panel says tools and thinking may not show. Folders
already in `<root>/hf` show as "Also on this computer", with **Add to the list**.

**Switching engines.** The Backend card's buttons are Ollama, llama.cpp and vLLM (and "External server" only while
the file holds an [`external`](#config--lolconfigjson) block). A switch stops the current engine first, and a stop
that fails changes nothing: two engines never share the GPU. Into vLLM it takes about 2 minutes (longer the very
first time, while it compiles kernels); out of it, about a minute. The name people see moves with the switch
(`carryNameAcross`), so open chats keep working. A switch to vLLM is refused up front, with the reason, when it is
not installed, the model is not downloaded, an install runs, or a set memory cannot hold one person's window.
While the external server is a vLLM the farm can run as it is ([Taking over](#vllm-run-by-the-farm), below), the
vLLM button is that take-over, with nothing restarted; and the External button never shows while it would point at
the port of the vLLM the farm runs. Leaving an external server on this computer says that it keeps running and
keeps its share of the GPU.

**Its settings**, under the panel's one **Apply changes** (which asks the farm first, and asks the operator only
when vLLM would restart):
- **Name users see** — renaming bounces LiteLLM only; vLLM keeps running (its own `--served-model-name` is the
  list's id).
- **People served at once** (`vllm.parallel`, the seat gate's seats). Automatic: what was measured on this card
  with this model at this context (or the nearest measured context above), never more than the memory holds;
  else what the memory holds, at most 16; else 4. A card and model nobody measured says so, with the Plan
  capacity link (the owner's question (c)).
- **Context per person** (`vllm.contextLength`, `--max-model-len`), at most what the model reads.
- **GPU memory for conversations** (`vllm.kvCacheGib`, `--kv-cache-memory-bytes`). Automatic, worked out at each
  start, once the free memory stops rising (a vLLM stopped a moment ago, by an Apply or a restart, gives its memory
  back over a few seconds): the GPU's free memory, less 8 % of the card, the model's weights, ~4 GB of vLLM's own and 9 GB kept for
  document reading (`vllm.ocrReserveGib`, when OCR is on); on a DGX Spark, from what the system has available,
  less the memory guard's 8 GB. Capped at what vLLM's request cap can use, so a small model does not take the
  card. On the PRO 6000 alone that is 52 GB; beside ComfyUI's ~45 GB, about 8 GB (then 10 people at 64k, which
  the Automatic people follow). Never `--gpu-memory-utilization`: a fraction of the card's total, and its start-up
  profiler aborts when Ollama loads a model beside it.
- vLLM's own request cap (`--max-num-seqs`) is Automatic: twice the people, as a power of 2, from 32 to 512
  (48 → 128). A new model, context, memory or request cap restarts vLLM (about 2 minutes); people at once inside
  the cap, the name and the password apply in seconds. So 48 → 40 people keeps it running, 48 → 80 restarts it
  (128 → 256).
- The farm's reply limit (`proxy.maxReplyTokens`, 32,768) becomes `--override-generation-config` (a ceiling on
  vLLM 0.30, [below](#replies-that-never-end)); changing it restarts vLLM.

The farm owns the whole `vllm serve` argv (`src/vllm.js` `planFor`, as `llamacpp.js` owns llama-server's) and hands
it to `serve.sh` in `LOL_VLLM_ARGS_B64`; `serve.sh` then adds none of its own defaults, and writes
`<root>/run/managed-by-farm` (its marker: from then on a start of `serve.sh` without the farm's argv, by the old
log-on task, `lol-vllm.service` or a hand, says so and does nothing).

**Starting and stopping.**
- The farm's boot never waits for vLLM: the proxy, the seat gate, the panel and the beacon come up in seconds, and
  vLLM starts as the job "Starting vLLM". A **planned** start (the boot, Start, a switch, an Apply, Use this)
  keeps the farm healthy and says busy, so clients keep their farm and show "Starting vLLM"; a chat sent meanwhile
  gets the gate's 503, "This farm's model is starting: about 2 minutes. Try again then." The panel shows the
  start's steps, read from vLLM's log. A start counts once `serve.sh` logged its own server ready (or `status.sh`
  says so), never because something answers on the port; and it refuses to start when another program already
  answers there ("Another program uses port …"), so chats never go to someone else's model.
- vLLM is **stopped on purpose only**: `lol down`, Ctrl-C, the Farm app's Quit and Stop (both run `lol down`
  first; the window stays up, saying "Stopping the farm…", until it is done), the panel's **Stop vLLM**, a switch,
  an Apply that restarts it. `lol down` stops only the farm's own vLLM: the one it serves with, or one its marker
  says it started; never an operator's vLLM in a folder the farm only downloaded a model into. Stop vLLM makes the farm unhealthy
  (clients go to another farm) and does not survive a farm restart: the next start starts vLLM (the owner's
  question (b)). A `lol down` that lands during a proxy bounce (a Quit in the middle of an Apply) stops the farm
  too: the farm never writes back the runtime file `lol down` removed, and a vLLM that stops once that file is gone
  is not restarted.
- A crash of `lol up` or of the Farm app leaves vLLM running, and the next `lol up` keeps it at once when it runs
  with these settings (an Automatic setting accepts what it runs with), waits for one still starting, and
  restarts one launched otherwise. A server that runs with these settings is kept even when the check of this
  computer misses something. When WSL gives no answer at all at boot (a slow log on), the start is queued instead
  of serving Ollama for the whole run: it checks again once the farm is up, keeps a server it then finds running
  with these settings, and serves with Ollama only if that check fails too. Any start that finds such a server
  ready keeps it rather than restarting it. The Farm app's **Share compute with the network** switch restarts the farm and keeps
  vLLM running. CLI note: a farm that crashed leaves vLLM running until the next `lol up` or `lol down`.
- At boot, a vLLM the farm started (its marker) that still runs while another engine is chosen (a crash in the
  middle of a switch) is stopped; one without the marker is someone else's and is left alone.
- **Watched**: three missed answers in a row (10 s each) and the farm looks before acting. Slow but answering:
  nothing. Stopped by the memory guard: stays stopped, the farm unhealthy, until the operator presses Start.
  Otherwise one restart ("Restarting vLLM after it stopped unexpectedly"); a second stop within 5 minutes falls
  back to Ollama for the run, under vLLM's name, with the reason on the panel. A start that fails falls back the
  same way; the file keeps vLLM, so the next farm start tries again. vLLM is stopped before Ollama loads anything:
  when that stop fails (something still answers on its port), the farm stays on vLLM, stopped and unhealthy, and
  says why. The watch keeps looking during the panel's other jobs (an Ollama download, a password): only a job that
  starts or stops vLLM itself pauses it.
- On a DGX Spark the memory guard (`vllm.minFreeGb`, Automatic: 8 GB where the GPU shares the system memory) and
  four compile jobs are on by themselves ([On Linux (DGX Spark)](#on-linux-dgx-spark) says why).

**Document reading beside it.** Ollama still reads documents (OCR), directly, in the memory kept for it. Beside
vLLM, the farm prefers `gemma4:12b` for it when that model is installed (beside llama.cpp or an external server it
keeps its own choice, the Ollama list's vision default); the Performance card
warns when the reading model does not fit the 9 GB kept (production's `qwen3.8:latest` would not: 17.7 GB).
Before vLLM or llama.cpp starts, Ollama's loaded models leave the GPU.

**Its files and its log.** Everything lives in the vLLM folder, inside WSL's Ubuntu on Windows: `.venv` (vLLM),
`hf/<model>` (the weights), `logs/vllm.log` (moved to `vllm.log.1` at a start once past 50 MB) and `run/` (the
process group, the socket, the marker). The panel's **Show the log** reads its last lines; it records no
conversations, but an error line can quote a few words of a reply. `lol down` from a terminal stops it too: from
the runtime file, or from the config when that file is gone.

**Taking over a vLLM you started.** A farm whose engine is an [external server](#external-a-vllm-you-run-yourself)
on this computer, started from `farm/vllm` (the recipe below), is offered **Let the farm run vLLM** on the panel
(looked for once the farm is up, and at Check again). The farm never takes it over by itself: a person clicks (the
owner's question (a)). It keeps the same model, name and settings, and restarts nothing:
- the server keeps running (the same process); LiteLLM is not restarted, its routing being the same apart from
  its key;
- `lol.config.json` is copied to `lol.config.json.before-managed-vllm`, then gets a `vllm` block (the folder, the
  port, the name, the model, the context and people the external block declared, the memory and request cap the
  server runs with, and any other flag it runs with in `vllm.extraArgs`) and loses its `external` block (a
  `llamacpp.enabled` left on is turned off: one engine on, as a switch writes it);
- `serve.sh`'s marker is written in the server's folder, so the old launchers do nothing from then on: on Windows
  the log-on task only opens the Farm app (its `serve.sh` exits 0 and `start-windows.ps1` says "The farm runs vLLM
  now"), and on Linux `lol-vllm.service` starts nothing (`sudo systemctl disable lol-vllm` removes it). No task or
  unit is changed.

It is offered only when the farm can keep the server exactly as it runs (not, for instance, a server started with
`--api-key`, or without a flag the farm would add). With nothing running on that port but the model in that
folder, it is offered too, and the farm then starts vLLM. **Undo** (on the panel, until a setting changes or the
farm restarts) puts the copy back, removes the marker and routes to the server as before; vLLM keeps running. By
hand, later: quit the Farm app (which stops vLLM), copy `lol.config.json.before-managed-vllm` over
`lol.config.json`, remove `<root>/run/managed-by-farm`, and start vLLM the old way
([docs/PRO6000_VLLM_SWITCH.md](../docs/PRO6000_VLLM_SWITCH.md), Part 2). **A farm-v0.0.42 or older refuses a file
with a `vllm` block**: put the copy back before installing an older Farm app.

**At login.** The Farm app's Launch at login starts the farm, and the farm starts vLLM (WSL boots in about 5 s,
then about 1.5 min). On Linux the app writes `~/.config/autostart/llmonlan-farm.desktop` for its AppImage, which runs only when
someone logs in to the desktop. A box nobody logs in to (a headless DGX Spark) gets no farm at boot this way,
and nothing shipped starts one there yet. Start the farm from a terminal (`node bin/lol.js up --no-pick` in a
checkout's `farm/`, after `./install.sh`) or from a systemd unit of your own; or keep the operator-run recipe there ([On Linux (DGX Spark)](#on-linux-dgx-spark), `lol-vllm.service`): do not press Let the farm run vLLM, or press Undo; the farm then starts vLLM as usual
([VLLM_MANAGED_PLAN.md](../docs/VLLM_MANAGED_PLAN.md) R4; whether a Spark logs in by itself is its §11.6, step 9).

### Why there is a relay

Under WSL2's mirrored networking (`networkingMode=mirrored` in `.wslconfig`), vLLM's
own TCP port never answers. vLLM binds its port when it starts but only listens once the model is loaded,
1.5–2.5 min later, and mirrored networking stops forwarding a port that has been bound that long without
listening. SYNs then time out from WSL, and Windows gets "connection refused", even though `ss` shows LISTEN.
A plain Python socket reproduces it with a 75 s gap; with a 12–15 s gap it works. No vLLM flag changes when
vLLM listens. So `serve.sh` runs vLLM on a Unix socket (`--uds`), and `relay.py`, which listens as soon as it
binds, carries `127.0.0.1:8100` to that socket. Each connection is closed on both sides when either side
leaves, so a person's Stop still aborts vLLM's request: streaming or not, alone or while others stream,
through the seat gate and LiteLLM (`LOL_CANCEL_ENGINE=vllm node test/litellm-cancel.js`). The relay is harmless
on native Linux.

### Thinking

Qwen3.6 thinks by default. The client turns thinking off for most of the Computer's structured
calls (lists, JSON, agent steps) with `chat_template_kwargs: {"enable_thinking": false}` and also sends
`think: false`, which vLLM ignores. LiteLLM's `drop_params` passes both through. A yes/no decision (a Condition,
a Filter) sends neither and thinks, and so does every structured call once a person ticks the Computer's
**Think all**. Chat messages and the Computer's prose and code answers never send them; Open WebUI's titles
and search queries do. Measured through the farm, one short answer took 393 completion tokens with thinking
and 14 without.

### LiteLLM's cost per streamed token

Every token a person reads passes through LiteLLM, and LiteLLM is one
Python process. Measured on the PRO 6000 on 2026-10-05: N people press Enter together, each gets a 200-token
reply, and the table gives the median time to the whole reply (p95 in brackets).

| N | vLLM alone | through the farm, before | through the farm, now |
|---|---|---|---|
| 50 | 2.1–2.2 s | 2.5–2.6 s | 2.3–2.4 s |
| 100 | 3.4–3.5 s | 4.6–5.3 s | 4.1–4.2 s |
| 140 | 4.0–4.2 s (5.2–5.3 s) | 5.2–6.6 s (7.0–8.2 s) | 4.9 s (5.5 s) |

- **Why.** Before, LiteLLM's process sat at one full core from 50 streams on. It passed on at most
  ~3,400–4,000 tokens/s, while vLLM alone made ~5,300–5,800. A py-spy profile put about half of its event
  loop's samples in the OpenAI SDK, which rebuilds every streamed chunk as typed objects, and ~15 % in
  rebuilding each whole reply once it ends. That path also makes and drops an async generator for every
  chunk, because `CustomStreamWrapper.__anext__` iterates the SDK's stream afresh each time.
- **The fix.** The route to vLLM (the farm's own, and an external server) is `hosted_vllm/`, which uses LiteLLM's own HTTP client
  and SSE parser. Through the farm, the client gets the same reasoning, images, tool calls, usage and
  thinking-off results. A person's Stop still stops vLLM on all 10 paths (`LOL_CANCEL_ENGINE=vllm`), and
  `external.apiKey` still reaches a server started with `--api-key`. One LiteLLM process now passes on
  ~5,000 tokens/s.
  - **What `hosted_vllm/` changes in a request:** it strips `strict` and `additionalProperties: false` from
    tool schemas, so a tool parameter literally named `strict` disappears. It also forwards
    `reasoning_effort` and `stream_options`, which `openai/` dropped, and vLLM refuses `stream_options` on a
    non-streaming call. No first-party client (Open WebUI 0.11.4's built-in tools, LOL Vibe, the Computer, the
    coding agent, Home Assistant) sends any of those; a third-party tool server might.
  - **llama.cpp keeps `openai/`:** it serves a handful of people at once.
  - **Coordinator peers keep `openai/` too, unmeasured.** Once a coordinator fronts a second big box (plan
    Phase 3.0), half a class streams through that peer deployment: move the vLLM route's peers to
    `hosted_vllm/` then, and measure.
- **What did not help.** LiteLLM's `--num_workers` loses connections on Windows: 12 and 21 of 100
  simultaneous streams never got an answer. Granian refuses to run several workers on Windows. With
  `hosted_vllm/`, a second LiteLLM on its own port bought only 0.2 s more at 140. On `openai/`, two
  processes landed where one `hosted_vllm/` process is, at twice the CPU. Granian with one worker changed
  nothing. The relay costs nothing: inside WSL, 140 streams through it and straight to vLLM's socket took
  the same 4.1 s.
- **What is left.** ~0.7 s at 140 people and 0.6–0.7 s at 100, with LiteLLM's one core full again. If the
  measured class sizes ever need it, the next step is for the seat gate to stream a lone vLLM deployment
  straight to vLLM. It would skip LiteLLM for `POST /v1/chat/completions` only, and only while vLLM (the farm's
  or an external one) serves with no peers. A scratch prototype matched vLLM alone (4.1 s (5.3 s) at 140, 3.6–3.7 s at 100)
  at 0.2 of a core. It is ~60 lines in `seats.js` plus a thunk from `up.js`, and it has to take over:
  - **the name:** rewrite `model` from the alias to the served model (`external.model`, the list's id), or
    start vLLM with the alias first in `--served-model-name`;
  - **the key:** send `external.apiKey` (or the farm's own) in place of the farm password;
  - **retries:** LiteLLM retries a failed call 3 times;
  - **dropped params:** under `drop_params`, LiteLLM removes what the server would refuse. vLLM ignores unknown
    fields, but the real clients' requests (Open WebUI, LOL Vibe, the coding agent) would need checking;
  - **images:** a text-only model would refuse an image instead of having it stripped.

  Auth (the gate checks the password since Phase 0.1), `/v1/models`, Stop and the gate's counts already
  live in the gate. The farm keeps no usage or spend records, so there is nothing to move there.
- **To measure it again** after a LiteLLM or vLLM bump, compare the farm with vLLM alone, on the farm box:
  `lol bench --users 140 --max-tokens 200` (through the gate) against
  `lol bench --users 140 --max-tokens 200 --url http://127.0.0.1:8100 --model <the served name>`.

### Replies that never end

Qwen3.6 on vLLM sometimes falls into a loop while it thinks ("Let's go. (Self-Correction): I'll do it.", over
and over) and never ends its reply: it writes until the 64k window is full, holding a seat for ~290 s, and
Open WebUI then shows an empty answer. On 2026-10-05 Open WebUI's real follow-ups (211 requests, saved as
sent) were replayed straight to vLLM, 2 to 8 times each, with a 32,768-token limit so a loop ended sooner:

| Sampling | Replies | Looped to the limit |
|---|---|---|
| vLLM's defaults (the model's `generation_config.json`: temperature 1.0, top_k 20, top_p 0.95) | 500 | 8 (1.6 %) |
| + `repetition_penalty: 1.05` | 422 | 1 (0.2 %) |
| + `presence_penalty: 1.0` | 633 | 0 |
| + `presence_penalty: 1.5` | 633 | 0 |

- **The cause.** Qwen's model card asks for `presence_penalty: 1.5` with thinking on, "to reduce endless
  repetitions", and nothing on the way applies it. Open WebUI sends no sampling at all, the checkpoint's
  `generation_config.json` carries only temperature, top_k and top_p, and vLLM 0.30 cannot default a presence
  penalty: its generation config takes only temperature, top_k, top_p, min_p, repetition_penalty and
  max_new_tokens. A loop is a per-reply accident, not a property of a prompt: the 8 loops came from 8
  different requests, and the requests that looped in Open WebUI looped 2 times in 72 replays.
- **The fix.** A presence penalty of 1.5 that the farm's LiteLLM adds to every request that names none (a
  request's own value wins): the vLLM list's Qwen3.6 entry carries it (`presencePenalty`), and so does an
  external server's block. 1.5 is the model card's value; 1.0 did as well here.
- **What it costs.** Nothing this set can measure. On the spike's quality set (28 items: code checked by
  tests, exact answers, tool calls) with thinking on, 83 of 84 answers passed at vLLM's defaults, 81 of 84
  with 1.5 and 54 of 56 with 1.0. A difference of one or two items is within the set's noise, and every
  setting had an answer that thought past 16k tokens. With thinking off (how the Computer asks), 28 of 28
  passed with 1.5 against 26 of 28 without. Qwen warns of "slight performance decreases" and asks for 0 on
  precise coding; the coding agent's SDK sends no presence penalty, so it gets 1.5 too (code items: 28 of 30
  with it, 29 of 30 without).
- **The backstop.** The farm starts its vLLM with a reply limit of 32,768 tokens
  (`--override-generation-config '{"max_new_tokens": 32768}'`, from `proxy.maxReplyTokens`; `serve.sh`'s own
  defaults, for a vLLM started by hand, carry the same number), so a loop that still happens holds a seat for half
  as long. On vLLM 0.30 it caps every request, not only those that
  name no `max_tokens`: a request asking 40,000 gets 32,768 (see
  [`proxy.maxReplyTokens`](#config--lolconfigjson)). If you pass your own `--override-generation-config`, it
  replaces this one: put `max_new_tokens` in yours.
- **Checked end to end** through the farm's own LiteLLM config, with vLLM started by `serve.sh`: the same
  follow-ups twice each, with no `max_tokens`. With `presencePenalty: 1.5`, 0 of 424 looped. With each request
  sending its own `presence_penalty: 0` (it wins), 6 of 424 looped and every one stopped at exactly 32,768
  tokens. The set's longest prompt, 47,117 tokens, was still answered, with what the window left. Each run sent
  428 requests: the 4 not counted are 2 prompts longer than the whole 64k window, sent twice, which vLLM
  refuses with or without a limit. In a separate check through the same stack, a 39,223-token prompt with no
  `max_tokens` was answered, and the same prompt sending `max_tokens: 32768` got vLLM's 400.

## External: a vLLM you run yourself

**For a developer, not an operator.** To serve vLLM on this computer, an operator presses the panel's **vLLM**
button ([vLLM, run by the farm](#vllm-run-by-the-farm)): it installs, starts, sizes and stops vLLM, with no file
to edit and no script to run. The farm can also route to an OpenAI-compatible server it does not run: SGLang,
TensorRT-LLM, a server on another machine, or a vLLM started by hand from `farm/vllm`. That is the [`external`](#config--lolconfigjson) engine,
which a developer sets up in `lol.config.json`; the panel shows its button only while the file holds one, and
never offers it otherwise. The farm routes to it and reads a vLLM's `/metrics`, but never installs, starts, stops
or configures it. Until 2026-10-07 this recipe was the only way to serve vLLM (the studio's PRO 6000 ran on it). A
vLLM on this computer started this way is offered to the farm on the panel
([Taking over a vLLM you started](#vllm-run-by-the-farm)); once the farm runs a folder (its marker
`run/managed-by-farm`), `serve.sh` started by hand from it does nothing until the marker is removed (the panel's
Undo does it).

### On Windows (WSL2)

Every step below was run on the PRO 6000 on 2026-10-05. **You need:** Windows 11 with WSL2 Ubuntu, the NVIDIA
driver (the Windows one is enough) and about 40 GB of disk in WSL (the 23.5 GB model plus the venv). Below,
`<repo>` is this repository seen from WSL, e.g. `/mnt/c/Users/<you>/LlmOnLan`.

1. **Install, once** (about 15 min plus the download). This installs uv if it is missing, then vLLM 0.30.0, the
   version measured, into `~/lol-vllm/.venv`, pins the CUDA compiler packages that FlashInfer's kernel build
   needs on this card, and downloads `nvidia/Qwen3.6-35B-A3B-NVFP4` into `~/lol-vllm/hf/`. Run it again to
   resume or repair.
   ```powershell
   wsl -d Ubuntu -- bash <repo>/farm/vllm/install.sh
   ```
2. **Start vLLM before the farm**, in a window you leave open:
   ```powershell
   wsl -d Ubuntu -- bash <repo>/farm/vllm/serve.sh
   ```
   The first start compiles kernels (~3 min); later starts take ~1.5 min. It is ready when the window prints
   `[serve] … ready: http://127.0.0.1:8100/v1`. Check it from Windows with
   `curl http://127.0.0.1:8100/v1/models`. Before that line, a connection to 8100 is accepted and closed at once,
   so the farm sees the server as down.
3. **Point the farm at it**, then restart the farm. With the Farm app, the file is
   `%APPDATA%\LlmOnLan Farm\farm\lol.config.json`: quit and reopen the app after editing it. If vLLM is not
   answering when the farm starts, the farm serves with its built-in engine for that whole run. Start vLLM
   first, or restart the farm once vLLM is up. This needs farm-v0.0.42 or newer: an older farm refuses
   `presencePenalty` and does not start.
   ```json
   "external": {
     "enabled": true,
     "alias": "assistant",
     "baseUrl": "http://127.0.0.1:8100/v1",
     "model": "qwen3.6-35b-a3b",
     "contextLength": 65536,
     "parallel": 48,
     "vision": true,
     "presencePenalty": 1.5,
     "label": "Qwen3.6-35B-A3B (vLLM)"
   }
   ```
   `presencePenalty` stops Qwen3.6's endless replies (see [Replies that never end](#replies-that-never-end)).
   Leave it out for another model unless its model card asks for it.
4. **Stop it** in one of three ways: close the vLLM window, press Ctrl+C in it, or run
   `wsl -d Ubuntu -- bash <repo>/farm/vllm/stop.sh`. A watchdog in `serve.sh` then stops vLLM, its EngineCore
   process and the relay together, because killing `wsl.exe` alone leaves Linux processes running and holding
   the GPU. Check that `nvidia-smi` is back to the desktop's ~1.5 GB. A running farm notices within 10 s and goes
   unhealthy, so clients fail over. When vLLM answers again, the farm serves it again with no restart.

`serve.sh` takes `LOL_VLLM_ROOT` (default `~/lol-vllm`), `LOL_VLLM_PORT` (8100) and `LOL_VLLM_MODEL`. Any
arguments you add go to `vllm serve` after its defaults, and a repeated flag keeps its last value. So an
`--override-generation-config` of your own replaces `serve.sh`'s, and with it the reply limit of 32,768 tokens
([Replies that never end](#replies-that-never-end)): put `"max_new_tokens": 32768` in yours. The log is
`~/lol-vllm/logs/vllm.log`. Other models from the spike also work: `bash install.sh <repo id>`, then
`LOL_VLLM_MODEL=~/lol-vllm/hf/<name> bash serve.sh --served-model-name <name> …` with that model's parsers from
[RESULTS.md](../docs/spike/RESULTS.md#exact-install-and-launch-commands-that-worked). Nemotron 3.5 Lightning
has no vision, so set `"vision": false` for it.

**Why 48 seats at 64k.** vLLM pages its KV cache, so a seat reserves no memory. A seat is admission: how many
people the farm lets generate. The spike counts a person as served when the first word arrives within 5 s
(p95) and the reply streams at 15 tok/s or more (p10).
- **The window.** At 64k, 48 people pass even when everyone starts at once, and 64 pass in steady use, with
  every person generating non-stop. Real people read and type between messages, and a seat stays held only
  `proxy.seatIdleSec` after a person's last message, so 48 seats is the safe head count. Raise it toward 64 for
  a class that does not type in sync.
- **The client.** 64k keeps the client's whole-document mode on: it switches on at `contextPerSlot` ≥ 24576,
  and an external server advertises its full `contextLength` per seat. It also leaves the coding agent room for
  "Keep going", which asks for ≥ 16k tokens of output.
- **The pool.** The KV pool holds 4,313,303 tokens, 65 full 64k windows, so the farm's pool warning (below)
  stays quiet.
- **Other shapes.** For a large class with short chats, use `contextLength: 32768, parallel: 96` and add
  `--max-model-len 32768` to `serve.sh`. For long documents, use `contextLength: 131072, parallel: 32` and add
  `--max-model-len 131072` to `serve.sh`. A cold 128k prompt takes ~8 s even alone (RESULTS.md, finding 8).
- **Overflow.** vLLM runs up to 128 requests at once (`--max-num-seqs`) and queues the rest, so a burst waits
  instead of failing.

**Why a 50 GiB KV pool.** `--kv-cache-memory-bytes` is absolute. Never use `--gpu-memory-utilization`: it is a
fraction of the card's total, and its start-up profiler aborts when Ollama loads a model beside it. Measured
on the 96 GB card (97,887 MiB):
- **vLLM itself.** Qwen3.6 needs 20.4 GiB of weights plus ~4 GiB of runtime at 64k and 128 requests.
- **What vLLM leaves free.** The card holds 76,950 MiB idle, the Windows desktop included, and 77,587 MiB at
  peak (140 streams, then 32 prompts of 36k tokens at once). That leaves ~19.8 GiB free.
- **What that free memory holds.** It fits the OCR vision model (~9 GB, owner decision 6) with room to spare,
  and with that model loaded the card stays under 92 %. Above 92 %, the farm unloads idle Ollama models, so the
  OCR model would have to reload for each document.
- **The cost.** The spike's 58 GiB left too little room for OCR. 50 GiB is ~14 % less pool, which costs
  nothing here: on this model, speed and first-word time run out before the pool does (RESULTS.md, finding 5).

To size the pool for another card or a co-tenant, use:
`pool ≈ 0.92 × card − (weights + ~4 GiB) − desktop − OCR model − anything else resident at its peak`
(read the last term from `nvidia-smi` while that app works). Pass the result as `--kv-cache-memory-bytes`. With
ComfyUI's ~45 GB still on this card, about 8 GiB remains: ~0.7M tokens, or ~10 people at 64k. In that case,
lower `parallel` to what the farm's pool warning says fits, or move ComfyUI or OCR to another box.

#### Start vLLM at logon

Only for a vLLM you run yourself. A farm that runs vLLM needs none of this: the Farm app's Launch at login
starts the farm, and the farm starts vLLM ([vLLM, run by the farm](#vllm-run-by-the-farm), "At login").
So that a vLLM you run comes back after a reboot, a scheduled task runs `farm/vllm/start-windows.ps1` when you log on. The
script starts `serve.sh` hidden in WSL, waits until `http://127.0.0.1:8100/v1/models` answers, then starts the Farm
app, so the farm finds vLLM when it starts. If vLLM has not answered after 15 minutes, or `serve.sh` stopped, the
script starts the Farm app anyway: the farm then serves its built-in engine until you quit and reopen it once vLLM
answers. The script's log is `%APPDATA%\LlmOnLan Farm\vllm-start.log`, next to `farm.log` in the Farm app's logs
folder. vLLM's own log is still `~/lol-vllm/logs/vllm.log`.

1. **Turn off the Farm app's Launch at login** (Settings). Otherwise the Farm app starts before vLLM answers and
   serves its built-in engine for that whole run. When that happens, the script's log says the Farm app was
   already running.
2. **Register the task once**, in PowerShell. This line runs the Farm app's own copy of `farm/vllm`, which exists
   from farm-v0.0.42 on and is refreshed by each Farm app update. The same file in a checkout of this repository
   works too.
   ```powershell
   Register-ScheduledTask -TaskName 'LlmOnLan vLLM' -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) -Settings (New-ScheduledTaskSettingsSet -Priority 4 -ExecutionTimeLimit 0 -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries) -Action (New-ScheduledTaskAction -Execute powershell.exe -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$env:APPDATA\LlmOnLan Farm\farm\vllm\start-windows.ps1`"")
   ```
   Options go at the end of `-Argument`, after the path: `-Root /home/<you>/lol-spike` for another
   `LOL_VLLM_ROOT` (a Linux path, without `~`), `-Distro` (`Ubuntu`), `-Port` (8100), `-TimeoutSec` (900) and
   `-FarmApp` (`%LOCALAPPDATA%\Programs\llmonlan-farm-app\LlmOnLan Farm.exe`). To try it without logging off:
   `Start-ScheduledTask 'LlmOnLan vLLM'`. To remove it: `Unregister-ScheduledTask 'LlmOnLan vLLM' -Confirm:$false`.
3. **Nothing to set in WSL.** The script runs `serve.sh` in daemon mode (`LOL_VLLM_DAEMON=1`), which turns the
   stdin watchdog off, so how its window was started does not matter. `serve.sh` stays in the foreground of the
   task's `wsl.exe`, and a distro keeps running while a `wsl.exe` is attached to it, so `wsl.conf` and
   `.wslconfig` need no keep-alive.
4. **Stopping and crashes.** `stop.sh` stops it, as in step 4 above. Nothing restarts a vLLM that stops or crashes:
   run the task again (`Start-ScheduledTask 'LlmOnLan vLLM'`). A farm that started on vLLM serves it again by
   itself once it answers; quit and reopen the Farm app only if the farm started while vLLM was down (its panel then
   shows the fallback reason). While vLLM still
   runs, a second start is refused by `serve.sh` and changes nothing.

Checked on 2026-10-07 with a stand-in for vLLM (no GPU) on a spare port: the Farm app started only once the
server answered; the distro and the server were still up 60 s after the script exited, with no other `wsl.exe`;
`stop.sh` ended the script's `wsl.exe` and the distro stopped 10 s later; a 12 s timeout and a `serve.sh` that
stopped at once both still started the Farm app. The task runs on the PRO 6000 since 2026-10-07
([docs/PRO6000_VLLM_SWITCH.md](../docs/PRO6000_VLLM_SWITCH.md)); after the farm takes that vLLM over, it only opens
the Farm app.

### On Linux (DGX Spark)

This is the operator-run recipe. With the Farm app, a Spark's operator presses the panel's **vLLM** button
instead ([vLLM, run by the farm](#vllm-run-by-the-farm)): the farm installs vLLM, sets the memory guard and the
4 compile jobs itself, and needs no unit, flag or file. The same scripts run vLLM natively on Linux. On the DGX Spark (GB10, 128 GB of memory shared by the CPU and the
GPU), the spike measured vLLM serving **8 people at once on Qwen3.6-35B-A3B, at 32k or 64k of context each, or 16
on Nemotron 3.5 Lightning at 32k** ([RESULTS.md, DGX Spark](../docs/spike/RESULTS.md#dgx-spark-gb10)). That is a
workshop table, not a class: llama.cpp served 2 there, and a PRO 6000 serves 48 at 64k. In this recipe the Spark runs
vLLM as a systemd service, so it comes back after a reboot, with a memory guard (the farm's own vLLM sets the same
guard and compile jobs by itself). The service and the guard were checked on 2026-10-07 under systemd with a
stand-in for vLLM, not yet on the Spark itself. Below, `<repo>` is your checkout of this repository.

1. **Install, once**, as your user (about 40 GB of disk):
   ```bash
   bash <repo>/farm/vllm/install.sh
   ```
   It builds the venv on uv's own Python 3.12 (`UV_PYTHON_PREFERENCE=only-managed`): the Spark's system Python has
   no headers, and vLLM then stops with `Model architectures [...] failed to be inspected`. For Nemotron, also run
   `bash <repo>/farm/vllm/install.sh nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4`.
2. **Install the service.** Copy `farm/vllm/lol-vllm.service` to `/etc/systemd/system/`. Set `User=` and the path
   to `serve.sh` in `ExecStart=`: a checkout of this repository, or the Farm app's own copy,
   `"/home/<you>/.config/LlmOnLan Farm/farm/vllm/serve.sh"` (farm-v0.0.42 and later, in double quotes because of
   the space). Then:
   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable --now lol-vllm
   ```
   The start returns once `http://127.0.0.1:8100/v1/models` answers; the first one compiles kernels for a few
   minutes. The unit:
   - runs `serve.sh` in daemon mode (`LOL_VLLM_DAEMON=1`): under systemd stdin is `/dev/null`, and the stdin
     watchdog would stop the server at once;
   - restarts it 30 s after a crash, at most 3 starts an hour, then leaves it stopped;
   - leaves it stopped after `sudo systemctl stop lol-vllm` or `stop.sh`;
   - logs `serve.sh`'s own lines to `journalctl -u lol-vllm`, and everything to `~/lol-vllm/logs/vllm.log`.
3. **The Spark's numbers** are arguments in `ExecStart=`, after `serve.sh`'s defaults, which stay the PRO 6000's:

   | | Qwen3.6-35B-A3B (the unit as shipped) | Nemotron 3.5 Lightning |
   |---|---|---|
   | People at once, measured | 8 at 32k or 64k, 4 at 128k | 16 at 32k, fewer than 8 at 64k, 4 at 128k |
   | In `ExecStart=`, after `serve.sh` | `--kv-cache-memory-bytes 62277025792 --max-num-seqs 32` | the same, plus `--max-model-len 32768 --served-model-name nemotron-3.5-lightning --mamba-backend flashinfer --reasoning-parser nemotron_v3 --tool-call-parser qwen3_coder`, and a line `Environment=LOL_VLLM_MODEL=/home/<you>/lol-vllm/hf/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4` |
   | In the farm's `external` block (step 3 of the Windows section) | `"model": "qwen3.6-35b-a3b"`, `"contextLength": 65536`, `"parallel": 8`, `"vision": true`, `"presencePenalty": 1.5` | `"model": "nemotron-3.5-lightning"`, `"contextLength": 32768`, `"parallel": 16`, `"vision": false`, no `presencePenalty` |

   - **The KV pool, 58 GiB**, is the spike's. With it the box used ~90–96 GB on Qwen3.6, the Farm app's
     speech-to-text and Classify included, which leaves room for the OCR model (~9 GB) above the guard's floor.
     The people use little of it: 8 people at 64k fill about a tenth, and speed runs out long before the pool. A
     box that also does other work can shrink it without serving fewer people; that was not measured.
   - **32 requests at once.** At 32, each stream still gets ~11–12 tok/s (p10), against 18 at 16, so a burst past
     the seats runs slower instead of waiting.
   - **Speed.** One person's reply streams at 69–76 tok/s. A cold 32k prompt takes 6 s alone and a cold 128k
     document 30–39 s, so long documents belong on a PRO 6000.
4. **Start the farm after vLLM.** The farm probes vLLM only when it starts: if vLLM is not answering then, the
   farm serves its built-in engine for that whole run.
   - **From a terminal:**
     ```bash
     until curl -s -o /dev/null http://127.0.0.1:8100/v1/models; do sleep 5; done; lol up
     ```
   - **The Farm app (AppImage):** its own Launch at login starts it at once, without waiting (right when the farm
     runs vLLM itself). For this recipe, turn it off and start it at login from
     `~/.config/autostart/lol-farm.desktop`, which waits for vLLM first, up to 15 minutes (put in the path of your
     AppImage):
     ```ini
     [Desktop Entry]
     Type=Application
     Name=LlmOnLan Farm
     Exec=sh -c "timeout 900 sh -c 'until curl -s -o /dev/null http://127.0.0.1:8100/v1/models; do sleep 5; done'; exec /home/<you>/LlmOnLan-Farm-0.0.42-arm64.AppImage"
     ```
     The Farm app's config is `~/.config/LlmOnLan Farm/farm/lol.config.json`: quit and reopen the app after
     editing it.
5. **The memory guard.** On the Spark the GPU allocates from the system memory. After an out-of-memory and two
   hard resets on 2026-09-16, the GPU stayed latched at ~700 MHz until a cold power drain (step 6). So the unit
   sets `LOL_VLLM_MIN_FREE_GB=8`: every 2 s `serve.sh` reads the box's `MemAvailable`, and below 8 GB it stops
   vLLM (TERM, then KILL after 5 s) and exits 3. systemd does not restart after a 3. The `[guard]` line in
   `vllm.log` says how much memory was left: find what took it (`free -g`, `ps aux --sort=-rss | head`), then
   `sudo systemctl reset-failed lol-vllm && sudo systemctl start lol-vllm` (after three failed starts in an hour,
   systemd refuses a plain start). The unit also sets `MAX_JOBS=4`: compiling kernels with one job per core took
   Qwen3.8's start from 35 to 116 GB in 30 s, and 4 jobs kept it to 108 GB.
   - **Why not a systemd memory limit** (`MemoryMax=`). It bounds only what the kernel charges to the unit. The
     farm, its plugins, Ollama's OCR model and the desktop take the same memory from outside the unit, and
     whether the GB10 driver charges the GPU's own allocations to it was not measured. At the limit, the kernel's
     out-of-memory killer would end vLLM in the middle of an allocation, the kind of event that came before the
     latch. The guard watches what the whole box has left, the number the spike's guard watched, and stops vLLM
     in order while 8 GB remain. The spike's guard checked every 10 s and caught a start-up climb at 5 GB free;
     this one checks every 2 s.
6. **After any crash, check the GPU clock.** While a reply streams,
   `nvidia-smi --query-gpu=clocks.sm,power.draw,utilization.gpu --format=csv -l 2` should read 1,400 MHz or more
   and 40 W or more. A GPU stuck near 700 MHz and 11–14 W while 90 % busy is the latch. NVIDIA's forums report it,
   with no fix yet. A warm reboot does not clear it; a cold drain does: power off, unplug the power brick at the
   wall, hold the power button for 30 s, wait, then boot.

`serve.sh` from a terminal works on a Spark too, with the same settings:
`LOL_VLLM_MIN_FREE_GB=8 MAX_JOBS=4 bash <repo>/farm/vllm/serve.sh --kv-cache-memory-bytes 62277025792 --max-num-seqs 32`.

## Adding or changing models

**The panel is the normal way.** Open `http://<box>:41997/lol/admin` (the Farm app shows it as its own
window) and everything below is a click — applied live, and written back to `lol.config.json` so it
survives a restart. Editing the config by hand still works and is documented under each heading, but you
only need it for a farm you administer over SSH.

### Which model everyone gets (llama.cpp path)

This is the model clients auto-select — the one that matters. It is a single `.gguf`.

**From the panel** — the *Model · llama.cpp* card lists a **library** of `.gguf`s the farm knows about:

1. **Add a model**: paste the link to a `.gguf` and press **Add**. On Hugging Face that is the file's
   *download* link — the `…/resolve/main/….gguf` one, not the page you were reading it from. Adding only
   remembers it; nothing is downloaded yet. **Split models work too** (very large models ship as
   `…-00001-of-00003.gguf` parts): paste *any* part's link — the farm fetches **all** parts and
   llama-server assembles them at load (no merge step). Note this is the ONLY route for split models:
   Ollama's registry refuses sharded Hugging Face repos outright (`ollama pull hf.co/…` errors), so
   they can't land in the Ollama catalog.
2. **Use this** on any entry downloads it (progress is shown per part — a first fetch is several GB
   and several minutes) and reloads llama-server onto it.
3. **Remove** drops an entry from the list. The one currently serving can't be removed; switch first.

The library ships with four: the three 12 GB-class Qwen3.8-27B quants measured here, plus an NVFP4+MTP
build for Blackwell cards (16 GB+), so you can switch between them without hunting for URLs.

If the new weights fail to load — a wrong URL, a file that isn't a GGUF, something too big for the card —
**the farm rolls back to the model that was working** and tells you why. It will not leave you with a
farm that has no backend, which matters because the panel is served *by* the farm.

**From the config** — set `llamacpp.model` (and `llamacpp.mmproj`) and restart:

```jsonc
"llamacpp": {
  "model": "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-UD-Q2_K_XL.gguf",
  "mmproj": "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/mmproj-F16.gguf",
  "mtp": true            // only because this quant is UD-Q2_K_XL — see the rule above
}
```

Either way the file is cached in `farm/.models/`, so switching **back** later is instant, and the model
keeps serving under the same alias — **existing chats keep working**, because clients bind to the alias,
not to the checkpoint.

Three things to get right when choosing weights:

- **`mmproj` must be the projector for that model family.** It goes straight to `--mmproj`, so a
  mismatched one fails at load. Take it from the same repo as the weights, or leave it empty for a
  text-only model.
- **Weights + KV cache must fit VRAM**, with room for the desktop. `ngl` is all-or-nothing here: a model
  that doesn't fit spills to CPU and collapses to a few tokens/s. See
  [Multiple users & capacity](#multiple-users--capacity) for the budget.
- **The quant ↔ `mtp` rule** above. Picking a library entry handles this for you — the farm turns MTP off
  automatically when you switch to a quant whose MTP head was stripped, rather than failing to boot.

Old `.gguf`s stay in `farm/.models/` at several GB each; delete the ones you're done with by hand.

### The name users see

Over an OpenAI connection, the model **id** is what a picker displays — so the name is the served alias,
not a label bolted on top. Set it in the panel: on llama.cpp and on vLLM, *Backend* ▸ **Name users see**
(`llamacpp.alias`, `vllm.alias`; on vLLM only the proxy restarts, vLLM keeps running); on Ollama, the
**Rename** button on each model row (`models[].alias`). `modelAlias` is config-file only. While llama.cpp
or vLLM serves, the Ollama default's row has no Rename: a switch back gives it that engine's name, so it is
renamed up in *Backend*.

Renaming reloads the model and takes a few seconds. **Existing chats will ask to re-select the model**,
because their bound id no longer exists; new chats are unaffected. That is the cost of the rename being
real rather than cosmetic.

### The Ollama catalog (served when Ollama is the engine)

These are ordinary Ollama tags. When **Ollama is the selected engine** they are what the farm serves —
several at once, load-balanced across `ollama.hosts`. While llama.cpp is the engine they are
**standby**: kept installed (the card carries a *standby* badge and a "Not served right now" hint; the
rows keep **Rename** — except the default's — and **Delete**, but lose Offer/Stop and Make default) so
an engine switch is instant, and so document OCR has its vision model.

**From the panel** — the *Models · Ollama* card:

- **Download a model**: type an Ollama tag (`gemma4:12b`, `qwen3.8:14b`) and press Download. It is
  pulled onto every local host and offered to clients while Ollama is the engine. With another engine
  serving it is only added to the standby catalog: no proxy restart (in-flight chats keep going) and no
  warm-up next to the serving engine.
- **Offer / Stop**: whether clients can select an already-downloaded model.
- **Delete**: removes the weights from the box. Refused for the last model in the catalog, and for the
  model document OCR is using.

**From the CLI:**

```bash
lol models add qwen2.5-coder:14b     # add to the served catalog
lol models ls                        # what's configured + present on each host
lol models pull                      # pull everything configured, on every host
lol up --no-pick                     # serve EVERYTHING in `models` (see the warning)
```

> **⚠ `lol up`'s picker (OLLAMA engine only — no prompt while llama.cpp serves) REPLACES the catalog for that run.** On a terminal, plain `lol up` prompts, and
> pressing Enter serves **only the default model** — silently dropping the model you just added. Use
> `lol up --no-pick` (alias `--yes` / `-y`) to serve the configured `models`, or answer the prompt with
> every number you want (e.g. `1,3`). Whatever you pick at the prompt is **ephemeral**; it is not written
> back to `lol.config.json`. (If the configured default isn't installed on the box, Enter falls back to
> the first installed model.)

Or edit `models` directly, giving each a stable role name:

```jsonc
"models": [
  { "id": "gemma4:12b", "default": true },
  { "id": "qwen2.5-coder:14b", "alias": "coder" }
]
```

An **alias is what keeps chats alive** across a model swap: a chat binds to the id it started with, so
without one, re-quantising or renaming breaks every existing conversation.

For a Hugging Face GGUF served *through Ollama*, use `source` + `params` (and `draft` for a separate
speculative-decoding module) — see the annotated `preinstall` entry in [`src/config.js`](src/config.js).

**`preinstall` — staged but not served.** Entries here are **pulled by `lol install` and `lol up` like
served models**, but get no routing and are absent from the beacon: no client can see or select one, so
no client can trigger a model swap on your GPU. It's how you keep a model *ready* for the panel to start
on demand (the panel picks up its full definition, so alias/vision/params survive). Note the shipped
default `preinstall` — a Qwen3.8-27B UD-IQ2_XXS **plus its draft module, ~8.6 GB** — is part of why the
first bootstrap is large; empty it (`"preinstall": []`) if you don't want it on disk.

### What the panel changes, and what it does not

Everything in the panel applies to the **running** farm and is written back to `lol.config.json`, so it
survives a restart. The exceptions, all deliberate:

- **Plugin toggles** and the **Blender recommendation** are for this session only.
- **Ollama's own slot count** needs a farm restart to take effect, because `OLLAMA_NUM_PARALLEL` is read
  by Ollama at startup. The panel says so when you change it. On a multi-box farm it is **per box**
  (the panel shows the farm total next to it).

The *Backend* card's settings — the name (llama.cpp, vLLM), people served at once, the context window (on vLLM
also the GPU memory for conversations) and the farm password — are collected and applied by **one Apply
changes** button: one restart for all of them, not one per field. On vLLM, Apply asks the farm first and
restarts vLLM (about 2 minutes, said before) only for a new model, context, memory or request cap; the name,
the password and people at once inside that cap apply in seconds. **Free an idle seat after** (shown while the seat gate is on) rides the same button but
restarts nothing: the gate reads `proxy.seatIdleSec` live, so set it to 2 min before a workshop and back
to 15 min after.

**Under an external server** its name, people at once and context are refused (*"This farm routes to a server it
does not run, so its model, context and people at once are that server's own. To change them here, switch to
Ollama, llama.cpp or vLLM."*), because that server's model, window and concurrency are its own. The engine
buttons still work: Ollama, llama.cpp or vLLM then serves, and the External server button stays while the file
holds its block. The farm password still applies. The
Ollama catalog is standby, exactly as under llama.cpp.

Only **one** long operation runs at a time — a download, a backend switch, a reload. Everything else is
refused with *"the farm is busy"* rather than queued, because two model reloads racing is how a farm ends
up with no backend at all.

## Multiple users & capacity

A farm is a shared box, and the honest limits are per-engine. On a big NVIDIA GPU, vLLM serves the most people
by far: 48 at 64k on an RTX PRO 6000, 8 on a DGX Spark (measured). Its people at once, context per person and
memory are set as [vLLM, run by the farm](#vllm-run-by-the-farm) says. The rest of this section is llama.cpp
and Ollama.

**llama.cpp serves `llamacpp.parallel` requests at once — default `1`.** With one slot, a second person's
message waits for the first to finish generating: throughput is fine, but their *time to first token* is
however long the current answer takes. With `kvUnified` (the default) the slots share ONE context pool:
a person alone gets the whole window, and under full contention each is guaranteed
`contextLength ÷ parallel` (what the beacon advertises as `contextPerSlot`). For N busy users at a
W-token window, set `contextLength ≈ N × W` and check the total still fits VRAM, because the KV cache is
allocated in full at load. `kvUnified: false` restores the hard split
(`--ctx-size 16384 --parallel 2` → 8192 each).

Both are panel controls — *Backend* → **People served at once** and **Context window**. The line under
them says, as you change them and before you apply, what each person gets (the `contextPerSlot` the farm
will advertise) and what the clients then do: below 24576 each, Open WebUI reads the 8 most relevant
passages of a document instead of all of it, and every connected Open WebUI restarts once when that
flips. On small windows, in clients newer than v0.2.7, the coding agent's *Keep going until done* writes
shorter replies; v0.2.7 and older still ask for 16k replies and, at 20k each or less, cannot summarise the
agent's history. Automatic is sized when the engine starts, so the line quotes the last measurement and
says so. They apply together
with **Apply changes**, reloading the model once, and are written back to `lol.config.json`. If the new shape does
not fit VRAM the model fails to load and the farm reverts to the shape that worked.

**Budgeting VRAM.** For the shipped quant, weights are ~7.8 GB and quantized (`q4_0`) KV runs
**~1.2 GB per 16k of total `contextLength`** — so `parallel: 4, contextLength: 65536` lands around
12.6 GB and will **not** fit a 12 GB card. Safe shapes:

| Card | Shape | Rough total |
|---|---|---|
| 12 GB | `parallel: 2, contextLength: 32768` (2 × 16k) | ~10.2 GB |
| 16 GB | `parallel: 4, contextLength: 65536` (4 × 16k) | ~12.6 GB |
| 24 GB+ | `parallel: 8, contextLength: 131072` (8 × 16k) | ~17.4 GB |

**The context window is automatic by default** (`llamacpp.contextLength: "auto"`): at every model
load the farm reads the model's **native maximum** and its **KV-cache geometry from the .gguf
header itself** (`farm/src/gguf.js` — the computed rate matches the fleet's measured 1.2 GB/16k
exactly), measures the GPU, and serves **the largest context that fits**:
min(native max, VRAM budget). A 4070 gets ~36k, a 4080 ~78k, the DGX Spark the full native window
— each box its own maximum, which is what thinking models and whole-document RAG want. Pin a
number in the panel only when you need to trade context for slots.
The budget is the VRAM **free** when llama.cpp is sized (nvidia-smi `memory.free`, read after the
farm's own llama-server has stopped; models the farm's own Ollama holds count as free, since the
pressure eviction frees them), not the card's total: another app on the GPU — ComfyUI keeps ~45 GB
of a 96 GB card — is not room to fill. `llamacpp.gpuReserveGb` (default `0`) keeps more back for an
app that is not running at that moment but will be. A unified-memory box (no `memory.free`) budgets
against the whole pool, as before.

**The Ollama engine sizes automatically too** (`ollama.contextLength: "auto"`, the default): GGUF
math is unreliable for its zoo of architectures (Gemma's sliding-window layers make the naive KV
estimate several times too high), so the farm **measures instead** — it loads the default model at 16k
and 32k, derives the per-token cost from `/api/ps`, aims at min(native max, VRAM − 8%) and verifies with
one more load (one halving, then 16k, if it spills). The verdict is **cached** per (model, VRAM,
numParallel, kvCacheType), so the loads are paid once per box, not per boot. If even 16k spills it walks
down to 8192/4096. Verified: gemma4:12b on a 96 GB box probes straight to its native **262144** (fully
in VRAM — that sliding window makes its KV tiny). The probe doubles as the warm-up. `Automatic` in the
panel's context selector works on both engines.

You mostly do not have to do the arithmetic yourself even then: the panel **computes the budget from the real
weights on disk and the detected VRAM** — context sizes past the budget are **advertised as too much**
("more than this 12 GB GPU holds — slows to a crawl") but stay selectable: the panel asks for a
confirmation, the applied result spells out the trade, and a persisted over-size is **honored at boot
with a loud warning** rather than clamped (owner call 2026-08-28 — the admin may deliberately trade
speed for window). The warnings exist because a
256k window saved onto a 12 GB card "worked" — Windows overcommits GPU memory into system RAM — and
served a few tokens a second until someone guessed why. The **Performance card** is the other half:
measured tok/s while generating (from llama-server’s own counters), slots busy, requests waiting, KV
usage, and plain-language warnings for the two silent failure modes (VRAM full at idle; generating far
below hardware speed). On vLLM (the farm's own, or an [external one](#config--lolconfigjson)) the same card reads vLLM's
`/metrics`: requests running / waiting, context memory used (`kv_cache_usage_perc`) and its size in
tokens, prefix-cache hits, tok/s **per person** while generating (generated tokens over the
inter-token-latency sum, so it means what llama.cpp's number means), **all together** (the generation
counter over the window's wall clock) and, with a drafter, the share of draft tokens accepted. Its
warnings are the KV pool against the declared seats and the Ollama model sharing the GPU — not the
llama.cpp VRAM ones (a vLLM fills VRAM on purpose). Verify rather than trust the table: `nvidia-smi` after load, and `lol status`. A workshop where people
type in bursts is usually happier with `parallel: 2-4`; a single power user is better off with `1` and a
big window.

> **⚠ The table assumes llama.cpp is the only tenant on the GPU — and by default it isn't.** Farm OCR
> runs a **vision model on this box's Ollama** for every uploaded image / scanned PDF, and by default
> that is `gemma4:12b` (**~7.6 GB**, auto-picked as the served default vision model). On a **12 GB
> card there is no shape in the table that also fits it** — even the 9 GB default leaves ~3 GB. Ollama
> can't help: `maxLoadedModels` has no visibility into llama-server's allocation. So on 12 GB, pick one:
>
> - **accept it** — the first document upload will page/evict and that chat will be slow;
> - **shrink the OCR model** — `"ocr": { "model": "<a small vision model>" }`;
> - **move OCR to another box** — `"ocr": { "enabled": false }` here;
> - **or give the box more VRAM.** A 24 GB card fits `parallel: 8` *and* the OCR model comfortably.

**Ollama serves `ollama.numParallel` generations per host (default 2)** and queues the rest, so more
boxes in `ollama.hosts` — or more farms on the LAN — is how that side scales.

**Measure before a workshop** instead of guessing:

```bash
lol bench --users 8 --rounds 3      # first-token latency p50/p95 + tokens/s under real concurrency
lol bench --people --users 8 --cancel 0.25 --out bench.json   # 8 PEOPLE; a quarter press Stop half-way; save it all
```

By default every user comes from this machine's one address — one seat — so bench measures the
engine's own queue. `--people` (with a loopback `--url`, i.e. run on the farm box) sends each user from
its own `127.0.0.x`, so the seat gate sees eight **people** and users past the seats get the 429 a
workshop would (Windows and Linux route all of `127/8`; macOS needs `sudo ifconfig lo0 alias 127.0.0.2`
per address). Those seats stay held for `proxy.seatIdleSec` after the run, so use a test farm, or bench
well before people arrive. From another machine, every user shares that machine's address.

**Who's connected.** Clients POST presence to the farm every ~10 s (`/lol/client-ping`: install id,
hostname, platform, app version, idle seconds). The admin panel's **Clients** card lists them with idle
times, and it rides the beacon as `usage.clients` — so you can see who is actually on a box before
restarting it. Machines drop off ~30 s after the app closes.

That count is also published against the slot count as `capacity: { slots, clients, seatsUsed }`, which
is what lets both ends show occupancy: every farm card in the desktop client turns amber once a box is
full. Past `slots` the **seat gate** refuses NEW generations with a clear 429 (*"All N seats … in use"*)
until a seat has been idle `proxy.seatIdleSec` (15 min). The panel's Clients card reads *"N of M seats
in use"*. Set `proxy.seatGate: false` to go back to queueing. A unicast `GET /lol/self` also says
`capacity.mine: true` when the **caller's** IP holds one of those seats (`false` otherwise), so a
client can count its own seat as its own; being per caller, it is never in the beacon broadcast.

**What people met at the gate.** To answer "keep the 429 or queue?" with numbers, the gate counts, over
the last hour and since the farm started: generations let in, turned away (the 429), refused for a wrong
password (the 401), stopped by the person before the reply ended (and how many of those before the first
word), the fullest moment (*"3 of 3 seats at 14:05"*, read at each generation request), and the wait for
the first word of a streamed reply, from the request reaching the gate to the first byte back (queueing and
prompt reading included; a non-streamed reply is let in but not timed), as *"within X s for half, Y s for
95%"*. The Clients card shows them and adds *"N generations turned away in the last hour"* to its title;
`GET /lol/admin/state` carries them as `capacity.metrics`. Counts only: no address, id or content is kept,
nothing is written to disk, and they reset when the farm restarts. Memory is fixed (60 one-minute buckets
plus the totals, the times in bins), so the percentiles are bin edges. They are not in the beacon: no
client reads them. A request counts each time, so a client that retries a 429 counts again.

**"Capacity is unverified."** `OLLAMA_NUM_PARALLEL` / `OLLAMA_KV_CACHE_TYPE` only reach an Ollama the farm
starts. When Ollama was already running as someone's service, the snapshot reports
`slotsVerified: false`, and the panel's Clients card says *"Capacity is unverified"* with the exact env
line to set on that service (the seats still use the configured number). An external server is
`slotsVerified: false` too — its seats are declared — but that row is Ollama's only; the Backend card
says it for an external server.

**What multi-user does *not* mean here.** There are no farm-side accounts and nothing to administer per
person: each client is a single-user app whose chats, documents and RAG vectors live on that person's own
machine (the farm stores nothing). "Multi-user" is purely a **capacity** question — plus, if you want the
box reachable at all, `proxy.host` / `beacon.enabled` (the Farm app's *Share compute with the network*
toggle). `proxy.masterKey` is the shared **farm password** — see the next section; the desktop client prompts
for it once per farm and remembers it.

## Password-protecting a farm

One shared password for everyone (the ComfyQ model — nothing fancy, no accounts):

1. Panel ▸ *Backend* ▸ **Farm password** → type one → Apply changes (a few seconds; the proxy
   restarts). To remove it, press **Remove** next to the field (it asks to confirm). Or set
   `proxy.masterKey` in `lol.config.json`.
2. Every client then shows the farm with a 🔒 and asks for the password **once**, verifies it
   against the farm before saving, and remembers it per farm. Wrong password = an immediate
   "not accepted", never a broken chat.

What it protects: **every `/v1` route** — chat, models, everything the proxy serves (it becomes
LiteLLM's `master_key`) — and, since 2026-09-27, **the plugins**: the OCR, Classify and speech-to-text
keys leave the beacon and `/lol/self` (their `key` is `null`), and a client holding the password fetches
them from `GET /lol/plugin-keys` (`Authorization: Bearer <farm password>`; 401 otherwise, 404 on an open
farm, where the keys stay in the snapshot as before). A new password takes effect there at once. The keys
are the same on every run (derived from one secret in `farm/.lol-secret` and the farm password, so a farm
restart no longer restarts every client's Open WebUI). Setting or changing the password gives the plugins
new keys at the next farm restart: until then, a device that fetched the old keys keeps them, and the
restart costs every connected Open WebUI one more restart. Delete `.lol-secret` and restart the farm to
rotate the keys without changing the password. What stays open, deliberately: discovery (`/lol/self`, the beacon) so
clients can *find* the farm and ask for the password, `/health/liveliness` (the farm's own health
checks), and the admin panel's own **token** gate, which is separate and unchanged. The
[message bus](#message-bus) checks the same password itself (MQTT, WebSocket and OSC each carry it their
own way). This is a trusted-LAN convenience lock, not hardened auth: traffic is plain HTTP on your own
network.

## Message bus

Off by default. `"bus": { "enabled": true }` in `lol.config.json` (or the panel's plugin toggle, for the
session) makes the farm the meeting point for microcontrollers and Computers on the LAN: **one in-memory
topic space behind three doors**, so an ESP32 on MQTT, a browser page on WebSocket and TouchDesigner on OSC
see the same messages. Node's standard library only (`src/bus.js`, run as its own process so a flood never
reaches the seat gate), nothing to install. It binds to `proxy.host` like the other plugins, starts once
the farm is public, and is advertised in the snapshot as
`bus: { mqtt: "mqtt://<host>:1883", ws: "ws://<host>:8893", osc: "udp://<host>:9001", auth }` only while it
answers (`auth` = a farm password is needed; the password itself is never there).

| Door | Port | Speaks |
|---|---|---|
| MQTT 3.1.1 broker | `bus.mqttPort` 1883 (TCP) | CONNECT, PUBLISH (QoS 0; QoS 1 and 2 are acknowledged and delivered at QoS 0), SUBSCRIBE with `+` and `#`, UNSUBSCRIBE, PING, DISCONNECT. A client silent for 1.5× its keep-alive is dropped; a reconnect with the same client id replaces the old session. |
| WebSocket hub | `bus.wsPort` 8893 | JSON text. Send `{"sub": "sensors/#"}` (answered `{"subscribed": "sensors/#"}`), `{"unsub": "…"}`, `{"pub": "lol/board1/led", "data": 0.5}`; receive `{"topic": "…", "data": …}`. A bad message gets `{"error": "…"}`. `GET /health` answers counts. |
| OSC relay | `bus.oscPort` 9001 (UDP) | `/light 0.5` is published on `osc/light` with data `0.5` (several arguments → an array). `/lol/listen <filter> [password] [reply port]` sends every matching message back as OSC (address `/` + topic) for 10 minutes — send it again to stay; the relay answers `/lol/listening <filter>`. The reply port is for tools that send from one port and listen on another (TouchDesigner, Max). `/lol/unlisten [filter] [reply port]` stops it. |

**Payloads.** An MQTT payload that parses as JSON reaches WebSocket and OSC as that value, anything else
as its text. A value goes to MQTT as its JSON text, except a string, which goes as itself (`on`, not
`"on"`). OSC out: an integer → `i`, another number → `f`, a string → `s`, true/false → `T`/`F`, an array →
its items, an object → its JSON text. Every door delivers to every matching subscriber, the sender included.

**Auth** follows the farm password: MQTT wants username `lol` + the password (CONNACK 5 otherwise), the
WebSocket wants `?key=<password>` on its URL (401 otherwise), `/lol/listen` wants it as its second argument
(ignored otherwise). A new password reaches the bus within one health tick (~10 s) and ends every session
made with the old one. On a keyed farm, OSC *writes* stay open — ordinary OSC tools cannot log in — but only
under `osc/…`; reading anything needs the password. An open farm asks for nothing.

**Limits.** 256 connections per door, 64 KB per MQTT packet or WebSocket message, 200 messages/s per
client (the excess is dropped and the log says so once), 64 subscriptions per client. Not built: retained
messages, persistent sessions, wills, exactly-once QoS 2, TLS (plain text on your own LAN, like the rest of
the farm). The log shows counts and refusals, never a message.

**Try it** (`-u`/`-P` only on a farm with a password):

```bash
mosquitto_sub -h <farm> -t 'sensors/#' -v -u lol -P <password>
mosquitto_pub -h <farm> -t sensors/test/light -m '{"light":512}' -u lol -P <password>
```

[MQTT Explorer](https://mqtt-explorer.com) works too: host `<farm>`, port 1883, username `lol`, the
password. In a browser's developer console:

```js
const ws = new WebSocket('ws://<farm>:8893/?key=<password>');
ws.onmessage = (e) => console.log(e.data);
ws.onopen = () => ws.send(JSON.stringify({ sub: 'sensors/#' }));
```

An ESP32 that publishes a light reading and takes its LED from the bus:
[`docs/examples/arduino/lol_mqtt`](../docs/examples/arduino/lol_mqtt/lol_mqtt.ino).

## Admin HTTP API

The panel is a thin page over these routes on `beacon.httpPort` (41997), bound to `proxy.host`. Every
`/lol/admin/*` route needs `Authorization: Bearer <admin token>`; the rest are open. Routes that reload a
model return at once with a job, whose progress rides `GET /lol/admin/state` (one job at a time — others
get *"the farm is busy"*).

| Route | Does |
|---|---|
| `GET /lol/self` | The discovery snapshot (open, CORS `*`), plus `capacity.mine` for the caller. Its shape, and who reads each field: [`contract/snapshot.schema.json`](contract/snapshot.schema.json). |
| `POST /lol/client-ping` | Client presence heartbeat (open). |
| `GET /lol/admin` | The panel page (open — it asks for the token). |
| `GET /lol/capacity` | The capacity explorer (open, read-only): usage scenarios and a models × hardware table, this box marked from `/lol/self`. Its scripts and data are `/lol/capacity/{estimator.js,scenarios.js,catalog.json,measured.json}` (`src/capacity/`); it asks nothing off the farm. How to rebuild: [docs/spike/explorer](../docs/spike/explorer/README.md). |
| `GET /lol/admin/state` | Everything the panel renders. |
| `POST /lol/admin/apply` | `{ name?, slots?, password?, context?, seatIdleSec? }` — the one **Apply changes**, one restart; `seatIdleSec` (60–3600) alone applies live, no restart. With vLLM also `{ model?, kvCacheGib?, dryRun? }`: `dryRun` answers `{ restart, changes }` and changes nothing. |
| `POST /lol/admin/backend` | `{ engine: "ollama" \| "llamacpp" \| "vllm" }` (`"external"` only while the file holds one) — switch engines. |
| `POST /lol/admin/vllm/check` · `/vllm/start` · `/vllm/stop` | Check this computer (and look for a vLLM to take over); start or stop the farm's vLLM (a job). |
| `POST /lol/admin/vllm/install` · `/vllm/download` | Install or update vLLM; download a list model `{ id }` — both in the download slot. |
| `POST /lol/admin/vllm/library/add` · `/vllm/library/remove` | `{ repo \| folder, label? }`; `{ id, deleteFiles? }`. |
| `GET /lol/admin/vllm/log?lines=200` | vLLM's own log, its last lines. |
| `POST /lol/admin/vllm/take-over` · `/vllm/take-over/undo` | Let the farm run the vLLM it routes to as an external server on this computer; undo it (until a setting changes or the farm restarts). |
| `POST /lol/admin/job/cancel` | `{ slot: "job" \| "download" }` — Stop on either bar. |
| `POST /lol/admin/name` · `/slots` · `/context` · `/security` | The single-field forms of Apply (`{ name }`, `{ slots }`, `{ tokens }`, `{ password }` — an empty password removes it). |
| `POST /lol/admin/llamacpp/model` · `/llamacpp/library/add` · `/llamacpp/library/remove` | Load a library entry or URL; edit the `.gguf` library. |
| `POST /lol/admin/model/start` · `/model/stop` · `/model/default` · `/model/alias` | Offer / stop / make default / rename an Ollama model (`{ id }`, `{ id, alias }`). |
| `POST /lol/admin/ollama/pull` · `/ollama/remove` | Download / delete an Ollama model. |
| `POST /lol/admin/plugin/<id>/enable` · `/disable` | Toggle web search / OCR / voice (session only). |
| `POST /lol/admin/plugin/recommend` | `{ id, on }` — recommend a client plugin (Blender) to the fleet (session only). |

## Config — `lol.config.json`

The CLI reads **`farm/lol.config.json`** (or `./lol.config.json` in your CWD) — `lol install` / `lol init`
scaffold it. [`lol.config.example.json`](lol.config.example.json) is a **template only**: editing it changes
nothing. Shape:

```jsonc
{
  "name": "Studio Farm",                       // friendly name shown in the client
  "modelAlias": null,                          // stable name for the default OLLAMA model (null = raw id);
                                               //   copied from llamacpp.alias on an engine switch
  "beacon": { "enabled": true, "group": "239.255.43.10", "port": 41998,
              "intervalSec": 5, "httpPort": 41997 },   // distinct from ComfyQ's 239.255.42.99
  "proxy":  { "port": 4000, "host": "0.0.0.0", "masterKey": null,
              "maxReplyTokens": 32768 },        // the longest reply (null = none): a default on Ollama and llama.cpp;
                                               //   a ceiling the farm's vLLM starts with
  "models": [ { "id": "gemma4:12b", "default": true },
              { "id": "qwen2.5-coder:14b", "alias": "coder" } ],  // per-model role alias
  "llamacpp": { "enabled": true,               // OPT-IN speed engine (default false) — serves ONE model as `alias`
                "alias": "assistant",          // the name clients see and auto-select
                "model": "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-UD-IQ2_S.gguf",
                "mmproj": "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/mmproj-F16.gguf",
                "contextLength": "auto",       // DEFAULT: the largest that fits the FREE VRAM (or a number)
                "gpuReserveGb": 0,             // GB "auto" leaves for another app on the GPU
                "parallel": 1,                 // concurrent slots; see "Multiple users & capacity"
                "kvUnified": true,             // ONE shared context pool across slots: a person alone gets
                                               //   the FULL window, people arriving share it dynamically
                                               //   (false = the old hard contextLength/parallel split)
                "kvCacheType": "q4_0",         // quantized KV — what makes a good quant fit 12 GB
                "cacheRam": "auto",            // host-RAM prompt cache (MiB): returning chats restore their
                                               //   KV instead of re-processing; auto = RAM/4, 8–32 GiB
                "flashAttention": true, "ngl": 999,
                "mtp": false,                  // needs a UD-Q2_K_XL+ quant — see the rule above
                "draftNMax": 2,                // with mtp on: tokens drafted per step
                "library": [ /* … */ ],        // the .gguf choices the panel offers (see below)
                "host": "127.0.0.1",           // LiteLLM is the only thing that talks to it
                "port": 8081, "binDir": null, "extraArgs": [] },
  "preinstall": [ /* … */ ],                   // models DOWNLOADED but never served (staged for the
                                               //   admin panel). Ships non-empty (~8.6 GB) — see below
  "recommendedClientPlugins": [],              // client-side plugins this farm recommends, e.g.
                                               //   ["blender"] — clients auto-apply what they can run
  "ollama": { "hosts": ["http://127.0.0.1:11434"],   // add more boxes ONLY if they're really up
              "numParallel": 2, "maxLoadedModels": 1, "flashAttention": true,
              "kvCacheType": "q8_0",           // quantized KV (DEFAULT q8_0): ~twice the context in the
                                               //   same VRAM, near-lossless; needs flashAttention; only
                                               //   applies to an Ollama the farm starts
              "keepAlive": "-1",               // keep models warm in VRAM (no reload after idle)
              "contextLength": "auto" },       // num_ctx for OLLAMA models. DEFAULT "auto": probed per
                                               //   box (largest that stays in VRAM, 4096 if even 16k spills) — a number pins it
  "litellm": { "command": "litellm", "extraArgs": [], "provider": "ollama_chat" },
  "websearch": { "enabled": true, "port": 8888 },   // shared SearXNG → clients get web search
  "tts": { "enabled": false, "port": 8880,            // shared Kokoro voice (off by default — multi-GB install)
           "voice": "af_heart", "model": "kokoro" },
  "ocr": { "enabled": true, "port": 8890, "preprocess": false,   // shared document OCR (ON by default) — omit `model` to
           "format": "markdown",                       // auto-use the served default vision model; markdown|text|…
           "pdfEngine": "auto", "docling": false },    // auto: text layer / vision / hybrid on mixed pages; docling adds office formats
  "vllm": { "enabled": false,                  // OPT-IN: vLLM run by the farm (set by the panel; see below)
            "root": null, "distro": null,      // its folder in Linux (null = ~/lol-vllm, or an install found);
                                               //   the WSL distribution (null = WSL's default)
            "port": 8100, "alias": "assistant", "model": "qwen3.6-35b-a3b",   // a list id
            "contextLength": 65536, "parallel": "auto", "maxNumSeqs": "auto",
            "kvCacheGib": "auto", "ocrReserveGib": 9, "marginPct": 8, "minFreeGb": "auto",
            "version": "0.30.0", "extraArgs": [], "library": [ /* the three measured NVFP4 models */ ] },
  "coordinator": false                          // aggregate LAN peers into one balanced endpoint
}
```

> **Per-model names.** Every downloaded model is advertised under its **checkpoint id** unless you
> rename it: each served row in the panel's *Models · Ollama* card has a **Rename** button (empty =
> back to the checkpoint name), which writes the per-model `"alias"` in `models` and enforces
> uniqueness — the name IS the id clients request, so a duplicate would silently merge two models
> into one route. Precedence: a per-model alias > the global `modelAlias` (which only names the
> default model and is config-file only; the Backend card's **Name users see** shows on llama.cpp and vLLM and
> sets `llamacpp.alias` or `vllm.alias`). A name you gave the model survives an engine switch and a fallback
> (`carryNameAcross`), so bound chats keep working; an unnamed default is served under its raw id on
> Ollama, under `llamacpp.alias` on llama.cpp, and under `vllm.alias` on vLLM, so name the model first if chats should survive a
> switch ([Backends](#backends--ollama-default-and-llamacpp)).

**`llamacpp.library`** is the list of `.gguf`s the panel offers under *Use this*, so an operator can
switch weights without hunting for URLs. Each entry is
`{ id, label, url, mmproj, sizeGb, mtp, note }` — only `id`, `label` and `url` are required. `mtp` marks
a quant that still carries its MTP head; it defaults to `false`, the safe direction, because the farm
reads it to decide whether it must turn speculative decoding **off** when you switch onto that model.
The list is only a menu: `llamacpp.model` is what is actually served, and adding an entry downloads
nothing. It ships with four: the three 12 GB-class Qwen3.8-27B quants measured here, plus an NVFP4+MTP
build for Blackwell cards (16 GB+); replace it freely.

> **`ollama.contextLength` is farm-global but VRAM is per-host.** A mixed fleet is served by whichever
> single value is set here, and it rides the generated routing (`num_ctx` per deployment), so it applies
> even on hosts this CLI never started.

- **Model choice** — on the default Ollama engine the picker offers `models` (or `lol models add`, or
  the `lol up` picker), and the `default` entry is what clients auto-select; with llama.cpp serving,
  the one model is `llamacpp.model`, with vLLM serving it is `vllm.model` (an id of the vLLM list), and
  `models` is standby (not routed or advertised). Full recipe:
  [Adding or changing models](#adding-or-changing-models). Each Ollama host becomes a deployment of the
  same `model_name`, so LiteLLM load‑balances + fails over automatically.
- **Model aliases (important for stable chats):** an OWUI chat binds to the model *id* it started with —
  swap the served model and old chats break. With an alias (global `modelAlias` for the default model,
  per‑model `alias` for others), clients see a **fixed id** ("assistant", "coder") and you can swap what's
  behind it anytime (`lol up`, pick another model) without breaking a single chat.
- **Web search (ON by default):** `websearch.enabled` defaults to **`true`**, so a fresh farm hosts
  **one shared [SearXNG](https://docs.searxng.org)** on this box with no config edits. It's installed into
  `farm/.searxng/` at `lol install` time (and re‑checked on `lol up`; delete that folder to uninstall).
  Clients discover it via the beacon and OWUI's per‑chat web‑search toggle just works, zero client
  setup (off by default; the globe button turns it on for a chat). Searches + page fetching run from each client
  (since client web search v2, its main process asks this SearXNG and reads the top pages itself); this box only
  hosts the metasearch engine. Turn it off with `"websearch": { "enabled": false }` or `lol up --no-websearch`.
  **Engines** (the generated `farm/.searxng/settings.yml`, v4 since 2026-10-06): only the engines that answered
  when probed from one box, plus two with their own index that fail fast where refused — `duckduckgo web`,
  `bing`, `seznam`, `mojeek`, `qwant`, `swisscows`, `wikipedia` (`keep_only`: the ~250 others are not even
  loaded; no Yandex, the owner's call). Swisscows (Swiss, no account, no key) joined in v4: with it, the answer was
  in what the model reads for 17 of 18 fresh questions, 13 without (the French ones 9/9 against 7/9); the stock
  settings mark it inactive, so it is switched on as well as kept. Moderate safe search, the question's own
  language, engines cut at 3 s (5 s at most), and a longer back-off (10 min, 1 h for a CAPTCHA) when an engine
  refuses this box's IP. A file `lol up` generated earlier is rewritten to v4 on the next `lol up`, keeping its
  secret; a hand-written one is yours and is left alone.
- **Document OCR (ON by default):** the farm hosts **one shared OCR / document‑extraction service** on this
  box, so clients get scanned‑document + image OCR with zero setup — OWUI uses it as its content‑extraction
  engine, routing images + scanned PDFs to a **vision model on this box's Ollama**
  ([Ollama‑OCR](https://github.com/imanoop7/Ollama-OCR), vendored) and born‑digital docs/PDFs to fast local
  extraction. Installed into `farm/.extract/` at `lol install` time, re-checked on `lol up` (torch‑free;
  reuses the vision model you already serve — `ocr.model` overrides which). Note it routes *all* of OWUI's document ingestion through the farm —
  opt a box out with `"ocr": { "enabled": false }` or `lol up --no-ocr`. The light path covers
  images/PDF/docx/pptx/xlsx/text, and `"docling": true` adds the rest (legacy `.doc`/`.ppt`/`.xls`,
  `.odt`/`.epub`/`.rtf`) at the cost of a multi‑GB torch install. Delete `farm/.extract/` to uninstall.
  The vision calls take turns — one at a time (`OCR_CONCURRENCY` in the farm's environment raises it),
  the rest **wait**, never refused — so a room dropping scans at once queues on the GPU instead of
  stacking up beside chat; text-layer pages and office files never wait. Its log line counts pages,
  never a file's name.
- **Classify — Laya (OFF by default, 2026-09-27):** the Laya decision model (convaiinnovations/laya,
  Apache-2.0) for the Computer's **Classify** box: one multiple-choice question answered for every item of
  a list, with a confidence. `"classify": { "enabled": true, "port": 8891, "threads": 4, "maxItems": 200 }`.
  `lol up` builds its own venv under `farm/.classify` (torch from the **CPU** index, ~0.9 GB, and
  `laya==0.3.20`); the service downloads ~0.8 GB of weights at its first start and warms the model before
  `/health` answers, so clients only ever see a service that answers quickly. It is ours
  (`src/pysvc/classify_server.py`), not `laya-serve`: a Bearer key advertised in the snapshot as
  `classify: {url, key}` (the same LAN trust as the OCR key), one forward pass at a time, one request in
  flight per client, then 429 + `Retry-After`; `choice` questions only (2–20 options); no request body is
  ever logged. Measured on the dev box's CPU: 13.7 s cold, then ~0.2 s per item. It shares the CPU with
  everything else, so run `lol bench` with it busy before turning it on for a class. The panel's plugin
  toggles list it (a toggle lasts the session; `classify.enabled` in the config makes it permanent).
  `rm -rf farm/.classify` uninstalls it.
- **Speech to text (OFF by default, 2026-09-27):** for the Computer's Sound box in **Listen** mode.
  `"stt": { "enabled": true, "port": 8892, "model": "small", "threads": 4, "maxMb": 25 }`. `lol up` builds
  `farm/.stt` with **faster-whisper 1.2.1** — the library and version Open WebUI uses on the client (MIT),
  CPU int8, no torch (~0.3 GB); the model (`small` ≈ 0.5 GB, `base` ≈ 0.15 GB) downloads at the first start.
  Ours (`src/pysvc/stt_server.py`), by the OpenAI contract `POST /v1/audio/transcriptions`, advertised as
  `stt: {url, key}`: a Bearer key, one transcription at a time, one request per client, 429 +
  `Retry-After`; the recording is read into memory, transcribed and dropped — never logged or kept.
  Measured on the dev box's CPU: `small` writes down a 7.4 s clip in 2.1 s. Confucius4-R2T2 (streaming,
  GPU, Linux/vLLM) is not installed: read its weight licence first, then run it yourself. `rm -rf farm/.stt`
  uninstalls it.
- **Message bus (OFF by default, 2026-09-27):** an MQTT broker, a WebSocket hub and an OSC relay on one
  topic space, so boards and Computers on the LAN meet at the farm.
  `"bus": { "enabled": true, "mqttPort": 1883, "wsPort": 8893, "oscPort": 9001 }`. Nothing to install. See
  [Message bus](#message-bus).
- **Admin panel (running the farm):** while `lol up` runs, open `http://<box>:41997/lol/admin` (the
  beacon `httpPort`) from any browser on the LAN — or click **"Manage this farm"** in the desktop
  client's fleet popover. The Farm app shows the same page as its own window. It is where the farm is
  run: which **engine** serves (Ollama, llama.cpp or vLLM) and which `.gguf` or vLLM model it loads, vLLM's
  install, downloads, Start and Stop (the vLLM card), the **name users see**, **how many people**
  it serves at once, the **context window** (applied to whichever engine is serving), the **Ollama
  catalog** (download / offer / delete / make default), the **plugins** (web search / voice / OCR) and
  the Blender recommendation, and the **connected clients** (hostname, IP, app version, idle time —
  clients report presence every ~10 s and drop off ~30 s after closing), against the slot count.
  Clients pick every change up within ~5 s. Everything except the plugin toggles and the Blender
  recommendation is **written back to** `lol.config.json`, so it survives a restart; see
  [What the panel changes, and what it does not](#what-the-panel-changes-and-what-it-does-not).
  Auth: the **admin token printed in the `lol up` banner** (regenerated each run; set
  `"admin": { "token": "…" }` in `lol.config.json` for a fixed one). The Farm app pins one and
  seeds it into its own window; its Settings ▸ **Panel access token** (Copy) is how you drive the
  panel from another computer's browser — with **Share compute** on (a private farm binds the panel to
  `127.0.0.1`), open `http://<its LAN address>:41997/lol/admin` there and paste the token. The HTTP
  routes are listed under [Admin HTTP API](#admin-http-api). Its **Plan capacity ↗** link (no token
  needed) opens the capacity explorer at `/lol/capacity`: usage scenarios (documents for 5, vibe-coding
  for 10, a class of 30…) with the hardware and model that serve them, and this box marked.
- **Multiple GPU boxes:** either list every box in `ollama.hosts` (one farm balances them all), or run
  `lol up` per box and let clients auto‑spread (they pick the least‑loaded farm), or run one box with
  `--coordinator` to aggregate the others behind a single endpoint that clients prefer.
- **`proxy.masterKey`** — leave `null` for an open proxy on a trusted LAN, or set a key clients must
  send (`Authorization: Bearer <key>`).
- **`proxy.maxReplyTokens`** (default `32768`; `null` = no limit) — the most a reply may write, thinking
  included. Open WebUI's chats and LOL Vibe's name no limit of their own. The Computer names one (16,384 at most
  for code or an agent step, 8,192 for a text answer or a verdict), so does the coding agent (16,384 at most,
  with Keep going on), and an agent page asks 2,048 unless its code asks more. On Ollama and llama.cpp the
  farm's limit is a default for a request that names none; on vLLM it is a ceiling for every request (below).
  - **Why.** A model sometimes falls into a loop and never ends its reply. Replaying Open WebUI's real
    follow-ups on vLLM + Qwen3.6 (2026-10-05), 8 of 500 replies (1.6 %) did. On vLLM such a reply runs until
    the 64k window is full: ~290 s of a seat, ~57k tokens, then an empty answer. Ollama 0.34 does not stop at
    its window: it starts its runner with `--context-shift` and goes on until 10 times the window, where 0.33
    and 0.34 end a reply that names no limit. That is over a million tokens on a 128k window. (A 512-token
    window wrote 1,000 tokens when asked to, and was still writing 150 s later with no limit.)
  - **Why 32,768.** The longest real replies measured that day: 9,747 tokens in Open WebUI (717 chat calls;
    one more, 22,552 tokens, looped through most of its thinking before it ended), 15,357 on the spike's
    quality set with thinking on (and one answer in 84 still thinking at the set's 16,384 limit), and 15,515
    for a correct Computer agent step with thinking on. 32,768 is twice the longest, and Qwen's own
    recommended output length.
  - **What a person sees when it hits.** The reply stops there. Every loop measured (15 of 15) was still in
    its thinking, so Open WebUI shows the thinking and an empty answer, as before, but after 32,768 tokens
    instead of the whole window: 164 s alone on the PRO 6000 (measured through the farm's LiteLLM),
    4–6.5 min while 32 others generate. LOL Vibe offers Continue on a reply that stopped there. A real
    answer that long would end mid-sentence; none was measured.
  - **On Ollama and llama.cpp, a default.** LiteLLM sends it as the default `max_tokens` (Ollama's
    `num_predict`) on those routes, and puts a request's own values over a route's: a request asking 40,000
    gets 40,000. (llama-server obeys a request's `max_completion_tokens` over the route's `max_tokens`, above
    or below it.)
  - **On vLLM, a ceiling.** The route sends vLLM no limit: vLLM refuses a request whose prompt plus
    `max_tokens` passes its window (a 33k-token document on a 64k window would get a 400). The farm starts its
    vLLM with the number instead (`--override-generation-config '{"max_new_tokens": 32768}'`; changing the key
    restarts vLLM), and vLLM 0.30 holds every request to it: each gets the smallest of what the window leaves,
    its own limit and 32,768, so a request asking 40,000 gets 32,768. No first-party caller asks more than
    16,384, so it cuts none of them.
  - **On an external server, this key changes nothing.** `serve.sh`'s own defaults (a vLLM started by hand)
    hard-code 32,768: to change it, edit `serve.sh`, or pass your own `--override-generation-config` with
    `max_new_tokens` in it. Any other external server (SGLang, TensorRT-LLM, a vLLM started without that flag)
    gets no limit from the farm.
  - **Checked by** `npm test` (the routes) and `test/litellm-cancel.js` (what the engine is told, per route,
    with and without a request's own `max_tokens` or `max_completion_tokens`, below the limit and above it).
- **`proxy.host`** — where the farm listens: the seat gate, `/lol/self` + the admin panel, **and** the
  plugins (SearXNG, OCR, Kokoro), which follow it. `0.0.0.0` (default) = the LAN; `127.0.0.1` = this
  machine only (the Farm app's private mode, with `beacon.enabled: false`) — the plugin URLs then
  advertise `127.0.0.1`, which is what a client on the same box needs.
- **`external`** — route to an OpenAI-compatible server the farm does **not** run (SGLang, TensorRT-LLM, a
  server on another machine, a vLLM or llama-server you started yourself). The fourth engine, exclusive like
  the others and above them all (`engineOf`: external > vllm > llama.cpp > Ollama): while it serves, no local
  Ollama deployment is routed or advertised. Use it for stacks we can never bundle
  — a Docker vLLM recipe, or NVFP4 W4A4 weights (vLLM/SGLang-only, Blackwell). Example:
  ```json
  "external": {
    "enabled": true,
    "alias": "assistant",                       // what clients see and auto-select
    "baseUrl": "http://127.0.0.1:8000/v1",      // include /v1
    "model": "deepseek-v4-flash-0731",          // null = send the alias through unchanged
    "apiKey": null,                             // most local servers are keyless
    "contextLength": 384000, "parallel": 8,     // DECLARED — the farm cannot read these back
    "vision": false, "label": "DeepSeek v4 Flash (vLLM)",
    "presencePenalty": null                     // presence_penalty for requests that name none (null = none)
  }
  ```
  `presencePenalty` is a default the farm's LiteLLM adds to every request that names no `presence_penalty`
  (a request's own wins): 1.5 for Qwen3.6, which otherwise loops ([Replies that never end](#replies-that-never-end)).
  The farm does everything **around** the model — discovery, the seat gate, the shared password, OWUI
  wiring, web search, the panel — and never installs, starts, restarts or configures the server. It
  polls `GET {baseUrl}/models`: unreachable at boot → it falls back to the built-in engine with the
  reason in the panel; dying later → the farm goes unhealthy so clients fail over, exactly like a dead
  llama-server. `contextLength`/`parallel` are declarations, not measurements (no portable endpoint
  reports them), and they size the client's whole-document gate and the seat count — so get them right.
  The panel shows an **External server** button only while the file holds this block (a developer wrote it),
  and switching away from it works from the panel; it never offers it otherwise. The tested vLLM recipe is
  [External: a vLLM you run yourself](#external-a-vllm-you-run-yourself); a vLLM on this computer started that
  way is offered to the farm to run ([vLLM, run by the farm](#vllm-run-by-the-farm), "Taking over").

  **When the external server is a vLLM** (its `/metrics`, at `baseUrl` without the `/v1`, carries `vllm:`
  series — nothing to configure), the farm reads it on the health tick it already runs: the
  snapshot's `capacity.busy` / `capacity.queued` come from `vllm:num_requests_running` /
  `vllm:num_requests_waiting`, and the panel shows a **Performance card** for it (below). It also
  reads the KV pool vLLM really allocated (`vllm:cache_config_info`: `kv_cache_size_tokens` on
  vLLM ≥ 0.25, else `num_gpu_blocks × block_size`, which over-counts a hybrid model) and **warns** —
  at `lol up` and on the card — when `parallel × contextLength` exceeds it: *"the declared seats can't
  all hold their full window at once"*. The seats stay `parallel` and `slotsVerified` stays `false`:
  the metrics can prove a declaration does not fit, never that it does (they carry neither
  `max_num_seqs` nor `max_model_len`), and refusing people on a pessimistic guess is worse than the
  queueing it would avoid (owner, 2026-09-07). Any other server (SGLang, a llama-server) is not read:
  no card, `busy`/`queued` stay `null`. The farm's own vLLM is read the same way (the Performance card,
  `busy` and `queued`), but its seats and window are the ones the farm started it with, so `slotsVerified`
  is `true` there.
- **`vllm`** — vLLM run by the farm ([vLLM, run by the farm](#vllm-run-by-the-farm)). The panel sets every key:
  the engine switch writes `enabled` (exactly one engine flag is true after a switch); Install and the first
  start write `root` (absolute); Apply writes `alias`, `parallel`, `contextLength`, `kvCacheGib` and `model`;
  the list's Add and Remove write `library`. `root` is a Linux path (`~` allowed, no `..`); `port` is
  `serve.sh`'s relay on 127.0.0.1. `parallel`, `maxNumSeqs`, `kvCacheGib` and `minFreeGb` take `"auto"` (the
  rules are in that section) or a number; `ocrReserveGib` (9) is kept for document reading when OCR is on, and
  `marginPct` (8) of the card stays free. `version` is the vLLM `install.sh` installs. `extraArgs` go last on
  `vllm serve` (a take-over keeps there the flags a server ran with that the list's entry does not give). Each
  `library` entry is `{ id, label, repo, folder, sizeGb, weightsGib, vision, presencePenalty, args, catalog,
  measured, note }`: `id` (lowercase) is vLLM's `--served-model-name`, `folder` its folder in `<root>/hf`
  (default: the repo's name), `args` its own `vllm serve` flags, `catalog`/`measured` its entries in
  `src/capacity/` (memory per person, people measured). A farm-v0.0.42 or older refuses a file with this block.
- **`proxy.seatGate`** (default `true`) — the public `proxy.port` is the farm's own listener and
  LiteLLM binds loopback-only behind it (`proxy.internalPort`, default port+1), so the farm can
  ENFORCE who generates: an IP's first completion claims a **seat** (capacity = the engine's
  "people served at once"), every completion refreshes it, and a seat with no generation for
  **`proxy.seatIdleSec`** (default 900 = 15 min; 60 minimum) frees for the next person. The panel's
  **Free an idle seat after** sets it live, 1–60 min, no restart: a short hold (2 min) suits a
  workshop, where an idle seat should not block the next person. A generation on a full
  farm gets a clear 429 ("All N seats are in use…") instead of silently queueing behind idlers; its
  `Retry-After` is the seconds until the soonest idle seat frees (the whole idle window when every seat
  is generating: none frees sooner).
  With a `proxy.masterKey`, the gate checks it **before** seating anyone: a missing or wrong key
  gets a 401 and no seat. The gate's own 401, 429 and 502 carry `Access-Control-Allow-Origin: *` (as
  LiteLLM's answers do) and expose `Retry-After`, so an agent page on another origin can read them.
  Every route LiteLLM generates on is gated — chat completions, completions,
  responses, Anthropic's `/v1/messages`, Google's `:generateContent`.
  Reading old chats, notes and menus never touches the proxy (client-local by design), so an
  evicted idler only loses starting NEW generations while the farm is full. The gate forwards only
  the routes clients use: the generation routes above (seated), `GET /v1/models`, `/models`,
  `/v1/models/<id>`, `/model_group/info`, `/health/liveliness`, and their CORS preflights. Everything
  else (LiteLLM's admin API and `/ui`, its pass-through routes such as `/vllm/…`, embeddings, the full
  `/health`) gets the gate's own 404, and a path with a decoded `..`, `?` or `#` a 400. The panel is
  on its own port and never goes through the gate. Coarse by design: one IP = one seat; a coordinator peer farm
  counts as one seat on this box (its own gate does the per-user work). `false` restores the old
  direct LiteLLM bind.
- **`litellm.command`** — leave it `"litellm"` and the farm auto‑uses `farm/.venv` if `lol install`
  made one, else `litellm` from PATH. Set an absolute path only to point at a LiteLLM elsewhere.
- **Concurrency/keep‑warm env** (`OLLAMA_NUM_PARALLEL`, `OLLAMA_KEEP_ALIVE`, …) only applies when Ollama
  *starts*. If the CLI starts a local Ollama it sets them; if Ollama is already running, set them on that
  service. The CLI prints the recommended values (and the panel flags *"Capacity is unverified"*
  with the same line). Sizing rule: one Ollama runs `numParallel` generations
  at once (default 2) and queues the rest, while llama.cpp runs `llamacpp.parallel` (default **1**) —
  see [Multiple users & capacity](#multiple-users--capacity), and check with `lol bench`.

## What `lol up` does, in order

1. (`external.enabled`) Probe `GET {baseUrl}/models`: answering → the external server serves and
   llama.cpp stands down (a vLLM's `/metrics` is read once: its KV pool, and a warning when the
   declared seats × window exceed it); not answering → fall back to the built-in engine for this run
   (panel says why).
   - (vLLM, another engine chosen) A vLLM this farm started (its marker) that still runs from its folder is
     stopped: a crash in the middle of a switch must not leave two engines on one GPU.
   - (`vllm.enabled`) Check this computer once (`status.sh`; on Windows through WSL). A vLLM that runs with
     these settings is kept at once; one still starting is waited for, one launched otherwise restarts, and
     otherwise one starts, both at step 13, once the farm is public. What blocks it (not installed, no model,
     WSL) → Ollama for this run, with the reason on the panel.
2. Ping each Ollama host (start a **local** one if it's down, with the concurrency/keep‑warm env). No
   reachable host → exit: Ollama is required even when another engine serves.
3. (Ollama engine) **Pick the model(s) to serve** — interactive from what's installed (Enter = default),
   or `--model` / `--no-pick` / non‑TTY = the config catalog.
4. Pull any picked (and `preinstall`) model missing on a reachable host; derive `source` models.
5. (llama.cpp, if enabled) Ensure the pinned `llama-server` build + CUDA runtime, ensure the `.gguf`
   weights + projector (**downloads several GB on a first run** — normally already done at
   `lol install`), spawn it, and health‑wait `/health`. A start failure here falls back to the Ollama
   engine (the panel shows why) and names the likely cause (see the quant ↔ `mtp` rule).
6. (Ollama engine — configured, or after a fallback) Size the context: the `"auto"` probe, cached per
   box after the first time.
7. (`--coordinator`) discover LAN peer farms and fold them into the routing.
8. Generate `litellm/config.generated.yaml` (the serving engine's deployment(s) + peers).
9. Spawn LiteLLM (on `127.0.0.1:proxy.port+1` with the seat gate on), wait for `/health/liveliness`,
   confirm `/v1/models`.
10. (websearch/OCR, on by default) Ensure each is installed (normally already done at `lol install`;
    installs here if missing) + spawn it, bound to `proxy.host`, and health‑wait it. Non‑fatal: the farm
    still serves chat.
11. Start the seat gate on `proxy.port` (LiteLLM stays on loopback behind it), then the discovery beacon
    (+ the unicast `/lol/self` endpoint + the admin panel).
12. Write `.lol-runtime.json` (so `status`/`down` work elsewhere; for vLLM, where it lives, not a pid) and
    supervise until Ctrl‑C (which stops vLLM too).
13. (vLLM) Start it, or wait for it, as the job "Starting vLLM": the farm stays healthy and says busy, and the
    gate answers a chat with "starting" until it is ready. (An external server on this computer) Look for a
    vLLM the farm could run, for the panel's take-over offer.

## If the farm won't start

| Symptom in the log | Cause | Fix |
|---|---|---|
| *"Bootstrap incomplete"* from `lol install`, no proxy afterwards | No Python 3.9–3.13 found | Install Python, re-run `lol install` (it's idempotent) |
| LiteLLM exits immediately; `ImportError: cannot import name 'get_flat_dependant'` | fastapi outside the supported bound | `pip install "fastapi>=0.136.3,<0.140.7"` into `farm/.venv` |
| `ENOENT` spawning litellm | `litellm.command` points nowhere / no venv | Run `lol install`, or set `litellm.command` to an absolute path |
| llama-server exits: *"model doesn't contain MTP layers"* | `mtp: true` on a quant whose head was stripped (below `UD-Q2_K_XL`) | Set `mtp: false`, or use a UD-Q2_K_XL+ quant |
| llama-server never becomes healthy, no clear error | Weights + KV don't fit VRAM, or a mismatched `mmproj` | Lower `contextLength`/`parallel`, check `mmproj` matches the model family |
| *"Farm already running"* / a stale port | A previous run wasn't torn down | `lol down`, then `lol up` |
| Port already in use (4000 / 4001 / 41997 / 8081 / 8888 / 8890) | Another process (or an orphaned plugin) holds it | `lol down`; if it persists, change the port in `lol.config.json` (the Farm app moves 8888 / 8890 itself) |
| *"Message bus did not start"* | Another MQTT broker (Mosquitto) or OSC tool holds 1883 / 8893 / 9001 | Stop it, or change `bus.mqttPort` / `wsPort` / `oscPort`; the farm serves chat without the bus meanwhile |
| The panel says *"vLLM could not start: … The farm serves with Ollama for now."* | Something the vLLM card's checklist lists (no WSL, no C compiler, the model not downloaded, too little disk), another program on vLLM's port, or vLLM's own error | Do what the checklist or vLLM's log (*Show the log*) says, then press **vLLM** on the *Backend* card again. The farm keeps serving with Ollama meanwhile |

## Notes / gotchas

- **Windows + LiteLLM banner:** the proxy is spawned with `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8`
  so its Unicode startup banner doesn't crash on a cp1252 console (`UnicodeEncodeError`).
- Generated/runtime files (`litellm/config.generated.yaml`, `.lol-runtime.json`, `.lol-id`, `.lol-secret`) and every
  on-box runtime dir (`.venv`, `.searxng`, `.extract`, `.kokoro`, `.models`, `.llamacpp`) are
  gitignored — never commit them. `.models` and `.llamacpp` are the big ones (GBs).

## Develop / test

```bash
npm test                      # unit tests for config, LiteLLM generation, snapshot, helpers
node test/litellm-cancel.js   # does a person's Stop reach the engine? and thinking off? (starts a real LiteLLM, ~30 s)
LOL_VLLM_FAKE=1 node test/vllm-lifecycle.js   # vLLM run by the farm, end to end with a fake vLLM (inside WSL on Windows): a few minutes, no GPU
bash vllm/test_scripts.sh     # the vLLM scripts with the fake (Linux; Windows: wsl -d Ubuntu --cd <repo>\farm\vllm -e bash ./test_scripts.sh)
```

Run the two vLLM checks after touching `src/vllm.js`, the vLLM half of `src/commands/up.js` or `farm/vllm/`.

`npm test` checks the snapshot of every engine (`contract/examples.js`, which also holds what farm-v0.0.41
sent) against `contract/snapshot.schema.json`, so a new snapshot field fails until it is declared there.
Declare it optional, because farms are updated by hand and clients meet old ones, with a line on who reads
it. The exceptions are inside `host` and `perf`: their shapes belong to `systemInfo.js` and `perf.js` and stay
open. The client reads the same examples in `shell/test/chat/unit/farm-contract.test.mjs`.

`npm test` also runs `src/pysvc/check_services.py` — the Classify and speech-to-text services' refusals
(key, size, busy), their queue bookkeeping and their stop-when-the-client-leaves, and the OCR service's
turn-taking on vision calls, against stub models (no Laya, no Whisper, no Ollama) — when it finds a Python
with `fastapi` + `httpx` (`LOL_PYSVC_PYTHON=<python>`, or the `.classify` / `.stt` venv if one has httpx).
Without one it says "skipped".

`test/litellm-cancel.js` routes the farm's own generated config (the `hosted_vllm/`, `openai/` and
`ollama_chat/` shapes) to a fake engine on loopback, behind the real seat gate, aborts streaming and
non-streaming calls, and checks the engine sees each request close within 2 s with no retry. It also checks
that `drop_params` keeps the thinking-off pair the client sends on the structured calls that do not think
(owner decision 9; yes/no decisions think since 2026-10-05):
`chat_template_kwargs: {enable_thinking: false}` reaches the engine on `hosted_vllm/` (vLLM, the farm's own or an
external one: one route shape) and
`openai/` (llama-server, coordinator peers), and
`think: false` becomes Ollama's own field on `ollama_chat/`. And it checks the reply limit
(`proxy.maxReplyTokens`): a request naming no limit reaches Ollama with `num_predict` 32768 and llama-server with
`max_tokens` 32768, vLLM (the farm's or an external one) with none, and a request's own `max_tokens` or `max_completion_tokens`
(what the coding agent sends) gets through untouched, 77 or 88 below the limit and 40,000 above it (only a
number above it tells a default from a ceiling). Run it after bumping the LiteLLM pin
(`LOL_LITELLM=<path to litellm>` tests another install).

**With a real engine** (opt-in, documented in the file's header), the check proves that generation itself
stops, timed by the engine's own task log:

- `LOL_CANCEL_ENGINE=ollama LOL_CANCEL_MODEL=<small model>` uses the running daemon and unloads the model
  afterwards.
- `LOL_CANCEL_ENGINE=llamacpp LOL_CANCEL_LLAMA_SERVER=<exe> LOL_CANCEL_GGUF=<file>` starts its own
  llama-server.
- `LOL_CANCEL_ENGINE=vllm [LOL_CANCEL_VLLM=http://127.0.0.1:8100/v1]` uses a vLLM that is already running
  (`farm/vllm/serve.sh`). Its evidence is vLLM's `/metrics`, read 2 s and 3.5 s after each abort: requests
  running, tokens generated, and requests that ran to `max_tokens`.

Measured 2026-10-05: **vLLM 0.30.0** (Qwen3.6, through `farm/vllm/relay.py`) stops on all 10 paths. That
covers streaming and not, direct, through LiteLLM, and through the seat gate, both alone and while another
person streams. Alone, the GPU idles 0.2–0.6 s after the abort and no token follows. While someone else streams,
only their request is left running.

Measured 2026-10-04:

- **Ollama 0.34** stops on every path within 16–71 ms.
- **llama.cpp b10670** stops streams within ~10 ms, but a **non-streaming call abandoned while someone else
  streams runs to its end**. This is an upstream bug: the disconnect check sits on a 1 s wait that every
  other request's result restarts. It is still there in b11406 (2026-10-05). Open PR
  [#29707](https://github.com/ggml-org/llama.cpp/pull/29707) fixes it. So the llama.cpp mode fails until a
  pinned build carries that fix. Bump the pin and re-run it. The reproduction is in
  `docs/upstream/LLAMACPP_NONSTREAM_CANCEL.md`.
