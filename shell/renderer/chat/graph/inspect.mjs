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
 * @param {any} app
 */
export function createInspector(app) {
  /** @type {any} */ let el = null;

  /** Where the inspector goes: inside the conversation column, above the composer. */
  function slot() {
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
    close();

    const node = document.createElement('section');
    node.className = 'graph-inspect';
    node.tabIndex = -1;
    node.setAttribute('aria-label', t('graph.inspectTitle'));

    const head = document.createElement('div');
    head.className = 'graph-inspect-head';
    const title = document.createElement('h3');
    title.textContent = headingText(opts || {});
    const shut = document.createElement('button');
    shut.type = 'button';
    shut.className = 'graph-btn';
    shut.textContent = t('graph.inspectClose');
    shut.addEventListener('click', () => close());
    head.append(title, shut);

    const body = document.createElement('pre');
    body.className = 'graph-inspect-body';
    const text = bodyText(value);
    // An empty value is still worth opening: it says so, rather than showing a blank panel the
    // reader cannot tell from a broken one (§1.2).
    body.textContent = text || t('graph.inspectEmpty');

    // Escape closes THIS, and stops there. ui/shortcuts.mjs reads Escape on `document` as
    // "stop the reply / cancel the run"; a reader closing a value they are reading is not asking
    // for the run to end (BH-7).
    node.addEventListener('keydown', (/** @type {any} */ e) => {
      if (!e || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    });

    node.append(head, body);
    where.main.insertBefore(node, where.form);
    el = node;
    // Focus the close button so the Escape above actually lands here, and so the keyboard can get
    // out of the inspector the same way it got in.
    try { shut.focus(); } catch (err) { void err; }
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
