// @ts-check
// C1-U1 — topological order, cycle detection, the stale set, the run set and the run plan
// (spec §2, plan §2.6 BG-4). PURE.
//
// The one rule that makes the panel affordable: `runSet` runs a part when it is dirty
// (idle|stale|error) OR when anything upstream of it is being re-run, and skips a `done` part
// whose whole upstream is `done`. That is what makes "a 30-part graph costs one generation after
// a typo fix" true, so it is stated once, here, and asserted by both the unit tests and the
// harness.


import { RUN_LIMITS } from '../core/types.mjs';

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
  // K3: ORDER over the forward graph. Reachability still follows back edges (an edit inside a loop
  // stales the whole loop), but a document that legally contains one must still come back ordered
  // rather than in raw document order.
  const ord = order(forwardEdges(doc));
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
 * K3 (§4.6): the plan is a RANGE when the graph loops — `costMin` is one pass, `costMax` multiplies
 * every thinking part ON a loop by `maxIterations`, which is what the run bar reads as
 * "6–48 generations". `waitMs` is the summed wall clock a run's Timers would spend BEFORE it
 * starts, so a plan that cannot finish inside `maxWallMs` is refused with its own arithmetic
 * rather than discovered ten minutes in. `manual` names the unpressed Buttons the run will skip.
 *
 * @param {GraphDoc} doc
 * @param {{specs?: Map<string, any>, only?: string[]|null, cap?: number,
 *   limits?: {maxIterations?: number, maxWallMs?: number}}} [o]
 * @returns {{ok: boolean, ids: string[], thinking: string[], cost: number, cap: number,
 *   capped: string[], overflow: number, cycle: string[],
 *   costMin: number, costMax: number, loops: string[], manual: string[], waitMs: number}}
 */
export function runPlan(doc, o = {}) {
  const fwd = forwardEdges(doc);
  const ord = order(fwd);
  const cap = Number.isFinite(Number(o.cap)) && Number(o.cap) > 0 ? Math.floor(Number(o.cap)) : DEFAULT_MAX_ITEMS;
  const specs = o.specs instanceof Map ? o.specs : new Map();
  if (!ord.ok) {
    return {
      ok: false, ids: [], thinking: [], cost: 0, cap, capped: [], overflow: 0, cycle: ord.cycle,
      costMin: 0, costMax: 0, loops: [], manual: [], waitMs: 0,
    };
  }
  let ids = activeSet(doc, [], { mode: 'all', specs });
  if (Array.isArray(o.only)) {
    const want = new Set(o.only);
    ids = ord.ids.filter((id) => want.has(id));
  }
  const limits = o.limits || {};
  const maxIterations = Number(limits.maxIterations) > 0
    ? Math.floor(Number(limits.maxIterations)) : RUN_LIMITS.maxIterations;
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const looping = new Set(loopParts(doc));
  /** @type {string[]} */ const thinking = [];
  /** @type {string[]} */ const capped = [];
  let cost = 0;
  let costMax = 0;
  let overflow = 0;
  let waitMs = 0;
  for (const id of ids) {
    const part = /** @type {any} */ (byId.get(id));
    const spec = part ? specs.get(part.type) : null;
    if (!spec) continue;
    // §4.6: the refusal is made at PLAN time, with the arithmetic shown — so the arithmetic has to
    // include the loop. A 120 s Timer inside a gated loop is not 120 s of waiting, it is up to
    // `maxIterations` × 120 s, and planning it as 120 s is exactly how the run gets discovered ten
    // minutes in by the runtime ceiling instead of refused before it starts. Same multiplier
    // `costMax` already applies two lines down.
    waitMs += plannedWaitMsOf(part, spec, maxIterations) * (looping.has(id) ? maxIterations : 1);
    if (!thinksFor(spec, part)) continue;
    thinking.push(id);
    cost += 1;
    costMax += looping.has(id) ? maxIterations : 1;
    if (cost <= cap) capped.push(id);
    else overflow += 1;
  }
  return {
    ok: true,
    ids,
    thinking,
    cost,
    cap,
    capped,
    overflow,
    cycle: [],
    costMin: cost,
    costMax,
    loops: ids.filter((id) => looping.has(id)),
    manual: manualRoots(doc, specs).filter((id) => !ids.includes(id)),
    waitMs,
  };
}

