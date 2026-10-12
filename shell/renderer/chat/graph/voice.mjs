// @ts-check
// Converse's arithmetic (docs/COMPUTER_VOICE_PLAN.md, contract K-V1). PURE: no DOM, no clock, no
// network, no audio device — every function takes the time and the samples it works on, so the
// whole turn-taking can be driven in Node with a script of levels (test/chat/unit/voice.test.mjs).
//
//   voice activity   vadInit / vadStep / vadQuiet, thresholdFor, rms, levelOf — the numbers of §5.1
//   the turn's sound takeWindow (where the turn is in a recorder's take), toMono16k, resample,
//                    wavBytes (a 16 kHz mono WAV: small, and Whisper's own rate)
//   the answer       nextSentences (cut a streaming answer into sentences), speakable (what a voice
//                    can say: no code, no links, no markdown, no emoji), heardNothing (Whisper's
//                    silence phrases), historyOf (the last turns as chat messages)
//   the face         voiceEvent (the frozen event shape of §4), turnTimes (the wait a person felt)
//   the box          knob / knobs (the clamps of §7)
//
// No prose lives here (lint rule 5): the spoken-style rules and the default persona are strings.

/** What a conversation is doing, as a face reads it (§4). */
export const VOICE_STATES = Object.freeze(['idle', 'listening', 'hearing', 'transcribing', 'thinking', 'speaking', 'ended', 'error']);

/** Every event a face can receive (§4's table). */
export const VOICE_EVENTS = Object.freeze([
  'start', 'listening', 'user.start', 'user.level', 'user.end', 'user.cancel', 'transcript',
  'not.understood', 'thinking', 'bot.text', 'bot.start', 'bot.sentence', 'bot.level', 'bot.end',
  'interrupted', 'turn', 'error', 'ended',
]);

/** Why a conversation ended (`ended {why}`). */
export const ENDED_WHYS = Object.freeze(['end', 'stop', 'limit', 'hidden', 'error']);

/** The private bus name the box announces its events on; computer/devlog.mjs writes them as
 * `voice.*` lines (plan §15.10). */
export const VOICE_BUS = 'voice:event';

/** Text in an event is clipped to this (§4). */
export const TEXT_MAX = 2000;

/** The numbers of §5.1. *tune* marks a starting value to adjust on real microphones. */
export const VAD = Object.freeze({
  calibrateMs: 500,      // the first half second only learns the room
  calibrateTauMs: 150,   // …with this time constant
  floor: 0.012,          // the lowest threshold, whatever the room (*tune*)
  botFactor: 4,          // while the bot speaks the threshold is ×4 … (*tune*)
  botMin: 0.07,          // … and at least this: its voice in the speakers is not an interruption (*tune*)
  botTailMs: 250,        // the room's echo outlives the last sound by about this (*tune*, plan §15.7)
  noiseTauMs: 1500,      // the noise floor follows the room this slowly
  noiseMin: 0.001,
  noiseMax: 0.2,
  onsetMs: 120,          // above the threshold this long is speech (a click is not)
  hysteresis: 0.6,       // inside speech, ×0.6 of the threshold still counts
  minSpeechMs: 300,      // shorter than this is a cough, not a turn
  maxSpeechMs: 30000,    // a monologue ends its turn anyway
  preRollMs: 250,        // kept before the onset (*tune*)
  tailMs: 150,           // kept after the last speech (*tune*)
  maxFrameMs: 250,       // a stalled frame counts as at most this
});

/** The rate the farm's speech to text gets (Whisper's own). */
export const STT_RATE = 16000;

/** The longest sentence the voice gets before it is cut at a comma (§8 K-V1). */
export const SENTENCE_MAX = 160;

/** The knobs of §7: their default and their range. Language is a two-letter code or `auto`. */
export const VOICE_LIMITS = Object.freeze({
  model: { def: '' },
  language: { def: 'auto', list: Object.freeze(['auto', 'fr', 'en', 'es', 'de', 'it', 'pt', 'nl']) },
  voice: { def: 'auto', list: Object.freeze(['auto', 'farm', 'local']) },
  farmVoice: { def: '' },
  speed: { def: 1, min: 0.5, max: 2 },
  pitch: { def: 1, min: 0.5, max: 1.5 },
  endSilenceMs: { def: 800, min: 200, max: 3000, whole: true },
  sensitivity: { def: 0.5, min: 0, max: 1 },
  interruptible: { def: true },
  delayMs: { def: 0, min: 0, max: 8000, whole: true },
  greeting: { def: false },
  notUnderstood: { def: '', max: 200 },
  cues: { def: 'soft', list: Object.freeze(['none', 'soft']) },
  maxTurns: { def: 12, min: 1, max: 40, whole: true },
  maxMinutes: { def: 6, min: 1, max: 9, whole: true },
});

