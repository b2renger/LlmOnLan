// @ts-check
// Converse (docs/COMPUTER_VOICE_PLAN.md) — a spoken conversation with the farm's model, for designing
// voice interaction: the identity of the voice, what the face shows, how the turn-taking feels.
//
// A person presses ● Start; the box opens the microphone (graph/parts/capture.mjs, the one door) and
// runs a loop until ■ End, the run bar's Stop, a limit, or the Computer / the window being left:
//   hear      an energy detector on the microphone's level, every animation frame (graph/voice.mjs,
//             pure): a room calibration, a noise floor that follows the room, an end-of-turn silence a
//             person sets, and a raised threshold while the bot speaks (barge-in);
//   write     the turn cut out of the recorder's take, made a 16 kHz mono WAV, written down by the
//             farm's speech to text (net/stt.mjs) — then dropped: no take is kept, logged or stored;
//   answer    the farm's model (app.ask through the runner's meteredAsk: the background lane, one
//             generation on the Cap per answered turn), streamed, with the last turns as history and
//             thinking off;
//   say       sentence by sentence as the answer streams: the farm's Kokoro (net/tts.mjs, sentence
//             n+1 made while n plays) or this computer's speechSynthesis.
// Every step is an event a face receives (§4): whatever Preview is ▶ Live gets them through its
// `lol.on(...)` (sandbox K-V2/K-V7). The box's value is the transcript, with each turn's timings.
//
// CONSENT (decision 7). The microphone opens only on a person's press on this box's face (the press
// is noted by the face and consumed by the run it starts: Run all, the title-bar ▶, a Trigger and an
// MCP run_graph never carry one, and are refused). It closes at the end, whatever ends it — and the
// conversation ENDS, it does not pause, when the Computer is left or the window hidden.
//
// The loop itself is `converse(deps)`, with every device, door and clock passed in, so
// test/chat/unit/converse-part.test.mjs drives whole conversations in Node.

import { valueOf } from '../values.mjs';
import { partFail, textOf, pickerRow, setPicked } from './common.mjs';
import { numberField, checkField, textField } from './fields.mjs';
import { modelOptions, optionSig } from './instruction.mjs';
import { playBytes, audioContext } from './audio.mjs';
import { openListening } from './capture.mjs';
import { voiceFor, SPEAK_VOICES } from './speak.mjs';
import { notePress, consumePress } from './button.mjs';
import { transcribe } from '../../net/stt.mjs';
import { speakOnFarm, listVoices } from '../../net/tts.mjs';
import { EV } from '../../core/events.mjs';
import { t } from '../../core/i18n.mjs';
import {
  VAD, STT_RATE, VOICE_BUS, VOICE_LIMITS, knobs, vadInit, vadStep, vadQuiet, levelOf, takeWindow, toMono16k,
  wavBytes, nextSentences, speakable, heardNothing, historyOf, voiceEvent, turnTimes,
} from '../voice.mjs';
import '../../strings/parts-converse.en.mjs';
import '../../strings/parts-speak.en.mjs';
import '../../strings/parts.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

// K-V8 (plan §15.3): ONE press registry, Button's, so the host's clearPresses() forgets a Converse
// press on a graph switch, a close, a run with no graph and a refused cycle.
export { notePress, consumePress };

/** The answer's length (decision 8): a spoken reply is short. The ask's floor (512) still applies. */
export const SPOKEN_MAX_TOKENS = 300;
/** Turns of history the model is given (§5.2.6). */
export const HISTORY_TURNS = 8;
/** Failed turns in a row that end the conversation (§5.4). */
export const MAX_FAILURES = 3;
/** A take older than this, while nobody speaks, is dropped and a new one started (§5.2.3). */
export const TAKE_MAX_MS = 20000;
/** Gaps between two events of the same kind sent to the face (K-V7): levels ≤ 20/s, text ≤ 10/s. */
const GAP = { 'user.level': 50, 'bot.level': 50, 'bot.text': 100 };
/** A local voice's word boundary is a pulse decaying over this (§5.3). */
const PULSE_MS = 150;
/** The time limit is graceful; this long after it, it is not. */
const HARD_STOP_MS = 30000;
/** A cue blip lasts this long; the detector treats it as the bot's sound. */
const CUE_MS = 130;
/** A press on ● Start opens the microphone only if the run it starts reaches the box this soon: a press
 * whose run waited (merged behind another conversation, say) asks to be pressed again. */
export const PRESS_TTL_MS = 15000;
/** partId -> when ● Start was pressed (the time half of Button's press registry). */
const pressedAt = new Map();
/** The face's press: noted in Button's registry (so the host's clearPresses forgets it) and timed.
 * @param {string} id */
export function pressStart(id) {
  if (busy.has(String(id))) return;      // a double click, or a press during the conversation: not a second Start
  notePress(id);
  pressedAt.set(String(id), Date.now());
}
/** Boxes whose conversation is starting or running (run() entry to exit). */
const busy = new Set();
/** partId -> when its last conversation ended: a run that follows at once is the ▶ or a click that
 * merged into the live run, not a person asking for another conversation. */
const endedAt = new Map();
/** A run within this of the box's own end hands on that conversation instead of refusing. */
const REQUEUE_MS = 3000;
/** The run's end, whatever ended it: no press noted meanwhile survives it (review 2026-10-12, 2).
 * @param {string} id */
function settled(id) {
  busy.delete(id);
  consumePress(id);
  pressedAt.delete(id);
  endedAt.set(id, Date.now());
}
/** Consume a press if there is one AND it is fresh. @param {string} id @returns {boolean} */
export function freshPress(id) {
  const had = consumePress(id);
  const at = pressedAt.get(String(id));
  pressedAt.delete(String(id));
  return had && typeof at === 'number' && Date.now() - at <= PRESS_TTL_MS;
}

/** The local voice's locale per language knob. */
const LOCALE = { fr: 'fr-FR', en: 'en-US', es: 'es-ES', de: 'de-DE', it: 'it-IT', pt: 'pt-PT', nl: 'nl-NL' };

/** Literal maps, so lint rule 5 can see every key a person may read. */
const STATE_KEY = {
  idle: 'parts.converseStateIdle', listening: 'parts.converseStateListening', hearing: 'parts.converseStateHearing',
  transcribing: 'parts.converseStateTranscribing', thinking: 'parts.converseStateThinking', speaking: 'parts.converseStateSpeaking',
  ended: 'parts.converseStateEnded', error: 'parts.converseStateError',
};
const LANG_KEY = {
  auto: 'parts.converseLangAuto', fr: 'parts.converseLangFr', en: 'parts.converseLangEn', es: 'parts.converseLangEs',
  de: 'parts.converseLangDe', it: 'parts.converseLangIt', pt: 'parts.converseLangPt', nl: 'parts.converseLangNl',
};
const VOICE_KEY = { auto: 'parts.speakVoiceAuto', farm: 'parts.speakVoiceFarm', local: 'parts.speakVoiceLocal' };
const CUE_KEY = { none: 'parts.converseCuesNone', soft: 'parts.converseCuesSoft' };

