// @ts-check
// K5-U2 (addendum KE-2): the ＋ menu — grouped, searchable, keyboard-driven, and the SAME menu
// whether it is opened by the toolbar's ＋, a double-click or a right-click on empty canvas.
//
// FROZEN: the factory signature, the instance's keys (API_KEYS.palette) and the DOM probes below,
// which the harness clicks exactly as a person does (build rule 6):
//
//   .graph-add-menu                           the menu (hidden when closed), appended to `o.host`
//     input.graph-add-search                  type-to-search (a combobox over the list)
//     .graph-add-group[data-group]            a group heading (only while nothing is typed)
//     button.graph-add-item                   one row, with
//       [data-entry]                          the entry id: a part type ('note') or a preset id ('p5')
//       [data-type]                           the part type it places (c1/c2 scenarios read this)
//       [data-group]                          its group
//       [data-preset]                         present on preset rows only
//       [aria-selected="true"]                the keyboard's current row
//       .graph-add-glyph / .graph-add-name / .graph-add-desc
//     .graph-add-empty                        "No box matches …"
//
// Added by K5-U2 (additions only): `[data-hint="true"]` on the row a lesson's `Show me` points at
// (`open({highlight})`), `.graph-add-tag` (a searched row's group, since a search ranks across
// groups and drops the headings), `.graph-add-foot` (the keys, and the double-click tip — the
// menu teaches the gesture that opens it), and the export `partKeywords(type)`.
//
// The canvas (integrator-owned) owns WHERE a pick lands: `onPick(entry, at)` with `at` the WORLD
// point the menu was opened for, or null for "the centre of the view". This module owns where the
// MENU shows: at `screen`, flipped and clamped so it stays whole inside the canvas at every edge,
// its height fixed at open so the search box never jumps while the person types.

import { t, hasKey } from '../core/i18n.mjs';
import { searchPalette, groupEntries } from './palette.mjs';
import '../strings/palette.en.mjs';

/** @typedef {import('../core/types.mjs').PaletteEntry} PaletteEntry */

/** The gap the menu keeps from the canvas edges, in px. */
const EDGE = 8;
/** The tallest the menu grows, in px (smaller when the canvas is). */
const MAX_H = 520;
/** Rows PageUp/PageDown move by. */
const PAGE = 5;

let menus = 0;

/** The strip at the top of the UNSEARCHED menu (fix pass): the boxes that draw with code and need
 * no farm. GROUP_ORDER is frozen, so in the grouped list they sit under Show, below nine Think rows
 * — twice the owner could not find a box that worked. The strip puts them on screen the moment the
 * menu opens; their rows stay under Show, and a search hides the strip. */
export const QUICK = Object.freeze(['p5', 'three', 'svg', 'html']);

/** A plain part's search-words key (strings/palette.en.mjs). A part type with no row has none. */
const KEYWORDS = {
  note: 'palette.kwNote', image: 'palette.kwImage', file: 'palette.kwFile',
  document: 'palette.kwDocument', audio: 'palette.kwAudio',   // K6 kickoff (KF-8)
  ask: 'palette.kwAsk', split: 'palette.kwSplit', filter: 'palette.kwFilter',
  collect: 'palette.kwCollect', repeat: 'palette.kwRepeat',
  preview: 'palette.kwPreview', code: 'palette.kwCode',
  button: 'palette.kwButton', condition: 'palette.kwCondition', confirm: 'palette.kwConfirm',
  dialog: 'palette.kwDialog', toggle: 'palette.kwToggle', timer: 'palette.kwTimer',
  sticky: 'palette.kwSticky', section: 'palette.kwSection', title: 'palette.kwTitle',
};

/**
 * Search words for a PLAIN part (a preset carries its own `keywords`): comma separated, so the
 * words people type for a box ("prompt", "photo", "loop") find it even when they are not its name.
 * @param {string} type @returns {string[]}
 */
export function partKeywords(type) {
  const s = String(type || '');
  if (!Object.prototype.hasOwnProperty.call(KEYWORDS, s)) return [];
  const key = /** @type {any} */ (KEYWORDS)[s];
  if (!hasKey(key)) return [];
  return t(KEYWORDS[/** @type {keyof typeof KEYWORDS} */ (s)]).split(',').map((w) => w.trim()).filter(Boolean);
}

/** The catalogue carries these words now (parts/index.mjs); this adds only what a row still lacks
 * — rows handed in by a caller that built its own. @param {PaletteEntry} e @returns {PaletteEntry} */