/**
 * One knob, clamped to its range (§7); anything unreadable is the default.
 * @param {string} key @param {any} v @returns {any}
 */
export function knob(key, v) {
  const spec = /** @type {any} */ (VOICE_LIMITS)[key];
  if (!spec) throw new Error(`voice: unknown knob "${key}"`);
  if (typeof spec.def === 'boolean') return typeof v === 'boolean' ? v : spec.def;
  if (typeof spec.def === 'number') {
    const n = typeof v === 'string' && v.trim() ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) return spec.def;
    const c = Math.min(spec.max, Math.max(spec.min, n));
    return spec.whole ? Math.round(c) : c;
  }
  const s = typeof v === 'string' ? v.trim() : '';
  if (spec.list) {
    if (key === 'language') return /^[a-z]{2}$/.test(s) || s === 'auto' ? s : spec.def;
    return spec.list.includes(s) ? s : spec.def;
  }
  if (key === 'farmVoice') return /^[\w+.-]{0,64}$/.test(s) ? s : spec.def;
  if (key === 'model') return s.slice(0, 200);
  return s.slice(0, spec.max || 200);
}

/** Every knob of a box's settings, clamped. @param {any} settings @returns {Record<string, any>} */
export function knobs(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  /** @type {Record<string, any>} */ const out = {};
  for (const key of Object.keys(VOICE_LIMITS)) out[key] = knob(key, s[key]);
  return out;
}

// ---- voice activity (§5.1) ------------------------------------------------------------------------

/** Root mean square of a block of samples. @param {ArrayLike<number>} block @returns {number} */
export function rms(block) {
  const n = block && block.length ? block.length : 0;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) { const x = Number(block[i]) || 0; sum += x * x; }
  return Math.sqrt(sum / n);
}

/** A level 0..1 for a face, from an RMS (speech is ~0.02–0.3). *tune* @param {number} r @returns {number} */
export function levelOf(r) {
  const x = Number(r);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.min(1, Math.sqrt(x / 0.25));
}

/** The speech threshold for a room's noise and a sensitivity 0..1 (§5.1).
 * @param {number} noise @param {number} sensitivity @returns {number} */
export function thresholdFor(noise, sensitivity) {
  const s = Math.min(1, Math.max(0, Number(sensitivity) || 0));
  const n = Math.max(0, Number(noise) || 0);
  return Math.max(VAD.floor * (1.6 - s), n * (4 - 2.5 * s));
}

/** @param {number} n */
const clampNoise = (n) => Math.min(VAD.noiseMax, Math.max(VAD.noiseMin, n));
/** An exponential average stepped by `dt` ms with time constant `tau`. */
const ema = (/** @type {number} */ avg, /** @type {number} */ x, /** @type {number} */ dt, /** @type {number} */ tau) => avg + (x - avg) * (1 - Math.exp(-dt / tau));

/**
 * @typedef {{phase: 'calibrating'|'silence'|'speech', at: number|null, elapsed: number,
 *   noise: number, primed: boolean, above: number, quiet: number,
 *   speechStart: number|null, lastSpeech: number|null}} VadState
 */

/** A detector that has heard nothing yet. @returns {VadState} */
export function vadInit() {
  return { phase: 'calibrating', at: null, elapsed: 0, noise: VAD.noiseMin, primed: false, above: 0, quiet: 0, speechStart: null, lastSpeech: null };
}

/** Listen afresh (the bot stopped speaking), keeping what was learnt about the room (plan §15.6).
 * @param {VadState} s @returns {VadState} */
export function vadQuiet(s) {
  return { ...s, phase: s.phase === 'calibrating' ? 'calibrating' : 'silence', above: 0, quiet: 0 };
}

