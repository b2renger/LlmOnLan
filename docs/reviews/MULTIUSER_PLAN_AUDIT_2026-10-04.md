# Audit — `multiuser_implementation_plan.md` against the repo (2026-10-04)

Status: COMPLETE (2026-10-04). Method: three read-only agents (farm · shell + OWUI 0.11.4 source ·
LOL Vibe + the Computer), each load-bearing claim then re-read by hand. Nothing was run against the
live farm.

Scope: every claim in the plan's §1 (Repository facts), §3 (Current state and gaps) and §11 (Hardware
configuration templates), plus every "today the code does X" statement elsewhere. Verdicts:
**CONFIRMED**, **WRONG** (with file:line), **PARTLY**, **ALREADY IMPLEMENTED**. Read-only audit: no code
was changed.

## 1. §1 Repository facts

| §1 claim | Verdict | Evidence | Note |
| --- | --- | --- | --- |
| Farm generates `litellm/config.generated.yaml`, runs the beacon and the panel; Farm-app updates are manual | CONFIRMED | `farm/src/litellm.js:373-375`, `farm/src/commands/up.js:1034-1042`, `farm-app/src/main/updater.ts:1-7` | |
| Engines: Ollama default; llama.cpp opt-in under `llamacpp.alias`; external never installed/started, ctx/parallel declared | CONFIRMED | `farm/src/config.js:155`, `:288-294`, `:314-315` | External unreachable at boot falls back to **llama.cpp if enabled, else Ollama** (`litellm.js:156-163`); dying mid-run has no fallback, only `healthy:false` (`up.js:1232-1241`). |
| One engine at a time; `carryNameAcross` | CONFIRMED | `litellm.js:70-72`, `:105` | Carries names Ollama ↔ llama.cpp only; external goes through `engineFallback`. |
| Ollama must be reachable even when another engine serves | CONFIRMED | `up.js:457-458` (`if (!oll) return 1`), `:218-219` | Runs before any engine starts; a non-serving Ollama gets `OLLAMA_KEEP_ALIVE=5m` (`up.js:96`). |
| llama.cpp: `parallel` 1, `kvUnified` true, `kvCacheType` q4_0, `cacheRam`, `mtp` ≥ UD-Q2_K_XL | CONFIRMED | `config.js:250,254,259,266,271` | `cacheRam:'auto'` = ¼ RAM, 8–32 GiB (`llamacpp.js:195-197`). |
| `contextLength:"auto"` from the GGUF header + VRAM | CONFIRMED | `up.js:719-728`, `perf.js:108` | Budget = VRAM − 0.4 GB − weights − mmproj − 1.0 GB; **independent of `parallel`**. |
| KV allocated in full at load | CONFIRMED | `farm/README.md:342-343`, `docs/DEVLOG.md:4842-4844` | |
| Crash policy: one restart, second in 5 min → Ollama | CONFIRMED (llama.cpp only) | `up.js:796`, `:811` | External has no restart policy. |
| Prebuilts win-x64 + linux-arm64 (`llamacpp-<build>`) | CONFIRMED | `llamacpp.js:37` (b10670), `:58-80` | No linux-x64 prebuilt. |
| Qwen3.8-27B KV ~1.2 GB/16k at q4_0; weights ~7.8 GB | CONFIRMED | `perf.js:89` `KV_GB_PER_16K = { q4_0: 1.2, … }`; `config.js:202` `sizeGb: 7.8`; `gguf.js:130-132` | `gguf.js:135-141` prices **every** layer as attention — over-estimates hybrids, as the plan suspects. |
| Gate on `proxy.port`, LiteLLM loopback on port+1, `seatGate:false` bypasses | CONFIRMED | `up.js:900-902` | |
| One IP = one seat; first completion claims; each refreshes; 900 s idle | CONFIRMED | `farm/src/seats.js:51-69`, `config.js:79` | `release()` also refreshes, so the 15 min start when the last generation **ends** (`seats.js:72-77`). |
| Full farm → 429 "All N seats are in use" | CONFIRMED | `seats.js:101-107` (`code: 'lol_seats_full'`) | `Retry-After: 30` while the message says "~15 min". |
| `/v1/models`, health, panel ungated | CONFIRMED — and broader | `seats.js:40` | Only 4 POST paths are gated; `/v1/responses`, `/v1/messages`, embeddings pass ungated. |
| Coordinator peer = one seat | CONFIRMED | `seats.js:26-28` | |
| Presence: ping ~10 s, dropped ~30 s after close | CONFIRMED | `up.js:1077` (`CLIENT_TTL_MS = 30000`), `:1087-1114` | `/lol/client-ping` is unauthenticated even on a passworded farm (`selfServer.js:91-96`). |
| Beacon carries `capacity {slots, clients, seatsUsed}` | PARTLY | `snapshot.js:299-311` | Real fields: `slots, clients, seatsUsed, seatIdleSec, busy, queued` (the last two from llama-server `/metrics` only). |
| Beacon 239.255.43.10:41998 every 5 s; HTTP 41997 | CONFIRMED | `config.js:56-62`, `beacon.js:50` | Plus an immediate kick on every change. |
| Admin route list | CONFIRMED (exact) | `selfServer.js:2-23`, `:124-184` | Outside `/lol/admin/*`: `GET /lol/self`, `POST /lol/client-ping`, `GET /lol/plugin-keys`. No clients route — clients ride `GET /lol/admin/state` (`up.js:1539-1543`). |
| One long operation at a time | CONFIRMED | `up.js:1895` | Refused, not queued. |
| Plugin defaults (SearXNG on, OCR on, Kokoro/Classify/STT/bus off) | CONFIRMED | `config.js:328,337,347,356,367,382` | |
| OCR = gemma4:12b ~7.6 GB | CONFIRMED, misleading | `up.js:59-66`, README `:396` | OCR uses the **served default vision model**. On the default Ollama engine it *is* the chat model — no second GPU tenant. The 7.6 GB tenant exists only while llama.cpp/external serves. Resident: 7.8–9.3 GB (`DEVLOG.md:4848`). |
| Classify/STT one job at a time + 429 + Retry-After | CONFIRMED | `pysvc/classify_server.py:44,142-144`; `pysvc/stt_server.py:44,100-102` | Also 1 per client IP, `MAX_WAITING` 4. **OCR has no cap** (`pysvc/server.py:320-323`). |
| Pressure eviction ≥ 92 % VRAM, ≤ 20 % busy | CONFIRMED | `perf.js:129-130`, `up.js:1258-1268` | Only while a non-Ollama engine serves. |
| `masterKey` = password = LiteLLM `master_key`; plugin keys via `/lol/plugin-keys`; plain HTTP | CONFIRMED | `litellm.js:361-363`, `selfServer.js:98-100` | Plugin keys are `randomBytes(24)` per plugin **start**, not per farm run, not HMAC (`plugins/registry.js:73,115,133`). |
| `lol bench --users N --rounds R` (TTFT p50/p95, tok/s) | PARTLY | `farm/src/commands/bench.js:6,84-89,106,125` | Also `--model --url --prompt --max-tokens`; reports **median** per-user tok/s; saves nothing; **every user comes from one IP = one seat**. |
| Performance card reads llama-server counters | CONFIRMED (llama.cpp only) | `llamacpp.js:375`, `perf.js:36-53` | 4 warnings, not 2 (`admin/index.html:343-354`). `kvUsed` is null on b10670. |
| First Farm-app run downloads ~28 GB (30–45 min) | WRONG | `docs/GETTING_STARTED.md:27` "~18 GB, 20–30 min" | 28 GB predates llama.cpp going off by default (2026-08-27); it adds ~10 GB only when enabled. |
| Use cases: Vibe = "a coding agent"; Computer = boxes | see §5 | | |
| `npm test` runs unit tests + `check_services.py` | CONFIRMED (farm) | `farm/package.json` → `test/run.js:2005-2012` | The shell's `npm test` is different — see §4. |

