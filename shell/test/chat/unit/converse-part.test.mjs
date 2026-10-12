// @ts-check
// The Converse box (docs/COMPUTER_VOICE_PLAN.md §5, §11): whole conversations driven in Node. The loop
// is `converse(deps)`; here every device and door is a fake on ONE virtual clock — a microphone whose
// level is a script, a speech to text that answers after 200 ms, a model that streams a sentence every
// 100 ms, a voice that takes 20 ms a character — so the order of events, the interruptions and the
// timings are exact. The consent rules are also proven through the box's real `run()`: no press, no
// microphone; the Computer left or the window hidden, the conversation ends and the microphone closes.
import assert from 'node:assert/strict';
import { converse, conversePart, notePress, consumePress, clearConversations, SPOKEN_MAX_TOKENS } from '../../../renderer/chat/graph/parts/converse.mjs';
import { clearPresses } from '../../../renderer/chat/graph/parts/button.mjs';
import { knobs } from '../../../renderer/chat/graph/voice.mjs';
import { createBus, EV } from '../../../renderer/chat/core/events.mjs';
import { runTool, CONVERSE_NOTE } from '../../../renderer/chat/computer/mcp-tools.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';

const FRAME = 1000 / 60;
const QUIET = 0.004;
const VOICE = 0.15;

/** Speech in these [from, to) ms windows at `level`, a quiet room elsewhere. @param {Array<[number, number, number?]>} spans */
const speech = (spans) => (/** @type {number} */ t) => {
  for (const [a, b, level] of spans) if (t >= a && t < b) return level ?? VOICE;
  return QUIET;
};
const macrotask = () => new Promise((r) => setImmediate(r));

/**
 * One fake world on a virtual clock.
 * @param {{settings?: any, level?: (t: number, w: any) => number, voice?: 'farm'|'local',
 *   stt?: (n: number, req: any) => {ms?: number, out: any}, answer?: (n: number, req: any) => string[],
 *   firstMs?: number, chunkMs?: number, sayMs?: number, capped?: number, micFails?: string, shown?: boolean}} [o]
 */
