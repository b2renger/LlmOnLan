// @ts-check
// K5-U1 in Node: the creative boxes (addendum KE-3) — "p5.js sketch", "three.js scene", "SVG",
// "HTML page", "Markdown view", and the Write-… answers that land in them.
//
// What this file proves that computer-format.test.mjs (K4's Preview) and computer-seams.test.mjs
// (the kickoff's seams) do not:
//   - the guest SHAPING actually works: the shaped p5 and three.js code is EXECUTED here, in a
//     `node:vm` context that plays the guest's function wrapper and a fake library, so "the starter
//     draws" and "a model's sketch with only draw() is photographed non-blank" are behaviour, not
//     string matches; and every line of the person's code keeps its line number;
//   - errors NAME THE LINE: a syntax error the engine reports without one, an SVG that does not
//     parse, a draw() that throws after the run returned;
//   - the box's own code editor keeps the Text part's discipline: typing is `ctx.update`, leaving
//     is `ctx.commit`, a run never overwrites an edit in progress, a lock keeps the person's code;
//   - re-draw on edit is debounced, goes to the ONE guest through `ctx.sandbox()` (never the
//     runner), waits while a run is going, and never interleaves two draws on the guest.
// What a real browser shows (the sandbox really drawing, the menu really placing the boxes) is
// chat-harness/scenarios/k5-creative.mjs.

import assert from 'node:assert/strict';
import vm from 'node:vm';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import {
  STARTER, creativePresets, presetOf, presetTitle, saveFormats, CREATIVE_PRESET_IDS,
} from '../../../renderer/chat/graph/parts/creative.mjs';
import {
  unfence, codeFor, codeValue, shapeForGuest, syntaxLine, isSyntaxError, markupLine, lineRange,
  P5_HANDLERS, CODE_FACETS,
} from '../../../renderer/chat/graph/unfence.mjs';
import {
  shownOf, clearShown, sandboxMessage, lineOf, refusalOf, isEditing, errorOf, EDIT_DEBOUNCE_MS, modeFor,
  explained,
} from '../../../renderer/chat/graph/parts/preview.mjs';
import { normaliseDoc } from '../../../renderer/chat/graph/model.mjs';
import { toJson, fromJson } from '../../../renderer/chat/graph/serialize.mjs';

const SPECS = specMap();
const PREVIEW = SPECS.get('preview');
const NL = String.fromCharCode(10);
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const lines = (/** @type {string[]} */ l) => l.join(NL);

// ---------------------------------------------------------------------------------------------
// the guest, played in Node
// ---------------------------------------------------------------------------------------------

/**
 * Run shaped code the way sandbox/runner.html doRun does — a strict function of `lol` — inside a
 * vm context whose global object is `win`, so `window.x` and a bare `x` are the same binding, as
 * in the guest frame.
 * @param {string} code @param {any} win @param {any} lol
 */
function runInGuest(code, win, lol) {
  win.window = win;
  const context = vm.createContext(win);
  const fn = vm.compileFunction(`"use strict";${NL}${code}`, ['lol'], { parsingContext: context });
  return fn(lol);
}

/** A p5 global mode just big enough to run a sketch: the drawing calls are counted. */
function fakeP5Window(o = {}) {
  const calls = { createCanvas: 0, background: 0, circle: 0, fill: 0 };
  let looping = true;
  const win = {
    calls,
    width: 400, height: 300,
    createCanvas: (w, h) => { calls.createCanvas++; win.width = w; win.height = h; },
    noStroke: () => {}, stroke: () => {}, strokeWeight: () => {}, noFill: () => {},
    background: () => { calls.background++; },
    fill: () => { calls.fill++; },
    circle: () => { calls.circle++; },
    ellipse: () => { calls.circle++; },
    noLoop: () => { looping = false; },
    loop: () => { looping = true; },
    isLooping: () => looping,
    ...o,
  };
  return win;
}

/** A three.js just big enough to run the starter: every class is a stand-in, the renderer is
 * recorded. */
function fakeThree() {
  const made = { renderers: /** @type {any[]} */ ([]), renders: 0 };
  class Obj {
    constructor() {
      this.position = { x: 0, y: 0, z: 0, set() {} };
      this.rotation = { x: 0, y: 0, z: 0, set() {} };
    }
    add() {}
  }
  class WebGLRenderer {
    /** @param {any} o */
    constructor(o) {
      this.opts = o || {};
      this.domElement = this.opts.canvas || { tag: 'canvas', parentNode: null, own: true };
      made.renderers.push(this);
    }
    setSize() {}
    setPixelRatio() {}
    render() { made.renders++; }
  }
  const THREE = {
    Scene: Obj, Color: class {}, PerspectiveCamera: Obj, Mesh: Obj, BoxGeometry: class {},
    TorusGeometry: class {}, MeshNormalMaterial: class {}, MeshStandardMaterial: class {},
    AmbientLight: Obj, DirectionalLight: Obj, Vector3: class {}, WebGLRenderer,
  };
  return { THREE, made };
}

function fakeRoot() {
  const root = {
    tag: 'root',
    children: /** @type {any[]} */ ([]),
    /** @param {any} el */
    insertBefore(el) { el.parentNode = root; root.children.unshift(el); return el; },
    /** @param {any} el */
    appendChild(el) { el.parentNode = root; root.children.push(el); return el; },
  };
  const canvas = { tag: 'canvas', parentNode: root };
  root.children.push(canvas);
  const body = { tag: 'body', /** @param {any} el */ appendChild(el) { el.parentNode = body; return el; } };
  return { root, canvas, body };
}

// ---------------------------------------------------------------------------------------------
// the box, rendered with the unit runner's DOM shim
// ---------------------------------------------------------------------------------------------

/** Run `fn` with the unit runner's DOM shim installed as `globalThis.document`. */
async function withDom(fn) {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = doc;
  try { return await fn(doc); } finally {
    if (had) /** @type {any} */ (globalThis).document = prev;
    else delete (/** @type {any} */ (globalThis).document);
  }
}

