// @ts-check
// The first-run offer (COMPUTER_PLAN §10.4; addendum KE-6) — K5-U2. A loader `feature` (row
// `welcome`): `install(app)` publishes `app.welcome` (API_KEYS.welcome) and lays a calm panel over
// the centre of an EMPTY canvas, so a new graph never opens on blank dots:
//
//   The Computer
//   A canvas where you wire small programs …
//   [ Take the tour ]  [ Open a template ]  [ Add your first box ]
//   Or start with:  (T Text) (✦ Instruction) (p5 p5.js sketch) (3D three.js scene) (S SVG)
//   Double-click or right-click anywhere on the canvas to add a box right there.
//
// FROZEN: `install(app)`, the API_KEYS.welcome keys, and the DOM probes the harness clicks:
// `.comp-welcome` and `.comp-welcome-btn[data-action="tour"|"template"|"add"]`. Added by K5-U2:
// the quick picks `.comp-welcome-pick[data-entry]` (a ＋ menu entry id — they place that box in
// the middle of the view through the SAME `canvas.placeEntry` the menu uses) and the tip line.
//
// The panel lives INSIDE `els.canvas` (its own element, KE-1) and covers nothing but itself: a
// double-click on the canvas around it still opens the ＋ menu there. A button whose door is
// missing (no tutorial feature, no tour, no template, no canvas) is HIDDEN, never dead (build
// rule 6). It shows while the open document has no parts, and steps aside the moment it has one.

import { t } from '../core/i18n.mjs';
import { paletteCatalogue } from '../graph/parts/index.mjs';
import { buildPalette } from '../graph/palette.mjs';
import '../strings/palette.en.mjs';

/** The quick picks, in order: the two boxes every graph starts from, then the creative boxes the
 * owner could not find (KE-0). Menu entry ids. */
export const PICKS = Object.freeze(['note', 'ask', 'p5', 'three', 'svg']);

/** @param {string} tag @param {string} cls @param {string} [text] */
function h(tag, cls, text) {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** @param {any} app */
export function install(app) {
  const panel = h('div', 'comp-welcome');
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', t('palette.welcomeTitle'));
  panel.append(h('h2', 'comp-welcome-title', t('palette.welcomeTitle')), h('p', 'comp-welcome-body', t('palette.welcomeBody')));

  const tut = () => /** @type {any} */ (app).tutorial || null;
  const canvas = () => (app.host && app.host.canvas) || null;

  const row = h('div', 'comp-welcome-actions');
  /** @param {string} action @param {string} name @param {string} hint @param {() => void} go */
  const btn = (action, name, hint, go) => {
    const b = /** @type {HTMLButtonElement} */ (h('button', 'comp-welcome-btn'));
    b.type = 'button';
    b.setAttribute('data-action', action);
    b.append(h('span', 'comp-welcome-name', name), h('span', 'comp-welcome-hint', hint));
    b.addEventListener('click', go);
    row.appendChild(b);
    return b;
  };
  const tour = btn('tour', t('palette.welcomeTour'), t('palette.welcomeTourHint'), () => {
    const x = tut();
    if (x && typeof x.open === 'function') void x.open('l00-tour');
  });
  const tpl = btn('template', t('palette.welcomeTemplate'), t('palette.welcomeTemplateHint'), () => {
    const x = tut();
    if (x && typeof x.showShelf === 'function') x.showShelf('templates');
  });
  const add = btn('add', t('palette.welcomeAdd'), t('palette.welcomeAddHint'), () => {
    const c = canvas();
    if (c && typeof c.openPalette === 'function') c.openPalette({});
  });
  panel.appendChild(row);

  // Quick picks: one click puts that box in the middle of the canvas, exactly as the ＋ menu would.
  const picks = h('div', 'comp-welcome-picks');
  picks.appendChild(h('span', 'comp-welcome-picks-label', t('palette.welcomePicks')));
  /** @type {Map<string, any>} */ const entries = new Map();
  try {
    for (const e of buildPalette(paletteCatalogue(), null)) entries.set(e.entry, e);
  } catch { /* no catalogue: no picks (hidden below) */ }
  /** @type {HTMLButtonElement[]} */ const pickBtns = [];
  for (const id of PICKS) {
    const e = entries.get(id);
    if (!e) continue;
    const b = /** @type {HTMLButtonElement} */ (h('button', 'comp-welcome-pick'));
    b.type = 'button';
    b.setAttribute('data-entry', e.entry);
    b.title = t('palette.welcomePickHint', { name: e.label });
    const glyph = h('span', 'comp-welcome-pick-glyph', e.glyph);
    glyph.setAttribute('aria-hidden', 'true');
    b.append(glyph, h('span', 'comp-welcome-pick-name', e.label));
    b.addEventListener('click', () => {
      const c = canvas();
      if (c && typeof c.placeEntry === 'function') c.placeEntry(e, null);
    });
    picks.appendChild(b);
    pickBtns.push(b);
  }
  panel.appendChild(picks);
  panel.appendChild(h('p', 'comp-welcome-tip', t('palette.welcomeTip')));
  app.els.canvas.appendChild(panel);

  function refresh() {
    const s = app.host && app.host.session;
    const open = !!(s && typeof s.docId === 'function' && s.docId());
    const empty = open && s.doc().parts.length === 0;
    const x = tut();
    const c = canvas();
    tour.hidden = !(x && typeof x.has === 'function' && x.has('l00-tour'));
    let templates = 0;
    try { templates = x && typeof x.templates === 'function' ? (x.templates() || []).length : 0; } catch { templates = 0; }
    tpl.hidden = !(x && typeof x.showShelf === 'function' && templates > 0);
    add.hidden = !(c && typeof c.openPalette === 'function');
    const canPlace = !!(c && typeof c.placeEntry === 'function');
    for (const b of pickBtns) b.hidden = !canPlace;
    picks.hidden = !canPlace || pickBtns.length === 0;
    panel.hidden = !empty;
    return !panel.hidden;
  }

  const s = app.host && app.host.session;
  if (s && typeof s.on === 'function') {
    s.on((/** @type {any} */ ev) => {
      if (ev && (ev.type === 'select' || ev.type === 'view')) return;   // cannot change emptiness
      refresh();
    });
  }
  refresh();

  app.welcome = {
    shown: () => !panel.hidden,
    refresh,
    debug: () => ({
      shown: !panel.hidden,
      actions: Array.from(row.querySelectorAll('.comp-welcome-btn')).filter((b) => !(/** @type {any} */ (b).hidden)).map((b) => /** @type {any} */ (b).getAttribute('data-action')),
      picks: pickBtns.filter((b) => !b.hidden).map((b) => b.getAttribute('data-entry')),
    }),
  };
}
