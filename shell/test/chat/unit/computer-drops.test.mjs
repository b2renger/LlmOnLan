// K6-U3 (LOLCHAT_PLAN 2.6 KF-7): the canvas drop router. A file dropped on empty canvas becomes the
// box that holds its kind — placed side by side from the drop point, ONE undo entry per box — or
// is refused with a sentence the reader sees (a toast) and hears (the canvas's live region). A
// graph file still opens, through the same door. Nothing is sent anywhere on a drop.
//
// The App is a recording double: `host.canvas.placeEntry` places into an in-memory document and
// counts its calls (each call is one `session.apply`, i.e. one undo entry, in the real canvas),
// `intake`/`media` record what they were asked to read and keep, and the farm is a plain object.
import assert from 'node:assert/strict';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import { install } from '../../../renderer/chat/computer/drops.mjs';
import {
  classify, slotsFor, fitSlots, describeType, looksLikeText, looksLikeGraph, TEXT_MAX_BYTES, MAX_DROP_FILES, DROP_GAP,
} from '../../../renderer/chat/graph/drop-route.mjs';
import { specMap, holderOf } from '../../../renderer/chat/graph/parts/index.mjs';
import { reasonFor, WHY } from '../../../renderer/chat/graph/takes.mjs';
import { DOC_MAX_BYTES } from '../../../renderer/chat/graph/parts/document.mjs';
import { AUDIO_MAX_BYTES } from '../../../renderer/chat/graph/parts/audio.mjs';

const SPECS = specMap();
const G = /** @type {any} */ (globalThis);

/** The fake 8 kHz measuring context the Sound box's intake decodes with: "RIFF" + uint16 seconds. */
class FakeOffline {
  async decodeAudioData(buf) {
    const b = new Uint8Array(buf);
    if (b[0] !== 0x52 || b[1] !== 0x49) throw new Error('EncodingError');
    return { duration: new DataView(buf).getUint16(4, true) };
  }
}
function sound(name, seconds) {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(bytes.buffer).setUint16(4, seconds, true);
  return new File([bytes], name, { type: 'audio/wav' });
}
const PNG = new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'shot.png', { type: 'image/png' });
const pdf = (name = 'paper.pdf') => new File(['%PDF-1.4 fake'], name, { type: 'application/pdf' });
const text = (name, body, type = '') => new File([body], name, { type });

/**
 * The recording App. `farm`: null = no farm connected, else {engine, ocr}.
 * @param {{farm?: any, docOpen?: boolean}} [o]
 */
function fakeApp(o = {}) {
  const doc = { id: 'g1', parts: /** @type {any[]} */ ([]), wires: [] };
  const log = { placed: /** @type {any[]} */ ([]), said: /** @type {string[]} */ ([]), toasts: /** @type {any[]} */ ([]),
    reads: /** @type {string[]} */ ([]), puts: /** @type {any[]} */ ([]), imports: /** @type {any[]} */ ([]) };
  let n = 0;
  const docOpen = o.docOpen !== false;
  const farm = o.farm === undefined ? { engine: 'llama.cpp', ocr: null } : o.farm;
  const app = {
    newId: () => `id${++n}`,
    host: {
      session: { doc: () => doc, docId: () => (docOpen ? doc.id : null), specs: SPECS },
      canvas: {
        placeEntry(entry, at) {
          const id = `p${doc.parts.length + 1}`;
          const size = SPECS.get(entry.type).size;
          doc.parts.push({ id, type: entry.type, x: at ? at.x : 1000, y: at ? at.y : 500, w: size.w, h: size.h, settings: entry.settings });
          log.placed.push({ entry, at });
          return id;
        },
        announce(s) { log.said.push(s); },
      },
    },
    dialogs: { toast(s, opt) { log.toasts.push({ text: s, kind: opt && opt.kind }); } },
    intake: {
      async fromFile(file) {
        log.reads.push(file.name);
        return { dataUrl: 'data:image/jpeg;base64,AAAA', name: file.name, w: 4, h: 3 };
      },
    },
    media: {
      async put(file, opt) {
        log.puts.push({ name: file.name, maxBytes: opt.maxBytes, kind: opt.kind });
        if (opt.maxBytes && file.size > opt.maxBytes) return { error: t('parts.mediaTooBig', { name: file.name, mb: 'x', capMb: 'y' }) };
        return { fileId: `f${log.puts.length}`, name: file.name, mime: file.type, size: file.size, sha256: 'ab' };
      },
    },
    farm: {
      get: () => (farm ? { present: true, engine: farm.engine, ocr: farm.ocr, models: [] } : { present: false, models: [] }),
      cap: () => 'unknown',
    },
  };
  install(app);
  const importGraph = async (file) => { log.imports.push(file.name); };
  return { app, doc, log, importGraph };
}

