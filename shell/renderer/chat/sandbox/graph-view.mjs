// @ts-check
// ONE viewer for node-link JSON (owner decision 2026-09-28, docs/NIGHT_LOG_2026-09-28.md 21:30): a
// d3-force drawing of graphify's `graphify-out/graph.json` (networkx node-link: `nodes` + `links`,
// `hyperedges` ignored) or any `{nodes, edges}` graph. The Computer's Preview draws it in its
// **Graph** mode; the IDE reuses the same three exports.
//
//   readNodeLink(textOrObject)  PURE. The graph, trimmed to what is drawn, or an Error with
//                               `code` 'not-json' | 'no-nodes' and `line` (1-based, 0 = unknown).
//   graphProgram(graph, opts)   The sandbox guest program that draws it into the guest's root:
//                               `sandbox.run({kind: 'dom', code, size})` for a picture, or
//                               `sandbox.live({mount, mode: 'dom', code, size})` to drag it.
//   drawNodeLink(d3, el, graph, opts)  The drawing itself, for a page that has d3 7 loaded.
//
// d3 is the one vendored in sandbox/lib (7.9.0): `graphProgram` names `d3.`, which is what makes the
// host load it (sandbox/host.mjs `libsFor`). Never a CDN — the guest has no network at all.
//
// `drawNodeLink` CLOSES OVER NOTHING: `graphProgram` ships its source text into the guest, so every
// constant it needs is inside it. Keep it that way (no module-level names in its body).

/** More nodes than this is a sentence, not a drawing: a force layout of it would stall the guest. */
export const MAX_NODES = 1000;
/** More links than this is a sentence too, for the same reason. */
export const MAX_LINKS = 5000;

/**
 * @typedef {{id: string, label: string, community: (string|number|null), community_name?: string}} GraphNode
 * @typedef {{source: string, target: string, relation: string, confidence: string}} GraphLink
 * @typedef {{nodes: GraphNode[], links: GraphLink[], total: {nodes: number, links: number},
 *   dropped: number, tooMany: boolean}} NodeLinkGraph
 */

/** @param {string} code @param {string} message @param {number} [line] */
function graphError(code, message, line) {
  const err = new Error(message);
  /** @type {any} */ (err).code = code;
  /** @type {any} */ (err).line = Number(line) > 0 ? Number(line) : 0;
  return err;
}

/**
 * The line a JSON.parse error is on: the engine's "(line N", else its "position N", else — V8 names
 * no place for "Unexpected token '}', "…" is not valid JSON" — the shortest prefix of the text that
 * already fails BEFORE its own end (a bisection: the bad character ends that prefix). 0 when the
 * text parses. PURE.
 * @param {string} text @param {any} err @returns {number}
 */
export function jsonErrorLine(text, err) {
  const src = String(text);
  const lineAt = (/** @type {number} */ i) => src.slice(0, i).split('\n').length;
  const msg = String((err && err.message) || '');
  const byLine = /\bline (\d+)/.exec(msg);
  if (byLine) return Number(byLine[1]);
  const byPos = /\bposition (\d+)/.exec(msg);
  if (byPos) return lineAt(Number(byPos[1]));
  const brokenBefore = (/** @type {number} */ i) => {
    try { JSON.parse(src.slice(0, i)); return false; } catch (e) {
      const m = String((e && /** @type {any} */ (e).message) || '');
      if (/end of JSON input/.test(m)) return false;
      const at = /\bposition (\d+)/.exec(m);
      return at ? Number(at[1]) < i : true;
    }
  };
  if (!brokenBefore(src.length)) return 0;
  let lo = 0;
  let hi = src.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (brokenBefore(mid)) hi = mid; else lo = mid + 1;
  }
  return lineAt(Math.max(0, lo - 1));
}

/** A value as a short id or label. @param {any} v @returns {string} */
const str = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Read a node-link graph. `input` is JSON text or the parsed value: graphify's graph.json, a d3
 * `{nodes, links}`, or `{nodes, edges}`. A node may be an object with an `id` (else `name`) or a
 * bare id; its `label` falls back to `name`, then the id; its colour group is `community` (else
 * `group`). A link's ends are node ids (or objects carrying one, or an index into `nodes`); a link
 * whose end is not a node is dropped and counted. Past MAX_NODES / MAX_LINKS the lists come back
 * EMPTY with `tooMany` set — the viewer then says so instead of laying out a hairball. PURE.
 * @param {any} input @returns {NodeLinkGraph}
 */
