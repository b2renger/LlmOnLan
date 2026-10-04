# LlmOnLan — Multi-user implementation plan and hardware/model brief

As of 2026-10-04. Covers LlmOnLan client v0.2.7, farm-v0.0.41, Open WebUI **0.11.4** (the pin; the field
still runs 0.10.x sidecars, because engine updates are a person's click).

**Revision 2 (2026-10-04).** v1 was written from the READMEs without the source. v2 is corrected against
the code by a read-only audit, [docs/reviews/MULTIUSER_PLAN_AUDIT_2026-10-04.md](docs/reviews/MULTIUSER_PLAN_AUDIT_2026-10-04.md),
which carries every file:line citation. A critic then weighed it against the product vision,
[docs/reviews/MULTIUSER_PLAN_CRITIC_2026-10-04.md](docs/reviews/MULTIUSER_PLAN_CRITIC_2026-10-04.md). Its
verified corrections are folded in, and its verdicts sit beside each **DECISION** in §13 (gaps in §13b).
Items that need an owner decision are marked **DECISION**.

**Revision 3 (2026-10-04, owner decisions).**

- **The goal is optimisation:** serve the most people with good quality (reasoning and coding) and a
  high context, on the **fewest boxes**.
- **The small GPUs are not farm capacity.** The 4070/4080-class boxes are booked for 3D, VR and
  workshops, and are not always on.
- **vLLM stays in scope**, overriding the critic's cut.
- **No hard per-person identity:** it adds complexity for users and the gains are unclear.
- **Future purchases** (more DGX Sparks, perhaps two RTX PRO 6000 or an A5500-class card) depend on
  measured people-per-box.

§1b, Phase 0.6, Phase 2, 3.0, Phase 5 and §13 are rewritten accordingly.

---

## 0. Instructions for the coding agent

You are working in the LlmOnLan repository (`b2renger/LlmOnLan`). This file is a design brief. v2 has been checked against the code, but every new module, config key and route is still a *proposal*.

1. **Read the real code before changing anything.** Map each proposal onto the existing layout (`farm/src/`, `farm/bin/lol.js`, `shell/`, `farm-app/`, `sidecar/`) and rename to fit local conventions. Code by the ponytail ladder (CLAUDE.md): reuse what exists, add the minimum.
2. **Respect the prime directive in `CLAUDE.md`.** Open WebUI stays vendored, version-pinned and unmodified. All persistent data stays on the client under `DATA_DIR`; the farm stays stateless. OWUI is touched only through **env vars**, plus its **user-settings** REST API for the two things env can't do. **Never the admin API**: with `ENABLE_PERSISTENT_CONFIG=false` its writes vanish at every sidecar restart. Anything OWUI cannot display (queue position, fallback badge) goes in the LOL shell's own chrome.
3. **Work in the order of section 12**, and don't start an item marked **DECISION** before the owner answers. Keep each item shippable on its own. Farm tests go in `farm/test/run.js` (`npm test` in `farm/`). Shell tests go in `npm run test:unit`, `node test/chat-unit.js`, `test/chat-lint.js` or `test/chat-scope.js`. **Never** the shell's `npm test`: it is the legacy e2e that drives the real app, and it is unsafe on the dev box, which also serves real users.
4. **Re-check the OWUI facts in §1** whenever the pin moves, and make new env vars degrade gracefully on the 0.10.x sidecars still in the field.
5. Keys and routes marked `// Phase N` do not exist yet. **The farm's config schema is strict** (zod `.strict()`): an unknown key makes `lol up` refuse to start. Never paste a §11 template into a running farm's `lol.config.json` before its phase ships.
6. Numbers marked *measured* come from published benchmarks, mostly single-author posts with different builds; *estimate* means derived. Re-benchmark on real hardware with `lol bench` before trusting user counts, once bench can simulate distinct people (Phase 0).
7. **The dev box (`AN-A6000PRO`) is also a production farm.**
   - `lol up` reaps the pids in the fixed `farm/.lol-runtime.json`; move it aside first.
   - There is no `--config` flag: run a test farm from a scratch directory, with its own ports, the
     beacon off and the plugins off.
   - Never bounce the shared Ollama under real users.

---

## 1. Repository facts this plan relies on

Verified against the code on 2026-10-04 (citations in the audit):

- **Topology.**
  - The Electron client (`shell/`) has **three surfaces**: Open WebUI, **LOL Vibe** (named LOL Chat until
    2026-09-27) and **the Computer**.
  - The OWUI sidecar is **not** in the installer: it is downloaded to `userData/sidecar` on first run and
    updated only on a person's click.
  - The farm (`farm/`, Node CLI `lol`) runs the engines, generates `litellm/config.generated.yaml`, and
    runs the UDP beacon and the admin panel.
  - The Farm app (`farm-app/`) wraps the CLI. Its updates are manual.
- **Engines.**
  - `ollama` is the default, with a multi-model catalog.
  - `llamacpp` is opt-in and serves one model as `llamacpp.alias`.
  - `external` is an operator-run vLLM/SGLang. The farm never installs, starts or restarts it, and its
    `contextLength`/`parallel` are declared, not read.
  - **External unreachable at boot** falls back to llama.cpp if enabled, else Ollama. Dying mid-run has
    no fallback: the farm only goes `healthy:false`.
  - One engine serves at a time. `carryNameAcross` carries names Ollama ↔ llama.cpp.
  - `lol up` requires a reachable Ollama before **any** engine starts. A non-serving Ollama runs with
    `keep_alive` 5m.
  - **While a non-Ollama engine serves, no Ollama model is routed at all.** The catalog is standby
    inventory, plus the OCR model.
- **llama.cpp.**
  - Defaults: `parallel` 1, `kvUnified: true` (one context pool shared by the slots), `kvCacheType: "q4_0"`.
    `cacheRam: "auto"` is ¼ of RAM, 8–32 GiB. `mtp` is only valid on quants ≥ `UD-Q2_K_XL`.
  - `contextLength: "auto"` = min(native max, VRAM − weights − mmproj − 1.4 GB). It is **independent of
    `parallel`**: slots only lower the guaranteed floor (`contextPerSlot = ctx/slots`), and a lone user
    gets the whole pool.
  - **Per-box prompt-cache affinity already exists**: `--slot-prompt-similarity 0.4`, `--cache-reuse 256`,
    `--cache-ram`. `--cache-reuse` is off whenever `mtp` is on (`llamacpp.js:188`). Vision works today
    (`mmproj` → `--mmproj`).
  - Crash policy: one restart, then a second crash within 5 min falls back to Ollama.
  - Prebuilts for win-x64 and linux-arm64 (CI release `llamacpp-<build>`); no linux-x64 prebuilt.
  - **The admin panel caps "people served at once" at 16** (`up.js:2416`); the config file has no cap.
- **Measured KV for Qwen3.8-27B (shipped quant).** ~1.2 GB per 16k tokens at q4_0 (`perf.js:89`), with
  weights ~7.8 GB for UD-IQ2_S. `gguf.js` prices **every** layer as attention, which over-estimates
  hybrid models.
- **Seat gate (`farm/src/seats.js`).**
  - The public `proxy.port` is the farm's listener; LiteLLM binds loopback at `proxy.internalPort`
    (port+1). `proxy.seatGate: false` restores direct LiteLLM.
  - One IP = one seat. The first completion claims it and every completion refreshes it. A seat frees
    `seatIdleSec` (900 s) after its **last generation ends**.
  - A full farm returns 429 `lol_seats_full` with `Retry-After: 30`, while the message says "~15 min".
  - Only four POST paths are gated (`/v1/chat/completions`, `/chat/completions`, `/v1/completions`,
    `/completions`). Everything else passes ungated, including `/v1/models` and the other generation
    routes.
  - A coordinator peer counts as one seat.
  - Facts v1 missed:
    - **The gate claims the seat before anything checks the password**; LiteLLM rejects a bad key only
      afterwards.
    - **There is no cap on in-flight requests per seat.**
    - **A client disconnect already destroys the upstream request** (`seats.js:136-142`); whether LiteLLM
      passes the cancel on to the engine is unverified, and LiteLLM is installed **unpinned**.
    - There is no queue and no request timeout.
    - Panel actions that restart LiteLLM drop in-flight chats with 502 `lol_upstream_down`.
- **Presence.**
  - Clients `POST /lol/client-ping` every 10 s with id, hostname, platform, version and idle seconds; the
    farm drops them 30 s after the last ping. There is no goodbye on quit.
  - The route is **unauthenticated even on a passworded farm**.
  - The install id (`clientId`) is per OS user in `userData/shell-settings.json`; a cloned lab image
    clones it.
  - **Presence and seats are not linked**: seats are keyed by IP, clients by id.
  - The beacon's `capacity` = `{slots, clients, seatsUsed, seatIdleSec, busy, queued}`. The last two come
    from llama-server `/metrics` only.
- **Beacon / panel.**
  - UDP group 239.255.43.10:41998 every 5 s, plus a kick on every change. HTTP on 41997: `/lol/self`,
    `/lol/admin`, and the admin-token gated `/lol/admin/*` routes.
  - Admin routes: `state`, `apply` `{name?, slots?, password?, context?}`, `backend`, `name`, `slots`,
    `context`, `security`, `llamacpp/model`, `llamacpp/library/add|remove`, `model/start|stop|default|alias`,
    `ollama/pull|remove`, `plugin/<id>/enable|disable`, `plugin/recommend`.
  - Outside `/lol/admin/*`: `GET /lol/self`, `POST /lol/client-ping`, and `GET /lol/plugin-keys`
    (password bearer).
  - One long operation at a time: refused, not queued.
- **Plugins.**
  - Defaults: SearXNG web search on, document OCR on, Kokoro TTS off, Classify/Laya on CPU off, STT
    faster-whisper on CPU off, message bus (MQTT/WebSocket/OSC) off.
  - **OCR uses the served default vision model on the box's Ollama.** On the default Ollama engine that
    *is* the chat model, so there is no second GPU tenant. The ~7.6 GB file (7.8–9.3 GB resident) becomes
    a second tenant only while llama.cpp or external serves.
  - Classify and STT take one job at a time (one per client IP, 4 waiting), then answer 429 +
    Retry-After. **OCR has no concurrency cap, and it logs filenames.**
  - Pressure eviction of Ollama models fires at ≥ 92 % VRAM and ≤ 20 % GPU busy, only while a non-Ollama
    engine serves.
  - Plugin keys are `randomBytes(24)` per plugin **start**.
- **Security.**
  - `proxy.masterKey` is the shared farm password and LiteLLM's `master_key`. The gate itself never
    checks it.
  - Plugin keys are fetched via `GET /lol/plugin-keys` with the password.
  - Plain HTTP. Failed admin attempts are not rate-limited.
- **Ops.**
  - `lol bench`:
    - Flags: `--users --rounds --model --url --prompt --max-tokens`.
    - Reports TTFT p50/p95 and **median** per-user tok/s, and saves nothing.
    - **Sends every simulated user from one IP, so the whole bench is one seat.** It still measures
      engine concurrency, because one seat admits unlimited parallel streams. What it can't measure is
      gate admission (seat counts, 429s).
  - The Performance card reads llama-server `/metrics` and is **llama.cpp-only**, with four warnings.
  - A first Farm-app run downloads **~18 GB (20–30 min)**; llama.cpp adds ~10 GB only when enabled.
  - **Every farm restart or OCR toggle restarts every connected client's OWUI (~10 s)**, because the
    per-start OCR key is in OWUI's env, and env changes restart the sidecar.
- **Use cases (from the code; details in the audit §5).**
  - *OWUI chat*: OWUI → farm. Title generation runs once per chat, and **search-query generation runs on
    every message** (web search is seeded `always`). Follow-ups, tags, autocomplete and retrieval-query
    generation are already off.
  - *LOL Vibe*: the client's own chat, farm-direct, streaming, with no tools. One request in flight per
    window, and a **seat-wait** row that resends when a seat frees.
  - *IDE / coding agent*: a mode of **project-bound** Vibe threads, DeepSeek Harness run by main. It uses
    OpenAI-native `tools`, with `max_completion_tokens` 4–8k (≥ 16k with "Keep going"). It compacts
    within the farm's `contextPerSlot`. It retries 429 by itself and keeps a small title call.
  - *Agent pages*: the page's own JS loop. Non-streaming, `json_object`, using the first listed model and
    a person-typed password.
  - *Computer*: model boxes (Instruction, Agent, Condition/Filter) run **one request at a time, on a
    background lane that yields to the person's chat**. They make **long** calls (4k/8k/16k ceilings,
    because thinking is never disabled) and use `json_schema` for structured asks only. Classify, Listen,
    Speak and Document call plugins; the bus is a Node hub. None of those takes a seat.
  - No caller picks an alias by itself, and **nothing sends a client identity**: no header, no `user`
    field.