function world(o = {}) {
  /** @type {any} */ const w = {
    t: 0, timers: [], frames: [], events: [], log: [], stts: [], asks: [], synths: [], plays: [], cues: [],
    aborts: 0, askEnds: [], playAborted: 0, shown: o.shown !== false, endFn: null, hiddenFn: null, listened: 0,
  };
  const later = (/** @type {number} */ ms, /** @type {() => void} */ fn) => { w.timers.push({ at: w.t + ms, fn }); };
  /** A promise that settles on the virtual clock, or at once with `aborted` when the signal fires. */
  const after = (/** @type {number} */ ms, /** @type {any} */ value, /** @type {AbortSignal|undefined} */ signal, /** @type {any} */ aborted) => new Promise((resolve) => {
    if (signal && signal.aborted) { resolve(aborted); return; }
    let over = false;
    later(ms, () => { if (!over) { over = true; resolve(value); } });
    if (signal) signal.addEventListener('abort', () => { if (!over) { over = true; resolve(aborted); } }, { once: true });
  });
  const mic = {
    closed: false, takes: 0, ended: 0, dropped: 0, takeAt: 0,
    level: () => (o.level ? o.level(w.t, w) : QUIET),
    startTake() { mic.takes++; mic.takeAt = w.t; return w.t; },
    takeStart: () => mic.takeAt,
    endTake() {
      mic.ended++;
      const durMs = w.t - mic.takeAt;
      return Promise.resolve({ type: 'audio/webm', size: 99, durMs, arrayBuffer: async () => new ArrayBuffer(16) });
    },
    dropTake() { mic.dropped++; },
    close() { mic.closed = true; },
  };
  w.mic = mic;
  w.runAc = new AbortController();
  const chunksFor = o.answer || (() => ['Bonjour. ', 'Je suis là. ', 'Et vous ?']);
  w.deps = {
    knobs: knobs({ cues: 'none', ...(o.settings || {}) }),
    persona: 'Tu es Margot.',
    voice: o.voice || 'farm',
    stt: { url: 'http://farm/stt', key: 'k' },
    tts: { url: 'http://farm/tts/v1', voice: 'af_heart', model: 'kokoro' },
    signal: w.runAc.signal,
    listen: async () => {
      w.listened++;
      if (o.micFails) throw Object.assign(new Error('no'), { code: o.micFails });
      return mic;
    },
    transcribe: (/** @type {any} */ req) => {
      w.stts.push({ ...req, at: w.t });
      const r = (o.stt || ((n) => ({ out: { text: `phrase ${n}`, language: 'fr', duration: 1, ms: 5 } })))(w.stts.length, req);
      return after(r.ms ?? 200, r.out, req.signal, { error: 'aborted', code: 'aborted' });
    },
    synth: (/** @type {any} */ req) => {
      w.synths.push({ text: req.text, at: w.t, speed: req.speed, voice: req.voice });
      return after(50, { bytes: { text: req.text } }, req.signal, { error: 'aborted', code: 'aborted' });
    },
    play: (/** @type {any} */ bytes, /** @type {AbortSignal} */ signal, /** @type {any} */ h) => {
      w.plays.push({ text: bytes.text, at: w.t });
      h.onStart();
      h.onLevel(0.1);
      return after((o.sayMs || 20) * bytes.text.length, { ok: true, seconds: 1 }, signal, { ok: true, seconds: 0, cut: true })
        .then((r) => { if (r.cut) w.playAborted++; return r; });
    },
    sayLocal: (/** @type {string} */ text, /** @type {AbortSignal} */ signal, /** @type {any} */ h) => {
      w.plays.push({ text, at: w.t, local: true, lang: h.lang });
      h.onStart();
      h.onBoundary();
      return after((o.sayMs || 20) * text.length, true, signal, true);
    },
    ask: (/** @type {any} */ req) => {
      w.asks.push({ ...req, at: w.t });
      if (o.capped && w.asks.length >= o.capped) return Promise.reject(Object.assign(new Error('capped'), { reason: 'capped' }));
      const chunks = chunksFor(w.asks.length, req);
      return new Promise((resolve) => {
        let text = '';
        let i = 0;
        let over = false;
        const done = (/** @type {any} */ r) => { if (!over) { over = true; resolve(r); } };
        req.signal.addEventListener('abort', () => { if (!over) w.aborts++; done({ ok: false, value: null, error: { kind: 'aborted', message: 'stopped' } }); }, { once: true });
        const next = () => {
          if (over) return;
          if (i >= chunks.length) { w.askEnds.push(w.t); done({ ok: true, value: text, finishReason: 'stop', ms: 1 }); return; }
          text += chunks[i++];
          req.onText(text);
          later(o.chunkMs ?? 100, next);
        };
        later(o.firstMs ?? 150, next);
      });
    },
    decode: async (/** @type {any} */ file) => ({ channels: [new Float32Array(Math.max(1, Math.round(file.durMs / 1000 * 16000)))], rate: 16000, duration: file.durMs / 1000 }),
    face: (/** @type {any} */ ev) => { w.events.push(ev); },
    announce: (/** @type {any} */ ev) => { w.log.push(ev); },
    cue: (/** @type {string} */ k) => { w.cues.push(k); },
    now: () => w.t,
    wallNow: () => Date.UTC(2026, 9, 12, 15, 0, 0),
    frame: (/** @type {() => void} */ fn) => { const e = { fn, dead: false }; w.frames.push(e); return () => { e.dead = true; }; },
    sleep: (/** @type {number} */ ms, /** @type {AbortSignal} */ signal) => after(ms, true, signal, false),
    watch: (/** @type {() => void} */ fn) => { w.hiddenFn = fn; return () => { w.hiddenFn = null; }; },
    shownNow: () => w.shown,
    onChange: () => {},
    onSession: (/** @type {any} */ fn) => { w.endFn = fn; },
  };
  /** One frame: timers due, then animation frames, then everything they awaited. */
  w.tick = async () => {
    w.t += FRAME;
    const due = w.timers.filter((/** @type {any} */ x) => x.at <= w.t).sort((/** @type {any} */ a, /** @type {any} */ b) => a.at - b.at);
    w.timers = w.timers.filter((/** @type {any} */ x) => x.at > w.t);
    for (const x of due) x.fn();
    await macrotask();
    const frames = w.frames;
    w.frames = [];
    for (const f of frames) if (!f.dead) f.fn();
    await macrotask();
  };
  w.until = async (/** @type {() => any} */ pred, maxMs = 60000) => {
    const end = w.t + maxMs;
    while (!pred()) {
      if (w.t > end) throw new Error(`timed out at t=${Math.round(w.t)}: ${w.kinds().join(' ')}`);
      await w.tick();
    }
  };
  /** Start a conversation; `w.done` holds its outcome once it ends. */
  w.start = () => {
    w.result = undefined;
    w.error = undefined;
    w.over = false;
    w.promise = converse(w.deps).then((r) => { w.result = r; w.over = true; }, (e) => { w.error = e; w.over = true; });
    return w.promise;
  };
  w.finished = () => w.until(() => w.over);
  w.kinds = () => w.events.filter((/** @type {any} */ e) => !['user.level', 'bot.level', 'bot.text'].includes(e.type)).map((/** @type {any} */ e) => e.type);
  w.of = (/** @type {string} */ type) => w.events.filter((/** @type {any} */ e) => e.type === type);
  return w;
}

