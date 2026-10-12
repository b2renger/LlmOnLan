// @ts-check
// graph/voice.mjs (docs/COMPUTER_VOICE_PLAN.md K-V1): Converse's arithmetic, driven in Node with
// synthetic signals — a script of levels at 60 frames a second stands for a microphone. Every rule of
// §5.1 has a test here that fails when the rule is taken out: the onset and its back-dating, the
// end-of-turn knob, the click, the cough, the calibration, the noise floor, the barge-in threshold,
// the stalled frame and the monologue; then the turn's window, the WAV and the resampling, the
// sentence cutter, what a voice can say, Whisper's silences, the event shape, the timings and the
// history.
import assert from 'node:assert/strict';
import {
  VAD, VOICE_EVENTS, VOICE_STATES, VOICE_LIMITS, TEXT_MAX, STT_RATE, knob, knobs, rms, levelOf, thresholdFor,
  vadInit, vadStep, vadQuiet, takeWindow, resample, toMono16k, wavBytes, nextSentences, speakable,
  heardNothing, historyOf, voiceEvent, turnTimes,
} from '../../../renderer/chat/graph/voice.mjs';

const FRAME = 1000 / 60;

/**
 * Run the detector over a script: `[[ms, level, botSpeaking?], …]`, one frame every FRAME ms.
 * @param {Array<[number, number, boolean?]>} script
 * @param {{sensitivity?: number, endSilenceMs?: number, start?: number, state?: any, frame?: number}} [o]
 */
function drive(script, o = {}) {
  let s = o.state || vadInit();
  let t = o.start || 0;
  const frame = o.frame || FRAME;
  /** @type {{ev: string, t: number, at: any}[]} */ const events = [];
  /** @type {number[]} */ const marks = [];   // when each segment's first frame came
  let threshold = 0;
  for (const [ms, level, bot] of script) {
    marks.push(t + frame);
    const until = t + ms;
    while (t < until) {
      t += frame;
      const r = vadStep(s, { level, t, sensitivity: o.sensitivity ?? 0.5, endSilenceMs: o.endSilenceMs ?? 800, botSpeaking: !!bot });
      s = r.s;
      threshold = r.threshold;
      if (r.ev) events.push({ ev: r.ev, t, at: r.at });
    }
  }
  return { events, s, t, threshold, marks, kinds: events.map((e) => e.ev) };
}

const QUIET = 0.004;      // a quiet room
const VOICE = 0.15;       // a person speaking
const calm = /** @type {[number, number]} */ ([700, QUIET]);   // past the calibration

