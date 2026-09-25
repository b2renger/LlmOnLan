// @ts-check
// COMPUTER_LIVE_PLAN, Builder E: hand-editing and the model's instructions.
//
//   - computer/code-edit.mjs, PURE: the line-number gutter's model, the caret readout, and what
//     Tab / Shift+Tab / Enter do to the text (an edit the drawer hands to the browser's insertText);
//   - computer/drawer.mjs `editCode` (K-8) under the unit runner's DOM shim: the panel, onChange
//     debounced and never lost, Run code delivering the text BEFORE onRun, setError with its line,
//     setSource never echoing, one editor at a time, and every way an editor ends;
//   - the starters and a model's answer that call `lol.orbit` (K-7, stubbed here) run through the
//     same unfence → shapeForGuest path the Preview uses, and the p5 starter answers the mouse;
//   - the system messages tell the model about lol.orbit and the mouse, and stay short.
// Real input (a person's keys and clicks in the real window) is k11-edit-* in the harness.

import assert from 'node:assert/strict';
import vm from 'node:vm';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import {
  INDENT, lineCount, gutterModel, gutterPatch, caretAt, tabEdit, newlineEdit, applyEdit, scrollForLine,
} from '../../../renderer/chat/computer/code-edit.mjs';
import {
  install as installDrawer, CODE_PANEL, CODE_WIDTH, CODE_CHANGE_MS, DRAWER_DEFAULT,
} from '../../../renderer/chat/computer/drawer.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';
import { STARTER } from '../../../renderer/chat/graph/parts/creative.mjs';
import { codeFor, shapeForGuest, syntaxLine, explainGuestError } from '../../../renderer/chat/graph/unfence.mjs';
import '../../../renderer/chat/strings/computer.en.mjs';
import '../../../renderer/chat/strings/computer-edit.en.mjs';
import '../../../renderer/chat/strings/computer-gen.en.mjs';

const NL = '\n';
const lines = (/** @type {string[]} */ a) => a.join(NL);
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// the DOM shim, and the drawer on it
// ---------------------------------------------------------------------------------------------

/** Run `fn` with the unit runner's DOM shim as `globalThis.document` (and a bare `window`). */
async function withDom(/** @type {(doc: any) => any} */ fn) {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = doc;
  const hadWin = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prevWin = /** @type {any} */ (globalThis).window;
  /** @type {any} */ (globalThis).window = { addEventListener() {}, removeEventListener() {} };
  try { return await fn(doc); } finally {
    if (had) /** @type {any} */ (globalThis).document = prev;
    else delete (/** @type {any} */ (globalThis).document);
    if (hadWin) /** @type {any} */ (globalThis).window = prevWin;
    else delete (/** @type {any} */ (globalThis).window);
  }
}

/** The Computer's skeleton, with the drawer installed. */
function drawerApp() {
  const root = document.createElement('div');
  root.id = 'lolcomputer';
  const drawer = document.createElement('div');
  drawer.className = 'comp-drawer';
  root.appendChild(drawer);
  const app = /** @type {any} */ ({ els: { root, drawer }, repo: null, host: null });
  installDrawer(app);
  return { app, drawer };
}

/** An editCode call that records what it was told. */
function recorder() {
  const log = /** @type {{changes: string[], runs: number, closes: number, order: string[]}} */ ({ changes: [], runs: 0, closes: 0, order: [] });
  return {
    log,
    onChange: (/** @type {string} */ text) => { log.changes.push(text); log.order.push('change'); },
    onRun: () => { log.runs++; log.order.push('run'); },
    onClose: () => { log.closes++; log.order.push('close'); },
  };
}

/** "Type" into the shim's textarea: set the value, raise input (the shim has no bubbling). */
function typeInto(/** @type {any} */ area, /** @type {string} */ text) {
  area.value = text;
  area.dispatchEvent({ type: 'input' });
}

/** A keydown as the shim dispatches one. */
function keydown(/** @type {string} */ key, /** @type {any} */ o = {}) {
  const ev = /** @type {any} */ ({
    type: 'keydown', key, prevented: false, stopped: false, ...o,
    preventDefault() { ev.prevented = true; },
    stopPropagation() { ev.stopped = true; },
  });
  return ev;
}

// ---------------------------------------------------------------------------------------------
// the guest, in Node (the same shapes computer-creative.test.mjs uses)
// ---------------------------------------------------------------------------------------------

/** Run shaped guest code the way sandbox/runner.html does: strict, with `lol` as a parameter. */
function runInGuest(/** @type {string} */ code, /** @type {any} */ win, /** @type {any} */ lol) {
  win.window = win;
  const context = vm.createContext(win);
  const fn = vm.compileFunction(`"use strict";${NL}${code}`, ['lol'], { parsingContext: context });
  return fn(lol);
}