// =============================================================================================
// K3 (COMPUTER_PLAN §4, §11 K3-U1) — the scheduler's half of topology. All of it is REAL and
// cross-unit; do not re-derive any of it anywhere else:
//
//   forwardEdges(doc) · backEdges(doc) · isBack(wire) · cycleFor(doc, edge) · loopParts(doc) ·
//   GATE_TYPES · gatedLoop(doc, cycle, specs) · manualRoots(doc, specs) ·
//   unrunAncestors(doc, seeds, {specs})  the §4.2 prologue, on its own so it can be asserted ·
//   activeSet(doc, seeds, {mode, force, specs})  the ONE active set, push and pull ·
//   thinksFor(spec, part) · plannedWaitMsOf(part, spec, maxIterations)
//
// `runPlan` above reads all of them, and is the RANGE the run bar quotes.
// =============================================================================================

/** The document's wires MINUS the declared back edges. `order()` runs on this graph, which is
 * what gives a loop its unit delay and stops a loop head deadlocking (§4.6).
 * @param {GraphDoc} doc @returns {GraphDoc} */
export function forwardEdges(doc) {
  const wires = (doc.wires || []).filter((w) => /** @type {any} */ (w).back !== true);
  return wires.length === (doc.wires || []).length ? doc : { ...doc, wires };
}

/** Just the declared back edges, in document order. @param {GraphDoc} doc @returns {any[]} */
export function backEdges(doc) {
  return (doc.wires || []).filter((w) => /** @type {any} */ (w).back === true);
}

/** @param {any} wire @returns {boolean} */
export function isBack(wire) {
  return !!wire && /** @type {any} */ (wire).back === true;
}

/** The cycle this edge would close, as a closed walk `[to, …, from, to]`, or null when it closes
 * none. It is the path the loop-gate check (§4.6) inspects, so it is computed ONCE, here, and
 * `wireRefusal` reads it rather than re-walking the graph.
 * @param {GraphDoc} doc @param {{from: string, to: string}} edge @returns {string[]|null} */
export function cycleFor(doc, edge) {
  if (!edge || !edge.from || !edge.to) return null;
  if (edge.from === edge.to) return [edge.from, edge.from];
  // Walk FORWARD from `to` looking for `from`, over the forward graph only: a loop that already
  // exists must not make every further edge look like a second loop.
  const fwd = forwardEdges(doc);
  const out = new Map();
  for (const p of fwd.parts) out.set(p.id, []);
  for (const w of fwd.wires) { const l = out.get(w.from); if (l && out.has(w.to)) l.push(w.to); }
  /** @type {Map<string, string|null>} */ const from = new Map([[edge.to, null]]);
  const queue = [edge.to];
  while (queue.length) {
    const id = /** @type {string} */ (queue.shift());
    if (id === edge.from) {
      const path = [];
      for (let at = /** @type {string|null|undefined} */ (id); at; at = from.get(at)) path.unshift(at);
      return [...path, edge.to];
    }
    for (const to of out.get(id) || []) if (!from.has(to)) { from.set(to, id); queue.push(to); }
  }
  return null;
}

/** The part types that can stop a loop (§4.6). A cycle containing none of them is refused with
 * `loop-ungated`. A spec declaring `control:true` counts too, so a part added later is a gate by
 * declaring itself one rather than by being added to this list. */
export const GATE_TYPES = Object.freeze(['button', 'condition', 'confirm', 'dialog', 'toggle', 'timer']);

/** Does this cycle contain something that can stop it? @param {GraphDoc} doc
 * @param {string[]} cycle @param {Map<string, any>} [specs] @returns {boolean} */
export function gatedLoop(doc, cycle, specs) {
  const ids = new Set(Array.isArray(cycle) ? cycle : []);
  for (const p of doc.parts) {
    if (!ids.has(p.id)) continue;
    if (GATE_TYPES.includes(p.type)) return true;
    const spec = specs instanceof Map ? specs.get(p.type) : null;
    if (spec && spec.control) return true;
  }
  return false;
}

/** Parts a `mode:'all'` run must never place in the active set: an unpressed Button (§4.2).
 * @param {GraphDoc} doc @param {Map<string, any>} specs @returns {string[]} */
export function manualRoots(doc, specs) {
  const out = [];
  for (const p of doc.parts) {
    const spec = specs instanceof Map ? specs.get(p.type) : null;
    if (spec && spec.manual) out.push(p.id);
  }
  return out;
}

/** Does this part hold a real value? Written here rather than imported from values.mjs so topo
 * stays import-free apart from the frozen constants. @param {any} part @returns {boolean} */
function holdsValue(part) {
  const v = part && part.value;
  return !!v && typeof v === 'object' && typeof (/** @type {any} */ (v).kind) === 'string';
}

/** A part whose stored value never satisfies a run (§4.2): `spec.volatile`, or `volatileFor(part)`
 * for a part that decides per box — a Dialog with `askEveryRun`.
 * @param {any} part @param {any} spec @returns {boolean} */
