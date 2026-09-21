// @ts-check
// C1-U1 — topological order, cycle detection, the stale set, the run set and the run plan
// (spec §2, plan §2.6 BG-4). PURE.
//
// The one rule that makes the panel affordable: `runSet` runs a part when it is dirty
// (idle|stale|error) OR when anything upstream of it is being re-run, and skips a `done` part
// whose whole upstream is `done`. That is what makes "a 30-part graph costs one generation after
// a typo fix" true, so it is stated once, here, and asserted by both the unit tests and the
// harness.


/** @typedef {import('../core/types.mjs').GraphDoc} GraphDoc */
/** @typedef {import('../core/types.mjs').GraphPart} GraphPart */

/** The generation cap for one run (spec §2 "Cap"). C1 only ACCOUNTS for it — one thinking part is
 * one generation; C2 multiplies it by fan-out and enforces the stop-and-offer. */
export const DEFAULT_MAX_ITEMS = 50;

/** part id → the ids it feeds. @param {GraphDoc} doc @returns {Map<string, string[]>} */
function outEdges(doc) {
  /** @type {Map<string, string[]>} */ const out = new Map();
  for (const p of doc.parts) out.set(p.id, []);
  for (const w of doc.wires) {
    const list = out.get(w.from);
    if (list && out.has(w.to)) list.push(w.to);
  }
  return out;
}

/** part id → the ids feeding it. @param {GraphDoc} doc @returns {Map<string, string[]>} */
function inEdges(doc) {
  /** @type {Map<string, string[]>} */ const into = new Map();
  for (const p of doc.parts) into.set(p.id, []);
  for (const w of doc.wires) {
    const list = into.get(w.to);
    if (list && into.has(w.from)) list.push(w.from);
  }
  return into;
}

/** One real cycle among the parts Kahn could not place, as a closed walk `[a, b, …, a]`.
 * @param {Map<string, string[]>} out @param {Set<string>} left @returns {string[]} */
function findCycle(out, left) {
  const state = new Map();                     // id → 1 on the stack, 2 finished
  /** @type {string[]} */ const path = [];
  /** @param {string} id @returns {string[]|null} */
  const walk = (id) => {
    state.set(id, 1);
    path.push(id);
    for (const to of out.get(id) || []) {
      if (!left.has(to)) continue;
      if (state.get(to) === 1) return [...path.slice(path.indexOf(to)), to];
      if (!state.has(to)) {
        const hit = walk(to);
        if (hit) return hit;
      }
    }
    path.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of left) {
    if (state.has(id)) continue;
    const hit = walk(id);
    if (hit) return hit;
  }
  return [...left];
}

/** Kahn. STABLE on DOCUMENT order: when several parts are ready at once the one placed on the
 * canvas first goes first, so the same graph always runs in the same order — the harness counts
 * completions in order, and a user watching two independent branches sees a predictable one.
 * @param {GraphDoc} doc @returns {{ok: true, ids: string[]}|{ok: false, cycle: string[]}} */
export function order(doc) {
  const out = outEdges(doc);
  /** @type {Map<string, number>} */ const deg = new Map();
  /** @type {Map<string, number>} */ const rank = new Map();
  doc.parts.forEach((p, i) => { deg.set(p.id, 0); rank.set(p.id, i); });
  for (const [, tos] of out) for (const to of tos) deg.set(to, (deg.get(to) || 0) + 1);
  /** @type {string[]} */ const ready = doc.parts.filter((p) => (deg.get(p.id) || 0) === 0).map((p) => p.id);
  /** @param {string} id */
  const offer = (id) => {
    const r = /** @type {number} */ (rank.get(id));
    let i = ready.length;
    while (i > 0 && /** @type {number} */ (rank.get(ready[i - 1])) > r) i -= 1;
    ready.splice(i, 0, id);
  };
  /** @type {string[]} */ const ids = [];
  const placed = new Set();
  while (ready.length) {
    const id = /** @type {string} */ (ready.shift());
    ids.push(id);
    placed.add(id);
    for (const to of out.get(id) || []) {
      const n = (deg.get(to) || 0) - 1;
      deg.set(to, n);
      if (n === 0) offer(to);
    }
  }
  if (ids.length !== doc.parts.length) {
    const left = new Set(doc.parts.map((p) => p.id).filter((id) => !placed.has(id)));
    return { ok: false, cycle: findCycle(out, left) };
  }
  return { ok: true, ids };
}

/** Would adding this wire close a loop? True for a self-wire, and for anything already reachable
 * from `to`. @param {GraphDoc} doc @param {{from: string, to: string}} edge @returns {boolean} */
