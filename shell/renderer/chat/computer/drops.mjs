// @ts-check
// The canvas drop router (K6-U3, addendum KF-7). Loader `feature`, key `drops`, installed AFTER
// `media` and `intake`.
//
// graph/canvas.mjs hands EVERY file dropped on empty canvas here (a drop on a box goes to that
// box's own handler, which stops it). Each file becomes the right box for its kind at the drop
// point, in ONE undo entry per box, or is refused with a visible sentence — never dropped silently:
//   graph (.lolgraph.json, or a .json whose text says "lolgraph") → `importGraph(file)`, today's path
//   image → an Image box (app.intake reads it: one cap, one downscale, one EXIF strip)
//   pdf   → a Document box (app.media keeps the bytes) — refused when the farm offers no extractor
//   audio → a Sound box (the Sound box's own intake: decoded once, measured, kept by app.media)
//   text  → a Text box holding the contents
//   none  → refused: "The Computer cannot use …"
// The box type comes from the catalogue (`holderOf(kind)`), the settings from the holder's own
// `adopt(payload)` — this module never names a part type.
//
// Nothing is SENT anywhere on a drop: a PDF is read by the farm only when a run needs its text
// (graph/parts/document.mjs), and a sound is never sent at all this phase (graph/takes.mjs).
//
// install(app) sets `app.drops` (API_KEYS.drops):
//   route(files, {at, importGraph}) -> Promise<{placed: string[], refused: {name, reason}[]}>
//   hint()                          -> string   the canvas's drop-overlay text
//   debug()                         -> {routed, placed, refused, last}

import { t } from '../core/i18n.mjs';
import {
  classify, looksLikeGraph, looksLikeText, describeType, slotsFor, fitSlots, TEXT_MAX_BYTES, MAX_DROP_FILES,
} from '../graph/drop-route.mjs';
import { holderOf, specMap } from '../graph/parts/index.mjs';
import { takesFor, farmViewOf } from '../graph/takes.mjs';
import { DOC_MAX_BYTES, pagesRefusal } from '../graph/parts/document.mjs';
import { takeSound } from '../graph/parts/audio.mjs';
import '../strings/drops.en.mjs';
import '../strings/computer.en.mjs';

/** How many refusal sentences one drop shows one by one; past it, one line counts the rest. */
export const SAY_AT_MOST = 3;

/** @param {number} bytes @returns {string} */
const kb = (bytes) => String(Math.ceil((Number(bytes) || 0) / 1024));

/** The first `n` bytes of a file as text — enough to tell a graph from a table. @param {any} file */
async function headText(file, n = 4096) {
  if (file && typeof file.slice === 'function') {
    const part = file.slice(0, n);
    if (part && typeof part.text === 'function') return String(await part.text());
  }
  return String(file && typeof file.text === 'function' ? await file.text() : '').slice(0, n);
}

/**
 * The world rectangle the person can see on the canvas right now, with the canvas's own 16 px
 * placement margin — or null when the canvas cannot say (no element, not laid out).
 * @param {any} c the canvas API (graph/canvas.mjs)
 * @returns {{x: number, y: number, w: number, h: number, margin: number}|null}
 */
function visibleWorld(c) {
  try {
    const el = c && c.canvas;
    const v = c && typeof c.view === 'function' ? c.view() : null;
    const w = Number(el && el.clientWidth) || 0;
    const h = Number(el && el.clientHeight) || 0;
    if (!v || !w || !h) return null;
    const z = Number(v.zoom) || 1;
    return { x: -Number(v.x) / z, y: -Number(v.y) / z, w: w / z, h: h / z, margin: 16 / z };
  } catch { return null; }
}

