// @ts-check
// Timer (K3, COMPUTER_PLAN §6.6) — waits `seconds`, then lets the wave through. HARD-CAPPED:
// `repeats` is 1..maxIterations and THERE IS NO "FOREVER". A run whose summed waits would exceed
// `maxWallMs` is refused AT PLAN TIME with the arithmetic shown (§4.6), which is K3-U1's half and
// reads `plannedWaitMs()` below.
//
// `setTimeout`, never `setInterval` — chat-lint rule 13 names this family by name.
//
// ONE activation is ONE wait. `repeats` is a DECLARATION the scheduler reads, not a loop this
// part runs: the part waits `seconds` and passes through, and re-activating what comes after it n
// times is the run loop's business (§4.6). That split is why a Timer cannot run away on its own,
// and why `plannedWaitMs()` — the arithmetic the plan-time refusal shows — is a pure function of
// the settings and nothing else.

import { valueOf } from '../values.mjs';
import { t } from '../../core/i18n.mjs';
import { RUN_LIMITS } from '../../core/types.mjs';
import { numberField } from './fields.mjs';
import { park, answer, isParked } from './control-bus.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

export const MIN_SECONDS = 0.1;
export const MAX_SECONDS = 3600;

/** @param {any} settings @returns {number} */
export function secondsOf(settings) {
  const raw = settings && settings.seconds;
  const n = Number(raw === undefined || raw === null ? 3 : raw);
  if (!Number.isFinite(n)) return 3;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, n));
}

/** @param {any} settings @param {number} [maxIterations] @returns {number} */
export function repeatsOf(settings, maxIterations) {
  const cap = Math.max(1, Math.floor(Number(maxIterations) || RUN_LIMITS.maxIterations));
  const raw = settings && settings.repeats;
  const n = Math.floor(Number(raw === undefined || raw === null ? 1 : raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(cap, n);
}

/** What this part will cost the run in WALL CLOCK, before the run starts (§4.6).
 * @param {any} part @param {number} [maxIterations] @returns {number} */
export function plannedWaitMs(part, maxIterations) {
  const s = part && part.settings;
  return Math.round(secondsOf(s) * 1000 * repeatsOf(s, maxIterations));
}

/** @type {PartSpec} */
export const timer = /** @type {any} */ ({
  type: 'timer',
  order: 650,
  label: t('parts.timerLabel'),
  thinks: false,
  control: true,
  size: { w: 220, h: 140 },
  inputs: [{ name: 'in', label: t('parts.ctlIn'), accepts: ['any'], many: false, required: false }],
  output: 'any',
  defaults: () => ({ seconds: 3, repeats: 1 }),

  // Declared ON the spec (K3 landing, resolving K3-U1's request): `topo.plannedWaitMsOf` prefers
  // this over its type-sniffing fallback, so the plan-time `maxWallMs` refusal reads the Timer's
  // OWN arithmetic. `repeatsFor` is the runner's door for `repeats > 1` (§6.6): a part that
  // declares it is re-queued — and so re-activates its downstream — until that many activations,
  // bounded by `maxIterations`.
  plannedWaitMs,
  /** @param {any} part @param {number} [maxIterations] @returns {number} */
  repeatsFor(part, maxIterations) {
    return repeatsOf(part && part.settings, maxIterations);
  },

  render(host, part, ctx) {
    const secs = numberField(t('parts.timerSeconds'), secondsOf(part.settings), MIN_SECONDS,
      (v) => { ctx.update({ seconds: v }); ctx.commit(t('parts.timerSeconds')); }, MAX_SECONDS);
    const reps = numberField(t('parts.timerRepeats'), repeatsOf(part.settings), 1,
      (v) => { ctx.update({ repeats: v }); ctx.commit(t('parts.timerRepeats')); }, RUN_LIMITS.maxIterations);
    const hint = document.createElement('p');
    hint.className = 'graph-part-hint';
    host.replaceChildren(secs.node, reps.node, hint);
    const paint = (/** @type {any} */ p) => {
      secs.update(secondsOf(p.settings));
      reps.update(repeatsOf(p.settings));
      hint.textContent = (p.state === 'waiting' || isParked(p.id))
        ? t('parts.timerWaiting', { seconds: secondsOf(p.settings) })
        : t('parts.timerHint', { seconds: secondsOf(p.settings), repeats: repeatsOf(p.settings) });
    };
    paint(part);
    return { update: paint, destroy() { host.replaceChildren(); } };
  },

  async run({ part, inputs, signal }) {
    const value = ((inputs && inputs.in) || [])[0] || valueOf('text', '');
    const ms = Math.round(secondsOf(part.settings) * 1000);
    const { request, promise } = park(part.id, 'timer', { untilMs: Date.now() + ms });
    const handle = setTimeout(() => answer(part.id, { ok: true, timeout: true }), ms);
    const onAbort = () => answer(part.id, { ok: false, cancelled: true });
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const settle = promise.then((a) => {
      clearTimeout(handle);
      if (signal) signal.removeEventListener('abort', onAbort);
      return { value, bar: !(a && a.ok) };
    });
    return { park: request, settle };
  },
});