export function readNodeLink(input) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (err) {
      const reason = str(err && /** @type {any} */ (err).message)
        .replace(/\s+in JSON at position \d+.*$/, '')
        .slice(0, 160);
      throw graphError('not-json', reason, jsonErrorLine(input, err));
    }
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.nodes)) {
    throw graphError('no-nodes', 'no "nodes" list');
  }
  const rawLinks = Array.isArray(data.links) ? data.links : Array.isArray(data.edges) ? data.edges : [];
  const total = { nodes: data.nodes.length, links: rawLinks.length };
  if (total.nodes > MAX_NODES || total.links > MAX_LINKS) return { nodes: [], links: [], total, dropped: 0, tooMany: true };

  /** @type {GraphNode[]} */ const nodes = [];
  /** @type {Map<string, true>} */ const seen = new Map();
  for (const n of data.nodes) {
    const obj = n && typeof n === 'object';
    const id = str(obj ? (n.id !== undefined ? n.id : n.name) : n);
    if (!id || seen.has(id)) continue;
    seen.set(id, true);
    const community = obj && n.community !== undefined ? n.community : obj && n.group !== undefined ? n.group : null;
    /** @type {GraphNode} */ const node = {
      id,
      label: str(obj ? (n.label !== undefined && n.label !== null ? n.label : n.name) : n) || id,
      community: typeof community === 'number' || typeof community === 'string' ? community : null,
    };
    if (obj && typeof n.community_name === 'string' && n.community_name) node.community_name = n.community_name;
    nodes.push(node);
  }
  /** @param {any} end @returns {string} */
  const endOf = (end) => {
    const v = end && typeof end === 'object' ? end.id : end;
    const id = str(v);
    if (seen.has(id)) return id;
    // d3's older convention: an index into `nodes`.
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < nodes.length) return nodes[v].id;
    return '';
  };
  /** @type {GraphLink[]} */ const links = [];
  let dropped = 0;
  for (const l of rawLinks) {
    const source = l && typeof l === 'object' ? endOf(l.source) : '';
    const target = l && typeof l === 'object' ? endOf(l.target) : '';
    if (!source || !target) { dropped++; continue; }
    links.push({
      source,
      target,
      relation: str(l.relation !== undefined ? l.relation : l.type !== undefined ? l.type : l.label),
      confidence: str(l.confidence).toUpperCase(),
    });
  }
  return { nodes, links, total, dropped, tooMany: false };
}

/**
 * The sandbox guest program that draws `graph` (from readNodeLink) into the guest's root at the
 * run's size. `opts.tooMany` / `opts.empty` are the sentences shown instead of a drawing (the
 * caller's own words, already translated). PURE.
 * @param {NodeLinkGraph} graph @param {{tooMany?: string, empty?: string}} [opts] @returns {string}
 */
export function graphProgram(graph, opts) {
  return [
    `const drawNodeLink = ${drawNodeLink.toString()};`,
    `drawNodeLink(d3, lol.root, ${JSON.stringify(graph)}, Object.assign(${JSON.stringify(opts || {})}, { width: lol.size.w, height: lol.size.h }));`,
  ].join('\n');
}

/**
 * Draw a graph from readNodeLink into `el` with d3 7: nodes coloured by community (Tableau 10,
 * cycled; grey for none), sized by degree, the best-connected ones labelled (all of them up to 150
 * nodes); links dashed when INFERRED and dotted when AMBIGUOUS; laid out to rest, then fitted to
 * `opts.width` x `opts.height`. Nodes drag (the layout follows), the wheel zooms, a drag on the
 * paper pans. Replaces whatever `el` held. Returns what it drew and `stop()` for the simulation.
 * SELF-CONTAINED — see the file header.
 * @param {any} d3 @param {any} el @param {NodeLinkGraph} graph
 * @param {{width?: number, height?: number, tooMany?: string, empty?: string}} [opts]
 * @returns {{nodes: number, links: number, labels: number, stop: () => void}}
 */
