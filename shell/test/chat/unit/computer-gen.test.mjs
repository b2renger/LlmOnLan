// Critic R1 A2 + A8 (Package A) in Node: what an Instruction SENDS for a code kind, and what
// happens to what a 12B model sends BACK.
//
// "Write SVG, p5js and threejs do not work — I think the model needs more and better instructions
// to be able to write in the context of the computer." — the owner. Two halves:
//   1. what is sent: the per-kind system message (the sandbox's real rules and one skeleton),
//      the real max_tokens, the task-only preset instructions;
//   2. what comes back: FIVE realistic answers per kind — the shapes gemma4:12b actually produces,
//      its usual mistakes included (no xmlns, a whole HTML page for a sketch, top-level p5 calls,
//      an import map, setAnimationLoop only, window.onload, an unclosed fence) — each put through
//      the same unfence → salvage → shape/sanitize path the box uses, and then RUN in a Node
//      stand-in for the guest (strict function body, p5/three globals only where the real guest
//      has them). A mistake we cannot repair must at least be EXPLAINED (explainGuestError).
//
// The live 4-of-5 acceptance on gemma4:12b is the integrator's rig check; this file is what can
// be pinned without a farm.
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import '../../../renderer/chat/strings/parts.en.mjs';
import '../../../renderer/chat/strings/computer-gen.en.mjs';
import {
  planFor, codeSystem, codeKindOf, maxTokensOf, MAX_TOKENS_CODE, MAX_TOKENS_TEXT, SYSTEM,
  bindArrivals, bindInputs,
} from '../../../renderer/chat/graph/bind.mjs';
import {
  codeValue, codeFor, shapeForGuest, scriptOf, explainGuestError, P5_FUNCTIONS, P5_VALUES,
} from '../../../renderer/chat/graph/unfence.mjs';
import { sanitizeSvg } from '../../../renderer/chat/design/svg-sanitize.mjs';
import { creativePresets } from '../../../renderer/chat/graph/parts/creative.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';
import { callLine, seedText, costView } from '../../../renderer/chat/computer/transcript.mjs';
import { nothingRan } from '../../../renderer/chat/computer/runbar.mjs';
import templateCreative from '../../../renderer/chat/computer/templates/creative-coding.mjs';

const NL = String.fromCharCode(10);
const FENCE = '```';
const fenced = (/** @type {string} */ lang, /** @type {string} */ body) => `${FENCE}${lang}${NL}${body}${NL}${FENCE}`;
const lines = (/** @type {string[]} */ l) => l.join(NL);

// ---------------------------------------------------------------------------------------------
// the guest, played in Node (the same contract as sandbox/runner.html doRun)
// ---------------------------------------------------------------------------------------------

/** Run shaped code as `new Function('lol', '"use strict";\n' + code)` inside `win`'s globals. */
function runInGuest(/** @type {string} */ code, /** @type {any} */ win, /** @type {any} */ lol) {
  win.window = win;
  const context = vm.createContext(win);
  const fn = vm.compileFunction(`"use strict";${NL}${code}`, ['lol'], { parsingContext: context });
  return fn(lol);
}

/** Does it COMPILE as the guest compiles it? (a SyntaxError is "Unexpected token '<'" on screen) */
function compiles(/** @type {string} */ code) {
  try { vm.compileFunction(`"use strict";${NL}${code}`, ['lol']); return true; } catch { return false; }
}

/** The p5 globals the real guest binds when `new p5()` starts — AFTER the sketch body ran. */
function p5Globals(/** @type {{calls: string[]}} */ log) {
  /** @type {any} */ const g = {};
  for (const name of P5_FUNCTIONS) g[name] = (...a) => { log.calls.push(name); return name === 'color' ? { c: a } : (name === 'random' ? 0.5 : 0); };
  for (const name of P5_VALUES) g[name] = typeof name === 'string' && /^[A-Z_]+$/.test(name) ? name : 400;
  g.PI = Math.PI; g.TWO_PI = Math.PI * 2; g.HALF_PI = Math.PI / 2;
  return g;
}

/**
 * Run a p5 sketch like the guest: the body first (no p5 globals yet), then — if it handed over a
 * setup/draw or returned an instance sketch — p5 "starts": globals appear, setup and one draw run.
 * @returns {{ok: boolean, error: string, calls: string[], mode: string}}
 */
