// @ts-check
// Dialog (K3-U2, COMPUTER_PLAN §6.6) — the question rendered IN the part, with a field and Send.
// `askEveryRun:false` (the default) needs no new machinery at all: the answer IS `part.value`, so
// a `done` Dialog is simply not in the run set. `true` maps to the spec flag `volatile:true`,
// meaning "never satisfied by a stored value" — and a ▶ on a Dialog always re-asks.
//
// The question is asked ON THE CANVAS, in the box, never in a modal: a modal hides which box is
// asking, and several Dialogs may be waiting at once (the run bar counts them and pans to them).
// The run suspends THIS BRANCH ONLY — the park (graph/parts/control-bus.mjs) is what lets the
// scheduler go on serving every other branch while a human thinks.

import { valueOf } from '../values.mjs';
import { t } from '../../core/i18n.mjs';
import { textField, checkField } from './fields.mjs';
import { park, answer, isParked } from './control-bus.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

/** Does this box re-ask every run? §6.6: `askEveryRun` is the setting a reader sets; `volatile` is
 * what the scheduler reads. ONE rule, exported, so the two can never drift.
 * @param {any} part @returns {boolean} */
export function asksEveryRun(part) {
  return !!(part && part.settings && part.settings.askEveryRun);
}

/** What a Dialog answers with when nobody answered: its `default`, or nothing.
 * @param {any} part @returns {string} */
export function fallbackOf(part) {
  return String((part && part.settings && part.settings.default) || '');
}

/** @type {PartSpec} */
export const dialog = /** @type {any} */ ({
  type: 'dialog',
  order: 640,
  label: t('parts.dlgLabel'),
  thinks: false,
  control: true,
  // The flag is STATIC; `volatileFor` decides it per box, so one Dialog can re-ask every run
  // while another keeps its answer. K3-U1's `activeSet` reads `volatileFor` when a spec has one
  // and falls back to `volatile`.
  volatile: false,
  volatileFor: asksEveryRun,
  size: { w: 260, h: 190 },
  inputs: [{ name: 'in', label: t('parts.dlgContext'), accepts: ['any'], many: true, required: false }],
  output: 'text',
  defaults: () => ({ question: '', placeholder: '', multiline: false, default: '', askEveryRun: false }),

  render(host, part, ctx) {
    const question = textField(t('parts.dlgQuestion'), String(part.settings.question || ''), {
      onInput: (v) => ctx.update({ question: v }),
      onCommit: () => ctx.commit(t('parts.dlgQuestion')),
    });
    const placeholder = textField(t('parts.dlgPlaceholder'), String(part.settings.placeholder || ''), {
      onInput: (v) => ctx.update({ placeholder: v }),
      onCommit: () => ctx.commit(t('parts.dlgPlaceholder')),
    });
    const fallback = textField(t('parts.dlgDefault'), String(part.settings.default || ''), {
      onInput: (v) => ctx.update({ default: v }),
      onCommit: () => ctx.commit(t('parts.dlgDefault')),
    });
    const multiline = checkField(t('parts.dlgMultiline'), !!part.settings.multiline, (v) => {
      ctx.update({ multiline: v });
      ctx.commit(t('parts.dlgMultiline'));
    });
    const every = checkField(t('parts.dlgAskEveryRun'), !!part.settings.askEveryRun, (v) => {
      ctx.update({ askEveryRun: v });
      ctx.commit(t('parts.dlgAskEveryRun'));
    });

    // The answer row. `[data-action]` + `[data-part]` and `.graph-part-answer` are the FROZEN
    // probes the canvas and the harness both read. BOTH fields exist from the start and only the
    // live one carries `.graph-part-answer`, so switching to several lines never has to re-mount
    // the row a human may already be typing into.
    const row = document.createElement('div');
    row.className = 'graph-part-controls graph-dlg-row';
    const line = document.createElement('input');
    line.type = 'text';
    line.dataset.part = part.id;
    const block = document.createElement('textarea');
    block.rows = 3;
    block.dataset.part = part.id;
    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'graph-part-control';
    send.dataset.action = 'send';
    send.dataset.part = part.id;
    send.textContent = t('parts.dlgSend');

    // Which field is live now, not which was live when the box was drawn: `paint` moves it.
    let many = !!part.settings.multiline;
    const field = () => (many ? block : line);
    const submit = () => answer(part.id, { ok: true, text: field().value });
    send.addEventListener('click', submit);
    for (const el of [line, block]) {
      el.addEventListener('keydown', (e) => {
        // Enter sends on one line; on several it needs the modifier, or a paragraph break would
        // answer the question halfway through writing it.
        if (e.key !== 'Enter') return;
        if (el === block && !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        submit();
      });
    }
    row.append(line, block, send);

    const asking = document.createElement('p');
    asking.className = 'graph-part-hint graph-dlg-asking';
    host.replaceChildren(question.node, placeholder.node, fallback.node, multiline.node, every.node, asking, row);
    const paint = (/** @type {any} */ p) => {
      question.update(String(p.settings.question || ''));
      placeholder.update(String(p.settings.placeholder || ''));
      fallback.update(String(p.settings.default || ''));
      multiline.update(!!p.settings.multiline);
      every.update(!!p.settings.askEveryRun);
      many = !!p.settings.multiline;
      line.hidden = many;
      block.hidden = !many;
      line.className = many ? '' : 'graph-part-answer';
      block.className = many ? 'graph-part-answer' : '';
      line.placeholder = String(p.settings.placeholder || '');
      block.placeholder = String(p.settings.placeholder || '');
      const waiting = p.state === 'waiting' || isParked(p.id);
      row.hidden = !waiting;
      asking.textContent = waiting ? (String(p.settings.question || '') || t('parts.dlgAsking')) : '';
    };
    paint(part);
    return { update: paint, destroy() { host.replaceChildren(); } };
  },

  async run({ part, signal }) {
    const { request, promise } = park(part.id, 'dialog', {
      question: String(part.settings.question || '') || t('parts.dlgAsking'),
    });
    const onAbort = () => answer(part.id, { ok: false, cancelled: true });
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const settle = promise.then((a) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      // Nobody answered: the fallback flows (§4.5 — the value always flows) and the branch stops.
      if (!a || !a.ok) return { value: valueOf('text', fallbackOf(part)), bar: true };
      return { value: valueOf('text', String(a.text == null ? '' : a.text)), bar: false };
    });
    return { park: request, settle };
  },
});
