// @ts-check
// The batch queue chip (S0-U3, studio plan §3.5.4). A FEATURE: install(app).
//
// studio plan §3.5.4: "Nothing in this plan starts a batch without a visible queue chip", and "the
// chip is the one place a user can stop a batch, and Escape (already bound to stop-then-close)
// reaches it through CANCEL_HANDLERS." S0 shipped `app.ask.queue` without it once (S0 review,
// finding 7): the API was live, a batch would have run invisibly, and Escape could not have reached
// it. This module is that missing half, and it is deliberately tiny.
//
// It knows nothing about who started the batch. app/ask.mjs emits QUEUE_EVENT on every phase and
// listens for QUEUE_CANCEL_EVENT; the chip renders the one and emits the other. That is the whole
// coupling — no handle is passed around, so a stale reference cannot exist here by construction.

import { t } from '../core/i18n.mjs';
import { SLOTS } from '../core/registry.mjs';
import { QUEUE_EVENT, QUEUE_CANCEL_EVENT } from '../app/ask.mjs';
import '../strings/queue.en.mjs';

/**
 * PURE. The sentence the chip shows for a queue state.
 * @param {{label?: string, i?: number, n?: number, running?: boolean, cancelled?: boolean,
 *          truncated?: number, stalled?: boolean}} q
 * @returns {{text: string, note: string}}
 */
export function chipText(q) {
  const s = q || {};
  const i = Number(s.i) || 0;
  const n = Number(s.n) || 0;
  const label = typeof s.label === 'string' ? s.label.trim() : '';
  const head = s.stalled ? t('queue.stalled')
    : s.cancelled ? t('queue.cancelled')
      : label ? t('queue.running', { label, i, n })
        : t('queue.runningBare', { i, n });
  const dropped = Number(s.truncated) || 0;
  return { text: head, note: dropped > 0 ? t('queue.truncated', { count: dropped }) : '' };
}

/** @param {any} app */
export function install(app) {
  // Into the CHAT COLUMN, not the root: `.chat-main` is already `position: relative`, so the chip
  // sits over the conversation just above the composer. Mounted on the root it floated over the
  // sidebar instead (caught in the light/dark screenshots at the fix round).
  const host = (app.els && app.els.main) || app.root;
  const doc = host && host.ownerDocument ? host.ownerDocument : document;
  const el = doc.createElement('div');
  el.className = 'chat-queue-chip';
  el.id = 'chat-queue-chip';
  el.hidden = true;

  const text = doc.createElement('span');
  text.className = 'chat-queue-text';
  const note = doc.createElement('span');
  note.className = 'chat-queue-note';
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.className = 'chat-queue-cancel';
  cancel.id = 'chat-queue-cancel';
  cancel.textContent = t('dialogs.cancel');
  cancel.title = t('queue.cancelTitle');
  el.appendChild(text);
  el.appendChild(note);
  el.appendChild(cancel);
  host.appendChild(el);

  let running = false;

  /** The one door out (§2.6 BB-3): the chip never holds a batch handle, it emits. */
  const stop = () => { app.bus.emit(QUEUE_CANCEL_EVENT, { from: 'chip' }); };
  cancel.addEventListener('click', stop);

  /** @param {any} q */
  function render(q) {
    const { text: head, note: extra } = chipText(q);
    text.textContent = head;
    note.textContent = extra;
    note.hidden = !extra;
    cancel.hidden = !q.running || !!q.cancelled;
    el.classList.toggle('is-stopping', !!q.cancelled && !!q.running);
  }

  app.bus.on(QUEUE_EVENT, (/** @type {any} */ q) => {
    const state = q || {};
    // 'end' arrives with running:false; anything else while running keeps the chip up. A batch that
    // was cut to nothing (n === 0) never shows a chip — there is nothing to stop.
    running = !!state.running && Number(state.n) > 0;
    if (!running) { el.hidden = true; return; }
    el.hidden = false;
    render(state);
  });

  // Escape reaches the batch through here: controller.stop() runs the CANCEL_HANDLERS when nothing
  // is streaming, and a background batch is exactly that case.
  app.registry.add(SLOTS.CANCEL_HANDLERS, {
    id: 'queue',
    order: 90,
    active: () => running,
    cancel: () => stop(),
  });

  return { el, chipText };
}