## 2. §3 Current state and gaps

| §3 row | Verdict | Evidence | What the plan misses |
| --- | --- | --- | --- |
| Seat gate | CONFIRMED | `seats.js` (above) | (1) **No cap on in-flight requests per seat** (`seats.js:69`) — one IP can push N parallel generations into the engine queue. (2) **Seats are claimed before authentication** (`admit()` at `seats.js:98`; headers passed through at `:121`) — a keyless POST holds a seat for 15 min on a passworded farm. (3) Generation paths other than the 4 listed are ungated. (4) No request timeout; a hung stream holds its seat until its socket closes. (5) Panel actions that bounce LiteLLM drop in-flight chats with 502 `lol_upstream_down` (`up.js:1369-1396`, `seats.js:126-133`) — any queue must survive that. |
| Presence | CONFIRMED | `seats.js:59-66` vs `up.js:1089,1105` | Seats keyed by IP, clients by `body.id`; a ping neither holds nor frees a seat. |
| llama.cpp "slots × window must fit VRAM up front, so seats stay low (8 on 24 GB at 16k)" | PARTLY | `up.js:719-723`, `snapshot.js:106` | With `kvUnified` + `auto`, the pool is sized from VRAM whatever `parallel` is; slots only lower the *guaranteed floor* (`contextPerSlot = ctx/slots`). "8 on 24 GB" is a README illustration. The real ceiling is the **panel cap of 16** (`up.js:2416`). |
| External engine | CONFIRMED | `snapshot.js:69-86` (`slotsVerified:false`) | |
| Routing | PARTLY | `litellm.js:338` (`least-busy`, retries 3, allowed_fails 1, cooldown 60) | Per-box slot affinity **already exists inside llama-server**: `--slot-prompt-similarity 0.4`, `--cache-reuse 256`, `--cache-ram` (`llamacpp.js:188-207`). No cross-box affinity, no overflow tier: confirmed. |
| Plugins not in the capacity budget | CONFIRMED — and a recorded decision | `perf.js:108`; `admin/index.html:347-350` | Owner audit 2026-08-26 chose **not** to reserve OCR room ("would collapse chat context to nothing … the wrong trade"); ECOSYSTEM_PLAN 2026-09-27 §2.3.1 (`docs/ECOSYSTEM_PLAN.md:80-82`) reopens it. Plan §1.5 must reconcile both. |
| Ops: one long op; no metrics export; bench = N identical chats | CONFIRMED | `selfServer.js` (no `/metrics`), `bench.js:106-109` | Bench is also single-IP → one seat (see §1). |
| Security: one password, plain HTTP, no revocation, no TLS | CONFIRMED | | Failed `/lol/admin/*` attempts aren't rate-limited; only `/lol/plugin-keys` sleeps 400 ms. |
| Distribution: ~28 GB per box; each box re-downloads | PARTLY | `up.js:252-283`, `ollama.js:340-347` | Re-download confirmed (no LAN copy). Size is ~18 GB (see §1). |
| Hidden cost: OWUI background tasks (title, tags, follow-ups, autocomplete) | PARTLY — mostly ALREADY IMPLEMENTED | `shell/src/main/configBridge.ts:178` (retrieval query) `:219` (autocomplete) `:220` (follow-ups) `:221` (tags) all `'false'` | Still on: **title** (once per chat, kept deliberately, `configBridge.ts:215-217`) and **search-query generation** (`configBridge.ts:176-177`) — which runs on **every** message when web search is on (OWUI `utils/middleware.py:~1574-1583`), and the shell seeds web search `'always'` (`renderer/app.js:531`). The real per-message extra generation is the search query, not title/tags. |

