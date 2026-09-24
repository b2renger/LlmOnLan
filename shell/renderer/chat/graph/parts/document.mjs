// @ts-check
// The Document (PDF) box (K6-U2, addendum KF-5). "Bring in" group.
//
// It HOLDS a PDF — the bytes stay on this computer, in the attachments store, through
// computer/media.mjs; the part keeps only a MediaRef in its settings. When a run NEEDS the text
// (never on drop), the bytes go to the farm's OCR extractor — the sanctioned flow in CLAUDE.md —
// through net/extract.mjs, and ONLY the text comes back. That text is cached on the attachment by
// content hash (the same bytes are never sent twice), shown in the box (safe markdown, "first N of
// M pages" honesty) and flows on as `{kind:'text', format:'markdown'}`. A farm that advertises no
// extractor gets a sentence, and nothing is sent.
//
// Four promises this file keeps, each checked by a test:
//   1. NOTHING IS SENT ON DROP. Dropping, choosing or pasting a PDF stores bytes locally, and only
//      a run that reaches this box reads it on the farm.
//   2. ONE EXTRACTION AT A TIME per window (the farm's extractor is outside the seat gate — DISCUSS
//      D-F3 — so a graph of five PDFs must not put five vision-OCR jobs on its GPU at once), and a
//      second box holding the same bytes waits and then finds the first one's cache.
//   3. A FAILURE IS NEVER CACHED. Stop, a timeout, a 5xx or an empty answer leave the record as it
//      was, so the next run tries again.
//   4. WHAT FLOWS ON SAYS WHEN IT WAS CUT. Past DOC_MAX_PAGES / DOC_MAX_CHARS the value begins with
//      the same sentence the box shows, so the model is told too.
//
// K6 fix round — the farm's extractor reads EVERY page it is sent and keeps going after we stop
// waiting (farm/src/pysvc/server.py: no page cap, no cancel on disconnect; DISCUSS D-F13). So:
//   5. A PDF WHOSE PAGE COUNT IS KNOWN FROM ITS BYTES AND IS OVER DOC_MAX_PAGES IS NEVER SENT: it is
//      refused at intake (`pagesRefusal`, through media.put's `check`) and again before an upload.
//   6. AFTER A TIMEOUT OR A STOP MID-READ, THE SAME BYTES WAIT (`EXTRACT_COOLDOWN_MS`, per sha256):
//      the farm may still be reading them, and a retry would start a second full job on its GPU.
//
// It is NOT a generation: `thinks:false`, it spends no seat and the plan preview does not count it.

import { t } from '../../core/i18n.mjs';
import { valueOf, isValue } from '../values.mjs';
import { partFail } from './common.mjs';
import { renderTakes } from '../takes-view.mjs';
import { farmViewOf, reasonFor, WHY } from '../takes.mjs';
import { extractDoc, EXTRACT_TIMEOUT_MS } from '../../net/extract.mjs';
import { parseBlocks } from '../../render/md-block.mjs';
import { domFactory, renderBlocks } from '../../render/dom.mjs';
import '../../strings/parts-document.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */
/** @typedef {{page: number, text: string, engine?: string}} DocPage */

/** The largest PDF a box keeps and sends for extraction (frozen, KF-5). */
export const DOC_MAX_BYTES = 32 * 1024 * 1024;
/** The pages that flow on; the box says "first N of M pages" past it (frozen, KF-5). */
export const DOC_MAX_PAGES = 60;
/** The characters that flow on, under serialize's 1 MB value cap with room to spare (frozen, KF-5). */
export const DOC_MAX_CHARS = 200000;
/** What a drop or a picker accepts. */
export const DOC_TYPES = Object.freeze(['application/pdf']);
/** After a timeout or a Stop while the farm was reading, how long the same bytes wait before they
 * may be sent again: as long as the farm may still be reading them (K6 fix round). A test may
 * shorten it with `flags.extractCooldownMs`. */
export const EXTRACT_COOLDOWN_MS = EXTRACT_TIMEOUT_MS;
/** How much of the text the BOX draws. Parsing and building 200 000 characters of markdown is
 * ~0.1 s of main thread on every new value; the box scrolls, and the whole text still flows on. */
export const DOC_RENDER_CHARS = 64 * 1024;

/** The settings a box is placed with for one stored PDF (KF-4 `adopt`). @param {any} ref */
function adopt(ref) {
  const r = ref || {};
  return {
    fileId: String(r.fileId || ''),
    name: String(r.name || ''),
    mime: String(r.mime || 'application/pdf'),
    size: Number(r.size) || 0,
    sha256: String(r.sha256 || ''),
  };
}