- **OWUI 0.11.4 config surface (read from the pinned package).**
  - **Connections.** `OPENAI_API_KEY`/`OPENAI_API_BASE_URL` is what the shell writes.
    `OPENAI_API_KEYS`/`OPENAI_API_BASE_URLS` are `;` lists with a singular fallback.
    **`OPENAI_API_CONFIGS` is parsed from env** (CLAUDE.md gotcha #2 is outdated). Per-connection
    `headers` support `{{CHAT_ID}}`, `{{TASK}}`, `{{USER_ID}}` and `{{MESSAGE_ID}}` templates, the same
    in 0.10.2.
  - **Tasks.** For an OpenAI connection the task model is **`TASK_MODEL_EXTERNAL`**. It must appear in
    OWUI's model list, or OWUI silently uses the chat model.
  - **Timeouts.** Chat and title calls have **no total timeout** by default; the `/models` fetch times
    out at **10 s**.
  - **TLS.**
    - `AIOHTTP_CLIENT_SESSION_SSL` accepts True, False or a CA path.
    - `AIOHTTP_CLIENT_SSL_CERT_FILE` **replaces** the trust store.
    - The OCR loader is plain `requests`, so it needs `REQUESTS_CA_BUNDLE`.
    - There is no fingerprint pinning.
- **Fleet (studio notes; owner 2026-10-04).** The machines the studio owns:
  - Mostly **RTX 4080 (16 GB) and RTX 4070 (12 GB) Windows boxes.** These are **not farm capacity**:
    they are booked for 3D, VR and workshops, and are not always on.
  - One or two **DGX Sparks**.
  - **One RTX PRO 6000 Blackwell (96 GB), which runs Windows**: `AN-A6000PRO`, the dev box and a live
    farm.
  - A few 5090/4090/3090/A6000.
  - The farm's capacity is the **big boxes**, with more Sparks and perhaps two RTX PRO 6000 or an
    A5500-class card under consideration.
  - The office LAN is NAT-free by design (`seats.js:24-25`), but beacons don't cross subnets.
- **The PRO 6000 is shared with more than the farm** (checked 2026-10-04):
  - **ComfyUI** (ComfyQ's backend, `python.exe … ComfyUI\main.py --listen 0.0.0.0 --port 8188`, up since
    2026-10-01) keeps **~45 GB of VRAM resident** while idle.
  - **llama.cpp's auto context budgets against the card's *total* VRAM** (`farm/src/systemInfo.js:29` →
    `perf.js:108`), so beside ComfyUI it would overcommit. Ollama's probe measures live placement and is
    unaffected.
  - WSL Ubuntu on this box sees the GPU and has 94 GB RAM, 16 CPUs and 685 GB disk. Its only vLLM is
    **0.14.0, in the Rtranslate project's `~/r2t2` venv**: too old for the §9 models and not ours to
    reuse.
  - Ollama 0.34.0 already holds candidate models: `nemotron-3.5-lightning:30b`, `granite4.2:30b`,
    `ornith-1.5:35b`, and `qwen3.8` in several quants.
- **Owner decisions this plan touches.**
  - 2026-08-26: don't reserve OCR room in auto-context.
  - 2026-08-26: one engine at a time.
  - 2026-09-03: `contextPerSlot` stays the ctx ÷ slots floor.
  - 2026-09-04: idle people must not hold seats, and a full farm answers **429 rather than silently
    queueing**.
  - 2026-09-04: keep LiteLLM least-busy routing.
  - 2026-09-07: **the farm never manages an external server**.
  - 2026-09-07: slots stay config-derived.
  - 2026-09-16: **local only, never cloud**.
  - 2026-09-27: plugins get a concurrency cap, a 429 and no body logging (ECOSYSTEM_PLAN).
- **Tests.** Farm: `npm test` → `farm/test/run.js` (plus `check_services.py` when Python is found).
  Shell: see §0.3.

---

## 1b. The bigger picture (added in revision 2)

**What the product is for** (CLAUDE.md): a person on the office Wi-Fi opens one app and chats with a local
model in seconds, with no setup, all data on their machine, a stateless farm, OWUI unmodified, and nothing
in the cloud. Multi-user work has to keep all of that, and the owner's ponytail rule (the least code that
works) applies to the plan as much as to the code.

**What "multi-user" means here.** Everyday office use with a handful of people at once, and workshops where
10–30 people start together. v1's target of "50 concurrent users on one box" is an assumption, not a
measured need. **No multi-user overload has been recorded yet.** The only multi-user measurement in the
repo is 3 concurrent users at ~132 tok/s each (`docs/DEVLOG.md:5911-5913`, 2026-07-02). **DECISION:** the
real head count per room and per day.

**Owner decision, 2026-10-04: scale up.** The small GPUs are booked for 3D, VR and workshops, so the
farm's job is **optimisation**: the most people at good quality (reasoning and coding) and high context,
per big box. In numbers, a box serves

> people ≈ min( KV pool ÷ context per person , aggregate tok/s ÷ comfortable tok/s per person )

so the levers, in order, are:

1. **KV bytes per token**, which is set by the model's architecture. Hybrid models (Mamba or linear
   attention plus a few attention layers) need a fraction of a dense model's KV: on this box
   `nemotron-3.5-lightning` holds 1M tokens in ~7 GB (`docs/DEVLOG.md:3639-3641`).
2. **An engine that pages and shares KV and batches continuously**, with prefix caching: vLLM's
   strengths, which llama.cpp only partly matches.
3. **Active parameters per token**, which set decode speed under load: 3B-active MoEs against dense 27B.
4. **What each request costs:** thinking length, injected web pages, the coding agent's output caps.

The same measurements become the **purchase case**: people-per-box for a Spark and a PRO 6000 decides
between more Sparks and more PRO 6000-class cards.

The analysis below (scale out vs scale up) is kept for the record. Scale-out across the small GPUs is
**out**. Multi-box survives only as "several big boxes behind one endpoint", once there is more than one.

**Two ways to grow, and the studio already owns both kinds of hardware:**

- **Scale out** across the fleet the studio already has: about a dozen 12–16 GB boxes, each its own farm
  serving `gemma4:12b`. This mostly exists. Clients find farms by beacon and sweep and pick the
  least-busy one at connect; coordinator mode puts several boxes behind one endpoint. Its gaps are
  concrete:
  - **A client stays on a full farm.** Farm choice is sticky while healthy, and "load" is presence, not
    seats.
  - **Moving a client to another farm restarts its OWUI (~10 s)**, because env is authoritative.
  - **The coordinator counts only its local slots as seats**, discovers peers once at boot, and skips
    passworded peers.

  - **Coordinator discovery** is the beacon plus a sweep of the coordinator's **own** subnets
    (`farm/src/peerListener.js:90-100`). The PRO 6000 on 10.10.16.x can't find the 10.10.17.x fleet
    without a static peer list.
  - **Coordinator traffic is gated twice.** A peer's gate sees the coordinator as one seat, and a peer's
    429 probably trips LiteLLM's `allowed_fails: 1` / 60 s cooldown (unverified).

  So the scale-out shapes that don't restart OWUI are **one coordinator endpoint over many boxes** (it
  needs its capacity accounting, discovery and cooldown fixed) or **one farm with all boxes in
  `ollama.hosts`**, which `docs/GETTING_STARTED.md:499-502` already recommends for passworded fleets. The
  latter has one gate, but auto context is sized from the local host only (`up.js:585-590`), so a 12 GB
  box behind a 16 GB one is overcommitted.
- **Scale up** on the PRO 6000 and the Sparks with a batching engine. v1 jumps straight to a managed vLLM
  engine (Phase 2), but four things argue for measuring first:
  - It reverses a recorded owner decision (2026-09-07).
  - The PRO 6000 runs **Windows**, where vLLM means WSL2.
  - The `external` engine already routes to an operator-run vLLM.
  - llama-server already batches its slots continuously, with a shared KV pool and per-slot prompt
    caching. v1's "doesn't scale with concurrency" evidence comes from the bandwidth-bound Spark, not a
    1.8 TB/s card.

  **What llama.cpp at `parallel` 8–16 delivers on the PRO 6000 has never been measured.** Today's bench
  *can* measure it: one seat admits unlimited parallel streams (`seats.js:62-70`, `bench.js:106`); only
  gate admission is unmeasurable from one IP. **The model is as big a lever as the engine:** a 3B-active
  MoE batches very differently from a dense 27B at IQ2_S, and the dev box already serves
  `nemotron-3.5-lightning` on Ollama (`docs/DEVLOG.md:3639-3641`).

**What limits the number of people today, cheapest lever first:**

1. **Seats are a config number, but not a free one.** The defaults are Ollama `numParallel` 2 and llama.cpp
   `parallel` 1, and the panel caps at 16. Raising them has three costs:
   - **Auto context stops at the model's native max** (`up.js:525-527`), so more slots shrink everyone's
     floor. 16 slots × 262144 = 16384 per person (`snapshot.js:106`). That is below the client's
     full-document RAG threshold (24576, `configBridge.ts:91`), which flips every client to top-k RAG and
     **restarts every OWUI**. It also stops the coding agent compacting under "Keep going".
   - **Where Ollama runs as a pre-existing service**, as on the dev box, `numParallel` never reaches the
     daemon: measured `n_slots = 1` against an advertised 2 (`docs/DEVLOG.md:3624-3633`,
     `slotsVerified:false`). Changing it means editing the service's environment and restarting the
     shared Ollama.
   - Ollama's slot count applies only after a farm restart.
2. **Two generations per OWUI message, and fat prompts.**
   - Search-query generation runs on every message while web search is on, which it is by default. It is
     short, but it takes a slot and pays a prefill of the conversation.
   - Likely the bigger cost: with `RAG_FULL_CONTEXT=true`, OWUI returns **every item** of the attached
     collections (`open_webui/retrieval/utils.py:1680-1683`), so the fetched web pages are probably
     injected whole into each answer's prompt.
   - Neither has been measured. **Demand-side load (thinking length, injected pages) is a lever as large
     as supply.**
3. **Thinking is never turned off.** The Computer's ceilings were raised to 8–16k tokens because models
   spend 2–4k thinking.
4. **Seat leaks.** A keyless POST claims a seat for 15 min, and one seat can push unlimited parallel
   requests.
5. **Idle seats hold for 15 min.** The owner chose this on 2026-09-04: the trade-off was a 429 rather
   than queueing behind idle people.
6. **The client never fails over** away from a full farm.

Items 2–4 cost days, not weeks. Items 1 and 6 cost about a week each (1: measuring plus the context trade;
6: the fleet path, Phase 3.0). None needs a new engine.

**So the shape of revision 3:**

- **Phase 0:** pin LiteLLM, fix the leaks that need no policy, and run the **engine × model spike**
  (0.6): llama.cpp against vLLM, on the PRO 6000 (WSL2) and on a Spark, with short-listed models, at
  32k/64k/128k per person.
