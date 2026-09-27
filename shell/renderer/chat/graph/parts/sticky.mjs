// @ts-check
// Sticky (K4-U4) — a square note for the READER, in five tints. COMPUTER_PLAN §6.7, §9.
//
// The three annotation parts carry `inert: true` (frozen at the K4 kickoff, KD-3/KD-7): no ports,
// no output, never in the active set, never counted by the plan preview, never a value in an
// export. That flag is honoured in exactly one place — graph/topo.mjs `activeSet()` — so the run
// loop, the run bar and the cap meter all agree without any of them knowing a part type by name.
// `quiet: true` keeps the canvas from drawing a value strip under a part that has no value.
//
// The TINTS are named for what this palette can actually show (§9's honest constraint: `--blue`
// is byte-identical to `--accent` and to a grey in both themes). Each id maps 1:1 onto
// --sticky-1..5 in css/computer-look.css; an unknown id falls back to the first, so a graph
// written by a future version opens without a hole in it.

import { t } from '../../core/i18n.mjs';
import '../../strings/parts-annotate.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

/** The five sticky tints, as ids — never colour literals (lint rule 3); the hues are tokens. */
export const TINTS = Object.freeze(['yellow', 'green', 'rose', 'slate', 'plain']);

/** @type {Record<string, string>} */
const TINT_KEY = {
  yellow: 'parts.stickyTintYellow',
  green: 'parts.stickyTintGreen',
  rose: 'parts.stickyTintRose',
  slate: 'parts.stickyTintSlate',
  plain: 'parts.stickyTintPlain',
};

/** @param {any} part @returns {string} */
export function tintOf(part) {
  const want = String((part && part.settings && part.settings.colour) || '');
  return TINTS.includes(want) ? want : TINTS[0];
}

/** @type {PartSpec} */
export const sticky = /** @type {any} */ ({
  type: 'sticky',
  order: 900,
  label: t('parts.stickyLabel'),
  thinks: false,
  inert: true,
  quiet: true,
  size: { w: 200, h: 200 },
  inputs: [],
  output: null,
  defaults: () => ({ text: '', colour: TINTS[0] }),

  render(host, part, ctx) {
    host.title = t('parts.stickyHint');
    // CLICK SELECTS, DOUBLE-CLICK EDITS (critic R1 A6/B6). A note that holds words shows them in a
    // READ-ONLY field that lets the press through to the note itself (`is-reading`, pointer-events
    // off in computer-look.css), so one click selects the note and Delete deletes it — the tour's
    // own step, which used to put a caret in the words and delete a character instead. A
    // double-click, or Enter with the note selected (the canvas's K-2 `edit()`), opens it for
    // typing. An EMPTY note is its own editor at once, like an empty Text box: there is nothing to
    // select-and-delete in it yet, and a fresh note must be something you can type into.
    let editing = false;
    const area = document.createElement('textarea');
    area.className = 'graph-sticky-text';
    area.setAttribute('aria-label', t('parts.stickyLabel'));
    area.placeholder = t('parts.stickyPlaceholder');
    area.value = String(part.settings.text || '');
    // Typing is live; the commit is what enters undo — one history entry per edit, not per
    // keystroke. Exactly the contract every other editable part on this canvas keeps.
    area.addEventListener('input', () => ctx.update({ text: area.value }));
    area.addEventListener('change', () => ctx.commit());
    area.addEventListener('focus', () => { if (!area.readOnly) editing = true; });
    area.addEventListener('blur', () => { editing = false; ctx.commit(); face(); });

    /** Reading or writing: read-only (and out of the Tab order) while it shows words and nobody
     * is typing in it. */
    function face() {
      const reading = !editing && !!String(area.value || '').trim();
      area.readOnly = reading;
      area.tabIndex = reading ? -1 : 0;
      area.classList.toggle('is-reading', reading);
    }

    /** Open the note for typing, caret at the end of its words. @returns {boolean} */
    function startEdit() {
      editing = true;
      face();
      try {
        area.focus();
        const end = String(area.value || '').length;
        if (typeof area.setSelectionRange === 'function') area.setSelectionRange(end, end);
      } catch { /* detached */ }
      return true;
    }
    /** @param {any} ev */
    const onDblClick = (ev) => {
      const target = ev && ev.target;
      if (target && typeof target.closest === 'function' && target.closest('.graph-sticky-tints')) return;
      startEdit();
    };
    host.addEventListener('dblclick', onDblClick);

    // The tint row. It is a <button> row, which the canvas's pointerdown `interactive` guard
    // already excludes from a drag, so pressing a tint never starts moving the note.
    const tints = document.createElement('div');
    tints.className = 'graph-sticky-tints';
    tints.setAttribute('role', 'group');
    tints.setAttribute('aria-label', t('parts.stickyColour'));
    /** @type {HTMLButtonElement[]} */
    const swatches = TINTS.map((name) => {
      const b = /** @type {HTMLButtonElement} */ (document.createElement('button'));
      b.type = 'button';
      b.className = 'graph-sticky-tint';
      b.dataset.tint = name;
      b.dataset.part = String(part.id);
      b.title = t(TINT_KEY[name]);
      b.setAttribute('aria-label', t(TINT_KEY[name]));
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        ctx.update({ colour: name });
        ctx.commit();
      });
      tints.appendChild(b);
      return b;
    });

    /** @param {any} p */
    const paint = (p) => {
      const tint = tintOf(p);
      host.dataset.tint = tint;
      for (const b of swatches) b.setAttribute('aria-pressed', b.dataset.tint === tint ? 'true' : 'false');
    };
    paint(part);
    face();
    host.replaceChildren(area, tints);
    return {
      update(next) {
        paint(next);
        if (document.activeElement !== area) { area.value = String(next.settings.text || ''); face(); }
      },
      /** K-2: a double-click inside the note, or Enter/F2 with it selected. */
      edit: () => startEdit(),
      destroy() { host.removeEventListener('dblclick', onDblClick); tints.remove(); area.remove(); },
    };
  },

  // `inert` means the runner never reaches this part. The method exists because PartSpec declares
  // it, and it returns null so that a hand-built run that somehow named one still cannot make a
  // sticky note produce a value.
  async run() { return null; },
});
