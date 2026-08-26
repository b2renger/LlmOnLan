# LlmOnLan Farm — the self-installing farm app

A downloadable desktop app that turns a GPU box into a running LlmOnLan farm with
**zero terminal and zero prerequisites**. It installs its own Ollama + Python, fetches
the inference backend and the model weights, runs the [`lol`](../farm/) farm as a
managed process, and gives the operator the existing **admin panel** as its window.

It's the operator-facing sibling of the client [`shell/`](../shell/): same Electron /
electron-builder packaging recipe, but its process supervisor points at `lol up`
instead of the Open WebUI sidecar. **Updates are manual** (a notice + a Download
button), not auto-installed — see "Updates" below.

## What it does on first run

A setup wizard runs once (needs internet), with a phase checklist + progress + a log:

| Phase | What happens | Where it lands |
|---|---|---|
| **Runtime** | Downloads a relocatable standalone **CPython** ([python-build-standalone](https://github.com/astral-sh/python-build-standalone)) + the **Ollama** binary for this OS/arch. | `userData/farm-runtime/{python,ollama}` |
| **Farm code** | Copies the bundled farm CLI to a **writable** location + writes `lol.config.json` (gemma4:12b default, a pinned admin token). | `userData/farm/` |
| **Model** | `ollama pull gemma4:12b` (~8 GB) with a real % bar (an app-owned Ollama) — the catalog + OCR vision model. | Ollama's model store |
| **Services** | `lol install` builds the LiteLLM / SearXNG / OCR venvs **and pre-fetches the llama.cpp backend**: the pinned `llama-server` + CUDA runtime, plus the `.gguf` weights of the model everyone chats with (~8.7 GB). | `userData/farm/.venv` · `.searxng` · `.extract` · `.llamacpp` · `.models` |
| **Staged model** | The same step also pulls the `preinstall` model + its draft module (~8.6 GB) — kept ready for the admin panel to start on demand, never served automatically. | Ollama's model store · `.models` |
| **Launch** | Starts `lol up`, health-waits `http://127.0.0.1:41997/lol/self`. | — |

Every phase is **idempotent + resumable** — a Retry after a failure only redoes
what's missing. On the 2nd+ launch it skips the wizard and goes straight to the
running screen (and auto-starts the farm).

> **The first run is big: ~28 GB and typically 30–45 minutes**
> ([breakdown](../docs/GETTING_STARTED.md#first-run-download-both-routes)). The start screen narrates
> what `lol up` is doing — step lines ("Starting LiteLLM …") and live download
> progress ("First start: fetching model weights — 43%") — so a working bootstrap is
> distinguishable from a hang. The supervisor waits as long as the farm keeps making
> progress and only errors after **5 silent minutes**. **Don't press "Start the farm"
> while a download is running** — that kills it and restarts the download from zero.
>
> An app **update** that changes the served checkpoint re-downloads the new weights on
> the next boot, with the same progress line.

## Steady state

The window IS the farm's admin panel — `http://127.0.0.1:41997/lol/admin` in a
`<webview>`, with the admin token auto-seeded into `localStorage` (via a webview
preload reading it from the URL hash) so it unlocks with no prompt. Thin app chrome
adds: a **status dot**, **Start/Stop**, a **privacy line** (private vs. the shared
LAN endpoint), and **Settings** (model name, share compute, context window, theme,
launch-at-login, update check, and **Open data & logs folder**).

## Settings ▸ Model name — what users see in the picker

The model id clients receive *is* the name their picker shows (over an OpenAI-style
connection there's no separate display-name channel), so this field renames the served
alias. Type e.g. `Studio Assistant` → **Apply**; the farm restarts and every client
picks the new name up within seconds. Empty restores the default (`assistant`).

It writes `llamacpp.alias` in `lol.config.json` — or the global `modelAlias` if the
llama.cpp backend is off — so the same name survives a backend switch, and it is
re-applied on every boot. The real checkpoint stays visible to clients as the beacon's
`underlying` field: only the label is friendly, not the truth.

> **Caveat:** it changes the model **id**, so chats a user started under the old name
> will ask them to re-select the model. New chats are unaffected. Pick the name once,
> early.

> **Settings ▸ Context window is Ollama-side.** It writes `ollama.contextLength`, which
> sizes the Ollama models — it does **not** resize `llama-server`, whose window is
> `llamacpp.contextLength` (edit `userData/farm/lol.config.json` and restart). Same
> caveat as the admin panel's context control — see
> [`farm/README.md`](../farm/README.md#live-from-the-admin-panel).

## Serving more than one person at a time

The farm answers **one request at a time** out of the box (`llamacpp.parallel: 1`), so a second
person's question waits for the first answer. **There is no setting for this in the app yet.** To
change it: **Settings ▸ Open data & logs folder** → open `farm/lol.config.json` → in the `llamacpp`
block set e.g. `"parallel": 4, "contextLength": 65536` (raise both — llama.cpp splits the window
across slots) → **Stop** then **Start** the farm. Sizing table + VRAM budget:
[`farm/README.md`](../farm/README.md#multiple-users--capacity).

> Also note **Settings ▸ Context window defaults to 64k**, which applies to the *Ollama* models
> (including the OCR vision model). On a 12 GB card that is measured to spill to CPU — lower it to
> 16k–32k there.

## Private by default (share compute is opt-in)

Out of the box the farm is **fully private**: the LiteLLM proxy + discovery bind
`127.0.0.1` only and the UDP beacon is off, so **no other machine can reach or use it**
— not by direct IP, not by subnet scan. You run models for your own machine and nobody
else spends your GPU.

Flip **Settings → Share compute with the network** to advertise as a compute box: the
farm rebinds to `0.0.0.0` + starts the beacon, so LlmOnLan clients on the LAN discover
and use it. Toggling restarts the farm (the bind address + beacon are read at boot).
The posture maps to the farm's own `proxy.host` + `beacon.enabled` config, so CLI
users get the same control by editing `lol.config.json`.

> Note: while private, your *own* other devices can't reach it either (it's localhost-
> only). "Share" opens it to everyone on the LAN — there's no per-device allow-list yet
> (that needs the farm's `proxy.masterKey` plus a key-entry screen in the client).

## Why bundled Python + Ollama on PATH

- **Python is mandatory** — LiteLLM *is* the OpenAI-compatible proxy, and SearXNG +
  OCR are default-on; all four are Python. The app provides one **3.12** interpreter.
- The farm's `resolvePython()` honors **`$LOL_PYTHON`**, so the bundled interpreter is
  chosen deterministically (a stray system `py -3.12` can't win the venv builds).
- The bundled Ollama dir is prepended to `PATH`, so `lol install`'s `onPath('ollama')`
  check finds it and skips winget/brew/curl, and `lol up` spawns *that* Ollama (with
  the right concurrency + context env — the app writes `ollama.contextLength` from its
  own Settings, default 64k).

The farm code writes its venvs + runtime state **inside its own dir**, so it's copied
to `userData/farm` (writable) rather than run from the read-only app resources.

## Develop

```bash
cd farm-app
npm install
npm run dev        # tsc → build/, then electron .
```

Dev reads the sibling `../farm` directly (so `farm/node_modules` must exist — run
`cd ../farm && npm install` once). The wizard + `lol install` + model pull all run
against your machine's real Python/Ollama unless `$LOL_PYTHON` / `PATH` point at a
bundled runtime.

> **Gotcha:** if `electron .` errors with *"Electron failed to install correctly"* or a
> snapshot assertion, the binary postinstall was skipped — run
> `node node_modules/electron/install.js`. And this repo's dev shell sometimes exports
> `ELECTRON_RUN_AS_NODE=1` (which makes `electron .` run as plain Node) — unset it for a
> GUI run.

## Build + release

- `npm run pack` — unpacked build (`dist/`) for a quick local check.
- `npm run dist` — installers for the current OS.
- `npm run release:patch` (or `:minor`/`:major`) — bumps the version, tags
  **`farm-vX.Y.Z`**, pushes; [`.github/workflows/release-farm.yml`](../.github/workflows/release-farm.yml)
  builds Windows (x64) / macOS (arm64) / Linux arm64 (DGX) and publishes them to the
  repo's GitHub Releases as a **prerelease** (see "Updates").

## Updates (manual)

The farm shares its GitHub repo with the client, and electron-updater resolves updates
via GitHub's `/releases/latest` — so a farm release becoming "latest" would break the
**client's** auto-update (it'd find `farm.yml` instead of `latest.yml`), and vice-versa.
There's no clean one-repo fix (electron-updater parses the git tag as semver, so `farm-v*`
tags don't work on the prerelease path). So:

- Farm releases are published as **prereleases** → the client's `v*` release stays
  GitHub's "latest", keeping client auto-update working.
- The farm app does **not** auto-install. On launch (and via **Settings → Check for
  updates**) it queries the GitHub API for the newest `farm-v*` release; if newer, it shows
  a notice and a **Download vX** button that opens the release page. The operator downloads
  the new installer. (electron-updater was removed — the app has no runtime deps.)

To restore true auto-update later, give the farm its **own releases repo** and re-add
electron-updater pointed at it (a small change).

## Platform notes

| Target | Status | Notes |
|---|---|---|
| **Windows + NVIDIA (x64)** | primary | bundled Ollama uses CUDA; per-user one-click NSIS. First download trips SmartScreen (unsigned). |
| **macOS Apple Silicon (arm64)** | supported | ad-hoc signed (right-click → Open on first launch). gemma4:12b wants ≥16 GB unified memory — the wizard **warns** below that, doesn't block. |
| **NVIDIA DGX Spark (linux arm64)** | supported | AppImage built on `ubuntu-24.04-arm`; a natural always-on host (enable launch-at-login). Needs FUSE (`--appimage-extract-and-run` is the FUSE-free fallback). |
