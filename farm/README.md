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
| `lol install` / `setup` | One‑time bootstrap: install Ollama + LiteLLM and pull the configured models. Idempotent. |
| `lol init [--force]` | Scaffold a `lol.config.json` in the current directory. |
| `lol up` / `lol serve` | Ensure Ollama, pull models, generate + run the LiteLLM proxy, start the beacon. Foreground; Ctrl‑C stops. |
| `lol down` | Stop the proxy + beacon (and any Ollama this CLI started). |
| `lol status` | Health of each Ollama host + the proxy + which models are loaded. Works from any shell. |
| `lol models ls` | List configured models + presence on each host. |
| `lol models add <id>` / `rm <id>` | Edit the served catalog (then `lol up`). |
| `lol models pull` | Pull every configured model on every host. |

## Config — `lol.config.json`

See [`lol.config.example.json`](lol.config.example.json). Shape:

```jsonc
{
  "name": "Studio Farm",                       // friendly name shown in the client
  "beacon": { "enabled": true, "group": "239.255.43.10", "port": 41998,
              "intervalSec": 5, "httpPort": 41997 },   // distinct from ComfyQ's 239.255.42.99
  "proxy":  { "port": 4000, "host": "0.0.0.0", "masterKey": null },
  "models": [ { "id": "gemma4:12b", "default": true } ],
  "ollama": { "hosts": ["http://127.0.0.1:11434", "http://gpu-2.local:11434"],
              "numParallel": 2, "maxLoadedModels": 1, "flashAttention": true },
  "litellm": { "command": "litellm", "extraArgs": [], "provider": "ollama_chat" }
}
```

- **Model choice = edit `models`** (or `lol models add`) then `lol up`. Each Ollama host becomes a
  deployment of the same `model_name`, so LiteLLM load‑balances + fails over automatically.
- **`proxy.masterKey`** — leave `null` for an open proxy on a trusted LAN, or set a key clients must
  send (`Authorization: Bearer <key>`).
- **`litellm.command`** — leave it `"litellm"` and the farm auto‑uses `farm/.venv` if `lol install`
  made one, else `litellm` from PATH. Set an absolute path only to point at a LiteLLM elsewhere.
- **Concurrency env** (`OLLAMA_NUM_PARALLEL`, …) only applies when Ollama *starts*. If the CLI starts a
  local Ollama it sets them; if Ollama is already running, set them on that service and `lol status`
  reflects them. The CLI prints the recommended values.

## What `lol up` does, in order

1. Ping each Ollama host (start a **local** one if it's down, with the concurrency env).
2. Pull any configured model missing on a reachable host.
3. Generate `litellm/config.generated.yaml` from the config (models × hosts → deployments).
4. Spawn LiteLLM, wait for `/health/liveliness`, confirm `/v1/models`.
5. (M3) Start the discovery beacon.
6. Write `.lol-runtime.json` (so `status`/`down` work elsewhere) and supervise until Ctrl‑C.

## Notes / gotchas

- **Windows + LiteLLM banner:** the proxy is spawned with `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8`
  so its Unicode startup banner doesn't crash on a cp1252 console (`UnicodeEncodeError`).
- Generated/runtime files (`litellm/config.generated.yaml`, `.lol-runtime.json`, `.lol-id`) are
  gitignored — never commit them.

## Develop / test

```bash
npm test        # unit tests for config, LiteLLM generation, snapshot, helpers
```
