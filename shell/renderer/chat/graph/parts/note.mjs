// @ts-check
// Note (C1) — a literal. The input end of most graphs, and a comment when nothing is wired out of
// it (spec §3). No inputs, no farm call, so `Run` never spends a seat on one.

import { valueOf } from '../values.mjs';
import { t } from '../../core/i18n.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

/** @type {PartSpec} */
export const note = /** @type {any} */ ({
  type: 'note',
  order: 100,
  label: t('parts.noteLabel'),
  thinks: false,
  size: { w: 220, h: 140 },
  inputs: [],
  output: 'text',
  defaults: () => ({ text: '' }),

  render(host, part, ctx) {
    const area = document.createElement('textarea');
    area.className = 'graph-note-text';
    area.setAttribute('aria-label', t('parts.noteLabel'));
    area.placeholder = t('parts.notePlaceholder');
    area.value = String(part.settings.text || '');
    // Typing is live (so a wired Ask preview updates), committing is what enters undo history —
    // one history entry per edit, not one per keystroke.
    area.addEventListener('input', () => ctx.update({ text: area.value }));
    area.addEventListener('change', () => ctx.commit(t('parts.noteLabel')));
    host.replaceChildren(area);
    return {
      update(next) {
        if (document.activeElement !== area) area.value = String(next.settings.text || '');
      },
      destroy() { area.remove(); },
    };
  },

  async run(input) {
    return valueOf('text', String(input.part.settings.text || ''));
  },
});
