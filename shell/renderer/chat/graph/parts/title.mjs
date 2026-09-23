// @ts-check
// Title (K4-U4) — words written on the canvas, at three sizes. COMPUTER_PLAN §6.7, §9.
// `inert: true`: see graph/parts/sticky.mjs for what that flag means and where it is honoured.
//
// Three SIZES, not a font-size field: a canvas whose headings are all different sizes reads as a
// ransom note, and §9's type scale is the whole point of having a Title part rather than a Sticky
// with big text. The size is an id; the type scale lives in css/computer-look.css.

import { t } from '../../core/i18n.mjs';
import '../../strings/parts-annotate.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

/** Frozen at the kickoff: three sizes, not a font-size field. */
export const TITLE_SIZES = Object.freeze(['s', 'm', 'l']);

/** @type {Record<string, string>} */
const SIZE_KEY = { s: 'parts.titleSizeS', m: 'parts.titleSizeM', l: 'parts.titleSizeL' };

/** @param {any} part @returns {string} */
export function sizeOf(part) {
  const want = String((part && part.settings && part.settings.size) || '');
  return TITLE_SIZES.includes(want) ? want : 'm';
}

/** @type {PartSpec} */
export const title = /** @type {any} */ ({
  type: 'title',
  order: 920,
  label: t('parts.titleLabel'),
  thinks: false,
  inert: true,
  quiet: true,
  size: { w: 360, h: 88 },
  inputs: [],
  output: null,
  defaults: () => ({ text: '', size: 'm' }),

  render(host, part, ctx) {
    host.title = t('parts.titleHint');
    const field = /** @type {HTMLInputElement} */ (document.createElement('input'));
    field.type = 'text';
    field.className = 'graph-title-text';
    field.dataset.part = String(part.id);
    field.setAttribute('aria-label', t('parts.titleLabel'));
    field.placeholder = t('parts.titlePlaceholder');
    field.value = String(part.settings.text || '');
    field.addEventListener('input', () => ctx.update({ text: field.value }));
    field.addEventListener('change', () => ctx.commit());

    const sizes = document.createElement('div');
    sizes.className = 'graph-title-sizes';
    sizes.setAttribute('role', 'group');
    sizes.setAttribute('aria-label', t('parts.titleSize'));
    /** @type {HTMLButtonElement[]} */
    const buttons = TITLE_SIZES.map((name) => {
      const b = /** @type {HTMLButtonElement} */ (document.createElement('button'));
      b.type = 'button';
      b.className = 'graph-title-size';
      b.dataset.size = name;
      b.dataset.part = String(part.id);
      b.textContent = name.toUpperCase();
      b.title = t(SIZE_KEY[name]);
      b.setAttribute('aria-label', t(SIZE_KEY[name]));
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        ctx.update({ size: name });
        ctx.commit();
      });
      sizes.appendChild(b);
      return b;
    });

    /** @param {any} p */
    const paint = (p) => {
      const size = sizeOf(p);
      host.dataset.size = size;
      for (const b of buttons) b.setAttribute('aria-pressed', b.dataset.size === size ? 'true' : 'false');
    };
    paint(part);
    host.replaceChildren(field, sizes);
    return {
      update(next) {
        paint(next);
        if (document.activeElement !== field) field.value = String(next.settings.text || '');
      },
      destroy() { sizes.remove(); field.remove(); },
    };
  },

  async run() { return null; },
});
