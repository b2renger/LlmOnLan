// @ts-check
// Image intake (K4-U2) — the ONE place a picture enters the Computer. COMPUTER_PLAN §6.4.
//
// A `feature` in computer/main.mjs's loader table: `install(app)` sets `app.intake`, and the Image
// part and the window paste both go through it. One module, so there is one size cap, one
// downscale, one EXIF strip and one refusal sentence.
//
// THE PIPELINE, and why each step is the step it is:
//   createImageBitmap(file)   decodes off the main thread and is the only decoder we have that
//                             does not need an <img> in the document.
//   OffscreenCanvas(w, h)     the resize. `fitWithin` picks the box; the long side never exceeds
//                             MAX_EDGE, and a small picture is never ENLARGED.
//   fillRect + drawImage      a white matte UNDER the picture: JPEG has no alpha, and a screenshot
//                             with a transparent background would otherwise arrive at the farm as
//                             black on black. The matte is what makes it readable, to the model
//                             and to the reader of the box.
//   convertToBlob(jpeg, q)    re-encoding is also what strips EXIF — the privacy answer as well as
//                             the size one (§6.4): no GPS, no camera serial, no embedded thumbnail.
//   FileReader.readAsDataURL  the bytes as a string a GraphValue can hold and `.lolgraph.json` can
//                             carry. FileReader ONLY: `fetch` is lint rule 11's door and
//                             createObjectURL belongs to ui/transfer.mjs.
// STEPS is a LADDER: a photograph still over the cap at 1536/0.85 is tried smaller before it is
// refused, because "try a smaller image" is a worse answer than trying one.
//
// THE OTHER DOOR IT MAY NOT OPEN: the drop guard in ui/layout.mjs must keep NOT calling
// stopPropagation, or a drop stops reaching a listener here.
//
// THE FROZEN SHAPE (addendum KD-5 — the seam K4-U1/U3/U4 may rely on, and the one the harness
// drives):
//   app.intake.fromFile(file)        -> Promise<{dataUrl, name, w, h} | {error}>
//   app.intake.fromDataTransfer(dt, {limit}) -> Promise<Array<{dataUrl, name, w, h} | {error}>>
//   app.intake.fromDrop(dt)          -> Promise<{dataUrl, name, w, h} | {error} | null>  (the FIRST
//                                       picture only — what a one-picture box should ask for)
//   app.intake.pick()                -> Promise<{dataUrl, name, w, h} | {error} | null>  (a dialog)
//   app.intake.fitWithin(w, h, edge) -> {w, h}   PURE, and the golden numbers are its acceptance
//   app.intake.debug()               -> {reads, refused, lastError}
// A refusal is `{error: <a sentence from strings/parts-image.en.mjs>}`, never a thrown string:
// an intake that throws into a drop handler loses the picture AND the message.

import { t } from '../core/i18n.mjs';
import '../strings/computer.en.mjs';
import { MAX_VALUE_BYTES } from '../graph/serialize.mjs';
import { setSettings } from '../graph/model.mjs';
import '../strings/parts-image.en.mjs';

/** The long side an intake downscales to. Kept in step with graph/parts/image.mjs `MAX_EDGE`. */
export const MAX_EDGE = 1536;

/** The one encoding an intake produces. */
export const JPEG_TYPE = 'image/jpeg';

/** The matte painted under every picture before it is encoded (see the header). A JPEG has no
 * alpha; without this a transparent PNG becomes black. */
export const MATTE = '#ffffff';

/** The ladder: each rung is tried in order and the FIRST one under the cap wins. Only a picture
 * still too big at the last rung is refused. */
export const STEPS = Object.freeze([
  { edge: MAX_EDGE, quality: 0.85 },
  { edge: 1024, quality: 0.75 },
  { edge: 768, quality: 0.6 },
]);

