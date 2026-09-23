// @ts-check
// K5-U1 (addendum KE-2, KE-3): the CREATIVE PRESETS — "p5.js sketch", "three.js scene", "SVG",
// "HTML page", "Markdown view" and the four "Write a …" Instructions. PURE: data, `t()` and a few
// small functions, so the tutorial's checkpoints (computer/tutorial/check.mjs, PURE) can ask
// "is this part a p5.js sketch?" in Node.
//
// FROZEN at the kickoff: the nine preset ids, which part type each one places, which group it lives
// in, its `match` keys, and the signatures of `creativePresets`, `presetOf`, `presetTitle`. U1 owns
// the starter code, the sizes, the glyphs and the keywords.
//
// WHY PRESETS AND NOT NEW PART TYPES. A p5.js sketch IS a Preview in `mode:'p5'` with code in it —
// the same run path, the same one sandbox guest, the same Save. A new type would be a second door
// to the same guest, a migration the day someone wants to switch a box from SVG to HTML, and a
// part type the engine knows by name. A preset is a row of DATA: a type plus the settings that
// make it that box. Every graph ever saved with a `preview` or a `render` keeps opening, because
// nothing about either type changed. (Addendum KE-2 records the decision.)
//
// THE STARTERS ARE ORDINARY CODE. Each one is what a tutorial or a model would write — p5 global
// mode with `setup()`/`draw()`, the three.js manual's first scene with `document.body.appendChild`
// — not code bent to fit our guest. What makes them draw in the guest is `shapeForGuest`
// (graph/unfence.mjs), so a starter that draws proves a model's sketch of the same shape will too.
//
// NOTHING HERE MAY CONTAIN a lint-forbidden token even inside a string: no `fetch(`, no
// `setInterval(`, no `innerHTML =`, no `eval(`, no `new Function(`, no `document.write`, no
// `blob:` (chat-lint rules 1, 2, 11, 13 scan string literals too).

import { t } from '../../core/i18n.mjs';
import '../../strings/parts-creative.en.mjs';

/** @typedef {import('../../core/types.mjs').PartPreset} PartPreset */

/** The preset ids, frozen. Lessons (`preset:'svg'`), the ＋ menu (`data-entry="svg"`) and the
 * harness all spell them this way. None may equal a part type. */
export const CREATIVE_PRESET_IDS = Object.freeze([
  'p5', 'three', 'svg', 'html', 'markdown',
  'write-p5', 'write-three', 'write-svg', 'write-html',
]);

/** What each creative box holds before anyone touches it. It must DRAW on the first ▶ with no
 * farm at all — that is the acceptance (KE-3). */
