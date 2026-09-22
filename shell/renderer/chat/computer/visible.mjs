// @ts-check
// PURE. The Computer's `visible` rule, frozen at the K1 kickoff (COMPUTER_PLAN §2.3, revision 2).
//
// It lives in its own module for one reason: `computer/main.mjs` owns the line, main.mjs calls
// mount() at module scope and therefore cannot be imported by a unit test, and K1-U1's acceptance
// is an assertion ABOUT this predicate. So the predicate is here, main.mjs is its only caller, and
// `computer-surface.test.mjs` imports it directly.
//
// The rule, in one sentence:
//   The Computer's app.state.visible is true while #lolcomputer is SHOWN, or while an activation
//   of a run it started is CURRENTLY EXECUTING. It is FALSE while a run is merely suspended on a
//   Confirm, a Dialog or a Timer.
//
// Why `executing()` and not `running()`: app/ask.mjs refuses with `busy` when state.visible is
// false, so a run the human deliberately started must keep its seat while they look at something
// else in the same window. But a Dialog nobody answers must not hold `visible` open indefinitely —
// that is the exact condition ask.mjs's hidden-means-idle rule exists to enforce. A park resolves
// by clicking the part, which requires the surface to be shown anyway, so the narrower rule costs
// nothing. `pageVisible` (a minimised window) still gates everything, unchanged.

/**
 * The predicate itself.
 * @param {{shown: boolean, executing: boolean}} o
 * @returns {boolean}
 */
export function computeVisible(o) {
  return !!(o && (o.shown || o.executing));
}

/**
 * "Is an activation executing right now?", read off a runner.
 *
 * K3 gives the runner `executing()` — true only while an activation is in flight, false while the
 * run is parked on a Dialog/Confirm/Timer. Until then there is no parking at all and `running()`
 * means exactly the same thing, so K1 reads whichever the runner has. Nothing else in the tree may
 * make that choice: one place, one rule.
 * @param {any} runner
 * @returns {boolean}
 */
export function runnerExecuting(runner) {
  if (!runner) return false;
  if (typeof runner.executing === 'function') return !!runner.executing();
  if (typeof runner.running === 'function') return !!runner.running();
  return false;
}