/** A ceiling on the SOURCE, refused BEFORE `createImageBitmap` ever runs. The ladder bounds what
 * we PRODUCE; the decode is the biggest allocation the pipeline makes and nothing bounded it. A
 * 32 MB file is a generous camera raw-export; past it we say the one too-big sentence instead of
 * asking the renderer for the memory. */
export const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

/** The same ceiling for a file whose BYTES are small but whose pixels are not (a 16000x16000 PNG
 * of a scan is a few MB on disk and ~1 GB decoded, at 4 bytes a pixel). Checked after the decode
 * reports its size and before anything is drawn. */
export const MAX_SOURCE_PIXELS = 50e6;

/** How many pictures ONE gesture may read. A folder dropped on a box is a gesture people make by
 * accident; each file costs a full decode and up to `maxBytes` of data URL held at once. The Image
 * part takes the first picture and nothing else (`fromDrop`), so this cap only bounds a caller
 * that really does want several. */
export const MAX_INTAKE_FILES = 8;

/** What a file picker offers and what a drop accepts. GIF is here because people paste them; it
 * arrives as its first frame, which is what a still model sees anyway. */
export const ACCEPTED_TYPES = Object.freeze([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif',
]);

/** Extensions, for a file whose `type` the platform did not fill in (a drop from some shells). */
const EXT_TYPE = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
});

/** PURE: the box a picture is fitted into, preserving aspect, never enlarging. The golden numbers
 * are K4-U2's acceptance, so this lives here from the kickoff and K4-U2 only proves it.
 * @param {number} w @param {number} h @param {number} [edge]
 * @returns {{w: number, h: number}} */
export function fitWithin(w, h, edge = MAX_EDGE) {
  const W = Math.max(0, Math.round(Number(w) || 0));
  const H = Math.max(0, Math.round(Number(h) || 0));
  if (!W || !H) return { w: 0, h: 0 };
  const long = Math.max(W, H);
  if (long <= edge) return { w: W, h: H };
  const k = edge / long;
  return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)) };
}

/** Is this a picture we will decode? @param {string} type @returns {boolean} */
export function isImageType(type) {
  return ACCEPTED_TYPES.indexOf(String(type || '').toLowerCase().split(';')[0].trim()) >= 0;
}

/** A file's type, falling back to its extension when the platform gave none.
 * @param {any} file @returns {string} */
export function typeOf(file) {
  const declared = String((file && file.type) || '').toLowerCase().split(';')[0].trim();
  if (declared) return declared;
  const name = String((file && file.name) || '');
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return /** @type {any} */ (EXT_TYPE)[ext] || '';
}

/** The name a box shows for this file. @param {any} file @returns {string} */
export function nameFor(file) {
  return String((file && file.name) || '') || t('parts.imageUnnamed');
}

/** How many bytes a data URL really costs us: it is stored, exported and counted as the STRING it
 * is, so the string length is the honest number and not `blob.size`.
 * @param {string} url @returns {number} */
export function dataUrlBytes(url) {
  return String(url || '').length;
}

/** Bytes as the megabytes a sentence says. @param {number} bytes @returns {string} */
export function mbOf(bytes) {
  const mb = Math.max(0, Number(bytes) || 0) / (1024 * 1024);
  return mb >= 10 ? String(Math.round(mb)) : mb.toFixed(1);
}

/** Pixels as megapixels, the way a camera says it: one decimal under 10, whole above.
 * @param {number} pixels @returns {string} */
export function mpOf(pixels) {
  const mp = Math.max(0, Number(pixels) || 0) / 1e6;
  return mp >= 10 ? String(Math.round(mp)) : mp.toFixed(1);
}

/** Bytes as the kilobytes the size line says. @param {number} bytes @returns {number} */
export function kbOf(bytes) {
  return Math.max(0, Math.round((Number(bytes) || 0) / 1024));
}

/** The platform pieces, injectable so the whole pipeline is provable in Node (the unit test hands
 * it fakes; the browser hands it nothing and gets the real ones).
 * @param {any} env @returns {any} */
