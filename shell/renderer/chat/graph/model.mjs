// @ts-check
// C1-U1 — the graph document and every legal mutation of it (plan §2.6 BG-4). PURE.
//
// Two invariants hold this file together:
//   1. EVERY exported function returns a NEW doc and never mutates its argument. Undo is a
//      snapshot stack (graph/undo.mjs), so one shared mutation would rewrite history retroactively.
//   2. A doc that leaves this module is always RUNNABLE: no unknown part type, no dangling wire,
//      no duplicate wire, no cycle. `normaliseDoc` is the gate — the store's read path, the
//      import path and the tests all go through it, so a hand-edited file or a row written by a
//      later phase cannot produce a canvas the runner chokes on.
//
// Semantic edits (settings, wires, deletions) mark the part and everything downstream STALE.
// Cosmetic edits (move, resize, view) and runtime writes (patchPart) mark nothing.

import { markStale, cycleFor, gatedLoop } from './topo.mjs';
import { accepts, isValue, valueOf, isRepeatList, facetsOf } from './values.mjs';
import { MAX_ITEM_ERRORS } from './fanout.mjs';

/** @typedef {import('../core/types.mjs').GraphDoc} GraphDoc */
/** @typedef {import('../core/types.mjs').GraphPart} GraphPart */
/** @typedef {import('../core/types.mjs').GraphWire} GraphWire */

export const DEFAULT_SIZE = Object.freeze({ w: 220, h: 120 });
export const DEFAULT_VIEW = Object.freeze({ x: 0, y: 0, zoom: 1 });

/**
 * K2-U1 (COMPUTER_PLAN §5.1) — the DISPLAY form of a wire label: trimmed, runs of whitespace
 * collapsed, the reader's OWN case kept, because the user's own spelling is what the model sees as
 * a `##` heading. A label that normalises to empty IS an unlabelled arrow (§5.2 rule 8), so the
 * stored form of "no name" is exactly `''` and never `null`.
 *
 * This is `bind.mjs`'s `labelName` written twice ON PURPOSE: `bind.mjs` imports this module, so
 * this module cannot import `bind.mjs` without a cycle. `computer-label.test.mjs` asserts the two
 * agree over a table of awkward inputs, so the duplication cannot drift unnoticed.
 * @param {any} raw @returns {string}
 */
export function wireLabel(raw) {
  // Anything that is not a string came from a hand-edited file or a later format, not from a
  // reader typing a name: it is an unlabelled arrow, never `[object Object]` painted on a pill.
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
}

/** The part states, in the order they occur in a run. `patchPart` refuses anything else.
 * K3 kickoff (COMPUTER_PLAN §4.1): `waiting` is an activation PARKED on a human or a clock — a
 * Confirm showing OK/Cancel, a Dialog holding its question, a Timer counting down. Other branches
 * keep running past it, so it is a state of one part and never of the run. */
export const STATES = Object.freeze(['idle', 'stale', 'queued', 'running', 'waiting', 'done', 'error']);

/** Why `addWire` refused. FROZEN (plan §2.6 BG-4): each maps to exactly one `graph.wire*` string,
 * and the engine never returns a sentence.
 * K3-U2 (COMPUTER_PLAN §4.6): a wire that merely closes a loop is no longer refused — it is
 * created with `back:true`. `cycle` stays in the frozen list, and stays in the canvas's sentence
 * table, because a document written by a client that refuses loops can still carry the code and a
 * reader must still get a sentence; nothing in this file returns it any more. `loop-ungated` is
 * what took its place, and it is the strongest safety property in the build: a cycle containing
 * nothing that can stop it is a gesture the canvas will not complete. */
export const WIRE_REASONS = Object.freeze([
  'self', 'cycle', 'duplicate', 'no-output', 'unknown-port', 'type', 'unknown-part', 'loop-ungated',
]);