function withKeywords(e) {
  if (e.preset) return e;
  const have = new Set(e.keywords || []);
  const extra = partKeywords(e.type).filter((w) => !have.has(w));
  return extra.length ? { ...e, keywords: [...(e.keywords || []), ...extra] } : e;
}

/**
 * @param {{doc?: Document, host: HTMLElement,
 *   entries: () => PaletteEntry[], groupLabel: (group: string) => string,
 *   onPick: (entry: PaletteEntry, at: {x: number, y: number}|null) => void,
 *   onClose?: () => void}} o
 * @returns {{el: HTMLElement, open(opts?: {at?: {x: number, y: number}|null, screen?: {x: number, y: number}|null, query?: string, highlight?: string}): void,
 *   close(): void, isOpen(): boolean, destroy(): void}}
 */
export function createPaletteMenu(o) {
  const doc = o.doc || document;
  const uid = `graph-add-${++menus}`;
  const el = doc.createElement('div');
  el.className = 'graph-add-menu';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('palette.menuLabel'));

  const search = /** @type {HTMLInputElement} */ (doc.createElement('input'));
  search.className = 'graph-add-search';
  search.type = 'search';
  search.placeholder = t('palette.searchPlaceholder');
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.setAttribute('aria-label', t('palette.searchLabel'));
  search.setAttribute('role', 'combobox');
  search.setAttribute('aria-autocomplete', 'list');
  search.setAttribute('aria-expanded', 'true');
  search.setAttribute('aria-controls', `${uid}-list`);

  const list = doc.createElement('div');
  list.className = 'graph-add-list';
  list.id = `${uid}-list`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', t('palette.menuLabel'));

  const foot = doc.createElement('p');
  foot.className = 'graph-add-foot';
  foot.textContent = t('palette.footKeys');
  const tip = doc.createElement('span');
  tip.className = 'graph-add-tip';
  tip.textContent = t('palette.footTip');
  foot.append(doc.createElement('br'), tip);

  const quick = doc.createElement('div');
  quick.className = 'graph-add-quicks';
  quick.setAttribute('role', 'group');
  quick.setAttribute('aria-label', t('palette.quickLabel'));
  const quickHead = doc.createElement('span');
  quickHead.className = 'graph-add-quick-head';
  quickHead.textContent = t('palette.quickLabel');
  const quickRow = doc.createElement('div');
  quickRow.className = 'graph-add-quick-row';
  quick.append(quickHead, quickRow);

  el.append(search, quick, list, foot);
  o.host.appendChild(el);

  /** @type {{x: number, y: number}|null} */ let at = null;
  /** @type {PaletteEntry[]} */ let all = [];
  /** @type {PaletteEntry[]} */ let shown = [];
  /** @type {HTMLElement[]} */ let rows = [];
  let active = 0;
  /** @type {string} */ let hint = '';
  /** @type {Element|null} */ let returnFocus = null;

  /** Keep the keyboard's row in view — and, for the first row of a group, its heading. */
  function reveal(/** @type {HTMLElement} */ b) {
    const prev = /** @type {HTMLElement|null} */ (b.previousElementSibling);
    const top = prev && prev.classList.contains('graph-add-group') ? prev.offsetTop : b.offsetTop;
    const bottom = b.offsetTop + b.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }

  /** @param {boolean} [scroll] */
  function paintActive(scroll = true) {
    rows.forEach((b, i) => b.setAttribute('aria-selected', i === active ? 'true' : 'false'));
    const b = rows[active];
    if (b) {
      search.setAttribute('aria-activedescendant', b.id);
      if (scroll) reveal(b);
    } else {
      search.removeAttribute('aria-activedescendant');
    }
  }

  /** @param {PaletteEntry} e @param {number} i @param {boolean} searching */
  function row(e, i, searching) {
    const b = /** @type {HTMLButtonElement} */ (doc.createElement('button'));
    b.type = 'button';
    b.className = 'graph-add-item';
    b.id = `${uid}-row-${i}`;
    b.tabIndex = -1;                                  // the search box keeps the focus (a combobox)
    b.setAttribute('data-entry', e.entry);
    b.setAttribute('data-type', e.type);
    b.setAttribute('data-group', e.group);
    if (e.preset) b.setAttribute('data-preset', e.preset);
    if (hint && e.entry === hint) b.setAttribute('data-hint', 'true');
    b.setAttribute('role', 'option');
    const glyph = doc.createElement('span');
    glyph.className = 'graph-add-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = e.glyph;
    const name = doc.createElement('span');
    name.className = 'graph-add-name';
    name.textContent = e.label;
    const desc = doc.createElement('span');
    desc.className = 'graph-add-desc';
    desc.textContent = e.desc;
    b.append(glyph, name);
    if (searching) {
      const tag = doc.createElement('span');
      tag.className = 'graph-add-tag';
      tag.textContent = o.groupLabel(e.group);
      b.appendChild(tag);
    }
    b.appendChild(desc);
    b.title = e.desc;
    b.addEventListener('click', () => pick(e));
    b.addEventListener('pointermove', () => {
      if (active === i) return;
      active = i;
      paintActive(false);                              // the pointer never scrolls the list
    });
    return b;
  }

  /** The quick strip: one chip per QUICK entry the catalogue offers; hidden while searching. */
  function paintQuick(/** @type {boolean} */ searching) {
    const chips = QUICK.map((id) => all.find((e) => e.entry === id)).filter(Boolean);
    quick.hidden = searching || !chips.length;
    if (quick.hidden) return;
    quickRow.replaceChildren(...chips.map((/** @type {any} */ e) => {
      const b = /** @type {HTMLButtonElement} */ (doc.createElement('button'));
      b.type = 'button';
      b.className = 'graph-add-quick';
      b.tabIndex = -1;                                 // the search box keeps the focus
      b.setAttribute('data-entry', e.entry);
      if (hint && e.entry === hint) b.setAttribute('data-hint', 'true');
      b.title = t('palette.quickHint', { name: e.label, desc: e.desc });
      const glyph = doc.createElement('span');
      glyph.className = 'graph-add-quick-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = e.glyph;
      const name = doc.createElement('span');
      name.className = 'graph-add-quick-name';
      name.textContent = e.label;
      b.append(glyph, name);
      b.addEventListener('click', () => pick(e));
      return b;
    }));
  }

  function paint() {
    const query = search.value;
    const searching = !!query.trim();
    paintQuick(searching);
    const found = searchPalette(all, query);
    list.replaceChildren();
    rows = [];
    shown = [];
    if (!found.length) {
      const empty = doc.createElement('p');
      empty.className = 'graph-add-empty';
      empty.setAttribute('role', 'status');
      empty.append(t('palette.noMatch', { query: query.trim() }));
      const more = doc.createElement('span');
      more.className = 'graph-add-empty-hint';
      more.textContent = t('palette.noMatchHint');
      empty.append(doc.createElement('br'), more);
      list.appendChild(empty);
      paintActive();
      return;
    }
    // A query ranks across groups (each row then names its group); no query reads group by group.
    const blocks = searching ? [{ group: '', entries: found }] : groupEntries(found);
    for (const block of blocks) {
      if (block.group) {
        const head = doc.createElement('div');
        head.className = 'graph-add-group';
        head.setAttribute('data-group', block.group);
        head.setAttribute('role', 'presentation');
        head.textContent = o.groupLabel(block.group);
        list.appendChild(head);
      }
      for (const e of block.entries) {
        const b = row(e, shown.length, searching);
        shown.push(e);                                 // the drawn order IS the keyboard order
        rows.push(b);
        list.appendChild(b);
      }
    }
    active = Math.min(Math.max(0, active), shown.length - 1);
    paintActive();
  }

  /** @param {PaletteEntry} e */
  function pick(e) {
    const where = at;
    close({ refocus: false });
    o.onPick(e, where);
  }

  /** @param {number} to */
  function move(to) {
    if (!shown.length) return;
    active = to;
    paintActive();
  }

  function onKey(/** @type {KeyboardEvent} */ ev) {
    if (el.hidden || ev.isComposing) return;
    const n = shown.length;
    let handled = true;
    switch (ev.key) {
      case 'Escape': close({ refocus: true }); break;
      case 'ArrowDown': move(n ? (active + 1) % n : 0); break;
      case 'ArrowUp': move(n ? (active - 1 + n) % n : 0); break;
      case 'PageDown': move(Math.min(n - 1, active + PAGE)); break;
      case 'PageUp': move(Math.max(0, active - PAGE)); break;
      case 'Enter':
        if (ev.ctrlKey || ev.metaKey) { handled = false; break; }
        if (shown[active]) pick(shown[active]);
        break;
      default: handled = false;
    }
    if (!handled) return;
    ev.preventDefault();
    ev.stopPropagation();                              // never the canvas's Escape (stop the run) or arrows
  }

  function onOutside(/** @type {Event} */ ev) {
    if (el.hidden) return;
    const target = /** @type {any} */ (ev.target);
    if (target && el.contains(target)) return;
    if (target && target.closest && target.closest('.graph-add')) return;   // the ＋ toggles itself
    close({ refocus: false });
  }

  // Clicking a heading, a row or the empty space in the menu must not take the focus away from the
  // search box, or the arrows would stop working after the first click.
  function onMouseDown(/** @type {MouseEvent} */ ev) {
    if (ev.target !== search) ev.preventDefault();
  }

  // Tab (or anything else) moving the focus OUT of the menu closes it. A window losing focus has
  // no relatedTarget and leaves the menu as it was.
  function onFocusOut(/** @type {FocusEvent} */ ev) {
    if (el.hidden) return;
    const next = /** @type {any} */ (ev.relatedTarget);
    if (!next || el.contains(next)) return;
    if (next.closest && next.closest('.graph-add')) return;
    close({ refocus: false });
  }

  search.addEventListener('input', () => { active = 0; hint = ''; paint(); });
  el.addEventListener('keydown', onKey);
  el.addEventListener('mousedown', onMouseDown);
  el.addEventListener('focusout', onFocusOut);
  doc.addEventListener('pointerdown', onOutside, true);

  /**
   * Show the menu at `screen` (px, relative to the host), kept whole inside the host: past the
   * right edge it opens to the LEFT of the point, past the bottom it opens ABOVE it, and whatever
   * still does not fit is clamped `EDGE` px inside. The height is fixed here, once, so a search
   * that finds three rows does not pull the search box out from under the typing hand.
   * @param {{x: number, y: number}|null} screen */
  function position(screen) {
    el.style.height = '';
    const hostW = o.host.clientWidth;
    const hostH = o.host.clientHeight;
    const x0 = screen && Number.isFinite(screen.x) ? screen.x : EDGE;
    const y0 = screen && Number.isFinite(screen.y) ? screen.y : EDGE;
    if (!hostW || !hostH) {                            // not laid out (hidden, or a test document)
      el.style.left = `${Math.round(x0)}px`;
      el.style.top = `${Math.round(y0)}px`;
      return;
    }
    const cap = Math.max(120, Math.min(MAX_H, hostH - 2 * EDGE));
    el.style.maxHeight = `${cap}px`;
    const w = Math.min(el.offsetWidth, hostW - 2 * EDGE);
    const h = Math.min(el.offsetHeight, cap);
    let x = x0;
    let y = y0;
    if (x + w > hostW - EDGE) x = x0 - w;
    if (y + h > hostH - EDGE) y = y0 - h >= EDGE ? y0 - h : hostH - h - EDGE;
    x = Math.max(EDGE, Math.min(x, hostW - w - EDGE));
    y = Math.max(EDGE, Math.min(y, hostH - h - EDGE));
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    if (Math.round(y) === Math.round(y0)) {
      // Hanging DOWN from the point: the search box is the top edge and never moves, so the menu
      // may shrink to what a search finds — and grow back no further than the room below.
      el.style.maxHeight = `${Math.round(Math.min(cap, hostH - EDGE - y))}px`;
    } else {
      // Lifted above the point (or pushed in from an edge): a shrinking menu would drag the search
      // box away from the typing hand, so its height is fixed for as long as it is open.
      el.style.height = `${Math.round(h)}px`;
    }
  }

  /** @param {{at?: {x: number, y: number}|null, screen?: {x: number, y: number}|null, query?: string, highlight?: string}} [opts] */
  function open(opts = {}) {
    if (el.hidden) returnFocus = doc.activeElement;
    all = (o.entries() || []).map(withKeywords);
    at = opts.at || null;
    hint = opts.highlight ? String(opts.highlight) : '';
    search.value = opts.query ? String(opts.query) : '';
    active = 0;
    el.hidden = false;
    list.scrollTop = 0;
    paint();
    position(opts.screen || null);
    if (hint) {
      const i = shown.findIndex((e) => e.entry === hint);
      if (i >= 0) { active = i; paintActive(); }
    }
    try { search.focus({ preventScroll: true }); } catch { /* not focusable yet */ }
  }

  /** @param {{refocus?: boolean}} [how] */
  function close(how = {}) {
    if (el.hidden) return;
    el.hidden = true;
    hint = '';
    const back = /** @type {any} */ (returnFocus);
    returnFocus = null;
    if (how.refocus && back && back !== doc.body && typeof back.focus === 'function' && back.isConnected) {
      try { back.focus({ preventScroll: true }); } catch { /* gone */ }
    }
    if (o.onClose) o.onClose();
  }

  return {
    el,
    open,
    close: () => close({ refocus: false }),
    isOpen: () => !el.hidden,
    destroy() {
      doc.removeEventListener('pointerdown', onOutside, true);
      el.remove();
    },
  };
}
