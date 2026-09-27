// @ts-check
// The farm's document extractor — the ONE network door for it (K6, addendum KF-5; chat-lint rule
// 11 allow-lists this file by name).
//
// The contract is the farm's own (farm/src/pysvc/server.py:312, OWUI's External Document Loader):
//   PUT {extract.url}/process
//     body           the file's raw bytes
//     Content-Type   the file's MIME type
//     Authorization  Bearer {extract.key}
//     X-Filename     encodeURIComponent(name)
//   → 200 [{page_content: string, metadata: {page, source, engine}}, …]
//     401 wrong key · 400 empty body · 415 a type it cannot read · 500 no key configured
// The URL and key come from the beacon snapshot's `extract` (farm/src/snapshot.js:217), published
// to the renderer as `app.farm.get().ocr = {url, key}`. `url` is the loader BASE: we append
// /process ourselves, exactly as OWUI does.
//
// This is the SANCTIONED flow in CLAUDE.md: the bytes go to the trusted-LAN farm for text
// EXTRACTION only, the farm stores nothing, and only the text comes back. It is never used for
// embeddings. It costs no seat (the extractor is not behind the seat gate — DISCUSS D-F3).
//
// The error table (each code has its own sentence in the Document box, K6-U2):
//   no-ocr        no extractor URL — nothing was sent
//   unsupported   415, or no bytes to send (nothing was sent)
//   unauthorized  401 — the key did not match
//   farm          any other non-2xx (400, 500 no key configured, 503 down, …) or a body that is
//                 not JSON: the farm answered, badly
//   aborted       the caller's signal (Stop)
//   timeout       EXTRACT_TIMEOUT_MS (or `timeoutMs`) passed with no answer
//   network       the request never got an answer (refused, reset, DNS)

/** @typedef {{page: number, text: string, engine: string}} ExtractPage */

/** How long one extraction may take before we give up and say so. Vision OCR on a scanned
 * document is seconds per page on the farm's GPU. */
export const EXTRACT_TIMEOUT_MS = 5 * 60 * 1000;

/** @param {any} v @returns {string} */
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * PURE: the extractor's JSON body → pages, in page order. Exported for the unit test, because
 * the shape is the one thing about the door that can silently change under us.
 * @param {any} body @returns {ExtractPage[]}
 */
export function readPages(body) {
  const rows = Array.isArray(body) ? body : [];
  /** @type {ExtractPage[]} */ const out = [];
  rows.forEach((row, i) => {
    if (!row || typeof row !== 'object') return;
    const meta = (row.metadata && typeof row.metadata === 'object') ? row.metadata : {};
    const page = Number.isFinite(Number(meta.page)) ? Number(meta.page) : i + 1;
    out.push({ page, text: str(row.page_content), engine: str(meta.engine) || '?' });
  });
  return out;
}

/**
 * Send one file for extraction.
 * @param {{url: string, key: string|null, bytes: ArrayBuffer, name: string, mime: string,
 *   signal?: AbortSignal, timeoutMs?: number}} o
 * @returns {Promise<{pages: ExtractPage[]} | {error: string, code: 'no-ocr'|'unauthorized'|'unsupported'|'farm'|'aborted'|'timeout'|'network', status?: number}>}
 */
export async function extractDoc(o) {
  if (!o || !o.url) return { error: 'no extractor', code: 'no-ocr' };
  // An empty body is a 400 on the farm: never spend a request to be told so.
  if (!o.bytes || !(Number(/** @type {any} */ (o.bytes).byteLength) > 0)) return { error: 'empty', code: 'unsupported' };
  const ac = new AbortController();
  const outer = o.signal || null;
  const onAbort = () => { try { ac.abort(); } catch { /* already */ } };
  if (outer) { if (outer.aborted) return { error: 'aborted', code: 'aborted' }; outer.addEventListener('abort', onAbort, { once: true }); }
  let timedOut = false;
  // A one-shot deadline on ONE request (the same discipline as app/caps.mjs), not a wall clock.
  const timer = setTimeout(() => { timedOut = true; onAbort(); }, Number(o.timeoutMs) || EXTRACT_TIMEOUT_MS);
  try {
    /** @type {Record<string, string>} */ const headers = {
      'Content-Type': o.mime || 'application/octet-stream',
      'X-Filename': encodeURIComponent(o.name || 'upload'),
    };
    if (o.key) headers.Authorization = `Bearer ${o.key}`;
    const res = await fetch(`${String(o.url).replace(/\/+$/, '')}/process`, {
      method: 'PUT', headers, body: o.bytes, cache: 'no-store', signal: ac.signal,
    });
    if (res.status === 401) return { error: 'unauthorized', code: 'unauthorized', status: 401 };
    if (res.status === 415) return { error: 'unsupported', code: 'unsupported', status: 415 };
    if (!res.ok) return { error: `HTTP ${res.status}`, code: 'farm', status: res.status };
    /** @type {any} */ let body = null;
    try { body = await res.json(); } catch {
      if (timedOut) return { error: 'timeout', code: 'timeout' };
      if (outer && outer.aborted) return { error: 'aborted', code: 'aborted' };
      return { error: 'not JSON', code: 'farm', status: res.status };
    }
    if (!Array.isArray(body)) return { error: 'not a list of pages', code: 'farm', status: res.status };
    return { pages: readPages(body) };
  } catch (err) {
    if (timedOut) return { error: 'timeout', code: 'timeout' };
    if (outer && outer.aborted) return { error: 'aborted', code: 'aborted' };
    return { error: String((err && /** @type {any} */ (err).message) || err), code: 'network' };
  } finally {
    clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onAbort);
  }
}