/** @param {{id: string, threadId: string|null, title?: string, now?: () => number}} o @returns {GraphDoc} */
export function createDoc(o) {
  const now = ((o && o.now) || Date.now)();
  return /** @type {any} */ ({
    id: o.id,
    threadId: o.threadId === undefined ? null : o.threadId,
    title: o.title || '',
    createdAt: now,
    updatedAt: now,
    rev: 1,
    parts: [],
    wires: [],
    settings: {},
    view: { ...DEFAULT_VIEW },
  });
}

/** @param {GraphDoc} doc @param {string} id @returns {GraphPart|null} */
export function partById(doc, id) {
  return doc.parts.find((p) => p.id === id) || null;
}

/** @param {GraphDoc} doc @param {{now?: () => number}} [o] @returns {GraphDoc} */
const bump = (doc, o = {}) => ({ ...doc, rev: (Number(doc.rev) || 0) + 1, updatedAt: (o.now || Date.now)() });

/** @param {any} n @param {number} fallback @returns {number} */
const num = (n, fallback) => (Number.isFinite(Number(n)) ? Number(n) : fallback);

/** @param {any} o @returns {object} */
const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});

/** The part type's declared inputs. @param {any} spec @returns {any[]} */
const inputsOfSpec = (spec) => (spec && Array.isArray(spec.inputs) ? spec.inputs : []);

/**
 * Port names a later build renamed, by part type. K2 landing: the C1 `ask`'s `context` port became
 * the Instruction's single `in` (COMPUTER_PLAN §5.2 rule 7). Every graph the owner already drew
 * stores `port: 'context'`, and `normaliseDoc` refuses an unknown port — so without this table the
 * catalogue swap would silently drop every wire into every Instruction on load, which is exactly
 * the quiet loss §1.3 rule 4 bans. Applied on the way IN only: what is stored afterwards is the
 * live name, so the rename is paid once per document.
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
const PORT_ALIASES = Object.freeze({ ask: Object.freeze({ context: 'in' }) });

/**
 * The port this wire means today: its own name, or the live name a rename maps it to when the
 * target part no longer declares it.
 * @param {any} toPart @param {any} toSpec @param {string} port @returns {string}
 */
function livePort(toPart, toSpec, port) {
  const ports = inputsOfSpec(toSpec);
  if (ports.some((p) => p && p.name === port)) return port;
  const table = toPart && PORT_ALIASES[toPart.type];
  const renamed = table && table[port];
  return renamed && ports.some((p) => p && p.name === renamed) ? renamed : port;
}

/**
 * Does this edge close a loop, and may it? The ONE predicate for both halves of §4.6, so the
 * refusal and the `back` stamp can never disagree about which edges the ordering must ignore:
 *   ''         it closes nothing — an ordinary forward arrow
 *   'gated'    it closes a cycle that holds a Toggle, Condition, Confirm, Dialog, Button or Timer
 *   'ungated'  it closes a cycle nothing can stop, and `wireRefusal` says so in words
 * @param {GraphDoc} doc @param {{from: string, to: string}} edge @param {Map<string, any>} specs
 * @returns {''|'gated'|'ungated'}
 */
function closesLoop(doc, edge, specs) {
  if (!edge || !edge.from || !edge.to || edge.from === edge.to) return '';
  const cycle = cycleFor(doc, edge);
  if (!cycle) return '';
  return gatedLoop(doc, cycle, specs) ? 'gated' : 'ungated';
}

/**
 * Why this wire cannot exist, or null when it can. The ONE place the reason codes are decided —
 * `addWire` and `normaliseDoc` both call it, so an imported file is filtered by exactly the rule
 * the canvas enforces.
 * @param {GraphDoc} doc @param {{from: string, to: string, port: string}} edge
 * @param {Map<string, any>} specs @returns {string|null}
 */
