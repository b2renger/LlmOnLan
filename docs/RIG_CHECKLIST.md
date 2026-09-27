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
- [ ] **Pin a farm, relaunch:** click a password-protected farm's card (it shows **pinned**), quit, relaunch
      → one `[sidecar] spawning`, no repoint, and chats answer (no 401). Then **Automatic — least busy
      farm** un-pins it (docs review SA-4/SA-5).
- [ ] **A farm added by hostname** (or a second IP) while its beacon also arrives → the pill stays on one
      address; OWUI does not show "Reconnecting…" every few seconds (SA-3).

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
- [ ] **Offline boot:** after one mic use (Whisper fetched into `DATA_DIR/cache/whisper/models`), a relaunch
      with the internet unplugged boots with `HF_HUB_OFFLINE=1` (visible in the sidecar env) and no hub
      wait; a fresh data folder boots with `HF_HUB_ETAG_TIMEOUT=2` instead (SA-2).
- [ ] **Chat-engine update on Windows:** Preferences ▸ About ▸ Check for chat-engine update → download →
      Restart to apply → About shows the new version; a failed swap keeps the old engine and retries next
      launch (SA-6).

## Data-folder change (M4)
- [x] `moveDataDir`/`copyDataDir` unit-tested (9/9: copy, nested, src-removed, refuse-nested, empty-src).
- [x] **All data in DATA_DIR (2026-09-27):** `clientData.ts` unit-tested in `shell-main` (the v0.1.x import,
      the boot-time move with its staging folder, refusals, failures, the settings marker on disk, the
      writability fallback, the stale-legacy warning); the chat harness runs every scenario on
      `session.fromPath(<DATA_DIR>/lol-client)` and `h1-data-dir` finds a saved thread's bytes under
      `<DATA_DIR>/lol-client/IndexedDB` and nothing under `<userData>/IndexedDB`. A scratch Electron 42 probe
      confirmed a v0.1.x-shaped default-session profile (IndexedDB + a 300 KB blob + localStorage keys)
      copied before `ready` reads back whole in the `fromPath` session, and that
      `<webview partition="persist:owui">` still resolves to `userData/Partitions/owui`.
