// @ts-check
// The chat-column value inspector (plan §2.6 BH-7, docs/LOLCHAT_COMPUTER_SPEC.md §3).
//
// A part's value on the canvas is one line. Clicking it must show the WHOLE thing somewhere a
// person can actually read — and that place is the conversation column, not a popover over the
// graph: the column is where reading happens in this app, it is as wide as the window allows, and
// a value you are reading next to the answer it came from is the point of having both.
//
// The rules this module exists to keep (all frozen in BH-7):
//   - `.graph-inspect` is a DIRECT CHILD of `app.els.main`, inserted immediately before the
//     composer (`els.form`). It is NEVER put inside `#chat-messages`: that subtree belongs to the
//     thread view (§2.6 AE), and a foreign node in it is a rendering bug waiting to happen.
//   - ONE inspector at a time. Opening a second value replaces the first.
//   - It closes on its own button, on Escape, on a thread change, and on panel destroy — and the
//     Escape it handles must NOT also stop the run: the key is consumed here (preventDefault +
//     stopPropagation) before ui/shortcuts.mjs's document listener can read it as "stop".
//   - Nothing here builds HTML. A value is shown with textContent, so a model answer full of
//     angle brackets is text, exactly as it is on the canvas (lint rule 1).

import { t } from '../core/i18n.mjs';
import { preview, itemsOf, isValue } from './values.mjs';

/** How much of a value the inspector shows before it says how much is left. A whole model answer
 * belongs here — this is the surface for READING one — but a runaway value must not be able to
 * paste megabytes into the conversation column. */
export const INSPECT_CAP = 40000;

/** How much of ONE item of a list the inspector shows on its line. */
const ITEM_CHARS = 400;

/**
 * The value as the text the inspector shows. PURE.
 * This is the READING surface, so every kind gets its full-size rendering rather than the canvas's
 * one line: text keeps its line breaks, json is pretty-printed, and a list is one numbered line per
 * item (the ' · ' run that fits on a part is unreadable at forty items).
 * @param {any} value @returns {string}
 */
export function bodyText(value) {
  if (!isValue(value)) return '';
  const full = fullText(value);
  if (full.length <= INSPECT_CAP) return full;
  return `${full.slice(0, INSPECT_CAP)}\n${t('graph.valueMore', { n: full.length - INSPECT_CAP })}`;
}

/** @param {any} value @returns {string} */
function fullText(value) {
  if (value.kind === 'text') return String(value.data == null ? '' : value.data);
  if (value.kind === 'json') {
    try {
      const s = JSON.stringify(value.data, null, 2);
      return s === undefined ? String(value.data) : s;
    } catch { return String(value.data); }
  }
  if (value.kind === 'list') {
    const items = itemsOf(value);
    if (!items.length) return '';
    return items.map((item, i) => `${i + 1}. ${preview(item, ITEM_CHARS)}`).join('\n');
  }
  return preview(value, INSPECT_CAP);
}

/** The heading for one opening. PURE.
 * @param {{partLabel?: string, item?: {i: number, n: number}|null}} opts @returns {string} */
export function headingText(opts) {
  const o = opts || {};
  const head = o.partLabel ? t('graph.inspectFrom', { part: o.partLabel }) : t('graph.inspectTitle');
  if (o.item && Number(o.item.n) > 0) return `${head} · ${t('graph.inspectItem', { i: Number(o.item.i) + 1, n: Number(o.item.n) })}`;
  return head;
}

/**
 * The inspector for one panel instance. It owns exactly one element, and only ever while it is
 * open.
 *
 * K1-U3 (COMPUTER_PLAN §3.2, §8.1) adds the SECOND argument and nothing else: a HOST to render
 * into. The Computer has no conversation column — its reading surface is `computer/drawer.mjs` —
 * so the drawer hands its own mount element here and the pure `bodyText`/`headingText` above are
 * reused verbatim rather than copied.
 *
 *   createInspector(app)                       the chat column, byte-for-byte the C2 behaviour
 *   createInspector(app, el)                   render into `el`
 *   createInspector(app, {el, onClose})        …and tell the host when the value went away
 *
 * Hosted mode differs in exactly two ways, both because the DRAWER owns the chrome:
 *   - no close button in the head (the drawer's own Close is the one, and there must not be two);
 *   - no Escape handler on the section. The drawer consumes Escape for the whole ladder of §8.1,
 *     and two handlers would mean the first one to see the key decides — the bug BH-7 warns about.
 * Everything a reader sees of the VALUE — heading, body, cap, empty — is identical.
 *
 * @param {any} app
 * @param {HTMLElement|{el?: HTMLElement|null, onClose?: () => void}|(() => HTMLElement|null)} [host]
 */