function wireRefusal(doc, edge, specs) {
  const from = partById(doc, edge.from);
  const to = partById(doc, edge.to);
  if (!from || !to) return 'unknown-part';
  if (edge.from === edge.to) return 'self';
  const fromSpec = specs.get(from.type);
  const toSpec = specs.get(to.type);
  if (!fromSpec || !fromSpec.output) return 'no-output';
  // K3 kickoff (COMPUTER_PLAN §6.6): a control part declares `output:'any'` — "whatever came in,
  // passed through". There is no such VALUE kind, so the outgoing type check below is skipped for
  // it; the value the part really returns still carries a real kind and is checked where it is
  // read. Without this a Toggle could only ever feed a port that accepts text.
  const anyOut = fromSpec.output === 'any';
  const port = inputsOfSpec(toSpec).find((p) => p && p.name === edge.port) || null;
  if (!port) return 'unknown-port';
  if (doc.wires.some((w) => w.from === edge.from && w.to === edge.to && w.port === edge.port)) return 'duplicate';
  // A port that declares `many:false` holds exactly one wire. There is no separate reason code in
  // the frozen set, and "this port is already taken" IS a duplicate from the user's side.
  if (port.many === false && doc.wires.some((w) => w.to === edge.to && w.port === edge.port)) return 'duplicate';
  // K3-U2 (COMPUTER_PLAN §4.6): a cycle is LEGAL and DECLARED. `cycleFor` answers with the closed
  // walk the edge would make, over the FORWARD graph, so a loop that already exists does not make
  // every later edge look like a second one. The only cycle still refused is one that contains
  // nothing that can stop it — `loop-ungated`, checked here, at draw time, O(V+E). That refusal is
  // the strongest safety property in the build: a runaway is not a bug to catch at run time, it is
  // a gesture the canvas will not complete. A self-wire never reaches this line (`self`, above).
  if (closesLoop(doc, edge, specs) === 'ungated') return 'loop-ungated';
  // The check is on the port's KIND, not on a value: wiring happens before anything has run.
  if (!anyOut && accepts(port.accepts, valueOf(fromSpec.output, null)) === 'no') return 'type';
  return null;
}

/**
 * The per-item record of a fan-out (§2.6 BH-3), cleaned — the ONE definition, read by `patchPart`
 * on the way in and by `normalisePart` on the way back from the store. It used to exist only on the
 * way in, so `7/40` and the list of failed items survived a run and then vanished on reload while
 * `stats` and `error` came back: the quiet loss §1.2 bans, on the one field C2 exists to produce
 * (fix pass, finding 2).
 * @param {any} f @returns {{n: number, done: number, ok: number, failed: number, hidden: number,
 *   errors: {i: number, message: string}[]}|null}
 */
function normaliseFanout(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return null;
  const errors = (Array.isArray(f.errors) ? f.errors : [])
    .filter((/** @type {any} */ e) => e && typeof e === 'object')
    .slice(0, MAX_ITEM_ERRORS)
    .map((/** @type {any} */ e) => ({ i: num(e.i, 0), message: String(e.message || '') }));
  const failed = num(f.failed, 0);
  return {
    n: num(f.n, 0),
    done: num(f.done, 0),
    ok: num(f.ok, 0),
    failed,
    // What the record no longer carries, either because the run dropped it past the cap or because
    // this row was written before the cap existed. Counted, never guessed away.
    hidden: Math.max(num(f.hidden, 0), failed - errors.length),
    errors,
  };
}

/**
 * A part's runtime stats, cleaned — the ONE definition, read by `patchPart` on the way in and by
 * `normalisePart` on the way back from the store (the lesson `normaliseFanout` taught). Critic R1
 * (K-5): `seed` (the whole number the last run's first item was sent, 0..2^31-1) and `pinned`
 * survive, and so does `cut` (an answer hit max_tokens) — each only when really there, so a stats
 * object from before R1 round-trips unchanged.
 * @param {any} s @returns {{ms: number, tokens: number, calls: number, seed?: number,
 *   pinned?: boolean, cut?: boolean}|null}
 */
function normaliseStats(s) {
  if (!s || typeof s !== 'object') return null;
  /** @type {any} */ const out = { ms: num(s.ms, 0), tokens: num(s.tokens, 0), calls: num(s.calls, 0) };
  const seed = Number(s.seed);
  if (s.seed !== null && s.seed !== undefined && s.seed !== '' && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff) {
    out.seed = seed;
    out.pinned = s.pinned === true;
  }
  if (s.cut === true) out.cut = true;
  return out;
}