export default (test) => {
  test('converse: one turn, in the order of §4 — and the first sentence is spoken before the answer ends', async () => {
    const w = world({ level: speech([[1000, 2000]]), settings: { cues: 'soft' } });
    w.start();
    await w.until(() => w.of('turn').length === 1);
    w.endFn();
    await w.finished();
    assert.deepEqual(w.kinds(), [
      'start', 'listening', 'user.start', 'user.end', 'transcript', 'thinking',
      'bot.start', 'bot.sentence', 'bot.sentence', 'bot.sentence', 'bot.end', 'turn', 'listening', 'ended',
    ]);
    assert.deepEqual(w.of('bot.sentence').map((/** @type {any} */ e) => [e.index, e.text]), [[0, 'Bonjour.'], [1, 'Je suis là.'], [2, 'Et vous ?']]);
    assert.ok(w.synths[0].at < w.askEnds[0], `the voice was asked for the first sentence (t=${Math.round(w.synths[0].at)}) before the answer ended (t=${Math.round(w.askEnds[0])})`);
    assert.ok(w.plays[0].at < w.askEnds[0], 'and it was heard before the answer ended');
    assert.equal(w.of('ended')[0].why, 'end');
    assert.equal(w.mic.closed, true, 'the microphone closed');
    assert.ok(w.of('user.level').length > 10, 'the face hears the microphone level');
    assert.ok(w.of('user.level').every((/** @type {any} */ e) => e.level >= 0 && e.level <= 1));
    assert.deepEqual(w.cues.slice(0, 2), ['end', 'listen'], 'soft cues at the end of the turn, and back to listening');
    // What was asked: the persona and the spoken rules, the words, thinking off, short, never cached.
    const ask = w.asks[0];
    assert.equal(ask.prompt, 'phrase 1');
    assert.ok(ask.system.startsWith('Tu es Margot.') && ask.system.includes(t('parts.converseSpokenRules')));
    assert.equal(ask.thinking, false);
    assert.equal(ask.maxTokens, SPOKEN_MAX_TOKENS);
    assert.equal(ask.cache, false);
    assert.deepEqual(ask.history, []);
    // The value (K-V9) is the transcript, with the wait a person felt.
    const v = w.result.value;
    assert.equal(v.kind, 'json');
    assert.deepEqual(Object.keys(v.data).sort(), ['persona', 'settings', 'startedAt', 'turns', 'why']);
    assert.equal(v.data.why, 'end');
    assert.equal(v.data.startedAt, '2026-10-12T15:00:00.000Z');
    assert.equal(v.data.turns.length, 1);
    const turn = v.data.turns[0];
    assert.deepEqual({ user: turn.user, bot: turn.bot, interrupted: turn.interrupted }, { user: 'phrase 1', bot: 'Bonjour. Je suis là. Et vous ?', interrupted: false });
    assert.ok(turn.ms.firstSound > 800 && turn.ms.firstSound < 2000, `first sound after the end-of-turn silence: ${turn.ms.firstSound}`);
    assert.ok(turn.ms.stt >= 200 && turn.ms.stt <= 200 + FRAME + 1, `the STT request alone: ${turn.ms.stt} (to a frame)`);
    assert.ok(turn.ms.total > turn.ms.firstSound);
    assert.equal(w.result.bar, false);
    // The Record log hears every event too.
    assert.ok(w.log.some((/** @type {any} */ e) => e.type === 'turn'));
  });

  test('converse: the turn sent to the farm is the window of the take, as a 16 kHz WAV, in the language set', async () => {
    const w = world({ level: speech([[1000, 2500]]), settings: { language: 'fr' } });
    w.start();
    await w.until(() => w.stts.length === 1);
    w.runAc.abort();
    await w.finished();
    const req = w.stts[0];
    assert.equal(req.name, 'turn.wav');
    assert.equal(req.mime, 'audio/wav');
    assert.equal(req.language, 'fr');
    const seconds = (req.bytes.length - 44) / 2 / 16000;
    assert.ok(seconds > 1.5 && seconds < 2.1, `the speech with its pre-roll and tail, not the whole take: ${seconds.toFixed(2)} s`);
    assert.equal(w.of('ended')[0].why, 'stop');
  });

  test('converse: nothing heard is "not understood" — no generation, and the repair line is said', async () => {
    const w = world({ level: speech([[1000, 1800]]), stt: () => ({ out: { text: 'Sous-titres réalisés par la communauté d\'Amara.org' } }), settings: { notUnderstood: 'Pardon ?' } });
    w.start();
    await w.until(() => w.of('not.understood').length === 1 && w.of('listening').length === 2);
    assert.equal(w.asks.length, 0, 'no generation spent');
    assert.deepEqual(w.plays.map((/** @type {any} */ p) => p.text), ['Pardon ?']);
    assert.equal(w.of('turn').length, 0);
    w.endFn();
    await w.finished();
    assert.equal(w.result.bar, true, 'no turn of the person\'s: nothing downstream runs');
  });

  test('converse: talking over the bot interrupts it — the answer is aborted, what was said is kept, the next turn is answered', async () => {
    const long = 'Première phrase assez longue pour durer un moment. ';
    const w = world({
      level: speech([[1000, 2000], [4200, 5200, 0.4]]),
      answer: (n) => (n === 1 ? [long, 'Deuxième phrase. ', 'Troisième.'] : ['Oui ?']),
      chunkMs: 1500,
      sayMs: 60,
    });
    w.start();
    await w.until(() => w.of('turn').length === 2);
    w.endFn();
    await w.finished();
    const k = w.kinds();
    assert.ok(k.indexOf('interrupted') > k.indexOf('bot.start'), k.join(' '));
    assert.equal(w.of('interrupted')[0].said, long.trim());
    assert.ok(w.aborts >= 1, 'the model was stopped');
    assert.ok(w.playAborted >= 1, 'the voice was stopped');
    const turns = w.result.value.data.turns;
    assert.deepEqual(turns.map((/** @type {any} */ x) => [x.user, x.bot, x.interrupted]), [['phrase 1', long.trim(), true], ['phrase 2', 'Oui ?', false]]);
    assert.deepEqual(w.asks[1].history, [{ role: 'user', content: 'phrase 1' }, { role: 'assistant', content: long.trim() }], 'what was said is the history');
    assert.equal(w.stts.length, 2);
  });

  test('converse: without Interruptible the bot is not stopped, and the take it spoke over is dropped', async () => {
    const w = world({ level: speech([[1000, 2000], [3400, 4400, 0.4]]), settings: { interruptible: false }, sayMs: 60 });
    w.start();
    await w.until(() => w.of('turn').length === 1);
    const takes = w.mic.takes;
    await w.until(() => w.of('listening').length === 2);
    w.endFn();
    await w.finished();
    assert.equal(w.of('interrupted').length, 0);
    assert.equal(w.plays.length, 3, 'every sentence said');
    assert.equal(w.asks.length, 1, 'the voice over it was not a turn');
    assert.ok(takes >= 2, 'a fresh take after the bot spoke');
  });

  test('converse: ■ End finishes the sentence being said; Stop cuts it now', async () => {
    const answer = () => ['Une première phrase. ', 'Une deuxième phrase. ', 'Une troisième phrase.'];
    const a = world({ level: speech([[1000, 2000]]), answer, chunkMs: 10, sayMs: 40 });
    a.start();
    await a.until(() => a.of('bot.sentence').length === 1);
    a.endFn();
    await a.finished();
    assert.equal(a.of('ended')[0].why, 'end');
    assert.equal(a.playAborted, 0, 'the sentence being said was finished');
    assert.equal(a.plays.length, 1, 'and nothing after it');
    assert.equal(a.result.value.data.turns[0].bot, 'Une première phrase.');
    assert.equal(a.mic.closed, true);

    const b = world({ level: speech([[1000, 2000]]), answer, chunkMs: 10, sayMs: 40 });
    b.start();
    await b.until(() => b.of('bot.sentence').length === 1);
    b.runAc.abort();
    await b.finished();
    assert.equal(b.of('ended')[0].why, 'stop');
    assert.ok(b.playAborted >= 1, 'Stop cut the voice');
    assert.equal(b.mic.closed, true);
    assert.equal(b.result.value.data.why, 'stop', 'an abort still returns what was said');
  });

  test('converse: leaving the Computer (or hiding the window) ends it at once and closes the microphone', async () => {
    const w = world({ level: speech([[1000, 2000]]), sayMs: 60 });
    w.start();
    await w.until(() => w.of('bot.start').length === 1);
    w.hiddenFn();
    await w.finished();
    assert.equal(w.of('ended')[0].why, 'hidden');
    assert.equal(w.mic.closed, true);
    assert.ok(w.playAborted >= 1, 'not paused: ended, the voice cut');
    const frames = w.frames.length;
    await w.tick();
    assert.equal(w.frames.length, frames, 'no frame asks for the microphone any more');

    const hidden = world({ shown: false });
    await hidden.start();
    assert.equal(hidden.listened, 0, 'the Computer not shown: the microphone is never opened');
    assert.equal(hidden.result.value.data.why, 'hidden');
  });

  test('converse: maxTurns ends it after the last answered turn', async () => {
    const w = world({ level: speech([[1000, 2000], [6000, 7000]]), settings: { maxTurns: 1 } });
    w.start();
    await w.finished();
    assert.equal(w.of('ended')[0].why, 'limit');
    assert.equal(w.result.value.data.turns.length, 1);
    assert.equal(w.mic.closed, true);
  });

  test('converse: the farm busy writing down — the box waits its Retry-After and tries once more', async () => {
    const w = world({
      level: speech([[1000, 2000]]),
      stt: (n) => (n === 1 ? { ms: 30, out: { error: 'busy', code: 'busy', status: 429, retryAfter: 1 } } : { out: { text: 'enfin' } }),
    });
    w.start();
    await w.until(() => w.of('turn').length === 1);
    w.endFn();
    await w.finished();
    assert.equal(w.stts.length, 2);
    assert.ok(w.stts[1].at - w.stts[0].at >= 1000, `waited the farm's Retry-After: ${Math.round(w.stts[1].at - w.stts[0].at)} ms`);
    assert.equal(w.result.value.data.turns[0].user, 'enfin');
    assert.equal(w.of('error').length, 0);
  });

  test('converse: three failed turns in a row end it; with no turn of the person\'s that is the box\'s error', async () => {
    const w = world({ level: speech([[1000, 1800], [4000, 4800], [7000, 7800]]), stt: () => ({ out: { error: 'farm answered 500', code: 'farm' } }) });
    w.start();
    await w.finished();
    assert.equal(w.of('error').length, 3);
    assert.equal(w.of('ended')[0].why, 'error');
    assert.ok(w.error instanceof Error && /Three turns in a row failed/.test(w.error.message), String(w.error));
    assert.equal(w.mic.closed, true);
  });

  test('converse: the toolbar\'s Cap ends it as a limit, never as an error', async () => {
    const w = world({ level: speech([[1000, 2000]]), capped: 1 });
    w.start();
    await w.finished();
    assert.equal(w.of('ended')[0].why, 'limit');
    assert.equal(w.error, undefined);
    assert.equal(w.mic.closed, true);
  });

  test('converse: a greeting — the bot speaks first, and later turns know what it said', async () => {
    const w = world({ level: speech([[3000, 4000]]), settings: { greeting: true }, answer: (n) => (n === 1 ? ['Bonjour, je suis Margot.'] : ['Très bien.']) });
    w.start();
    await w.until(() => w.of('turn').length === 2);
    w.endFn();
    await w.finished();
    assert.equal(w.asks[0].prompt, t('parts.converseGreetingAsk'));
    const turns = w.result.value.data.turns;
    assert.equal(turns[0].greeting, true);
    assert.equal(turns[0].bot, 'Bonjour, je suis Margot.');
    assert.ok(w.asks[1].system.includes('Bonjour, je suis Margot.'), 'the greeting rides the system message');
    assert.deepEqual(w.asks[1].history, [], 'never as a first assistant message (the roles must alternate)');
  });

  test('converse: this computer\'s voice says each sentence in the language set, and its mouth moves on word boundaries', async () => {
    const w = world({ level: speech([[1000, 2000]]), voice: 'local', settings: { language: 'fr' }, sayMs: 40 });
    w.start();
    await w.until(() => w.of('turn').length === 1);
    w.endFn();
    await w.finished();
    assert.equal(w.synths.length, 0, 'nothing went to the farm\'s voice');
    assert.deepEqual(w.plays.map((/** @type {any} */ p) => [p.local, p.lang]), [[true, 'fr-FR'], [true, 'fr-FR'], [true, 'fr-FR']]);
    assert.ok(w.of('bot.level').some((/** @type {any} */ e) => e.level > 0), 'a pulse on each word');
  });

  test('converse: a microphone refused is the box\'s error, worded like the Sound box\'s', async () => {
    const w = world({ micFails: 'refused' });
    await w.start();
    assert.ok(w.error && w.error.message === t('parts.converseMicRefused'), String(w.error && w.error.message));
    const w2 = world({ micFails: 'no-device' });
    await w2.start();
    assert.equal(w2.error.message, t('parts.converseNoMic'));
  });

  // ---- the consent rules, through the box's real run() -------------------------------------------------

  /** Fake devices for the real capture.mjs, and an app with a real bus. */
  function realRun() {
    const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
    const env = { gum: 0, tracks };
    const savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const g = /** @type {any} */ (globalThis);
    const saved = { MediaRecorder: g.MediaRecorder, speechSynthesis: g.speechSynthesis, SpeechSynthesisUtterance: g.SpeechSynthesisUtterance };
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia: async () => { env.gum++; return { getTracks: () => tracks }; } } },
    });
    g.MediaRecorder = class { constructor() { this.ondataavailable = null; this.onstop = null; } start() {} stop() { if (this.onstop) this.onstop(); } };
    g.speechSynthesis = { speak() {}, cancel() {} };
    g.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    const bus = createBus();
    const app = { bus, state: { shown: true, pageVisible: true, visible: true }, farm: { get: () => ({ stt: { url: 'http://farm/stt', key: 'k' }, tts: null }) }, host: null };
    const restore = () => {
      if (savedNav) Object.defineProperty(globalThis, 'navigator', savedNav); else delete g.navigator;
      Object.assign(g, saved);
    };
    const input = (/** @type {string} */ id) => ({
      part: { id, type: 'converse', settings: { voice: 'local' } },
      inputs: {}, app, signal: new AbortController().signal,
      ask: { text: async () => ({ ok: false, error: { kind: 'busy', message: 'busy' } }) },
    });
    return { env, app, bus, restore, input };
  }

  test('consent: without a press on ● Start the box refuses, and the microphone is never asked for', async () => {
    clearPresses();
    clearConversations();
    const r = realRun();
    try {
      await assert.rejects(/** @type {any} */ (conversePart).run(r.input('c1')), (/** @type {any} */ e) => e.message === t('parts.converseNoPress'));
      assert.equal(r.env.gum, 0, 'no microphone without a person\'s press');
      // A press is for the box it was made on, and for one run.
      notePress('other');
      await assert.rejects(/** @type {any} */ (conversePart).run(r.input('c1')), /only a person opens the microphone/);
      assert.equal(r.env.gum, 0);
      notePress('c1');
      assert.equal(consumePress('c1'), true, 'the face\'s press is what run() consumes');
      assert.equal(consumePress('c1'), false, 'once');
    } finally { r.restore(); clearPresses(); }
  });

  test('consent: leaving the Computer during a conversation ends it and lets the microphone go', async () => {
    for (const leave of ['shown', 'page']) {
      clearPresses();
      const r = realRun();
      try {
        notePress('c2');
        const run = /** @type {any} */ (conversePart).run(r.input('c2'));
        for (let i = 0; i < 200 && !r.env.gum; i++) await new Promise((res) => setTimeout(res, 5));
        assert.equal(r.env.gum, 1, 'the press opened the microphone');
        await new Promise((res) => setTimeout(res, 40));
        assert.equal(r.env.tracks[0].stopped, false, 'it is open while the Computer is shown');
        if (leave === 'shown') r.bus.emit(EV.COMPUTER_SHOWN, { shown: false });
        else r.bus.emit(EV.VISIBLE, { visible: true, pageVisible: false });
        const out = await run;
        assert.equal(out.value.data.why, 'hidden', leave);
        assert.equal(r.env.tracks[0].stopped, true, `${leave}: every track stopped, the device let go`);
      } finally { r.restore(); clearPresses(); }
    }
  });

  test('consent: a model never starts a conversation — MCP run_graph from a Converse box is refused', async () => {
    const g = /** @type {any} */ (globalThis);
    const saved = g.window;
    let ran = 0;
    const comp = {
      docId: () => 'g1',
      doc: () => ({ parts: [{ id: 'c1', type: 'converse', settings: {} }], wires: [] }),
      run: async () => { ran++; return {}; },
      running: () => false,
    };
    g.window = { lol: {}, LolComputer: { debug: { computer: comp, library: { list: () => [] } } } };
    try {
      const out = await runTool('run_graph', { from: 'c1' });
      assert.equal(out.isError, true);
      assert.equal(out.text, CONVERSE_NOTE);
      assert.equal(ran, 0, 'nothing ran');
    } finally { g.window = saved; }
  });
};