/** Join two pieces of what a person said. @param {string} a @param {string} b */
const joinWords = (a, b) => [String(a || '').trim(), String(b || '').trim()].filter(Boolean).join(' ');

// ---- the face's view of a running conversation (render and run are different calls) ---------------

/** partId -> {snap, end()} while a conversation runs, and its last snapshot after. */
const sessions = new Map();
/** partId -> the face repaints. @type {Map<string, Set<(snap: any) => void>>} */
const watchers = new Map();

/** @param {string} id @param {any} snap */
function publish(id, snap) {
  const s = sessions.get(id) || {};
  sessions.set(id, { ...s, snap });
  for (const fn of Array.from(watchers.get(id) || [])) { try { fn(snap); } catch (err) { console.error('[lolcomputer] converse face threw', err); } }
}

/** For tests and the debug door: is a conversation running on this box, and is its microphone on?
 * @param {string} partId @returns {{running: boolean, mic: boolean, state: string}|null} */
export function conversationOf(partId) {
  const s = sessions.get(String(partId));
  if (!s || !s.snap) return null;
  return { running: !!(s.end && s.end.end), mic: !!s.snap.mic, state: String(s.snap.state || '') };
}

/** Forget every conversation's leftovers (a unit test between cases). */
export function clearConversations() {
  sessions.clear();
  watchers.clear();
}

/** The live sketch, if a Preview is ▶ Live — through the session's `sandboxNow()`, which never makes
 * a guest (plan §15.2). @param {any} app @returns {any} */
export function liveFace(app) {
  try {
    const session = app && app.host && app.host.session;
    const sb = session && typeof session.sandboxNow === 'function' ? session.sandboxNow() : null;
    return sb && typeof sb.liveNow === 'function' ? sb.liveNow() : null;
  } catch { return null; }
}

// ---- the loop --------------------------------------------------------------------------------------

/**
 * One conversation, from the open microphone to the transcript. Every outside thing is a dependency.
 * @param {{
 *   knobs: Record<string, any>, persona: string, voice: 'farm'|'local',
 *   stt: {url: string, key: string|null}, tts: {url: string, voice?: string|null, model?: string|null}|null,
 *   signal: AbortSignal,
 *   listen: () => Promise<any>,
 *   transcribe: (o: any) => Promise<any>,
 *   synth: (o: any) => Promise<any>,
 *   play: (bytes: any, signal: AbortSignal, o: {onStart: () => void, onLevel: (rms: number) => void}) => Promise<any>,
 *   sayLocal: (text: string, signal: AbortSignal, o: any) => Promise<any>,
 *   ask: (o: any) => Promise<any>,
 *   decode: (file: any) => Promise<{channels: Float32Array[], rate: number, duration: number}|null>,
 *   face: (ev: any) => void, announce: (ev: any) => void, cue: (kind: 'end'|'listen') => void,
 *   now: () => number, wallNow: () => number,
 *   frame: (fn: () => void) => (() => void),
 *   sleep: (ms: number, signal: AbortSignal) => Promise<boolean>,
 *   watch: (onHidden: () => void) => (() => void),
 *   shownNow: () => boolean,
 *   onChange: (snap: any) => void,
 *   onSession: (handles: {end: () => void, stop: () => void}|null) => void,
 * }} o
 * @returns {Promise<{value: any, bar: boolean}>}
 */
