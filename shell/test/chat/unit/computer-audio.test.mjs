// K6-U3 (LOLCHAT_PLAN 2.6 KF-6): the Sound box. What it keeps, what it refuses and in which words,
// what it plays and that only one sound plays at a time, and what flows on — TEXT, never a sound
// part, because no verified path carries sound to a model on this farm (KF-1(b)).
//
// The platform is faked and RECORDING: a fake OfflineAudioContext decodes a made-up "RIFF" header
// whose bytes 4-5 are the length in seconds (anything else does not decode), and a fake
// AudioContext hands out buffer sources that remember start/stop. The file store is a fake
// `app.media` that records what it was asked to keep.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import {
  audioPart, takeSound, measureSound, clock, soundDebug,
  AUDIO_MAX_BYTES, AUDIO_MAX_SEC, AUDIO_ACCEPT, MEASURE_RATE,
} from '../../../renderer/chat/graph/parts/audio.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import { reasonFor, WHY, AUDIO_SEND } from '../../../renderer/chat/graph/takes.mjs';

const require = createRequire(import.meta.url);
const { stripComments } = require('../../chat-lint.js');
const SPECS = specMap();
const G = /** @type {any} */ (globalThis);

/** A made-up sound file the fake decoder understands: "RIFF" + a uint16 length in seconds. */
function sound(name, seconds, o = {}) {
  const bytes = new Uint8Array(o.bytes || 64);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);                 // RIFF
  new DataView(bytes.buffer).setUint16(4, seconds, true);
  return new File([bytes], name, { type: o.type === undefined ? 'audio/wav' : o.type });
}
/** Bytes no decoder understands, wearing a sound file's name. */
const noise = (name) => new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], name, { type: 'audio/mpeg' });

/** The fake 8 kHz measuring context. */
class FakeOffline {
  constructor(ch, len, rate) { FakeOffline.rates.push(rate); }
  async decodeAudioData(buf) {
    const b = new Uint8Array(buf);
    if (b[0] !== 0x52 || b[1] !== 0x49) throw new Error('EncodingError');
    return { duration: new DataView(buf).getUint16(4, true) };
  }
}
FakeOffline.rates = [];

/** The fake output context: every source it made, and whether each was started or stopped. */
class FakeAC {
  constructor() { this.currentTime = 0; this.destination = {}; FakeAC.sources = []; FakeAC.made += 1; }
  async decodeAudioData(buf) {
    const b = new Uint8Array(buf);
    if (b[0] !== 0x52) throw new Error('EncodingError');
    return { duration: new DataView(buf).getUint16(4, true) };
  }
  createBufferSource() {
    const s = {
      buffer: null, onended: null, started: 0, stopped: 0,
      connect() {}, disconnect() {},
      start() { s.started += 1; }, stop() { s.stopped += 1; },
    };
    FakeAC.sources.push(s);
    return s;
  }
  resume() { return Promise.resolve(); }
}
FakeAC.made = 0;
FakeAC.sources = [];

/** A file store that keeps files in a Map, by a fake id. */
function fakeMedia() {
  const files = new Map();
  const puts = [];
  return {
    puts,
    files,
    async put(file, o) {
      puts.push({ name: file.name, maxBytes: o && o.maxBytes, kind: o && o.kind });
      const buf = await file.arrayBuffer();
      const fileId = `m${files.size + 1}`;
      files.set(fileId, { id: fileId, name: file.name, mime: file.type, size: buf.byteLength, buf });
      return { fileId, name: file.name, mime: file.type, size: buf.byteLength, sha256: `sha-${fileId}` };
    },
    async get(id) { const r = files.get(id); return r ? { ...r } : null; },
    async bytes(id) { const r = files.get(id); return r ? r.buf.slice(0) : null; },
  };
}

/** Run `fn` with the unit runner's DOM shim installed as `globalThis.document`. */
async function withDom(fn) {
  const doc = G.__chatTestDom.createDocument();
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = G.document;
  G.document = doc;
  try { return await fn(doc); } finally {
    if (had) G.document = prev;
    else delete G.document;
  }
}

/** Run `fn` with the fake audio platform installed. */
async function withAudio(fn) {
  const saved = { o: G.OfflineAudioContext, a: G.AudioContext };
  G.OfflineAudioContext = FakeOffline;
  G.AudioContext = FakeAC;
  try { return await fn(); } finally {
    if (saved.o === undefined) delete G.OfflineAudioContext; else G.OfflineAudioContext = saved.o;
    if (saved.a === undefined) delete G.AudioContext; else G.AudioContext = saved.a;
  }
}

