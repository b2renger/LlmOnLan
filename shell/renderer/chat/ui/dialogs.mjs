// @ts-check
// Modal dialogs, popovers and toasts (plan §3.4 / §4 P1-U4).
//
//   createDialogs(app) → {
//     confirm({title, body, ok, danger}) → Promise<boolean>
//     prompt({title, body, value, placeholder, ok}) → Promise<string|null>   // null = cancelled
//     popover(anchorEl, build) → {el, close}                                 // Popover API, light-dismiss
//     toast(text, {kind, ms}) → {el, close}
//   }
//
// Everything is built with createElement (never a string of HTML), so no caller can turn model text
// into markup. The modal surfaces are real <dialog>s: Escape cancels them for free, the browser keeps
// focus inside them, and the top layer escapes the `overflow-y:auto` clipping of the message list.
// Because they hang off <body> rather than #lolchat, every root carries the `.chat-layer` class — the
// escape hatch css/base.css publishes so the shared primitives (.btn-accent, focus rings, reduced
// motion) still apply outside #lolchat. Toasts are the exception: plan §4 P1-U4 puts them in a local
// stack INSIDE #lolchat.
//
// CALLING `popover(anchorEl, build)`: `build` is handed the popover's OWN root, already carrying
// `chat-popover chat-layer` — the element this module positions, light-dismisses and styles. APPEND
// your content to it; a caller that writes `el.className = 'my-menu'` silently destroys positioning
// and dismissal (it happened once, to the composer's chip menu). The real `build` is called as
// `build(el, close)`; `core/fakes.mjs` calls it as `build(el)` and returns the handle instead, so a
// caller that wants `close` must tolerate both.
//
// Focus is restored to whatever had it before a modal opened (the row's × button, say), so keyboard
// users are not dumped at the top of the document after a confirm.

import { t } from '../core/i18n.mjs';
import '../strings/dialogs.en.mjs';

const TOAST_MS = 4200;

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

