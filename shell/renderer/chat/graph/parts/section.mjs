// @ts-check
// Section (K4-U4) — a labelled dashed region the reader lays parts inside. COMPUTER_PLAN §6.7, §9.
// `inert: true`: see graph/parts/sticky.mjs for what that flag means and where it is honoured.
//
// WHAT A SECTION IS, AND WHAT IT IS NOT, IN THIS PHASE. It is a region you can see and name: a
// dashed frame with a label, drawn big enough to hold the parts of one idea. It does NOT yet drag
// its contents with it. That is drag semantics and therefore graph/canvas.mjs, which is
// integrator-owned for K4 (kickoff KD-1) — so it leaves this unit as a contract request rather
// than an edit to a file four builders share. §6.7's sentence is kept honest meanwhile: the hint
// string says "lay the parts of one idea inside it", not "they move with it".
//
// The one thing that MUST be true for a region to be usable at all is that it never steals a
// click from the parts it frames. A Section placed after them sits above them in the layer, so
// css/computer-look.css gives the card `pointer-events: none` and hands it back to the title bar
// (the drag handle) and the name field. Everything inside stays reachable.

import { t } from '../../core/i18n.mjs';
import '../../strings/parts-annotate.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

/** @type {PartSpec} */
export const section = /** @type {any} */ ({
  type: 'section',
  order: 910,
  label: t('parts.sectionLabel'),
  thinks: false,
  inert: true,
  quiet: true,
  size: { w: 460, h: 340 },
  inputs: [],
  output: null,
  defaults: () => ({ text: '' }),

  render(host, part, ctx) {
    host.title = t('parts.sectionHint');
    const field = /** @type {HTMLInputElement} */ (document.createElement('input'));
    field.type = 'text';
    field.className = 'graph-section-name';
    field.dataset.part = String(part.id);
    field.setAttribute('aria-label', t('parts.sectionLabel'));
    field.placeholder = t('parts.sectionPlaceholder');
    field.value = String(part.settings.text || '');
    field.addEventListener('input', () => ctx.update({ text: field.value }));
    field.addEventListener('change', () => ctx.commit());
    host.replaceChildren(field);
    return {
      update(next) { if (document.activeElement !== field) field.value = String(next.settings.text || ''); },
      destroy() { field.remove(); },
    };
  },

  async run() { return null; },
});
