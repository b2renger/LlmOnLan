# The Computer: Converse — a real voice loop for designing voice interaction (plan, 2026-10-09)

> *"I'd like design students to work on voice interaction: the identity of the voice bot, what to
> show, how the feedback between bot and user works. Use the Computer for this. No Wizard of Oz,
> no mechanical turk — we want to actually do the thing, a POC."* — the owner (paraphrased from
> French)

This plan is written for a builder who knows the repo (CLAUDE.md, COMPUTER_LIVE_PLAN.md). It
names every file it touches and every contract it adds. Numbers marked *tune* are starting
values to adjust on real microphones; everything else is a decision.

## 1. What is true today (read at `ad5e53c`, client v0.2.10; brought up to date at `27817c1`, client v0.2.11, 2026-10-12)

- **Every voice brick exists, as separate boxes and separate runs.** Sound (● Record, a person
  presses Record and Stop; **Listen** sends the take to the farm's speech to text) → Instruction
  (`app.ask.text`) → Speak (the farm's Kokoro through `net/tts.mjs`, or `speechSynthesis`) — the
  *Ask out loud* template. One turn = Record, Stop, Run all. Nothing on the Computer listens
  continuously, nothing detects the end of a turn, nothing can be interrupted.
- **The farm's speech to text** (`farm/src/stt.js`, `farm/src/pysvc/stt_server.py`, since
  2026-10-09): faster-whisper, `stt.device`/`stt.model` = `'auto'` — on an NVIDIA GPU (Windows or
  Linux x64) Whisper **large-v3-turbo** in int8_float16 (1.7 GB of GPU; measured on the PRO 6000:
  **0.14–0.17 s for a 5 s phrase**, 0.42–0.48 s for 30 s), else **`small`** in int8 on the CPU
  (1.8–1.9 s for 5 s, 3.6–5.5 s for 30 s), and the CPU model by itself when the GPU does not load
  (`/health` says why). `vad_filter=True`. Still **one transcription at a time farm-wide** (one
  `asyncio.Semaphore`), at most `STT_MAX_WAITING` (4) waiting, one in flight per client address,
  then 429 + `Retry-After: 3`. A chunked upload is read up to the cap; PyAV is pinned at 18.1.0
  (19 refused every recording). The snapshot advertises `stt {url, key, model}`; the renderer's
  `net/farm.mjs` publishes `{url, key}` (the service ignores `model`: one model). Contract in
  `net/stt.mjs` (multipart `file`, optional `language`); it does not hand the caller Retry-After
  yet. Off by default on the farm.
- **Open WebUI's Call mode now goes through the same service** (client v0.2.11, `configBridge.ts`:
  `AUDIO_STT_ENGINE=openai` when the farm advertises `stt`). Read in the bundled 0.11.4: its
  end-of-phrase is a fixed **2 s** of silence (no setting, no env), speaking over the answer
  interrupts only with a person's own setting (off by default), and it keeps every recording and
  its transcript in `DATA_DIR/cache/audio/transcriptions`. Measured end to end on the PRO 6000:
  **end of speech → first audio 2.1–2.5 s** (median 2.37 s), of which **1.55–1.73 s is that
  end-of-phrase wait**; STT 0.27–0.33 s through OWUI; Kokoro's first piece 0.17–0.22 s. The
  DEVLOG left one question open: "whether OWUI's 2 s end-of-phrase is good enough in the studio
  (it cannot be tuned without a voice mode of LOL's own)". Converse is that voice mode: every one
  of those numbers is a knob on its box, and it keeps no recording.
- **The farm's voice** (`net/tts.mjs`): `POST {tts.url}/audio/speech {model, voice, input,
  response_format:'mp3'}`, voice from the beacon (`config.tts.voice`, default `af_heart`, an
  English voice). No `speed` sent yet. Played by `graph/parts/audio.mjs` `playBytes()` through the
  window's ONE AudioContext (no `<audio>`: lint rule 2). Read in the farm's pinned Kokoro-FastAPI
  v0.5.0 source: `speed` (0.25–4.0) is in its speech request, and **`GET {tts.url}/audio/voices`
  answers `{voices: [{id, name}]}`** (`?legacy=true`: plain strings); its 67 voices include
  `ff_siwis`, the one French voice. K-V6's *verify* is answered: the list exists.
- **The ask door does not stream.** `app.ask.text()` returns once the whole answer is in
  (`app/ask.mjs` `once()` collects `startGeneration()`'s stream, whose `onTail` callback is
  already there, unused by ask). It sends one user message (`buildBody` → `draftFromPath` with a
  one-message path): no conversation history. `thinking:false` is only sent by `json()`.
- **The runner** wraps the ask (`graph/runner.mjs` `meteredAsk`): every call is the background
  lane, every real call is one generation on the Cap, extra options pass through (`...given`).
  `RUN_LIMITS.maxWallMs` = 10 min, parked time included.
- **The live guest** (COMPUTER_LIVE_PLAN K-9): one Preview at a time runs ▶ Live. The host can
  `restart(code, {inputs})` it (a re-run), but there is **no way to push data into a running
  live sketch**. `params` (with `lol.onParams`) exists only on the snapshot guest
  (`sandbox/host.mjs` `params()`), not on the live handle. The runner already tracks a sketch's
  AudioContexts (`audios`), so a face can make sounds.
- **The doors this work must go through:** rule 16 (`getUserMedia`/`MediaRecorder` only in
  `graph/parts/capture.mjs`), rule 11 (network only in the listed `net/*` files), rule 13
  (`setInterval` only in `sandbox/host.mjs`), rule 12 (iframes only in `sandbox/host.mjs`),
  rule 4 (PURE_MODULES import with DOM/storage trapped), rule 5 (strings through `t()`),
  rule 15 (lessons and templates), rule 3 (colours are tokens).
- **Visibility:** `computer/visible.mjs` keeps `app.state.visible` true while an activation is
  *executing*, even if the person switched surface. A conversation is one long activation, so
  without a rule of its own **the microphone would stay open while nobody looks at the
  Computer**. Decision 7 closes that. (`computer/main.mjs` emits `EV.VISIBLE` only when `visible`
  changes or on `visibilitychange`, so `pageVisible:false` does arrive; "the Computer was left"
  does not, hence K-V10.)
- **Since `ad5e53c`, nothing else Converse touches moved.** Lessons 13–14 are the home lessons
  (*read the room*, *switch the home*), so this plan's "lesson 15" (§13) stays a later item; the
  shelf has 15 lessons and 11 templates. The Home boxes, the vLLM models (Gemma 4 12B, Qwen3-Omni)
  and the farm panel's engine sections change nothing here. One routing fact matters for
  decision 8: `thinking:false` is sent as `chat_template_kwargs` (vLLM, llama-server) **and**
  `think:false` (Ollama) by `net/request.mjs`; a vLLM model served with no thinking parser has
  `chat_template_kwargs` dropped by LiteLLM (2026-10-09), which is harmless for a model that does
  not think.
- **Read in the code while bringing this plan up to date** (these change *how*, not *what*; §15
  lists them with the closest honest option): `app/ask.mjs` `normalise()` rebuilds the options
  from a fixed list, so K-V5's three options must be added there or they never reach `once()`;
  `meteredAsk` counts every real ask on the Cap (default 50), so a long conversation can meet the
  Cap before `maxTurns`; `RUN_LIMITS.maxWallMs` is checked between activations only, so a
  conversation (one activation) is bounded by its own `maxMinutes`, as decision 10 already says.

## 2. Decisions

1. **One new box, Converse** (type `converse`, palette group *think*). A person presses
   **● Start** on its face; the box runs a conversation until **■ End**, the run bar's Stop, a
   limit, or the window being hidden. Its output is the conversation as JSON (every turn, with
   its latencies), so an Instruction downstream can critique a session.
2. **Farm only: speech to text → model → Kokoro.** No cloud. A speech-to-speech service (Gemini
   Live and the like) would break "the Computer talks to the farm only" and is out of scope
   (§10). The loop is written as steps (hear, transcribe, answer, say) so another engine could
   replace the middle later.
3. **The face is the live sketch.** Whatever Preview is ▶ Live receives the conversation's
   events (`lol.on(...)`, §4). Not a wire: a Preview wired *from* Converse would run *after* the
   conversation (topological order). One live guest at a time makes "the face" unambiguous. The
   template puts the two side by side with a Sticky saying so; the box's face says
   "No face: put a Preview ▶ Live" when `sandbox.liveNow()` is null.
4. **Stream and cut into sentences.** The answer streams (`onText`, K-V5); each complete sentence
   goes to the voice while the model writes the next. The first sound comes after the first
   sentence, not the whole answer. With the farm's voice, sentence n+1 is synthesised while n
   plays.
5. **Turn-taking happens in the renderer**: an energy detector on an AnalyserNode (§5), a room
   calibration, a noise floor that follows the room, an end-of-turn silence a person sets, and
   barge-in with a raised threshold while the bot speaks.
6. **The turn, trimmed, as a 16 kHz mono WAV.** The recorder runs through the listening phase;
   at the end of a turn the take is decoded, cut to [onset − pre-roll, last speech + tail],
   resampled to 16 kHz mono and sent as WAV (~32 KB/s: small, and Whisper's own rate). If the
   decode fails, the whole take goes as recorded.
7. **Consent and privacy, stricter than Listen.**
   - The microphone opens only after a press on the face's ● Start (recorded in the part, like
     Button's `notePress`/`consumePress`). Run all never runs it (`manual: true`); the title-bar
     ▶, a Trigger and the MCP `run_graph` without that press get a one-sentence refusal:
     "Press ● Start on the box: only a person opens the microphone."
   - The microphone closes at ■ End, Stop, an error, a limit, and **when the Computer is not
     shown or the window is hidden**: the conversation ends, it is not paused. `EV.VISIBLE` alone
     cannot say so (its `visible` stays true while an activation executes — `visible.mjs`), so
     the box listens to `pageVisible` on `EV.VISIBLE` and to a new `EV.COMPUTER_SHOWN` (K-V10).
   - Sound never leaves the turn: no take is stored, logged or kept after its transcription. The
     transcript is the box's value, like a Sound box's written-down text today. The Record log
     (debugLog) records events and timings, never audio.
   - While the mic is open, the box shows it (a red dot and "Microphone on").
8. **A spoken reply is short and does not think.** Every turn sends `thinking:false` (latency),
   `maxTokens` ~300 (*tune*; the ask floor of 512 applies — keep it), and the persona followed by
   fixed spoken-style rules (strings, not code): answer in the person's language, a few short
   sentences, no lists, no markdown, no emoji, ask one question at a time.
9. **The design knobs live on the box** (§7). They are what students turn: end-of-turn silence,
   sensitivity, interruptible, added delay, voice, speed, greeting, the "not understood" line,
   sound cues.
10. **Limits.** `maxTurns` (default 12, ≤ 40) and `maxMinutes` (default 6, ≤ 9, under the
    runner's 10-minute wall clock). Each answered turn is one generation on the Cap; a turn that
    found nothing to answer costs none.

## 3. The user's side, in one paragraph

Open the *Voice persona* template. Write the persona in the Text box. Press ▶ Live on the face
(a p5 sketch). Press ● Start on Converse, allow the microphone, talk. The face breathes while it
listens, follows your voice, shows it is thinking, moves its mouth with the voice; the box shows
the last exchange and how long the bot made you wait. Turn the knobs (patient vs impatient bot,
interruptible or not, an added delay), press ● Start again, compare. Edit the sketch: that is the
design work. ■ End gives the transcript, which an Instruction can analyse.

## 4. The event contract (frozen)

Every event a face receives has the shape `{type, state, t, ...data}`: `t` is ms since the
conversation started, `state` is one of `idle · listening · hearing · transcribing · thinking ·
speaking · ended · error`. Text is clipped to 2000 characters; only strings, numbers, booleans and
the `ms` object cross.

| type | when | data |
|---|---|---|
| `start` | the microphone is on | `persona` (first 200 chars) |
| `listening` | waiting for the person | — |
| `user.start` | the person started speaking (onset) | — |
| `user.level` | the mic level, ≤ 20/s, in every state | `level` 0..1 |
| `user.end` | end-of-turn silence reached | `speechMs` |
| `user.cancel` | a sound too short to be a turn | — |
| `transcript` | the farm wrote it down | `text`, `ms` |
| `not.understood` | nothing usable written down (§5.4) | `text` (what Whisper said, maybe empty) |
| `thinking` | the model is asked (after the added delay) | — |
| `bot.text` | the answer so far, as it streams (≤ 10/s) | `text` |
| `bot.start` | the first sound of the answer | — |
| `bot.sentence` | one sentence starts being said | `text`, `index` |
| `bot.level` | the voice level, ≤ 20/s | `level` 0..1 |
| `bot.end` | the answer was said | `text` |
| `interrupted` | the person spoke over the bot and it stopped | `said` (what it had said) |
| `turn` | one turn's summary | `user`, `bot`, `ms: {heard, stt, firstWord, firstSound, total}` |
| `error` | something failed, the conversation may go on | `code`, `message` |
| `ended` | the microphone is off | `why`: `end · stop · limit · hidden · error` |

`ms` (all from the same monotonic clock, null when it did not happen): `heard` = end of speech →
transcript; `stt` = the STT request alone; `firstWord` = model asked → first token; `firstSound` =
end of speech → first sound (**the wait a person feels**); `total` = end of speech → answer said.

In the sketch (every live kind that gets `lol` today; for an HTML page, expose it as `window.lol`
in live mode if it is not reachable):

```js
// lol.on(type, fn) and lol.on('*', fn) → returns an off() function; lol.voice = {state, last}
let state = 'idle', level = 0, mouth = 0;
lol.on('*', (e) => { state = e.state; });
lol.on('user.level', (e) => { level = e.level; });
lol.on('bot.level', (e) => { mouth = e.level; });
function setup() { createCanvas(lol.size.w, lol.size.h); }
function draw() {
  background(20);
  const r = 80 + (state === 'listening' ? 10 * sin(frameCount / 20) : 0) + 200 * level;
  fill(state === 'thinking' ? 120 : 230); circle(width / 2, height / 2, r);
  rect(width / 2 - 30, height / 2 + 60, 60, 4 + 60 * mouth);
}
```

## 5. The loop

### 5.1 Voice activity (pure, `graph/voice.mjs`)

Per frame (one `requestAnimationFrame`, no `setInterval`), with `level` = RMS of the analyser's
time-domain block and `t` = `performance.now()`. Durations accumulate from real frame gaps,
each capped at 250 ms (a stalled frame is not seconds of silence).

- **Calibration**: the first 500 ms only learn the room's level (time constant ~150 ms); nothing
  starts a turn.
- **Threshold**: `max(floor × (1.6 − s), noise × (4 − 2.5 s))`, `s` = sensitivity 0..1, `floor`
  0.012 (*tune*). While the bot speaks: `max(threshold × 4, 0.07)` (*tune*) — its voice in the
  speakers must not count as an interruption; a headset needs none of it.
- **Noise floor**: outside speech and outside the bot's speech, an exponential average with a
  1.5 s time constant, clamped 0.001..0.2.
- **Onset**: above threshold for 120 ms → `start`, the onset back-dated by those 120 ms.
- **Inside speech**: above threshold × 0.6 (hysteresis) counts as speech. Silence ≥ the
  end-of-turn knob → `end` if the speech lasted ≥ 300 ms, else `cancel` (a cough). Speech longer
  than 30 s ends the turn anyway.
- **Pre-roll / tail** kept around the turn: 250 ms / 150 ms (*tune*).

### 5.2 One conversation (`graph/parts/converse.mjs` `run()`)

1. Refuse without a face press (decision 7), without a farm STT (`app.farm.get().stt`), or with
   no voice at all (same rule as Speak's `voiceFor`). `openListening()` (K-V3); a refusal from
   the OS is the box's error, worded like the Sound box's.
2. Emit `start`; if **Greeting** is on, ask the model for the opening line (one generation) and
   say it (§5.3); then `listening`.
3. **Listen.** The detector runs every frame; `user.level` is sent ≤ 20/s. While the bot is
   not speaking and **Interruptible** is off, the detector still runs (for the face) but a
   `start` is ignored. While the recorder's take is older than 20 s and nobody speaks, the take
   is dropped and a new one started (bounded memory and decode).
4. **End of turn.** `user.end`, state `transcribing`. Stop the take, decode it at 16 kHz mono
   (`OfflineAudioContext`), cut it with `takeWindow`, `wavBytes`, then `transcribe()`. Start the
   next take at once (the person may go on talking). On 429: wait Retry-After (≤ 3 s; the farm
   says 3), retry once, then `error {code:'busy'}` and back to listening. (`net/stt.mjs` hands the
   busy answer's Retry-After to the caller: §15.)
5. **Nothing heard** (`heardNothing`: empty, or one of Whisper's silence phrases — "Sous-titres
   réalisés par la communauté d'Amara.org", "Merci d'avoir regardé", "Thank you for watching",
   "[Musique]"…, compared WHOLE, so a real sentence containing them passes): `not.understood`;
   if the **Not understood** line is set, say it; back to listening. No generation spent.
6. **Answer.** `transcript`; wait the **Added delay** (abortable); `thinking`; `ask.text({system:
   persona + spoken rules, prompt: transcript, history: last 8 turns, thinking:false,
   onText, cache:false})`. On each `onText`: `bot.text` (≤ 10/s), `nextSentences()`, each new
   sentence → `speakable()` → the voice queue (§5.3).
7. **Interruption.** With Interruptible on, a `start` while the bot thinks or speaks aborts the
   answer (the ask's signal, the voice queue's signal), emits `interrupted {said}`, keeps what was
   said as the turn's bot text, and the new speech is the next turn (the take already holds it:
   the window starts at its onset).
8. **Turn done.** `bot.end`, `turn {user, bot, ms}`, `listening`. Without Interruptible, the take
   that ran during the bot's speech is dropped and a fresh one started (it holds the bot's
   voice).
9. **End.** On ■ End (graceful: finish the sentence being said, then stop), Stop (abort now), a
   limit, the window hidden (`pageVisible:false`) or the Computer surface left
   (`EV.COMPUTER_SHOWN {shown:false}`), or an unrecoverable error: close the
   mic (every track stopped), emit `ended {why}`, return the transcript (an abort still returns
   what was said; a refusal before the first turn is an error).

### 5.3 Saying it

- **The farm's voice**: one `speakOnFarm({text, voice, speed})` per sentence, started as soon as
  the sentence exists; played in order with `playBytes(bytes, signal, {onLevel})` → `bot.level`.
  `bot.start` at the first sound, `bot.sentence` at each.
- **This computer's voice**: one `SpeechSynthesisUtterance` per sentence (`lang`, `rate` =
  speed, `pitch`); no level is measurable, so `bot.level` is a pulse on each `onboundary` word
  event decaying over ~150 ms — a mouth still moves.
- **Sound cues** (setting `cues`): `none` or `soft` — a short sine blip (OscillatorNode on the
  shared AudioContext) on `user.end` and a lower one on `listening`. Anything richer is the
  face's job (the sketch can make its own sounds).

### 5.4 Errors (the box's sentences, `strings/parts-converse.en.mjs`)

`refused` (microphone not allowed) · `no-device` · `no-press` · `no-stt` (the farm has no speech
to text: its operator turns it on) · `no-voice` · `busy` (STT or seat: says which) · `stt` /
`tts` / `ask` failures with the door's own sentence · `limit` (turns or minutes) · `hidden`.
After a failed turn the loop goes back to listening; three failures in a row end it.

## 6. The box's face

- Header: the state with a dot (Not started · Listening · Hearing you · Writing down · Thinking ·
  Speaking · Ended), and "● Microphone on" in red while it is.
- A level meter (mic, and the voice while it speaks), painted every frame while running.
- The last exchange: "You: …" / "Bot: …", two lines each, clipped.
- The last turn's numbers: "heard in 0.9 s · first word 0.6 s · **first sound 2.1 s**".
- **● Start** (class `graph-part-control`, `data-action="press"`, so the canvas routes it to
  `onPlay` like Button) when idle; **■ End** while running.
- "No face: put a Preview ▶ Live to see it react" when nothing is live.
- The knobs (§7), the rarely-turned ones folded under "More".

## 7. Settings (`defaults()`)

| key | default | range | what a student changes with it |
|---|---|---|---|
| `model` | the farm's default | the Instruction's picker | intelligence vs speed |
| `language` | `auto` | auto, fr, en, es, de, it… | sent to STT, and to the local voice |
| `voice` | `auto` | auto · farm · local | Speak's three choices |
| `farmVoice` | `''` (= the beacon's) | Kokoro voice id; a list if `GET {tts.url}/audio/voices` answers (*verify*), else a text field | the timbre (`ff_siwis` is Kokoro's French voice) |
| `speed` | 1 | 0.5–2 | Kokoro `speed`; local `rate` |
| `pitch` | 1 | 0.5–1.5 | local voice only |
| `endSilenceMs` | 800 | 200–3000 | impatient ↔ patient |
| `sensitivity` | 0.5 | 0–1 | whispers count ↔ only clear speech |
| `interruptible` | true | bool | can you talk over it? |
| `delayMs` | 0 | 0–8000 | latency as a material |
| `greeting` | false | bool | does the bot speak first? |
| `notUnderstood` | `''` | text | the repair line ("Pardon ?"); empty = silent |
| `cues` | `soft` | none · soft | earcons |
| `maxTurns` | 12 | 1–40 | |
| `maxMinutes` | 6 | 1–9 | |

The persona arrives on the `persona` port (text, many, joined). With nothing wired, a default
persona string (strings, not code) is used and the face says so.

## 8. Frozen contracts

- **K-V1 `graph/voice.mjs`, PURE** (added to `PURE_MODULES` in `test/chat-lint.js`):
  `VOICE_STATES`, `VOICE_EVENTS`, `VOICE_LIMITS` + `knob(key, v)` (the clamps of §7),
  `VAD` (the numbers of §5.1), `thresholdFor(noise, sensitivity)`, `vadInit()`,
  `vadStep(state, {level, t, sensitivity, endSilenceMs, botSpeaking}) → {s, ev: 'start'|'end'|'cancel'|null, at: {speechStart, lastSpeech}, threshold}`,
  `takeWindow({takeStart, speechStart, lastSpeech, duration}) → {from, to}` (seconds),
  `nextSentences(text, from, final?) → {sentences, next}` (cuts at `. ! ? …` + whitespace or a
  blank line; never "3.5", never "M."/"etc."; a sentence over 160 chars cuts at its last comma),
  `speakable(text)` (no code fences, `<think>`, link targets, URLs, headings, bullets, emphasis,
  emoji), `heardNothing(text)`, `wavBytes(float32, rate) → Uint8Array`, `rms(block)`,
  `voiceEvent(type, state, data, t)` (throws on an unknown type or state), `turnTimes(moments)`,
  `historyOf(turns, keep) → [{role, content}]`. No prose in it (rule 5): the spoken-style rules
  and the default persona are strings.
- **K-V2 the sandbox `event` command.** `sandbox/protocol.mjs` `CMDS` gains `'event'`, and so does
  the runner's inline list (`sandbox-protocol.test.mjs` asserts the two agree). Guest side
  (`runner.html`): `{cmd:'event', ev}` with `ev` an object whose `type` is a string ≤ 64 chars;
  handlers registered by `lol.on(type|'*', fn)` (returns an off function) are called in
  registration order, each in a try/catch reported as a `runtime` error; `lol.voice` holds
  `{state, last}`; `reset()` clears the handlers. The snapshot guest accepts the command too (a
  harmless no-op for a sketch that registered nothing).
- **K-V3 `capture.mjs` `openListening({echoCancellation?: true}) → Promise<{level(): number,
  startTake(): number, endTake(): Promise<File|null>, dropTake(): void, close(): void}>`.**
  Asks for `{audio: {echoCancellation, noiseSuppression: true, autoGainControl: true}}`; the
  level comes from an AnalyserNode on a MediaStreamSource in the shared AudioContext, connected
  to nothing else (no feedback); `startTake()` returns the take's start time
  (`performance.now()` at the recorder's `onstart`); `close()` stops every track and disconnects
  the node. Same error codes as `startRecording` (`refused`, `no-device`). Rule 16 unchanged.
- **K-V4 `audio.mjs`**: export `audioContext()` (the existing `audioCtx`); `playBytes(bytes,
  signal, opts?)` where `opts.onLevel(level)` is called once per animation frame while it plays
  (an AnalyserNode between the source and the destination). Existing callers unchanged.
- **K-V5 `app/ask.mjs` `text(opts)`** gains three options, all ignored when absent so every
  caller is unchanged: `onText(contentSoFar)` (called from `startGeneration`'s `onTail`;
  implies `cache:false`), `history: [{role:'user'|'assistant', content}]` (messages before the
  prompt: `buildBody` passes `draftFromPath` rows shaped like its own `{id, role, content,
  status:'done'}`, history first, the prompt last; part of the cache key when caching), and
  `thinking: false` (sent as today's `chat_template_kwargs`; `text()` still never sends it
  unless asked). `meteredAsk` already passes them through; add a test that it does.
- **K-V6 `net/tts.mjs` `speakOnFarm`** gains `speed` (sent only when ≠ 1) and, if the farm's
  Kokoro answers it, `listVoices({url}) → string[]` (`GET {url}/audio/voices`), the one new
  request, in the same door.
- **K-V7 the live handle's `send(ev)`** (`sandbox/host.mjs`, K-9's handle): posts `event` to the
  live guest; a no-op once ended. The Converse box reaches it through the session's
  `sandboxNow()` → `liveNow()`, looked up at every event (a live box pauses off screen and comes
  back with a new handle). Not `input.sandbox()`: that one BOOTS the snapshot guest when there is
  none, so a conversation with no face would pay for an iframe it never uses (§15). The box
  throttles: levels ≤ 20/s, `bot.text` ≤ 10/s; every other event is sent as it happens.
- **K-V8 the press.** `converse.mjs` exports `notePress(partId)` / `consumePress(partId)` like
  `button.mjs` — re-exported FROM `button.mjs`, one registry, so the host's `clearPresses()` (a
  graph switch, a close, a run on no graph, a refused cycle) forgets a Converse press too (§15);
  only the face's ● Start calls `notePress`. `computer/mcp-tools.mjs` `run_graph`
  answers "A conversation is started by a person, with ● Start on the box" when `from` is a
  Converse box (belt and braces: `run()` refuses anyway).
- **K-V9 the part spec**: `type:'converse'`, `group:'think'`, `thinks:true`, `manual:true`,
  ~~`volatile:true`~~ (not set: §15), `mostGenerations(part)` = `maxTurns` (+1 with a greeting) so
  the run plan quotes the range, inputs `[{name:'persona', accepts:['text'], many:true}]`, `output:'json'`,
  the value `{persona, settings, turns: [{user, bot, interrupted, ms}], why, startedAt}`.
  Palette: glyph `◖))`, order ~270 in *think*, keywords in `strings/palette.en.mjs`
  (`kwConverse`: talk, voice, conversation, speech, assistant, bot, mic, persona, dialogue).
- **K-V10 the shown signal.** `core/events.mjs` gains `COMPUTER_SHOWN: 'computer:shown'`
  (`{shown}`); `computer/main.mjs` `onShownChange` emits it on every change (it already computes
  `shown` from `#lolcomputer`'s `hidden` class). Nothing else reads it today.

## 9. Files

| file | change |
|---|---|
| `graph/voice.mjs` | new, pure (K-V1) |
| `graph/parts/converse.mjs` | new: the box (render, run, the loop of §5) |
| `graph/parts/capture.mjs` | `openListening` (K-V3) |
| `graph/parts/audio.mjs` | `audioContext()` export, `playBytes` `onLevel` (K-V4) |
| `graph/parts/index.mjs` | the row in `partSpecs()`, `partMeta()`, `KW` |
| `app/ask.mjs` | `onText`, `history`, `thinking` for `text()` (K-V5) |
| `net/tts.mjs` | `speed`, `listVoices` (K-V6) |
| `net/stt.mjs` | the busy answer's `retryAfter` (§15.5) |
| `computer/devlog.mjs` | `voice.*` lines from the `voice:event` bus name (§15.10) |
| `sandbox/protocol.mjs`, `sandbox/runner.html`, `sandbox/host.mjs` | `event`, `lol.on`, `lol.voice`, `send` (K-V2, K-V7) |
| `computer/mcp-tools.mjs` | the `run_graph` refusal (K-V8) |
| `core/events.mjs`, `computer/main.mjs` | `EV.COMPUTER_SHOWN` (K-V10) |
| `strings/parts-converse.en.mjs`, `strings/palette.en.mjs` | every sentence; the spoken-style rules; the default persona |
| `css/computer-converse.css` (+ `@import` in `computer/computer.css`) | the face; tokens only (rule 3) |
| `computer/examples/think.mjs` | the ? example (box-examples test: one per ＋ entry) |
| `computer/templates/voice-persona.mjs`, `computer/tutorial/registry.mjs` | the template (rule 15) |
| `graph/parts/creative.mjs` | a "Voice face (p5.js)" preset whose starter is §4's sketch, grown |
| `test/chat/unit/voice.test.mjs`, `converse-part.test.mjs`, `sandbox-protocol.test.mjs`, `capture.test.mjs`, `ask.test.mjs` | §11 |
| `test/chat-harness/scenarios/k27-converse.mjs`, `test/mock/services.js` | §11 |
| `docs/LOLCHAT_COMPUTER_TUTORIAL.md`, `docs/COMPUTER_STATUS.md`, `docs/HUMAN_TESTS.md`, `docs/DEVLOG.md`, `CLAUDE.md` | as usual |

Nothing in `src/main`, nothing on the farm.

## 10. The template, *Voice persona*

Title; a Sticky (how it works, privacy in one paragraph: "the microphone opens only when you
press ● Start and closes when you stop or leave the Computer; your voice goes to the farm to be
written down and is dropped"); a Text box with a persona **in French** (a museum guide, with a
name, a tone, three rules of speech); Converse (`language: fr`, `farmVoice: ff_siwis`); a
Preview in p5 mode holding the Voice face starter, with a second Sticky "▶ Live this first";
an Instruction wired from Converse: "Read this conversation. Where did the bot make the person
wait, interrupt them, or misunderstand? Three suggestions to improve its persona." `needsFarm:
'one'`, `generations` = the Instruction's 1 (Converse is manual).

## 11. Proves

**Unit (Node):**
- `voice.test.mjs`: onset back-dated; a pause inside a sentence keeps the turn; the end-of-turn
  knob changes how many turns a script makes (300 vs 1000 ms); a click never starts, a cough is
  cancelled; nothing starts during calibration; a fan's hum is learnt and a voice over it is
  heard; the bot's echo at 0.05 does not barge in and a voice at 0.4 does; a stalled frame is
  ≤ 250 ms; 30 s cuts a monologue; `takeWindow` pre-roll/tail/clamps; sentence cuts (incl.
  "3.5", "M.", the final flush, the comma cut); `speakable`; `heardNothing` true for the
  silence phrases and false for "Non merci." and a real sentence containing "merci d'avoir
  regardé"; the WAV header; `voiceEvent` clipping and refusals; `turnTimes`; `historyOf`.
- `converse-part.test.mjs`, with fakes for `openListening` (a level script), STT, TTS, a
  streaming ask and a live handle that records `send`: the event ORDER of one turn; no press →
  refusal and no mic; nothing heard → `not.understood`, no generation; interruption mid-answer
  → `interrupted`, the ask aborted, the next turn answered; ■ End vs Stop; `EV.COMPUTER_SHOWN
  {shown:false}` or `pageVisible:false` → `ended {why:'hidden'}` and the mic closed; `maxTurns`; a 429 then success; the first
  sentence is said before the stream ends (TTS called before the ask resolves); the transcript
  value's shape.
- `sandbox-protocol.test.mjs`: the CMDS lists agree; an `event` reaches `lol.on` and `'*'`; a
  throwing handler is a runtime error, not a dead guest; `reset()` clears handlers.
- `capture.test.mjs`: `openListening` with fake devices — close stops every track; a take is a
  File; a refusal says so. `ask.test.mjs`: `onText` sees growing content, `history` becomes
  messages in order, `thinking:false` is in the body, and nothing changes for callers that pass
  none of them.

**Gates:** `chat-lint.js` (incl. `--self-test`), `chat-scope.js`, `chat-unit.js`, `npm run build`.

**Harness** (`k27-converse`, Electron on the mock farm): `main.cjs` already passes
`--use-fake-device-for-media-stream`; add `--use-file-for-fake-audio-capture=<fixture.wav>`
behind an env var (a fixture of 1 s silence, 1.5 s noise burst, 2 s silence, looped). Chromium
loads the fake devices once per process, and every harness scenario shares one Electron, so the
fixture is the microphone of the whole run: k23 (● Record) only needs *a* sound of the right length,
which it still gets. The mock already answers `/stt/v1/audio/transcriptions` (deterministic: it
names the uploaded file and its size) and `/tts/v1/audio/speech` — but that one answers 0.3 s of
silence whatever the text, too short to be interrupted; it now answers a quiet tone whose length
follows the text. It gains `/tts/v1/audio/voices` (K-V6) and a scenario model that streams a
three-sentence answer slowly enough for the first sentence to be spoken before the stream ends. Prove: ● Start → `user.start`, `user.end`, `transcript`,
`thinking`, `bot.start`, three `bot.sentence`, `bot.end`, `turn` reach a live p5 face (read
`lol.voice.last` through the live handle's debug door or a pixel change); the first TTS call is
logged before the chat stream ends; switching to LOL Vibe ends it and the mic track is stopped.

**Human (HUMAN_TESTS, a real farm):** a laptop mic in a quiet room and in a noisy one; with
speakers (does the bot interrupt itself?) and with a headset; French with `ff_siwis`; measure
`firstSound` on an idle farm with a small model (goal: about 2–3 s) and with 10 people talking.

## 12. Capacity and risks

- **Speech to text is still the classroom's narrow door, but a much shorter one on a GPU**: one
  transcription at a time farm-wide, 4 waiting then 429, one in flight per laptop. On a GPU farm a
  turn of a few seconds costs ~0.15–0.2 s (large-v3-turbo, measured), so 20 people finishing a
  sentence in the same second wait at most ~4 s, and only the 5th and later get a 429 (retried once
  after the farm's 3 s, then `busy`). On a CPU farm (`small`, ~1.9 s per 5 s phrase) a room of 20
  does not fit: 5 in a row is already ~10 s, so a workshop on a CPU-only farm is a few people at a
  time. Trimmed 16 kHz WAVs keep each request short either way. Several workers, or Qwen3-Omni's
  `/v1/audio/transcriptions` on vLLM (0.12–0.18 s, measured 2026-10-09), are farm decisions outside
  this plan; the box shows `busy` honestly, and says which (speech to text, or no free seat).
- **The model** uses the background lane: it yields to anyone typing in LOL Vibe on this
  laptop, and needs a free seat on the farm. On a one-slot farm a class will wait; size
  `llamacpp.parallel` before a workshop (GETTING_STARTED §4).
- **Echo** without a headset: AEC in Chromium may not cancel Web Audio output on every OS. The
  guarded threshold (×4, ≥ 0.07) is the safety; the template recommends headsets; Interruptible
  off is the fallback.
- **Whisper hallucinates on silence**: trimming, `vad_filter` on the farm, and `heardNothing`.
- **Decoding a WebM take** with `decodeAudioData` works in Chromium (the Sound box already
  measures takes by decoding); the fallback is sending the whole take.
- **Kokoro in French**: one French voice (`ff_siwis`); English voices read French badly — the
  template sets it.
- **Thinking models**: `thinking:false` relies on `chat_template_kwargs` (Qwen); a model that
  ignores it streams reasoning first. `speakable` strips a leaked `<think>`; the first word is
  late, and the box's numbers will show it.

## 13. Out of scope (phase 2)

- Events out to the world in real time (OSC to TouchDesigner, an LED ring on an ESP32) through
  `src/main/outputs.ts`, only while armed — the natural next step for tangible voice objects.
- A cloud speech-to-speech engine (Gemini Live): an owner decision about the network boundary.
- Speech to text on the laptop (Whisper in the renderer) to unload the farm.
- A lesson 15 ("give a voice a face").
- Several voices in one conversation; a bot that speaks first on a schedule.

## 14. Questions for the owner

1. Is "the face is whatever is ▶ Live" acceptable, or do you want an explicit link (a setting
   naming the Preview)?
2. Default `interruptible`: on (natural) or off (safe with speakers)?
3. Should a session's transcript be kept as the box's value (as proposed) or forgotten at ■ End
   unless a person presses "Keep"?
4. French strings: the app is English-only today; is a French persona in the template enough?

### The owner's answers (2026-10-12)

1. **The face is whatever Preview is ▶ Live** — no setting naming it (as proposed).
2. **`interruptible` defaults to ON** (natural turn-taking). The template recommends a headset; the guarded threshold
   stays the safety, and students can turn it off.
3. **The transcript is kept as the box's value** (as proposed); audio is never kept.
4. Not asked again: the app stays English; the template carries a French persona (Kokoro's `ff_siwis`).
- Release: farm-v0.0.46 (Model storage, the panel's engine sections) waits to ship together with Converse.

## 15. What the code says about this plan (read at `27817c1`, 2026-10-12)

Every decision of §2 and every answer of §14 stands. Read against the code, a few contract details
are wrong or impossible as written; the closest honest option is taken, and each is named here so
a reader of §8 is not misled.

1. **K-V9 `volatile:true` is dropped.** In `graph/topo.mjs`, `volatile` does two things: the §4.2
   prologue re-pulls a volatile ancestor (but a `manual` part is never pulled at all), and Run all's
   dirty closure treats a volatile part as dirty forever, so **everything downstream of Converse
   (the template's critic Instruction) would re-run on every Run all**, spending a generation on an
   unchanged transcript. `manual:true` already keeps Converse itself out of Run all, and ● Start is
   a seed, which always runs. So the spec sets `manual` and not `volatile`.
2. **K-V7: `sandboxNow()`, not `input.sandbox()`.** `input.sandbox()` is `session.sandbox()`, which
   creates and boots the snapshot guest when none exists. A live face can only exist inside an
   existing sandbox, so the box reads `app.host.session.sandboxNow()` (as `common.mjs`
   `sandboxPaused` does), never creating one, and asks `liveNow()` at every event.
3. **K-V8: one press registry.** The host forgets Button presses (`clearPresses()`) on a graph
   switch, a close, a run with no graph and a refused cycle. A second registry in `converse.mjs`
   would be one the host never clears, so `notePress`/`consumePress` are re-exported from
   `button.mjs`. Same signatures, same rule: only the face's ● Start notes a press, and the run it
   starts consumes it.
4. **K-V5: `normalise()` is where the options go.** `app/ask.mjs` `normalise()` rebuilds the option
   bag from a fixed list, so `onText`, `history` and `thinking` are added there; `onText` is
   forwarded to `startGeneration`'s `onTail` with the content so far (the delta accumulator already
   keeps a leading `<think>` block out of `content`).
5. **§5.2.4 Retry-After:** `net/stt.mjs` returns `{code:'busy'}` without the header. Its busy result
   gains `retryAfter` (seconds, from the header, clamped 0–3 by the box), in the same door.
6. **K-V1 gains `vadQuiet(state)`.** Without Interruptible, the detector still follows the person
   while the bot speaks (for the face) but a `start` is ignored; when the bot stops, the detector
   must listen afresh (a person still talking is then heard from that moment) without forgetting
   the room's noise. That is one small pure function, so it is in `voice.mjs` with the rest.
7. **The bot's echo tail.** "While the bot speaks" (§5.1) ends at the last sound, but a room's echo
   does not: the raised threshold is kept for **250 ms** (*tune*) after each sound ends.
8. **The Cap.** Every answered turn is one generation through `meteredAsk`, so the toolbar's Cap
   (default 50) can end a conversation before `maxTurns`: it ends as `ended {why:'limit'}` and the
   transcript is kept, never as an error.
9. **An interruption before any word was said** (the person speaks again while the model is still
   thinking, or while the last turn is still being written down): no `turn` is recorded for it, and
   its words are carried into the next turn's prompt, so nothing the person said is lost and the
   history the model sees still alternates person/bot (Gemma's template refuses two person messages
   in a row).
10. **The Record log** gets the conversation's events through a private bus name (`voice:event`,
    exported by `voice.mjs`), which `computer/devlog.mjs` writes as `voice.*` lines with their
    timings; levels and the streaming text are counted, not written. No part imports the recorder.
    The recorder's own request summary already writes only the method and address of a multipart
    upload, so the STT request's sound never reaches the file either.