## 3. §11 Hardware configuration templates (config keys and use-case claims)

### 3a. Config keys — would `lol up` accept the templates?

`ConfigSchema`, `ProxySchema`, `OcrSchema`, `BusSchema` and most sub-schemas are zod `.strict()`
(`farm/src/config.js:53,63,81,132,278,320,330,341,371,512`). An unknown key makes `loadConfig` throw
`BAD_CONFIG` (`config.js:553-558`) — **the farm refuses to start**. `classify` and `stt` are not strict:
an unknown key there is silently dropped.

| Template key | Today | Evidence |
| --- | --- | --- |
| `proxy.seatKey`, `queueTimeoutSec`, `perClientConcurrency`, `queueMax`, `seatGraceSec`, `tls` | **Absent — farm refuses to start** | `config.js:81` |
| `ocr.vramGb`, `ocr.placement` | **Absent — refuses to start** | `config.js:399` |
| top-level `vllm`, `overflow` | **Absent — refuses to start** | `config.js:512` |
| `proxy.masterKey`, `seatGate`, `internalPort` | Exist | `config.js:70,78,80` |
| `ollama.numParallel`, `maxLoadedModels`, `kvCacheType`, `keepAlive` | Exist | `config.js:85,86,94,99` — env-backed: apply only to an Ollama the farm starts (`:92-93,98`) |
| `models[].alias` (`assistant-tasks`) | Exists | `config.js:52` — but while llama.cpp/external/vLLM serves **no Ollama model is routed** (`litellm.js:64-72`), so the tasks alias in the §11.2 shared base would not be served at all |
| `ocr.enabled`, `ocr.model`, `websearch.enabled`, `bus.enabled` | Exist | `config.js:382,386,328,367` |
| `classify.enabled/threads/maxItems`, `stt.enabled/model/threads` | Exist | `config.js:346-361` |
| `external.enabled/alias/baseUrl/model/contextLength/parallel/vision/label` | Exist (all eight) | `config.js:298-319` |
| `llamacpp.enabled/alias/model/mmproj/library/contextLength/ngl/parallel/flashAttention/kvCacheType/cacheRam/kvUnified/mtp` | Exist | `config.js:155-271`; `mmproj` is downloaded and passed as `--mmproj` today (`llamacpp.js:208,322-324`) |

The plan (v1) marks some Phase keys `// Phase 1/2` but not all: `proxy.perClientConcurrency`/`queueMax`
(the §11.2 chat block) and the §11.3/§11.4 `vllm` blocks carry no marker, and nothing warns that copying any
of them **today** stops the farm from booting.

### 3b. Use-case and hardware claims

| §11 claim | Verdict | Evidence | Note |
| --- | --- | --- | --- |
| "LOL Vibe: coding agent; long growing contexts, many tool calls; prefill and prefix caching dominate; needs reliable tool calling" | PARTLY | `shell/renderer/chat/app/controller.mjs:490-499`; `shell/src/main/studio.ts:110,119-125` | Only **project-bound threads** are answered by the coding agent (dsh). Ordinary Vibe threads are plain streaming chat with no tools. The coding agent uses **OpenAI-native `tools`**, so the engine and LiteLLM must return `tool_calls`. Its window is the farm's `contextPerSlot` (fallback 32k), not a fixed 128k, and it compacts within it. |
| "Computer: many short structured calls (Classify, Listen, LLM boxes, bus); latency and request rate matter more than context" | WRONG on most points | `renderer/chat/net/governor.mjs:50-62,107`; `graph/bind.mjs:62-131`; `app/ask.mjs:470-473,587` | Classify and Listen are CPU plugins; the bus is a Node hub. **None of them takes a seat or touches the LLM.** LLM boxes are **not short**: ceilings are 4k/8k/16k tokens, raised because thinking models spend 2–4k on reasoning, and prompts can fill about ¾ of the window. Rate is **at most 1 request in flight per client**, on a background lane that yields to the person's chat. Structured output (`json_schema` strict) is used for list/json/verdict/agent calls only; text and code answers send none. |
| Aliases `chat`/`coding`/`computer`; the `computer` alias injects no-thinking, low `max_tokens` and a JSON-schema `response_format` | WRONG as a drop-in | `graph/parts/instruction.mjs:83-89`; `app/ask.mjs:587`; `renderer/chat/projects/models.mjs:217-239` | No caller picks an alias by itself: Vibe and the Computer use a person's pick or the farm default; agent pages use the **first** id in `/v1/models` (`assets/agent-page/lol-agent.mjs:55`). A forced JSON schema would break text/code boxes; a low `max_tokens` would cut code and trip `cutThinking`. The coding agent's `pickEditor` regex (`/^qwen3\.8/`, `/^nemotron/`) could auto-move project threads onto a Nemotron-backed `computer` alias. **Thinking is never disabled anywhere** (no `enable_thinking` / `chat_template_kwargs` / `reasoning_effort` in `shell/`). |
| Shared base: "keep Ollama for OCR and the tasks model" beside vLLM | Two traps | `litellm.js:64-72`; `up.js:96`; `perf.js:129-130` | The tasks alias is **not routed** while a non-Ollama engine serves. The farm itself churns Ollama's VRAM beside another engine: `keep_alive` 5m, plus pressure eviction. vLLM's startup profiler aborts when another process changes VRAM use mid-start, so templates must use `kv_cache_memory_bytes`, not `gpuMemoryUtilization`. |
| §11.3 RTX PRO 6000 templates under managed vLLM | Not runnable as planned | `nvidia-smi` on `AN-A6000PRO` | The only RTX PRO 6000 is a Windows box, and §2.2 makes vLLM Linux-only. |
| §11.4 llama.cpp alternative (`parallel` 12, 262k, mmproj, `mtp`) | CONFIRMED (keys exist) | `config.js:155-271`; `llamacpp.js:208` | `parallel` 12 is under the panel cap of 16. |
| Templates cover Spark / RTX PRO 6000 / A6000 | Incomplete | studio fleet notes (2026-08-26) | The fleet is mostly **RTX 4070 (12 GB) and 4080 (16 GB)** boxes, plus one or two Sparks, the PRO 6000 and a few 5090/4090/3090/A6000. The common box has no template. |