/** A sandbox host as the parts see it, with every call recorded, in order. */
function fakeSandbox(answers = {}) {
  const calls = { run: [], snapshot: [], order: [] };
  let errs = [];
  return {
    calls,
    async run(req) {
      calls.run.push(req);
      calls.order.push(`run:${req.params && req.params.tag}`);
      if (answers.delay) await sleep(answers.delay);
      errs = answers.late ? [answers.late] : [];
      const a = answers.run;
      const out = typeof a === 'function' ? a(req) : a;
      return out || { ok: true, ms: 1, error: null };
    },
    async snapshot(o) {
      calls.snapshot.push(o);
      calls.order.push('snap');
      if (answers.delay) await sleep(answers.delay);
      return { dataUrl: `data:image/png;base64,${'A'.repeat(8)}${calls.snapshot.length}`, w: 400, h: 300 };
    },
    errors: () => errs.slice(),
  };
}

let seq = 0;
/** A part placed as a preset, the way `addPart` would: defaults, then the preset's settings. */
function presetPart(presetId, extra = {}) {
  const p = creativePresets().find((x) => x.id === presetId);
  const spec = SPECS.get(p.type);
  return {
    id: `cr-${++seq}`, type: p.type, x: 0, y: 0, w: 380, h: 500,
    settings: { ...spec.defaults(), ...p.settings }, value: null, state: 'idle', error: null, stats: null,
    ...extra,
  };
}

/** A RunInput. `ask` THROWS: a Preview spends no generations, ever. */
function runInput(part, content, o = {}) {
  const sandbox = o.sandbox === null ? null : (o.sandbox || fakeSandbox());
  return {
    input: {
      part, inputs: { content }, labels: { content: content.map(() => '') },
      app: { now: () => 1000 },
      ask: () => { throw new Error('Preview asked the farm'); },
      signal: new AbortController().signal, thread: null, cache: true, item: null,
      sandbox: sandbox ? async () => sandbox : null,
    },
    sandbox,
  };
}

/** The message a run() threw. */
async function failureOf(input) {
  try { await PREVIEW.run(input); } catch (err) { return { message: String(err.message), reason: err.reason, line: err.line }; }
  return null;
}

/**
 * Render a box the way the canvas does: `ctx.update` merges into the part and hands it straight
 * back to `update()` on the same turn (the canvas's own behaviour, which rule 2 depends on).
 */
