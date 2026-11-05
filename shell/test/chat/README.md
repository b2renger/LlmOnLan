# LOL Vibe and Computer tests (the code keeps the name LOL Chat)

Everything under `shell/test/chat/`, `shell/test/mock/` and `shell/test/chat-harness/` exists to
test **LOL Vibe** (named LOL Chat until 2026-09-27; the Desk) and **the Computer** without touching Open WebUI, the
live farm, or the owner's real client. Plan: `docs/archive/plans/LOLCHAT_PLAN.md` §2 (harness), §2.3 (this mock),
§2.6 (the P0 freeze).

---

## 0. Read this before you run anything

**This box runs a production farm and the owner's real LlmOnLan client.**

1. **Never bind a port the farm or the client uses:** 4000, 4001, 41997, 41998, 8081, 8888, 8890, 11434 (the
   seat gate, LiteLLM, the panel, the beacon, llama-server, SearXNG, OCR, Ollama); 8100, 8880, 8891, 8892, 8893,
   8894, 1883, 9001 (vLLM, Kokoro, Classify, speech to text, the bus's WebSocket, document search, MQTT, the bus's
   OSC over UDP); and 41995 (the client's own MCP server). `mock/index.js` refuses those in its `FORBIDDEN_PORTS` on
   the *computed* port, slot or no slot, and exits 1 from the CLI.
2. **Never set `LOL_MOCK_BEACON_OK=1` here.** The mock only creates a UDP socket when that variable
   is `1` *and* `--no-beacon` is absent. With a beacon it announces itself on `127.0.0.1:41998` — the
   port the real client listens on. The client prefers coordinators, so it would silently switch
   itself to "Mock Farm" and restart a colleague's Open WebUI. Without the variable the mock prints

   ```
   [mock] beacon disabled (set LOL_MOCK_BEACON_OK=1 only on a machine with no LlmOnLan client running)
   ```

   and serves HTTP exactly as before. `require('dgram')` itself only happens inside the enabled
   branch, so a run that must not beacon never even loads the module.
3. **Never run `electron .` (or `npm run dev`) in `shell/` on the real profile.** A dev run is the real client:
   `app.setName('LlmOnLan')` and no `userData` override, so it uses `%APPDATA%\LlmOnLan` — the owner's settings, his
   data folder (Open WebUI's chats; LOL Vibe's history and the Computer's graphs in `<data folder>\lol-client`), his
   Home Assistant link — and runs its first-launch migrations on them. And `app.requestSingleInstanceLock()` makes a
   second copy on the same `userData` quit at once: with the installed client open, the dev run just exits. The harness
   runs its own Electron main against a throwaway `--user-data-dir`.

   **To run the real client apart**, give it its own `userData`. It then has its own single-instance lock (it runs
   beside the installed client), its own settings and its own data folder (`<that folder>\owui-data`). Point it at a
   mock, never the live farm (rule 4): `LOL_ENDPOINT` pins Open WebUI to the mock, and discovery is then informational
   only — the live farm may still show on the cards, so never pick it.

   ```powershell
   node shell/test/mock-farm.js --slot 1                # in another terminal: the mock's proxy on 4029
   npm --prefix shell run build                         # a stale build/ runs old main code
   $env:LOL_ENDPOINT = 'http://127.0.0.1:4029/v1'
   Remove-Item Env:ELECTRON_RUN_AS_NODE -EA SilentlyContinue   # when set, Electron runs as plain Node and exits
   cd shell; npx electron . --user-data-dir="$env:TEMP\lol-dev-profile"   # a fresh profile: nothing to migrate
   ```

   A dev run starts Open WebUI from the repo's `sidecar/.venv` (or `LOL_SIDECAR_CMD`), never from `userData/sidecar`,
   so there is nothing to download or link; that venv's Open WebUI can lag the pin (`sidecar/README.md` says how to
   make it at the pin). Delete the profile folder afterwards.
4. **Never send completions to the live farm.** Every one takes a real colleague's seat. The mock is
   the only endpoint a test may talk to.
5. **Parallel builders share this machine — use your assigned slot** (§1 below) and nothing else. If a
   port you need is busy, stop and report it; never kill a process you did not start.

---

## 1. Ports and slots

A **slot** offsets every port by `20 × n` (plan §2.6 A), so several builders can run a mock and a
harness at once:

| Role | slot 0 | slot n | flag |
|---|---|---|---|
| CDP (harness) | 9333 | `9333 + 20n` | `--slot` on `chat-harness/run.js` |
| mock proxy (open) | 4009 | `4009 + 20n` | `--port` |
| mock proxy (keyed) | 4010 | `4010 + 20n` | `--keyed-port` (+ `--key`) |
| mock services / control | 4011 | `4011 + 20n` | `--services-port` |
| mock `/lol/self` | 41987 | `41987 + 20n` | `--http-port` |

`41987`, not the live farm's `41997` (DISCUSS D-M1).

**A slot moves the DEFAULTS only.** An explicitly-passed `--port` is used exactly as given, so
`--slot 1` and `--port 4029 --slot 1` mean the same thing and can never double-offset. The landing
integrator uses slot 0.

---

## 2. Commands

```bash
# unit tests (Node >= 22) — the mock's own tests are "mock". Fourteen suites test the compiled main process
# (build/main): run `npm --prefix shell run build` first (farm-contract also needs `npm ci` in farm/)
node shell/test/chat-unit.js                 # every shell/test/chat/unit/*.test.mjs
node shell/test/chat-unit.js mock md         # only files whose name contains "mock" or "md"
node shell/test/unit.js                      # the existing app.js tests, must stay green

# gates (P0-U2)
node shell/test/chat-lint.js                 # static safety rules (§2.4)
node shell/test/chat-scope.js                # LOL Chat vNext's phase gate (§2.5, 2026-09): flags any change outside that
                                             # phase's allowlist (the farm, CLAUDE.md, most of main); no longer a gate

# the chat-only Electron harness (P0-U2) — always with YOUR slot
node shell/test/chat-harness/run.js --slot 1
node shell/test/chat-harness/run.js --slot 1 --phase h0

# the mock alone (it never beacons)
node shell/test/mock-farm.js --slot 1
node shell/test/mock-farm.js --port 4009 --keyed-port 4010 --key harness-pw \
     --services-port 4011 --http-port 41987
```

CLI flags: `--slot n` · `--port` · `--keyed-port` · `--key` · `--services-port` · `--http-port` ·
`--beacon-port` (default 41998) · `--beacon-host` · `--no-beacon` · `--coordinator` (snapshot flag
only) · `--quiet` · `--help`.

In-process, for unit tests — ephemeral ports, nothing to clean up:

```js
import { startMock } from '../../mock/index.js';
const mock = await startMock({ port: 0, keyedPort: 0, key: 'pw', servicesPort: 0, httpPort: 0, quiet: true });
mock.ports;   // { proxy, keyed, services, http } — the real, bound numbers
mock.urls;    // { proxy, keyed, services, self }
mock.store;   // .state (live), .log (live), .merge(patch), .reset()
await mock.close();     // destroys open sockets first, so an SSE stream cannot hang the close
```

---

## 3. What the mock serves

### Proxy (`--port`, and `--keyed-port` with `Authorization: Bearer <key>`)

| Route | Answer |
|---|---|
| `GET /v1/models` | every scenario model id |
| `GET /model_group/info` (and `/v1/model_group/info`) | `{data:[{model_group, supports_vision}, …]}` — `gemma4:12b`, `mock-echo`, `mock-vision-echo`, `mock-headings` and `mock-reads-pdf` are vision, `assistant` is not; `mock-hears` adds `supports_audio_input`, `mock-reads-pdf` `supports_pdf_input`, and `mock-nocaps` has no `supports_*` field at all. `state.modelGroupInfo` replaces the whole body |
| `POST /v1/chat/completions` | the model behaviours below |
| `GET /health/liveliness` | `{status:'healthy'}` |
| `POST /v1/embeddings` | **418** — the client never embeds through the chat endpoint (the farm's document search has its own address and key, `embed.url`); an accidental call is loud instead of silent |
| anything else | 404 with a JSON error |

- The **keyed** listener answers a missing or wrong key with LiteLLM's real shape: **400**
  `{"error":{"message":"Authentication Error, Invalid proxy server token passed…","type":"auth_error","code":"400"}}`
  (a 400, not a 401 — that is what the client must learn to read).
- **Seat simulation.** When `state.capacity.seatsUsed >= state.capacity.slots`, *every* completion POST
  gets **429**, `retry-after` = the idle window (as the farm sends when every seat is generating) and the farm's own sentence — `mock/seats-body.js` is a verbatim copy
  of `farm/src/seats.js` and `mock.test.mjs` re-reads that farm file and fails if the wording drifts.
- **`state.proxyDown: true`** destroys incoming sockets on both listeners (what a killed LiteLLM looks
  like to `fetch`: a `TypeError`, not an HTTP status).
- **Usage chunk:** `prompt_tokens = ceil(JSON.stringify(body.messages).length / 3)` — deterministic and
  deliberately *not* 3.6, so the client's token estimator is calibrated against something it cannot
  accidentally match.
- **Pacing:** 5 deltas per 15 ms tick ≈ 330 deltas/s, above the real farm's 154.8 tok/s.
  `POST /mock/state {"streamRate":{"tickMs":1,"perTick":50}}` speeds a slow test up.

### Scenario models

| Model | Behaviour |
|---|---|
| `assistant`, `gemma4:12b` | 100 `reasoning_content` deltas (`think0 …`), 1000 content deltas (`tok0 …`), then a usage chunk carrying `finish_reason:'stop'`, then `[DONE]`. |
| `mock-echo` | Streams a summary of the request as `key: value` lines (see below). `GET /mock/last-body` returns the raw body. |
| `mock-md` | `fixtures/md/stream.md` in seeded random 1–12-char chunks. |
| `mock-xss` | `fixtures/md/xss-corpus.md`, same chunking. |
| `mock-perf:<name>` | `fixtures/md/perf/<name>.md` in 3–6-char chunks. Names: `mixed`, `list-500`, `table-300`, `paragraph-20k`, `nested-fence`, `reasoning-40k` (that one streams the fixture as **reasoning**, then a short answer). |
| `mock-think-tags` | `<think>…</think>` inside `content`, with both tags split across chunk boundaries. |
| `mock-429` / `mock-502` | The seat-gate 429 body / the `lol_upstream_down` 502 body. |
| `mock-context-overflow` | 400 with a LiteLLM `ContextWindowExceededError` body. |
| `mock-midstream-error` | 50 deltas, then `data: {"error":{"message":"upstream exploded",…}}`, then close — **no** `[DONE]`. |
| `mock-reset` | 50 deltas, then `socket.destroy()`. |
| `mock-length` | 200 tokens then `finish_reason:"length"`. A trailing assistant ending in `tokN` continues at `tok{N+1}`; a trailing assistant ending in anything else continues with `<lastWord>-continued `. |
| `mock-restart-on-prefill` | Ignores a trailing assistant and starts over with `Hello! …`. A trailing **user** turn containing `Continue exactly where you stopped` continues properly, starting `(continuing) tok{N+1} `. |
| `mock-slow` | 3 s TTFT, then 20 tok/s for 60 s. |
| `mock-usage-none` | 100 content deltas and `[DONE]`, **no** usage chunk. |
| `mock-vision-refuse` | (P3) 400 `this model does not support image input` when any `image_url` part is present. `state.visionRefuseAll` applies that to every model. |
| `mock-voice` | (Converse, k27) three short French sentences, one every `state.voiceChunkMs` (default 400 ms); the log entry gets `streamEndedAt` when the last is sent. |
| `mock-studio-json` | (S0, the ask spine) JSON for the schema it was sent, in 7-character chunks: with a `json_schema` `response_format` the body IS the instance; without one, a sentence and a ```` ```json ```` fence (the shape is read from the prompt too). |
| `mock-json-empty` | Empty content and empty reasoning, only a usage chunk (after `state.askDelayMs` when set): the "never a silent empty result" path. |
| `mock-json-reasoning-only` | The JSON arrives only as `reasoning_content`; content stays empty. |
| `mock-vision-echo` | What arrived, as `images: N`, `mimes: …`, `bytes: …`, `detail: …` lines (a vision model). |
| `mock-item` | `item: <the item>` — the first line under the first `## ` heading of the last user message, else its last line: 40 distinct generations can be told apart. |
| `mock-headings` | The last user message's markdown headings in order (`heading: ## …`), then `images:`, `systemChars:`, `promptChars:` lines (keys added at the end, never renamed). A vision model. |
| `mock-verdict` | `{"verdict": …}` from `state.verdicts`, consumed in order, the last one repeating (default `['maybe']`). |
| `mock-agent` | For a prompt saying *step k of …*, `state.agentSteps[k-1]` as JSON (the last repeats; none scripted: an `answer` step). |
| `mock-code` | A sentence, then ONE fenced block of the kind asked (svg / p5 / three / html: the system message's *You write ONE …*, else the first named in the prompt; none → svg). `state.codeReply` replaces the whole answer. |
| `mock-hears`, `mock-reads-pdf`, `mock-nocaps` | Answer like `mock-echo`; only their `/model_group/info` rows differ (audio input; PDF input and vision; no `supports_*` field). |
| `mock-think-length` | 60 `reasoning_content` deltas only, then `finish_reason:"length"` and a usage of the whole `max_tokens` (default 4096): a thinking model cut off before its answer. |

**`mock-echo` keys** — one per line, `key: value`, in this order. *Add keys at the end; never rename
one*, tests parse them:

`model` · `messageCount` · `roles` (comma-separated, in order) · `lastRole` · `partTypes` (every
content-part type across all messages, in order) · `imageCount` · `textLengths` (per message) ·
`systemText` (JSON-encoded, so it stays one line) · `paramKeys` (sorted; `messages`/`model`/`stream`/
`stream_options`/`response_format` excluded) · `params` (`k=<json>; …`) · `responseFormat` (JSON) ·
`stream` · `hasReasoningField` (any message carrying `reasoning` or `reasoning_content` — the client
must never send one) · `markerDocument` · `markerWebSearch` · `markerBlenderScene`.

### Services (`--services-port`; `/lol/self` also on `--http-port`)

| Route | Answer |
|---|---|
| `GET /lol/self` | the farm snapshot, built from the live `state` (name, id `mockfarm0001`, version, requiresKey, proxyPort, httpPort, models, backend, capacity, busy, perf, usage, host, healthy, searxngUrl/ttsUrl/extract, ts) |
| `GET /mock/health` | `{ok:true, beacon:false}` |
| `GET /mock/log?since=&path=&model=&role=` | a **bare JSON array** of log entries |
| `GET /mock/last-body` | the raw text of the last completion POST, verbatim (`null` if none) |
| `GET /mock/warnings` | the warnings the mock has printed (e.g. a missing fixture) |
| `POST /mock/reset` | clears the log and restores the default state |
| `GET`/`POST /mock/state` | read / deep-merge the mutable state |
| `POST /stt/v1/audio/transcriptions` | the farm's speech to text (Bearer `mock-stt-key`): *Mock transcript of <file> (<bytes> bytes).* |
| `POST /tts/v1/audio/speech` | the farm's voice: 0.3 s of silence, or (with `state.ttsMsPerChar`) a 220 Hz tone as long as the text; `input`, `voice`, `speed` kept on the log entry |
| `GET /tts/v1/audio/voices` | Kokoro's voice list shape: `{voices: [{id, name}]}` |
| `POST /classify/classify` | the farm's Laya by its own contract (Bearer `mock-classify-key`): `{answers:[{choice, confidence, probabilities}], ms, model}` — the first option named in an item at 0.9, else the last option at 0.4; the question asked is kept on the log entry |
| `GET /ocr/health` | `{status:'ok', model:'mock-ocr', docling:false}` |
| `PUT /ocr/process` | the farm's document extractor by its own contract (Bearer `mock-extract-key`, `X-Filename`, raw bytes): a JSON list of pages `{page_content, metadata:{page, source, engine}}`; the page count from `X-Mock-Pages`, `state.ocrPages`, a `pages-<N>.pdf` name, else the size |

The harness's **microphone** is Chromium's fake device playing `chat-harness/mic-fixture.js`'s WAV (1 s of silence,
1.5 s of a speech-like voice, 2 s of silence, looped; written into each run's userData, `LOL_HARNESS_MIC_WAV`), and its
**sound is muted** (`LOL_HARNESS_MUTE=1`, Chromium's `--mute-audio`): scenarios play and measure sound, nobody hears it.

A log entry is `{ts, role, method, path, query, headers:{authorization, content-type, x-filename},
body, model, status, closedEarly}`. `closedEarly:true` means the client walked away mid-stream — that
is how an abort is asserted. `/mock/*` control calls are deliberately **not** logged, so a scenario
never sees its own `h.mock.log()`.

---

## 4. How to add things

**A scenario model.** In `shell/test/mock/scenario-models.js`:
1. add the id to `STATIC_MODEL_IDS` (it then appears in `/v1/models` and `/model_group/info`; add it to
   `VISION_MODELS` if it should accept images);
2. add a branch to `handleCompletion()`. Use `streamContent(id, res, store, body, chunks, {finish})`
   for a plain stream, or `sse()` + `pace()` when you need reasoning, a mid-stream error or a reset;
3. a handler owns the response from `writeHead` to `end` and **must** stop its timers on
   `res.on('close')` — `pace()` already does, a bare `setTimeout` does not;
4. document it in the table above and cover it in `shell/test/chat/unit/mock.test.mjs`.

**A harness scenario** (files owned by P0-U2): add
`shell/test/chat-harness/scenarios/<phase>-<area>.mjs` with a default export of
`[{name, run(h), timeoutMs?, keepStorage?, allowConsoleErrors?, perf?}]`; `run.js --phase <phase>`
picks it up by the name prefix. Scenarios with `perf:true` run only under `--phase perf`.

**A unit test:** `shell/test/chat/unit/<area>.test.mjs`, default export `(test) => { test('…', fn) }`,
run with `node shell/test/chat-unit.js <area>`. Start any mock on **port 0**.

---

## 5. The legacy `e2e.js` flow (CI or a spare machine only)

`shell/test/e2e.js` drives the **real** app over CDP and needs real UDP discovery, so it is the one
flow that needs a beacon. It stays byte-identical and **must not run on the dev box**. On a machine
with **no** LlmOnLan client running:

```bash
cd shell
LOL_MOCK_BEACON_OK=1 node test/mock-farm.js --coordinator      # PowerShell: $env:LOL_MOCK_BEACON_OK='1'
LOL_ENDPOINT=http://127.0.0.1:4009/v1 npx electron . --remote-debugging-port=9222
node test/e2e.js
```

`--coordinator` only marks the snapshot, so the client deterministically prefers the mock over a real
farm on the same LAN. Two differences from the pre-vNext mock, both deliberate: the snapshot's
`httpPort` is now **41987** (D-M1), and the beacon is off unless the variable is set. **41987 is the
httpPort everywhere, CI included** — there is no escape hatch back to `41997`: it is on the forbidden
list, and `assertPortsAllowed` refuses it even when it is passed explicitly, on every machine. A
client that must reach the mock reads the port out of the snapshot.
