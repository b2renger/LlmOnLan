// Critic S1, Package B: the canvas and the lessons. The PURE half — where a wire dropped on a
// box's body plugs in (S1-5), the least pan that brings a tabbed-to box on screen (S1-9), which
// key is Ctrl+0 on any layout (S1-15) — and the lesson words that name the canvas's own controls
// (S1-5, S1-6, S1-12). The real-input half is the harness's k10-canvas-lessons.

import assert from 'node:assert/strict';
import * as model from '../../../renderer/chat/graph/model.mjs';
import { bodyDropPort, panToShow, isZoomResetKey } from '../../../renderer/chat/graph/canvas.mjs';
import { lessonById } from '../../../renderer/chat/computer/tutorial/registry.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';
import '../../../renderer/chat/strings/graph.en.mjs';
import '../../../renderer/chat/strings/computer-canvas.en.mjs';
import { specs, ids, clock } from './graph-fixture.mjs';

/** The fixture's parts, plus a box with three inputs: image-only, text, text. */
const map = specs({
  triple: {
    type: 'triple', label: 'Triple', output: 'text',
    inputs: [
      { name: 'pic', label: 'Picture', accepts: ['image'] },
      { name: 'first', label: 'First', accepts: ['text'], many: true },
      { name: 'second', label: 'Second', accepts: ['text'], many: true },
    ],
    defaults: () => ({}),
  },
});

function docWith(/** @type {string[]} */ types) {
  const newId = ids('p');
  const now = clock();
  let doc = model.createDoc({ id: 'g1', threadId: null, now });
  /** @type {string[]} */ const out = [];
  for (const type of types) {
    const r = model.addPart(doc, { type, x: 0, y: 0 }, { specs: map, newId, now });
    doc = r.doc;
    out.push(r.part.id);
  }
  const wid = ids('w');
  const wire = (/** @type {string} */ from, /** @type {string} */ to, /** @type {string} */ port) => {
    const r = model.addWire(doc, { from, to, port }, { specs: map, newId: wid, now });
    if (!r.ok) throw new Error(`fixture wire refused: ${r.reason}`);
    doc = r.doc;
  };
  return { get doc() { return doc; }, ids: out, wire };
}