export const STARTER = Object.freeze({
  p5: [
    '// A ball that bounces off the walls.',
    '// Change a number: the picture redraws as you type.',
    'let x = 120;',
    'let y = 80;',
    'let dx = 3;',
    'let dy = 2;',
    'const r = 28;',
    '',
    'function setup() {',
    '  createCanvas(400, 300);',
    '  noStroke();',
    '}',
    '',
    'function draw() {',
    '  background(245, 240, 230);',
    '  fill(230, 90, 60);',
    '  circle(x, y, r * 2);',
    '  x += dx;',
    '  y += dy;',
    '  if (x < r || x > width - r) dx = -dx;',
    '  if (y < r || y > height - r) dy = -dy;',
    '}',
  ].join('\n'),
  three: [
    '// A cube that spins. THREE is already loaded: no import needed.',
    'const scene = new THREE.Scene();',
    'scene.background = new THREE.Color(0x1f1f23);',
    '',
    'const camera = new THREE.PerspectiveCamera(50, 400 / 300, 0.1, 100);',
    'camera.position.z = 4;',
    '',
    'const renderer = new THREE.WebGLRenderer({ antialias: true });',
    'renderer.setSize(400, 300);',
    'document.body.appendChild(renderer.domElement);',
    '',
    'const cube = new THREE.Mesh(',
    '  new THREE.BoxGeometry(1.4, 1.4, 1.4),',
    '  new THREE.MeshNormalMaterial()',
    ');',
    'cube.rotation.set(0.5, 0.7, 0);',
    'scene.add(cube);',
    '',
    'function animate() {',
    '  requestAnimationFrame(animate);',
    '  cube.rotation.x += 0.01;',
    '  cube.rotation.y += 0.015;',
    '  renderer.render(scene, camera);',
    '}',
    'animate();',
  ].join('\n'),
  svg: [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">',
    '  <rect width="400" height="300" fill="#f5efe4"/>',
    '  <circle cx="300" cy="80" r="40" fill="#f2b134"/>',
    '  <path d="M0 240 Q100 150 200 225 T400 210 V300 H0 Z" fill="#5b8c5a"/>',
    '  <text x="28" y="52" font-family="sans-serif" font-size="24" fill="#333333">Hello, SVG</text>',
    '</svg>',
  ].join('\n'),
  html: [
    '<style>',
    '  .card { padding: 16px 20px; background: #fbf7ef; color: #222222; border-radius: 10px; }',
    '  .card h1 { color: #b0452f; margin: 0 0 6px; }',
    '</style>',
    '<div class="card">',
    '  <h1>Hello from the Computer</h1>',
    '  <p>This page is drawn in the sandbox: it cannot reach the network or your files.</p>',
    '  <ul>',
    '    <li>Change these words</li>',
    '    <li>Wire an Instruction into this box to let the model write the page</li>',
    '  </ul>',
    '</div>',
  ].join('\n'),
  markdown: [
    '# A markdown view',
    '',
    'Write **markdown** here, or wire an Instruction into this box and its answer shows up formatted.',
    '',
    '- lists',
    '- tables',
    '- `code`',
  ].join('\n'),
});

/** The presets, with their strings resolved NOW (a function, so a locale registered later is
 * honoured). Order within a group is `order`; groups are ordered by the catalogue.
 * @returns {PartPreset[]} */