function envOf(env) {
  const e = env || {};
  const g = /** @type {any} */ (globalThis);
  // BOUND, deliberately: `createImageBitmap` is a method of the global object, and calling it
  // through a plain reference is an "Illegal invocation" in Chromium — which would have made
  // every real drop refuse while every faked one passed.
  const decode = e.createImageBitmap || g.createImageBitmap;
  return {
    createImageBitmap: typeof decode === 'function' ? decode.bind(g) : decode,
    OffscreenCanvas: e.OffscreenCanvas || g.OffscreenCanvas,
    FileReader: e.FileReader || g.FileReader,
    maxBytes: Number(e.maxBytes) > 0 ? Number(e.maxBytes) : MAX_VALUE_BYTES,
    steps: Array.isArray(e.steps) && e.steps.length ? e.steps : STEPS,
    matte: e.matte === null ? null : (e.matte || MATTE),
    maxSourceBytes: Number(e.maxSourceBytes) > 0 ? Number(e.maxSourceBytes) : MAX_SOURCE_BYTES,
    maxSourcePixels: Number(e.maxSourcePixels) > 0 ? Number(e.maxSourcePixels) : MAX_SOURCE_PIXELS,
  };
}

/** One rung of the ladder: the bitmap, resized and encoded.
 * @param {any} bitmap @param {{w: number, h: number}} box @param {number} quality @param {any} e
 * @returns {Promise<any>} */
async function encode(bitmap, box, quality, e) {
  const canvas = new e.OffscreenCanvas(box.w, box.h);
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return null;
  if (e.matte && typeof ctx.fillRect === 'function') {
    ctx.fillStyle = e.matte;
    ctx.fillRect(0, 0, box.w, box.h);
  }
  ctx.drawImage(bitmap, 0, 0, box.w, box.h);
  return canvas.convertToBlob({ type: JPEG_TYPE, quality });
}

/** The blob as a data URL. Resolves '' on any reader failure, which the caller turns into the one
 * unreadable sentence. @param {any} blob @param {any} e @returns {Promise<string>} */
function readAsDataUrl(blob, e) {
  return new Promise((resolve) => {
    let reader;
    try { reader = new e.FileReader(); } catch { resolve(''); return; }
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.onabort = () => resolve('');
    try { reader.readAsDataURL(blob); } catch { resolve(''); }
  });
}

/**
 * A File (or a Blob with a name) as the picture a box holds, or one sentence saying why not.
 * NEVER throws: every door into this module hands the result to a drop handler or a click
 * handler, and a throw there loses the picture and the message together.
 * @param {any} file @param {any} [env]
 * @returns {Promise<{dataUrl: string, name: string, w: number, h: number}|{error: string}>}
 */
export async function readImage(file, env) {
  const e = envOf(env);
  if (!file) return { error: t('parts.imageUnreadable') };
  const type = typeOf(file);
  if (!isImageType(type)) {
    return { error: t('parts.imageNotAnImage', { type: type || t('parts.imageTypeUnknown') }) };
  }
  if (!e.createImageBitmap || !e.OffscreenCanvas || !e.FileReader) return { error: t('parts.imageUnreadable') };
  // BEFORE the decode: the decode is the biggest allocation here and the ladder does not bound it.
  const size = Number(file.size) || 0;
  if (size > e.maxSourceBytes) {
    // Critic S1-12: the FILE is too big to open — nothing was resized yet, so say only that.
    return { error: t('parts.imageTooBigFile', { mb: mbOf(size), capMb: mbOf(e.maxSourceBytes) }) };
  }
  let bitmap = null;
  try {
    try { bitmap = await e.createImageBitmap(file); } catch { return { error: t('parts.imageUnreadable') }; }
    const W = Number(bitmap && bitmap.width) || 0;
    const H = Number(bitmap && bitmap.height) || 0;
    if (!W || !H) return { error: t('parts.imageUnreadable') };
    // And after it: a file small on disk can still be enormous decoded. ~4 bytes a pixel is what
    // it cost us to get here, and it is the honest number to refuse on.
    if (W * H > e.maxSourcePixels) {
      // Critic S1-12: too many PIXELS, counted as pixels — not as megabytes "once resized".
      return { error: t('parts.imageTooManyPixels', { mp: mpOf(W * H), capMp: mpOf(e.maxSourcePixels) }) };
    }
    let bytes = 0;
    for (const step of e.steps) {
      const box = fitWithin(W, H, step.edge);
      if (!box.w || !box.h) return { error: t('parts.imageUnreadable') };
      let dataUrl = '';
      try {
        const blob = await encode(bitmap, box, step.quality, e);
        if (blob) dataUrl = await readAsDataUrl(blob, e);
      } catch { dataUrl = ''; }
      if (!dataUrl) return { error: t('parts.imageUnreadable') };
      bytes = dataUrlBytes(dataUrl);
      if (bytes <= e.maxBytes) return { dataUrl, name: nameFor(file), w: box.w, h: box.h };
    }
    return { error: t('parts.imageTooBig', { mb: mbOf(bytes), capMb: mbOf(e.maxBytes) }) };
  } finally {
    try { if (bitmap && typeof bitmap.close === 'function') bitmap.close(); } catch (err) { void err; }
  }
}

