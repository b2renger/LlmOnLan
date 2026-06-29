# `lol` — the LlmOnLan farm CLI

A small Node CLI that turns one declarative `lol.config.json` into a running, LAN‑discoverable
inference farm: it ensures [Ollama](https://ollama.com) is up, pulls the configured models,
**generates** a [LiteLLM](https://docs.litellm.ai) proxy config (one OpenAI‑compatible, load‑balanced
endpoint), runs the proxy, and (from M3) broadcasts a UDP discovery beacon. Model choice lives in the
config — the CLI never hand‑edits routing.

## Prerequisites (installed by the operator)

| Tool | Why | Install |
|---|---|---|
| **Ollama** | Serves the models. One instance per GPU box. | https://ollama.com |
| **LiteLLM** | The OpenAI‑compatible proxy that load‑balances + fails over across boxes. | `pip install "litellm[proxy]"` (Python 3.11/3.12; a venv is fine — point `litellm.command` at it) |
| **Node ≥ 20** | Runs this CLI. | https://nodejs.org |

> The CLI **spawns and supervises** Ollama + LiteLLM; it does not reimplement them.

## Install

```bash
cd farm
npm install
# optional: link `lol` onto your PATH
npm link        # then just `lol <cmd>` anywhere
```

…or call it directly: `node bin/lol.js <cmd>`.

## Commands

| Command | Does |
|---|---|
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
- **`litellm.command`** — `litellm` if it's on PATH, else an absolute path to a venv's `litellm[.exe]`.
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
