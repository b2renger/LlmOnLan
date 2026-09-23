// @ts-check
// THE PARK REGISTRY — the one seam between K3's three units (COMPUTER_PLAN §4.1, §4.3, §6.6).
// Integrator-owned, frozen at the K3 kickoff. PURE: no DOM, no network, no timers of its own.
//
// A control part that must wait for a human or a clock does not block the run loop. It calls
// `park()`, hands the runner `{park, settle}` (core/types.mjs `PartOutcome`), and the runner marks
// it `waiting` and goes on serving other branches (§4.3). When the human clicks OK, types an
// answer or the Timer's `setTimeout` fires, ONE of three callers resolves it:
//
//   K3-U2  the part's own render(): the inline OK/Cancel, the question field's Send, the Timer's
//          own timeout — all of them call `answer(partId, …)`.
//   K3-U3  the canvas draws those controls in the box's body and routes their clicks here.
//   K3-U1  the runner reads `pending()` for the journal's `waits` and the run bar's count, and
//          calls `cancelAll()` from `stop()` (§4.8: "rejects every park").
//
// Why a module singleton and not per-session state: `render()` and `run()` are different calls on
// different objects, and only the Computer surface runs graphs. Keyed by partId, so a second
// activation of the same part replaces the first — a part cannot be parked twice at once.
//
// The ANSWER shape is deliberately not a GraphValue: a part decides what its answer MEANS.
//   answer(partId, {ok: true})              a Confirm accepted     → the part resolves bar:false
//   answer(partId, {ok: false})             a Confirm cancelled    → the part resolves bar:true
//   answer(partId, {ok: true, text: '…'})   a Dialog answered
//   answer(partId, {ok: true, timeout: true})  a clock, or a Confirm that timed out

/** @typedef {import('../../core/types.mjs').ParkRequest} ParkRequest */
/** @typedef {{ok: boolean, text?: string, timeout?: boolean, cancelled?: boolean}} ParkAnswer */

/** @type {Map<string, {request: ParkRequest, resolve: (a: ParkAnswer) => void}>} */
const parked = new Map();

/** @type {Set<(pending: ParkRequest[]) => void>} */
const listeners = new Set();

function announce() {
  const list = pending();
  for (const fn of Array.from(listeners)) {
    try { fn(list); } catch (err) { console.error('[lolcomputer] park listener threw', err); }
  }
}

/**
 * Park one activation. The returned `promise` NEVER rejects: a cancel is an answer
 * (`{ok:false, cancelled:true}`), because a rejected park would look to the runner exactly like a
 * part that threw, and a cancelled Confirm is not an error (§6.6).
 * @param {string} partId @param {'confirm'|'dialog'|'timer'} kind
 * @param {{question?: string, untilMs?: number|null, now?: () => number}} [meta]
 * @returns {{request: ParkRequest, promise: Promise<ParkAnswer>}}
 */
export function park(partId, kind, meta = {}) {
  const id = String(partId || '');
  // A second park on the same part cancels the first: the run that owned it is gone.
  if (parked.has(id)) answer(id, { ok: false, cancelled: true });
  /** @type {ParkRequest} */
  const request = {
    kind,
    partId: id,
    since: (meta.now || Date.now)(),
    ...(meta.question ? { question: String(meta.question) } : {}),
    ...(meta.untilMs === undefined ? {} : { untilMs: meta.untilMs }),
  };
  /** @type {(a: ParkAnswer) => void} */ let resolve = () => {};
  const promise = new Promise((res) => { resolve = res; });
  parked.set(id, { request, resolve });
  announce();
  return { request, promise };
}

/**
 * Answer a parked activation. Returns false when nothing was waiting on that part — which is the
 * honest answer to a stale click on a control the run already moved past.
 * @param {string} partId @param {ParkAnswer} value @returns {boolean}
 */
export function answer(partId, value) {
  const id = String(partId || '');
  const entry = parked.get(id);
  if (!entry) return false;
  parked.delete(id);
  try { entry.resolve(value && typeof value === 'object' ? value : { ok: false }); } finally { announce(); }
  return true;
}

/** Is this part parked right now? @param {string} partId @returns {boolean} */
export function isParked(partId) {
  return parked.has(String(partId || ''));
}

/** What one part is waiting for, or null. @param {string} partId @returns {ParkRequest|null} */
export function parkOf(partId) {
  const entry = parked.get(String(partId || ''));
  return entry ? { ...entry.request } : null;
}

/** Everything parked right now, oldest first — the run bar's `2 questions waiting` and the
 * journal's `waits` both read this. @returns {ParkRequest[]} */
export function pending() {
  return [...parked.values()].map((e) => ({ ...e.request }))
    .sort((a, b) => (Number(a.since) || 0) - (Number(b.since) || 0));
}

/** Cancel every park — Stop (§4.8), and a document close. @returns {number} how many */
export function cancelAll() {
  const ids = [...parked.keys()];
  for (const id of ids) answer(id, { ok: false, cancelled: true });
  return ids.length;
}

/** Subscribe to the pending list. @param {(pending: ParkRequest[]) => void} fn @returns {() => void} */
export function onParks(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}