export function drawNodeLink(d3, el, graph, opts) {
  const o = opts || {};
  const W = Math.max(64, Math.round(Number(o.width) || el.clientWidth || 640));
  const H = Math.max(64, Math.round(Number(o.height) || el.clientHeight || 480));
  const PAPER = '#ffffff';
  const INK = '#1f2328';
  const LINK = '#6e7781';
  const NONE = '#9aa0a6';
  const PALETTE = ['#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab'];
  const FONT = 'Inter, system-ui, sans-serif';
  const g = graph || { nodes: [], links: [], tooMany: false };
  /** @type {any[]} */ const nodes = (g.nodes || []).map((n) => ({ ...n }));
  /** @type {any[]} */ const links = (g.links || []).map((l) => ({ ...l }));
  el.replaceChildren();

  if (g.tooMany || !nodes.length) {
    const p = el.ownerDocument.createElement('p');
    p.textContent = String((g.tooMany ? o.tooMany : o.empty) || '');
    p.setAttribute('data-graph', g.tooMany ? 'too-many' : 'empty');
    p.style.cssText = `margin:0;padding:24px;box-sizing:border-box;width:${W}px;height:${H}px;background:${PAPER};color:${INK};font:14px/1.5 ${FONT};`;
    el.appendChild(p);
    return { nodes: 0, links: 0, labels: 0, stop: () => {} };
  }

  const keys = Array.from(new Set(nodes.map((n) => n.community).filter((c) => c !== null && c !== undefined && c !== '')))
    .sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))));
  const colours = new Map(keys.map((k, i) => [k, PALETTE[i % PALETTE.length]]));
  const degree = new Map();
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) || 0) + 1);
    degree.set(l.target, (degree.get(l.target) || 0) + 1);
  }
  const radius = (/** @type {any} */ d) => 4 + Math.min(8, Math.sqrt(degree.get(d.id) || 0) * 1.6);

  // Laid out to rest BEFORE anything is drawn: a picture must show the settled graph, and the
  // simulation only runs again while a node is dragged. Fewer ticks for bigger graphs (1000 nodes
  // and 3000 links: ~0.3 s in Node). A strong charge on a small graph keeps a chain from settling
  // folded over itself (-90 left a 5-node chain crossed).
  const n = nodes.length;
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((/** @type {any} */ d) => d.id).distance(36))
    .force('charge', d3.forceManyBody().strength(n > 300 ? -30 : n > 100 ? -60 : -150))
    .force('x', d3.forceX().strength(0.05))
    .force('y', d3.forceY().strength(0.05))
    .stop();
  const ticks = n > 500 ? 120 : n > 200 ? 200 : 300;
  for (let i = 0; i < ticks; i++) sim.tick();

  // Fit the settled layout into W x H (never blown up past 4x); `s` is one screen pixel in layout units.
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const d of nodes) {
    x0 = Math.min(x0, d.x); y0 = Math.min(y0, d.y); x1 = Math.max(x1, d.x); y1 = Math.max(y1, d.y);
  }
  const pad = 28;
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);
  const k = Math.max(0.01, Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh, 4));
  const tx = (W - bw * k) / 2 - x0 * k;
  const ty = (H - bh * k) / 2 - y0 * k;
  const s = 1 / k;

  const svg = d3.select(el).append('svg')
    .attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)
    .attr('data-nodes', n).attr('data-links', links.length)
    .style('display', 'block');
  svg.append('rect').attr('width', W).attr('height', H).attr('fill', PAPER);
  const view = svg.append('g').attr('transform', `translate(${tx},${ty}) scale(${k})`);

  const link = view.append('g').attr('stroke', LINK).attr('stroke-opacity', 0.8)
    .selectAll('line').data(links).join('line')
    .attr('stroke-width', 1.2 * s)
    .attr('stroke-dasharray', (/** @type {any} */ d) => (d.confidence === 'INFERRED' ? `${4 * s} ${3 * s}` : d.confidence === 'AMBIGUOUS' ? `${1.2 * s} ${3 * s}` : null));
  link.append('title').text((/** @type {any} */ d) => [d.relation, d.confidence].filter(Boolean).join(' · '));

  const node = view.append('g').attr('stroke', PAPER).attr('stroke-width', 1.5 * s)
    .selectAll('circle').data(nodes).join('circle')
    .attr('r', (/** @type {any} */ d) => radius(d) * s)
    .attr('fill', (/** @type {any} */ d) => colours.get(d.community) || NONE)
    .attr('data-id', (/** @type {any} */ d) => d.id)
    .style('cursor', 'grab');
  node.append('title').text((/** @type {any} */ d) => (d.community_name ? `${d.label} — ${d.community_name}` : d.label));

  const named = n <= 150 ? nodes : nodes.slice().sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0)).slice(0, 40);
  const short = (/** @type {any} */ v) => { const t = String(v == null ? '' : v); return t.length > 32 ? `${t.slice(0, 31)}…` : t; };
  const label = view.append('g').attr('pointer-events', 'none')
    .attr('font-family', FONT).attr('font-size', 11 * s).attr('fill', INK)
    .attr('stroke', PAPER).attr('stroke-width', 3 * s).attr('paint-order', 'stroke')
    .selectAll('text').data(named).join('text')
    .attr('dx', (/** @type {any} */ d) => (radius(d) + 3) * s).attr('dy', 3.5 * s)
    .text((/** @type {any} */ d) => short(d.label));

  const place = () => {
    link.attr('x1', (/** @type {any} */ d) => d.source.x).attr('y1', (/** @type {any} */ d) => d.source.y)
      .attr('x2', (/** @type {any} */ d) => d.target.x).attr('y2', (/** @type {any} */ d) => d.target.y);
    node.attr('cx', (/** @type {any} */ d) => d.x).attr('cy', (/** @type {any} */ d) => d.y);
    label.attr('x', (/** @type {any} */ d) => d.x).attr('y', (/** @type {any} */ d) => d.y);
  };
  place();
  sim.on('tick', place);

  node.call(d3.drag()
    .on('start', (/** @type {any} */ e, /** @type {any} */ d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (/** @type {any} */ e, /** @type {any} */ d) => { d.fx = e.x; d.fy = e.y; })
    .on('end', (/** @type {any} */ e, /** @type {any} */ d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
  const zoom = d3.zoom().scaleExtent([k / 8, k * 8]).on('zoom', (/** @type {any} */ e) => view.attr('transform', e.transform));
  svg.call(zoom).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));

  return { nodes: n, links: links.length, labels: named.length, stop: () => { sim.stop(); } };
}
