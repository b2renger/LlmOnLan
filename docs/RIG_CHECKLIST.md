# Rig / real-hardware verification checklist

What's been verified **single-machine on the dev box** vs. what still needs a **real two-machine LAN,
real installers, and the actual target OSes**. Everything below the line in each section is the residual
risk; the build itself is implemented (see [DEVLOG.md](DEVLOG.md)).

> **2026-10-09:** the open items now live in [HUMAN_TESTS.md](HUMAN_TESTS.md) (the arrow names the test there); this file keeps the
> verified ones. Two ticked lines below are history: the pin is Open WebUI **0.11.4** now, and since document search
> (2026-10-08) a farm with it turns document text into vectors (nothing kept), so "zero `/v1/embeddings`" holds only
> for a data folder still on MiniLM. The old open items' full text: `git show 3b8c0c1:docs/RIG_CHECKLIST.md`.

## Discovery (two machines, real Wi-Fi)
- [x] Beacon sent by the farm + received by a listener on the same host (UDP loopback/broadcast).
- [x] `/lol/self` unicast endpoint returns the snapshot.
- [x] Shell auto-connects to a beacon-discovered farm with no URL typed (single host).
- → **D6** (two physical machines). *(2026-09-02: beacons do not cross the 10.10.16.x ↔ 10.10.17.x subnets.)*
- → **D6** (broadcast-blocked Wi-Fi: the sweep and Add-by-address).
- → **D3** (two farms; switching repoints Open WebUI).
- → **D7** (the farm changes address).
- → **D4** (a pinned password farm, relaunched; SA-4/SA-5).
- → **D5** (a farm added by hostname; SA-3).

## Farm robustness
- [x] `lol up` → `/v1/models` + a real `/v1/chat/completions` (LiteLLM → Ollama → gemma4).
- [x] `lol status` / `lol down` from a second shell; clean intentional-stop.
- [x] **Failover:** two Ollama hosts (`:11434` + a 2nd on `:11435`) serving gemma4 → load-balanced
      (both loaded; 8/8). Killing one mid-operation → **10/10** completions still succeed after tuning the
      router (`num_retries:3`, `allowed_fails:1`, `cooldown_time:60`). Size by concurrent in-flight generations,
      not headcount. *(Multi-physical-box still worth a real-LAN run; here both Ollamas were on one box.)*
- → **N2** (`lol up` starts its own Ollama).
- → **N1** (the gemma4:12b pull on a clean box).

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
- → **D7** (env stays authoritative after the farm moves).
- A developer's check at each pin bump (read the pinned Open WebUI's source), not a person's: the app ran on 0.11.4 since 2026-09-27.
- → **B6** (offline after one microphone use; SA-2). Simulated in the lab 2026-08-27 and 2026-10-08.
- → **B3**, **B4**. Simulated end to end 2026-10-08 03:10. With document search (2026-10-08) they apply only to a data folder still on MiniLM (I5).
- → **B5**. Simulated 2026-10-08 02:02 and 03:10.
- → **C3** (the owner's v0.2.7 client still runs Open WebUI 0.10.2: About ▸ Check for chat-engine update; SA-6).

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
- → **C5** (from v0.1.45, on a spare Windows profile).
- → **C6** (Move my data, Start fresh).
- → **C6** (a USB stick unplugged).
- → **C6** (a cross-volume move, timed).

## Packaging + auto-update (CI + real OSes) — the upgrade test
- [x] `electron-builder --dir` packs a real `LlmOnLan.exe` (~100 MB, **no sidecar bundled**); the sidecar
      is downloaded to `userData/sidecar` on first run from the release's
      `owui-sidecar-<platform>-<arch>.tar.gz` asset (`sidecarManager.ts`).
- [x] **Full installers** built by CI on a `v*` tag, every platform with its `owui-sidecar-*` (verified: release v0.2.9, 27 assets, DEVLOG 2026-10-08 07:08; the Intel-Mac sidecar job since v0.2.0).
- → **E1** (Intel Mac first run).
- → **E2** (macOS ad-hoc: microphone and camera).
- → **C1** (Windows), **E1** (macOS), **E3** (Linux). Never logged for v0.2.x.
- [x] **The upgrade test** (bump the pin, nothing else changes) (verified: Open WebUI 0.11.4, "pin bump, no LOL code change", DEVLOG 2026-09-27 evening; 0.10.1 → 0.10.2 on 2026-07-01).
- → **B1** (first-run downloads and the SmartScreen/Gatekeeper steps, which GETTING_STARTED documents).

## Farm app install (new 2026-07-05 h — needs a clean-box first-run pass per OS)
The desktop installer that runs the farm for a non-technical operator (`farm-app/`). Everything
here is **residual risk** — verified so far only at the code level (tsc/tests/`resolvePython`) + a
dev Electron boot to the welcome screen on the dev box.
- [x] Dev boot: `npm run dev` opens the window to the welcome screen with no crashes (env
      `ELECTRON_RUN_AS_NODE` unset; `node node_modules/electron/install.js` if the binary postinstall was skipped).
- → **N1** (partly seen on the PRO 6000's clean-state run, 2026-10-08, which reused the owner's Ollama).
- → **N2**.
- → **N2**.
- → **N3** (Quit's `lol down` seen 2026-10-08).
- → **D10**.
- → **D10** (FA-4).
- Dropped (2026-10-09): only farm-v0.0.1 shipped shared, in July.
- [x] **A client connects** with sharing on (verified: 2026-09-03, and the production farm since, DEVLOG 2026-10-07 17:48).
- Windows and the Spark's AppImage are installed and running (DEVLOG 2026-10-08 07:08). The macOS dmg → **N5**.
- → **L1** (the GB10 seen 2026-07-06; that the model runs on it, and plain vs jetpack Ollama, not recorded).
- → **N5**.
- → **N4**.
- → **D9** (FA-6).

## Admin panel + plugins + presence (shipped 2026-07-03→05; needs a two-machine pass)
- → **D9** (start/stop of a model verified live 2026-07-04; the panel changed since).
- → **D9** (now also Classify, Speech to text, Document search; a switch lasts until the farm restarts).
- → **N1** (real PDFs read since 2026-07-05; the `.extract` bootstrap on a fresh box is left).
- → **D9**.
- → **D11** (pending since 2026-07-04).

## Engines, seats and names (needs a real rig)
- → **D1** (a 429 with two IPs on one box, 2026-09-04; the release after idle is left).
- Superseded: vLLM is run by the farm now; its watch was tested live (`kill -9`, seen in 3 s, one restart: DEVLOG 2026-10-08 02:24, step 7). The operator-run engine stays for a headless Spark (L2 step 3).
- → **L3** (and ggml-org's own arm64 build, owner 2026-10-09).
- → **K3** (FA-2; seen on a dev farm 2026-08-26, before per-model names).

## Dev-environment gotchas already found
- LiteLLM + OWUI children are spawned with `PYTHONUTF8=1` (Windows cp1252 banner/log crash).
- `ELECTRON_RUN_AS_NODE=1` in the shell env makes Electron run as Node → launch with
  `env -u ELECTRON_RUN_AS_NODE`.