export function createInspector(app, host) {
  /** @type {any} */ let el = null;
  /** True while show() is replacing the open value: a replacement is not a close (§8.1, one at a
   * time), and the host must not be told to shut itself between the two. */
  let replacing = false;

  const hosted = host !== undefined && host !== null;
  /** @returns {any} */
  const hostEl = () => {
    if (!hosted) return null;
    if (typeof host === 'function') return host() || null;
    if (/** @type {any} */ (host).nodeType) return host;
    return /** @type {any} */ (host).el || null;
  };
  const onClose = hosted && host && typeof (/** @type {any} */ (host).onClose) === 'function'
    ? /** @type {any} */ (host).onClose
    : null;

  /** Where the inspector goes: the host when there is one, else the conversation column above the
   * composer. */
  function slot() {
    if (hosted) {
      const h = hostEl();
      return h ? { host: h } : null;
    }
    const els = app && app.els;
    const main = els && els.main;
    const form = els && els.form;
    if (!main || !form || form.parentNode !== main) return null;
    return { main, form };
  }

  function close() {
    if (!el) return false;
    const node = el;
    el = null;
    try { node.remove(); } catch (err) { void err; }
    if (onClose && !replacing) {
      try { onClose(); } catch (err) { console.error('[lolcomputer] inspector host close threw', err); }
    }
    return true;
  }

  /**
   * Show a value. Returns the element, or null when there is nowhere to put it (a layout this
   * panel is not mounted in) — never a half-open inspector.
   * @param {any} value
   * @param {{partLabel?: string, item?: {i: number, n: number}|null}} [opts]
   */
  function show(value, opts) {
    const where = slot();
    if (!where) return null;
    replacing = true;
    try { close(); } finally { replacing = false; }

    const node = document.createElement('section');
    node.className = 'graph-inspect';
    node.tabIndex = -1;
    node.setAttribute('aria-label', t('graph.inspectTitle'));

    const head = document.createElement('div');
    head.className = 'graph-inspect-head';
    const title = document.createElement('h3');
    title.textContent = headingText(opts || {});
    /** @type {any} */ let shut = null;
    if (!hosted) {
      shut = document.createElement('button');
      shut.type = 'button';
      shut.className = 'graph-btn';
      shut.textContent = t('graph.inspectClose');
      shut.addEventListener('click', () => close());
    }
    head.append(title);
    if (shut) head.appendChild(shut);

    const body = document.createElement('pre');
    body.className = 'graph-inspect-body';
    const text = bodyText(value);
    // An empty value is still worth opening: it says so, rather than showing a blank panel the
    // reader cannot tell from a broken one (§1.2).
    body.textContent = text || t('graph.inspectEmpty');

    // Escape closes THIS, and stops there. ui/shortcuts.mjs reads Escape on `document` as
    // "stop the reply / cancel the run"; a reader closing a value they are reading is not asking
    // for the run to end (BH-7). HOSTED: the drawer owns Escape for the whole §8.1 ladder, so
    // there is exactly one handler for the key on that surface too.
    if (!hosted) {
      node.addEventListener('keydown', (/** @type {any} */ e) => {
        if (!e || e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        close();
      });
    }

    node.append(head, body);
    if (where.host) where.host.appendChild(node);
    else where.main.insertBefore(node, where.form);
    el = node;
    // Focus the close button so the Escape above actually lands here, and so the keyboard can get
    // out of the inspector the same way it got in.
    if (shut) { try { shut.focus(); } catch (err) { void err; } }
    return node;
  }

  return {
    show,
    close,
    /** Is one open? (the harness asserts on the DOM, this is for the panel's own bookkeeping) */
    open: () => !!el,
    destroy() { close(); },
  };
}
