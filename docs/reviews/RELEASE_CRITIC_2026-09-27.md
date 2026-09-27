# Release critic — v0.2.0 + farm-v0.0.39 (2026-09-27)

**Verdict: SHIP AFTER FIXES.** Each fix is a few lines. The outputs and plugin-key items would bite on day one.

Scope: `41a508c..0f3d21a`, code first, then what a student reads.
- Tests: `chat-unit` 1658/0, `chat-lint` 0, `farm/test/run.js` 129, and `tsc` is clean.
- `farm/test/run.js` skips its Python check on this box, so I ran `check_services.py` with `sidecar/.venv`
  (Starlette 1.3.1): 16/16.
- Probes, run from the scratchpad: chunked uploads into both Python services, and the Send door through
  `build/main/outputs.js`.
- No farm port was contacted.

## Must fix before the tag

**R1 (high) — Outputs disarm when any iframe loads, while the run bar still says LIVE.** `shell/src/main/index.ts:465`.
`did-start-loading` is Chromium's "the frame tree started loading", and subframes count, so a reload is not the only
trigger. I read this from Chromium's behaviour and have not run it; confirm it on the rig. The sandbox iframe is
built lazily. It is torn down after a hide (a switch to Open WebUI), after a stall, or after dropped messages, and a
Live guest is a second iframe. Scenario: arm, then run a graph whose first Code or Preview box boots the sandbox. Main
disarms. The renderer's mirror (`runbar.mjs` `armed`) never learns this. Send boxes print "Dry run — would send" under
a bar reading **Outputs: LIVE**, and the lights never move. It fails safe, but the P3a demo is broken. `main.cjs` in the
harness does not mirror the hook, so k16 cannot see it.
Fix: `win.webContents.on('did-start-navigation', (d) => { if (d.isMainFrame && !d.isSameDocument) armOutputs(false); })`,
plus `render-process-gone` → `armOutputs(false)`. Also have `paintNow` re-read `door.armed()` after a run, so the label
can never outlive the truth.

**R2 (med) — Each cold launch against a farm with a password restarts Open WebUI (OCR on, the default).**
`index.ts:347` (`connectTo`), `index.ts:1052` (and `:898`), `farmSelect.ts:141-151`. The sidecar boots with the persisted
`lastFarmExtract`, which holds the key. On the first beacon, `onFarms` starts the key fetch. The same call then runs
`connectTo`, which finds no cached keys yet. `extract` becomes `null` → the env differs → OWUI restart #1, and `null` is
persisted. The fetch returns → `extract` has its key again → restart #2. This breaks the CLAUDE.md invariant "a cold
launch spawns the sidecar ONCE". The boot seed (`farmContext(activeNow, …)` without `withPluginKeys`) downgrades the
same way.
Fix: while a key fetch for this farm is in flight, or there is no cache entry yet, keep the current or persisted
`extract` when its `url` matches the snapshot's. Apply the same rule to the seed. Add one unit case: a pending fetch
must not change the context.

**R3 (med) — Cached plugin keys never refresh after a plugin or the farm restarts.** `farmSelect.ts:146-148`.
`makeCtx` (`registry.js:143`) mints a new key on every plugin start: a panel toggle, a farm restart, or a Farm-app
relaunch after this very update. The farm id is stable (`identity.js`), and the URLs and the password do not change.
So `sig` does not change, the entry stays "fresh" with non-empty keys, and `due` is false. Every open client then sends
the old key. Farm OCR, Classify and Listen answer 401 until the client restarts.
Fix (smallest): the farm advertises a non-secret `keyId` (the first 8 hex characters of sha256(key)) next to
`key: null`, and the client adds the `keyId`s to `sig`. A client-only fallback: also refetch a successful entry after
`retryAt`, at about 5 minutes.

