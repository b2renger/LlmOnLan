# DEVLOG — LlmOnLan

A running, dated log of what was built, how it was tested, and decisions taken. Newest first.
Each milestone lands as one (or a few) granular commits; an entry here is written **before** the
commit so the history records that a feature was tested + documented before it was pushed.

---

## 2026-07-01 (f) — OWUI auto-selects the farm's model (fix: re-picking the model every message)

**Symptom (reported):** after switching the served model (gemma4 → `ornith:35b` via the new picker), OWUI made
the user pick the model on every message. Their hunch was a box-side signalling bug.

**Investigation (box ruled out with evidence):** on the box, `/v1/models` returned `ornith:35b` on every poll
(no flap), `/lol/self` showed `healthy=true`, one model, one IP, steady over 6 polls, and `lol fleet` found
**one** farm on the LAN — so no model-list instability and no multi-farm switching by the v0.1.9 least-loaded
client. The client also never told OWUI a model (a grep found only `DEFAULT_MODEL_METADATA`). So the model
*signals* fine; what changed was *which* model.

**Root cause:** OWUI had **no default model** over its OpenAI connection. With one steady model it happened to
keep working; once the served model changed, OWUI's remembered selection went stale with nothing to fall back
to → it prompts for a model. The box does advertise its default in the beacon (`models:[{id,default}]`), but
the client wasn't using it.