/** One stored part, cleaned. @param {any} raw @param {any} spec @returns {GraphPart} */
function normalisePart(raw, spec) {
  const size = obj(spec && spec.size);
  const state = STATES.includes(raw.state) ? raw.state : 'idle';
  // K2 kickoff (COMPUTER_PLAN §6.8): the facets ride along. This line used to strip a value to
  // `{kind, data}`, which is the ONE place a `format`/`lang` was silently lost on reload — a Note
  // came back as `plain` and its markdown stopped being fenced as markdown in the next prompt.
  const value = isValue(raw.value)
    ? { kind: raw.value.kind, data: raw.value.data, ...facetsOf(raw.value) }
    : null;
  // A list may say its identical items are deliberate (Repeat). That belongs to the VALUE, so it
  // has to survive the round trip or a reloaded Repeat would collapse its four passes into one.
  if (value && isRepeatList(raw.value)) /** @type {any} */ (value).repeats = true;
  const stats = normaliseStats(raw.stats);
  return /** @type {any} */ ({
    id: String(raw.id),
    type: raw.type,
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    w: num(raw.w, num(size.w, DEFAULT_SIZE.w)),
    h: num(raw.h, num(size.h, DEFAULT_SIZE.h)),
    settings: { ...(typeof spec.defaults === 'function' ? obj(spec.defaults()) : {}), ...obj(raw.settings) },
    value,
    // A part that carries a value but claims to be running/queued was interrupted by a crash: it
    // comes back STALE, never mid-flight, so Run can finish it and nothing shows a spinner forever.
    // K3 kickoff (COMPUTER_PLAN §0.3, §7.5): `waiting` joins them. A Dialog that was holding a
    // question when the app closed has no stored answer, so it must come back asking — which is
    // what `stale` means here, and what makes Resume honest.
    state: state === 'running' || state === 'queued' || state === 'waiting' ? 'stale' : state,
    error: typeof raw.error === 'string' && raw.error ? raw.error : null,
    stats,
    fanout: normaliseFanout(raw.fanout),
    // K5 kickoff (addendum KE-7): the demo badge describes the VALUE, so it survives only while
    // there is one. A flag with no value would be a badge on nothing.
    ...(raw.demo === true && value ? { demo: true } : {}),
  });
}

/**
 * Clean an untrusted object into a runnable doc. Drops parts of unknown types and wires that no
 * longer connect anything, and SAYS SO in `dropped` (`'part:<reason>'` / `'wire:<reason>'`) — that
 * is what makes a C2/C3 graph survive being opened by a C1 client, and an import survive a
 * hand-edited file.
 * @param {any} raw @param {{specs: Map<string, any>, now?: () => number}} o
 * @returns {{doc: GraphDoc, dropped: string[]}}
 */
