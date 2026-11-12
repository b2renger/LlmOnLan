---
name: lol-scratch-farm
description: How to run a test farm, a test Ollama and a test client on the development computer without disturbing the farm people use there. Use it before any test that starts `lol up`, an Ollama, a vLLM or the client app, and before any GPU measurement.
---

# A scratch farm on the computer that also serves people

The development computer (AN-A6000PRO, RTX PRO 6000, 96 GB) is **also the farm people use**: the Farm app runs there,
and often the owner's client. Everything below was done and checked on 2026-11-10 (DEVLOG, that date).

## Before, and after

- Read the live farm first, and again at the end; it must be the same:
  `curl -s http://127.0.0.1:41997/lol/self` → `version`, `backend.engine`, `backend.model`, `usage.clients`.
- Note the GPU memory in use: `nvidia-smi --query-gpu=memory.used --format=csv,noheader`. It must come back to it.
- Kill only what you started. The live farm's `lol up` runs under `LlmOnLan Farm.exe`, never `node.exe`. An
  `ollama.exe` under `AppData\Local\Programs\Ollama` is the owner's Ollama app: leave it.

## The scratch farm

`lol up` has no `--config` flag: it reads `lol.config.json` from the **current folder**. So make a folder of your own
(in the session's scratch folder), write a config there, and run from it:

```json
{
  "name": "LOL scratch",
  "beacon": { "enabled": false, "httpPort": 41990 },
  "proxy": { "port": 4290, "host": "127.0.0.1", "internalPort": 4291 },
  "models": [ { "id": "<the model under test>", "default": true } ],
  "preinstall": [],
  "ollama": { "hosts": ["http://127.0.0.1:11500"] },
  "llamacpp": { "enabled": false, "port": 8191 },
  "vllm": { "enabled": false, "root": "/home/ateliernum/lol-vllm-scratch-none", "port": 8190 },
  "websearch": { "enabled": false, "port": 8988 }, "ocr": { "enabled": false, "port": 8990 },
  "tts": { "enabled": false }, "classify": { "enabled": false }, "stt": { "enabled": false },
  "bus": { "enabled": false }, "embed": { "enabled": false, "port": 8994 },
  "admin": { "token": "<a token of your own, to call /lol/admin/*>" }
}
```

- **Every port is its own.** The live farm holds 4000, 4001, 41997, 8081, 8100, 8888, 8890, 8894 and Ollama's 11434.
- **Not port 4190 for the gate:** it is on the web's blocked-ports list, so Node's `fetch` and the coding agent refuse
  it ("bad port"). Python's client does not, which hides the problem.
- **`vllm.root` is never production's (`~/lol-vllm`),** and never left null (null resolves to it): a farm that chooses
  another engine stops a vLLM carrying the farm's marker.
- `farm/src/proc.js` pins the runtime file to `farm/.lol-runtime.json` in the repo. If one is there from a run that
  died, move it aside before `lol up` (it would kill the pids that run recorded) and put it back after.
- Start: `cd <scratch>/farm && node <repo>/farm/bin/lol.js up --no-pick` as a tracked background command. Ready when
  `GET http://127.0.0.1:4290/v1/models` lists a model. Stop: `node <repo>/farm/bin/lol.js down` from the same folder.
- The panel's API: `POST http://127.0.0.1:41990/lol/admin/<route>` with `authorization: Bearer <admin.token>`; a job's
  progress is `job` in `GET /lol/admin/state` (`done`, `ok`, `message`).

## A scratch Ollama

Never the owner's Ollama app, never the Farm app's own. Download the version the Farm app pins
(`farm-app/src/main/runtimeManager.ts` `RUNTIME_PINS`) into the scratch folder and run it on its own port and models
folder, with the farm's settings:

`OLLAMA_HOST=127.0.0.1:11500 OLLAMA_MODELS=<scratch>/models OLLAMA_NUM_PARALLEL=2 OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_FLASH_ATTENTION=1 OLLAMA_MAX_LOADED_MODELS=1 ./ollama.exe serve`

- A pull is checked by digest; the school's network gave about 6 MB/s and corrupted one 16 GB download. Pull again.
- Ollama 0.33's `/api/ps` leaves the weights out of a model's size. For GPU memory, read `nvidia-smi` with the model
  unloaded, then loaded.

## vLLM and WSL

- A trial vLLM serves from `~/lol-vllm-033` through `docs/spike/runs/trial_serve.sh`, which refuses production's root.
- Run WSL scripts through PowerShell (`wsl.exe -d Ubuntu -- bash /mnt/c/...`): Git Bash rewrites `/mnt/...` paths
  (or set `MSYS_NO_PATHCONV=1`). PowerShell 5.1 mangles double quotes inside an argument to `wsl.exe`: use none.
- A detached `nohup … &` in WSL dies when the session closes: run long jobs as a tracked background command.
- The GPU is shared with the live farm. You may load models beside it, with clients connected or not (owner
  2026-11-12); never free or touch the live farm's own memory. A speed or capacity number taken while `usage.clients`
  is above 0 says so in its notes: other people's requests share the GPU.

## The client

- `shell/test/chat-harness/run.js` drives a chat-only Electron over CDP against a mock farm that does not beacon: safe
  here. Clear `ELECTRON_RUN_AS_NODE` first, or Electron starts as plain Node and exits.
- `shell/test/e2e.js` (`npm test` in `shell/`) **cannot run here**: Electron's single-instance lock, and it would point
  a sidecar at the owner's real data folder. Say it was not run.
- The coding agent's five tasks: `node docs/spike/ide/run.js <label> <farm /v1 URL> <context> <model> <maxTokens> <tasks> <rep>`,
  with `IDE_DATA` set to a scratch folder.

## Measuring a model

`docs/spike/spike_bench.py quality --base-url <farm>/v1 --label <label> --thinking off|on --concurrency 4`: the
28-item check. Run it through the scratch farm, as clients are served, with `farm/.venv/Scripts/python.exe`. Results go
to `docs/spike/results/`; a new measurement gets its section in `docs/spike/RESULTS.md`.

## At the end

`lol down` from the scratch folder; stop the scratch Ollama; check no process of yours is left
(`Get-CimInstance Win32_Process` shows each one's path), the GPU memory is back, and the live farm answers as before.
Delete your scratch downloads.