/** A Sound box, rendered, with a faithful ctx double (update → the box's own update(), as the
 * canvas does on the same turn). */
function box(doc, part, app) {
  const host = doc.createElement('div');
  const patches = [];
  const commits = [];
  let live = { ...part, settings: { ...part.settings } };
  /** @type {any} */ let inst = null;
  const ctx = {
    app,
    get part() { return live; },
    update(patch) {
      patches.push(patch);
      live = { ...live, settings: { ...live.settings, ...patch } };
      if (inst) inst.update(live);
    },
    commit(label) { commits.push(label); },
  };
  inst = audioPart.render(host, live, /** @type {any} */ (ctx));
  const q = (sel) => host.querySelector(sel);
  return { host, inst, patches, commits, q, get live() { return live; } };
}

/** Let promise chains settle. */
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

/** A drop event the box's own listener accepts. */
const dropOf = (files) => ({
  type: 'drop',
  dataTransfer: { types: ['Files'], files },
  defaultPrevented: false,
  propagationStopped: false,
  preventDefault() { this.defaultPrevented = true; },
  stopPropagation() { this.propagationStopped = true; },
});

const part = (settings = {}, id = 'snd1') => ({ id, type: 'audio', x: 0, y: 0, w: 280, h: 220, settings: { ...audioPart.defaults(), ...settings } });

/** One run of the Sound part. */
const run = (p, app) => audioPart.run(/** @type {any} */ ({
  part: p, inputs: {}, labels: {}, app: app || null, ask: null, signal: null, thread: null, cache: true,
}));