/**
 * One frame of the detector (§5.1). `t` in ms (one monotonic clock), `level` an RMS.
 * `ev`: 'start' (speech began; `at.speechStart` is back-dated by the onset), 'end' (the end-of-turn
 * silence was reached after at least minSpeechMs of speech), 'cancel' (a sound too short to be a
 * turn), or null.
 * @param {VadState} state
 * @param {{level: number, t: number, sensitivity: number, endSilenceMs: number, botSpeaking?: boolean}} f
 * @returns {{s: VadState, ev: 'start'|'end'|'cancel'|null, at: {speechStart: number|null, lastSpeech: number|null}, threshold: number}}
 */
export function vadStep(state, f) {
  const t = Number(f.t) || 0;
  const level = Math.max(0, Number.isFinite(Number(f.level)) ? Number(f.level) : 0);
  const dt = state.at === null ? 0 : Math.min(VAD.maxFrameMs, Math.max(0, t - state.at));
  /** @type {VadState} */ const s = { ...state, at: t, elapsed: state.elapsed + dt };
  /** @type {'start'|'end'|'cancel'|null} */ let ev = null;
  const done = (/** @type {number} */ thr) => ({ s, ev, at: { speechStart: s.speechStart, lastSpeech: s.lastSpeech }, threshold: thr });

  if (s.phase === 'calibrating') {
    // The room is learnt from the room: while the bot speaks (a greeting), calibration waits.
    if (f.botSpeaking) { s.elapsed = state.elapsed; return done(Math.max(thresholdFor(s.noise, f.sensitivity) * VAD.botFactor, VAD.botMin)); }
    s.noise = clampNoise(s.primed ? ema(s.noise, level, dt, VAD.calibrateTauMs) : level);
    s.primed = true;
    if (s.elapsed >= VAD.calibrateMs) s.phase = 'silence';
    return done(thresholdFor(s.noise, f.sensitivity));
  }

  const base = thresholdFor(s.noise, f.sensitivity);
  const thr = f.botSpeaking ? Math.max(base * VAD.botFactor, VAD.botMin) : base;

  if (s.phase === 'silence') {
    if (level > thr) {
      s.above = state.above + dt;
      if (s.above >= VAD.onsetMs) {
        s.phase = 'speech';
        s.speechStart = t - s.above;
        s.lastSpeech = t;
        s.quiet = 0;
        ev = 'start';
      }
    } else {
      s.above = 0;
      // The room is learnt only in silence, and never from the bot's own voice.
      if (!f.botSpeaking) s.noise = clampNoise(ema(s.noise, level, dt, VAD.noiseTauMs));
    }
    return done(thr);
  }

  // Inside speech: the hysteresis keeps a soft syllable in the turn.
  if (level > thr * VAD.hysteresis) { s.lastSpeech = t; s.quiet = 0; } else s.quiet = state.quiet + dt;
  const endSilence = knob('endSilenceMs', f.endSilenceMs);
  const monologue = s.speechStart !== null && t - s.speechStart >= VAD.maxSpeechMs;
  if (s.quiet >= endSilence || monologue) {
    const spoke = (Number(s.lastSpeech) || 0) - (Number(s.speechStart) || 0);
    ev = spoke >= VAD.minSpeechMs ? 'end' : 'cancel';
    s.phase = 'silence';
    s.above = 0;
    s.quiet = 0;
  }
  return done(thr);
}

// ---- the turn's sound (§2.6) -------------------------------------------------------------------

/**
 * Where the turn is inside a recorder's take, in seconds from the take's start: from the onset
 * less the pre-roll to the last speech plus the tail, inside [0, duration]. A window that makes no
 * sense (the clocks disagree) is the whole take.
 * @param {{takeStart: number, speechStart: number, lastSpeech: number, duration: number}} o
 * @returns {{from: number, to: number}}
 */
export function takeWindow(o) {
  const duration = Math.max(0, Number(o.duration) || 0);
  const from = Math.min(duration, Math.max(0, (Number(o.speechStart) - VAD.preRollMs - Number(o.takeStart)) / 1000));
  const to = Math.min(duration, Math.max(0, (Number(o.lastSpeech) + VAD.tailMs - Number(o.takeStart)) / 1000));
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) return { from: 0, to: duration };
  return { from, to };
}