**Fix (client feeds the farm's model to OWUI):** the client now reads the active farm's advertised default
model (`farmDefaultModel` in [index.ts](../shell/src/main/index.ts)) and sets OWUI's **`DEFAULT_MODELS`** via
[configBridge](../shell/src/main/configBridge.ts), so OWUI auto-selects whatever the farm serves. Threaded
through the sidecar supervisor ([sidecar.ts](../shell/src/main/sidecar.ts)): `start`/`repoint`/`setDataDir`/
crash-restart all carry `defaultModel`, and it's part of `repoint`'s change-check so **switching the served
model (same endpoint) still restarts OWUI to re-default it**. Env-authoritative each launch
(`ENABLE_PERSISTENT_CONFIG=false`), so it tracks the farm with zero clicks. tsc clean.

**Ships in the next client release; needs on-box confirmation** — I couldn't reproduce OWUI's UI from here, so
if re-picking persists after updating, the next thing to check is whether a *new* chat also starts model-less
(vs only pre-existing chats that stored the old model id).

---

## 2026-07-01 (e) — Choose the served model at `lol up` (installed-Ollama picker)

`lol up` always served the fixed `config.models`. Now the operator can **pick which installed Ollama model(s)
to serve at startup**, from what's actually on the box.

- **New [farm/src/modelPicker.js](../farm/src/modelPicker.js)** — `selectModels(config, hosts, args)` resolves
  the run's catalog: (1) `--model <id[,id]>` / `-m` → serve those, no prompt (pulls if absent); (2) `--no-pick`
  / `--yes` / **no TTY** (scripts, CI, `npm run`) → `config.models` unchanged, so nothing existing breaks;
  (3) otherwise an **interactive picker** — lists installed models with param + disk size (via new
  `ollama.listModelsDetailed`, off `/api/tags`), defaulting to the config's default, Enter to accept, or a
  number / comma-separated list.
- **Wired into [up.js](../farm/src/commands/up.js)** right after Ollama is confirmed reachable and before the
  pull/config steps: the choice replaces `config.models` **in memory** for this run, so it flows through the
  pull, the generated LiteLLM routing, the beacon snapshot, and (coordinator) peer matching. `lol.config.json`
  is left untouched — the persistent catalog is still managed with `lol models add/rm`.
- Purely farm-side (no client change) → reaches the boxes via `git pull`, no release.

**Tested:** farm suite 27 pass (`parseModelFlag` for `--model`/`-m`/`--model=`/comma-lists + not swallowing a
following flag; `selectModels` honours `--model`, `--no-pick`, and the no-reachable-models/non-interactive
fallback). Live: `installedModels` against the box's Ollama listed `gemma4:12b` (11.9B/7.6 GB),
`gemma4:latest` (8.0B/9.6 GB), `ornith:9b` (9.0B/5.6 GB) with sizes.

---

## 2026-07-01 (d) — Multi-box load balancing: least-loaded selection, coordinator farm, `lol fleet`

Closed the Layer-2 gap from the plan (several GPU boxes + several clients → no automatic spreading). Three
pieces, one design that unifies two deployment styles:

- **#1 Least-loaded client selection** ([shell/src/main/index.ts](../shell/src/main/index.ts)) — `chooseActive`
  no longer picks "first healthy"; a new `pickLeastLoaded` sorts by the GPU utilisation the beacon **already**
  broadcasts (`usage.gpuUtil`; unknown → treated as mid-load) and **scatters ties randomly** within a 15-point
  band so a fleet booting at once (all boxes idle) doesn't stampede one box. It runs **only when choosing** —
  first connect / failover — so a healthy current farm stays sticky and we never repoint OWUI mid-session over
  a load blip. Zero new infra: it turns N independent farms into a self-balancing pool.
- **Peer discovery for the CLI** ([farm/src/peerListener.js](../farm/src/peerListener.js)) — the farm can now
  *hear* other farms (it only sent beacons before). Mirrors the shell's discovery: UDP multicast + directed/
  limited broadcast, **plus** a unicast `/lol/self` subnet sweep for broadcast-blocked Wi-Fi; peer registry
  keyed by farm id, self excluded. Shared by the next two.
- **#2 Coordinator farm** (`lol up --coordinator`, or `coordinator:true` in config) — at boot it discovers peer
  farms and folds each into the generated LiteLLM config as an `openai/<model>` deployment of the same
  `model_name` ([farm/src/litellm.js](../farm/src/litellm.js) `buildLitellmConfig(config, peers)`), so **one
  endpoint shuffle-balances across the whole fleet** (each peer proxy then balances its own Ollama) with the
  same failover. It advertises `coordinator:true` in its beacon; the client's `pickLeastLoaded` **prefers a
  coordinator when one exists** — so with no coordinator clients balance client-side (#1), and with one present
  they route through it (#2). Static at boot (a box added later → restart the coordinator); dynamic add is a
  noted follow-up (a proxy restart mid-flight is disruptive, and live `/model/new` needs a master key that
  would force keys on clients).
- **#3 `lol fleet`** ([farm/src/commands/fleet.js](../farm/src/commands/fleet.js)) — listens + sweeps for ~7 s
  and prints every farm on the LAN (this box + peers): health, GPU %, VRAM, hosts up, backends, loaded models,
  model catalog, coordinator role, last-seen. The telemetry was already in the beacon; this renders it.

**Capacity reminder unchanged:** one Ollama serves `OLLAMA_NUM_PARALLEL` (default 2) concurrent generations —
size the fleet by in-flight generations, not headcount.

**Tested:** farm suite 23 pass (peer aggregation adds openai deployments + preserves `supports_vision`; skips a
peer that doesn't serve the model; coordinator config default false; snapshot carries `coordinator`/
`deployments`). Shell `tsc` clean. `lol fleet` smoke-run on the box renders self correctly (hardware, 0% GPU,
loaded/idle) and reports no peers on a single-farm LAN. Client change ships in the next release; the farm
changes reach the boxes via `git pull`.

---

## 2026-07-01 (c) — Multimodal verified + OWUI update procedure (the misleading toast)

**Multimodal confirmed working on the box.** Proved the vision chain layer-by-layer with live tests on the
dev/GPU box: `gemma4:12b` reports `vision` capability and describes a test image directly via Ollama; the
*running* proxy (old `gemma4`, no flag) DROPPED the image ("Please provide the image"); a throwaway proxy on
the regenerated config (`gemma4:12b` + `supports_vision`) DESCRIBED it ("a blue circle… on a red field").
After `lol up` + updating a client to v0.1.7, **image description and webcam work by default** — the
`DEFAULT_MODEL_METADATA` vision baseline flips OWUI on with no per-model toggle (owner-confirmed). Also
pinned the farm to `gemma4:12b` (was `gemma4` → `:latest`) so the 12B multimodal build that fits the 4070 is
what's served. Voice was already confirmed live.

**The misleading OWUI update toast.** On startup OWUI popped "a new version (v0.10.2) is available" while our
own **About → Check for chat-engine update** said "up to date (v0.10.1)." Both were right from their own
vantage: the toast is OWUI's **built-in upstream check** (it queries the OWUI GitHub), whereas our button
compares the installed sidecar to the OWUI version in **our latest release's** `owui-sidecar-manifest.json`
(0.10.1, the sidecar we built + shipped). We manage OWUI by pinning + repackaging it as a sidecar tarball and
updating through the app (sidecarManager: check → download to `.pending` → apply on next launch), so OWUI's
own toast advertises versions we haven't packaged yet — contradicting our button.

**Fix (two parts):**
- **Single source of truth** ([configBridge.ts](../shell/src/main/configBridge.ts)): set
  `ENABLE_VERSION_UPDATE_CHECK=false` so OWUI stops its upstream check/toast. The app's own update flow is now
  the only OWUI-version signal the user sees.
- **Bump the pin + prove the pipeline** ([sidecar/OPENWEBUI_VERSION](../sidecar/OPENWEBUI_VERSION)):
  0.10.1 → **0.10.2** (verified on PyPI as latest; `requires_python >=3.11,<3.13` satisfied by our sidecar's
  Python 3.12). Cutting the release rebuilds the sidecar tarball + manifest at 0.10.2, so existing clients'
  **Check for chat-engine update** will see 0.10.2 > 0.10.1, download it, and apply it on restart — which
  exercises the whole in-app OWUI update procedure end-to-end.

---

## 2026-07-01 (b) — Vision, take 2: OWUI defaulted models to vision-OFF

**Field report after v0.1.6:** voice mode worked (mic fix confirmed live), but attaching an image still got
"my interaction mode does not include vision processing capabilities," AND the **webcam** couldn't be
accessed in call mode.

**Root cause (the webcam clue nailed it):** the LiteLLM `supports_vision` fix (take 1) was necessary but
not sufficient — it stops the *proxy* dropping images, but **OWUI wasn't sending them in the first place**.
Over an OpenAI-style connection OWUI can't introspect a model's capabilities (the farm's `/v1/models`
returns names only), so it defaults **vision OFF**, and a vision-off model means OWUI neither sends attached
images inline NOR enables camera/webcam vision input. The mic worked because STT is capability-independent —
which is exactly why voice was fine but *both* image and webcam failed. One gate, two symptoms.

**Fix** ([configBridge.ts](../shell/src/main/configBridge.ts)): set OWUI's official
`DEFAULT_MODEL_METADATA={"capabilities":{"vision":true}}` (a v0.10.0+ env; we pin 0.10.1). It's a baseline
that flips vision on for every model, env-authoritative every launch (`ENABLE_PERSISTENT_CONFIG=false`), so
it's **zero-config across all clients** — no per-model toggle to click on each machine. Harmless for
text-only models: OWUI sends the image, but the farm's per-model `supports_vision` still gates whether
LiteLLM forwards it to Ollama, so a text-only model just has its image dropped at the proxy.

**Full working chain now:** OWUI (vision on → sends image_url + enables camera) → LiteLLM (supports_vision →
forwards image) → Ollama (gemma4, multimodal → describes it). tsc clean. Needs a client release; the farm
half still needs `lol up` on the box to regenerate the proxy config.

---

## 2026-07-01 — Multimodal: image understanding + voice mode (STT/TTS)

**Symptoms (reported):** attaching an image to a chat produced no description, and voice mode did nothing.

**Root causes (traced through the stack, farm → LiteLLM → Ollama, and shell → webview → OWUI):**

1. **Images silently dropped by the LiteLLM proxy.** The farm serves `gemma4`, which *is* natively
   multimodal — so the model was never the problem. But the generated LiteLLM config
   ([farm/src/litellm.js](../farm/src/litellm.js)) declared each model with only `model_name` +
   `litellm_params` and **no `model_info`**, and `litellm_settings.drop_params: true` is on. LiteLLM's cost
   map doesn't know our Ollama tags, so it treats the model as text-only and, with `drop_params`, **strips
   the `image_url` content before forwarding to Ollama**. OWUI sent the picture; the proxy threw it away.
   (This is the well-known OWUI + LiteLLM + Ollama "image attached but ignored" issue.)

2. **Microphone never granted to the webview.** The Electron main process
   ([shell/src/main/index.ts](../shell/src/main/index.ts)) created the OWUI `<webview>` (partition
   `persist:owui`) but installed **no permission handler**. Electron denies camera/mic by default, so voice
   mode's `getUserMedia()` was silently refused. (The origin itself is fine — OWUI loads from `127.0.0.1`,
   a secure context, so the only block was the missing grant.)

3. **No local speech engine configured.** [configBridge.ts](../shell/src/main/configBridge.ts) set no audio
   env, so STT/TTS fell to OWUI defaults that expect a cloud key — dead on a closed LAN.

**Fixes:**

- **Vision passthrough** ([farm/src/litellm.js](../farm/src/litellm.js)): infer image support from the tag
  (`gemma-4|llava|*-vl|*-vision|minicpm-v|moondream|…`, overridable by an explicit `vision:` on the model)
  and emit `model_info: { supports_vision: true }` for those deployments. LiteLLM then keeps the images
  *and* advertises the capability on `/v1/models` (so OWUI lights up the image UI). Added an optional
  `vision` field to the model schema ([farm/src/config.js](../farm/src/config.js)). **Needs `lol up` on the
  GPU box** to regenerate the config — it's derived, never hand-edited.
- **Mic permission** ([shell/src/main/index.ts](../shell/src/main/index.ts)):
  `configureWebviewPermissions()` sets a request + check handler on the `persist:owui` session that grants
  **only** `media`/`audioCapture`/`videoCapture` (scoped to the OWUI partition, nothing app-wide).
- **Local voice engines** ([configBridge.ts](../shell/src/main/configBridge.ts)): `AUDIO_STT_ENGINE=''` →
  OWUI's built-in **faster-whisper on the client CPU** (offline; `WHISPER_MODEL=base` keeps the one-time
  download ~150 MB); `AUDIO_TTS_ENGINE=''` → **client-side Web-Speech voices** (offline, zero bundle cost).
  These are env-authoritative every launch (`ENABLE_PERSISTENT_CONFIG=false`), so they can't be un-set by a
  stale persisted setting.
- **Ship the STT dep** ([sidecar/build-sidecar.mjs](../sidecar/build-sidecar.mjs)): explicitly
  `pip install faster-whisper` after OWUI (CTranslate2, not torch → no CUDA weight; a no-op if OWUI already
  bundles it) so voice works even if OWUI makes audio an optional extra.

**Tested:** farm unit tests extended (19 pass) — vision inferred from tag, explicit flag overrides,
`supports_vision` present for `gemma4` and absent for `qwen2.5-coder`; shell `tsc --noEmit` clean. **Still to
verify on the GPU box + a client build** (I can't reach the rig from here): (a) `lol up`, then attach an
image and ask "describe this" → expect a real description; (b) a fresh client build → voice mode records
(mic prompt), transcribes locally, and speaks the reply.

**Note:** vision needs a client that talks to a farm running the regenerated config; voice needs a new
client release (shell + sidecar changes). Both are LAN-local — no cloud, no farm audio load (STT/TTS run on
the client).

---

## 2026-06-30 — Fix: OWUI cramped at the top with a black bar (webview not filling)

**Symptom (reported, with a screenshot):** OWUI rendered squished into the top of the window with a large
black area below — model picker + greeting + input crammed together, input not at the bottom.

**Root cause (reproduced + measured):** the embedded `<webview>` was sized with `width/height:100%`. A
harness that loads OWUI and resizes the window showed the precise failure: the **webview *element*** fills
`.main` correctly (e.g. 745px → 355px on resize), but the **embedded guest's viewport stays stuck at its
intrinsic 150px** — so OWUI lays out in a 150px-tall page and the element's background shows below it
(the black bar). Percentage height on an Electron `<webview>` doesn't propagate to the guest viewport and
never re-tracks a window resize; `position:absolute;inset:0` had the same flaw.

**Fix** ([shell/renderer/styles.css](../shell/renderer/styles.css)): size the webview by **flex** instead
— `.main { display:flex }` + `webview { flex:1 1 auto; align-self:stretch; min-width:0 }` (no
width/height). With flex stretch the guest viewport tracks the element at every size (harness: guest
innerHeight 745 → 355 = fills). The absolute overlay (`inset:0`) is out of flex flow, so it's unaffected.

**Tested:** the resize harness goes from a 150px guest (black bar) to a fully-filling guest with flex; and
a real packaged app launched + resized to a short window (added a `LOL_SMOKE_RESIZE` smoke option) renders
OWUI filling the whole window, no black bar. Shipping as the next patch.

---

## 2026-06-30 — Small installer: download Open WebUI on first run + in-app updates

The bundled-OWUI installer was ~740 MB (Win) / ~1.3 GB (Linux). Switched to a **small installer
(~120 MB) that downloads the OWUI sidecar on first run**, plus in-app update buttons for both the app and
the chat engine.

- **Installer** ([shell/electron-builder.yml](../shell/electron-builder.yml)) — dropped `extraResources`
  (the sidecar). win-unpacked fell from ~1.5 GB to **357 MB** (→ ~120 MB NSIS). Also set
  `nsis.artifactName: ${productName}-Setup-${version}.${ext}` — electron-builder's default name has spaces
  that GitHub turns into dots on upload (`LlmOnLan.Setup.0.1.3.exe`), which breaks electron-updater's
  filename match in `latest.yml`.
- **Sidecar as a release asset** ([.github/workflows/release.yml](../.github/workflows/release.yml)) — CI
  still builds the per-OS sidecar, then packs it as `owui-sidecar-<platform>-<arch>.tar.gz` (+ a tiny
  `owui-sidecar-manifest.json` with the OWUI version) and uploads it via `gh release upload`. (Bonus: this
  also sidesteps the 2 GB asset limit that the bundled Linux AppImage kept hitting — the small AppImage and
  the sidecar tarball are each well under it.)
- **Download on first run** ([shell/src/main/sidecarManager.ts](../shell/src/main/sidecarManager.ts)) — a
  packaged app with no `userData/sidecar` downloads the matching tarball (redirect-following `https`, byte
  progress), extracts it with the system `tar` (relative paths to dodge the Windows drive-colon bug), and
  swaps it into place. [paths.ts](../shell/src/main/paths.ts) `resolveSidecarCommand` now points at
  `userData/sidecar` (packaged); the renderer shows a "Setting up the chat engine (~700 MB, one-time)"
  progress overlay with a Retry on failure.
- **In-app updates** ([Preferences](../shell/renderer/index.html)) — **Check for app updates**
  ([updater.ts](../shell/src/main/updater.ts) `checkForAppUpdate`/`quitAndInstallUpdate`; downloads in the
  background, "Restart & install" when ready) and **Check for chat-engine update** (compares the installed
  OWUI version to the latest release's manifest; downloads a newer sidecar to `userData/sidecar.pending`,
  applied on the next launch by `applyPendingSidecar()` so a running OWUI isn't disturbed — "Restart to
  apply").

**Tested:** tsc + renderer clean; the small `--dir` build has no `resources/sidecar` (357 MB). End-to-end
first-run download verified against a real release asset — a fresh-userData small build downloaded the
778 MB sidecar, extracted it, ran OWUI from `userData/sidecar`, and reached the authenticated chat.
**Shipped as v0.1.4** (single clean release, all 4 jobs green): installers `LlmOnLan-Setup-0.1.4.exe`
**97 MB** / `…-arm64.dmg` 111 MB / `….AppImage` 120 MB (down from ~740 MB / ~1.3 GB), the per-OS
`owui-sidecar-*.tar.gz` (777/702/1231 MB) + manifest, and `latest*.yml` whose `path` matches the
hyphenated installer name (so electron-updater resolves it).

---

## 2026-06-30 — Farm bootstrap: `lol install` (one command to set up, one to run)

A fresh checkout on a GPU box was a multi-step manual setup (install Ollama, `pip install litellm`, point
the config at the venv, pull models). Collapsed that into **one command to install, one to run**, the way
the desktop client is one installer.

- **`lol install`** ([farm/src/commands/install.js](../farm/src/commands/install.js)) — idempotent
  bootstrap: (1) scaffold `lol.config.json` if absent; (2) install **Ollama** if missing —
  `winget install Ollama.Ollama` on Windows, `brew install ollama` on macOS, the official `install.sh`
  on Linux (detected as "present" if the CLI is on PATH or a local daemon answers, so it never reinstalls);
  (3) create `farm/.venv` with the operator's Python 3.9–3.13 and `pip install "litellm[proxy]"`;
  (4) pull every configured model over Ollama's HTTP API. Each step is skipped if already satisfied, and a
  missing auto-installer (no winget/brew/curl/Python) prints the exact manual step instead of failing.
- **`farm/.venv` is auto-used** ([farm/src/proc.js](../farm/src/proc.js) `resolveLitellmCommand`): with the
  default `litellm.command:"litellm"`, the farm prefers `farm/.venv`'s litellm if `lol install` made one,
  else falls back to PATH — so a fresh pull needs **no config editing**. An explicit absolute command still
  wins.
- **Wrapper scripts** for the literal two commands: [farm/install.ps1](../farm/install.ps1) /
  [install.sh](../farm/install.sh) (`npm install` + `lol install`) and [farm/run.ps1](../farm/run.ps1) /
  [run.sh](../farm/run.sh) (`lol up`). So a fresh GPU box is: `cd farm; ./install.ps1; ./run.ps1`.

**Tested:** `lol install` on the dev box runs the full happy path idempotently (detects Ollama, the venv,
and the pulled model — exit 0); `where`/`py -3.12` probes resolve (winget + Python 3.12 present); 16/16
farm unit tests pass incl. two new ones for `resolveLitellmCommand` (explicit path wins; default →
`.venv`-or-PATH). The actual installer invocations follow each tool's official method; the model-pull
reuses the existing HTTP `pullModel`. Docs: [farm/README.md](../farm/README.md) gains a "Quick start
(fresh pull) — two commands" section + a `lol install` breakdown.

---

## 2026-06-30 — M5 release: published to GitHub Releases (v0.1.1 → v0.1.3, validated)

First real packaged release — the "streamline testing with several clients + one GPU box" goal: install
the client on each machine, all pointing at the one farm, with **auto-update** from GitHub Releases.

**Two build fixes were needed before the first release could be trusted:**
- **`OPENWEBUI_VERSION` wasn't staged into the bundle** — `paths.bundledOwuiVersion()` reads
  `resources/sidecar/OPENWEBUI_VERSION` (About panel), but `build-sidecar` only copied `launcher.py` +
  `python/`. Now copies the pin too.
- **`tar` Windows drive-colon** — GNU/MSYS `tar` reads `C:\…\python.tar.gz` as a remote `host:path`
  ("Cannot connect to C:"), so extraction failed wherever GNU tar is first on PATH (a CI windows-latest
  risk too, since Git ships GNU tar). `build-sidecar` now runs `tar` from `workDir` with **relative**
  paths, which both GNU tar and Windows' bundled bsdtar handle.

**Validated locally before tagging (so the first public release isn't broken):**
1. Built the full `win32-x64` sidecar — standalone CPython (python-build-standalone) + `open-webui==0.10.1`
   (torch/chromadb/transformers, ~1.5 GB).
2. Ran the bundle directly: `python launcher.py serve` → `/health 200`, `/api/config` `v0.10.1`.
3. `electron-builder --dir` pack → launched the **packaged** `LlmOnLan.exe`: it resolved the bundled
   sidecar (`[sidecar] spawning (packaged): …/resources/sidecar/python/python.exe …launcher.py serve`),
   booted OWUI, and rendered the **authenticated** UI — the "What's new in Open WebUI" modal + full
   sidebar (signed-in admin), confirming the auth-reveal fix in a real packaged build
   ([docs/img/packaged-app.png](img/packaged-app.png)). (`app-update.yml ENOENT` in a `--dir` pack is
   expected — that file is emitted by the NSIS target in CI, not `--dir` — and the updater catches it.)

**Release flow:** `npm run release:patch` → bumps `shell/package.json`, tags `vX.Y.Z`, pushes →
`.github/workflows/release.yml` matrix (windows/macos/ubuntu) each builds its own sidecar then
`electron-builder --publish always` to the GitHub Release. Clients with auto-update on (default) pull the
next version from there. The chat-auth fix above ships in this release.

**The real CI run then surfaced four more bugs (fixed; the local `--dir` pack couldn't catch any of them):**
- **`release.mjs` ENOENT on Windows** — `execFileSync('npm', …)` can't spawn `npm.cmd` without a shell;
  pass `shell:true` (git is a real `.exe`, unaffected).
- **CI never compiled TypeScript** — the workflow ran `electron-builder` directly, not the `dist` script
  that chains `npm run build`, so the app.asar shipped without `build/main/index.js` and every OS failed
  the packager's entry-file sanity check. Added an explicit `npm run build` step. *(After this, Windows
  built + published a working 741 MB installer + `latest.yml`.)*
- **Linux AppImage > 2 GB** — on Linux the PyPI `torch` is the **CUDA** build, which pulls **~3–4 GB of
  `nvidia-*`/`cuda-toolkit` wheels** (cudnn, nccl, cublas, …) as dependencies, blowing past GitHub's 2 GB
  asset limit (Windows/mac get CPU torch by default). v0.1.2's first attempt swapped the torch *binary* for
  the CPU wheel but `--no-deps` left the multi-GB nvidia packages behind — still > 2 GB. **v0.1.3** fixes it
  for real: swap torch → CPU **and** `pip uninstall` the orphaned `nvidia-*`/`cuda-*` packages (CPU torch
  never loads them). The client only needs CPU embeddings; the GPU box runs the farm.
- **electron-builder's GitHub publisher is unusable across a matrix** — it uploads a release's assets in
  parallel and each upload that finds no release creates its own, which (a) 422'd `already_exists`, dropping
  assets, and (b) it *ignores a pre-made published release* and makes its own draft → **two non-draft v0.1.3
  releases with assets split between them**. `max-parallel:1` (cross-job) and a `create-release` pre-make job
  both helped but neither cured it. **Final fix: stop publishing via electron-builder.** Build with
  `--publish never` (which still emits the `latest*.yml` manifests + blockmaps in `dist/`), then upload with
  `gh release upload "$TAG" … --clobber` to the release the `create-release` job pre-made. `gh` doesn't
  create-race, `--clobber` makes re-runs idempotent, and `max-parallel:1` keeps uploads from overlapping.
  Also dropped the mac **x64** target — the sidecar is built for the runner's arch (arm64), so an Intel dmg
  would ship an arm64 Python (re-add once `build-sidecar` emits both arch bundles).

So **v0.1.1** was the Windows-only first attempt; **v0.1.2** got Windows (NSIS) + macOS (arm64 dmg+zip)
clean (the serialize fix landed the mac assets) but Linux still 2 GB; **v0.1.3** is the fully-green
release — Windows, macOS, and Linux (AppImage) all published with their auto-update manifests.

---

## 2026-06-30 — Fix: embedded OWUI rendered unauthenticated (no chat stream, sparse features)

**Symptom (reported):** the shell connects to a farm and the model is selectable, but **chat answers
never stream back** and **many Open WebUI features are missing**.

**Root cause (found via systematic debugging, evidence at every boundary):** the whole stack was
healthy — the farm streams (`curl` to `:4000` ✅), and OWUI→farm→Ollama works end‑to‑end in a normal
browser (Playwright drove a full streamed reply with all features ✅). The break was **webview‑specific
and timing‑based**:
- OWUI's SvelteKit SPA fetches `GET /api/config` and **first‑paints before** the `WEBUI_AUTH=false`
  auto‑login writes its token. Unauthenticated, `/api/config` returns the **sparse** feature set
  (7 keys vs 37) → "features missing", and any chat `POST /api/chat/completions` **401s** → "no answer".
  Once the token lands, a single reload re‑bootstraps the SPA fully authenticated.
- It bites **nearly every launch**, not just the first: `localStorage` is keyed by origin, and the
  sidecar takes a **fresh ephemeral port** whenever its preferred `8080` is busy ([util.ts](../shell/src/main/util.ts)
  `findFreePort`), so each boot is a new origin with empty storage that loses the race again. (A normal
  browser happened to win the race, which is why it only reproduced inside the `<webview>`.)

Proven with a minimal Electron `<webview>` harness: probe at first paint → `hasToken:false`, 7 features,
chat `401`; after waiting for the token + **one reload** → `hasToken:true`, 37 features, chat `200` with
streamed chunks.

**Fix** ([shell/renderer/app.js](../shell/renderer/app.js)): keep the "Starting your local chat…" overlay
up until OWUI is authenticated, never flashing the degraded UI. On the webview's `did-finish-load`,
`ensureAuthenticated()` checks `localStorage.token`; if absent it waits (≤20 s) for the auto‑login token,
then **reloads once**. A `webviewAuthed` gate drives the reveal and `authReloadPending` prevents reload
loops; both reset when the OWUI origin changes (repoint / new port), so every fresh origin re‑bootstraps
cleanly.

**Tested:** the `<webview>` harness goes sparse→full + chat `200` after the reload; an isolated real‑app
instance (own `--user-data-dir`, fresh partition → exercises the race) boots straight to the **full,
authenticated** OWUI — "Bonjour, User", model picker, sidebar (chats/search/notes/workspace), voice — with
no stuck overlay ([docs/img/owui-auth-fixed.png](img/owui-auth-fixed.png)). Renderer‑only change; no `tsc`.

---

## 2026-06-30 — M6: farm health indicators (GPU/VRAM/RAM + live util)

Richer health surfaced from the farm all the way to the client — the M6 "connection/health indicators +
richer `lol status`" goal.
- **Farm** ([systemInfo.js](../farm/src/systemInfo.js)) — dependency‑free hardware detection: RAM/CPU
  from `os`, GPU/VRAM from `nvidia-smi` (degrades to `Unknown GPU` on non‑NVIDIA boxes; swap in
  `systeminformation` if AMD/Apple detection is ever needed). `detectHardware()` runs once at boot;
  `gpuLiveStats()` (util% + VRAM used/total) is refreshed on the health timer.
- **Snapshot** ([snapshot.js](../farm/src/snapshot.js)) now carries `host` `{gpu, vramGb, ramGb, cpuCores}`
  + `usage` `{gpuUtil, vramUsedGb, vramTotalGb, loaded}` — flowing through the beacon + `/lol/self` to the
  client with no schema migration (older farms simply omit them; the client treats them as optional).
- **`lol status`** ([status.js](../farm/src/commands/status.js)) prints a Hardware line:
  *NVIDIA RTX PRO 6000 Blackwell · 96GB VRAM · 126GB RAM · 32 cores · 1% util · 2/96GB VRAM used*.
- **Shell** — the farm popover row shows the live busy indicator on the meta line (`gemma4 · 1% GPU`) +
  the GPU name/VRAM beneath ([docs/img/m6-farm-health.png](img/m6-farm-health.png)). `FarmSnapshot` type
  extended with optional `host`/`usage`.

**Tested:** 14/14 farm unit tests (added snapshot host/usage + systemInfo tests; the runner now awaits
async tests); `lol status` + `/lol/self` show the real hardware on the rig; the shell capture shows the
farm card with `1% GPU` + the GPU name. Shell `tsc` clean.

---

## 2026-06-30 — Failover verified + LiteLLM router tuned for transparent failover

Stood up a **two‑Ollama** farm to test load‑balancing + failover (the rig had a 96 GB GPU, so a second
`ollama serve` on `:11435` held a second copy of `gemma4` easily).
- **Load‑balancing:** the generated config produced two `gemma4` deployments (one per host); 8/8 chat
  completions succeeded and **both** hosts loaded the model — LiteLLM's `simple-shuffle` spread the
  traffic.
- **Failover (first pass) found a real gap:** killing `:11435` mid‑operation gave **7/8** — one request
  (and its retries) hit the dead host before the circuit‑breaker cooled it out, surfacing an
  `APIConnectionError` to the caller. Not transparent enough.
- **Fix → re‑verified:** tuned the generated `router_settings`
  ([litellm.js](../farm/src/litellm.js)) — `num_retries 2→3`, `allowed_fails 2→1` (cool a dead host out
  after a *single* failure), `cooldown_time 30→60`. Re‑ran the same kill‑a‑host test: **10/10
  completions succeeded** — failover is now transparent (a node death is invisible to the user). 10/10
  unit tests still pass.

Ticks the RIG_CHECKLIST failover item.

---

## 2026-06-30 — Rig verification: full chat E2E + document-locality (Playwright)

Two of the biggest open [RIG_CHECKLIST](RIG_CHECKLIST.md) items, verified on the live stack by driving
a real OWUI instance (pointed at a running `lol up` farm) with Playwright.

**Full chat end-to-end** ([docs/img/e2e-chat.png](img/e2e-chat.png)) — drove the actual OWUI UI:
auto‑signed‑in under `WEBUI_AUTH=false`; OWUI's `/api/models` returned **`gemma4`** (fetched from the
farm's `/v1/models`); selected the model, typed *"what does LAN stand for?"*, and got a **real streamed
response from gemma4: "LAN stands for Local Area Network."** Since `ENABLE_OLLAMA_API=false`, the farm
(LiteLLM→Ollama) is OWUI's *only* possible inference path, so this is a definitive
**OWUI → farm → gemma4** round‑trip through the real chat surface.

**Document-locality (invariant #3)** — uploaded a doc containing a unique canary phrase
(`ZQX-PINEAPPLE-42`) via OWUI's API, then checked both ends:
- **Local:** the file landed in `DATA_DIR/uploads/`, and the **canary phrase is present in the local
  `vector_db/chroma.sqlite3`** — the document was embedded + stored on the device.
- **Farm:** the farm's LiteLLM access log shows **ZERO `/v1/embeddings` requests** (only the 4
  chat/completions from the chat above). The embedding ran on the **local MiniLM** (loaded in‑process at
  OWUI startup) — the document text never left the machine. Exactly the privacy promise: documents embed
  locally; only chat context reaches the farm at request time.

Checklist items ticked: "a full chat in the embedded webview end‑to‑end" and "document‑locality RAG test".

---

## 2026-06-29 — Adversarial review pass (correctness fixes)

A fresh-eyes adversarial review of the highest-logic code (shell main process + farm CLI) surfaced
real bugs; the genuine ones are fixed (the reviewer's "reviewed-OK / not-a-bug" items were left alone):
- **Sidecar restart races (HIGH)** — a crash auto‑restart could race a `repoint()`/`stop()` and orphan
  or duplicate an OWUI process. [sidecar.ts](../shell/src/main/sidecar.ts) now uses a **generation
  counter** (every `start()`/`stop()` bumps it; an in‑flight `start()` aborts at its awaits when
  superseded) + **child‑identity** comparison in the exit handler (only the current child's unexpected
  exit restarts), and `start()` reaps any existing child before spawning.
- **`lol down` orphaned a spawned Ollama (HIGH)** — [up.js](../farm/src/commands/up.js)'s child‑exit
  handler killed `oll.spawnedPids` **without awaiting** before `process.exit`. Now it awaits the kills
  and also tears down the health timer + beacon + self‑server first.
- **Dead `requiresKey ? null : null` ternary** — [index.ts](../shell/src/main/index.js) cleaned up;
  documented that keyed farms need a key‑entry UX we haven't built (so we don't send a wrong placeholder).
- **Discovery kept working after `stop()`** — [discovery.ts](../shell/src/main/discovery.js) added a
  `stopped` flag (checked in `sweep`/`pollKnown`/socket message) and tracks the socket‑reconnect timer so
  a stopped Discovery can't re‑emit or leak a bound socket.
- **No‑farm boot could reach public OpenAI** — [configBridge.ts](../shell/src/main/configBridge.js) now
  sets `ENABLE_OPENAI_API=false` when there's no farm endpoint (privacy intent: only the farm).
- **Stale webview after a same‑port repoint** — [app.js](../shell/renderer/app.js) forces a webview
  reload on the restarting→ready transition even when the URL is unchanged.
- **Overlapping health ticks** — up.js's health interval now skips a tick if the previous probe round is
  still running.

**Tested:** shell `tsc` clean; farm 10/10 unit tests; data‑migration 9/9; and a fresh smoke launch shows
**no regression** — discovery → OWUI spawned at the discovered endpoint → ready, pill reads "Dev Box
Farm" (active‑farm match intact after the lifecycle rewrite).

---

## 2026-06-29 — M5: packaging + auto-update (electron-builder + GitHub Releases)

**What:** The self‑updating, one‑click install path (ComfyQ recipe, with the brief's §6 corrections).
- [`electron-builder.yml`](../shell/electron-builder.yml) — `com.llmonlan.client` / **LlmOnLan**; the
  bundled sidecar rides via **`extraResources`** (`../sidecar/build/sidecar` → `resources/sidecar/`,
  outside `app.asar` so it's executable); **win** NSIS `oneClick` + `perMachine:false` (silent per‑user
  updates, no UAC); **mac** `dmg` **+** `zip` for both arches (zip is required for Squirrel.Mac
  auto‑update) with ad‑hoc signing (`identity:null`, `hardenedRuntime:false`); **linux** AppImage;
  `publish: github b2renger/LlmOnLan releaseType:release`.
- [`scripts/afterPack.cjs`](../shell/scripts/afterPack.cjs) — macOS ad‑hoc `codesign --sign -` so the
  app isn't flagged "damaged" (no‑op elsewhere).
- [`scripts/release.mjs`](../shell/scripts/release.mjs) — `npm version --no-git-tag-version`, then commits
  ONLY the version files, makes an annotated `vX.Y.Z` tag, and pushes `--follow-tags` (the npm‑tagging‑is‑
  unreliable workaround); guarded to `main` + a clean tree. `release:patch|minor|major` scripts.
- [`updater.ts`](../shell/src/main/updater.js) — **electron‑updater 6.8.9** (a real runtime dep), wired
  in `index.ts`: checks on launch when enabled + packaged, downloads in the background, installs on quit;
  a no‑op in dev. The Preferences auto‑update toggle starts a check when flipped on.
- [`.github/workflows/release.yml`](../.github/workflows/release.yml) — on a `v*` tag, matrix
  `[windows, macos, ubuntu]` each builds the OWUI sidecar for its OS then runs
  `electron-builder --publish always` (`contents: write`, `CSC_IDENTITY_AUTO_DISCOVERY=false`).

**Tested:** `electron-updater@6.8.9` + `electron-builder@26.15.3` install clean (0 vulnerabilities); tsc
builds with the updater wiring. **`electron-builder --dir`** (against a stub sidecar) **packaged a real
`dist/win-unpacked/LlmOnLan.exe`** — confirming the config parses, the app packages, `afterPack` runs,
and `extraResources` places the sidecar at exactly `resources/sidecar/{launcher.py, python/}` where
`resolveSidecarCommand()` looks. `release.mjs`/`afterPack.cjs`/`build-sidecar.mjs` syntax‑check clean;
`release.yml` is valid YAML. The full installer (NSIS/dmg/AppImage) + the publish‑to‑Releases +
auto‑update cycle run in CI on a version tag — that's the upgrade test, not a single‑session step.

---

## 2026-06-29 — M0 (sidecar packaging): bundle the pinned OWUI

**What:** The build path that turns the pin into a self‑contained, shippable sidecar.
- [`OPENWEBUI_VERSION`](../sidecar/OPENWEBUI_VERSION) `= 0.10.1` — the single source of truth.
- [`launcher.py`](../sidecar/launcher.py) — drives OWUI's Typer app (`open_webui:app`) via argv, so the
  invocation is **path‑independent** (no pip console‑script shebang that breaks once the installer
  relocates the bundle). There is **no `python -m open_webui`** in 0.10.1, hence the launcher.
- [`build-sidecar.mjs`](../sidecar/build-sidecar.mjs) (+ `.sh`/`.ps1` wrappers) — downloads a relocatable
  **standalone CPython** (astral‑sh/python‑build‑standalone, latest release matched via the GitHub API
  so no tag rots), `pip install open-webui==<pin>` into it, drops in `launcher.py`, and stages
  `sidecar/build/sidecar/` (fixed name → same `extraResources from` on every OS). Chosen over PyInstaller
  because OWUI's built SvelteKit frontend + data files + torch/chromadb make a one‑file build fragile;
  a real interpreter with the package installed is the reliable path.
- [`resolveSidecarCommand`](../shell/src/main/paths.ts) updated: packaged runs
  `resources/sidecar/python(.exe) resources/sidecar/launcher.py serve --host --port`; dev keeps the
  `.venv` console script.
- [`sidecar/README.md`](../sidecar/README.md) documents the approach + the **upgrade test** (bump the
  pin → re‑build → smoke; pass = no LOL code changed).

**Tested:** the load‑bearing mechanism — **`python launcher.py serve` boots OWUI** (`/health` →
`{"status":true}`) against the existing self‑contained Python — is verified. The full multi‑GB
standalone‑Python bundle build (download + `pip install torch/…`) is heavy and runs on **CI / the build
machine**, not in this session; the script is written to be CI‑run (it's exercised by the release
workflow). This is the milestone the plan explicitly flags as a packaging spike.

---

## 2026-06-29 — M4: Preferences (data folder + connection + startup/updates + about)

**What:** A LOL‑owned, ComfyQ‑styled Preferences modal (the gear), with the four sections the plan
calls for.
- **Data location** — shows the current `DATA_DIR` (with a "(default)" tag), "Change folder…" via the
  native `dialog.showOpenDialog`. On change, if the old folder has data, the user chooses **Move my
  data** or **Start fresh**; the sidecar is stopped, the data copied (then the old removed), settings
  updated, and the sidecar restarts pointed at the new folder.
- **Connection** — auto‑search toggle, Rescan, a **subnet search‑range editor** (base + 3rd/4th octet
  from–to, defaulting to the machine's own subnet), Add‑by‑address, and removable manual‑peer chips —
  the richer counterpart to the topbar popover, all driving the M3 discovery module.
- **Startup & updates** — launch‑at‑login (`app.setLoginItemSettings`), an auto‑update toggle (the
  updater itself lands in M5), and version display.
- **About** — LlmOnLan version (`app.getVersion()`) + bundled Open WebUI version (read from
  `sidecar/OPENWEBUI_VERSION`, the single source of truth) + a "Powered by Open WebUI" link.
- Main: new module [dataMigration.ts](../shell/src/main/dataMigration.ts) (transactional copy‑then‑remove,
  reversible on failure, with self‑containment guards), `bundledOwuiVersion()` in paths, and IPC
  `get-prefs`/`choose-data-dir`/`set-data-dir`/`set-launch-at-login`/`set-auto-update`.

**Tested:** the modal renders all four sections (see [docs/img/m4-prefs.png](img/m4-prefs.png)) with the
data path, the search range **auto‑detected as `10.10.16–17.1–254`** (correctly spanning this /23 LAN),
versions (`v0.1.0` / `v0.10.1`), and the connected farm still shown in the pill. The data‑migration
helper has a focused unit test — **9/9** covering copy‑to‑dest, nested files, src‑removed‑after‑move,
copy‑leaves‑src, the refuse‑dest‑inside‑src guard, and empty‑src. (The folder *pick* itself is a native
dialog, a manual interaction; the migration core that moves the data is what's unit‑tested.)

---

## 2026-06-29 — M3 (client half): LAN discovery + connection UX (no URL typed)

**What:** The shell now finds the farm itself and points OWUI at it — zero config.
- **Discovery module** ([discovery.ts](../shell/src/main/discovery.ts), ported from ComfyQ's desktop
  discovery) — merges three sources into one farm map: (1) **UDP beacons** on `239.255.43.10:41998`,
  (2) **subnet sweep** probing `GET /lol/self` (the broadcast‑blocked‑LAN fallback), (3) **manual
  add‑by‑address**. Per‑farm staleness/TTL; de‑duped by farm `id` (survives DHCP IP changes).
- **Auto‑connect** ([index.ts](../shell/src/main/index.js)) — on first run, OWUI's boot waits a short
  grace period for discovery to surface a farm, then boots **pointed at the reachable LAN address**
  (`http://<reach-host>:<proxyPort>/v1`); `onFarms` keeps it repointed as the LAN changes. Pick logic
  is sticky (pinned choice → current‑if‑good → first healthy) to avoid flapping between equivalents.
- **Connection UX** ([renderer](../shell/renderer/)) — the topbar status pill shows the connected farm
  name (green) and opens a **connection popover**: the discovered‑servers list (health dot · source tag ·
  `host:port · models` · active checkmark, click to switch), an **Add by address** field, an
  **Auto‑search the subnet** toggle, and **Rescan** — mirroring ComfyQ's controls.
- IPC + persistence: `get-farms`/`select-farm`/`add|remove-manual-peer`/`set-auto-scan`/`set-scan-range`/
  `rescan`; manual peers, auto‑scan, scan range, and the pinned farm persist to shell settings;
  `lastEndpoint` is remembered as the pre‑discovery fallback.

**Tested — the actual app (see [docs/img/m3-discovery.png](img/m3-discovery.png)):** launched with **no
`LOL_ENDPOINT`**. Logs show `[discovery] listening 239.255.43.10:41998` and the sidecar spawning with
`endpoint=http://10.10.16.58:4000/v1` — i.e. it **discovered the farm and auto‑pointed OWUI at the LAN
address** with nothing typed. The capture shows the pill reading **"Dev Box Farm"** and the popover
listing it (BEACON source, `10.10.16.58:4000 · gemma4`, active ✓) with the add/rescan fallbacks. The
sweep + manual‑add paths reuse the same `/lol/self` fetch verified in the M3 farm half.

---

## 2026-06-29 — M0 + M1: Electron shell skeleton + config‑bridge (OWUI runs in the shell)

**What:** Built the client shell (`shell/`, Electron + TypeScript) and proved the prime‑directive
separation: an **unmodified** Open WebUI runs inside our chrome, pointed at the farm purely through
env vars.
- **Sidecar supervisor** ([sidecar.ts](../shell/src/main/sidecar.ts)) — spawns
  `open-webui serve --host 127.0.0.1 --port <free>` with the config‑bridge env, health‑waits on
  `/health`, auto‑restarts on crash (bounded), and `repoint()`s by restarting with a new endpoint.
- **config‑bridge** ([configBridge.ts](../shell/src/main/configBridge.ts)) — the ONLY module that
  knows OWUI's surface (M1). Strategy: **env‑authoritative** (`ENABLE_PERSISTENT_CONFIG=false`) so a
  changed farm URL is honored every launch with no stale persisted URL winning; `ENABLE_OLLAMA_API=false`;
  `DATA_DIR` local; default local embeddings (RAG engine unset); `WEBUI_AUTH=false`; telemetry off;
  branding untouched. *(HF model cache left at its default `~/.cache/huggingface` — shared across data
  folders so changing DATA_DIR doesn't re‑download the embedding model; still 100% local.)*
- **Shell chrome** — `renderer/` topbar (logo + connection‑status pill + theme toggle + gear) over a
  `<webview>` of the local OWUI, with a connection overlay until the sidecar is `ready`. ComfyQ
  `tokens.css` (verbatim) + light/dark via `nativeTheme`. New LOL logo ([icon.svg](../shell/assets/icon.svg)
  → `icon.png`, rendered via a headless‑Chromium screenshot): a chat bubble holding a LAN node‑graph.
- **store.ts / paths.ts / util.ts** — JSON settings store, dev‑venv‑vs‑packaged sidecar resolution,
  free‑port / tree‑kill / health‑poll helpers.

**Tested — the actual app, end to end (see [docs/img/m0-shell.png](img/m0-shell.png)):** `tsc` builds
clean; launched via a new `LOL_SMOKE_SHOT` hook (boot → wait for OWUI → capture the window → quit).
The capture shows the LOL topbar (green **Ready** pill) over **Open WebUI 0.10.1 running unmodified in
the webview**, its own branding intact. Logs confirm OWUI auto‑provisioned `admin@localhost`
(`WEBUI_AUTH=false`), served its SvelteKit frontend, and ran `get_all_models()` against the configured
farm endpoint. The earlier sidecar spike confirmed all user data (webui.db, `vector_db/chroma.sqlite3`,
uploads) lands under the local `DATA_DIR` and embeddings load **locally** (MiniLM in‑process) —
invariant #3.

**M0 sidecar spike result:** `open-webui==0.10.1` installs on Python 3.12; the launch command is the
console script `open-webui serve --host --port` (NOT `python -m open_webui`, which 0.10.1 doesn't
expose; and `--port`, not a `PORT` env). It boots with the privacy env to `/health → {"status":true}`.

**Bugs/gotchas fixed:**
- **`ELECTRON_RUN_AS_NODE=1`** in this session's environment made Electron run as plain Node →
  `require('electron')` returns a path string → `app` undefined. Launch with `env -u ELECTRON_RUN_AS_NODE`
  (documented in the shell README).
- Forced `PYTHONUTF8=1` for the OWUI child too (same Windows cp1252 class of bug as LiteLLM).

**Decision — combined commit.** M0 (skeleton) and M1 (config‑bridge) ship together: the shell can't
boot OWUI without the bridge providing its env, so splitting would leave a non‑functional intermediate.
Both milestones' acceptance criteria are documented above.

---

## 2026-06-29 — M3 (farm half): UDP discovery beacon + `/lol/self`

**What:** The farm now announces itself on the LAN two ways, both fed by the one
`buildSnapshot()` so they can't drift (mirroring ComfyQ).
- **UDP beacon** ([beacon.js](../farm/src/beacon.js)) — adapted from ComfyQ's `beacon.js`. Every
  `intervalSec` it sends the snapshot to the multicast group on each interface **+** each interface's
  directed broadcast **+** the limited broadcast `255.255.255.255` (deduped), with
  `setBroadcast(true)` + `setMulticastTTL(4)`. Group `239.255.43.10:41998` — distinct from ComfyQ.
- **Unicast `/lol/self`** ([selfServer.js](../farm/src/selfServer.js)) — a tiny `http` server on
  `41997` returning the snapshot JSON (CORS‑open). This is the fallback for managed/school Wi‑Fi that
  blocks broadcast+multicast between clients (where the UDP beacon never arrives but unicast works) —
  the shell's subnet sweep / "add by address" will probe it.
- Wired both into `lol up` ([up.js](../farm/src/commands/up.js)): a shared `getSnapshot()` closure
  over a `liveHealth` object that a 15s timer re‑probes (proxy liveness + per‑host reachability +
  loaded models), then re‑kicks the beacon — so advertised health stays honest. `shutdown` stops the
  beacon + self‑server + timer.

**Tested:** built [tools/listen.js](../farm/tools/listen.js) (a standalone listener that also doubles
as the reference for the shell's M3 client half). With `lol up` running: `GET /lol/self` returned the
snapshot, and the UDP listener **received the beacon** from `10.10.16.58` with the full snapshot
(`models=gemma4 healthy=true hostsUp=1/1`). Syntax‑checked all new modules; 10/10 unit tests still green.

**Still pending for M3:** the client half (beacon listener + connection UX) lives in the shell, built
alongside M0/M1.

---

## 2026-06-29 — M2: the `lol` farm CLI (+ integration research)

**What:** Built the whole farm backend (`farm/`) — a dependency‑light Node CLI that turns one
declarative `lol.config.json` into a running, OpenAI‑compatible, load‑balanced inference farm.
- **Config** ([config.js](../farm/src/config.js)) — a strict `zod` schema with materialized defaults;
  beacon group defaults to `239.255.43.10` (distinct from ComfyQ's `239.255.42.99`, per the spec).
- **LiteLLM generation** ([litellm.js](../farm/src/litellm.js)) — emits `model_list` as
  *models × hosts*, so every Ollama host is a deployment of the same `model_name` →
  LiteLLM's router load‑balances + fails over. Routing is **derived, never hand‑authored**.
- **Ollama client** ([ollama.js](../farm/src/ollama.js)) — `/api/version|tags|ps|pull` over plain
  HTTP, no SDK. `hasModel` tolerates an implicit `:latest`.
- **Commands** — `init`, `up`/`serve`, `down`, `status`, `models ls|add|rm|pull`. `up` runs in the
  foreground and writes `.lol-runtime.json` so `status`/`down` work from another shell; `down` clears
  that file *before* killing so a foreground `up` recognizes an intentional stop and exits 0 quietly.
- **Snapshot** ([snapshot.js](../farm/src/snapshot.js)) — the discovery contract built once
  (shared by the M3 beacon + `/lol/self`), `v:1 { id, name, proxyPort, ips, openaiBaseUrl, models,
  healthy, … }`. The beacon itself is **deferred to M3** per the plan (M2 only logs it).

**Tested — end‑to‑end on the dev box, real inference:**
- `npm test` → 10/10 unit tests (config validation, models×hosts generation, snapshot, helpers).
- `lol init` scaffolds a config in a fresh dir (and refuses to clobber an existing one).
- `lol up` → Ollama detected, `gemma4` present (no pull), LiteLLM config generated, proxy healthy,
  `/v1/models` lists `gemma4`. **`POST /v1/chat/completions` returned a real completion** routed
  LiteLLM → Ollama → gemma4. `lol status` (separate shell) shows the live proxy + loaded model;
  `lol down` stops it cleanly and `up` exits 0.

**Bug fixed (Windows):** LiteLLM crashed on startup with `UnicodeEncodeError` — its box‑drawing
banner can't encode on a cp1252 Windows console. Fix: spawn the proxy with `PYTHONUTF8=1` /
`PYTHONIOENCODING=utf-8` ([proc.js](../farm/src/proc.js)). This is a real, load‑bearing fix for any
Windows operator.

**Research landed:** a multi‑agent web‑research + fact‑check workflow produced
[docs/INTEGRATION_BRIEF.md](INTEGRATION_BRIEF.md). Headline facts the later milestones depend on:
- **Pin `open-webui==0.10.1`** (Python 3.11/3.12 only; run `open-webui serve --host --port` — the
  `PORT` env is *not* honored). Branding kept → license rider imposes nothing at any scale.
- **Config gotcha**: OWUI's `OPENAI_*` are PersistentConfig — env seeds only the *first* boot, then
  the DB wins. Decision for M1: **bake env + `ENABLE_PERSISTENT_CONFIG=false`** so env is always
  authoritative (the kiosk move), and set `ENABLE_OLLAMA_API=false`. Admin REST `POST /openai/config/update`
  exists but still needs an admin token even under `WEBUI_AUTH=false`, and only sticks while persistent
  config is on — so env‑authoritative is simpler and matches invariant #4.

**Decision — beacon group `239.255.43.10:41998`** (UDP) + `httpPort 41997` for the unicast `/lol/self`
fallback, all distinct from ComfyQ so both tools coexist on one LAN.

---

## 2026-06-29 — Scaffold (repo structure + tooling)

**What:** Bootstrapped the empty repo into the layout `CLAUDE.md` prescribes.
- `.gitignore` — excludes `node_modules`, build output, Python venvs, the generated LiteLLM
  config, the `lol.config.json` runtime file (example is kept), and — critically — any local
  `DATA_DIR` / `*.db` / `*.sqlite` so OWUI user data can **never** be committed (invariant #3).
- Root `README.md` — project overview, the three pieces, the prime directive, quick starts.
- `docs/DEVLOG.md` (this file) — the running build log.

**Environment confirmed on the dev box (Windows 11):**
- Node 24.14, npm 11.9 · Ollama 0.30.11 running on `127.0.0.1:11434` with `gemma4:latest` (9.6 GB).
- Python 3.12.10 available (used for LiteLLM + the OWUI sidecar; 3.14 is too new for OWUI).
- `gh` 2.92 authed to `b2renger/LlmOnLan`.

**Decision — work on `main`, granular commits.** This is a greenfield bootstrap, so per the
owner's "do everything in one path" direction the build proceeds on `main` with one tested +
documented commit per milestone (rather than per-feature PRs), so `git log` reads as the
milestone history.

**Tested:** structure only; nothing executable yet.

---