/** @param {any} app */
export function createDialogs(app) {
  /** @type {HTMLElement|null} */
  let toastStack = null;

  /**
   * The shared modal shell: a <dialog> with a title, a body node and a cancel/confirm pair.
   * `finish(returnValue, body)` maps the way the dialog closed onto the caller's promise value.
   * @param {{title?: string, ok?: string, danger?: boolean, focus?: 'ok'|'cancel'|'body'}} o
   * @param {(body: HTMLElement) => void} fillBody
   * @param {(returnValue: string, body: HTMLElement) => any} finish
   */
  function modal(o, fillBody, finish) {
    const dlg = /** @type {HTMLDialogElement} */ (h('dialog', 'chat-dialog chat-layer'));
    const form = /** @type {HTMLFormElement} */ (h('form', 'chat-dialog-form'));
    form.setAttribute('method', 'dialog');

    const head = h('div', 'chat-dialog-head');
    if (o.title) head.appendChild(h('h2', 'chat-dialog-title', String(o.title)));
    const body = h('div', 'chat-dialog-body');
    fillBody(body);

    const foot = h('div', 'chat-dialog-foot');
    const cancel = /** @type {HTMLButtonElement} */ (h('button', 'btn-ghost chat-dialog-cancel', t('dialogs.cancel')));
    cancel.type = 'button';
    const okBtn = /** @type {HTMLButtonElement} */ (h('button', `btn-accent chat-dialog-ok${o.danger ? ' chat-dialog-danger' : ''}`, o.ok || t('dialogs.ok')));
    okBtn.type = 'submit';
    okBtn.value = 'ok';
    foot.append(cancel, okBtn);

    form.append(head, body, foot);
    dlg.appendChild(form);
    document.body.appendChild(dlg);

    const previous = /** @type {any} */ (document.activeElement);
    let settled = false;

    return new Promise((resolve) => {
      const done = (/** @type {string} */ value) => {
        if (settled) return;
        settled = true;
        const result = finish(value, body);
        dlg.remove();
        if (previous && typeof previous.focus === 'function' && previous.isConnected) previous.focus();
        resolve(result);
      };

      cancel.addEventListener('click', () => { dlg.close('cancel'); });
      // Escape fires the browser's own 'cancel' event and then closes with an empty returnValue.
      dlg.addEventListener('close', () => done(dlg.returnValue || 'cancel'));
      // A click on the backdrop lands on the <dialog> itself (the form covers everything else).
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        dlg.close('ok');
      });

      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', 'open');

      const first = o.focus === 'body' ? /** @type {any} */ (body.querySelector('input, textarea, select')) : null;
      const target = first || (o.focus === 'cancel' || o.danger ? cancel : okBtn);
      if (target && typeof target.focus === 'function') target.focus();
    });
  }

  /** @param {{title?: string, body?: string, ok?: string, danger?: boolean}} [o] */
  function confirm(o = {}) {
    return modal(
      { title: o.title, ok: o.ok, danger: !!o.danger },
      (bodyEl) => { if (o.body) bodyEl.appendChild(h('p', 'chat-dialog-text', String(o.body))); },
      (value) => value === 'ok',
    );
  }

  /** @param {{title?: string, body?: string, value?: string, placeholder?: string, ok?: string}} [o] */
  function prompt(o = {}) {
    /** @type {any} */
    let input = null;
    return modal(
      { title: o.title, ok: o.ok, focus: 'body' },
      (bodyEl) => {
        if (o.body) bodyEl.appendChild(h('p', 'chat-dialog-text', String(o.body)));
        input = h('input', 'chat-dialog-input');
        input.type = 'text';
        input.value = o.value == null ? '' : String(o.value);
        if (o.placeholder) input.placeholder = String(o.placeholder);
        bodyEl.appendChild(input);
        // select() so typing replaces the suggested value, the way a rename box should behave.
        setTimeout(() => { if (input && typeof input.select === 'function') input.select(); }, 0);
      },
      (value) => (value === 'ok' ? (input ? String(input.value) : '') : null),
    );
  }

  /**
   * A light-dismiss popover under `anchorEl`. `build(el, close)` fills it.
   * @param {HTMLElement} anchorEl
   * @param {(el: HTMLElement, close: () => void) => void} build
   */
  function popover(anchorEl, build) {
    const el = h('div', 'chat-popover chat-layer');
    el.setAttribute('popover', 'auto');
    document.body.appendChild(el);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      try {
        const api = /** @type {any} */ (el);
        if (typeof api.hidePopover === 'function' && el.matches(':popover-open')) api.hidePopover();
      } catch { /* already hidden */ }
      el.remove();
    };

    build(el, close);

    const api = /** @type {any} */ (el);
    if (typeof api.showPopover === 'function') {
      try { api.showPopover(); } catch { /* not connected */ }
    } else {
      el.classList.add('chat-popover-open');       // no Popover API: a plainly positioned panel
    }
    place(el, anchorEl);
    // Light dismiss (a click elsewhere, Escape) closes the popover; drop the node with it.
    el.addEventListener('toggle', (/** @type {any} */ e) => { if (e && e.newState === 'closed') close(); });

    return { el, close };
  }

  /** Put `el` under `anchorEl`, kept inside the viewport. @param {HTMLElement} el @param {HTMLElement} anchorEl */
  function place(el, anchorEl) {
    if (!anchorEl || typeof anchorEl.getBoundingClientRect !== 'function') return;
    const a = anchorEl.getBoundingClientRect();
    const w = el.offsetWidth || 220;
    const tall = el.offsetHeight || 0;
    const margin = 6;
    let left = a.left;
    let top = a.bottom + 4;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (vw && left + w + margin > vw) left = Math.max(margin, vw - w - margin);
    if (vh && tall && top + tall + margin > vh) top = Math.max(margin, a.top - tall - 4);
    el.style.left = `${Math.max(margin, left)}px`;
    el.style.top = `${Math.max(margin, top)}px`;
  }

  /** @param {string} text @param {{kind?: 'info'|'error'|'success', ms?: number}} [o] */
  function toast(text, o = {}) {
    if (!toastStack || !toastStack.isConnected) {
      toastStack = h('div', 'chat-toasts');
      // Inside #lolchat (plan §4 P1-U4). `app.root` is that element; fall back to <body> rather
      // than throwing, so a toast can never take down the caller that raised it.
      (app && app.root ? app.root : document.body).appendChild(toastStack);
    }
    const el = h('div', `chat-toast chat-toast-${o.kind || 'info'}`, String(text));
    el.setAttribute('role', o.kind === 'error' ? 'alert' : 'status');
    toastStack.appendChild(el);

    let gone = false;
    const close = () => {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      el.remove();
      if (toastStack && !toastStack.childNodes.length) toastStack.remove();
    };
    const timer = setTimeout(close, Number(o.ms) > 0 ? Number(o.ms) : TOAST_MS);
    el.addEventListener('click', close);
    return { el, close };
  }

  return { confirm, prompt, popover, toast };
}
