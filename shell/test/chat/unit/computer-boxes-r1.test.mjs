// @ts-check
// Critic R1, Package C (docs/reviews/COMPUTER_CRITIC_R1.md): the BOX side of the owner's list, in
// Node. The Text box's own A6/A7 rules live in computer-text.test.mjs; this file holds the rest:
//
//   A6/B6  a Sticky note is READ (click selects it, Delete deletes it) until a double-click or the
//          canvas's K-2 `edit()` opens it; the Preview's `edit()` puts the caret in its code
//   A7     the Preview's markdown and the Document's text are selectable zones (K-1); Document Copy
//   A8     the Preview hands the guest its Width x Height (K-4); the page font is on #root; a guest
//          error comes with what to DO about it; the host sizes the frame and sends the size
//   B16    a sound decoded for a box that was destroyed meanwhile is NOT left in the cache
//   B17    two drops on one box: the last one wins; a drop or a paste that finishes after a graph
//          switch places nothing in the graph that is open now
//
// The real-input half (a person's mouse and keys, the real guest) is
// chat-harness/scenarios/k8-boxes-*.mjs.

import assert from 'node:assert/strict';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';
import { preview as PREVIEW, PAGE_CSS, sandboxMessage, explained } from '../../../renderer/chat/graph/parts/preview.mjs';
import * as unfence from '../../../renderer/chat/graph/unfence.mjs';
import { sticky } from '../../../renderer/chat/graph/parts/sticky.mjs';
import { audioPart, soundDebug } from '../../../renderer/chat/graph/parts/audio.mjs';
import { documentPart } from '../../../renderer/chat/graph/parts/document.mjs';
import { image } from '../../../renderer/chat/graph/parts/image.mjs';
import { install as installDrops } from '../../../renderer/chat/computer/drops.mjs';
import { install as installIntake } from '../../../renderer/chat/computer/intake.mjs';
import { createSandbox } from '../../../renderer/chat/sandbox/host.mjs';
import { guestSize, GUEST_MAX_PX } from '../../../renderer/chat/sandbox/protocol.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';

const G = /** @type {any} */ (globalThis);
const SPECS = specMap();

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

/** Let promise chains settle. */
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

/** A promise and the hand that resolves it. */
function gate() {
  /** @type {(v?: any) => void} */ let open = () => {};
  const p = new Promise((r) => { open = r; });
  return { p, open };
}

/** A part as `addPart` makes one. @param {any} spec @param {any} settings @param {string} id */
const partOf = (spec, settings, id) => ({
  id, type: spec.type, x: 0, y: 0, w: (spec.size && spec.size.w) || 240, h: (spec.size && spec.size.h) || 200,
  settings: { ...spec.defaults(), ...settings }, value: null, state: 'idle', error: null, stats: null,
});

/** A box rendered the way the canvas does: `ctx.update` merges and hands the part straight back. */
function render(spec, doc, part, app) {
  const host = doc.createElement('div');
  /** @type {any[]} */ const patches = [];
  /** @type {string[]} */ const commits = [];
  let live = part;
  /** @type {any} */ let inst = null;
  const ctx = {
    app: app || {},
    get part() { return live; },
    update(/** @type {any} */ patch) {
      patches.push(patch);
      live = { ...live, settings: { ...live.settings, ...patch } };
      if (inst) inst.update(live);
    },
    commit(/** @type {string} */ label) { commits.push(String(label)); },
    open() {},
  };
  inst = spec.render(host, live, /** @type {any} */ (ctx));
  return {
    host, patches, commits, inst,
    get live() { return live; },
    q: (/** @type {string} */ sel) => host.querySelector(sel),
    /** @param {any[]} files */
    drop(files) {
      host.dispatchEvent({
        type: 'drop', dataTransfer: { types: ['Files'], files },
        preventDefault() {}, stopPropagation() {},
      });
    },
  };
}

