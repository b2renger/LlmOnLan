// @ts-check
// K4-U2 in Node: image intake and the Image part (COMPUTER_PLAN §6.4, addendum KD-5).
//
// The whole pipeline is provable here because `readImage` takes its platform as an argument:
// the browser hands it `createImageBitmap`/`OffscreenCanvas`/`FileReader` and these tests hand it
// fakes that RECORD what the real ones would have been asked to do. So the numbers a picture is
// resized to, the encoding it is given, the ladder it climbs before it is refused and the sentence
// each refusal says are all checked without a browser — and the browser scenario (k4-vision) is
// left to prove only what a browser can: that the bytes reach the farm.

import assert from 'node:assert/strict';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import {
  fitWithin, isImageType, typeOf, nameFor, dataUrlBytes, mbOf, kbOf, filesOf, isTypingTarget,
  readImage, install, MAX_EDGE, STEPS, JPEG_TYPE, MATTE, ACCEPTED_TYPES,
  MAX_SOURCE_BYTES, MAX_SOURCE_PIXELS, MAX_INTAKE_FILES,
} from '../../../renderer/chat/computer/intake.mjs';
import { image, shownImage, arrivalOf, baseName } from '../../../renderer/chat/graph/parts/image.mjs';
import { valueOf, listOf } from '../../../renderer/chat/graph/values.mjs';
import { MAX_VALUE_BYTES } from '../../../renderer/chat/graph/serialize.mjs';

const PREFIX = 'data:image/jpeg;base64,';

/** A file, as a drop or a picker hands one over. */
const fileOf = (name, type, w, h) => ({ name, type, w, h });

/**
 * The platform, faked and recording. `bytesFor(w, h, quality)` decides how big the encoded picture
 * comes out, which is what lets a test drive the ladder without megabytes of base64.
 */
function fakePlatform(o = {}) {
  const bytesFor = o.bytesFor || (() => 1000);
  /** @type {any[]} */ const encodes = [];
  const state = { closed: 0, matte: /** @type {any} */ (null), drew: /** @type {any} */ (null) };

  class FakeCanvas {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext(kind) {
      assert.equal(kind, '2d');
      const self = this;
      return {
        fillStyle: '',
        fillRect(x, y, w, h) { state.matte = { fill: this.fillStyle, x, y, w, h }; },
        drawImage(bitmap, x, y, w, h) { state.drew = { x, y, w, h, from: { w: bitmap.width, h: bitmap.height } }; },
        get canvas() { return self; },
      };
    }
    async convertToBlob(opts) {
      encodes.push({ w: this.width, h: this.height, type: opts.type, quality: opts.quality });
      if (o.encodeFails) throw new Error('nope');
      return { n: Math.max(0, bytesFor(this.width, this.height, opts.quality) - PREFIX.length) };
    }
  }

  class FakeReader {
    readAsDataURL(blob) {
      setTimeout(() => {
        if (o.readerFails) { this.onerror(); return; }
        this.result = PREFIX + 'A'.repeat(blob.n);
        this.onload();
      }, 0);
    }
  }

  const env = {
    createImageBitmap: async (file) => {
      if (o.decodeFails) throw new Error('undecodable');
      return { width: file.w, height: file.h, close() { state.closed += 1; } };
    },
    OffscreenCanvas: FakeCanvas,
    FileReader: FakeReader,
    maxBytes: o.maxBytes || MAX_VALUE_BYTES,
    steps: o.steps,
  };
  return { env, encodes, state };
}

/** Run `fn` with the fake platform installed as globals, for the doors that take no `env`. */
async function withPlatform(fake, fn) {
  const g = /** @type {any} */ (globalThis);
  const had = { c: g.createImageBitmap, o: g.OffscreenCanvas, f: g.FileReader };
  g.createImageBitmap = fake.env.createImageBitmap;
  g.OffscreenCanvas = fake.env.OffscreenCanvas;
  g.FileReader = fake.env.FileReader;
  try { return await fn(); } finally {
    g.createImageBitmap = had.c; g.OffscreenCanvas = had.o; g.FileReader = had.f;
  }
}

/** Run `fn` with the unit runner's DOM shim installed as `globalThis.document`. */
async function withDom(fn) {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = doc;
  try { return await fn(doc); } finally {
    if (had) /** @type {any} */ (globalThis).document = prev;
    else delete (/** @type {any} */ (globalThis).document);
  }
}

/** The part, rendered into the shim, with a ctx that records what it was asked to write. */
async function renderPart(part, o = {}) {
  return withDom(async (doc) => {
    const host = doc.createElement('div');
    /** @type {any[]} */ const edits = [];
    /** @type {any} */ let live = part;
    const ctx = {
      get part() { return live; },
      update(patch) { edits.push({ kind: 'update', patch }); live = { ...live, settings: { ...live.settings, ...patch } }; },
      commit(label) { edits.push({ kind: 'commit', label }); },
      open() {},
      app: o.app || {},
    };
    const inst = image.render(host, part, /** @type {any} */ (ctx));
    return { host, inst, edits, ctx, doc, repaint: (next) => { live = next; inst.update(next); } };
  });
}