function runP5(/** @type {string} */ code) {
  const log = { calls: /** @type {string[]} */ ([]) };
  /** @type {any} */ const win = { console, Math };
  let value;
  try {
    value = runInGuest(shapeForGuest('p5', code), win, { root: {}, size: { w: 400, h: 300 } });
    if (typeof value === 'function') {
      // instance mode: p5 calls the sketch with an instance carrying the API
      const p = p5Globals(log);
      value(p);
      if (typeof p.setup === 'function') p.setup();
      if (typeof p.draw === 'function') p.draw();
      return { ok: true, error: '', calls: log.calls, mode: 'instance' };
    }
    Object.assign(win, p5Globals(log));
    if (typeof win.setup === 'function') win.setup();
    if (typeof win.draw === 'function') win.draw();
    return { ok: typeof win.setup === 'function' || typeof win.draw === 'function', error: '', calls: log.calls, mode: 'global' };
  } catch (e) {
    return { ok: false, error: String(/** @type {any} */ (e).message), calls: log.calls, mode: '' };
  }
}

/** A three.js r160 stand-in: `setAnimationLoop` is assigned IN the constructor, as the real one. */
function fakeThree() {
  const made = { renders: 0, loops: 0, renderers: /** @type {any[]} */ ([]) };
  class Obj {
    constructor() { this.position = { x: 0, y: 0, z: 0, set() {} }; this.rotation = { x: 0, y: 0, z: 0, set() {} }; }
    add() {}
  }
  class WebGLRenderer {
    constructor(/** @type {any} */ o) {
      this.opts = o || {};
      this.domElement = this.opts.canvas || { tag: 'canvas', parentNode: null };
      /** @type {any} */ let loop = null;
      this.setAnimationLoop = function (/** @type {any} */ cb) { loop = cb; made.loops += 1; };
      this.hasLoop = () => !!loop;
      made.renderers.push(this);
    }
    setSize() {}
    setPixelRatio() {}
    render() { made.renders += 1; }
  }
  const THREE = {
    Scene: Obj, Color: class {}, PerspectiveCamera: Obj, Mesh: Obj, Group: Obj, BoxGeometry: class {},
    SphereGeometry: class {}, TorusGeometry: class {}, IcosahedronGeometry: class {}, ConeGeometry: class {},
    MeshStandardMaterial: class {}, MeshNormalMaterial: class {}, MeshPhongMaterial: class {},
    AmbientLight: Obj, DirectionalLight: Obj, PointLight: Obj, Vector3: class {}, Clock: class { getElapsedTime() { return 0; } },
    WebGLRenderer,
  };
  return { THREE, made };
}

/** Run a three.js scene like the guest, then flush microtasks (the setAnimationLoop first frame). */
async function runThree(/** @type {string} */ code) {
  const { THREE, made } = fakeThree();
  const root = { children: /** @type {any[]} */ ([]), insertBefore(/** @type {any} */ el) { el.parentNode = root; return el; }, appendChild(/** @type {any} */ el) { el.parentNode = root; return el; } };
  const canvas = { tag: 'canvas', parentNode: root };
  const body = { appendChild(/** @type {any} */ el) { el.parentNode = body; return el; } };
  /** @type {any[]} */ const frames = [];
  const win = {
    THREE, console, Math, Promise, performance: { now: () => 1 }, innerWidth: 400, innerHeight: 300,
    document: { body, addEventListener() {} }, addEventListener() {},
    requestAnimationFrame: (/** @type {any} */ f) => { frames.push(f); return frames.length; },
  };
  try {
    runInGuest(shapeForGuest('three', code), win, { canvas, root, size: { w: 400, h: 300 } });
    await new Promise((r) => setTimeout(r, 0));
    return { ok: true, error: '', made, canvas, root };
  } catch (e) {
    return { ok: false, error: String(/** @type {any} */ (e).message), made, canvas, root };
  }
}

// ---------------------------------------------------------------------------------------------
// FIVE realistic answers per kind (what a 12B model tends to produce, mistakes included)
// ---------------------------------------------------------------------------------------------