/**
 * Resample with linear interpolation; going down, each output sample is first averaged over the
 * input samples it covers (a box filter), so a 48 kHz take does not alias into 16 kHz.
 * @param {Float32Array} input @param {number} fromRate @param {number} toRate @returns {Float32Array}
 */
export function resample(input, fromRate, toRate) {
  const a = Number(fromRate) || 0;
  const b = Number(toRate) || 0;
  if (!input || !input.length || a <= 0 || b <= 0) return new Float32Array(0);
  if (a === b) return Float32Array.from(input);
  const n = Math.max(1, Math.round(input.length * b / a));
  const out = new Float32Array(n);
  const step = a / b;
  if (step > 1) {
    for (let i = 0; i < n; i++) {
      const lo = Math.floor(i * step);
      const hi = Math.min(input.length, Math.max(lo + 1, Math.floor((i + 1) * step)));
      let sum = 0;
      for (let j = lo; j < hi; j++) sum += input[j];
      out[i] = sum / (hi - lo);
    }
    return out;
  }
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const k = Math.min(input.length - 1, j + 1);
    const f = x - j;
    out[i] = input[Math.min(j, input.length - 1)] * (1 - f) + input[k] * f;
  }
  return out;
}

/**
 * The turn as Whisper wants it: the channels mixed to mono, cut to [from, to] seconds, at 16 kHz.
 * @param {Float32Array[]} channels @param {number} rate @param {number} from @param {number} to
 * @returns {Float32Array}
 */
export function toMono16k(channels, rate, from, to) {
  const list = Array.isArray(channels) ? channels.filter((c) => c && c.length) : [];
  if (!list.length || !(rate > 0)) return new Float32Array(0);
  const len = Math.min(...list.map((c) => c.length));
  const a = Math.max(0, Math.min(len, Math.floor(from * rate)));
  const b = Math.max(a, Math.min(len, Math.ceil(to * rate)));
  const mono = new Float32Array(b - a);
  for (const c of list) for (let i = a; i < b; i++) mono[i - a] += c[i] / list.length;
  return resample(mono, rate, STT_RATE);
}

/**
 * A 16-bit PCM mono WAV of these samples (-1..1, clipped).
 * @param {Float32Array} samples @param {number} rate @returns {Uint8Array}
 */
export function wavBytes(samples, rate) {
  const n = samples ? samples.length : 0;
  const r = Math.max(1, Math.round(Number(rate) || STT_RATE));
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const ascii = (/** @type {number} */ at, /** @type {string} */ s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);        // PCM
  v.setUint16(22, 1, true);        // mono
  v.setUint32(24, r, true);
  v.setUint32(28, r * 2, true);    // bytes per second
  v.setUint16(32, 2, true);        // bytes per frame
  v.setUint16(34, 16, true);       // bits per sample
  ascii(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, Number(samples[i]) || 0));
    v.setInt16(44 + i * 2, x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff), true);
  }
  return new Uint8Array(buf);
}

// ---- the answer ----------------------------------------------------------------------------------

/** Words a dot follows without ending a sentence ("M. Dupont", "etc. and"). Compared lower-case. */
const ABBREVIATIONS = new Set(['m', 'mm', 'mme', 'mmes', 'mlle', 'mr', 'mrs', 'ms', 'dr', 'st', 'ste', 'prof', 'etc', 'cf', 'ex', 'vs', 'p', 'pp', 'no', 'env', 'approx', 'e.g', 'i.e', 'av', 'bd', 'jr', 'sr']);
const ENDS = '.!?…';
const CLOSERS = '.!?…"\'»)]”’';

/** Is the dot at `dot` the end of an abbreviation? @param {string} text @param {number} start @param {number} dot */
function abbreviated(text, start, dot) {
  const m = /([A-Za-zÀ-ÖØ-öø-ÿ.]+)$/.exec(text.slice(start, dot));
  if (!m) return false;
  const word = m[1];
  if (word.length === 1 && word === word.toUpperCase() && word !== word.toLowerCase()) return true;   // an initial: "J."
  return ABBREVIATIONS.has(word.toLowerCase());
}

/** Split a sentence over SENTENCE_MAX at its last comma, as many times as it takes.
 * @param {string} s @returns {string[]} */
