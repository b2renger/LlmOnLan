// @ts-check
// The context meter (VISION F25): a small bar in the composer row that says how much of the farm's
// window the next send will use, and a popover that breaks the number down.
//
// It is a LEAF (plan §2.6 AB): no loader row, statically imported by app/context.mjs, which owns the
// numbers and hands them over. It owns els.meter (plan §2.6 AE) and is the only module that writes
// into `composer.region('meter')`.
//
//   createMeter(app) → {update(req), setCaps(caps), open(), el}
//
// Where the numbers come from: EV.REQUEST_PREVIEW carries the FINAL RequestDraft — after the trim,
// with the dropped messages already gone — so the breakdown here is what really goes on the wire,
// for a preview and for a real send alike (plan §2.6 AM is what makes both arrive exactly once).
//
// Hidden with no farm: a budget with nothing to spend it on is noise, and the composer row is tight.

import { t } from '../core/i18n.mjs';
import { breakdown } from '../ctx/tokens.mjs';
import '../strings/context.en.mjs';

/** Amber above this share of the window, danger over it. */
const WARN_AT = 0.75;

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

/**
 * Compact token counts: exact below 1,000, then one decimal of "k". The meter is a glance, not an
 * invoice — the popover carries the exact numbers.
 * @param {number} n
 * @returns {string}
 */
export function fmtTokens(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v < 1000) return String(v);
  const k = v / 1000;
  const s = k < 100 ? k.toFixed(1) : String(Math.round(k));
  return `${s.endsWith('.0') ? s.slice(0, -2) : s}k`;
}

/**
 * @param {any} app
 * @returns {{update: (req: any) => void, setCaps: (caps: any) => void, open: () => void, el: HTMLElement|null}}
 */
