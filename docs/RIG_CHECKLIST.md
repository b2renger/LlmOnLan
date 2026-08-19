# Rig / real-hardware verification checklist

What's been verified **single-machine on the dev box** vs. what still needs a **real two-machine LAN,
real installers, and the actual target OSes**. Everything below the line in each section is the residual
risk; the build itself is implemented (see [DEVLOG.md](DEVLOG.md)).

## Discovery (two machines, real Wi-Fi)
- [x] Beacon sent by the farm + received by a listener on the same host (UDP loopback/broadcast).
- [x] `/lol/self` unicast endpoint returns the snapshot.
- [x] Shell auto-connects to a beacon-discovered farm with no URL typed (single host).
- [ ] **Two physical machines:** farm on box A, shell on box B → B finds A via beacon across the real AP.
- [ ] **Broadcast-blocked Wi-Fi** (e.g. school/guest net with client isolation): beacon won't arrive →
      confirm the **subnet sweep** finds the farm via `/lol/self`, and **Add-by-address** works.
- [ ] Multiple farms on one LAN → the picker lists both and switching repoints OWUI.
- [ ] Farm IP changes (DHCP) → de-dup by farm `id` keeps one entry; shell repoints to the new address.

## Farm robustness
- [x] `lol up` → `/v1/models` + a real `/v1/chat/completions` (LiteLLM → Ollama → gemma4).
- [x] `lol status` / `lol down` from a second shell; clean intentional-stop.
- [x] **Failover:** two Ollama hosts (`:11434` + a 2nd on `:11435`) serving gemma4 → load-balanced
      (both loaded; 8/8). Killing one mid-operation → **10/10** completions still succeed after tuning the
      router (`num_retries:3`, `allowed_fails:1`, `cooldown_time:60`). Size by concurrent in-flight generations,
      not headcount. *(Multi-physical-box still worth a real-LAN run; here both Ollamas were on one box.)*
- [ ] `lol up` starting a **local Ollama** when none is running (the spawn path; here Ollama was already up).
- [ ] `gemma4:12b` pull on a fresh box (the dev box already had a `gemma4` tag).

## Open WebUI integration (re-verify per pin — see INTEGRATION_BRIEF §7)
- [x] OWUI boots with the privacy env; `/health` true; **local** MiniLM embeddings load in-process.
      *(Verified at 0.10.1; the current pin is **0.10.2** — re-verify pin-sensitive checks per the section rule.)*
- [x] All user data (webui.db, `vector_db/chroma.sqlite3`, uploads) lands under the local `DATA_DIR`.
- [x] Auto-admin under `WEBUI_AUTH=false`; `get_all_models()` runs against the farm endpoint.
- [x] **A full chat through the OWUI UI** end-to-end (Playwright drove a real chat → streamed gemma4
      response "Local Area Network"; `ENABLE_OLLAMA_API=false` so the farm is the only inference path).
      *In the Electron-embedded webview specifically: still worth a manual click-through, but it's the same
      OWUI instance + URL the shell embeds.*
- [x] **Document-locality RAG test:** uploaded a doc with a canary phrase → it embedded into the **local**
      `vector_db/chroma.sqlite3` (canary found there) and the farm logged **ZERO `/v1/embeddings`** — the
      doc text never left the device; only chat completions reached the farm.
- [ ] `ENABLE_PERSISTENT_CONFIG=false` truly keeps env authoritative across restarts when the farm IP
      changes (no stale persisted URL winning). Spot-check there's no DB-saved OpenAI URL.
- [ ] Confirm `--port` (not `PORT` env) + the single-vs-plural OpenAI env precaution on the exact pin.

## Data-folder change (M4)
- [x] `moveDataDir`/`copyDataDir` unit-tested (9/9: copy, nested, src-removed, refuse-nested, empty-src).
- [ ] The full UI flow on real data: pick a folder via the native dialog → **Move my data** → OWUI
      restarts and the existing chats are present in the new folder; then **Start fresh** elsewhere.
- [ ] Cross-volume move (e.g. C: → D:) with a non-trivial `vector_db`.

## Packaging + auto-update (CI + real OSes) — the upgrade test
- [x] `electron-builder --dir` packs a real `LlmOnLan.exe` (~100 MB, **no sidecar bundled**); the sidecar
      is downloaded to `userData/sidecar` on first run from the release's
      `owui-sidecar-<platform>-<arch>.tar.gz` asset (`sidecarManager.ts`).
- [ ] **Full installers** built by CI on a `v*` tag: NSIS (win), dmg+zip (mac **arm64 + x64**),
      AppImage (linux); each release also carries the sidecar tarball assets the app downloads on
      first run (`darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-x64`).
- [ ] **★ Intel Mac (x64), new 2026-08-19 — needs a real pre-2020 Mac:** the `macos-15-intel` CI job
      publishes `owui-sidecar-darwin-x64.tar.gz`; install the **x64** dmg on an Intel Mac → first run
      downloads that tarball → OWUI boots and a chat works. **Watch the embeddings:** macOS-Intel torch
      tops out at **2.2.2** (PyTorch shipped no x86_64 mac wheels after it), which pip resolves via
      `sentence-transformers`' loose `torch>=1.11.0` — so local RAG embedding is the thing most likely
      to break. Also confirm the OS version: Electron needs a recent macOS, and ComfyQ's ad-hoc-signed
      Intel builds failed on **macOS 11 Big Sur** while working on **12+**.
