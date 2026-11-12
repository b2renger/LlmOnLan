# The farm: the `lol` CLI, its engines, panel, presets, storage and plugins

> Moved verbatim from CLAUDE.md on 2026-11-12 (the split into context modules). It describes `main` unless a line
> names a release or says *not released yet*. Keep it true: a change to the code it describes changes this file in the same commit.

- **`farm/`** — the `lol` CLI (verified end-to-end: `lol up` → real `/v1/chat/completions`; status/down;
  beacon + `/lol/self`). **Four engines behind one LiteLLM endpoint, exactly one serving at a time**
  (owner decisions 2026-08-26/27, 09-07, 10-07), resolved by `engineOf` (`litellm.js`: external > vllm > llama.cpp >
  Ollama); the panel switches between Ollama, llama.cpp and vLLM:
  - **Ollama — the default.** Serves the `models` catalog, default **`gemma4:26b`** since 2026-11-10 (farm-v0.0.53;
    owner: "documents, describe an image, code a little; GPUs of 24 GB and above"): Gemma 4 26B-A4B Q4_K_M, vision-native
    and also the OCR model, measured on Ollama 0.33.0 at 28/28 on the spike's check with thinking on and off, 14/15 with
    the coding agent, two people at about 48k each on a 24 GB card (20.6 GiB at 32k each, 22.0 at 64k, 24.8 at 128k);
    `gemma4:12b` until then, for 12 GB cards (22/28 with thinking on). `preinstall` holds `gemma4:12b`, never served: it
    reads scanned pages beside vLLM (`OCR_BESIDE`). `ollama.contextLength:
    'auto'` MEASURES the largest `num_ctx` that stays fully in VRAM: loads the default at 16k and 32k, takes
    the per-token slope from `/api/ps`, aims at min(model native max, VRAM − max(1 GB, 8%)) and verifies with one more
    load (one halving then 16k if that spills; 8k/4k if even 16k spills). A 32k that spills keeps 16k; an aim of exactly
    32k needs no third load; with the VRAM unknown it skips 32k and verifies the native max (`up.js` `resolveOllamaContext`). The verdict caches per (model, VRAM,
    numParallel, kvCacheType, and whether document search and speech to text on the GPU run beside it). Per-arch KV math is deliberately NOT used (Gemma's sliding window makes it
    wildly over-estimate). It is applied as per-deployment `num_ctx` in the generated routing (+ the
    `OLLAMA_CONTEXT_LENGTH` seed). `kvCacheType` q8_0 and `numParallel` 2 only apply to an Ollama the farm
    starts; otherwise the panel flags capacity as unverified. Routed `keep_alive` MUST be a number — the
    string `'-1'` is refused by Ollama (`time: missing unit in duration`), hence `keepAliveValue()`.
  - **llama.cpp — opt-in (`llamacpp.enabled`), the speed pick.** `llama-server` build **b11836** (official
    ggml-org, Windows zips on CUDA 13.4; since 2026-10-23: ≥ b11454 for EmbeddingGemma 2, ≥ b11769 for the
    non-streaming cancel fix, ≥ b11803 for Flint, not served by default; it refuses `--mlock`,
    `--mmap`, `--direct-io`, `--tensor-read-lazy` in `extraArgs`) serves ONE
    `.gguf` (`llamacpp.model`, default Unsloth Qwen3.8-27B-UD-IQ2_S) as `llamacpp.alias` (`assistant`).
    `contextLength: 'auto'` = min(native max, VRAM budget), both read from the real files (`gguf.js`).
    `kvUnified` (default true) = one KV pool shared by the `parallel` slots: a person alone gets the whole
    window, and `backend.contextPerSlot` advertises the ctx ÷ slots floor (`kvUnified:false` = the hard
    split, `--ctx-size 16384 --parallel 2` → 8192 each). `mtp` defaults false (Unsloth strips the MTP head
    below UD-Q2_K_XL and llama-server then refuses to start). Prebuilts: win-x64 (ggml-org, CUDA) and
    linux-arm64/DGX Spark (our `build-llamacpp-arm64.yml` → the `llamacpp-<build>` prerelease, fetched by
    `assetsFor()`); anywhere else set `llamacpp.binDir`. If it cannot start (no prebuilt, a failed download
    or load) `lol up` **falls back to Ollama for that run with the reason on the panel** instead of exiting;
    a crash mid-run gets one restart, a second within 5 min falls back too. While llama.cpp serves, NO local
    Ollama deployment is routed or advertised — the catalog is standby inventory (and the OCR vision model,
    which talks raw Ollama).
  - **vLLM — opt-in from the panel (`vllm.enabled`), run BY THE FARM** (owner 2026-10-07, replacing the 2026-09-07
    rule "the farm never installs/starts/restarts an external server" and the 2026-10-06 recipe-plus-autostart;
    [docs/archive/plans/VLLM_MANAGED_PLAN.md](../../docs/archive/plans/VLLM_MANAGED_PLAN.md)). For many people on a big NVIDIA GPU (48 at 64k on the
    PRO 6000): Windows x64 inside WSL2, Linux x64/arm64. `src/vllm.js` (shaped like `llamacpp.js`; pure planning +
    the process half) drives the scripts in `farm/vllm/` (`serve.sh` with the farm's whole argv in
    `LOL_VLLM_ARGS_B64`, `stop.sh`, `install.sh`, the read-only `status.sh`; on Windows through `wsl.exe` with a
    timeout on every call). The panel installs it (the **download slot**: outside the job slot and `serialize`,
    never `busy`, resumable), installs **vLLM 0.33.0** (`vllm.version`; branch `vllm-033`, 2026-11-02: the five models
    below checked on it, Qwen3.6 48 people at 64k every turn against 0.30.0's 32 the same day; an install of another
    version is offered **Update vLLM**, never run by itself, which builds the new version in `.venv-next` and swaps it in
    only once its check passed, so a stopped or failed update leaves the old one serving), keeps a list of seven models (Download / Use this / Remove / Add by Hugging Face name):
    the spike's three NVFP4 models and, since 2026-10-09 (branch `vllm-models`), two that hear sound in a
    chat message (`audio`, the snapshot's `backend.audio`; vLLM's sound extras, `vllm[audio]` in `install.sh`, an
    older install offered Update vLLM): **Gemma 4 12B** (`unsloth/gemma-4-12b-it-NVFP4`, 9.25 GiB, vLLM's
    `gemma4` parsers; 16 people at 32k / 8 at 64k on the PRO 6000, every turn) and **Qwen3-Omni 30B-A3B**
    (`Qwen/Qwen3-Omni-30B-A3B-Instruct`, the thinker only, BF16 made FP8 at load, 30.9 GiB; 20 / 10 people, its memory
    the limit; `install.sh` writes its processor-only template as `chat_template.jinja` for tool calls, and the route
    drops `chat_template_kwargs` for a vLLM model with no thinking parser; vLLM's `/v1/audio/transcriptions` answers
    for it, unrouted); and since 2026-11-02 (branch `vllm-033`) **Flint 40B-A2.5B** (`RecursiveSI/flint-nvfp4-gguf`: one
    GGUF, `gguf`, whose config and tokenizer come from `configRepo` `RecursiveSI/flint`, only its small files, in
    `<folder>/config`; `minVllm` 0.33.0, refused by the checklist and Use this on an older vLLM; the `glm47` parsers; a bf16
    context only, so 40 people at 32k / 20 at 64k on the PRO 6000, its memory the limit (catalog `flint`, `kv_bf16_only`:
    the measured 50,869 B a token, so Automatic seats 19 at a whole 64k on a 60 GiB pool, fewer on a smaller one); `openThink`: `install.sh` writes
    a copy of its template whose answer opens a think block, else vLLM's `glm47` parser read a direct answer as thinking;
    `alwaysThinks`: the route drops `chat_template_kwargs`, which leaked its `<think>` into titles); and since 2026-11-09 (owner)
    **Gemma 4 26B-A4B** (`nvidia/Gemma-4-26B-A4B-NVFP4`, 18.1 GiB, the Gemma 4 flags, pictures, no audio tower; 40 people at
    32k / 20 at 64k on the PRO 6000, its memory the limit: vLLM pages its sliding-window layers per token, 37,464 B measured
    against the config's 10,240; 12/15 on LOL Vibe's agent tasks, docs/spike/RESULTS.md *Model trials*). A list saved before
    a version added models gets them at the next start, except the ids in `vllm.removed` (a Remove of a built-in);
    and sets people at once, context per person and GPU memory for conversations
    (Automatic: measured seats capped by what the pool holds; the pool from free memory less the model, ~4 GB,
    9 GB for OCR, document search's 1.5 GB while it is not running yet and an 8 % margin, never `--gpu-memory-utilization`) under the one Apply, which dry-runs and
    confirms only a restart. The boot never waits for it: a PLANNED start keeps the farm healthy + `busy`
    "Starting vLLM" and the gate answers 503 `lol_engine_starting` (503 `lol_engine_stopped` while it is stopped:
    2026-11-05, farm-v0.0.52); an unplanned death, Stop and the memory guard
    make it unhealthy. Three missed answers → look; one restart; a second stop in 5 min → Ollama with the reason.
    Stopped on purpose only (`lol down`, Ctrl-C, the Farm app's Quit/Stop, Stop, a switch, a restarting Apply);
    a crash of `lol up` or the Farm app leaves it running and the next `lol up` ADOPTS it when its SETTINGS match
    (D9: Automatic accepts the running value). `<root>/run/managed-by-farm` (serve.sh's marker) makes the old
    launchers no-ops; the orphan rule stops a marked vLLM at boot when another engine is chosen. **Take-over**
    (2026-10-07): a farm whose `external` server is a vLLM on this computer from `farm/vllm` is OFFERED "Let the
    farm run vLLM" (a person clicks; never automatic): `vllm.takeOverPlan` builds the vllm block from what runs
    (other flags in `extraArgs`), `configFile.takeOverFile` copies `lol.config.json.before-managed-vllm` then
    swaps the blocks, the marker is written, the server is adopted and LiteLLM NOT restarted (routing equal apart
    from api_key); Undo until a setting changes or a restart. A farm-v0.0.42 refuses a file with a `vllm` block
    (strict zod). The review fixes (2026-10-08): `lol down` stops only the farm's own vLLM (the one it serves
    with, or one carrying its marker), never an operator's in a folder it downloaded into; the scripts own a pid
    file only when its leader runs from their root (WSL reuses pids after a reboot); a start refuses a port another
    program answers on and counts only once `serve.sh` logged it ready; Ollama never loads beside a vLLM whose stop
    failed (the farm stays on vLLM, stopped); the check needs a C compiler (`build-essential`); Install/Download
    check the disk and leave 10 GB free; the take-over writes llama.cpp off. The leftovers (2026-10-08): a GPU no
    model of the list fits (`vllm.gpuFit`, document reading's 9 GB included: an RTX 4070/4080/4090; without it,
    Gemma 4 12B fits a 24 GB card, and a 16 GB one with document search off too, since 2026-10-09) is said on the
    vLLM section's line before any check, on Windows before anything about WSL, and offered nothing; WSL with no answer at
    boot queues the start (which keeps a server running with these settings, `keepRunning`) instead of Ollama all
    day; Automatic memory waits until freed memory stops rising (`systemInfo.untilSteady`); the runtime file `lol
    down` removed is never written back and a vLLM stopping after it is not restarted; an install's time limit stops
    its whole process group (on Linux `hf` kept downloading). A DGX Spark checklist: HUMAN_TESTS L2 and M2. Tests:
    `farm/test/vllm-lifecycle.js` (`LOL_VLLM_FAKE=1`, `test/fake-vllm` inside WSL, 24 steps).
  - **external — config file only, for servers the farm cannot run** (SGLang/TensorRT-LLM/another machine/a vLLM
    run by hand; 2026-09-07). The farm never installs/starts/stops it. Its panel section shows only while the file
    holds an `external` block (a developer wrote it); switching away from it works from the panel. Health = `GET
    {baseUrl}/models`: unreachable at boot → fallback; dies later → the farm goes unhealthy and clients fail over.
    `contextLength`/`parallel` are operator DECLARATIONS (no portable endpoint reports them); they size the
    client RAG gate and the seats. Both vLLM routes go through `serverRoute` as LiteLLM `hosted_vllm/`
    (2026-10-05), not `openai/`: the OpenAI SDK's per-chunk work held one LiteLLM core full from ~50 streams.
  - A name the operator GAVE the served model (per-model Rename, `modelAlias`, `llamacpp.alias`, `vllm.alias`,
    `external.alias`) survives an engine switch and a fallback (`carryNameAcross(config, from, to)` over the four
    engines, `engineFallback`), so bound chats keep working. An
    unnamed default is served under its raw id on Ollama (`gemma4:26b`) and as `llamacpp.alias` on llama.cpp,
    so chats bound to it re-pick after a switch; non-default catalog models are never served under llama.cpp.
  - **Seat gate** (2026-09-04, `proxy.seatGate` default true): the public `proxy.port` is the farm's own
    streaming listener (`seats.js`) with LiteLLM on `127.0.0.1:proxy.internalPort` (default port+1). An IP's
    completions claim/refresh a seat (capacity = the serving engine's slots); a seat idle `proxy.seatIdleSec`
    (900 s) frees; a generation on a full farm gets an explicit 429 `lol_seats_full` instead of queueing
    behind idlers. The gate checks the farm password BEFORE a seat (401), gates every generation route, forwards
    only the routes clients use, and its own 401/429/502 carry CORS headers (agent pages read them); Retry-After =
    the soonest a seat can free.
  - `proxy.masterKey` = the shared **farm password** (LiteLLM `master_key`; panel-settable; clients prompt
    once, verify, remember per farm). Discovery, `/health/liveliness` and the admin token stay separate.
  - **Admin panel** at `http://<box>:41997/lol/admin` (bearer = `admin.token`, or a per-run token printed by
    `lol up`; the Farm app pins one). **Its layout** (owner 2026-10-12, branch `panel-engines`): the **Presets** card on
    top (2026-10-27, below), the Serving card (what
    serves, people at once, connected; the engine's warnings), then **one collapsible section per engine** in a fixed
    order — Ollama, llama.cpp, vLLM, and External only while configured — each holding everything about its engine;
    its line (a `<summary>`) says the state without opening it (serving / standby / starting / stopped / not installed /
    cannot run on this computer, `SUMMARY` in `admin/index.html`) and one fact. The serving one opens by itself, and
    again when the engine changes; the others keep the person's choice (`localStorage` `lolEngineOpen`, kept through
    the 5 s rebuild, which also gives the keyboard focus back). Every section but the serving one ends with **Serve
    with <engine>** (`engineClick`: the same question and `/lol/admin/backend` as the old engine buttons; vLLM's off
    until it is set up, replaced by the take-over offer when there is one); opening a section never switches; opening
    vLLM's checks this computer once per page. Then **Access** (the name users see, Free an idle seat after, the farm
    password, the ONE Apply changes), Model storage, Plugins, Clients, This box. In the sections: Ollama's catalog
    (download/offer/stop/delete/Make default/Rename); the `.gguf` library (add by URL — split files too — / Use this,
    with rollback; while another engine serves, Use this chooses and downloads what Serve with llama.cpp will serve,
    owner 2026-10-09); vLLM's checklist, Install, the model list, Start/Stop, the log, WSL's disk and the take-over
    offer; each engine's part of Model storage; and, in the serving one only (Apply writes to the engine that serves),
    *People and context* and Performance (llama.cpp, a vLLM). The name users see (llama.cpp, vLLM) or per-model
    **Rename** (Ollama); people served at once, the context window (Automatic on Ollama and llama.cpp; on vLLM the
    context is a number, and people at once and GPU memory for conversations are Automatic) and the farm
    password under ONE **Apply changes** (one restart; on vLLM a dry run first, and vLLM restarts only for a new
    model, context, memory, people at once, reply cap or extra flags: `vllm.js` `restart`), and **Free an idle seat after** (`proxy.seatIdleSec`,
    1–60 min, the workshop setting — alone it applies live, no restart); Ollama download/offer/stop/delete/Make default;
    the plugin switches and the Blender fleet recommendation; and the clients with their seats. Long operations run as one
    job whose progress the panel polls. vLLM's install and model downloads run beside it in a second slot, the download slot, with their own bar and Stop. A Stop of vLLM is not kept: the
    next farm start starts vLLM again. Everything persists to
    `lol.config.json` (`configFile.js` raw patch — never the schema-parsed config) **except** the Blender
    recommendation (the plugin switches persist since 2026-10-27, `<plugin>.enabled`, written once the plugin came up or
    stopped); Ollama's slot count applies after a farm restart. The header's
    **Plan capacity ↗** opens `/lol/capacity` (2026-10-07, `farm/src/capacity/`, open like `/lol/self`, offline):
    the capacity explorer with this farm's box and model marked, and usage scenarios (documents for 5, vibe-coding
    for 10, a class of 30, …) whose picks come from the spike's measurements and the calibrated estimator
    (`scenarios.js`; the GeForce cards count as one-person boxes; the model served now comes first when it covers; a card
    that prefers people counts a lead under 10 % as a tie the better model wins, `morePeople`, 2026-10-27; the class card
    prefers people, owner 2026-11-09; the coding card counts LOL Vibe's own agent runs as evidence, `CODING`).
  - **Presets** (owner 2026-10-27, `src/presets.js` + `up.js` `makePresets`, the panel's Presets card; branches `presets`
    and `presets-users`, released in farm-v0.0.50): one per session — **Balanced** (the default, the farm as it ships:
    vLLM's shipped model and context (the card's best vLLM pick when that one is not in the list or does not fit) where
    vLLM is set up on a GPU the capacity page knows, else the model the farm ships for Ollama (`gemma4:26b`, made the
    default IN PLACE OF the old one and downloaded first when missing, its context measured inside the job; 2026-11-10,
    farm-v0.0.53: until then Ollama's default, whatever it was), so a farm serving llama.cpp switches to Ollama; the
    shipped plugins), **Documents** (`rag`: the MOST PEOPLE at 64k among models good enough for documents — `GATE_FLOOR`, 25/28
    or more on every run of the spike's check — document reading on), **LOL Vibe** (`vibe`: the most people at 64k among
    models PROVEN WITH THE IDE'S CODING AGENT — `AGENT_PROVEN`: Qwen3.6, 11/15 on the five tasks, and since 2026-11-09
    (owner, in Flint's place: Flint stays in vLLM's list) Gemma 4 26B, 12/15 on the farm's vLLM 0.33.0 and 14/15 on Ollama
    0.33.0 (2026-11-10: ollama#19191, which broke Flint's reads there, did not touch it); the most-people rule still picks Qwen3.6 on every card the
    capacity page knows (48 against Gemma's 20 on the PRO 6000) — document reading off), **Computer** (the most
    people at 32k among models that see pictures and do tools well, every plugin on). Picked for THIS box by `scenarios.js`
    `recommend()` (the capacity page's cards, the spike's measurements, the estimator; never copied), only among what it
    can run: vLLM's list where vLLM is set up on a GPU the capacity page knows for a group (people at once and memory
    Automatic: on the PRO 6000 Qwen3.6 for all four — 64k / 64k / 64k / 32k: for Documents Nemotron's 64 against Qwen3.6's
    63 at 64k is a tie, both at the spike's highest level, and 16 against 48 when everyone asks together; Q4 of HUMAN_TESTS
    measures Nemotron past 64, a real lead flips it; on the Max-Q/5500/5000 the estimate gives Nemotron a real lead; on a
    Spark Qwen3.6 for all four), else
    Ollama's default (Automatic context, 2 at once) and, for LOL Vibe, a proven model if llama.cpp or Ollama has one, else
    llama.cpp's model (said). **Document search is never switched.** Review =
    a dry run (reasons, every change, what restarts and how long, what to download first, offered, never waited for);
    Apply = ONE job through the existing controls (`setBackend`/`applyFarmSettings`/`applyVllmSettings` take an `inJob`
    progress and run inside it): plugins off, the engine with its settings (another engine's written first so the switch
    starts it with them, put back if it fails; on vLLM a running one restarts when document reading or speech to text flips,
    `forceRestart`, so Automatic memory follows), plugins on, then `preset: {id, applied}`. A setting changed by hand
    afterwards marks the card *changed* and says what (`statusOf`, against the config FILE). A farm-v0.0.49 refuses a file
    with `preset` (strict zod).
  - **Model storage** (owner 2026-10-12, `src/storage.js` + `up.js` `makeStorage`, the panel's Model storage card; branch
    `model-storage`): ONE folder for the farm's models, `storage.dir` (null = today's places: `farm/.models`,
    `farm/.stt/models`, Ollama's own, the shared Hugging Face cache, Kokoro's source tree), and the folder is the source
    of truth. Everything goes into `<dir>/gguf` (llama.cpp, document search, drafts), `speech-to-text/`, `classify/`
    (Laya, its own HF cache), `kokoro/` (the voice's .pth), `ollama/` (the `OLLAMA_MODELS` of an Ollama the farm starts:
    `lol up`, `lol install`, the Farm app's wizard), on Linux `vllm/` (`<root>/hf` a link to `<dir>/vllm/hf`), and the
    vLLM section offers `<dir>\wsl\<distro>` for WSL's disk. A `.gguf` dropped into `gguf/` joins the llama.cpp list and one
    deleted leaves it; vLLM's `hf/` folders likewise. `<dir>/.lol-storage` (written at the switch) proves the folder is
    there: without it the farm says the folder is missing and downloads or starts nothing from it. **Move here** (download
    slot) copies only each store's own files (Ollama's `blobs/` + `manifests/`, vLLM's list folders, Laya's repo; the
    rest named and left) through `.lolmove-part` + fsync + rename, the sha256 in the journal; a file it did not write
    counts only when its bytes match; then in one serialize step stops what holds the files, copies what changed, checks
    (sizes, small files byte for byte, sums), writes the marker and the config (paths by entry follow) flushed, marks the
    journal `switched`, restarts (a farm Ollama on `ollama/` only when its models moved, else `storage.ollama` keeps its
    folder), and only then deletes each old copy, checked again (nothing when the folders are one through a link; an
    Ollama manifest only with its whole, checked copy; a file in use waits for Finish). Cut short →
    `.lol-storage-move.json`; Move here goes on; Finish (vLLM's link, checked) / Forget. **The Ollama desktop app**: after
    the copy is checked the farm sets its Model location itself (`src/ollamaApp.js`: the `models` column of its SQLite
    settings, the app quit as its tray does and reopened hidden, the old value kept and put back on any failure), and
    deletes the old copy only once the app (never the farm's own Ollama) is seen reading the new folder; Linux (a service)
    or an app it cannot change: the panel says what to set, after the move. **Use the models in this folder**: a scan;
    `.gguf` → llama.cpp entries by `path`, HF folders → vLLM entries by `path`, an Ollama folder → `storage.ollama`
    (`OLLAMA_NOPRUNE=1`); **Move into the farm's folder** for `.gguf` and a lent Ollama folder. Windows: the vLLM section's
    **WSL's Linux disk** row runs `wsl --manage <d> --move` (checked first; vLLM stopped first; `wsl --shutdown` only after
    a second question naming every running Linux, from `wsl -l --running -q`). A hard disk or USB drive is said; network
    folders refused. Two independent reviews of the data-loss paths (2026-10-12) fixed: DEVLOG.
  - **Plugins** (`plugins/registry.js`): web search (SearXNG, ON), document OCR (`farm/src/pysvc` +
    `extract.js`, ON — hybrid text/vision PDF extraction), Kokoro TTS (OFF), and since 2026-09-27 **Classify**
    (Laya on the CPU, `classify.js` + `pysvc/classify_server.py`, OFF) and **speech to text** (faster-whisper,
    `stt.js` + `pysvc/stt_server.py`, OFF; since 2026-10-09 `device: 'auto'` = Whisper large-v3-turbo on the NVIDIA
    GPU, int8_float16, 1.7 GB, cuBLAS as a pip wheel in its venv, else `small` on the CPU, and a GPU that does not
    load falls back to the CPU by itself; 2 GB kept out of vLLM's Automatic memory while it is on but not running
    yet; advertised as `stt {url, key, model}`, read by the Computer's Sound box AND by Open WebUI's microphone and
    Call mode on the laptops — the farm decides which server and model transcribe; it accepts the chunked uploads
    Open WebUI sends), and the **message bus** (`bus.js`, Node stdlib, OFF: an MQTT
    3.1.1 broker :1883, a WebSocket hub :8893 and an OSC relay :9001 sharing one topic space, tied to the farm
    password — MQTT user `lol`, `?key=`, `/lol/listen <filter> <pw>`; never logs a payload), and since 2026-10-08
    **document search** (`embed.js`: llama-server `--embeddings` with ONE pinned EmbeddingGemma 2 GGUF — ggml-org's
    BF16 conversion of google/embeddinggemma-2, pinned by revision and sha256 — 768 numbers, contract
    `embeddinggemma-2/768/v1`; port 8894, 8 slots of 2048 tokens, ~1.2 GB of GPU memory; its key in `LLAMA_API_KEY`,
    never in the argv; `--no-slots`, `--cache-ram 0`, no prompt log, LLAMA_* variables dropped; it reuses the llama.cpp
    engine's build — llama.cpp >= b11454 — or `llamacpp.binDir`; `enabled: 'auto'` = on with an NVIDIA GPU it can run
    on; started BEFORE the engine sizes its memory when it is on disk, else once the farm is public; vLLM's Automatic
    memory keeps 1.5 GB for it while it is on but not running; Ollama's context verdict is keyed on it; outside the
    seat gate, no seat). They bind to `proxy.host`; the Python ones share one
    shape (own venv, a Bearer key that stays the same across runs — an HMAC of `farm/.lol-secret` and the farm
    password — one job at a time (Classify and speech to text answer 429 + Retry-After; OCR's vision pages wait their
    turn), no body ever logged). **Plugin keys are
    tied to the farm password** (2026-09-27): on an open farm the key rides the snapshot; with a password
    it is `null` there and a client holding the password fetches it from `GET /lol/plugin-keys`
    (`selfServer.js`; the client side is `farmSelect.ts` `applyPluginKeys` + `index.ts`).
  - Also: beacon group **`239.255.43.10:41998`** (+ httpPort `41997`), distinct from ComfyQ; coordinator mode;
    `lol fleet`/`lol bench`; `modelAlias` + the interactive picker in `lol up`; `lol install` (Ollama, the
    LiteLLM venv, `models` + `preinstall` — `gemma4:12b` for reading documents beside vLLM; a Qwen3.8-27B staged for
    12 GB cards until 2026-11-10 — the SearXNG/OCR venvs, document
    search when it is on — by default, with an NVIDIA GPU — (the llama.cpp build + EmbeddingGemma 2), and the llama.cpp
    engine's weights only when enabled). The farm's advertised `version` is the Farm app's
    (`LOL_FARM_VERSION`), falling back to `farm/package.json`.
- **health (M6)** — the farm advertises `host` (GPU/VRAM/RAM/cores) + `usage` (live GPU util/VRAM +
  connected clients) in the snapshot; `lol status`, the admin panel and the shell's farm cards show it.


## Backend: the `lol` farm CLI & config

Node CLI, npm‑style (mirrors ComfyQ's config‑driven Node server). Single source of truth is a
declarative config; the CLI orchestrates everything from it.

`lol.config.json` (example — every key has a default, and the file holds only what differs: the Farm app writes its
changes, and `lol init` / `lol install` scaffold the name only; until 2026-11-05 (farm-v0.0.52) they wrote every
default, which froze them, an old `vllm.version` among them):
```jsonc
{
  "name": "Studio Farm",                 // friendly name shown in the client
  "beacon": { "enabled": true, "group": "239.255.43.10", "port": 41998, "intervalSec": 5, "httpPort": 41997 },
  "proxy":  { "port": 4000, "host": "0.0.0.0",   // port = the seat gate; LiteLLM on 127.0.0.1:port+1 (seatGate false: LiteLLM on port)
              "masterKey": null,                 // the shared farm password (null = open LAN)
              "seatGate": true, "seatIdleSec": 900 },
  "models": [ { "id": "gemma4:26b", "default": true } ],   // Ollama catalog = the DEFAULT engine's serving set
  "modelAlias": null,                            // optional stable name for the default Ollama model
  "preinstall": [ { "id": "gemma4:12b" } ],      // downloaded, never served: reads scanned pages beside vLLM
  "ollama": { "hosts": ["http://127.0.0.1:11434"], "numParallel": 2, "maxLoadedModels": 1,
              "flashAttention": true, "kvCacheType": "q8_0", "keepAlive": "-1",
              "contextLength": "auto" },         // probed per box; a number pins it
  "llamacpp": { "enabled": false,                // OPT-IN: ONE .gguf served as `alias`
                "alias": "assistant",
                "model": "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-UD-IQ2_S.gguf",
                "contextLength": "auto",         // min(native max, VRAM budget); a number pins it (over-size warns)
                "parallel": 1, "kvUnified": true,// one KV pool shared by the slots; false = hard split
                "kvCacheType": "q4_0", "mtp": false, "cacheRam": "auto" },   // mtp needs UD-Q2_K_XL+
  "vllm": { "enabled": false, "root": null,      // OPT-IN from the panel: vLLM run by the farm (in WSL2 on Windows)
            "port": 8100, "alias": "assistant", "model": "qwen3.6-35b-a3b",   // a list id (seven built in: farm/README.md)
            "contextLength": 65536, "parallel": "auto", "kvCacheGib": "auto" },
  "external": { "enabled": false, "alias": "assistant", "baseUrl": "http://127.0.0.1:8000/v1",
                "contextLength": 32768, "parallel": 4 },   // a server the farm does not run; DECLARED values
  "websearch": { "enabled": true }, "ocr": { "enabled": true }, "tts": { "enabled": false },
  "embed": { "enabled": "auto", "port": 8894 },  // document search: 'auto' = on with an NVIDIA GPU
  "storage": { "dir": null, "ollama": null },   // one folder for the farm's models (the panel's Model storage)
  "preset": null,                                // the panel's preset, { id, applied } (Presets)
  "admin": { "token": null }                     // null = a fresh token per `lol up`, printed in the banner
}
```
Full reference, and the name-uniqueness rule (a per-model name may not duplicate another served name):
[farm/README.md](../../farm/README.md#config--lolconfigjson).

CLI commands:

| Command | Does |
|---|---|
| `lol init` | Scaffold a `lol.config.json` (the name only; every other key keeps its default). |
| `lol up` / `serve` | Probe an external engine; ensure Ollama (start a local one if down); pick the Ollama models (prompt / `--model` / `--no-pick`); pull what's missing; start llama-server if enabled (fall back to Ollama on failure); check vLLM if it is the engine (keep a matching one, else queue its start); size the Ollama context; generate `litellm/config.generated.yaml`; start LiteLLM on loopback + the seat gate on `proxy.port`; start the plugins; start the beacon, `/lol/self` and the admin panel; print the admin token; start vLLM as the job "Starting vLLM". Foreground. |
| `lol models ls` / `add <id>` / `rm <id>` / `pull` | Manage the Ollama catalog in `models` (then `lol up --no-pick`). |
| `lol status` | Health of each Ollama host + the proxy + which models are loaded. |
| `lol down` / `stop` | Stop the proxy, `llama-server`, every plugin (SearXNG, TTS, OCR, Classify, speech to text, the message bus, document search) and the beacon (and any Ollama it started), and the vLLM the farm runs (from the runtime file, else the config; never an operator's vLLM the farm only downloaded a model for). |
| `lol install` / `setup` | One-time, idempotent bootstrap: Ollama, the LiteLLM venv, every `models` + `preinstall` entry, the SearXNG + OCR venvs, document search when it is on (the llama.cpp build + EmbeddingGemma 2, ~0.6 GB), and (only when `llamacpp.enabled`) the llama.cpp build + weights. Never vLLM: the panel's vLLM section installs it. |
| `lol fleet` / `lol bench` | Every farm on the LAN; load-test N concurrent chats before a workshop. |

Notes:
- The CLI **generates** `litellm/config.generated.yaml` (routing least-busy, `num_retries` 3,
  `allowed_fails` 1, cooldown 60 s — none when no model has a second deployment to fail over to). On Ollama
  each host becomes a deployment of the same `model_name`
  (e.g. `gemma4:26b`), so LiteLLM load‑balances + fails over; with llama.cpp, vLLM or an external server serving, one
  OpenAI‑compatible deployment (+ coordinator peers) replaces the Ollama catalog. LOL never hand‑edits routing; it's
  derived from `lol.config.json`.
- Model choice = the admin panel (live), or edit `models` (or `lol models add`) + `lol up`. Clients see the
  catalog via the endpoint's `/v1/models`; OWUI's and LOL Vibe's pickers handle per‑chat selection.
- Prereqs (documented in `farm/README.md`): Ollama installed per box; LiteLLM available (pip/binary) —
  `lol install` bootstraps both. The CLI spawns/supervises them; it doesn't reimplement them.
- The beacon is adapted from ComfyQ's `server/federation/beacon.js` (see Discovery).
