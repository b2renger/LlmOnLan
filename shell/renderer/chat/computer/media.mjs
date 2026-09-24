// @ts-check
// The Computer's local file store (K6-U2, addendum KF-5). Loader `feature`, key `media`.
//
// A PDF or a sound file a box holds is kept on THIS computer — in the existing `attachments` store,
// under `threadId: MEDIA_OWNER`, deduplicated by sha256 (state/repo.mjs `putAttachment` already
// does that by (threadId, sha256)). A part keeps only the MediaRef in its settings, so a
// `.lolgraph.json` never carries the bytes, and the same file dropped twice is stored once. The
// farm's extracted text is cached ON the attachment record (`pages`, `extractEngine:'farm-ocr'`),
// which is what "cached by content hash" means: the same bytes are never sent twice.
//
// install(app) sets `app.media` (API_KEYS.media):
//   put(file, {maxBytes, kind})  -> Promise<MediaRef | {error}>   a refusal is a SENTENCE, never a throw
//   get(fileId)                  -> Promise<Attachment|null>
//   bytes(fileId)                -> Promise<ArrayBuffer|null>
//   patch(fileId, fields)        -> Promise<boolean>              the extraction cache; never the bytes
//   sweep()                      -> Promise<number>               drop files no graph refers to
//   debug()                      -> {puts, refused, swept, lastError}
//
// Nothing here talks to the network. Nothing here decides whether a farm can USE a file — that is
// graph/takes.mjs; this module only keeps bytes, and says so in a sentence when it will not.

import { t } from '../core/i18n.mjs';
import '../strings/parts-document.en.mjs';

/** Attachment.threadId for every file the Computer keeps (frozen, KF-5). */
export const MEDIA_OWNER = 'computer:media';

/** A PDF's first bytes. The format allows junk before it, so we look a little way in. */
const PDF_MAGIC = '%PDF-';
/** How far into a file the PDF signature may start. */
export const PDF_MAGIC_WINDOW = 1024;

/** @param {number} bytes @returns {string} */
const mb = (bytes) => ((Number(bytes) || 0) / (1024 * 1024)).toFixed(1);

/** Hex sha256 of some bytes. `crypto.subtle` is available in the renderer (plan §0.3).
 * @param {ArrayBuffer} buf @returns {Promise<string>} */
export async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** PURE: do these bytes carry a PDF signature near the start? A file NAMED `.pdf` that is not one
 * would otherwise travel to the farm to be refused there. @param {ArrayBuffer} buf @returns {boolean} */
export function isPdfBytes(buf) {
  if (!buf || typeof buf.byteLength !== 'number') return false;
  const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, PDF_MAGIC_WINDOW));
  // One byte per char (latin1), so the signature is found wherever it sits in the window.
  return String.fromCharCode(...head).indexOf(PDF_MAGIC) >= 0;
}

/** Every `settings.fileId` a graph document refers to. PURE. @param {any} doc @param {Set<string>} into */
export function fileIdsOf(doc, into) {
  const parts = doc && Array.isArray(doc.parts) ? doc.parts : [];
  for (const p of parts) {
    const id = p && p.settings && p.settings.fileId;
    if (typeof id === 'string' && id) into.add(id);
  }
  return into;
}