export function normaliseDoc(raw, o) {
  const now = ((o && o.now) || Date.now)();
  const specs = o && o.specs instanceof Map ? o.specs : new Map();
  const base = obj(raw);
  /** @type {string[]} */ const dropped = [];

  /** @type {GraphPart[]} */ const parts = [];
  const seenPart = new Set();
  for (const p of Array.isArray(base.parts) ? base.parts : []) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) { dropped.push('part:no-id'); continue; }
    if (seenPart.has(p.id)) { dropped.push('part:duplicate'); continue; }
    const spec = specs.get(p.type);
    if (!spec) { dropped.push('part:unknown-type'); continue; }
    seenPart.add(p.id);
    parts.push(normalisePart(p, spec));
  }

  // Wires are admitted one at a time against the doc built SO FAR, so the cycle and duplicate
  // rules see the same graph the canvas would.
  /** @type {GraphDoc} */ let doc = /** @type {any} */ ({
    id: typeof base.id === 'string' ? base.id : '',
    threadId: base.threadId === undefined ? null : base.threadId,
    title: typeof base.title === 'string' ? base.title : '',
    createdAt: num(base.createdAt, now),
    updatedAt: num(base.updatedAt, now),
    rev: num(base.rev, 1),
    parts,
    wires: [],
    settings: obj(base.settings),
    view: normaliseView(base.view),
  });
  const seenWire = new Set();
  for (const w of Array.isArray(base.wires) ? base.wires : []) {
    if (!w || typeof w !== 'object' || typeof w.from !== 'string' || typeof w.to !== 'string') {
      dropped.push('wire:malformed');
      continue;
    }
    const stored = typeof w.port === 'string' && w.port ? w.port : '';
    const target = partById(doc, w.to);
    const port = livePort(target, target ? specs.get(target.type) : null, stored);
    const refusal = wireRefusal(doc, { from: w.from, to: w.to, port }, specs);
    if (refusal) { dropped.push(`wire:${refusal}`); continue; }
    const id = typeof w.id === 'string' && w.id && !seenWire.has(w.id) ? w.id : `w:${w.from}:${w.to}:${port}`;
    seenWire.add(id);
    // K3: `back` survives a round-trip, and is RE-DERIVED rather than trusted. A stored
    // `back:true` on an edge the live graph no longer sees as a loop is dropped to false, so a
    // hand-edited file cannot smuggle a back edge into a plain DAG and disable its ordering; a
    // stored `back:false` on an edge that really does close one is raised to true, so a file
    // written before K3 loads as the loop it draws instead of as a document `order()` refuses.
    const back = refusal === null && !!closesLoop(doc, { from: w.from, to: w.to }, specs);
    doc = { ...doc, wires: [...doc.wires, { id, from: w.from, to: w.to, port, label: wireLabel(w.label), back }] };
  }
  return { doc, dropped };
}

/** @param {any} view @returns {{x: number, y: number, zoom: number}} */
function normaliseView(view) {
  const v = obj(view);
  const zoom = num(/** @type {any} */ (v).zoom, DEFAULT_VIEW.zoom);
  return {
    x: num(/** @type {any} */ (v).x, DEFAULT_VIEW.x),
    y: num(/** @type {any} */ (v).y, DEFAULT_VIEW.y),
    zoom: zoom > 0 ? zoom : DEFAULT_VIEW.zoom,
  };
}

/** K5 kickoff (addendum KE-2): `w`/`h` override the spec's size — a palette PRESET places a
 * "three.js scene" bigger than a bare Preview. Absent, today's behaviour.
 * @param {GraphDoc} doc
 * @param {{type: string, x: number, y: number, settings?: object, w?: number, h?: number}} spec
 *  @param {{specs: Map<string, any>, newId: () => string, now?: () => number}} o
 *  @returns {{doc: GraphDoc, part: GraphPart|null}} */
export function addPart(doc, spec, o) {
  const def = o.specs.get(spec && spec.type);
  if (!def) return { doc, part: null };
  const size = obj(def.size);
  const part = /** @type {any} */ ({
    id: o.newId(),
    type: spec.type,
    x: num(spec.x, 0),
    y: num(spec.y, 0),
    w: num(/** @type {any} */ (spec).w, num(/** @type {any} */ (size).w, DEFAULT_SIZE.w)),
    h: num(/** @type {any} */ (spec).h, num(/** @type {any} */ (size).h, DEFAULT_SIZE.h)),
    settings: { ...(typeof def.defaults === 'function' ? obj(def.defaults()) : {}), ...obj(spec.settings) },
    value: null,
    state: 'idle',
    error: null,
    stats: null,
  });
  return { doc: bump({ ...doc, parts: [...doc.parts, part] }, o), part };
}

/** Removing a part removes its wires and marks whatever it fed stale.
 * @param {GraphDoc} doc @param {string[]} ids @param {{now?: () => number}} [o] @returns {GraphDoc} */
export function removeParts(doc, ids, o = {}) {
  const gone = new Set((Array.isArray(ids) ? ids : []).filter((id) => partById(doc, id)));
  if (!gone.size) return doc;
  const parts = doc.parts.filter((p) => !gone.has(p.id));
  const wires = doc.wires.filter((w) => !gone.has(w.from) && !gone.has(w.to));
  const orphaned = [...new Set(doc.wires.filter((w) => gone.has(w.from) && !gone.has(w.to)).map((w) => w.to))];
  return markStale(bump({ ...doc, parts, wires }, o), orphaned, o);
}

