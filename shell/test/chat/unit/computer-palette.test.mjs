// K5-U2 (addendum KE-2, KE-6): the ＋ menu's model (graph/palette.mjs — the fuzzy search), the
// menu itself (graph/palette-menu.mjs — rows, keys, where it shows) and the first-run offer
// (computer/welcome.mjs), in Node with the runner's DOM shim. The same paths a person takes are
// driven in the real browser by chat-harness/scenarios/k5-palette.mjs.
import assert from 'node:assert/strict';

import { specMap, paletteCatalogue, groupLabel } from '../../../renderer/chat/graph/parts/index.mjs';
import {
  buildPalette, searchPalette, groupEntries, GROUP_ORDER, words, osa, scoreEntry, STOP_WORDS,
} from '../../../renderer/chat/graph/palette.mjs';
import { createPaletteMenu, partKeywords } from '../../../renderer/chat/graph/palette-menu.mjs';
import { install as installWelcome, PICKS } from '../../../renderer/chat/computer/welcome.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';

const SPECS = specMap();
/** The rows exactly as the menu holds them: the catalogue plus the plain parts' search words. */
const ROWS = buildPalette(paletteCatalogue(), SPECS)
  .map((e) => (e.preset ? e : { ...e, keywords: [...e.keywords, ...partKeywords(e.type)] }));
const ids = (/** @type {any[]} */ list) => list.map((e) => e.entry);
const find = (/** @type {string} */ q) => ids(searchPalette(ROWS, q));

/** A fresh shim document that also takes document-level listeners. */
function shimDoc() {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  /** @type {Map<string, Set<Function>>} */ const on = new Map();
  doc.addEventListener = (/** @type {string} */ type, /** @type {Function} */ fn) => { const s = on.get(type) || new Set(); s.add(fn); on.set(type, s); };
  doc.removeEventListener = (/** @type {string} */ type, /** @type {Function} */ fn) => { const s = on.get(type); if (s) s.delete(fn); };
  doc.fire = (/** @type {any} */ ev) => { for (const fn of on.get(ev.type) || []) fn(ev); };
  doc.listeners = (/** @type {string} */ type) => (on.get(type) || new Set()).size;
  return doc;
}