- **Phase 2:** turn the winning vLLM setup into a farm engine, **sized against what else shares the
  GPU** (ComfyUI, Ollama's OCR).
- **Phase 5,** reshaped: a measured capacity table per box, which is the purchase tool.
- **Cut:** identity (owner). **Out of scope:** scale-out on the small GPUs (owner). The queue, search
  cost, OCR reserve and TLS are still open (§13).

## 2. Summary

Revision 2 reorders v1 around measurement and the cheapest levers. Effort figures are rough.

| Phase | Outcome | Effort | Status |
| --- | --- | --- | --- |
| **0. Hardening + measurement** (new) | LiteLLM pinned and cancel proven. The gate checks the password before seating, refuses ungated generation paths, and sends an honest `Retry-After`. Plugin keys are persisted (no more OWUI reboots on farm restart). OCR gets a semaphore. Bench uses distinct source addresses and realistic load. A measured baseline exists: engines, slots, models, prompt cost per OWUI message. | 7–10 days | Ready |
| 1. Seat gate v2 | Client fixes (1.6). Background-task and search cost (1.4) after measurement. The fair queue (1.2) only if adopted. ~~Identity (1.1)~~: **cut** by the owner. | 1 week core; +1 week with 1.2 | 1.2 and 1.4 are **DECISIONs** |
| 2. vLLM engine | **In scope (owner, 2026-10-04).** The spike runs in Phase 0.6. Then a farm engine sized against its GPU co-tenants: on Spark natively, on the Windows PRO 6000 via WSL2. Managed or operator-run is decided from the spike. | 3–4 weeks after the spike | Ready after 0.6 |
| 3. Several big boxes | One endpoint over several Sparks/PRO 6000s as the studio buys them. Scale-out on the small GPUs is **out** (owner). | ~1 week, when a second big box exists | Later |
| 4. Distribution and contract | LAN model copy over plain HTTP; a minimal snapshot schema check. (v1's QVAC plugin swap and on-device fallback: recommended **cut**.) | 1–2 weeks | **DECISION** on cuts |
| 5. Capacity table (the purchase tool) | Measured people-per-box at 32k/64k/128k for each box × engine × model, in `farm/README.md` and the panel. Roofline estimates, clearly marked, for hardware not owned (A5500-class, a second PRO 6000). | 3–5 days after the spike | After 0.6 |
| Security | ~~Revocation~~ (no identity). Optional TLS. | 1 week | TLS is a **DECISION** |
| **Total** | Phase 0 with the spike: **~3 weeks**. The vLLM engine: +3–4 weeks. | | |

---

## 3. Current state and gaps

The farm already has the right choke point: every generation passes through the seat gate on `proxy.port`, with LiteLLM on loopback behind it. Most multi-user work is small gate fixes, measurement and the fleet path, not a re-architecture. A new engine comes only if the measurements call for one.

| Area | What the code does today | Gap for many people at once |
| --- | --- | --- |
| Seat gate | One IP = one seat, freed 900 s after its last generation. A full farm returns 429. A coordinator peer = one seat. The gate already cancels upstream when a client disconnects. | **The seat is claimed before the password is checked.** No cap on in-flight requests per seat. Only 4 paths gated. No request timeout. Several OS users on one lab PC share a seat (the LAN is NAT-free by design, and a person on two devices holds two seats under any keying). Idle seats hold for 15 min, by owner choice. |
| Presence | Install id, hostname etc. every 10 s; beacon carries capacity | Install id not used for seats; ping route unauthenticated; no goodbye on quit |
| llama.cpp | `parallel` 1 default; unified KV pool (a lone user gets the whole window); auto context sized from VRAM, independent of slots; per-box prompt-cache affinity | **Seats are a config number**, panel-capped at 16. Real concurrency throughput on the PRO 6000 is unmeasured. |
| External engine | Routes to an operator-run vLLM/SGLang; never managed (owner, 2026-09-07); capacity declared | No restart/fallback mid-run; no Performance card; `capacity.busy/queued` null |
| Routing | One `model_name`; Ollama hosts or coordinator peers as deployments; LiteLLM least-busy; one engine at a time | No cross-box affinity; no second tier when full; **coordinator seats ignore peer capacity**; **a client never fails over away from a full farm** |
| Plugins | OCR = the served default vision model (no extra tenant on Ollama; a ~7.6 GB tenant beside llama.cpp/external). Classify/STT capped at one job. | **OCR uncapped** and logs filenames; plugins outside the capacity budget (deliberate since 2026-08-26) |
| Ops | One long op at a time; Performance card llama.cpp-only; bench = N identical chats **from one IP = one seat** | No metrics export; **bench cannot measure multi-user at all** |
| Security | One shared password, never checked by the gate; plain HTTP | No per-user revocation; no TLS; no admin rate limit |
| Distribution | ~18 GB first run per box; manual Farm-app updates; OWUI engine updates manual | Each box re-downloads; farm/client/OWUI version drift |
| Client churn | Every farm restart or OCR toggle reboots every client's OWUI (per-start OCR key in the env) | ~10 s outage per client per farm restart; any per-run secret adds another |

Hidden cost, corrected: OWUI's follow-ups, tags, autocomplete and retrieval-query generation are **already off**. What remains on the shared model is one **title** per chat and a **search-query** generation on every message, since web search is on by default.

---

## 4a. Phase 0 — Hardening and measurement (new in revision 2)

Small fixes that need no policy decision, and the measurements every later choice depends on.

> **Status, 2026-10-04: 0.0–0.5 and 0.7 are built** on branch `multiuser-phase0` (DEVLOG 2026-10-04 13:39;
> farm tests 141 → 146). Where the build departs from the text below:
> - LiteLLM is pinned at **1.97.0**, the Farm app's long-running version, not the dev venv's 1.90.0.
> - Non-streaming calls needed LiteLLM's `cancel_on_disconnect` to cancel at all. It is now on in the
>   generated config.
> - `lol bench --people` is **opt-in**, because the seats it takes stay held for `seatIdleSec`.
> - Not yet measured: whether real llama-server and Ollama stop generating on disconnect (no GPU was
>   available).
>
> **0.6 (the spike) is running** (`docs/spike/`).

### 0.0 Pin LiteLLM and prove that a cancel reaches the engine (moved from 1.3)

- **Already done:** the gate destroys the upstream request when a client disconnects (`seats.js:136-142`).
- **Unknown:** whether **LiteLLM** passes the cancel on to llama-server and Ollama.
- LiteLLM is installed **unpinned** (`commands/install.js:166`), so every new box gets a different one.
  Pin it, then prove the cancel on a test farm.

### 0.1 Seat only after the password

In `seats.js`, when `proxy.masterKey` is set, compare the request's bearer **before** `admit()`. A bad or
missing key gets 401, and no seat. Today a keyless POST holds a seat for 15 min on a passworded farm.
This is correctness, not capacity: an open farm has no password to check. The repo's own config has
`masterKey: null`; whether the live farms are passworded is unchecked.

### 0.2 Gate every generation path; honest `Retry-After`

- Refuse LiteLLM's other generation routes (`/v1/responses`, `/v1/messages`, …) at the gate, or gate
  them. Today only 4 paths are gated.
- Align `Retry-After` with the message (today it says 30 s while the message says ~15 min).
- **Not now: a per-seat in-flight cap.** It would throttle coordinator peers (one seat each,
  `seats.js:26-28`) and several people on one IP. Revisit it only with identities (1.1).

### 0.3 Stop rebooting every client's OWUI on farm restarts

**Persist** plugin keys across runs (as `farm/src/identity.js` does for the farm id), or derive them from
a persisted secret. A toggle should rotate a key only when the owner asks for it. Today the per-start OCR
key rides into OWUI's env (`EXTERNAL_DOCUMENT_LOADER_API_KEY`), so every farm restart reboots every
client's OWUI.

### 0.4 Bound OCR's GPU work

- **The problem:** OCR has no concurrency cap. Thirty people dropping PDFs at a workshop is the most
  likely multi-user overload today, and its vision calls to Ollama **bypass the seat gate**.
- **Don't** answer 429 the way Classify and STT do: in OWUI a 429 is a failed upload.
- **Instead:** put a **semaphore with a wait queue** on the vision-model calls only. Pages with a text
  layer stay free.
- Stop logging filenames (`pysvc/server.py:318,334`), as ECOSYSTEM_PLAN §2.3.1 requires.

### 0.5 Bench that simulates people

- **Seats:** today's bench sends every user from one IP, so it holds one seat. It *does* measure engine
  concurrency, because one seat admits unlimited parallel streams. To measure gate admission, give each
  simulated user its own source address (`localAddress` 127.0.0.x; check on Windows). No header and no
  gate hook.
- **Realistic load:** varied prompts, long outputs, thinking on. Model each surface (audit §5): OWUI's
  search query plus answer with injected pages, coding-agent tool steps, one Computer call at a time.
- Add `--cancel <fraction>` and save results to a file.
- Keep the defaults safe for the live dev box: a test farm on its own ports, never the live one.

### 0.6 The engine × model spike (the decisive measurement)

**Question:** for each big box, how many people at good quality and 32k / 64k / 128k context?

- **Boxes:**
  - **PRO 6000** (Windows; vLLM in WSL2).
  - **One Spark** (linux-arm64, vLLM native).
- **Engines:**
  - **llama.cpp** (the farm's b10670 build), `parallel` 4/8/16 with `kvUnified`. Also try a pool larger
    than the native max (min(VRAM budget, native × slots)), so the per-person floor stays above 24576.
  - **vLLM**, current release in its **own venv**, never Rtranslate's `~/r2t2`. Use `--enable-prefix-caching`
    and `--kv-cache-memory-bytes` (never `gpu_memory_utilization` beside ComfyUI or Ollama). Use the
    stdin-EOF self-kill pattern in WSL.
  - Ollama only as the reference, since it doesn't scale with concurrency.
- **Models**, short-listed for reasoning + coding + long context (§9):
  - **Qwen3.6-35B-A3B** (hybrid MoE, vision, 262k).
  - **Nemotron 3.5 Lightning 30B-A3B** (hybrid, 1M, tiny KV, no vision).
  - **Qwen3.8-27B** (the quality reference).
  - On the Spark, optionally gpt-oss-120b.
  - Where a quant is available both ways, compare the GGUF on llama.cpp against NVFP4 (or AWQ) on vLLM.
- **Load:** the bench from 0.5 with distinct source addresses and a realistic mix: OWUI messages with
  injected pages, the coding agent's tool steps with 8–16k outputs, Computer calls with thinking on and
  off.
- **Quality gate:** throughput only counts if quality holds.
  - (a) The coding agent completes a fixed set of ~10 IDE tasks with OpenAI-native `tool_calls` on that
    engine and parser.
  - (b) A ~20-item local reasoning and coding smoke set, scored the same way for every model.
  - Vendor scores (§9) are only a tiebreak.
- **Co-tenants:** ComfyUI keeps ~45 GB resident on the PRO 6000. Either measure within the ~50 GB left,
  which is the realistic case if ComfyUI stays, or in a window with ComfyUI stopped, which is the
  ceiling. Record both. Ollama's OCR model is a second tenant beside vLLM.
- **Per OWUI message:** count the generations and the prompt tokens (search query; injected web pages
  under `RAG_FULL_CONTEXT`).
- **Output:** one row per box × engine × model × context: people at TTFT p95 < 5 s and ≥ 15 tok/s, the
  quality-gate result, and VRAM used. This feeds Phase 2, Phase 5 (the purchase table), 1.4 and §11.

### 0.7 Budget VRAM against what is actually free

llama.cpp's auto context budgets against the card's **total** VRAM (`systemInfo.js:29` → `perf.js:108`).
Beside ComfyUI's resident ~45 GB, it would size a pool that doesn't fit.

- Budget from **free** VRAM at start, or from a configured reserve for co-tenants (`gpuReserveGb`, a new
  key).
- Apply the same rule to vLLM's `--kv-cache-memory-bytes` in Phase 2.

### Tests

Gate unit tests in `farm/test/run.js`:

- 401 before seat.
- Ungated generation paths refused.
- A plugin key that survives a restart.
- The OCR semaphore orders and bounds vision calls (in `check_services.py`).

## 4. Phase 1 — Seat gate v2

Changes who holds a seat, what happens when seats run out, and how fast they come back. All in the gate and the clients, so it benefits every engine.

### 1.1 Per-install identity — CUT (owner, 2026-10-04)

> The owner decided against a hard per-person identity: it adds complexity for users and the gains are
> unclear. Seats stay keyed by IP. Revocation (§10) goes with it. The analysis below is kept only in case
> a shared-IP problem is ever observed.

**What it fixes.** Several OS users on one lab PC currently share one IP seat. It does **not** merge one
person's two devices into one seat (different installs). The office LAN is NAT-free by design. **No
shared-IP case has been observed yet**; the critic recommends deferring 1.1 until one is (§13b).

**Costs either option carries:**

- **Seat exhaustion.** A header turns it into a curl flag unless the number of identities per IP is
  capped.
- **Privacy.** A per-request install id, plus per-install metrics, would turn a farm that "stores
  nothing" into a per-student activity record. That is a data-protection question for a school: keep
  identities in memory only, hashed, and never logged.
- **Unverified.** Whether OWUI's title and search-query calls carry the header, and whether LiteLLM
  forwards it to coordinator peers (by default it doesn't).

**Option A, header identity:**

- **OWUI:** the shell adds `OPENAI_API_CONFIGS={"0":{"headers":{"X-LOL-Client":"<installId>"}}}` to OWUI's
  env. OWUI parses it from env, the same in 0.10.2 and 0.11.4.
- **Everything else:** LOL Vibe and the Computer (`renderer/chat/net/farm.mjs` `headers()`) and the coding
  agent's profile (`studio.ts`) send the same header.
- **The gate** keys the seat on the header when present, else on the IP. The farm password stays
  `OPENAI_API_KEY`, so no `Authorization` rewrite and no OWUI restart.
- **Trade-off:** a header can be spoofed, as an IP can on a trusted LAN. No revocation.
- **Before relying on it,** verify on a rig that OWUI sends the header on chat, title and search-query
  calls.

**Option B, signed tokens (only if revocation, §10, is wanted):**

- `POST /lol/client-token` (password required when set) returns a token signed with a **persisted** farm
  secret. A per-run secret would reboot every client's OWUI on every farm restart.
- The token must reach **every bearer site**:
  - OWUI's `OPENAI_API_KEY` (a change restarts the sidecar).
  - `net/farm.mjs`.
  - The coding agent's `LOL_FARM_KEY` (a change restarts its runtime).
  - The bus `?key=`.
- The gate must translate it on `/v1/models` and `/model_group/info` too, or OWUI's model list goes empty.
- Agent pages stay password-typed: `/lol-farm.json` must never carry a credential.

**Either way:**

- Fix the install id's lifetime: `clientId` is per OS user in userData, and cloned lab images share it.
  Regenerate it when the machine id changes.
- Keep IP keying as the fallback for raw API users.

Touches: gate, snapshot (`capacity.identity`), shell, the panel Clients card (seats by hostname). The
card already lists clients; it has no revoke button.

### 1.2 Fair queue instead of 429 — ANSWERED (owner, 2026-10-04): the engine queues + a workshop setting

> **Decision:**
> - With vLLM, set seats near what the card serves at acceptable speed (the spike's latency-bounded
>   count), and let vLLM's scheduler queue the rest. The 429 becomes a rare safety valve.
> - **Workshop setting:** a panel control for the seat hold (`proxy.seatIdleSec`, config-only today,
>   minimum 60 s), applied live.
> - The farm's fair queue below is built **only if** the 3.3 metrics show frequent refusals.

The owner's 2026-09-04 ask was that **idle people** must not hold seats; the 429 was the mechanism
(`seats.js:1-4`). This queue waits behind **active** people only. The 2026-09-07 decision also says
"refusing people on a pessimistic guess is worse than the queueing it would avoid"
(`docs/DEVLOG.md:3638-3639`), which argues for the **engine's own FIFO** over a new gate queue. The engine
already queues every admitted request.

Options:

- Adopt the gate queue.
- **Keep 429**, with a **workshop preset** (a short `seatIdleSec`) and an honest wait message on every
  surface. `seatIdleSec` (minimum 60 s) is config-file only today (`config.js:79`). This is the critic's
  recommendation.
- Make it per-farm.

**Before deciding,** count real 429s: the snapshot and panel have no counter today. If adopted:

- **Queueing:**
  - One FIFO per identity, served round-robin.
  - At most `proxy.perClientConcurrency` (default 1) in flight per identity. The clients already
    self-limit to about one: one governor for Vibe and the Computer.
  - Limits `proxy.queueMax` (default 2 × slots) and `proxy.queueTimeoutSec` (default 120). Past either,
    a 429 with an honest `Retry-After`.
- **Seat lifetime:** a seat is reserved while running or queued, plus `proxy.seatGraceSec` (default 20 s).
- **What OWUI users see:** **the shell cannot see OWUI's requests.** OWUI shows a slow first token; it has
  no total timeout, so a long wait is safe.
  - Show the farm's queue depth from the snapshot in the topbar pill (`capacity.queued` exists).
  - Or add a main-process observer on the `persist:owui` session. That is new code: no `webRequest` hook
    exists.
- **LiteLLM restarts:** queued requests must **survive** them. Panel actions restart LiteLLM, and today
  in-flight chats get 502.
- **Never queue `/v1/models`:** OWUI's model-list fetch times out at 10 s.
- **LOL Vibe:** its seat-wait (`app/seat-wait.mjs`) becomes the over-queue fallback.
- `GET /lol/queue?client=<id>` → `{position, etaSec}` for LOL Vibe and the Computer. ETA = moving
  average of generation time per slot.
- **Simpler variant to weigh first:** the per-identity in-flight cap (0.2), plus letting the engine's own
  queue order requests, plus 429 only past a depth limit. With clients already self-limiting, engine FIFO
  is close to fair.

### 1.3 Cancel frees the slot — moved to Phase 0.0

The gate already cancels upstream on disconnect. Verifying the LiteLLM hop and pinning LiteLLM are now
Phase 0.0. What stays here: optionally link presence to seats (free a seat when its identity stops
pinging for 30 s), once 1.1 exists.

### 1.4 Background tasks off the main lane (half ALREADY IMPLEMENTED) — ANSWERED: measure first

> **Decision (owner, 2026-10-04):** measure the per-message cost first (the search-query generation and
> the injected pages' prompt tokens). Then (c) turn query generation off with one env line if it's
> significant, or make web search off by default if the pages dominate.

- **Already done:** follow-ups, tags, autocomplete and retrieval-query generation are off.
- **Remaining:** one **title** per chat, and **search-query generation on every message**, since web
  search is seeded `always`.
- **Measure first (Phase 0.6):** the slot time the search query takes, and the prompt tokens the
  injected web pages add. The pages may cost more than the query.
- **Options — DECISION:**
  - (a) Header lane: `OPENAI_API_CONFIGS` headers with `{{TASK}}` mark OWUI's task calls. A
    "low-priority lane" **needs a queue (1.2)**. Without one, the gate can only rewrite the call's model
    to a small one (same routing problem as (b)) or refuse it. Nothing appears in the picker.
  - (b) `TASK_MODEL_EXTERNAL=assistant-tasks`. But it then shows in every person's picker, and it is **not
    served at all while a non-Ollama engine serves**: no Ollama model is routed then, so OWUI silently
    falls back to the chat model. Making that work means routing one Ollama alias beside llama.cpp,
    external or vLLM.
  - (c) Turn search-query generation off with one env line, and accept raw-message search queries.
    The critic recommends this if the query costs more than ~15 % of slot time. Also revisit whether web
    search should stay `always` by default, given the injected pages.
- **Coding agent:** its title call (≤ 64 tokens) belongs to the same lane. Disable it in the profile
  patch, or send it with the task header.
- **Not via an on-device model** (v1's 4.3 is recommended cut).

### 1.5 Plugins in the capacity budget — ANSWERED (owner, 2026-10-04): reserve ~9 GB for OCR on vLLM boxes

> **Decision:**
> - vLLM's KV budget leaves room for the OCR model, costing ~14 % of the pool and nothing in practice.
> - The 2026-08-26 no-reserve rule stays for llama.cpp on 12–16 GB cards.
> - Built with Phase 2's sizing. The spike's 62 GB KV budget already leaves ~15 GiB free on the 96 GB
>   card.

The owner decided not to reserve OCR room in auto context: it "would collapse chat context to nothing" on
12–16 GB cards. ECOSYSTEM_PLAN (2026-09-27) asks for plugins in the capacity maths.

- On the **default Ollama engine** the OCR model *is* the chat model, so there is nothing to reserve.
- The question only arises beside llama.cpp, external or vLLM.
- **On cards ≥ 48 GB it is moot:** auto context stops at the model's native max (`up.js:525-527`),
  leaving tens of GB free. On 12–16 GB cards the owner already decided against it, so the critic
  recommends **cutting** 1.5.
- Proposal: reserve only on cards ≥ 48 GB, plus `ocr.placement: "local" | "peer"`. `peer` = OCR
  advertised by another farm.
- The CPU option is dropped: it is a vision model.

### 1.6 Client fixes the gate work depends on

> **Status, 2026-10-04: all five are built** (DEVLOG 2026-10-04 14:08; `chat-unit` 1794/0).
> - The own-seat fix uses `capacity.mine` (no identity).
> - A 429 is `busy` at the ask layer.
> - dsh doesn't retry 429s; a refused turn goes to seat-wait. Its title call was already off in the sdk
>   bundle.
> - The agent's window is clamped, and "Keep going" shrinks its reply room on small windows.
> - Agent pages use `defaultModel`.
> - Not yet run: the chat harness, after the spike frees the GPU.

From code reading; rig-check each.

- **The Computer's own seat.** Its background lane treats the client's **own** seat as taken: `freeSeat()`
  is `used < slots` (`net/governor.mjs:50-62`). On a full farm, a person who chatted recently can't run
  model boxes. Fix without identity: the active farm is re-polled by unicast `GET /lol/self` every 2 s,
  so that response can carry `capacity.mine: true` when the caller's IP holds a seat. The governor then
  treats its own seat as free to it.
- **The Cap.** A gate 429 costs a Computer Cap generation: `graph/runner.mjs:570-576` frees only
  `busy`/`aborted`/`no_farm`.
- **The coding agent:**
  - It retries 429 by itself (dsh `llm-retry`, 5 tries) and never reaches seat-wait. Disable `llm-retry`
    for rate limits in the profile patch.
  - "Keep going" (output ≥ 16384) on a ≤ 16k slot disables proactive compaction. Clamp its window as
    LOL Vibe does.
- **Agent pages** default to the first listed model. Use the farm default.

### Tests

Gate unit tests:

- Identity keying, and IP fallback.
- Round-robin order and per-client caps, if 1.2 is adopted.
- Timeout → 429 with an honest Retry-After.
- Queue survives a LiteLLM restart.

`lol bench --users N --cancel 0.2` with distinct identities checks slot recovery and that LiteLLM forwards
the cancel.

---

## 5. Phase 2 — vLLM engine (in scope: owner, 2026-10-04)

> **Status, 2026-10-04:** step (a) is built (DEVLOG 2026-10-04 14:01).
> - An external vLLM is detected by its `/metrics`. Its running and waiting counts feed
>   `capacity.busy/queued`, and the Performance card shows vLLM's figures.
> - The KV pool is checked against `parallel × contextLength`, with a warning when the declared seats
>   don't fit.
> - Seats and `slotsVerified` are unchanged (2026-09-07a).
> - Not yet run against a live vLLM: the spike will be the first.

**Step 1, the spike (Phase 0.6).** It picks the model and flags per box, and shows how far llama.cpp
gets.

**Step 2, managed or operator-run: DECISION from the spike.** On 2026-09-07 the owner decided the farm
never installs, starts or restarts an external server, because "half-managing one is worse than not
managing it". The owner's renewed interest in vLLM (2026-10-04) puts a managed engine back on the table,
since the Farm app's operators are not technical. Two shapes:

- **(a) Integrated `external`:** the operator runs vLLM, and the farm reads its `/metrics` for seats, the
  Performance card and `capacity.busy/queued`.
- **(b) Fully managed:** install, start and supervise, below.

(a) is a subset of (b), so build (a) first either way.

If managed vLLM is approved:

- **Windows.** Add `vllm` as a fourth engine the farm installs, launches, sizes and supervises, reusing
  the `external` routing path (`litellm.js:195-212`). **The studio's PRO 6000 runs Windows**, so either
  the farm supports vLLM **in WSL2**, or that box stays on llama.cpp/external.
  - WSL2 has two measured hazards (2026-09-24): killing `wsl.exe` leaves the Linux processes alive (use
    the stdin-EOF self-kill), and a backgrounded `&` dies with its `wsl.exe`.
- **Sizing.** Use **`kv_cache_memory_bytes`, not `gpuMemoryUtilization`**, whenever Ollama shares the GPU,
  which here is always (OCR). vLLM's startup profiler aborts if another process changes its VRAM use
  mid-start, and the farm itself churns Ollama beside another engine (`keep_alive` 5m, pressure eviction).
  `gpu_memory_utilization` is also a fraction of **total** VRAM.
- **Slots.** Raise the panel's slot cap of 16 (`up.js:2416`) per engine.
- **Metrics.** Generalize the Performance card and `capacity.busy/queued`, which today are llama.cpp-only.
- **Engine start** is `lol up` step **2b** (`up.js:838`), not step 5.
- **Config.** The schema needs a `vllm` block and a new engine value; it is strict.

### 2.1 Config

```jsonc
"vllm": {
  "enabled": false,
  "alias": "assistant",
  "model": "nvidia/Qwen3.6-35B-A3B-NVFP4",
  "maxModelLen": "auto",
  "maxNumSeqs": "auto",
  "kvCacheDtype": "fp8",
  "kvCacheMemoryGb": "auto",    // → --kv-cache-memory-bytes; skips the startup profiler that aborts on a shared GPU
  "gpuMemoryUtilization": null, // only when vLLM owns the GPU alone; a fraction of TOTAL VRAM
  "prefixCaching": true,
  "speculative": null,
  "extraArgs": [],
  "install": "venv",            // or "docker"
  "host": "127.0.0.1", "port": 8082
}
```

- Engine selection becomes `ollama | llamacpp | vllm | external`; keep one-engine-at-a-time and `carryNameAcross` (which today carries names Ollama ↔ llama.cpp only — extend it).
- `speculative` = speculator repo + method (Qwen3.6 MTP, Qwen3.8 DSpark, Nemotron DSpark/MTP).
- Model-specific flags (Nemotron `--mamba-cache-mode align`, reasoning/tool parsers) come from the model catalog (Phase 5), not user config.
- A `library` list mirrors `llamacpp.library` so the panel's *Use this* works for vLLM checkpoints.

### 2.2 Install

- Targets: linux-x86_64 + NVIDIA, linux-arm64 (DGX Spark), and **Windows via WSL2** if the owner wants it on the PRO 6000. Otherwise the panel shows vLLM unavailable on Windows and keeps llama.cpp.
- `lol install` builds `farm/.vllm/` with `uv` and a pinned vLLM (`LOL_PYTHON` exists, `farm/src/python.js:29`). `install: "docker"` opt-in (official `vllm/vllm-openai` aarch64/cu130 images exist).
- Weights via the Hugging Face cache. `farm/.models/` is flat today; add an `hf/` subfolder. Progress reporting exists in the job model: bytes/total/rate/ETA, `up.js:1883-1891`.

### 2.3 Spawn and supervise

- `lol up` step 2b (engine start, `up.js:838`) gains a vLLM branch: spawn `vllm serve`, wait `GET /health`, confirm `/v1/models`.
- Same crash policy as llama.cpp (one restart; second crash in 5 min → Ollama fallback, reason on Backend card).
- Longer health timeout: vLLM load (compile + CUDA graphs) often takes 1–3 min.

### 2.4 Sizing and seats

1. Read the model's `config.json`: count attention layers, KV heads, head size; detect hybrid layers (Mamba, linear attention) holding no KV. HF-format twin of `gguf.js`. Fix `gguf.js` the same way, since it prices every layer as attention today.
2. After launch, read the real pool from vLLM's startup log ("GPU KV cache size", "maximum concurrency") or `/metrics` — ground truth.
3. `maxNumSeqs: "auto"` = pool ÷ per-user window chosen in the panel, capped by a throughput ceiling from the last `lol bench`.
4. Publish `slots` and `contextPerSlot` in the beacon from these numbers.

Panel's *People served at once* / *Context window* map to `maxNumSeqs` / `maxModelLen`, applied by the single **Apply changes** restart. The panel's 1–16 slot range must widen for this engine.

### 2.5 Performance card

Scrape vLLM Prometheus `/metrics` on the farm's existing 10 s health tick: running/waiting requests, KV usage, prefix-cache hit rate, generation tok/s, speculative acceptance. The card and its **four** warnings are llama.cpp-only today (`admin/index.html:343-354`, `up.js:1186`); generalize them per engine. Do the same for the `external` engine when it is a vLLM.

### Tests

- Unit: config validation, LiteLLM generation for the vLLM deployment, sizing math on two fixture `config.json` files (dense + hybrid).
- Integration (nightly, GPU runner if available): small model under vLLM, `lol bench --users 16`, slots match `max_num_seqs`, fallback to Ollama when vLLM is killed twice.

---

## 6. Phase 3 — Several big boxes behind one endpoint

> **Scope, owner 2026-10-04:** the small GPUs are booked for 3D, VR and workshops, so scale-out across
> them is **out**. What remains is putting **several big boxes** (Sparks, PRO 6000s) behind one endpoint
> as the studio buys them. With vLLM that is several OpenAI deployments of one model name in LiteLLM.
> Today `external` takes a single `baseUrl`, so it would need a list, or a coordinator over big-box farms.
> The items below apply to that case.

### 3.0 Make the existing multi-box path work first

- **The coordinator's seat capacity** = its local slots only (`up.js:1001`). It must add its peers'
  advertised slots. Today a coordinator over five 4080s still says "2 seats".
- **Peers:**
  - The coordinator discovers them **once at boot**. Re-discover on the beacon, so a peer that boots later
    joins.
  - Discovery covers only the coordinator's own subnets (`farm/src/peerListener.js:90-100`). Add a
    **static peer list**, so the PRO 6000 on 10.10.16.x can front the 10.10.17.x boxes.
  - It **skips passworded peers**, which is the v1 fleet-password constraint. Settle a fleet-shared
    password, or a coordinator credential.
  - A peer's 429 probably trips LiteLLM's `allowed_fails: 1` / 60 s cooldown for the whole peer. Check
    this, and map a peer's `lol_seats_full` to "try another deployment" rather than a failure.
- **The alternative to weigh:** one farm with every box in `ollama.hosts`, as GETTING_STARTED already
  recommends. It has one gate and no double gating, but auto context is sized from the local host only
  (`up.js:585-590`), so mixed 12/16 GB hosts need a pinned context or a per-host minimum.
- **Failover off a full farm.** Today a client stays on a full farm: farm choice is sticky while healthy
  (`farmSelect.ts:63-66`), and "load" is presence (`clients/slots`), not `seatsUsed`. Moving a client
  between farms restarts its OWUI (~10 s), so:
  - Prefer the coordinator shape (one endpoint, many boxes).
  - Let the client move only when its farm has been full for a while and it is idle.
  - In the least-busy pick, use max(clients, seatsUsed) / slots. At a workshop's start everyone's
    `seatsUsed` is 0, and presence predicts demand better.

### 3.1 Cache-affinity routing

- **Within one box,** llama-server **already** keeps per-slot prompt affinity (`--slot-prompt-similarity`,
  `--cache-reuse`, `--cache-ram`).
- **Across boxes** (coordinator, multi-host): route by **conversation** first, using OWUI's `{{CHAT_ID}}`
  header (1.1, Option A) and the same header from LOL Vibe. A per-install key would pin all of a person's
  chats to one box. Use rendezvous hashing, and move a conversation only when its box is full or
  unhealthy.
- **Where:** in the gate, before LiteLLM. Pick the deployment and forward under its name, keeping
  LiteLLM's least-busy routing as the fallback (owner, 2026-09-04: LiteLLM is kept for `num_ctx`,
  `keep_alive` and aliasing).
- **Payoff:** `cacheRam` and the prefix cache hit on returning turns.

### 3.2 Overflow tier — CUT (owner, 2026-10-04)

> Cut: a weaker model when busy works against the "good quality" goal. Kept for the record only.

- Config `overflow: {alias, engine, model, triggerWaitSec}`; overflow model on Ollama or a peer farm (e.g. Nemotron 3.5 Lightning beside a Qwen main model). On one box, an Ollama overflow beside llama.cpp/vLLM breaks today's "no Ollama model routed while another engine serves" rule (2026-08-26, one engine at a time). A **peer farm** as overflow doesn't.
- If estimated queue wait > `triggerWaitSec`, the gate rewrites the request's model to the overflow alias; the client's bound alias stays, so OWUI chats never break.
- Gate adds `x-lol-served-by`; shell shows a "fast mode" badge via `/lol/queue`. Opt-in per farm.

### 3.3 Observability

- **Minimal version first** (critic): a 429 count, peak seats and TTFT p95 in the existing snapshot and panel. No Prometheus, no per-install labels. What follows is the full version, only if that proves too little.
  - **Status, 2026-10-04: the minimal version is built** (DEVLOG 2026-10-04 14:19). It counts generations let in, turned away, refused for the password and stopped, plus the fullest moment and the first-word wait p50/p95, over the last hour and since start. Counts only, in memory, in the panel and the admin state (not in the beacon). A week of normal use, or one workshop, answers decision 2.
- `GET /metrics` (Prometheus) on the beacon port: seats used, queue depth, queue wait p50/p95, TTFT p50/p95, tok/s per active user, cancels, overflow count, engine KV usage.
- Labels use install-id hashes, never hostnames or content. The "counts and refusals only" rule exists for the bus and the Python services, but **not farm-wide**: OCR logs filenames (Phase 0.4). Make it farm-wide first.
- Panel: 15-minute sparklines for queue depth and TTFT.

### 3.4 Realistic bench

- Builds on Phase 0.5 (distinct identities). `lol bench --profile workshop`: Poisson arrivals with bursts, mixed prompt lengths, thinking on, 20 % cancels. Model each surface's real pattern (audit §5): OWUI = search query + answer per message, Vibe = one stream, coding agent = back-to-back tool steps with 8–16k outputs, Computer = one long background call at a time.
- ~~`lol bench --replay <file>`: replays a gate-recorded timing profile.~~ **Cut (critic):** recording arrival times per client means the farm keeps an activity record, which a stateless farm should not, especially at a school. Use synthetic workshop profiles. The workshop profile itself folds into Phase 0.5.
- Output adds queue wait and "share of users above 15 tok/s".

### Tests

Rendezvous stability (adding a box moves ~1/N users), overflow trigger from a fake ETA, metric formatting; two-farm loopback test with stub engines for stickiness and failover.

---

## 7. Phase 4 — Distribution and contract (v1: "QVAC borrowings", narrowed in revision 2)

v1 proposed borrowing QVAC's (`tetherto/qvac`) distribution, plugin and client-side ideas. Measured on
2026-09-10 for the Rtranslate comparison:

- QVAC is **not a Node library**. Inference runs in a **Bare** worker over `bare-rpc`, so in Electron it
  is still a sidecar.
- `npm install @qvac/sdk` is **4.8 GB** (the win32-x64 slice is ~805 MB).
- On Windows its only GPU backend is **Vulkan, never CUDA**.

Its P2P registry relies on blind relays through NAT, which is internet infrastructure. What survives is
the idea of LAN model sharing, done with plain HTTP.

### 4.1 LAN model sharing

1. Each farm advertises a content-addressed index at `GET /lol/models/index`, with a hash summary in the
   beacon. It covers the `farm/.models/` files (`.gguf`, draft modules) and Ollama models (manifest +
   blobs, SHA-256). The farm never reads `OLLAMA_MODELS` today, so locating Ollama's store is new work.
2. `GET /lol/models/blob/<sha256>` with HTTP range support, behind the farm password when set.
3. `lol install` and *Use this* try peers first (parallel ranges across peers), verify the hash, and fall
   back to Hugging Face or the Ollama registry.
4. ~~Later, for multi-site, swap the transport for Hyperswarm/Hypercore with relays.~~ **Cut:** relays
   through NAT conflict with the owner's "local only, never cloud" rule (2026-09-16). Beacons don't cross
   subnets, but unicast does, so peers on other subnets come from the search range or manual add, as
   clients do.

Target: a new box on gigabit LAN goes from ~18 GB of internet downloads to minutes of local copy.

### 4.2 Lighter plugin backends — CUT (owner, 2026-10-04)

> Cut. What follows is kept for the record only.

v1's spike question ("do QVAC addons run under Node ≥ 20?") is **already answered: no**. A Bare sidecar
of ~805 MB+ per platform is not lighter than the ~1 GB of Python venvs it would replace.

- **If lighter plugins are still wanted:** evaluate whisper.cpp for STT, behind the same
  `POST /v1/audio/transcriptions` contract, key and one-job rules.
- **ONNX OCR for clean scans:** only worth it on boxes where the vision model is a second GPU tenant,
  i.e. non-Ollama engines.
- **New TTS or translation plugins** are out of scope for multi-user.

### 4.3 On-device model in the client — OPEN: a use-case study first (owner, 2026-10-04)

v1 proposed running a small model on the laptop, for offline use or when all farms are full. The owner
keeps it open: "it should be able to run on any laptop … I think it's a good idea but I am afraid most
laptops won't be able to have decent speed and quality. Depends on the use case, the space etc. We need
to think further about use cases and if it is really pertinent." No code before the study.

**Three questions the study must answer:**

1. **Which uses could a laptop model serve acceptably?** Candidates, from least to most demanding:
   - OWUI's background tasks: titles, the search query. Short and tolerant, and they free the farm.
   - The Computer's small structured calls: Condition/Filter verdicts, short Instructions. With thinking
     off, they are short.
   - Offline single-person chat (no farm reachable: travel, home, a broken network).
   - "The farm is full" overflow.
   - The coding agent: almost certainly not, because it needs long context, tool calls and quality.
2. **On which laptops?** The studio's real spread: RAM (8 / 16 / 32 GB), Apple Silicon vs Intel/AMD with
   an integrated GPU vs a discrete NVIDIA, and free disk. A 3–4B model at Q4 is ~2–3 GB on disk and needs
   ~4–6 GB of RAM while running. It also has to coexist with the person's other work (3D, VR, Adobe…).
3. **At what speed and quality?** Measured, not guessed. The spike harness already provides both:
   - `docs/spike/spike_bench.py --quality` at concurrency 1 for quality.
   - A `chat` profile at c = 1 for tok/s and the first-word wait.
   - Run it with llama.cpp on 3–4 representative laptops, with 2–3 small models.

**The rule to revisit if it goes ahead:** CLAUDE.md says "Do NOT enable OWUI's built-in local inference
engine (inference must go to the farm, not the laptop)". A client-side model would need an owner
amendment to that rule (CLAUDE.md is the owner's), and the data-flow section would gain a line. It would
also be **opt-in per laptop**, downloaded only on a person's click, and never the default.

**Effort:** ~½ day to run the harness on a few laptops, once the owner names them, then a short
write-up: which uses pass, on which machines.

### 4.4 Shared contract and drift check (minimum version)

- `contract/` (or `farm/contract/`) holds JSON Schemas for the beacon snapshot / `/lol/self`, and later
  `/lol/queue` and the Phase 5 catalog.
- **One farm unit test** validates a real `buildSnapshot()` against the schema. The shell tests validate
  `farmSelect.ts`'s parsing against the same file.
- No TypeScript codegen: the farm is plain CommonJS, and the renderer is no-build ES modules with JSDoc.
  Generated types would be a new build step for two consumers (ponytail ladder).
- The farm already advertises `version`. Add `contractVersion` only once a breaking change exists. The
  shell warns on older farms, which targets the manual Farm-app update gap.

---

## 8. Phase 5 — Capacity planner

**Revision 3: Phase 5 is the purchase tool, built as a measured table first.**

- **The table:** box × engine × model × context per person → people at TTFT p95 < 5 s and ≥ 15 tok/s,
  plus the quality-gate result. It comes from the Phase 0.6 spike, ships in `farm/README.md` and is shown
  in the panel.
- **Hardware the studio is considering but doesn't own** (more Sparks, a second PRO 6000, an A5500-class
  card) gets a roofline estimate scaled from the measured box of the same family, always labelled
  *estimated*. **DECISION:** which "A5500" is meant: the RTX A5500 (Ampere, 24 GB, ~768 GB/s) or a
  Blackwell RTX PRO 5000-class card (48 GB)? The answer changes the estimate a lot.
- The interactive planner below (v1's design) is built only if the table proves too coarse. It generalizes a capacity calculator (an earlier prototype: platform × model × KV precision × users slider → memory split bar, guaranteed context per user, per-user speed at peak, verdict, and a chart of context-per-user vs users across platforms) into a planner built into the farm. It runs offline from a shipped catalog and improves as `lol bench` adds local measurements.

### 5.1 Where it appears

- **Farm app first-run wizard:** a step *before* the ~18 GB download — "What will this farm serve?" — so the operator downloads the right weights.
- **Admin panel *Plan* card:** pre-filled with detected GPU and current config, with *Apply*.
- **CLI:** `lol plan --hw auto --use chat --users 10 [--write]`.

All three share one estimator module.

### 5.2 Inputs

| Input | Source | Default |
| --- | --- | --- |
| Hardware | Detected (`nvidia-smi` name + memory; unified-memory boxes flagged) or picked from catalog — the catalog must include the fleet's **12 GB and 16 GB** cards, not only Spark/PRO 6000/A6000 | Detected |
| Use case | OWUI chat, LOL Vibe chat, coding agent, Computer, or a mix with percentages | OWUI chat |
| Users | Slider 5–50 (more for fleets) | 10 |
| Context target | Per profile, editable | Chat 32k, coding agent ≥ 32k (see below), Vibe chat 32k, Computer 32k |
| Engine | vLLM, llama.cpp, Ollama — filtered by platform (vLLM on Windows only via WSL2) | Measured best (Phase 0.6) |
| Plugins | OCR, web search, Classify, STT, TTS, bus (memory subtracted only beside a non-Ollama engine, see 1.5) | Current config |
| Constraints | Vision, **OpenAI-native tool calling** (coding agent), JSON-schema output (Computer), languages, license | From use case |

**Profiles, from the code (audit §5), not v1's guesses.** The shares of users generating at once
(v1: 40/70/80 %) are still assumptions, to be replaced by the Phase 0.6 measurements and the minimal 429/peak-seat counts (3.3). Replay recording is cut.

- **OWUI chat:** two generations per message while web search is on (a short search query, then the
  answer), plus one title per chat.
- **Coding agent:**
  - Each request needs `max_completion_tokens` (4–8k, ≥ 16k with "Keep going") + 4096 headroom +
    the prompt, inside `contextPerSlot`.
  - With "Keep going" (O = 16384), the compaction trigger min(0.8W, W − O − 4096) is 12k at a 32k slot
    and 4k at a 24k slot. At or below ~20k it is zero: no proactive compaction at all.
  - It generates almost continuously during a turn.
- **Computer:**
  - One long background call at a time per client: ceilings 8k text / 16k code, because thinking is on.
    No TTFT target; it yields to a person's chat.
  - Turning thinking off for its calls is the biggest lever. Nothing does that today.
- **Vibe chat:** one stream per window, history trimmed by the client.

### 5.3 Estimator

For each catalog model passing the constraints:
1. **Memory:** weights for the chosen quant + plugin memory + OS headroom on unified-memory boxes → remaining = KV pool.
2. **KV per token:** from catalog when known; else from `config.json` / GGUF header (extend `gguf.js`), counting only attention layers (hybrids like Nemotron and Qwen3.6 come out right).
3. **Context per user:** pool ÷ users, capped at native window; plus expected context with a shared pool (pool ÷ active users).
4. **Speed:** if measured points exist for this hardware + engine, interpolate per-user tok/s between concurrency points. Else bandwidth roofline: ~85 % of memory bandwidth ÷ bytes read per token (active weights + KV), with concurrency scaling borrowed from a measured model of the same class (dense / MoE / hybrid). Tag every number *measured*, *interpolated* or *estimated*.
5. **Verdict:** good / tight / not viable vs profile thresholds; rank by use-case quality among passing models.

Reference formula used by the chat prototype (planning only):

```
usable      = hardware.usableGB                    // PRO 6000 86, RTX 5090 28, Spark 105
pool_GB     = usable - weights_GB - users * state_GB_per_user
pool_tokens = pool_GB * 1e6 / kv_KB_per_token
ctx_user    = min(native_ctx, pool_tokens / users)
active      = ceil(users * active_fraction)        // 0.4 chat
tok_s_user  = min(single_stream_tok_s, aggregate_tok_s / active)
verdict     = ctx_user < 8k or tok_s_user < 8   -> "not viable"
              ctx_user < 32k or tok_s_user < 15 -> "tight"
              else                              -> "good"
```

### 5.4 Outputs

- Ranked list with badges (fits / tight / doesn't fit, vision, tools, license) and the measured/estimated tag on each number.
- For the selected model: memory split bar, context per user, per-user speed at peak, chart of context-per-user vs head count across catalog hardware — **inline SVG, no CDN** (farms often run offline).
- Generated config: `vllm` or `llamacpp` block, plugins, seat/queue settings, and for today's `external` route the exact `vllm serve` command. *Apply* writes through `POST /lol/admin/apply` and adds weights to the model library (keeps one-job-at-a-time and rollback rules).

### 5.5 Learning from the farm

- After *Apply*, offer a 2-minute `lol bench --profile` at the planned head count; store in `farm/.bench/` as measured points for this box.
- Prefer local points over catalog points; show both when they disagree by > 25 %.
- Optional, off by default: export anonymized bench results (hardware, model, engine, flags, concurrency, tok/s; never prompts) as JSON for a catalog PR.

### 5.6 Code and data layout

- `farm/catalog/models.json`, `farm/catalog/hardware.json`, `farm/catalog/profiles.json`, each with a JSON Schema under `contract/`, validated by a farm unit test.
- `farm/src/planner.js`: pure estimator functions shared by CLI, panel (static script) and Farm app. Reuse what the farm already measures: `perf.js` (`KV_GB_PER_16K`, the VRAM fit), `gguf.js`, and the Ollama context probe cache `farm/.models/ollama-ctx.json` (keyed `model|vramGb|numParallel|kvCacheType`).
- Catalog ships with farm releases. `lol catalog update` pulls only the catalog from the latest release, from GitHub, like the Farm app's update check; it carries no user data. It is optional, because farms often run offline.

### Tests

- Schema validation of all catalog files.
- Estimator accuracy: leave-one-out over measured points, estimate within ±25 %; CI fails on regression.
- Golden tests: Spark + chat + 10 users → Qwen3.6-35B-A3B first; Spark + Computer → Nemotron 3.5 Lightning first; dense models never first on Spark above 5 users.
- Panel planner renders with no network.

---

## 9. Model and hardware catalog (seed data for Phase 5)

From October 2026 research on one DGX Spark serving 10 concurrent users. Spark speeds are community/vendor measurements unless marked; other hardware starts from the roofline estimate. **Not verified by the repo audit.** Most rows are single-author posts with different builds and flags, and none was measured on the studio's own boxes. Treat this table as seed data that local `lol bench` points override (§5.5), never as acceptance numbers.

### 9.1 Models

| Model | Total / active | Weights (Spark format) | Context | Vision | Spark speed, measured | Fit | License |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Qwen3.6-35B-A3B | 35B / 3B, hybrid Gated DeltaNet MoE (256 experts, 8+1 active), MTP heads | NVFP4 (`nvidia/Qwen3.6-35B-A3B-NVFP4`) ~19 GB | 262k (1M YaRN) | Yes (image, video) | 97.4 tok/s single (MTP-3); 322 agg at 8 (~42/stream, ~290 distinct prompts); 325 agg at 16 (MTP-1, ~22.5/user, TTFT mean 889 ms); 6,265 prefill tok/s at 8k | Chat, Vibe — **default pick** | Apache 2.0 |
| Nemotron 3.5 Lightning 30B-A3B | 30B / 3B; Mamba-2 + MoE + 6 attention layers of 52 | NVFP4 21.58 GB + DSpark draft 1.35 GB (W4A16 via Marlin on GB10) | 1M | No | 79.6 single plain, 115.75 DSpark; 332 agg at 8 plain, 422 with DSpark; at 16: 420 agg decode-heavy, 236 balanced, 193 prompt-heavy (draft acceptance falls to 21–29 %); TTFT 71 ms at c=1; KV pool 18.4M tokens at util 0.85 | Computer — **default**; chat runner-up | OpenMDW-1.1 |
| Gemma 4 26B-A4B | 25.2B / ~3.8B MoE | NVFP4 ~16.5 GB | 256k | Yes (image) | 52 plain; 108.8 FP8 + MTP; 674 agg at 8; community recipe 1,081 agg at 32 | Chat with images (weak agentic coding: SWE-V 17.4) | Apache 2.0 |
| Laguna XS 2.1 (Poolside) | 33B / 3B MoE | FP8 / NVFP4 / INT4 official | 262k | No | Not measured (estimate ≈ other 3B-active MoEs) | Vibe alternative (SWE-V 70.9) | Poolside — check card |
| Qwen3-Coder-Next | 80B / 3B hybrid MoE | NVFP4 42.7 GiB | 262k | No | 60.8 single, 72.0 with EAGLE3 | Vibe alternative (SWE-V 70.6); verify prefix caching support | Apache 2.0 |
| gpt-oss-120b | ~117B / ~5B MoE | MXFP4 ~65 GB | 128k | No | 60.4 single; 141.9 at 8; 160.5 agg at 10; 181.2 at 16 | Structured-output fallback | Apache 2.0 |
| Qwen3.8-27B | 27B dense, hybrid attention, vision | NVFP4 23.4 GB / FP8 30.9 GB | 262k | Yes | 7.9–12.3 single plain; 57.9 agg at 10 (7.2/user); 208.7 agg at 8 with DSpark k=7 | Quality model; ≤ 5 users on Spark | Apache 2.0 |
| Qwen3.8-Flash-Next | 125B MoE / 6B active (+ n-gram table, MTP) | NVFP4 ~125 GiB (n-gram table on NVMe, patched vLLM) | 262k (1M) | Yes | 41.7 median single; 47–100 agg at 4; 32k prefill TTFT 17.3 s | Two Sparks only | Qwen Community licence |
| Nemotron 3 Super 120B-A12B | 120B / 12B | NVFP4 | 1M | No | 14.8–23.45 single; recipe caps `max-num-seqs` 4 | **Avoid** on Spark | NVIDIA Open |
| Gemma 4 31B | 31B dense | NVFP4 | 256k | Yes | 6.15 single; 92 agg at 16 (5.8/user) | **Avoid** on Spark | Apache 2.0 |

Quality (vendor-reported, harnesses differ): Qwen3.6-35B-A3B SWE-bench Verified 73.4, SWE-bench Pro 49.5, Terminal-Bench 2.0 51.5; Nemotron 3.5 Lightning MMLU-Pro 81.6, GPQA-D 75.6, SWE-V 52.8, Terminal-Bench 2.1 23.5, IFBench 72.9 (languages: EN, ES, FR, DE, IT, JA); Qwen3.8-27B SWE-Pro 61.7, Terminal-Bench 2.1 73.0.

Planner rule: flag dense and ≥ 12B-active models as "bandwidth-bound" whenever memory bandwidth < 500 GB/s.

### 9.2 Hardware

| Hardware | Memory | Bandwidth | FP4 tensor cores | Planner notes |
| --- | --- | --- | --- | --- |
| DGX Spark (GB10) | 128 GB unified | 273 GB/s | Yes (some NVFP4 models run W4A16 via Marlin) | Reserve 10–15 GB for OS + services; vLLM utilization is a fraction of the shared pool |
| RTX PRO 6000 Blackwell | 96 GB | ~1.8 TB/s | Yes | The studio's one is **Windows** (vLLM only via WSL2). Ollama models share VRAM with any second engine; size vLLM by `kv_cache_memory_bytes` |
| RTX 5090 | 32 GB | ~1.8 TB/s | Yes | Weights of 30B-class models leave little KV |
| RTX A6000 (Ampere) | 48 GB | 768 GB/s | No | AWQ/GPTQ 4-bit or GGUF; FP8 KV depends on vLLM build |
| RTX 4080 (Ada) — **most of the fleet** | 16 GB | ~717 GB/s | No (FP8 yes) | Windows boxes; today `gemma4:12b` on Ollama, auto context. Scale-out unit: seats per box from Phase 0.6 |
| RTX 4070 / 4070 Ti (Ada) | 12 GB | ~504 GB/s | No (FP8 yes) | As above. The OCR vision model can't sit beside a llama.cpp model (`admin/index.html:347-350`) |

KV reference points: Qwen3.8-27B ≈ 75 KB/token at q4_0 (repo-measured 1.2 GB/16k), ~2× at FP8; Nemotron 3.5 Lightning ≈ 3–5 KB/token FP8 (attention layers only). Decode on Spark reaches ~85 % of the bandwidth roofline (Qwen3.8-27B NVFP4: 273 GB/s ÷ 18.77 GB/token = 14.54 tok/s ceiling, 12.3 measured).

### 9.3 Catalog entry format

```json
{
  "id": "qwen3.6-35b-a3b",
  "label": "Qwen3.6-35B-A3B",
  "arch": { "totalB": 35, "activeB": 3, "class": "hybrid-moe", "attnLayers": null },
  "nativeCtx": 262144,
  "vision": true, "tools": true, "license": "Apache-2.0",
  "weights": [
    { "engine": "vllm", "quant": "nvfp4", "repo": "nvidia/Qwen3.6-35B-A3B-NVFP4", "gb": 19 }
  ],
  "kvBytesPerToken": { "fp8": null, "source": "probe" },
  "flags": { "vllm": ["--reasoning-parser", "qwen3", "--kv-cache-dtype", "fp8"] },
  "quality": { "sweVerified": 73.4, "terminalBench2": 51.5, "source": "vendor" },
  "perf": [
    { "hw": "dgx-spark", "engine": "vllm", "spec": "mtp-3", "concurrency": 1, "perUserTokS": 97.4, "measured": true, "date": "2026-06" },
    { "hw": "dgx-spark", "engine": "vllm", "spec": "mtp-3", "concurrency": 8, "aggTokS": 322.05, "perUserTokS": 42.16, "measured": true, "date": "2026-06" },
    { "hw": "dgx-spark", "engine": "vllm", "spec": "mtp-1", "concurrency": 16, "aggTokS": 325.3, "perUserTokS": 22.5, "measured": true, "date": "2026-04" }
  ],
  "useCases": ["chat", "vibe"]
}
```

`null` values are filled by the probe step on first load and cached per box (like today's Ollama context probe cache).

---

## 10. Security for larger groups

> **Owner, 2026-10-04:** TLS is **cut** (a closed, trusted LAN; revisit only if the school's IT or
> data-protection rules require encrypted Wi-Fi traffic). Revocation went with identity (1.1). What
> remains here: the password check before a seat (built, Phase 0.1) and rate-limiting failed admin
> attempts.

- **First, Phase 0.1:** the gate checks the farm password before giving a seat. Today it never checks it.
- **Revocation (only with 1.1 Option B, signed tokens):**
  - The Clients card gets *Revoke* per install. The card exists (`admin/index.html:487-533`) but has no
    revoke button.
  - A deny list goes in `lol.config.json` (a new key: strict schema), and the gate refuses those tokens.
  - The shell shows "access removed by the farm operator".
  - With header identity (Option A) there is nothing to revoke but the shared password.
- **Rotation:** changing the password affects new token requests; *Invalidate all tokens* rotates the
  **persisted** signing secret on purpose. Every client's OWUI restarts once, which is acceptable for a
  deliberate act and not for every farm restart.
- **Presence:** `POST /lol/client-ping` is open even on a passworded farm. Decide whether it should
  require the password, since it would carry the identity used for seats.
- **Optional TLS** (`proxy.tls: true`):
  - A self-signed cert on first run, with its fingerprint in the beacon. The shell pins it on first use
    (TOFU) and writes it to `DATA_DIR`.
  - **OWUI 0.11.4 has no fingerprint pinning.** Point it at a CA file:
    - `AIOHTTP_CLIENT_SESSION_SSL=<path>` covers OpenAI, TTS and SearXNG calls.
    - `AIOHTTP_CLIENT_SSL_CERT_FILE` **replaces** the whole trust store, so ship certifi plus the farm
      cert if it is used.
    - The OCR loader is plain `requests`, so it needs `REQUESTS_CA_BUNDLE`.
    - LOL Vibe, the Computer and the coding agent need the same trust.
  - The cert's SAN must cover every address a client reaches the farm at, and **DHCP can change it**.
    Weigh TLS against its value on a closed, trusted LAN.
- **Admin:** keep the separate admin token. Rate-limit failed attempts on `/lol/admin/*` (none today;
  only `/lol/plugin-keys` sleeps 400 ms) and on `/lol/client-token`.

---

## 11. Hardware configuration templates

> **Do not paste these into a running farm.** The config schema is strict: every key marked
> `// Phase N`, and the `vllm` blocks, make `lol up` refuse to start until that phase ships. The user
> counts below are v1 planning estimates, not measurements; Phase 0.6 replaces them.

The surfaces load a farm differently (from the code, audit §5):

- **OWUI chat:** bursty human-paced turns, documents and images, OCR and web search on. Each message is
  **two generations** while web search is on: a short search query, then the answer. Sized by people
  reading at once.
- **LOL Vibe chat:** one stream per window, history trimmed by the client.
- **Coding agent** (project threads in LOL Vibe):
  - Back-to-back tool steps with 4–16k-token outputs, in a context that grows and then compacts.
  - Prefill and prefix caching dominate.
  - Needs **OpenAI-native `tool_calls`**: vLLM `--enable-auto-tool-choice` + a tool parser; llama.cpp
    `--jinja`.
- **Computer:** **one long call at a time per client**, on a background lane that yields to the person's
  chat. 8k/16k ceilings, because thinking is on; `json_schema` only for structured asks. Classify,
  Listen, the bus, Speak and Document never touch the LLM or a seat. **Turning thinking off** is the
  biggest lever.

### 11.1 Overview

| Platform | Use case | Main model | Engine | Users (connected) | Context per user |
| --- | --- | --- | --- | --- | --- |
| DGX Spark | OWUI chat | Qwen3.6-35B-A3B NVFP4 + MTP | vLLM | 10–20 | 128k max, ~32k guaranteed |
| DGX Spark | LOL Vibe | Qwen3.6-35B-A3B NVFP4 + MTP | vLLM | 8–10 | 131k max |
| DGX Spark | Computer | Nemotron 3.5 Lightning NVFP4 | vLLM | 30–50 | 32k |
| RTX PRO 6000 (96 GB) | OWUI chat | Qwen3.8-27B NVFP4 + DSpark | vLLM | 25–35 | 128k max, ~16k guaranteed |
| RTX PRO 6000 (96 GB) | LOL Vibe | Qwen3.8-27B FP8 + DSpark | vLLM | 5–8 | 262k max |
| RTX PRO 6000 (96 GB) | Computer | Nemotron 3.5 Lightning NVFP4 | vLLM | 50+ | 64k |
| RTX A6000 (48 GB) | OWUI chat | Qwen3.8-27B 4-bit (AWQ or GGUF Q4) | vLLM or llama.cpp | 8–12 | 64k max, ~16k guaranteed |
| RTX A6000 (48 GB) | LOL Vibe | Nemotron 3.5 Lightning 4-bit | vLLM | 5–8 | 256k max |
| RTX A6000 (48 GB) | Computer | Nemotron 3.5 Lightning 4-bit | vLLM | 20–30 | 32k |
| ~~RTX 4080 / 4070 (16 / 12 GB)~~ | — | — | — | **Not farm capacity** (owner 2026-10-04: booked for 3D/VR/workshops) | — |

User counts are planning estimates assuming ~40 % of connected users generate at once; confirm with `lol bench` once it simulates people (Phase 0.5). The vLLM rows assume the Phase 2 `vllm` engine, which is a **DECISION**. Until then, run `vllm serve` yourself (on Linux, or in WSL2 on the Windows PRO 6000) and point the `external` block at it. Placeholders in `<angle brackets>` must be filled from the model card / vLLM recipe. Every vLLM row is replaced by the Phase 0.6 measurements once they exist.

### 11.2 DGX Spark

Give vLLM ~0.70–0.80 of the 128 GB unified pool (NVIDIA examples use 0.85–0.91, which leaves too little once OCR, plugins, LiteLLM and the OS run). If running two models (Option B below), split ~0.45–0.5 / ~0.25–0.3. Because Ollama shares the pool, prefer an absolute `--kv-cache-memory-bytes` over these fractions: vLLM's startup profiler aborts when another process changes its memory use mid-start, and the farm churns Ollama beside another engine (`keep_alive` 5m, pressure eviction).

**Shared base**

```jsonc
{
  "name": "Spark farm",
  "proxy": { "port": 4000, "host": "0.0.0.0", "masterKey": "<farm password>",
             "seatGate": true,
             "seatKey": "token",          // Phase 1.1 Option B — name not defined yet; omit with Option A
             "queueTimeoutSec": 120 },    // Phase 1
  "ollama": { "numParallel": 2, "maxLoadedModels": 2, "kvCacheType": "q8_0", "keepAlive": "-1" },
  "models": [
    { "id": "gemma4:12b", "default": true },                              // OCR vision model
    { "id": "<small instruct model>", "alias": "assistant-tasks" }        // Phase 1.4 option (b) — NOT served while vLLM/llama.cpp/external serves (no Ollama model is routed then); needs a routing change
  ]
}
```

**OWUI chat and LOL Vibe — Qwen3.6-35B-A3B (10 users)**

```jsonc
"vllm": {                                    // Phase 2
  "enabled": true, "alias": "assistant",
  "model": "nvidia/Qwen3.6-35B-A3B-NVFP4",
  "maxModelLen": 131072, "maxNumSeqs": 16,
  "kvCacheDtype": "fp8", "gpuMemoryUtilization": 0.75, "prefixCaching": true,   // or kvCacheMemoryGb (see §2.1) — Ollama shares the pool
  "speculative": { "method": "<Qwen3.6 MTP method per vLLM recipe>", "numSpeculativeTokens": 1 },
  "extraArgs": ["--reasoning-parser", "qwen3",
                "--enable-auto-tool-choice", "--tool-call-parser", "<Qwen tool parser per recipe>",
                "--mamba-cache-mode", "align"]
},
"proxy": { "perClientConcurrency": 1, "queueMax": 32 },   // Phase 1.2 (DECISION) — chat; coding agent: perClientConcurrency 2 (its title call), queueTimeoutSec 300
"websearch": { "enabled": true },
"ocr": { "enabled": true, "model": "gemma4:12b" }          // Vibe-only box: false
```

- MTP-1 held ~86 % acceptance up to 32 concurrent; MTP-3 maximizes single-stream speed. Use 1 for 10+ busy users.
- **Aliases, corrected.**
  - No client picks an alias by itself: Vibe and the Computer use a person's pick or the farm default;
    agent pages use the first listed model.
  - A `computer` alias would only be used where a person selects it in a box.
  - If one is exposed, inject **only** `chat_template_kwargs: {"enable_thinking": false}`. **Never** a
    low `max_tokens` (it cuts code answers and trips the Computer's cut-thinking error) and **never** a
    farm-imposed `response_format` (the client sends its own per-call schemas, and text/code boxes send
    none on purpose).
  - The coding agent's `pickEditor` regex (`/^qwen3\.8/`, `/^nemotron/`) would auto-move project threads
    onto a Nemotron-backed alias.
  - The simpler route: the client sends `enable_thinking:false` itself on the calls that don't need
    thinking.
- For the coding agent add `--max-num-batched-tokens 16384` (faster long prefills; lower it if chat users share the box). Keep agent system prompts and tool schemas byte-stable so prefix caching hits (cold 100k-token prefill ≈ 15–20 s on Spark).
- Check the startup log's "GPU KV cache size" and "maximum concurrency" lines after every change.

**Computer — Nemotron 3.5 Lightning (30–50 users), or the second model in Option B**

```jsonc
"vllm": {
  "enabled": true, "alias": "computer",
  "model": "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4",
  "maxModelLen": 32768, "maxNumSeqs": 64,
  "kvCacheDtype": "fp8", "gpuMemoryUtilization": 0.80, "prefixCaching": true,
  "speculative": { "model": "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4-DSpark",
                   "method": "dspark", "numSpeculativeTokens": 3 },
  "extraArgs": ["--mamba-cache-mode", "align", "--moe-backend", "marlin",
                "--reasoning-parser", "nemotron_v3",
                "--enable-auto-tool-choice", "--tool-call-parser", "qwen3_coder"]
},
"proxy": { "perClientConcurrency": 4, "queueTimeoutSec": 30 },   // Phase 1
"classify": { "enabled": true, "threads": 8, "maxItems": 200 },
"stt": { "enabled": true, "model": "small", "threads": 4 },
"bus": { "enabled": true },
"ocr": { "enabled": false }
```

- DSpark is NVIDIA's Spark default for low concurrency; at 10–16 busy users acceptance falls to ~21–29 % on mixed work — benchmark MTP or no draft. Acceptance also drops at temperature ≥ 0.7.
- Nemotron "thinks extensively": cap or disable reasoning for Computer calls, or answers can be cut off inside the reasoning trace.
- Classify and STT run on the Spark's ARM CPU cores.

Today's `external` equivalent (example for Nemotron; same pattern for Qwen3.6):

```bash
vllm serve nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4 \
  --host 127.0.0.1 --port 8082 --served-model-name computer \
  --kv-cache-dtype fp8 --mamba-cache-mode align --enable-prefix-caching \
  --gpu-memory-utilization 0.80 --max-model-len 32768 --max-num-seqs 64 \
  --speculative-config '{"model":"nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4-DSpark","method":"dspark","num_speculative_tokens":3}'
```

```jsonc
"external": { "enabled": true, "alias": "computer", "baseUrl": "http://127.0.0.1:8082/v1",
              "model": "computer", "contextLength": 32768, "parallel": 64,
              "vision": false, "label": "Nemotron 3.5 Lightning (vLLM)" }
```

**Spark layout options**
- **Option A (start here):** one vLLM instance of Qwen3.6-35B-A3B behind LiteLLM, three aliases (chat, coding, computer with thinking off).
- **Option B:** Qwen3.6 for chat + coding (~0.45–0.5) plus Nemotron 3.5 Lightning for Computer (~0.25–0.3). ~45 GB of weights total; both share 273 GB/s, so combined throughput is less than the sum of solo benchmarks. Watch `free -g` and OOM behaviour.
- Retire Ollama/llama.cpp for the shared endpoint on Spark (no concurrency scaling); keep Ollama for OCR and the tasks model.

### 11.3 RTX PRO 6000 (96 GB)

**The studio's RTX PRO 6000 (`AN-A6000PRO`) runs Windows and is also the dev box.**

- These vLLM templates run there only **in WSL2**, operator-run behind `external` today, or managed if
  Phase 2 is approved.
- **Start instead with the llama.cpp measurement in Phase 0.6:** `parallel` 8–16, `kvUnified`, the
  Qwen3.8-27B GGUF with mmproj (shape of §11.4's template).
- Use vLLM only if that falls short.

Give vLLM 0.82 (~79 GB), leaving ~17 GB for Ollama's OCR and tasks models, or better, an absolute
`--kv-cache-memory-bytes`. `gpu_memory_utilization` is a fraction of **total** VRAM, and Ollama loading or
unloading during vLLM's startup aborts it (measured on this box, 2026-09-24).

```jsonc
// Base
"vllm": { "enabled": true, "alias": "assistant", "kvCacheDtype": "fp8",
          "gpuMemoryUtilization": 0.82, "prefixCaching": true,
          "extraArgs": ["--reasoning-parser", "qwen3"] }

// OWUI chat, 25–35 users
"vllm": { "model": "<Qwen3.8-27B NVFP4 checkpoint>", "maxModelLen": 131072, "maxNumSeqs": 32,
          "speculative": { "model": "RedHatAI/Qwen3.8-27B-speculator.dspark", "method": "dspark",
                           "numSpeculativeTokens": 4 } },
"proxy": { "perClientConcurrency": 1, "queueMax": 64 },
"websearch": { "enabled": true }, "ocr": { "enabled": true, "model": "gemma4:12b" }

// LOL Vibe, 5–8 users
"vllm": { "model": "Qwen/Qwen3.8-27B-FP8", "maxModelLen": 262144, "maxNumSeqs": 8,
          "speculative": { "model": "RedHatAI/Qwen3.8-27B-speculator.dspark", "method": "dspark",
                           "numSpeculativeTokens": 8 },
          "extraArgs": ["--reasoning-parser", "qwen3", "--max-num-batched-tokens", "16384",
                        "--enable-auto-tool-choice", "--tool-call-parser", "<per model card>"] },
"proxy": { "perClientConcurrency": 2, "queueTimeoutSec": 300 }, "ocr": { "enabled": false }

// Computer, 50+ users: Spark Computer profile with gpuMemoryUtilization 0.82,
// maxModelLen 65536, maxNumSeqs 128.
```

- Qwen3.8 reads images itself (`vision: true`); OCR stays for scanned PDFs.
- At 30 concurrent users, 3–4 drafted tokens usually beat the speculator's published 8; with few Vibe users keep 8.
- For more than 8 coders, switch to Qwen3.6-35B-A3B or Nemotron, or add a card.

### 11.4 RTX A6000 (48 GB, Ampere)

Half the memory and ~40 % of the PRO 6000's bandwidth; no FP4/FP8 tensor cores.
- Weights: 4-bit AWQ/GPTQ for vLLM; Nemotron NVFP4 may run through Marlin on non-Blackwell (test first).
- KV: try `kvCacheDtype: "fp8"`; if refused on Ampere, use `auto` and halve `maxNumSeqs`.
- OCR: `ocr.placement: "peer"` (Phase 1.5) or disable — the 7.6 GB vision model costs ~1/3 of the remaining pool.
- Profiles: PRO 6000 templates with `gpuMemoryUtilization: 0.88` and overview user counts.

llama.cpp alternative (Windows or before Phase 2), OWUI chat with Qwen3.8-27B:

```jsonc
"llamacpp": {
  "enabled": true, "alias": "assistant",
  "model": "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/<UD-Q4_K_XL file>.gguf",
  "mmproj": "https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/mmproj-F16.gguf",
  "parallel": 12, "contextLength": 262144, "kvUnified": true,
  "kvCacheType": "q4_0", "flashAttention": true, "ngl": 999,
  "mtp": true,          // allowed: UD-Q4_K_XL is above UD-Q2_K_XL — but MTP turns OFF --cache-reuse (llamacpp.js:188); measure both for multi-user
  "cacheRam": "auto"
}
```

262k shared context ≈ 20 GB KV at q4_0 + ~17 GB weights ≈ 37 GB; each of 12 slots guaranteed ~21k, a lone user gets the full window.

### 11.5 Spark serving tips (from research)

- **Engine:** vLLM (v0.27.1+ for Lightning, v0.28.0+ for Qwen3.6 NVFP4). SGLang is close (~10 % behind on Lightning at c=8) but had a Gemma 4 vision concurrency bug. TensorRT-LLM shows no advantage for bandwidth-bound decode. Ollama/llama.cpp do not scale with concurrency on Spark (Ollama's aggregate at 8 = its single-stream; vLLM reached 289–313 tok/s on the same box).
- **Quantization:** NVIDIA ModelOpt NVFP4 checkpoints; on GB10 the gain is mostly bandwidth. Early "NVFP4 is slow" reports were kernel fallbacks — use current images and recipe flags.
- **FP8 KV:** use with checkpoints shipping calibrated KV scales; run a long-generation sanity test (uncalibrated FP8 KV caused repetition loops on GB10 in one report).
- **`--max-num-seqs`:** 16 for 10 users (some recipes use 2–4, which makes requests queue).
- **CUDA graphs:** never `--enforce-eager` (one NVFP4 MoE went 23 → 67 tok/s); make sure batch sizes 10–16 are captured (missing sizes cost 17–25 % at c=5/c=10 for gpt-oss-120b).
- **Context:** don't set 1M "because you can"; vLLM allocates on demand, the pool must cover the sum of live contexts.
- **Prefix caching:** `--enable-prefix-caching`; hybrids use `--mamba-cache-mode align` (experimental for Qwen3.6).
- **Thermals:** a Spark under sustained full load hard-powered-off in one report; a 2200 MHz clock cap fixed it. Monitor all-day classroom boxes.

---

## 12. Sequencing, effort and acceptance

**Order:**

**Order:**

1. **Phase 0**: 0.0 pin + cancel, 0.1–0.4 leaks, 0.5 bench, **0.6 the engine × model spike**, 0.7 VRAM
   budget from free memory.
2. **Phase 5's measured table** (the purchase tool), straight from 0.6.
3. **Phase 2:** the vLLM engine (step (a) integrated `external`, then (b) managed if chosen), with the
   model and flags the spike picked.
4. **1.6 client fixes**, and slots/model per the measurements.
5. **The answered DECISIONs (2026-10-04):**
   - the workshop setting for the seat hold (1.2), now;
   - seats near the measured capacity (1.2), after the spike;
   - the web-search cost (1.4), measured first;
   - the OCR reserve (1.5), with Phase 2's sizing.
6. **Phase 3** when a second big box arrives; 4.1 and 4.4 later.
   - **Cut:** 1.1, 3.2, 4.2 and TLS.
   - **4.3 (laptop model)** is an open study: run the harness on a few laptops first.

| Item | Depends on | Effort | Done when |
| --- | --- | --- | --- |
| 0.0 Pin LiteLLM, prove cancel reaches the engine | — | 1–2 days | LiteLLM pinned in `lol install`; a cancelled stream frees its **engine** slot within 1 s on a test farm |
| 0.1–0.4 Password before seat, gated paths, persisted plugin keys, OCR semaphore | — | 3–4 days | A keyless POST gets 401 and no seat; a farm restart no longer restarts connected OWUIs; OCR vision calls are bounded and queued |
| 0.5 Bench with distinct source addresses + realistic load | — | 1–2 days | `lol bench --users 8` holds 8 seats on a test farm |
| 0.6 Engine × model spike | 0.0, 0.5 | ~1–1.5 weeks (vLLM venv in WSL2, Spark access, weights, quality gate) | One row per box × engine × model × context: people at TTFT p95 < 5 s and ≥ 15 tok/s, quality-gate result, VRAM; generations + prompt tokens per OWUI message |
| 0.7 VRAM budget from free memory / co-tenant reserve | — | 1 day | llama.cpp auto context fits beside ComfyUI's resident ~45 GB |
| 1.6 Client fixes | — | 2–3 days | Computer runs model boxes while holding its own seat on a full farm; a 429 costs no Cap; dsh doesn't self-retry 429 |
| 3.0 Fleet path (coordinator capacity, static peers, peer-429, failover) | 0.6 | 1 week | A coordinator over N boxes (across subnets) advertises their summed slots; a client off a full farm moves only when idle |
| 1.4 Background tasks (DECISION a/b/c) | 0.6 | ½ day (c) – 1 week (a, needs 1.2) | Main-lane generations per OWUI message drop to 1 (search query moved or off) |
| ~~1.1 Per-install identity~~ | — | — | Cut (owner, 2026-10-04) |
| 1.2 Fair queue (DECISION) | 1.1 | 1 week | No 429 below `queueMax`; queue depth shown in the shell; a queue survives a LiteLLM restart |
| 1.5 Plugin budget (DECISION; critic: cut) | — | 2–3 days | Beside a non-Ollama engine, auto context leaves OCR's VRAM free |
| 4.4 Snapshot schema check | — | 1–2 days | A farm unit test fails when `buildSnapshot()` drifts from the schema (the snapshot already has tests, `farm/test/run.js:856`) |
| 2 (a) vLLM as integrated `external` | 0.6 | 1 week | Seats, Performance card and `capacity.busy/queued` from vLLM's `/metrics` |
| 2.1–2.3 (b) Managed vLLM (DECISION from the spike) | 2 (a) | 2 weeks | `lol up` serves the spike's model on a Spark and in WSL2 on the PRO 6000, with fallback working |
| 2.4–2.5 vLLM sizing and metrics | 2.1–2.3 | 1–2 weeks | Beacon `slots` matches vLLM's pool; Performance card live per engine |
| 3.1 Cache affinity | 1.1, 3.0 | 1 week | Returning turns hit the prefix cache > 80 % in a two-box test |
| 3.2 Overflow tier | 1.2 | 1 week | Saturated main model serves overflow within `triggerWaitSec` |
| 3.3 Minimal metrics (429 count, peak seats, TTFT p95 in the snapshot) | — | 1–2 days | The panel shows them; no per-install labels |
| 5 Measured capacity table (purchase tool) | 0.6 | 3–5 days | People-per-box at 32k/64k/128k for Spark and PRO 6000, measured; labelled estimates for boxes not owned |
| 5.1–5.4 Interactive planner (only if the table is too coarse) | 5 table, 4.4 | 2–3 weeks | Golden tests pass on the studio's big boxes; estimates within ±25 % of local measurements |
| 5.5 Planner learns from bench | 5.1–5.4, 0.5 | 3–4 days | Local bench points override catalog points in the panel |
| 4.1 LAN model sharing (critic: defer) | 4.4 | 1–2 weeks | Second box installs from a peer with verified hashes |
| Revocation (DECISION) | 1.1 B | 3 days | Revoked install refused |
| TLS (DECISION; critic: cut) | — | 1 week+ | TLS works with OWUI's CA-file env and the three other trust stores |
| ~~4.2 Plugin backends (QVAC)~~, ~~4.3 On-device fallback~~ | — | — | Recommended cut (DECISION) |

**Global acceptance tests** (only meaningful once bench simulates people, Phase 0.5):

- **One PRO 6000 (beside ComfyUI) and one Spark**, each with the model the spike picked:
  `lol bench --profile workshop --users <real head count>` at ≥ 32k context per person gives TTFT
  p95 < 5 s, ≥ 90 % of users above 15 tok/s, the quality gate passed, and zero 429s below the queue
  limit if 1.2 is adopted.
- v1's targets (one PRO 6000 + Nemotron under vLLM at 50 users, one Spark + Qwen3.6 at 10 users at
  ≥ 20 tok/s) remain stretch targets for Phase 2.

---

## 13. Risks, assumptions and open questions

**Resolved by the 2026-10-04 audit** (v1 risks):

- OWUI's env names were verified in the pinned 0.11.4: connections, `OPENAI_API_CONFIGS` headers,
  `TASK_MODEL_EXTERNAL`, timeouts and TLS (§1). The admin REST API is **not** an option (§0.2).
- The source was read: module names now point at real files (`seats.js`, `up.js`, `configBridge.ts`,
  `governor.mjs`, …).
- LOL Vibe's and the Computer's request patterns were confirmed from code (§1 Use cases; audit §5).
- QVAC on Node: already measured, it doesn't run on Node (Phase 4).
- OWUI timeouts: chat has no total timeout; only the 10 s `/models` fetch matters, and it is never
  queued.

**Remaining risks:**

- **Field version drift.** Clients run 0.10.x OWUI sidecars and farms update manually. Every new env var
  and snapshot field must degrade gracefully.
- **LiteLLM is unpinned.** Cancel propagation, header passing and routing behaviour can change under a
  reinstall. Pin it in Phase 1.3.
- **The live dev box.** Every farm experiment on `AN-A6000PRO` risks real users (§0.7).
- **vLLM:** on Spark, arm64 wheels and NVFP4 kernels move fast (pin, keep a Docker fallback). On Windows
  it only runs in WSL2, with its process-lifetime hazards.
- **Overflow quality:** keep it opt-in and always labelled.
- **Benchmarks:** most §9 numbers are single-author posts with different builds. No source measured
  exactly 10 concurrent users for Qwen3.6 or Lightning. Quality scores are vendor-reported. Local
  measurements decide.

**DECISIONs for the owner** (no code before an answer). Each carries the **critic's recommendation**
([docs/reviews/MULTIUSER_PLAN_CRITIC_2026-10-04.md](docs/reviews/MULTIUSER_PLAN_CRITIC_2026-10-04.md)).
These are recommendations, not decisions.

1. **Target. ANSWERED (2026-10-04):** scale up on the big boxes (PRO 6000, Sparks), optimising
   people × quality × context per box; the small GPUs are out.
   - Still open: the real head count per class, which sets the acceptance test.
   - *Critic:* one class on the PRO 6000 first.
2. **Queue or 429** (1.2). **ANSWERED (2026-10-04): the engine queues, plus a workshop setting.**
   - With vLLM, seats are set near what the card really serves at acceptable speed (from the spike), and
     vLLM's own scheduler queues the rest. The 429 becomes a rare safety valve.
   - A panel control shortens the seat hold (`seatIdleSec`, config-only today) for classes.
   - The farm's fair queue is built **only if** the 3.3 metrics show frequent refusals.
   - *Critic:* keep 429 + a workshop preset. Close to this.
3. **Identity** (1.1). **ANSWERED (2026-10-04): no hard per-person identity**: complexity for users,
   unclear gains. Matches the critic's "neither for now".
4. **OWUI's search-query generation and web pages** (1.4). **ANSWERED (2026-10-04): measure first, then
   decide.**
   - Measure the per-message cost: the query generation and the prompt tokens of injected pages.
   - Then (b) turn query generation off (one env line) if it's significant, or (c) make web search off by
     default if the pages dominate.
   - *Critic:* the same.
5. **vLLM** (Phase 2). **ANSWERED (2026-10-04): in scope**, overriding the critic's cut.
   - Still open, decided from the spike: (a) integrated `external` or (b) fully managed.
   - The critic's caution stands as a test condition: WSL2 lifetimes on the PRO 6000 must be handled
     (stdin-EOF self-kill), and llama.cpp with a 3B-active MoE is measured beside it.
6. **OCR reserve** (1.5). **ANSWERED (2026-10-04): reserve ~9 GB for the OCR model on vLLM boxes.**
   - vLLM's `--kv-cache-memory-bytes` leaves room for it. It costs ~14 % of the KV pool: Qwen3.6
     168 → ~144 people at 32k, Nemotron 485 → ~415. Memory is not the limit on these models.
   - The spike's 62 GB KV budget already leaves ~15 GiB free on the 96 GB card.
   - The 2026-08-26 rule (no reserve) still holds for llama.cpp on 12–16 GB cards.
   - Later, if Qwen3.6 wins: let the served vision model read documents itself (no second model).
7. **Cuts. ANSWERED (2026-10-04):**
   - **Cut:** 4.2 (QVAC plugins) and 3.2 (overflow to a weaker model, which works against the quality
     goal).
   - **4.3 is NOT cut: an open study.** The owner: "it should be able to run on any laptop … I think
     it's a good idea but I am afraid most laptops won't be able to have decent speed and quality.
     Depends on the use case, the space etc. We need to think further about use cases and if it is
     really pertinent." See §7, 4.3.
   - *Critic:* cut more (Phase 5 catalog, managed vLLM). Phase 5 became the measured table; vLLM stays
     (owner).
8. **TLS** (§10). **ANSWERED (2026-10-04): cut.** It is a closed, trusted LAN. Revisit only if the
   school's IT or data-protection rules require encrypted Wi-Fi traffic.

## 13b. Gaps the critic raised (not yet planned)

- **What a person sees while waiting, per surface.** Today:
  - OWUI shows the 429 text and needs a manual resend.
  - Vibe shows seat-wait.
  - The Computer yields, but a 429 costs a Cap generation.
  - The coding agent retries 5 times uselessly.
  - Agent pages throw "busy".

  One table, with one honest wait message per surface.
- **The workshop operator's flow.** `seatIdleSec` is config-file only, the slots are panel-capped at 16,
  and Ollama slots apply after a restart. Who flips a pre-class preset, and when?
- **Slots vs context.** More slots means less context per person, a RAG-mode flip that reboots every
  OWUI, and a coding agent that can't compact under "Keep going". The panel should show that trade
  before Apply.
- **Thinking control.** It is the biggest demand lever, and unscheduled, for OWUI chats as well as the
  Computer. Options: a per-alias `chat_template_kwargs` in LiteLLM, or llama-server's reasoning budget.
- **Web search `always` + whole-document injection.** Measure the cost and revisit the 2026-07-02
  default.
- **Subnets and shared boxes.** The coordinator needs static peers across subnets. Fleet boxes may be
  people's own workstations, so a farm there competes with their GPU work.
- **Identity privacy.** Per-request install ids, per-install metric labels and recorded replays would
  make a "stores nothing" farm a per-student activity record (data protection at a school).
- **Mixed-version rollout.** Farms update manually, clients auto-update, and many sidecars are 0.10.x.
  Each item needs an old-farm/new-client compatibility line. Cloned images also clone the farm's
  `.lol-id` (`farm/src/identity.js:9`), and clients de-dupe farms by id.

---

## 14. Sources

LlmOnLan
- [docs/reviews/MULTIUSER_PLAN_AUDIT_2026-10-04.md](docs/reviews/MULTIUSER_PLAN_AUDIT_2026-10-04.md): the code audit behind revision 2, with every file:line citation
- [docs/reviews/MULTIUSER_PLAN_CRITIC_2026-10-04.md](docs/reviews/MULTIUSER_PLAN_CRITIC_2026-10-04.md): the critic's scorecard and recommendations on revision 2
- https://github.com/b2renger/LlmOnLan (README)
- https://github.com/b2renger/LlmOnLan/blob/main/farm/README.md
- https://github.com/b2renger/LlmOnLan/releases/tag/v0.2.5 (LOL Vibe coding agent)

QVAC
- https://github.com/tetherto/qvac

Models
- https://huggingface.co/Qwen/Qwen3.6-35B-A3B
- https://recipes.vllm.ai/Qwen/Qwen3.6-35B-A3B
- https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4
- https://huggingface.co/Qwen/Qwen3.8-27B
- https://huggingface.co/RedHatAI/Qwen3.8-27B-speculator.dspark

DGX Spark measurements
- https://llmrequirements.com/news/2026-06-03-nvfp4-qwen-3-6-35b-dgx-spark
- https://stevescargall.com/blog/2026/04/vllm-recipe-redhatai/qwen3.6-35b-a3b-nvfp4-on-dgx-spark/
- https://dev.classmethod.jp/en/articles/dgx-spark-nemotron-3-5-lightning-first-touch/
- https://forums.developer.nvidia.com/t/nvidia-nemotron-3-5-lightning-30b-a3b-nvfp4-dgx-spark-vs-rtx-pro-6000-blackwell-performance/379921
- https://forums.developer.nvidia.com/t/measured-inference-benchmarks-on-a-single-dgx-spark-same-harness-across-ollama-llama-cpp-and-vllm-notes-data-published/379766
- https://ai-muninn.com/en/blog/dgx-spark-bandwidth-ceiling-85-percent
- https://ai-muninn.com/en/blog/dgx-spark-gemma4-26b-nvfp4-52-toks
- https://ai-muninn.com/en/blog/qwen38-flash-next-nvfp4-dgx-spark-vllm-recipe
- https://dendro-logic.com/recipes/gpt-oss-120b-gx10-dgx-spark-concurrency-first/
- https://forums.developer.nvidia.com/t/nemotron-3-super-120b-a12b-nvfp4-on-single-dgx-spark-23-45-tok-s-spark-arena-com-benhmarks/370070
- https://vllm.ai/blog/2026-06-01-vllm-dgx-spark
- https://github.com/0xBakeer/Qwen3.8-27B-FP8-on-a-single-DGX-Spark