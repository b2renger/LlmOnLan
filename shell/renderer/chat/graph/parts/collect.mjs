// @ts-check
// Collect (C1) — joins many values back into one (spec §3). With C2's fan-out it is what ends a
// fan-out; already in C1 it is what turns several wires (or a list from `Ask`'s list shape) into
// one text or one JSON array, which is how a three-part graph ends in something readable.
//
// It accepts `list` explicitly — that is the sanctioned way a list travels in C1, and the reason
// wiring a list into `Ask` is refused instead (fan-out is C2's). Many wires into `items` arrive in
// wire order, and a `list` on any of them contributes its own items, flattened one level.

import { valueOf } from '../values.mjs';
import { t } from '../../core/i18n.mjs';
import { itemsOf, textOf, fillTemplate, pickerRow, partFail } from './common.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */
/** @typedef {import('../../core/types.mjs').GraphValue} GraphValue */

const MODES = ['bullets', 'numbered', 'json', 'template'];

/**
 * The join itself — pure, exported, and what the unit test asserts.
 * @param {GraphValue[]} items @param {{mode?: string, template?: string, separator?: string}} settings
 * @returns {GraphValue}
 */
export function join(items, settings) {
  const mode = MODES.includes(String(settings.mode)) ? String(settings.mode) : 'bullets';
  const texts = items.map(textOf);
  if (mode === 'json') return valueOf('json', items.map((v) => (v.kind === 'json' ? v.data : textOf(v))));
  if (mode === 'numbered') return valueOf('text', texts.map((s, i) => `${i + 1}. ${s}`).join('\n'));
  if (mode === 'template') {
    const tpl = String(settings.template === undefined ? '{item}' : settings.template);
    const sep = String(settings.separator === undefined ? '\n' : settings.separator);
    return valueOf('text', texts.map((s, i) => fillTemplate(tpl, s, i, texts.length)).join(sep));
  }
  return valueOf('text', texts.map((s) => `- ${s}`).join('\n'));
}

/** @type {PartSpec} */
export const collect = /** @type {any} */ ({
  type: 'collect',
  order: 300,
  label: t('parts.collectLabel'),
  thinks: false,
  size: { w: 260, h: 160 },
  inputs: [{ name: 'items', label: t('parts.collectItems'), accepts: ['list', 'text', 'json'], many: true, required: true }],
  output: 'text',
  defaults: () => ({ mode: 'bullets', template: '{item}', separator: '\n' }),

  render(host, part, ctx) {
    const mode = pickerRow(t('parts.collectMode'), [
      { value: 'bullets', label: t('parts.collectBullets') },
      { value: 'numbered', label: t('parts.collectNumbered') },
      { value: 'json', label: t('parts.collectJson') },
      { value: 'template', label: t('parts.collectTemplate') },
    ], String(part.settings.mode || 'bullets'), (v) => {
      ctx.update({ mode: v });
      ctx.commit(t('parts.collectMode'));
      paint(/** @type {any} */ ({ ...part, settings: { ...part.settings, mode: v } }));
    });

    const template = document.createElement('input');
    template.type = 'text';
    template.className = 'graph-collect-template';
    template.setAttribute('aria-label', t('parts.collectTemplateText'));
    template.value = String(part.settings.template === undefined ? '{item}' : part.settings.template);
    template.addEventListener('input', () => ctx.update({ template: template.value }));
    template.addEventListener('change', () => ctx.commit(t('parts.collectTemplateText')));

    const hint = document.createElement('p');
    hint.className = 'graph-part-hint';
    hint.textContent = t('parts.collectHint');

    const fields = document.createElement('div');
    fields.className = 'graph-part-fields';
    fields.append(mode);
    host.replaceChildren(fields, template, hint);

    /** The template box exists only for the mode that uses one. @param {any} p */
    function paint(p) {
      template.hidden = String(p.settings.mode || 'bullets') !== 'template';
    }
    paint(part);

    return {
      update(next) {
        const ms = /** @type {any} */ (mode.querySelector('select'));
        if (ms && document.activeElement !== ms) ms.value = String(next.settings.mode || 'bullets');
        if (document.activeElement !== template) {
          template.value = String(next.settings.template === undefined ? '{item}' : next.settings.template);
        }
        paint(next);
      },
      destroy() { host.replaceChildren(); },
    };
  },

  async run(input) {
    const wired = (input.inputs && input.inputs.items) || [];
    /** @type {GraphValue[]} */ const items = [];
    for (const v of wired) for (const item of itemsOf(v)) items.push(item);
    // "Nothing came in" is a failure, not an empty value (§1.2). The runner catches the empty-port
    // case first; this is the list-that-turned-out-empty one.
    if (!items.length) throw partFail(t('parts.errNoInput', { port: t('parts.collectItems') }), 'part');
    return join(items, input.part.settings || {});
  },
});
