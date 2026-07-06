# LlmOnLan Farm — the self-installing farm app

A downloadable desktop app that turns a GPU box into a running LlmOnLan farm with
**zero terminal and zero prerequisites**. It installs its own Ollama + Python, pulls
**gemma4:12b**, runs the [`lol`](../farm/) farm as a managed process, and gives the
operator the existing **admin panel** as its window.

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
| **Model** | `ollama pull gemma4:12b` (~8 GB) with a real % bar (an app-owned Ollama). | Ollama's model store |
| **Services** | `lol install` builds the LiteLLM / SearXNG / OCR venvs (it reuses the pulled model + the bundled Python via `$LOL_PYTHON`). | `userData/farm/.venv` · `.searxng` · `.extract` |
| **Launch** | Starts `lol up`, health-waits `http://127.0.0.1:41997/lol/self`. | — |

Every phase is **idempotent + resumable** — a Retry after a failure only redoes
what's missing. On the 2nd+ launch it skips the wizard and goes straight to the
running screen (and auto-starts the farm).

## Steady state

The window IS the farm's admin panel — `http://127.0.0.1:41997/lol/admin` in a
`<webview>`, with the admin token auto-seeded into `localStorage` (via a webview
preload reading it from the URL hash) so it unlocks with no prompt. Thin app chrome
adds: a **status dot**, **Start/Stop**, a **privacy line** (private vs. the shared
LAN endpoint), and **Settings** (share compute, theme, launch-at-login, update check).

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
  the right concurrency + 16k context env).

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