const SVG_ANSWERS = [
  // 1. the good case, but NO xmlns — blank as <img> before R1
  fenced('svg', lines([
    '<svg viewBox="0 0 400 300" width="400" height="300">',
    '  <rect width="400" height="300" fill="#87ceeb"/>',
    '  <circle cx="330" cy="70" r="40" fill="#ffd700"/>',
    '  <ellipse cx="120" cy="300" rx="200" ry="90" fill="#4caf50"/>',
    '  <ellipse cx="320" cy="300" rx="180" ry="70" fill="#388e3c"/>',
    '  <rect x="170" y="170" width="80" height="60" fill="#d2691e"/>',
    '  <polygon points="160,170 210,125 260,170" fill="#8b0000"/>',
    '</svg>',
  ])),
  // 2. prose around an ```xml fence with a prolog and a declared xlink
  lines([
    'Here is a simple landscape SVG with a sun, two hills and a house:',
    '',
    fenced('xml', lines([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 400 300">',
      '  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6ec6ff"/><stop offset="1" stop-color="#e3f2fd"/></linearGradient></defs>',
      '  <rect width="400" height="300" fill="url(#sky)"/>',
      '  <circle cx="60" cy="60" r="30" fill="#fdd835"/>',
      '  <path d="M0 220 Q100 140 200 220 T400 220 V300 H0 Z" fill="#66bb6a"/>',
      '</svg>',
    ])),
    '',
    'This SVG uses a gradient for the sky. Let me know if you want changes!',
  ]),
  // 3. unfenced, an HTML entity in <text>, and an unescaped ampersand
  lines([
    '<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">',
    '  <rect width="100%" height="100%" fill="#fff8e1"/>',
    '  <text x="20" y="40" font-family="sans-serif" font-size="22">Sunny&nbsp;Day & Hills</text>',
    '  <path d="M0 250 C 100 180, 200 180, 400 250 L400 300 L0 300 Z" fill="#7cb342"/>',
    '</svg>',
  ]),
  // 4. an <animate> the system message forbade (dropped: the picture is still)
  fenced('svg', lines([
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">',
    '  <rect width="400" height="300" fill="#1a237e"/>',
    '  <circle cx="200" cy="150" r="50" fill="#ffeb3b"><animate attributeName="r" values="40;60;40" dur="2s" repeatCount="indefinite"/></circle>',
    '</svg>',
  ])),
  // 5. <use xlink:href> with the xlink prefix NEVER declared — blank as <img> before R1
  fenced('svg', lines([
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">',
    '  <defs><g id="tree"><rect x="-5" y="0" width="10" height="30" fill="#795548"/><circle cx="0" cy="-5" r="20" fill="#2e7d32"/></g></defs>',
    '  <rect width="400" height="300" fill="#e8f5e9"/>',
    '  <use xlink:href="#tree" x="80" y="200"/>',
    '  <use xlink:href="#tree" x="300" y="210"/>',
    '</svg>',
  ])),
];

const P5_ANSWERS = [
  // 1. the good case
  fenced('javascript', lines([
    'let angle = 0;',
    'function setup() {',
    '  createCanvas(windowWidth, windowHeight);',
    '  colorMode(HSB, 360, 100, 100);',
    '}',
    'function draw() {',
    '  background(230, 30, 15);',
    '  translate(width / 2, height / 2);',
    '  for (let i = 0; i < 200; i++) {',
    '    const r = i * 1.5;',
    '    fill((i * 2 + frameCount) % 360, 80, 90);',
    '    circle(r * cos(angle + i * 0.2), r * sin(angle + i * 0.2), 8);',
    '  }',
    '  angle += 0.01;',
    '}',
  ])),
  // 2. a whole HTML page, fenced ```html, CDN <script src> + the sketch inline — salvaged
  fenced('html', lines([
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>',
    '</head>',
    '<body>',
    '  <script>',
    '    let t = 0;',
    '    function setup() {',
    '      createCanvas(400, 300);',
    '    }',
    '    function draw() {',
    '      background(20);',
    '      stroke(255);',
    '      point(200 + 100 * cos(t), 150 + 100 * sin(t));',
    '      t += 0.05;',
    '    }',
    '  </script>',
    '</body>',
    '</html>',
  ])),
  // 3. p5 calls at the TOP of the sketch — cannot run; must be EXPLAINED
  fenced('js', lines([
    'const palette = [color(255, 0, 0), color(0, 0, 255)];',
    'function setup() { createCanvas(400, 300); }',
    'function draw() { background(palette[0]); }',
  ])),
  // 4. an undeclared variable in strict mode — must be EXPLAINED
  fenced('javascript', lines([
    'function setup() {',
    '  createCanvas(400, 300);',
    '  spin = 0;',
    '}',
    'function draw() { background(0); spin += 0.1; }',
  ])),
  // 5. instance mode with `new p5(sketch)` as the last line, and an unclosed fence (truncated
  //    reply that happened to finish the code) — handed over to the guest's instance door
  lines([
    'Sure! Here is a sketch in instance mode:',
    '',
    `${FENCE}javascript`,
    'const sketch = (p) => {',
    '  p.setup = () => { p.createCanvas(400, 300); };',
    '  p.draw = () => { p.background(10); p.circle(200, 150, 80); };',
    '};',
    'new p5(sketch);',
  ]),
];

