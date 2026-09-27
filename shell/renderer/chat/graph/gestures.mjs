// @ts-check
// The canvas's input maths (critic R1, Package B: A3, A4, A5, A7). PURE.
//
// Everything a pointer, a wheel or a trackpad asks the canvas to DECIDE lives here, so it can be
// pinned in Node: which way a wheel event goes (scroll the box under it, pan, or zoom, and by how
// much), how far a resize handle drag really resizes, what dropping a picked-up wire end means,
// and whether Ctrl+C copies parts or leaves the page's text selection alone. graph/canvas.mjs only
// reads the DOM to fill in the arguments and writes the answer back.
//
// Why a module of its own and not canvas.mjs's pure half: canvas.mjs renders, and chat-lint rule 4
// can only hold a module that never touches the DOM to that promise.

import { addWire, removeWire } from './model.mjs';

/** The grid parts land on (mirrors canvas.mjs's GRID; kept here so this module stays leaf-pure). */
export const GESTURE_GRID = 10;
/** The smallest box graph/model.mjs `resizePart` keeps. The handle stops where the model does. */
export const MIN_BOX = Object.freeze({ w: 80, h: 60 });
/** A wheel in LINE mode (deltaMode 1, most mice on Windows/Linux) moves this many px per line. */
export const LINE_PX = 16;
/** A PAGE (deltaMode 2) is taken as this many px when the caller does not say. */
export const PAGE_PX = 800;
/**
 * Zoom rate. Chromium turns a trackpad pinch into ctrl+wheel with `deltaY = -100 · ln(scale)`, so
 * `exp(-deltaY / 100)` IS the pinch: the canvas follows the fingers one to one. The old divisor
 * (400) made a pinch four times slower than the hand, which is the "sluggish" the owner felt.
 */
export const ZOOM_RATE = 100;
/**
 * One wheel event zooms at most this much (in delta units). A pinch never gets near it (its
 * per-event deltas are single digits); a mouse notch (100-120) is tamed to ×1.28 per click instead
 * of ×2.7, and a burst of notches cannot jump from 25 % to 400 % in one frame.
 */
