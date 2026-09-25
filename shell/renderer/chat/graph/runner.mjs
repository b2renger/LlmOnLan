// @ts-check
// The run engine (plan §2.6 BG-6 + BH-2/BH-4/BH-6/BH-8, COMPUTER_PLAN §4): ONE scheduler for both
// entry points — Run-all pulls the stale closure, a box's ▶ pushes forward from a seed — with
// barriers, parks, loops, four ceilings and a run journal. ONE request in flight, at BACKGROUND
// priority, abortable, and — since C2 — fanned out over the items of a list.
//
// Everything here exists to make these sentences true:
//
//   1. "A 30-part graph costs one generation after a typo fix." The active set comes from topo.mjs
//      (a `done` part whose whole upstream is `done` is skipped), so a re-run touches the dirty
//      subgraph and nothing else. `only` narrows it further for a per-part Re-run.
//   2. "A human typing always wins." Every thinking part goes through `app.ask` at
//      `priority:'background'` — the governor's background lane, which the reader's next Send
//      aborts outright. That abort is NOT an error: the part goes back to `stale`, every finished
//      value stays, and the report says `yielded`.
//   3. "Stop keeps what you already paid for." `stop()` aborts the ONE in-flight request AND
//      cancels every park (§4.8). The part that was running returns to `stale` with `error:null`.
//   4. "One bad part never ends the run." A part that throws goes `error`; everything downstream of
//      it is left `stale`, skipped, and counted — the rest of the active set still executes.
//   5. "One bad ITEM never ends the run either" (§2.6 BH-3). A fanned part runs once per item; an
//      item that throws is recorded in `part.fanout.errors` and its siblings carry on.
//   6. "A graph cannot quietly spend the farm." The cap is counted in GENERATIONS, in the wrapper
//      that makes them (§2.6 BH-4), and three more ceilings bound a run that spends nothing and
//      grinds anyway (§4.6). Every one of them is a STOP, not an error, and every one is raisable
//      for that run.
//   7. "▶ means do this again, here." `mode:'from'` marks the seed and its downstream stale and
//      runs that closure, after PULLING the seed's unrun ancestors (§4.2's prologue) — so the
//      headline button on a freshly imported template works instead of refusing `errNoInput`.
//   8. "A question never stops the other branches." A part that returns `{park, settle}` goes
//      `waiting`; the loop keeps serving every branch that is still ready and only suspends when
//      nothing else CAN run (§4.3).
//   9. "The press is never swallowed." A ▶ pressed mid-run MERGES into the live run (§4.4).
//  10. "Run it again gives a new answer" (critic R1 A1). Every run mints a NONCE; every activation
//      hands its part a SEED (`input.seed`) derived from it — or from the part's pinned
//      `settings.seed` — and the Instruction sends it. A new seed is a new cache key, so ▶ twice is
//      two generations; a pinned seed is honestly the same answer, from the cache or the farm.
//      Stop / yield / cap CARRY the interrupted part's nonce to its next run, so the items it had
//      already paid for come back from the cache for free (sentence 3 stays true).
//  11. "An edit made while a box runs is never overwritten" (critic R1 B2). The answer that comes
//      back for the OLD settings is kept, but the box stays `stale` and the run does not count it.
//
// THE SCAN IS DELIBERATELY O(n) PER ACTIVATION (§4.3) and `order()` is recomputed every iteration:
// that is what makes the loop restartable, mergeable, loop-safe and editable-during-a-run with no
// cursor. A LATER OPTIMISER MUST NOT REINTRODUCE A CURSOR.
//
// THE QUEUE IS DELIBERATELY NOT `app.ask.queue` (BG-6 stands, restated in BH-5): the runner is
// serial, owns its own progress, and has its own cap.

import {
  order, forwardEdges, backEdges, cycleFor, activeSet, isBack, runPlan,
} from './topo.mjs';
import { wiresInto, partById } from './model.mjs';
import { accepts, isValue } from './values.mjs';
import { planFan, joinResults, fanoutRecord } from './fanout.mjs';
import { KV_KEYS, RUN_LIMITS } from '../core/types.mjs';
import { createJournal } from './journal.mjs';
import { cancelAll as cancelParks, answer as answerPark } from './parts/control-bus.mjs';
import { parseSeed, baseSeed, seedFor } from './bind.mjs';
import { t } from '../core/i18n.mjs';
import '../strings/parts.en.mjs';

/** @typedef {import('../core/types.mjs').RunReport} RunReport */
/** @typedef {import('../core/types.mjs').GraphValue} GraphValue */

/** Generations one Run may spend before it stops and asks (spec §2, `pref:computeMaxItems`). It is
 * also the ITEM ceiling: a single fan may not exceed it either (see the loop below). */
export const DEFAULT_MAX_ITEMS = 50;

/** How long the run may hold the main thread before handing it back (fix pass, finding 1).
 * `await spec.run(...)` is not a suspension point when the part makes no farm call — a promise that
 * resolves on the microtask queue keeps the SAME macrotask — so a fan over a free part ran
 * thousands of items in one unbroken stretch: the `7/40` badge could not paint and Stop could not
 * be clicked. Eight milliseconds is half a 60 Hz frame. §4.3 adds: a LOOP yields between
 * iterations too, which this same slice does, because every activation passes through it. */
export const YIELD_SLICE_MS = 8;
/** A run of more than this many parts yields once after marking them queued (perf pass, 2026-09-25). */
export const BIG_RUN = 50;

/** A REAL macrotask, so a pending timer, a click and a paint all get their turn. Deliberately
 * `setTimeout` and not `queueMicrotask`/`await null`: a microtask would not let ANY of them run. */
const breathe = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** The reason half of a part's failure (§2.6 BH-4). Read here rather than imported from
 * parts/common.mjs so the engine stays loadable with no DOM in a unit test.
 * @param {any} err @returns {string} */
function reasonOf(err) {
  return String((err && /** @type {any} */ (err).reason) || 'part');
}

/** @param {any} err @returns {string} */
function messageOf(err) {
  return String((err && /** @type {any} */ (err).message) || err);
}

/** Is this what a part returns when it SUSPENDS (§4.5's fourth shape)? @param {any} out */
function isPark(out) {
  return !!out && typeof out === 'object' && !Array.isArray(out)
    && !!(/** @type {any} */ (out).park) && !!(/** @type {any} */ (out).settle);
}

/** Collapse a settled `PartOutcome` to the value and the barrier flag (§4.5). A GraphValue has a
 * `kind`; a control outcome is `{value, bar}` and has none. @param {any} out
 * @returns {{value: any, bar: boolean}} */
function unwrapOutcome(out) {
  if (out && typeof out === 'object' && !Array.isArray(out) && !('kind' in out) && 'value' in out) {
    return { value: /** @type {any} */ (out).value, bar: !!(/** @type {any} */ (out).bar) };
  }
  return { value: out, bar: false };
}

/** part id → the ids feeding it, over the FORWARD graph only: a back edge must never make a part
 * wait, or a loop head deadlocks forever (§4.6). @param {any} fwd @returns {Map<string, string[]>} */