export async function converse(o) {
  const k = o.knobs;
  const t0 = o.now();
  const startedAt = new Date(o.wallNow()).toISOString();
  /** @type {any[]} */ const turns = [];
  /** @type {string} */ let state = 'idle';
  let failures = 0;
  let lastProblem = '';
  /** @type {string|null} */ let endWhy = null;
  let endNote = '';
  let closed = false;
  /** Words the person said that no answer has taken yet (plan §15.9). */
  let carry = '';
  /** The detector's current speech is the person's turn (not ignored while the bot spoke). */
  let accepted = false;
  /** A turn whose words were still being written down when the person spoke again. */
  /** @type {any} */ let superseded = null;
  let vad = vadInit();
  /** @type {Promise<any>} */ let pipeline = Promise.resolve();
  /** The turn in hand (being written down, answered, said). @type {any} */ let cur = null;
  const endAc = new AbortController();
  /** @type {any} */ let mic = null;
  /** The bot's sound, for the detector (barge-in) and the face. */
  const out = { playing: false, lastSoundEnd: -Infinity, boundaryAt: -Infinity };
  /** @type {Map<string, number>} */ const sentAt = new Map();
  const snap = { state, mic: false, level: 0, botLevel: 0, user: '', bot: '', times: /** @type {any} */ (null), note: '', running: true };
  /** @type {(() => void)|null} */ let stopFrame = null;
  /** @type {() => void} */ let resolveEnd = () => {};
  const ended = new Promise((r) => { resolveEnd = () => r(undefined); });

  const at = () => o.now() - t0;
  const changed = () => { snap.state = state; try { o.onChange({ ...snap }); } catch { /* the face's problem */ } };
  const setState = (/** @type {string} */ s) => { state = s; changed(); };
  /** One event, to the face and the Record log; levels and streaming text throttled (K-V7).
   * @param {string} type @param {any} [data] */
  const fire = (type, data) => {
    /** @type {any} */ let ev;
    try { ev = voiceEvent(type, state, data, at()); } catch (err) { console.error('[lolcomputer] converse event', err); return; }
    const gap = /** @type {any} */ (GAP)[type];
    if (gap) {
      const now = o.now();
      if (now - (sentAt.get(type) ?? -Infinity) < gap) return;
      sentAt.set(type, now);
    }
    try { o.face(ev); } catch { /* a face that went away */ }
    try { o.announce(ev); } catch { /* the recorder's problem */ }
  };
  /** A controller that dies with the conversation. */
  const linked = () => {
    const ac = new AbortController();
    if (endAc.signal.aborted) ac.abort();
    else endAc.signal.addEventListener('abort', () => ac.abort(), { once: true });
    return ac;
  };
  const cueNow = (/** @type {'end'|'listen'} */ kind) => {
    if (k.cues !== 'soft' || closed) return;
    try { o.cue(kind); } catch { /* no sound is not a problem */ }
    out.lastSoundEnd = Math.max(out.lastSoundEnd, o.now() + CUE_MS);
  };

  // ---- the end ----------------------------------------------------------------------------------
  /** Close the microphone and end, now. @param {string} why @param {string} [note] */
  function finish(why, note) {
    if (closed) return;
    closed = true;
    endWhy = why;
    if (note) endNote = note;
    endAc.abort();                                   // every request, every sound
    if (stopFrame) { try { stopFrame(); } catch { /* gone */ } stopFrame = null; }
    if (mic) { try { mic.close(); } catch { /* already */ } }
    snap.mic = false;
    snap.level = 0;
    snap.botLevel = 0;
    snap.running = false;
    snap.note = endNote;
    accepted = false;
    setState('ended');
    fire('ended', { why });
    resolveEnd();
  }
  /** ■ End and the limits: finish the sentence being said, then stop (§5.2.9).
   * @param {string} why @param {string} note */
  function requestEnd(why, note) {
    if (closed) return;
    if (endWhy) { finish(endWhy, endNote); return; }   // asked twice: now (review 2026-10-12, 1)
    endWhy = why;
    endNote = note;
    if (cur && cur.started && !cur.done) {
      cur.stopAfter = true;                          // the speaker stops after this sentence
      cur.askAc.abort();                             // and the model need not write more
      return;
    }
    finish(why, note);
  }
  /** One failed turn (§5.4): said on the box and to the face; three in a row end it.
   * @param {string} message @param {string} code */
  function problem(message, code) {
    if (closed) return;
    lastProblem = message;
    failures += 1;
    snap.note = message;
    setState('error');
    fire('error', { code, message });
    if (failures >= MAX_FAILURES) finish('error', t('parts.converseTooMany', { message }));
  }
  /** Back to listening, unless the person already has the floor again. */
  function backToListening() {
    if (closed) return;
    cur = null;
    if (endWhy) { finish(endWhy, endNote); return; }
    if (accepted) return;
    setState('listening');
    fire('listening');
    cueNow('listen');
  }
  /** The person's turns so far (a greeting is the bot's). */
  const personTurns = () => turns.filter((x) => !x.greeting).length;

  /** @param {any} turn @param {string} bot @param {boolean} interrupted */
  function record(turn, bot, interrupted) {
    const ms = turnTimes(turn.moments);
    const row = { user: turn.user, bot, interrupted, ms, ...(turn.greeting ? { greeting: true } : {}) };
    turns.push(row);
    snap.times = ms;
    snap.bot = bot;
    fire('turn', { user: turn.user, bot, ms });
    return row;
  }

  // ---- saying it (§5.3) ----------------------------------------------------------------------------
  /**
   * The voice queue of one turn: sentences said in order; with the farm's voice, sentence n+1 is
   * made while n plays. `done` resolves when all is said, the turn is aborted, or `stopAfter`.
   * @param {any} turn
   */
  function speaker(turn) {
    /** @type {{text: string, ready?: Promise<any>}[]} */ const queue = [];
    let shut = false;
    /** @type {(() => void)|null} */ let wake = null;
    let index = 0;
    const signal = turn.sayAc.signal;
    /** @type {Promise<any>} */ let chain = Promise.resolve();
    const poke = () => { const w = wake; wake = null; if (w) w(); };
    signal.addEventListener('abort', poke, { once: true });
    const started = (/** @type {string} */ text) => {
      out.playing = true;
      turn.saying = true;
      if (!turn.started) {
        turn.started = true;
        turn.moments.firstSound = o.now();
        setState('speaking');
        fire('bot.start');
      }
      turn.said.push(text);
      snap.bot = turn.said.join(' ');
      fire('bot.sentence', { text, index: index++ });
    };
    const stopped = () => { out.playing = false; turn.saying = false; out.lastSoundEnd = o.now(); snap.botLevel = 0; };
    const push = (/** @type {string} */ raw) => {
      const text = speakable(raw);
      if (!text) return;
      /** @type {{text: string, ready?: Promise<any>}} */ const item = { text };
      if (o.voice === 'farm' && o.tts) {
        const tts = o.tts;
        chain = chain.then(() => (signal.aborted ? { error: 'aborted', code: 'aborted' }
          : o.synth({ url: tts.url, voice: k.farmVoice || tts.voice, model: tts.model, text, speed: k.speed, signal })));
        item.ready = chain;
      }
      queue.push(item);
      poke();
    };
    const close = () => { shut = true; poke(); };
    const done = (async () => {
      for (;;) {
        if (signal.aborted || turn.stopAfter || closed) break;
        if (!queue.length) {
          if (shut) break;
          await new Promise((r) => { wake = () => r(undefined); });
          continue;
        }
        const item = /** @type {any} */ (queue.shift());
        if (o.voice === 'farm') {
          const got = await item.ready;
          if (signal.aborted || closed || turn.stopAfter) break;
          if (!got || 'error' in got) {
            if (got && got.code === 'aborted') break;
            turn.ttsFailed = String((got && got.error) || '');
            break;
          }
          const r = await o.play(got.bytes, signal, {
            onStart: () => started(item.text),
            onLevel: (/** @type {number} */ rms) => {
              snap.botLevel = levelOf(rms);
              fire('bot.level', { level: snap.botLevel });
            },
          });
          stopped();
          if (r && r.ok === false) { turn.ttsFailed = String(r.error || ''); break; }
        } else {
          await o.sayLocal(item.text, signal, {
            lang: /** @type {any} */ (LOCALE)[k.language] || '',
            rate: k.speed,
            pitch: k.pitch,
            onStart: () => started(item.text),
            onBoundary: () => { out.boundaryAt = o.now(); },
          });
          stopped();
        }
      }
      stopped();
    })();
    return { push, close, done };
  }

  /** Say one line with no model (the "not understood" repair line). @param {any} turn @param {string} text */
  async function sayLine(turn, text) {
    turn.stage = 'repair';
    const q = speaker(turn);
    q.push(text);
    q.close();
    await q.done;
  }

  // ---- answering (§5.2.6) ------------------------------------------------------------------------------
  /** The model's system message: the persona, then the spoken-style rules (strings). */
  function systemFor() {
    const parts = [o.persona, t('parts.converseSpokenRules')];
    if (k.language !== 'auto') parts.push(t('parts.converseSpokenLanguage', { lang: k.language }));
    const hello = turns.find((x) => x.greeting && x.bot);
    if (hello) parts.push(t('parts.converseOpenedWith', { text: hello.bot }));
    return parts.filter(Boolean).join('\n\n');
  }

  /**
   * Ask, stream, say. `turn.user` is what the person said ('' for the greeting).
   * @param {any} turn @param {string} prompt
   */
  async function answer(turn, prompt) {
    if (closed) return;
    turn.stage = 'thinking';
    if (k.delayMs > 0 && !turn.greeting) {
      setState('thinking');
      if (!(await o.sleep(k.delayMs, turn.askAc.signal))) return settleAborted(turn);
    }
    if (closed || turn.interrupted) return;
    turn.moments.asked = o.now();
    setState('thinking');
    fire('thinking');
    const q = speaker(turn);
    let content = '';
    let cut = 0;
    /** @type {any} */ let res = null;
    try {
      res = await o.ask({
        task: 'converse',
        system: systemFor(),
        prompt,
        history: historyOf(turns, HISTORY_TURNS),
        thinking: false,
        maxTokens: SPOKEN_MAX_TOKENS,
        cache: false,
        model: k.model || undefined,
        signal: turn.askAc.signal,
        onText: (/** @type {string} */ c) => {
          if (turn.interrupted || closed) return;
          if (turn.moments.firstToken === undefined) turn.moments.firstToken = o.now();
          content = c;
          if (!turn.started) snap.bot = c;
          fire('bot.text', { text: c });
          const r = nextSentences(c, cut, false);
          cut = r.next;
          for (const s of r.sentences) q.push(s);
        },
      });
    } catch (err) {
      if (err && /** @type {any} */ (err).reason === 'capped') {
        q.close();
        turn.askAc.abort();
        await q.done;
        finish('limit', t('parts.converseEndedLimitCap'));
        return;
      }
      res = { ok: false, error: { kind: 'farm', message: String((err && /** @type {any} */ (err).message) || err) } };
    }
    if (res && res.ok && !turn.askAc.signal.aborted) {
      for (const s of nextSentences(content, cut, true).sentences) q.push(s);
    }
    q.close();
    await q.done;
    turn.done = true;
    turn.moments.saidAll = o.now();
    if (closed || turn.interrupted) return;
    const bot = turn.said.join(' ');
    const ok = !!(res && res.ok);
    // Aborted here means End or a limit asked the model to stop: what was said is the turn.
    const cutByEnd = !!endWhy && turn.askAc.signal.aborted;
    if (!ok && !cutByEnd) {
      const kind = res && res.error ? String(res.error.kind || '') : '';
      if (bot) record(turn, bot, false);
      if (kind === 'busy') problem(String((res.error && res.error.message) || '') || t('parts.converseBusySeat'), 'busy');
      else problem(t('parts.converseAskErr', { message: String((res && res.error && res.error.message) || '') || t('parts.errEmpty') }), 'ask');
      backToListening();
      return;
    }
    if (!bot) {
      if (turn.ttsFailed) problem(t('parts.converseTtsErr', { message: turn.ttsFailed }), 'tts');
      else if (ok && !content.trim()) problem(t('parts.converseAskErr', { message: t('parts.errEmpty') }), 'ask');
      backToListening();
      return;
    }
    fire('bot.end', { text: bot });
    record(turn, bot, false);
    failures = 0;
    snap.note = '';
    if (turn.ttsFailed) problem(t('parts.converseTtsErr', { message: turn.ttsFailed }), 'tts');
    if (closed) return;
    if (!k.interruptible) {
      // The take that ran while the bot spoke holds its voice: start afresh, and listen afresh.
      mic.startTake();
      vad = vadQuiet(vad);
      accepted = false;
    }
    if (endWhy) { finish(endWhy, endNote); return; }
    if (!turn.greeting && personTurns() >= k.maxTurns) { finish('limit', t('parts.converseEndedLimitTurns', { n: k.maxTurns })); return; }
    backToListening();
  }

  /** A turn aborted before it was asked (the delay was cut): nothing to say. @param {any} turn */
  function settleAborted(turn) {
    if (closed || turn.interrupted) return;
    if (endWhy) finish(endWhy, endNote);
  }

  /** The person spoke over the bot (§5.2.7). */
  function interrupt() {
    const turn = cur;
    if (!turn) return;
    if (turn.stage === 'transcribing') {           // its words are still being written down: carried (§15.9)
      turn.superseded = true;
      superseded = turn;
      return;
    }
    turn.interrupted = true;
    turn.askAc.abort();
    turn.sayAc.abort();
    out.playing = false;
    out.lastSoundEnd = o.now();
    const said = turn.said.join(' ');
    fire('interrupted', { said });
    if (turn.stage === 'repair') { cur = null; return; }
    turn.moments.saidAll = o.now();
    if (said) record(turn, said, true);
    else if (turn.user) carry = joinWords(turn.user, carry);
    cur = null;
    // ■ End was pressed while it spoke: speaking over it does not bring the conversation back.
    if (endWhy) finish(endWhy, endNote);
  }

  // ---- hearing (§5.2.3–5) -------------------------------------------------------------------------------
  /** The turn's sound, as the farm gets it: the window of the take, 16 kHz mono WAV; the whole take
   * as recorded when it cannot be decoded. @param {any} job */
  async function soundOf(job, file) {
    /** @type {any} */ let dec = null;
    try { dec = await o.decode(file); } catch { dec = null; }
    if (dec && Array.isArray(dec.channels) && dec.channels.length) {
      const w = takeWindow({ takeStart: job.takeStart, speechStart: job.speechStart, lastSpeech: job.lastSpeech, duration: dec.duration });
      const mono = toMono16k(dec.channels, dec.rate, w.from, w.to);
      if (mono.length) return { bytes: wavBytes(mono, STT_RATE), name: 'turn.wav', mime: 'audio/wav' };
    }
    return { bytes: new Uint8Array(await file.arrayBuffer()), name: 'turn.webm', mime: String(file.type || 'audio/webm') };
  }

  /** One turn of the person's: write it down, then answer it. @param {any} job */
  async function hear(job) {
    if (closed) return;
    const turn = { stage: 'transcribing', user: '', said: /** @type {string[]} */ ([]), moments: job.moments, askAc: linked(), sayAc: linked() };
    cur = turn;
    const file = await job.file;
    if (closed) return;
    if (endWhy) { finish(endWhy, endNote); return; }   // ended while the take was handed over: not sent
    if (!file) { if (cur === turn) { problem(t('parts.converseNoSound'), 'stt'); backToListening(); } return; }
    let sound = await soundOf(job, file);
    if (closed) return;
    const lang = k.language === 'auto' ? null : k.language;
    job.moments.sttStart = o.now();
    let r = await o.transcribe({ url: o.stt.url, key: o.stt.key, bytes: sound.bytes, name: sound.name, mime: sound.mime, language: lang, signal: turn.askAc.signal });
    if (r && r.code === 'busy') {
      const wait = Math.min(3, Math.max(0, Number(r.retryAfter) || 3)) * 1000;
      if (await o.sleep(wait, turn.askAc.signal)) {
        r = await o.transcribe({ url: o.stt.url, key: o.stt.key, bytes: sound.bytes, name: sound.name, mime: sound.mime, language: lang, signal: turn.askAc.signal });
      }
    }
    sound = /** @type {any} */ (null);             // the sound is dropped: nothing keeps it
    job.moments.sttEnd = o.now();
    if (closed) return;
    const isSuperseded = !!(/** @type {any} */ (turn).superseded);
    if (superseded === turn) superseded = null;
    if (!r || 'error' in r) {
      if (r && r.code === 'aborted') return;
      problem(r && r.code === 'busy' ? t('parts.converseBusyStt') : t('parts.converseSttErr', { message: String((r && r.error) || '') }), r && r.code === 'busy' ? 'busy' : 'stt');
      if (!isSuperseded) backToListening();
      return;
    }
    const text = String(r.text || '').trim();
    if (heardNothing(text)) {
      fire('not.understood', { text });
      if (isSuperseded) return;
      if (k.notUnderstood) await sayLine(turn, k.notUnderstood);
      if (cur === turn) backToListening();
      return;
    }
    snap.user = text;
    fire('transcript', { text, ms: Math.round(job.moments.sttEnd - job.moments.sttStart) });
    if (isSuperseded) { carry = joinWords(carry, text); return; }   // the person went on: the next turn takes these words too
    const user = joinWords(carry, text);
    carry = '';
    /** @type {any} */ (turn).user = user;
    if (endWhy) { finish(endWhy, endNote); return; }
    await answer(turn, user);
  }

  /** The person's words that a cut turn left behind, answered as a turn of their own. */
  async function answerCarry() {
    if (closed || !carry || cur) return;
    const user = carry;
    carry = '';
    const turn = { stage: 'thinking', user, said: /** @type {string[]} */ ([]), moments: {}, askAc: linked(), sayAc: linked() };
    cur = turn;
    await answer(turn, user);
  }

  /** End of the person's turn: hand the take over, start the next one at once (§5.2.4). @param {any} span */
  function endOfTurn(span) {
    const takeStart = mic.takeStart();
    const file = mic.endTake();
    mic.startTake();
    fire('user.end', { speechMs: Math.round((span.lastSpeech || 0) - (span.speechStart || 0)) });
    cueNow('end');
    setState('transcribing');
    const job = { takeStart, speechStart: span.speechStart, lastSpeech: span.lastSpeech, file, moments: { endOfSpeech: span.lastSpeech } };
    pipeline = pipeline.then(() => hear(job)).catch((err) => { problem(t('parts.converseSttErr', { message: String((err && err.message) || err) }), 'stt'); backToListening(); });
  }

  // ---- every frame (§5.1) -------------------------------------------------------------------------------
  function tick() {
    if (closed) return;
    const now = o.now();
    // The time limit asks once (the sentence being said is finished); 30 s later it is a hard stop.
    if (!endWhy && now - t0 >= k.maxMinutes * 60000) requestEnd('limit', t('parts.converseEndedLimitMinutes', { n: k.maxMinutes }));
    if (now - t0 >= k.maxMinutes * 60000 + HARD_STOP_MS) finish('limit', t('parts.converseEndedLimitMinutes', { n: k.maxMinutes }));
    if (closed) return;
    const level = Number(mic.level()) || 0;
    const botLoud = out.playing || now - out.lastSoundEnd < VAD.botTailMs;
    const r = vadStep(vad, { level, t: now, sensitivity: k.sensitivity, endSilenceMs: k.endSilenceMs, botSpeaking: botLoud });
    vad = r.s;
    snap.level = levelOf(level);
    fire('user.level', { level: snap.level });
    if (out.playing && o.voice === 'local') {
      snap.botLevel = Math.max(0, 1 - (now - out.boundaryAt) / PULSE_MS);
      fire('bot.level', { level: snap.botLevel });
    }
    // Bounded memory: while nobody speaks, a take never grows past TAKE_MAX_MS.
    if (vad.phase === 'silence' && !accepted && vad.above === 0 && now - mic.takeStart() > TAKE_MAX_MS) mic.startTake();
    if (r.ev === 'start' && endWhy) {
      // ■ End (or a limit) was asked: whatever is said now is not a turn — it ends here, unheard.
      finish(endWhy, endNote);
      return;
    }
    if (r.ev === 'start') {
      // Free to speak: nothing in hand, or the last words are only being written down (the person
      // went on talking). Over the bot, thinking or speaking, only when it is interruptible.
      if (!cur || cur.stage === 'transcribing' || k.interruptible) {
        if (cur) interrupt();
        accepted = true;
        setState('hearing');
        fire('user.start');
      }
    } else if (r.ev === 'end' && accepted) {
      accepted = false;
      endOfTurn(r.at);
    } else if (r.ev === 'cancel' && accepted) {
      accepted = false;
      // A cough after the person's last words: the turn that was being written down is answered after all.
      if (superseded) { superseded.superseded = false; superseded = null; }
      setState(cur ? 'transcribing' : 'listening');
      fire('user.cancel');
      if (!cur && carry) pipeline = pipeline.then(() => answerCarry()).catch(() => {});
    }
    changed();
  }

  // ---- start ------------------------------------------------------------------------------------------
  const onStop = () => finish('stop', t('parts.converseEndedStop'));
  if (o.signal.aborted || !o.shownNow()) {
    // Stopped, or the Computer left, before the microphone opened: it never opens.
    endWhy = o.signal.aborted ? 'stop' : 'hidden';
    return { value: valueOf('json', resultOf()), bar: true };
  }
  const offWatch = o.watch(() => finish('hidden', t('parts.converseEndedHidden')));
  o.signal.addEventListener('abort', onStop, { once: true });
  // ■ End, and the box deleted under it, work from now on — also while the system asks for the microphone.
  o.onSession({ end: () => requestEnd('end', t('parts.converseEndedEnd')), stop: () => finish('stop', t('parts.converseEndedStop')) });
  changed();
  try {
    mic = await o.listen();
  } catch (err) {
    offWatch();
    o.signal.removeEventListener('abort', onStop);
    o.onSession(null);
    snap.running = false;
    changed();
    const code = err && /** @type {any} */ (err).code;
    throw partFail(code === 'refused' ? t('parts.converseMicRefused') : t('parts.converseNoMic'), 'part');
  }
  /** Anything unexpected ends the conversation, and so closes the microphone: it is never left open
   * by a loop that stopped turning. @param {any} err */
  const crash = (err) => {
    console.error('[lolcomputer] converse stopped on an error', err);
    finish('error', t('parts.converseAskErr', { message: String((err && err.message) || err) }));
  };
  try {
    if (closed || o.signal.aborted || !o.shownNow()) {
      // Left (or stopped) while the system asked for the microphone: it closes before anything is heard.
      try { mic.close(); } catch { /* already */ }
      if (!closed) finish(o.signal.aborted ? 'stop' : 'hidden', o.signal.aborted ? t('parts.converseEndedStop') : t('parts.converseEndedHidden'));
    } else {
      snap.mic = true;
      mic.startTake();
      setState('listening');
      fire('start', { persona: String(o.persona || '').slice(0, 200) });
      const loop = () => {
        if (closed) return;
        try { tick(); } catch (err) { crash(err); return; }
        if (!closed) stopFrame = o.frame(loop);
      };
      stopFrame = o.frame(loop);
      if (k.greeting) {
        const hello = { stage: 'thinking', user: '', greeting: true, said: /** @type {string[]} */ ([]), moments: {}, askAc: linked(), sayAc: linked() };
        cur = hello;
        pipeline = pipeline.then(() => answer(hello, t('parts.converseGreetingAsk'))).catch(() => backToListening());
      } else {
        fire('listening');
      }
    }
    await ended;
  } catch (err) {
    crash(err);
  } finally {
    if (!closed) finish('error');
    offWatch();
    o.signal.removeEventListener('abort', onStop);
    o.onSession(null);
  }
  if (endWhy === 'error' && !personTurns()) throw partFail(endNote || lastProblem || t('parts.converseEndedError'), 'part');
  return { value: valueOf('json', resultOf()), bar: personTurns() === 0 };

  /** The box's value (K-V9): the conversation as it went. */
  function resultOf() {
    return {
      persona: o.persona,
      settings: { ...k },
      turns: turns.map((x) => ({ ...x })),
      why: endWhy,
      startedAt,
    };
  }
}

