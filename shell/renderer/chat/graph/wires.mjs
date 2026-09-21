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

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Height of `.graph-part-head` — the ports hang below it. Mirrored by `--graph-head-h` in css. */
export const HEAD_H = 28;
/** How far a click may miss a wire and still hit it, in WORLD units. */
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
 * @param {{specs: Map<string, any>}} o
 */
export function createWireLayer(svg, o) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'graph-wire-g');
  svg.replaceChildren(g);
  /** @type {Map<string, SVGPathElement>} */ const paths = new Map();
  /** @type {SVGPathElement|null} */ let preview = null;
  /** @type {Set<string>} */ let selected = new Set();

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
        g.appendChild(path);
        paths.set(wire.id, path);
      }
      const d = wirePath(ends.a, ends.b);
      if (path.getAttribute('d') !== d) path.setAttribute('d', d);
      const want = selected.has(wire.id) ? 'true' : 'false';
      if (path.getAttribute('data-selected') !== want) path.setAttribute('data-selected', want);
    }
    for (const [id, path] of Array.from(paths)) {
      if (live.has(id)) continue;
      path.remove();
      paths.delete(id);
    }
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
      g.appendChild(preview);
    }
    preview.setAttribute('d', wirePath(ends.a, ends.b));
  }

  return {
    setView,
    render,
    setPreview,
    /** @param {string[]} ids */
    setSelected(ids) { selected = new Set(ids || []); },
    selected: () => Array.from(selected),
    count: () => paths.size,
    destroy() { paths.clear(); preview = null; svg.replaceChildren(); },
  };
}