function forwardInto(fwd) {
  /** @type {Map<string, string[]>} */ const into = new Map();
  for (const p of fwd.parts) into.set(p.id, []);
  for (const w of fwd.wires) {
    const list = into.get(w.to);
    if (list && into.has(w.from)) list.push(w.from);
  }
  return into;
}

/** part id → the ids it feeds. @param {any} doc @returns {Map<string, string[]>} */
function outOf(doc) {
  /** @type {Map<string, string[]>} */ const out = new Map();
  for (const p of doc.parts) out.set(p.id, []);
  for (const w of doc.wires) {
    const list = out.get(w.from);
    if (list && out.has(w.to)) list.push(w.to);
  }
  return out;
}

/** A journal that is not there behaves exactly like one that is, minus the writing. */
const NO_JOURNAL = {
  id: null,
  row: () => null,
  event() {},
  wait() {},
  resume() {},
  iteration() {},
  spend() {},
  status() {},
  close: async () => {},
  flush: async () => {},
};

/** A run's nonce: 32 random bits from the platform's CSPRNG (a Math.random floor where there is
 * none). Only its DIFFERENCE from the last run matters — it is what makes ▶ twice two seeds. */
function mintNonce() {
  try {
    const c = /** @type {any} */ (globalThis).crypto;
    if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(new Uint32Array(1))[0] >>> 0;
  } catch { /* fall through */ }
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/** @param {{session: any, app: any, nonce?: () => number}} o */
export function createRunner(o) {
  const session = o.session;
  const app = o.app;
  /** Where a run's nonce comes from. Injectable so a unit test can name the seeds it expects. */
  const nextNonce = typeof o.nonce === 'function' ? o.nonce : mintNonce;
  /**
   * Critic R1 A1: the nonce a part was interrupted under, by `<docId>|<partId>`, for the life of
   * this runner. Set when a part ends yielded / capped / cancelled; its next activation uses it
   * instead of the new run's, and deletes it when the part completes or fails. It is what keeps
   * "Stop keeps what you already paid for" true now that every run brings new seeds: the fan items
   * that finished are asked again with the SAME seeds, and the ask cache answers them for free.
   * @type {Map<string, number>}
   */
  const carry = new Map();
  /** @type {AbortController|null} */ let ac = null;
  /**
   * How many activations are executing RIGHT NOW (§2.3). Not the same question as `running()`: a
   * run parked on a Dialog nobody has answered is running and executing nothing, and the Computer
   * reads THIS one to decide whether a hidden surface still deserves its farm seat and its guest.
   * A number rather than a flag because a fan-out's items run through the same door.
   */
  let inFlight = 0;
  /** @type {Set<Function>} */ const listeners = new Set();
  /** @type {{i: number, n: number, partId: string|null, item: {i: number, n: number}|null}|null} */
  let progress = null;
  /** @type {RunReport|null} */ let last = null;
  /** The live run's merge door (§4.4), or null between runs. @type {((seeds: string[]) => number)|null} */
  let mergeInto = null;

  const now = () => (app && typeof app.now === 'function' ? app.now() : Date.now());

  /** The model this run is spending on, for the journal's cost record (§7.3). Best effort: a
   * journal row that says `null` is honest, a run that throws looking for a name is not. */
  function modelId() {
    try {
      const farm = app && app.farm;
      if (!farm) return null;
      if (typeof farm.model === 'function') return farm.model() || null;
      if (typeof farm.model === 'string') return farm.model;
      const snap = typeof farm.snapshot === 'function' ? farm.snapshot() : null;
      return (snap && (snap.defaultModel || snap.model)) || null;
    } catch { return null; }
  }

  /** @param {any} ev */
  function emit(ev) {
    for (const fn of Array.from(listeners)) {
      try { fn(ev); } catch (err) { console.error('[lolchat] graph run listener threw', err); }
    }
  }

  /**
   * The document the live run belongs to (§4.8, K3 fix pass). A run is started ON a graph; if the
   * library hands the session a DIFFERENT graph while it unwinds, every id it still marks would
   * land in the graph that replaced it — the same id meaning a different box. Null between runs,
   * when a write is unconditional.
   * @type {string|null}
   */
  let ownerDocId = null;
  /** Is the document the run started on still the open one? @returns {boolean} */
  const ownsDoc = () => !ownerDocId
    || typeof session.docId !== 'function'
    || session.docId() === ownerDocId;

  /** Write a part's runtime fields (state/value/error/stats/fanout) through the session's one door.
   * @param {string} id @param {any} fields */
  function mark(id, fields) {
    if (!ownsDoc()) return;
    try { session.patchPart(id, fields); } catch (err) { console.error('[lolchat] graph patch threw', err); }
  }

  /** The same door for MANY parts: one document, one save, one event. The active set is marked
   * `queued` up front, and N separate patches cost the canvas N renders (C1 fix pass).
   * @param {string[]} ids @param {any} fields */
  function markAll(ids, fields) {
    if (!ids.length || !ownsDoc()) return;
    try {
      if (typeof session.patchParts === 'function') session.patchParts(ids, fields);
      else for (const id of ids) session.patchPart(id, fields);
    } catch (err) { console.error('[lolchat] graph patch threw', err); }
  }

  /** The reader's cap for this run: the stored preference unless this run raised it. It IS
   * `maxGenerations` (§4.6) — the ceiling that is expected to bite on every shipped template.
   * @param {{maxItems?: number, limits?: any}} opts @returns {Promise<number>} */
  async function capFor(opts) {
    if (Number(opts.maxItems) > 0) return Math.floor(Number(opts.maxItems));
    const asked = opts.limits && Number(opts.limits.maxGenerations);
    if (asked > 0) return Math.floor(asked);
    const repo = app && app.repo;
    if (!repo || typeof repo.kvGet !== 'function') return DEFAULT_MAX_ITEMS;
    try {
      const stored = Number(await repo.kvGet(KV_KEYS.prefComputeMaxItems, DEFAULT_MAX_ITEMS));
      return stored > 0 ? Math.floor(stored) : DEFAULT_MAX_ITEMS;
    } catch {
      return DEFAULT_MAX_ITEMS;
    }
  }

  /**
   * Read one part's ports off the doc and refuse what it cannot take. Returns the inputs, or the
   * sentence that says why this part cannot run — a REFUSAL, never a silent empty (§1.2).
   * A `list` at a port that wants `text` is NOT refused here: that is a fan-out, and planFan()
   * decides what it means (§2.6 BH-2).
   *
   * K3 (§4.6, frozen): a BACK EDGE whose source holds no value CONTRIBUTES NOTHING — it is
   * skipped, not refused. Iteration 1 of every loop has no previous value, and that is not an
   * error; only a required port left with zero arrivals still refuses.
   * @param {any} doc @param {any} part @param {any} spec
   * @returns {{inputs: Record<string, GraphValue[]>}|{error: string}}
   */
  function gather(doc, part, spec) {
    const sources = wiresInto(doc, part.id);
    /** @type {Record<string, GraphValue[]>} */ const inputs = {};
    // K2 (COMPUTER_PLAN §5): the wire LABEL of every arrival, in the same order as its value.
    // The walk already has the wire in its hand; handing the label over is what lets a part bind
    // named parameters without being given the whole document.
    /** @type {Record<string, string[]>} */ const labels = {};
    for (const port of spec.inputs || []) {
      const wires = sources[port.name] || [];
      /** @type {GraphValue[]} */ const values = [];
      /** @type {string[]} */ const names = [];
      for (const wire of wires) {
        const up = partById(doc, wire.from);
        const value = up ? up.value : null;
        if (!isValue(value)) {
          if (isBack(wire)) continue;                       // iteration 1 of a loop (§4.6)
          return { error: t('parts.errNoInput', { port: port.label }) };
        }
        const verdict = accepts(port.accepts, value);
        if (verdict === 'no') return { error: t('parts.errBadInput', { port: port.label, kind: /** @type {any} */ (value).kind }) };
        values.push(value);
        names.push(typeof wire.label === 'string' ? wire.label : '');
      }
      if (!values.length && port.required) return { error: t('parts.errNoInput', { port: port.label }) };
      inputs[port.name] = values;
      labels[port.name] = names;
    }
    return { inputs, labels };
  }

  /**
   * @param {{only?: string[], cache?: boolean, maxItems?: number, mode?: 'all'|'from',
   *   seeds?: string[], force?: boolean, limits?: object}} [opts]
   * @returns {Promise<RunReport>}
   */
  async function run(opts = {}) {
    // A run is already in flight. This is a REFUSAL, not an abort: a report that says `cancelled`
    // must only ever come from a real Stop, or a caller (the per-part Re-run button, debug.run)
    // would be told "Stopped. Finished parts kept their values." about a run that never began.
    // A ▶ pressed mid-run never lands here — the host calls `addToRun` (§4.4).
    if (ac) {
      return /** @type {any} */ ({
        ran: 0, skipped: 0, errors: [], cancelled: false, busy: true, ms: 0,
        yielded: false, capped: null, cycle: false, generations: 0,
      });
    }
    const started = now();
    const startedWall = Date.now();
    const controller = new AbortController();
    ac = controller;
    ownerDocId = typeof session.docId === 'function' ? session.docId() : null;
    const signal = controller.signal;
    const cache = opts.cache !== false;
    // Critic R1 B18: `mode:'button'` was accepted here and passed by nobody — a press is a seed of
    // a `from` run (§4.2). Two modes, both real.
    const mode = opts.mode === 'from' ? 'from' : 'all';
    /** This run's nonce (A1): every new-each-run part gets seeds no earlier run used. */
    const runNonce = nextNonce() >>> 0;
    const docKey = typeof session.docId === 'function' ? String(session.docId() || '') : '';
    /** @param {string} id */
    const carryKey = (id) => `${docKey}|${id}`;
    const limits = { ...RUN_LIMITS, ...(opts.limits || {}) };
    /** @type {{partId: string, message: string}[]} */ const errors = [];
    let ran = 0;
    let skipped = 0;
    let cancelled = false;
    let yielded = false;
    let merged = 0;
    let waited = 0;
    let activations = 0;
    /** @type {{cap: number, spent: number, stopped: number}|null} */ let capped = null;
    /** @type {any} */ let limited = null;
    /** @type {string[]} */ const barred = [];
    /** Generations this run has spent, across every part and every item. */
    let spent = 0;
    /** Tokens this run has spent, across every part — the journal's cost record is the RUN's. */
    let tokensTotal = 0;
    const cap = await capFor(opts);
    limits.maxGenerations = cap;

    /** The active set `A` — MUTABLE for the whole run (merge, barriers). */
    /** @type {Set<string>} */ const A = new Set();
    /** The ACCUMULATED seed set `S` (§4.4): every barrier recomputes reachability from this, never
     * from the original seeds, or the first barrier after a merge drops what the merge added. */
    /** @type {Set<string>} */ const S = new Set(
      (Array.isArray(opts.seeds) ? opts.seeds : []).filter((id) => typeof id === 'string' && id),
    );
    /** Parts that completed at least one activation this run. */
    /** @type {Set<string>} */ const executed = new Set();
    /** Parts whose upstream failed: left stale, never run, counted in `skipped`. */
    /** @type {Set<string>} */ const blocked = new Set();
    /** Activations of each part in this run — `maxIterations` counts these (§4.6). */
    /** @type {Map<string, number>} */ const iterationsOf = new Map();
    /** Parts a ▶ re-pressed while they were running: they re-queue on completion (§4.4). */
    /** @type {Set<string>} */ const requeue = new Set();
    /** Parked activations, by part id (§4.3). The loop finalises them when they settle. */
    /** @type {Map<string, any>} */ const waiting = new Map();

    // ---- the shape memo (K3 landing, perf) ---------------------------------------------------
    // §4.3 keeps the ready scan O(n) per activation and recomputes the order EVERY iteration, so an
    // edit during a run lands at the next selection. What it does not ask for is a fresh topological
    // sort, two fresh Maps and a document spread per activation: on a 1000-part graph that is a
    // million Map entries and the run bill measured 0.56 ms/part against a 0.4 ms budget. The three
    // derivations below depend ONLY on the graph's SHAPE — its wires and its part ids — and a state
    // write replaces `doc.parts` while keeping both, so they are recomputed exactly when the shape
    // changes: a wire added or removed replaces `doc.wires`, a part added or removed changes the
    // length. THIS IS A MEMO, NOT A CURSOR: the scan below still looks at every part, every time.
    /** @type {{fwd: any, rank: {ok: boolean, ids: string[]}, into: Map<string, string[]>}|null} */
    let shape = null;
    /** @type {any} */ let shapeWires = null;
    let shapeLen = -1;
    /** @param {any} doc */
    function shapeOf(doc) {
      if (shape && doc.wires === shapeWires && doc.parts.length === shapeLen) {
        // The parts array is new on every state write; only its ids matter here, and those are the
        // ones the memo is keyed on. Hand the FRESH parts back so nothing reads a stale state.
        shape.fwd = { ...shape.fwd, parts: doc.parts };
        return shape;
      }
      const fwd = forwardEdges(doc);
      shapeWires = doc.wires;
      shapeLen = doc.parts.length;
      shape = { fwd, rank: order(fwd), into: forwardInto(fwd) };
      return shape;
    }

    /** id → its index in `doc.parts`. Positions survive a state write (the session maps the array),
     * so the index is rebuilt only when a lookup misses — at most once per parts array.
     * @type {Map<string, number>} */
    let idx = new Map();
    /** @type {any} */ let idxFor = null;
    /** @param {any} doc @param {string} id @returns {any} */
    function lookup(doc, id) {
      const parts = doc.parts;
      const i = idx.get(id);
      if (i !== undefined) { const hit = parts[i]; if (hit && hit.id === id) return hit; }
      if (idxFor === parts) return null;
      idx = new Map();
      for (let j = 0; j < parts.length; j += 1) idx.set(parts[j].id, j);
      idxFor = parts;
      const k = idx.get(id);
      const p = k === undefined ? null : parts[k];
      return p && p.id === id ? p : null;
    }

    /** Wake the loop when it is suspended on parks: a park settled, a merge arrived, or Stop. */
    /** @type {(() => void)|null} */ let wakeResolve = null;
    const wake = () => { const r = wakeResolve; wakeResolve = null; if (r) r(); };
    /** @param {number} ms */
    const sleepUntilWake = (ms) => new Promise((resolve) => {
      wakeResolve = resolve;
      const handle = setTimeout(() => { if (wakeResolve === resolve) { wakeResolve = null; resolve(undefined); } },
        Math.max(1, Math.min(ms, 60000)));
      if (handle && typeof (/** @type {any} */ (handle).unref) === 'function') /** @type {any} */ (handle).unref();
    });
    signal.addEventListener('abort', wake, { once: true });

    // The wall clock, deliberately NOT `app.now` — a test may freeze that, and a frozen clock must
    // never turn the yield below into an infinite one or into no yield at all.
    let sliceAt = Date.now();
    /** Hand the main thread back when this slice has run long enough. @returns {Promise<boolean>} */
    const breatheIfDue = async () => {
      if (Date.now() - sliceAt < YIELD_SLICE_MS) return false;
      await breathe();
      sliceAt = Date.now();
      return true;
    };

    const graphId = typeof session.docId === 'function' ? String(session.docId() || '') : '';
    const repo = app && app.repo;
    const journal = graphId && repo && typeof repo.kvSet === 'function'
      ? createJournal({ repo, graphId, now }) : null;
    /** @type {any} */ let J = NO_JOURNAL;

    /** @param {string} id @returns {any} */
    const partNow = (id) => partById(session.doc(), id);
    /** @param {string} id @returns {string} */
    const stateOf = (id) => { const p = partNow(id); return p ? String(p.state) : ''; };

    /** A part's runtime stats. Since critic R1: `seed` (the BASE seed of the activation — what the
     * box shows and what Keep pins) and `pinned` when the part really sent a seed, and `cut` when
     * an answer hit max_tokens. @param {any} meter @param {number} t0 @returns {any} */
    const statsOf = (meter, t0) => {
      /** @type {any} */ const s = { ms: Math.round(now() - t0), tokens: meter.tokens, calls: meter.calls };
      if (meter.seeded && typeof meter.base === 'number') { s.seed = meter.base; s.pinned = !!meter.pinned; }
      if (meter.cut) s.cut = true;
      return s;
    };

    /** @param {boolean} cycle @returns {RunReport} */
    const finish = (cycle) => {
      // §4.8, K3 fix pass: NO run outlives its parks. `stop()` cancels them, but a run can also end
      // on a ceiling, on the generation cap, or on a cycle with a branch still parked — and a park
      // that survives its run is a ghost: the run bar keeps counting "1 question waiting", the box
      // keeps painting the field and Send, and the answer the person types resolves a promise
      // nobody awaits. Every exit goes through here, so every exit rejects what it left parked.
      for (const id of [...waiting.keys()]) answerPark(id, { ok: false, cancelled: true });
      /** @type {string[]} */ const leftStale = [];
      if (!cancelled) {
        for (const id of executed) {
          if (barred.includes(id)) continue;
          if (stateOf(id) === 'stale') leftStale.push(id);
        }
      }
      const report = /** @type {any} */ ({
        ran, skipped, errors, cancelled, ms: Math.round(now() - started),
        yielded, capped, cycle, generations: spent,
        mode, seeds: [...S], journalId: J.id || null,
        activations, iterations: Object.fromEntries(iterationsOf),
        barred: barred.slice(), waited, leftStale, limited, merged,
      });
      last = report;
      ac = null;
      ownerDocId = null;
      inFlight = 0;
      mergeInto = null;
      progress = null;
      try { J.close(report); } catch (err) { console.error('[lolchat] journal close threw', err); }
      emit({ type: 'done', report });
      return report;
    };

    /**
     * `app.ask`, with this run's signal, background priority and cache setting forced on, the token
     * usage of every call metered onto the part that made it, AND the cap enforced on the way in
     * (§2.6 BH-4). A part therefore cannot accidentally jump the governor's foreground lane, and
     * cannot spend past the cap however many times it loops.
     *
     * A CACHED answer costs the farm nothing, so it costs the cap nothing either: that is what lets
     * a fan-out which yielded to a person half way through resume and finish inside the same cap.
     * `cacheSalt` comes from the fan plan (§2.6 BH-5) AND, since K3, from the loop ITERATION
     * (§4.6): a critique loop whose inputs have not changed must make a real second generation, or
     * `maxGenerations` never fires and the lesson whose point is a loop teaches that loops do
     * nothing. Iteration 1 stays unsalted, so re-running a settled graph is still near-free — for
     * a part that sends no seed. A part that DOES (the Instruction, critic R1 A1) gets a new seed
     * every run, so its re-run is a real generation, which is what the owner asked for.
     *
     * `given.seed` passes through untouched. The meter notes THAT a seed was sent (so the box can
     * show "last run: seed 48213") and whether any answer was cut off at max_tokens.
     * @param {{tokens: number, calls: number, seeded?: boolean, cut?: boolean}} meter
     * @param {number|string|null} salt
     */
    function meteredAsk(meter, salt) {
      const base = app && app.ask;
      if (!base) return null;
      /** @param {Function} fn @param {any} given */
      const call = async (fn, given) => {
        if (spent >= cap) {
          const err = new Error(t('parts.errCapped', { cap }));
          /** @type {any} */ (err).reason = 'capped';
          throw err;
        }
        if (typeof given.seed === 'number') meter.seeded = true;
        const res = await fn({
          ...given,
          signal,
          priority: 'background',
          cache: given.cache === undefined ? cache : given.cache,
          cacheSalt: given.cacheSalt === undefined && salt !== null && salt !== undefined
            ? salt
            : given.cacheSalt,
        });
        if (res && /** @type {any} */ (res).finishReason === 'length') meter.cut = true;
        if (res && /** @type {any} */ (res).cached) return res;   // free: no generation, no cost
        // A refusal that never reached a seat is not a generation either: a farm that said "busy",
        // an abort, and "there is no farm" must not eat the reader's cap on the way past.
        const kind = res && res.ok === false && res.error ? String(res.error.kind || '') : '';
        if (kind === 'busy' || kind === 'aborted' || kind === 'no_farm') return res;
        spent++;
        meter.calls++;
        const usage = res && res.usage;
        const tokens = usage && Number(usage.total_tokens);
        if (tokens) meter.tokens += tokens;
        return res;
      };
      return {
        text: (/** @type {any} */ given) => call(base.text, given || {}),
        json: (/** @type {any} */ given) => call(base.json, given || {}),
        mode: (/** @type {string} */ m) => (typeof base.mode === 'function' ? base.mode(m) : 'json'),
        vision: (/** @type {string} */ m) => (typeof base.vision === 'function' ? base.vision(m) : 'unknown'),
      };
    }

    /** One ceiling tripped (§4.6). Always a STOP: the run ends, the part goes `stale`, the report
     * names the ceiling and what raising it has to reach.
     * @param {string} ceiling @param {string|null} partId @param {number} limit @param {number} reached */
    function limitHit(ceiling, partId, limit, reached) {
      const raiseTo = ceiling === 'maxIterations'
        ? Math.min(100, Math.max(limit * 2, limit + 1))
        : Math.max(limit * 2, reached + 1);
      limited = { ceiling, partId: partId || null, limit, reached, raiseTo };
      J.event({ partId, kind: 'limit' });
      emit({ type: 'limited', ...limited });
    }

    /**
     * A barrier (§4.5). The value of `id` still flows — `gather()` reads it off the doc — but the
     * parts that were only reachable THROUGH it stop being activated. Reachability is RECOMPUTED
     * rather than walked, so a part reachable by a second, unbarred path keeps running.
     *
     * The roots are the run's own sources (parts in `A` with no forward-upstream in `A`) plus the
     * accumulated seeds `S`, which is what makes this work identically for a pull run, whose `S` is
     * empty, and a push run, whose sources may themselves be mid-graph.
     * @param {string} id
     */
    function applyBarrier(id) {
      const fwd = forwardEdges(session.doc());
      const cut = { ...fwd, wires: fwd.wires.filter((w) => w.from !== id) };
      const into = forwardInto(fwd);
      const out = outOf(cut);
      /** @type {string[]} */ const roots = [];
      for (const x of A) if (!(into.get(x) || []).some((f) => A.has(f))) roots.push(x);
      for (const s of S) if (A.has(s)) roots.push(s);
      const keep = new Set(roots);
      const stack = [...keep];
      while (stack.length) {
        const x = /** @type {string} */ (stack.pop());
        for (const to of out.get(x) || []) if (A.has(to) && !keep.has(to)) { keep.add(to); stack.push(to); }
      }
      /** @type {string[]} */ const dropped = [];
      for (const q of [...A]) {
        if (q === id || keep.has(q)) continue;
        // Never un-do finished work — but a pending SECOND activation (an earlier loop iteration
        // already ran this part) is exactly what a gate exists to stop.
        if (executed.has(q) && stateOf(q) !== 'queued') continue;
        A.delete(q);
        // Barring a part that is PARKED must reject its park too, or the question stays on the box
        // and on the run bar after the branch it belonged to was cut (K3 fix pass).
        if (waiting.delete(q)) answerPark(q, { ok: false, cancelled: true });
        barred.push(q);
        dropped.push(q);
        J.event({ partId: q, kind: 'bar', by: id });
      }
      markAll(dropped, { state: 'stale' });
      if (dropped.length) emit({ type: 'barred', partId: id, ids: dropped });
    }

    /**
     * A part completed without a barrier: drive every back edge leaving it (§4.6). The loop body —
     * the closed walk the back edge completes — is re-queued, which is the ONLY thing that makes a
     * second iteration happen. A gate inside the loop bars instead, and the loop stops.
     * @param {string} id
     */
    function driveLoops(id) {
      const doc = session.doc();
      const backs = backEdges(doc).filter((w) => w.from === id);
      if (!backs.length) return;
      /** @type {string[]} */ const again = [];
      for (const w of backs) {
        const walk = cycleFor(doc, { from: w.from, to: w.to }) || [w.to, w.from];
        for (const q of walk) if (A.has(q) && !again.includes(q) && !waiting.has(q)) again.push(q);
      }
      if (again.length) markAll(again, { state: 'queued', error: null });
    }

    /** A part that repeats itself without a loop — a Timer with `repeats: 3` (§6.6). A spec says
     * so by declaring `repeatsFor(part, maxIterations)`; nothing else in the catalogue does.
     * @param {any} part @param {any} spec @param {number} done @returns {boolean} */
    function repeatsAgain(part, spec, done) {
      if (!spec || typeof spec.repeatsFor !== 'function') return false;
      let want = 1;
      try { want = Number(spec.repeatsFor(part, limits.maxIterations)) || 1; } catch { return false; }
      return done < Math.min(want, limits.maxIterations);
    }

    /**
     * Finish one activation, wherever it came from — straight through, or back from a park.
     * @param {any} ctx
     * @returns {'next'|'stop'}
     */
    function complete(ctx) {
      const { id, meter, t0, record, wantsValue, value, bar, spec, part } = ctx;
      const stats = statsOf(meter, t0);
      executed.add(id);
      // It finished: its next run brings new seeds (A1) — unless some of its fan items FAILED, in
      // which case the next run is a repair, not a re-roll: the items that answered are asked again
      // with the seeds they were paid for (so the cache answers them) and only the failures cost.
      if (typeof ctx.keepNonce === 'number') carry.set(carryKey(id), ctx.keepNonce);
      else carry.delete(carryKey(id));
      // (a) of §7.4: anything the farm was paid for is flushed before the next part starts —
      // whatever becomes of the answer below, the generation was spent.
      if (meter.calls > 0) {
        tokensTotal += meter.tokens;
        J.spend({ spent, tokens: tokensTotal });
        J.flush();
      }
      // A ▶ pressed on this part while it ran: keep the value, and run it again (§4.4).
      if (requeue.has(id)) {
        requeue.delete(id);
        mark(id, { state: 'queued', value: wantsValue ? value : null, error: null, stats, fanout: record });
        emit({ type: 'part', partId: id, state: 'queued', i: activations, n: A.size });
        return 'next';
      }
      // Critic R1 B2: the person EDITED this box while it ran — `setSettings` marked it stale. The
      // answer that came back is for the OLD settings: it is kept (it was paid for, and it is still
      // worth reading) but the box stays stale, the run does not count it as ran, and nothing
      // downstream is driven by it. The next Run asks again with what the person wrote.
      const expected = ctx.expect || 'running';
      if (ownsDoc() && stateOf(id) !== expected) {
        mark(id, { state: 'stale', value: wantsValue ? value : null, error: null, stats, fanout: record });
        emit({ type: 'part', partId: id, state: 'stale', i: activations, n: A.size, edited: true });
        return 'next';
      }
      mark(id, { state: 'done', value: wantsValue ? value : null, error: null, stats, fanout: record });
      ran++;
      J.event({ partId: id, kind: 'done' });
      emit({ type: 'part', partId: id, state: 'done', i: activations, n: A.size });
      if (bar) applyBarrier(id);
      else {
        driveLoops(id);
        if (repeatsAgain(part, spec, iterationsOf.get(id) || 1)) mark(id, { state: 'queued' });
      }
      return 'next';
    }

    /** A part threw. It goes `error`, its downstream is blocked, and the run carries on (§1.4).
     * @param {string} id @param {string} message @param {any} [stats] */
    function failPart(id, message, stats) {
      blocked.add(id);
      A.delete(id);
      carry.delete(carryKey(id));              // a failure ends the attempt: next run, new seeds
      errors.push({ partId: id, message });
      mark(id, stats ? { state: 'error', error: message, stats } : { state: 'error', error: message });
      J.event({ partId: id, kind: 'error' });
      emit({ type: 'part', partId: id, state: 'error', i: activations, n: A.size });
    }

    /**
     * Execute ONE activation of one part. Returns 'suspended' when the part parked — the loop then
     * goes on serving other branches, which is the whole point of §4.3 — and 'stop' when a ceiling,
     * a cap, a Stop or a yield ended the run.
     * @param {string} id @returns {Promise<'next'|'suspended'|'stop'>}
     */
    async function execute(id) {
      const doc = session.doc();
      const part = partById(doc, id);
      const spec = part ? session.specs.get(part.type) : null;
      if (!part || !spec || typeof spec.run !== 'function') {
        A.delete(id);
        skipped++;
        if (part) mark(id, { state: 'idle' });      // not 'queued': the cleanup must not recount it
        return 'next';
      }

      const upstream = shapeOf(doc).into.get(id) || [];
      if (upstream.some((from) => blocked.has(from))) {
        blocked.add(id);
        A.delete(id);
        skipped++;
        mark(id, { state: 'stale' });
        emit({ type: 'part', partId: id, state: 'stale', i: activations, n: A.size });
        return 'next';
      }

      // A part the run deliberately NEVER activates leaves its downstream STALE, not red (§6.6,
      // K3 landing). The one part that does this is an unpressed Button, which Run-all excludes
      // from `A`: turning the box after it into an error reads to a learner as "your graph is
      // wrong" when nothing is — the graph is simply waiting for a click.
      const skippedManual = upstream.some((from) => {
        if (A.has(from)) return false;
        const up = lookup(doc, from);
        if (!up || isValue(up.value)) return false;
        const upSpec = session.specs.get(up.type);
        return !!(upSpec && upSpec.manual);
      });
      if (skippedManual) {
        blocked.add(id);
        A.delete(id);
        skipped++;
        mark(id, { state: 'stale' });
        emit({ type: 'part', partId: id, state: 'stale', i: activations, n: A.size });
        return 'next';
      }

      // THE CEILINGS, checked where an activation is about to be spent (§4.6).
      const iteration = (iterationsOf.get(id) || 0) + 1;
      if (iteration > limits.maxIterations) {
        mark(id, { state: 'stale', error: null });
        limitHit('maxIterations', id, limits.maxIterations, iteration);
        return 'stop';
      }
      if (activations + 1 > limits.maxActivations) {
        mark(id, { state: 'stale', error: null });
        limitHit('maxActivations', id, limits.maxActivations, activations + 1);
        return 'stop';
      }

      const got = gather(doc, part, spec);
      if (/** @type {any} */ (got).error) {
        failPart(id, /** @type {any} */ (got).error);
        return 'next';
      }
      const inputs = /** @type {any} */ (got).inputs;
      const labels = /** @type {any} */ (got).labels || {};

      // Does this part run once, or once per item? Two lists at once is a REFUSAL, never a
      // guessed pairing (§2.6 BH-2).
      const plan = planFan(spec, inputs);
      if (plan.kind === 'refuse') {
        failPart(id, t('parts.errFanoutMany'));
        return 'next';
      }
      const fanning = plan.kind === 'fan';

      // THE ITEM CEILING (fix pass, finding 1). The cap counts generations where they are made,
      // which bounds what a fan can SPEND — but not what it can grind: a free part fanned twenty
      // thousand times spends nothing and still costs the reader a frozen window. So the same
      // number the reader set is the ceiling on ONE fan's item count, and going over it is the
      // same loud stop as running out of generations, with the same button: never a silent slice
      // of the first `cap` items, which would be exactly the quiet loss §1.2 bans.
      if (fanning && /** @type {any} */ (plan).n > cap) {
        const items = /** @type {any} */ (plan).n;
        capped = /** @type {any} */ ({
          cap, spent, stopped: unrunCount(id), items, raiseTo: Math.max(cap * 2, items),
        });
        mark(id, { state: 'stale', error: null, fanout: null });
        emit({ type: 'part', partId: id, state: 'stale', i: activations, n: A.size });
        emit({ type: 'capped', ...capped });
        return 'stop';
      }

      // A part with `output: null` does its work elsewhere (To thread posts a message): resolving
      // nothing is success for it, and a failure for everyone else (§2.6 BH-6).
      const wantsValue = spec.output !== null && spec.output !== undefined;

      iterationsOf.set(id, iteration);
      activations++;
      J.iteration(id, iteration);
      J.event({ partId: id, kind: 'start' });
      mark(id, { state: 'running', error: null, fanout: null });
      emit({ type: 'part', partId: id, state: 'running', i: activations, n: A.size });
      // Critic R1 A1: the seed. Pinned (`settings.seed`) or new each run — from THIS run's nonce, or
      // the nonce this part was interrupted under (the carry), so a resumed fan asks its finished
      // items with the same seeds and the cache answers them.
      const pinned = parseSeed(part.settings && part.settings.seed);
      const nonce = carry.has(carryKey(id)) ? /** @type {number} */ (carry.get(carryKey(id))) : runNonce;
      const base = baseSeed({ pinned, nonce, partId: id });
      const meter = { tokens: 0, calls: 0, base, pinned: pinned !== null, seeded: false, cut: false };
      const t0 = now();
      /** @type {any[]} */ const results = [];
      const n = fanning ? /** @type {any} */ (plan).n : 1;
      /** @type {'ok'|'cancelled'|'yielded'|'capped'|'part'} */ let how = 'ok';
      let partMessage = '';
      let bar = false;

      for (let k = 0; k < n; k++) {
        if (signal.aborted) { how = 'cancelled'; break; }
        const item = fanning ? { i: k, n } : null;
        if (item) {
          progress = { i: activations, n: A.size, partId: id, item: { i: k, n } };
          emit({ type: 'item', partId: id, i: k, n });
          J.event({ partId: id, kind: 'item' });
        }
        try {
          const fanSalt = fanning ? /** @type {any} */ (plan).saltFor(k) : null;
          const salt = iteration > 1
            ? (fanSalt === null || fanSalt === undefined ? iteration : `${iteration}#${fanSalt}`)
            : fanSalt;
          let out = await spec.run({
            part,
            inputs: fanning ? /** @type {any} */ (plan).inputsFor(k) : inputs,
            labels,
            app,
            ask: meteredAsk(meter, salt),
            signal,
            thread: session.thread(),
            cache,
            item,
            iteration,
            // K-5: the sampling seed for THIS item of THIS iteration (item 0 of iteration 1 is the
            // base). A part that asks the farm passes it on; every other part ignores it.
            seed: seedFor(base, k, iteration),
            run: { id: J.id, mode },
            // C3 (§2.6 BJ): the panel's ONE sandbox, created on the first part that asks.
            // A part that never asks never pays for an iframe; there is at most one in the
            // process, which is what keeps a 500-part canvas at 60 fps.
            sandbox: typeof session.sandbox === 'function' ? () => session.sandbox() : null,
          });
          if (isPark(out)) {
            if (!fanning) {
              // THE SUSPENSION (§4.3). The part is `waiting`, the journal says so and is flushed
              // (§7.4 (b)), and this function RETURNS: every other branch keeps running.
              suspend(id, part, spec, out, { meter, t0, wantsValue, iteration });
              return 'suspended';
            }
            // A control part never fans (its input port is `many:false`), so a park inside a fan is
            // a part doing something unusual: it is awaited inline rather than refused.
            out = await /** @type {any} */ (out).settle;
          }
          const got2 = unwrapOutcome(out);
          if (got2.bar) bar = true;
          // "No value" is a failure, not a state (§1.2 / BG-5) — unless the part declares none.
          if (wantsValue && !isValue(got2.value)) throw new Error(t('parts.errNoValue'));
          results.push({ ok: true, value: wantsValue ? got2.value : null });
        } catch (err) {
          if (signal.aborted) { how = 'cancelled'; break; }
          const reason = reasonOf(err);
          // A CONTROL failure is about the RUN, not about the item (§2.6 BH-4): it ends the run
          // with the part back to `stale`, and it is never written against item k.
          if (reason === 'capped') { how = 'capped'; break; }
          if (reason === 'busy' || reason === 'aborted') { how = 'yielded'; break; }
          // A per-ITEM failure: recorded against the item, and its siblings carry on. A part that
          // did not fan has exactly one "item", so this is C1's behaviour unchanged.
          results.push({ ok: false, message: messageOf(err) });
          if (!fanning) { how = 'part'; partMessage = messageOf(err); break; }
        }
        // The badge, the Stop button and the reader's own chat all live on this thread: hand it
        // back, and paint `7/40` when we do.
        if (fanning) {
          // eslint-disable-next-line no-await-in-loop
          const paused = await breatheIfDue();
          if (paused) mark(id, { fanout: fanoutRecord(results, n) });
        }
      }

      const record = fanning ? fanoutRecord(results, n) : null;
      const stats = statsOf(meter, t0);

      // Interrupted, not finished: the NEXT run of this part reuses this nonce (A1), so whatever
      // items finished are asked again with the seeds they were paid for — and cost nothing.
      if (how === 'cancelled' || how === 'yielded' || how === 'capped') carry.set(carryKey(id), nonce);

      if (how === 'cancelled') {
        // OUR Stop. The part was interrupted, not wrong; whatever items finished are in the ask
        // cache, so the next Run gets them back for free.
        cancelled = true;
        mark(id, { state: 'stale', error: null, fanout: record });
        emit({ type: 'part', partId: id, state: 'stale', i: activations, n: A.size });
        return 'stop';
      }
      if (how === 'yielded') {
        // The human took the seat. Yield: nothing is wrong, and Run resumes here.
        yielded = true;
        mark(id, { state: 'stale', error: null, fanout: record });
        emit({ type: 'part', partId: id, state: 'stale', i: activations, n: A.size, yielded: true });
        return 'stop';
      }
      if (how === 'capped') {
        // The run reached what the reader allowed it to spend. Not an error and not a silent
        // truncation: the part is stale, the report says how much is left, and the canvas's
        // "raise the cap" button re-runs from exactly here.
        capped = { cap, spent, stopped: unrunCount(id) };
        limited = { ceiling: 'maxGenerations', partId: id, limit: cap, reached: spent, raiseTo: cap * 2 };
        mark(id, { state: 'stale', error: null, fanout: record });
        emit({ type: 'part', partId: id, state: 'stale', i: activations, n: A.size });
        emit({ type: 'capped', cap, spent, stopped: capped.stopped });
        return 'stop';
      }
      if (how === 'part') {
        failPart(id, partMessage, stats);
        return 'next';
      }

      // A fan in which EVERY item failed is a failed part (§2.6 BH-3) — carrying the first item's
      // own words, so the reader is told what went wrong and not merely that something did.
      if (record && record.n > 0 && record.ok === 0) {
        const message = t('parts.errAllItems', { message: record.errors.length ? record.errors[0].message : '' });
        blocked.add(id);
        A.delete(id);
        carry.delete(carryKey(id));
        errors.push({ partId: id, message });
        mark(id, { state: 'error', error: message, stats, fanout: record });
        emit({ type: 'part', partId: id, state: 'error', i: activations, n: A.size });
        return 'next';
      }

      let value = null;
      if (wantsValue) value = fanning ? joinResults(results) : results[0].value;
      const keepNonce = record && record.failed > 0 ? nonce : null;
      return complete({ id, meter, t0, record, wantsValue, value, bar, spec, part, keepNonce });
    }

    /** How many parts this run has not executed — what `capped.stopped` means. @param {string} id */
    function unrunCount(id) {
      let n = 0;
      for (const x of A) if (x === id || !executed.has(x)) n++;
      return n;
    }

    /**
     * Park one activation (§4.3). The promise NEVER rejects — control-bus turns a cancel into an
     * answer — so the only thing that can arrive here is a settled `PartOutcome`.
     * @param {string} id @param {any} part @param {any} spec @param {any} out @param {any} ctx
     */
    function suspend(id, part, spec, out, ctx) {
      const request = /** @type {any} */ (out).park || {};
      const entry = { ...ctx, id, part, spec, settled: null, record: null };
      waiting.set(id, entry);
      waited++;
      mark(id, { state: 'waiting', error: null });
      J.wait(id, String(request.kind || 'dialog'), request.question ? { question: String(request.question) } : {});
      emit({ type: 'part', partId: id, state: 'waiting', i: activations, n: A.size, park: request });
      Promise.resolve(/** @type {any} */ (out).settle).then(
        (value) => { entry.settled = { ok: true, value }; wake(); },
        (err) => { entry.settled = { ok: false, err }; wake(); },
      );
    }

    /** Finish a park that has settled, on the LOOP's thread (never inside the part's promise).
     * @param {any} entry @returns {'next'|'stop'} */
    function resumeParked(entry) {
      const id = entry.id;
      J.resume(id);
      if (!A.has(id)) return 'next';            // a barrier or a Stop took it while it waited
      if (signal.aborted) {
        cancelled = true;
        mark(id, { state: 'stale', error: null });
        return 'stop';
      }
      if (!entry.settled.ok) {
        failPart(id, messageOf(entry.settled.err));
        return 'next';
      }
      const got = unwrapOutcome(entry.settled.value);
      if (entry.wantsValue && !isValue(got.value)) {
        failPart(id, t('parts.errNoValue'));
        return 'next';
      }
      return complete({
        id, meter: entry.meter, t0: entry.t0, record: null, wantsValue: entry.wantsValue,
        value: got.value, bar: got.bar, spec: entry.spec, part: entry.part,
        // B2: a parked part is `waiting`, not `running`; anything else means it was edited.
        expect: 'waiting',
      });
    }

    /** §4.4: a ▶ pressed mid-run MERGES. Never refuses, never waits for the current part. */
    mergeInto = (seeds2) => {
      const list = (Array.isArray(seeds2) ? seeds2 : []).filter((id) => typeof id === 'string' && id);
      if (!list.length) return 0;
      for (const s of list) S.add(s);
      const doc = session.doc();
      // The SAME prologue as §4.2 — a merged seed pulls its own missing ancestors too.
      const add = activeSet(doc, list, { mode: 'from', specs: session.specs });
      /** @type {string[]} */ const queued = [];
      let n = 0;
      for (const q of add) {
        const p = partById(doc, q);
        if (waiting.has(q) || (p && p.state === 'running')) { requeue.add(q); A.add(q); n++; continue; }
        A.add(q);
        blocked.delete(q);
        queued.push(q);
        n++;
      }
      markAll(queued, { state: 'queued', error: null, fanout: null });
      merged += n;
      emit({ type: 'merged', ids: add, n });
      wake();
      return n;
    };

    try {
      const doc0 = session.doc();
      const ord0 = order(forwardEdges(doc0));
      // A cycle in the FORWARD graph cannot be BUILT (addWire declares a loop `back:true`), so this
      // is the defensive path: a hand-edited or imported file. Nothing runs, `graph.runCycle`.
      if (!ord0.ok) {
        emit({ type: 'start', n: 0, cycle: true });
        return finish(true);
      }

      const wanted = Array.isArray(opts.only) && opts.only.length ? new Set(opts.only) : null;
      const ids = wanted
        ? ord0.ids.filter((id) => wanted.has(id))
        : activeSet(doc0, [...S], { mode, force: !!opts.force, specs: session.specs });
      for (const id of ids) A.add(id);

      // §4.6, frozen: a plan whose Timers alone would outlast `maxWallMs` is refused BEFORE it
      // starts, with the arithmetic, instead of being discovered ten minutes in.
      const plan = runPlan(doc0, { specs: session.specs, only: ids, cap, limits });
      if (plan.waitMs > limits.maxWallMs) {
        emit({ type: 'start', n: 0, cycle: false });
        limitHit('maxWallMs', null, limits.maxWallMs, plan.waitMs);
        /** @type {any} */ (limited).planned = true;
        return finish(false);
      }

      if (journal) J = journal.openRun({ mode, seeds: [...S], cap, model: modelId() });

      emit({ type: 'start', n: ids.length, cycle: false, mode, plan });
      // Everything in the active set is visibly QUEUED from the first frame — "nothing runs
      // invisibly" (§3.5.4) applies to the parts, not only to the button. A previous run's
      // per-item record goes with it: `7/40` from last time is not this run's progress.
      markAll(ids, { state: 'queued', error: null, fanout: null });
      // PERF PASS (2026-09-25): on a big run, let the "everything is queued" frame paint BEFORE the
      // first part executes. Marking 1000 parts and running the first slice in one turn was one
      // ~70 ms block (the mark, then a frame restyling 1000 boxes, with no gap between them). A
      // small graph keeps its exact timing: the yield is only for sets larger than BIG_RUN.
      if (ids.length > BIG_RUN) {
        // eslint-disable-next-line no-await-in-loop
        await breathe();
        sliceAt = Date.now();
      }

      for (;;) {
        if (signal.aborted) { cancelled = true; break; }
        // eslint-disable-next-line no-await-in-loop
        await breatheIfDue();
        if (signal.aborted) { cancelled = true; break; }

        // 1. Parks that settled while we were elsewhere finish FIRST: a person who answered is
        //    ahead of a part that has not started.
        let stop = false;
        for (const entry of [...waiting.values()]) {
          if (!entry.settled) continue;
          waiting.delete(entry.id);
          if (resumeParked(entry) === 'stop') { stop = true; break; }
        }
        if (stop) break;
        if (signal.aborted) { cancelled = true; break; }

        // 2. The wall clock, parked time included (§4.6).
        const spentWall = Date.now() - startedWall;
        if (spentWall > limits.maxWallMs) {
          const who = waiting.size ? [...waiting.keys()][0] : null;
          limitHit('maxWallMs', who, limits.maxWallMs, spentWall);
          break;
        }

        // 3. The O(n) scan of §4.3. `order()` is recomputed every iteration: editing during a run
        //    is allowed, and lands at the next selection.
        const doc = session.doc();
        const { rank, into } = shapeOf(doc);
        if (!rank.ok) { emit({ type: 'start', n: 0, cycle: true }); return finish(true); }
        /** @type {string|null} */ let next = null;
        for (const id of rank.ids) {
          if (!A.has(id)) continue;
          const p = lookup(doc, id);
          if (!p || p.state !== 'queued') continue;
          const held = (into.get(id) || []).some((from) => {
            if (!A.has(from)) return false;
            const up = lookup(doc, from);
            return !!up && (up.state === 'queued' || up.state === 'running' || up.state === 'waiting');
          });
          if (held) continue;
          next = id;
          break;
        }

        if (next === null) {
          if (waiting.size) {
            // SUSPEND, do not end (§4.3). The journal says `waiting` and is flushed (§7.4 (b)).
            J.status('waiting');
            // eslint-disable-next-line no-await-in-loop
            await J.flush();
            const remain = limits.maxWallMs - (Date.now() - startedWall);
            if (remain <= 0) { limitHit('maxWallMs', [...waiting.keys()][0], limits.maxWallMs, limits.maxWallMs); break; }
            // eslint-disable-next-line no-await-in-loop
            await sleepUntilWake(remain);
            continue;
          }
          break;
        }

        progress = { i: activations, n: A.size, partId: next, item: null };
        inFlight += 1;
        /** @type {any} */ let verdict = 'next';
        // eslint-disable-next-line no-await-in-loop
        try { verdict = await execute(next); } finally { inFlight -= 1; }
        // The `waiting` event above was emitted while the activation was still technically in
        // flight. This one fires once it is not, so a listener that reads `executing()` — the
        // Computer's `visible` rule (§2.3) — learns that the run is now parked and lets a hidden
        // surface suspend its guest instead of holding the seat for a question nobody answered.
        if (verdict === 'suspended') emit({ type: 'parked', partId: next, i: activations, n: A.size });
        if (verdict === 'stop') break;
      }

      // A Stop — or a ceiling, or the cap — while parts were parked: anything still suspended is
      // put back where the next Run will find it. `waiting` is deliberately NOT cleared here:
      // `finish()` reads it to reject the parks this run leaves behind, and the Map dies with the
      // call anyway.
      for (const id of waiting.keys()) A.add(id);

      // Anything still QUEUED, RUNNING or WAITING never finished: put it back where the run set
      // will find it — in ONE write, the same as the queueing that put it there. A capped run's
      // leftovers come through here too, which is why `skipped` counts the parts the run never
      // reached while the report's `stopped` counts every part the cap left unrun.
      /** @type {string[]} */ const leftover = [];
      const endDoc = session.doc();
      for (const id of A) {
        const p = partById(endDoc, id);
        if (!p) continue;
        if (p.state === 'queued') { leftover.push(id); skipped++; }
        else if (p.state === 'running' || p.state === 'waiting') leftover.push(id);
      }
      markAll(leftover, { state: 'stale' });
      return finish(false);
    } catch (err) {
      console.error('[lolchat] graph run failed', err);
      return finish(false);
    }
  }

  return {
    run,
    /** §4.8: Stop aborts the in-flight farm request AND rejects every park. One button, both
     * modes, `Esc`. Every finished value is kept. */
    stop() {
      if (ac) ac.abort();
      cancelParks();
    },
    /** §4.4: a ▶ pressed mid-run. Returns how many parts joined the live run, 0 when none did
     * (there is no run, or the seeds are gone). It never refuses and never blocks. */
    addToRun(seeds) {
      if (!mergeInto) return 0;
      try { return mergeInto(Array.isArray(seeds) ? seeds : [seeds]); } catch (err) {
        console.error('[lolchat] addToRun threw', err);
        return 0;
      }
    },
    running: () => !!ac,
    /** §2.3: is an activation in flight RIGHT NOW? False while the run is merely parked on a
     * Dialog, a Confirm or a Timer — which is what lets a hidden Computer stop holding a farm
     * seat and suspend its guest while nobody answers the question. */
    executing: () => !!ac && inFlight > 0,
    progress: () => (progress ? { ...progress } : null),
    /** The last finished run, for a panel that mounted after it (null before the first). */
    report: () => last,
    /** @param {(ev: any) => void} fn */
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