const THREE_ANSWERS = [
  // 1. the good case (the system message's own skeleton, lightly varied)
  fenced('javascript', lines([
    'const W = window.innerWidth, H = window.innerHeight;',
    'const scene = new THREE.Scene();',
    'const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);',
    'camera.position.z = 6;',
    'const renderer = new THREE.WebGLRenderer({ antialias: true });',
    'renderer.setSize(W, H);',
    'document.body.appendChild(renderer.domElement);',
    'scene.add(new THREE.AmbientLight(0xffffff, 0.5));',
    'const shapes = [];',
    'for (let i = 0; i < 5; i++) {',
    '  const m = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshStandardMaterial({ color: 0xff8800 }));',
    '  scene.add(m); shapes.push(m);',
    '}',
    'function animate() { requestAnimationFrame(animate); shapes.forEach((s) => { s.rotation.y += 0.01; }); renderer.render(scene, camera); }',
    'renderer.render(scene, camera);',
    'animate();',
  ])),
  // 2. an ES-module PAGE: import map + <script type="module"> with imports — salvaged
  fenced('html', lines([
    '<!DOCTYPE html>',
    '<html><head><style>body { margin: 0; }</style></head>',
    '<body>',
    '<script type="importmap">{ "imports": { "three": "https://unpkg.com/three@0.160.0/build/three.module.js" } }</script>',
    '<script type="module">',
    "import * as THREE from 'three';",
    "import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';",
    'const scene = new THREE.Scene();',
    'const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);',
    'const renderer = new THREE.WebGLRenderer();',
    'renderer.setSize(innerWidth, innerHeight);',
    'document.body.appendChild(renderer.domElement);',
    'const controls = new OrbitControls(camera, renderer.domElement);',
    'scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial()));',
    'renderer.render(scene, camera);',
    '</script>',
    '</body></html>',
  ])),
  // 3. ONLY setAnimationLoop — painted nothing before the snapshot until R1
  fenced('javascript', lines([
    'const scene = new THREE.Scene();',
    'const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 100);',
    'const renderer = new THREE.WebGLRenderer({ antialias: true });',
    'renderer.setSize(400, 300);',
    'document.body.appendChild(renderer.domElement);',
    'const light = new THREE.DirectionalLight(0xffffff, 1);',
    'scene.add(light);',
    'const torus = new THREE.Mesh(new THREE.TorusGeometry(1, 0.3, 16, 64), new THREE.MeshStandardMaterial({ color: 0x44aaff }));',
    'scene.add(torus);',
    'renderer.setAnimationLoop(() => { torus.rotation.x += 0.01; renderer.render(scene, camera); });',
  ])),
  // 4. waits for window 'load' with an init() that declares its own globals — salvaged
  fenced('javascript', lines([
    'let scene, camera, renderer, cube;',
    'function init() {',
    '  scene = new THREE.Scene();',
    '  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);',
    '  renderer = new THREE.WebGLRenderer();',
    '  renderer.setSize(window.innerWidth, window.innerHeight);',
    '  document.body.appendChild(renderer.domElement);',
    '  cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ color: 0x00ff00 }));',
    '  scene.add(cube);',
    '  renderer.render(scene, camera);',
    '}',
    "window.addEventListener('load', init);",
  ])),
  // 5. assigns window.onload, and inside uses an add-on the guest does not ship — the salvage
  //    runs it, and the add-on's error is EXPLAINED
  fenced('javascript', lines([
    'window.onload = function () {',
    '  const scene = new THREE.Scene();',
    '  const renderer = new THREE.WebGLRenderer();',
    '  const loader = new GLTFLoader();',
    '  renderer.render(scene, null);',
    '};',
  ])),
];

const HTML_ANSWERS = [
  // 1. the good case: a fragment with one <style>
  fenced('html', lines([
    '<style>.card { font-family: system-ui, sans-serif; padding: 20px; } h1 { color: #b0452f; }</style>',
    '<div class="card"><h1>Tides</h1><p>An exhibition about the sea.</p><ul><li>Waves</li><li>Wrecks</li><li>Light</li></ul></div>',
  ])),
  // 2. a whole page with doctype/head/body
  fenced('html', lines([
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="UTF-8"><title>Exhibition</title><style>body { font-family: sans-serif; }</style></head>',
    '<body><h1>Deep Blue</h1><p>Three rooms.</p></body></html>',
  ])),
  // 3. unfenced, prose before and after
  lines([
    "Sure! Here's a small page:",
    '',
    '<div style="padding:16px"><h2>Light and Water</h2><p>Opening Friday.</p></div>',
    '',
    'Let me know if you want more highlights.',
  ]),
  // 4. two fences: the page, then "the CSS separately" (longer) — the HTML one is drawn
  lines([
    fenced('html', '<main><h1>Harbour</h1><p>Boats and nets.</p></main>'),
    'And some optional styling:',
    fenced('css', lines(['main {', '  padding: 24px;', '  background: linear-gradient(#e0f7fa, #ffffff);', '  font-family: system-ui, sans-serif;', '}', 'h1 { margin: 0; }'])),
  ]),
  // 5. a <script> it was told not to write (the picture is still; the markup is kept)
  fenced('html', '<h1>Coral</h1><p id="x">Reefs</p><script>document.getElementById("x").textContent = "changed";</script>'),
];

