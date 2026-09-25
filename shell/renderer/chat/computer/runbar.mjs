// @ts-check
// The Computer's run bar (COMPUTER_PLAN §8.3, §11 K1-U3): the strip above the canvas that says
// what the last run did and lets you start or stop the next one.
//
//   [ Run all ] [ Stop ]   3 parts · 1 generation   1 / 50   100%   ?
//
// K1 lands exactly the controls §11 names — Run all, Stop, the two counts, the cap meter, the zoom
// readout and the `?`; K5 lights the `?` up. K3-U3 added, in this file and in
// css/computer-runbar.css: the PLAN PREVIEW before the first run of a graph (§4.6 — a RANGE,
// "6-48 generations", when the document declares a loop), the WAITS counter (§8.3 — "2 questions
// waiting" and the button that puts the canvas on the oldest one), and the reading of a finished
// run that the CANVAS then draws — which arrows a gate greyed (§8.2) and which of §4.6's four
// ceilings stopped it (§8.4). The bar is where the report is read, because it is the module that
// already reads reports; the canvas owns the picture and none of the arithmetic.
//
// The numbers are READ, never kept: the parts/generations counts come off the runner's own report
// and the zoom off the canvas's view. A run bar with its own idea of what ran is a run bar that
// will one day disagree with the canvas, and the canvas is the thing people believe.
//
// Feature contract (computer/main.mjs's loader, `runbar` row):
//   install(app) -> void, publishing app.runbar = {render(), setRunning(state)}
// It renders into app.els.runbar and nothing else. Run all and Stop go through the HOST's own run
// door, so pressing them walks the shipped path and not a second implementation (§0.4/BG-3).

import { t } from '../core/i18n.mjs';
import { KV_KEYS, RUN_LIMITS } from '../core/types.mjs';
import { DEFAULT_MAX_ITEMS } from '../graph/runner.mjs';
// K3-U3 (COMPUTER_PLAN §4.6, §8.3): the plan's RANGE and what is parked. Both are read, never
// kept — `runPlan` is topo's (K3-U1's file) and the parks are the control bus's (the integrator's
// singleton). A run bar with its own idea of either is a run bar that will one day disagree.
import { backEdges, forwardEdges, runPlan } from '../graph/topo.mjs';
import { onParks, pending } from '../graph/parts/control-bus.mjs';
// Critic S2-2: a run held back by a Button names it by what its face reads.
import { faceText } from '../graph/parts/button.mjs';
import '../strings/computer.en.mjs';
import '../strings/computer-gen.en.mjs';

/** The share of the cap past which the meter warns (§8.3: "turning amber past 80 %"). */
export const CAP_AMBER = 0.8;

/**
 * What the meter reads and whether it is warning. PURE, so the threshold is testable without a
 * canvas. @param {number} spent @param {number} cap
 * @returns {{text: string, amber: boolean}}
 */
export function capMeter(spent, cap) {
  const s = Math.max(0, Math.floor(Number(spent) || 0));
  const c = Math.max(1, Math.floor(Number(cap) || DEFAULT_MAX_ITEMS));
  return { text: `${s} / ${c}`, amber: s / c >= CAP_AMBER };
}

/** `{n} parts`, in the reader's own grammar. @param {number} n @returns {string} */
export function partsLabel(n) {
  // chat-lint rule 5: literal keys, never a key built from the count.
  return Number(n) === 1 ? t('computer.runPartsOne') : t('computer.runParts', { n: Number(n) || 0 });
}

/** `{n} generations`. @param {number} n @returns {string} */
export function generationsLabel(n) {
  return Number(n) === 1 ? t('computer.runGenerationsOne') : t('computer.runGenerations', { n: Number(n) || 0 });
}

/**
 * What the NEXT run will cost, as a range (§4.6: "a graph with a loop reads 6–48 generations,
 * minimum one pass, maximum `maxIterations` per looping thinking part. On a shared farm that
 * honesty is the point").
 *
 * K3-U1's `runPlan` is the authority and returns `costMin`/`costMax` once a loop can exist; while
 * it still returns the single `cost`, a document that HAS a back edge is still a looping graph and
 * the bar still owes the reader a range, so the ceiling is applied here. The moment the scheduler
 * reports its own numbers, these are ignored — which is the only way round that cannot go stale.
 * PURE. @param {any} plan @param {number} loops how many back edges the document declares
 * @returns {{min: number, max: number}}
 */