export default (/** @type {any} */ test) => {
  // ---- S1-5: a drop on a box's body -------------------------------------------------------------

  test('S1-5 bodyDropPort: a drop on an Instruction plugs into its one input', () => {
    const g = docWith(['note', 'ask']);
    const [note, ask] = g.ids;
    assert.deepEqual(bodyDropPort(g.doc, note, ask, map), { port: 'in', reason: null });
  });

  test('S1-5 bodyDropPort: the FIRST input that is free and takes the kind — a busy one comes after', () => {
    const g = docWith(['note', 'note', 'triple']);
    const [a, b, box] = g.ids;
    assert.deepEqual(bodyDropPort(g.doc, a, box, map), { port: 'first', reason: null },
      'the image-only input is skipped: it would refuse text');
    g.wire(a, box, 'first');
    assert.deepEqual(bodyDropPort(g.doc, b, box, map), { port: 'second', reason: null },
      'with `first` holding a wire, the free `second` wins');
    g.wire(b, box, 'second');
    const c = model.addPart(g.doc, { type: 'note', x: 0, y: 0 }, { specs: map, newId: ids('q'), now: clock() });
    assert.deepEqual(bodyDropPort(c.doc, c.part.id, box, map), { port: 'first', reason: null },
      'every input busy: the first that still takes one more wire');
  });

  test('S1-5 bodyDropPort: a box that cannot take the wire says why, in addWire\'s own reason', () => {
    const lists = docWith(['lister', 'lister', 'collect']);
    const [l1, l2, collect] = lists.ids;
    assert.deepEqual(bodyDropPort(lists.doc, l1, collect, map), { port: 'items', reason: null });
    lists.wire(l1, collect, 'items');
    assert.deepEqual(bodyDropPort(lists.doc, l2, collect, map), { port: null, reason: 'duplicate' },
      'a one-wire input that is taken is not free');
    const look = docWith(['note', 'looker']);
    assert.deepEqual(bodyDropPort(look.doc, look.ids[0], look.ids[1], map), { port: null, reason: 'type' });
    const two = docWith(['note', 'note']);
    assert.deepEqual(bodyDropPort(two.doc, two.ids[0], two.ids[1], map), { port: null, reason: 'no-input' },
      'a box with no input dot takes nothing');
    assert.deepEqual(bodyDropPort(two.doc, two.ids[0], 'gone', map), { port: null, reason: 'no-input' });
    const self = docWith(['ask']);
    assert.deepEqual(bodyDropPort(self.doc, self.ids[0], self.ids[0], map), { port: null, reason: 'self' });
  });

  test('S1-5 bodyDropPort: it asks the model and changes nothing', () => {
    const g = docWith(['note', 'ask']);
    const before = JSON.stringify(g.doc);
    bodyDropPort(g.doc, g.ids[0], g.ids[1], map);
    assert.equal(JSON.stringify(g.doc), before);
  });

  // ---- S1-9: Tab brings the box on screen --------------------------------------------------------

  test('S1-9 panToShow: a box already on screen needs no pan', () => {
    assert.equal(panToShow({ x: 0, y: 0, zoom: 1 }, { x: 40, y: 40, w: 200, h: 100 }, { w: 1000, h: 700 }), null);
  });

  test('S1-9 panToShow: the LEAST pan that brings an off-screen box in, at the same zoom', () => {
    const v = panToShow({ x: 0, y: 0, zoom: 1 }, { x: 3000, y: 2000, w: 200, h: 100 }, { w: 1000, h: 700 });
    assert.deepEqual(v, { x: 1000 - 24 - 3200, y: 700 - 24 - 2100, zoom: 1 }, 'its far corner lands 24 px inside');
    const left = panToShow({ x: -500, y: 0, zoom: 0.5 }, { x: 100, y: 100, w: 200, h: 100 }, { w: 1000, h: 700 });
    assert.deepEqual(left, { x: -500 + (24 - (100 * 0.5 - 500)), y: 0, zoom: 0.5 }, 'from the left, zoom kept');
  });

  test('S1-9 panToShow: a box bigger than the view shows its top-left corner', () => {
    const v = panToShow({ x: 0, y: 0, zoom: 1 }, { x: 2000, y: 50, w: 1500, h: 100 }, { w: 1000, h: 700 });
    assert.deepEqual(v, { x: 24 - 2000, y: 0, zoom: 1 });
  });

  // ---- S1-15: Ctrl+0 by where the key is ---------------------------------------------------------

  test('S1-15 isZoomResetKey: Ctrl+0 by the key\'s place — AZERTY\'s `à` counts, the character alone does not decide', () => {
    assert.equal(isZoomResetKey({ key: 'à', code: 'Digit0', ctrlKey: true }), true, 'AZERTY: the 0 key reports à');
    assert.equal(isZoomResetKey({ key: '0', code: 'Digit0', ctrlKey: true }), true, 'QWERTY');
    assert.equal(isZoomResetKey({ key: '0', code: 'Digit0', metaKey: true }), true, 'Cmd+0 on a Mac');
    assert.equal(isZoomResetKey({ key: '0', code: 'Numpad0', ctrlKey: true }), true, 'the numpad');
    assert.equal(isZoomResetKey({ key: '0', ctrlKey: true }), true, 'a synthetic event with no code still works');
    assert.equal(isZoomResetKey({ key: '0', code: 'Digit0' }), false, 'no Ctrl, no zoom');
    assert.equal(isZoomResetKey({ key: '0', code: 'Digit0', ctrlKey: true, altKey: true }), false, 'AltGr+0 types a character');
    assert.equal(isZoomResetKey({ key: '0', code: 'Digit9', ctrlKey: true }), false, 'a layout that puts 0 elsewhere: the place decides');
  });

  // ---- the lessons say what the canvas does ------------------------------------------------------

  test('S1-5: the wiring steps name the box AND its left dot, and both are now true', () => {
    const l2 = lessonById('l02-wires').steps.find((s) => s.id === 's1');
    const l4 = lessonById('l04-draw').steps.find((s) => s.id === 's4');
    assert.match(String(l2 && l2.text), /onto the Instruction \(its left dot\)/);
    assert.match(String(l4 && l4.text), /onto the SVG box \(its left dot\)/);
    assert.ok(t('graph.wireDropNowhere').length > 10 && !/\{/.test(t('graph.wireDropNowhere')));
  });

  test('S1-6: lesson 3 points at the tag the canvas really draws, never at "click the arrow and type"', () => {
    const lesson = lessonById('l03-labels');
    const tag = `“${t('graph.wireNameMe')}”`;
    const s2 = lesson.steps.find((s) => s.id === 's2');
    assert.ok(String(s2 && s2.text).includes(tag), `s2 names the ${tag} tag: ${s2 && s2.text}`);
    assert.match(String(s2 && s2.text), /F2/, 'and the keyboard way');
    const sticky = lesson.doc.parts.find((p) => p.id === 'n_try');
    assert.ok(String(sticky && sticky.settings.text).includes(tag), 'the sticky beside the box says the same');
    for (const s of lesson.steps) assert.doesNotMatch(s.text, /click (the|an) arrow/i, `${s.id}: ${s.text}`);
  });

  test('S1-12: lesson 2\'s last step says how to finish it with no farm', () => {
    const s4 = lessonById('l02-wires').steps.find((s) => s.id === 's4');
    assert.match(String(s4 && s4.hint), /No farm\?.*saved answer.*▶ on the title/);
  });

  test('S1-11: the file button that replaces the open graph is called what it does', () => {
    assert.equal(t('graph.replaceFromFile'), 'Replace from file…');
    assert.match(t('graph.replaceBody', { count: 4 }), /This graph already has 4 boxes/);
    assert.match(t('graph.replaceBody', { count: 1 }), /1 box\./);
    assert.doesNotMatch(t('graph.replaceBody', { count: 4 }), /conversation/i);
    assert.match(t('graph.replaceFromFileHint'), /Import… in the library/);
  });
};
