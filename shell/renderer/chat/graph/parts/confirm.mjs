// @ts-check
// Confirm (K3, COMPUTER_PLAN §6.6) — OK / Cancel INLINE ON THE PART, on the canvas. A modal over
// a canvas is hostile and hides which box is asking. The run suspends THIS BRANCH ONLY: the other
// branches keep going, and the run bar counts the wait.
//
// The value flows whatever the human said (§4.5): Cancel refuses to ACTIVATE what comes next, it
// does not erase what came in — so a part that runs for another reason still reads through it.
// What Cancel changes is the SENTENCE on the box, because "this branch stopped here, and a person
// stopped it" is the one thing a reader must not have to infer from a grey wire.

import { valueOf } from '../values.mjs';
import { t } from '../../core/i18n.mjs';
import { textField, numberField } from './fields.mjs';
import { park, answer, isParked } from './control-bus.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

/** How each box's last activation ended: '' (never ran, or OK), 'cancelled', 'timeout'. The box
 * reads it to say so in words; nothing else depends on it. @type {Map<string, string>} */
const outcomes = new Map();

/** @param {string} partId @returns {string} */
export function lastOutcome(partId) {
  return outcomes.get(String(partId || '')) || '';
}

/** chat-lint rule 5: a t() key is a literal or a same-file literal MAP, never a built string. */
const OUTCOME_LABEL = {
  cancelled: () => t('parts.confirmCancelled'),
  timeout: () => t('parts.confirmTimedOut'),
};

/** @type {PartSpec} */
export const confirm = /** @type {any} */ ({
  type: 'confirm',
  order: 630,
  label: t('parts.confirmLabel'),
  thinks: false,
  control: true,
  size: { w: 240, h: 150 },
  inputs: [{ name: 'in', label: t('parts.ctlIn'), accepts: ['any'], many: false, required: false }],
  output: 'any',
  defaults: () => ({ message: '', timeoutSec: 0 }),

  render(host, part, ctx) {
    const message = textField(t('parts.confirmMessage'), String(part.settings.message || ''), {
      onInput: (v) => ctx.update({ message: v }),
      onCommit: () => ctx.commit(t('parts.confirmMessage')),
    });
    const timeout = numberField(t('parts.confirmTimeout'), Number(part.settings.timeoutSec) || 0, 0,
      (v) => { ctx.update({ timeoutSec: v }); ctx.commit(t('parts.confirmTimeout')); }, 3600);

    // The inline control. `[data-action]` + `[data-part]` is the FROZEN probe the canvas and the
    // harness both read (K3 addendum): a control part never reaches for the runner itself.
    const row = document.createElement('div');
    row.className = 'graph-part-controls';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'graph-part-control';
    ok.dataset.action = 'ok';
    ok.dataset.part = part.id;
    ok.textContent = t('parts.confirmOk');
    ok.addEventListener('click', () => answer(part.id, { ok: true }));
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'graph-part-control';
    no.dataset.action = 'cancel';
    no.dataset.part = part.id;
    no.textContent = t('parts.confirmCancel');
    no.addEventListener('click', () => answer(part.id, { ok: false }));
    row.append(ok, no);

    const asking = document.createElement('p');
    asking.className = 'graph-part-hint';
    host.replaceChildren(message.node, timeout.node, asking, row);
    const paint = (/** @type {any} */ p) => {
      message.update(String(p.settings.message || ''));
      const waiting = p.state === 'waiting' || isParked(p.id);
      row.hidden = !waiting;
      const ended = lastOutcome(p.id);
      asking.textContent = waiting
        ? (String(p.settings.message || '') || t('parts.confirmAsking'))
        : (ended && OUTCOME_LABEL[ended] ? OUTCOME_LABEL[ended]() : '');
    };
    paint(part);
    return { update: paint, destroy() { host.replaceChildren(); } };
  },

  async run({ part, inputs, signal }) {
    const value = ((inputs && inputs.in) || [])[0] || valueOf('text', '');
    const seconds = Math.max(0, Number(part.settings.timeoutSec) || 0);
    const { request, promise } = park(part.id, 'confirm', {
      question: String(part.settings.message || '') || t('parts.confirmAsking'),
      untilMs: seconds ? Date.now() + seconds * 1000 : null,
    });
    // `setTimeout`, never `setInterval` (chat-lint rule 13). A timeout counts as Cancel and the
    // part SAYS it timed out rather than pretending a human declined.
    let timer = null;
    if (seconds) timer = setTimeout(() => answer(part.id, { ok: false, timeout: true }), seconds * 1000);
    const onAbort = () => answer(part.id, { ok: false, cancelled: true });
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const settle = promise.then((a) => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      const ok = !!(a && a.ok);
      outcomes.set(part.id, ok ? '' : ((a && a.timeout) ? 'timeout' : 'cancelled'));
      // The VALUE is untouched either way — only the activation is refused (§4.5).
      return { value, bar: !ok };
    });
    return { park: request, settle };
  },
});
