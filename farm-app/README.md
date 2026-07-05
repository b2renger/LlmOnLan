# LlmOnLan Farm — the self-installing farm app

A downloadable desktop app that turns a GPU box into a running LlmOnLan farm with
**zero terminal and zero prerequisites**. It installs its own Ollama + Python, pulls
**gemma4:12b**, runs the [`lol`](../farm/) farm as a managed process, and gives the
operator the existing **admin panel** as its window.

It's the operator-facing sibling of the client [`shell/`](../shell/): same Electron /
electron-builder / electron-updater recipe, but its process supervisor points at
`lol up` instead of the Open WebUI sidecar.

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
adds: a **status dot**, **Start/Stop**, the **LAN endpoint** clients connect to
(`http://<lan-ip>:4000/v1`, copyable), **Settings** (theme, launch-at-login,
auto-update), and **self-update**.

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
  builds Windows (x64) / macOS (arm64) / Linux arm64 (DGX) and publishes to GitHub
  Releases on the **`farm`** electron-updater channel (`farm.yml`), distinct from the
  client's `latest.yml` so the two apps in this one repo never collide.

## Platform notes

| Target | Status | Notes |
|---|---|---|
| **Windows + NVIDIA (x64)** | primary | bundled Ollama uses CUDA; per-user one-click NSIS → silent auto-update. First download trips SmartScreen (unsigned). |
| **macOS Apple Silicon (arm64)** | supported | ad-hoc signed (right-click → Open on first launch). gemma4:12b wants ≥16 GB unified memory — the wizard **warns** below that, doesn't block. |
| **NVIDIA DGX Spark (linux arm64)** | supported | AppImage built on `ubuntu-24.04-arm`; a natural always-on host (enable launch-at-login). Needs FUSE (`--appimage-extract-and-run` is the FUSE-free fallback). |

## Known risk (validate on the first release)

electron-updater channel resolution in a **shared repo**: the client publishes `v*`
releases (with `latest.yml`) and this app publishes `farm-v*` releases (with
`farm.yml`). The `channel: farm` config makes this updater read `farm.yml`; confirm on
the first packaged `farm-v*` release that it finds the newest **farm** release and
ignores the client's. Fallback if it mis-resolves: a dedicated updates-only feed.