**R4 (med, safety text) — The photosensitivity promise is not true.** `outputs.ts:130` (key), `outputs.ts:9-10`,
`docs/LOLCHAT_COMPUTER_TUTORIAL.md:388-389`, `examples/show.mjs:127`.
- The DMX cap is keyed by the **host string**. Two Send boxes on the same universe, one to the node's IP and one to the
  broadcast address (the tutorial's table offers both), sent 6 of 6 frames at 170 ms intervals. I ran this against
  `outputs.js`. That is ~6 frames/s, which is 3 Hz on/off.
- One frame can also switch on a fixture's own strobe channel.
- OSC, WebSocket and HTTP to an LED controller (the table's "an ESP32") allow 20 messages/s, which is 10 Hz.

"Nothing a graph sends may flash a light faster than that" is a safety sentence that students read.
Fix: key the cap as `artnet|${universe}` (every host shares one budget). Reword: "DMX frames at most 3 a second. This
does not limit a fixture's own strobe channel, or lights you drive over OSC, MQTT, WebSocket or HTTP. Keep strobes off."

**R5 (med) — A typed number or list reaches Send as text.** `graph/parts/send.mjs:132`. A Text box yields `text`, and
`toPlain` gives a string. Verified: a Text box holding `[255, 128, 0]` into DMX gives "DMX u0: all 0", a blackout.
`0.75` into OSC goes out as `,s` (a string), which TouchDesigner's OSC In CHOP ignores. The Send example builds exactly
this setup (`examples/show.mjs:130`, a Text box "0.75" → OSC), and its text says it "reaches TouchDesigner".
Fix, in `run()`: when the arrived value is text that parses as a JSON number, array or object, send the parsed value.

**R6 (low-med) — Panic disappears once outputs are disarmed; lights stay lit.** `runbar.mjs:562`
(`panicBtn.hidden = !hasSend || !armed`). The Panic button hides in three cases: after "press it again to go back to a
dry run", after a graph switch, and after a reload. The DMX a graph lit stays on, and the only blackout control is gone.
The person must re-arm (a dialog) to find Panic. Main's `panic()` works while disarmed.
Fix: `panicBtn.hidden = !hasSend;`.

**R7 (low-med) — M3/S3 are not fully closed: a body without Content-Length skips both size checks.**
`farm/src/pysvc/stt_server.py:91-95`, `classify_server.py:114-120`. `declared` defaults to 0 when the header is absent
(chunked transfer). Probe with the real modules:
- STT spooled a 6 MB chunked file to a temp file on disk before its 413. The cap was 1 MB, so the upload went past
  `spool_max_size`.
- Classify read an 8 MB chunked body whole into RAM before its 413.

The key is required, but on an open farm the key is in the beacon.
Fix: `if declared <= 0: return 411` in both, before any read. The client's `fetch(FormData)` and JSON bodies always
send Content-Length. Add the chunked case to `check_services.py`.

**R8 (med) — Wrong sentences in the box examples** (0f3d21a). Each one was checked against the part code; I
re-read the starred ones myself. Students read these first, so each fix is a text edit:
- ★ **Timer** `control.mjs:110-116`. The text says "Repeats: how many times what comes after runs again" and
  "Timer → Send keeps a device at a gentle pace". The runner re-queues only the Timer (`runner.mjs:699`) and holds the
  boxes after it while the Timer is queued (`:1126-1131`). What follows runs **once**, after seconds × repeats.
  `timer.mjs:9-11` promises the other behaviour. Either say "the wait happens N times, then what follows runs once",
  or fix the runner.
- ★ **Instruction** `think.mjs:41` and **Text** `bring.mjs:14`. "{name} puts that value exactly there" is true only
  with *Fill in {names} with their values* ticked, and that is off by default (`instruction.mjs:178`). The example's
  own box (`think.mjs:47`) is not ticked, so the model reads "Write a haiku about topic." Set `inlineVars: true`
  there and name the checkbox.
- ★ **Classify** `think.mjs:139`. "labels are in inputs.in" is wrong: `inputs.in` is an array, so the labels are
  `inputs.in[0].labels`. `:138` has a second error: an Instruction wired to Classify alone never sees the topics
  (they are not in its output), so wire the topics in too.
- ★ **Write code** `think.mjs:82`. There is no "value port": the Code box's data port is **Inputs**.
- ★ **Button** `control.mjs:18`. "Its face and its ▶ are the same press" is wrong: only the face records a press
  (`button.mjs:110`), and ▶ stops at the Button again. `:13` is also wrong: Run all stops *before* a manual Button,
  and the run bar asks for a press. The box does not glow.
- ★ **Markdown / Preview** `show.mjs:48, 65`. "Output: a picture of the page" is wrong: a markdown page hands on
  nothing (`preview.mjs:522-525`), and the Preview example runs in markdown. `:67` says Automatic picks SVG or
  markdown; it also picks HTML, p5 and three. `:52` says JSON shows "as a code block"; it shows as plain text.
- ★ **Sticky** `control.mjs:135`. `colour: 'pink'` is not a tint (`sticky.mjs:21`), so it falls back to yellow.
  Use `rose`. The box-examples unit test should hold each setting value to what the part normalises it to.
- **Dialog** `control.mjs:79`. "Default is used when nobody answers" is wrong: there is no timeout, and Stop leaves
  it with no value. `:76`: the `in` words are not shown to the person.
- **Toggle** `control.mjs:92, 97`. A loop does not have to "pass through a Toggle": any gate box
  (`topo.mjs:323`) makes it legal.
- **Speak** `show.mjs:109`. "Sound (Listen) → Instruction → Speak makes a talking loop" is wrong: Sound holds a
  recording someone dropped (there is no microphone), and the chain runs once.
- **File** `bring.mjs:86`. The folder is `LOL Studio Projects/<graph-title slug>-<8 chars>`, named at the first
  write. `:82`: a `file` value is written as its **path**, not its content.
- **Split** `think.mjs:156`. "Everything after it runs once PER ITEM" holds only for boxes that take text;
  Filter, Collect, Code and Classify take the whole list. `:162`: empty text gives an empty list, not an error.
- **Scripts** `show.mjs:38`, `think.mjs:55`. "No JavaScript": ▶ Live runs the page's scripts.
  `think.mjs:52`: "follow the mouse" is only a hint in the prompt.
- **UI names that don't match.** Invert → *Keep the others instead*. The filter modes are *Contains / Matches /
  Length is / The model says yes*. Template → *Each item*. Text → *Label*. Branch → *Continue when*. Timeout →
  *Give up after*. Seconds → *Wait (seconds)*. Default → *If nobody answers*.

## Should fix soon

- **Panic does not stop the run, and a race can miss a lit universe.** The tutorial (line 386) says Panic "stops
  everything at once", but the graph keeps running as a dry run. Either stop the runner in the Panic handler or say
  "stops every output". `outputs.ts:206` records a universe only after its first frame's `await`, so a Panic in that
  window misses it: move `dmxTargets.set` above the send. Quitting the app leaves lights lit: call `panic()` on
  `before-quit`.
- **The arming question prints the target list on one line.** `.chat-dialog-text` (`css/dialogs.css:22`) has no
  `white-space: pre-line`, so the `\n•` list collapses. It is hard to read with several targets. One CSS line.
- **Read the news: a model-written label can put a digit on the chart.** `read-the-news.mjs:325` prints the model's
  off-list topic verbatim (`not one of your topics: top 10`). Pass it through `words()` in DRAW, or drop the topic.
- **The tutorial overclaims Write code.** Line 235 says "numbers computed from the data, never typed by the model".
  Nothing enforces this: the model writes the program, and rule 5 is a request. Say "the model is told to compute
  every number from the data; the Code box shows the program, so check it". This matters when a student follows
  "wire Write code into Count's code port": the footer still says "counts by the code".
- **The `writeCodeDesc` + menu text says "value port"** (`strings/parts-creative.en.mjs:51`). The Code box's data
  port is **Inputs**.
- **A plugin whose model failed to load keeps running.** `plugins/registry.js:166-170`. After `{up:false}` the child
  is not killed, so it keeps its port and its RAM until `lol down`. Call `killTree` when `res.ok` is false.
- **Release note for mixed versions.** A v0.1.45 client on a farm-v0.0.39 with a password sees `extract.key: null`,
  so it silently falls back to OWUI's local extraction (no scanned-PDF OCR) until it updates.
- **Send over HTTP/WS may target this machine.** POSTing to a local service (for example ComfyUI's `/prompt` on
  127.0.0.1:8188) takes one arm click on a shared graph. Loopback is right for OSC. Consider refusing it for `http`
  and `ws`, or at least naming "this computer" in the arming list.
- **Send example wording** (`show.mjs:126-127`). "20 a second per device" is really per host:port + address.
  The text says `/lol`, but the box uses `/lol/level`.

## Checked and fine

- **M1** is closed. My probes return `E_LOCAL` for mapped (dotted, hex, full), compatible, NAT64, link-local-mapped,
  `::`, `::1`, `fe80::/10`, `0x7f000001` and own-address forms. The ones still allowed are not local:
  `::ffff:0:a.b.c.d`, 6to4, public mapped. A bad `Location` gives `E_URL`, and `ac.abort()` sits in `finally`.
- **M2** is closed: a load error or a dead child ends the wait within about 1 s. **S1, S2** are closed, and **M3, S3**
  are closed for declared sizes (the Python check passed); R7 is the gap left.
- **Send.** The target comes only from `settings` (`requestFor`), and nothing binds settings to a wire. Unarmed is a
  dry run in main. The farm ports are refused armed or not. The runbar installs once per page load. Opening another
  graph disarms synchronously through the session's `doc` event. The IPC is reachable from the main frame's preload
  only: not the OWUI webview, not the opaque sandbox. The dialog body uses `textContent`, so an imported target cannot
  inject markup.
- **Plugin keys.**
  - `/lol/plugin-keys` compares with `timingSafeEqual`, adds a delay on 401, and answers 404 on an open farm.
  - The password is mutated in place, so the endpoint and the snapshot always agree.
  - The fetch goes to the host that already receives the password.
  - Failures retry at most once a minute per farm, so there is no storm. The Record log redacts `key`.
- **Code `code` port, Classify `question`/`check`.** The program port is kept out of the guest's inputs. Lock and
  unlock behave as the strings say. Wired options win over the model's options. `check` carries only the unsure items.
- **d3.** The file is byte-identical: sha256 `f2094bbf…` matches the lint manifest. Total size is 2047 of 2048 KB.
  The runner's CSP has `connect-src 'none'`, so `d3.json` cannot reach the network.
- **Read the news.** Every count and bar comes from COUNT/DRAW. Title, subtitle and insight have their digits
  scrubbed. Laya's options are the Topics box, exactly.
- **Examples.** Every example's wire ports and setting keys exist on their boxes. The values are in range, except the
  Sticky's `pink`. The tokens `{item}`, `{i}` (1-based) and `{n}` are real. The limits are right, and so are Condition's
  text rules (casefolded, first word, unmatched → maybe), Confirm's 0 = never, and Fetch's rules. The import path
  resets Listen, and opening an example is a graph switch, so it disarms.

## Resolution (integrator, 2026-09-27, before the tag)

| # | Fix | Check |
|---|---|---|
| R1 | Disarm on `did-start-navigation` for the main frame (not the same document) and on `render-process-gone`; the run bar re-reads `armed()` after every run. | k16; to confirm on the rig with real lights |
| R2 | `keepPendingExtract` (farmSelect.ts): while the key fetch is out, the loader already in use for the same URL stays; applied in `connectTo` and both boot seeds. | shell-main unit |
| R3 | The snapshot carries `keyId` = the first 8 hex of sha256(key) next to `key: null`; the client's signature includes it. | farm + shell-main units |
| R4 | DMX rate key `artnet|<universe>`; the arming question, the tutorial and the Send example say what the cap does not cover. | outputs unit (node IP + broadcast share one budget) |
| R5 | `sendValue`: text that is JSON (a number, list or object) is sent parsed. | outputs unit |
| R6 | Panic shown with any Send box; it stops the run; `before-quit` calls `panic()`; a universe is recorded before its first frame. | outputs unit, k16 |
| R7 | Both services answer 411 when `content-length` is missing or 0, before any read. | check_services.py (chunked cases), 18/18 |
| R8 | Every sentence listed rewritten against the box code and in the boxes' own labels; `inlineVars` ticked where an example writes {name}; `rose` sticky. | box-examples unit (settings hold real values) |
| should | Panic stops the run · the arming list keeps its lines · off-list topics digit-scrubbed · the tutorial's Write-code sentence · "Inputs port" · a failed plugin is stopped · the mixed-version note (DEVLOG) · local targets named in the arming list · the Send example's address. | units, k13, k16, k17 |
