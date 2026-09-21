// @ts-check
// The per-message actions (P2-U3): Regenerate, Regenerate with…, Edit, Fork, Delete.
//
// Every one of them is a MESSAGE_ACTIONS item, which means thread-view renders them (plan §2.6 AD)
// and this module never touches a row itself — except through ui/edit-inline.mjs, which appends its
// own child and cleans it up.
//
// This module is ALSO the host of REGENERATE_OPTIONS: the "Regenerate with…" popover lists the slot
// at OPEN time, so a later feature (a recipe at P4, a params drawer) shows up without an edit here.
// The two built-ins are the ones §4 P2-U3 names: More creative (temperature 1.0) and More precise
// (0.2). They travel as `params` on controller.generate(), i.e. the CALL layer — so they beat the
// thread's own temperature (§3.6.3), which is exactly what "regenerate with" has to mean.
//
// The work itself belongs to app/branching.mjs, reached LAZILY (§2.6 AA): a feature never reads
// another feature's API during its own install.

import { EV } from '../core/events.mjs';
import { SLOTS } from '../core/registry.mjs';
import { t } from '../core/i18n.mjs';
import { openEdit, closeEdit } from './edit-inline.mjs';
import '../strings/tree.en.mjs';

const ICONS = {
  regenerate: [
    'M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8',
    'M3 3v5h5',
    'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16',
    'M16 16h5v5',
  ],
  regenerateWith: ['M4 6h16', 'M4 12h10', 'M4 18h6', 'm15 14 4 4 4-4'],
  edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z'],
  fork: ['M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M15 6a9 9 0 0 1-9 9'],
  delete: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
};

/** An assistant answer that has finished one way or another — the ones worth redoing. */
function settledAssistant(msg) {
  if (!msg || msg.role !== 'assistant') return false;
  return msg.status === 'done' || msg.status === 'error' || msg.status === 'aborted' || msg.status === 'interrupted';
}

/** A message the reader actually sent (a local note is the chat talking to itself). */
function editableUser(msg) {
  return !!msg && msg.role === 'user' && msg.status !== 'streaming';
}

/**
 * Anything that is a real turn in the tree: forkable and deletable.
 *
 * 'waiting' is excluded on purpose. A seat-waiting row is a LIVE placeholder with its own two
 * actions (Try now / Cancel, P2-U1); offering Delete beside them let the reader remove a message
 * the waiter still held — which wedged the composer and then wrote the deleted row back when a seat
 * freed (P2 review). Cancel first, then the settled row is deletable like any other.
 */
function realTurn(msg) {
  if (!msg || msg.status === 'streaming' || msg.status === 'waiting') return false;
  return msg.role === 'user' || msg.role === 'assistant';
}

/** @param {any} app */
export function install(app) {
  const branching = () => (app.branching && typeof app.branching.regenerate === 'function' ? app.branching : null);

  // Leaving the chat closes the editor. The row it lives on is removed by the repaint anyway, so
  // without this the reader's half-typed edit survived only as a detached node nobody could see
  // (P2 review). Its module header always claimed a thread switch closed it; now something does.
  app.bus.on(EV.THREAD_SELECTED, () => closeEdit());

  /** @param {Promise<any>|any} p */
  const guard = (p) => Promise.resolve(p).catch((err) => console.warn('[lolchat] message action failed', err));

  // ---- the "Regenerate with…" menu (this module hosts the slot) -------------------------------

  /** @param {any} msg @param {HTMLElement} anchorEl */
  function openRegenerateMenu(msg, anchorEl) {
    if (!app.dialogs || typeof app.dialogs.popover !== 'function') return;
    app.dialogs.popover(anchorEl, (/** @type {HTMLElement} */ el, /** @type {any} */ close) => {
      const done = typeof close === 'function' ? close : () => {};
      const menu = document.createElement('div');
      menu.className = 'chat-menu';
      // Listed at RENDER time (§2.6 AD): a later feature's option appears with no edit here.
      for (const opt of app.registry.list(SLOTS.REGENERATE_OPTIONS)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chat-menu-item';
        b.setAttribute('data-option', opt.id);
        b.textContent = opt.label;
        b.addEventListener('click', () => {
          done();
          const br = branching();
          if (br) guard(br.regenerate(msg, { params: opt.params || null, recipeId: opt.recipeId || null }));
        });
        menu.appendChild(b);
      }
      el.appendChild(menu);
    });
  }

  app.registry.add(SLOTS.REGENERATE_OPTIONS, {
    id: 'creative', order: 100, label: t('tree.regenerateCreative'), params: { temperature: 1.0 },
  });
  app.registry.add(SLOTS.REGENERATE_OPTIONS, {
    id: 'precise', order: 200, label: t('tree.regeneratePrecise'), params: { temperature: 0.2 },
  });

  // ---- the actions ---------------------------------------------------------------------------

  app.registry.add(SLOTS.MESSAGE_ACTIONS, {
    id: 'regenerate',
    order: 200,
    icon: ICONS.regenerate,
    label: t('tree.regenerate'),
    visible: (/** @type {any} */ msg) => settledAssistant(msg),
    run: (/** @type {any} */ msg) => {
      const br = branching();
      if (br) guard(br.regenerate(msg, {}));
    },
  });

  app.registry.add(SLOTS.MESSAGE_ACTIONS, {
    id: 'regenerate-with',
    order: 210,
    icon: ICONS.regenerateWith,
    label: t('tree.regenerateWith'),
    visible: (/** @type {any} */ msg) => settledAssistant(msg),
    run: (/** @type {any} */ msg, /** @type {any} */ _app, /** @type {any} */ anchorEl) => openRegenerateMenu(msg, anchorEl),
  });

  app.registry.add(SLOTS.MESSAGE_ACTIONS, {
    id: 'edit',
    order: 220,
    icon: ICONS.edit,
    label: t('tree.edit'),
    visible: (/** @type {any} */ msg) => editableUser(msg),
    run: (/** @type {any} */ msg) => { openEdit(app, msg); },
  });

  app.registry.add(SLOTS.MESSAGE_ACTIONS, {
    id: 'fork',
    order: 230,
    icon: ICONS.fork,
    label: t('tree.fork'),
    visible: (/** @type {any} */ msg) => realTurn(msg),
    run: (/** @type {any} */ msg) => {
      const br = branching();
      if (br) guard(br.fork(msg));
    },
  });

  app.registry.add(SLOTS.MESSAGE_ACTIONS, {
    id: 'delete',
    order: 240,
    icon: ICONS.delete,
    label: t('tree.delete'),
    visible: (/** @type {any} */ msg) => realTurn(msg),
    run: (/** @type {any} */ msg) => {
      const br = branching();
      if (br) guard(br.deleteSubtree(msg));
    },
  });

  app.messageActions = { openRegenerateMenu };
  return app.messageActions;
}