/** @param {GraphDoc} doc @param {string} id @param {{x: number, y: number}} at
 *  @param {{now?: () => number}} [o] @returns {GraphDoc} */
export function movePart(doc, id, at, o = {}) {
  if (!partById(doc, id)) return doc;
  return bump({
    ...doc,
    parts: doc.parts.map((p) => (p.id === id ? { ...p, x: num(at && at.x, p.x), y: num(at && at.y, p.y) } : p)),
  }, o);
}

/** @param {GraphDoc} doc @param {string} id @param {{w: number, h: number}} size
 *  @param {{now?: () => number}} [o] @returns {GraphDoc} */
export function resizePart(doc, id, size, o = {}) {
  if (!partById(doc, id)) return doc;
  return bump({
    ...doc,
    parts: doc.parts.map((p) => (p.id === id
      ? { ...p, w: Math.max(80, num(size && size.w, p.w)), h: Math.max(60, num(size && size.h, p.h)) }
      : p)),
  }, o);
}

/** Editing a part's settings marks it and everything downstream stale (spec §2).
 * @param {GraphDoc} doc @param {string} id @param {object} patch
 * @param {{specs?: Map<string, any>, now?: () => number}} [o] @returns {GraphDoc} */
export function setSettings(doc, id, patch, o = {}) {
  const part = partById(doc, id);
  if (!part) return doc;
  const next = bump({
    ...doc,
    parts: doc.parts.map((p) => (p.id === id ? { ...p, settings: { ...obj(p.settings), ...obj(patch) } } : p)),
  }, o);
  return markStale(next, [id], o);
}

/** Runtime fields only (state/value/error/stats). NEVER undoable, never marks anything stale, and
 * never bumps `rev` — a run is not an edit of the program.
 * @param {GraphDoc} doc @param {string} id @param {object} patch
 * @param {{now?: () => number}} [o] @returns {GraphDoc} */
export function patchPart(doc, id, patch, o = {}) {
  if (!partById(doc, id)) return doc;
  /** @type {Record<string, any>} */ const next = {};
  const p = obj(patch);
  if ('state' in p && STATES.includes(/** @type {any} */ (p).state)) next.state = /** @type {any} */ (p).state;
  if ('value' in p) next.value = isValue(/** @type {any} */ (p).value) ? /** @type {any} */ (p).value : null;
  if ('error' in p) {
    const e = /** @type {any} */ (p).error;
    next.error = typeof e === 'string' && e ? e : null;
  }
  if ('stats' in p) next.stats = normaliseStats(/** @type {any} */ (p).stats);
  // C2 (§2.6 BH-3): the per-item record of a fan-out. A runtime field like the four above — it is
  // what the canvas reads to paint `7/40` and the per-item failures, and it is DROPPED, not
  // trusted, when it is not the shape below.
  if ('fanout' in p) next.fanout = normaliseFanout(/** @type {any} */ (p).fanout);
  // K5 kickoff (addendum KE-7): the demo badge. Said explicitly, it is set or cleared; NOT said,
  // any patch that writes a value clears it — a real generation never inherits a recorded
  // answer's badge, which is the whole of "we never let the app pretend it generated something".
  if ('demo' in p) next.demo = /** @type {any} */ (p).demo === true;
  else if ('value' in p) next.demo = false;
  if (!Object.keys(next).length) return doc;
  return {
    ...doc,
    updatedAt: (o.now || Date.now)(),
    parts: doc.parts.map((pt) => (pt.id === id ? { ...pt, ...next } : pt)),
  };
}

/** @param {GraphDoc} doc @param {{from: string, to: string, port: string, label?: string}} edge
 *  @param {{specs: Map<string, any>, newId: () => string, now?: () => number}} o
 *  @returns {{ok: true, doc: GraphDoc, wire: GraphWire}|{ok: false, reason: string}} */
