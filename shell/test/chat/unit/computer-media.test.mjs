// @ts-check
// K6-U2 in Node: the Computer's local file store (computer/media.mjs, addendum KF-5), against the
// REAL repo over the memory backend — the same `putAttachment` dedup, the same `runTx` door, the
// same `attachments` store the renderer uses. No network anywhere in this file.

import assert from 'node:assert/strict';

import { createApp } from '../../../renderer/chat/core/app.mjs';
import { openRepoSync } from '../../../renderer/chat/state/repo.mjs';
import { createMemoryBackend } from '../../../renderer/chat/state/backend-memory.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';
import {
  install, MEDIA_OWNER, sha256Hex, isPdfBytes, fileIdsOf, PDF_MAGIC_WINDOW,
} from '../../../renderer/chat/computer/media.mjs';

/** A fresh app with a real repo and the file store installed. @param {any} [openDoc] */
function setup(openDoc) {
  const app = /** @type {any} */ (createApp({ root: null, els: /** @type {any} */ ({ live: { textContent: '' } }) }));
  app.repo = openRepoSync({ openPersistent: () => createMemoryBackend({ kind: 'idb' }), bus: app.bus, now: app.now, newId: app.newId });
  let doc = openDoc || null;
  app.host = { session: { doc: () => doc } };
  install(app);
  return { app, setDoc: (/** @type {any} */ d) => { doc = d; } };
}

/** A PDF-looking file: the signature, then `n` bytes of body. */
const pdf = (/** @type {string} */ name, /** @type {number} */ n = 64, /** @type {string} */ salt = '') =>
  new File([`%PDF-1.7\n${salt}${'x'.repeat(n)}`], name, { type: 'application/pdf' });