function mount(doc, part, o = {}) {
  const host = doc.createElement('div');
  const patches = [];
  const commits = [];
  let current = part;
  const listeners = new Set();
  let running = false;
  const runner = {
    running: () => running,
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
  let wires = o.wires || [];
  const app = { now: () => 5000, host: { runner, session: { doc: () => ({ parts: [current], wires }) } } };
  /** @type {any} */ let view = null;
  const ctx = {
    app, get part() { return current; }, open: () => {},
    update(patch) {
      patches.push(patch);
      current = { ...current, settings: { ...current.settings, ...patch }, state: 'stale' };
      if (view) view.update(current);
    },
    commit(label) { commits.push(label); },
    sandbox: o.sandbox === undefined ? undefined : async () => o.sandbox,
  };
  view = PREVIEW.render(host, part, /** @type {any} */ (ctx));
  return {
    host, view, patches, commits,
    current: () => current,
    setPart(next) { current = next; view.update(next); },
    /** The document's wires change (a wire deleted, Undo, Reset lesson); the canvas repaints. */
    setWires(next) { wires = next; view.update(current); },
    setRunning(on) { running = on; for (const fn of [...listeners]) fn({ type: 'run' }); },
    q: (sel) => host.querySelector(sel),
    qa: (sel) => host.querySelectorAll(sel),
  };
}

/** Type into the code editor, as the browser reports it. */
function type(area, text) {
  area.value = text;
  area.dispatchEvent({ type: 'input' });
}

export default (test) => {
  // ------------------------------------------------------------------------------ the presets

  test('the creative presets: nine ids, every setting a real key, a starter that is ordinary code', () => {
    const presets = creativePresets();
    assert.deepEqual(presets.map((p) => p.id), [...CREATIVE_PRESET_IDS]);
    for (const p of presets) {
      const defaults = SPECS.get(p.type).defaults();
      for (const k of Object.keys(p.settings)) {
        assert.ok(Object.prototype.hasOwnProperty.call(defaults, k), `${p.id}.${k} is a key of ${p.type}.defaults(), or export would drop it`);
      }
      assert.ok(p.glyph.length >= 1 && p.glyph.length <= 3, `${p.id}: a 1–3 character glyph`);
      assert.ok(p.desc.length > 20, `${p.id}: a one-line description a person can read`);
      assert.equal(presetOf({ type: p.type, settings: p.settings }), p.id);
    }
    // Standard code, not code bent for our guest: p5 global mode, the three.js manual's scene.
    assert.match(STARTER.p5, /function setup\(\)/);
    assert.match(STARTER.p5, /function draw\(\)/);
    assert.match(STARTER.three, /new THREE\.WebGLRenderer\(/);
    assert.match(STARTER.three, /document\.body\.appendChild\(renderer\.domElement\)/);
    assert.deepEqual(saveFormats('p5'), ['js', 'png']);
    assert.deepEqual(saveFormats('three'), ['js', 'png']);
    assert.deepEqual(saveFormats('html'), ['html', 'png']);
    assert.deepEqual(saveFormats('svg'), ['svg']);
    assert.deepEqual(saveFormats('markdown'), ['md']);
    assert.deepEqual(saveFormats('auto'), []);
    // the title follows the mode: an SVG box switched to html IS an HTML page
    assert.equal(presetTitle({ type: 'preview', settings: { mode: 'html', source: STARTER.svg } }), t('parts.creativeHtmlLabel'));
  });

  test('the Write-… asks are the TASK only; the rules ride the system message (critic R1 A8)', () => {
    // This test used to pin "Reply with only…" in the instruction. Since critic R1 the person's
    // instruction is what to draw, and how to answer is the per-kind system message —
    // computer-gen.test.mjs pins those.
    const ask = (id) => creativePresets().find((p) => p.id === id).settings.instruction;
    for (const id of ['write-p5', 'write-three', 'write-svg', 'write-html']) {
      assert.doesNotMatch(ask(id), /Reply with only/);
      assert.ok(ask(id).length < 120, `${id}: a short task`);
    }
    assert.match(ask('write-p5'), /spiral/);
    assert.match(ask('write-three'), /floating shapes/);
    assert.match(ask('write-svg'), /landscape/);
    assert.match(ask('write-html'), /exhibition/);
  });

  // ------------------------------------------------------------------ unfence and what arrives

  test('what arrives is unwrapped: the fence, and the prose a model wraps around markup', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>';
    assert.equal(codeFor('svg', `Here is your SVG:${NL}${NL}\`\`\`svg${NL}${svg}${NL}\`\`\`${NL}Enjoy!`), svg);
    assert.equal(codeFor('svg', `Here is your SVG: ${svg} Hope you like it.`), svg, 'unfenced prose around an SVG is cut away');
    assert.equal(codeFor('svg', `<?xml version="1.0"?>${NL}${svg}`), `<?xml version="1.0"?>${NL}${svg}`, 'a prolog is kept');
    const page = lines(['<h1>Hi</h1>', '<p>there</p>']);
    assert.equal(codeFor('html', lines(["Sure! Here's the page:", '', page, '', 'Let me know!'])), page);
    assert.equal(codeFor('html', page), page, 'markup that starts at the start is left alone');
    const js = lines(['Here is a sketch', 'function setup() {}']);
    assert.equal(codeFor('p5', js), js, 'JavaScript is never cut: a sentence and a line of code look alike');
    assert.equal(codeFor('p5', lines(['```js', 'draw()', '```'])), 'draw()');
    // the longest block wins: a usage example before the program is not the program
    assert.equal(unfence(lines(['```js', 'go()', '```', 'and the program:', '```js', 'function draw() { go(); }', '```'])).code,
      'function draw() { go(); }');
    // the frozen seam, unchanged
    assert.deepEqual(codeValue(lines(['```svg', svg, '```']), 'svg'), { kind: 'text', data: svg, format: 'svg' });
  });

  test('fences a model gets wrong are still unwrapped: unclosed, glued, and the wrong language', () => {
    const sketch = lines(['function setup() { createCanvas(4, 4); }', 'function draw() { background(0); }']);
    // an opening fence and no closing one — a truncated answer, or a model that omits it
    const open = unfence(lines(['```javascript', sketch]));
    assert.deepEqual(open, { code: sketch, lang: 'javascript', fenced: true }, 'the ```javascript line is not line 1 of the sketch');
    assert.equal(codeValue(lines(['Here is your sketch:', '', '```javascript', sketch]), 'p5').data, sketch);
    // a closing fence glued to the last line
    assert.equal(unfence('```html' + NL + '<p>hi</p>```').code, '<p>hi</p>');
    assert.equal(codeFor('html', lines(['```html', '<h1>A</h1>', '<p>hi</p>```'])), lines(['<h1>A</h1>', '<p>hi</p>']));
    // a closing fence and no opener
    assert.equal(unfence(lines([sketch, '```'])).code, sketch);
    // several blocks: the one in the box's language wins, even when another is longer
    const html = lines(['<h1>Hello</h1>', '<p>A small page.</p>']);
    const css = lines(['body { font-family: sans-serif; margin: 0; padding: 2rem; }', 'h1 { color: #2e86ab; letter-spacing: 0.02em; }', 'p { line-height: 1.6; }']);
    const both = lines(['```html', html, '```', 'and the styles:', '```css', css, '```']);
    assert.equal(codeFor('html', both), html, 'an HTML page box draws the HTML, not the longer stylesheet');
    assert.equal(codeValue(both, 'html').data, html);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>';
    assert.equal(codeValue(lines(['```css', css, '```', '```svg', svg, '```']), 'svg').data, svg);
    assert.equal(codeValue(lines(['```html', html, '```', '```js', 'function draw() {}', '```']), 'p5').data, 'function draw() {}');
    // no block in the right language: the longest, as before
    assert.equal(codeFor('p5', lines(['```', 'go()', '```', '```', 'function draw() { go(); }', '```'])), 'function draw() { go(); }');
    // a backtick run in the middle of a line is not a fence
    assert.equal(unfence('const s = "```";').fenced, false);
  });

  // --------------------------------------------------------------------- shaping for the guest

  test('shaping keeps every line of the person’s code at its own line number', () => {
    const code = lines([
      "import * as THREE from 'three';",
      "import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';",
      'const a = 1;',
      'const b = 2;',
    ]);
    for (const mode of ['p5', 'three']) {
      const out = shapeForGuest(mode, code).split(NL);
      assert.ok(!/^\s*import\b/.test(out[1]), `${mode}: an import line is blanked`);
      assert.equal(out[2], 'const a = 1;', `${mode}: line 3 is still line 3`);
      assert.equal(out[3], 'const b = 2;', `${mode}: line 4 is still line 4`);
    }
    const p5 = shapeForGuest('p5', STARTER.p5).split(NL);
    const src = STARTER.p5.split(NL);
    assert.deepEqual(p5.slice(0, src.length), src, 'p5: the sketch is handed over verbatim, the hand-off below it');
    const three = shapeForGuest('three', STARTER.three).split(NL);
    const tsrc = STARTER.three.split(NL);
    assert.ok(three[0].endsWith(tsrc[0]), 'three: the prelude shares line 1 with the person’s line 1');
    assert.deepEqual(three.slice(1, tsrc.length), tsrc.slice(1), 'three: every other line is untouched');
    // an import from a CDN path that names the library is blanked too (the guest has no network,
    // and the library is already a global); an import of anything else is left for the engine
    // to refuse with its own words
    const cdn = shapeForGuest('three', "import { OrbitControls } from 'https://cdn.example/three@0.160/examples/jsm/controls/OrbitControls.js';");
    assert.ok(!/\bimport\b/.test(cdn.split(NL)[0].replace(/^const THREE[\s\S]*?lol\.canvas\); /, '')), 'a CDN three import is blanked');
    assert.ok(/import x from 'lodash'/.test(shapeForGuest('p5', "import x from 'lodash';")), 'other imports are not ours to hide');
    // instance mode and html are left alone
    assert.equal(shapeForGuest('p5', 'return function (p) { p.setup = () => {}; };'), 'return function (p) { p.setup = () => {}; };');
    assert.equal(shapeForGuest('html', '<p>x</p>'), '<p>x</p>');
    // a sketch that declares THREE itself gets no second declaration
    assert.ok(!/class extends/.test(shapeForGuest('three', 'const THREE = window.THREE;')), 'no second declaration: the prelude steps aside');
    for (const n of P5_HANDLERS) if (n !== 'setup') assert.ok(shapeForGuest('p5', 'x').includes(`window.${n} = typeof ${n}`), `${n} is handed over`);
  });

  test('the p5 starter DRAWS in the guest, and a draw()-only sketch paints its first frame', () => {
    // The starter: setup() + draw(). p5 calls window.setup; the wrapper paints frame one at once,
    // because the off-screen guest may never get an animation frame before the picture is taken.
    const win = fakeP5Window();
    runInGuest(shapeForGuest('p5', STARTER.p5), win, {});
    assert.equal(typeof win.setup, 'function', 'setup is handed to window');
    assert.equal(typeof win.draw, 'function', 'draw is handed to window');
    win.setup();
    assert.equal(win.calls.createCanvas, 1, 'the canvas is made');
    assert.equal(win.calls.background, 1, 'and the first frame is painted before the snapshot');
    assert.equal(win.calls.circle, 1, 'the ball is on it');

    // A model's sketch that calls noLoop(): p5 paints that frame itself, so it is not painted twice.
    const once = fakeP5Window();
    runInGuest(shapeForGuest('p5', lines(['function setup() { createCanvas(400, 300); noLoop(); }', 'function draw() { background(0); }'])), once, {});
    once.setup();
    assert.equal(once.calls.background, 0, 'noLoop(): the wrapper leaves the one frame to p5');

    // A sketch with only draw(): still gets a setup to hang the first frame on.
    const bare = fakeP5Window();
    runInGuest(shapeForGuest('p5', 'function draw() { background(1); circle(1, 1, 1); }'), bare, {});
    assert.equal(typeof bare.setup, 'function');
    bare.setup();
    assert.equal(bare.calls.circle, 1);
  });

  test('a p5 handler the new sketch does not declare is never the previous sketch’s', () => {
    const win = fakeP5Window();
    runInGuest(shapeForGuest('p5', lines(['function setup() {}', 'function draw() { circle(0, 0, 1); }', 'function mousePressed() {}'])), win, {});
    assert.equal(typeof win.mousePressed, 'function');
    const firstDraw = win.draw;
    // same frame, next run: a sketch with setup only
    runInGuest(shapeForGuest('p5', 'function setup() { background(9); }'), win, {});
    assert.equal(win.draw, undefined, 'the old draw() is recognised as a leftover and cleared');
    assert.equal(win.mousePressed, undefined, 'and so is the old mousePressed()');
    assert.notEqual(win.setup, firstDraw);
    win.calls.circle = 0;
    win.setup();
    assert.equal(win.calls.circle, 0, 'the previous sketch never draws again');
    assert.equal(win.calls.background, 1, 'the new one does');
  });

  test('the three.js starter DRAWS into the guest’s canvas, and keeps its picture', () => {
    const { THREE, made } = fakeThree();
    const { root, canvas, body } = fakeRoot();
    const win = { THREE, requestAnimationFrame: () => 0, document: { body } };
    runInGuest(shapeForGuest('three', STARTER.three), win, { canvas, root });
    assert.equal(made.renderers.length, 1, 'one renderer');
    assert.equal(made.renderers[0].opts.canvas, canvas, 'it draws into lol.canvas, where the snapshot looks');
    assert.equal(made.renderers[0].opts.preserveDrawingBuffer, true, 'with its drawing buffer kept');
    assert.equal(made.renderers[0].opts.antialias, true, 'and the sketch’s own options kept');
    assert.ok(made.renders >= 1, 'a frame is rendered before the snapshot');
    assert.equal(canvas.parentNode, root, 'document.body.appendChild did not carry the canvas off');
    assert.equal(win.THREE.WebGLRenderer, THREE.WebGLRenderer, 'the library itself is never modified');

    // A model's scene with OrbitControls (an addon the guest does not ship) still runs.
    const two = fakeThree();
    const r2 = fakeRoot();
    runInGuest(shapeForGuest('three', lines([
      "import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';",
      'const renderer = new THREE.WebGLRenderer();',
      'const controls = new OrbitControls({}, renderer.domElement);',
      'controls.enableDamping = true;',
      'controls.update();',
      'renderer.render({}, {});',
    ])), { THREE: two.THREE, document: { body: r2.body } }, { canvas: r2.canvas, root: r2.root });
    assert.equal(two.made.renders, 1);
    assert.equal(two.made.renderers[0].opts.canvas, r2.canvas);
  });

  // ------------------------------------------------------------------------- naming the line

  test('a syntax error the engine reports without a line gets one', () => {
    assert.deepEqual(syntaxLine(lines(['function setup() {', '  createCanvas(4, 4);', '', 'function draw() {', '  background(0);', '}'])),
      { line: 1, what: 'open' }, 'a { never closed: setup’s on line 1 (draw’s own } closed draw’s {)');
    assert.deepEqual(syntaxLine(lines(['let a = 1;', 'if (a) {', '  a++;', '}}'])), { line: 4, what: 'bracket' }, 'one } too many');
    assert.deepEqual(syntaxLine(lines(['let a = 1;', "let s = 'oops;", 'let b = 2;'])), { line: 2, what: 'string' }, 'a string left open');
    assert.deepEqual(syntaxLine(lines(['const a = [1, 2;', 'x();'])), { line: 1, what: 'open' }, 'a [ never closed');
    // not fooled by brackets that are not code
    assert.equal(syntaxLine(lines([
      '// a comment with a { in it',
      '/* and ( another */',
      "const s = 'a } in a string';",
      'const t = `a ${1 + (2)} template',
      '  over two lines }`;',
      'const re = /[({]+/g;',
      'const half = width / 2 / 1;',
      'function f() { return /}/.test(s); }',
    ])), null);
    // A WRONG LINE IS WORSE THAN NONE (fix pass): the box offers to jump to it.
    assert.deepEqual(syntaxLine(lines(['function setup() {', '  createCanvas(400, 300;', '}'])), { line: 2, what: 'open' },
      'a ( left open before the block ends: the line of the (, not of the }');
    assert.deepEqual(syntaxLine(lines(['function setup() {', '  createCanvas(400, 300;', '  background(0);', '}'])), { line: 2, what: 'open' });
    assert.deepEqual(syntaxLine(lines(['function draw() {', '  background(0));', '}'])), { line: 2, what: 'bracket' }, 'a stray ) is on its own line');
    assert.equal(syntaxLine(lines(['const a = [', '  1,', '  2', ');'])), null, 'a ( … ] mix across lines: unsure, so no line');
    assert.deepEqual(syntaxLine(lines(['function setup() {', '  let x = ;', '}'])), { line: 2, what: 'token' }, 'an = with nothing after it');
    assert.deepEqual(syntaxLine(lines(['let a = 1;', 'funtion draw() {', '  background(0);', '}'])), { line: 2, what: 'token' }, 'a misspelt keyword: two words side by side');
    // …and words that may stand side by side are left alone
    assert.equal(syntaxLine(lines([
      'let i = 0; const k = 1; var v = 2;',
      'async function go() { await new Promise((r) => r()); }',
      'for (const x of [1]) { if (typeof x === "number" && x instanceof Object) {} else if (x in {}) {} }',
      'class Ball extends Object { static n = 0; get r() { return this.n; } set r(v) { this.n = v; } }',
      'function* gen() { yield 1; }',
      'i++; i--; switch (i) { case 1: }',
      'const ok = i > 0 ? i : void 0; throw new Error("x");',
    ])), null);
    assert.equal(syntaxLine(STARTER.p5), null, 'the starters scan clean');
    assert.equal(syntaxLine(STARTER.three), null);
    assert.equal(isSyntaxError({ message: "Unexpected token '}'", stack: '' }), true);
    assert.equal(isSyntaxError({ message: 'x', stack: 'SyntaxError: x' }), true);
    assert.equal(isSyntaxError({ message: 'boom is not defined', stack: 'ReferenceError: boom' }), false);
    // …and it reaches the sentence the box shows
    const broken = lines(['function setup() {', '  createCanvas(4, 4);', '', 'function draw() {}']);
    assert.equal(sandboxMessage({ message: 'Unexpected end of input', line: 0 }, broken),
      t('parts.previewError', { message: 'Unexpected end of input', line: 1 }));
    assert.equal(lineOf({ message: 'boom is not defined', line: 3 }, broken), 3, 'a runtime line is the guest’s, measured');
  });

  test('an SVG that does not parse names the line of the tag that broke it', async () => {
    assert.deepEqual(markupLine(lines(['<svg xmlns="http://www.w3.org/2000/svg">', '  <g>', '    <rect/>', '  </svg>'])), { line: 4, tag: 'svg' });
    assert.deepEqual(markupLine(lines(['<svg>', '  <g>', '    <circle r="3">', '  </g>', '</svg>'])), { line: 4, tag: 'g' });
    assert.equal(markupLine(STARTER.svg), null, 'a good SVG has no bad line');
    assert.equal(markupLine('<svg><!-- a <g> in a comment --><rect/></svg>'), null);

    const bad = lines(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4">', '  <g>', '    <rect width="4" height="4"/>', '</svg>']);
    const fail = await failureOf(runInput(presetPart('svg'), [valueOf('text', bad)]).input);
    assert.equal(fail.reason, 'invalid');
    assert.equal(fail.line, 4, 'the failure carries the line');
    assert.match(fail.message, /line 4/, `and says it: ${fail.message}`);
    assert.match(fail.message, /does not parse/);
    assert.deepEqual(lineRange(bad, 2), [bad.indexOf('  <g>'), bad.indexOf('  <g>') + 5]);
  });

  // ------------------------------------------------------------------------------- the run

  test('with nothing wired in the box draws its OWN code; an arrival is adopted, unfenced', async () => {
    const p5 = presetPart('p5');
    const own = runInput(p5, []);
    await PREVIEW.run(own.input);
    assert.equal(own.sandbox.calls.run.length, 1);
    assert.ok(own.sandbox.calls.run[0].code.startsWith(STARTER.p5), 'the starter is what was drawn');
    assert.equal(shownOf(p5.id).from, 'own');
    assert.equal(shownOf(p5.id).source, STARTER.p5, 'and it is what the editor shows');

    const svgBox = presetPart('svg');
    const answer = codeValue(`Here you go:${NL}\`\`\`svg${NL}<svg xmlns="http://www.w3.org/2000/svg"><rect width="9" height="9"/></svg>${NL}\`\`\``, 'svg');
    await PREVIEW.run(runInput(svgBox, [answer]).input);
    assert.equal(shownOf(svgBox.id).from, 'input');
    assert.match(shownOf(svgBox.id).svg, /<rect/);
    assert.equal(svgBox.settings.source, STARTER.svg, 'a run never writes the person’s code');

    // auto reads the Write-… facet: a p5 answer into a plain Preview is drawn as p5
    const plain = { ...presetPart('markdown'), settings: { ...PREVIEW.defaults() } };
    const r = runInput(plain, [codeValue(lines(['```javascript', 'function draw() {}', '```']), 'p5')]);
    await PREVIEW.run(r.input);
    assert.equal(r.sandbox.calls.run[0].kind, 'p5');
    assert.ok(r.sandbox.calls.run[0].code.startsWith('function draw() {}'), 'the fence is gone');
  });

  test('a Write-… answer keeps its dialect through a reload and an export/import (auto still draws p5 / three)', () => {
    // The facets a Write-a-p5.js-sketch answer carries must survive every door a value goes
    // through after the session: the store's load (normaliseDoc → normalisePart → facetsOf) and a
    // graph file (toJson with values → fromJson). Before the fix `lang` was dropped for format 'js'
    // and a reopened sketch drew as markdown text.
    for (const kind of ['p5', 'three']) {
      const v = codeValue(lines(['```javascript', 'function draw() {}', '```']), kind);
      assert.equal(modeFor('auto', v), kind, `${kind}: fresh`);
      const doc = {
        lolgraph: 3, id: 'g', title: 'g',
        parts: [{ id: 'p1', type: 'ask', x: 0, y: 0, w: 240, h: 200, settings: { instruction: 'x', code: kind }, state: 'done', value: v }],
        wires: [],
      };
      const loaded = normaliseDoc(doc, { specs: SPECS, now: () => 1 });
      const lv = loaded.doc.parts[0].value;
      assert.deepEqual({ format: lv.format, lang: lv.lang }, CODE_FACETS[kind], `${kind}: facets after a reload`);
      assert.equal(modeFor('auto', lv), kind, `${kind}: auto after a reload`);
      const json = toJson(loaded.doc, { values: true, specs: SPECS });
      let n = 0;
      const back = fromJson(JSON.parse(JSON.stringify(json)), { specs: SPECS, newId: () => `n${++n}`, now: () => 1 });
      const bv = back.doc.parts[0].value;
      assert.equal(modeFor('auto', bv), kind, `${kind}: auto after export → import`);
    }
    // …and a lang on a format that has no dialect is still dropped.
    assert.deepEqual(valueOf('text', 'x', { format: 'svg', lang: 'p5' }), { kind: 'text', data: 'x', format: 'svg' });
    assert.deepEqual(valueOf('text', 'x', { lang: 'p5' }), { kind: 'text', data: 'x' });
  });

  test('a lock keeps the person’s code, and says so', async () => {
    const box = presetPart('svg', { settings: { ...presetPart('svg').settings, locked: true } });
    await PREVIEW.run(runInput(box, [valueOf('text', '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')]).input);
    assert.match(shownOf(box.id).svg, /Hello, SVG/, 'the starter, not the arrival');
    assert.equal(refusalOf(box.id), 'locked');
    const unlocked = presetPart('svg');
    await PREVIEW.run(runInput(unlocked, [valueOf('text', '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')]).input);
    assert.equal(refusalOf(unlocked.id), '', 'nothing kept, nothing said');
  });

  test('an error thrown after the run returned is still the sketch’s error, with its line', async () => {
    const code = lines(['function setup() { createCanvas(4, 4); }', 'function draw() {', '  bad();', '}']);
    const box = presetPart('p5', { settings: { ...presetPart('p5').settings, source: code } });
    const sandbox = fakeSandbox({ late: { message: 'bad is not defined', line: 3, stack: 'ReferenceError' } });
    const fail = await failureOf(runInput(box, [], { sandbox }).input);
    // Critic R1 A8: the engine's sentence, with its line — and, on a second line, what to do about
    // it when Package A's explainer knows the mistake ('' when it does not).
    const why = explained('bad is not defined', 'p5');
    const said = t('parts.previewError', { message: 'bad is not defined', line: 3 });
    assert.equal(fail.message, why ? `${said}\n${why}` : said);
    assert.equal(errorOf(box.id).line, 3, 'the box can offer to go to that line');
    assert.equal(shownOf(box.id), null, 'a broken sketch shows no picture pretending it worked');
  });

  test('two boxes drawing at once take the ONE guest in turn — a snapshot never photographs the other sketch', async () => {
    const sandbox = fakeSandbox({ delay: 15 });
    const a = presetPart('p5', { settings: { ...presetPart('p5').settings, h: 300 } });
    const b = presetPart('three');
    const ia = runInput(a, [], { sandbox });
    const ib = runInput(b, [], { sandbox });
    await Promise.all([PREVIEW.run(ia.input), PREVIEW.run(ib.input)]);
    assert.deepEqual(sandbox.calls.order, ['run:undefined', 'snap', 'run:undefined', 'snap'], 'run, photograph, run, photograph');
    assert.notEqual(shownOf(a.id).dataUrl, shownOf(b.id).dataUrl);
  });

  // ------------------------------------------------------------------------------- the box

  test('the box: its own monospace code, a lock, and Save as .js/.png for a sketch', async () => {
    await withDom(async (doc) => {
      const part = presetPart('p5', { state: 'done' });   // a reopened box: no auto-draw of sketches
      const sandbox = fakeSandbox();
      const m = mount(doc, part, { sandbox });
      const area = m.q('.graph-preview-source');
      assert.ok(area, 'the box has a code editor');
      assert.equal(area.value, STARTER.p5, 'holding the starter');
      assert.equal(area.getAttribute('spellcheck'), 'false');
      assert.equal(m.q('.graph-preview-note').textContent, t('parts.previewPress'), 'it says how to draw it');
      assert.ok(m.q('.graph-preview-lock'), 'and has a lock');
      await sleep(20);
      assert.equal(sandbox.calls.run.length, 0, 'a reopened sketch waits for ▶ — the guest is not booted for every box');

      // the save row offers the code before anything is drawn, the picture only after
      const visible = () => m.qa('.graph-preview-save').filter((b) => !b.hidden).map((b) => b.getAttribute('data-as'));
      assert.deepEqual(visible(), ['js']);
      await PREVIEW.run(runInput(m.current(), [], { sandbox }).input);
      m.setPart({ ...m.current(), state: 'done' });
      assert.deepEqual(visible(), ['js', 'png']);
      assert.equal(m.q('.graph-preview-save').getAttribute('data-as'), 'js', 'the first Save button is a pressable one');
      assert.ok(m.q('.graph-preview-tile'), 'the picture is shown');
      assert.equal(m.q('.graph-preview-note').textContent, t('parts.previewSnapshot'));

      // the lock is a settings edit
      m.q('.graph-preview-lock').dispatchEvent({ type: 'click' });
      assert.deepEqual(m.patches.at(-1), { locked: true });
      assert.equal(m.q('.graph-preview-lock').getAttribute('aria-pressed'), 'true');
      m.view.destroy();
      assert.equal(shownOf(part.id), null, 'a box that goes away forgets its drawing');
    });
  });

  test('typing is ctx.update, leaving is ctx.commit, and it re-draws — debounced, via ctx.sandbox, never the runner', async () => {
    await withDom(async (doc) => {
      const part = presetPart('p5', { state: 'done' });
      const sandbox = fakeSandbox();
      const m = mount(doc, part, { sandbox });
      const area = m.q('.graph-preview-source');
      type(area, STARTER.p5.replace('fill(230, 90, 60)', 'fill(20, 90, 200)'));
      type(area, STARTER.p5.replace('fill(230, 90, 60)', 'fill(20, 90, 220)'));
      assert.ok(isEditing(part.id), 'the box is being edited');
      assert.equal(m.patches.length, 2, 'every keystroke reaches the document');
      assert.match(m.patches[1].source, /fill\(20, 90, 220\)/);
      assert.equal(area.value, m.patches[1].source, 'the canvas handing the part back did not re-seed the field');
      assert.equal(sandbox.calls.run.length, 0, 'not on every keystroke');
      await sleep(EDIT_DEBOUNCE_MS + 80);
      assert.equal(sandbox.calls.run.length, 1, 'once typing pauses: ONE draw');
      assert.match(sandbox.calls.run[0].code, /fill\(20, 90, 220\)/, 'of what was typed last');
      assert.equal(shownOf(part.id).from, 'own');
      assert.ok(m.q('.graph-preview-tile'));
      area.dispatchEvent({ type: 'blur' });
      assert.equal(isEditing(part.id), false);
      assert.equal(m.commits.length, 1, 'leaving the editor closes ONE undo entry');
      m.view.destroy();
    });
  });

  test('an edit-draw waits while a run is going, then draws once it ends', async () => {
    await withDom(async (doc) => {
      const part = presetPart('three', { state: 'done' });
      const sandbox = fakeSandbox();
      const m = mount(doc, part, { sandbox });
      m.setRunning(true);
      type(m.q('.graph-preview-source'), `${STARTER.three}${NL}// edited`);
      await sleep(EDIT_DEBOUNCE_MS + 80);
      assert.equal(sandbox.calls.run.length, 0, 'a run holds the floor: the edit waits');
      assert.equal(m.q('.graph-preview-note').textContent, t('parts.previewDrawing'), 'and says it is on its way');
      m.setRunning(false);
      await sleep(30);
      assert.equal(sandbox.calls.run.length, 1, 'the run ended: the edit draws');
      m.view.destroy();
    });
  });

  test('an edit that breaks the sketch names the line, and clicking it selects that line', async () => {
    await withDom(async (doc) => {
      const part = presetPart('p5', { state: 'done' });
      const broken = lines(['function setup() {', '  createCanvas(400, 300);', '', 'function draw() {', '  background(0);', '}']);
      const sandbox = fakeSandbox({ run: () => ({ ok: false, ms: 0, error: { message: 'Unexpected end of input', line: 0, stack: 'SyntaxError: Unexpected end of input' } }) });
      const m = mount(doc, part, { sandbox });
      const area = m.q('.graph-preview-source');
      /** @type {number[]} */ let selected = [];
      area.setSelectionRange = (a, b) => { selected = [a, b]; };
      type(area, broken);
      await sleep(EDIT_DEBOUNCE_MS + 80);
      const error = m.q('.graph-preview-error');
      assert.equal(error.hidden, false, 'the box shows the error itself (the canvas knows nothing of edit-draws)');
      assert.equal(error.textContent, t('parts.previewError', { message: 'Unexpected end of input', line: 1 }));
      assert.equal(error.getAttribute('data-line'), '1');
      error.dispatchEvent({ type: 'click' });
      assert.deepEqual(selected, lineRange(broken, 1), 'the line it names is selected in the code');
      // fixing it clears it
      sandbox.calls.run.length = 0;
      m.view.destroy();
    });
  });

  test('a run while the person is typing keeps their code — an arrival never overwrites an edit', async () => {
    await withDom(async (doc) => {
      const part = presetPart('svg', { state: 'done' });
      const m = mount(doc, part, { wires: [{ from: 'x', to: part.id, port: 'content' }] });
      const area = m.q('.graph-preview-source');
      const mine = STARTER.svg.replace('Hello, SVG', 'Mine');
      type(area, mine);
      await PREVIEW.run(runInput(m.current(), [valueOf('text', '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')]).input);
      m.setPart({ ...m.current(), state: 'done' });
      assert.match(shownOf(part.id).svg, /Mine/, 'the person’s code was drawn');
      assert.equal(refusalOf(part.id), 'unsaved');
      assert.equal(m.q('.graph-preview-kept').textContent, t('parts.previewKeptEditing'), 'and the box says why');
      assert.equal(area.value, mine, 'the field still holds what was typed');
      area.dispatchEvent({ type: 'blur' });
      // editing an ARRIVAL makes it yours (rule 3): after a run adopts one, the editor shows it…
      await PREVIEW.run(runInput(m.current(), [valueOf('text', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="2"/></svg>')]).input);
      m.setPart({ ...m.current(), state: 'done' });
      assert.match(area.value, /<circle r="2"\/>/, 'the editor shows the code that was drawn');
      assert.equal(m.q('.graph-preview-from').textContent, t('parts.previewFromInput'));
      // …and the first keystroke writes arrival-plus-keystroke to the person's source
      type(area, `${area.value} `);
      assert.match(m.patches.at(-1).source, /<circle r="2"\/><\/svg> $/);
      area.dispatchEvent({ type: 'blur' });
      assert.match(area.value, /<circle/, 'leaving does not snap back to the old starter');
      m.view.destroy();
    });
  });

  test('a fresh SVG box shows its picture at once; a wired one waits for ▶', async () => {
    await withDom(async (doc) => {
      const fresh = presetPart('svg');
      const m = mount(doc, fresh);
      await sleep(20);
      assert.ok(shownOf(fresh.id), 'drawn on its own, free: no guest, no generation');
      assert.ok(String(m.q('.graph-preview-tile').getAttribute('src')).startsWith('data:image/svg+xml'));
      m.view.destroy();

      const wired = presetPart('svg');
      const w = mount(doc, wired, { wires: [{ from: 'ask', to: wired.id, port: 'content' }] });
      await sleep(20);
      assert.equal(shownOf(wired.id), null, 'a wired box does not show its starter as if it were the answer');
      w.view.destroy();

      // a fresh sketch (idle, unwired) draws once through the ONE guest
      const sketch = presetPart('p5');
      const sandbox = fakeSandbox();
      const s = mount(doc, sketch, { sandbox });
      await sleep(30);
      assert.equal(sandbox.calls.run.length, 1, 'a freshly placed p5.js sketch shows its ball without a ▶');
      assert.equal(sandbox.calls.run[0].kind, 'p5');
      s.view.destroy();
      clearShown(sketch.id);
    });
  });

  test('an arrival is forgotten when its wire goes, or when Reset / Undo puts the box’s own code back', async () => {
    await withDom(async (doc) => {
      const arrived = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>';
      // 1. the wire is deleted: the box shows its own starter again, drawn, and no "arrived" mark
      const box = presetPart('svg');
      const wire = { from: 'ask', to: box.id, port: 'content' };
      const m = mount(doc, box, { wires: [wire] });
      await PREVIEW.run(runInput(box, [valueOf('text', arrived)]).input);
      m.setPart({ ...box, state: 'done' });
      assert.equal(m.q('.graph-preview-source').value, arrived, 'the arrival is in the editor');
      assert.equal(m.q('.graph-preview-from').getAttribute('data-from'), 'input');
      m.setWires([]);
      await sleep(20);
      assert.equal(m.q('.graph-preview-source').value, STARTER.svg, 'unwired: the box’s own code again');
      assert.equal(m.q('.graph-preview-from').getAttribute('data-from'), 'own');
      assert.match(String(shownOf(box.id) && shownOf(box.id).svg), /Hello, SVG/, 'and it draws it');
      assert.equal(shownOf(box.id).from, 'own');
      m.view.destroy();

      // 2. Reset lesson (the SAME id, shipped settings, wires put back as shipped — here none)
      const edited = presetPart('svg', { settings: { ...presetPart('svg').settings, source: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="3"/></svg>' } });
      const r = mount(doc, edited, { wires: [{ from: 'w', to: edited.id, port: 'content' }] });
      await PREVIEW.run(runInput(edited, [valueOf('text', arrived)]).input);
      r.setPart({ ...edited, state: 'done' });
      assert.equal(r.q('.graph-preview-source').value, arrived);
      r.setPart({ ...edited, settings: { ...edited.settings, source: STARTER.svg }, state: 'idle' });
      await sleep(20);
      assert.equal(r.q('.graph-preview-source').value, STARTER.svg, 'reset: the shipped code, not the old answer');
      assert.equal(r.q('.graph-preview-from').getAttribute('data-from'), 'own');
      r.view.destroy();

      // 3. while still wired and unchanged, the arrival stays (a pan, a selection, a move)
      const kept = presetPart('svg');
      const k = mount(doc, kept, { wires: [{ from: 'w', to: kept.id, port: 'content' }] });
      await PREVIEW.run(runInput(kept, [valueOf('text', arrived)]).input);
      k.setPart({ ...kept, x: 40, state: 'done' });
      assert.equal(k.q('.graph-preview-source').value, arrived, 'a repaint keeps what arrived');
      assert.equal(k.q('.graph-preview-from').getAttribute('data-from'), 'input');
      k.view.destroy();
    });
  });

  test('a markdown report that arrived folds its code away; a sketch never does', async () => {
    await withDom(async (doc) => {
      const report = { ...presetPart('markdown'), settings: { ...PREVIEW.defaults() }, state: 'done' };
      await PREVIEW.run(runInput(report, [valueOf('text', '# Report')]).input);
      const m = mount(doc, report, { wires: [{ from: 'a', to: report.id, port: 'content' }] });
      assert.equal(m.q('.graph-preview-source').hidden, true, 'a report is read, not edited, by default');
      const toggle = m.q('.graph-preview-code-toggle');
      assert.equal(toggle.hidden, false);
      toggle.dispatchEvent({ type: 'click' });
      assert.equal(m.q('.graph-preview-source').hidden, false, 'one click shows its source');
      assert.equal(m.q('.graph-preview-source').value, '# Report');
      m.view.destroy();
    });
  });
};
