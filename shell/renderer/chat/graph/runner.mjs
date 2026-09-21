// @ts-check
// The run engine (plan §2.6 BG-6 + BH-2/BH-4/BH-6/BH-8, docs/LOLCHAT_COMPUTER_SPEC.md §2):
// topological execution of the dirty subgraph, ONE request in flight, at BACKGROUND priority,
// abortable, and — since C2 — fanned out over the items of a list.
//
// Everything here exists to make six sentences true:
//
//   1. "A 30-part graph costs one generation after a typo fix." The run set comes from topo.mjs
//      (a `done` part whose whole upstream is `done` is skipped), so a re-run touches the dirty
//      subgraph and nothing else. `only` narrows it further for a per-part Re-run.
//   2. "A human typing always wins." Every thinking part goes through `app.ask` at
//      `priority:'background'` — the governor's background lane, which the reader's next Send
//      aborts outright. That abort is NOT an error: the part goes back to `stale`, every finished
//      value stays, and the report says `yielded`. Pressing Run again resumes exactly where it
//      stopped, because `stale` is what the run set reads — and because every answer already paid
//      for is in the ask cache, resuming a half-finished fan-out re-pays for NOTHING.
//   3. "Stop keeps what you already paid for." `stop()` aborts the ONE in-flight request. The part
//      that was running returns to `stale` with `error:null` — it was interrupted, not wrong.
//   4. "One bad part never ends the run." A part that throws goes `error`; everything downstream of
//      it is left `stale`, skipped, and counted — the rest of the run set still executes.
//   5. "One bad ITEM never ends the run either" (C2, §2.6 BH-3). A fanned part runs once per item;
//      an item that throws is recorded in `part.fanout.errors` and its siblings carry on. The
//      part's value is the successes, IN ORDER; it is `error` only when EVERY item failed.
//   6. "A graph cannot quietly spend the farm." The cap is counted in GENERATIONS, in the wrapper
//      that makes them (§2.6 BH-4) — not in a pre-pass, because a `Split` decides its item count at
//      run time and a `Filter` spends N generations inside ONE part. The call that would exceed the
//      cap THROWS `capped`; the run ends there, says `{cap, spent, stopped}`, and `run({maxItems})`
//      is the "raise it for this run" door the canvas's button calls.
//
// THE QUEUE IS DELIBERATELY NOT `app.ask.queue` (BG-6 stands, restated in BH-5): the runner is
// serial, owns its own progress, and has its own cap. `app.ask.queue({max})` exists for the
// studio's other callers.

import { runSet, order } from './topo.mjs';
import { inputsOf, partById } from './model.mjs';
import { accepts, isValue } from './values.mjs';
import { planFan, joinResults, fanoutRecord } from './fanout.mjs';
import { KV_KEYS } from '../core/types.mjs';
import { t } from '../core/i18n.mjs';
import '../strings/parts.en.mjs';

/** @typedef {import('../core/types.mjs').RunReport} RunReport */
/** @typedef {import('../core/types.mjs').GraphValue} GraphValue */

/** Generations one Run may spend before it stops and asks (spec §2, `pref:computeMaxItems`). It is
 * also the ITEM ceiling: a single fan may not exceed it either (see the loop below). */
export const DEFAULT_MAX_ITEMS = 50;

/** How long the run may hold the main thread before handing it back (fix pass, finding 1).
 * `await spec.run(...)` is not a suspension point when the part makes no farm call — a promise that
 * resolves on the microtask queue keeps the SAME macrotask — so a fan over a free part (Split into
 * Split, Filter over a pasted document) ran thousands of items, and thousands of synchronous canvas
 * syncs, in one unbroken stretch: the `7/40` badge could not paint and Stop could not be clicked.
 * Eight milliseconds is half a 60 Hz frame: short enough that the badge keeps up, long enough that
 * the yields themselves cost nothing measurable. */
export const YIELD_SLICE_MS = 8;

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

