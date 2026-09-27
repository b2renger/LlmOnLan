// @ts-check
// K6-U2 in Node: the Document (PDF) box and the extractor door (addendum KF-5).
//
// The part runs against the REAL file store (computer/media.mjs over the real repo, memory
// backend) and the REAL net/extract.mjs; only `fetch` is a double, and it COUNTS — which is how
// "nothing is sent on drop", "zero requests without an extractor", "the same bytes are never sent
// twice" and "one extraction at a time" are proven rather than asserted. The browser scenario
// (k6-document) proves the same against the mock farm, by dropping a real file.

import assert from 'node:assert/strict';

import { createApp } from '../../../renderer/chat/core/app.mjs';
import { openRepoSync } from '../../../renderer/chat/state/repo.mjs';
import { createMemoryBackend } from '../../../renderer/chat/state/backend-memory.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';
import { install as installMedia } from '../../../renderer/chat/computer/media.mjs';
import { extractDoc, readPages, EXTRACT_TIMEOUT_MS } from '../../../renderer/chat/net/extract.mjs';
import { reasonFor, WHY } from '../../../renderer/chat/graph/takes.mjs';
import { activeSet, runPlan } from '../../../renderer/chat/graph/topo.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import {
  documentPart, docText, cachedPages, hasText, errorSentence, readingOf, isPdfFile,
  DOC_MAX_PAGES, DOC_MAX_CHARS, DOC_RENDER_CHARS,
  pdfPageCount, pagesRefusal, coolingLeft, EXTRACT_COOLDOWN_MS,
} from '../../../renderer/chat/graph/parts/document.mjs';

const NO_OCR = /** @type {string} */ (reasonFor(WHY.noOcr, null));

/** `n` pages of `each` characters. */
const pagesOf = (/** @type {number} */ n, /** @type {number} */ each = 20) =>
  Array.from({ length: n }, (_, i) => ({ page: i + 1, text: `p${i + 1} ${'w'.repeat(Math.max(0, each - 4))}`, engine: 'text' }));

/** A PDF whose (uncompressed) page tree says it has `n` pages, as a simple writer makes it. */
const pagedPdf = (/** @type {string} */ name, /** @type {number} */ n) => new File([
  `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count ${n} >>\nendobj\n`
  + `3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n%%EOF\n`], name, { type: 'application/pdf' });

/** A PDF-looking file. */
const pdf = (/** @type {string} */ name, /** @type {string} */ salt = '') =>
  new File([`%PDF-1.7\n${salt}body`], name, { type: 'application/pdf' });

/**
 * `fetch`, replaced for one test. `answer(call)` decides each response; every call is recorded
 * with how many were in flight when it started.
 * @param {(call: any) => Promise<any>|any} answer
 */
async function withFetch(answer, /** @type {(calls: any[]) => Promise<void>} */ fn) {
  const real = globalThis.fetch;
  /** @type {any[]} */ const calls = [];
  let inflight = 0;
  globalThis.fetch = /** @type {any} */ (async (/** @type {any} */ url, /** @type {any} */ init) => {
    inflight++;
    const call = { url: String(url), init, inflight, bytes: init && init.body ? init.body.byteLength : 0 };
    calls.push(call);
    try { return await answer(call); } finally { inflight--; }
  });
  try { await fn(calls); } finally { globalThis.fetch = real; }
}

/** An OK answer with `n` pages, after `ms`, abort-aware like a real fetch. */
const okPages = (/** @type {number} */ n, /** @type {number} */ ms = 0) => (/** @type {any} */ call) => new Promise((resolve, reject) => {
  const sig = call.init && call.init.signal;
  const done = () => resolve({ status: 200, ok: true, json: async () => pagesOf(n).map((p) => ({ page_content: p.text, metadata: { page: p.page, engine: 'text' } })) });
  const timer = setTimeout(done, ms);
  if (sig) sig.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
});

/** An app with a real file store and a farm double. @param {{present?: boolean, ocr?: any}} [farm] */
function setup(farm = { present: true, ocr: { url: 'http://farm.test:9999/ocr', key: 'k' } }) {
  const app = /** @type {any} */ (createApp({ root: null, els: /** @type {any} */ ({ live: { textContent: '' } }) }));
  app.repo = openRepoSync({ openPersistent: () => createMemoryBackend({ kind: 'idb' }), bus: app.bus, now: app.now, newId: app.newId });
  let now = farm;
  app.farm = { get: () => now, cap: () => 'unknown', modelInfo: () => null };
  installMedia(app);
  return { app, setFarm: (/** @type {any} */ f) => { now = f; } };
}

/** Run the part the way the runner does. */
const run = (/** @type {any} */ app, /** @type {any} */ settings, /** @type {AbortSignal|null} */ signal = null, id = 'doc1') =>
  documentPart.run(/** @type {any} */ ({
    part: { id, type: 'document', settings }, inputs: {}, labels: {}, app, ask: null,
    signal: signal || new AbortController().signal, thread: null, cache: true,
  }));