/** A keyboard event the menu can prevent and stop. */
function keyEv(/** @type {string} */ key, extra = {}) {
  return { type: 'keydown', key, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
}

/** A menu in a shim document, with its picks recorded. */
function makeMenu(/** @type {any} */ extra = {}) {
  const doc = shimDoc();
  const host = doc.createElement('div');
  host.className = 'graph';
  /** @type {{entry: any, at: any}[]} */ const picked = [];
  let closed = 0;
  const menu = createPaletteMenu({
    doc, host,
    entries: () => buildPalette(paletteCatalogue(), SPECS),
    groupLabel,
    onPick: (entry, at) => picked.push({ entry, at }),
    onClose: () => { closed++; },
    ...extra,
  });
  const q = (/** @type {string} */ sel) => menu.el.querySelector(sel);
  const qa = (/** @type {string} */ sel) => /** @type {any[]} */ (menu.el.querySelectorAll(sel));
  const rows = () => qa('.graph-add-item').map((/** @type {any} */ b) => ({
    entry: b.getAttribute('data-entry'), active: b.getAttribute('aria-selected') === 'true', b,
  }));
  const type = (/** @type {string} */ v) => { const s = q('.graph-add-search'); s.value = v; s.dispatchEvent({ type: 'input' }); };
  const press = (/** @type {string} */ key, extra2 = {}) => { const ev = keyEv(key, extra2); menu.el.dispatchEvent(ev); return ev; };
  return { doc, host, menu, picked, closedCount: () => closed, q, qa, rows, type, press };
}

export default (test) => {
  // ---------------------------------------------------------------- the model: build + group
  test('palette: every row is in a frozen group, reading order is group → order → label', () => {
    assert.deepEqual(groupEntries(ROWS).map((g) => g.group), [...GROUP_ORDER]);
    const gi = (/** @type {string} */ g) => GROUP_ORDER.indexOf(g);
    for (let i = 1; i < ROWS.length; i++) {
      const a = ROWS[i - 1];
      const b = ROWS[i];
      assert.ok(gi(a.group) < gi(b.group) || (a.group === b.group && a.order <= b.order), `${a.entry} before ${b.entry}`);
    }
    // the named creative boxes sit in Show BEFORE the generic Preview and Code (KE-2)
    const show = ids(ROWS.filter((r) => r.group === 'show'));
    assert.deepEqual(show, ['p5', 'three', 'svg', 'html', 'markdown', 'preview', 'code']);
    // Think: the Instruction first, then the Write-… boxes, then the list tools
    const think = ids(ROWS.filter((r) => r.group === 'think'));
    assert.deepEqual(think.slice(0, 5), ['ask', 'write-p5', 'write-three', 'write-svg', 'write-html']);
  });

  test('palette: buildPalette drops duplicates, unknown types and junk, and never shares settings', () => {
    const cat = {
      parts: [
        { type: 'note', label: 'Text', group: 'bring', order: 10, glyph: 'T', desc: 'd' },
        { type: 'note', label: 'Text again', group: 'bring', order: 11, glyph: 'T', desc: 'd' },
        { type: 'nope', label: 'Nope', group: 'think', order: 1, glyph: '?', desc: 'd' },
        null,
      ],
      presets: [
        { id: 'svg', type: 'preview', group: 'show', label: 'SVG', title: 'SVG', desc: 'd', glyph: 'S', keywords: ['picture'], order: 830, settings: { mode: 'svg' }, match: { mode: 'svg' }, size: { w: 300, h: 200 } },
        { id: 'svg', type: 'preview', group: 'show', label: 'SVG 2', title: 'SVG', desc: 'd', glyph: 'S', keywords: [], order: 831, settings: {}, match: {} },
      ],
    };
    const rows = buildPalette(/** @type {any} */ (cat), SPECS);
    assert.deepEqual(ids(rows), ['note', 'svg']);
    const svg = rows[1];
    assert.equal(svg.preset, 'svg');
    assert.deepEqual(svg.size, { w: 300, h: 200 });
    /** @type {any} */ (svg.settings).mode = 'html';
    assert.equal(cat.presets[0].settings.mode, 'svg', 'a row is a COPY: picking one never edits the catalogue');
    assert.deepEqual(buildPalette(/** @type {any} */ (null), SPECS), []);
  });

  // ---------------------------------------------------------------- the search (KE-2 acceptance)
  test('search: "p5" finds the p5.js sketch FIRST, then Write a p5.js sketch', () => {
    const r = find('p5');
    assert.equal(r[0], 'p5');
    assert.equal(r[1], 'write-p5');
  });

  test('search: "svg" finds both SVG rows, the box first', () => {
    const r = find('svg');
    assert.deepEqual(r.slice(0, 2), ['svg', 'write-svg']);
  });

  test('search: "picture" finds Image and SVG', () => {
    const r = find('picture');
    assert.ok(r.includes('image') && r.includes('svg'), String(r));
  });

  test('search: a typo still finds the box — "skecth", "imgae", "timre", "instrution"', () => {
    assert.equal(find('skecth')[0], 'p5', 'a swapped pair of letters is one edit');
    assert.equal(find('imgae')[0], 'image');
    assert.equal(find('timre')[0], 'timer');
    assert.equal(find('instrution')[0], 'ask', 'a dropped letter in a long word');
  });

  test('search: run-together, dotted and multi-word names', () => {
    assert.equal(find('threejs')[0], 'three');
    assert.equal(find('three.js')[0], 'three');
    assert.equal(find('p5js')[0], 'p5');
    assert.equal(find('write an svg')[0], 'write-svg', 'the words of a label, in order');
    assert.equal(find('write svg')[0], 'write-svg', 'a little word left out');
    assert.equal(find('html page')[0], 'html');
    assert.equal(find('3d')[0], 'three', 'by keyword');
  });

  test('search: by what a box DOES — keywords and descriptions', () => {
    assert.equal(find('prompt')[0], 'ask', 'the word people use for an Instruction');
    assert.equal(find('model')[0], 'ask');
    assert.equal(find('loop')[0], 'repeat');
    assert.equal(find('wait')[0], 'timer');
    assert.equal(find('yes no')[0], 'condition');
    assert.equal(find('ask')[0], 'ask', 'the part type is a keyword, and beats the Write-… presets built on it');
    assert.equal(find('note')[0], 'note', 'the Text part is still found by its old name');
    assert.ok(find('javascript').includes('code'));
    assert.ok(find('animation').includes('p5'));
  });

  test('search: a sentence may say more than one box does, and pays for it', () => {
    const r = find('make a picture');
    assert.ok(r.includes('svg') && r.includes('image'), String(r));
    assert.equal(find('draw a spinning cube')[0], 'three');
    assert.deepEqual(find('xyzzy'), [], 'nothing matches nonsense');
    assert.deepEqual(find('zzz qqq svg').length, 0, 'more than half the words missing is no match');
  });

  test('search: no query is every row in reading order; case and accents fold', () => {
    assert.deepEqual(find(''), ids(ROWS));
    assert.deepEqual(find('   '), ids(ROWS));
    assert.deepEqual(find('SVG'), find('svg'));
    assert.deepEqual(find('Imàge').slice(0, 1), ['image']);
  });

  test('search: helpers — words, osa, stop words, scoreEntry', () => {
    assert.deepEqual(words('p5.js sketch'), ['p5', 'js', 'sketch']);
    assert.deepEqual(words('  Write an SVG!'), ['write', 'an', 'svg']);
    assert.equal(osa('sketch', 'skecth'), 1, 'a transposition is one edit');
    assert.equal(osa('image', 'imgae'), 1);
    assert.equal(osa('kitten', 'sitting'), 3);
    assert.equal(osa('abcdef', 'uvwxyz', 1), 2, 'gives up past max');
    assert.ok(STOP_WORDS.includes('a'));
    const p5 = ROWS.find((r) => r.entry === 'p5');
    assert.ok(p5);
    assert.equal(scoreEntry(/** @type {any} */ (p5), ''), 0);
    assert.ok(scoreEntry(/** @type {any} */ (p5), 'p5') > scoreEntry(/** @type {any} */ (p5), 'sketch'), 'a name that starts with the query beats a word in it');
    assert.equal(scoreEntry(/** @type {any} */ (p5), 'timer'), 0);
  });

  test('search: short queries never fuzz (two letters stay exact)', () => {
    const r = find('no');
    assert.ok(!r.includes('p5') && !r.includes('svg'), String(r));
  });

  test('partKeywords: every plain part has search words; presets bring their own', () => {
    for (const r of ROWS.filter((x) => !x.preset)) assert.ok(partKeywords(r.type).length >= 3, `${r.type} has search words`);
    assert.deepEqual(partKeywords('p5'), []);
    assert.deepEqual(partKeywords(''), []);
  });

  // ---------------------------------------------------------------- the menu (DOM shim)
  test('menu: opens grouped, every row with its glyph, name and one-liner; closed is hidden', () => {
    const m = makeMenu();
    assert.equal(m.menu.el.hidden, true, 'hidden until opened');
    assert.equal(m.host.querySelector('.graph-add-menu'), m.menu.el, 'appended to the canvas root');
    m.menu.open({});
    assert.equal(m.menu.isOpen(), true);
    const groups = m.qa('.graph-add-group').map((/** @type {any} */ g) => g.getAttribute('data-group'));
    assert.deepEqual(groups, [...GROUP_ORDER]);
    const rows = m.qa('.graph-add-item');
    assert.equal(rows.length, ROWS.length);
    for (const b of rows) {
      assert.ok(b.getAttribute('data-entry') && b.getAttribute('data-type') && b.getAttribute('data-group'));
      assert.ok(b.querySelector('.graph-add-glyph').textContent, `${b.getAttribute('data-entry')} has a glyph`);
      assert.ok(b.querySelector('.graph-add-name').textContent);
      assert.ok(b.querySelector('.graph-add-desc').textContent.length > 10);
      assert.equal(b.getAttribute('role'), 'option');
    }
    const p5 = m.q('.graph-add-item[data-entry="p5"]');
    assert.equal(p5.getAttribute('data-preset'), 'p5');
    assert.equal(p5.getAttribute('data-type'), 'preview');
    assert.equal(m.q('.graph-add-item[data-entry="note"]').getAttribute('data-preset'), null, 'a plain part has no data-preset');
    assert.equal(m.qa('.graph-add-item[aria-selected="true"]').length, 1, 'exactly one keyboard row');
    assert.equal(m.rows()[0].active, true, 'the first row starts active');
    assert.ok(m.q('.graph-add-foot').textContent.includes(t('palette.footTip')), 'the menu teaches the double-click');
    m.menu.close();
    assert.equal(m.menu.isOpen(), false);
    assert.equal(m.closedCount(), 1);
  });

  test('menu: typing searches across groups — headings go, each row names its group', () => {
    const m = makeMenu();
    m.menu.open({});
    m.type('svg');
    assert.deepEqual(m.rows().slice(0, 2).map((r) => r.entry), ['svg', 'write-svg']);
    assert.equal(m.qa('.graph-add-group').length, 0);
    assert.equal(m.q('.graph-add-item[data-entry="svg"] .graph-add-tag').textContent, groupLabel('show'));
    assert.equal(m.rows()[0].active, true, 'the best match is the keyboard row: Enter adds it');
    m.type('xyzzy');
    assert.equal(m.rows().length, 0);
    const empty = m.q('.graph-add-empty');
    assert.ok(empty && empty.textContent.includes('xyzzy'), 'says what found nothing');
    m.type('');
    assert.equal(m.rows().length, ROWS.length, 'clearing the search brings every row back');
  });

  test('menu: ↑/↓ move and wrap, PageDown jumps, Enter places the keyboard row at the opened point', () => {
    const m = makeMenu();
    const at = { x: 120, y: 80 };
    m.menu.open({ at });
    const n = m.rows().length;
    let ev = m.press('ArrowDown');
    assert.ok(ev.prevented && ev.stopped, 'the canvas never sees the arrow');
    assert.equal(m.rows().findIndex((r) => r.active), 1);
    m.press('ArrowUp');
    m.press('ArrowUp');
    assert.equal(m.rows().findIndex((r) => r.active), n - 1, 'up from the first row wraps to the last');
    m.press('ArrowDown');
    assert.equal(m.rows().findIndex((r) => r.active), 0, 'and down from the last wraps to the first');
    m.press('PageDown');
    assert.equal(m.rows().findIndex((r) => r.active), 5);
    const want = m.rows()[5].entry;
    ev = m.press('Enter');
    assert.ok(ev.prevented);
    assert.equal(m.picked.length, 1);
    assert.equal(m.picked[0].entry.entry, want);
    assert.deepEqual(m.picked[0].at, at, 'the pick lands where the menu was opened for');
    assert.equal(m.menu.isOpen(), false, 'a pick closes the menu');
  });

  test('menu: search then Enter adds the best match (the fastest path: ＋, type, Enter)', () => {
    const m = makeMenu();
    m.menu.open({});
    m.type('skecth');
    m.press('Enter');
    assert.equal(m.picked.length, 1);
    assert.equal(m.picked[0].entry.entry, 'p5');
    assert.equal(m.picked[0].at, null, 'the toolbar ＋ places at the centre of the view');
    assert.equal(/** @type {any} */ (m.picked[0].entry.settings).mode, 'p5', 'the preset carries its settings');
  });

  test('menu: Escape closes without placing and stops the event (never the run-stopping Escape)', () => {
    const m = makeMenu();
    m.menu.open({});
    m.type('svg');
    const ev = m.press('Escape');
    assert.ok(ev.prevented && ev.stopped);
    assert.equal(m.menu.isOpen(), false);
    assert.equal(m.picked.length, 0);
    // Ctrl+Enter is the canvas's Run: the menu leaves it alone.
    m.menu.open({});
    const run = m.press('Enter', { ctrlKey: true });
    assert.equal(run.prevented, false);
    assert.equal(m.picked.length, 0);
    // an IME composing
    const ime = m.press('Enter', { isComposing: true });
    assert.equal(ime.prevented, false);
  });

  test('menu: clicking a row picks it; a pointerdown outside closes, inside does not', () => {
    const m = makeMenu();
    m.menu.open({ at: { x: 1, y: 2 } });
    m.doc.fire({ type: 'pointerdown', target: m.q('.graph-add-search') });
    assert.equal(m.menu.isOpen(), true, 'a press inside the menu keeps it');
    m.doc.fire({ type: 'pointerdown', target: m.doc.createElement('div') });
    assert.equal(m.menu.isOpen(), false, 'a press elsewhere closes it');
    m.menu.open({ at: { x: 1, y: 2 } });
    m.q('.graph-add-item[data-entry="three"]').dispatchEvent({ type: 'click' });
    assert.equal(m.picked.length, 1);
    assert.equal(m.picked[0].entry.entry, 'three');
    assert.deepEqual(m.picked[0].at, { x: 1, y: 2 });
  });

  test('menu: the pointer moves the keyboard row (Enter adds what is under the mouse)', () => {
    const m = makeMenu();
    m.menu.open({});
    m.q('.graph-add-item[data-entry="svg"]').dispatchEvent({ type: 'pointermove' });
    assert.equal(m.rows().find((r) => r.active)?.entry, 'svg');
    m.press('Enter');
    assert.equal(m.picked[0].entry.entry, 'svg');
  });

  test('menu: open({highlight}) — a lesson\'s Show me — selects and marks that row', () => {
    const m = makeMenu();
    m.menu.open({ highlight: 'write-svg' });
    const row = m.q('.graph-add-item[data-entry="write-svg"]');
    assert.equal(row.getAttribute('aria-selected'), 'true');
    assert.equal(row.getAttribute('data-hint'), 'true');
    assert.equal(m.qa('.graph-add-item[data-hint]').length, 1);
    assert.equal(m.q('.graph-add-search').getAttribute('aria-activedescendant'), row.id, 'a screen reader hears the row');
    m.type('p5');
    assert.equal(m.qa('.graph-add-item[data-hint]').length, 0, 'typing clears the hint');
    m.menu.close();
    m.menu.open({});
    assert.equal(m.qa('.graph-add-item[data-hint]').length, 0, 'and it never survives a reopen');
    m.menu.open({ highlight: 'no-such-row' });
    assert.equal(m.rows()[0].active, true, 'an unknown highlight falls back to the first row');
  });

  test('menu: open({query}) opens already searched', () => {
    const m = makeMenu();
    m.menu.open({ query: 'write' });
    assert.equal(m.q('.graph-add-search').value, 'write');
    assert.deepEqual(m.rows().slice(0, 4).map((r) => r.entry).sort(), ['write-html', 'write-p5', 'write-svg', 'write-three']);
  });

  test('menu: kept whole inside the canvas — flips left/up at the far edges, clamps near the near ones', () => {
    const m = makeMenu();
    m.host.clientWidth = 800;
    m.host.clientHeight = 600;
    m.menu.el.offsetWidth = 372;
    m.menu.el.offsetHeight = 400;
    m.menu.open({ screen: { x: 100, y: 50 } });
    assert.equal(m.menu.el.style.left, '100px', 'room to the right and below: opens at the point');
    assert.equal(m.menu.el.style.top, '50px');
    assert.equal(m.menu.el.style.height, '', 'hanging down, the menu shrinks to what a search finds');
    assert.equal(m.menu.el.style.maxHeight, '520px', 'and grows no further than the cap or the room below');
    m.menu.open({ screen: { x: 700, y: 500 } });
    assert.equal(m.menu.el.style.left, `${700 - 372}px`, 'past the right edge: opens to the left of the point');
    assert.equal(m.menu.el.style.top, `${500 - 400}px`, 'past the bottom: opens above the point');
    assert.equal(m.menu.el.style.height, '400px', 'lifted, its height is fixed, so typing never moves the search box');
    m.menu.open({ screen: { x: 100, y: 150 } });
    assert.equal(m.menu.el.style.top, '150px');
    assert.equal(m.menu.el.style.height, '', 'a reopen starts from a clean height');
    assert.equal(m.menu.el.style.maxHeight, `${600 - 8 - 150}px`, 'the room below the point caps it');
    m.menu.open({ screen: { x: 780, y: 300 } });
    assert.equal(m.menu.el.style.left, `${780 - 372}px`);
    assert.equal(m.menu.el.style.top, `${600 - 400 - 8}px`, 'no room above or below: clamped inside');
    m.menu.open({ screen: { x: -40, y: -40 } });
    assert.equal(m.menu.el.style.left, '8px');
    assert.equal(m.menu.el.style.top, '8px');
    // a short canvas caps the menu's height
    m.host.clientHeight = 300;
    m.menu.el.offsetHeight = 520;
    m.menu.open({ screen: { x: 10, y: 10 } });
    assert.equal(m.menu.el.style.maxHeight, `${300 - 16}px`);
    assert.equal(m.menu.el.style.height, `${300 - 16}px`);
    assert.equal(m.menu.el.style.top, '8px');
  });

  test('menu: destroy removes the menu and its document listener', () => {
    const m = makeMenu();
    assert.equal(m.doc.listeners('pointerdown'), 1);
    m.menu.destroy();
    assert.equal(m.doc.listeners('pointerdown'), 0);
    assert.equal(m.host.querySelector('.graph-add-menu'), null);
  });

  // ---------------------------------------------------------------- the first-run offer
  /** A minimal app for welcome.install, with doors that record what they were asked. */
  function fakeApp(doc, /** @type {any} */ opts = {}) {
    /** @type {any[]} */ const calls = [];
    /** @type {any} */ let parts = opts.parts || [];
    /** @type {Function[]} */ const listeners = [];
    const app = {
      els: { canvas: doc.createElement('div') },
      host: {
        session: {
          docId: () => (opts.noDoc ? null : 'd1'),
          doc: () => ({ parts }),
          on: (/** @type {Function} */ fn) => { listeners.push(fn); return () => {}; },
        },
        canvas: opts.noCanvas ? null : {
          openPalette: (/** @type {any} */ o) => { calls.push(['openPalette', o]); return true; },
          placeEntry: (/** @type {any} */ e, /** @type {any} */ at) => { calls.push(['placeEntry', e.entry, at, e.settings]); parts = [...parts, { id: 'x' }]; for (const fn of listeners) fn({ type: 'doc' }); return 'x'; },
        },
      },
      tutorial: opts.noTutorial ? undefined : {
        has: (/** @type {string} */ id) => id === 'l00-tour' && !opts.noTour,
        templates: () => (opts.noTemplates ? [] : [{ id: 't-research' }]),
        open: (/** @type {string} */ id) => { calls.push(['open', id]); return Promise.resolve('d2'); },
        showShelf: (/** @type {string} */ which) => { calls.push(['showShelf', which]); },
      },
    };
    return { app, calls, setParts: (/** @type {any[]} */ p) => { parts = p; for (const fn of listeners) fn({ type: 'part' }); } };
  }

  /** Run `fn` with the shim installed as globalThis.document (welcome.mjs builds with it). */
  async function withDom(/** @type {Function} */ fn) {
    const doc = shimDoc();
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
    const prev = /** @type {any} */ (globalThis).document;
    /** @type {any} */ (globalThis).document = doc;
    try { return await fn(doc); } finally {
      if (had) /** @type {any} */ (globalThis).document = prev;
      else delete (/** @type {any} */ (globalThis).document);
    }
  }

  const visible = (/** @type {any} */ panel, /** @type {string} */ sel) => panel.querySelectorAll(sel).filter((/** @type {any} */ b) => !b.hidden);

  test('welcome: an empty canvas offers the tour, a template and the ＋ menu, plus quick picks', () => withDom((/** @type {any} */ doc) => {
    const { app, calls } = fakeApp(doc);
    installWelcome(app);
    const panel = app.els.canvas.querySelector('.comp-welcome');
    assert.ok(panel, 'the panel lives inside the canvas mount');
    assert.equal(panel.hidden, false);
    assert.equal(/** @type {any} */ (app).welcome.shown(), true);
    assert.deepEqual(visible(panel, '.comp-welcome-btn').map((/** @type {any} */ b) => b.getAttribute('data-action')), ['tour', 'template', 'add']);
    assert.deepEqual(/** @type {any} */ (app).welcome.debug().picks, [...PICKS]);
    assert.ok(panel.querySelector('.comp-welcome-tip').textContent.length > 10, 'the double-click tip is on screen');

    panel.querySelector('.comp-welcome-btn[data-action="tour"]').dispatchEvent({ type: 'click' });
    panel.querySelector('.comp-welcome-btn[data-action="template"]').dispatchEvent({ type: 'click' });
    panel.querySelector('.comp-welcome-btn[data-action="add"]').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls.slice(0, 3), [['open', 'l00-tour'], ['showShelf', 'templates'], ['openPalette', {}]]);
  }));

  test('welcome: a quick pick places that box through the menu\'s own placeEntry, and the offer steps aside', () => withDom((/** @type {any} */ doc) => {
    const { app, calls } = fakeApp(doc);
    installWelcome(app);
    const panel = app.els.canvas.querySelector('.comp-welcome');
    panel.querySelector('.comp-welcome-pick[data-entry="p5"]').dispatchEvent({ type: 'click' });
    const [what, entry, at, settings] = calls[0];
    assert.equal(what, 'placeEntry');
    assert.equal(entry, 'p5');
    assert.equal(at, null, 'the middle of the view');
    assert.equal(settings.mode, 'p5', 'the preset, with its settings');
    assert.equal(panel.hidden, true, 'a canvas with a box has no offer');
    assert.equal(/** @type {any} */ (app).welcome.shown(), false);
  }));

  test('welcome: shows only while the open document is empty, and comes back when it is again', () => withDom((/** @type {any} */ doc) => {
    const { app, setParts } = fakeApp(doc, { parts: [{ id: 'a' }] });
    installWelcome(app);
    assert.equal(/** @type {any} */ (app).welcome.shown(), false);
    setParts([]);
    assert.equal(/** @type {any} */ (app).welcome.shown(), true);
    setParts([{ id: 'b' }]);
    assert.equal(/** @type {any} */ (app).welcome.shown(), false);
    const noDoc = fakeApp(doc, { noDoc: true });
    installWelcome(noDoc.app);
    assert.equal(/** @type {any} */ (noDoc.app).welcome.shown(), false, 'no document open: nothing to welcome to');
  }));

  test('welcome: a button whose door is missing is hidden, never dead', () => withDom((/** @type {any} */ doc) => {
    const a = fakeApp(doc, { noTutorial: true });
    installWelcome(a.app);
    assert.deepEqual(/** @type {any} */ (a.app).welcome.debug().actions, ['add']);
    const b = fakeApp(doc, { noTour: true, noTemplates: true });
    installWelcome(b.app);
    assert.deepEqual(/** @type {any} */ (b.app).welcome.debug().actions, ['add']);
    const c = fakeApp(doc, { noCanvas: true });
    installWelcome(c.app);
    assert.deepEqual(/** @type {any} */ (c.app).welcome.debug().actions, ['tour', 'template']);
    assert.deepEqual(/** @type {any} */ (c.app).welcome.debug().picks, [], 'no canvas: no quick picks either');
  }));
};
