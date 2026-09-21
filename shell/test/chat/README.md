# LOL Chat tests

Everything under `shell/test/chat/`, `shell/test/mock/` and `shell/test/chat-harness/` exists to
test **LOL Chat vNext** (the Desk) without touching Open WebUI, the live farm, or the owner's real
client. Plan: `docs/LOLCHAT_PLAN.md` §2 (harness), §2.3 (this mock), §2.6 (the P0 freeze).

---

## 0. Read this before you run anything

**This box runs a production farm and the owner's real LlmOnLan client.**

1. **Never bind 4000, 4001, 41997, 41998, 8081, 8888, 8890, 11434.** `mock/index.js` refuses them on
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
3. **Never run `electron .` in `shell/`.** It shares the owner's LOL Chat storage and fights the
   single-instance lock. The harness runs its own Electron main against a throwaway `--user-data-dir`.
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
# unit tests (dependency-free, Node >= 22) — the mock's own tests are "mock"
node shell/test/chat-unit.js                 # every shell/test/chat/unit/*.test.mjs
node shell/test/chat-unit.js mock md         # only files whose name contains "mock" or "md"
node shell/test/unit.js                      # the existing app.js tests, must stay green

# gates (P0-U2)
node shell/test/chat-lint.js                 # static safety rules (§2.4)
node shell/test/chat-scope.js                # the change set stays inside the LOL Chat scope (§2.5)

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
| `GET /model_group/info` | `{data:[{model_group, supports_vision}, …]}` — `gemma4:12b` and `mock-echo` are vision, `assistant` is not |
| `POST /v1/chat/completions` | the model behaviours below |
| `GET /health/liveliness` | `{status:'healthy'}` |
| `POST /v1/embeddings` | **418** — the client must never embed on the farm; an accidental call is loud instead of silent |
| anything else | 404 with a JSON error |

- The **keyed** listener answers a missing or wrong key with LiteLLM's real shape: **400**
  `{"error":{"message":"Authentication Error, Invalid proxy server token passed…","type":"auth_error","code":"400"}}`
  (a 400, not a 401 — that is what the client must learn to read).
- **Seat simulation.** When `state.capacity.seatsUsed >= state.capacity.slots`, *every* completion POST
  gets **429**, `retry-after: 30` and the farm's own sentence — `mock/seats-body.js` is a verbatim copy
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