- [ ] **Auto-update cycle:** install `vX.Y.Z`, publish `vX.Y.(Z+1)`, confirm the installed app self-updates
      on next launch — per OS. Windows: silent, no UAC (rides on NSIS `perMachine:false`). macOS: ad-hoc
      signing is the weak link — **validate on real Macs** (zip target present for Squirrel.Mac). Linux:
      AppImage must be launched as an AppImage.
- [ ] **The upgrade test:** bump `sidecar/OPENWEBUI_VERSION`, rebuild the sidecar, run the smoke test —
      pass = **no LOL code changed** and everything works. A failure is a separation defect to redesign.
- [ ] First-run downloads on a fresh install: the OWUI sidecar tarball (hundreds of MB, to
      `userData/sidecar`) then the ~90 MB MiniLM embedding model — measure combined latency + the
      download-progress UX; unsigned-app OS warnings (SmartScreen / Gatekeeper right-click→Open)
      documented for users.

## Farm app install (new 2026-07-05 h — needs a clean-box first-run pass per OS)
The desktop installer that runs the farm for a non-technical operator (`farm-app/`). Everything
here is **residual risk** — verified so far only at the code level (tsc/tests/`resolvePython`) + a
dev Electron boot to the welcome screen on the dev box.
- [x] Dev boot: `npm run dev` opens the window to the welcome screen with no crashes (env
      `ELECTRON_RUN_AS_NODE` unset; `node node_modules/electron/install.js` if the binary postinstall was skipped).
- [ ] **Clean box, no system Python/Ollama (the real test):** first-run wizard completes all five phases —
      runtime download (Python + Ollama), farm copy, gemma4:12b pull (~8 GB, real % bar), `lol install`
      venvs, launch → `/lol/self` healthy → the admin panel loads **unlocked** (token auto-seeded).
- [ ] **`$LOL_PYTHON` determinism:** the venvs are built by the **bundled** interpreter even when a system
      `py -3.12`/`python3` is also on PATH (check the `.venv`/`.searxng`/`.extract` python).
- [ ] **Ollama lifecycle:** the app-owned Ollama used for the pull is stopped before launch, and `lol up`
      starts its own with `OLLAMA_CONTEXT_LENGTH=65536` (a whole-document chat isn't truncated).
- [ ] **Start/Stop + crash-restart:** the chrome Stop/Start toggles the farm; `taskkill` the `lol up` tree →
      bounded auto-restart; quitting the app reaps LiteLLM/Ollama (no orphans).
- [ ] **Private by default (the compute-privacy toggle):** fresh install → a second machine
      **cannot** reach the farm — `curl http://<box>:4000/v1/models` refuses AND the client's subnet
      scan does NOT find it (localhost bind + no beacon). Flip **Settings → Share compute** → the farm
      restarts, the second machine now reaches the proxy and the client auto-discovers it; flip back →
      it disappears + refuses again. The chrome shows 🔒 private vs. the shared endpoint.
- [ ] **Upgrade migration:** a farm installed while the app defaulted to shared (farm-v0.0.1) → after
      updating, boot enforces private (the box stops being reachable until the operator opts in).
- [ ] **A client connects:** with sharing ON, a second machine's LlmOnLan **client** auto-discovers this farm and chats.
- [ ] **Per-OS installers** (CI on a `farm-v*` tag): NSIS (win x64), dmg+zip (mac arm64, ad-hoc), AppImage
      (linux **arm64** — the DGX). SmartScreen/Gatekeeper unsigned warnings documented for the operator.
- [ ] **DGX Spark:** the arm64 AppImage runs on the Spark; the plain `ollama-linux-arm64` archive loads
      gemma4:12b on the GB10 GPU (vs. the `-jetpack5/6` variants); FUSE present or `--appimage-extract-and-run`.
- [ ] **Low-RAM Mac:** a <16 GB Mac shows the wizard's memory **warning** but still proceeds.
- [ ] **★ Auto-update channel (the load-bearing packaging risk):** publish `farm-v0.0.1`, install, publish
      `farm-v0.0.2` → the app self-updates via the **`farm`** channel (`farm.yml`) and does **not** confuse
      itself with the client's `v*`/`latest.yml` releases in the same repo.

## Admin panel + plugins + presence (shipped 2026-07-03→05; needs a two-machine pass)
- [ ] **Admin panel** from a second machine: open `http://<box>:41997/lol/admin`, paste the banner token →
      start/stop a model (appears/disappears in a client's picker ~5 s later), **Make default**, change the
      **context window** (brief proxy blip; `lol status` still healthy), wrong token → rejected.
- [ ] **Plugins live-toggle:** disable/enable web search + OCR from the panel → clients lose/gain the
      feature (their OWUI restarts, ~30 s); a killed plugin process shows "down" within ~10 s.
- [ ] **OCR on a fresh box:** first `lol install`/`lol up` bootstraps `farm/.extract/` (needs Python
      3.10–3.13); upload a scanned PDF + a photo in a client → transcribed; the farm logs one
      `[extract] <file>: N page(s) → …` line per document; a text+image PDF shows `text+vision` pages
      and `[Page N]` markers in the extracted text.
- [ ] **Client presence:** two shells (≥0.1.23) → both appear in the panel's Clients section with
      hostname/version/idle; quitting one removes it within ~30 s; the popover shows "N clients".
- [ ] **Blender recommendation:** Recommend from the panel → a client that never touched the toggle
      enables it; a client that explicitly disabled it is left alone.

## Dev-environment gotchas already found
- LiteLLM + OWUI children are spawned with `PYTHONUTF8=1` (Windows cp1252 banner/log crash).
- `ELECTRON_RUN_AS_NODE=1` in the shell env makes Electron run as Node → launch with
  `env -u ELECTRON_RUN_AS_NODE`.