/** The picture files a DataTransfer (a drop, or a paste) is carrying, in order and deduplicated.
 * A drag that carries no picture answers `[]`, which is how a graph-file drop stays the canvas's
 * business and not ours. @param {any} dt @returns {any[]} */
export function filesOf(dt) {
  if (!dt) return [];
  /** @type {any[]} */ const out = [];
  const add = (/** @type {any} */ f) => {
    if (!f || out.indexOf(f) >= 0) return;
    if (!isImageType(typeOf(f))) return;
    out.push(f);
  };
  const items = dt.items ? Array.from(dt.items) : [];
  for (const item of /** @type {any[]} */ (items)) {
    if (!item || item.kind !== 'file' || typeof item.getAsFile !== 'function') continue;
    add(item.getAsFile());
  }
  if (!out.length) {
    const files = dt.files ? Array.from(dt.files) : [];
    for (const f of /** @type {any[]} */ (files)) add(f);
  }
  return out;
}

/** Is the reader typing? A picture pasted into a field belongs to the field.
 * @param {any} node @returns {boolean} */
export function isTypingTarget(node) {
  const el = node && node.nodeType === 1 ? node : (node && node.parentElement) || null;
  if (!el) return false;
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return !!(el.isContentEditable || (typeof el.closest === 'function' && el.closest('[contenteditable="true"]')));
}