/** @param {() => Promise<any>} fn @returns {Promise<any>} the error it threw */
async function failure(fn) {
  try { await fn(); } catch (err) { return err; }
  throw new Error('expected a failure');
}

export default (/** @type {any} */ test) => {
  // ---- docText: what flows on, and the honesty about what did not ----------------------------

  test('one page flows on as its text; several pages are marked so a model can cite them', () => {
    assert.deepEqual(docText([{ page: 1, text: '  Hello  ' }]), { md: 'Hello', note: '', shown: 1, total: 1, cut: false, charCut: false, page: 1 });
    const two = docText([{ page: 1, text: 'A' }, { page: 2, text: 'B' }]);
    assert.equal(two.md, `${t('parts.docPageMark', { page: 1 })}\n\nA\n\n${t('parts.docPageMark', { page: 2 })}\n\nB`);
    assert.equal(two.cut, false);
    assert.equal(docText([]).md, '');
    assert.equal(docText(null).total, 0);
  });

  test('past DOC_MAX_PAGES: the first 60 of 120 pages flow on, and the value SAYS so at the top', () => {
    const out = docText(pagesOf(120));
    assert.equal(DOC_MAX_PAGES, 60);
    assert.equal(out.cut, true);
    assert.equal(out.charCut, false);
    assert.equal(out.shown, 60);
    assert.equal(out.total, 120);
    assert.equal(out.note, t('parts.docCutPages', { shown: 60, total: 120 }));
    assert.match(out.note, /^First 60 of 120 pages/);
    assert.ok(out.md.startsWith(`*${out.note}*\n\n`), 'the model reads the cut before the text');
    assert.ok(out.md.includes('p60 '), 'page 60 is in');
    assert.ok(!out.md.includes('p61 '), 'page 61 is not');
  });

  test('past DOC_MAX_CHARS: cut mid-page, never over the cap IN TOTAL, and it names the page it stopped at', () => {
    const out = docText(pagesOf(10, 30000));
    assert.equal(out.cut, true);
    assert.equal(out.charCut, true);
    assert.ok(out.md.length <= DOC_MAX_CHARS, `${out.md.length} ≤ ${DOC_MAX_CHARS}`);
    assert.ok(out.md.length > DOC_MAX_CHARS - 1000, 'and it used the room it had');
    assert.equal(out.page, 7, '6 whole pages of ~30 000 characters, then part of the 7th');
    assert.match(out.note, /up to page 7 of 10/);
    assert.ok(out.md.startsWith(`*${out.note}*`));
    // One enormous page is cut too, and still says so.
    const one = docText([{ page: 1, text: 'z'.repeat(DOC_MAX_CHARS * 2) }]);
    assert.equal(one.cut, true);
    assert.ok(one.md.length <= DOC_MAX_CHARS);
    assert.match(one.note, /up to page 1 of 1/);
  });

  test('cachedPages: only a READY farm extraction with some text is a cache hit', () => {
    const pages = [{ page: 1, text: 'x' }];
    assert.deepEqual(cachedPages({ extractEngine: 'farm-ocr', status: 'ready', pages }), pages);
    assert.equal(cachedPages({ extractEngine: 'farm-ocr', status: 'error', pages }), null);
    assert.equal(cachedPages({ extractEngine: 'local', status: 'ready', pages }), null);
    assert.equal(cachedPages({ extractEngine: 'farm-ocr', status: 'ready', pages: [{ page: 1, text: '  ' }] }), null);
    assert.equal(cachedPages({ status: 'ready' }), null);
    assert.equal(cachedPages(null), null);
    assert.equal(hasText([{ text: '' }, { text: 'a' }]), true);
  });

  test('isPdfFile: by its type, or by its name when the type says nothing', () => {
    assert.equal(isPdfFile({ name: 'a.pdf', type: 'application/pdf' }), true);
    assert.equal(isPdfFile({ name: 'a.PDF', type: '' }), true);
    assert.equal(isPdfFile({ name: 'a.pdf', type: 'application/octet-stream' }), true);
    assert.equal(isPdfFile({ name: 'a.pdf', type: 'image/png' }), false, 'a type that says otherwise wins');
    assert.equal(isPdfFile({ name: 'a.txt', type: 'text/plain' }), false);
    assert.equal(isPdfFile(null), false);
  });

  test('every extractor code has its OWN sentence, naming the file (no-ocr is the takes sentence)', () => {
    const codes = ['no-ocr', 'unauthorized', 'unsupported', 'farm', 'aborted', 'timeout', 'network'];
    const said = codes.map((c) => errorSentence(c, 'r.pdf', 503));
    assert.equal(new Set(said).size, codes.length, 'seven codes, seven sentences');
    assert.equal(said[0], NO_OCR);
    for (const s of said.slice(2)) assert.match(s, /r\.pdf/);
    assert.match(errorSentence('farm', 'r.pdf', 503), /HTTP 503/);
    assert.match(errorSentence('timeout', 'r.pdf'), new RegExp(`${Math.round(EXTRACT_TIMEOUT_MS / 60000)} minutes`));
  });

  // ---- the extractor door --------------------------------------------------------------------

  test('extractDoc: the wire contract, and the error table (401, 415, 5xx, not JSON, network, empty)', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 x').buffer;
    await withFetch(async (call) => {
      if (call.url.includes('/bad-key/')) return { status: 401, ok: false };
      if (call.url.includes('/odd/')) return { status: 415, ok: false };
      if (call.url.includes('/down/')) return { status: 503, ok: false };
      if (call.url.includes('/garbled/')) return { status: 200, ok: true, json: async () => { throw new SyntaxError('bad'); } };
      if (call.url.includes('/object/')) return { status: 200, ok: true, json: async () => ({ detail: 'x' }) };
      if (call.url.includes('/gone/')) throw new TypeError('fetch failed');
      return { status: 200, ok: true, json: async () => [{ page_content: 'hi', metadata: { page: 1, engine: 'text' } }] };
    }, async (calls) => {
      const ok = await extractDoc({ url: 'http://f/ok/', key: 'k', bytes, name: 'a b.pdf', mime: 'application/pdf' });
      assert.deepEqual(ok, { pages: [{ page: 1, text: 'hi', engine: 'text' }] });
      assert.equal(calls[0].url, 'http://f/ok/process', 'the loader BASE plus /process, one slash');
      assert.equal(calls[0].init.method, 'PUT');
      assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
      assert.equal(calls[0].init.headers['X-Filename'], 'a%20b.pdf');
      assert.equal(calls[0].init.headers['Content-Type'], 'application/pdf');
      assert.equal(calls[0].bytes, bytes.byteLength);
      assert.equal((await extractDoc({ url: 'http://f/bad-key', key: 'k', bytes, name: 'a.pdf', mime: 'application/pdf' })).code, 'unauthorized');
      assert.equal((await extractDoc({ url: 'http://f/odd', key: 'k', bytes, name: 'a.pdf', mime: 'application/pdf' })).code, 'unsupported');
      const down = await extractDoc({ url: 'http://f/down', key: 'k', bytes, name: 'a.pdf', mime: 'application/pdf' });
      assert.deepEqual([down.code, down.status], ['farm', 503]);
      assert.equal((await extractDoc({ url: 'http://f/garbled', key: 'k', bytes, name: 'a.pdf', mime: 'application/pdf' })).code, 'farm');
      assert.equal((await extractDoc({ url: 'http://f/object', key: 'k', bytes, name: 'a.pdf', mime: 'application/pdf' })).code, 'farm');
      assert.equal((await extractDoc({ url: 'http://f/gone', key: 'k', bytes, name: 'a.pdf', mime: 'application/pdf' })).code, 'network');
      const n = calls.length;
      assert.equal((await extractDoc({ url: 'http://f/ok', key: 'k', bytes: new ArrayBuffer(0), name: 'a.pdf', mime: 'application/pdf' })).code, 'unsupported');
      assert.equal((await extractDoc({ url: '', key: 'k', bytes, name: 'a.pdf', mime: 'application/pdf' })).code, 'no-ocr');
      assert.equal(calls.length, n, 'no bytes and no extractor send NOTHING');
    });
  });

  test('extractDoc: Stop aborts the request, and a deadline gives up with `timeout`', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 x').buffer;
    await withFetch(okPages(1, 5000), async (calls) => {
      const ac = new AbortController();
      const pending = extractDoc({ url: 'http://f/', key: 'k', bytes, name: 'a.pdf', mime: 'application/pdf', signal: ac.signal });
      setTimeout(() => ac.abort(), 10);
      assert.equal((await pending).code, 'aborted');
      const pre = new AbortController();
      pre.abort();
      assert.equal((await extractDoc({ url: 'http://f/', key: 'k', bytes, name: 'a.pdf', mime: 'application/pdf', signal: pre.signal })).code, 'aborted');
      assert.equal(calls.length, 1, 'an already-stopped run sends nothing');
      assert.equal((await extractDoc({ url: 'http://f/', key: 'k', bytes, name: 'a.pdf', mime: 'application/pdf', timeoutMs: 20 })).code, 'timeout');
    });
    assert.deepEqual(readPages([{ page_content: 'a' }, 'junk', { metadata: { page: 3 } }]),
      [{ page: 1, text: 'a', engine: '?' }, { page: 3, text: '', engine: '?' }]);
  });

  // ---- the run: cached, refused, serialized --------------------------------------------------

  test('a run reads the PDF on the farm ONCE; the same bytes (any box) never travel twice', async () => {
    const { app } = setup();
    const ref = await app.media.put(pdf('three.pdf'), { kind: 'pdf' });
    await withFetch(okPages(3), async (calls) => {
      const v = await run(app, ref);
      assert.equal(v.kind, 'text');
      assert.equal(v.format, 'markdown');
      assert.match(v.data, /p1 [\s\S]*p2 [\s\S]*p3 /);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'http://farm.test:9999/ocr/process');
      const rec = await app.media.get(ref.fileId);
      assert.equal(rec.extractEngine, 'farm-ocr', 'the text is cached on the record');
      assert.equal(rec.pages.length, 3);
      // Again, and from a second box holding a copy of the same file: zero new requests.
      await run(app, ref);
      const copy = await app.media.put(pdf('copy-of-three.pdf'), { kind: 'pdf' });
      assert.equal(copy.fileId, ref.fileId);
      await run(app, { ...copy, name: 'copy-of-three.pdf' }, null, 'doc2');
      assert.equal(calls.length, 1, 'cached by content hash');
    });
  });

  test('refusals before the queue send NOTHING: empty box, file gone, no farm, no extractor, already stopped', async () => {
    const { app, setFarm } = setup();
    const ref = await app.media.put(pdf('x.pdf'), { kind: 'pdf' });
    await withFetch(okPages(1), async (calls) => {
      const empty = await failure(() => run(app, { fileId: '', name: '' }));
      assert.deepEqual([empty.message, empty.reason], [t('parts.docEmpty'), 'empty']);
      const gone = await failure(() => run(app, { ...ref, fileId: 'not-here' }));
      assert.deepEqual([gone.message, gone.reason], [t('parts.mediaMissing'), 'part']);
      setFarm({ present: false, ocr: null });
      const noFarm = await failure(() => run(app, ref));
      assert.deepEqual([noFarm.message, noFarm.reason], [t('parts.docNoFarm', { name: 'x.pdf' }), 'no-farm']);
      setFarm({ present: true, ocr: null });
      const noOcr = await failure(() => run(app, ref));
      assert.deepEqual([noOcr.message, noOcr.reason], [NO_OCR, 'part']);
      setFarm({ present: true, ocr: { url: 'http://farm.test/ocr', key: 'k' } });
      const ac = new AbortController();
      ac.abort();
      const stopped = await failure(() => run(app, ref, ac.signal));
      assert.equal(stopped.reason, 'aborted');
      assert.equal(calls.length, 0, 'not one request');
    });
    const bare = /** @type {any} */ ({ farm: app.farm });
    const noStore = await failure(() => run(bare, ref));
    assert.equal(noStore.message, t('parts.mediaNoStore', { name: 'x.pdf' }));
  });

  test('a failure is NEVER cached: a 503, an empty answer and a Stop all leave the next run to try again', async () => {
    const { app } = setup();
    let shift = 0;
    app.now = () => Date.now() + shift;
    const ref = await app.media.put(pdf('flaky.pdf'), { kind: 'pdf' });
    let mode = 'down';
    await withFetch(async (call) => {
      if (mode === 'down') return { status: 503, ok: false };
      if (mode === 'blank') return { status: 200, ok: true, json: async () => [{ page_content: '   ', metadata: { page: 1 } }] };
      if (mode === 'slow') return okPages(2, 5000)(call);
      return okPages(2)(call);
    }, async (calls) => {
      const down = await failure(() => run(app, ref));
      assert.deepEqual([down.message, down.reason], [errorSentence('farm', 'flaky.pdf', 503), 'farm']);
      mode = 'blank';
      const blank = await failure(() => run(app, ref));
      assert.equal(blank.message, t('parts.docNoText', { name: 'flaky.pdf' }));
      mode = 'slow';
      const ac = new AbortController();
      const pending = failure(() => run(app, ref, ac.signal));
      setTimeout(() => ac.abort(), 20);
      const stopped = await pending;
      assert.deepEqual([stopped.message, stopped.reason], [errorSentence('aborted', 'flaky.pdf'), 'aborted']);
      assert.equal(cachedPages(await app.media.get(ref.fileId)), null, 'three failures, nothing cached');
      mode = 'ok';
      // K6 fix round: the farm keeps reading after a Stop, so the same bytes WAIT before they are
      // sent again — a run now is refused in a sentence and sends nothing.
      const held = await failure(() => run(app, ref));
      assert.deepEqual([held.message, held.reason], [errorSentence('cooling', 'flaky.pdf', 0, { waitMs: EXTRACT_COOLDOWN_MS }), 'farm']);
      assert.equal(calls.length, 3, 'the wait sent nothing');
      assert.ok(coolingLeft(ref.sha256, app.now()) > 0);
      shift = EXTRACT_COOLDOWN_MS + 1;
      await run(app, ref);
      assert.equal(calls.length, 4, 'each run asked again once it was allowed to');
      assert.equal(coolingLeft(ref.sha256, Date.now()), 0, 'a success ends the wait for those bytes');
      assert.ok(cachedPages(await app.media.get(ref.fileId)), 'the first success is cached');
    });
  });

  test('ONE extraction at a time per window; a box queued behind another says it is waiting', async () => {
    const { app } = setup();
    const a = await app.media.put(pdf('a.pdf', 'a'), { kind: 'pdf' });
    const b = await app.media.put(pdf('b.pdf', 'b'), { kind: 'pdf' });
    await withFetch(okPages(1, 40), async (calls) => {
      const first = run(app, a, null, 'boxA');
      const second = run(app, b, null, 'boxB');
      const same = run(app, a, null, 'boxC');   // the same bytes as boxA, queued behind it
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(readingOf('boxA'), 'reading');
      assert.equal(readingOf('boxB'), 'waiting');
      assert.equal(readingOf('boxC'), 'waiting');
      await Promise.all([first, second, same]);
      assert.equal(calls.length, 2, 'two different files, two requests; the copy of a.pdf found the cache');
      assert.deepEqual(calls.map((c) => c.inflight), [1, 1], 'never two at once');
      assert.deepEqual(['boxA', 'boxB', 'boxC'].map(readingOf), ['', '', ''], 'nobody says "reading" afterwards');
    });
  });

  test('Stop while queued: that box stops waiting at once, and its turn sends nothing', async () => {
    const { app } = setup();
    const a = await app.media.put(pdf('a.pdf', 'q1'), { kind: 'pdf' });
    const b = await app.media.put(pdf('b.pdf', 'q2'), { kind: 'pdf' });
    await withFetch(okPages(1, 60), async (calls) => {
      const first = run(app, a, null, 'qa');
      const ac = new AbortController();
      const second = failure(() => run(app, b, ac.signal, 'qb'));
      await new Promise((r) => setTimeout(r, 5));
      ac.abort();
      const err = await second;
      assert.equal(err.reason, 'aborted');
      assert.equal(readingOf('qb'), '');
      await first;
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(calls.length, 1, 'only the first file was sent');
    });
  });

  test('the farm withdrawing its extractor while a box waits is caught at its turn, and nothing is sent', async () => {
    const { app, setFarm } = setup();
    const a = await app.media.put(pdf('a.pdf', 'w1'), { kind: 'pdf' });
    const b = await app.media.put(pdf('b.pdf', 'w2'), { kind: 'pdf' });
    await withFetch(okPages(1, 30), async (calls) => {
      const first = run(app, a, null, 'wa');
      const second = failure(() => run(app, b, null, 'wb'));
      await new Promise((r) => setTimeout(r, 5));
      setFarm({ present: true, ocr: null });
      await first;
      const err = await second;
      assert.equal(err.message, NO_OCR);
      assert.equal(calls.length, 1);
    });
  });

  // ---- the box ---------------------------------------------------------------------------------

  test('the box: a PDF dropped on it is KEPT with one undoable edit, and nothing is sent', async () => {
    const { app } = setup();
    await withDom(async (doc) => {
      await withFetch(okPages(1), async (calls) => {
        const b = box(doc, app, { id: 'd1', type: 'document', settings: documentPart.defaults(), value: null });
        assert.equal(b.q('.graph-doc-empty').hidden, false);
        assert.equal(b.q('.graph-doc-empty').textContent, t('parts.docEmpty'));
        assert.equal(b.q('.graph-doc-head').hidden, true);
        const ev = b.drop([pdf('drop.pdf')]);
        assert.equal(ev.prevented, true);
        assert.equal(ev.stopped, true, 'the canvas router never sees a drop on the box');
        await b.settle();
        assert.equal(b.patches.length, 1);
        assert.equal(b.patches[0].name, 'drop.pdf');
        assert.ok(b.patches[0].fileId);
        assert.deepEqual(b.commits, [t('parts.docLabel')]);
        assert.equal(b.q('.graph-doc-name').textContent, 'drop.pdf');
        assert.equal(b.q('.graph-doc-note').textContent, t('parts.docKept'));
        assert.equal(b.q('.graph-doc-note').hidden, false);
        assert.equal(calls.length, 0, 'NOTHING IS SENT ON DROP');
        b.inst.destroy();
      });
    });
  });

  test('the box refuses, in a sentence, a PDF the farm cannot read and a file that is not a PDF', async () => {
    const { app } = setup({ present: true, ocr: null });
    await withDom(async (doc) => {
      const b = box(doc, app, { id: 'd2', type: 'document', settings: documentPart.defaults(), value: null });
      b.drop([pdf('nope.pdf')]);
      await b.settle();
      assert.equal(b.q('.graph-doc-note').textContent, t('parts.docRefusedNoOcr', { name: 'nope.pdf' }));
      assert.equal(b.q('.graph-doc-note').getAttribute('data-state'), 'error');
      assert.equal(b.q('.graph-takes-why').textContent, NO_OCR, 'the why is the takes line, said once');
      assert.equal(b.patches.length, 0, 'nothing kept');
      assert.equal((await app.repo.listAttachments('computer:media')).length, 0);
      b.drop([new File(['hi'], 'notes.txt', { type: 'text/plain' })]);
      await b.settle();
      assert.equal(b.q('.graph-doc-note').textContent, t('parts.docNotAPdf', { name: 'notes.txt', type: 'text/plain' }));
      b.inst.destroy();
    });
  });

  test('the box shows the extracted text through the safe renderer, and the cut line from the same function', async () => {
    const { app } = setup();
    const ref = await app.media.put(pdf('long.pdf', 'L'), { kind: 'pdf' });
    await app.media.patch(ref.fileId, { pages: pagesOf(120), extractEngine: 'farm-ocr', status: 'ready' });
    const v = await run(app, ref);
    await withDom(async (doc) => {
      const b = box(doc, app, { id: 'd3', type: 'document', settings: { ...ref }, value: v });
      await b.settle();
      const text = b.q('.graph-doc-text');
      assert.equal(text.hidden, false);
      assert.match(text.textContent, /First 60 of 120 pages/);
      assert.ok(text.querySelector('em'), 'the note is markdown italics, rendered as nodes');
      assert.equal(b.q('.graph-doc-cut').hidden, false);
      assert.equal(b.q('.graph-doc-cut').textContent, docText(pagesOf(120)).note);
      assert.equal(b.q('.graph-doc-meta').textContent, t('parts.docMetaPages', { mb: '0.0', pages: 120 }));
      assert.equal(b.q('.graph-doc-note').hidden, true, 'nothing to say once the text is here');
      // Remove: the old text is not shown under an empty box.
      b.q('.graph-doc-remove').dispatchEvent({ type: 'click' });
      await b.settle();
      assert.equal(b.patches.at(-1).fileId, '');
      assert.equal(b.q('.graph-doc-text').hidden, true);
      assert.equal(b.q('.graph-doc-empty').hidden, false);
      // Undo hands the box its file back — and the text that belongs to it shows again.
      b.inst.update({ id: 'd3', type: 'document', settings: { ...ref }, value: v, state: 'done' });
      await b.settle();
      assert.equal(b.q('.graph-doc-text').hidden, false);
      assert.match(b.q('.graph-doc-text').textContent, /p1 /);
      // A failed run: the canvas's error strip speaks; this box does not talk over it.
      b.inst.update({ id: 'd3', type: 'document', settings: { ...ref, fileId: ref.fileId }, value: null, state: 'error' });
      await b.settle();
      assert.equal(b.q('.graph-doc-note').hidden, true);
      b.inst.destroy();
    });
    assert.equal(DOC_RENDER_CHARS, 64 * 1024);
  });

  test('the box says the file is gone when its record is (an imported graph from another computer)', async () => {
    const { app } = setup();
    await withDom(async (doc) => {
      const b = box(doc, app, { id: 'd4', type: 'document', settings: { fileId: 'elsewhere', name: 'far.pdf', mime: 'application/pdf', size: 10, sha256: 'x' }, value: null });
      await b.settle();
      assert.equal(b.q('.graph-doc-note').textContent, t('parts.mediaMissing'));
      assert.equal(b.q('.graph-doc-note').getAttribute('data-state'), 'error');
      b.inst.destroy();
    });
  });

  // ---- K6 fix round -------------------------------------------------------------------------

  test('pdfPageCount: the root page tree says, the newest root after an update wins, the linearized /N — else null, never a guess', () => {
    const enc = (/** @type {string} */ x) => new TextEncoder().encode(x);
    assert.equal(pdfPageCount(enc('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 300 >>\nendobj\n4 0 obj\n<</Type/Pages/Parent 2 0 R/Count 7>>\nendobj\n')), 300,
      'a child node (it has a /Parent) is not the root');
    assert.equal(pdfPageCount(enc('%PDF-1.4\n2 0 obj\n<< /Type /Pages /Count 300 >>\nendobj\nxref\n2 0 obj\n<< /Type /Pages /Count 12 >>\nendobj\n')), 12,
      'an incremental update appends a new root: the last one is the document now');
    assert.equal(pdfPageCount(enc('%PDF-1.5\n1 0 obj\n<< /Linearized 1 /L 12345 /H [ 500 200 ] /O 4 /E 999 /N 88 /T 1200 >>\nendobj\n')), 88);
    assert.equal(pdfPageCount(enc('%PDF-1.7\n5 0 obj\n<< /Type /ObjStm /N 40 /First 300 /Filter /FlateDecode >>\nstream\nxx\nendstream\nendobj\n')), null,
      'a page tree inside a compressed object stream: unknown, not 40');
    assert.equal(pdfPageCount(enc('%PDF-1.4\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n')), null, '/Type /Page is a page, not the tree');
    assert.equal(pdfPageCount(enc('%PDF-1.4\nnothing here\n')), null);
    assert.equal(pdfPageCount(new ArrayBuffer(0)), null);
  });

  test('a PDF that SAYS it has more pages than flow on is never sent: refused at intake, on the box, and before an upload', async () => {
    const { app } = setup();
    const big = pagedPdf('big.pdf', 300);
    const said = t('parts.docTooManyPages', { name: 'big.pdf', pages: 300, max: DOC_MAX_PAGES });
    assert.equal(pagesRefusal(await big.arrayBuffer(), 'big.pdf'), said);
    assert.equal(pagesRefusal(await pagedPdf('ok.pdf', DOC_MAX_PAGES).arrayBuffer(), 'ok.pdf'), '', 'exactly the cap is fine');
    assert.equal(pagesRefusal(await pdf('plain.pdf').arrayBuffer(), 'plain.pdf'), '', 'a PDF that does not say is not refused');
    const refused = await app.media.put(big, { kind: 'pdf', check: (/** @type {ArrayBuffer} */ buf) => pagesRefusal(buf, 'big.pdf') });
    assert.equal(refused.error, said);
    assert.equal((await app.repo.listAttachments('computer:media')).length, 0, 'nothing kept');
    await withFetch(okPages(1), async (calls) => {
      await withDom(async (doc) => {
        const b = box(doc, app, { id: 'd9', type: 'document', settings: documentPart.defaults(), value: null });
        b.drop([big]);
        await b.settle();
        assert.equal(b.q('.graph-doc-note').textContent, said, 'the box says it, in its own words');
        assert.equal(b.q('.graph-doc-note').getAttribute('data-state'), 'error');
        assert.equal(b.patches.length, 0);
        b.inst.destroy();
      });
      // A file kept before this check existed is refused before the upload.
      const old = await app.media.put(pagedPdf('old.pdf', 120), { kind: 'pdf' });
      const err = await failure(() => run(app, old));
      assert.deepEqual([err.message, err.reason], [errorSentence('too-many-pages', 'old.pdf', 0, { pages: 120 }), 'part']);
      assert.match(err.message, /120 pages/);
      assert.equal(calls.length, 0, 'not one byte reached the farm');
    });
  });

  test('after a Stop mid-read, a box queued behind with the SAME bytes waits too; a Stop before sending starts no wait', async () => {
    const { app } = setup();
    const a = await app.media.put(pdf('same.pdf', 'cool-1'), { kind: 'pdf' });
    const other = await app.media.put(pdf('other.pdf', 'cool-2'), { kind: 'pdf' });
    await withDom(async (doc) => {
      // A box holding the same bytes, on screen BEFORE the read is stopped: it must learn of the
      // wait by itself, not on its next update from the canvas.
      const b = box(doc, app, { id: 'c4', type: 'document', settings: documentPart.adopt(a), value: null });
      await b.settle();
      assert.equal(b.q('.graph-doc-note').textContent, t('parts.docKept'));
      await withFetch(okPages(1, 200), async (calls) => {
        const ac = new AbortController();
        const first = failure(() => run(app, a, ac.signal, 'c1'));
        const queuedOther = new AbortController();
        const second = failure(() => run(app, other, queuedOther.signal, 'c2'));
        const twin = failure(() => run(app, a, null, 'c3'));
        await new Promise((r) => setTimeout(r, 10));
        queuedOther.abort();                    // stopped while QUEUED: nothing sent, so no wait
        ac.abort();                             // stopped while the farm READS: the bytes wait
        assert.equal((await first).reason, 'aborted');
        assert.equal((await second).reason, 'aborted');
        const held = await twin;
        assert.deepEqual([held.reason, /may still be reading same\.pdf/.test(held.message)], ['farm', true]);
        assert.equal(calls.length, 1, 'only the read that was stopped mid-way ever left');
        assert.ok(coolingLeft(a.sha256, Date.now()) > 0);
        assert.equal(coolingLeft(other.sha256, Date.now()), 0, 'a Stop before the request left is no reason to wait');
      });
      // The box says so between runs, with no run going and no update from the canvas.
      assert.equal(b.q('.graph-doc-note').textContent, t('parts.docCoolingNote', { min: 5 }));
      b.inst.destroy();
    });
  });

  test('the farm\'s own "[Page N]" heading is replaced by our page mark, not said twice', () => {
    const md = docText([{ page: 1, text: '[Page 1]\nbody 1' }, { page: 2, text: '[Page 2]\r\nbody 2' }]).md;
    assert.equal(md, `${t('parts.docPageMark', { page: 1 })}\n\nbody 1\n\n${t('parts.docPageMark', { page: 2 })}\n\nbody 2`);
    assert.ok(!/\[Page/.test(md));
    assert.equal(docText([{ page: 1, text: '[Page 1] is how the farm marks pages' }]).md, '[Page 1] is how the farm marks pages',
      'one page: the farm adds no heading, and nothing is stripped');
    assert.match(t('parts.docMoreHere', { chars: '65,536' }), /65,536 characters/, 'the box counts what it cuts in characters');
  });

  test('several files dropped on the box: it takes one and SAYS which, and where the others go', async () => {
    const { app } = setup();
    /** @type {string[]} */ const said = [];
    app.dialogs = { toast: (/** @type {string} */ m) => { said.push(m); } };
    await withDom(async (doc) => {
      const b = box(doc, app, { id: 'm1', type: 'document', settings: documentPart.defaults(), value: null });
      b.drop([new File(['hi'], 'a.txt', { type: 'text/plain' }), pdf('b.pdf', 'many'), pdf('c.pdf', 'many2')]);
      await b.settle();
      assert.equal(b.patches.length, 1);
      assert.equal(b.patches[0].name, 'b.pdf', 'the first PDF');
      assert.deepEqual(said, [t('parts.dropOnlyOne', { name: 'b.pdf', n: 2 })]);
      b.inst.destroy();
    });
  });

  test('Run-all leaves out a Document box nothing is wired from; ▶ on it, or a wire from it, reads it', () => {
    const specs = specMap();
    const doc = {
      parts: [
        { id: 'd1', type: 'document', settings: {}, state: 'idle' },
        { id: 't1', type: 'note', settings: { text: 'x' }, state: 'idle' },
        { id: 'a1', type: 'ask', settings: {}, state: 'idle' },
      ],
      wires: [{ id: 'w1', from: 't1', to: 'a1', port: 'in' }],
    };
    assert.deepEqual(activeSet(/** @type {any} */ (doc), [], { mode: 'all', specs }), ['t1', 'a1'], 'the lone PDF is not read for nobody');
    assert.deepEqual(activeSet(/** @type {any} */ (doc), [], { mode: 'all', force: true, specs }), ['t1', 'a1']);
    assert.ok(activeSet(/** @type {any} */ (doc), ['d1'], { mode: 'from', specs }).includes('d1'), '▶ on the box reads it');
    const wired = { ...doc, wires: [...doc.wires, { id: 'w2', from: 'd1', to: 'a1', port: 'in' }] };
    assert.ok(activeSet(/** @type {any} */ (wired), [], { mode: 'all', specs }).includes('d1'), 'wired: Run-all reads it');
    assert.deepEqual(runPlan(/** @type {any} */ (doc), { specs }).ids, ['t1', 'a1'], 'the plan preview agrees');
  });

  test('the spec: quiet, not a generation, holds pdf, adopt returns only defaults() keys', () => {
    assert.equal(documentPart.quiet, true);
    assert.equal(documentPart.thinks, false);
    assert.equal(documentPart.holds, 'pdf');
    assert.equal(documentPart.output, 'text');
    const keys = Object.keys(documentPart.defaults()).sort();
    assert.deepEqual(Object.keys(documentPart.adopt({ fileId: 'f', name: 'n', extra: 1 })).sort(), keys);
  });
};

