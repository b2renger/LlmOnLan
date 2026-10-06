# `lol` — the LlmOnLan farm CLI

A small Node CLI that turns one declarative `lol.config.json` into a running, LAN‑discoverable
inference farm. It brings up the inference engines — **[Ollama](https://ollama.com)** (the multi‑model
catalog, and the **default backend** — serving `gemma4:12b` at its native 262k context out of the box)
and **[llama.cpp](https://github.com/ggml-org/llama.cpp)** (`llama-server`, the opt‑in speed engine) —
**generates** a
[LiteLLM](https://docs.litellm.ai) proxy config that fronts both as one OpenAI‑compatible,
load‑balanced endpoint, runs the proxy, and broadcasts a UDP discovery beacon so clients find it with
no URL typed. Model choice lives in the config — the CLI never hand‑edits routing.

> **New to the two‑engine setup?** Read [Backends](#backends--ollama-default-and-llamacpp) first — it
> decides where you add a model and what a client actually gets.

> **Not comfortable in a terminal?** The **[LlmOnLan Farm app](../farm-app/)** is a downloadable
> installer that runs this exact CLI for you — it downloads its own Ollama + Python, fetches the
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
the desktop clients auto‑discover it. To change which models are served, edit `models` in
[`lol.config.json`](lol.config.example.json) (or `lol models add <id>`) and re‑run.

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
| `lol up` / `lol serve` | Ensure Ollama, **pick the Ollama model(s) to serve** (interactive, from what's installed; Enter = default), pull anything missing, start `llama-server` if enabled (fetching build + weights on first run), generate + run the LiteLLM proxy behind the seat gate, start SearXNG + OCR (if enabled) + the beacon + the admin panel. Foreground; Ctrl‑C stops. |
| `lol down` | Stop the proxy + `llama-server` + SearXNG + TTS + OCR + beacon (and any Ollama this CLI started). |
| `lol status` | Health of each Ollama host + the proxy + which models are loaded. Works from any shell. |
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

A farm knows **two** built-in engines — plus an operator-run [`external`](#config--lolconfigjson) server
(vLLM/SGLang, config file only) — and serves through **one at a time**. Knowing which one is serving is
the thing to understand before changing models or sizing for a group.

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

**A reachable Ollama is required even when llama.cpp or an external server serves.** `lol up` exits
with *"No reachable Ollama host"* if none answers: Ollama is the fallback engine, and document OCR
drives its vision model there. With another engine serving, a farm-started Ollama keeps models warm
for only 5 minutes, and **pressure eviction** unloads Ollama models when VRAM is ≥ 92 % full and the
GPU ≤ 20 % busy (never mid-extraction) — the farm log says so, and on llama.cpp (or an external vLLM)
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
people it serves at once. The two engines are a pair of buttons; picking the other one reloads the
model and regenerates the routing, in about a minute. It is also written to `lol.config.json`, so it
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

## Serving with vLLM on Windows (WSL2)

On a big card, vLLM serves far more people than llama.cpp. On the studio's RTX PRO 6000 (96 GB), the spike
([docs/spike/RESULTS.md](../docs/spike/RESULTS.md)) measured Qwen3.6-35B-A3B NVFP4 on vLLM at **96–128 people
at 32k of context each, 48–64 at 64k and 32–40 at 128k**. The best llama.cpp configuration served 4–8 people at
32k. vLLM runs only on Linux, so on Windows it runs in WSL2, **operator-run** as the farm's
[`external`](#config--lolconfigjson) engine (owner, 2026-10-04): you start it, and the farm routes to it and
reads its `/metrics`, but never installs, starts or stops it. The scripts are in `farm/vllm/`. Every step below
was run on that box on 2026-10-05.

**You need:** Windows 11 with WSL2 Ubuntu, the NVIDIA driver (the Windows one is enough), about 40 GB of disk
in WSL (the 23.5 GB model plus the venv), and [uv](https://docs.astral.sh/uv/) in WSL
(`curl -LsSf https://astral.sh/uv/install.sh | sh`). Below, `<repo>` is this repository seen from WSL, e.g.
`/mnt/c/Users/<you>/LlmOnLan`.

1. **Install, once** (about 15 min plus the download). This installs vLLM 0.30.0, the version measured, into
   `~/lol-vllm/.venv`, pins the CUDA compiler packages that FlashInfer's kernel build needs on this card, and
   downloads `nvidia/Qwen3.6-35B-A3B-NVFP4` into `~/lol-vllm/hf/`. Run it again to resume or repair.
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
   first, or restart the farm once vLLM is up.
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

**Why there is a relay.** Under WSL2's mirrored networking (`networkingMode=mirrored` in `.wslconfig`), vLLM's
own TCP port never answers. vLLM binds its port when it starts but only listens once the model is loaded,
1.5–2.5 min later, and mirrored networking stops forwarding a port that has been bound that long without
listening. SYNs then time out from WSL, and Windows gets "connection refused", even though `ss` shows LISTEN.
A plain Python socket reproduces it with a 75 s gap; with a 12–15 s gap it works. No vLLM flag changes when
vLLM listens. So `serve.sh` runs vLLM on a Unix socket (`--uds`), and `relay.py`, which listens as soon as it
binds, carries `127.0.0.1:8100` to that socket. Each connection is closed on both sides when either side
leaves, so a person's Stop still aborts vLLM's request: streaming or not, alone or while others stream,
through the seat gate and LiteLLM (`LOL_CANCEL_ENGINE=vllm node test/litellm-cancel.js`). The relay is harmless
on native Linux.

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
  `--max-model-len 32768` to `serve.sh`. For long documents, use `131072` with `32`. A cold 128k prompt takes
  ~8 s even alone (RESULTS.md, finding 8).
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

**Thinking.** Qwen3.6 thinks by default. The client turns thinking off for most of the Computer's structured
calls (lists, JSON, agent steps) with `chat_template_kwargs: {"enable_thinking": false}` and also sends
`think: false`, which vLLM ignores. LiteLLM's `drop_params` passes both through. A yes/no decision (a Condition,
a Filter) sends neither and thinks, and so does every structured call once a person ticks the Computer's
**Think all**. Chat messages and the Computer's prose and code answers never send them; Open WebUI's titles
and search queries do. Measured through the farm, one short answer took 393 completion tokens with thinking
and 14 without.

**LiteLLM's cost per streamed token.** Every token a person reads passes through LiteLLM, and LiteLLM is one
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
- **The fix.** The external engine's deployment is now `hosted_vllm/`, which uses LiteLLM's own HTTP client
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
    Phase 3.0), half a class streams through that peer deployment: move the external branch's peers to
    `hosted_vllm/` then, and measure.
- **What did not help.** LiteLLM's `--num_workers` loses connections on Windows: 12 and 21 of 100
  simultaneous streams never got an answer. Granian refuses to run several workers on Windows. With
  `hosted_vllm/`, a second LiteLLM on its own port bought only 0.2 s more at 140. On `openai/`, two
  processes landed where one `hosted_vllm/` process is, at twice the CPU. Granian with one worker changed
  nothing. The relay costs nothing: inside WSL, 140 streams through it and straight to vLLM's socket took
  the same 4.1 s.
- **What is left.** ~0.7 s at 140 people and 0.6–0.7 s at 100, with LiteLLM's one core full again. If the
  measured class sizes ever need it, the next step is for the seat gate to stream a lone external deployment
  straight to vLLM. It would skip LiteLLM for `POST /v1/chat/completions` only, and only while the external
  engine serves with no peers. A scratch prototype matched vLLM alone (4.1 s (5.3 s) at 140, 3.6–3.7 s at 100)
  at 0.2 of a core. It is ~60 lines in `seats.js` plus a thunk from `up.js`, and it has to take over:
  - **the name:** rewrite `model` from the alias to `external.model`, or start vLLM with the alias first in
    `--served-model-name`;
  - **the key:** send `external.apiKey` in place of the farm password;
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
- **The fix.** `"presencePenalty": 1.5` in `external` (step 3 above): the farm's LiteLLM adds it to every
  request that names none, and a request's own value wins. 1.5 is the model card's value; 1.0 did as well here.
- **What it costs.** Nothing this set can measure. On the spike's quality set (28 items: code checked by
  tests, exact answers, tool calls) with thinking on, 83 of 84 answers passed at vLLM's defaults, 81 of 84
  with 1.5 and 54 of 56 with 1.0. A difference of one or two items is within the set's noise, and every
  setting had an answer that thought past 16k tokens. With thinking off (how the Computer asks), 28 of 28
  passed with 1.5 against 26 of 28 without. Qwen warns of "slight performance decreases" and asks for 0 on
  precise coding; the coding agent's SDK sends no presence penalty, so it gets 1.5 too (code items: 28 of 30
  with it, 29 of 30 without).
- **The backstop.** `serve.sh` also gives vLLM a reply limit of 32,768 tokens
  (`--override-generation-config '{"max_new_tokens": 32768}'`, the farm's `proxy.maxReplyTokens`), so a loop
  that still happens holds a seat for half as long. On vLLM 0.30 it caps every request, not only those that
  name no `max_tokens`: a request asking 40,000 gets 32,768 (see
  [`proxy.maxReplyTokens`](#config--lolconfigjson)). If you pass your own `--override-generation-config`, it
  replaces this one: put `max_new_tokens` in yours.
- **Checked end to end** through the farm's own LiteLLM config, with vLLM started by this `serve.sh`: the same
  follow-ups twice each, with no `max_tokens`. With `presencePenalty: 1.5`, 0 of 424 looped. With each request
  sending its own `presence_penalty: 0` (it wins), 6 of 424 looped and every one stopped at exactly 32,768
  tokens. The set's longest prompt, 47,117 tokens, was still answered, with what the window left. Each run sent
  428 requests: the 4 not counted are 2 prompts longer than the whole 64k window, sent twice, which vLLM
  refuses with or without a limit. In a separate check through the same stack, a 39,223-token prompt with no
  `max_tokens` was answered, and the same prompt sending `max_tokens: 32768` got vLLM's 400.

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
not a label bolted on top. Set it in the panel: on llama.cpp, *Backend* ▸ **Name users see**
(`llamacpp.alias`); on Ollama, the **Rename** button on each model row (`models[].alias`). `modelAlias`
is config-file only. While llama.cpp serves, the Ollama default's row has no Rename: a switch back gives
it llama.cpp's name, so it is renamed up in *Backend*.

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

The *Backend* card's settings — the name (llama.cpp), people served at once, the context window and the
farm password — are collected and applied by **one Apply changes** button: one restart for all of them,
not one per field. **Free an idle seat after** (shown while the seat gate is on) rides the same button but
restarts nothing: the gate reads `proxy.seatIdleSec` live, so set it to 2 min before a workshop and back
to 15 min after.

**Under an external server** the panel's engine controls are off: the engine buttons, name, slots and
context are refused (*"An external server is serving — set external.\* in lol.config.json and restart"*),
because that server's model, window and concurrency are its own. The farm password still applies. The
Ollama catalog is standby, exactly as under llama.cpp.

Only **one** long operation runs at a time — a download, a backend switch, a reload. Everything else is
refused with *"the farm is busy"* rather than queued, because two model reloads racing is how a farm ends
up with no backend at all.

## Multiple users & capacity

A farm is a shared box, and the honest limits are per-engine.

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
below hardware speed). On an [external vLLM](#config--lolconfigjson) the same card reads vLLM's
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
farm, where the keys stay in the snapshot as before). A new password takes effect there at once; a
client that fetched the keys under the old one keeps them. The keys are the same on every run (derived
from one secret in `farm/.lol-secret`, so a farm restart no longer restarts every client's Open WebUI);
delete that file and restart the farm to rotate them. What stays open, deliberately: discovery (`/lol/self`, the beacon) so
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
| `GET /lol/admin/state` | Everything the panel renders. |
| `POST /lol/admin/apply` | `{ name?, slots?, password?, context?, seatIdleSec? }` — the one **Apply changes**, one restart; `seatIdleSec` (60–3600) alone applies live, no restart. |
| `POST /lol/admin/backend` | `{ engine: "llamacpp" \| "ollama" }` — switch engines. |
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
                                               //   vLLM's is serve.sh's own number, a ceiling
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
  "coordinator": false                          // aggregate LAN peers into one balanced endpoint
}
```

> **Per-model names.** Every downloaded model is advertised under its **checkpoint id** unless you
> rename it: each served row in the panel's *Models · Ollama* card has a **Rename** button (empty =
> back to the checkpoint name), which writes the per-model `"alias"` in `models` and enforces
> uniqueness — the name IS the id clients request, so a duplicate would silently merge two models
> into one route. Precedence: a per-model alias > the global `modelAlias` (which only names the
> default model and is config-file only; the Backend card's **Name users see** is llama.cpp-only and
> sets `llamacpp.alias`). A name you gave the model survives an engine switch and a fallback
> (`carryNameAcross`), so bound chats keep working; an unnamed default is served under its raw id on
> Ollama and under `llamacpp.alias` on llama.cpp, so name the model first if chats should survive a
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
  the one model is `llamacpp.model` and `models` is standby (not routed or advertised). Full recipe:
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
  run: which **engine** serves and which `.gguf` it loads, the **name users see**, **how many people**
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
  routes are listed under [Admin HTTP API](#admin-http-api).
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
  - **On vLLM, a ceiling.** The farm sends vLLM no limit: vLLM refuses a request whose prompt plus
    `max_tokens` passes its window (a 33k-token document on a 64k window would get a 400). `farm/vllm/serve.sh`
    gives vLLM the number itself (`--override-generation-config '{"max_new_tokens": 32768}'`), and vLLM 0.30
    holds every request to it: each gets the smallest of what the window leaves, its own limit and 32,768,
    so a request asking 40,000 gets 32,768. No first-party caller asks more than 16,384, so it cuts
    none of them. If you run vLLM yourself, add that flag.
  - **On an external server, this key changes nothing.** `serve.sh` hard-codes 32,768: to change it, edit
    `serve.sh`, or pass your own `--override-generation-config` with `max_new_tokens` in it. Any other
    external server (SGLang, TensorRT-LLM, a vLLM started without that flag) gets no limit from the farm.
  - **Checked by** `npm test` (the routes) and `test/litellm-cancel.js` (what the engine is told, per route,
    with and without a request's own `max_tokens` or `max_completion_tokens`, below the limit and above it).
- **`proxy.host`** — where the farm listens: the seat gate, `/lol/self` + the admin panel, **and** the
  plugins (SearXNG, OCR, Kokoro), which follow it. `0.0.0.0` (default) = the LAN; `127.0.0.1` = this
  machine only (the Farm app's private mode, with `beacon.enabled: false`) — the plugin URLs then
  advertise `127.0.0.1`, which is what a client on the same box needs.
- **`external`** — route to an OpenAI-compatible server the farm does **not** run (vLLM, SGLang,
  TensorRT-LLM, a llama-server you started yourself). A third engine, exclusive like llama.cpp: while
  it serves, no local Ollama deployment is routed or advertised. Use it for stacks we can never bundle
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
  There is no panel switch for this one: set `enabled` in `lol.config.json` and restart the farm. A tested
  vLLM recipe for a Windows box is in
  [Serving with vLLM on Windows (WSL2)](#serving-with-vllm-on-windows-wsl2).

  **When the server is a vLLM** (its `/metrics`, at `baseUrl` without the `/v1`, carries `vllm:`
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
  no card, `busy`/`queued` stay `null`.
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
  evicted idler only loses starting NEW generations while the farm is full. `/v1/models`, health
  checks and the panel pass ungated. Coarse by design: one IP = one seat; a coordinator peer farm
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
12. Write `.lol-runtime.json` (so `status`/`down` work elsewhere) and supervise until Ctrl‑C.

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
```

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
`chat_template_kwargs: {enable_thinking: false}` reaches the engine on `hosted_vllm/` (external servers) and
`openai/` (llama-server, coordinator peers), and
`think: false` becomes Ollama's own field on `ollama_chat/`. And it checks the reply limit
(`proxy.maxReplyTokens`): a request naming no limit reaches Ollama with `num_predict` 32768 and llama-server with
`max_tokens` 32768, an external server with none, and a request's own `max_tokens` or `max_completion_tokens`
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
