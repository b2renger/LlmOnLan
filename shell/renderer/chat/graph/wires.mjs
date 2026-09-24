// @ts-check
// The wire layer: ONE <svg> under the parts, one <path> per wire, redrawn in ONE pass.
//
// Why one SVG and not one element per wire in the DOM layer: pan/zoom is a transform on
// `.graph-layer` and on this svg's single <g> (plan §2.6 BG-8) — two style writes per frame no
// matter how many wires there are. Nothing in here schedules a frame of its own; the canvas owns
// the one rAF and calls `render()` inside it.
//
// Geometry is PURE and exported on its own, because the DOM and the model must agree on where a
// port is to within a pixel (the canvas positions the port element from `portOffsetY`, the wire
// ends at `portPoint`) and because that agreement is unit-testable in Node.

import { t } from '../core/i18n.mjs';
import '../strings/graph.en.mjs';
import '../strings/computer-canvas.en.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Height of `.graph-part-head` — the ports hang below it. Mirrored by `--graph-head-h` in css. */
export const HEAD_H = 28;
/** How far a click may miss a wire and still hit it, in SCREEN px (critic R1, A5): the canvas
 * divides by the zoom, so the band is 8 px wide at 25 % as at 200 %, not 2 px. */
export const WIRE_HIT = 8;
/** How far a dragged wire end may miss a port and still snap to it, in WORLD units. */
export const SNAP_PX = 28;

/** The vertical offset of input `i` of `n` inside a part box of height `h`. Local coordinates.
 * @param {number} h @param {number} i @param {number} n @returns {number} */
export function portOffsetY(h, i, n) {
  const top = HEAD_H;
  const span = Math.max(0, h - top);
  const count = Math.max(1, n);
  return top + (span * (i + 0.5)) / count;
}

/** World point of one port. `dir` 'out' ignores index/count.
 * @param {any} part @param {{dir: 'in'|'out', index?: number, count?: number}} o
 * @returns {{x: number, y: number}} */
export function portPoint(part, o) {
  const w = Number(part.w) || 0;
  const h = Number(part.h) || 0;
  if (o.dir === 'out') return { x: part.x + w, y: part.y + h / 2 };
  return { x: part.x, y: part.y + portOffsetY(h, Number(o.index) || 0, Number(o.count) || 1) };
}

/** Both ends of a wire, from the doc + the specs. @returns {{a: {x, y}, b: {x, y}}|null} */
export function wireEnds(doc, wire, specs) {
  const from = doc.parts.find((/** @type {any} */ p) => p.id === wire.from);
  const to = doc.parts.find((/** @type {any} */ p) => p.id === wire.to);
  if (!from || !to) return null;
  const spec = specs && specs.get ? specs.get(to.type) : null;
  const inputs = (spec && spec.inputs) || [];
  const index = Math.max(0, inputs.findIndex((/** @type {any} */ p) => p.name === wire.port));
  return {
    a: portPoint(from, { dir: 'out' }),
    b: portPoint(to, { dir: 'in', index, count: inputs.length || 1 }),
  };
}

/** A left-to-right cubic. The handle grows with the gap so a long wire does not look like a hinge.
 * @param {{x: number, y: number}} a @param {{x: number, y: number}} b @returns {string} */
export function wirePath(a, b) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  const r = (/** @type {number} */ n) => Math.round(n * 100) / 100;
  return `M ${r(a.x)} ${r(a.y)} C ${r(a.x + dx)} ${r(a.y)} ${r(b.x - dx)} ${r(b.y)} ${r(b.x)} ${r(b.y)}`;
}

/** One point of that same cubic, so the hit test and the drawing cannot drift apart. */
function at(a, b, t) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  const p1 = { x: a.x + dx, y: a.y };
  const p2 = { x: b.x - dx, y: b.y };
  const u = 1 - t;
  const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
  return {
    x: k0 * a.x + k1 * p1.x + k2 * p2.x + k3 * b.x,
    y: k0 * a.y + k1 * p1.y + k2 * p2.y + k3 * b.y,
  };
}

/** The MIDPOINT of the drawn curve — where the label pill sits (§8.2). It is `at(a, b, 0.5)` and
 * not the average of the ends, so the pill follows the curve's belly rather than floating off it
 * when the two parts are far apart vertically.
 * @param {{x: number, y: number}} a @param {{x: number, y: number}} b @returns {{x: number, y: number}} */
export function wireMid(a, b) {
  return at(a, b, 0.5);
}

