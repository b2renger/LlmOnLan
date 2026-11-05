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
| **Runtime** | Downloads a relocatable standalone **CPython 3.12** ([python-build-standalone](https://github.com/astral-sh/python-build-standalone) 20260825) + the **Ollama** binary (v0.33.0) for this OS/arch: the pins in `src/main/runtimeManager.ts`. An installed farm keeps the ones it first downloaded. | `userData/farm-runtime/{python,ollama}` |
| **Farm code** | Copies the bundled farm CLI to a **writable** location + writes `lol.config.json` (gemma4:12b default, a pinned admin token). | `userData/farm/` |
| **Model** | `ollama pull gemma4:12b` (~8 GB) with a real % bar (an app-owned Ollama) — the catalog + OCR vision model. | Ollama's model store |
| **Services** | `lol install` builds the LiteLLM / SearXNG / OCR venvs and, on an NVIDIA GPU (Windows x64, DGX Spark), sets up **document search**: the llama.cpp build with its CUDA runtime (~0.6 GB) and EmbeddingGemma 2 (~0.6 GB). The llama.cpp engine's own model comes only if `llamacpp.enabled` (off by default). | `userData/farm/.venv` · `.searxng` · `.extract` · `.llamacpp` + `.models` (document search on an NVIDIA GPU; the engine's model when enabled) |
| **Staged model** | The same step also pulls the `preinstall` model + its draft module (~8.6 GB) — kept ready for the admin panel to start on demand, never served automatically. | Ollama's model store · `.models` |
| **Launch** | Starts `lol up`, health-waits `http://127.0.0.1:41997/lol/self`. | — |

vLLM is not part of the first run. On a big NVIDIA GPU (an RTX PRO 6000, a DGX Spark, or a 32 GB card for Gemma 4
12B), the panel's **vLLM** section checks this computer and installs vLLM later (about 8 GB plus the model, about
45 minutes; on Windows inside WSL, which an administrator installs once). The card needs about 27 GB as the farm
ships (18 GB with document reading off); with document reading on, only Gemma 4 12B fits below about 36 GB.

Every phase is **idempotent + resumable** — a Retry after a failure only redoes
what's missing. On the 2nd+ launch it skips the wizard and goes straight to the
running screen (and auto-starts the farm).