## 4. Other "today the code does X" statements (§0, §4–§10, §13)

| Plan statement | Verdict | Evidence | Note |
| --- | --- | --- | --- |
| Header: "Open WebUI 0.10.2" | WRONG (stale) | `sidecar/OPENWEBUI_VERSION:1` = 0.11.4 (since 2026-09-27); `shell/package.json:3` = 0.2.7 | The **field** still runs older engines: this box's installed sidecar is 0.10.2, dev `sidecar/.venv` is 0.10.1 — engine updates are a person's click (`sidecarManager.ts:1-10`). New env vars must degrade on old sidecars (e.g. `TASK_MODEL_PARAMS` is 0.11-only). |
| §0.2 / §13: "OWUI touched via env vars and its **admin** REST API … use the admin REST API (allowed by the prime directive)" | WRONG | `CLAUDE.md:337` "The admin API is never used"; `CLAUDE.md:390-391` | With `ENABLE_PERSISTENT_CONFIG=false` admin writes are memory-only and vanish on every sidecar restart. Real REST touches: user-settings writes (`renderer/app.js:533,584,619`), reads of `/api/config` and `/api/v1/auths/`. |
| §0.3: "tests added to `npm test`" | PARTLY | `farm/package.json` → `test/run.js` (unit suite); `shell/package.json:13` `"test": "node test/e2e.js"` | Farm: right place. Shell: `npm test` is the legacy e2e that drives the real app — unsafe on this box (live client + single-instance lock). Shell tests belong in `test:unit`, `test/chat-unit.js`, `chat-lint.js`, `chat-scope.js`. |
| §1.1: token passed via "the env vars it already writes (`OPENAI_API_KEYS`)" | WRONG (name) | `configBridge.ts:257-259` writes singular `OPENAI_API_KEY` (farm password or `sk-lol-lan`) | OWUI reads `OPENAI_API_KEYS` as a `;` list falling back to the singular (OWUI `config.py:335-347`). Any key change restarts OWUI (~10 s): `sidecar.ts:161,170-182`. |
| §1.1: "HMAC key made per farm run, like plugin keys" | WRONG premise, and a trap | Plugin keys = `randomBytes(24)` per plugin **start** (`plugins/registry.js:73,115,133`) | The per-run OCR key already rides into OWUI's env (`configBridge.ts:313`), so **every farm restart or OCR toggle already reboots every connected client's OWUI** (`sidecar.ts:170-182`) — a latent bug. A per-run token secret would add a second one. Persist the secret (as `farm/src/identity.js` does for the farm id). |
| §1.2: "shell polls `/lol/queue` during a pending request" | WRONG premise | No `webRequest` hook anywhere; `index.ts:601-609` only sets permission handlers on `persist:owui` | The shell cannot see OWUI's requests today. It would need a new main-process observer on the `persist:owui` session. LOL Vibe already has its own seat-wait row (see §5). |
| §1.3: "abort the upstream fetch on client socket close" | ALREADY IMPLEMENTED (at the gate) | `farm/src/seats.js:136-142` | Unverified: whether **LiteLLM** passes the cancel on to llama-server/Ollama. LiteLLM is unpinned (`commands/install.js:166`). §1.3 becomes "verify, pin LiteLLM". The "drop a seat after 30 s without pings" half is new: presence and seats are not linked. |
| §1.4: task-model env names | PARTLY | OWUI `config.py:2180-2190,2295-2333`; `utils/task.py:16-27` | For an OpenAI connection the var is **`TASK_MODEL_EXTERNAL`** (`routers/openai.py:732`). The model must be in OWUI's model list, so `assistant-tasks` shows in every person's picker, and if missing OWUI silently uses the chat model (`task.py:18`). Half of 1.4 is already done (see §2). |
| §1.5: subtract plugins from auto context | Contradicts a recorded decision | `farm/src/admin/index.html:347-350` (audit 2026-08-26); `docs/ECOSYSTEM_PLAN.md:80-82` (2026-09-27) | |
| §2: "reuse the external routing path" | CONFIRMED feasible | `litellm.js:195-212` | Phase 2 reverses the **2026-09-07 owner decision** that the farm never manages the external server (`docs/DEVLOG.md:3603-3606`) — needs sign-off. |
| §2.1: "a `library` list mirrors `llamacpp.library`" | CONFIRMED (it exists) | `config.js:188-241` | |
| §2.2: `farm/.models/hf/`, `$LOL_PYTHON`, progress | PARTLY | `.models` is flat (`ollama.js:340`); `python.js:28` `LOL_PYTHON`; job progress `up.js:1883-1891` | |
| §2.2: "Windows: vLLM unavailable" | Correct as stated, but defeats §11.3 | `nvidia-smi` on `AN-A6000PRO`: RTX PRO 6000 Blackwell 96 GB, **Windows 11** | The studio's only RTX PRO 6000 is a Windows box. vLLM has run there **in WSL2** (2026-09-24 notes) with two hazards: its startup profiler aborts if another process (Ollama) changes VRAM use mid-start — use `kv_cache_memory_bytes`, not `gpu_memory_utilization` — and killing `wsl.exe` leaves the Linux processes alive. |
| §2.3: "`lol up` step 5" | WRONG | `up.js:953` step 5 = discovery | Engine start is step 2b (`up.js:838`); external probe is 0c-bis (`up.js:427`). |
| §2.5: "the existing card and its two warnings" | WRONG | `admin/index.html:343-354` | 4 warnings, all llama.cpp-only. |
| §3.3: existing "counts and refusals only" logging rule | PARTLY | `bus.js:21`; `pysvc/classify_server.py:12` | Not farm-wide: OCR logs the **filename** (`pysvc/server.py:334`). |
| §4.1: `farm/.models/` + Ollama blobs | PARTLY | | Ollama blobs live in Ollama's own store; the farm never reads `OLLAMA_MODELS`. |
| §4.1.4: later Hyperswarm/Hypercore "with relays" | Conflicts with an owner rule | owner rule 2026-09-16 "local only, never cloud" | Blind relays through NAT are internet infrastructure. |
| §4.2: venvs `farm/.extract`, `.stt`, `.classify` | CONFIRMED | `extract.js:27`, `stt.js:24`, `classify.js:23` | Also `.searxng`, `.kokoro`, `.venv`. |
| §4.2 spike: "confirm QVAC addons run under Node ≥ 20 or as a sidecar" | ALREADY ANSWERED | measured 2026-09-10 (Rtranslate comparison) | Not a Node library: inference runs in a **Bare** worker over `bare-rpc` (a JS sidecar). `npm install @qvac/sdk` = 4.8 GB (win32-x64 slice ~805 MB); on Windows it uses **Vulkan, never CUDA**. |
| §4.3: second OWUI connection via env | CONFIRMED feasible | OWUI `config.py:335-359` | `OPENAI_API_CONFIGS` **is** parsed from env in 0.11.4 (and 0.10.2) — CLAUDE.md gotcha #2 is outdated. |
| §5.5: "today's Ollama context probe cache" | CONFIRMED | `up.js:591-594` → `farm/.models/ollama-ctx.json`, key `model|vramGb|numParallel|kvCacheType` | |
| §10: Clients card; deny list; TLS env | PARTLY | `admin/index.html:487-533` (no revoke button, no deny list) | TLS: `AIOHTTP_CLIENT_SESSION_SSL` (True/False/CA path) and `AIOHTTP_CLIENT_SSL_CERT_FILE` (**replaces** the trust store) in OWUI `env.py:556-631`. The OCR loader is plain `requests` → needs `REQUESTS_CA_BUNDLE`. No fingerprint pinning exists. The cert's SAN must cover DHCP-assigned IPs. |
| §13: "queue waits may hit OWUI's HTTP timeouts" | PARTLY | OWUI `env.py:608-625` (`AIOHTTP_CLIENT_TIMEOUT` unset → no total timeout), `:656-663` (model list 10 s) | Chat and title calls have no timeout by default. The real risk is the **10 s `/models` fetch**, which a queue must never hold. |
| §12 acceptance: "zero 429s at `--users 50`" | Would pass trivially today | `commands/bench.js:86,106` | Bench sends every "user" from one IP = **one seat**. It must emulate distinct identities before any acceptance number means anything. |

