// @ts-check
// Tidy: a layered left-to-right layout (spec §4, plan §2.6 BJ-17). PURE (lint rule 4) — it takes a
// GraphDoc and returns a NEW one whose parts have new x/y, and touches nothing else.
//
// THREE PROPERTIES THIS FILE IS WRITTEN AROUND, because they are what makes a layout button
// trustworthy rather than frightening:
//
//   1. NEVER AUTOMATIC. Nothing in here runs on its own. The canvas calls `tidy()` from the Tidy
//      button and from nowhere else; a graph is somebody's spatial memory of their own thinking and
//      rearranging it under them is a small theft. (The unit test cannot assert "never automatic" —
//      the canvas scenario does, by building a graph and checking nothing moved.)
//   2. IT MOVES PARTS AND NOTHING ELSE. Same ids, same types, same settings, same values, same
//      wires, same count — only x and y differ. That is asserted field by field, so a later "small
//      improvement" that drops a wire cannot land quietly.
//   3. IT IS STABLE. tidy(tidy(doc)) === tidy(doc), by identity: the second call finds every part
//      already where it wants it, moves nothing, and returns the SAME document object. That is what
//      makes the button safe to press twice, and it is why the within-column ordering below is
//      derived from the ordering of the column to its left rather than from raw y — an order that
//      depended on the y values it is about to overwrite would oscillate.
//
// The layout itself: longest-path layering (a part sits one column right of its right-most input),
// then one barycentre pass per column to pick the row order, then a straight pack down each column.
// Crossing reduction stops there. A prettier layout is a much bigger program and this one already
// reads left to right, which is the whole ask.

import { order } from './topo.mjs';

/** Parts land on the canvas's 10 px grid, so a tidied graph and a hand-dragged one line up. */
export const TIDY_GRID = 10;

/** Gaps between columns and rows, in canvas units. Multiples of the grid. */
export const TIDY = Object.freeze({
  colGap: 80, rowGap: 40, originX: 80, originY: 80, defaultW: 240, defaultH: 160,
});

/** @param {number} v */
const snap = (v) => Math.round(v / TIDY_GRID) * TIDY_GRID;

/** @param {any} p @returns {number} */
const widthOf = (p) => (Number.isFinite(p && p.w) && p.w > 0 ? p.w : TIDY.defaultW);
/** @param {any} p @returns {number} */
const heightOf = (p) => (Number.isFinite(p && p.h) && p.h > 0 ? p.h : TIDY.defaultH);

/** Sort key for a part whose row order nothing else decides: where the reader last left it.
 * @param {any} a @param {any} b */
const byPlace = (a, b) => (a.y - b.y) || (a.x - b.x) || String(a.id).localeCompare(String(b.id));

/**
 * Longest-path layering: a part sits one column right of its right-most input. A part with no
 * inputs is column 0, which puts every Note and every From-thread on the left edge, where the
 * graph reads from.
 *
 * Wires are read in topological order when there is one. A graph with a cycle has no such order —
 * the engine refuses to RUN one, but a reader can hold a half-wired graph that briefly has one, and
 * the Tidy button must not hang or throw on it. So the fallback is document order, which gives
 * every part a column in one pass and terminates whatever the wires say.
 *
 * @param {any} doc @returns {Map<string, number>} partId -> column
 */
export function columns(doc) {
  /** @type {Map<string, number>} */ const col = new Map();
  const parts = (doc && Array.isArray(doc.parts)) ? doc.parts : [];
  const ord = order(doc);
  const ids = ord && ord.ok ? ord.ids : parts.map((/** @type {any} */ p) => p.id);
  /** @type {Map<string, string[]>} */ const feeders = new Map();
  for (const w of (doc && doc.wires) || []) {
    const list = feeders.get(w.to) || [];
    list.push(w.from);
    feeders.set(w.to, list);
  }
  for (const id of ids) {
    let c = 0;
    for (const from of feeders.get(id) || []) {
      const fc = col.get(from);
      if (typeof fc === 'number' && fc + 1 > c) c = fc + 1;
    }
    col.set(id, c);
  }
  // Document order (the cycle fallback) can visit a part before its feeder, which leaves the feeder
  // one column to its RIGHT. One relaxation pass over the wires pushes such a part right again; it
  // is bounded by the part count, so a cycle cannot spin here.
  if (!(ord && ord.ok)) {
    for (let pass = 0; pass < parts.length; pass++) {
      let changed = false;
      for (const w of (doc && doc.wires) || []) {
        const fc = col.get(w.from);
        const tc = col.get(w.to);
        if (typeof fc !== 'number' || typeof tc !== 'number') continue;
        if (fc + 1 > tc && fc + 1 <= parts.length) { col.set(w.to, fc + 1); changed = true; }
      }
      if (!changed) break;
    }
  }
  return col;
}