/** @param {{session: any, app: any}} o */
export function createRunner(o) {
  const session = o.session;
  const app = o.app;
  /** @type {AbortController|null} */ let ac = null;
  /** @type {Set<Function>} */ const listeners = new Set();
  /** @type {{i: number, n: number, partId: string|null, item: {i: number, n: number}|null}|null} */
  let progress = null;
  /** @type {RunReport|null} */ let last = null;

  const now = () => (app && typeof app.now === 'function' ? app.now() : Date.now());

  /** @param {any} ev */
  function emit(ev) {
    for (const fn of Array.from(listeners)) {
      try { fn(ev); } catch (err) { console.error('[lolchat] graph run listener threw', err); }
    }
  }

  /** Write a part's runtime fields (state/value/error/stats/fanout) through the session's one door.
   * @param {string} id @param {any} fields */
  function mark(id, fields) {
    try { session.patchPart(id, fields); } catch (err) { console.error('[lolchat] graph patch threw', err); }
  }

  /** The same door for MANY parts: one document, one save, one event. The run set is marked
   * `queued` up front, and N separate patches cost the canvas N renders (C1 fix pass).
   * @param {string[]} ids @param {any} fields */
  function markAll(ids, fields) {
    if (!ids.length) return;
    try {
      if (typeof session.patchParts === 'function') session.patchParts(ids, fields);
      else for (const id of ids) session.patchPart(id, fields);
    } catch (err) { console.error('[lolchat] graph patch threw', err); }
  }

  /** The reader's cap for this run: the stored preference unless this run raised it.
   * @param {{maxItems?: number}} opts @returns {Promise<number>} */
  async function capFor(opts) {
    if (Number(opts.maxItems) > 0) return Math.floor(Number(opts.maxItems));
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
   * @param {any} doc @param {any} part @param {any} spec
   * @returns {{inputs: Record<string, GraphValue[]>}|{error: string}}
   */
  function gather(doc, part, spec) {
    const sources = inputsOf(doc, part.id);
    /** @type {Record<string, GraphValue[]>} */ const inputs = {};
    for (const port of spec.inputs || []) {
      const froms = sources[port.name] || [];
      /** @type {GraphValue[]} */ const values = [];
      for (const from of froms) {
        const up = partById(doc, from);
        const value = up ? up.value : null;
        if (!isValue(value)) return { error: t('parts.errNoInput', { port: port.label }) };
        const verdict = accepts(port.accepts, value);
        if (verdict === 'no') return { error: t('parts.errBadInput', { port: port.label, kind: /** @type {any} */ (value).kind }) };
        values.push(value);
      }
      if (!values.length && port.required) return { error: t('parts.errNoInput', { port: port.label }) };
      inputs[port.name] = values;
    }
    return { inputs };
  }

  /** @param {{only?: string[], cache?: boolean, maxItems?: number}} [opts] @returns {Promise<RunReport>} */
  async function run(opts = {}) {
    // A run is already in flight. This is a REFUSAL, not an abort: a report that says `cancelled`
    // must only ever come from a real Stop, or a caller (the per-part Re-run button, debug.run)
    // would be told "Stopped. Finished parts kept their values." about a run that never began.
    if (ac) {
      return /** @type {any} */ ({
        ran: 0, skipped: 0, errors: [], cancelled: false, busy: true, ms: 0,
        yielded: false, capped: null, cycle: false, generations: 0,
      });
    }
    const started = now();
    const controller = new AbortController();
    ac = controller;
    const signal = controller.signal;
    const cache = opts.cache !== false;
    /** @type {{partId: string, message: string}[]} */ const errors = [];
    let ran = 0;
    let skipped = 0;
    let cancelled = false;
    let yielded = false;
    /** @type {{cap: number, spent: number, stopped: number}|null} */ let capped = null;
    /** Generations this run has spent, across every part and every item. */
    let spent = 0;
    const cap = await capFor(opts);
    // The wall clock, deliberately NOT `app.now` — a test may freeze that, and a frozen clock must
    // never turn the yield below into an infinite one or into no yield at all.
    let sliceAt = Date.now();
    /** Hand the main thread back when this slice has run long enough. Says whether it did, which
     * is also the cadence the per-item record is written at: a fan of two thousand items wrote the
     * whole graph row two thousand times and made the canvas sync two thousand times, all of it
     * invisible because it happened inside one unbroken macrotask. Once per slice is once per
     * repaint, which is all a `7/40` badge can show. @returns {Promise<boolean>} */
    const breatheIfDue = async () => {
      if (Date.now() - sliceAt < YIELD_SLICE_MS) return false;
      await breathe();
      sliceAt = Date.now();
      return true;
    };

    /** @param {boolean} cycle @returns {RunReport} */
    const finish = (cycle) => {
      const report = /** @type {any} */ ({
        ran, skipped, errors, cancelled, ms: Math.round(now() - started),
        yielded, capped, cycle, generations: spent,
      });
      last = report;
      ac = null;
      progress = null;
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
     * `cacheSalt` comes from the fan plan (§2.6 BH-5): identical items are deliberately DIFFERENT
     * generations, distinct items are unsalted and therefore cheap to resume.
     * @param {{tokens: number, calls: number}} meter @param {number|null} salt
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
        const res = await fn({
          ...given,
          signal,
          priority: 'background',
          cache: given.cache === undefined ? cache : given.cache,
          cacheSalt: given.cacheSalt === undefined && salt !== null && salt !== undefined
            ? salt
            : given.cacheSalt,
        });
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

    try {
      const doc0 = session.doc();
      const ord = order(doc0);
      // A cycle cannot be BUILT (addWire refuses it), so this is the defensive path: a hand-edited
      // or imported file. Nothing runs, and the panel says `graph.runCycle`.
      if (!ord.ok) {
        emit({ type: 'start', n: 0, cycle: true });
        return finish(true);
      }

      const wanted = Array.isArray(opts.only) && opts.only.length ? new Set(opts.only) : null;
      const ids = wanted ? ord.ids.filter((id) => wanted.has(id)) : runSet(doc0);

      emit({ type: 'start', n: ids.length, cycle: false });
      // Everything in the run set is visibly WAITING from the first frame — "nothing runs
      // invisibly" (§3.5.4) applies to the parts, not only to the button. A previous run's
      // per-item record goes with it: `7/40` from last time is not this run's progress.
      markAll(ids, { state: 'queued', error: null, fanout: null });

      /** Parts whose upstream failed: left stale, never run, counted in `skipped`. */
      const blocked = new Set();

      for (let i = 0; i < ids.length; i++) {
        if (signal.aborted) { cancelled = true; break; }
        // eslint-disable-next-line no-await-in-loop
        await breatheIfDue();
        if (signal.aborted) { cancelled = true; break; }
        const id = ids[i];
        progress = { i, n: ids.length, partId: id, item: null };
        const doc = session.doc();
        const part = partById(doc, id);
        const spec = part ? session.specs.get(part.type) : null;
        if (!part || !spec || typeof spec.run !== 'function') {
          skipped++;
          if (part) mark(id, { state: 'idle' });         // not 'queued': the cleanup must not recount it
          continue;
        }

        const upstream = Object.values(inputsOf(doc, id)).reduce((all, list) => all.concat(list), []);
        if (upstream.some((from) => blocked.has(from))) {
          blocked.add(id);
          skipped++;
          mark(id, { state: 'stale' });
          emit({ type: 'part', partId: id, state: 'stale', i, n: ids.length });
          continue;
        }

        const got = gather(doc, part, spec);
        if (/** @type {any} */ (got).error) {
          const message = /** @type {any} */ (got).error;
          blocked.add(id);
          errors.push({ partId: id, message });
          mark(id, { state: 'error', error: message });
          emit({ type: 'part', partId: id, state: 'error', i, n: ids.length });
          continue;
        }
        const inputs = /** @type {any} */ (got).inputs;

        // Does this part run once, or once per item? Two lists at once is a REFUSAL, never a
        // guessed pairing (§2.6 BH-2).
        const plan = planFan(spec, inputs);
        if (plan.kind === 'refuse') {
          const message = t('parts.errFanoutMany');
          blocked.add(id);
          errors.push({ partId: id, message });
          mark(id, { state: 'error', error: message });
          emit({ type: 'part', partId: id, state: 'error', i, n: ids.length });
          continue;
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
            cap, spent, stopped: ids.length - i, items, raiseTo: Math.max(cap * 2, items),
          });
          mark(id, { state: 'stale', error: null, fanout: null });
          emit({ type: 'part', partId: id, state: 'stale', i, n: ids.length });
          emit({ type: 'capped', ...capped });
          break;
        }

        // A part with `output: null` does its work elsewhere (To thread posts a message): resolving
        // nothing is success for it, and a failure for everyone else (§2.6 BH-6).
        const wantsValue = spec.output !== null && spec.output !== undefined;

        mark(id, { state: 'running', error: null, fanout: null });
        emit({ type: 'part', partId: id, state: 'running', i, n: ids.length });
        const meter = { tokens: 0, calls: 0 };
        const t0 = now();
        /** @type {any[]} */ const results = [];
        const n = fanning ? /** @type {any} */ (plan).n : 1;
        /** @type {'ok'|'cancelled'|'yielded'|'capped'|'part'} */ let outcome = 'ok';
        let partMessage = '';

        for (let k = 0; k < n; k++) {
          if (signal.aborted) { outcome = 'cancelled'; break; }
          const item = fanning ? { i: k, n } : null;
          if (item) {
            progress = { i, n: ids.length, partId: id, item: { i: k, n } };
            emit({ type: 'item', partId: id, i: k, n });
          }
          try {
            const value = await spec.run({
              part,
              inputs: fanning ? /** @type {any} */ (plan).inputsFor(k) : inputs,
              app,
              ask: meteredAsk(meter, fanning ? /** @type {any} */ (plan).saltFor(k) : null),
              signal,
              thread: session.thread(),
              cache,
              item,
              // C3 (§2.6 BJ): the panel's ONE sandbox, created on the first part that asks.
              // A part that never asks never pays for an iframe; there is at most one in the
              // process, which is what keeps a 500-part canvas at 60 fps.
              sandbox: typeof session.sandbox === 'function' ? () => session.sandbox() : null,
            });
            // "No value" is a failure, not a state (§1.2 / BG-5) — unless the part declares none.
            if (wantsValue && !isValue(value)) throw new Error(t('parts.errNoValue'));
            results.push({ ok: true, value: wantsValue ? value : null });
          } catch (err) {
            if (signal.aborted) { outcome = 'cancelled'; break; }
            const reason = reasonOf(err);
            // A CONTROL failure is about the RUN, not about the item (§2.6 BH-4): it ends the run
            // with the part back to `stale`, and it is never written against item k.
            if (reason === 'capped') { outcome = 'capped'; break; }
            if (reason === 'busy' || reason === 'aborted') { outcome = 'yielded'; break; }
            // A per-ITEM failure: recorded against the item, and its siblings carry on. A part that
            // did not fan has exactly one "item", so this is C1's behaviour unchanged.
            results.push({ ok: false, message: messageOf(err) });
            if (!fanning) { outcome = 'part'; partMessage = messageOf(err); break; }
          }
          // The badge, the Stop button and the reader's own chat all live on this thread: hand it
          // back, and paint `7/40` when we do. Every terminal path below writes the record too, so
          // the last item is never the one nobody saw.
          if (fanning) {
            // eslint-disable-next-line no-await-in-loop
            const paused = await breatheIfDue();
            if (paused) mark(id, { fanout: fanoutRecord(results, n) });
          }
        }

        const record = fanning ? fanoutRecord(results, n) : null;
        const stats = { ms: Math.round(now() - t0), tokens: meter.tokens, calls: meter.calls };

        if (outcome === 'cancelled') {
          // OUR Stop. The part was interrupted, not wrong; whatever items finished are in the ask
          // cache, so the next Run gets them back for free.
          cancelled = true;
          mark(id, { state: 'stale', error: null, fanout: record });
          emit({ type: 'part', partId: id, state: 'stale', i, n: ids.length });
          break;
        }
        if (outcome === 'yielded') {
          // The human took the seat. Yield: nothing is wrong, and Run resumes here.
          yielded = true;
          mark(id, { state: 'stale', error: null, fanout: record });
          emit({ type: 'part', partId: id, state: 'stale', i, n: ids.length, yielded: true });
          break;
        }
        if (outcome === 'capped') {
          // The run reached what the reader allowed it to spend. Not an error and not a silent
          // truncation: the part is stale, the report says how much is left, and the canvas's
          // "raise the cap" button re-runs from exactly here.
          capped = { cap, spent, stopped: ids.length - i };
          mark(id, { state: 'stale', error: null, fanout: record });
          emit({ type: 'part', partId: id, state: 'stale', i, n: ids.length });
          emit({ type: 'capped', cap, spent, stopped: capped.stopped });
          break;
        }
        if (outcome === 'part') {
          blocked.add(id);
          errors.push({ partId: id, message: partMessage });
          mark(id, { state: 'error', error: partMessage, stats });
          emit({ type: 'part', partId: id, state: 'error', i, n: ids.length });
          continue;
        }

        // A fan in which EVERY item failed is a failed part (§2.6 BH-3) — carrying the first item's
        // own words, so the reader is told what went wrong and not merely that something did.
        if (record && record.n > 0 && record.ok === 0) {
          const message = t('parts.errAllItems', { message: record.errors.length ? record.errors[0].message : '' });
          blocked.add(id);
          errors.push({ partId: id, message });
          mark(id, { state: 'error', error: message, stats, fanout: record });
          emit({ type: 'part', partId: id, state: 'error', i, n: ids.length });
          continue;
        }

        let value = null;
        if (wantsValue) value = fanning ? joinResults(results) : results[0].value;
        mark(id, { state: 'done', value, error: null, stats, fanout: record });
        ran++;
        emit({ type: 'part', partId: id, state: 'done', i, n: ids.length });
      }

      // Anything still WAITING never ran: put it back where the run set will find it — in ONE
      // write, the same as the queueing that put it there. A capped run's leftovers come through
      // here too — which is why `skipped` counts the parts the run never reached while the report's
      // `stopped` counts every part the cap left unrun, the interrupted one included.
      /** @type {string[]} */ const leftover = [];
      const endDoc = session.doc();
      for (const id of ids) {
        const p = partById(endDoc, id);
        if (p && p.state === 'queued') { leftover.push(id); skipped++; }
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
    stop() { if (ac) ac.abort(); },
    running: () => !!ac,
    progress: () => (progress ? { ...progress } : null),
    /** The last finished run, for a panel that mounted after it (null before the first). */
    report: () => last,
    /** @param {(ev: any) => void} fn */
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