/** A sandbox host as the Preview sees it, every run request recorded. */
function fakeSandbox() {
  /** @type {any[]} */ const runs = [];
  return {
    runs,
    async run(/** @type {any} */ req) { runs.push(req); return { ok: true, ms: 1, error: null }; },
    async snapshot() { return { dataUrl: 'data:image/png;base64,AAAA', w: 500, h: 200 }; },
    errors: () => [],
  };
}

/** One Preview run through a fake sandbox. @param {any} part */
async function previewRun(part) {
  const sb = fakeSandbox();
  await PREVIEW.run(/** @type {any} */ ({
    part, inputs: { content: [] }, labels: { content: [] }, app: { now: () => 1 },
    ask: () => { throw new Error('a Preview never asks the farm'); },
    signal: new AbortController().signal, thread: null, cache: true, item: null,
    sandbox: async () => sb,
  }));
  return sb;
}

export default (test) => {
  // ---- A8, guest side (K-4) ---------------------------------------------------------------------

  test('A8/K-4: a p5 Preview hands the guest its Width x Height as `size`', async () => {
    const part = partOf(PREVIEW, { mode: 'p5', w: 500, h: 200, source: 'function setup(){createCanvas(windowWidth, windowHeight);}' }, 'pv1');
    const sb = await previewRun(part);
    assert.equal(sb.runs.length, 1);
    assert.deepEqual(sb.runs[0].size, { w: 500, h: 200 }, 'the fields tell the truth: the guest frame IS the box');
    assert.equal(sb.runs[0].kind, 'p5');
  });

  test('A8/K-4: a three.js and an HTML Preview hand it too', async () => {
    const three = await previewRun(partOf(PREVIEW, { mode: 'three', w: 640, h: 360, source: 'const s = 1;' }, 'pv2'));
    assert.deepEqual(three.runs[0].size, { w: 640, h: 360 });
    const html = await previewRun(partOf(PREVIEW, { mode: 'html', w: 300, h: 150, source: '<p>hi</p>' }, 'pv3'));
    assert.deepEqual(html.runs[0].size, { w: 300, h: 150 });
    assert.equal(html.runs[0].css, PAGE_CSS);
  });

  test('A8: the page font is on #root (the snapshot clones the root alone), and the paper fills it', () => {
    const root = PAGE_CSS.split('\n').find((r) => r.startsWith('#root{')) || '';
    assert.ok(/font:14px\/1\.5 Inter,system-ui,sans-serif/.test(root), `the root carries the font: ${root}`);
    assert.ok(/min-height:100%/.test(root), 'the paper fills whatever size the box is');
    assert.equal(/body\{[^}]*font:/.test(PAGE_CSS), false, 'and body no longer holds a font the picture never saw');
  });

  test('A8: a guest error says what to DO about it, on its own line, when the explainer knows', () => {
    const plain = sandboxMessage({ message: 'boom', line: 0 }, 'x', 'p5');
    assert.equal(plain, 'boom', 'an error nobody can explain better is the engine\'s own sentence');
    assert.equal(sandboxMessage({ message: 'x', line: 0 }), 'x', 'no mode: exactly as before');
    if (typeof /** @type {any} */ (unfence).explainGuestError !== 'function') return;   // Package A not landed
    const said = sandboxMessage({ message: 'color is not defined', line: 2 }, 'let a;\nconst c = color(1);', 'p5');
    const [first, second] = said.split('\n');
    assert.equal(first, t('parts.previewError', { message: 'color is not defined', line: 2 }));
    assert.ok(second && /setup\(\)|draw\(\)/.test(second), `the fix, named: ${said}`);
    assert.equal(explained('color is not defined', 'p5'), second);
    assert.equal(explained('color is not defined', ''), '', 'no mode, no guess');
  });

  test('K-4: guestSize() is whole pixels, at least 1, at most GUEST_MAX_PX — or null', () => {
    assert.deepEqual(guestSize({ w: 500.4, h: 199.6 }), { w: 500, h: 200 });
    assert.deepEqual(guestSize({ w: 99999, h: 5 }), { w: GUEST_MAX_PX, h: 5 });
    assert.equal(guestSize({ w: 0, h: 5 }), null);
    assert.equal(guestSize({ w: 'x', h: 5 }), null);
    assert.equal(guestSize(null), null);
    assert.equal(guestSize(undefined), null);
  });

  test('K-4: the sandbox host sizes the frame before `run`, sends the size, and gives it back after', async () => {
    const frames = /** @type {any[]} */ ([]);
    const handlers = new Set();
    const win = {
      addEventListener(/** @type {string} */ type, /** @type {any} */ fn) { if (type === 'message') handlers.add(fn); },
      removeEventListener(/** @type {string} */ _type, /** @type {any} */ fn) { handlers.delete(fn); },
    };
    const deliver = (/** @type {any} */ data, /** @type {any} */ source) => { for (const fn of Array.from(handlers)) /** @type {any} */ (fn)({ data, source }); };
    const doc = {
      createElement() {
        const frame = /** @type {any} */ ({
          attrs: {}, style: {}, sent: [], parentNode: null, measured: 0,
          setAttribute(/** @type {string} */ k, /** @type {string} */ v) { frame.attrs[k] = v; },
          addEventListener(/** @type {string} */ type, /** @type {any} */ fn) { if (type === 'load') setTimeout(fn, 0); },
          getBoundingClientRect() { frame.measured += 1; return { width: 0, height: 0 }; },
          contentWindow: {
            postMessage(/** @type {any} */ msg) {
              // The size is on the frame BEFORE the guest hears `run`.
              frame.sent.push({ ...msg, styleAtSend: { ...frame.style } });
              const tok = msg.tok;
              const out = msg.cmd === 'boot' ? { v: 1, tok, kind: 'ready', ua: 'runner' }
                : msg.cmd === 'run' ? { v: 1, tok, kind: 'ran', id: msg.id, ok: true, ms: 1, error: null }
                  : msg.cmd === 'libs' ? { v: 1, tok, kind: 'libsDone', results: [] }
                    : msg.cmd === 'dispose' ? { v: 1, tok, kind: 'bye' } : null;
              if (out) setTimeout(() => deliver(out, frame.contentWindow), 0);
            },
          },
        });
        frames.push(frame);
        return frame;
      },
    };
    const mount = { appendChild(/** @type {any} */ el) { el.parentNode = mount; return el; }, removeChild(/** @type {any} */ el) { el.parentNode = null; return el; } };
    const sb = createSandbox({ doc: /** @type {any} */ (doc), win, timeouts: { boot: 200, run: 200, compute: 200, ping: 5000, snapshot: 200, hideGrace: 60 } });
    sb.mount(mount);
    const out = await sb.run({ kind: 'dom', html: '<p>x</p>', size: { w: 500, h: 200 } });
    assert.equal(out.ok, true);
    const fr = frames[0];
    const run1 = fr.sent.find((/** @type {any} */ m) => m.cmd === 'run');
    assert.deepEqual(run1.size, { w: 500, h: 200 }, 'the guest is told the size');
    assert.deepEqual(run1.styleAtSend, { width: '500px', height: '200px' }, 'and the frame had it before the message left');
    assert.ok(fr.measured >= 1, 'the parent laid the frame out at once');
    await sb.run({ kind: 'dom', html: '<p>y</p>' });
    const run2 = fr.sent.filter((/** @type {any} */ m) => m.cmd === 'run')[1];
    assert.equal(run2.size, null, 'a caller that names no size gets none');
    assert.deepEqual(fr.style, { width: '', height: '' }, 'and the frame goes back to the mount\'s own size');
    sb.destroy();
  });

  // ---- A6 / B6: the Sticky note and the Preview's K-2 door --------------------------------------

  test('B6: a Sticky with words is READ — click passes through, so the canvas selects it — until edit()', async () => {
    await withDom(async (doc) => {
      const b = render(sticky, doc, partOf(sticky, { text: 'I come back.' }, 'st1'));
      const area = b.q('.graph-sticky-text');
      assert.equal(area.readOnly, true, 'a click cannot put a caret in the words (Delete deletes the note)');
      assert.equal(area.classList.contains('is-reading'), true, 'the press goes through to the note');
      assert.equal(area.tabIndex, -1);
      assert.equal(typeof b.inst.edit, 'function', 'K-2');
      assert.equal(b.inst.edit(), true);
      assert.equal(area.readOnly, false, 'open for typing');
      assert.equal(area.classList.contains('is-reading'), false);
      area.dispatchEvent({ type: 'blur' });
      assert.equal(area.readOnly, true, 'leaving it puts it back to reading');
      assert.ok(b.commits.length >= 1, 'and closes the undo entry');
      b.host.dispatchEvent({ type: 'dblclick', target: b.host });
      assert.equal(area.readOnly, false, 'a double-click on the note opens it too');
      const tint = { closest: (/** @type {string} */ s) => (s === '.graph-sticky-tints' ? {} : null) };
      area.dispatchEvent({ type: 'blur' });
      b.host.dispatchEvent({ type: 'dblclick', target: tint });
      assert.equal(area.readOnly, true, 'but not a double-click on the tint row');
      b.inst.destroy();
    });
  });

  test('B6: an EMPTY sticky is its own editor at once, like an empty Text box', async () => {
    await withDom(async (doc) => {
      const b = render(sticky, doc, partOf(sticky, { text: '' }, 'st2'));
      const area = b.q('.graph-sticky-text');
      assert.equal(area.readOnly, false);
      assert.equal(area.classList.contains('is-reading'), false);
      area.dispatchEvent({ type: 'focus' });
      area.value = 'a new note';
      area.dispatchEvent({ type: 'input' });
      assert.deepEqual(b.patches, [{ text: 'a new note' }]);
      area.dispatchEvent({ type: 'blur' });
      assert.equal(area.readOnly, true, 'once it holds words, it is read until opened again');
      b.inst.destroy();
    });
  });

  test('A6/K-2: the Preview\'s edit() puts the caret in its code; A7: its markdown is selectable', async () => {
    await withDom(async (doc) => {
      const b = render(PREVIEW, doc, partOf(PREVIEW, { mode: 'markdown', source: '# Hello\n\nsome words' }, 'pv4'));
      const area = b.q('.graph-preview-source');
      let focused = 0;
      area.focus = () => { focused += 1; };
      assert.equal(b.inst.edit(), true);
      assert.equal(focused, 1);
      await settle();
      const body = b.q('.graph-preview-body');
      assert.equal(body.getAttribute('data-selectable'), 'text', 'a drawn markdown page is words: a selectable zone');
      // A double-click ON the words selects a word (the browser's meaning) — edit() in the same
      // turn does not pull the caret away from it.
      body.dispatchEvent({ type: 'dblclick', target: body });
      assert.equal(b.inst.edit(), false);
      assert.equal(focused, 1);
      await settle();
      assert.equal(b.inst.edit(), true, 'the next turn, Enter or a double-click elsewhere edits again');
      b.inst.destroy();
    });
  });

  // ---- A7: the Document's text ------------------------------------------------------------------

  test('A7: the Document\'s text is a selectable zone, and Copy puts ALL of it on the clipboard', async () => {
    const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    /** @type {string[]} */ const wrote = [];
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (/** @type {string} */ s) => { wrote.push(s); } } } });
    try {
      await withDom(async (doc) => {
        const app = { media: { async get() { return { id: 'f1', pages: [] }; } } };
        const words = `# Report\n\n${'lorem '.repeat(20000)}`;
        const part = { ...partOf(documentPart, { fileId: 'f1', name: 'r.pdf', mime: 'application/pdf', size: 10, sha256: 's' }, 'dc1'), value: valueOf('text', words) };
        const b = render(documentPart, doc, part, app);
        await settle();
        const text = b.q('.graph-doc-text');
        assert.equal(text.getAttribute('data-selectable'), 'text');
        const copy = b.q('.graph-doc-copy');
        assert.equal(copy.hidden, false, 'a box with text offers Copy');
        copy.dispatchEvent({ type: 'click', target: copy });
        await settle();
        assert.deepEqual(wrote, [words], 'every character, not the rendered-down head');
        b.inst.destroy();
      });
    } finally {
      if (had) Object.defineProperty(globalThis, 'navigator', had);
      else delete G.navigator;
    }
  });

  // ---- B16: the decoded sound ---------------------------------------------------------------------

  test('B16: a sound decoded for a box destroyed meanwhile is NOT pinned in the cache', async () => {
    // The player's AudioContext is made ONCE per module (audio.mjs `audioCtx`), so an earlier test
    // file's fake may be the one in use: the bytes are a "RIFF" + length header every fake decodes,
    // and the window in which the box goes away is held open on the STORE's read, which comes first.
    const saved = { a: G.AudioContext };
    class FakeAC {
      constructor() { this.currentTime = 0; this.destination = {}; }
      async decodeAudioData() { return { duration: 3 }; }
      createBufferSource() { return { connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }; }
      resume() { return Promise.resolve(); }
    }
    if (typeof G.AudioContext !== 'function') G.AudioContext = FakeAC;
    const riff = () => {
      const b = new Uint8Array(16);
      b.set([0x52, 0x49, 0x46, 0x46], 0);
      new DataView(b.buffer).setUint16(4, 3, true);
      return b.buffer;
    };
    let read = gate();
    try {
      await withDom(async (doc) => {
        const media = {
          async get() { return { id: 'snd-b16' }; },
          async bytes() { await read.p; return riff(); },
        };
        const b = render(audioPart, doc, partOf(audioPart, { fileId: 'snd-b16', name: 'long.wav', durationSec: 600, size: 1 }, 'au1'), { media });
        await settle();
        const play = b.q('.graph-audio-play');
        play.dispatchEvent({ type: 'click', target: play });
        await settle();
        b.inst.destroy();                      // the box goes while its sound is being read
        read.open();
        await settle();
        assert.notEqual(soundDebug().cached, 'snd-b16', 'nothing left holds a decoded copy for nobody');

        // The same decode for a box that is still there IS cached (the one-slot cache still works).
        read = gate();
        const c = render(audioPart, doc, partOf(audioPart, { fileId: 'snd-b16', name: 'long.wav', durationSec: 600, size: 1 }, 'au2'), { media });
        await settle();
        const play2 = c.q('.graph-audio-play');
        play2.dispatchEvent({ type: 'click', target: play2 });
        read.open();
        await settle();
        assert.equal(soundDebug().cached, 'snd-b16');
        c.inst.destroy();
        assert.equal(soundDebug().cached, null, 'and destroy lets it go');
      });
    } finally {
      if (saved.a === undefined) delete G.AudioContext; else G.AudioContext = saved.a;
    }
  });

  // ---- B17: two drops on one box --------------------------------------------------------------------

  test('B17: two PDFs dropped on one Document box — the LAST dropped wins, and the other is let go', async () => {
    await withDom(async (doc) => {
      const slow = gate();
      /** @type {any[]} */ const swept = [];
      let n = 0;
      const app = {
        media: {
          async put(/** @type {any} */ file) {
            n += 1;
            const id = `f-${file.name}`;
            if (n === 1) await slow.p;          // the FIRST drop is the slow one
            return { fileId: id, name: file.name, mime: 'application/pdf', size: 10, sha256: id };
          },
          async get(/** @type {string} */ id) { return { id }; },
          async sweep(/** @type {any} */ o) { swept.push(o); return 0; },
        },
      };
      const b = render(documentPart, doc, partOf(documentPart, {}, 'dc2'), app);
      const pdf = (/** @type {string} */ name) => ({ name, type: 'application/pdf', size: 10 });
      b.drop([pdf('first.pdf')]);
      b.drop([pdf('second.pdf')]);
      await settle();
      assert.equal(b.live.settings.fileId, 'f-second.pdf', 'the second drop is kept');
      slow.open();
      await settle();
      assert.equal(b.live.settings.fileId, 'f-second.pdf', 'the first, finishing late, does not overwrite it');
      assert.deepEqual(swept, [{ only: ['f-first.pdf'] }], 'and the bytes it kept are let go (unless still used)');
      b.inst.destroy();
    });
  });

  test('B17: two pictures dropped on one Image box — the LAST dropped wins', async () => {
    await withDom(async (doc) => {
      const slow = gate();
      let n = 0;
      const app = {
        intake: {
          async fromDrop(/** @type {any} */ dt) {
            n += 1;
            const name = dt.files[0].name;
            if (n === 1) await slow.p;
            return { dataUrl: `data:image/jpeg;base64,${name}`, name, w: 4, h: 3 };
          },
        },
      };
      const b = render(image, doc, partOf(image, {}, 'im1'), app);
      b.drop([{ name: 'first.png', type: 'image/png' }]);
      b.drop([{ name: 'second.png', type: 'image/png' }]);
      await settle();
      assert.equal(b.live.settings.name, 'second.png');
      slow.open();
      await settle();
      assert.equal(b.live.settings.name, 'second.png', 'the slower first drop lands nowhere');
      assert.equal(b.patches.length, 1, 'one edit, one undo entry');
      b.inst.destroy();
    });
  });

  test('B17: two sounds dropped on one Sound box — the LAST dropped wins', async () => {
    const saved = { o: G.OfflineAudioContext };
    const slow = gate();
    let n = 0;
    class FakeOffline {
      async decodeAudioData() { n += 1; if (n === 1) await slow.p; return { duration: 2 }; }
    }
    G.OfflineAudioContext = FakeOffline;
    try {
      await withDom(async (doc) => {
        /** @type {any[]} */ const swept = [];
        const app = {
          media: {
            async put(/** @type {any} */ file) { return { fileId: `f-${file.name}`, name: file.name, mime: file.type, size: 64, sha256: file.name }; },
            async get(/** @type {string} */ id) { return { id }; },
            async sweep(/** @type {any} */ o) { swept.push(o); return 0; },
          },
        };
        const b = render(audioPart, doc, partOf(audioPart, {}, 'au3'), app);
        const wav = (/** @type {string} */ name) => {
          const bytes = new Uint8Array(64);
          bytes.set([0x52, 0x49, 0x46, 0x46], 0);
          return new File([bytes], name, { type: 'audio/wav' });
        };
        b.drop([wav('first.wav')]);
        await settle(2);
        b.drop([wav('second.wav')]);
        await settle();
        assert.equal(b.live.settings.fileId, 'f-second.wav');
        slow.open();
        await settle();
        assert.equal(b.live.settings.fileId, 'f-second.wav', 'the first sound, measured late, does not replace it');
        assert.deepEqual(swept, [{ only: ['f-first.wav'] }]);
        b.inst.destroy();
      });
    } finally {
      if (saved.o === undefined) delete G.OfflineAudioContext; else G.OfflineAudioContext = saved.o;
    }
  });

  // ---- B17: a drop or a paste that finishes after a graph switch ------------------------------------

  test('B17: a canvas drop that finishes after a graph switch places NOTHING in the new graph', async () => {
    const slow = gate();
    let docId = 'gA';
    /** @type {any[]} */ const placed = [];
    /** @type {any[]} */ const swept = [];
    /** @type {string[]} */ const toasts = [];
    const app = /** @type {any} */ ({
      newId: () => 'x',
      host: {
        session: { doc: () => ({ id: docId, parts: [], wires: [] }), docId: () => docId, specs: SPECS },
        canvas: { placeEntry: (/** @type {any} */ e) => { placed.push(e); return 'p1'; }, announce() {} },
      },
      dialogs: { toast: (/** @type {string} */ s) => toasts.push(s) },
      media: {
        async put(/** @type {any} */ file) { await slow.p; return { fileId: 'f-big', name: file.name, mime: 'application/pdf', size: 10, sha256: 'ab' }; },
        async sweep(/** @type {any} */ o) { swept.push(o); return 0; },
      },
      farm: { get: () => ({ present: false, models: [] }), cap: () => 'unknown' },
    });
    installDrops(app);
    const pdf = new File(['%PDF-1.4 fake'], 'big.pdf', { type: 'application/pdf' });
    const routed = app.drops.route([pdf], { at: { x: 10, y: 10 } });
    await settle(2);
    docId = 'gB';                               // the person opens another graph meanwhile
    slow.open();
    const out = await routed;
    assert.deepEqual(placed, [], 'nothing lands in the graph that is open now');
    assert.deepEqual(out.placed, []);
    assert.equal(out.refused.length, 1);
    assert.equal(out.refused[0].reason, t('computer.dropSwitched', { name: 'big.pdf' }));
    assert.deepEqual(toasts, [t('computer.dropSwitched', { name: 'big.pdf' })], 'and the person is told, not left guessing');
    assert.deepEqual(swept, [{ only: ['f-big'] }], 'the kept bytes are let go again');
  });

  test('B17: a canvas drop with NO switch still places its box (the guard is not a wall)', async () => {
    /** @type {any[]} */ const placed = [];
    const app = /** @type {any} */ ({
      newId: () => 'x',
      host: {
        session: { doc: () => ({ id: 'gA', parts: [], wires: [] }), docId: () => 'gA', specs: SPECS },
        canvas: { placeEntry: (/** @type {any} */ e) => { placed.push(e); return 'p1'; }, announce() {} },
      },
      dialogs: { toast() {} },
      media: { async put(/** @type {any} */ file) { return { fileId: 'f1', name: file.name, mime: 'application/pdf', size: 10, sha256: 'ab' }; } },
      farm: { get: () => ({ present: false, models: [] }), cap: () => 'unknown' },
    });
    installDrops(app);
    const out = await app.drops.route([new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' })], { at: { x: 0, y: 0 } });
    assert.deepEqual(out.placed, ['p1']);
    assert.equal(placed.length, 1);
  });

  test('B17: a pasted picture read after a graph switch is not pasted into the new graph', async () => {
    const g = G;
    const had = { c: g.createImageBitmap, o: g.OffscreenCanvas, f: g.FileReader };
    const slow = gate();
    let docId = 'gA';
    g.createImageBitmap = async (/** @type {any} */ file) => { await slow.p; return { width: file.w, height: file.h, close() {} }; };
    g.OffscreenCanvas = class {
      constructor(/** @type {number} */ w, /** @type {number} */ h) { this.width = w; this.height = h; }
      getContext() { return { fillStyle: '', fillRect() {}, drawImage() {} }; }
      async convertToBlob() { return { n: 10 }; }
    };
    g.FileReader = class {
      readAsDataURL() { setTimeout(() => { /** @type {any} */ (this).result = 'data:image/jpeg;base64,AAAA'; /** @type {any} */ (this).onload(); }, 0); }
    };
    try {
      /** @type {string[]} */ const said = [];
      /** @type {any} */ const app = {
        now: () => 1,
        dialogs: { toast: (/** @type {string} */ m) => said.push(m) },
        host: {
          session: {
            specs: new Map([['image', image]]), docId: () => docId,
            doc: () => ({ id: docId, rev: 1, parts: [], wires: [] }), selected: () => [],
            apply: () => { throw new Error('the new graph must not be written'); },
          },
          canvas: { placeCentred: () => { throw new Error('nothing is placed in the new graph'); } },
        },
      };
      installIntake(app);
      const pasted = app.intake.adopt({ name: 'shot.png', type: 'image/png', w: 64, h: 64 });
      await settle(2);
      docId = 'gB';
      slow.open();
      assert.equal(await pasted, null);
      assert.deepEqual(said, [t('computer.pasteSwitched', { name: 'shot.png' })]);
    } finally {
      g.createImageBitmap = had.c; g.OffscreenCanvas = had.o; g.FileReader = had.f;
    }
  });
};