/** @param {any} app */
export function install(app) {
  let puts = 0;
  let refused = 0;
  let swept = 0;
  /** @type {string|null} */ let lastError = null;
  const repo = () => (app && app.repo) || null;

  /** @param {string} message */
  const refuse = (message) => { refused++; lastError = message; return { error: message }; };

  /**
   * Keep one file. `kind: 'pdf'` also checks the bytes really are a PDF.
   * @param {any} file a File/Blob with name/type/size
   * @param {{maxBytes?: number, kind?: string}} [o]
   */
  async function put(file, o = {}) {
    const name = String((file && file.name) || 'file');
    const cap = Number(o && o.maxBytes) || 0;
    const said = Number(file && file.size) || 0;
    if (cap && said > cap) return refuse(t('parts.mediaTooBig', { name, mb: mb(said), capMb: mb(cap) }));
    const r = repo();
    if (!r || typeof r.putAttachment !== 'function') return refuse(t('parts.mediaNoStore', { name }));
    if (!file || typeof file.arrayBuffer !== 'function') return refuse(t('parts.mediaUnreadable', { name }));
    try {
      const buf = await file.arrayBuffer();
      // The size a File claims and the bytes it gives can differ (a file that grew on disk).
      if (cap && buf.byteLength > cap) return refuse(t('parts.mediaTooBig', { name, mb: mb(buf.byteLength), capMb: mb(cap) }));
      if (!buf.byteLength) return refuse(t('parts.mediaEmpty', { name }));
      if (o && o.kind === 'pdf' && !isPdfBytes(buf)) return refuse(t('parts.mediaNotPdf', { name }));
      const sha = await sha256Hex(buf);
      const mime = String((file && file.type) || (o && o.kind === 'pdf' ? 'application/pdf' : 'application/octet-stream'));
      /** @type {any} */ const att = { threadId: MEDIA_OWNER, name, mime, size: buf.byteLength, sha256: sha, status: 'ready' };
      // Assigned, not written as an object key: chat-lint rule 2 reads `blob` + colon as a URL.
      att.blob = new Blob([buf], { type: mime });
      const fileId = await r.putAttachment(att);
      if (!fileId) return refuse(t('parts.mediaUnreadable', { name }));
      puts++;
      return { fileId: String(fileId), name, mime, size: buf.byteLength, sha256: sha };
    } catch (err) {
      console.warn('[lolcomputer] keeping a file failed', err);
      return refuse(t('parts.mediaUnreadable', { name }));
    }
  }

  /** @param {string} fileId */
  async function get(fileId) {
    const r = repo();
    if (!r || !fileId || typeof r.getAttachment !== 'function') return null;
    try {
      const rec = (await r.getAttachment(String(fileId))) || null;
      // Only the Computer's own files: a fileId pasted into a hand-edited graph must not reach a
      // chat's attachment.
      return rec && rec.threadId === MEDIA_OWNER ? rec : null;
    } catch { return null; }
  }

  /** @param {string} fileId */
  async function bytes(fileId) {
    const rec = await get(fileId);
    const blob = rec && rec.blob;
    if (!blob || typeof blob.arrayBuffer !== 'function') return null;
    try { return await blob.arrayBuffer(); } catch { return null; }
  }

  /** The extraction cache. The bytes, name and hash are never patched. @param {string} fileId @param {object} fields */
  async function patch(fileId, fields) {
    const r = repo();
    const rec = await get(fileId);
    if (!r || !rec || typeof r.runTx !== 'function') return false;
    /** @type {any} */ const next = { ...rec, ...(fields || {}) };
    next.id = rec.id; next.threadId = rec.threadId; next.sha256 = rec.sha256; next.blob = rec.blob;
    next.name = rec.name; next.mime = rec.mime; next.size = rec.size;
    try {
      await r.runTx(['attachments'], 'readwrite', async (/** @type {any} */ tx) => { await tx.put('attachments', next); });
      return true;
    } catch (err) {
      console.warn('[lolcomputer] caching on a file failed', err);
      return false;
    }
  }

  /**
   * Delete the Computer's files that no saved graph and not the open one refers to. Called after a
   * graph is deleted (computer/library.mjs remove()). The saved graphs are read INSIDE the same
   * transaction that deletes, so a graph saved meanwhile cannot lose its file, and a failed read
   * throws instead of looking like "no graphs" (repo reads fall back to [] on error — deleting
   * against that would empty the store). → how many files were deleted.
   */
  async function sweep() {
    const r = repo();
    if (!r || typeof r.runTx !== 'function') return 0;
    /** @type {Set<string>} */ const keep = new Set();
    // The open graph may hold a file it has not been saved with yet.
    try {
      const session = app && app.host && app.host.session;
      if (session && typeof session.doc === 'function') fileIdsOf(session.doc(), keep);
    } catch (err) { console.warn('[lolcomputer] reading the open graph for a sweep failed', err); return 0; }
    // Graphs of ephemeral threads live outside IndexedDB; listGraphs() is the only door to them.
    if (typeof r.listGraphs === 'function') {
      for (const g of (await r.listGraphs()) || []) fileIdsOf(g, keep);
    }
    let removed = 0;
    await r.runTx(['graphs', 'attachments'], 'readwrite', async (/** @type {any} */ tx) => {
      for (const g of (await tx.getAll('graphs')) || []) fileIdsOf(g, keep);
      const mine = (await tx.byIndex('attachments', 'threadId', MEDIA_OWNER)) || [];
      for (const a of mine) {
        if (!a || !a.id || keep.has(a.id)) continue;
        await tx.del('attachments', a.id);
        removed++;
      }
    });
    swept += removed;
    return removed;
  }

  app.media = {
    put, get, bytes, patch, sweep,
    debug: () => ({ puts, refused, swept, lastError }),
  };
  return app.media;
}
