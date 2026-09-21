// @ts-check
// DRAFTS (P2-U3): what you were typing is still there when you come back to a chat.
//
// `thread.draft` holds the unsent text of that chat. It is saved on a 500 ms debounce (an INPUT
// debounce, not a wall-clock rule — plan §2.6 AK explicitly allows setTimeout here), restored when
// a thread is selected, and cleared the moment a send takes it.
//
// Two rules that are easy to get wrong:
//   - a THREAD_SELECTED carrying `created: true` (plan §2.6 AP.1) is a thread nobody has typed in
//     yet. Restoring into it is a no-op — and worse than a no-op, because the composer clears and
//     focuses itself in the same beat, so an async "restore" landing afterwards would wipe the
//     first characters the reader types into a brand-new chat.
//   - the pending save belongs to the thread that was open when it was scheduled. Switching threads
//     FLUSHES it first, or the old chat's sentence would land on the new chat's record.

import { EV } from '../core/events.mjs';

/** Input debounce for the draft write (§4 P2-U3). */
const DEBOUNCE_MS = 500;

/** @param {any} app */
export function install(app) {
  const repo = () => app.repo;

  /** @type {{threadId: string, text: string}|null} */
  let pending = null;
  /** @type {any} */
  let timer = null;
  /** True while we are writing into the composer ourselves (its DRAFT_CHANGE is not the reader). */
  let restoring = false;

  /** @param {string} threadId @param {string} text */
  function write(threadId, text) {
    if (!repo() || !threadId) return Promise.resolve(null);
    // SILENT (repo.updateThread's third argument): nothing on screen renders `thread.draft`, and
    // the THREADS_CHANGED this used to emit re-rendered the sidebar and the thread header twice a
    // second while the reader typed (P2 review).
    return Promise.resolve(repo().updateThread(threadId, { draft: text ? String(text) : null }, { silent: true }))
      .catch((err) => { console.warn('[lolchat] draft save failed', err); return null; });
  }

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** Write whatever is queued right now (used on a thread switch and on send). */
  function flush() {
    clearTimer();
    const p = pending;
    pending = null;
    return p ? write(p.threadId, p.text) : Promise.resolve(null);
  }

  /** @param {string|null} threadId @param {string} text */
  function schedule(threadId, text) {
    if (!threadId) return;                       // nothing typed yet has a thread to belong to
    pending = { threadId, text: String(text == null ? '' : text) };
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      const p = pending;
      pending = null;
      if (p) void write(p.threadId, p.text);
    }, DEBOUNCE_MS);
  }

  app.bus.on(EV.DRAFT_CHANGE, (/** @type {any} */ draft) => {
    if (restoring) return;
    schedule(app.state.threadId, (draft && draft.text) || '');
  });

  app.bus.on(EV.THREAD_SELECTED, (/** @type {any} */ p) => {
    const created = !!(p && p.created);
    const id = p && typeof p.threadId === 'string' ? p.threadId : null;
    void (async () => {
      await flush();                             // the OLD thread's sentence, before we move on
      if (created || !id || !repo() || !app.composer) return;
      let thread = null;
      try { thread = await repo().getThread(id); } catch (err) { void err; }
      if (app.state.threadId !== id) return;     // the reader moved on again while we read
      const text = thread && typeof thread.draft === 'string' ? thread.draft : '';
      if (!text && !app.composer.getDraft().text) return;   // nothing to restore, nothing to wipe
      restoring = true;
      try { app.composer.setText(text); } finally { restoring = false; }
    })();
  });

  // A send TAKES the draft: the composer clears itself, and the record must not keep a stale copy
  // for the 500 ms the debounce would otherwise sit on.
  if (app.composer && typeof app.composer.on === 'function') {
    app.composer.on('submit', () => {
      clearTimer();
      pending = null;
      const id = app.state.threadId;
      if (id) void write(id, '');
    });
  }

  app.drafts = { flush, debounceMs: DEBOUNCE_MS };
  return app.drafts;
}