export default (test) => {
  // ---- the knobs ---------------------------------------------------------------------------------

  test('voice: the knobs are clamped to §7, and anything unreadable is the default', () => {
    assert.equal(knob('endSilenceMs', 50), 200);
    assert.equal(knob('endSilenceMs', 99999), 3000);
    assert.equal(knob('endSilenceMs', '1234.6'), 1235, 'a whole number of ms');
    assert.equal(knob('sensitivity', 0.333), 0.333);
    assert.equal(knob('sensitivity', 'loud'), 0.5);
    assert.equal(knob('interruptible', 'yes'), true, 'only a real boolean counts (default: on, the owner\'s answer)');
    assert.equal(knob('interruptible', false), false);
    assert.equal(knob('voice', 'robot'), 'auto');
    assert.equal(knob('language', 'fr'), 'fr');
    assert.equal(knob('language', 'french'), 'auto');
    assert.equal(knob('farmVoice', 'ff_siwis'), 'ff_siwis');
    assert.equal(knob('farmVoice', 'a b<script>'), '');
    assert.equal(knob('maxTurns', 0), 1);
    assert.equal(knob('maxMinutes', 30), 9, 'under the runner\'s 10-minute wall clock');
    assert.throws(() => knob('volume', 1), /unknown knob/);
    const k = knobs({ endSilenceMs: 100, cues: 'loud' });
    assert.equal(k.endSilenceMs, 200);
    assert.equal(k.cues, 'soft');
    assert.deepEqual(Object.keys(k).sort(), Object.keys(VOICE_LIMITS).sort());
  });

  // ---- voice activity (§5.1) ---------------------------------------------------------------------

  test('VAD: rms and the threshold follow §5.1', () => {
    assert.equal(rms([]), 0);
    assert.ok(Math.abs(rms([1, -1, 1, -1]) - 1) < 1e-9);
    assert.ok(Math.abs(rms([0.5, 0.5]) - 0.5) < 1e-9);
    assert.equal(thresholdFor(0, 0.5), VAD.floor * 1.1, 'a silent room: the floor');
    assert.ok(Math.abs(thresholdFor(0.03, 0.5) - 0.03 * 2.75) < 1e-12, 'a noisy room: the noise times (4 − 2.5 s)');
    assert.ok(thresholdFor(0.03, 1) < thresholdFor(0.03, 0), 'more sensitive is a lower threshold');
    assert.equal(levelOf(0), 0);
    assert.equal(levelOf(10), 1);
    assert.ok(levelOf(0.05) > levelOf(0.01));
  });

  test('VAD: nothing starts during the calibration, however loud', () => {
    const r = drive([[400, VOICE], [150, QUIET]]);
    assert.deepEqual(r.kinds, [], 'the first half second only learns the room');
    assert.equal(r.s.phase, 'silence', 'and then it listens');
    // A quiet start, then a voice inside the first half second: still nothing.
    assert.deepEqual(drive([[200, QUIET], [280, VOICE], [600, QUIET]]).kinds, [], 'a voice during the calibration is not a turn');
  });

  test('VAD: the calibration waits while the bot speaks (a greeting is not the room)', () => {
    const r = drive([[600, 0.3, true]]);
    assert.equal(r.s.phase, 'calibrating', 'still calibrating after 600 ms of the bot');
    assert.ok(r.s.noise < 0.01, `the bot's voice was not learnt as noise: ${r.s.noise}`);
    const r2 = drive([[600, QUIET]], { state: r.s, start: r.t });
    assert.equal(r2.s.phase, 'silence');
  });

  test('VAD: an onset is 120 ms above the threshold, and is back-dated to when the voice began', () => {
    const r = drive([calm, [1000, VOICE], [1000, QUIET]]);
    assert.deepEqual(r.kinds, ['start', 'end']);
    const start = r.events[0];
    const began = r.marks[1] - FRAME;   // the first loud frame covers the frame before it
    assert.ok(start.t >= began + VAD.onsetMs && start.t <= began + VAD.onsetMs + 2 * FRAME, `start seen ~120 ms after the voice: ${start.t} (voice at ${began})`);
    assert.ok(Math.abs(start.at.speechStart - began) <= FRAME, `the onset is back-dated to the voice: ${start.at.speechStart} (voice at ${began})`);
    const end = r.events[1];
    assert.ok(Math.abs(end.at.lastSpeech - (r.marks[2] - FRAME)) <= FRAME * 1.5, `the last speech is where the voice stopped: ${end.at.lastSpeech}`);
    assert.ok(end.t - end.at.lastSpeech >= 800 - FRAME, 'the end came after the end-of-turn silence');
  });

  test('VAD: a click never starts a turn', () => {
    const r = drive([calm, [FRAME, 0.9], [500, QUIET], [FRAME * 3, 0.9], [500, QUIET]]);
    assert.deepEqual(r.kinds, [], 'one frame, then three frames (50 ms), of a click');
  });

  test('VAD: a cough starts and is cancelled, it is not a turn', () => {
    const r = drive([calm, [220, VOICE], [1000, QUIET]]);
    assert.deepEqual(r.kinds, ['start', 'cancel']);
  });

  test('VAD: a pause inside a sentence keeps the turn', () => {
    const r = drive([calm, [700, VOICE], [450, QUIET], [700, VOICE], [1000, QUIET]]);
    assert.deepEqual(r.kinds, ['start', 'end'], 'one turn, not two');
    assert.ok(r.events[1].at.lastSpeech - r.events[1].at.speechStart >= 1800, 'the whole sentence is in it');
  });

  test('VAD: the end-of-turn knob decides how many turns a script makes (impatient vs patient)', () => {
    const script = /** @type {Array<[number, number]>} */ ([calm, [600, VOICE], [600, QUIET], [600, VOICE], [600, QUIET], [600, VOICE], [1200, QUIET]]);
    assert.deepEqual(drive(script, { endSilenceMs: 300 }).kinds, ['start', 'end', 'start', 'end', 'start', 'end'], '300 ms: three turns');
    assert.deepEqual(drive(script, { endSilenceMs: 1000 }).kinds, ['start', 'end'], '1000 ms: one turn');
  });

  test('VAD: a fan\'s hum is learnt, never starts a turn, and a voice over it is heard', () => {
    const hum = 0.03;
    const r = drive([[3000, hum]]);
    assert.deepEqual(r.kinds, [], 'the hum alone is not speech');
    assert.ok(r.s.noise > 0.02 && r.s.noise < 0.04, `the room's noise was learnt: ${r.s.noise}`);
    assert.ok(r.threshold > hum, `the threshold sits above the hum: ${r.threshold}`);
    const r2 = drive([[1000, 0.25], [1200, hum]], { state: r.s, start: r.t });
    assert.deepEqual(r2.kinds, ['start', 'end'], 'a voice over the hum is a turn');
  });

  test('VAD: the noise floor follows the room slowly, clamped, and never learns from speech', () => {
    const r = drive([[3000, 0.9]]);
    assert.ok(r.s.noise <= VAD.noiseMax, 'clamped at 0.2');
    const quiet = drive([[3000, 0]]);
    assert.ok(quiet.s.noise >= VAD.noiseMin, 'clamped at 0.001');
    const talk = drive([calm, [4000, VOICE]]);
    assert.ok(talk.s.noise < 0.01, `four seconds of speech did not raise the floor: ${talk.s.noise}`);
    // Nor does the bot's own voice: after three seconds of it, a quiet person is still heard.
    const after = drive([calm, [3000, 0.06, true], [600, QUIET], [700, 0.1], [1000, QUIET]]);
    assert.ok(after.s.noise < 0.01, `the bot's voice was not learnt as the room: ${after.s.noise}`);
    assert.deepEqual(after.kinds, ['start', 'end'], 'and a soft voice after it is a turn');
  });

  test('VAD: while the bot speaks, its echo at 0.05 does not barge in, a voice at 0.4 does', () => {
    const echo = drive([calm, [2000, 0.05, true]]);
    assert.deepEqual(echo.kinds, [], 'the bot\'s own voice in the speakers');
    assert.ok(echo.threshold >= VAD.botMin, `the raised threshold: ${echo.threshold}`);
    const barge = drive([calm, [500, 0.05, true], [600, 0.4, true]]);
    assert.deepEqual(barge.kinds, ['start'], 'the person talks over it');
    // and the same 0.05 IS speech when the bot is quiet: the raise is what kept it out.
    assert.deepEqual(drive([calm, [800, 0.05], [1000, QUIET]]).kinds, ['start', 'end']);
  });

  test('VAD: a stalled frame counts as at most 250 ms of silence', () => {
    const r = drive([calm, [500, VOICE]]);
    // One frame five seconds late, in silence: 250 ms, not 5 s — the turn is not over.
    const late = vadStep(r.s, { level: QUIET, t: r.t + 5000, sensitivity: 0.5, endSilenceMs: 800 });
    assert.equal(late.ev, null, 'no end after one stalled frame');
    assert.equal(late.s.quiet, VAD.maxFrameMs);
  });

  test('VAD: a monologue of 30 s ends its turn anyway', () => {
    const r = drive([calm, [31000, VOICE]]);
    assert.deepEqual(r.kinds.slice(0, 2), ['start', 'end'], 'the turn ends at 30 s (a voice going on starts the next)');
    const e = r.events[1];
    assert.ok(e.t - e.at.speechStart >= VAD.maxSpeechMs && e.t - e.at.speechStart < VAD.maxSpeechMs + 100);
  });

  test('VAD: vadQuiet listens afresh and keeps the room it learnt', () => {
    const r = drive([[2000, 0.02], [400, VOICE]]);
    assert.equal(r.s.phase, 'speech');
    const q = vadQuiet(r.s);
    assert.equal(q.phase, 'silence');
    assert.equal(q.noise, r.s.noise);
    const again = drive([[300, VOICE]], { state: q, start: r.t });
    assert.deepEqual(again.kinds, ['start'], 'a person still talking is heard from now on');
    assert.equal(vadQuiet(vadInit()).phase, 'calibrating', 'a calibration is never cut short');
  });

  // ---- the turn's sound --------------------------------------------------------------------------

  test('takeWindow: pre-roll before the onset, tail after the last speech, clamped to the take', () => {
    const w = takeWindow({ takeStart: 1000, speechStart: 3000, lastSpeech: 5000, duration: 10 });
    assert.equal(w.from, (3000 - VAD.preRollMs - 1000) / 1000);
    assert.equal(w.to, (5000 + VAD.tailMs - 1000) / 1000);
    assert.equal(takeWindow({ takeStart: 1000, speechStart: 1100, lastSpeech: 2000, duration: 10 }).from, 0, 'the pre-roll cannot go before the take');
    assert.equal(takeWindow({ takeStart: 0, speechStart: 1000, lastSpeech: 9990, duration: 10 }).to, 10, 'nor the tail past its end');
    assert.deepEqual(takeWindow({ takeStart: 9000, speechStart: 1000, lastSpeech: 2000, duration: 4 }), { from: 0, to: 4 }, 'clocks that disagree: the whole take');
  });

  test('resample and toMono16k: 48 kHz stereo becomes 16 kHz mono, the pitch kept, the window cut', () => {
    const rate = 48000;
    const n = rate;   // one second
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (let i = 0; i < n; i++) { left[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / rate); right[i] = left[i]; }
    const mono = toMono16k([left, right], rate, 0, 1);
    assert.equal(mono.length, STT_RATE, 'one second at 16 kHz');
    let crossings = 0;
    for (let i = 1; i < mono.length; i++) if ((mono[i - 1] < 0) !== (mono[i] < 0)) crossings++;
    assert.ok(Math.abs(crossings - 880) <= 4, `440 Hz stays 440 Hz: ${crossings} zero crossings`);
    assert.ok(Math.abs(rms(mono) - 0.5 / Math.SQRT2) < 0.02, 'the level is kept (stereo averaged, not summed)');
    const cut = toMono16k([left], rate, 0.25, 0.75);
    assert.equal(cut.length, STT_RATE / 2, 'half a second cut out');
    assert.equal(resample(new Float32Array([1, 2, 3]), 8000, 8000).length, 3);
    assert.equal(resample(new Float32Array(8000), 8000, 16000).length, 16000, 'up-sampling doubles');
    assert.equal(toMono16k([], rate, 0, 1).length, 0);
  });

  test('wavBytes: a 16-bit PCM mono WAV with a correct header, samples clipped', () => {
    const b = wavBytes(new Float32Array([0, 1, -1, 2, -2]), 16000);
    const v = new DataView(b.buffer);
    const str = (at, n) => String.fromCharCode(...b.slice(at, at + n));
    assert.equal(str(0, 4), 'RIFF');
    assert.equal(v.getUint32(4, true), 36 + 10);
    assert.equal(str(8, 4), 'WAVE');
    assert.equal(str(12, 4), 'fmt ');
    assert.equal(v.getUint16(20, true), 1, 'PCM');
    assert.equal(v.getUint16(22, true), 1, 'mono');
    assert.equal(v.getUint32(24, true), 16000);
    assert.equal(v.getUint32(28, true), 32000, '~32 KB a second');
    assert.equal(v.getUint16(34, true), 16);
    assert.equal(str(36, 4), 'data');
    assert.equal(v.getUint32(40, true), 10);
    assert.deepEqual([0, 1, 2, 3, 4].map((i) => v.getInt16(44 + i * 2, true)), [0, 32767, -32768, 32767, -32768]);
  });

  // ---- the answer ----------------------------------------------------------------------------------

  test('nextSentences: cuts at . ! ? … followed by a space, keeps 3.5 and M. and etc., flushes at the end', () => {
    const a = nextSentences('Bonjour ! Comment allez-vous ? Très bien', 0, false);
    assert.deepEqual(a.sentences, ['Bonjour !', 'Comment allez-vous ?']);
    assert.equal('Bonjour ! Comment allez-vous ? Très bien'.slice(a.next).trim(), 'Très bien', 'the rest waits');
    assert.deepEqual(nextSentences('Il coûte 3.5 euros. Oui', 0).sentences, ['Il coûte 3.5 euros.']);
    assert.deepEqual(nextSentences('Le chiffre 3.', 0).sentences, [], '"3." at the end may become "3.5"');
    assert.deepEqual(nextSentences('M. Dupont est là. Oui', 0).sentences, ['M. Dupont est là.']);
    assert.deepEqual(nextSentences('Des pommes, des poires, etc. et des prunes. Fin', 0).sentences, ['Des pommes, des poires, etc. et des prunes.']);
    assert.deepEqual(nextSentences('Il a dit « oui. » Puis il est parti', 0).sentences, ['Il a dit « oui. »'], 'closing quotes ride along');
    assert.deepEqual(nextSentences('Wait... What? Fine', 0).sentences, ['Wait...', 'What?']);
    assert.deepEqual(nextSentences('Un titre\n\nUn paragraphe sans point', 0, false).sentences, ['Un titre'], 'a blank line ends one');
    assert.deepEqual(nextSentences('Encore un mot', 0, true), { sentences: ['Encore un mot'], next: 'Encore un mot'.length }, 'final flushes');
    assert.deepEqual(nextSentences('   ', 0, true).sentences, []);
  });

  test('nextSentences: streaming gives the same sentences as all at once', () => {
    const text = 'Je suis Margot. Je vous montre ce vase de 1925 ? Il vient de Sèvres, M. Dubois l\'a offert. Voilà !';
    const whole = nextSentences(text, 0, true).sentences;
    /** @type {string[]} */ const got = [];
    let from = 0;
    for (let i = 1; i <= text.length; i += 3) {
      const r = nextSentences(text.slice(0, i), from, false);
      got.push(...r.sentences);
      from = r.next;
    }
    got.push(...nextSentences(text, from, true).sentences);
    assert.deepEqual(got, whole);
    assert.equal(whole.length, 4);
  });

  test('nextSentences: a sentence over 160 characters is cut at its last comma, finished or not', () => {
    const long = `${'Une phrase très longue, '.repeat(9)}qui ne finit pas encore`;
    const open = nextSentences(long, 0, false);
    assert.ok(open.sentences.length >= 1, 'a run-on answer starts speaking before its full stop');
    for (const s of open.sentences) { assert.ok(s.length <= 160, s); assert.ok(s.endsWith(','), s); }
    const closed = nextSentences(`${long}. Fin`, 0, false).sentences;
    for (const s of closed) assert.ok(s.length <= 160, `cut at a comma: ${s.length}`);
    assert.equal(closed.join(' ').replace(/\s+/g, ' '), `${long}.`.replace(/\s+/g, ' '), 'nothing lost');
  });

  test('speakable: no thinking, code, link targets, addresses, headings, bullets, emphasis or emoji', () => {
    assert.equal(speakable('<think>let me see</think>Bonjour.'), 'Bonjour.');
    assert.equal(speakable('Voici :\n```js\nlet a = 1;\n```\nVoilà.'), 'Voici : Voilà.');
    assert.equal(speakable('Le code ```js\nlet a'), 'Le code', 'an unclosed fence: the rest is code');
    assert.equal(speakable('Voir [le site](https://example.org) ou https://example.org/x pour plus.'), 'Voir le site ou pour plus.');
    assert.equal(speakable('# Titre\n- un\n* deux\n1. trois'), 'Titre un deux trois');
    assert.equal(speakable('C\'est **très** _beau_ et `simple`.'), 'C\'est très beau et simple.');
    assert.equal(speakable('Super 🎉👍🏽 !'), 'Super !');
    assert.equal(speakable('🇫🇷'), '');
    assert.equal(speakable('3 * 4 = 12'), '3 4 = 12', 'a stray asterisk is not read out');
  });

  test('heardNothing: Whisper\'s silences, compared whole — a real sentence containing one passes', () => {
    for (const s of ['', '   ', '...', '♪', '[Musique]', '(music)', 'Sous-titres réalisés par la communauté d\'Amara.org', 'Merci d’avoir regardé !', 'Thank you for watching.', ' you ']) {
      assert.equal(heardNothing(s), true, JSON.stringify(s));
    }
    for (const s of ['Non merci.', 'Merci.', 'Je voulais dire merci d\'avoir regardé le film avec moi.', 'You know what?', 'Musique classique, s\'il vous plaît.']) {
      assert.equal(heardNothing(s), false, JSON.stringify(s));
    }
  });

  test('historyOf: the last turns as person/bot messages that always alternate', () => {
    const turns = [
      { user: 'un', bot: 'A' }, { user: 'deux', bot: '' }, { user: '', bot: 'Bonjour (greeting)' },
      { user: 'trois', bot: 'C' }, { user: 'quatre', bot: 'D' },
    ];
    assert.deepEqual(historyOf(turns, 8), [
      { role: 'user', content: 'un' }, { role: 'assistant', content: 'A' },
      { role: 'user', content: 'trois' }, { role: 'assistant', content: 'C' },
      { role: 'user', content: 'quatre' }, { role: 'assistant', content: 'D' },
    ]);
    assert.deepEqual(historyOf(turns, 1), [{ role: 'user', content: 'quatre' }, { role: 'assistant', content: 'D' }]);
    assert.deepEqual(historyOf(turns, 0), []);
    assert.deepEqual(historyOf(/** @type {any} */ (null), 8), []);
  });

  // ---- the face --------------------------------------------------------------------------------------

  test('voiceEvent: the frozen shape — known types and states only, text clipped, only plain values cross', () => {
    const e = voiceEvent('transcript', 'transcribing', { text: 'x'.repeat(TEXT_MAX + 50), ms: 412.4, ok: true, f: () => 1, o: { a: 1 }, type: 'nope', t: -5 }, 1234.6);
    assert.deepEqual(Object.keys(e).sort(), ['ms', 'ok', 'state', 't', 'text', 'type']);
    assert.equal(e.type, 'transcript', 'data cannot rename the event');
    assert.equal(e.t, 1235);
    assert.equal(e.text.length, TEXT_MAX);
    assert.equal(e.ms, 412.4, 'a plain number crosses as it is');
    const turn = voiceEvent('turn', 'listening', { user: 'a', bot: 'b', ms: { heard: 900.2, stt: 'x', firstWord: null, firstSound: 2100, total: Infinity, extra: 1 } }, 0);
    assert.deepEqual(turn.ms, { heard: 900, stt: null, firstWord: null, firstSound: 2100, total: null });
    assert.throws(() => voiceEvent('user.shout', 'listening', {}, 0), /unknown event/);
    assert.throws(() => voiceEvent('turn', 'sleeping', {}, 0), /unknown state/);
    assert.equal(VOICE_EVENTS.length, 18);
    assert.equal(VOICE_STATES.length, 8);
  });

  test('turnTimes: the wait a person feels, from the moments of a turn', () => {
    const ms = turnTimes({ endOfSpeech: 1000, sttStart: 1100, sttEnd: 1300, asked: 1300, firstToken: 1700, firstSound: 2100, saidAll: 5000 });
    assert.deepEqual(ms, { heard: 300, stt: 200, firstWord: 400, firstSound: 1100, total: 4000 });
    assert.deepEqual(turnTimes({ endOfSpeech: 1000 }), { heard: null, stt: null, firstWord: null, firstSound: null, total: null }, 'what did not happen is null');
    assert.equal(turnTimes({ endOfSpeech: 2000, firstSound: 1000 }).firstSound, null, 'never a negative wait');
  });
};