export function planRange(plan, loops) {
  const cost = Math.max(0, Math.floor(Number(plan && plan.cost) || 0));
  const hasMin = plan && Number.isFinite(Number(plan.costMin));
  const hasMax = plan && Number.isFinite(Number(plan.costMax));
  const min = hasMin ? Math.max(0, Math.floor(Number(plan.costMin))) : cost;
  const max = hasMax
    ? Math.floor(Number(plan.costMax))
    : (Number(loops) > 0 ? cost * RUN_LIMITS.maxIterations : cost);
  return { min, max: Math.max(min, max) };
}

/** The generations chip's text: one number, or §4.6's range. PURE.
 * @param {{min: number, max: number}} range @returns {string} */
export function rangeLabel(range) {
  const min = Math.max(0, Math.floor(Number(range && range.min) || 0));
  const max = Math.max(min, Math.floor(Number(range && range.max) || 0));
  return max > min ? t('computer.runRange', { min, max }) : generationsLabel(min);
}

/** `{n} questions waiting`, in the reader's own grammar. PURE. @param {number} n */
export function waitingLabel(n) {
  // chat-lint rule 5: literal keys, never a key built from the count.
  return Number(n) === 1 ? t('computer.runWaitingOne') : t('computer.runWaiting', { n: Number(n) || 0 });
}

/** `{n} boxes were stopped by a gate`. PURE. @param {number} n */
export function barredLabel(n) {
  return Number(n) === 1 ? t('computer.runBarredOne') : t('computer.runBarred', { n: Number(n) || 0 });
}

/**
 * Critic S1-1/S1-2: the ONE sentence a finished run leaves — in the bar AND in the canvas's live
 * region (computer/host.mjs), whatever door started it. A literal map (chat-lint rule 5): every
 * outcome is one of these keys, chosen by `outcomeOf`.
 */
const OUTCOME = {
  nothing: 'computer.runNothing',
  done: 'computer.runOutcomeDone',
  doneOne: 'computer.runOutcomeDoneOne',
  hidden: 'computer.runOutcomeHidden',
  busy: 'computer.runOutcomeBusy',
  already: 'computer.runOutcomeAlready',
  stopped: 'computer.runOutcomeStopped',
  cycle: 'computer.runOutcomeCycle',
  errors: 'computer.runOutcomeErrors',
  errorsOne: 'computer.runOutcomeErrorsOne',
  capped: 'computer.runOutcomeCapped',
  cappedItems: 'computer.runOutcomeCappedItems',
  limited: 'computer.runOutcomeLimited',
  planned: 'computer.runOutcomePlanned',
  held: 'computer.runOutcomeHeld',
  heldOne: 'computer.runOutcomeHeldOne',
  barred: 'computer.runBarred',
  barredOne: 'computer.runBarredOne',
  leftStale: 'computer.runLeftStale',
};

/** @typedef {{id: keyof typeof OUTCOME, key: string, vars: any}} OutcomeBit */

/** @param {keyof typeof OUTCOME} id @param {any} [vars] @returns {OutcomeBit} */
const bit = (id, vars) => ({ id, key: OUTCOME[id], vars: vars || {} });

/**
 * What a finished run SAYS (critic S1-1): one key and its vars, plus the notes that ride after it
 * (a gate that barred boxes, boxes an edit left stale). PURE. The order is the order of what a
 * reader most needs to know:
 *   already   the run was refused because one is going (`busy` on the report)
 *   cycle     a loop nothing can stop
 *   stopped   Stop (or a switch) ended it
 *   hidden    it YIELDED because this window was in the background — nothing was sent
 *   busy      it yielded because someone else took the seat
 *   capped    the generation cap (or one fan over it)
 *   planned   a Timer plan refused before it started · limited — another ceiling
 *   held      boxes wait behind a Button nobody pressed (critic S2-2): the one thing to do next is
 *             press it, so it leads — what did run, and what failed, ride after it as notes
 *   errors    boxes failed
 *   nothing   nothing was stale: the ONLY outcome that offers "Run everything again"
 *   done      boxes ran
 * `o.nameOf(buttonId)` names a held Button (`faceNamesIn(doc)`: what its face reads); without it
 * the default face's words stand in.
 * @param {any} out a RunReport, or null
 * @param {{nameOf?: (id: string) => string}} [o]
 * @returns {{id: keyof typeof OUTCOME, key: string, vars: any, notes: OutcomeBit[]}|null}
 */