export default (test) => {
  // ---- fitWithin: the golden numbers (KD-5) ---------------------------------------------------

  test('fitWithin: a big picture comes down to the long edge, aspect intact', () => {
    assert.deepEqual(fitWithin(4000, 3000), { w: 1536, h: 1152 });
    assert.deepEqual(fitWithin(3000, 4000), { w: 1152, h: 1536 });
    assert.deepEqual(fitWithin(3000, 3000), { w: 1536, h: 1536 });
    assert.deepEqual(fitWithin(4096, 100), { w: 1536, h: 38 });
  });

  test('fitWithin: a small picture is never enlarged, and a broken size is nothing', () => {
    assert.deepEqual(fitWithin(1200, 800), { w: 1200, h: 800 });
    assert.deepEqual(fitWithin(MAX_EDGE, 900), { w: MAX_EDGE, h: 900 });
    assert.deepEqual(fitWithin(0, 900), { w: 0, h: 0 });
    assert.deepEqual(fitWithin(900, 0), { w: 0, h: 0 });
    assert.deepEqual(fitWithin(NaN, NaN), { w: 0, h: 0 });
  });

  test('fitWithin: a custom edge, and a side that rounds to at least one pixel', () => {
    assert.deepEqual(fitWithin(800, 2000, 1000), { w: 400, h: 1000 });
    assert.deepEqual(fitWithin(10000, 3, 1000), { w: 1000, h: 1 });
  });

  // ---- what counts as a picture ---------------------------------------------------------------

  test('isImageType / typeOf: the declared type wins, the extension is the fallback', () => {
    for (const type of ACCEPTED_TYPES) assert.equal(isImageType(type), true, type);
    assert.equal(isImageType('image/png;charset=binary'), true);
    assert.equal(isImageType('IMAGE/PNG'), true);
    assert.equal(isImageType('application/pdf'), false);
    assert.equal(isImageType(''), false);
    assert.equal(typeOf({ name: 'a.PNG', type: '' }), 'image/png');
    assert.equal(typeOf({ name: 'a.jpeg', type: '' }), 'image/jpeg');
    assert.equal(typeOf({ name: 'notes.md', type: '' }), '');
    assert.equal(typeOf({ name: 'x.png', type: 'image/webp' }), 'image/webp');
    assert.equal(nameFor({ name: '' }), t('parts.imageUnnamed'));
    assert.equal(nameFor({ name: 'shot.png' }), 'shot.png');
  });

  test('dataUrlBytes counts the STRING, because the string is what is stored and exported', () => {
    assert.equal(dataUrlBytes('data:image/jpeg;base64,AAAA'), 27);
    assert.equal(dataUrlBytes(''), 0);
    assert.equal(mbOf(1024 * 1024), '1.0');
    assert.equal(mbOf(1024 * 1024 * 12), '12');
    assert.equal(kbOf(2048), 2);
  });

  test('filesOf: pictures only, deduplicated, and a graph-file drop is not ours', () => {
    const png = fileOf('a.png', 'image/png', 10, 10);
    const gguf = fileOf('g.lolgraph.json', 'application/json', 0, 0);
    assert.deepEqual(filesOf({ items: [{ kind: 'file', getAsFile: () => png }, { kind: 'string', getAsFile: () => png }] }), [png]);
    assert.deepEqual(filesOf({ items: [{ kind: 'file', getAsFile: () => gguf }] }), []);
    assert.deepEqual(filesOf({ files: [png, gguf] }), [png]);
    assert.deepEqual(filesOf({ items: [{ kind: 'file', getAsFile: () => png }, { kind: 'file', getAsFile: () => png }] }), [png]);
    assert.deepEqual(filesOf(null), []);
  });

  test('isTypingTarget: a picture pasted into a field belongs to the field', () => {
    assert.equal(isTypingTarget({ nodeType: 1, tagName: 'TEXTAREA' }), true);
    assert.equal(isTypingTarget({ nodeType: 1, tagName: 'INPUT' }), true);
    assert.equal(isTypingTarget({ nodeType: 1, tagName: 'DIV', closest: () => null }), false);
    assert.equal(isTypingTarget({ nodeType: 1, tagName: 'DIV', isContentEditable: true, closest: () => null }), true);
    assert.equal(isTypingTarget(null), false);
  });

  // ---- the pipeline ---------------------------------------------------------------------------

  test('readImage: decode, fit, matte, JPEG, data URL — and the bitmap is closed', async () => {
    const fake = fakePlatform({ bytesFor: () => 5000 });
    const out = await readImage(fileOf('holiday.png', 'image/png', 4000, 3000), fake.env);
    assert.equal(/** @type {any} */ (out).error, undefined);
    assert.deepEqual({ w: /** @type {any} */ (out).w, h: /** @type {any} */ (out).h }, { w: 1536, h: 1152 });
    assert.equal(/** @type {any} */ (out).name, 'holiday.png');
    assert.equal(String(/** @type {any} */ (out).dataUrl).startsWith(PREFIX), true);
    assert.equal(dataUrlBytes(/** @type {any} */ (out).dataUrl), 5000);
    assert.deepEqual(fake.encodes, [{ w: 1536, h: 1152, type: JPEG_TYPE, quality: STEPS[0].quality }]);
    assert.deepEqual(fake.state.matte, { fill: MATTE, x: 0, y: 0, w: 1536, h: 1152 },
      'a JPEG has no alpha, so a transparent PNG needs a matte or it arrives black');
    assert.deepEqual(fake.state.drew, { x: 0, y: 0, w: 1536, h: 1152, from: { w: 4000, h: 3000 } });
    assert.equal(fake.state.closed, 1, 'the bitmap is released');
  });

  test('readImage: a small picture keeps its own size', async () => {
    const fake = fakePlatform();
    const out = await readImage(fileOf('chip.png', 'image/png', 300, 200), fake.env);
    assert.deepEqual({ w: /** @type {any} */ (out).w, h: /** @type {any} */ (out).h }, { w: 300, h: 200 });
    assert.equal(fake.encodes.length, 1);
  });

  test('readImage: the ladder — a heavy photograph is tried smaller before it is refused', async () => {
    // Over the cap at 1536, under it at 1024: the second rung is the one that ships.
    const fake = fakePlatform({ maxBytes: 1000, bytesFor: (w) => (w > 1024 ? 5000 : 900) });
    const out = await readImage(fileOf('big.jpg', 'image/jpeg', 4000, 4000), fake.env);
    assert.equal(/** @type {any} */ (out).error, undefined, 'it was not refused');
    assert.deepEqual({ w: /** @type {any} */ (out).w, h: /** @type {any} */ (out).h }, { w: 1024, h: 1024 });
    assert.deepEqual(fake.encodes.map((e) => e.w), [1536, 1024]);
    assert.deepEqual(fake.encodes.map((e) => e.quality), [STEPS[0].quality, STEPS[1].quality]);
  });

  test('readImage: still too big at the last rung is a refusal that names the size', async () => {
    const fake = fakePlatform({ maxBytes: 1024 * 1024, bytesFor: () => 3 * 1024 * 1024 });
    const out = await readImage(fileOf('huge.jpg', 'image/jpeg', 6000, 6000), fake.env);
    assert.equal(/** @type {any} */ (out).error, t('parts.imageTooBig', { mb: '3.0', capMb: '1.0' }));
    assert.equal(fake.encodes.length, STEPS.length, 'every rung was tried first');
    assert.equal(fake.state.closed, 1);
  });

  test('readImage: a file that is not a picture is refused by NAME, before any decode', async () => {
    const fake = fakePlatform();
    const out = await readImage(fileOf('notes.md', 'text/markdown', 10, 10), fake.env);
    assert.equal(/** @type {any} */ (out).error, t('parts.imageNotAnImage', { type: 'text/markdown' }));
    assert.equal(fake.encodes.length, 0);
    const bare = await readImage(fileOf('mystery', '', 10, 10), fake.env);
    assert.equal(/** @type {any} */ (bare).error, t('parts.imageNotAnImage', { type: t('parts.imageTypeUnknown') }),
      'an unknown type still reads as a sentence');
  });

  test('readImage: a broken decoder, a broken encoder and a broken reader all answer one sentence', async () => {
    const one = await readImage(fileOf('a.png', 'image/png', 10, 10), fakePlatform({ decodeFails: true }).env);
    assert.equal(/** @type {any} */ (one).error, t('parts.imageUnreadable'));
    const two = await readImage(fileOf('a.png', 'image/png', 10, 10), fakePlatform({ encodeFails: true }).env);
    assert.equal(/** @type {any} */ (two).error, t('parts.imageUnreadable'));
    const three = await readImage(fileOf('a.png', 'image/png', 10, 10), fakePlatform({ readerFails: true }).env);
    assert.equal(/** @type {any} */ (three).error, t('parts.imageUnreadable'));
    const none = await readImage(null, fakePlatform().env);
    assert.equal(/** @type {any} */ (none).error, t('parts.imageUnreadable'));
    const zero = await readImage(fileOf('a.png', 'image/png', 0, 0), fakePlatform().env);
    assert.equal(/** @type {any} */ (zero).error, t('parts.imageUnreadable'));
  });

  test('readImage: no platform at all refuses instead of throwing into a drop handler', async () => {
    const out = await readImage(fileOf('a.png', 'image/png', 10, 10), { createImageBitmap: null, OffscreenCanvas: null, FileReader: null });
    assert.equal(/** @type {any} */ (out).error, t('parts.imageUnreadable'));
  });

  // ---- install(): the seam KD-5 froze ---------------------------------------------------------

  test('install: app.intake has the frozen shape, and debug() counts what happened', async () => {
    const fake = fakePlatform({ bytesFor: () => 4000 });
    await withPlatform(fake, async () => {
      /** @type {any} */ const app = {};
      install(app);
      for (const key of ['fromFile', 'fromDataTransfer', 'fromDrop', 'pick', 'fitWithin', 'debug']) {
        assert.equal(typeof app.intake[key], 'function', key);
      }
      assert.deepEqual(app.intake.debug(), { reads: 0, refused: 0, lastError: null });

      const ok = await app.intake.fromFile(fileOf('a.png', 'image/png', 100, 50));
      assert.deepEqual({ w: ok.w, h: ok.h, name: ok.name }, { w: 100, h: 50, name: 'a.png' });
      const bad = await app.intake.fromFile(fileOf('a.md', 'text/markdown', 1, 1));
      assert.equal(bad.error, t('parts.imageNotAnImage', { type: 'text/markdown' }));
      assert.deepEqual(app.intake.debug(), { reads: 1, refused: 1, lastError: bad.error });
    });
  });

  test('install: fromDataTransfer answers one result per picture, and [] for a graph file', async () => {
    const fake = fakePlatform({ bytesFor: () => 4000 });
    await withPlatform(fake, async () => {
      /** @type {any} */ const app = {};
      install(app);
      const png = fileOf('a.png', 'image/png', 80, 40);
      const jpg = fileOf('b.jpg', 'image/jpeg', 40, 80);
      const results = await app.intake.fromDataTransfer({ files: [png, jpg] });
      assert.equal(results.length, 2);
      assert.deepEqual(results.map((r) => r.name), ['a.png', 'b.jpg']);
      assert.deepEqual(results.map((r) => [r.w, r.h]), [[80, 40], [40, 80]]);
      assert.deepEqual(await app.intake.fromDataTransfer({ files: [fileOf('g.json', 'application/json', 0, 0)] }), []);
      assert.equal(app.intake.debug().reads, 2);
    });
  });

  test('install: fromDrop reads the FIRST picture and decodes nothing else', async () => {
    const fake = fakePlatform({ bytesFor: () => 4000 });
    await withPlatform(fake, async () => {
      /** @type {any} */ const app = {};
      install(app);
      // A folder of pictures dropped on one box. Only one of them can ever be shown, so only one
      // may be decoded: the rest would be a full decode + a base64 string each, held at once.
      const files = [];
      for (let i = 0; i < 40; i += 1) files.push(fileOf(`p${i}.png`, 'image/png', 80, 40));
      const out = await app.intake.fromDrop({ files });
      assert.equal(out.name, 'p0.png', 'the first picture is the one the box takes');
      assert.equal(app.intake.debug().reads, 1, 'and it is the ONLY one that was decoded');
      assert.equal(fake.encodes.length, 1, 'one encode, not forty');
      assert.equal(await app.intake.fromDrop({ files: [fileOf('g.json', 'application/json', 0, 0)] }), null,
        'a drag with no picture in it is not ours');
    });
  });

  test('install: fromDataTransfer is capped, so no gesture can decode a whole folder', async () => {
    const fake = fakePlatform({ bytesFor: () => 4000 });
    await withPlatform(fake, async () => {
      /** @type {any} */ const app = {};
      install(app);
      const files = [];
      for (let i = 0; i < 40; i += 1) files.push(fileOf(`p${i}.png`, 'image/png', 80, 40));
      const results = await app.intake.fromDataTransfer({ files });
      assert.equal(results.length, MAX_INTAKE_FILES, 'the cap, not the folder');
      assert.equal((await app.intake.fromDataTransfer({ files }, { limit: 2 })).length, 2,
        'and a caller may ask for fewer');
    });
  });

  test('readImage: a source too big in bytes is refused BEFORE it is decoded', async () => {
    const fake = fakePlatform({ bytesFor: () => 4000 });
    let decodes = 0;
    const env = { ...fake.env, createImageBitmap: async (f) => { decodes += 1; return fake.env.createImageBitmap(f); } };
    const huge = { ...fileOf('scan.png', 'image/png', 100, 50), size: MAX_SOURCE_BYTES + 1 };
    const out = await readImage(huge, env);
    assert.equal(/** @type {any} */ (out).error,
      t('parts.imageTooBig', { mb: mbOf(MAX_SOURCE_BYTES + 1), capMb: mbOf(MAX_SOURCE_BYTES) }));
    assert.equal(decodes, 0, 'the decode is the biggest allocation here: it never ran');
    const ok = await readImage({ ...fileOf('ok.png', 'image/png', 100, 50), size: 1024 }, env);
    assert.equal(/** @type {any} */ (ok).w, 100, 'an ordinary file is untouched by the guard');
  });

  test('readImage: a source too big in PIXELS is refused before anything is drawn', async () => {
    const fake = fakePlatform({ bytesFor: () => 4000 });
    // A 16000x16000 scan: a few MB on disk, ~1 GB decoded.
    const out = await readImage(fileOf('panorama.png', 'image/png', 16000, 16000), fake.env);
    assert.ok(/** @type {any} */ (out).error, 'refused');
    assert.equal(fake.encodes.length, 0, 'and no canvas was ever asked for');
    assert.ok(16000 * 16000 > MAX_SOURCE_PIXELS);
    assert.equal(fake.state.closed, 1, 'the bitmap is still closed on the way out');
  });

  test('install: a pasted picture becomes ONE undoable settings edit on the selected Image box', async () => {
    const fake = fakePlatform({ bytesFor: () => 4000 });
    await withPlatform(fake, async () => {
      let doc = {
        id: 'g', rev: 1,
        parts: [{ id: 'p1', type: 'image', x: 0, y: 0, w: 240, h: 200, settings: { dataUrl: '', name: '' }, value: null, state: 'idle', error: null, stats: null }],
        wires: [],
      };
      /** @type {any[]} */ const applied = [];
      /** @type {any[]} */ const placed = [];
      /** @type {any} */ const app = {
        now: () => 1,
        host: {
          session: {
            specs: new Map([['image', image]]),
            doc: () => doc,
            selected: () => ['p1'],
            apply: (next, o) => { doc = next; applied.push(o.label); },
          },
          canvas: { placeCentred: (type) => { placed.push(type); return 'p2'; } },
        },
      };
      install(app);
      const id = await app.intake.adopt(fileOf('plan.png', 'image/png', 200, 100));
      assert.equal(id, 'p1', 'the selected Image box took it');
      assert.deepEqual(placed, [], 'no new box was placed');
      assert.deepEqual(applied, ['image'], 'one undoable edit, labelled');
      const settings = doc.parts[0].settings;
      assert.equal(settings.name, 'plan.png');
      assert.deepEqual([settings.w, settings.h], [200, 100]);
      assert.equal(String(settings.dataUrl).startsWith(PREFIX), true);
    });
  });

  test('install: with nothing selected the paste places a new Image box', async () => {
    const fake = fakePlatform({ bytesFor: () => 4000 });
    await withPlatform(fake, async () => {
      let doc = { id: 'g', rev: 1, parts: [], wires: [] };
      /** @type {any[]} */ const placed = [];
      /** @type {any} */ const app = {
        now: () => 1,
        host: {
          session: {
            specs: new Map([['image', image]]),
            doc: () => doc,
            selected: () => [],
            apply: (next) => { doc = next; },
          },
          canvas: {
            placeCentred: (type) => {
              placed.push(type);
              doc = { ...doc, parts: [{ id: 'p9', type, x: 0, y: 0, w: 240, h: 200, settings: {}, value: null, state: 'idle', error: null, stats: null }] };
              return 'p9';
            },
          },
        },
      };
      install(app);
      assert.equal(await app.intake.adopt(fileOf('paste.png', 'image/png', 64, 64)), 'p9');
      assert.deepEqual(placed, ['image']);
      assert.equal(String(doc.parts[0].settings.dataUrl).startsWith(PREFIX), true);
    });
  });

  test('install: a refused picture never writes the document', async () => {
    const fake = fakePlatform();
    await withPlatform(fake, async () => {
      let doc = { id: 'g', rev: 1, parts: [], wires: [] };
      /** @type {string[]} */ const said = [];
      /** @type {any} */ const app = {
        now: () => 1,
        dialogs: { toast: (m) => said.push(m) },
        host: {
          session: { specs: new Map(), doc: () => doc, selected: () => [], apply: () => { throw new Error('the document must not be touched'); } },
          canvas: { placeCentred: () => { throw new Error('nothing is placed for a refusal'); } },
        },
      };
      install(app);
      assert.equal(await app.intake.adopt(fileOf('notes.md', 'text/markdown', 0, 0)), null);
      assert.deepEqual(said, [t('parts.imageNotAnImage', { type: 'text/markdown' })]);
    });
  });

  // ---- the Image part -------------------------------------------------------------------------

  test('the Image spec: one optional port, an image out, and it never thinks', () => {
    assert.equal(image.type, 'image');
    assert.equal(image.output, 'image');
    assert.equal(image.thinks, false);
    assert.equal(image.inputs.length, 1);
    assert.equal(image.inputs[0].name, 'file');
    assert.deepEqual(image.inputs[0].accepts, ['file', 'image']);
    assert.equal(image.inputs[0].required, false);
    assert.deepEqual(image.defaults(), { dataUrl: '', name: '', w: 0, h: 0 });
  });

  test('shownImage: an arrival wins over the held picture, and neither is invented', () => {
    const held = { settings: { dataUrl: 'data:image/jpeg;base64,AA', name: 'held.png', w: 20, h: 10 }, value: null };
    assert.deepEqual(shownImage(held), { dataUrl: 'data:image/jpeg;base64,AA', name: 'held.png', w: 20, h: 10, from: 'held' });
    const both = { ...held, value: valueOf('image', { dataUrl: 'data:image/png;base64,BB', name: 'wire.png' }) };
    assert.equal(shownImage(both).from, 'input');
    assert.equal(shownImage(both).dataUrl, 'data:image/png;base64,BB');
    assert.equal(shownImage({ settings: {}, value: null }).from, 'none');
    assert.equal(shownImage({ settings: {}, value: valueOf('text', 'hello') }).from, 'none',
      'a text value is not a picture and must not be shown as one');
    assert.equal(baseName('out/shot.png'), 'shot.png');
  });

  test('arrivalOf: one picture is adopted, two is a sentence, a text is a sentence', () => {
    assert.deepEqual(arrivalOf([]), { ok: false, message: '' });
    const one = valueOf('image', { dataUrl: 'data:image/png;base64,AA', name: 'a.png' });
    assert.deepEqual(arrivalOf([one]), { ok: true, value: one });
    assert.deepEqual(arrivalOf([listOf([one])]), { ok: true, value: one }, 'a one-item list is one picture');
    const two = arrivalOf([one, one]);
    assert.equal(two.ok, false);
    assert.equal(/** @type {any} */ (two).message, t('parts.imageOnePicture', { n: 2 }));
    const wrong = arrivalOf([valueOf('text', 'a picture, honest')]);
    assert.equal(/** @type {any} */ (wrong).message, t('parts.imageWrongKind', { kind: 'text' }));
  });

  test('run: the held picture is what goes downstream when nothing arrives', async () => {
    const out = await image.run(/** @type {any} */ ({
      part: { settings: { dataUrl: 'data:image/jpeg;base64,AA', name: 'held.png', w: 4, h: 4 } },
      inputs: {},
    }));
    assert.deepEqual(out, valueOf('image', { dataUrl: 'data:image/jpeg;base64,AA', name: 'held.png' }),
      'the box sizing never travels on a wire');
  });

  test('run: an empty box fails with the sentence the empty state shows', async () => {
    await assert.rejects(
      () => image.run(/** @type {any} */ ({ part: { settings: {} }, inputs: {} })),
      (err) => err.message === t('parts.imageEmpty') && err.reason === 'empty',
    );
  });

  test('run: an arriving picture is adopted and passed on — and settings are NOT written', async () => {
    const part = { settings: { dataUrl: 'data:image/jpeg;base64,HELD', name: 'held.png' } };
    const arriving = valueOf('image', { dataUrl: 'data:image/png;base64,NEW', name: 'wire.png' });
    const out = await image.run(/** @type {any} */ ({ part, inputs: { file: [arriving] } }));
    assert.deepEqual(out, valueOf('image', { dataUrl: 'data:image/png;base64,NEW', name: 'wire.png' }));
    assert.equal(part.settings.dataUrl, 'data:image/jpeg;base64,HELD',
      'a run never rewrites the program: re-running cannot destroy the picture someone dropped in');
  });

  test('run: two pictures at one port is a refusal naming the count', async () => {
    const one = valueOf('image', { dataUrl: 'data:image/png;base64,AA', name: 'a.png' });
    await assert.rejects(
      () => image.run(/** @type {any} */ ({ part: { settings: {} }, inputs: { file: [one, one] } })),
      (err) => err.message === t('parts.imageOnePicture', { n: 2 }),
    );
  });

  test('run: a file value is read from the graph folder and becomes a picture', async () => {
    /** @type {any[]} */ const asked = [];
    const app = {
      projects: {
        readBinary: async (id, rel) => { asked.push([id, rel]); return { ok: true, base64: 'QUJD', mime: 'image/png', size: 3 }; },
      },
    };
    const out = await image.run(/** @type {any} */ ({
      part: { settings: {} },
      inputs: { file: [valueOf('file', { path: 'out/shot.png', project: 'proj-1', size: 3 })] },
      app,
    }));
    assert.deepEqual(asked, [['proj-1', 'out/shot.png']]);
    assert.deepEqual(out, valueOf('image', { dataUrl: 'data:image/png;base64,QUJD', name: 'shot.png' }));
  });

  test('run: a file that is not a picture, or unreadable, or nameless, says which', async () => {
    const run = (value, app) => image.run(/** @type {any} */ ({ part: { settings: {} }, inputs: { file: [value] }, app }));
    const notes = valueOf('file', { path: 'out/notes.md', project: 'proj-1' });
    await assert.rejects(
      () => run(notes, { projects: { readBinary: async () => ({ ok: true, base64: 'QQ==', mime: 'text/markdown' }) } }),
      (err) => err.message === t('parts.imageFileNotAPicture', { path: 'out/notes.md', type: 'text/markdown' }),
    );
    await assert.rejects(
      () => run(notes, { projects: { readBinary: async () => ({ ok: false, code: 'E_MISSING' }) } }),
      (err) => err.message === t('parts.imageFileUnreadable', { path: 'out/notes.md' }),
    );
    await assert.rejects(
      () => run(valueOf('file', { path: 'out/shot.png' }), { projects: { readBinary: async () => ({ ok: true }) } }),
      (err) => err.message === t('parts.imageNoProject'),
    );
    await assert.rejects(
      () => run(notes, {}),
      (err) => err.message === t('parts.imageFileUnreadable', { path: 'out/notes.md' }),
    );
  });

  test('run: a file bigger than a value may carry is refused with its size', async () => {
    const big = 'Q'.repeat(MAX_VALUE_BYTES + 64);
    const url = `data:image/png;base64,${big}`;
    await assert.rejects(
      () => image.run(/** @type {any} */ ({
        part: { settings: {} },
        inputs: { file: [valueOf('file', { path: 'out/huge.png', project: 'p' })] },
        app: { projects: { readBinary: async () => ({ ok: true, base64: big, mime: 'image/png' }) } },
      })),
      (err) => err.message === t('parts.imageFileTooBig', { path: 'out/huge.png', mb: mbOf(url.length), capMb: mbOf(MAX_VALUE_BYTES) }),
    );
  });

  // ---- the box on the canvas ------------------------------------------------------------------

  test('render: an empty box is the drop target and offers the picker', async () => {
    const part = { id: 'p1', type: 'image', settings: image.defaults(), value: null };
    const r = await renderPart(part);
    const empty = r.host.querySelector('.graph-image-empty');
    assert.ok(empty, 'the empty state is there');
    assert.equal(empty.textContent, t('parts.imageEmpty'));
    assert.equal(r.host.querySelector('.graph-image-figure').hidden, true);
    assert.equal(r.host.querySelector('.graph-image-foot').hidden, true);
  });

  test('render: a held picture is shown, with its size and the two edits it allows', async () => {
    const part = {
      id: 'p1', type: 'image', value: null,
      settings: { dataUrl: `${PREFIX}${'A'.repeat(2048)}`, name: 'plan.png', w: 800, h: 600 },
    };
    const r = await renderPart(part);
    const img = r.host.querySelector('.graph-image-shot');
    assert.equal(img.getAttribute('src'), part.settings.dataUrl);
    assert.equal(img.alt, t('parts.imageAria', { name: 'plan.png', w: 800, h: 600 }));
    assert.equal(r.host.querySelector('.graph-image-empty').hidden, true);
    assert.equal(r.host.querySelector('.graph-image-caption').textContent,
      t('parts.imageSize', { w: 800, h: 600, kb: kbOf(part.settings.dataUrl.length) }));
    assert.equal(r.host.querySelector('.graph-image-badge').hidden, true);
    const buttons = r.host.querySelectorAll('.graph-image-btn');
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].hidden, false);
  });

  test('render: an arrived picture says so, and hides the two edits that would rewrite settings', async () => {
    const part = {
      id: 'p1', type: 'image',
      settings: { dataUrl: `${PREFIX}HELD`, name: 'held.png', w: 10, h: 10 },
      value: valueOf('image', { dataUrl: `${PREFIX}WIRE`, name: 'wire.png' }),
    };
    const r = await renderPart(part);
    assert.equal(r.host.querySelector('.graph-image-shot').getAttribute('src'), `${PREFIX}WIRE`);
    const badge = r.host.querySelector('.graph-image-badge');
    assert.equal(badge.hidden, false);
    assert.equal(badge.textContent, t('parts.imageFromInput'));
    for (const b of r.host.querySelectorAll('.graph-image-btn')) assert.equal(b.hidden, true);
    // and when the value is cleared the held picture comes back, untouched.
    r.repaint({ ...part, value: null });
    assert.equal(r.host.querySelector('.graph-image-shot').getAttribute('src'), `${PREFIX}HELD`);
    assert.equal(r.host.querySelector('.graph-image-badge').hidden, true);
  });

  test('render: Remove clears the held picture as ONE undoable edit', async () => {
    const part = {
      id: 'p1', type: 'image', value: null,
      settings: { dataUrl: `${PREFIX}AA`, name: 'plan.png', w: 10, h: 10 },
    };
    const r = await renderPart(part);
    const remove = r.host.querySelectorAll('.graph-image-btn')[1];
    assert.equal(remove.textContent, t('parts.imageRemove'));
    remove.dispatchEvent({ type: 'click' });
    assert.deepEqual(r.edits, [
      { kind: 'update', patch: { dataUrl: '', name: '', w: 0, h: 0 } },
      { kind: 'commit', label: t('parts.imageRemove') },
    ]);
    assert.equal(r.host.querySelector('.graph-image-empty').hidden, false);
  });

  test('render: choosing a picture goes through the intake and commits once', async () => {
    const chosen = { dataUrl: `${PREFIX}NEW`, name: 'chosen.png', w: 320, h: 240 };
    let picks = 0;
    const app = { intake: { pick: async () => { picks += 1; return chosen; } } };
    const part = { id: 'p1', type: 'image', settings: image.defaults(), value: null };
    const r = await renderPart(part, { app });
    r.host.querySelector('.graph-image-empty').dispatchEvent({ type: 'click' });
    assert.equal(r.host.querySelector('.graph-image-note').textContent, t('parts.imageWorking'));
    await new Promise((done) => { setTimeout(done, 0); });
    assert.equal(picks, 1);
    assert.deepEqual(r.edits, [
      { kind: 'update', patch: { dataUrl: chosen.dataUrl, name: 'chosen.png', w: 320, h: 240 } },
      { kind: 'commit', label: t('parts.imageLabel') },
    ]);
    assert.equal(r.host.querySelector('.graph-image-shot').getAttribute('src'), chosen.dataUrl);
  });

  test('render: a refused picture is one line on the box and no edit at all', async () => {
    const app = { intake: { pick: async () => ({ error: t('parts.imageUnreadable') }) } };
    const part = { id: 'p1', type: 'image', settings: image.defaults(), value: null };
    const r = await renderPart(part, { app });
    r.host.querySelector('.graph-image-empty').dispatchEvent({ type: 'click' });
    await new Promise((done) => { setTimeout(done, 0); });
    assert.deepEqual(r.edits, []);
    const note = r.host.querySelector('.graph-image-note');
    assert.equal(note.textContent, t('parts.imageUnreadable'));
    assert.equal(note.hidden, false);
  });

  test('render: a dropped picture is read by the intake and stops at the box', async () => {
    const dropped = { dataUrl: `${PREFIX}DROP`, name: 'drop.png', w: 100, h: 50 };
    /** @type {any[]} */ const seen = [];
    // `fromDrop`, which reads ONE file: a folder dropped on a box must not decode 300 pictures.
    const app = { intake: { fromDrop: async (dt) => { seen.push(dt); return dropped; } } };
    const part = { id: 'p1', type: 'image', settings: image.defaults(), value: null };
    const r = await renderPart(part, { app });
    let prevented = 0;
    let stopped = 0;
    r.host.dispatchEvent({
      type: 'drop',
      dataTransfer: { types: ['Files'], files: [] },
      preventDefault: () => { prevented += 1; },
      stopPropagation: () => { stopped += 1; },
    });
    await new Promise((done) => { setTimeout(done, 0); });
    assert.equal(seen.length, 1);
    assert.equal(prevented, 1);
    assert.equal(stopped, 1, 'the canvas must not also read the picture as a graph file');
    assert.deepEqual(r.edits, [
      { kind: 'update', patch: { dataUrl: dropped.dataUrl, name: 'drop.png', w: 100, h: 50 } },
      { kind: 'commit', label: t('parts.imageLabel') },
    ]);
  });

  test('render: a drag that carries no file is left entirely alone', async () => {
    /** @type {any[]} */ const seen = [];
    const app = { intake: { fromDrop: async (dt) => { seen.push(dt); return null; } } };
    const part = { id: 'p1', type: 'image', settings: image.defaults(), value: null };
    const r = await renderPart(part, { app });
    let prevented = 0;
    r.host.dispatchEvent({
      type: 'drop',
      dataTransfer: { types: ['text/plain'] },
      preventDefault: () => { prevented += 1; },
      stopPropagation: () => {},
    });
    await new Promise((done) => { setTimeout(done, 0); });
    assert.deepEqual(seen, [], 'a part being dragged is not an intake');
    assert.equal(prevented, 0);
  });

  test('render: destroy leaves the box empty and the listeners gone', async () => {
    const part = { id: 'p1', type: 'image', settings: image.defaults(), value: null };
    const r = await renderPart(part, { app: { intake: { fromDrop: async () => null } } });
    r.inst.destroy();
    assert.equal(r.host.childNodes.length, 0);
    assert.equal(r.host.classList.contains('graph-image'), false);
  });
};