export const ZOOM_CLAMP = 25;
/** Wheel events closer together than this belong to ONE gesture, which keeps the target it chose. */
export const WHEEL_LATCH_MS = 120;
/** The + / − buttons and Ctrl+= / Ctrl+− step through these. */
export const ZOOM_STEPS = Object.freeze([0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]);

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fin = (/** @type {any} */ v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * A wheel delta in CSS pixels, whatever mode the device reported it in.
 * @param {number} d @param {number} [mode] 0 px, 1 lines, 2 pages @param {number} [pagePx]
 */
export function wheelPx(d, mode, pagePx = PAGE_PX) {
  const k = mode === 1 ? LINE_PX : mode === 2 ? (Number(pagePx) > 0 ? Number(pagePx) : PAGE_PX) : 1;
  return fin(d) * k;
}

/**
 * What ONE wheel event means (A4, K-1).
 *
 *   zoom          ctrl/meta is down — a pinch on a trackpad, or ctrl+wheel on a mouse
 *   scroll-inner  the pointer is over something inside a box that can still scroll that way (a
 *                 long answer, a document's text, a code editor): the browser scrolls it and the
 *                 canvas stays where it is
 *   pan           everything else, by the delta in px
 *
 * `inner` says which ways the scrollable thing under the pointer can still move (null = nothing
 * scrollable there). `latched` is the kind the PREVIOUS event of the same gesture chose: a gesture
 * keeps its target, so a two-finger pan that slides over a box keeps panning, and a scroll inside
 * a box that reaches its end does not lurch the whole canvas (Chromium latches a scroll the same way).
 *
 * @param {{deltaX?: number, deltaY?: number, deltaMode?: number, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean}} ev
 * @param {{up?: boolean, down?: boolean, left?: boolean, right?: boolean}|null} [inner]
 * @param {{latched?: 'pan'|'scroll-inner'|null, pagePx?: number}} [o]
 * @returns {{kind: 'zoom', factor: number}|{kind: 'scroll-inner'}|{kind: 'pan', dx: number, dy: number}}
 */
export function wheelIntent(ev, inner, o = {}) {
  const e = ev || {};
  let dx = wheelPx(fin(e.deltaX), e.deltaMode, o.pagePx);
  let dy = wheelPx(fin(e.deltaY), e.deltaMode, o.pagePx);
  if (e.ctrlKey || e.metaKey) {
    const d = clamp(dy, -ZOOM_CLAMP, ZOOM_CLAMP);
    return { kind: 'zoom', factor: Math.exp(-d / ZOOM_RATE) };
  }
  // A mouse's Shift+wheel means sideways. Chromium already swaps it on some platforms; when it did
  // not, the vertical delta is the horizontal one.
  if (e.shiftKey && !dx && dy) { dx = dy; dy = 0; }
  if (o.latched === 'pan') return { kind: 'pan', dx, dy };
  if (o.latched === 'scroll-inner' && inner) return { kind: 'scroll-inner' };
  if (inner) {
    const vertical = Math.abs(dy) >= Math.abs(dx);
    const can = vertical
      ? (dy > 0 ? !!inner.down : dy < 0 ? !!inner.up : false)
      : (dx > 0 ? !!inner.right : dx < 0 ? !!inner.left : false);
    if (can) return { kind: 'scroll-inner' };
  }
  return { kind: 'pan', dx, dy };
}

/**
 * Which ways one scrollable box can still move. `el` is anything with the four scroll numbers
 * (an Element, or a plain object in a test). @param {any} el @param {{x?: boolean, y?: boolean}} [axes]
 * @returns {{up: boolean, down: boolean, left: boolean, right: boolean}}
 */
export function scrollRoom(el, axes = { x: true, y: true }) {
  const out = { up: false, down: false, left: false, right: false };
  if (!el) return out;
  const top = fin(el.scrollTop);
  const left = fin(el.scrollLeft);
  if (axes.y !== false && fin(el.scrollHeight) > fin(el.clientHeight) + 1) {
    out.up = top > 0.5;
    out.down = top + fin(el.clientHeight) < fin(el.scrollHeight) - 1;
  }
  if (axes.x !== false && fin(el.scrollWidth) > fin(el.clientWidth) + 1) {
    out.left = left > 0.5;
    out.right = left + fin(el.clientWidth) < fin(el.scrollWidth) - 1;
  }
  return out;
}

/** The next zoom step in one direction, from wherever the zoom is now. @param {number} z @param {1|-1} dir */
export function zoomStep(z, dir) {
  const cur = fin(z) || 1;
  if (dir > 0) {
    for (const s of ZOOM_STEPS) if (s > cur + 1e-6) return s;
    return ZOOM_STEPS[ZOOM_STEPS.length - 1];
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < cur - 1e-6) return ZOOM_STEPS[i];
  return ZOOM_STEPS[0];
}

/**
 * A resize handle dragged by (dx, dy) SCREEN px at `zoom` (A3). Snapped to the grid, never smaller
 * than the model allows, so the box drawn under the pointer and the box stored on pointerup agree.
 * @param {{w: number, h: number}} start @param {number} dx @param {number} dy @param {number} zoom
 * @param {{w: number, h: number}} [min] @param {number} [grid]
 * @returns {{w: number, h: number}}
 */
export function resizeRect(start, dx, dy, zoom, min = MIN_BOX, grid = GESTURE_GRID) {
  const z = fin(zoom) > 0 ? fin(zoom) : 1;
  const g = fin(grid) > 0 ? fin(grid) : 1;
  const w = Math.round((fin(start && start.w) + fin(dx) / z) / g) * g;
  const h = Math.round((fin(start && start.h) + fin(dy) / z) / g) * g;
  return { w: Math.max(fin(min && min.w) || MIN_BOX.w, w), h: Math.max(fin(min && min.h) || MIN_BOX.h, h) };
}

/**
 * What dropping a picked-up wire end means (A5). `target` is the input port it was dropped on
 * (`null` = empty canvas). Never throws; the document is only ever a NEW one when something changed.
 *
 *   unplug    dropped on nothing: the wire is gone (one undo brings it back)
 *   replug    dropped on another input: the wire leaves its old port and arrives at the new one,
 *             keeping its source and its NAME — one document, so one undo entry
 *   same      dropped back where it was: nothing changed
 *   refused   the new port does not take it (type, cycle, duplicate…): the wire STAYS where it
 *             was, and `reason` is addWire's code so the canvas can say why
 *   missing   the wire is not in the document (a stale gesture)
 *
 * @param {any} doc @param {string} wireId @param {{partId: string, port: string}|null} target
 * @param {{specs: Map<string, any>, newId: () => string, now?: () => number}} o
 * @returns {{kind: 'unplug'|'replug'|'same'|'refused'|'missing', doc: any, wire?: any, reason?: string, was?: any}}
 */
export function rewireOutcome(doc, wireId, target, o) {
  const was = doc && Array.isArray(doc.wires) ? doc.wires.find((/** @type {any} */ w) => w.id === wireId) : null;
  if (!was) return { kind: 'missing', doc };
  if (!target || !target.partId) return { kind: 'unplug', doc: removeWire(doc, wireId, { now: o && o.now }), was };
  if (target.partId === was.to && target.port === was.port) return { kind: 'same', doc, was };
  const without = removeWire(doc, wireId, { now: o && o.now });
  const out = addWire(without, { from: was.from, to: target.partId, port: target.port, label: was.label }, o);
  if (!out.ok) return { kind: 'refused', doc, reason: out.reason, was };
  return { kind: 'replug', doc: out.doc, wire: out.wire, was };
}

/**
 * Does Ctrl+C copy the selected PARTS (A7, K-1)? Only when nobody is typing, no text is selected
 * on the page, and there is something selected. A highlighted sentence in a box is the reader's
 * copy, not ours: taking the clipboard from them was the bug.
 * @param {{selectionCollapsed?: boolean, typing?: boolean, selected?: number}} s
 */
export function shouldCopyParts(s) {
  if (!s || s.typing) return false;
  if (s.selectionCollapsed === false) return false;
  return Number(s.selected) > 0;
}