// ---- the browser's devices and doors, for the box ---------------------------------------------------

/** Say one sentence with this computer's voice; resolves when said or stopped. The OS does not
 * always fire `end`, so a ceiling from the text's length ends the wait (as the Speak box does).
 * @param {string} text @param {AbortSignal} signal @param {any} opts */
function sayLocally(text, signal, opts) {
  const synth = /** @type {any} */ (globalThis).speechSynthesis;
  const Utterance = /** @type {any} */ (globalThis).SpeechSynthesisUtterance;
  if (!synth || typeof Utterance !== 'function' || (signal && signal.aborted)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let over = false;
    const finish = () => { if (!over) { over = true; clearTimeout(timer); resolve(true); } };
    const timer = setTimeout(finish, 4000 + text.length * 120);
    const u = new Utterance(text);
    if (opts.lang) u.lang = opts.lang;
    u.rate = Number(opts.rate) || 1;
    u.pitch = Number(opts.pitch) || 1;
    u.onstart = () => { try { opts.onStart(); } catch { /* the loop's problem */ } };
    u.onboundary = () => { try { opts.onBoundary(); } catch { /* the loop's problem */ } };
    u.onend = finish;
    u.onerror = finish;
    if (signal) signal.addEventListener('abort', () => { try { synth.cancel(); } catch { /* nothing to cancel */ } finish(); }, { once: true });
    synth.speak(u);
  });
}

