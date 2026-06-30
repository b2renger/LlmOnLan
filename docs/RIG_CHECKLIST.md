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
- [ ] **Failover:** two Ollama hosts serving the same model; kill one mid-chat → LiteLLM routes around it
      (router `allowed_fails`/`cooldown`). Size by concurrent in-flight generations, not headcount.
- [ ] `lol up` starting a **local Ollama** when none is running (the spawn path; here Ollama was already up).
- [ ] `gemma4:12b` pull on a fresh box (the dev box already had a `gemma4` tag).

## Open WebUI integration (re-verify per pin — see INTEGRATION_BRIEF §7)
- [x] OWUI 0.10.1 boots with the privacy env; `/health` true; **local** MiniLM embeddings load in-process.
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
- [x] `electron-builder --dir` packs a real `LlmOnLan.exe`; `extraResources` places the sidecar at
      `resources/sidecar/`.
- [ ] **Full installers** built by CI on a `v*` tag: NSIS (win), dmg+zip (mac arm64+x64), AppImage (linux),
      each bundling the real multi-GB OWUI sidecar.
- [ ] **Auto-update cycle:** install `vX.Y.Z`, publish `vX.Y.(Z+1)`, confirm the installed app self-updates
      on next launch — per OS. Windows: silent, no UAC (rides on NSIS `perMachine:false`). macOS: ad-hoc
      signing is the weak link — **validate on real Macs** (zip target present for Squirrel.Mac). Linux:
      AppImage must be launched as an AppImage.
- [ ] **The upgrade test:** bump `sidecar/OPENWEBUI_VERSION`, rebuild the sidecar, run the smoke test —
      pass = **no LOL code changed** and everything works. A failure is a separation defect to redesign.
- [ ] First-run model download (~90 MB MiniLM) latency on a fresh install; unsigned-app OS warnings
      (SmartScreen / Gatekeeper right-click→Open) documented for users.

## Dev-environment gotchas already found
- LiteLLM + OWUI children are spawned with `PYTHONUTF8=1` (Windows cp1252 banner/log crash).
- `ELECTRON_RUN_AS_NODE=1` in the shell env makes Electron run as Node → launch with
  `env -u ELECTRON_RUN_AS_NODE`.