export default (test) => {

  test('KF-6: the spec — a Bring-in box that holds a sound, takes no wire, and passes on text', () => {
    assert.equal(audioPart.type, 'audio');
    assert.equal(audioPart.holds, 'audio');
    assert.equal(audioPart.thinks, false);
    assert.deepEqual(audioPart.inputs, []);
    assert.equal(audioPart.output, 'text');
    assert.deepEqual(Object.keys(audioPart.defaults()).sort(), ['durationSec', 'fileId', 'mime', 'name', 'sha256', 'size']);
    assert.equal(SPECS.get('audio'), audioPart, 'the catalogue serves this spec');
    assert.equal(AUDIO_MAX_BYTES, 25 * 1024 * 1024);
    assert.equal(AUDIO_MAX_SEC, 600);
    assert.equal(MEASURE_RATE, 8000);
    assert.ok(AUDIO_ACCEPT.startsWith('audio/*,') && AUDIO_ACCEPT.includes('.m4a') && AUDIO_ACCEPT.includes('.flac'),
      'the picker offers extensions too — a Windows .m4a often has no MIME type');
    const adopted = audioPart.adopt({ fileId: 'f', name: 'a.wav', mime: 'audio/wav', size: 9, sha256: 'x', durationSec: 2.5, extra: 1 });
    assert.deepEqual(adopted, { fileId: 'f', name: 'a.wav', mime: 'audio/wav', size: 9, sha256: 'x', durationSec: 2.5 });
    assert.equal(clock(0), '0:00');
    assert.equal(clock(9.6), '0:10');
    assert.equal(clock(134), '2:14');
    assert.equal(clock(AUDIO_MAX_SEC), '10:00');
    assert.equal(clock(-3), '0:00');
  });

  test('takeSound: a good file is measured at 8 kHz, kept once, and comes back as a ref with its length', async () => {
    const media = fakeMedia();
    FakeOffline.rates.length = 0;
    const out = await withAudio(() => takeSound({ media }, sound('talk.wav', 134)));
    assert.ok(!('error' in out), JSON.stringify(out));
    assert.equal(out.fileId, 'm1');
    assert.equal(out.name, 'talk.wav');
    assert.equal(out.mime, 'audio/wav');
    assert.equal(out.durationSec, 134);
    assert.equal(out.sha256, 'sha-m1');
    assert.deepEqual(FakeOffline.rates, [8000], 'decoded ONCE, into the small measuring context');
    assert.deepEqual(media.puts, [{ name: 'talk.wav', maxBytes: AUDIO_MAX_BYTES, kind: 'audio' }], 'kept with the frozen cap');
    const stored = new Uint8Array(media.files.get('m1').buf);
    assert.equal(stored[0], 0x52, 'the kept bytes are the file — the measuring decode got a COPY (decodeAudioData detaches)');
  });

  test('takeSound: every refusal is a sentence, and nothing is kept', async () => {
    const media = fakeMedia();
    // Too big: refused from the size alone — not one byte is read.
    let read = 0;
    const huge = { name: 'long.wav', type: 'audio/wav', size: AUDIO_MAX_BYTES + 1, arrayBuffer: async () => { read += 1; return new ArrayBuffer(8); } };
    let out = await withAudio(() => takeSound({ media }, huge));
    assert.equal(out.error, t('parts.audioTooBig', { name: 'long.wav', mb: '25.0', capMb: '25.0' }));
    assert.equal(read, 0, 'a file over the cap is never read');
    // Too long: decoded, measured, refused naming both lengths.
    out = await withAudio(() => takeSound({ media }, sound('lecture.wav', AUDIO_MAX_SEC + 1)));
    assert.equal(out.error, t('parts.audioTooLong', { name: 'lecture.wav', duration: '10:01', cap: '10:00' }));
    // Not a sound this computer can decode.
    out = await withAudio(() => takeSound({ media }, noise('song.mp3')));
    assert.equal(out.error, t('parts.audioUndecodable', { name: 'song.mp3' }));
    assert.ok(/WAV, MP3/.test(out.error), 'and it says what does work');
    // Empty.
    out = await withAudio(() => takeSound({ media }, new File([], 'blank.wav', { type: 'audio/wav' })));
    assert.equal(out.error, t('parts.audioEmptyFile', { name: 'blank.wav' }));
    // No file store in this build.
    out = await withAudio(() => takeSound({}, sound('a.wav', 3)));
    assert.equal(out.error, t('parts.audioNoStore'));
    // The store's own refusal is passed on as its sentence.
    out = await withAudio(() => takeSound({ media: { put: async () => ({ error: 'the store said no' }) } }, sound('a.wav', 3)));
    assert.equal(out.error, 'the store said no');
    assert.equal(media.puts.length, 0, 'nothing refused was kept');
    for (const s of Object.values({ a: t('parts.audioTooBig'), b: t('parts.audioTooLong'), c: t('parts.audioUndecodable') })) {
      assert.ok(!s.startsWith('parts.'), `a registered sentence: ${s}`);
    }
  });

  test('takeSound: a window with no decoder refuses honestly instead of guessing a length', async () => {
    const had = G.OfflineAudioContext;
    delete G.OfflineAudioContext;
    try {
      await assert.rejects(() => measureSound(new ArrayBuffer(8)), /no audio decoder/);
      const out = await takeSound({ media: fakeMedia() }, sound('a.wav', 3));
      assert.equal(out.error, t('parts.audioUndecodable', { name: 'a.wav' }));
    } finally { if (had !== undefined) G.OfflineAudioContext = had; }
  });

  test('run: TEXT that names the file and its length, and the resolver\'s sentence for why the sound was not sent', async () => {
    const media = fakeMedia();
    const ref = await withAudio(() => takeSound({ media }, sound('memo.wav', 75, { bytes: 1024 * 1024 + 10 })));
    const p = part(audioPart.adopt(ref));
    // Unwired, no farm reachable through this double.
    let v = await run(p, { media });
    assert.equal(v.kind, 'text');
    assert.equal(v.data, t('parts.audioValue', { name: 'memo.wav', duration: '1:15', mb: '1.0', why: reasonFor(WHY.unwired, null) }));
    // Wired into an Instruction on an OLLAMA farm: the engine sentence, whatever the model says.
    const doc = {
      parts: [p, { id: 'ask1', type: 'ask', settings: { model: 'mock-hears' } }],
      wires: [{ id: 'w1', from: p.id, to: 'ask1', port: 'in' }],
    };
    const app = {
      media,
      host: { session: { doc: () => doc, specs: SPECS } },
      farm: {
        get: () => ({ present: true, engine: 'ollama', ocr: null, models: [{ id: 'mock-hears' }] }),
        cap: (m, n) => (m === 'mock-hears' && n === 'audio' ? 'yes' : 'unknown'),
      },
    };
    v = await run(p, app);
    assert.equal(v.kind, 'text');
    assert.ok(v.data.includes(reasonFor(WHY.engineNoAudio, 'mock-hears')), v.data);
    // On an engine that might carry it, a model that SAYS it listens is still not sent to (AUDIO_SEND).
    app.farm.get = () => ({ present: true, engine: 'llama.cpp', ocr: null, models: [{ id: 'mock-hears' }] });
    v = await run(p, app);
    assert.equal(AUDIO_SEND, false);
    assert.ok(v.data.includes(reasonFor(WHY.audioUnverified, 'mock-hears')), v.data);
    assert.ok(!JSON.stringify(v).includes('input_audio'), 'a text value, never a sound part');
  });

  test('run: an empty box and a box whose file is gone fail with a sentence', async () => {
    await assert.rejects(() => run(part()), (err) => err.reason === 'empty' && err.message === t('parts.audioEmpty'));
    const gone = part({ fileId: 'nope', name: 'x.wav', durationSec: 2, size: 10 });
    await assert.rejects(() => run(gone, { media: fakeMedia() }),
      (err) => err.reason === 'part' && err.message === t('parts.mediaMissing'));
  });

  test('no code path in the Sound box or the drop router builds a sound part for a request', () => {
    for (const rel of ['../../../renderer/chat/graph/parts/audio.mjs', '../../../renderer/chat/computer/drops.mjs']) {
      const src = stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
      assert.ok(!/input_audio|['"]file['"]\s*:\s*\{/.test(src), `${rel}: no input_audio / file part is ever built`);
      assert.ok(!/new\s+Audio\s*\(|createElement\s*\(\s*['"]audio/.test(src), `${rel}: no <audio> element (the CSP has no media-src)`);
    }
  });

  test('render: empty, the box offers the drop/choose face; a non-sound file dropped on it is refused in words', async () => {
    await withDom(async (doc) => {
      const b = box(doc, part(), { media: fakeMedia() });
      assert.equal(b.q('.graph-audio-empty').hidden, false);
      assert.equal(b.q('.graph-audio-empty').textContent, t('parts.audioEmpty'));
      assert.equal(b.q('.graph-audio-player').hidden, true);
      assert.ok(b.q('.graph-takes'), 'the takes line is on the box');
      const ev = dropOf([new File(['x'], 'paper.pdf', { type: 'application/pdf' })]);
      b.host.dispatchEvent(ev);
      await settle();
      assert.equal(ev.defaultPrevented, true);
      assert.equal(ev.propagationStopped, true, 'a drop ON the box is the box\'s: the canvas must not place a second box');
      assert.equal(b.q('.graph-audio-note').hidden, false);
      assert.equal(b.q('.graph-audio-note').textContent, t('parts.audioNotSound', { name: 'paper.pdf' }));
      assert.equal(b.patches.length, 0, 'nothing written');
      b.inst.destroy();
    });
  });

  test('render: a sound dropped on the box is kept and written in ONE edit; the box shows its name and length', async () => {
    await withDom(async (doc) => withAudio(async () => {
      const media = fakeMedia();
      const b = box(doc, part(), { media });
      b.host.dispatchEvent(dropOf([sound('birds.ogg', 42, { type: 'audio/ogg' })]));
      await settle();
      assert.equal(b.patches.length, 1, 'one settings write');
      assert.deepEqual(b.commits, [t('parts.audioLabel')], 'one undo entry');
      assert.equal(b.live.settings.fileId, 'm1');
      assert.equal(b.live.settings.durationSec, 42);
      assert.equal(b.q('.graph-audio-empty').hidden, true);
      assert.equal(b.q('.graph-audio-player').hidden, false);
      assert.equal(b.q('.graph-audio-name').textContent, 'birds.ogg');
      assert.equal(b.q('.graph-audio-time').textContent, t('parts.audioTime', { at: '0:00', duration: '0:42', mb: '0.0' }));
      assert.equal(b.q('.graph-audio-note').hidden, true, 'nothing to say');
      // A second, undecodable file: refused in words, and the first one is still what the box holds.
      b.host.dispatchEvent(dropOf([noise('broken.mp3')]));
      await settle();
      assert.equal(b.patches.length, 1, 'the refusal wrote nothing');
      assert.equal(b.q('.graph-audio-note').textContent, t('parts.audioUndecodable', { name: 'broken.mp3' }));
      assert.equal(b.q('.graph-audio-name').textContent, 'birds.ogg');
      // Remove: back to the empty face, one more edit.
      b.q('.graph-audio-remove').dispatchEvent({ type: 'click' });
      assert.equal(b.live.settings.fileId, '');
      assert.deepEqual(b.commits, [t('parts.audioLabel'), t('parts.audioRemove')]);
      assert.equal(b.q('.graph-audio-empty').hidden, false);
      b.inst.destroy();
    }));
  });

  test('render: ▶ plays through Web Audio, one sound at a time; ■ and the end both stop it; destroy stops it', async () => {
    await withDom(async (doc) => withAudio(async () => {
      const media = fakeMedia();
      const a = await takeSound({ media }, sound('one.wav', 3));
      const bRef = await takeSound({ media }, sound('two.wav', 5));
      const app = { media };
      const one = box(doc, part(audioPart.adopt(a), 'p1'), app);
      const two = box(doc, part(audioPart.adopt(bRef), 'p2'), app);
      const pressed = (x) => x.q('.graph-audio-play').getAttribute('aria-pressed');
      const before = soundDebug().plays;

      one.q('.graph-audio-play').dispatchEvent({ type: 'click' });
      await settle();
      assert.equal(pressed(one), 'true', 'box one is playing');
      assert.equal(one.q('.graph-audio-play').textContent, t('parts.audioStop'));
      assert.equal(soundDebug().playing, a.fileId);
      const first = FakeAC.sources[FakeAC.sources.length - 1];
      assert.equal(first.started, 1, 'an AudioBufferSourceNode was started');

      two.q('.graph-audio-play').dispatchEvent({ type: 'click' });
      await settle();
      assert.equal(pressed(two), 'true', 'box two is playing');
      assert.equal(pressed(one), 'false', 'and box one stopped: one sound at a time');
      assert.equal(first.stopped, 1);
      assert.equal(soundDebug().playing, bRef.fileId);

      // ■ stops it.
      two.q('.graph-audio-play').dispatchEvent({ type: 'click' });
      assert.equal(pressed(two), 'false');
      assert.equal(soundDebug().playing, null);

      // The sound ending on its own stops it too (the replay reuses the one cached decode).
      one.q('.graph-audio-play').dispatchEvent({ type: 'click' });
      await settle();
      const again = FakeAC.sources[FakeAC.sources.length - 1];
      assert.equal(pressed(one), 'true');
      again.onended();
      assert.equal(pressed(one), 'false', 'the end of the sound resets the button');

      // Playing, then the box goes away: the sound stops with it.
      one.q('.graph-audio-play').dispatchEvent({ type: 'click' });
      await settle();
      const last = FakeAC.sources[FakeAC.sources.length - 1];
      one.inst.destroy();
      assert.equal(last.stopped, 1, 'destroy() stops the sound');
      assert.equal(soundDebug().playing, null);
      assert.equal(soundDebug().plays - before, 4);
      assert.equal(FakeAC.made, 1, 'one AudioContext for the whole window');
      two.inst.destroy();
    }));
  });

  test('render: clicking the empty face opens a picker for sound files, and the chosen file goes through the same intake', async () => {
    await withDom(async (doc) => withAudio(async () => {
      const made = [];
      const real = doc.createElement.bind(doc);
      doc.createElement = (tag) => { const e = real(tag); if (tag === 'input') made.push(e); return e; };
      const b = box(doc, part(), { media: fakeMedia() });
      b.q('.graph-audio-empty').dispatchEvent({ type: 'click' });
      assert.equal(made.length, 1, 'one file input');
      assert.equal(made[0].type, 'file');
      assert.equal(made[0].accept, AUDIO_ACCEPT);
      made[0].files = [sound('picked.mp3', 7, { type: 'audio/mpeg' })];
      made[0].dispatchEvent({ type: 'change' });
      await settle();
      assert.equal(b.live.settings.name, 'picked.mp3');
      assert.equal(b.live.settings.durationSec, 7);
      assert.deepEqual(b.commits, [t('parts.audioLabel')]);
      b.inst.destroy();
    }));
  });

  test('render: a box whose file is gone says so, and ▶ is disabled', async () => {
    await withDom(async (doc) => {
      const b = box(doc, part({ fileId: 'gone', name: 'lost.wav', size: 10, durationSec: 4 }), { media: fakeMedia() });
      await settle();
      assert.equal(b.q('.graph-audio-note').hidden, false);
      assert.equal(b.q('.graph-audio-note').textContent, t('parts.mediaMissing'));
      assert.equal(b.q('.graph-audio-play').disabled, true);
      b.inst.destroy();
    });
  });
};