/** The settings of a box that holds nothing. */
const EMPTY = Object.freeze({ fileId: '', name: '', mime: '', size: 0, sha256: '' });

/** @param {number} bytes @returns {string} */
const mbOf = (bytes) => ((Number(bytes) || 0) / (1024 * 1024)).toFixed(1);

/** Is this File a PDF, by what it SAYS it is? (media.put checks the bytes.) PURE.
 * @param {any} file @returns {boolean} */
export function isPdfFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  if (DOC_TYPES.indexOf(type) >= 0) return true;
  return !type || type === 'application/octet-stream' || type === 'binary/octet-stream'
    ? /\.pdf$/i.test(String(file.name || ''))
    : false;
}

/** @param {number} ms @returns {number} whole minutes, at least 1 */
const minutesOf = (ms) => Math.max(1, Math.ceil((Number(ms) || 0) / 60000));

/** Bytes -> a one-byte-per-char string, in slices (a 32 MB PDF must not blow the argument limit).
 * @param {Uint8Array} u8 @returns {string} */
function latin1(u8) {
  /** @type {string[]} */ const out = [];
  for (let i = 0; i < u8.length; i += 0x8000) out.push(String.fromCharCode.apply(null, /** @type {any} */ (u8.subarray(i, i + 0x8000))));
  return out.join('');
}

/**
 * PURE, best effort: how many pages a PDF has, read from its bytes without a PDF library — or null
 * when the bytes do not say (the page tree lives in a compressed object stream, as in most PDFs
 * written since 2003). Never a guess: the answer is either one the file states or null.
 *   1. the LAST root `/Type /Pages` dictionary (no `/Parent`) in file order, and its `/Count` — the
 *      last, because an incremental update appends a new root after the old one;
 *   2. else the linearization dictionary's `/N` (the page count, stated in the first bytes).
 * @param {ArrayBuffer|Uint8Array} buf @returns {number|null}
 */
/** How far a `/Type /Pages` may sit from its object's `obj`/`endobj` (a flat tree of 10 000 pages
 * has a ~100 KB /Kids array). */
const PAGES_SPAN = 1 << 20;