/** A take, decoded at 16 kHz (Chromium resamples to the context's rate). @param {any} file */
async function decodeTake(file) {
  const g = /** @type {any} */ (globalThis);
  const Offline = g.OfflineAudioContext || g.webkitOfflineAudioContext;
  if (typeof Offline !== 'function' || !file) return null;
  const ac = new Offline(1, 1, STT_RATE);
  const buf = await ac.decodeAudioData(await file.arrayBuffer());
  /** @type {Float32Array[]} */ const channels = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
  return { channels, rate: buf.sampleRate, duration: buf.duration };
}

/** A short sine blip on the window's one AudioContext (§5.3 cues). @param {'end'|'listen'} kind */
function blip(kind) {
  const ac = audioContext();
  if (!ac || typeof ac.createOscillator !== 'function') return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const t0 = ac.currentTime;
  osc.frequency.value = kind === 'end' ? 880 : 523;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + CUE_MS / 1000);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.onended = () => { try { gain.disconnect(); } catch { /* gone */ } };
  osc.start(t0);
  osc.stop(t0 + CUE_MS / 1000 + 0.01);
}

/** @param {number} ms @param {AbortSignal} signal @returns {Promise<boolean>} false when aborted */
const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal && signal.aborted) { resolve(false); return; }
  const timer = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(true); }, Math.max(0, ms));
  const onAbort = () => { clearTimeout(timer); resolve(false); };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
});