- [ ] **The upgrade path, on a spare Windows profile (not the dev box's real one):** install v0.1.45, make
      some LOL Chat v1 history (a few threads; one Computer graph with a picture and a PDF), quit →
      install v0.2.0 and launch → a toast says the history now lives in the data folder; the threads and
      the graph (with its picture/PDF) are all there; `…\LlmOnLan\owui-data\lol-client\IndexedDB\file__0.indexeddb.leveldb`
      exists and `%APPDATA%\LlmOnLan\IndexedDB` is still there, unchanged (the backup);
      `%APPDATA%\LlmOnLan\logs\client-data.log` records the import. Relaunch → no toast, nothing copied again.
- [ ] **Then a Preferences move:** Settings ⚙ ▸ Data location ▸ Change folder… → the panel says the app
      restarts → **Move my data** → the path box shows the new folder, the app relaunches **without** the
      "Quit LlmOnLan?" prompt → a toast "Your data now lives in …"; LOL Chat's threads, the Computer's
      graphs (pictures, PDFs, sounds), `LOL Studio Projects` and Open WebUI's chats are all in the new
      folder, and the old folder is gone. Repeat with **Start fresh** → everything starts empty, the old
      folder is untouched.
- [ ] **Move to an unplugged drive:** move to a USB stick, quit, unplug it, launch → a warning toast and
      a red line in Data location; LOL Chat works (empty) from `%APPDATA%\LlmOnLan\lol-client`; plug the
      stick back, relaunch → the stick's history is back, and what that session wrote is set aside as
      `%APPDATA%\LlmOnLan\lol-client.unmerged-*`, named in a toast (never merged, never deleted).
- [ ] Cross-volume move (e.g. C: → D:) with a non-trivial `vector_db` and a LOL Chat history of a few
      hundred MB (the boot-time copy blocks the window for its duration — measure it).

## Packaging + auto-update (CI + real OSes) — the upgrade test
- [x] `electron-builder --dir` packs a real `LlmOnLan.exe` (~100 MB, **no sidecar bundled**); the sidecar
      is downloaded to `userData/sidecar` on first run from the release's
      `owui-sidecar-<platform>-<arch>.tar.gz` asset (`sidecarManager.ts`).
- [ ] **Full installers** built by CI on a `v*` tag: NSIS (win x64), dmg+zip (mac arm64 + x64), AppImage
      (linux x64 + arm64); sidecars darwin-arm64, darwin-x64 (onnxruntime 1.23.2 substitution), win32-x64,
      linux-x64, linux-arm64 — each release carries one `owui-sidecar-<platform>-<arch>.tar.gz` per platform,
      downloaded on first run. **Never ship an x64 mac installer without the matching
      `owui-sidecar-darwin-x64.tar.gz`** — the app dead-ends on first run.
- [ ] **Intel Mac (macOS 14+):** first run downloads the darwin-x64 sidecar; local embeddings + a chat work
      (the darwin-x64 sidecar substitutes onnxruntime 1.23.2 — the last Intel wheel — for OWUI's pin;
      macOS-Intel torch tops out at 2.2.2, so local embeddings are the thing to watch).
- [ ] **macOS ad-hoc build: OWUI voice (mic) and camera prompt and work** (electron-builder ≥ 26.0.13 has
      an ad-hoc Camera/Microphone regression, #9529; the webview is granted both).
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
      starts its own Ollama (`OLLAMA_CONTEXT_LENGTH` seed 16384) and the `"auto"` probe settles the served
      `num_ctx` (the "Context: auto → N" log line).
- [ ] **Start/Stop + crash-restart:** the chrome Stop/Start toggles the farm; `taskkill` the `lol up` tree →
      bounded auto-restart; quitting the app reaps LiteLLM/Ollama (no orphans).
- [ ] **Private by default (the compute-privacy toggle):** fresh install → a second machine
      **cannot** reach the farm — `curl http://<box>:4000/v1/models` refuses AND the client's subnet
      scan does NOT find it (localhost bind + no beacon). Flip **Settings → Share compute** → the farm
      restarts, the second machine now reaches the proxy and the client auto-discovers it; flip back →
      it disappears + refuses again. The chrome shows 🔒 private vs. the shared endpoint.
- [ ] **Private really means the plugins too (FA-4):** while private, from a second machine
      `curl http://<box>:8888/healthz` (web search) and `http://<box>:8890/health` (OCR) refuse; on the
      farm box itself a client still gets web search and document reading (the snapshot advertises
      `http://127.0.0.1:8888` / `:8890`). Shared again → both answer on the LAN address.
- [ ] **Upgrade migration:** a farm installed while the app defaulted to shared (farm-v0.0.1) → after
      updating, boot enforces private (the box stops being reachable until the operator opts in).
- [ ] **A client connects:** with sharing ON, a second machine's LlmOnLan **client** auto-discovers this farm and chats.
- [ ] **Per-OS installers** (CI on a `farm-v*` tag): NSIS (win x64), dmg+zip (mac arm64, ad-hoc), AppImage
      (linux **arm64** — the DGX). SmartScreen/Gatekeeper unsigned warnings documented for the operator.
- [ ] **DGX Spark:** the arm64 AppImage runs on the Spark; the plain `ollama-linux-arm64` archive loads
      gemma4:12b on the GB10 GPU (vs. the `-jetpack5/6` variants); FUSE present or `--appimage-extract-and-run`.
- [ ] **Low-RAM Mac:** a <16 GB Mac shows the wizard's memory **warning** but still proceeds.
- [ ] **★ Manual update check:** with `farm-v0.0.N` installed, publish `farm-v0.0.N+1` as a prerelease →
      at launch (Notify on) the app shows "Version … is available" and Download opens the release page;
      the client's `v*` auto-update is unaffected.
- [ ] **Farm version on the wire (FA-6):** `lol fleet` (and `version` in `http://<box>:41997/lol/self`)
      shows the Farm app's release (e.g. `farm v0.0.39`), not `0.1.0`. (A client's farm card shows no farm
      version.)

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
      hostname/version/idle; quitting one removes it within ~30 s; the farm card shows seats ("N of M
      seats free", plus "K connected" when that differs).
- [ ] **Blender recommendation:** Recommend from the panel → a client that never touched the toggle
      enables it; a client that explicitly disabled it is left alone.

## Engines, seats and names (needs a real rig)
- [ ] **Seat gate:** two source IPs against a farm with 1 seat → the second one's completion gets a 429
      `lol_seats_full` ("All 1 seats … in use"); after `proxy.seatIdleSec` of no generation from the first,
      the second one gets in.
- [ ] **External engine killed mid-run:** stop the operator-run vLLM/SGLang → within one health tick the
      farm goes unhealthy (`healthy:false` in `/lol/self`) and clients fail over; restart it → healthy again.
      The panel offers no slots/context/engine control while external serves (FA-1).
- [ ] **llama.cpp on the DGX Spark** from the `llamacpp-b10670` tarball (our `build-llamacpp-arm64.yml`):
      `lol up` downloads it, llama-server loads on the GB10, the panel reads `llama.cpp · …`.
- [ ] **An engine switch keeps the served name (FA-2):** rename the Ollama default in the panel (e.g.
      `tutor`), switch to llama.cpp → clients still see `tutor` and an open chat keeps working; switch
      back → still `tutor`.

## Dev-environment gotchas already found
- LiteLLM + OWUI children are spawned with `PYTHONUTF8=1` (Windows cp1252 banner/log crash).
- `ELECTRON_RUN_AS_NODE=1` in the shell env makes Electron run as Node → launch with
  `env -u ELECTRON_RUN_AS_NODE`.
