// @ts-check
// Repeat (C2) — the "four variants" button (spec §3, plan §2.6 BH).
//
// It does NOT re-execute an upstream subgraph and it does not loop: it emits a `list` of N items,
// and the FAN-OUT RULE does the rest — the part downstream of it runs once per item. That is why a
// graph can express "four variants" without a cycle, which spec §2 forbids outright.
//
// The three things that make the passes real rather than decorative:
//   - N identical items. `planFan()` gives every repeat of an earlier item a cache SALT (§2.6
//     BH-5), so four identical prompts are four generations, not one answer shown four times.
//   - The index. The runner sets `RunInput.item = {i, n}` per item, so a part that wants the pass
//     number has it without Repeat inventing a channel.
//   - The template, for graphs that want the index IN the text: {item} {i} {n}.
//
// N IS NOT CLAMPED TO THE CAP HERE. The cap is a count of GENERATIONS and lives in the runner's
// metered ask (BH-4): a Repeat of 40 over a graph with no Ask costs nothing and must not be
// refused, while a Repeat of 40 over an Ask stops at the cap with the banner and the raise button.
// What this part does refuse is a number no reader meant to type (MAX_TIMES), loudly.

import { valueOf, listOf, isValue } from '../values.mjs';
import { t } from '../../core/i18n.mjs';
import { textOf, partFail, fillTemplate } from './common.mjs';
import { itemsLine, numberField, textField } from './fields.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */
/** @typedef {import('../../core/types.mjs').GraphValue} GraphValue */

/** A pass count past this is a typo, not an intention (a Repeat of 1000 over an Ask could not
 * finish under any cap anyway). Refused by name rather than silently floored. */
export const MAX_TIMES = 200;

/** @param {any} settings @returns {number} */
export function timesOf(settings) {
  const n = Math.floor(Number(settings && settings.times));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * The N items — PURE, exported, and what the unit test asserts.
 * With no template the item IS the wired value (identical copies: that is what the salt is for);
 * with one, each item is the template filled for that pass.
 * @param {GraphValue|null} source @param {{times?: number, template?: string}} settings
 * @returns {GraphValue}
 */
export function passes(source, settings) {
  const n = timesOf(settings);
  if (n > MAX_TIMES) throw partFail(t('parts.errTooMany', { max: MAX_TIMES }), 'invalid');
  const tpl = String((settings && settings.template) || '');
  const base = isValue(source) ? source : valueOf('text', '');
  /** @type {GraphValue[]} */ const items = [];
  for (let i = 0; i < n; i++) {
    items.push(tpl ? valueOf('text', fillTemplate(tpl, textOf(base), i, n)) : base);
  }
  // `repeats: true` — the copies are the POINT, so the fan-out salts them into N generations
  // rather than one cached answer shown N times (values.mjs `listOf`, fix pass finding 7).
  return listOf(items, { repeats: true });
}

/** @type {PartSpec} */
export const repeat = /** @type {any} */ ({
  type: 'repeat',
  order: 260,
  label: t('parts.repeatLabel'),
  thinks: false,
  size: { w: 240, h: 170 },
  inputs: [{ name: 'value', label: t('parts.repeatInput'), accepts: ['any'], many: false, required: false }],
  output: 'list',
  defaults: () => ({ times: 4, template: '' }),

  render(host, part, ctx) {
    const times = numberField(t('parts.repeatTimes'), timesOf(part.settings), 1, (n) => {
      ctx.update({ times: n });
      ctx.commit(t('parts.repeatLabel'));
    }, MAX_TIMES);
    const tpl = textField(t('parts.repeatTemplate'), String(part.settings.template || ''), {
      onInput: (v) => ctx.update({ template: v }),
      onCommit: () => ctx.commit(t('parts.repeatTemplate')),
      placeholder: t('parts.repeatTemplatePlaceholder'),
    });
    const count = itemsLine();
    host.replaceChildren(times.node, tpl.node, count.node);

    /** @param {any} next */
    function paint(next) {
      times.update(timesOf(next.settings));
      tpl.update(String(next.settings.template || ''));
      count.update(next.value);
    }
    paint(part);

    return {
      update(next) { paint(next); },
      destroy() { host.replaceChildren(); },
    };
  },

  async run(input) {
    const source = (input.inputs.value || [])[0] || null;
    return passes(source, input.part.settings || {});
  },
});
