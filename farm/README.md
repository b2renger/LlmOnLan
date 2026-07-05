# `lol` — the LlmOnLan farm CLI

A small Node CLI that turns one declarative `lol.config.json` into a running, LAN‑discoverable
inference farm: it ensures [Ollama](https://ollama.com) is up, pulls the configured models,
**generates** a [LiteLLM](https://docs.litellm.ai) proxy config (one OpenAI‑compatible, load‑balanced
endpoint), runs the proxy, and (from M3) broadcasts a UDP discovery beacon. Model choice lives in the
config — the CLI never hand‑edits routing.

## Quick start (fresh pull) — two commands

On a GPU box with a fresh checkout, the **only** prerequisite is **[Node ≥ 20](https://nodejs.org)**.
One command installs everything (Ollama + LiteLLM + the configured models); one runs the farm.

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
| **LiteLLM** | A local `farm/.venv` (your Python 3.9–3.13) with `litellm[proxy]`. The farm auto‑uses this venv — no config edit. | `farm/.venv` already has `litellm`. |
| **Models** | Pulls every model in `lol.config.json` on the local Ollama (over its HTTP API). | Model already pulled. (`lol up` also pulls anything missing.) |

If an auto‑installer isn't available (no winget/brew/curl, or no Python), `lol install` prints the exact
manual step and you re‑run it — it's **idempotent**, so re‑running only does what's left.

## Manual setup (alternative to `lol install`)

The pieces `lol install` automates, done by hand:

| Tool | Why | Install |
|---|---|---|
| **Ollama** | Serves the models. One instance per GPU box. | https://ollama.com |
| **LiteLLM** | The OpenAI‑compatible proxy that load‑balances + fails over across boxes. | `pip install "litellm[proxy]"` (Python 3.11/3.12; a venv is fine — drop it at `farm/.venv` and the farm finds it, or point `litellm.command` at it) |
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
| `lol install` / `setup` | One‑time bootstrap: install Ollama + LiteLLM, pull the configured models, and set up shared web search (SearXNG, on by default). Idempotent. |
| `lol init [--force]` | Scaffold a `lol.config.json` in the current directory. |
| `lol up` / `lol serve` | Ensure Ollama, **pick the model(s) to serve** (interactive, from what's installed; Enter = default), pull anything missing, generate + run the LiteLLM proxy, start SearXNG + OCR (if enabled) + the beacon. Foreground; Ctrl‑C stops. |
| `lol down` | Stop the proxy + SearXNG + OCR + beacon (and any Ollama this CLI started). |
| `lol status` | Health of each Ollama host + the proxy + which models are loaded. Works from any shell. |
| `lol fleet` | Every farm on the LAN (this box + peers): health, GPU load, VRAM, loaded models, roles, search URL. |
| `lol bench` | Load‑test before a workshop: N concurrent chats → first‑token latency (p50/p95) + tokens/s. `--users N --rounds R --model id --url …`. |
| `lol models ls` | List configured models + presence on each host. |
| `lol models add <id>` / `rm <id>` | Edit the served catalog (then `lol up`). |
| `lol models pull` | Pull every configured model on every host. |

**`lol up` flags:** `--model <id[=alias][,…]>` serve exactly these (no prompt; pulls if missing) ·
`--no-pick` skip the prompt, use the config catalog · `--alias <name>` / `--no-alias` override the global
model alias · `--coordinator` aggregate LAN peer farms into one balanced endpoint (clients prefer it) ·
`--websearch` / `--no-websearch` override the SearXNG toggle · `--ocr` / `--no-ocr` override the document‑OCR toggle.

## Config — `lol.config.json`

See [`lol.config.example.json`](lol.config.example.json). Shape:

```jsonc
{
  "name": "Studio Farm",                       // friendly name shown in the client
  "modelAlias": "assistant",                   // stable id clients see for the DEFAULT model (null = raw ids)
  "beacon": { "enabled": true, "group": "239.255.43.10", "port": 41998,
              "intervalSec": 5, "httpPort": 41997 },   // distinct from ComfyQ's 239.255.42.99
  "proxy":  { "port": 4000, "host": "0.0.0.0", "masterKey": null },
  "models": [ { "id": "gemma4:12b", "default": true },
              { "id": "qwen2.5-coder:14b", "alias": "coder" } ],  // per-model role alias
  "ollama": { "hosts": ["http://127.0.0.1:11434", "http://gpu-2.local:11434"],
              "numParallel": 2, "maxLoadedModels": 1, "flashAttention": true,
              "keepAlive": "-1" },             // keep models warm in VRAM (no reload after idle)
  "litellm": { "command": "litellm", "extraArgs": [], "provider": "ollama_chat" },
  "websearch": { "enabled": true, "port": 8888 },   // shared SearXNG → clients get web search
  "ocr": { "enabled": false, "port": 8890,           // shared document OCR → clients get scanned-doc/image OCR
           "model": null, "format": "markdown",       // null = served default vision model; markdown|text|json|…
           "pdfEngine": "auto", "docling": false },    // auto text-layer-else-vision; docling=true adds office formats
  "coordinator": false                          // aggregate LAN peers into one balanced endpoint
}
```

- **Model choice = edit `models`** (or `lol models add`, or just answer the `lol up` picker) then
  `lol up`. Each Ollama host becomes a deployment of the same `model_name`, so LiteLLM load‑balances +
  fails over automatically.
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
- **Document OCR (OFF by default):** set `"ocr": { "enabled": true }` (or `lol up --ocr`) to host **one shared
  OCR / document‑extraction service** on this box. Clients then get scanned‑document + image OCR with zero
  setup — OWUI uses it as its content‑extraction engine, routing images + scanned PDFs to a **vision model on
  this box's Ollama** ([Ollama‑OCR](https://github.com/imanoop7/Ollama-OCR), vendored) and born‑digital
  docs/PDFs to fast local extraction. Installed into `farm/.extract/` on first use (torch‑free; reuses the
  vision model you already serve — `ocr.model` overrides which). It's **off by default because enabling it
  routes *all* of OWUI's document ingestion through the farm**; the light path covers
  images/PDF/docx/pptx/xlsx/text, and `"docling": true` adds the rest (legacy `.doc`/`.ppt`/`.xls`,
  `.odt`/`.epub`/`.rtf`) at the cost of a multi‑GB torch install. Delete `farm/.extract/` to uninstall.
- **Admin panel (live control of a running farm):** while `lol up` runs, open
  `http://<box>:41997/lol/admin` (the beacon `httpPort`) from any browser on the LAN — or click **"Manage
  this farm"** in the desktop client's fleet popover. It can **start/stop served models** (adds/removes them
  from the proxy + warms/evicts VRAM; the proxy bounces for a few seconds) and **enable/disable the farm
  plugins** (web search / voice / OCR) live, plus recommend the client‑side Blender plugin to the fleet —
  clients pick every change up within ~5 s. Auth: the **admin token printed in the `lol up` banner**
  (regenerated each run; set `"admin": { "token": "…" }` in `lol.config.json` for a fixed one). Everything
  the panel changes is **ephemeral** — a farm restart reverts to `lol.config.json`, so persist real
  decisions there.
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
  at once (default 2) and queues the rest — check with `lol bench`.

## What `lol up` does, in order

1. Ping each Ollama host (start a **local** one if it's down, with the concurrency/keep‑warm env).
2. **Pick the model(s) to serve** — interactive from what's installed (Enter = default), or `--model` /
   `--no-pick` / non‑TTY = the config catalog.
3. Pull any picked model missing on a reachable host.
4. (`--coordinator`) discover LAN peer farms and fold them into the routing.
5. Generate `litellm/config.generated.yaml` (served names × hosts + peers → deployments).
6. Spawn LiteLLM, wait for `/health/liveliness`, confirm `/v1/models`.
7. (websearch, on by default) Ensure SearXNG is installed (normally already done at `lol install`; installs here if missing) + spawn it, health‑wait `/healthz` + the JSON API.
8. Start the discovery beacon (+ the unicast `/lol/self` endpoint).
9. Write `.lol-runtime.json` (so `status`/`down` work elsewhere) and supervise until Ctrl‑C.

## Notes / gotchas

- **Windows + LiteLLM banner:** the proxy is spawned with `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8`
  so its Unicode startup banner doesn't crash on a cp1252 console (`UnicodeEncodeError`).
- Generated/runtime files (`litellm/config.generated.yaml`, `.lol-runtime.json`, `.lol-id`) are
  gitignored — never commit them.

## Develop / test

```bash
npm test        # unit tests for config, LiteLLM generation, snapshot, helpers
```