export function creativePresets() {
  /** @param {string} mode @param {number} w @param {number} h */
  const show = (mode, w, h) => ({ mode, source: /** @type {any} */ (STARTER)[mode], w, h, locked: false });
  return [
    {
      id: 'p5', type: 'preview', group: 'show', order: 810, glyph: 'p5',
      label: t('parts.creativeP5Label'), title: t('parts.creativeP5Label'), desc: t('parts.creativeP5Desc'),
      keywords: ['processing', 'sketch', 'animation', 'draw', 'canvas', 'javascript', 'creative coding', 'render'],
      settings: show('p5', 400, 300), match: { mode: 'p5' }, size: { w: 380, h: 520 },
    },
    {
      id: 'three', type: 'preview', group: 'show', order: 820, glyph: '3D',
      label: t('parts.creativeThreeLabel'), title: t('parts.creativeThreeLabel'), desc: t('parts.creativeThreeDesc'),
      keywords: ['3d', 'webgl', 'cube', 'scene', 'javascript', 'threejs', 'render'],
      settings: show('three', 400, 300), match: { mode: 'three' }, size: { w: 380, h: 520 },
    },
    {
      id: 'svg', type: 'preview', group: 'show', order: 830, glyph: 'SVG',
      label: t('parts.creativeSvgLabel'), title: t('parts.creativeSvgLabel'), desc: t('parts.creativeSvgDesc'),
      keywords: ['vector', 'picture', 'drawing', 'illustration', 'image', 'graphic', 'render', 'renderer'],
      settings: show('svg', 400, 300), match: { mode: 'svg' }, size: { w: 380, h: 460 },
    },
    {
      id: 'html', type: 'preview', group: 'show', order: 840, glyph: '<>',
      label: t('parts.creativeHtmlLabel'), title: t('parts.creativeHtmlLabel'), desc: t('parts.creativeHtmlDesc'),
      keywords: ['web', 'page', 'webpage', 'website', 'site', 'browser', 'css', 'render', 'renderer'],
      settings: show('html', 400, 300), match: { mode: 'html' }, size: { w: 380, h: 520 },
    },
    {
      id: 'markdown', type: 'preview', group: 'show', order: 850, glyph: 'MD',
      label: t('parts.creativeMarkdownLabel'), title: t('parts.creativeMarkdownLabel'), desc: t('parts.creativeMarkdownDesc'),
      keywords: ['text', 'report', 'format', 'document'],
      settings: show('markdown', 320, 240), match: { mode: 'markdown' }, size: { w: 340, h: 400 },
    },
    {
      id: 'write-p5', type: 'ask', group: 'think', order: 210, glyph: '✦',
      label: t('parts.writeP5Label'), title: t('parts.writeP5Label'), desc: t('parts.writeP5Desc'),
      keywords: ['code', 'generate', 'processing', 'sketch', 'animation', 'p5js'],
      settings: { instruction: t('parts.writeAskP5'), shape: 'text', code: 'p5' }, match: { code: 'p5' },
    },
    {
      id: 'write-three', type: 'ask', group: 'think', order: 220, glyph: '✦',
      label: t('parts.writeThreeLabel'), title: t('parts.writeThreeLabel'), desc: t('parts.writeThreeDesc'),
      keywords: ['code', 'generate', '3d', 'webgl', 'threejs'],
      settings: { instruction: t('parts.writeAskThree'), shape: 'text', code: 'three' }, match: { code: 'three' },
    },
    {
      id: 'write-svg', type: 'ask', group: 'think', order: 230, glyph: '✦',
      label: t('parts.writeSvgLabel'), title: t('parts.writeSvgLabel'), desc: t('parts.writeSvgDesc'),
      keywords: ['code', 'generate', 'vector', 'picture', 'drawing', 'image'],
      settings: { instruction: t('parts.writeAskSvg'), shape: 'text', code: 'svg' }, match: { code: 'svg' },
    },
    {
      id: 'write-html', type: 'ask', group: 'think', order: 240, glyph: '✦',
      label: t('parts.writeHtmlLabel'), title: t('parts.writeHtmlLabel'), desc: t('parts.writeHtmlDesc'),
      keywords: ['code', 'generate', 'web', 'page', 'webpage', 'website'],
      settings: { instruction: t('parts.writeAskHtml'), shape: 'text', code: 'html' }, match: { code: 'html' },
    },
  ].map((p) => /** @type {PartPreset} */ (/** @type {any} */ (p)));
}

/**
 * Which preset a placed part IS, by its `match` keys, or null. Frozen signature — the tutorial's
 * checkpoints and the box titles both ask it.
 * @param {{type: string, settings?: any}|null|undefined} part
 * @param {PartPreset[]} [presets]
 * @returns {string|null}
 */
export function presetOf(part, presets) {
  if (!part || typeof part !== 'object') return null;
  const s = part.settings && typeof part.settings === 'object' ? part.settings : {};
  for (const p of presets || creativePresets()) {
    if (p.type !== part.type) continue;
    const keys = Object.keys(p.match || {});
    if (keys.length && keys.every((k) => /** @type {any} */ (s)[k] === /** @type {any} */ (p.match)[k])) return p.id;
  }
  return null;
}

/** The box title for a part placed as a preset, or null (PartSpec.titleOf, KE-2).
 * @param {{type: string, settings?: any}} part @returns {string|null} */
export function presetTitle(part) {
  const id = presetOf(part);
  if (!id) return null;
  const p = creativePresets().find((x) => x.id === id);
  return p ? p.title : null;
}

/** What a box drawing in `mode` can be saved as, in button order: the code first, then the
 * picture when the mode makes one. Pure, so the unit test and the box read the same table.
 * @param {string} mode @returns {string[]} file extensions */
export function saveFormats(mode) {
  switch (mode) {
    case 'p5': case 'three': return ['js', 'png'];
    case 'html': return ['html', 'png'];
    case 'svg': return ['svg'];
    case 'markdown': return ['md'];
    default: return [];
  }
}