export default (/** @type {any} */ test) => {
  test('put keeps the bytes HERE, under the Computer, and hands back only a reference', async () => {
    const { app } = setup();
    const file = pdf('report.pdf');
    const ref = await app.media.put(file, { maxBytes: 1024 * 1024, kind: 'pdf' });
    assert.ok(!ref.error, ref.error);
    assert.deepEqual(Object.keys(ref).sort(), ['fileId', 'mime', 'name', 'sha256', 'size']);
    assert.equal(ref.name, 'report.pdf');
    assert.equal(ref.mime, 'application/pdf');
    assert.equal(ref.size, file.size);
    assert.equal(ref.sha256, await sha256Hex(await file.arrayBuffer()));
    const rec = await app.media.get(ref.fileId);
    assert.equal(rec.threadId, MEDIA_OWNER);
    assert.equal(rec.status, 'ready');
    const back = new Uint8Array(/** @type {ArrayBuffer} */ (await app.media.bytes(ref.fileId)));
    assert.deepEqual(back, new Uint8Array(await file.arrayBuffer()), 'the same bytes come back');
    assert.equal(app.media.debug().puts, 1);
  });

  test('the same bytes dropped twice are stored ONCE (dedup by content hash), a different file is not', async () => {
    const { app } = setup();
    const a = await app.media.put(pdf('a.pdf'), { kind: 'pdf' });
    const again = await app.media.put(pdf('renamed-copy.pdf'), { kind: 'pdf' });
    const other = await app.media.put(pdf('b.pdf', 64, 'other'), { kind: 'pdf' });
    assert.equal(again.fileId, a.fileId, 'same content → same file id → the farm cache is shared');
    assert.notEqual(other.fileId, a.fileId);
    assert.equal((await app.repo.listAttachments(MEDIA_OWNER)).length, 2);
  });

  test('every refusal is a sentence, never a throw: too big, empty, not really a PDF, no store', async () => {
    const { app } = setup();
    const big = await app.media.put(pdf('huge.pdf', 3 * 1024 * 1024), { maxBytes: 2 * 1024 * 1024, kind: 'pdf' });
    assert.equal(big.error, t('parts.mediaTooBig', { name: 'huge.pdf', mb: '3.0', capMb: '2.0' }));
    // A File whose `size` understates its bytes is caught after reading, too.
    const liar = { name: 'liar.pdf', type: 'application/pdf', size: 10, arrayBuffer: async () => new ArrayBuffer(4096) };
    assert.match(String((await app.media.put(liar, { maxBytes: 1024, kind: 'pdf' })).error), /liar\.pdf is 0\.0 MB, over/);
    const empty = await app.media.put(new File([], 'nothing.pdf', { type: 'application/pdf' }), { kind: 'pdf' });
    assert.equal(empty.error, t('parts.mediaEmpty', { name: 'nothing.pdf' }));
    const fake = await app.media.put(new File(['just words'], 'notes.pdf', { type: 'application/pdf' }), { kind: 'pdf' });
    assert.equal(fake.error, t('parts.mediaNotPdf', { name: 'notes.pdf' }));
    // Without `kind:'pdf'` the store keeps any bytes (the Sound box's files are not PDFs).
    assert.ok(!(await app.media.put(new File(['RIFF....WAVE'], 's.wav', { type: 'audio/wav' }), {})).error);
    const bare = /** @type {any} */ ({});
    install(bare);
    assert.equal((await bare.media.put(pdf('x.pdf'), { kind: 'pdf' })).error, t('parts.mediaNoStore', { name: 'x.pdf' }));
    assert.equal(await bare.media.get('anything'), null);
    const d = app.media.debug();
    assert.equal(d.refused, 4);
    assert.equal(d.lastError, t('parts.mediaNotPdf', { name: 'notes.pdf' }));
    assert.equal((await app.repo.listAttachments(MEDIA_OWNER)).length, 1, 'nothing refused was kept');
  });

  test('isPdfBytes finds the signature near the start, and only there', () => {
    const enc = (/** @type {string} */ s) => new TextEncoder().encode(s).buffer;
    assert.equal(isPdfBytes(enc('%PDF-1.4 ...')), true);
    assert.equal(isPdfBytes(enc(`junk before it\n%PDF-1.4`)), true);
    assert.equal(isPdfBytes(enc(`${'j'.repeat(PDF_MAGIC_WINDOW)}%PDF-1.4`)), false, 'past the window it is not a PDF header');
    assert.equal(isPdfBytes(enc('%PDF')), false);
    assert.equal(isPdfBytes(/** @type {any} */ (null)), false);
  });

  test('get() answers only for the Computer\'s own files: a chat attachment id is not reachable', async () => {
    const { app } = setup();
    const chatId = await app.repo.putAttachment({ threadId: 'some-chat', name: 'secret.pdf', mime: 'application/pdf', size: 3, sha256: 'abc', status: 'ready' });
    assert.ok(chatId);
    assert.equal(await app.media.get(chatId), null);
    assert.equal(await app.media.bytes(chatId), null);
    assert.equal(await app.media.patch(chatId, { pages: [] }), false);
  });

  test('patch() caches the extraction ON the record and can never touch the bytes, name or hash', async () => {
    const { app } = setup();
    const ref = await app.media.put(pdf('r.pdf'), { kind: 'pdf' });
    const before = new Uint8Array(/** @type {ArrayBuffer} */ (await app.media.bytes(ref.fileId)));
    const ok = await app.media.patch(ref.fileId, {
      pages: [{ page: 1, text: 'hello', engine: 'text' }], extractEngine: 'farm-ocr', status: 'ready',
      name: 'evil.pdf', sha256: 'nope', size: 1, threadId: 'elsewhere',
    });
    assert.equal(ok, true);
    const rec = await app.media.get(ref.fileId);
    assert.deepEqual(rec.pages, [{ page: 1, text: 'hello', engine: 'text' }]);
    assert.equal(rec.extractEngine, 'farm-ocr');
    assert.equal(rec.name, 'r.pdf');
    assert.equal(rec.sha256, ref.sha256);
    assert.equal(rec.size, ref.size);
    assert.equal(rec.threadId, MEDIA_OWNER);
    assert.deepEqual(new Uint8Array(/** @type {ArrayBuffer} */ (await app.media.bytes(ref.fileId))), before);
    assert.equal(await app.media.patch('no-such-id', { pages: [] }), false);
  });

  test('sweep() deletes the files no saved graph and not the open one refers to — and nothing else', async () => {
    const { app, setDoc } = setup();
    const kept = await app.media.put(pdf('in-a-saved-graph.pdf', 10, 'a'), { kind: 'pdf' });
    const open = await app.media.put(pdf('in-the-open-graph.pdf', 10, 'b'), { kind: 'pdf' });
    const orphan = await app.media.put(pdf('orphan.pdf', 10, 'c'), { kind: 'pdf' });
    const sound = await app.media.put(new File(['RIFF-sound'], 'orphan.wav', { type: 'audio/wav' }), {});
    const chat = await app.repo.putAttachment({ threadId: 'a-chat', name: 'c.pdf', mime: 'application/pdf', size: 1, sha256: 'zz', status: 'ready' });
    await app.repo.putGraph({ id: 'g1', parts: [{ id: 'p1', type: 'document', settings: { fileId: kept.fileId } }], wires: [] });
    setDoc({ id: 'g2', parts: [{ id: 'p2', type: 'document', settings: { fileId: open.fileId } }, { id: 'n', type: 'note', settings: { text: 'x' } }], wires: [] });
    const n = await app.media.sweep();
    assert.equal(n, 2, 'the orphan PDF and the orphan sound');
    assert.ok(await app.media.get(kept.fileId), 'a saved graph still refers to it');
    assert.ok(await app.media.get(open.fileId), 'the open, unsaved graph refers to it');
    assert.equal(await app.media.get(orphan.fileId), null);
    assert.equal(await app.media.get(sound.fileId), null);
    assert.ok(await app.repo.getAttachment(chat), 'a chat\'s attachment is never the Computer\'s to sweep');
    assert.equal(app.media.debug().swept, 2);
    assert.equal(await app.media.sweep(), 0, 'a second sweep finds nothing');
  });

  test('sweep() deletes nothing when it cannot read the graphs (a failed read is not "no graphs")', async () => {
    const { app } = setup();
    const ref = await app.media.put(pdf('precious.pdf'), { kind: 'pdf' });
    const realRunTx = app.repo.runTx;
    app.repo.runTx = async (/** @type {any} */ stores, /** @type {any} */ mode, /** @type {any} */ fn) => realRunTx(stores, mode, async (/** @type {any} */ tx) => fn({
      ...tx, getAll: async () => { throw new Error('the store is unreadable'); },
    }));
    await assert.rejects(() => app.media.sweep(), /unreadable/);
    app.repo.runTx = realRunTx;
    assert.ok(await app.media.get(ref.fileId), 'the file survived');
  });

  test('fileIdsOf reads settings.fileId of every part and ignores the rest', () => {
    const got = fileIdsOf({ parts: [{ settings: { fileId: 'a' } }, { settings: { fileId: '' } }, { settings: {} }, null, { settings: { fileId: 7 } }] }, new Set());
    assert.deepEqual([...got], ['a']);
    assert.deepEqual([...fileIdsOf(null, new Set())], []);
  });
};