export function createMeter(app) {
  /** @type {HTMLElement|null} */
  let host = null;
  try {
    host = app.composer && typeof app.composer.region === 'function' ? app.composer.region('meter') : null;
  } catch {
    host = null;
  }
  if (!host || typeof document === 'undefined') {
    return { update() { }, setCaps() { }, open() { }, el: null };
  }

  const root = /** @type {HTMLButtonElement} */ (h('button', 'chat-meter'));
  root.type = 'button';
  root.setAttribute('aria-haspopup', 'dialog');
  const bar = h('span', 'chat-meter-bar');
  const fill = h('span', 'chat-meter-fill');
  bar.appendChild(fill);
  const text = h('span', 'chat-meter-text');
  const src = h('span', 'chat-meter-src');
  root.append(bar, text, src);
  host.replaceChildren(root);                       // els.meter has exactly one owner (§2.6 AE)

  /** @type {any} */ let last = null;               // the last RequestDraft we were shown
  /** @type {any} */ let caps = null;
  /** @type {any} */ let openPopover = null;

  function capsNow() {
    if (caps) return caps;
    try { return app.farm ? app.farm.get() : null; } catch { return null; }
  }

  /** Everything the label and the popover need, from the last preview. */
  function figures() {
    const c = capsNow();
    const budgetInfo = (c && c.budget) || null;
    const meta = (last && last.meta) || {};
    const parts = last ? breakdown(last, meta.ratio) : null;
    const total = Number.isFinite(meta.estimate) ? Number(meta.estimate) : (parts ? parts.total : 0);
    const budget = Number.isFinite(meta.budget) && meta.budget > 0
      ? Number(meta.budget)
      : (budgetInfo && Number(budgetInfo.tokens)) || 0;
    const reserve = Number.isFinite(meta.reserve) ? Number(meta.reserve) : 0;
    const trimmed = Array.isArray(meta.trimmedIds) ? meta.trimmedIds.length : 0;
    return {
      total,
      budget,
      reserve,
      trimmed,
      over: budget > 0 && total + reserve > budget,
      advertised: !!(budgetInfo && budgetInfo.source === 'advertised'),
      parts,
    };
  }

  function render() {
    const c = capsNow();
    const present = !!(c && c.present);
    root.hidden = !present;
    if (!present) return;

    const f = figures();
    const share = f.budget > 0 ? f.total / f.budget : 0;
    const pct = Math.round(share * 100);
    fill.style.width = `${Math.min(100, Math.max(0, share * 100)).toFixed(1)}%`;
    root.classList.toggle('is-over', f.over);
    root.classList.toggle('is-warn', !f.over && share > WARN_AT);
    root.classList.toggle('is-ok', !f.over && share <= WARN_AT);
    const label = t('context.meterLabel', { estimate: fmtTokens(f.total), budget: fmtTokens(f.budget) });
    if (text.textContent !== label) text.textContent = label;
    const advertised = f.advertised ? t('context.meterAdvertised') : '';
    if (src.textContent !== advertised) src.textContent = advertised;
    src.hidden = !f.advertised;
    root.title = f.over ? t('context.meterOver') : t('context.meterTitle', { percent: pct });
    root.setAttribute('aria-label', root.title);
  }

  /** @param {HTMLElement} el @param {number} tokens @param {string} label */
  function row(el, tokens, label) {
    if (!tokens) return;
    const line = h('div', 'chat-meter-row');
    line.append(h('span', 'chat-meter-key', label), h('span', 'chat-meter-val', fmtTokens(tokens)));
    el.appendChild(line);
  }

  /** @param {HTMLElement} el */
  function buildPopover(el) {
    const f = figures();
    const p = f.parts;
    const box = h('div', 'chat-meter-break');
    box.appendChild(h('div', 'chat-meter-title', t('context.breakdownTitle')));
    if (p) {
      row(box, p.system, t('context.breakdownSystem'));
      row(box, p.pinned, t('context.breakdownPinned'));
      row(box, p.history, t('context.breakdownHistory'));
      row(box, p.newTurn, t('context.breakdownNewTurn'));
      // `p.images` is a REPORT, not a bucket: ctx/tokens.mjs charges IMAGE_TOKENS inside
      // estimateMessage, so those tokens are already inside newTurn/history and `total` does not
      // add them again. Printing allowances + images made the column sum to ~2x its own Total the
      // moment a message carried an image (P2 review). Rows sum to Total, or they are lying.
      row(box, p.allowances, t('context.breakdownAttachments'));
    }
    const total = h('div', 'chat-meter-row is-total');
    total.append(h('span', 'chat-meter-key', t('context.breakdownTotal')), h('span', 'chat-meter-val', fmtTokens(f.total)));
    box.appendChild(total);
    row(box, f.reserve, t('context.breakdownReserve'));
    const win = h('div', 'chat-meter-row');
    win.append(h('span', 'chat-meter-key', t('context.breakdownBudget')), h('span', 'chat-meter-val', fmtTokens(f.budget)));
    box.appendChild(win);

    const notes = h('div', 'chat-meter-note');
    const lines = [];
    if (f.over) lines.push(t('context.overNote'));
    if (f.trimmed === 1) lines.push(t('context.trimmedOne'));
    else if (f.trimmed > 1) lines.push(t('context.trimmedMany', { count: f.trimmed }));
    else lines.push(t('context.trimmedNone'));
    lines.push(f.advertised ? t('context.breakdownAdvertised') : t('context.breakdownDefault'));
    for (const line of lines) notes.appendChild(h('p', 'chat-meter-line', line));
    box.appendChild(notes);
    el.appendChild(box);
  }

  function open() {
    if (root.hidden || !app.dialogs || typeof app.dialogs.popover !== 'function') return;
    try {
      if (openPopover && typeof openPopover.close === 'function') openPopover.close();
    } catch { /* already gone */ }
    // The real dialogs call build(el, close); core/fakes.mjs calls build(el) (plan §2.6 Z).
    openPopover = app.dialogs.popover(root, (/** @type {HTMLElement} */ el) => buildPopover(el));
  }

  root.addEventListener('click', (ev) => {
    ev.preventDefault();
    open();
  });

  render();

  return {
    /** @param {any} req the final RequestDraft of a preview or a send */
    update(req) {
      if (req) last = req;
      render();
    },
    /** @param {any} next */
    setCaps(next) {
      caps = next || null;
      render();
    },
    open,
    el: root,
  };
}
