// @ts-check
// Keyboard shortcuts (P2-U3). ONE `document` keydown listener for the whole chat, dispatching the
// SHORTCUTS slot — which this module also hosts, so P4's palette (or any later feature) can add a
// binding without touching this file (plan §2.6 AD).
//
// When it is allowed to act (plan §4 P2-U3):
//   - `app.state.visible` — the chat surface is on screen. LOL Chat lives inside a shell that also
//     shows Open WebUI; a hidden #lolchat must never eat the other surface's keys.
//   - the focus is inside #lolchat, or on <body> (nothing focused yet, straight after a load).
// An <input>/<textarea> elsewhere in the page therefore never loses a keystroke to us.
//
// Built-ins:
//   Escape            stop the reply; with nothing streaming the controller's CANCEL_HANDLERS get
//                     it (that is the seat-wait cancel); with nothing to cancel, close a popover.
//   ArrowUp           in an EMPTY composer: edit the last message you sent.
//   Alt+←  / Alt+→    walk the branches of the last reply.
//   Mod+Shift+O       new chat (Mod = Ctrl, or ⌘ on a Mac).

import { SLOTS } from '../core/registry.mjs';
import { t } from '../core/i18n.mjs';
import { openEdit, closeEdit, isEditing } from './edit-inline.mjs';
import '../strings/tree.en.mjs';

/** @param {string} keys e.g. 'Mod+Shift+O' */
function parseKeys(keys) {
  const parts = String(keys == null ? '' : keys).split('+').map((s) => s.trim()).filter(Boolean);
  const key = parts.pop() || '';
  const mods = new Set(parts.map((s) => s.toLowerCase()));
  return {
    key,
    mod: mods.has('mod'),
    ctrl: mods.has('ctrl'),
    meta: mods.has('meta'),
    shift: mods.has('shift'),
    alt: mods.has('alt'),
  };
}

/**
 * Does this keydown match `keys`? PURE. `Mod` is Ctrl or ⌘ — one binding for both platforms.
 * @param {string} keys @param {any} e
 */
export function matchesKeys(keys, e) {
  if (!e) return false;
  const want = parseKeys(keys);
  const got = String(e.key == null ? '' : e.key);
  if (!want.key) return false;
  if (want.key.length === 1 || got.length === 1) {
    if (got.toLowerCase() !== want.key.toLowerCase()) return false;
  } else if (got !== want.key) return false;

  if (want.mod) {
    if (!e.ctrlKey && !e.metaKey) return false;
  } else {
    if (want.ctrl !== !!e.ctrlKey) return false;
    if (want.meta !== !!e.metaKey) return false;
  }
  if (want.shift !== !!e.shiftKey) return false;
  if (want.alt !== !!e.altKey) return false;
  return true;
}

/** @param {any} app */
export function install(app) {
  const els = app.els || {};

  /** The last message of the open path matching `role`. */
  function lastOf(role) {
    const cur = app.controller && typeof app.controller.current === 'function' ? app.controller.current() : null;
    const path = (cur && cur.path) || [];
    for (let i = path.length - 1; i >= 0; i--) {
      if (path[i] && path[i].role === role) return path[i];
    }
    return null;
  }

  const composerIsEmpty = () => !(els.input && String(els.input.value || '').trim());

  /** Focus is somewhere the chat may claim the key. */
  function focusIsOurs() {
    const el = typeof document !== 'undefined' ? document.activeElement : null;
    if (!el) return true;
    if (typeof document !== 'undefined' && el === document.body) return true;
    const root = app.root;
    if (root && typeof root.contains === 'function') return root.contains(el);
    return false;
  }

  /** Close whatever transient layer is open. @returns {boolean} whether anything closed */
  function closeLayers() {
    let closed = false;
    if (isEditing()) { closeEdit(); closed = true; }
    if (typeof document !== 'undefined') {
      for (const el of Array.from(document.querySelectorAll('.chat-popover'))) {
        const api = /** @type {any} */ (el);
        try {
          if (typeof api.hidePopover === 'function' && el.matches(':popover-open')) api.hidePopover();
          else el.remove();
          closed = true;
        } catch (err) { void err; }
      }
    }
    return closed;
  }

  // ---- built-ins -------------------------------------------------------------------------------

  app.registry.add(SLOTS.SHORTCUTS, {
    id: 'stop',
    keys: 'Escape',
    label: t('tree.shortcutStop'),
    run() {
      // The controller stops a stream, or hands the key to the first active CANCEL_HANDLERS item
      // (the seat wait). Only when nothing at all was cancellable does Escape close a layer.
      let stopped = false;
      if (app.controller && typeof app.controller.stop === 'function') {
        try { stopped = !!app.controller.stop(); } catch (err) { console.warn('[lolchat] stop threw', err); }
      }
      if (!stopped) closeLayers();
    },
  });

  app.registry.add(SLOTS.SHORTCUTS, {
    id: 'edit-last',
    keys: 'ArrowUp',
    label: t('tree.shortcutEditLast'),
    when() {
      if (isEditing() || !composerIsEmpty()) return false;
      if (typeof document !== 'undefined' && els.input && document.activeElement
        && document.activeElement !== els.input && document.activeElement !== document.body) return false;
      return !!lastOf('user');
    },
    run() {
      const msg = lastOf('user');
      if (msg) openEdit(app, msg);
    },
  });

  /** @param {-1|1} dir */
  const branchStep = (dir) => () => {
    const msg = lastOf('assistant');
    if (!msg || !app.branching || typeof app.branching.switchSibling !== 'function') return;
    void Promise.resolve(app.branching.switchSibling(msg.id, dir))
      .catch((err) => console.warn('[lolchat] branch switch failed', err));
  };

  app.registry.add(SLOTS.SHORTCUTS, {
    id: 'branch-prev', keys: 'Alt+ArrowLeft', label: t('tree.shortcutBranchPrev'), run: branchStep(-1),
  });
  app.registry.add(SLOTS.SHORTCUTS, {
    id: 'branch-next', keys: 'Alt+ArrowRight', label: t('tree.shortcutBranchNext'), run: branchStep(1),
  });

  app.registry.add(SLOTS.SHORTCUTS, {
    id: 'new-chat',
    keys: 'Mod+Shift+O',
    label: t('tree.shortcutNewChat'),
    run() {
      if (!app.controller || typeof app.controller.newThread !== 'function') return;
      app.controller.newThread();
      if (app.composer) {
        app.composer.clear();
        app.composer.focus();
      }
    },
  });

  // ---- the one listener -------------------------------------------------------------------------

  /** @param {any} e */
  function onKeyDown(e) {
    if (!e || e.defaultPrevented || e.isComposing) return;
    if (!app.state.visible) return;
    if (!focusIsOurs()) return;
    for (const item of app.registry.list(SLOTS.SHORTCUTS)) {
      if (!matchesKeys(item.keys, e)) continue;
      let ok = true;
      try { ok = item.when ? !!item.when(e, app) : true; } catch (err) { ok = false; void err; }
      if (!ok) continue;
      e.preventDefault();
      try { item.run(e, app); } catch (err) { console.warn(`[lolchat] shortcut "${item.id}" failed`, err); }
      return;
    }
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', onKeyDown);
  }

  app.shortcuts = {
    handle: onKeyDown,
    matchesKeys,
    off: () => {
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('keydown', onKeyDown);
      }
    },
  };
  return app.shortcuts;
}