function fakeThree() {
  const made = { renderers: /** @type {any[]} */ ([]), renders: 0, cameras: /** @type {any[]} */ ([]) };
  class Obj {
    constructor() {
      this.position = { x: 0, y: 0, z: 0, set() {} };
      this.rotation = { x: 0, y: 0, z: 0, set() {} };
    }
    add() {}
  }
  class PerspectiveCamera extends Obj {
    constructor() { super(); made.cameras.push(this); }
  }
  class Vector3 { constructor() { this.x = 0; this.y = 0; this.z = 0; } set() { return this; } }
  class WebGLRenderer {
    constructor(/** @type {any} */ o) {
      this.opts = o || {};
      this.domElement = this.opts.canvas || { tag: 'canvas', parentNode: null };
      made.renderers.push(this);
    }
    setSize() {}
    setPixelRatio() {}
    render() { made.renders++; }
  }
  const THREE = {
    Scene: Obj, Color: class {}, PerspectiveCamera, Mesh: Obj, BoxGeometry: class {}, IcosahedronGeometry: class {},
    TorusKnotGeometry: class {}, MeshNormalMaterial: class {}, MeshStandardMaterial: class {},
    AmbientLight: Obj, DirectionalLight: Obj, Group: Obj, Vector3, WebGLRenderer,
  };
  return { THREE, made };
}

function fakeRoot() {
  const root = {
    children: /** @type {any[]} */ ([]),
    insertBefore(/** @type {any} */ el) { el.parentNode = root; root.children.unshift(el); return el; },
    appendChild(/** @type {any} */ el) { el.parentNode = root; root.children.push(el); return el; },
  };
  const canvas = { tag: 'canvas', parentNode: root };
  root.children.push(canvas);
  const body = { appendChild(/** @type {any} */ el) { el.parentNode = body; return el; } };
  return { root, canvas, body };
}

/** `lol.orbit` as K-7 describes it, recorded: {target, update(), dispose()}. */
function fakeOrbit(/** @type {any} */ THREE) {
  const calls = /** @type {{cams: any[], opts: any[], updates: number, disposed: number}} */ ({ cams: [], opts: [], updates: 0, disposed: 0 });
  const orbit = (/** @type {any} */ cam, /** @type {any} */ opts) => {
    calls.cams.push(cam);
    calls.opts.push(opts);
    return { target: new THREE.Vector3(), update() { calls.updates++; }, dispose() { calls.disposed++; } };
  };
  return { orbit, calls };
}

/** p5 global mode, just enough to run the starter and watch where the ball is drawn. */
function fakeP5() {
  /** @type {{x: number, y: number}[]} */ const circles = [];
  const win = /** @type {any} */ ({
    width: 400, height: 300, mouseX: 0, mouseY: 0, mouseIsPressed: false, circles,
    createCanvas(/** @type {number} */ w, /** @type {number} */ h) { win.width = w; win.height = h; },
    noStroke() {}, background() {}, fill() {},
    constrain: (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v)),
    circle(/** @type {number} */ x, /** @type {number} */ y) { circles.push({ x, y }); },
    isLooping: () => true,
  });
  return win;
}