export function outcomeOf(out, o) {
  if (!out) return null;
  const ran = Math.max(0, Math.floor(Number(out.ran) || 0));
  const errors = Array.isArray(out.errors) ? out.errors.length : 0;
  const barred = Array.isArray(out.barred) ? out.barred.length : 0;
  const stale = Array.isArray(out.leftStale) ? out.leftStale.length : 0;
  const heldBy = Array.isArray(out.heldBy) ? out.heldBy.filter((/** @type {any} */ id) => typeof id === 'string' && id) : [];
  /** @param {OutcomeBit} main @param {OutcomeBit[]} [notes] */
  const said = (main, notes) => ({ ...main, notes: notes || [] });
  if (out.busy) return said(bit('already'));
  if (out.cycle) return said(bit('cycle'));
  if (out.cancelled) return said(bit('stopped'));
  if (out.yielded) return said(bit(out.yieldedBy && out.yieldedBy.hidden ? 'hidden' : 'busy'));
  if (out.capped) {
    const c = out.capped;
    return said(c.items
      ? bit('cappedItems', { items: c.items, cap: c.cap })
      : bit('capped', { cap: c.cap, n: Number(c.stopped) || 0 }));
  }
  if (out.limited) return said(bit(out.limited.planned ? 'planned' : 'limited'));
  /** @type {OutcomeBit[]} */ const notes = [];
  if (barred) notes.push(barred === 1 ? bit('barredOne') : bit('barred', { n: barred }));
  if (stale) notes.push(bit('leftStale', { n: stale }));
  const sec = (Math.max(0, Number(out.ms) || 0) / 1000).toFixed(1);
  const failed = errors ? (errors === 1 ? bit('errorsOne') : bit('errors', { n: errors })) : null;
  const done = ran === 1 ? bit('doneOne', { sec }) : bit('done', { n: ran, sec });
  if (heldBy.length) {
    // Critic S2-2: `held` counts every box waiting for the press; a report without it (a hand-made
    // one) falls back to what the run skipped, at least the one box after the Button.
    const n = Array.isArray(out.held) && out.held.length
      ? out.held.length : Math.max(1, Math.floor(Number(out.skipped) || 0));
    const nameOf = o && typeof o.nameOf === 'function' ? o.nameOf : null;
    const button = (nameOf && String(nameOf(heldBy[0]) || '')) || faceText(null);
    /** @type {OutcomeBit[]} */ const also = [];
    if (ran) also.push(done);
    if (failed) also.push(failed);
    return said(n === 1 ? bit('heldOne', { button }) : bit('held', { button, n }), [...also, ...notes]);
  }
  if (failed) return said(failed, notes);
  if (!ran && !barred) return said(bit('nothing'));
  return said(done, notes);
}

/** The outcome as the sentence both the bar and the live region say. PURE. @param {any} out
 * @param {{nameOf?: (id: string) => string}} [o] as `outcomeOf`
 * @returns {string} '' when there is no report */
export function outcomeText(out, o) {
  const got = outcomeOf(out, o);
  if (!got) return '';
  const head = t(OUTCOME[got.id], got.vars);
  const tail = got.notes.map((n) => t(OUTCOME[n.id], n.vars));
  return [head, ...tail].join(' · ');
}

/**
 * Critic S2-2: `outcomeOf`'s `nameOf` for one document — a Button is named by what its FACE reads
 * (graph/parts/button.mjs `faceText`), the words a person has to find and press.
 * @param {any} doc @returns {(id: string) => string}
 */