function isVolatile(part, spec) {
  if (!spec) return false;
  if (spec.volatile === true) return true;
  if (typeof spec.volatileFor !== 'function') return false;
  try { return !!spec.volatileFor(part); } catch { return false; }
}

/** Does this part cost a generation, in THIS box's settings (§4.6)? A Condition in text mode
 * declares `thinks:true` and `thinksFor(part) === false`, and the plan must quote the truth.
 * @param {any} spec @param {any} part @returns {boolean} */
export function thinksFor(spec, part) {
  if (!spec) return false;
  if (typeof spec.thinksFor === 'function') {
    try { return !!spec.thinksFor(part); } catch { return !!spec.thinks; }
  }
  return !!spec.thinks;
}

/** The wall clock one part will spend WAITING, before the run starts (§4.6's plan-time refusal).
 * A spec may declare `plannedWaitMs(part, maxIterations)`; a Timer that has not declared one is
 * read from its own settings, which is the shape `graph/parts/timer.mjs` ships.
 * @param {any} part @param {any} spec @param {number} maxIterations @returns {number} */
export function plannedWaitMsOf(part, spec, maxIterations) {
  if (spec && typeof spec.plannedWaitMs === 'function') {
    try { return Math.max(0, Number(spec.plannedWaitMs(part, maxIterations)) || 0); } catch { return 0; }
  }
  if (!part || part.type !== 'timer') return 0;
  const s = (part && part.settings) || {};
  const seconds = Number.isFinite(Number(s.seconds)) ? Math.max(0, Number(s.seconds)) : 3;
  const cap = Number(maxIterations) > 0 ? Math.floor(Number(maxIterations)) : RUN_LIMITS.maxIterations;
  const repeats = Number.isFinite(Number(s.repeats)) ? Math.min(cap, Math.max(1, Math.floor(Number(s.repeats)))) : 1;
  return Math.round(seconds * 1000 * repeats);
}

/** Every part that lies ON a declared loop — the closed walk each back edge completes (§4.6). The
 * run plan multiplies these by `maxIterations` and nothing else, so the range it quotes is the
 * range the ceilings actually allow. @param {GraphDoc} doc @returns {string[]} */
export function loopParts(doc) {
  const backs = backEdges(doc);
  if (!backs.length) return [];
  const set = new Set();
  for (const w of backs) {
    const walk = cycleFor(doc, { from: w.from, to: w.to });
    if (walk) for (const id of walk) set.add(id);
    else { set.add(w.from); set.add(w.to); }
  }
  return doc.parts.map((p) => p.id).filter((id) => set.has(id));
}

/**
 * THE PROLOGUE (§4.2, frozen): the transitive forward-upstream parts of the seeds that hold no
 * value, so a ▶ pressed on an Instruction in a freshly imported template pulls what it needs
 * instead of refusing with `errNoInput`.
 *
 * It is a PULL, so it costs nothing on a warm graph: the walk STOPS at an ancestor that already
 * holds a value (it is read, never re-run) and at a `manual:true` ancestor (an unpressed Button is
 * never pressed on someone's behalf — the seed runs with what it has and the Button says so).
 *
 * @param {GraphDoc} doc @param {string[]} seeds @param {{specs?: Map<string, any>}} [opts]
 * @returns {string[]} in topological order
 */
export function unrunAncestors(doc, seeds, opts = {}) {
  const fwd = forwardEdges(doc);
  const ord = order(fwd);
  if (!ord.ok) return [];
  const specs = opts.specs instanceof Map ? opts.specs : new Map();
  const byId = new Map(fwd.parts.map((p) => [p.id, p]));
  const into = inEdges(fwd);
  const pull = new Set();
  const seen = new Set();
  /** @type {string[]} */ const stack = [];
  for (const id of Array.isArray(seeds) ? seeds : []) {
    if (byId.has(id) && !seen.has(id)) { seen.add(id); stack.push(id); }
  }
  while (stack.length) {
    const id = /** @type {string} */ (stack.pop());
    for (const from of into.get(id) || []) {
      if (seen.has(from)) continue;
      seen.add(from);
      const part = byId.get(from);
      if (!part) continue;
      const spec = specs.get(part.type);
      if (spec && spec.manual) continue;                       // an unpressed Button is not pulled
      if (holdsValue(part) && !isVolatile(part, spec)) continue; // already has an answer: read it
      pull.add(from);
      stack.push(from);
    }
  }
  return ord.ids.filter((id) => pull.has(id));
}

/** The pull set of §4.2, with `volatile` honoured: dirty is `idle|stale|error` OR never satisfied
 * by a stored value, and anything downstream of something dirty is dirty too.
 * @param {GraphDoc} fwd @param {string[]} ranked @param {Map<string, any>} specs @returns {string[]} */
