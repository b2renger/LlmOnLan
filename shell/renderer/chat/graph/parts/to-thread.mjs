// @ts-check
// To thread (C2) — the bridge OUT of the graph (spec §3, plan §2.6 BH-1/BH-7): a value posted back
// into the conversation as a message, so a graph result becomes something you can talk about.
//
// It is the ONE part that writes to the thread store, and it takes exactly the three steps the
// controller takes for a message of its own (BH-7), in this order and no other:
//   1. `repo.appendMessage()`  — the repo's own door: it allocates the id, hangs the message off
//      the thread's head and persists it. The Computer never writes a store row itself.
//   2. `app.view.upsert()`     — only when that thread is the one ON SCREEN. The view renders the
//      message through the ordinary safe markdown path, exactly like an answer from the farm;
//      nothing here builds HTML, and `innerHTML` never appears in the Computer (lint rule 1).
//   3. `EV.MESSAGE_PUT`        — the event the sidebar (and anything later) listens to.
// It never touches `#chat-messages` directly: that subtree belongs to the thread view (§2.6 AE).
//
// It has NO output (`output: null`), which is the one case where run() may resolve to null (BH-6):
// posting is the effect, and inventing a value to satisfy the runner would put a copy of the
// message on the canvas as if it were a result.

import { t } from '../../core/i18n.mjs';
import { EV } from '../../core/events.mjs';
import { textOf, pickerRow, partFail } from './common.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

export const ROLES = ['assistant', 'user'];

/** @param {any} settings @returns {string} */
export function roleOf(settings) {
  const role = String((settings && settings.role) || 'assistant');
  return ROLES.includes(role) ? role : 'assistant';
}

/**
 * The message body for a set of wired values — PURE, and what the unit test asserts.
 * Several wires into one port arrive in wire order and are posted as ONE message, separated by a
 * blank line: two messages would be two turns the reader never asked for.
 * @param {any[]} values @param {string} prefix @returns {string}
 */
export function bodyOf(values, prefix) {
  const body = (Array.isArray(values) ? values : [])
    .map(textOf)
    .filter((s) => s.trim())
    .join('\n\n');
  const head = String(prefix || '').trim();
  if (!body.trim()) return '';
  return head ? `${head}\n\n${body}` : body;
}

/** A labelled text box. @param {string} label @param {string} value @param {string} placeholder */
function textRow(label, value, placeholder) {
  const row = document.createElement('label');
  row.className = 'graph-part-field';
  const caption = document.createElement('span');
  caption.className = 'graph-part-field-label';
  caption.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'graph-part-input';
  input.placeholder = placeholder;
  input.value = value;
  row.append(caption, input);
  return { row, input };
}

/** @type {PartSpec} */
export const toThread = /** @type {any} */ ({
  type: 'to-thread',
  order: 400,
  label: t('parts.toThreadLabel'),
  thinks: false,
  size: { w: 250, h: 170 },
  inputs: [{ name: 'value', label: t('parts.toThreadInput'), accepts: ['any'], many: true, required: true }],
  output: null,
  defaults: () => ({ role: 'assistant', prefix: '' }),

  render(host, part, ctx) {
    // chat-lint rule 5: literal t() keys, never a key built from the role id (§2.6 BH-12).
    const options = [
      { value: 'assistant', label: t('parts.toThreadRoleAssistant') },
      { value: 'user', label: t('parts.toThreadRoleYou') },
    ];
    const role = pickerRow(t('parts.toThreadRole'), options, roleOf(part.settings), (v) => {
      ctx.update({ role: v });
      ctx.commit(t('parts.toThreadRole'));
    });

    const prefix = textRow(t('parts.toThreadPrefix'), String(part.settings.prefix || ''), t('parts.toThreadPrefixPlaceholder'));
    prefix.input.addEventListener('input', () => ctx.update({ prefix: prefix.input.value }));
    prefix.input.addEventListener('change', () => ctx.commit(t('parts.toThreadPrefix')));

    const note = document.createElement('p');
    note.className = 'graph-part-note';

    host.replaceChildren(role, prefix.row, note);

    /** The one thing this part can say about itself: whether it has posted yet. @param {any} p */
    function paint(p) { note.textContent = p.state === 'done' ? t('parts.toThreadPosted') : t('parts.toThreadHint'); }
    paint(part);

    return {
      update(next) {
        const rs = /** @type {any} */ (role.querySelector('select'));
        if (rs && document.activeElement !== rs) rs.value = roleOf(next.settings);
        if (document.activeElement !== prefix.input) prefix.input.value = String(next.settings.prefix || '');
        paint(next);
      },
      destroy() { host.replaceChildren(); },
    };
  },

  async run(input) {
    const thread = input.thread;
    const app = input.app;
    const repo = app && app.repo;
    if (!thread || !repo || typeof repo.appendMessage !== 'function') throw partFail(t('parts.errNoThread'), 'invalid');

    const text = bodyOf(input.inputs.value || [], (input.part.settings || {}).prefix);
    // Posting an empty message would be a turn that says nothing, in the one place the reader
    // cannot undo it from the canvas. Refuse (§1.2).
    if (!text.trim()) throw partFail(t('parts.errNothingToPost'), 'empty');

    const role = roleOf(input.part.settings);
    const msg = repo.appendMessage(thread.id, {
      role,
      content: text,
      parts: [{ type: 'text', text }],
      status: 'done',
      // Provenance: this turn came from the Computer, not from the farm. Nothing reads it in C2;
      // it is here so a later phase never has to guess which messages a graph wrote.
      params: { source: 'computer', partId: input.part.id },
    });

    // ON SCREEN only: upserting a message from another thread would paint it into the conversation
    // the reader is looking at. The controller takes the same precaution (`onScreen`).
    const showing = app && app.state ? app.state.threadId : null;
    if (app && app.view && typeof app.view.upsert === 'function' && showing === thread.id) {
      try { app.view.upsert(msg); } catch (err) { console.error('[lolchat] to-thread upsert threw', err); }
    }
    try { if (app && app.bus) app.bus.emit(EV.MESSAGE_PUT, msg); } catch (err) { console.error('[lolchat] to-thread event threw', err); }

    // BH-6: `output: null` means the runner marks this part `done` with no value. Posting IS the
    // result; a value here would put a copy of the message on the canvas as if it were one.
    return null;
  },
});