export function faceNamesIn(doc) {
  return (id) => {
    const part = doc && Array.isArray(doc.parts) ? doc.parts.find((/** @type {any} */ p) => p.id === id) : null;
    return part ? faceText(part.settings) : '';
  };
}

/**
 * Critic R1 A1: did this run find NOTHING to do — every box up to date? That is the moment the bar
 * offers "Run everything again" instead of a dead end. Critic S1-1: exactly `outcomeOf`'s
 * `nothing` — a run that YIELDED (the window was hidden, the seat was taken) sent nothing, but it
 * did not find everything up to date, and "Run everything again" would re-roll finished boxes.
 * Critic S2-2: nor did a run `held` behind an unpressed Button — its forced re-run would still skip
 * that Button, re-roll every other box and leave the held one stale.
 * PURE. @param {any} out a RunReport, or null @returns {boolean}
 */
export function nothingRan(out) {
  const o = outcomeOf(out);
  return !!o && o.id === 'nothing';
}

/** @param {string} cls @param {string} text @param {HTMLElement} [parent] */
function chip(cls, text, parent) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

/** @param {string} cls @param {string} label @param {(() => void)} onClick */
function button(cls, label, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = cls;
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

/** @param {any} app */
export function install(app) {
  const root = app && app.els ? app.els.runbar : null;
  if (!root) {
    app.runbar = { render: () => {}, setRunning: () => {} };
    return;
  }

  const host = () => app.host || null;
  const runner = () => {
    const h = host();
    return h && h.runner ? h.runner : null;
  };
  const canvas = () => {
    const h = host();
    return h && h.canvas ? h.canvas : null;
  };

  /**
   * The one door a run goes through. `host.start()` is the shipped one — it clears the cap banner,
   * re-arms a disabled sandbox and announces the outcome — and the debug door is the same
   * function under its frozen name. `runner.run()` is the floor: a host that has neither still
   * runs, it just says less. @returns {(opts?: any) => Promise<any>}
   */
  function runDoor() {
    const h = host();
    if (h && typeof h.start === 'function') return (o) => h.start(o || {});
    if (h && h.debug && typeof h.debug.run === 'function') return (o) => h.debug.run(o || {});
    const r = runner();
    if (r && typeof r.run === 'function') return (o) => r.run(o || {});
    return async () => null;
  }

  /** The generation cap for the NEXT run, as the runner will read it. */
  let cap = DEFAULT_MAX_ITEMS;
  /** The document the last adopted report belongs to. A report is about ONE graph: open another
   *  and the bar goes back to planning rather than quoting a run that happened somewhere else. */
  let reportDocId = '';
  /** The document revision that report was adopted at: an edit after it retires "Run again". */
  let reportRev = -1;
  /** What the status line is saying (critic S1-2): a run's outcome, a waiting question, or nothing. */
  /** @type {''|'outcome'|'wait'|'other'} */ let statusKind = '';

  // ---- the bar ---------------------------------------------------------------------------------
  const runBtn = button('comp-run-all', t('computer.runAll'), () => { runAll(); });
  const stopBtn = button('comp-run-stop', t('computer.runStop'), () => {
    const r = runner();
    if (r && typeof r.stop === 'function') r.stop();
  });
  stopBtn.classList.add('hidden');

  const counts = document.createElement('div');
  counts.className = 'comp-run-counts';
  const partsChip = chip('comp-run-parts', partsLabel(0), counts);
  const gensChip = chip('comp-run-gens', generationsLabel(0), counts);
  const capChip = chip('comp-run-cap', capMeter(0, cap).text, counts);
  // K3-U3 (§8.3: "Waiting: ... and the run bar counts them"). Two Dialogs open at once and the bar
  // says `2 questions waiting` — the one place a reader can see that the run is not stuck but
  // asking. The button beside it puts the canvas on the oldest question.
  const waitsChip = chip('comp-run-waits', '', counts);
  waitsChip.hidden = true;
  const waitsBtn = button('comp-run-show-waiting', t('computer.runShowWaiting'), () => { showWaiting(); });
  waitsBtn.hidden = true;
  counts.appendChild(waitsBtn);

  // The chip shows the live zoom and opens the canvas's zoom menu (fit, selection, 100 %), so the
  // bar and the toolbar are one control; on a canvas without the menu it still fits.
  const zoomBtn = button('comp-run-zoom', t('computer.runZoom', { percent: 100 }), () => {
    const c = /** @type {any} */ (canvas());
    if (c && typeof c.openZoomMenu === 'function') c.openZoomMenu(zoomBtn);
    else if (c && typeof c.fit === 'function') c.fit();
    paint();
  });

  const helpBtn = document.createElement('button');
  helpBtn.type = 'button';
  helpBtn.className = 'comp-run-help';
  helpBtn.textContent = '?';
  helpBtn.setAttribute('aria-label', t('computer.runHelp'));
  helpBtn.title = t('computer.runHelp');
  // K5 owns the `?` card (§8.5). Until the tutorial exists there is nothing honest to show, and a
  // button that answers a question with silence is worse than one that says it cannot yet.
  helpBtn.disabled = true;
  helpBtn.addEventListener('click', () => {
    const tut = /** @type {any} */ (app).tutorial;
    if (tut && typeof tut.explain === 'function') tut.explain();
  });

  const status = document.createElement('p');
  status.className = 'comp-run-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  // Critic R1 A1: "Nothing to run — every box is up to date" used to be a dead end, and the only
  // way to get a new answer was to edit something. When a run finds nothing stale the bar offers
  // this instead: every box runs again (`force`, which still leaves an unpressed Button and the
  // notes alone), and every Instruction set to "new each run" gets a new seed.
  const againBtn = button('comp-run-again', t('computer.genRunAgain'), () => { runAll({ force: true }); });
  againBtn.title = t('computer.genRunAgainHint');
  againBtn.hidden = true;

  // Order matters: the status line reads left-to-right after the counts it explains, and the zoom
  // readout carries `margin-left:auto`, so everything after it is pinned to the right edge.
  root.replaceChildren(runBtn, stopBtn, counts, status, againBtn, zoomBtn, helpBtn);
  // The frozen probe `h.computer.states().runbar` reads `#lolcomputer .comp-run` (KC-4), and the
  // element the layout hands us is `.comp-runbar`. One class, so the harness reads the real bar
  // rather than an empty string that would pass every assertion by accident.
  root.classList.add('comp-run');

  // ---- painting --------------------------------------------------------------------------------
  /** The last finished run, when the runner remembers one. */
  function report() {
    const r = runner();
    return r && typeof r.report === 'function' ? r.report() : null;
  }

  // The cap lives in kv, and the canvas toolbar's cap field writes the SAME key (graph/canvas.mjs)
  // while graph/runner.mjs re-reads it on every run. Reading it once at install left the meter
  // showing `N / 50` after the reader had moved the cap to 10, i.e. the two cap widgets on this
  // surface actively contradicting each other. So re-read on every paint, and repaint only when
  // the number actually moved (which is what stops this from looping).
  let capInFlight = false;
  function refreshCap() {
    const repo = app && app.repo;
    if (!repo || typeof repo.kvGet !== 'function' || capInFlight) return;
    capInFlight = true;
    Promise.resolve(repo.kvGet(KV_KEYS.prefComputeMaxItems, DEFAULT_MAX_ITEMS))
      .then((stored) => {
        capInFlight = false;
        const next = Number(stored) > 0 ? Math.floor(Number(stored)) : DEFAULT_MAX_ITEMS;
        if (next !== cap) { cap = next; paintNow(); }
      })
      .catch(() => { capInFlight = false; });
  }

  /** The document the bar is describing, or null. */
  function docNow() {
    const h = host();
    return h && h.session && typeof h.session.doc === 'function' ? h.session.doc() : null;
  }

  /** The last plan, and the document revision it was made for. */
  let planKey = '';
  /** @type {{parts: number, range: {min: number, max: number}}|null} */ let planVal = null;

  /**
   * What the next run would cost, BEFORE it is paid for (§4.6's plan preview). `runPlan` is
   * topo's, so the bar quotes the scheduler rather than counting thinking boxes itself — which is
   * what makes a free text-mode Condition quote nothing.
   *
   * MEMOISED on the document's revision, and never called while a run is live. `runPlan` walks
   * every part and every wire; `paint()` runs on every runner event, and a run over 1000 parts
   * emits three per part. Planning on each of those is O(N²) and cost 3 ms per part on the perf
   * fixture — the plan cannot change mid-run anyway, because the reader is not editing.
   * @returns {{parts: number, range: {min: number, max: number}}|null}
   */
  function plan() {
    const h = host();
    const doc = docNow();
    if (!doc || !h || !h.session) return null;
    const key = `${doc.rev || 0}|${doc.parts.length}|${doc.wires.length}|${cap}`;
    if (key === planKey) return planVal;
    try {
      let out = runPlan(doc, { cap, specs: h.session.specs });
      const loops = backEdges(doc).length;
      // While `runPlan` still refuses a document with a back edge as a cycle (§4.6 says `order()`
      // runs on the forward graph), plan the forward graph instead — the loop is still counted,
      // because the RANGE is computed from `loops`, not from the edge being walked.
      if (!out.ok && loops) out = runPlan(forwardEdges(doc), { cap, specs: h.session.specs });
      planKey = key;
      planVal = { parts: (out.ids || []).length, range: planRange(out, loops) };
      return planVal;
    } catch (err) {
      console.warn('[lolcomputer] the run bar could not read the plan', err);
      planKey = key;
      planVal = null;
      return null;
    }
  }

  /**
   * Put the canvas on the oldest question and say which part it is (§8.3's `Show me`). Critic S1-8:
   * it used to only SELECT the box — a Dialog off screen stayed off screen. `reveal` pans to it
   * (and selects and flashes it), and the answer field takes the focus, so the next key types the
   * answer. `preventScroll`: the canvas owns its own view; a native scroll would fight it.
   */
  function showWaiting() {
    const waiting = pending();
    if (!waiting.length) return false;
    const c = /** @type {any} */ (canvas());
    const doc = docNow();
    const partId = waiting[0].partId;
    if (c && typeof c.reveal === 'function') c.reveal(partId);
    else if (c && typeof c.select === 'function') c.select([partId]);
    const scope = /** @type {any} */ ((app.els && app.els.canvas) || (typeof document !== 'undefined' ? document : null));
    const field = scope && typeof scope.querySelector === 'function'
      ? scope.querySelector(`.graph-part-answer[data-part="${String(partId).replace(/["\\]/g, '')}"]`) : null;
    if (field && typeof field.focus === 'function') {
      try { field.focus({ preventScroll: true }); } catch { field.focus(); }
    }
    const part = doc && Array.isArray(doc.parts) ? doc.parts.find((/** @type {any} */ p) => p.id === partId) : null;
    const h = host();
    const spec = part && h && h.session && h.session.specs ? h.session.specs.get(part.type) : null;
    say(t('computer.runWaitFor', { part: (spec && spec.label) || (part ? part.type : partId) }), 'wait');
    return true;
  }

  /** The last painted waits count, so the common case (none) writes no DOM at all. */
  let paintedWaits = -1;

  function paintWaits() {
    const n = pending().length;
    if (n === paintedWaits) return;
    paintedWaits = n;
    waitsChip.textContent = n ? waitingLabel(n) : '';
    waitsChip.hidden = !n;
    waitsBtn.hidden = !n;
    // Critic S1-2: "Waiting for Dialog" is about a question that is waiting — not once none is.
    if (!n && statusKind === 'wait') say('');
  }

  /**
   * ONE rAF for the whole bar, exactly as the canvas has one (§2.6 BG-8's habit). A run over a
   * thousand parts emits three events per part; painting a text chip on each of them is three
   * thousand style recalculations for sixty frames' worth of readable change, and the perf gate
   * measures precisely that. Anything a scenario reads straight after an await is painted through
   * `paintNow()` instead — the terminal events and `render()`.
   */
  let paintRaf = 0;
  function paint() {
    if (paintRaf) return;
    paintRaf = requestAnimationFrame(() => { paintRaf = 0; paintNow(); });
  }

  function paintNow() {
    refreshCap();
    const r = runner();
    const running = !!(r && typeof r.running === 'function' && r.running());
    runBtn.classList.toggle('hidden', running);
    stopBtn.classList.toggle('hidden', !running);
    runBtn.disabled = !r;

    // Before the first run the bar PLANS — what would run, and what it would cost as a range on a
    // looping graph; afterwards it reports what the run actually did, which is the number a reader
    // wants when six of nine boxes were cached.
    const last = report();
    const doc = docNow();
    const h = host();
    const here = h && h.session && typeof h.session.docId === 'function' ? (h.session.docId() || '') : '';
    // The bar reports the LAST RUN of THIS graph; with no such run — a fresh document, or one
    // never run — it PLANS the next one instead (§4.6's preview, a range when there is a loop).
    // Never mid-run: a run is not a moment to re-quote a price, and `runPlan` walks the document.
    const mine = !!(last && here && here === reportDocId);
    const ahead = running || mine ? null : plan();
    // What the PARTS chip counts is unchanged since K1 — the boxes on the canvas before a run,
    // what the run reported after it. `runPlan`'s run set is the scheduler's business and is not
    // the same number a reader is looking at when they have drawn three boxes.
    const parts = mine ? Number(last.ran) || 0 : (doc && Array.isArray(doc.parts) ? doc.parts.length : 0);
    const gens = mine ? Number(last.generations) || 0 : 0;
    const partsText = partsLabel(parts);
    if (partsChip.textContent !== partsText) partsChip.textContent = partsText;
    const gensText = ahead && !mine ? rangeLabel(ahead.range) : generationsLabel(gens);
    if (gensChip.textContent !== gensText) gensChip.textContent = gensText;
    paintWaits();

    // "Run everything again" stands while the last run of THIS graph found nothing to do and
    // nothing has been edited since — an edit makes something stale, and then Run all is the
    // honest button again.
    const again = !running && mine && nothingRan(last) && !!doc && (Number(doc.rev) || 0) === reportRev;
    if (againBtn.hidden === again) againBtn.hidden = !again;
    // Critic S1-2: the run's sentence is about THAT run of THIS graph as it was. An edit since (the
    // box is stale now), or another graph open, and it is no longer true — so it goes.
    if (statusKind === 'outcome' && !running && (!mine || !doc || (Number(doc.rev) || 0) !== reportRev)) say('');

    const meter = capMeter(gens, cap);
    if (capChip.textContent !== meter.text) capChip.textContent = meter.text;
    const amber = meter.amber ? 'true' : 'false';
    if (capChip.dataset.amber !== amber) capChip.dataset.amber = amber;

    const c = canvas();
    const view = c && typeof c.view === 'function' ? c.view() : null;
    const percent = Math.round((view && Number(view.zoom) ? view.zoom : 1) * 100);
    const zoomText = t('computer.runZoom', { percent });
    if (zoomBtn.textContent !== zoomText) zoomBtn.textContent = zoomText;

    helpBtn.disabled = !(/** @type {any} */ (app).tutorial);
  }

  /** @param {string} text @param {''|'outcome'|'wait'|'other'} [kind] */
  function say(text, kind) {
    const next = text ? String(text) : '';
    statusKind = next ? (kind || 'other') : '';
    if (status.textContent !== next) status.textContent = next;
  }

  /**
   * What the canvas has to show about a finished run (K3-U3, COMPUTER_PLAN §8.2, §8.4). The bar is
   * the module that READS the report, so it is the module that tells the canvas which arrows a
   * gate greyed and which ceiling stopped the run. The canvas owns the picture; it owns none of
   * the arithmetic. @param {any} out a RunReport, or null
   */
  function adoptReport(out) {
    const h = host();
    if (out && h && h.session && typeof h.session.docId === 'function') {
      reportDocId = h.session.docId() || '';
      const d = docNow();
      reportRev = d ? Number(d.rev) || 0 : -1;
    }
    const c = canvas();
    if (!c) return;
    if (typeof c.setBarred === 'function') c.setBarred((out && out.barred) || []);
    if (!out || typeof c.setLimited !== 'function') return;
    if (out.limited) {
      // §4.6: every ceiling is raisable FOR THAT RUN, through the frozen `run({limits})` door —
      // the same door the Run button uses, so the raise walks the shipped path.
      c.setLimited(out.limited, { onRaise: (/** @type {any} */ limits) => { void runDoor()({ limits }); } });
    } else if (!out.capped) {
      c.setLimited(null);
    }
  }

  /**
   * The sentence a finished run leaves behind (§8.3), whatever door started it (critic S1-2): the
   * runner's own `done` event says it, so ▶, a Button's face and the toolbar's Run are reported
   * exactly like Run all. It is `outcomeText` — the same sentence the live region gets (S1-1).
   * @param {any} out
   */
  function sayOutcome(out) {
    if (!out) return;
    say(outcomeText(out, { nameOf: faceNamesIn(docNow()) }), 'outcome');
  }

  async function runAll(/** @type {any} */ opts) {
    const r = runner();
    if (r && typeof r.running === 'function' && r.running()) return null;
    const out = await runDoor()(opts || {});
    adoptReport(out);
    paintNow();
    return out;
  }

  // ---- what makes it repaint -------------------------------------------------------------------
  const offs = [];
  const r0 = runner();
  /** What THIS run has barred so far, from the runner's own events (§8.2). */
  /** @type {Set<string>} */ let liveBarred = new Set();
  const pushBarred = () => {
    const c = canvas();
    if (c && typeof c.setBarred === 'function') c.setBarred(Array.from(liveBarred));
  };
  if (r0 && typeof r0.on === 'function') {
    offs.push(r0.on((/** @type {any} */ ev) => {
      const type = ev && ev.type;
      // The grey arrives WHILE the run happens, not after it: a reader watching a Condition choose
      // one of three branches has to see the other two go grey at the moment it chooses. The run's
      // own `barred` events say exactly that, and the report confirms it at the end.
      // Critic S1-2: a new run retires the last one's sentence at once, whatever door started it.
      if (type === 'start') { liveBarred = new Set(); pushBarred(); say(''); }
      else if (type === 'barred' && Array.isArray(ev.ids)) {
        for (const id of ev.ids) liveBarred.add(id);
        pushBarred();
      }
      // A run that ended anywhere but through `runAll` — the canvas toolbar's Run, a per-box ▶,
      // the debug door — still has barred branches and a ceiling to show. The report is the same
      // object either way, so the bar adopts it from the runner's own event.
      // The coalesced paint is for the THOUSAND `part` events one run emits. Everything else — a
      // run starting, a park opening, the end — moves a control a person is about to press, and
      // is painted at once: a Stop button that appears one frame late is a Stop button that was
      // not there when the reader reached for it.
      if (!(r0.running && r0.running())) {
        adoptReport(report());
        paintNow();
        if (type === 'done') sayOutcome((ev && ev.report) || report());
      } else if (type === 'part' || type === 'item') paint();
      else paintNow();
    }));
  }
  // A park opening or closing is not a runner event and not a document edit: it is its own
  // channel, and the waits counter is the only thing on the bar that reads it.
  offs.push(onParks(() => paintWaits()));
  const h0 = host();
  // An EDIT repaints the bar at once — a reader who has just drawn a third box must not read
  // "2 parts" for a frame, and in a hidden or occluded window rAF may not run at all, which is
  // how a coalesced paint here turned into a flaky test rather than a slow one. During a RUN it
  // is coalesced, because that is the path that patches a thousand boxes three times each.
  if (h0 && h0.session && typeof h0.session.on === 'function') {
    offs.push(h0.session.on(() => {
      const live = runner();
      if (live && typeof live.running === 'function' && live.running()) paint();
      else paintNow();
    }));
  }

  paintNow();   // which also kicks off the first refreshCap()

  app.runbar = {
    render: () => paintNow(),
    /** The host may tell the bar directly; it still reads the runner for everything else. */
    setRunning: () => paintNow(),
    runAll,
    say,
    destroy() {
      if (paintRaf) { cancelAnimationFrame(paintRaf); paintRaf = 0; }
      for (const off of offs) { try { off(); } catch (err) { void err; } }
    },
  };
}
