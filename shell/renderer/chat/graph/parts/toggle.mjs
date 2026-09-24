// @ts-check
// Toggle (K3, COMPUTER_PLAN §6.6) — the simplest barrier there is, and the one that makes a loop
// legal: `on` lets the wave through, `off` stops it AND STILL PUBLISHES ITS VALUE, so a part that
// runs for another reason reads straight through it (§4.5). Flipping it is a settings edit: it
// marks downstream stale and does not auto-run.
//
// It is also the part that makes a LOOP legal: `gatedLoop()` counts it as something that can stop
// a cycle, so `state → Toggle → Instruction → state` is a graph the canvas will draw, while the
// same ring without it is refused `loop-ungated` before a single generation is spent (§4.6).

import { valueOf } from '../values.mjs';
import { t } from '../../core/i18n.mjs';
import { checkField } from './fields.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

/** The one input, passed through untouched, or an empty text when nothing is wired. @param {any} inputs */
export function passthrough(inputs) {
  const list = (inputs && inputs.in) || [];
  return list.length ? list[0] : valueOf('text', '');
}

/** @type {PartSpec} */
export const toggle = /** @type {any} */ ({
  type: 'toggle',
  // K6 fix round: what arrives goes on unchanged, so graph/takes.mjs looks THROUGH this box for the
  // model a picture or a sound is headed to.
  passes: true,
  order: 610,
  label: t('parts.togLabel'),
  thinks: false,
  control: true,
  // Taller since critic R2: a box is exactly its height now, and the answer line a run adds
  // below the face (~33 px) must fit without the body scrolling.
  size: { w: 200, h: 156 },
  minH: 156,
  inputs: [{ name: 'in', label: t('parts.ctlIn'), accepts: ['any'], many: false, required: false }],
  output: 'any',
  defaults: () => ({ on: true }),

  render(host, part, ctx) {
    const on = checkField(t('parts.togOn'), !!part.settings.on, (v) => {
      ctx.update({ on: v });
      ctx.commit(t('parts.togLabel'));
    });
    const state = document.createElement('p');
    state.className = 'graph-part-hint';
    host.replaceChildren(on.node, state);
    const paint = (/** @type {any} */ p) => { on.update(!!p.settings.on); state.textContent = p.settings.on ? t('parts.togOnHint') : t('parts.togOffHint'); };
    paint(part);
    return { update: paint, destroy() { host.replaceChildren(); } };
  },

  async run({ part, inputs }) {
    return { value: passthrough(inputs), bar: !part.settings.on };
  },
});