export function addWire(doc, edge, o) {
  const specs = o && o.specs instanceof Map ? o.specs : new Map();
  const want = {
    from: edge && typeof edge.from === 'string' ? edge.from : '',
    to: edge && typeof edge.to === 'string' ? edge.to : '',
    port: edge && typeof edge.port === 'string' ? edge.port : '',
  };
  const refusal = wireRefusal(doc, want, specs);
  if (refusal) return { ok: false, reason: refusal };
  const wire = /** @type {any} */ ({
    id: o.newId(), from: want.from, to: want.to, port: want.port, label: wireLabel(edge && edge.label),
    // K3-U2: the loop DECLARATION (§4.6). `wireRefusal` above has already let this edge through,
    // so a cycle here is a GATED one; `closesLoop` is the same predicate that decided the refusal,
    // which is what makes it impossible for the two to disagree about which edges `order()` must
    // ignore. A declared back edge is drawn dashed with a `↺` and carries the loop's unit delay.
    back: !!closesLoop(doc, want, specs),
  });
  return { ok: true, doc: markStale(bump({ ...doc, wires: [...doc.wires, wire] }, o), [want.to], o), wire };
}

/**
 * Name a wire (K2-U1, COMPUTER_PLAN §5.1). A label is a PROGRAM edit, not a decoration: it changes
 * which parameter an input arrives as, so it bumps `rev`, it is undoable at the caller, and it
 * marks `to` and everything downstream STALE — renaming `country` to `topic` must make the
 * Instruction below re-run, or the canvas would show an answer built from a heading that no longer
 * exists. Renaming to the same normalised text is NOT an edit: it returns the doc untouched, so a
 * blur that changed nothing costs neither an undo entry nor a re-run.
 * @param {GraphDoc} doc @param {string} wireId @param {any} label @param {{now?: () => number}} [o]
 * @returns {GraphDoc}
 */
export function setWireLabel(doc, wireId, label, o = {}) {
  const w = doc.wires.find((x) => x.id === wireId);
  if (!w) return doc;
  const next = wireLabel(label);
  if (next === wireLabel(/** @type {any} */ (w).label)) return doc;
  const wires = doc.wires.map((x) => (x.id === wireId ? { ...x, label: next } : x));
  return markStale(bump({ ...doc, wires }, o), [w.to], o);
}

/** @param {GraphDoc} doc @param {string} wireId @param {{now?: () => number}} [o] @returns {GraphDoc} */
export function removeWire(doc, wireId, o = {}) {
  const w = doc.wires.find((x) => x.id === wireId);
  if (!w) return doc;
  return markStale(bump({ ...doc, wires: doc.wires.filter((x) => x.id !== wireId) }, o), [w.to], o);
}

/** The WIRES into each input port, in wire order — what `inputsOf` answers, with the wire itself
 * instead of only its source id. K2 (COMPUTER_PLAN §5) needs the wire because the LABEL lives on
 * it: the runner walks these to hand a part `labels` alongside `inputs`, in the same order.
 * @param {GraphDoc} doc @param {string} partId @returns {Record<string, GraphWire[]>} */
export function wiresInto(doc, partId) {
  /** @type {Record<string, GraphWire[]>} */ const out = {};
  for (const w of doc.wires) {
    if (w.to !== partId) continue;
    (out[w.port] = out[w.port] || []).push(w);
  }
  return out;
}

/** Source part ids per input port, in wire order (several wires into one port arrive as a list).
 * @param {GraphDoc} doc @param {string} partId @returns {Record<string, string[]>} */
export function inputsOf(doc, partId) {
  /** @type {Record<string, string[]>} */ const out = {};
  for (const w of doc.wires) {
    if (w.to !== partId) continue;
    (out[w.port] = out[w.port] || []).push(w.from);
  }
  return out;
}

/** Pan/zoom is not a document edit: not undoable, never marks anything stale, never bumps `rev`.
 * @param {GraphDoc} doc @param {{x: number, y: number, zoom: number}} view @returns {GraphDoc} */
export function setView(doc, view) {
  return { ...doc, view: normaliseView(view) };
}
