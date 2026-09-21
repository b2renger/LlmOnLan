// @ts-check
// The thread header (P2-U3): what this chat is called, and the system prompt it runs under.
//
// Two jobs (plan §2.6 AD/AE):
//   1. it OWNS `els.header` and HOSTS the THREAD_HEADER slot — it lists the slot on every render, so
//      a later feature's header chip appears without this file changing;
//   2. it CONTRIBUTES the two built-in items: the title (click → rename) and the system prompt
//      (click → a popover editor saved to `thread.systemOverride`).
//
// And it registers the `thread-system` REQUEST_TRANSFORM at order 150 (plan §3.6.3): with an
// override set, `req.system` IS that text, byte for byte — no trim, no normalisation — and every
// later stage may only push to `req.systemAppend`. The registration happens synchronously inside
// install(app) so the transform exists before the first send, and so
// shell/test/chat/unit/transform-order.test.mjs can install this module headless.

import { EV } from '../core/events.mjs';
import { SLOTS } from '../core/registry.mjs';
import { t } from '../core/i18n.mjs';
import '../strings/tree.en.mjs';
import '../strings/dialogs.en.mjs';

/** The order §3.6.3 gives the thread override: after `recipe` (100), before `params-resolve` (250). */
const THREAD_SYSTEM_ORDER = 150;

/** @param {any} app */
export function install(app) {
  // ---- the transform (registered first: it must exist even if the DOM half cannot run) ---------
  app.registry.add(SLOTS.REQUEST_TRANSFORMS, {
    id: 'thread-system',
    order: THREAD_SYSTEM_ORDER,
    /**
     * @param {any} req @param {{thread: any}} ctx
     */
    apply(req, ctx) {
      const thread = ctx && ctx.thread;
      if (!thread || thread.systemOverride == null) return;
      const text = String(thread.systemOverride);
      if (!text.trim()) return;                 // an empty override is no override
      req.system = text;                        // byte-stable, and the recipe's system loses
    },
  });

  const els = app.els || {};
  const host = els.header || null;
  const repo = () => app.repo;

  /** The thread the header is describing right now (null = no chat open). */
  /** @type {any} */
  let current = null;

  // ---- rendering ------------------------------------------------------------------------------

  /** The host lists the slot at RENDER time, never once at install (plan §2.6 AD). */
  function render() {
    if (!host || typeof host.replaceChildren !== 'function') return;
    /** @type {any[]} */
    const nodes = [];
    for (const item of app.registry.list(SLOTS.THREAD_HEADER)) {
      try {
        const node = item.render(app);
        if (node) nodes.push(node);
      } catch (err) {
        console.warn(`[lolchat] thread header item "${item.id}" failed`, err);
      }
    }
    host.replaceChildren(...nodes);
  }

  /** Re-read the open thread and repaint. */
  async function refresh() {
    const id = app.state.threadId;
    if (!id || !repo()) {
      current = null;
      render();
      return;
    }
    let thread = null;
    try { thread = await repo().getThread(id); } catch (err) { void err; }
    if (app.state.threadId !== id) return;      // the reader moved on while we were reading
    current = thread || null;
    render();
  }

  // ---- the two built-in items -----------------------------------------------------------------

  async function rename() {
    if (!current || !app.dialogs || typeof app.dialogs.prompt !== 'function') return;
    const id = current.id;
    const next = await app.dialogs.prompt({
      title: t('tree.renameTitle'),
      value: current.title || '',
      placeholder: t('tree.renamePlaceholder'),
    });
    if (next === null || next === undefined) return;          // cancelled
    const title = String(next).trim();
    if (!title || !repo()) return;
    await repo().updateThread(id, { title, titleSource: 'user' });
    if (app.sidebar) app.sidebar.render();
    await refresh();
  }

  /** @param {HTMLElement} anchorEl */
  function openSystemEditor(anchorEl) {
    if (!current || !app.dialogs || typeof app.dialogs.popover !== 'function') return;
    const id = current.id;
    const value = current.systemOverride == null ? '' : String(current.systemOverride);
    app.dialogs.popover(anchorEl, (/** @type {HTMLElement} */ el, /** @type {any} */ close) => {
      const done = typeof close === 'function' ? close : () => {};
      const box = document.createElement('div');
      box.className = 'chat-system-editor';

      const hint = document.createElement('p');
      hint.className = 'chat-system-hint';
      hint.textContent = t('tree.systemPromptHint');

      const input = document.createElement('textarea');
      input.className = 'chat-system-input';
      input.value = value;
      input.placeholder = t('tree.systemPromptPlaceholder');
      input.setAttribute('aria-label', t('tree.systemPromptTitle'));

      const row = document.createElement('div');
      row.className = 'chat-system-row';
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'btn-ghost';
      clear.textContent = t('tree.systemClear');
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn-accent';
      save.textContent = t('tree.systemSave');
      row.append(clear, save);
      box.append(hint, input, row);
      el.appendChild(box);

      /** @param {string|null} next */
      const write = async (next) => {
        done();
        if (!repo()) return;
        await repo().updateThread(id, { systemOverride: next });
        await refresh();
      };
      // The saved text is NOT trimmed: what the reader typed is what the farm is told, byte for
      // byte (§3.6.3). Only the decision "is there an override at all" looks at the trimmed value.
      save.addEventListener('click', () => { void write(input.value.trim() ? input.value : null); });
      clear.addEventListener('click', () => { void write(null); });
      try { input.focus(); } catch (err) { void err; }
    });
  }

  app.registry.add(SLOTS.THREAD_HEADER, {
    id: 'title',
    order: 100,
    render() {
      if (!current) return null;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-header-title';
      b.setAttribute('data-thread-title', current.id);
      b.title = t('tree.titleHint');
      b.textContent = current.title || '';
      b.addEventListener('click', () => { void rename(); });
      return b;
    },
  });

  app.registry.add(SLOTS.THREAD_HEADER, {
    id: 'system',
    order: 200,
    render() {
      if (!current) return null;
      const on = !!(current.systemOverride && String(current.systemOverride).trim());
      const b = document.createElement('button');
      b.type = 'button';
      b.className = on ? 'chat-header-system on' : 'chat-header-system';
      b.setAttribute('data-system-prompt', on ? 'on' : 'off');
      b.title = t('tree.systemPromptTitle');
      b.textContent = on ? t('tree.systemOn') : t('tree.systemPrompt');
      b.addEventListener('click', () => openSystemEditor(b));
      return b;
    },
  });

  // ---- when the header changes -----------------------------------------------------------------

  app.bus.on(EV.THREAD_SELECTED, () => { void refresh(); });
  app.bus.on(EV.THREADS_CHANGED, (/** @type {any} */ p) => {
    const id = app.state.threadId;
    if (!id) return;
    const ids = p && Array.isArray(p.ids) ? p.ids : [];
    // `attach`/`migrate`/`import` carry no ids for this thread but can still bring its record in.
    if (ids.length && ids.indexOf(id) < 0) return;
    void refresh();
  });

  // A feature never sees the events emitted while the components were built (§2.6 AA/I), so the
  // current state is READ here as well as subscribed to.
  void refresh();

  app.threadHeader = { render, refresh };
  return app.threadHeader;
}