## 5. What LOL Vibe and the Computer actually are, and how they call the farm

**LOL Vibe** (called "LOL Chat" until 2026-09-27; the code still says `chat` / `lolchat`) is the client's
own chat surface. It talks to the farm **directly, never through OWUI**: a message tree, tok/s and TTFT per
reply, a context meter, sending that knows about seats, and history in IndexedDB under
`DATA_DIR/lol-client`. A plain thread has no tools, RAG or uploads.

**The IDE** is a mode of LOL Vibe. The Project panel binds a thread to a folder in
`DATA_DIR/LOL Studio Projects/`, and from then on that thread is answered by the **coding agent**:
DeepSeek Harness (dsh) 0.1.7-rc.2, which main runs on its own Node (`src/main/studio.ts`).
**Agent pages** are pages the coding agent writes; their own JavaScript runs a step loop against the farm
(`assets/agent-page/lol-agent.mjs`).

**The Computer** is a node-graph canvas of about 30 box types. Only Instruction (and its presets), Agent,
and Condition/Filter in model mode call the LLM. Classify, Listen, Speak and Document call farm
**plugins**. Receive/Trigger use the bus, and Send reaches devices directly from the client. A run is
serial and bounded by `RUN_LIMITS` (`core/types.mjs:551-556`: 8 passes per box, 50 generations,
10 min, 2000 activations).