/** @param {any} app */
export function install(app) {
  let routed = 0;
  let placedTotal = 0;
  let refusedTotal = 0;
  /** @type {any} */ let last = null;
  /** Drops are handled one at a time, in order, so two quick drops never interleave their boxes. */
  /** @type {Promise<any>} */ let queue = Promise.resolve();

  const hostOf = () => (app && app.host) || null;
  const canvasOf = () => { const h = hostOf(); return (h && h.canvas) || null; };
  const sessionOf = () => {
    const h = hostOf();
    const s = h && h.session;
    return s && typeof s.doc === 'function' ? s : null;
  };
  const hasDoc = () => {
    const s = sessionOf();
    return !!(s && typeof s.docId === 'function' && s.docId());
  };
  /** The open graph's id, or '' — asked again before anything is placed (critic R1 B17). */
  const docIdNow = () => {
    const s = sessionOf();
    try { return s && typeof s.docId === 'function' ? String(s.docId() || '') : ''; } catch { return ''; }
  };
  const specsOf = () => {
    const s = sessionOf();
    return (s && s.specs instanceof Map) ? s.specs : specMap();
  };

  /** A sentence the reader SEES (a toast) and HEARS (the canvas's live region). @param {string} message */
  function say(message) {
    if (!message) return;
    const c = canvasOf();
    try { if (c && typeof c.announce === 'function') c.announce(message); } catch (err) { console.warn('[lolcomputer] the drop router could not announce', err); }
    try {
      if (app && app.dialogs && typeof app.dialogs.toast === 'function') app.dialogs.toast(message, { kind: 'error' });
    } catch (err) { console.warn('[lolcomputer] the drop router could not say so', err); }
  }

  /**
   * What one file becomes: the payload its holder adopts, or the sentence that refuses it.
   * @param {{file: any, kind: string, name: string, text?: string|null}} it
   * @returns {Promise<{payload: any}|{error: string}>}
   */
  async function payloadFor(it) {
    const { file, kind, name } = it;
    if (kind === 'image') {
      const intake = app && app.intake;
      if (!intake || typeof intake.fromFile !== 'function') return { error: t('drops.cannotKeep', { name }) };
      const out = await intake.fromFile(file);
      if (!out) return { error: t('drops.unreadable', { name }) };
      if (out.error) return { error: String(out.error) };
      return { payload: out };
    }
    if (kind === 'pdf') {
      // The farm decides a PDF (KF-3): connected and offering no extractor → refused, and nothing
      // is kept or sent. With no farm at all it is kept, and read on the first run with one that can.
      const v = takesFor({ parts: [], wires: [] }, '', 'pdf', farmViewOf(app), specsOf());
      if (v.state === 'no') return { error: String(v.reason || '') };
      const media = app && app.media;
      if (!media || typeof media.put !== 'function') return { error: t('drops.cannotKeep', { name }) };
      // The Document box's own intake check rides along: a PDF that says it has more pages than a
      // box passes on is refused here too, before anything is kept (K6 fix round).
      const ref = await media.put(file, { maxBytes: DOC_MAX_BYTES, kind: 'pdf', check: (/** @type {ArrayBuffer} */ buf) => pagesRefusal(buf, name) });
      if (!ref || ref.error) return { error: String((ref && ref.error) || t('drops.unreadable', { name })) };
      return { payload: ref };
    }
    if (kind === 'audio') {
      const out = await takeSound(app, file);
      if ('error' in out) return { error: out.error };
      return { payload: out };
    }
    // text
    const size = Number(file && file.size) || 0;
    if (size > TEXT_MAX_BYTES) return { error: t('drops.textTooBig', { name, kb: kb(size), capKb: kb(TEXT_MAX_BYTES) }) };
    let text = it.text;
    if (text == null) {
      try { text = String(await file.text()); } catch { return { error: t('drops.unreadable', { name }) }; }
    }
    if (!looksLikeText(text)) return { error: t('drops.notText', { name }) };
    return { payload: { text, name } };
  }

  /**
   * @param {any[]} files
   * @param {{at?: {x: number, y: number}|null, importGraph?: (file: any) => any}} o
   */
  async function routeNow(files, o) {
    routed++;
    const all = (Array.isArray(files) ? files : []).filter(Boolean);
    const list = all.slice(0, MAX_DROP_FILES);
    const at = o && o.at && Number.isFinite(o.at.x) && Number.isFinite(o.at.y) ? { x: o.at.x, y: o.at.y } : null;
    const importGraph = o && typeof o.importGraph === 'function' ? o.importGraph : null;
    /** @type {string[]} */ const placed = [];
    /** @type {{name: string, reason: string}[]} */ const refused = [];
    const refuse = (/** @type {string} */ name, /** @type {string} */ reason) => { refused.push({ name, reason }); };
    if (all.length > list.length) refuse('', t('drops.tooMany', { n: all.length, max: MAX_DROP_FILES }));

    // 1. What is each file? Names and types decide; a .json is peeked at, because a graph file and
    //    a table of numbers share the extension.
    /** @type {{file: any, kind: string, name: string, text: string|null}[]} */ const items = [];
    for (const file of list) {
      const c = classify(file);
      const name = String((file && file.name) || '');
      /** @type {string} */ let kind = c.kind;
      /** @type {string|null} */ let text = null;
      if (kind === 'text' && c.maybeGraph) {
        try {
          const small = (Number(file.size) || 0) <= TEXT_MAX_BYTES;
          const peek = small ? String(await file.text()) : await headText(file);
          if (looksLikeGraph(peek)) kind = 'graph';
          else if (small) text = peek;
        } catch { refuse(name, t('drops.unreadable', { name })); continue; }
      }
      items.push({ file, kind, name, text });
    }

    // 2. A graph file opens first — it REPLACES the document (after the importer's own confirm) —
    //    so everything else in the same drop lands in the graph that is open afterwards.
    const graphs = items.filter((i) => i.kind === 'graph');
    if (graphs.length) {
      const g = graphs[0];
      if (!importGraph) refuse(g.name, t('drops.noGraphDoor', { name: g.name }));
      else await importGraph(g.file);
      for (const extra of graphs.slice(1)) refuse(extra.name, t('drops.oneGraph', { name: extra.name }));
    }

    // 3. Every other file: the box that holds its kind, with what that box adopts. The graph they
    //    are FOR is the one open now (after any graph file above opened): reading a big PDF or a
    //    long sound takes a while, and a person who switches graphs meanwhile must not find the
    //    boxes in the graph they switched to (critic R1 B17).
    const docAt = docIdNow();
    const specs = specsOf();
    /** @type {{type: string, settings: any, size: any, name: string, fileId: string}[]} */ const boxes = [];
    for (const it of items) {
      if (it.kind === 'graph') continue;
      if (it.kind === 'none') {
        refuse(it.name, t('drops.refusedKind', { name: it.name, type: describeType(it.file) || t('drops.typeUnknown') }));
        continue;
      }
      if (!hasDoc()) { refuse(it.name, t('drops.refusedNoDoc', { name: it.name })); continue; }
      const type = holderOf(/** @type {any} */ (it.kind));
      const spec = type ? specs.get(type) : null;
      if (!type || !spec || typeof spec.adopt !== 'function') {
        refuse(it.name, t('drops.refusedKind', { name: it.name, type: describeType(it.file) || t('drops.typeUnknown') }));
        continue;
      }
      /** @type {any} */ let out;
      try { out = await payloadFor(it); } catch (err) {
        console.warn('[lolcomputer] a dropped file could not be taken', err);
        out = { error: t('drops.unreadable', { name: it.name }) };
      }
      if (out.error) { refuse(it.name, out.error); continue; }
      const kept = out.payload && typeof out.payload.fileId === 'string' ? out.payload.fileId : '';
      boxes.push({ type, settings: spec.adopt(out.payload), size: spec.size || { w: 220, h: 120 }, name: it.name, fileId: kept });
    }

    // 4. Place them side by side from the drop point: ONE undo entry per box (placeEntry applies
    //    once each), so undo takes back the last box and not the whole drop.
    const canvas = canvasOf();
    /** Files kept for a box that never got placed: nothing will ever refer to them. */
    /** @type {string[]} */ const orphans = [];
    if (boxes.length && docIdNow() !== docAt) {
      for (const b of boxes) { refuse(b.name, t('computer.dropSwitched', { name: b.name })); if (b.fileId) orphans.push(b.fileId); }
    } else if (boxes.length && (!canvas || typeof canvas.placeEntry !== 'function' || !hasDoc())) {
      for (const b of boxes) { refuse(b.name, t('drops.notPlaced', { name: b.name })); if (b.fileId) orphans.push(b.fileId); }
    } else if (boxes.length) {
      const sizes = boxes.map((b) => b.size);
      const bounds = visibleWorld(canvas);
      /** @type {{x: number, y: number}|null} */ let origin = at;
      // No drop point but a known view: the group starts where the first box would be centred.
      if (!origin && bounds) {
        origin = { x: bounds.x + bounds.w / 2 - (Number(sizes[0].w) || 220) / 2, y: bounds.y + bounds.h / 2 - (Number(sizes[0].h) || 120) / 2 };
      }
      /** @type {({x: number, y: number}|null)[]} */ let slots = origin ? fitSlots(origin, sizes, bounds) : [];
      boxes.forEach((b, i) => {
        const id = canvas.placeEntry({ type: b.type, settings: b.settings }, slots[i] || null);
        if (!id) { refuse(b.name, t('drops.notPlaced', { name: b.name })); if (b.fileId) orphans.push(b.fileId); return; }
        placed.push(String(id));
        // No drop point (a caller that gave none): the first box was centred; the rest follow it.
        if (!origin) {
          const s = sessionOf();
          const p = s ? (s.doc().parts || []).find((/** @type {any} */ x) => x && x.id === id) : null;
          if (p) {
            origin = { x: Number(p.x) || 0, y: Number(p.y) || 0 };
            slots = slotsFor(origin, sizes);
          }
        }
      });
    }

    // 4b. The bytes of a box that was not placed are deleted again at once (K6 fix round) — unless
    //     something else refers to the same bytes (the store keeps one copy per content hash).
    if (orphans.length && app && app.media && typeof app.media.sweep === 'function') {
      try { await app.media.sweep({ only: orphans }); } catch (err) { console.warn('[lolcomputer] releasing an unplaced file failed', err); }
    }

    // 5. Every refusal is SAID — a toast and the live region — never a silent no-op.
    refused.slice(0, SAY_AT_MOST).forEach((r) => say(r.reason));
    if (refused.length > SAY_AT_MOST) say(t('drops.refusedMore', { n: refused.length - SAY_AT_MOST }));

    placedTotal += placed.length;
    refusedTotal += refused.length;
    last = {
      files: all.map((f) => String((f && f.name) || '')),
      at,
      placed: placed.slice(),
      refused: refused.map((r) => ({ ...r })),
    };
    return { placed, refused };
  }

  /**
   * @param {any[]} files
   * @param {{at?: {x: number, y: number}|null, importGraph?: (file: any) => any}} o
   */
  function route(files, o) {
    const run = queue.then(() => routeNow(files, o));
    queue = run.catch(() => undefined);
    return run;
  }

  app.drops = {
    route,
    hint: () => t('drops.hint'),
    debug: () => ({ routed, placed: placedTotal, refused: refusedTotal, last }),
  };
  return app.drops;
}