function splitLong(s) {
  const out = [];
  let rest = s;
  while (rest.length > SENTENCE_MAX) {
    const k = rest.lastIndexOf(',', SENTENCE_MAX);
    if (k < 20) break;
    out.push(rest.slice(0, k + 1).trim());
    rest = rest.slice(k + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Cut the complete sentences out of a streaming answer, from character `from` on. A sentence ends
 * at `. ! ? …` (closing quotes and brackets ride along) followed by whitespace, or at a blank line;
 * never inside "3.5", never after "M." or "etc."; one over 160 characters is cut at its last comma,
 * and an unfinished one that is already that long is cut too, so a run-on answer still starts
 * speaking. `final` flushes what is left. `next` is where the following call starts.
 * @param {string} text @param {number} from @param {boolean} [final]
 * @returns {{sentences: string[], next: number}}
 */
export function nextSentences(text, from, final) {
  const src = String(text || '');
  /** @type {string[]} */ const sentences = [];
  let start = Math.max(0, Math.min(src.length, Number(from) || 0));
  const push = (/** @type {number} */ a, /** @type {number} */ b) => {
    const s = src.slice(a, b).trim();
    if (s) for (const piece of splitLong(s)) sentences.push(piece);
  };
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n' && /^\n[ \t]*\n/.test(src.slice(i, i + 64))) {
      const blank = /^\n[ \t]*\n/.exec(src.slice(i, i + 64));
      const j = i + (blank ? blank[0].length : 2);
      push(start, i);
      start = j;
      i = j;
      continue;
    }
    if (ENDS.includes(c)) {
      let j = i + 1;
      // Closing marks ride along — with French spacing too: « oui. » keeps its guillemet.
      for (;;) {
        if (j < src.length && CLOSERS.includes(src[j])) { j++; continue; }
        if (j + 1 < src.length && /[ \u00a0\u202f]/.test(src[j]) && '»”)]'.includes(src[j + 1])) { j += 2; continue; }
        break;
      }
      if (j >= src.length) break;                     // nothing after it yet: "3." may become "3.5"
      if (/\s/.test(src[j])) {
        if (c === '.' && abbreviated(src, start, i)) { i = j; continue; }
        push(start, j);
        start = j;
      }
      i = j;
      continue;
    }
    i++;
  }
  if (final) {
    push(start, src.length);
    start = src.length;
  } else {
    // A long unfinished sentence: say up to its last comma now.
    for (;;) {
      if (src.length - start <= SENTENCE_MAX) break;
      const k = src.lastIndexOf(',', start + SENTENCE_MAX);
      if (k < start + 20) break;
      push(start, k + 1);
      start = k + 1;
    }
  }
  return { sentences, next: start };
}

const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}]/gu;

/**
 * What a voice can say: no thinking, no code, no link targets or addresses, no headings, bullets,
 * emphasis or emoji. A sentence that was only code says nothing ('').
 * @param {string} text @returns {string}
 */
