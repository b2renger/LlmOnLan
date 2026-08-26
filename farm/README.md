# `lol` — the LlmOnLan farm CLI

A small Node CLI that turns one declarative `lol.config.json` into a running, LAN‑discoverable
inference farm. It brings up the inference engines — **[llama.cpp](https://github.com/ggml-org/llama.cpp)**
(`llama-server`, the default backend for the model everyone chats with) and
**[Ollama](https://ollama.com)** (the multi‑model catalog) — **generates** a
[LiteLLM](https://docs.litellm.ai) proxy config that fronts both as one OpenAI‑compatible,
load‑balanced endpoint, runs the proxy, and broadcasts a UDP discovery beacon so clients find it with
no URL typed. Model choice lives in the config — the CLI never hand‑edits routing.

> **New to the two‑engine setup?** Read [Backends](#backends--llamacpp-default-and-ollama) first — it
> decides where you add a model and what a client actually gets.

> **Not comfortable in a terminal?** The **[LlmOnLan Farm app](../farm-app/)** is a downloadable
> installer that runs this exact CLI for you — it downloads its own Ollama + Python, fetches the
> backend + weights, and gives you the admin panel, with zero prerequisites. (**Unlike the client it
> does not update itself** — it shows a notice and a Download button; check it after each client
> release. It also has no UI for `llamacpp.parallel`, so serving a group still means editing the
> config.) This README is for driving
> the farm directly (or understanding what the app does under the hood). The app sets `$LOL_PYTHON`
> so the venv builds below use its bundled interpreter.

## Quick start (fresh pull) — two commands

On a GPU box with a fresh checkout you need **[Node ≥ 20](https://nodejs.org)** and
**[Python 3.9–3.13](https://python.org)** — `lol install` builds the LiteLLM proxy into a venv but will
**not** install Python for you (without it the bootstrap stops at *"Bootstrap incomplete"* and the farm
has no proxy). Everything else — Ollama, LiteLLM, the llama.cpp backend, the models, web search and OCR
— one command installs; one runs the farm.

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
| **LiteLLM** | A local `farm/.venv` (your Python 3.9–3.13) with `litellm[proxy]` + the required fastapi bound. The farm auto‑uses this venv — no config edit. | `farm/.venv` already has `litellm`. |
| **Config** | Scaffolds `farm/lol.config.json` from the defaults (named after this host) if none exists. | A config is already there. |
| **Models** | Pulls every model in `models` **and `preinstall`** on the local Ollama (over its HTTP API), derives `source` models with their `params`, and fetches any `draft` module. | Model already pulled. (`lol up` also pulls anything missing.) |
| **Web search + OCR** | Builds the SearXNG and document-OCR venvs (both default-on) so the first `lol up` starts instantly. Non-fatal: `lol up` retries. | Already installed. |
| **llama.cpp backend** | Downloads the pinned `llama-server` build + CUDA runtime into `farm/.llamacpp/` and the `.gguf` weights + vision projector into `farm/.models/` (several GB). Non‑fatal: `lol up` retries. | Build marker matches **and** the weights are cached. |

If an auto‑installer isn't available (no winget/brew/curl, or no Python), `lol install` prints the exact
manual step and you re‑run it — it's **idempotent**, so re‑running only does what's left.

## Manual setup (alternative to `lol install`)

The pieces `lol install` automates, done by hand:

| Tool | Why | Install |
|---|---|---|
| **Ollama** | Serves the models. One instance per GPU box. | https://ollama.com |
| **LiteLLM** | The OpenAI‑compatible proxy that load‑balances + fails over across boxes. | `pip install "litellm[proxy]" "fastapi>=0.136.3,<0.140.7"` (Python 3.9–3.13; a venv is fine — drop it at `farm/.venv` and the farm finds it, or point `litellm.command` at it). **The fastapi bound is mandatory** — outside it the proxy dies at startup with `ImportError: cannot import name 'get_flat_dependant'` and the farm never comes up. |
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
| `lol install` / `setup` | One‑time bootstrap: install Ollama + LiteLLM, pull the configured models, and set up shared web search (SearXNG) + document OCR (both on by default). Idempotent. |
| `lol init [--force]` | Scaffold a `lol.config.json` in the current directory. |
| `lol up` / `lol serve` | Ensure Ollama, **pick the Ollama model(s) to serve** (interactive, from what's installed; Enter = default), pull anything missing, start `llama-server` (fetching build + weights on first run), generate + run the LiteLLM proxy, start SearXNG + OCR (if enabled) + the beacon. Foreground; Ctrl‑C stops. |
| `lol down` | Stop the proxy + `llama-server` + SearXNG + TTS + OCR + beacon (and any Ollama this CLI started). |
| `lol status` | Health of each Ollama host + the proxy + which models are loaded. Works from any shell. |
| `lol fleet` | Every farm on the LAN (this box + peers): health, GPU load, VRAM, loaded models, roles, search URL. |
| `lol bench` | Load‑test before a workshop: N concurrent chats → first‑token latency (p50/p95) + tokens/s. `--users N --rounds R --model id --url …`. |
| `lol models ls` | List configured models + presence on each host. |
| `lol models add <id>` / `rm <id>` | Edit the served catalog, then run **`lol up --no-pick`** — plain `lol up` prompts, and pressing Enter serves only the default, dropping what you just added. There is no alias flag: to give the model a stable role name, add `"alias": "…"` to its entry in `models` by hand. |
| `lol models pull` | Pull every configured model on every host. |

**`lol up` flags:** `--model <id[=alias][,…]>` (also `-m`, `--model=…`) serve exactly these (no prompt;
pulls if missing) · `--no-pick` (also `--yes`, `-y`) skip the prompt, use the config catalog · `--alias <name>` / `--no-alias` override the global
model alias · `--coordinator` aggregate LAN peer farms into one balanced endpoint (clients prefer it) ·
`--websearch` / `--no-websearch` override the SearXNG toggle · `--tts` / `--no-tts` override the Kokoro
voice toggle (off by default) · `--ocr` / `--no-ocr` override the document‑OCR toggle (on by default).

## Backends — llama.cpp (default) and Ollama

A farm can serve models through **two** engines at once. Knowing which one answers a given request is
the thing to understand before changing models or sizing for a group.

| | **llama.cpp** (`llama-server`) | **Ollama** |
|---|---|---|
| On by default | **yes** (`llamacpp.enabled: true`) | yes |
| Serves | **exactly one** model — `llamacpp.model`, a `.gguf` URL | every entry in `models` — **only while it is the selected engine** |
| Client-facing name | `llamacpp.alias` (default `assistant`) | each model's `alias`, else its raw id |
| Visible to clients? | **yes** — the only model, while it is the engine | only when Ollama is the engine — otherwise **standby** (not routed, not advertised) |
| Why it exists | explicit KV-cache quantization + flash attention, so a good quant stays fully GPU-resident on a 12 GB card (Ollama spills there) | multi-model catalog, load balancing across boxes, the OCR vision model |

Both live behind the same LiteLLM proxy, but **one engine serves at a time**: while llama.cpp is the
engine, its alias is the only model routed or advertised, and the Ollama catalog is **standby** —
installed and ready for an engine switch, and used internally by document OCR (which talks raw Ollama,
never the proxy). Two engines advertising at once read as "both are running", and on a 12 GB card a
client picking an Ollama model next to a resident llama-server overcommitted VRAM and crawled. The
advertised **name survives the switch** (it is copied between `llamacpp.alias` and `modelAlias`), so
existing chats keep working either way.

**If llama.cpp cannot start, the farm does not die.** No prebuilt exists for this platform (anything
but win-x64 today — the DGX Spark is linux-arm64), the download failed, the weights would not load:
`lol up` logs the reason, **falls back to the Ollama engine for the run**, and the panel shows why on
the Backend card. The config keeps `llamacpp.enabled`, so a later boot (or a `binDir` pointing at a
hand-built llama.cpp) picks the fast engine back up.

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
global `modelAlias` (not `llamacpp.alias`) names the default model.

> **Quant ↔ `mtp` rule.** `mtp: true` adds `--spec-type draft-mtp` (speculative decoding via the GGUF's
> built-in MTP head). Unsloth **strips that head** from every quant below `UD-Q2_K_XL`, and llama-server
> then exits with *"model doesn't contain MTP layers"* — a loud failure we deliberately don't paper over.
> The shipped default quant (`UD-IQ2_S`) is one of those, so `mtp` defaults to **false**. Turn it on only
> together with a `UD-Q2_K_XL`-or-above `model`.

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
   remembers it; nothing is downloaded yet.
2. **Use this** on any entry downloads it (progress is shown — a first fetch is several GB and several
   minutes) and reloads llama-server onto it.
3. **Remove** drops an entry from the list. The one currently serving can't be removed; switch first.

The library ships with the three quants this project has measured on 12 GB cards, so on that hardware you
can switch between them without hunting for URLs.

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
not a label bolted on top. Set it in the panel's *Backend* card (**Name users see** → Apply), or as
`llamacpp.alias` in the config (`modelAlias` when the llama.cpp backend is off).

Renaming reloads the model and takes a few seconds. **Existing chats will ask to re-select the model**,
because their bound id no longer exists; new chats are unaffected. That is the cost of the rename being
real rather than cosmetic.

### The Ollama catalog (served when Ollama is the engine)

These are ordinary Ollama tags. When **Ollama is the selected engine** they are what the farm serves —
several at once, load-balanced across `ollama.hosts`. While llama.cpp is the engine they are
**standby**: kept installed (the panel shows them greyed with Download/Delete only) so an engine
switch is instant, and so document OCR has its vision model.

**From the panel** — the *Models · Ollama* card:

- **Download a model**: type an Ollama tag (`gemma4:12b`, `qwen3.8:14b`) and press Download. It is pulled
  onto every local host and immediately offered to clients.
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

> **⚠ `lol up`'s picker REPLACES the catalog for that run.** On a terminal, plain `lol up` prompts, and
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
survives a restart. Two exceptions, both deliberate:

- **Plugin toggles** (web search / OCR / voice) are for this session only.
- **Ollama's own slot count** needs a farm restart to take effect, because `OLLAMA_NUM_PARALLEL` is read
  by Ollama at startup. The panel says so when you change it.

Only **one** long operation runs at a time — a download, a backend switch, a reload. Everything else is
refused with *"the farm is busy"* rather than queued, because two model reloads racing is how a farm ends
up with no backend at all.

## Multiple users & capacity

A farm is a shared box, and the honest limits are per-engine.

**llama.cpp serves `llamacpp.parallel` requests at once — default `1`.** With one slot, a second person's
message waits for the first to finish generating: throughput is fine, but their *time to first token* is
however long the current answer takes. Raising it splits the context window rather than adding memory —
verified on the pinned build:

```
--ctx-size 16384 --parallel 2   →   n_slots = 2, n_ctx_slot = 8192
```

So for N concurrent users at the same usable window, raise **both**: `parallel: N` **and**
`contextLength: N × (the per-user window you want)` — then check the total still fits VRAM, because the
KV cache is allocated in full at load.

Both are panel controls — *Backend* → **People served at once** and **Context window** — and the panel
spells out the arithmetic as you change them ("2 slots, 8192 tokens of context each"), which is the
part that is easy to get wrong. Each applies live, reloading the model, and is written back to
`lol.config.json`. If the new shape does not fit VRAM the model fails to load and the farm reverts to
the shape that worked.

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

You mostly do not have to do the arithmetic yourself even then: the panel **computes the budget from the real
weights on disk and the detected VRAM** — context sizes that cannot fit are disabled in the selector
("won’t fit (12 GB GPU)"), an over-size request is refused with the largest size that does fit, and a
persisted config that no longer fits is **clamped at boot** (loudly, and saved). This exists because a
256k window saved onto a 12 GB card "worked" — Windows overcommits GPU memory into system RAM — and
served a few tokens a second until someone guessed why. The **Performance card** is the other half:
measured tok/s while generating (from llama-server’s own counters), slots busy, requests waiting, KV
usage, and plain-language warnings for the two silent failure modes (VRAM full at idle; generating far
below hardware speed). Verify rather than trust the table: `nvidia-smi` after load, and `lol status`. A workshop where people
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
```

**Who's connected.** Clients POST presence to the farm every ~10 s (`/lol/client-ping`: install id,
hostname, platform, app version, idle seconds). The admin panel's **Clients** card lists them with idle
times, and it rides the beacon as `usage.clients` — so you can see who is actually on a box before
restarting it. Machines drop off ~30 s after the app closes.

That count is also published against the slot count as `capacity: { slots, clients }`, which is what
lets both ends show occupancy: the panel's Clients card reads *"1 of 2 slots in use"*, and every farm
card in the desktop client shows the same, turning amber once a box is full. It is deliberately
**advisory** — the farm never turns anyone away past `slots`, it queues them — so a full box means
"expect to wait", and the point of showing it is that the next person can pick a different box.

**What multi-user does *not* mean here.** There are no farm-side accounts and nothing to administer per
person: each client is a single-user app whose chats, documents and RAG vectors live on that person's own
machine (the farm stores nothing). "Multi-user" is purely a **capacity** question — plus, if you want the
box reachable at all, `proxy.host` / `beacon.enabled` (the Farm app's *Share compute with the network*
toggle). `proxy.masterKey` can gate the endpoint with a bearer key, but the desktop client has no
key-entry screen yet, so a keyed farm is for CLI/API clients only.

## Password-protecting a farm

One shared password for everyone (the ComfyQ model — nothing fancy, no accounts):

1. Panel ▸ *Backend* ▸ **Farm password** → type one → Apply (a few seconds; the proxy restarts).
   Apply with the field empty to remove it. Or set `proxy.masterKey` in `lol.config.json`.
2. Every client then shows the farm with a 🔒 and asks for the password **once**, verifies it
   against the farm before saving, and remembers it per farm. Wrong password = an immediate
   "not accepted", never a broken chat.

What it protects: **every `/v1` route** — chat, models, everything the proxy serves (it becomes
LiteLLM's `master_key`). What stays open, deliberately: discovery (`/lol/self`, the beacon) so
clients can *find* the farm and ask for the password, `/health/liveliness` (the farm's own health
checks), and the admin panel's own **token** gate, which is separate and unchanged. This is a
trusted-LAN convenience lock, not hardened auth: traffic is plain HTTP on your own network.

## Config — `lol.config.json`

The CLI reads **`farm/lol.config.json`** (or `./lol.config.json` in your CWD) — `lol install` / `lol init`
scaffold it. [`lol.config.example.json`](lol.config.example.json) is a **template only**: editing it changes
nothing. Shape:

```jsonc
{
  "name": "Studio Farm",                       // friendly name shown in the client
  "modelAlias": null,                          // stable id for the default OLLAMA model (null = raw ids).
                                               //   MUST NOT equal llamacpp.alias — see the warning below
  "beacon": { "enabled": true, "group": "239.255.43.10", "port": 41998,
              "intervalSec": 5, "httpPort": 41997 },   // distinct from ComfyQ's 239.255.42.99
  "proxy":  { "port": 4000, "host": "0.0.0.0", "masterKey": null },
  "models": [ { "id": "gemma4:12b", "default": true },
              { "id": "qwen2.5-coder:14b", "alias": "coder" } ],  // per-model role alias
  "llamacpp": { "enabled": true,               // DEFAULT backend — serves ONE model as `alias`
                "alias": "assistant",          // the name clients see and auto-select
                "model": "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-UD-IQ2_S.gguf",
                "mmproj": "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/mmproj-F16.gguf",
                "contextLength": "auto",       // DEFAULT: the largest that fits (or a number) — SPLIT across `parallel` slots
                "parallel": 1,                 // concurrent slots; see "Multiple users & capacity"
                "kvCacheType": "q4_0",         // quantized KV — what makes a good quant fit 12 GB
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
              "keepAlive": "-1",               // keep models warm in VRAM (no reload after idle)
              "contextLength": 16384 },        // num_ctx for OLLAMA models; up to 262144. Measured: 65536
                                               //   spills on a 12 GB card — raise it on a big-VRAM box
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

> **⚠ No Ollama model may be served under `llamacpp.alias`** — not via the global `modelAlias`, and not
> via a per-model `"alias"`. The llama.cpp backend owns its alias: the generated routing skips every
> Ollama deployment with that `model_name` and the beacon drops it too, so the colliding model
> **silently disappears from the fleet**, with no warning. Verified both ways:
>
> | you set | what vanishes |
> |---|---|
> | `"modelAlias": "assistant"` | the default Ollama model (`gemma4:12b`) |
> | `models: [{ id: "qwen2.5-coder:14b", alias: "assistant" }]` | that model |
>
> Leave `modelAlias: null` while llama.cpp is on (it only names the default *Ollama* model, which
> matters when `llamacpp.enabled` is `false`), and give per-model aliases distinct names (`coder`,
> `vision`, …). Renaming `llamacpp.alias` itself is safe — just don't rename it *onto* one of these.

**`llamacpp.library`** is the list of `.gguf`s the panel offers under *Use this*, so an operator can
switch weights without hunting for URLs. Each entry is
`{ id, label, url, mmproj, sizeGb, mtp, note }` — only `id`, `label` and `url` are required. `mtp` marks
a quant that still carries its MTP head; it defaults to `false`, the safe direction, because the farm
reads it to decide whether it must turn speculative decoding **off** when you switch onto that model.
The list is only a menu: `llamacpp.model` is what is actually served, and adding an entry downloads
nothing. It ships with the three quants measured on this project's 12 GB hardware; replace it freely.

> **`ollama.contextLength` is farm-global but VRAM is per-host.** A mixed fleet is served by whichever
> single value is set here, and it rides the generated routing (`num_ctx` per deployment), so it applies
> even on hosts this CLI never started.

- **Model choice** — the model everyone gets is `llamacpp.model`; extra models in the picker are
  `models` (or `lol models add`, or the `lol up` picker). Full recipe:
  [Adding or changing models](#adding-or-changing-models). Each Ollama host becomes a deployment of the
  same `model_name`, so LiteLLM load‑balances + fails over automatically.
- **Model aliases (important for stable chats):** an OWUI chat binds to the model *id* it started with —
  swap the served model and old chats break. With an alias (global `modelAlias` for the default model,
  per‑model `alias` for others), clients see a **fixed id** ("assistant", "coder") and you can swap what's
  behind it anytime (`lol up`, pick another model) without breaking a single chat.
- **Web search (ON by default):** `websearch.enabled` defaults to **`true`**, so a fresh farm hosts
  **one shared [SearXNG](https://docs.searxng.org)** on this box with no config edits. It's installed into
  `farm/.searxng/` at `lol install` time (and re‑checked on `lol up`; delete that folder to uninstall).
  Clients discover it via the beacon and OWUI's per‑message web‑search toggle just works, zero client
  setup. Searches + page fetching run from each client; this box only hosts the metasearch engine. Turn it
  off with `"websearch": { "enabled": false }` or `lol up --no-websearch`.
- **Document OCR (ON by default):** the farm hosts **one shared OCR / document‑extraction service** on this
  box, so clients get scanned‑document + image OCR with zero setup — OWUI uses it as its content‑extraction
  engine, routing images + scanned PDFs to a **vision model on this box's Ollama**
  ([Ollama‑OCR](https://github.com/imanoop7/Ollama-OCR), vendored) and born‑digital docs/PDFs to fast local
  extraction. Installed into `farm/.extract/` at `lol install` time, re-checked on `lol up` (torch‑free;
  reuses the vision model you already serve — `ocr.model` overrides which). Note it routes *all* of OWUI's document ingestion through the farm —
  opt a box out with `"ocr": { "enabled": false }` or `lol up --no-ocr`. The light path covers
  images/PDF/docx/pptx/xlsx/text, and `"docling": true` adds the rest (legacy `.doc`/`.ppt`/`.xls`,
  `.odt`/`.epub`/`.rtf`) at the cost of a multi‑GB torch install. Delete `farm/.extract/` to uninstall.
- **Admin panel (running the farm):** while `lol up` runs, open `http://<box>:41997/lol/admin` (the
  beacon `httpPort`) from any browser on the LAN — or click **"Manage this farm"** in the desktop
  client's fleet popover. The Farm app shows the same page as its own window. It is where the farm is
  run: which **engine** serves and which `.gguf` it loads, the **name users see**, **how many people**
  it serves at once, the **context window** (applied to whichever engine is serving), the **Ollama
  catalog** (download / offer / delete / make default), the **plugins** (web search / voice / OCR) and
  the Blender recommendation, and the **connected clients** (hostname, IP, app version, idle time —
  clients report presence every ~10 s and drop off ~30 s after closing), against the slot count.
  Clients pick every change up within ~5 s. Everything except the plugin toggles is **written back to**
  `lol.config.json`, so it survives a restart; see
  [What the panel changes, and what it does not](#what-the-panel-changes-and-what-it-does-not).
  Auth: the **admin token printed in the `lol up` banner** (regenerated each run; set
  `"admin": { "token": "…" }` in `lol.config.json` for a fixed one).
- **Multiple GPU boxes:** either list every box in `ollama.hosts` (one farm balances them all), or run
  `lol up` per box and let clients auto‑spread (they pick the least‑loaded farm), or run one box with
  `--coordinator` to aggregate the others behind a single endpoint that clients prefer.
- **`proxy.masterKey`** — leave `null` for an open proxy on a trusted LAN, or set a key clients must
  send (`Authorization: Bearer <key>`).
- **`litellm.command`** — leave it `"litellm"` and the farm auto‑uses `farm/.venv` if `lol install`
  made one, else `litellm` from PATH. Set an absolute path only to point at a LiteLLM elsewhere.
- **Concurrency/keep‑warm env** (`OLLAMA_NUM_PARALLEL`, `OLLAMA_KEEP_ALIVE`, …) only applies when Ollama
  *starts*. If the CLI starts a local Ollama it sets them; if Ollama is already running, set them on that
  service. The CLI prints the recommended values. Sizing rule: one Ollama runs `numParallel` generations
  at once (default 2) and queues the rest, while llama.cpp runs `llamacpp.parallel` (default **1**) —
  see [Multiple users & capacity](#multiple-users--capacity), and check with `lol bench`.

## What `lol up` does, in order

1. Ping each Ollama host (start a **local** one if it's down, with the concurrency/keep‑warm env).
2. **Pick the model(s) to serve** — interactive from what's installed (Enter = default), or `--model` /
   `--no-pick` / non‑TTY = the config catalog.
3. Pull any picked model missing on a reachable host.
4. (llama.cpp, on by default) Ensure the pinned `llama-server` build + CUDA runtime, ensure the `.gguf`
   weights + projector (**downloads several GB on a first run** — normally already done at
   `lol install`), spawn it, and health‑wait `/health`. A start failure here is fatal and names the
   likely cause (see the quant ↔ `mtp` rule).
5. (`--coordinator`) discover LAN peer farms and fold them into the routing.
6. Generate `litellm/config.generated.yaml` (llama.cpp deployment + served names × hosts + peers).
7. Spawn LiteLLM, wait for `/health/liveliness`, confirm `/v1/models`.
8. (websearch/OCR, on by default) Ensure each is installed (normally already done at `lol install`;
   installs here if missing) + spawn it and health‑wait it. Non‑fatal: the farm still serves chat.
9. Start the discovery beacon (+ the unicast `/lol/self` endpoint + the admin panel).
10. Write `.lol-runtime.json` (so `status`/`down` work elsewhere) and supervise until Ctrl‑C.

## If the farm won't start

| Symptom in the log | Cause | Fix |
|---|---|---|
| *"Bootstrap incomplete"* from `lol install`, no proxy afterwards | No Python 3.9–3.13 found | Install Python, re-run `lol install` (it's idempotent) |
| LiteLLM exits immediately; `ImportError: cannot import name 'get_flat_dependant'` | fastapi outside the supported bound | `pip install "fastapi>=0.136.3,<0.140.7"` into `farm/.venv` |
| `ENOENT` spawning litellm | `litellm.command` points nowhere / no venv | Run `lol install`, or set `litellm.command` to an absolute path |
| llama-server exits: *"model doesn't contain MTP layers"* | `mtp: true` on a quant whose head was stripped (below `UD-Q2_K_XL`) | Set `mtp: false`, or use a UD-Q2_K_XL+ quant |
| llama-server never becomes healthy, no clear error | Weights + KV don't fit VRAM, or a mismatched `mmproj` | Lower `contextLength`/`parallel`, check `mmproj` matches the model family |
| *"Farm already running"* / a stale port | A previous run wasn't torn down | `lol down`, then `lol up` |
| Port already in use (4000 / 41997 / 8081 / 8888 / 8890) | Another process (or an orphaned plugin) holds it | `lol down`; if it persists, change the port in `lol.config.json` |

## Notes / gotchas

- **Windows + LiteLLM banner:** the proxy is spawned with `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8`
  so its Unicode startup banner doesn't crash on a cp1252 console (`UnicodeEncodeError`).
- Generated/runtime files (`litellm/config.generated.yaml`, `.lol-runtime.json`, `.lol-id`) and every
  on-box runtime dir (`.venv`, `.searxng`, `.extract`, `.kokoro`, `.models`, `.llamacpp`) are
  gitignored — never commit them. `.models` and `.llamacpp` are the big ones (GBs).

## Develop / test

```bash
npm test        # unit tests for config, LiteLLM generation, snapshot, helpers
```