/** @param {any} app */
export function install(app) {
  let reads = 0;
  let refused = 0;
  /** @type {string|null} */ let lastError = null;

  /** Every answer passes through here, so `debug()` counts what really happened.
   * @param {any} out @returns {any} */
  const record = (out) => {
    if (out && out.error) { refused += 1; lastError = String(out.error); } else if (out) reads += 1;
    return out;
  };

  /** @param {any} file */
  const fromFile = async (file) => record(await readImage(file));

  /** Every picture a gesture carries, up to `MAX_INTAKE_FILES`. A caller that wants ONE picture
   * wants `fromDrop`: this decodes and base64-encodes every file it is given, which is a freeze
   * and hundreds of megabytes if a folder was dropped.
   * @param {any} dt @param {{limit?: number}} [o] */
  const fromDataTransfer = async (dt, o) => {
    const want = Math.max(1, Math.min(MAX_INTAKE_FILES, Number(o && o.limit) || MAX_INTAKE_FILES));
    /** @type {any[]} */ const out = [];
    for (const file of filesOf(dt).slice(0, want)) out.push(await fromFile(file));
    return out;
  };

  /** THE picture a drop carries: the first one, and nothing else is read. A box holds one picture,
   * so reading the other 299 in a dropped folder only spends the memory and the time.
   * @param {any} dt @returns {Promise<{dataUrl: string, name: string, w: number, h: number}|{error: string}|null>} */
  const fromDrop = async (dt) => {
    const file = filesOf(dt)[0];
    return file ? await fromFile(file) : null;
  };

  const pick = () => new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve(null); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED_TYPES.join(',');
    let done = false;
    const finish = (/** @type {any} */ v) => { if (!done) { done = true; resolve(v); } };
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) { finish(null); return; }
      fromFile(file).then(finish, () => finish({ error: t('parts.imageUnreadable') }));
    });
    // Chromium fires `cancel` when the dialog is dismissed; without it a cancelled pick would
    // leave a promise nobody ever settles.
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });

  /** A sentence the reader sees, wherever this build puts them.
   * @param {string} message @param {string} [kind] */
  const say = (message, kind) => {
    try {
      if (app && app.dialogs && typeof app.dialogs.toast === 'function') app.dialogs.toast(message, { kind: kind || 'info' });
    } catch (err) { console.warn('[lolcomputer] the intake could not say so', err); }
  };

  /**
   * A pasted or dropped picture, into the Image box that is selected or into a new one. The write
   * is the part's own `settings`, through `session.apply`, so it is ONE undoable edit — the same
   * door `ctx.update`/`ctx.commit` gives the part itself.
   * @param {any} file @param {{into?: string}} [o]
   * @returns {Promise<string|null>} the id of the box that took it
   */
  async function adoptIntoGraph(file, o) {
    const host = app && app.host;
    const session = host && host.session;
    const canvas = host && host.canvas;
    if (!session || !canvas || typeof session.doc !== 'function') { say(t('parts.imageNoBox'), 'error'); return null; }
    // The graph the picture is FOR is the one open when it was pasted (critic R1 B17): a big
    // picture takes a moment to read, and a switch meanwhile must not put it in the other graph.
    const docIdOf = () => { try { return typeof session.docId === 'function' ? String(session.docId() || '') : ''; } catch { return ''; } };
    const docAt = docIdOf();
    const out = await fromFile(file);
    if (!out || out.error) { say(String((out && out.error) || t('parts.imageUnreadable')), 'error'); return null; }
    if (docIdOf() !== docAt) { say(t('computer.pasteSwitched', { name: String(out.name || '') }), 'error'); return null; }
    const doc = session.doc();
    const wanted = (o && o.into) || '';
    const selected = typeof session.selected === 'function' ? session.selected() : [];
    const target = (doc.parts || []).find((/** @type {any} */ p) => p && p.type === 'image'
      && (wanted ? p.id === wanted : selected.indexOf(p.id) >= 0));
    const id = target ? target.id : canvas.placeCentred('image');
    if (!id) { say(t('parts.imageNoBox'), 'error'); return null; }
    session.apply(
      setSettings(session.doc(), id, { dataUrl: out.dataUrl, name: out.name, w: out.w, h: out.h },
        { specs: session.specs, now: app.now }),
      { label: 'image' },
    );
    say(t('parts.imagePasted', { name: out.name }), 'info');
    return id;
  }

  /** @param {any} ev */
  function onPaste(ev) {
    if (!ev || !ev.clipboardData || isTypingTarget(ev.target)) return;
    const files = filesOf(ev.clipboardData);
    if (!files.length) return;               // not ours: the canvas's own paste still gets it
    ev.preventDefault();
    void adoptIntoGraph(files[0]);
  }

  const surface = typeof document !== 'undefined' ? document.getElementById('lolcomputer') : null;
  if (surface) surface.addEventListener('paste', onPaste);

  app.intake = {
    fromFile,
    fromDataTransfer,
    fromDrop,
    pick,
    fitWithin,
    /** Exposed so the Image part's own drop handler and this paste door make the SAME write. */
    adopt: adoptIntoGraph,
    debug: () => ({ reads, refused, lastError }),
    destroy() { if (surface) surface.removeEventListener('paste', onPaste); },
  };
}