/** Run with the fake measuring context installed. */
async function withAudio(fn) {
  const had = G.OfflineAudioContext;
  G.OfflineAudioContext = FakeOffline;
  try { return await fn(); } finally { if (had === undefined) delete G.OfflineAudioContext; else G.OfflineAudioContext = had; }
}

export default (test) => {

  test('drop-route: the kind, the type a refusal names, text vs binary, and where several boxes land', () => {
    assert.equal(classify({ name: 'song.flac', type: '' }).kind, 'audio');
    assert.equal(classify({ name: 'clip.webm', type: 'audio/webm' }).kind, 'audio');
    assert.equal(classify({ name: 'movie.mp4', type: 'video/mp4' }).kind, 'none', 'a video is not a sound box');
    assert.equal(classify({ name: 'data.csv', type: 'text/csv' }).kind, 'text');
    assert.equal(classify({ name: 'x.json', type: 'application/json' }).maybeGraph, true);
    assert.equal(classify({ name: 'x.md', type: '' }).maybeGraph, false);
    assert.equal(describeType({ name: 'setup.exe', type: 'application/x-msdownload' }), 'application/x-msdownload');
    assert.equal(describeType({ name: 'thing.xyz', type: '' }), '.xyz');
    assert.equal(describeType({ name: 'README', type: '' }), '');
    assert.equal(looksLikeText('plain words\nand more'), true);
    assert.equal(looksLikeText(`MZ${String.fromCharCode(0)}${String.fromCharCode(0)}binary`), false);
    assert.equal(looksLikeGraph(' {\n  "lolgraph" : 4 }'), true);
    const at = { x: 100, y: 40 };
    const sizes = [{ w: 240, h: 200 }, { w: 260, h: 170 }, { w: 280, h: 220 }, { w: 260, h: 170 }, { w: 240, h: 200 }];
    assert.deepEqual(slotsFor(at, sizes), [
      { x: 100, y: 40 }, { x: 100 + 240 + DROP_GAP, y: 40 }, { x: 100 + 240 + 260 + 2 * DROP_GAP, y: 40 },
      { x: 100 + 240 + 260 + 280 + 3 * DROP_GAP, y: 40 },
      { x: 100, y: 40 + 220 + DROP_GAP },
    ], 'left to right, four to a row, the next row under the tallest box');
    assert.deepEqual(slotsFor(at, []), []);
  });

  test('a picture, a text file and a sound dropped together: three boxes, side by side, one undo entry each; an .exe is refused in words', async () => {
    const { app, doc, log, importGraph } = fakeApp();
    const files = [PNG, text('notes.md', '# Hello\nworld'), sound('memo.wav', 12), new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' })];
    const out = await withAudio(() => app.drops.route(files, { at: { x: 40, y: 60 }, importGraph }));
    assert.deepEqual(doc.parts.map((p) => p.type), [holderOf('image'), holderOf('text'), holderOf('audio')]);
    assert.deepEqual(out.placed, ['p1', 'p2', 'p3']);
    assert.equal(log.placed.length, 3, 'placeEntry once per box — one undo entry each, not one for the whole drop');
    // Where they landed: side by side from the drop point, never on top of each other.
    const [a, b, c] = doc.parts;
    assert.deepEqual([a.x, a.y], [40, 60]);
    assert.equal(b.x, a.x + a.w + DROP_GAP);
    assert.equal(c.x, b.x + b.w + DROP_GAP);
    // What each box holds is what its OWN adopt() made of the file.
    assert.equal(a.settings.dataUrl, 'data:image/jpeg;base64,AAAA');
    assert.equal(a.settings.name, 'shot.png');
    assert.deepEqual(log.reads, ['shot.png'], 'the picture went through the intake — its cap, downscale and EXIF strip');
    assert.deepEqual(b.settings, { text: '# Hello\nworld' }, 'the Text box holds the file\'s contents');
    assert.equal(c.settings.name, 'memo.wav');
    assert.equal(c.settings.durationSec, 12, 'the sound was measured at intake');
    assert.deepEqual(log.puts, [{ name: 'memo.wav', maxBytes: AUDIO_MAX_BYTES, kind: 'audio' }]);
    // The .exe: refused, and SAID — a toast and the live region.
    const why = t('drops.refusedKind', { name: 'setup.exe', type: 'application/x-msdownload' });
    assert.deepEqual(out.refused, [{ name: 'setup.exe', reason: why }]);
    assert.deepEqual(log.toasts, [{ text: why, kind: 'error' }]);
    assert.equal(log.said[log.said.length - 1], why);
    assert.deepEqual(log.imports, [], 'nothing here was a graph');
    const dbg = app.drops.debug();
    assert.equal(dbg.routed, 1);
    assert.equal(dbg.placed, 3);
    assert.equal(dbg.refused, 1);
    assert.deepEqual(dbg.last.placed, ['p1', 'p2', 'p3']);
    assert.equal(app.drops.hint(), t('drops.hint'));
  });

  test('a PDF: refused when the farm offers no extractor (nothing kept, nothing sent); kept when it does, or when no farm can say yet', async () => {
    // A farm WITHOUT an extractor.
    let f = fakeApp({ farm: { engine: 'ollama', ocr: null } });
    let out = await f.app.drops.route([pdf()], { at: { x: 0, y: 0 }, importGraph: f.importGraph });
    const noOcr = reasonFor(WHY.noOcr, null);
    assert.deepEqual(out.refused, [{ name: 'paper.pdf', reason: noOcr }]);
    assert.equal(f.doc.parts.length, 0, 'no Document box');
    assert.equal(f.log.puts.length, 0, 'the bytes were not even kept');
    assert.deepEqual(f.log.toasts.map((x) => x.text), [noOcr]);
    // A farm WITH one: a Document box holding the kept file. Nothing is read on the farm yet.
    f = fakeApp({ farm: { engine: 'ollama', ocr: { url: 'http://farm/ocr', key: 'k' } } });
    out = await f.app.drops.route([pdf('scan.pdf')], { at: { x: 0, y: 0 }, importGraph: f.importGraph });
    assert.deepEqual(out.refused, []);
    assert.equal(f.doc.parts.length, 1);
    assert.equal(f.doc.parts[0].type, holderOf('pdf'));
    assert.equal(f.doc.parts[0].settings.fileId, 'f1');
    assert.equal(f.doc.parts[0].settings.name, 'scan.pdf');
    assert.deepEqual(f.log.puts, [{ name: 'scan.pdf', maxBytes: DOC_MAX_BYTES, kind: 'pdf' }]);
    // No farm connected: kept (unknown), to be read on the first run with a farm that can.
    f = fakeApp({ farm: null });
    out = await f.app.drops.route([pdf()], { at: { x: 0, y: 0 }, importGraph: f.importGraph });
    assert.equal(f.doc.parts.length, 1);
    assert.deepEqual(out.refused, []);
  });

  test('K6 fix round: a file kept for a box that could not be placed is let go at once; a PDF drop carries the page check', async () => {
    const f = fakeApp({ farm: { engine: 'ollama', ocr: { url: 'http://farm/ocr', key: 'k' } } });
    /** @type {any[]} */ const sweeps = [];
    /** @type {any[]} */ const opts = [];
    f.app.media.sweep = async (/** @type {any} */ o) => { sweeps.push(o); return 1; };
    const put = f.app.media.put;
    f.app.media.put = async (/** @type {any} */ file, /** @type {any} */ opt) => { opts.push(opt); return put(file, opt); };
    f.app.host.canvas.placeEntry = () => null;
    const out = await withAudio(() => f.app.drops.route([pdf('a.pdf'), sound('b.wav', 3), PNG], { at: { x: 0, y: 0 }, importGraph: f.importGraph }));
    assert.equal(out.placed.length, 0);
    assert.equal(out.refused.length, 3, 'each unplaced box is said');
    assert.deepEqual(sweeps, [{ only: ['f1', 'f2'] }], 'the PDF and the sound kept for boxes that never appeared — the picture kept nothing');
    assert.equal(typeof opts[0].check, 'function', 'the PDF went in with the Document box’s page check');
    const big = await new File(['%PDF-1.4\n2 0 obj\n<< /Type /Pages /Count 300 >>\nendobj\n'], 'big.pdf').arrayBuffer();
    assert.equal(opts[0].check(big), t('parts.docTooManyPages', { name: 'a.pdf', pages: 300, max: 60 }));
    // Placed normally: nothing is swept.
    const g = fakeApp({ farm: { engine: 'ollama', ocr: { url: 'http://farm/ocr', key: 'k' } } });
    let swept = 0;
    g.app.media.sweep = async () => { swept++; return 0; };
    await g.app.drops.route([pdf('ok.pdf')], { at: { x: 0, y: 0 }, importGraph: g.importGraph });
    assert.equal(g.doc.parts.length, 1);
    assert.equal(swept, 0);
  });

  test('graph files still open — by name, or a .json whose text says "lolgraph" — and a plain .json becomes a Text box', async () => {
    const { app, doc, log, importGraph } = fakeApp();
    await app.drops.route([text('flow.lolgraph.json', '{"lolgraph":4}', 'application/json')], { at: { x: 0, y: 0 }, importGraph });
    assert.deepEqual(log.imports, ['flow.lolgraph.json']);
    await app.drops.route([text('export.json', '{\n "lolgraph": 4, "parts": []}', 'application/json')], { at: { x: 0, y: 0 }, importGraph });
    assert.deepEqual(log.imports, ['flow.lolgraph.json', 'export.json'], 'peeked at, recognised, imported');
    assert.equal(doc.parts.length, 0);
    await app.drops.route([text('rows.json', '{"rows": [1, 2]}', 'application/json')], { at: { x: 0, y: 0 }, importGraph });
    assert.equal(doc.parts.length, 1);
    assert.deepEqual(doc.parts[0].settings, { text: '{"rows": [1, 2]}' });
    // Two graph files in one drop: the first opens, the second is refused in words.
    const out = await app.drops.route([
      text('a.lolgraph.json', '{"lolgraph":4}'), text('b.lolgraph.json', '{"lolgraph":4}'),
    ], { at: { x: 0, y: 0 }, importGraph });
    assert.deepEqual(log.imports.slice(-1), ['a.lolgraph.json']);
    assert.deepEqual(out.refused, [{ name: 'b.lolgraph.json', reason: t('drops.oneGraph', { name: 'b.lolgraph.json' }) }]);
  });

  test('refusals: no open graph, too many files, a text file too big or binary — each a sentence; past three, one line counts the rest', async () => {
    // No graph open: a graph file still imports (it opens one); everything else is refused.
    let f = fakeApp({ docOpen: false });
    let out = await f.app.drops.route([text('a.lolgraph.json', '{"lolgraph":4}'), text('n.txt', 'hi')], { at: null, importGraph: f.importGraph });
    assert.deepEqual(f.log.imports, ['a.lolgraph.json']);
    assert.deepEqual(out.refused, [{ name: 'n.txt', reason: t('drops.refusedNoDoc', { name: 'n.txt' }) }]);
    assert.equal(f.log.placed.length, 0);

    // Ten files: the first eight are used, and the drop says so.
    f = fakeApp();
    const ten = Array.from({ length: 10 }, (_, i) => text(`n${i}.txt`, `note ${i}`));
    out = await f.app.drops.route(ten, { at: { x: 0, y: 0 }, importGraph: f.importGraph });
    assert.equal(out.placed.length, MAX_DROP_FILES);
    assert.equal(out.refused[0].reason, t('drops.tooMany', { n: 10, max: MAX_DROP_FILES }));
    assert.equal(f.doc.parts[4].y > f.doc.parts[0].y, true, 'the fifth box starts a second row');

    // Too big, binary, a video, and an unknown file: four refusals → three sentences + "1 more".
    f = fakeApp();
    const big = text('huge.txt', 'x'.repeat(TEXT_MAX_BYTES + 1));
    const bin = text('dump.txt', `MZ${String.fromCharCode(0)}rest`);
    out = await f.app.drops.route([big, bin, new File(['v'], 'clip.mp4', { type: 'video/mp4' }), new File(['?'], 'README', { type: '' })],
      { at: { x: 0, y: 0 }, importGraph: f.importGraph });
    assert.equal(f.doc.parts.length, 0);
    assert.deepEqual(out.refused.map((r) => r.reason), [
      t('drops.textTooBig', { name: 'huge.txt', kb: '257', capKb: '256' }),
      t('drops.notText', { name: 'dump.txt' }),
      t('drops.refusedKind', { name: 'clip.mp4', type: 'video/mp4' }),
      t('drops.refusedKind', { name: 'README', type: t('drops.typeUnknown') }),
    ]);
    assert.deepEqual(f.log.toasts.map((x) => x.text), [
      ...out.refused.slice(0, 3).map((r) => r.reason),
      t('drops.refusedMore', { n: 1 }),
    ]);
    for (const x of f.log.toasts) assert.ok(!x.text.startsWith('drops.'), `a sentence, not a key: ${x.text}`);
  });

  test('a sound the box would refuse is refused on the canvas too, with the Sound box\'s own sentence', async () => {
    const f = fakeApp();
    const out = await withAudio(() => f.app.drops.route([
      sound('lecture.wav', 601), new File([new Uint8Array([9, 9, 9, 9])], 'broken.mp3', { type: 'audio/mpeg' }),
    ], { at: { x: 0, y: 0 }, importGraph: f.importGraph }));
    assert.equal(f.doc.parts.length, 0);
    assert.deepEqual(out.refused.map((r) => r.reason), [
      t('parts.audioTooLong', { name: 'lecture.wav', duration: '10:01', cap: '10:00' }),
      t('parts.audioUndecodable', { name: 'broken.mp3' }),
    ]);
    assert.equal(f.log.puts.length, 0, 'nothing refused was kept');
  });

  test('fitSlots: as many to a row as the view holds, and the group slid back inside the view', () => {
    const sizes = [{ w: 240, h: 200 }, { w: 260, h: 170 }, { w: 280, h: 220 }];
    const bounds = { x: 0, y: 0, w: 700, h: 600, margin: 16 };
    // Dropped at the centre of a 700-wide view: three in a row would be 828 wide, two fit (524).
    const s = fitSlots({ x: 350, y: 300 }, sizes, bounds);
    assert.equal(s[1].y, s[0].y, 'two to the first row');
    assert.equal(s[1].x, s[0].x + 240 + DROP_GAP);
    assert.equal(s[2].x, s[0].x, 'the third starts a second row');
    assert.equal(s[2].y, s[0].y + 200 + DROP_GAP, 'under the taller box of the first row');
    // …and the group was slid left and up so every box is inside the view.
    s.forEach((p, i) => {
      assert.ok(p.x >= 16 && p.x + sizes[i].w <= 700 - 16, `box ${i} inside horizontally: ${JSON.stringify(p)}`);
      assert.ok(p.y >= 16 && p.y + sizes[i].h <= 600 - 16, `box ${i} inside vertically: ${JSON.stringify(p)}`);
    });
    // A view narrower than one box: one to a row, the first box's top-left kept in view.
    const narrow = fitSlots({ x: 50, y: 50 }, sizes, { x: 0, y: 0, w: 200, h: 300, margin: 16 });
    assert.deepEqual(narrow[0], { x: 16, y: 16 });
    assert.equal(narrow[1].x, 16);
    // No view known: exactly slotsFor.
    assert.deepEqual(fitSlots({ x: 1, y: 2 }, sizes, null), slotsFor({ x: 1, y: 2 }, sizes));
  });

  test('a drop near the right edge of the view: the boxes are laid out inside it, not pushed on top of each other', async () => {
    const f = fakeApp();
    f.app.host.canvas.canvas = { clientWidth: 900, clientHeight: 700 };
    f.app.host.canvas.view = () => ({ x: -100, y: 0, zoom: 1 });      // the view shows world x 100..1000
    await withAudio(() => f.app.drops.route([PNG, text('a.md', 'a'), sound('s.wav', 2)], { at: { x: 900, y: 100 }, importGraph: f.importGraph }));
    const ps = f.doc.parts;
    assert.equal(ps.length, 3);
    for (let i = 0; i < ps.length; i++) {
      assert.ok(ps[i].x >= 100 + 16 && ps[i].x + ps[i].w <= 1000 - 16, `box ${i} is in view: ${ps[i].x}`);
      for (let j = 0; j < i; j++) {
        const a = ps[j];
        const b = ps[i];
        const apart = b.x >= a.x + a.w || a.x >= b.x + b.w || b.y >= a.y + a.h || a.y >= b.y + b.h;
        assert.ok(apart, `boxes ${j} and ${i} do not overlap`);
      }
    }
  });

  test('no drop point: the first box is centred and the rest follow it; two quick drops never interleave', async () => {
    const f = fakeApp();
    await f.app.drops.route([text('a.txt', 'a'), text('b.txt', 'b')], { at: null, importGraph: f.importGraph });
    assert.deepEqual([f.doc.parts[0].x, f.doc.parts[0].y], [1000, 500], 'centred by the canvas');
    assert.equal(f.doc.parts[1].x, 1000 + f.doc.parts[0].w + DROP_GAP);
    const one = f.app.drops.route([text('c.txt', 'c'), text('d.txt', 'd')], { at: { x: 0, y: 0 }, importGraph: f.importGraph });
    const two = f.app.drops.route([text('e.txt', 'e')], { at: { x: 0, y: 900 }, importGraph: f.importGraph });
    await Promise.all([one, two]);
    assert.deepEqual(f.doc.parts.slice(2).map((p) => p.settings.text), ['c', 'd', 'e'], 'in the order they were dropped');
    assert.equal(f.app.drops.debug().routed, 3);
  });
};