export function wouldCycle(doc, edge) {
  if (!edge || !edge.from || !edge.to) return false;
  if (edge.from === edge.to) return true;
  const out = outEdges(doc);
  const seen = new Set([edge.to]);
  const stack = [edge.to];
  while (stack.length) {
    const id = /** @type {string} */ (stack.pop());
    if (id === edge.from) return true;
    for (const to of out.get(id) || []) if (!seen.has(to)) { seen.add(to); stack.push(to); }
  }
  return false;
}

/** Everything reachable from `ids`, in topological order, the seeds EXCLUDED.
 * @param {GraphDoc} doc @param {string[]} ids @returns {string[]} */
export function downstream(doc, ids) {
  const seeds = new Set(Array.isArray(ids) ? ids : []);
  if (!seeds.size) return [];
  const out = outEdges(doc);
  const hit = new Set();
  const stack = [...seeds];
  while (stack.length) {
    const id = /** @type {string} */ (stack.pop());
    for (const to of out.get(id) || []) if (!hit.has(to)) { hit.add(to); stack.push(to); }
  }
  if (!hit.size) return [];
  const ord = order(doc);
  const all = ord.ok ? ord.ids : doc.parts.map((p) => p.id);
  return all.filter((id) => hit.has(id) && !seeds.has(id));
}

/** The seeds and everything downstream become 'stale'. Values are KEPT: a stale part still shows
 * its last answer, greyed, until the next Run replaces it.
 * @param {GraphDoc} doc @param {string[]} ids @param {{now?: () => number}} [o] @returns {GraphDoc} */
export function markStale(doc, ids, o = {}) {
  const seeds = (Array.isArray(ids) ? ids : []).filter((id) => doc.parts.some((p) => p.id === id));
  const touched = new Set([...seeds, ...downstream(doc, seeds)]);
  if (!touched.size) return doc;
  let changed = false;
  const parts = doc.parts.map((p) => {
    if (!touched.has(p.id) || p.state === 'stale') return p;
    changed = true;
    return { ...p, state: 'stale' };
  });
  if (!changed) return doc;
  return { ...doc, updatedAt: (o.now || Date.now)(), parts };
}

/** The parts `Run` must execute, in topological order. FROZEN RULE (plan §2.6 BG-4): a part is in
 * the run set when its state is idle|stale|error, or when any upstream part is in the run set; a
 * `done` part whose whole upstream is `done` is skipped.
 * @param {GraphDoc} doc @returns {string[]} */
export function runSet(doc) {
  const ord = order(doc);
  if (!ord.ok) return [];
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const into = inEdges(doc);
  const need = new Set();
  for (const id of ord.ids) {
    const p = /** @type {any} */ (byId.get(id));
    const dirty = !p || p.state === 'idle' || p.state === 'stale' || p.state === 'error';
    if (dirty || (into.get(id) || []).some((from) => need.has(from))) need.add(id);
  }
  return ord.ids.filter((id) => need.has(id));
}

/**
 * The run plan: what one press of Run will do, before it does it. The runner walks `ids`; the
 * canvas shows `thinking` as the cost and `overflow` as the cap warning.
 *
 * `cost` counts ONE generation per thinking part (`spec.thinks`). C2 multiplies it by the fan-out
 * width; the accounting lives here so both phases read one number.
 *
 * @param {GraphDoc} doc
 * @param {{specs?: Map<string, any>, only?: string[]|null, cap?: number}} [o]
 * @returns {{ok: boolean, ids: string[], thinking: string[], cost: number, cap: number,
 *   capped: string[], overflow: number, cycle: string[]}}
 */
export function runPlan(doc, o = {}) {
  const ord = order(doc);
  const cap = Number.isFinite(Number(o.cap)) && Number(o.cap) > 0 ? Math.floor(Number(o.cap)) : DEFAULT_MAX_ITEMS;
  if (!ord.ok) {
    return { ok: false, ids: [], thinking: [], cost: 0, cap, capped: [], overflow: 0, cycle: ord.cycle };
  }
  let ids = runSet(doc);
  if (Array.isArray(o.only)) {
    const want = new Set(o.only);
    ids = ord.ids.filter((id) => want.has(id));
  }
  const specs = o.specs instanceof Map ? o.specs : new Map();
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  /** @type {string[]} */ const thinking = [];
  /** @type {string[]} */ const capped = [];
  let cost = 0;
  let overflow = 0;
  for (const id of ids) {
    const part = /** @type {any} */ (byId.get(id));
    const spec = part ? specs.get(part.type) : null;
    if (!spec || !spec.thinks) continue;
    thinking.push(id);
    cost += 1;
    if (cost <= cap) capped.push(id);
    else overflow += 1;
  }
  return { ok: true, ids, thinking, cost, cap, capped, overflow, cycle: [] };
}