/** @param {() => void} fn @returns {() => void} */
const frame = (fn) => {
  if (typeof requestAnimationFrame !== 'function') { const h = setTimeout(fn, 16); return () => clearTimeout(h); }
  const h = requestAnimationFrame(() => fn());
  return () => cancelAnimationFrame(h);
};
const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/** The seconds a person reads, one decimal. @param {number|null} ms */
const secs = (ms) => (typeof ms === 'number' ? (Math.round(ms / 100) / 10).toFixed(1) : '–');

// ---- the box -----------------------------------------------------------------------------------------

/** @type {PartSpec} */
export const conversePart = /** @type {any} */ ({
  type: 'converse',
  order: 270,
  label: t('parts.converseLabel'),
  thinks: true,
  // Run all never runs it (§6.6's manual): a conversation is a person's ● Start, and nothing else.
  // Not `volatile` (plan §15.1): that would re-run everything wired after it on every Run all.
  manual: true,
  size: { w: 340, h: 420 },
  minH: 300,
  inputs: [{ name: 'persona', label: t('parts.conversePersona'), accepts: ['text', 'json', 'list'], many: true, required: false }],
  output: 'json',
  defaults: () => Object.fromEntries(Object.entries(VOICE_LIMITS).map(([key, spec]) => [key, /** @type {any} */ (spec).def])),
  /** The run plan's range: one generation per turn, and one more for a greeting. @param {any} part */
  mostGenerations: (part) => { const k = knobs(part && part.settings); return k.maxTurns + (k.greeting ? 1 : 0); },

  render(host, part, ctx) {
    const id = String(part.id);
    const app = ctx && ctx.app;
    const doc = host.ownerDocument || document;
    let live = part;
    let destroyed = false;
    /** @param {string} tag @param {string} cls */
    const make = (tag, cls) => { const e = doc.createElement(tag); e.className = cls; return e; };
    const wrap = make('div', 'graph-converse');

    // The state line: a dot, the state, and the microphone in red while it is on.
    const head = make('div', 'graph-converse-head');
    const dot = make('i', 'graph-converse-dot');
    dot.setAttribute('aria-hidden', 'true');
    const stateText = make('span', 'graph-converse-state');
    stateText.setAttribute('role', 'status');
    const micOn = make('span', 'graph-converse-mic');
    micOn.textContent = t('parts.converseMicOn');
    micOn.title = t('parts.converseMicOnHint');
    head.append(dot, stateText, micOn);

    const meter = make('div', 'graph-converse-meter');
    meter.setAttribute('aria-hidden', 'true');
    const meterFill = make('span', 'graph-converse-meter-fill');
    meter.appendChild(meterFill);

    const you = make('p', 'graph-converse-line graph-converse-you');
    const bot = make('p', 'graph-converse-line graph-converse-bot');
    const times = make('p', 'graph-converse-times');
    times.title = t('parts.converseTimesHint');
    const note = make('p', 'graph-converse-note');
    const noFace = make('p', 'graph-converse-noface');
    noFace.textContent = t('parts.converseNoFace');
    noFace.title = t('parts.converseNoFaceHint');
    const personaNote = make('p', 'graph-converse-noface');
    personaNote.textContent = t('parts.conversePersonaDefault');

    // ● Start is a press (the canvas routes [data-action=press] to the run, like a Button's face);
    // the face notes the press first, and only that press opens the microphone.
    const start = /** @type {HTMLButtonElement} */ (make('button', 'graph-part-control graph-converse-start'));
    start.type = 'button';
    start.dataset.action = 'press';
    start.dataset.part = id;
    start.textContent = t('parts.converseStart');
    start.title = t('parts.converseStartHint');
    start.addEventListener('click', () => { pressStart(id); start.disabled = true; });
    const end = /** @type {HTMLButtonElement} */ (make('button', 'graph-part-control graph-converse-end'));
    end.type = 'button';
    end.dataset.action = 'end';
    end.dataset.part = id;
    end.textContent = t('parts.converseEnd');
    end.title = t('parts.converseEndHint');
    end.addEventListener('click', () => { const s = sessions.get(id); if (s && s.end && typeof s.end.end === 'function') s.end.end(); });
    const buttons = make('div', 'graph-converse-buttons');
    buttons.append(start, end);

    // ---- the knobs (§7) ----
    const set = (/** @type {object} */ patch, /** @type {string} */ what) => { ctx.update(patch); ctx.commit(what); };
    const settingsOf = () => knobs((ctx.part || live).settings);
    /** A slider with its value beside it. @param {string} key @param {string} label @param {string} hint @param {number} step */
    const slider = (key, label, hint, step) => {
      const spec = /** @type {any} */ (VOICE_LIMITS)[key];
      const row = make('label', 'graph-part-field graph-converse-slider');
      row.title = hint;
      const caption = make('span', 'graph-part-field-label');
      caption.textContent = label;
      const input = /** @type {HTMLInputElement} */ (make('input', 'graph-converse-range'));
      input.type = 'range';
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(step);
      const shown = make('span', 'graph-converse-range-value');
      const show = (/** @type {number} */ v) => { shown.textContent = String(v); };
      input.addEventListener('input', () => show(Number(input.value)));
      input.addEventListener('change', () => set({ [key]: Number(input.value) }, label));
      row.append(caption, input, shown);
      return { node: row, update: (/** @type {number} */ v) => { if (doc.activeElement !== input) input.value = String(v); show(v); } };
    };
    const silence = slider('endSilenceMs', t('parts.converseEndSilence'), t('parts.converseEndSilenceHint'), 50);
    const sens = slider('sensitivity', t('parts.converseSensitivity'), t('parts.converseSensitivityHint'), 0.05);
    const inter = checkField(t('parts.converseInterruptible'), settingsOf().interruptible, (on) => set({ interruptible: on }, t('parts.converseInterruptible')));
    inter.node.title = t('parts.converseInterruptibleHint');
    const voicePick = pickerRow(t('parts.converseVoice'), SPEAK_VOICES.map((v) => ({ value: v, label: t(/** @type {any} */ (VOICE_KEY)[v]) })), settingsOf().voice, (v) => set({ voice: v }, t('parts.converseVoice')));
    const langPick = pickerRow(t('parts.converseLanguage'), VOICE_LIMITS.language.list.map((v) => ({ value: v, label: t(/** @type {any} */ (LANG_KEY)[v]) })), settingsOf().language, (v) => set({ language: v }, t('parts.converseLanguage')));
    langPick.title = t('parts.converseLanguageHint');

    // "More": the knobs turned less often.
    const moreBtn = /** @type {HTMLButtonElement} */ (make('button', 'graph-converse-more'));
    moreBtn.type = 'button';
    const more = make('div', 'graph-converse-more-body');
    let open = false;
    const showMore = () => { more.hidden = !open; moreBtn.textContent = `${open ? '▾' : '▸'} ${t('parts.converseMore')}`; moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    moreBtn.addEventListener('click', () => { open = !open; showMore(); });
    let modelSig = optionSig(modelOptions(app));
    const modelPick = pickerRow(t('parts.converseModel'), modelOptions(app), settingsOf().model, (v) => set({ model: v }, t('parts.converseModel')));
    const voiceList = /** @type {HTMLDataListElement} */ (make('datalist', 'graph-converse-voices'));
    voiceList.id = `graph-converse-voices-${id}`;
    const farmVoice = textField(t('parts.converseFarmVoice'), settingsOf().farmVoice, {
      onInput: (v) => ctx.update({ farmVoice: v }),
      onCommit: () => ctx.commit(t('parts.converseFarmVoice')),
      placeholder: 'ff_siwis',
    });
    farmVoice.node.title = t('parts.converseFarmVoiceHint');
    farmVoice.input.setAttribute('list', voiceList.id);
    let voicesFor = '';
    // The farm's voices are asked for once, when a person goes to pick one (one GET, nothing sent).
    farmVoice.input.addEventListener('focus', () => {
      const farm = app && app.farm && typeof app.farm.get === 'function' ? app.farm.get() : null;
      const url = farm && farm.tts && farm.tts.url ? String(farm.tts.url) : '';
      if (!url || url === voicesFor) return;
      voicesFor = url;
      void listVoices({ url }).then((ids) => {
        if (destroyed) return;
        voiceList.replaceChildren(...ids.map((v) => { const opt = doc.createElement('option'); opt.value = v; return opt; }));
      });
    });
    const speed = slider('speed', t('parts.converseSpeed'), t('parts.converseSpeed'), 0.05);
    const pitch = slider('pitch', t('parts.conversePitch'), t('parts.conversePitch'), 0.05);
    const delay = slider('delayMs', t('parts.converseDelay'), t('parts.converseDelayHint'), 250);
    const greet = checkField(t('parts.converseGreeting'), settingsOf().greeting, (on) => set({ greeting: on }, t('parts.converseGreeting')));
    const repair = textField(t('parts.converseNotUnderstood'), settingsOf().notUnderstood, {
      onInput: (v) => ctx.update({ notUnderstood: v }),
      onCommit: () => ctx.commit(t('parts.converseNotUnderstood')),
    });
    repair.node.title = t('parts.converseNotUnderstoodHint');
    const cuePick = pickerRow(t('parts.converseCues'), VOICE_LIMITS.cues.list.map((v) => ({ value: v, label: t(/** @type {any} */ (CUE_KEY)[v]) })), settingsOf().cues, (v) => set({ cues: v }, t('parts.converseCues')));
    const turnsMax = numberField(t('parts.converseMaxTurns'), settingsOf().maxTurns, VOICE_LIMITS.maxTurns.min, (n) => set({ maxTurns: n }, t('parts.converseMaxTurns')), VOICE_LIMITS.maxTurns.max);
    const minsMax = numberField(t('parts.converseMaxMinutes'), settingsOf().maxMinutes, VOICE_LIMITS.maxMinutes.min, (n) => set({ maxMinutes: n }, t('parts.converseMaxMinutes')), VOICE_LIMITS.maxMinutes.max);
    more.append(modelPick, farmVoice.node, voiceList, speed.node, pitch.node, delay.node, greet.node, repair.node, cuePick, turnsMax.node, minsMax.node);

    wrap.append(head, meter, buttons, you, bot, times, note, noFace, personaNote, silence.node, sens.node, inter.node, voicePick, langPick, moreBtn, more);
    host.classList.add('graph-converse-host');
    host.replaceChildren(wrap);

    /** Write text only when it changed: the face repaints every frame while a conversation runs.
     * @param {any} el @param {string} text */
    const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
    /** @param {any} [snapIn] */
    const paint = (snapIn) => {
      if (destroyed) return;
      const s = (snapIn || (sessions.get(id) || {}).snap || null);
      const running = !!(s && s.running);
      const stateName = s ? String(s.state || 'idle') : 'idle';
      host.dataset.voice = stateName;
      setText(stateText, t(/** @type {any} */ (STATE_KEY)[stateName] || STATE_KEY.idle));
      micOn.hidden = !(s && s.mic);
      start.hidden = running;
      start.disabled = busy.has(id);
      end.hidden = !running;
      const level = s ? Math.max(Number(s.level) || 0, Number(s.botLevel) || 0) : 0;
      /** @type {any} */ (meterFill).style.transform = `scaleX(${(running ? level : 0).toFixed(3)})`;
      setText(you, s && s.user ? t('parts.converseYou', { text: s.user }) : '');
      you.hidden = !you.textContent;
      setText(bot, s && s.bot ? t('parts.converseBot', { text: s.bot }) : '');
      bot.hidden = !bot.textContent;
      const ms = s && s.times;
      const sig = ms ? `${ms.heard}|${ms.firstWord}|${ms.firstSound}` : '';
      if (times.dataset.sig !== sig) {
        times.dataset.sig = sig;
        if (ms) {
          const strong = make('strong', 'graph-converse-wait');
          strong.textContent = t('parts.converseFirstSound', { s: secs(ms.firstSound) });
          times.replaceChildren(doc.createTextNode(`${t('parts.converseHeardIn', { s: secs(ms.heard) })} · ${t('parts.converseFirstWord', { s: secs(ms.firstWord) })} · `), strong);
        } else times.replaceChildren();
      }
      times.hidden = !ms;
      setText(note, s && s.note ? String(s.note) : '');
      note.hidden = !note.textContent;
      noFace.hidden = !!liveFace(app);
      const wired = (() => {
        const session = app && app.host && app.host.session;
        const d = session && typeof session.doc === 'function' ? session.doc() : null;
        return !!(d && Array.isArray(d.wires) && d.wires.some((/** @type {any} */ w) => w.to === id && w.port === 'persona'));
      })();
      personaNote.hidden = wired;
    };
    const paintSettings = () => {
      const k = settingsOf();
      silence.update(k.endSilenceMs);
      sens.update(k.sensitivity);
      inter.update(k.interruptible);
      setPicked(voicePick.querySelector('select'), k.voice);
      setPicked(langPick.querySelector('select'), k.language);
      const opts = modelOptions(app);
      const sig = optionSig(opts);
      const sel = /** @type {any} */ (modelPick.querySelector('select'));
      if (sig !== modelSig && sel && doc.activeElement !== sel) {
        modelSig = sig;
        sel.replaceChildren(...opts.map((x) => { const opt = doc.createElement('option'); opt.value = x.value; opt.textContent = x.label; return opt; }));
      }
      if (sel) setPicked(sel, k.model);
      farmVoice.update(k.farmVoice);
      speed.update(k.speed);
      pitch.update(k.pitch);
      delay.update(k.delayMs);
      greet.update(k.greeting);
      repair.update(k.notUnderstood);
      setPicked(cuePick.querySelector('select'), k.cues);
      turnsMax.update(k.maxTurns);
      minsMax.update(k.maxMinutes);
    };
    let set2 = watchers.get(id);
    if (!set2) { set2 = new Set(); watchers.set(id, set2); }
    set2.add(paint);
    // A Preview going ▶ Live does not touch this box: the "No face" line is checked again on the farm's tick.
    const offTick = app && app.bus && typeof app.bus.on === 'function' ? app.bus.on(EV.FARM_TICK, () => paint()) : () => {};
    showMore();
    paintSettings();
    paint();
    return {
      update(next) { live = next || live; paintSettings(); paint(); },
      destroy() {
        destroyed = true;
        // The box was deleted (or undone away) while it talked: nothing could show the microphone any
        // more, or end it — so it ends now. A box only redrawn keeps its conversation.
        const running = sessions.get(id);
        const session = app && app.host && app.host.session;
        const d = session && typeof session.doc === 'function' ? session.doc() : null;
        if (running && running.end && typeof running.end.stop === 'function' && d && !d.parts.some((/** @type {any} */ p) => p.id === id)) running.end.stop();
        const w = watchers.get(id);
        if (w) w.delete(paint);
        try { offTick(); } catch { /* gone */ }
        host.classList.remove('graph-converse-host');
        delete host.dataset.voice;
        host.replaceChildren();
      },
    };
  },

  async run(input) {
    const id = String(input.part.id);
    // Decision 7: only a person's ● Start on this box opens the microphone. Run all never gets here
    // (manual); the title-bar ▶, a Trigger, an MCP run_graph and a wave from upstream carry no press.
    if (!freshPress(id)) {
      // The ▶ in the title bar (or a click) that merged into this box's own live run re-runs it the moment the
      // conversation ends: that hands on the conversation, it never opens the microphone again.
      const ended = endedAt.get(id);
      if (ended && Date.now() - ended < REQUEUE_MS && input.part && input.part.value && input.part.value.kind === 'json') {
        return { value: input.part.value, bar: false };
      }
      throw partFail(t('parts.converseNoPress'), 'part');
    }
    busy.add(id);
    publish(id, { ...((sessions.get(id) || {}).snap || {}), state: 'idle', running: true, mic: false });
    try {
      return await converseRun(input, id);
    } finally {
      settled(id);
    }
  },
});

/** The conversation behind one ● Start (run(), once the press is checked). @param {any} input @param {string} id */
async function converseRun(input, id) {
  const app = input.app;
  const farm = app && app.farm && typeof app.farm.get === 'function' ? app.farm.get() : null;
  const stt = farm && farm.stt && farm.stt.url ? farm.stt : null;
  if (!stt) throw partFail(t('parts.converseNoStt'), 'part');
  const k = knobs(input.part.settings);
  const tts = farm && farm.tts && farm.tts.url ? farm.tts : null;
  const g = /** @type {any} */ (globalThis);
  const localVoice = !!g.speechSynthesis && typeof g.SpeechSynthesisUtterance === 'function';
  const voice = voiceFor(k.voice, !!tts, localVoice);
  if (!voice) throw partFail(k.voice === 'farm' ? t('parts.converseNoFarmVoice') : t('parts.converseNoVoice'), 'part');
  if (!input.ask || typeof input.ask.text !== 'function') throw partFail(t('parts.errNoFarm'), 'no-farm');
  const persona = ((input.inputs && input.inputs.persona) || []).map(textOf).join('\n').trim() || t('parts.converseDefaultPersona');
  const bus = app && app.bus;
  const out = await converse({
    knobs: k,
    persona,
    voice,
    stt: { url: String(stt.url), key: stt.key || null },
    tts,
    signal: input.signal,
    listen: () => openListening({ echoCancellation: true, audioContext }),
    transcribe,
    synth: speakOnFarm,
    play: (bytes, signal, opts) => playBytes(bytes, signal, opts),
    sayLocal: sayLocally,
    ask: (o) => /** @type {any} */ (input.ask).text(o),
    decode: decodeTake,
    face: (ev) => { const f = liveFace(app); if (f && typeof f.send === 'function') f.send(ev); },
    announce: (ev) => { if (bus && typeof bus.emit === 'function') bus.emit(VOICE_BUS, { partId: id, ...ev }); },
    cue: blip,
    now: clock,
    wallNow: () => Date.now(),
    frame,
    sleep,
    watch: (onHidden) => {
      if (!bus || typeof bus.on !== 'function') return () => {};
      const a = bus.on(EV.COMPUTER_SHOWN, (/** @type {any} */ p) => { if (p && p.shown === false) onHidden(); });
      const b = bus.on(EV.VISIBLE, (/** @type {any} */ p) => { if (p && p.pageVisible === false) onHidden(); });
      return () => { a(); b(); };
    },
    shownNow: () => !!(app && app.state && app.state.shown !== false && app.state.pageVisible !== false),
    onChange: (snap) => publish(id, snap),
    onSession: (handles) => { const s = sessions.get(id) || {}; sessions.set(id, { ...s, end: handles }); },
  });
  return out;
}