export default (/** @type {any} */ test) => {
  // ------------------------------------------------------------------- the gutter's model

  test('the gutter model: one row per line the textarea shows, never one short, the error marked in range', () => {
    assert.equal(lineCount(''), 1, 'an empty field is one empty line');
    assert.equal(lineCount('a'), 1);
    assert.equal(lineCount('a\nb'), 2);
    assert.equal(lineCount('a\nb\n'), 3, 'a trailing newline starts a line the caret can be on');
    assert.equal(lineCount(null), 1);
    assert.deepEqual(gutterModel('a\nb\nc', 2), { count: 3, digits: 2, error: 2 });
    assert.deepEqual(gutterModel('a\nb', 7), { count: 2, digits: 2, error: 0 }, 'an error past the end marks nothing');
    assert.deepEqual(gutterModel('x', 0), { count: 1, digits: 2, error: 0 });
    assert.equal(gutterModel('x\n'.repeat(99)).digits, 3, '100 lines: the column is three digits wide');
    assert.equal(gutterModel('x\n'.repeat(8)).digits, 2, 'and at least two, so 9 → 10 lines does not jump');
    assert.equal(lineCount(STARTER.three), STARTER.three.split(NL).length, 'the starter, counted as the editor shows it');
  });

  test('the gutter patch: typing inside a line rebuilds nothing; lines come and go at the end', () => {
    assert.deepEqual(gutterPatch(10, 10), { add: [], drop: 0 });
    assert.deepEqual(gutterPatch(3, 5), { add: [4, 5], drop: 0 });
    assert.deepEqual(gutterPatch(5, 2), { add: [], drop: 3 });
    assert.deepEqual(gutterPatch(0, 3), { add: [1, 2, 3], drop: 0 }, 'the first render');
  });

  test('the caret readout counts as a person does: line and column from 1', () => {
    const s = lines(['ab', 'cde', '']);
    assert.deepEqual(caretAt(s, 0), { line: 1, col: 1 });
    assert.deepEqual(caretAt(s, 2), { line: 1, col: 3 }, 'at the end of line 1');
    assert.deepEqual(caretAt(s, 3), { line: 2, col: 1 });
    assert.deepEqual(caretAt(s, 7), { line: 3, col: 1 }, 'the empty last line');
    assert.deepEqual(caretAt(s, 99), { line: 3, col: 1 }, 'an offset past the end is the end');
    assert.deepEqual(caretAt('x', -4), { line: 1, col: 1 });
  });

  // ------------------------------------------------------------------------------ Tab and Enter

  test('Tab types spaces to the next indent stop, replacing a one-line selection', () => {
    assert.equal(INDENT, '  ');
    const e = tabEdit('ab', 0, 0);
    assert.deepEqual(e, { from: 0, to: 0, insert: '  ', selStart: 2, selEnd: 2 });
    assert.equal(applyEdit('ab', /** @type {any} */ (e)), '  ab');
    assert.equal(/** @type {any} */ (tabEdit('abc', 1, 1)).insert, ' ', 'from column 2, one space reaches the stop');
    const sel = /** @type {any} */ (tabEdit('let x = 10;', 8, 10));
    assert.equal(applyEdit('let x = 10;', sel), 'let x =   ;', 'the selected "10" (from column 9) is replaced by the two spaces to the stop');
    assert.equal(sel.selStart, sel.selEnd, 'and the caret lands after it');
  });

  test('Tab across lines indents every line it touches, skips empty ones, and keeps the block selected', () => {
    const s = lines(['a', '', 'b', 'c']);
    // select from inside "a" to inside "b"
    const e = /** @type {any} */ (tabEdit(s, 0, 4));
    const out = applyEdit(s, e);
    assert.equal(out, lines(['  a', '', '  b', 'c']), 'a and b indented, the empty line left empty, c untouched');
    assert.equal(out.slice(e.selStart, e.selEnd), lines(['  a', '', '  b']), 'the whole block stays selected');
    // a second Tab on that selection indents again
    const again = applyEdit(out, /** @type {any} */ (tabEdit(out, e.selStart, e.selEnd)));
    assert.equal(again, lines(['    a', '', '    b', 'c']));
    // a selection that ends at the start of a line does not touch that line
    const two = lines(['x', 'y', 'z']);
    const stop = /** @type {any} */ (tabEdit(two, 0, 4));   // "x\ny\n" — ends at z's column 1
    assert.equal(applyEdit(two, stop), lines(['  x', '  y', 'z']), 'the line the person sees as unselected is not moved');
  });

  test('Shift+Tab takes one indent off, keeps a caret on its character, and does nothing to an unindented line', () => {
    const s = lines(['function f() {', '    x();', '}']);
    const caret = s.indexOf('x();') + 2;                 // between "x(" and ");"
    const e = /** @type {any} */ (tabEdit(s, caret, caret, true));
    const out = applyEdit(s, e);
    assert.equal(out, lines(['function f() {', '  x();', '}']), 'one indent (two spaces) came off');
    assert.equal(out.slice(e.selStart, e.selStart + 2), ');', 'the caret stayed on the same character');
    assert.equal(tabEdit('abc', 1, 1, true), null, 'nothing to outdent: no edit at all');
    assert.equal(applyEdit('\tx', /** @type {any} */ (tabEdit('\tx', 0, 0, true))), 'x', 'a tab character counts as one indent');
    const block = lines(['  a', '    b', 'c']);
    const bo = /** @type {any} */ (tabEdit(block, 0, block.length, true));
    assert.equal(applyEdit(block, bo), lines(['a', '  b', 'c']), 'a block: each line loses at most one indent');
    // a caret inside the indentation does not slide onto the previous line
    const inside = /** @type {any} */ (tabEdit(lines(['x', '  y']), 3, 3, true));
    assert.equal(inside.selStart, 2, 'it stops at the start of its own line');
  });

  test('Enter keeps the indentation, one deeper after an opening bracket', () => {
    const s = lines(['function draw() {', '  background(0);']);
    const atBrace = s.indexOf('{') + 1;
    const e = newlineEdit(s, atBrace, atBrace);
    assert.equal(e.insert, '\n  ', 'inside a new block: one indent');
    const end = s.length;
    assert.equal(newlineEdit(s, end, end).insert, '\n  ', 'after an indented line: the same indent');
    assert.equal(newlineEdit('  foo(', 6, 6).insert, '\n    ', 'after an open ( : one deeper than the line');
    assert.equal(newlineEdit('  x', 1, 1).insert, '\n ', 'a caret inside the indentation keeps only what is left of it');
    assert.equal(newlineEdit('abc', 1, 2).from, 1, 'a selection is replaced');
    assert.equal(newlineEdit('abc', 1, 2).to, 2);
    const e2 = newlineEdit('a', 1, 1);
    assert.equal(e2.selStart, 2, 'the caret lands at the end of what was inserted');
  });

  test('scrollForLine: nothing when the line is in view, otherwise it lands a third of the way down', () => {
    assert.equal(scrollForLine({ line: 3, lineHeight: 18, pad: 8, scrollTop: 0, height: 360 }), null);
    const to = scrollForLine({ line: 100, lineHeight: 18, pad: 8, scrollTop: 0, height: 360 });
    assert.equal(to, Math.round(99 * 18 + 8 - 120));
    assert.equal(scrollForLine({ line: 1, lineHeight: 18, pad: 8, scrollTop: 500, height: 360 }), 0, 'back up to the top');
  });

  // --------------------------------------------------------------------------- the drawer editor

  test('editCode opens a panel in the drawer with the box’s code, a gutter row per line, and Run code', async () => {
    await withDom(() => {
      const { app, drawer } = drawerApp();
      assert.equal(typeof app.drawer.editCode, 'function', 'K-8 is published');
      const r = recorder();
      const h = app.drawer.editCode({ partId: 'p1', title: 'three.js scene', mode: 'three', source: STARTER.three, ...r });
      assert.equal(app.drawer.isOpen(), true, 'the drawer opened');
      assert.equal(app.drawer.panel(), CODE_PANEL, 'as the code panel');
      assert.equal(app.drawer.editing(), 'p1');
      const panel = drawer.querySelector('.comp-code');
      assert.ok(panel && !panel.classList.contains('hidden'));
      assert.equal(panel.getAttribute('data-mode'), 'three');
      const area = drawer.querySelector('.comp-code-area');
      assert.equal(area.value, STARTER.three, 'the box’s own source');
      assert.equal(area.getAttribute('wrap'), 'off', 'no soft wrap: line N of the gutter is line N of the code');
      assert.equal(drawer.querySelectorAll('.comp-code-ln').length, lineCount(STARTER.three), 'one number per line');
      assert.equal(drawer.querySelector('.comp-code-ln').textContent, '1');
      assert.equal(drawer.querySelector('.comp-code-run').textContent, t('computer.codeRun'));
      assert.equal(drawer.querySelector('.comp-code-title').textContent, t('computer.codeTitle', { title: 'three.js scene' }));
      assert.equal(drawer.querySelector('.comp-code-caret').textContent, t('computer.codeCaret', { line: 1, col: 1 }));
      assert.equal(drawer.querySelector('.comp-code-gutter').getAttribute('aria-hidden'), 'true', 'the numbers are not read aloud');
      assert.equal(app.drawer.width(), CODE_WIDTH, 'code gets a wider column');
      assert.equal(h.isOpen(), true);
      assert.equal(r.log.changes.length, 0, 'opening is not a change');
    });
  });

  test('typing reaches onChange once, debounced, with the latest text; Run code delivers it BEFORE onRun', async () => {
    await withDom(async () => {
      const { app, drawer } = drawerApp();
      const r = recorder();
      app.drawer.editCode({ partId: 'p1', title: 'p5.js sketch', mode: 'p5', source: 'a', ...r });
      const area = drawer.querySelector('.comp-code-area');
      typeInto(area, 'ab');
      typeInto(area, 'abc\nd');
      assert.equal(r.log.changes.length, 0, 'not on every keystroke');
      assert.equal(drawer.querySelectorAll('.comp-code-ln').length, 2, 'but the gutter follows at once');
      await sleep(CODE_CHANGE_MS + 60);
      assert.deepEqual(r.log.changes, ['abc\nd'], 'one call, the latest text');

      typeInto(area, 'abc\nde');
      drawer.querySelector('.comp-code-run').dispatchEvent({ type: 'click', preventDefault() {} });
      assert.deepEqual(r.log.order, ['change', 'change', 'run'], 'the pending text first, then the run');
      assert.equal(r.log.changes[1], 'abc\nde');
      await sleep(CODE_CHANGE_MS + 60);
      assert.equal(r.log.changes.length, 2, 'and the timer does not send it a second time');

      // Ctrl+Enter is Run code, and it stops there
      typeInto(area, 'abc\ndef');
      const ev = keydown('Enter', { ctrlKey: true });
      area.dispatchEvent(ev);
      assert.equal(ev.prevented, true, 'no newline is typed');
      assert.equal(ev.stopped, true, 'and nothing behind the drawer hears it');
      assert.deepEqual(r.log.order.slice(-2), ['change', 'run']);
      assert.equal(r.log.runs, 2);
      // a blur delivers what is pending too
      typeInto(area, 'abc\ndefg');
      area.dispatchEvent({ type: 'blur' });
      assert.equal(r.log.changes[r.log.changes.length - 1], 'abc\ndefg');
    });
  });

  test('setError shows the message, marks the line and offers Go to line; null clears it', async () => {
    await withDom(() => {
      const { app, drawer } = drawerApp();
      const h = app.drawer.editCode({ partId: 'p1', title: 'x', mode: 'p5', source: lines(['a', 'b', 'c', 'd']), ...recorder() });
      const fault = drawer.querySelector('.comp-code-error');
      assert.equal(fault.hidden, true, 'no error to start with');
      assert.equal(h.setError({ line: 3, message: 'boom is not defined' }), true);
      assert.equal(fault.hidden, false);
      assert.equal(drawer.querySelector('.comp-code-error-text').textContent, 'boom is not defined');
      const go = drawer.querySelector('.comp-code-goto');
      assert.equal(go.hidden, false);
      assert.equal(go.textContent, t('computer.codeGoto', { line: 3 }));
      assert.equal(go.getAttribute('data-line'), '3');
      const rows = drawer.querySelectorAll('.comp-code-ln');
      assert.equal(rows[2].classList.contains('is-error'), true, 'row 3 is marked');
      assert.equal(rows[1].classList.contains('is-error'), false);
      assert.equal(drawer.querySelector('.comp-code-band').hidden, false, 'and the band shows behind the line');
      go.dispatchEvent({ type: 'click', preventDefault() {} });   // the shim has no selection: it must not throw

      h.setError({ line: 1, message: 'moved' });
      assert.equal(rows[2].classList.contains('is-error'), false, 'the old mark goes');
      assert.equal(rows[0].classList.contains('is-error'), true, 'the new one comes');

      h.setError({ line: 0, message: 'no line known' });
      assert.equal(go.hidden, true, 'no line, no jump');
      assert.equal(drawer.querySelector('.comp-code-band').hidden, true);
      assert.equal(fault.hidden, false, 'but the message still shows');

      h.setError(null);
      assert.equal(fault.hidden, true, 'null clears it');
      assert.equal(drawer.querySelectorAll('.comp-code-ln.is-error').length, 0);
    });
  });

  test('setSource is two-way without an echo, and keystrokes typed here are delivered first', async () => {
    await withDom(async () => {
      const { app, drawer } = drawerApp();
      const r = recorder();
      const h = app.drawer.editCode({ partId: 'p1', title: 'x', mode: 'svg', source: '<svg/>', ...r });
      const area = drawer.querySelector('.comp-code-area');
      assert.equal(h.setSource('<svg/>'), false, 'the same text: nothing to do');
      assert.equal(h.setSource('<svg>\n</svg>'), true);
      assert.equal(area.value, '<svg>\n</svg>');
      assert.equal(drawer.querySelectorAll('.comp-code-ln').length, 2, 'the gutter follows');
      await sleep(CODE_CHANGE_MS + 60);
      assert.equal(r.log.changes.length, 0, 'the box’s own text is never sent back to it');

      typeInto(area, 'mine');
      assert.equal(h.text(), 'mine', 'text() is what the field holds, typing not yet delivered included');
      // Critic L1-2: the pending typing reaches the box FIRST, and then the box holds the person's
      // text — so the text it offered is not written over it.
      assert.equal(h.setSource('theirs'), false, 'nothing overwritten after a flush that delivered');
      assert.deepEqual(r.log.changes, ['mine'], 'what was typed here reached the box');
      assert.equal(area.value, 'mine', 'and the typed text stays in the editor');
      // With nothing pending, the box's text lands as before.
      assert.equal(h.setSource('theirs'), true);
      assert.equal(area.value, 'theirs');
      assert.equal(h.text(), 'theirs');
      assert.deepEqual(r.log.changes, ['mine'], 'and it is not echoed back');
    });
  });

  test('one editor at a time, and every way it ends: a second editCode, a value, another panel, Close, Escape, close()', async () => {
    await withDom(() => {
      const { app, drawer } = drawerApp();
      const a = recorder();
      const first = app.drawer.editCode({ partId: 'p1', title: 'x', mode: 'p5', source: 'one', ...a });
      typeInto(drawer.querySelector('.comp-code-area'), 'one!');
      const b = recorder();
      const second = app.drawer.editCode({ partId: 'p2', title: 'y', mode: 'three', source: 'two', ...b });
      assert.deepEqual(a.log.changes, ['one!'], 'the first editor’s last keystrokes were delivered');
      assert.equal(a.log.closes, 1, 'and it was told it closed');
      assert.equal(first.isOpen(), false);
      assert.equal(first.setSource('late'), false, 'a closed handle is inert');
      assert.equal(first.setError({ line: 1, message: 'late' }), false);
      assert.equal(first.close(), false);
      assert.equal(drawer.querySelectorAll('.comp-code').length, 1, 'ONE editor in the drawer');
      assert.equal(drawer.querySelector('.comp-code-area').value, 'two');
      assert.equal(app.drawer.editing(), 'p2');

      // a value opened on the canvas replaces it
      app.drawer.open(valueOf('text', 'an answer'));
      assert.equal(b.log.closes, 1, 'opening a value ends the edit');
      assert.equal(second.isOpen(), false);
      assert.equal(drawer.querySelectorAll('.comp-code').length, 0, 'and takes its panel down');
      assert.equal(app.drawer.editing(), '');

      // another panel replaces it
      const c = recorder();
      const third = app.drawer.editCode({ partId: 'p3', title: 'z', mode: 'p5', source: 's', ...c });
      const other = document.createElement('div');
      app.drawer.mountPanel('transcript', other);
      app.drawer.showPanel('transcript');
      assert.equal(c.log.closes, 1, 'the transcript replaces the editor');
      assert.equal(third.isOpen(), false);

      // the drawer's Close button
      const d = recorder();
      app.drawer.editCode({ partId: 'p4', title: 'z', mode: 'p5', source: 's', ...d });
      drawer.querySelector('.comp-drawer-close').dispatchEvent({ type: 'click' });
      assert.equal(d.log.closes, 1);
      assert.equal(app.drawer.isOpen(), false);
      assert.equal(app.drawer.width(), DRAWER_DEFAULT, 'the widening is given back, not remembered');

      // Escape (the drawer's own handler)
      const e = recorder();
      app.drawer.editCode({ partId: 'p5', title: 'z', mode: 'p5', source: 's', ...e });
      const esc = keydown('Escape');
      drawer.dispatchEvent(esc);
      assert.equal(esc.prevented, true, 'Escape is consumed');
      assert.equal(e.log.closes, 1);
      assert.equal(app.drawer.isOpen(), false);

      // the handle's close()
      const f = recorder();
      const last = app.drawer.editCode({ partId: 'p6', title: 'z', mode: 'p5', source: 's', ...f });
      assert.equal(last.close(), true);
      assert.equal(f.log.closes, 1);
      assert.equal(app.drawer.isOpen(), false);
      assert.equal(last.close(), false, 'twice is a no-op');
      assert.equal(f.log.closes, 1, 'onClose is called exactly once');
    });
  });

  test('a drawer with no element to render into has no editCode, so the Preview hides Edit code', async () => {
    await withDom(() => {
      const app = /** @type {any} */ ({ els: {}, repo: null });
      installDrawer(app);
      assert.equal(app.drawer.editCode, undefined);
      assert.equal(app.drawer.editing(), '');
    });
  });

  test('a callback that throws is the caller’s problem, not the editor’s', async () => {
    await withDom(() => {
      const { app, drawer } = drawerApp();
      const warn = console.warn;
      /** @type {any[]} */ const warned = [];
      console.warn = (...a) => { warned.push(a); };
      try {
        const h = app.drawer.editCode({
          partId: 'p1', title: 'x', mode: 'p5', source: 's',
          onChange: () => { throw new Error('box gone'); }, onRun: () => { throw new Error('no guest'); },
        });
        typeInto(drawer.querySelector('.comp-code-area'), 's2');
        drawer.querySelector('.comp-code-run').dispatchEvent({ type: 'click', preventDefault() {} });
        assert.equal(h.isOpen(), true, 'still open');
        assert.equal(warned.length, 2, 'both said so on the console');
        h.close();
      } finally { console.warn = warn; }
    });
  });

  // ------------------------------------------------------------ the starters, and lol.orbit (K-7)

  test('the three.js starter hands its camera to lol.orbit, and still draws its picture', () => {
    const { THREE, made } = fakeThree();
    const { root, canvas, body } = fakeRoot();
    const { orbit, calls } = fakeOrbit(THREE);
    assert.match(STARTER.three, /^lol\.orbit\(camera\);$/m, 'the starter calls lol.orbit(camera) on a line of its own');
    assert.match(STARTER.three, /drag/, 'and says, in a comment, that you can drag when the box is Live');
    runInGuest(shapeForGuest('three', STARTER.three), { THREE, requestAnimationFrame: () => 0, document: { body } }, { canvas, root, orbit });
    assert.equal(calls.cams.length, 1);
    assert.equal(calls.cams[0], made.cameras[0], 'the camera the scene renders with');
    assert.ok(made.renders >= 1, 'a frame is rendered before the snapshot');
    assert.equal(made.renderers[0].opts.canvas, canvas, 'into the guest’s canvas');
    assert.equal(syntaxLine(STARTER.three), null, 'and it scans clean');
    // lol.orbit is on its own line after the camera, so an error there names that line
    const at = STARTER.three.split(NL).findIndex((l) => l === 'lol.orbit(camera);') + 1;
    const cam = STARTER.three.split(NL).findIndex((l) => /new THREE\.PerspectiveCamera/.test(l)) + 1;
    assert.ok(at > cam, 'after the camera is made');
  });

  test('a model’s fenced answer that calls lol.orbit runs through unfence → shapeForGuest with no error', () => {
    const answer = lines([
      'Here is your scene:',
      '',
      '```javascript',
      'const W = window.innerWidth, H = window.innerHeight;',
      'const scene = new THREE.Scene();',
      'const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);',
      'camera.position.set(0, 2, 6);',
      'const controls = lol.orbit(camera, { target: [0, 0.5, 0], damping: 0.1 });',
      'const renderer = new THREE.WebGLRenderer({ antialias: true });',
      'renderer.setSize(W, H);',
      'document.body.appendChild(renderer.domElement);',
      'scene.add(new THREE.AmbientLight(0xffffff, 0.5));',
      'const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.3), new THREE.MeshStandardMaterial({ color: 0x66aaff }));',
      'scene.add(knot);',
      'function animate() {',
      '  requestAnimationFrame(animate);',
      '  knot.rotation.y += 0.01;',
      '  controls.update();',
      '  renderer.render(scene, camera);',
      '}',
      'renderer.render(scene, camera);',
      'animate();',
      '```',
      '',
      'Drag to look around!',
    ]);
    const code = codeFor('three', answer);
    assert.ok(code.startsWith('const W'), 'the prose and the fence are gone');
    const { THREE, made } = fakeThree();
    const { root, canvas, body } = fakeRoot();
    const { orbit, calls } = fakeOrbit(THREE);
    /** @type {any[]} */ const frames = [];
    runInGuest(shapeForGuest('three', code), { THREE, innerWidth: 400, innerHeight: 300, requestAnimationFrame: (/** @type {any} */ f) => { frames.push(f); return frames.length; }, document: { body } }, { canvas, root, orbit });
    assert.equal(calls.cams[0], made.cameras[0], 'the camera went to lol.orbit');
    assert.equal(JSON.stringify(calls.opts[0]), JSON.stringify({ target: [0, 0.5, 0], damping: 0.1 }), 'with the options K-7 takes');
    assert.ok(made.renders >= 2, 'the first render and the first animate() frame');
    assert.ok(calls.updates >= 1, 'the model’s own controls.update() is a harmless call on the handle');
    assert.equal(canvas.parentNode, root, 'the canvas stayed where the snapshot looks');
  });

  test('a model that reaches for OrbitControls anyway gets lol.orbit behind the stand-in; an older guest still runs', () => {
    const scene = lines([
      "import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';",
      'const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 100);',
      'const renderer = new THREE.WebGLRenderer();',
      'const controls = new OrbitControls(camera, renderer.domElement);',
      'controls.enableDamping = true;',
      'controls.target.set(0, 1, 0);',
      'controls.update();',
      'renderer.render({}, camera);',
    ]);
    const live = fakeThree();
    const r1 = fakeRoot();
    const o = fakeOrbit(live.THREE);
    runInGuest(shapeForGuest('three', scene), { THREE: live.THREE, document: { body: r1.body } }, { canvas: r1.canvas, root: r1.root, orbit: o.orbit });
    assert.equal(o.calls.cams.length, 1, 'new OrbitControls(camera, …) handed the camera to lol.orbit');
    assert.equal(o.calls.cams[0], live.made.cameras[0]);
    assert.equal(o.calls.updates, 1, 'controls.update() reaches the orbit');
    assert.equal(live.made.renders, 1);

    // a guest without lol.orbit (before K-7): the do-nothing stand-in, as before
    const old = fakeThree();
    const r2 = fakeRoot();
    runInGuest(shapeForGuest('three', scene), { THREE: old.THREE, document: { body: r2.body } }, { canvas: r2.canvas, root: r2.root });
    assert.equal(old.made.renders, 1, 'it still draws');

    // any other camera add-on is explained with the first-party answer
    assert.equal(explainGuestError('TrackballControls is not defined', 'three'), t('parts.genErrThreeControls', { name: 'TrackballControls' }));
    assert.match(t('parts.genErrThreeControls', { name: 'MapControls' }), /lol\.orbit\(camera\)/);
    assert.equal(explainGuestError('GLTFLoader is not defined', 'three'), t('parts.genErrThreeAddon', { name: 'GLTFLoader' }), 'a loader is still just an add-on');
  });

  test('the p5 starter: the same first picture, and when Live the ball follows the mouse and a key turns it back', () => {
    const win = fakeP5();
    runInGuest(shapeForGuest('p5', STARTER.p5), win, {});
    assert.equal(typeof win.keyPressed, 'function', 'keyPressed is handed to p5 like setup and draw');
    win.setup();
    assert.deepEqual(win.circles[0], { x: 120, y: 80 }, 'the picture: the ball where it always started');
    assert.match(STARTER.p5, /mouseX/);
    assert.match(STARTER.p5, /Live/, 'the comment says it moves when the box is Live');
    assert.match(STARTER.p5, /fill\(230, 90, 60\)/, 'the colour the editing tests change is still spelt the same');

    // no button: it bounces on
    win.draw();
    assert.deepEqual(win.circles[1], { x: 123, y: 82 });
    // the button down: it glides toward the pointer
    win.mouseIsPressed = true;
    win.mouseX = 300; win.mouseY = 250;
    for (let i = 0; i < 30; i++) win.draw();
    const near = win.circles[win.circles.length - 1];
    assert.ok(Math.abs(near.x - 300) < 3 && Math.abs(near.y - 250) < 3, `it followed the pointer: ${JSON.stringify(near)}`);
    // a pointer dragged off the canvas: the ball waits at the edge, whole, and bounces on when let go
    win.mouseX = -200; win.mouseY = 999;
    for (let i = 0; i < 30; i++) win.draw();
    const edge = win.circles[win.circles.length - 1];
    assert.ok(edge.x >= 27 && edge.y <= 273, `it never leaves the canvas: ${JSON.stringify(edge)}`);
    win.mouseIsPressed = false;
    for (let i = 0; i < 120; i++) win.draw();
    const back = win.circles[win.circles.length - 1];
    assert.ok(back.x >= 0 && back.x <= 400 && back.y >= 0 && back.y <= 300, `it is still inside: ${JSON.stringify(back)}`);

    // a key turns it back (the ball is drawn BEFORE it moves, so a turn shows one frame later)
    const at = () => win.circles[win.circles.length - 1];
    win.mouseIsPressed = true; win.mouseX = 200; win.mouseY = 150;
    for (let i = 0; i < 40; i++) win.draw();                 // parked mid-canvas, far from any wall
    win.mouseIsPressed = false;
    win.draw(); const a = at();
    win.draw(); const b = at();
    win.keyPressed();
    win.draw(); const c = at();
    win.draw(); const d = at();
    assert.ok(Math.sign(d.x - c.x) === -Math.sign(b.x - a.x) && Math.sign(d.y - c.y) === -Math.sign(b.y - a.y),
      `a key reverses its direction: ${JSON.stringify([a, b, c, d])}`);
    assert.equal(syntaxLine(STARTER.p5), null);
  });

  // ------------------------------------------------------------------------ what the model is told

  test('the system messages name lol.orbit and the mouse, in one short rule each', () => {
    const three = t('parts.genSystemThree');
    const p5 = t('parts.genSystemP5');
    assert.match(three, /lol\.orbit\(camera\)/, 'three.js: call lol.orbit(camera)');
    assert.match(three, /^camera\.position\.z = 5;\nlol\.orbit\(camera\);$/m, 'and the skeleton does, right after the camera');
    assert.match(p5, /mouseX, mouseY/, 'p5: the mouse works when Live');
    assert.match(p5, /keyPressed\(\)/);
    // "do not bloat them": the rig passed 5/5 at the old length; each grew by one rule
    assert.ok(three.length < 2100, `three.js message stays short: ${three.length}`);
    assert.ok(p5.length < 1600, `p5 message stays short: ${p5.length}`);
    const rule7 = (/** @type {string} */ s) => (s.split(NL).find((l) => l.startsWith('7. ')) || '');
    assert.ok(rule7(three).length < 200 && rule7(p5).length < 200, 'the new rule is one line');
  });
};