function dirtyClosure(fwd, ranked, specs) {
  const byId = new Map(fwd.parts.map((p) => [p.id, p]));
  const into = inEdges(fwd);
  const need = new Set();
  for (const id of ranked) {
    const part = /** @type {any} */ (byId.get(id));
    const spec = part ? specs.get(part.type) : null;
    const dirty = !part || part.state === 'idle' || part.state === 'stale' || part.state === 'error'
      || isVolatile(part, spec);
    if (dirty || (into.get(id) || []).some((from) => need.has(from))) need.add(id);
  }
  return ranked.filter((id) => need.has(id));
}

/**
 * The ACTIVE SET `A` of one run (§4.2), in topological order over the forward graph. ONE function
 * for both entry points — there is deliberately no second code path.
 *
 *   mode 'all'   the pull set: dirty ∪ downstream(dirty), minus `manualRoots` and minus an
 *                `onlyWhenUsed` part nothing is wired from, `volatile` parts always dirty. An
 *                input-less `done` source stays done.
 *   mode 'from'  the push set: `unrunAncestors(seeds) ∪ seeds ∪ downstream(seeds)` — the PROLOGUE
 *                of §4.2. Every part in it executes regardless of its stored state, `manual`
 *                included (§6.6 excludes `manual` from RUN-ALL only).
 *   force        every part, `manualRoots` still excluded.
 *
 * A SEED is always in `A`, `manual` or not: pressing ▶ on a Button is exactly how a Button runs.
 *
 * @param {GraphDoc} doc @param {string[]} seeds
 * @param {{mode?: 'all'|'from'|'button', force?: boolean, specs?: Map<string, any>}} [opts]
 * @returns {string[]}
 */
export function activeSet(doc, seeds, opts = {}) {
  const fwd = forwardEdges(doc);
  const ord = order(fwd);
  if (!ord.ok) return [];
  const specs = opts.specs instanceof Map ? opts.specs : new Map();
  const manual = new Set(manualRoots(fwd, specs));
  // K4 kickoff (COMPUTER_PLAN §6.7, addendum KD-4): an `inert` part is never active, in any mode,
  // seed or not. The annotation parts (Sticky, Section, Title) exist for the reader: they have no
  // ports, no output and nothing to run, and a run that "ran" three of them would report a number
  // the reader cannot make sense of. This is the ONE place the flag is read, which is what keeps
  // the run loop, the run bar and the plan preview agreeing without any of them naming a type.
  const inert = new Set(fwd.parts
    .filter((p) => { const s = specs.get(p.type); return !!(s && /** @type {any} */ (s).inert); })
    .map((p) => p.id));
  // NOT `partById` from model.mjs: model.mjs imports this file, so topo stays import-free.
  const live = new Set(fwd.parts.map((p) => p.id));
  const seedIds = (Array.isArray(seeds) ? seeds : []).filter((id) => live.has(id));
  const isSeed = new Set(seedIds);
  // K6 fix round: an `onlyWhenUsed` part with no wire drawn from it (a Document box nothing reads)
  // is left out of a RUN-ALL — running it would send a PDF to the farm's reader for nobody. ▶ on
  // its own face is a seed, and a seed always runs.
  const wiredFrom = new Set((Array.isArray(doc.wires) ? doc.wires : []).map((w) => w && w.from).filter(Boolean));
  const unused = new Set(fwd.parts
    .filter((p) => { const s = specs.get(p.type); return !!(s && /** @type {any} */ (s).onlyWhenUsed) && !wiredFrom.has(p.id); })
    .map((p) => p.id));
  const keep = (/** @type {string} */ id) => !inert.has(id) && (!manual.has(id) || isSeed.has(id)) && (!unused.has(id) || isSeed.has(id));
  if (opts.mode === 'from' || opts.mode === 'button') {
    const want = new Set([
      ...seedIds,
      ...downstream(fwd, seedIds),
      ...unrunAncestors(fwd, seedIds, { specs }),
    ]);
    // `manual` is NOT filtered here (K3 landing, §6.6): a manual part is excluded from RUN-ALL
    // only. A wave that reaches a Button must ACTIVATE it — that is the only way it can bar the
    // wave and glow "ready — click to continue" — and a ▶ on the Button's own face is a seed.
    // The prologue still refuses to PULL an unpressed Button from upstream (`unrunAncestors`
    // stops at one), so a push never presses a button nobody touched.
    return ord.ids.filter((id) => want.has(id) && !inert.has(id));
  }
  if (opts.force) return ord.ids.filter(keep);
  return dirtyClosure(fwd, ord.ids, specs).filter(keep);
}