/**
 * The row order inside each column. Column 0 is ordered by where the parts already are (the
 * reader's own arrangement is the only information there is). Every later column is ordered by the
 * barycentre of its feeders' ROW INDICES in the columns to its left — the classic one-pass crossing
 * reduction — with the reader's arrangement as the tie-break.
 *
 * Row indices, not y values: a part that has just been placed by this very function has a y that is
 * about to change, and ordering on it would make a second press of the button move things again.
 *
 * @param {any} doc @param {Map<string, number>} col
 * @returns {{cols: number[], rows: Map<number, any[]>}}
 */
export function rowOrder(doc, col) {
  /** @type {Map<number, any[]>} */ const byCol = new Map();
  for (const p of (doc && doc.parts) || []) {
    const c = col.get(p.id) || 0;
    const list = byCol.get(c) || [];
    list.push(p);
    byCol.set(c, list);
  }
  /** @type {Map<string, string[]>} */ const feeders = new Map();
  for (const w of (doc && doc.wires) || []) {
    const list = feeders.get(w.to) || [];
    list.push(w.from);
    feeders.set(w.to, list);
  }
  const cols = Array.from(byCol.keys()).sort((a, b) => a - b);
  /** @type {Map<string, number>} */ const rowOf = new Map();
  for (const c of cols) {
    const list = (byCol.get(c) || []).slice();
    if (c === cols[0]) list.sort(byPlace);
    else {
      /** @type {Map<string, number>} */ const bary = new Map();
      for (const p of list) {
        let sum = 0;
        let n = 0;
        for (const from of feeders.get(p.id) || []) {
          const r = rowOf.get(from);
          if (typeof r === 'number') { sum += r; n++; }
        }
        // No placed feeder at all (a part whose only wire comes from its own column, i.e. a cycle):
        // keep it where the reader had it rather than pinning it to row 0.
        bary.set(p.id, n ? sum / n : Number.POSITIVE_INFINITY);
      }
      list.sort((a, b) => {
        // Compared, never subtracted: a part with no placed feeder carries Infinity, and
        // `Infinity - Infinity` is NaN, which sorts nothing.
        const ba = /** @type {number} */ (bary.get(a.id));
        const bb = /** @type {number} */ (bary.get(b.id));
        if (ba !== bb) return ba < bb ? -1 : 1;
        return byPlace(a, b);
      });
    }
    list.forEach((p, i) => rowOf.set(p.id, i));
    byCol.set(c, list);
  }
  return { cols, rows: byCol };
}

/**
 * Where every part would go, and how many would actually move. Exported so the canvas can report
 * "Moved {n} parts" without laying the graph out twice, and so the unit test can read the layout
 * without reading it out of a document.
 * @param {any} doc
 * @returns {{places: Map<string, {x: number, y: number}>, moved: string[], width: number, height: number}}
 */
export function tidyPlan(doc) {
  /** @type {Map<string, {x: number, y: number}>} */ const places = new Map();
  /** @type {string[]} */ const moved = [];
  if (!doc || !Array.isArray(doc.parts) || !doc.parts.length) {
    return { places, moved, width: 0, height: 0 };
  }
  const col = columns(doc);
  const { cols, rows } = rowOrder(doc, col);
  let x = TIDY.originX;
  let bottom = TIDY.originY;
  for (const c of cols) {
    const list = rows.get(c) || [];
    let y = TIDY.originY;
    let widest = TIDY.defaultW;
    for (const p of list) {
      const at = { x: snap(x), y: snap(y) };
      places.set(p.id, at);
      if (at.x !== p.x || at.y !== p.y) moved.push(p.id);
      const w = widthOf(p);
      if (w > widest) widest = w;
      y += heightOf(p) + TIDY.rowGap;
    }
    if (y > bottom) bottom = y;
    x += widest + TIDY.colGap;
  }
  return {
    places,
    moved,
    width: Math.max(0, x - TIDY.colGap - TIDY.originX),
    height: Math.max(0, bottom - TIDY.rowGap - TIDY.originY),
  };
}

/**
 * Lay the graph out. Returns a NEW document, or THE SAME ONE when nothing moved — which is both the
 * stability property and the signal the canvas uses to say "Everything is already in place." rather
 * than pushing an undo entry that would undo nothing.
 *
 * @param {any} doc @param {{now?: () => number}} [o] @returns {any}
 */
export function tidy(doc, o = {}) {
  const plan = tidyPlan(doc);
  if (!plan.moved.length) return doc;
  const move = new Set(plan.moved);
  const parts = doc.parts.map((/** @type {any} */ p) => {
    if (!move.has(p.id)) return p;
    const at = plan.places.get(p.id);
    return at ? { ...p, x: at.x, y: at.y } : p;
  });
  const now = (o.now || Date.now)();
  return { ...doc, parts, updatedAt: now, rev: (doc.rev || 0) + 1 };
}