// ---- a box in the unit runner's DOM shim ---------------------------------------------------------

/** Run `fn` with the shim installed as `globalThis.document`. @param {(doc: any) => Promise<void>} fn */
async function withDom(fn) {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = doc;
  try { await fn(doc); } finally {
    if (had) /** @type {any} */ (globalThis).document = prev;
    else delete (/** @type {any} */ (globalThis).document);
  }
}

/** A rendered box whose ctx behaves like the canvas's: update() edits the part and hands it back.
 * @param {any} doc @param {any} app @param {any} part */
function box(doc, app, part) {
  const host = doc.createElement('div');
  /** @type {any[]} */ const patches = [];
  /** @type {string[]} */ const commits = [];
  let live = { ...part };
  /** @type {any} */ let inst = null;
  const ctx = {
    app,
    get part() { return live; },
    update(/** @type {any} */ patch) {
      patches.push(patch);
      live = { ...live, settings: { ...live.settings, ...patch } };
      if (inst) inst.update(live);
    },
    commit(/** @type {string} */ label) { commits.push(label); },
    open() {},
  };
  inst = documentPart.render(host, live, /** @type {any} */ (ctx));
  return {
    host, patches, commits, inst,
    q: (/** @type {string} */ sel) => host.querySelector(sel),
    /** @param {any[]} files */
    drop(files) {
      const ev = {
        type: 'drop', prevented: false, stopped: false,
        dataTransfer: { types: ['Files'], files },
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; },
      };
      host.dispatchEvent(ev);
      return ev;
    },
    /** Let the store's promises and the repaint they schedule finish. */
    settle: () => new Promise((r) => setTimeout(r, 20)),
  };
}