> **The first run is big: ~18 GB (gemma4:12b + the staged model + venvs; ~19 GB with an NVIDIA GPU, for
> document search) plus the Python/Ollama runtime** ([breakdown](../docs/GETTING_STARTED.md#first-run-download-both-routes)). The start screen narrates
> what `lol up` is doing — step lines ("Starting LiteLLM …") and live download
> progress ("llama.cpp: model weights — 43%") — so a working bootstrap is
> distinguishable from a hang. The supervisor waits as long as the farm keeps making
> progress and only errors after **5 silent minutes**. The screen then clears itself if the farm comes up later
> (`farm.log`, from Settings ▸ **Open data & logs folder**, shows whether it still works). **Start the farm**, the
> top bar's **Start** or the wizard's **Retry** at that moment kill the run, and a model file it was downloading (a
> `.gguf`) starts over from zero.
>
> An app **update** that changes the served checkpoint re-downloads the new weights on
> the next boot, with the same progress line.

## Steady state

The window IS the farm's admin panel — `http://127.0.0.1:41997/lol/admin` in a
`<webview>`, with the admin token auto-seeded into `localStorage` (via a webview
preload reading it from the URL hash) so it unlocks with no prompt. Thin app chrome
adds: a **status dot**, **Start/Stop** (Stop and Quit stop the farm with `lol down`, which also stops a vLLM the
farm runs: the window says "Stopping the farm…" until the GPU is free, and such a farm takes about 2 minutes to
start again), a **privacy line** (private vs. the shared
LAN endpoint), and **Settings** (share compute, theme, launch-at-login, update
notifications + **Check for updates**, the **panel access token** (Copy — to drive the
panel from another computer's browser: with Share compute on, open
`http://<this computer's LAN address>:41997/lol/admin` there and paste it; a private farm binds the
panel to `127.0.0.1`), and **Open data & logs folder**) — the model
itself is run from the panel below.

## The model, its name, and capacity — in the panel, not in Settings

All of it lives in the window itself. The panel opens on **Presets** (one click sets the farm up for a kind of
session: Balanced, the default; Documents; LOL Vibe; Computer; **Review…** shows why and every change first), then
**Serving** (what serves, people at once, who is connected), then one section per engine (Ollama, llama.cpp, vLLM).
Each section holds everything about its engine (its models, its part of Model storage); every section but the
serving one ends with **Serve with …**, and the serving one holds **People and context** (people served at once,
the context window; on vLLM context per person and GPU memory for conversations). **Access** holds **Name users
see** (llama.cpp, vLLM; on Ollama, each model row's Rename), **Free an idle seat after** and the farm password. One
**Apply changes** applies these and the serving section's people and context together, in one restart, and writes
them back to `lol.config.json` (Ollama's "people served at once" takes effect after a farm restart; on vLLM, Apply
says first whether vLLM restarts, about 2 minutes). The vLLM section also holds the check of this computer,
Install, its model list, Start and Stop, its log. Below Access, **Model storage** keeps all the farm's models in one
folder (**Browse…** picks it; **Move here** copies and checks them before anything is deleted:
[farm/README.md](../farm/README.md#where-the-models-are-on-disk-model-storage)), then Plugins, Clients and This box.

These used to be split between Settings and the panel, in two half-versions that could disagree: the
app re-applied its own stored values on every launch, so a rename done in the panel came back wrong
after the next restart. Settings now holds only what belongs to the *app* (share-with-network, theme,
launch-at-login, update notifications + Check for updates, the panel access token, logs folder).

**Naming.** The model id clients receive *is* the name their picker shows — over an OpenAI-style
connection there's no separate display-name channel — so this renames the served id: on llama.cpp and vLLM,
*Access* ▸ **Name users see**; on Ollama, each model row's **Rename** (`models[].alias`). A name you
gave the model survives an engine switch and a fallback, so bound chats keep working; an unnamed
default is served under its raw id on Ollama (`gemma4:12b`) and under `llamacpp.alias` (`assistant`)
on llama.cpp, so name the model first if chats should survive a switch. The real checkpoint stays
visible to clients as the beacon's `underlying` field: only the label is friendly, not the truth.

> **Caveat:** it changes the model **id**, so chats a user started under the old name will ask them to
> re-select the model. New chats are unaffected. Pick the name once, early.
## Serving more than one person at a time

Out of the box the farm serves gemma4:12b on Ollama, **2 requests at a time** (`ollama.numParallel`,
applied after a farm restart). On llama.cpp the default is 1; its slots share one context pool
(`kvUnified`), so a person alone gets the whole window. Raise it in the panel: the serving engine's section ▸
*People and context* ▸ **People served at once** (or a preset). Past capacity, new generations get a clear "all
seats in use" until a seat has been idle for *Access* ▸ **Free an idle seat after** (15 min by default). On a big
NVIDIA GPU, vLLM serves far more: 48 people at 64k on an RTX PRO 6000, 8 on a DGX Spark (the panel's vLLM
section). Sizing table + budget:
[`farm/README.md`](../farm/README.md#multiple-users--capacity).

Every client shows how full each box is, so people can spread themselves across boxes without being
told to.

> A fresh install starts on **Automatic**: the farm measures the largest window this GPU holds and
> caches it. (It used to seed a fixed 64k — a figure measured on a 96 GB box, which spills to CPU and
> runs ~5x slower on 12 GB.) Pin a number in the panel only to trade window for something else.

## Private by default (share compute is opt-in)

Out of the box the farm is **fully private**: the proxy, discovery **and the plugins**
(web search, document OCR, document search, voice, Classify, speech to text, the message bus) bind
`127.0.0.1` only and the UDP beacon is off, so
**no other machine can reach or use it** — not by direct IP, not by subnet scan. You run
models for your own machine and nobody else spends your GPU.

Flip **Settings → Share compute with the network** to advertise as a compute box: the
farm rebinds to `0.0.0.0` + starts the beacon, so LlmOnLan clients on the LAN discover
and use it. Toggling restarts the farm (the bind address + beacon are read at boot); a vLLM the farm runs keeps
running through it.
The posture maps to the farm's own `proxy.host` + `beacon.enabled` config, so CLI
users get the same control by editing `lol.config.json`.

> Note: while private, your *own* other devices can't reach it either (it's localhost-
> only). "Share" opens it to everyone on the LAN. To limit who uses a shared farm, set a
> farm password (panel ▸ Access ▸ Farm password); clients prompt for it once.

## Why bundled Python + Ollama on PATH

- **Python is mandatory** — LiteLLM *is* the OpenAI-compatible proxy, and SearXNG +
  OCR are default-on; all four are Python. The app provides one **3.12** interpreter.
- The farm's `resolvePython()` honors **`$LOL_PYTHON`**, so the bundled interpreter is
  chosen deterministically (a stray system `py -3.12` can't win the venv builds).
- The bundled Ollama dir is prepended to `PATH`, so `lol install`'s `onPath('ollama')`
  check finds it and skips winget/brew/curl, and `lol up` spawns *that* Ollama (with
  the right concurrency + context env — the app seeds `ollama.contextLength` ("auto")
  once, at setup; the panel owns it afterwards).
- Before every farm start the app moves SearXNG / OCR off a taken 8888 / 8890 (e.g.
  JupyterLab on a DGX) by patching `websearch.port` / `ocr.port` in `lol.config.json`;
  clients follow automatically, since the port rides the beacon.
- The app passes its own version as `$LOL_FARM_VERSION`, so the farm advertises the
  release it runs (`lol fleet`, `/lol/self`) instead of `farm/package.json`'s 0.1.0.

The farm code writes its venvs + runtime state **inside its own dir**, so it's copied
to `userData/farm` (writable) rather than run from the read-only app resources.

## Develop

```bash
cd farm-app
npm install
npm run dev        # tsc → build/, then electron .
npm test           # tsc, then test/supervisor.test.js (lol down before the kill, keepEngine, the reap, the Linux autostart entry, what the farm copy and the installer leave out) and test/copytree.test.js (the update's copy over a held file, under Electron)
```

In dev the app copies the sibling `../farm` into its `userData/farm` at setup (so `farm/node_modules` must exist:
run `cd ../farm && npm install` once) and runs that copy. It copies again only when `farm-app/package.json`'s
version changes: after editing `../farm`, remove `farmCodeVersion` from `farm-settings.json` in the app's userData
folder (Settings ▸ **Open data & logs folder**), then start the app again. The wizard runs as in a packaged app: it
downloads its own Python and Ollama into `userData/farm-runtime`.

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
- The farm app does **not** auto-install. On launch (when **Notify me about updates** is
  on) and via **Settings → Check for updates** it queries the GitHub API for the newest `farm-v*` release; if newer, it shows
  a notice and a **Download vX** button that opens the release page. The operator downloads
  the new installer. (electron-updater was removed — the app has no runtime deps.)

To restore true auto-update later, give the farm its **own releases repo** and re-add
electron-updater pointed at it (a small change).

## Platform notes

| Target | Status | Notes |
|---|---|---|
| **Windows + NVIDIA (x64)** | primary | bundled Ollama uses CUDA; per-user one-click NSIS. First download trips SmartScreen (unsigned). Ollama, llama.cpp, and vLLM inside WSL2 on a card of about 27 GB or more as the farm ships (18 GB with document reading off) — never an RTX 4070; a 4090 only with document reading off, a 4080 only with document reading and document search off. |
| **macOS Apple Silicon (arm64)** | supported | ad-hoc signed (right-click → Open on first launch). gemma4:12b wants ≥16 GB unified memory — the wizard **warns** below that, doesn't block. Ollama only: no llama.cpp build for it, no vLLM. |
| **NVIDIA DGX Spark (linux arm64)** | supported | AppImage built on `ubuntu-24.04-arm`; Ollama, llama.cpp and vLLM (8 people at 64k on Qwen3.6). Launch at login starts the farm only when someone logs in to the desktop. Needs FUSE (`--appimage-extract-and-run` is the FUSE-free fallback). |
| **Linux x64** | no build | Run the `lol` CLI instead ([farm/README.md](../farm/README.md)): Ollama and vLLM; llama.cpp only with a llama-server you build. |