export function speakable(text) {
  let s = String(text || '');
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, ' ').replace(/<\/?think>/gi, ' ');
  s = s.replace(/```[\s\S]*?```/g, ' ').replace(/```[\s\S]*$/g, ' ');
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/<?\bhttps?:\/\/[^\s>)]+>?/gi, ' ').replace(/\bwww\.[^\s)]+/gi, ' ');
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');
  s = s.replace(/^[ \t]*(?:[-*+•]|\d{1,3}[.)])[ \t]+/gm, '');
  s = s.replace(/^[ \t]*>[ \t]?/gm, '');
  s = s.replace(/(\*\*|__)([\s\S]*?)\1/g, '$2').replace(/(^|[^\w*])\*(\S(?:[^*]*?\S)?)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w])_(\S(?:[^_]*?\S)?)_(?!\w)/g, '$1$2');
  s = s.replace(/`+/g, '').replace(/[*~]+/g, '');
  s = s.replace(EMOJI, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** What Whisper writes for silence, music or nothing (compared WHOLE, after `plain`). */
const SILENCE = new Set([
  "sous-titres réalisés par la communauté d'amara.org",
  "sous-titres réalisés para la communauté d'amara.org",
  "sous-titrage st' 501",
  'sous-titrage société radio-canada',
  "merci d'avoir regardé",
  "merci d'avoir regardé cette vidéo",
  'thank you for watching',
  'thanks for watching',
  'subtitles by the amara.org community',
  'musique', 'music', 'applaudissements', 'applause', 'rires', 'laughter', 'silence',
  'you',
]);

/** Lower case, curly apostrophes made straight, brackets and outer punctuation dropped. @param {string} s */
function plain(s) {
  return String(s || '').toLowerCase().normalize('NFC').replace(/[’`]/g, "'")
    .replace(/[[\](){}«»"“”!?¡¿…,;:♪*]/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/^[.\s'-]+|[.\s'-]+$/g, '');
}

/**
 * Did Whisper write nothing usable? Empty, punctuation or music marks only, or one of its known
 * silence phrases as the WHOLE text — so "Non merci." and a real sentence containing
 * "merci d'avoir regardé" pass.
 * @param {string} text @returns {boolean}
 */
export function heardNothing(text) {
  const p = plain(text);
  if (!/[\p{L}\p{N}]/u.test(p)) return true;
  return SILENCE.has(p);
}

/**
 * The last `keep` turns as chat messages, oldest first, person then bot. A turn with nothing said
 * by one side is left out whole, so the roles always alternate (some chat templates refuse
 * two person messages in a row).
 * @param {{user?: string, bot?: string}[]} turns @param {number} keep
 * @returns {{role: 'user'|'assistant', content: string}[]}
 */
export function historyOf(turns, keep) {
  const list = (Array.isArray(turns) ? turns : []).filter((x) => x && String(x.user || '').trim() && String(x.bot || '').trim());
  const k = Math.max(0, Math.floor(Number(keep) || 0));
  /** @type {{role: 'user'|'assistant', content: string}[]} */ const out = [];
  for (const x of k ? list.slice(-k) : []) {
    out.push({ role: 'user', content: String(x.user).trim() });
    out.push({ role: 'assistant', content: String(x.bot).trim() });
  }
  return out;
}

// ---- the face (§4) ------------------------------------------------------------------------------

/** @param {any} v */
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/**
 * One event as a face receives it: `{type, state, t, ...data}`. Only strings (clipped to
 * TEXT_MAX), finite numbers, booleans and the `ms` object of whole numbers or null cross.
 * Throws on a type or a state §4 does not name.
 * @param {string} type @param {string} state @param {Record<string, any>|null|undefined} data @param {number} t
 * @returns {Record<string, any>}
 */
export function voiceEvent(type, state, data, t) {
  if (!VOICE_EVENTS.includes(type)) throw new Error(`voice: unknown event "${type}"`);
  if (!VOICE_STATES.includes(state)) throw new Error(`voice: unknown state "${state}"`);
  /** @type {Record<string, any>} */ const ev = { type, state, t: Math.max(0, Math.round(Number(t) || 0)) };
  for (const [k, v] of Object.entries(data && typeof data === 'object' ? data : {})) {
    if (k === 'type' || k === 'state' || k === 't') continue;
    if (typeof v === 'string') ev[k] = v.length > TEXT_MAX ? v.slice(0, TEXT_MAX) : v;
    else if (typeof v === 'number') { if (Number.isFinite(v)) ev[k] = v; }
    else if (typeof v === 'boolean') ev[k] = v;
    else if (k === 'ms' && v && typeof v === 'object') {
      ev.ms = { heard: numOrNull(v.heard), stt: numOrNull(v.stt), firstWord: numOrNull(v.firstWord), firstSound: numOrNull(v.firstSound), total: numOrNull(v.total) };
    }
  }
  return ev;
}

/**
 * A turn's timings (§4's `ms`), from the moments it went through, all on one clock. `firstSound`
 * (end of speech → the first sound of the answer) is the wait a person feels.
 * @param {{endOfSpeech?: number, sttStart?: number, sttEnd?: number, asked?: number, firstToken?: number,
 *   firstSound?: number, saidAll?: number}} m
 * @returns {{heard: number|null, stt: number|null, firstWord: number|null, firstSound: number|null, total: number|null}}
 */
export function turnTimes(m) {
  const o = m || {};
  /** @param {any} a @param {any} b */
  const d = (a, b) => (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round(b - a) : null);
  return {
    heard: d(o.endOfSpeech, o.sttEnd),
    stt: d(o.sttStart, o.sttEnd),
    firstWord: d(o.asked, o.firstToken),
    firstSound: d(o.endOfSpeech, o.firstSound),
    total: d(o.endOfSpeech, o.saidAll),
  };
}