| Caller | Endpoint · auth | Stream · max_tokens · structure | Model | In flight per client | Cancel · 429 handling |
| --- | --- | --- | --- | --- | --- |
| **Vibe chat** | `POST {openaiBaseUrl}/chat/completions` (`app/controller.mjs:605-613`) · `Bearer <farm password>` when set (`net/farm.mjs:114-118`) · no client id | Streaming + usage; no `max_tokens` by default; no tools; no thinking toggle | The thread's pick, else the farm default | **1** — one foreground slot shared with the Computer (`computer/boot.mjs:10-15`) | AbortController (`net/run.mjs:76-131`) · 429 `lol_seats_full` → a **seat-wait row** (`app/seat-wait.mjs`): resend when a snapshot shows `used < slots`, manual after 5 refusals, gives up after 15 min |
| **Coding agent (dsh)** | pi-ai `openai-completions` → `{endpoint}/v1` (`studio.ts:101-111`) · `Bearer $LOL_FARM_KEY` (password or `sk-lol-lan`, `studio.ts:107,221,435`) | Streaming; `max_completion_tokens` 4096–8192 by model (`projects/models.mjs:217-248`), **≥ 16384 with "Keep going"** (`studio.ts:489`); **OpenAI-native `tools`** (9 file tools, plus the Computer's MCP tools when "Use the Computer" is on) | The thread's model; `pickEditor` prefers `qwen3.8*` / `nemotron*` | Holds the foreground slot; steps run one after another. **But** the dsh base profile keeps a first-prompt title call (≤ 64 tokens) and `llm-retry` (5 retries on 429/5xx, 0.5–10 s backoff), and LOL's patch disables neither (`dsh-base/cordis.patch.yml:62-69,91-92` in the built runtime) | Stop kills the process tree (`studio.ts:519`) · retries 429 **by itself** and never reaches seat-wait |
| **Agent pages** | `GET /lol-farm.json` (address only, never the password) then `POST {baseUrl}/chat/completions` · `Bearer` from a password **the person types into the page** (`lol-agent.mjs:24-31`) | **Not streaming**; `maxTokens` default 2048; `response_format: json_object` + a text tool protocol | **First id in `/v1/models`**, not the farm default (`lol-agent.mjs:55`) | Ungoverned (the page may run calls in parallel) | Only if the page passes a signal · 429 throws "busy", no retry |
| **Computer LLM boxes** | `app.ask` → same caps and headers as Vibe (`app/ask.mjs:304-315`) | Streaming; ceilings 8192 text / **16384 code** / 4096 verdicts / 16384 per Agent step, clamped to the window (`graph/bind.mjs:74-131`); `json_schema` strict for list/json/verdict/agent asks, nothing for text/code | The box's Model setting, else the farm default | **Background lane: at most 1**, only while the foreground is idle **and** the snapshot shows `used < slots` (`net/governor.mjs:50-62,107`); a person's Send aborts it | Run signal → AbortController · a local "no free seat" yields the run; a gate 429 is a box **error** that costs a Cap generation (`graph/runner.mjs:570-576` excludes only `busy`/`aborted`/`no_farm`) |
| **Computer plugin boxes** | Classify `/classify` (≤ 200 items), Listen `/v1/audio/transcriptions`, Speak `/audio/speech`, Document `PUT /process`, bus WebSocket · plugin keys; Speak hard-codes `sk-lol-tts`; the bus puts the password in `?key=` | — | — | Serialised by the runner (OCR also runs at drop time) | 429/503 → `busy` → the run yields |
| **MCP server** (`127.0.0.1:41995`) | Called **by** OWUI and the coding agent · per-install bearer (`src/main/mcp.ts`) | JSON | — | Makes no farm call itself; `run_graph` runs in the page through the Computer's background lane | — |

**Context.** No caller asks for a context size: Vibe's meter, the Computer's budget and dsh all read the
farm's `backend.contextPerSlot`. Vibe clamps it to 1024–262144 (`net/farm.mjs:25-48`); **dsh does not
clamp it** (`studio.ts:110`). dsh compacts at floor(min(0.8W, W − O − 4096)). On a 16k slot with
"Keep going" (O = 16384) that is negative, so proactive compaction never runs.

**Where the plan's §5.2 profile numbers come from:** not from code. There is no 32k/128k/16k target,
no active-share figure and no TTFT goal for the Computer, whose calls are designed to wait or yield.
One person cannot have Vibe and the Computer generating at once (one governor). A dsh turn keeps its
client generating almost continuously.

**Every place a farm bearer is set today (the §1.1 change surface, OWUI aside):**
`renderer/chat/net/farm.mjs:114-118` (used by Vibe, Computer asks, `/models`, `/model_group/info`; fed
by `renderer/app.js:1012`), `net/bus.mjs:28-32` (`?key=`), `src/main/studio.ts:107,221,435` (dsh; a
changed key restarts the runtime, `:492`), `assets/agent-page/lol-agent.mjs:24-31` (person-typed), the
plugin bearers (`net/classify.mjs:56`, `net/stt.mjs:122`, `net/extract.mjs:79`, `net/tts.mjs:174`),
and main's checks (`src/main/index.ts:314,343,935`). **Nothing sends a client identity today**: no
header, no `user` field.

## 6. Proposed corrections to the plan

### 6.1 Fix the facts (text edits, no design change)

1. Header: OWUI **0.11.4** is the pin. Say the field runs older sidecars (engine updates are a person's
   click), so new env vars must degrade on 0.10.x.
2. §0.2 / §13: drop "use the admin REST API". It is never used: with `ENABLE_PERSISTENT_CONFIG=false`
   its writes vanish at every restart. The only REST writes are OWUI's user-settings API.
3. §0.3: farm tests go in `farm/test/run.js` (`npm test`). Shell tests go in `test:unit`,
   `test/chat-unit.js`, `chat-lint.js` or `chat-scope.js`, **never** `npm test` (the legacy e2e is
   unsafe on the dev box).
4. §1 Topology / Use cases: three surfaces (OWUI · LOL Vibe · Computer). The coding agent is the IDE mode
   of project-bound Vibe threads. Replace the Vibe/Computer descriptions with §5 of this audit.
5. §1: first run is **~18 GB / 20–30 min**. `capacity` also has `seatIdleSec`, `busy` and `queued`. The
   Performance card has 4 warnings and is llama.cpp-only. Bench reports median per-user tok/s, saves
   nothing and runs from **one IP**.
6. §1 / §3 OCR: on the default Ollama engine the OCR model **is** the chat model. The extra 7.6 GB tenant
   exists only while llama.cpp, external or vLLM serves.
7. §2.3 "step 5" → step 2b (`up.js:838`). §2.5 "two warnings" → four. §4.1: Ollama blobs live in
   Ollama's own store.
8. §11: mark **every** not-yet-existing key, and warn that the config schema is strict. Pasting a
   template today stops `lol up` from booting.

### 6.2 Phase 1 — re-scope around what already exists

- **New "1.0 Gate hardening" (first, small, no policy change):**
  - (a) Check the farm password in the gate **before** `admit()`, so keyless POSTs can't hold seats.
  - (b) Cap in-flight requests per seat.
  - (c) Gate the other generation paths (`/v1/responses`, `/v1/messages`, …) or refuse them.
  - (d) Align `Retry-After` with the message.
  - (e) **Persist** plugin keys (or derive them stably). Today every farm restart reboots every client's
    OWUI through the OCR key (`registry.js:73` → `configBridge.ts:313` → `sidecar.ts:170-182`).
  - (f) Give OCR the one-job + 429 cap Classify and STT already have (ECOSYSTEM_PLAN §2.3.1, unbuilt),
    and stop logging filenames.
- **1.3 → "verify and pin".** The gate already cancels upstream on disconnect (`seats.js:136-142`).
  What's left: prove LiteLLM passes the cancel on to llama-server/Ollama, and **pin LiteLLM**
  (`install.js:166` installs it unpinned). Linking presence to seats ("drop after 30 s without pings")
  stays as new work.
- **1.4 → "the remaining half".** Follow-ups, tags, autocomplete and retrieval-query are already off. What
  remains is **search-query generation on every message** (web search is seeded `always`) and **one title
  per chat**. `TASK_MODEL_EXTERNAL` has two costs: it exposes `assistant-tasks` in every picker, and it
  isn't served at all while a non-Ollama engine serves (`litellm.js:64-72`). Alternative that stays
  inside env: `OPENAI_API_CONFIGS` headers with `{{TASK}}` (OWUI `utils/headers.py:135-150`, read from env
  per `config.py:349-359`). The gate can then give background tasks a low-priority lane, or rewrite their
  model, with nothing visible in the picker. Not yet tested on a rig.
- **1.1 → identity first, tokens only if revocation is wanted.**
  - Per-install identity can ride a **header**: `X-LOL-Client: <installId>`, set from env via
    `OPENAI_API_CONFIGS` for OWUI, and in `net/farm.mjs` and the dsh profile for the rest. The farm
    password stays `OPENAI_API_KEY`.
  - That avoids OWUI restarts, avoids rewriting `Authorization` on `/v1/models` and `/model_group/info`,
    and avoids touching every caller's auth.
  - If revocation (§10) is wanted, tokens need a **persisted** secret, not a per-run one, and must reach
    all five bearer sites in §5, not just OWUI.
  - Agent pages stay password-typed (`/lol-farm.json` must stay credential-free).
  - Correct the motivation: the office LAN is NAT-free by design (`seats.js:24-25`), and an install id
    does **not** merge a two-device person into one seat. What it fixes is several OS users on one lab PC.
    `clientId` is per OS user in userData, so cloned lab images share it; regenerate on first run per
    machine.
- **1.2 → policy change, owner's call** (see §7). Corrections if approved:
  - The shell **cannot see OWUI's requests**. Show the farm's queue depth from the snapshot in the pill,
    or add a main-process observer on the `persist:owui` session.
  - Adapt Vibe's existing seat-wait to the queue.
  - Queued requests must survive the LiteLLM restarts that panel actions cause (`up.js:1369-1396`).
  - Keep the 10 s OWUI `/models` fetch ungated.
- **Client fixes the queue depends on (from code reading; rig-check first):**
  - The Computer's `freeSeat()` counts this client's **own** seat as taken (`governor.mjs:50-62`).
  - A gate 429 costs a Computer Cap generation (`runner.mjs:570-576`).
  - dsh's own title call and 429 self-retries bypass seat etiquette.
- **Bench before acceptance:** `lol bench` must simulate distinct identities. Today it is one seat, so
  every "zero 429s at 50 users" test would pass trivially.
- **1.5 → reconcile with the 2026-08-26 decision** not to reserve OCR room (`admin/index.html:347-350`).
  It only matters on non-Ollama engines.

### 6.3 Phase 2 — managed vLLM

- It **reverses the 2026-09-07 owner decision** that the farm never manages an external server
  (`docs/DEVLOG.md:3603-3606`). Needs sign-off before any code.
- The studio's RTX PRO 6000 is a **Windows** box. Either add a WSL2 path, with the 2026-09-24 hazards
  (stdin-EOF self-kill, since killing `wsl.exe` leaves vLLM alive), or say §11.3 is external-only there.
- Size vLLM with **`kv_cache_memory_bytes`**, never `gpuMemoryUtilization`, whenever Ollama shares the
  GPU. That is always the case here: OCR, plus the farm's own `keep_alive` 5m and pressure eviction.
  vLLM's startup profiler aborts on any VRAM change mid-start.
- Raise the panel's slot cap of 16 (`up.js:2416`) per engine. Generalize the Performance card and
  `capacity.busy/queued` beyond llama.cpp. The schema needs the `vllm` block and a new engine enum. The
  HF-config twin of `gguf.js` must count attention layers only.

### 6.4 Phase 3

- 3.1: llama-server **already has per-box slot affinity** (`--slot-prompt-similarity`, `--cache-reuse`,
  `--cache-ram`). Cross-box affinity needs the coordinator fixed first: it discovers peers once at boot,
  skips passworded peers, and counts only its local slots as seats (`up.js:334-365,1001`). OWUI's
  `{{CHAT_ID}}` header is a better affinity key than the install id. Preserve the 2026-09-04 decision
  to keep LiteLLM least-busy.
- 3.3: the "no content in logs" rule is not farm-wide yet (OCR logs filenames). Fix that before adding
  `/metrics`.

### 6.5 Phase 4 — mostly drop or reframe

- **4.1** HTTP copy on the LAN is fine. **Drop step 4** (Hyperswarm with relays): it conflicts with the
  owner's "local only, never cloud" rule (2026-09-16).
- **4.2** The spike is **already answered** (2026-09-10). QVAC is a **Bare** sidecar, not Node; a
  4.8 GB npm install with an ~805 MB Windows slice; **Vulkan-only on Windows**. That's not lighter than
  the ~1 GB of Python venvs. Reframe as whisper.cpp / ONNX directly, or drop.
- **4.3** On-device fallback contradicts CLAUDE.md: "inference must go to the farm, not the laptop."
  Owner's call; I recommend cutting it.
- **4.4** The farm is plain CommonJS and the renderer is no-build ES modules, so "generate TypeScript
  types for farm/" doesn't fit. By the ponytail ladder, the minimum is JSON Schemas plus one farm unit
  test that validates a live `buildSnapshot()` against them.

### 6.6 §11 / Phase 5

- Rewrite the use-case profiles from §5. Computer load is **long, thinking-heavy, one-in-flight
  background calls**, and its biggest lever is turning thinking off. No caller does that today. The
  client could send it per box, or a `computer` alias could inject **only** `enable_thinking:false`, never
  a JSON schema or a low `max_tokens`.
- Coding-agent sizing must cover `O + 4096 + prompt` per request: O ≥ 16384 with "Keep going", so a 16k
  slot can't run "Keep going" with compaction. Clamp dsh's window like Vibe's.
- Add templates for the boxes the fleet actually has (12 GB 4070 and 16 GB 4080 on Windows, plus the
  Windows RTX PRO 6000). Seed the planner from the farm's own measurements (`perf.js:89`,
  `farm/.models/ollama-ctx.json`).

