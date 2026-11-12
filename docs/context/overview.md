# The four pieces

> Moved verbatim from CLAUDE.md on 2026-11-12 (the split into context modules). It describes `main` unless a line
> names a release or says *not released yet*. Keep it true: a change to the code it describes changes this file in the same commit.

## What we are building (four pieces)

1. **`lol` — the farm CLI** (Node, npm‑style). Run on each GPU box (or one box). Reads a
   declarative `lol.config.json`, brings up the serving engine (Ollama by default; llama.cpp or vLLM opt-in from
   the panel, vLLM installed, started and stopped by the farm; an external server a developer configures), generates and runs a LiteLLM proxy behind the farm's seat gate
   (one OpenAI‑compatible endpoint, load‑balanced across boxes), hosts the shared plugins and the admin
   panel, and runs a **UDP discovery beacon** (+ unicast `/lol/self`) so clients find the farm
   automatically. This is where models are chosen.
2. **The client shell** (Electron + TypeScript). Supervises a bundled, unmodified Open WebUI
   sidecar, discovers the farm on the LAN, points Open WebUI at it, and stores all data locally
   (OWUI's under a user‑chosen folder). Owns the topbar, settings/preferences, the connection overlay,
   and two first-party surfaces beside OWUI: **LOL Vibe** and **the Computer**.
3. **Open WebUI** — vendored, version‑pinned, **unmodified**. We inherit all its features.
4. **The Farm app** (`farm-app/`, Electron) — the operator-facing sibling of the client: a first-run
   wizard downloads its own Python + Ollama, copies the farm code to `userData/farm`, pulls `gemma4:26b` (19 GB; `gemma4:12b`
   until 2026-11-10), runs `lol install` (venvs, document search on an NVIDIA GPU, `gemma4:12b` for reading documents beside
   vLLM: about 27 GB in all), then supervises `lol up --no-pick` and shows
   the admin panel as its window (token auto-seeded) — which is where the model, its name and the capacity
   are run. **Private by default** (`proxy.host` 127.0.0.1, beacon off) until Settings ▸ Share compute.
   The panel's Browse… (Model storage) is the app's folder picker (`choose-folder`, `webviewPreload.js`), and its own
   Ollama starts with the `OLLAMA_MODELS` the panel chose (`installer.ts` `ollamaModelsEnv`; never on a model folder gone
   missing, never pruning a lent one), and a wizard run again keeps the config's keys (`storage` above all: `farmConfigFor`).
   Its Settings drawer holds only app-level things (share-with-LAN → `proxy.host`/`beacon.enabled`, theme,
   launch-at-login, update notifications + Check for updates, the panel access token, logs folder); it
   deliberately never re-applies model settings at boot, which used to overwrite the panel's. Its Quit and Stop run
   `lol down` FIRST (so the vLLM the farm runs stops too), then tree-kill `lol up` as a backstop; the share toggle
   restarts the farm keeping vLLM (`keepEngine`: only `lol up`'s own pid is killed, never its tree); Quit keeps the
   window up ("Stopping the farm…", status `stopping`, Start waits) until `lol down` is done; a crash
   restart reaps the dead run's recorded pids first (`reapStaleFarm`, which never stops vLLM). Launch at login on
   Linux writes an XDG autostart entry for the AppImage (`farm-app/test/supervisor.test.js` checks all of it). An app
   update copies the farm code into userData FILE BY FILE (`copyTree.ts`, 2026-10-08): a file that differs is moved
   aside into `farm/.replaced` (allowed while a running vLLM's bash holds it; cleared at the next refresh), then the
   new one is written, and one failure never stops the rest. Electron 42's `fs.cpSync` deleted first, left a held
   `serve.sh` "delete pending" and skipped every later file (farm-v0.0.43 on the PRO 6000). A failed refresh is
   written to `farm.log` and retried at the next launch; a missing `farm/vllm` script is said as such on the panel
   (`vllm.js` `spawnScript`), never as "WSL did not answer". `farm-app/test/copytree.test.js` runs under Electron.
   Released on `farm-v*` tags as GitHub prereleases (Windows x64, macOS arm64, Linux arm64 AppImage). No
   electron-updater: the app looks for a newer `farm-v*` release (at launch when enabled, or on demand) and
   opens its download page; **installing is manual**. **No GitHub API in the hot paths** (2026-11-10, v0.2.17 and farm-v0.0.53):
   it allows 60 requests an hour to a whole network behind one public address, and the school's ran out (*GitHub API
   403*). The update check reads `releases.atom` (the API only when its 10 newest hold no farm release); the wizard
   downloads the pinned Python and Ollama by their names (`releases/download/<pin>/<file>`, the API if that fails); the
   client finds its chat engine and coding agent by their download links (`sidecarManager.ts` `releaseAssetUrl`).

End‑user experience: install one app → open it → chatting in seconds. No URL, no account
ceremony, no Docker.