export default (test) => {
  // ------------------------------------------------------------------------- what is SENT (A8)

  test('planFor: a code kind adds its system instruction and 4096 max_tokens; prose keeps SYSTEM and 2048', () => {
    const bind = bindArrivals({ values: [valueOf('text', 'a sun')], labels: ['brief'], instruction: 'Draw the brief.' });
    const svg = planFor({ part: { id: 'a', settings: { instruction: 'Draw the brief.', code: 'svg', shape: 'text' } }, bind });
    assert.ok(svg.assembled.system.startsWith(SYSTEM), 'the frozen SYSTEM stays first');
    assert.ok(svg.assembled.system.includes('xmlns="http://www.w3.org/2000/svg"'), 'the SVG rules name the namespace');
    assert.equal(svg.call.maxTokens, MAX_TOKENS_CODE);
    assert.equal(svg.call.maxTokens, 4096);
    for (const [code, marker] of [['p5', 'createCanvas(windowWidth, windowHeight)'], ['three', 'THREE is already a global'], ['html', 'no <!DOCTYPE>']]) {
      const plan = planFor({ part: { id: 'a', settings: { instruction: 'x', code, shape: 'text' } }, bind });
      assert.ok(plan.assembled.system.includes(marker), `${code}: ${marker}`);
      assert.ok(plan.assembled.system.includes('exactly one'), `${code}: ONE fenced block`);
      assert.equal(plan.call.maxTokens, 4096);
      assert.equal(plan.call.code, code);
    }
    const prose = planFor({ part: { id: 'a', settings: { instruction: 'x' } }, bind });
    assert.equal(prose.assembled.system, SYSTEM);
    assert.equal(prose.call.maxTokens, MAX_TOKENS_TEXT);
    // a list answer is never code, whatever `code` says
    const list = planFor({ part: { id: 'a', settings: { instruction: 'x', code: 'svg', shape: 'list' } }, bind });
    assert.equal(list.assembled.system, SYSTEM);
    assert.equal(list.call.maxTokens, 2048);
    assert.equal(codeKindOf({ code: 'p5' }), 'p5');
    assert.equal(codeKindOf({ code: 'p5', shape: 'json' }), '');
    assert.equal(maxTokensOf({ code: 'three' }), 4096);
    assert.equal(codeSystem('nope'), '');
  });

  test('the p5 and three system messages match what the guest provides', () => {
    const p5 = codeSystem('p5');
    for (const rule of ['no new p5', 'only inside setup() and draw()', 'Declare every variable', 'no preload', 'background(']) {
      assert.ok(p5.includes(rule), `p5 says: ${rule}`);
    }
    const three = codeSystem('three');
    for (const rule of ['no import map', 'window.onload', 'window.innerWidth', 'AmbientLight', 'renderer.render(scene, camera) once']) {
      assert.ok(three.includes(rule), `three says: ${rule}`);
    }
    for (const kind of ['svg', 'p5', 'three', 'html']) assert.ok(codeSystem(kind).length < 2400, `${kind}: short enough for a 12B model`);
  });

  test('the Write-… presets and the creative template send the task only, and the rules ride the system message', () => {
    for (const p of creativePresets().filter((x) => x.id.startsWith('write-'))) {
      const plan = planFor({ part: { id: 'w', settings: p.settings }, bind: { params: [], unused: [], unwired: [] } });
      assert.ok(plan.assembled.prompt.endsWith(p.settings.instruction), `${p.id}: the task is the instruction`);
      assert.ok(plan.assembled.system.includes('You write ONE'), `${p.id}: the system message carries the rules`);
      assert.equal(plan.call.maxTokens, 4096);
    }
    const write = templateCreative.doc.parts.find((/** @type {any} */ x) => x.id === 'c_write_p5');
    assert.doesNotMatch(write.settings.instruction, /Reply with only/);
    assert.equal(write.settings.code, 'p5');
  });

  // -------------------------------------------------------------------------------------- SVG

  test('sanitizeSvg repairs the namespaces an <img> needs: xmlns on the root, xmlns:xlink when used', () => {
    const bare = sanitizeSvg('<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');
    assert.equal(bare.ok, true);
    assert.ok(bare.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), bare.svg);
    const xl = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><defs><circle id="c" r="2"/></defs><use xlink:href="#c"/></svg>');
    assert.ok(xl.svg.includes('xmlns:xlink="http://www.w3.org/1999/xlink"'), xl.svg);
    assert.ok(xl.svg.includes('xlink:href="#c"'));
    const kept = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect/></svg>');
    assert.equal(kept.svg.split('xmlns=').length - 1, 1, 'never declared twice');
    assert.equal(kept.svg.split('xmlns:xlink=').length - 1, 1);
    const wrong = sanitizeSvg('<svg xmlns="http://www.w3.org/1999/xhtml"><rect/></svg>');
    assert.ok(wrong.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), 'a refused foreign namespace is replaced');
    const noXlink = sanitizeSvg('<svg><rect/></svg>');
    assert.ok(!noXlink.svg.includes('xlink'), 'xlink only when something uses it');
  });

  test('five realistic SVG answers: every one becomes a picture an <img> can show', () => {
    for (const [i, answer] of SVG_ANSWERS.entries()) {
      const value = codeValue(answer, 'svg');
      const code = codeFor('svg', value.data);
      const clean = sanitizeSvg(code);
      assert.equal(clean.ok, true, `answer ${i + 1}: ${clean.error}`);
      assert.match(clean.svg, /^<svg\b[^>]*\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `answer ${i + 1} declares the SVG namespace`);
      if (clean.svg.includes('xlink:')) assert.ok(clean.svg.includes('xmlns:xlink='), `answer ${i + 1} declares xlink`);
      assert.ok(!/```|Here is|Let me know/.test(clean.svg), `answer ${i + 1}: no fence or prose left`);
    }
    assert.ok(sanitizeSvg(codeFor('svg', codeValue(SVG_ANSWERS[2], 'svg').data)).svg.includes('Sunny Day &amp; Hills'),
      '&nbsp; is a space on the picture, and a bare & is escaped');
    assert.ok(sanitizeSvg(codeFor('svg', codeValue(SVG_ANSWERS[3], 'svg').data)).removed.includes('animation'),
      'the forbidden <animate> is dropped and said');
  });

  // --------------------------------------------------------------------------------------- p5

  test('scriptOf: a sketch that came back as a web page runs its largest inline script', () => {
    const page = lines([
      '<!DOCTYPE html><html><head>',
      '<script src="p5.min.js"></script>',
      '<script type="importmap">{"imports":{}}</script>',
      '<script type="x-shader/x-vertex">void main() {}</script>',
      '</head><body>',
      '  <script>',
      '    function setup() { createCanvas(4, 4); }',
      '    function draw() { background(0); }',
      '  </script>',
      '</body></html>',
    ]);
    const code = scriptOf(page);
    assert.equal(code, lines(['function setup() { createCanvas(4, 4); }', 'function draw() { background(0); }']), 'dedented, the body only');
    assert.equal(codeValue(fenced('html', page), 'p5').data, code, 'the Instruction lands the script, not the page');
    assert.equal(codeFor('p5', fenced('html', page)), code, 'and so does an ordinary Instruction wired into the box');
    assert.equal(scriptOf('function setup() {}'), 'function setup() {}', 'JavaScript is left alone');
    assert.equal(scriptOf('<p>no script</p>'), '<p>no script</p>', 'markup with no script is left for the error to explain');
    assert.equal(scriptOf('<script>\nlet a = 1;\nfunction draw() {'), 'let a = 1;\nfunction draw() {', 'an unclosed script runs to the end');
  });

  test('five realistic p5 answers: three draw, two say what to fix in the words of the fix', () => {
    const results = P5_ANSWERS.map((a) => {
      const code = codeValue(a, 'p5').data;
      return { code, compiles: compiles(shapeForGuest('p5', code)), run: runP5(code) };
    });
    for (const [i, r] of results.entries()) assert.equal(r.compiles, true, `answer ${i + 1} compiles as the guest compiles it`);
    assert.equal(results[0].run.ok, true, results[0].run.error);
    assert.ok(results[0].run.calls.includes('createCanvas'));
    assert.equal(results[1].run.ok, true, `the HTML page's inline script draws: ${results[1].run.error}`);
    assert.ok(!results[1].code.includes('<'), 'no markup reached the guest');
    assert.equal(results[4].run.ok, true, results[4].run.error);
    assert.equal(results[4].run.mode, 'instance', '`new p5(sketch)` is handed to the guest’s instance door');
    assert.ok(results[4].run.calls.includes('createCanvas'));
    // the two that cannot run are EXPLAINED
    assert.equal(results[2].run.ok, false);
    assert.equal(results[2].run.error, 'color is not defined');
    const why3 = explainGuestError(results[2].run.error, 'p5');
    assert.equal(why3, t('parts.genErrP5Function', { name: 'color' }));
    assert.match(why3, /setup\(\) or draw\(\)/);
    assert.equal(results[3].run.ok, false);
    assert.equal(explainGuestError(results[3].run.error, 'p5'), t('parts.genErrDeclare', { name: 'spin' }));
  });

  test('handing `new p5(sketch)` over keeps every line where it was, and leaves other code alone', () => {
    const src = lines(['const s = (p) => {', '  p.setup = () => {};', '};', 'let app = new p5(s, document.body);']);
    const out = shapeForGuest('p5', src).split(NL);
    assert.equal(out[3], 'return s;');
    assert.equal(out.length, 4, 'no trailer for an instance sketch');
    const mid = lines(['new p5(s);', 'console.log(1);']);
    assert.ok(shapeForGuest('p5', mid).startsWith('new p5(s);'), 'only the LAST statement is handed over');
  });

  // ------------------------------------------------------------------------------------ three

  test('THREE_PRELUDE: a setAnimationLoop-only scene paints its first frame before the snapshot', async () => {
    const r = await runThree(codeValue(THREE_ANSWERS[2], 'three').data);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.made.loops, 1, 'the loop was still registered with three');
    assert.ok(r.made.renders >= 1, 'and its callback ran once, after the top level, before the picture');
    assert.equal(r.made.renderers[0].opts.canvas, r.canvas, 'into the guest canvas');
    assert.equal(r.made.renderers[0].opts.preserveDrawingBuffer, true);
    const first = shapeForGuest('three', 'renderer.render(1, 2);').split(NL)[0];
    assert.match(first, /^const THREE = [\s\S]*lol\.canvas\); renderer\.render\(1, 2\);$/, 'the prelude stays on line 1');
  });

  test('five realistic three.js answers: four draw, one says which add-on is missing', async () => {
    const runs = [];
    for (const a of THREE_ANSWERS) {
      const code = codeValue(a, 'three').data;
      runs.push({ code, compiles: compiles(shapeForGuest('three', code)), run: await runThree(code) });
    }
    for (const [i, r] of runs.entries()) assert.equal(r.compiles, true, `answer ${i + 1} compiles`);
    for (const i of [0, 1, 2, 3]) {
      assert.equal(runs[i].run.ok, true, `answer ${i + 1}: ${runs[i].run.error}`);
      assert.ok(runs[i].run.made.renders >= 1, `answer ${i + 1} renders before the snapshot`);
    }
    assert.ok(!runs[1].code.includes('<script'), 'the module page became its script');
    assert.ok(!/^\s*import\b/m.test(shapeForGuest('three', runs[1].code)), 'and its imports are blanked');
    assert.match(shapeForGuest('three', runs[3].code), /\(function \(f\) \{ f\(\); \}\)\( init\);/, "the 'load' listener is called right there");
    assert.equal(runs[4].run.ok, false);
    assert.equal(runs[4].run.error, 'GLTFLoader is not defined', 'window.onload was called (the salvage ran it)');
    assert.equal(explainGuestError(runs[4].run.error, 'three'), t('parts.genErrThreeAddon', { name: 'GLTFLoader' }));
  });

  // ------------------------------------------------------------------------------------- html

  test('five realistic HTML answers: markup only, no fence, no prose, the page not the stylesheet', () => {
    for (const [i, a] of HTML_ANSWERS.entries()) {
      const code = codeFor('html', codeValue(a, 'html').data);
      assert.ok(/^\s*</.test(code), `answer ${i + 1} starts with markup`);
      assert.ok(!/```|Sure!|Let me know|And some optional/.test(code), `answer ${i + 1}: ${code.slice(0, 60)}`);
    }
    assert.match(codeFor('html', codeValue(HTML_ANSWERS[3], 'html').data), /^<main>/, 'the html block, not the longer css one');
    assert.match(codeFor('html', codeValue(HTML_ANSWERS[2], 'html').data), /^<div style="padding:16px">[\s\S]*<\/div>$/);
  });

  // ---------------------------------------------------------------------- explainGuestError

  test('explainGuestError: the fix, in words, for the errors a model’s code really throws', () => {
    assert.equal(explainGuestError('color is not defined', 'p5'), t('parts.genErrP5Function', { name: 'color' }));
    assert.match(explainGuestError('color is not defined', 'p5'), /setup\(\) or draw\(\)/);
    assert.equal(explainGuestError('Uncaught ReferenceError: width is not defined', 'p5'), t('parts.genErrP5Value', { name: 'width' }));
    assert.equal(explainGuestError('angle is not defined', 'p5'), t('parts.genErrDeclare', { name: 'angle' }));
    assert.equal(explainGuestError('ReferenceError: scene is not defined', 'three'), t('parts.genErrDeclare', { name: 'scene' }));
    assert.equal(explainGuestError("Cannot access 'mesh' before initialization", 'three'), t('parts.genErrTooEarly', { name: 'mesh' }));
    assert.equal(explainGuestError('EffectComposer is not defined', 'three'), t('parts.genErrThreeAddon', { name: 'EffectComposer' }));
    assert.equal(explainGuestError('TypeError: THREE.Geometry is not a constructor', 'three'), t('parts.genErrThreeGone', { name: 'Geometry' }));
    assert.equal(explainGuestError("Unexpected token '<'", 'p5'), t('parts.genErrHtmlNotJs'));
    assert.equal(explainGuestError('Cannot use import statement outside a module', 'three'), t('parts.genErrImport'));
    assert.equal(explainGuestError('something odd happened', 'p5'), '', 'nothing better to say: say nothing');
    assert.equal(explainGuestError('color is not defined', 'svg'), '', 'markup modes have no JavaScript to explain');
    assert.equal(explainGuestError(null, 'p5'), '');
  });

  // ------------------------------------------------------------------ the declared call (A1)

  test('the transcript declares the seed: pinned, new each run, and the one the last run used', () => {
    assert.equal(seedText(48213), t('computer.genTxSeedPinned', { seed: 48213 }));
    assert.equal(seedText(null), t('computer.genTxSeedNew'));
    assert.equal(seedText(null, 777), t('computer.genTxSeedNewLast', { seed: 777 }));
    const line = callLine({ model: 'gemma4:12b', shape: 'text', maxTokens: 4096, seed: 12, priority: 'background' });
    assert.match(line, /max_tokens: 4096/);
    assert.match(line, /seed: 12 \(pinned\)/);
    const cost = costView({ stats: { ms: 1000, tokens: 9, calls: 1, seed: 5, pinned: false, cut: true }, farm: 'F', value: null });
    assert.equal(cost.seed, 5);
    assert.equal(cost.seedLine, t('computer.genCostSeed', { seed: 5 }));
    assert.equal(cost.cut, true);
    const plan = planFor({ part: { id: 'a', settings: { instruction: 'x', seed: '31' } }, bind: bindArrivals({ values: [], labels: [], instruction: 'x' }) });
    assert.equal(plan.call.seed, 31, 'planFor declares a pinned seed as a number');
  });

  test('the run bar offers "Run everything again" only when a run found nothing to do', () => {
    assert.equal(nothingRan({ ran: 0, errors: [], barred: [] }), true);
    assert.equal(nothingRan({ ran: 2, errors: [] }), false);
    assert.equal(nothingRan({ ran: 0, errors: [{ partId: 'a', message: 'x' }] }), false);
    assert.equal(nothingRan({ ran: 0, cancelled: true }), false);
    assert.equal(nothingRan({ ran: 0, busy: true }), false);
    assert.equal(nothingRan({ ran: 0, capped: { cap: 1 } }), false);
    assert.equal(nothingRan({ ran: 0, barred: ['x'] }), false);
    assert.equal(nothingRan(null), false);
  });

  // ---------------------------------------------------------------- the bound doc door (A2)

  test('A2 from the document door: a braced mention is marked, a bare one is not', () => {
    const doc = {
      parts: [
        { id: 'n', type: 'note', settings: {}, value: valueOf('text', 'cats'), state: 'done' },
        { id: 'i', type: 'ask', settings: { instruction: 'The topic of the essay is {topic}. Stay on topic.', inlineVars: true }, value: null, state: 'idle' },
      ],
      wires: [{ id: 'w', from: 'n', to: 'i', port: 'in', label: 'topic' }],
    };
    const bound = bindInputs(/** @type {any} */ (doc), 'i');
    assert.equal(/** @type {any} */ (bound.params[0]).mentionedBraced, true);
    const plan = planFor({ part: doc.parts[1], bind: bound });
    assert.equal(plan.assembled.prompt, '# Instruction\nThe topic of the essay is cats. Stay on topic.');
  });
};