### 6.7 Latent bugs found on the way (worth fixing whatever happens to the plan)

| # | Bug | Evidence | Confidence |
| --- | --- | --- | --- |
| 1 | Every farm restart / OCR toggle reboots every connected client's OWUI (per-start OCR key in the env) | `plugins/registry.js:73`, `configBridge.ts:313`, `sidecar.ts:170-182` | Verified in code |
| 2 | A keyless POST claims a seat for 15 min on a passworded farm | `seats.js:97-99,121` | Verified in code |
| 3 | `Retry-After: 30` vs "~15 min" in the same 429 | `seats.js:101-104` | Verified |
| 4 | Computer background lane treats the client's own seat as taken | `net/governor.mjs:50-62` + `farm/src/snapshot.js:302` | Code reading; rig-check |
| 5 | A gate 429 costs a Computer Cap generation | `graph/runner.mjs:570-576` | Code reading |
| 6 | dsh title call + 429 self-retry not disabled by LOL's patch | built `dsh-base/cordis.patch.yml:62-69,91-92` | Code reading |
| 7 | "Keep going" on a ≤ 16k slot disables dsh's proactive compaction; dsh's window is unclamped | `studio.ts:110,489` | Arithmetic from code |
| 8 | OCR: no concurrency cap; logs filenames | `pysvc/server.py:320-334` | Verified by agent |
| 9 | Agent pages default to the first listed model, not the farm default | `lol-agent.mjs:55` | Verified by agent |
| 10 | CLAUDE.md gotcha #2 is outdated (`OPENAI_API_CONFIGS` **is** parsed from env in 0.10.2 and 0.11.4); stale "pinned 0.10.2" comments | OWUI `config.py:349-359`; `configBridge.ts:61,212,303` | Verified |

## 7. Questions for the owner

1. **Queue vs 429.** On 2026-09-04 you chose an explicit 429 over "silently queueing behind idlers". The
   plan's queue waits behind **active** people only, with idle seats freed in ~20 s. Adopt it, keep 429,
   or make it a per-farm option?
2. **Managed vLLM** reverses the 2026-09-07 "the farm never manages the external server". Approve? And
   on the Windows RTX PRO 6000: WSL2, or external-only?
3. **Identity:** a header (no OWUI restarts, no revocation) or signed tokens (revocation, a persisted
   secret, every caller changes)?
4. **Search-query generation** runs on every message. Turn it off, move it to a small model, or give it a
   low-priority lane?
5. **§1.5 vs the 2026-08-26 decision** not to reserve OCR room. Reverse it for non-Ollama engines?
6. **Phase 4.3** (on-device inference) contradicts "inference goes to the farm, not the laptop", and
   **4.2's QVAC** premise is already measured negative. Cut both?
7. **Target box.** Which machine is the multi-user target first: the Spark, the Windows RTX PRO 6000,
   or a fleet of 4080s behind a coordinator?