export function pdfPageCount(buf) {
  const u8 = buf instanceof Uint8Array ? buf : (buf && typeof buf.byteLength === 'number' ? new Uint8Array(buf) : null);
  if (!u8 || !u8.length) return null;
  const s = latin1(u8);
  /** @type {number|null} */ let root = null;
  const re = /\/Type\s*\/Pages(?![A-Za-z0-9#])/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const start = s.lastIndexOf('obj', m.index);
    const end = s.indexOf('endobj', m.index);
    if (start < 0 || end < 0 || m.index - start > PAGES_SPAN || end - m.index > PAGES_SPAN) continue;
    const body = s.slice(start + 3, end);
    if (/\/Parent[\s/]/.test(body)) continue;
    const c = /\/Count\s+(\d{1,7})(?!\d)/.exec(body);
    if (c) root = Number(c[1]);
  }
  if (root != null && root > 0) return root;
  const head = s.slice(0, 4096);
  const lin = /<<[^>]*\/Linearized[^>]*>>/.exec(head);
  const n = lin ? /\/N\s+(\d{1,7})(?!\d)/.exec(lin[0]) : null;
  return n && Number(n[1]) > 0 ? Number(n[1]) : null;
}

/**
 * The intake check (media.put's `check`) and the pre-upload check: a PDF that SAYS it has more
 * pages than a box passes on is refused with a sentence, because the farm would read all of them.
 * '' = no objection (including "the bytes do not say"). PURE.
 * @param {ArrayBuffer|Uint8Array} buf @param {string} name @returns {string}
 */
export function pagesRefusal(buf, name) {
  const pages = pdfPageCount(buf);
  return pages != null && pages > DOC_MAX_PAGES
    ? t('parts.docTooManyPages', { name: String(name || 'document.pdf'), pages, max: DOC_MAX_PAGES })
    : '';
}

/** The pages a record already carries from the farm, or null. PURE. A record is a cache hit only
 * when the farm's extractor wrote it and it holds some text — never a failure, never "nothing".
 * @param {any} rec @returns {DocPage[]|null} */
export function cachedPages(rec) {
  if (!rec || rec.extractEngine !== 'farm-ocr' || rec.status !== 'ready' || !Array.isArray(rec.pages)) return null;
  return hasText(rec.pages) ? rec.pages : null;
}

/** Does any page carry text? PURE. @param {any} pages @returns {boolean} */
export function hasText(pages) {
  return Array.isArray(pages) && pages.some((p) => p && typeof p.text === 'string' && p.text.trim() !== '');
}

/**
 * PURE: the pages → the markdown that flows on, cut to DOC_MAX_PAGES pages and DOC_MAX_CHARS
 * characters IN TOTAL (the note included), and the sentence that says so when it was cut.
 * `shown` counts a page the character cap cut through; `page` is the last page (partly) shown.
 * @param {any} pages
 * @returns {{md: string, note: string, shown: number, total: number, cut: boolean, charCut: boolean, page: number}}
 */
export function docText(pages) {
  const all = (Array.isArray(pages) ? pages : [])
    .filter((p) => p && typeof p.text === 'string')
    .map((p, i) => ({ page: Number.isFinite(Number(p.page)) ? Number(p.page) : i + 1, text: String(p.text) }));
  const total = all.length;
  const marked = total > 1;
  /** @param {number} budget */
  const build = (budget) => {
    let body = '';
    let shown = 0;
    let page = 0;
    let charCut = false;
    for (const p of all.slice(0, DOC_MAX_PAGES)) {
      // The farm already heads each page of a multi-page PDF with "[Page N]"
      // (farm/src/pysvc/server.py); our own mark replaces it rather than saying it twice.
      const own = marked ? p.text.trim().replace(/^\[Page \d+\][ \t]*(?:\r?\n|$)/, '').trim() : p.text.trim();
      const chunk = (marked ? `${t('parts.docPageMark', { page: p.page })}\n\n` : '') + own;
      const sep = body ? '\n\n' : '';
      if (body.length + sep.length + chunk.length > budget) {
        const room = budget - body.length - sep.length;
        if (room > 0) { body += sep + chunk.slice(0, room); shown++; page = p.page; }
        charCut = true;
        break;
      }
      body += sep + chunk;
      shown++;
      page = p.page;
    }
    return { body, shown, page, charCut };
  };
  /** @param {{body: string, shown: number, page: number, charCut: boolean}} b */
  const noteOf = (b) => (b.charCut
    ? t('parts.docCutChars', { chars: b.body.length.toLocaleString('en-US'), page: b.page, total })
    : t('parts.docCutPages', { shown: b.shown, total }));
  let b = build(DOC_MAX_CHARS);
  const cut = b.charCut || b.shown < total;
  if (!cut) return { md: b.body, note: '', shown: b.shown, total, cut: false, charCut: false, page: b.page };
  // The note rides at the TOP, in italics, so a model reads it before the text. Its room comes
  // out of the same budget: what flows on never passes DOC_MAX_CHARS.
  let note = noteOf(b);
  const room = DOC_MAX_CHARS - note.length - 64;
  if (b.body.length > room) { b = build(room); note = noteOf(b); }
  const md = `*${note}*\n\n${b.body}`;
  return { md, note, shown: b.shown, total, cut: true, charCut: b.charCut, page: b.page };
}

/** The sentence for one net/extract.mjs failure code — plus this file's own two, `too-many-pages`
 * and `cooling`. Every code has its own. PURE.
 * @param {string} code @param {string} name @param {number} [status]
 * @param {{pages?: number, waitMs?: number, coolMs?: number}} [more] @returns {string} */
export function errorSentence(code, name, status, more) {
  const m = more || {};
  const cool = minutesOf(m.coolMs == null ? EXTRACT_COOLDOWN_MS : m.coolMs);
  switch (code) {
    case 'too-many-pages': return t('parts.docTooManyPagesRun', { name, pages: m.pages || '?', max: DOC_MAX_PAGES });
    case 'cooling': return t('parts.docCooling', { name, min: minutesOf(m.waitMs == null ? EXTRACT_COOLDOWN_MS : m.waitMs) });
    case 'no-ocr': return /** @type {string} */ (reasonFor(WHY.noOcr, null));
    case 'unauthorized': return t('parts.docErrUnauthorized', { name });
    case 'unsupported': return t('parts.docErrUnsupported', { name });
    case 'aborted': return t('parts.docErrAborted', { name, cool });
    case 'timeout': return t('parts.docErrTimeout', { name, min: Math.round(EXTRACT_TIMEOUT_MS / 60000), cool });
    case 'network': return t('parts.docErrNetwork', { name });
    default: return t('parts.docErrFarm', { name, status: status || '?' });
  }
}

/** The runner's reason for a code: Stop is not a failure (the part goes back to stale), a farm
 * problem is the farm's, a file the farm cannot read is the part's. @param {string} code */
const reasonOf = (code) => (code === 'aborted' ? 'aborted' : code === 'unsupported' || code === 'too-many-pages' ? 'part' : 'farm');

// ---- one reader per window ---------------------------------------------------------------------

/** One extraction at a time (promise 2), and what each box is waiting on, so it can say so. */
const READER = {
  /** @type {Promise<any>} */ tail: Promise.resolve(),
  busy: 0,
  /** @type {Map<string, 'waiting'|'reading'>} */ status: new Map(),
  /** @type {Set<(partId: string) => void>} */ subs: new Set(),
  /** sha256 -> the time before which those bytes are not sent again (promise 6). */
  /** @type {Map<string, number>} */ cooling: new Map(),
};

/** @param {any} app @returns {number} */
const nowOf = (app) => (app && typeof app.now === 'function' ? Number(app.now()) : Date.now());
/** @param {any} app @returns {number} */
function coolMsOf(app) {
  const f = app && app.flags;
  const v = f && f.extractCooldownMs != null ? Number(f.extractCooldownMs) : NaN;
  return Number.isFinite(v) && v >= 0 ? v : EXTRACT_COOLDOWN_MS;
}

/** How long the bytes with this hash must still wait before they may be sent to the farm again
 * (0 = they may go now). @param {string} sha @param {number} now @returns {number} ms */
export function coolingLeft(sha, now) {
  const key = String(sha || '');
  const until = READER.cooling.get(key);
  if (until == null) return 0;
  if (until <= now) { READER.cooling.delete(key); return 0; }
  return until - now;
}

/** @param {string} partId @param {''|'waiting'|'reading'} state */
function setStatus(partId, state) {
  if (!partId) return;
  if (state) READER.status.set(partId, state); else READER.status.delete(partId);
  for (const fn of Array.from(READER.subs)) {
    try { fn(partId); } catch (err) { console.warn('[lolcomputer] a Document box could not repaint', err); }
  }
}

/** Every box repaints (a wait began: any box holding those bytes now says so). */
function repaintAll() {
  for (const fn of Array.from(READER.subs)) {
    try { fn('*'); } catch (err) { console.warn('[lolcomputer] a Document box could not repaint', err); }
  }
}

/** What a box is doing on the farm right now: 'waiting' | 'reading' | ''. @param {string} partId */
export function readingOf(partId) { return READER.status.get(String(partId || '')) || ''; }

/** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
function serial(task) {
  const run = READER.tail.then(task);
  READER.tail = run.then(() => undefined, () => undefined);
  return run;
}

/** Resolve with the job, or with `aborted` the moment the signal fires — a box queued behind
 * another document stops waiting when Stop is pressed, and its job then sends nothing.
 * @param {Promise<any>} job @param {AbortSignal|null|undefined} signal @returns {Promise<any>} */
function untilAbort(job, signal) {
  if (!signal) return job;
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve({ error: 'aborted', code: 'aborted' });
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    job.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

/**
 * The pages of the PDF a box holds: the cache when there is one, else ONE extraction on the farm.
 * Throws the sentence (a partFail) on every refusal — and every refusal before the queue sends
 * nothing at all. Exported for the unit test; `run()` is its only caller in the app.
 * @param {{app: any, ref: any, signal?: AbortSignal|null, partId?: string}} o
 * @returns {Promise<DocPage[]>}
 */
export async function readDoc(o) {
  const app = (o && o.app) || null;
  const ref = (o && o.ref) || {};
  const signal = (o && o.signal) || null;
  const partId = String((o && o.partId) || '');
  const name = String(ref.name || 'document.pdf');
  const media = app && app.media;
  if (!media || typeof media.get !== 'function') throw partFail(t('parts.mediaNoStore', { name }), 'part');
  const rec = await media.get(ref.fileId);
  if (!rec) throw partFail(t('parts.mediaMissing'), 'part');
  const hit = cachedPages(rec);
  if (hit) return hit;

  const farm = app.farm && typeof app.farm.get === 'function' ? app.farm.get() : null;
  if (!farm || !farm.present) throw partFail(t('parts.docNoFarm', { name }), 'no-farm');
  if (!farm.ocr || !farm.ocr.url) throw partFail(errorSentence('no-ocr', name), 'part');
  if (signal && signal.aborted) throw partFail(errorSentence('aborted', name), 'aborted');
  // Promise 6: the farm may still be reading these very bytes from a try we gave up on.
  const sha = String(rec.sha256 || ref.sha256 || ref.fileId || '');
  const coolMs = coolMsOf(app);
  const wait = coolingLeft(sha, nowOf(app));
  if (wait > 0) throw partFail(errorSentence('cooling', name, 0, { waitMs: wait }), 'farm');

  setStatus(partId, READER.busy > 0 ? 'waiting' : 'reading');
  READER.busy++;
  const job = serial(async () => {
    try {
      if (signal && signal.aborted) return { error: 'aborted', code: 'aborted' };
      setStatus(partId, 'reading');
      // The box ahead of us in the queue may have read these very bytes.
      const again = cachedPages(await media.get(ref.fileId));
      if (again) return { pages: again };
      const bytes = await media.bytes(ref.fileId);
      if (!bytes) return { missing: true };
      // Promise 5: a PDF that says it has more pages than flow on is not sent (a file kept before
      // the intake check existed, or by a door that skipped it).
      const pages = pdfPageCount(bytes);
      if (pages != null && pages > DOC_MAX_PAGES) return { error: 'too many pages', code: 'too-many-pages', pages };
      // Read the farm AGAIN: it may have withdrawn its extractor while we queued.
      const now = app.farm.get();
      const ocr = now && now.present ? now.ocr : null;
      if (!ocr || !ocr.url) return { error: 'no extractor', code: 'no-ocr' };
      // A box that queued behind the one that gave up on these bytes waits too.
      const left = coolingLeft(sha, nowOf(app));
      if (left > 0) return { error: 'cooling', code: 'cooling', waitMs: left };
      // The last look before the request leaves: from here to fetch() nothing awaits, so a Stop
      // after this line is a Stop DURING the read, which is what the cooldown is for.
      if (signal && signal.aborted) return { error: 'aborted', code: 'aborted' };
      const out = await extractDoc({
        url: String(ocr.url), key: ocr.key ? String(ocr.key) : null, bytes, name,
        mime: String(ref.mime || rec.mime || 'application/pdf'), signal: signal || undefined,
      });
      const code = 'code' in out ? out.code : '';
      if (code === 'timeout' || code === 'aborted') {
        if (sha && coolMs > 0) { READER.cooling.set(sha, nowOf(app) + coolMs); repaintAll(); }
      } else if ('pages' in out) READER.cooling.delete(sha);
      if ('pages' in out && hasText(out.pages) && !(signal && signal.aborted)) {
        await media.patch(ref.fileId, { pages: out.pages, extractEngine: 'farm-ocr', status: 'ready' });
      }
      return out;
    } finally {
      READER.busy--;
    }
  });
  /** @type {any} */ let out;
  try { out = await untilAbort(job, signal); } finally { setStatus(partId, ''); }
  if (out && out.missing) throw partFail(t('parts.mediaMissing'), 'part');
  if (out && Array.isArray(out.pages)) {
    if (!hasText(out.pages)) throw partFail(t('parts.docNoText', { name }), 'farm');
    return out.pages;
  }
  const code = String((out && out.code) || 'farm');
  throw partFail(errorSentence(code, name, out && out.status, { pages: out && out.pages, waitMs: out && out.waitMs, coolMs }),
    /** @type {any} */ (reasonOf(code)));
}

/**
 * Several files dropped on a box that holds ONE: say which one it took and where the rest go —
 * a toast the reader sees, and the canvas's live region for a screen reader (build rule 6). The
 * Sound box says it the same way. @param {any} app @param {string} took @param {number} others
 */
export function sayOnlyOne(app, took, others) {
  const message = t('parts.dropOnlyOne', { name: took, n: others });
  try {
    const canvas = app && app.host && app.host.canvas;
    if (canvas && typeof canvas.announce === 'function') canvas.announce(message);
  } catch (err) { console.warn('[lolcomputer] a box could not announce', err); }
  try {
    if (app && app.dialogs && typeof app.dialogs.toast === 'function') app.dialogs.toast(message, { kind: 'info' });
  } catch (err) { console.warn('[lolcomputer] a box could not say so', err); }
}

// ---- the part ----------------------------------------------------------------------------------

/** @type {PartSpec} */
export const documentPart = /** @type {any} */ ({
  type: 'document',
  order: 125,
  label: t('parts.docLabel'),
  thinks: false,
  // K6 fix round: a Run-all leaves out a Document box nothing is wired from — reading it would
  // send the PDF to the farm for nobody. The box's own ▶ still reads it (graph/topo.mjs activeSet).
  onlyWhenUsed: true,
  // The box draws its own value (the extracted text), so the canvas's one-line strip would only
  // print its first line twice (KD-3).
  quiet: true,
  size: { w: 300, h: 200 },
  holds: 'pdf',
  adopt,
  inputs: [],
  output: 'text',
  defaults: () => ({ ...EMPTY }),

  render(host, part, ctx) {
    const app = (ctx && ctx.app) || null;
    const doc = host.ownerDocument || document;
    let destroyed = false;
    let latest = part;
    let keeping = '';
    let problem = '';
    /** The value that belonged to the file this box held before it was replaced or removed, and
     * that file: not shown while the box holds another (Undo back to that file shows it again). */
    /** @type {{value: any, fileId: string}|null} */ let hidden = null;
    /** @type {any} */ let rendered = null;
    /** The attachment record: undefined while unknown, null when it is gone. */
    /** @type {any} */ let rec;
    let recFor = '';
    /** @type {any} */ let recValue = null;
    /** The repaint that clears the "the farm may still be reading it" line when its wait ends. */
    /** @type {any} */ let coolTimer = null;

    /** @param {string} tag @param {string} cls @param {string} [text] */
    const el = (tag, cls, text) => {
      const n = doc.createElement(tag);
      n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };

    const empty = /** @type {HTMLButtonElement} */ (el('button', 'graph-doc-empty', t('parts.docEmpty')));
    empty.type = 'button';
    const head = el('div', 'graph-doc-head');
    const glyph = el('span', 'graph-doc-glyph', 'PDF');
    glyph.setAttribute('aria-hidden', 'true');
    const who = el('div', 'graph-doc-who');
    const name = el('p', 'graph-doc-name');
    const meta = el('p', 'graph-doc-meta');
    who.append(name, meta);
    const actions = el('span', 'graph-doc-actions');
    const replace = /** @type {HTMLButtonElement} */ (el('button', 'graph-part-control graph-doc-btn graph-doc-replace', t('parts.docReplace')));
    replace.type = 'button';
    const remove = /** @type {HTMLButtonElement} */ (el('button', 'graph-part-control graph-doc-btn graph-doc-remove', t('parts.docRemove')));
    remove.type = 'button';
    actions.append(replace, remove);
    head.append(glyph, who, actions);
    const takes = renderTakes({ app, partId: part.id, kind: 'pdf', doc });
    const note = el('p', 'graph-doc-note');
    note.setAttribute('role', 'status');
    const cutLine = el('p', 'graph-doc-cut');
    const text = el('div', 'graph-doc-text');
    host.classList.add('graph-doc');
    host.replaceChildren(empty, head, takes.el, note, cutLine, text);

    /** The record, read once per (file, value): after a run the cache on it has changed.
     * @param {any} s @param {any} value */
    function loadRecord(s, value) {
      const fileId = String(s.fileId || '');
      if (fileId === recFor && value === recValue) return;
      recFor = fileId;
      recValue = value;
      rec = undefined;
      const media = app && app.media;
      if (!fileId || !media || typeof media.get !== 'function') return;
      Promise.resolve(media.get(fileId)).then((r) => {
        if (destroyed || recFor !== fileId || recValue !== value) return;
        rec = r || null;
        paint(latest);
      }, () => { /* a store that cannot answer is not a missing file */ });
    }

    /** How long this box's bytes still wait after a read we gave up on (0 = none), and a repaint
     * booked for the moment it ends. @param {any} s @returns {number} */
    function coolLeftOf(s) {
      const left = s && s.sha256 ? coolingLeft(String(s.sha256), nowOf(app)) : 0;
      if (left > 0 && !coolTimer) {
        coolTimer = setTimeout(() => { coolTimer = null; paint(latest); }, Math.min(left + 50, 2147483647));
      }
      return left;
    }

    /** @param {any} p */
    function paint(p) {
      if (destroyed) return;
      latest = p || latest;
      const s = (latest && latest.settings) || {};
      const has = !!s.fileId;
      const value = /** @type {any} */ (latest && latest.value);
      const stale = !!hidden && value === hidden.value && s.fileId !== hidden.fileId;
      const own = isValue(value) && value.kind === 'text' && !stale && has ? value : null;
      loadRecord(s, own);

      empty.hidden = has;
      head.hidden = !has;
      name.textContent = has ? String(s.name || '') : '';
      const pages = rec && Array.isArray(rec.pages) && rec.extractEngine === 'farm-ocr' ? rec.pages.length : 0;
      meta.textContent = !has ? ''
        : pages > 1 ? t('parts.docMetaPages', { mb: mbOf(s.size), pages })
          : pages === 1 ? t('parts.docMetaPage', { mb: mbOf(s.size) })
            : t('parts.docMeta', { mb: mbOf(s.size) });
      takes.refresh();

      // One status line, most urgent first: the farm is reading it, we are keeping it, a refusal,
      // the file is gone, and — before the first run — the promise that nothing was sent yet.
      const reading = readingOf(latest && latest.id);
      /** @type {[string, string]} */ let line = ['', ''];
      if (reading === 'reading') line = ['reading', t('parts.docReading', { name: String(s.name || '') })];
      else if (reading === 'waiting') line = ['reading', t('parts.docWaiting')];
      else if (keeping) line = ['working', t('parts.docKeeping', { name: keeping })];
      else if (problem) line = ['error', problem];
      // The wait after a read we gave up on — unless a run already failed on it, whose sentence the
      // canvas's error strip says (not twice on one box).
      else if (has && latest.state !== 'error' && coolLeftOf(s) > 0) line = ['info', t('parts.docCoolingNote', { min: minutesOf(coolLeftOf(s)) })];
      else if (has && rec === null) line = ['error', t('parts.mediaMissing')];
      // A failed run's sentence is the canvas's (the box's error strip); this line does not
      // talk over it.
      else if (has && !own && latest.state !== 'error') line = ['info', t('parts.docKept')];
      note.textContent = line[1];
      note.setAttribute('data-state', line[0]);
      note.hidden = !line[1];

      // The text, drawn only when the value changed: 200 000 characters are not re-parsed on
      // every document change.
      if (own !== rendered) {
        rendered = own;
        if (!own) text.replaceChildren();
        else {
          const whole = String(own.data || '');
          const cut = whole.length > DOC_RENDER_CHARS;
          const node = renderBlocks(parseBlocks(cut ? whole.slice(0, DOC_RENDER_CHARS) : whole), domFactory(doc));
          if (!cut) text.replaceChildren(node);
          else text.replaceChildren(node, el('p', 'graph-doc-more', t('parts.docMoreHere', { chars: DOC_RENDER_CHARS.toLocaleString('en-US') })));
        }
      }
      text.hidden = !own;
      // "First 60 of 120 pages", from the SAME function that cut the value.
      const info = own && rec && Array.isArray(rec.pages) ? docText(rec.pages) : null;
      cutLine.textContent = info && info.cut ? info.note : '';
      cutLine.hidden = !cutLine.textContent;
    }

    /** The one place a file becomes this box's. @param {any} file */
    async function take(file) {
      if (destroyed || !file) return;
      const fileName = String(file.name || 'file');
      if (!isPdfFile(file)) {
        problem = t('parts.docNotAPdf', { name: fileName, type: String(file.type || '?') });
        paint(latest);
        return;
      }
      // A farm that is here and reads no documents: refuse NOW, with its sentence, and keep
      // nothing (KF-5). No farm at all keeps the file; it is read on a run with one that can.
      const view = farmViewOf(app);
      // The why is the "takes:" line just above (K6 landing: saying it twice stacked the same
      // four lines in white and in red); this names the file and what happened to it.
      if (view.present && !view.ocr) { problem = t('parts.docRefusedNoOcr', { name: fileName }); paint(latest); return; }
      const media = app && app.media;
      if (!media || typeof media.put !== 'function') { problem = t('parts.mediaNoStore', { name: fileName }); paint(latest); return; }
      problem = '';
      keeping = fileName;
      paint(latest);
      /** @type {any} */ let ref = null;
      try {
        ref = await media.put(file, { maxBytes: DOC_MAX_BYTES, kind: 'pdf', check: (/** @type {ArrayBuffer} */ buf) => pagesRefusal(buf, fileName) });
      } catch { ref = null; }
      keeping = '';
      if (destroyed) return;
      if (!ref || ref.error) { problem = String((ref && ref.error) || t('parts.mediaUnreadable', { name: fileName })); paint(latest); return; }
      const before = (latest && latest.settings) || {};
      if (before.fileId !== ref.fileId) hidden = { value: (latest && latest.value) || null, fileId: String(before.fileId || '') };
      ctx.update(adopt(ref));
      ctx.commit(t('parts.docLabel'));
      paint(ctx.part || latest);
    }

    function choose() {
      if (typeof doc.createElement !== 'function') return;
      const input = /** @type {HTMLInputElement} */ (doc.createElement('input'));
      input.type = 'file';
      input.accept = 'application/pdf,.pdf';
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (f) void take(f);
      });
      input.click();
    }

    /** The first PDF a gesture carries, else the first file (so the refusal names it).
     * @param {any} dt @returns {any} */
    function fileOf(dt) {
      const files = dt && dt.files ? Array.from(/** @type {ArrayLike<any>} */ (dt.files)) : [];
      return files.find(isPdfFile) || files[0] || null;
    }

    /** @param {any} ev */
    const carriesFiles = (ev) => {
      const types = ev && ev.dataTransfer && ev.dataTransfer.types ? Array.from(ev.dataTransfer.types) : [];
      return types.indexOf('Files') >= 0;
    };

    /** @param {any} ev */
    function onDragOver(ev) {
      if (!carriesFiles(ev)) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      host.classList.add('is-over');
    }
    function onDragLeave() { host.classList.remove('is-over'); }

    /** @param {any} ev */
    function onDrop(ev) {
      host.classList.remove('is-over');
      if (!carriesFiles(ev)) return;
      ev.preventDefault();
      // A file dropped ON this box is this box's (KF-7): the canvas router must not also see it.
      ev.stopPropagation();
      const file = fileOf(ev.dataTransfer);
      // A box holds ONE file: the others are not dropped silently (build rule 6), they are named.
      const count = ev.dataTransfer && ev.dataTransfer.files ? Number(ev.dataTransfer.files.length) || 0 : 0;
      if (file && count > 1) sayOnlyOne(app, String(file.name || ''), count - 1);
      void take(file);
    }

    /** A PDF pasted while this box (or something in it) has focus. @param {any} ev */
    function onPaste(ev) {
      if (!ev || ev.defaultPrevented || !ev.clipboardData) return;
      const box = typeof host.closest === 'function' ? host.closest('.graph-part') : null;
      if (!box || !ev.target || !box.contains(ev.target)) return;
      const file = fileOf(ev.clipboardData);
      if (!file || !isPdfFile(file)) return;     // not ours: text and pictures go where they went
      ev.preventDefault();
      void take(file);
    }

    /** The text scrolls under the wheel instead of panning the canvas — while it can scroll.
     * @param {any} ev */
    function onWheel(ev) {
      if (ev.ctrlKey || ev.metaKey) return;
      if (text.scrollHeight > text.clientHeight) ev.stopPropagation();
    }

    /** @param {string} partId */
    const onStatus = (partId) => { if (latest && (partId === '*' || partId === latest.id)) paint(latest); };

    empty.addEventListener('click', choose);
    replace.addEventListener('click', choose);
    remove.addEventListener('click', () => {
      problem = '';
      hidden = { value: (latest && latest.value) || null, fileId: String(((latest && latest.settings) || {}).fileId || '') };
      ctx.update({ ...EMPTY });
      ctx.commit(t('parts.docRemove'));
      paint(ctx.part || latest);
    });
    host.addEventListener('dragover', onDragOver);
    host.addEventListener('dragleave', onDragLeave);
    host.addEventListener('drop', onDrop);
    text.addEventListener('wheel', onWheel);
    if (typeof doc.addEventListener === 'function') doc.addEventListener('paste', onPaste);
    READER.subs.add(onStatus);

    paint(part);
    return {
      update(next) { paint(next); },
      destroy() {
        destroyed = true;
        if (coolTimer) { clearTimeout(coolTimer); coolTimer = null; }
        READER.subs.delete(onStatus);
        if (typeof doc.removeEventListener === 'function') doc.removeEventListener('paste', onPaste);
        host.removeEventListener('dragover', onDragOver);
        host.removeEventListener('dragleave', onDragLeave);
        host.removeEventListener('drop', onDrop);
        text.removeEventListener('wheel', onWheel);
        takes.destroy();
        host.classList.remove('graph-doc', 'is-over');
        host.replaceChildren();
      },
    };
  },

  async run(input) {
    const s = (input.part && input.part.settings) || {};
    if (!s.fileId) throw partFail(t('parts.docEmpty'), 'empty');
    const pages = await readDoc({ app: input.app, ref: s, signal: input.signal, partId: input.part.id });
    return valueOf('text', docText(pages).md, { format: 'markdown' });
  },
});