/** The box the label pill is laid out in, in WORLD units. Fixed, because it must not depend on
 * text measurement: the pill is centred inside it and the rest is transparent. */
export const LABEL_BOX = Object.freeze({ w: 180, h: 26 });

/** Squared distance from `p` to the cubic, sampled. @returns {number} world units */
export function wireDistance(a, b, p, samples = 24) {
  let best = Infinity;
  for (let i = 0; i <= samples; i++) {
    const q = at(a, b, i / samples);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** The wire under a world point, or null. Ties go to the LAST drawn (the one on top).
 * @returns {{wire: any, distance: number}|null} */
export function wireAt(doc, specs, p, tol = WIRE_HIT) {
  /** @type {{wire: any, distance: number}|null} */ let best = null;
  for (const wire of doc.wires) {
    const ends = wireEnds(doc, wire, specs);
    if (!ends) continue;
    const d = wireDistance(ends.a, ends.b, p);
    if (d <= tol && (!best || d <= best.distance)) best = { wire, distance: d };
  }
  return best;
}

/**
 * The live layer. `render(doc)` is ONE pass: every path is created, moved or dropped in this call
 * and nothing else in the panel touches the svg.
 * @param {SVGSVGElement} svg
 * @param {{specs: Map<string, any>, onLabel?: (wireId: string, text: string) => void,
 *   onDelete?: (wireId: string) => void}} o
 */
export function createWireLayer(svg, o) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'graph-wire-g');
  // Two child groups under the ONE transformed <g> (K2-U1): the paths, then the label pills on
  // top of them. Pan/zoom is still exactly one style write — the pills ride the same transform and
  // do no per-frame work of their own, which is the whole reason §11 says the perf gate must not
  // move when labels land.
  const gPaths = document.createElementNS(SVG_NS, 'g');
  gPaths.setAttribute('class', 'graph-wire-paths');
  const gLabels = document.createElementNS(SVG_NS, 'g');
  gLabels.setAttribute('class', 'graph-wire-labels');
  g.append(gPaths, gLabels);
  svg.replaceChildren(g);
  /** @type {Map<string, SVGPathElement>} */ const paths = new Map();
  /** @type {Map<string, {fo: any, pill: any, label: any}>} */ const pills = new Map();
  /** @type {SVGPathElement|null} */ let preview = null;
  /** @type {Set<string>} */ let selected = new Set();
  /** The wire under the pointer (critic R1, A5): it thickens and its pill shows the ✕. */
  let hovered = '';
  /** The wire whose pill is being typed into, and the text it had when the edit began. */
  /** @type {{id: string, was: string, cancelled: boolean}|null} */ let editing = null;

  /** @param {{x: number, y: number, zoom: number}} view */
  function setView(view) {
    g.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.zoom})`);
  }

  /** @param {any} doc */
  function render(doc) {
    /** @type {Set<string>} */ const live = new Set();
    for (const wire of doc.wires) {
      const ends = wireEnds(doc, wire, o.specs);
      if (!ends) continue;
      live.add(wire.id);
      let path = paths.get(wire.id);
      if (!path) {
        path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('class', 'graph-wire');
        path.setAttribute('data-wire', wire.id);
        path.setAttribute('aria-hidden', 'true');
        gPaths.appendChild(path);
        paths.set(wire.id, path);
      }
      const d = wirePath(ends.a, ends.b);
      if (path.getAttribute('d') !== d) path.setAttribute('d', d);
      const want = selected.has(wire.id) ? 'true' : 'false';
      if (path.getAttribute('data-selected') !== want) path.setAttribute('data-selected', want);
      const hov = hovered === wire.id ? 'true' : 'false';
      if (path.getAttribute('data-hover') !== hov) path.setAttribute('data-hover', hov);
      renderPill(wire, ends);
    }
    for (const [id, path] of Array.from(paths)) {
      if (live.has(id)) continue;
      path.remove();
      paths.delete(id);
    }
    for (const [id, pill] of Array.from(pills)) {
      if (live.has(id)) continue;
      if (editing && editing.id === id) editing = null;
      pill.fo.remove();
      pills.delete(id);
    }
  }

  // ---- the label pill (K2-U1, COMPUTER_PLAN §5.1 + §8.2) ---------------------------------------
  //
  // An unnamed wire is the #1 cause of a mushy answer, so EVERY wire wears a pill: dashed and
  // `name me` at rest when it is empty, an editable field when it is clicked. The text node is the
  // label and nothing else — the placeholder is a SIBLING span — because `.graph-wire-label`'s
  // `textContent` is the contract the harness reads: `''` means an empty pill, never 'name me'.

  /** @param {any} wire @param {{a: any, b: any}} ends */
  function renderPill(wire, ends) {
    const text = String(wire.label == null ? '' : wire.label);
    let pill = pills.get(wire.id);
    if (!pill) pill = makePill(wire.id);
    const mid = wireMid(ends.a, ends.b);
    const x = Math.round((mid.x - LABEL_BOX.w / 2) * 100) / 100;
    const y = Math.round((mid.y - LABEL_BOX.h / 2) * 100) / 100;
    if (pill.fo.getAttribute('x') !== String(x)) pill.fo.setAttribute('x', String(x));
    if (pill.fo.getAttribute('y') !== String(y)) pill.fo.setAttribute('y', String(y));
    // While someone is typing, the document is BEHIND the field, not in front of it: rewriting the
    // text here would move the caret to the start on every unrelated render.
    if (!editing || editing.id !== wire.id) {
      if (pill.label.textContent !== text) pill.label.textContent = text;
      pill.pill.dataset.empty = text ? 'false' : 'true';
    }
    const sel = selected.has(wire.id) ? 'true' : 'false';
    if (pill.pill.dataset.selected !== sel) pill.pill.dataset.selected = sel;
    const hov = hovered === wire.id ? 'true' : 'false';
    if (pill.pill.dataset.hover !== hov) pill.pill.dataset.hover = hov;
  }

  /** @param {string} wireId */
  function makePill(wireId) {
    const fo = document.createElementNS(SVG_NS, 'foreignObject');
    fo.setAttribute('class', 'graph-wire-fo');
    fo.setAttribute('width', String(LABEL_BOX.w));
    fo.setAttribute('height', String(LABEL_BOX.h));
    const pillEl = document.createElement('div');
    pillEl.className = 'graph-wire-pill';
    pillEl.dataset.wire = wireId;
    pillEl.dataset.empty = 'true';
    const label = document.createElement('span');
    label.className = 'graph-wire-label';
    label.dataset.wire = wireId;
    label.setAttribute('role', 'textbox');
    label.setAttribute('aria-label', t('graph.wireLabelAria'));
    label.tabIndex = 0;
    // The placeholder is its own span (never the label's text) and carries the tab stop while the
    // label is hidden, so an UNNAMED arrow is reachable by keyboard as well as by mouse.
    const ph = document.createElement('span');
    ph.className = 'graph-wire-ph';
    ph.setAttribute('aria-label', t('graph.wireLabelAria'));
    ph.setAttribute('role', 'button');
    ph.tabIndex = 0;
    ph.textContent = t('graph.wireNameMe');
    // Critic R1, A5: the ✕ that unplugs. It sits BESIDE the name (absolutely, so showing it on
    // hover never shifts the name under the pointer) and shows while the wire is hovered or
    // selected. Out of the tab order: a selected wire's keyboard way out is Delete, which its
    // title says.
    const chip = document.createElement('span');
    chip.className = 'graph-wire-chip';
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'graph-wire-x';
    x.dataset.wire = wireId;
    x.tabIndex = -1;
    x.textContent = '✕';
    x.title = t('graph.wireUnplug');
    x.setAttribute('aria-label', t('graph.wireUnplug'));
    x.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof o.onDelete === 'function') o.onDelete(wireId);
    });
    chip.append(label, ph, x);
    pillEl.append(chip);
    fo.appendChild(pillEl);
    gLabels.appendChild(fo);
    const entry = { fo, pill: pillEl, label };
    pills.set(wireId, entry);
    // On the PILL, so the dashed placeholder opens the same editor the named pill does; the canvas
    // never sees the press, which is why clicking a name does not also start a marquee.
    pillEl.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    pillEl.addEventListener('click', (ev) => { ev.stopPropagation(); beginEdit(wireId); });
    ph.addEventListener('focus', () => beginEdit(wireId));
    label.addEventListener('focus', () => beginEdit(wireId));
    label.addEventListener('blur', () => endEdit());
    label.addEventListener('keydown', onLabelKey);
    ph.addEventListener('keydown', (/** @type {any} */ ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); beginEdit(wireId); }
    });
    return entry;
  }

  /** @param {string} wireId */
  function beginEdit(wireId) {
    if (editing && editing.id === wireId) return;
    if (editing) endEdit();
    const entry = pills.get(wireId);
    if (!entry) return;
    editing = { id: wireId, was: entry.label.textContent || '', cancelled: false };
    entry.pill.dataset.editing = 'true';
    entry.label.contentEditable = 'plaintext-only';
    if (document.activeElement !== entry.label) entry.label.focus();
    selectAll(entry.label);
  }

  /**
   * Commit (or, after Escape, put back) whatever was typed. Committing is the CALLER's job — the
   * layer never touches the document; it hands the text to `o.onLabel` and re-renders from what
   * comes back, so one edit is one undo entry made in one place.
   *
   * It is called from FOUR places on purpose: Enter, Escape, the label's own blur, and the canvas's
   * next pointer press. `blur` alone is not enough — a browser whose window does not hold the OS
   * focus sets `activeElement` without ever firing `focus`/`blur`, and a name typed into a window
   * that then lost focus must still be the name the graph runs with.
   * @param {{cancel?: boolean}} [opt]
   */
  function endEdit(opt = {}) {
    if (!editing) return;
    if (opt.cancel) editing.cancelled = true;
    const { id, was, cancelled } = editing;
    const entry = pills.get(id);
    editing = null;
    if (!entry) return;
    entry.label.contentEditable = 'false';
    delete entry.pill.dataset.editing;
    const text = String(entry.label.textContent || '');
    if (cancelled || text === was) {
      entry.label.textContent = was;
      entry.pill.dataset.empty = was ? 'false' : 'true';
      return;
    }
    entry.pill.dataset.empty = text.trim() ? 'false' : 'true';
    if (typeof o.onLabel === 'function') o.onLabel(id, text);
  }

  /** @param {any} ev */
  function onLabelKey(ev) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      endEdit();
      if (ev.target.blur) ev.target.blur();
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();                 // the drawer owns Escape; a field being typed in owns it first
      endEdit({ cancel: true });
      if (ev.target.blur) ev.target.blur();
      return;
    }
    // Delete, Backspace and the arrows mean "edit this text", not "delete the selected parts".
    ev.stopPropagation();
  }

  /** @param {any} node */
  function selectAll(node) {
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch { /* selection is a convenience; an edit that cannot select still types */ }
  }

  /** The wire being dragged. `null` clears it. @param {{a: any, b: any}|null} ends */
  function setPreview(ends) {
    if (!ends) {
      if (preview) { preview.remove(); preview = null; }
      return;
    }
    if (!preview) {
      preview = document.createElementNS(SVG_NS, 'path');
      preview.setAttribute('class', 'graph-wire graph-wire-preview');
      preview.setAttribute('aria-hidden', 'true');
      gPaths.appendChild(preview);
    }
    preview.setAttribute('d', wirePath(ends.a, ends.b));
  }

  return {
    setView,
    render,
    setPreview,
    /** @param {string[]} ids */
    setSelected(ids) { selected = new Set(ids || []); },
    /** The wire under the pointer, or '' (critic R1, A5). Written straight onto the path and the
     * pill — no render, so a hover costs two attribute writes and never a re-draw.
     * @param {string} id */
    setHover(id) {
      const next = String(id || '');
      if (next === hovered) return;
      const prev = hovered;
      hovered = next;
      for (const [wid, v] of [[prev, 'false'], [next, 'true']]) {
        if (!wid) continue;
        const path = paths.get(wid);
        if (path) path.setAttribute('data-hover', v);
        const pill = pills.get(wid);
        if (pill) pill.pill.dataset.hover = v;
      }
    },
    hovered: () => hovered,
    selected: () => Array.from(selected),
    count: () => paths.size,
    /** Put the caret in one wire's pill (K2-U1). The canvas calls it when a wire is chosen and
     * `F2`/Enter is pressed, so naming a wire is reachable without a mouse.
     * @param {string} wireId @returns {boolean} */
    editLabel(wireId) {
      if (!pills.has(wireId)) return false;
      beginEdit(wireId);
      return true;
    },
    /** Which wire's pill has the caret, or `''`. */
    editingLabel: () => (editing ? editing.id : ''),
    /** Close an open pill: the canvas calls it on its next pointer press, so pressing anywhere
     * else on the graph commits the name the way clicking away from a field always has.
     * @param {{cancel?: boolean}} [opt] @returns {boolean} whether anything was open */
    endLabelEdit(opt) {
      if (!editing) return false;
      endEdit(opt || {});
      return true;
    },
    destroy() {
      editing = null;
      paths.clear();
      pills.clear();
      preview = null;
      svg.replaceChildren();
    },
  };
}
