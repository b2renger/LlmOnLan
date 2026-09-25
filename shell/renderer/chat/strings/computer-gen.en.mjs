// @ts-check
// Package A's strings (critic R1, "Generation": seed, length, prompts, code answers). A NEW file
// per package, registered into the namespaces the modules already speak (`parts`, `computer`),
// exactly as the parts-*.en.mjs files decorate `parts` — so no other package's table is touched.
//
// Two kinds of text live here, and they are kept apart on purpose:
//   - PROMPT TEXT (`genSystem*`): what the model reads when an Instruction answers in code. These
//     are written for gemma4:12b — short, explicit, one skeleton each, "exactly one code block".
//     Each one matches what sandbox/runner.html really provides: a strict-mode function body, p5
//     globals only after setup() starts, no network, no import, a picture taken of the first frame.
//     Changing one changes every code answer the Computer gives, so change them deliberately.
//   - CHROME: the seed row, the cut-off sentences, the run bar's "Run everything again", the
//     transcript's call line and the guest-error explanations.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  // ---- the seed row on an Instruction (A1) --------------------------------------------------
  genSeed: 'Seed',
  genSeedNew: 'new each run',
  // Critic S1-13: the sameness a pinned seed promises is the Computer's OWN cache. Asked the farm
  // again with the same seed, Qwen3.8 repeated itself and gemma4:12b (through Ollama) did not.
  genSeedHint: 'Empty: a new seed every run, so pressing ▶ again gives a new answer. A number: the same seed every time. While this window is open the Computer re-uses the answer it already has. Asked again, most models repeat it, but some still vary.',
  genSeedDice: '🎲',
  genSeedDiceTitle: 'Pin a random seed',
  genSeedClear: '✕',
  genSeedClearTitle: 'Back to a new seed each run',
  // Critic R2, N1: said INSIDE the Seed row now, so "seed" is not repeated.
  genSeedUsed: 'last run: {seed}',
  genSeedUsedPinned: 'last run: {seed} (pinned)',
  genSeedKeep: 'Keep',
  genSeedKeepTitle: 'Pin this seed: the next run re-uses this answer instead of asking again.',

  // ---- answers that hit max_tokens (A8) -----------------------------------------------------
  errCutOff: 'The answer was cut off after {n} tokens, so the code is incomplete. Ask for something smaller.',
  errCutOffData: 'The answer was cut off after {n} tokens, so the list or JSON is incomplete. Ask for fewer or shorter items.',
  genCutChip: 'cut off after {n} tokens — the end of the answer is missing',
  // Critic S1-3: the tokens went on THINKING (reasoning_content counts toward max_tokens), so
  // "ask for something smaller" would be wrong advice.
  errCutOffThinking: 'The model used all {n} tokens thinking before it finished. Run it again, or pick a model that thinks less in Model.',

  // ---- what the model is told when an Instruction answers in code (A8) ----------------------
  genSystemSvg: [
    'You write ONE still SVG picture.',
    'Reply with exactly one ```svg code block and nothing else — no words before or after it.',
    'Rules:',
    '1. Start with: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300"> and end with </svg>.',
    '2. Valid XML: every attribute in double quotes, every element closed (<circle ... />).',
    '3. Use only: rect, circle, ellipse, line, polyline, polygon, path, text, g, defs, linearGradient, radialGradient, stop, clipPath, mask, pattern, filter.',
    '4. No <script>, no <foreignObject>, no <image>, no links, no web fonts, no animation (<animate>, <set>). It is a still picture.',
    '5. Colours as #rrggbb. At most 80 elements.',
    'Example:',
    '```svg',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">',
    '  <rect width="400" height="300" fill="#f5efe4"/>',
    '  <circle cx="300" cy="80" r="40" fill="#f2b134"/>',
    '  <path d="M0 240 Q100 150 200 225 T400 210 V300 H0 Z" fill="#5b8c5a"/>',
    '</svg>',
    '```',
  ].join('\n'),
  genSystemP5: [
    'You write ONE p5.js sketch (p5.js 1.11, global mode). p5 is already loaded. There is no network.',
    'Reply with exactly one ```javascript code block and nothing else.',
    'Rules:',
    '1. Plain JavaScript only: no HTML, no <script>, no import, no require, no new p5(...).',
    '2. Define function setup() and function draw(). The first line of setup() is createCanvas(windowWidth, windowHeight).',
    '3. At the top of the file only declare variables (let x;). Call p5 functions and use p5 constants (random, color, width, PI…) only inside setup() and draw().',
    '4. Declare every variable with let or const.',
    '5. Do not load anything: no preload, no loadImage, loadFont, loadJSON or loadSound. Draw everything with code. No p5.sound.',
    '6. The first frame is saved as a picture: draw() starts with background(...) and paints the whole scene.',
    'Skeleton:',
    '```javascript',
    'let t;',
    'function setup() {',
    '  createCanvas(windowWidth, windowHeight);',
    '  colorMode(HSB, 360, 100, 100);',
    '  t = 0;',
    '}',
    'function draw() {',
    '  background(230, 30, 15);',
    '  // draw the scene here, using width and height',
    '  t += 0.01;',
    '}',
    '```',
  ].join('\n'),
  genSystemThree: [
    'You write ONE three.js scene (three.js r160). THREE is already a global. There is no network.',
    'Reply with exactly one ```javascript code block and nothing else.',
    'Rules:',
    '1. Plain JavaScript only: no HTML, no <script>, no import, no import map, no addons (no OrbitControls, no loaders), no textures or files.',
    '2. Do not wait for window.onload or DOMContentLoaded: run everything at the top level.',
    '3. Size: const W = window.innerWidth, H = window.innerHeight.',
    '4. Build: scene, PerspectiveCamera(50, W / H, 0.1, 100), renderer = new THREE.WebGLRenderer({ antialias: true }), renderer.setSize(W, H), document.body.appendChild(renderer.domElement).',
    '5. MeshStandardMaterial needs light: add an AmbientLight and a DirectionalLight.',
    '6. Call renderer.render(scene, camera) once, then animate with requestAnimationFrame.',
    'Skeleton:',
    '```javascript',
    'const W = window.innerWidth, H = window.innerHeight;',
    'const scene = new THREE.Scene();',
    'scene.background = new THREE.Color(0x1f1f23);',
    'const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);',
    'camera.position.z = 5;',
    'const renderer = new THREE.WebGLRenderer({ antialias: true });',
    'renderer.setSize(W, H);',
    'document.body.appendChild(renderer.domElement);',
    'scene.add(new THREE.AmbientLight(0xffffff, 0.5));',
    'const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(3, 4, 5); scene.add(sun);',
    'const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1), new THREE.MeshStandardMaterial({ color: 0x66aaff }));',
    'scene.add(mesh);',
    'function animate() {',
    '  requestAnimationFrame(animate);',
    '  mesh.rotation.y += 0.01;',
    '  renderer.render(scene, camera);',
    '}',
    'renderer.render(scene, camera);',
    'animate();',
    '```',
  ].join('\n'),
  genSystemHtml: [
    'You write ONE small web page fragment. It is shown as a still picture, window.innerWidth pixels wide. There is no network and no JavaScript.',
    'Reply with exactly one ```html code block and nothing else.',
    'Rules:',
    '1. Write only what goes inside <body>: no <!DOCTYPE>, <html>, <head> or <body> tags.',
    '2. Put all CSS in one <style> element at the top. Use system fonts (font-family: system-ui, sans-serif).',
    '3. No <script>, no onclick or other handlers, no external links, images, fonts or iframes. Use CSS colours, gradients, emoji or inline <svg> instead of pictures.',
    '4. Keep it to one screen.',
    'Skeleton:',
    '```html',
    '<style>',
    '  .card { font-family: system-ui, sans-serif; padding: 20px; background: #fbf7ef; border-radius: 12px; }',
    '  h1 { margin: 0 0 8px; color: #b0452f; }',
    '</style>',
    '<div class="card">',
    '  <h1>Title</h1>',
    '  <p>One short paragraph.</p>',
    '</div>',
    '```',
  ].join('\n'),

  // ---- a guest error, said in the words of the fix (A8, graph/unfence.mjs explainGuestError) --
  genErrP5Function: '{name} is a p5 function: call it inside setup() or draw(), not at the top of the sketch.',
  genErrP5Value: '{name} is a p5 value: use it inside setup() or draw(), not at the top of the sketch.',
  genErrDeclare: '{name} was never declared: add “let {name};” at the top of the code.',
  genErrTooEarly: '{name} is used before the line that creates it. Move that line up, or use {name} only inside draw() or animate().',
  genErrThreeAddon: '{name} is a three.js add-on this sandbox does not have. Build the scene from THREE’s own shapes, lights and materials instead.',
  genErrThreeGone: 'THREE.{name} does not exist in three.js r160. Use THREE.BufferGeometry or one of the built-in shapes.',
  genErrHtmlNotJs: 'This is HTML, but this box runs JavaScript. Ask for plain JavaScript only, or wire the answer into an HTML page box.',
  genErrImport: 'The sandbox already has p5.js and three.js loaded: remove the import lines.',
});

registerStrings('computer', {
  // ---- the run bar: nothing is stale, so offer the re-run with new seeds (A1) ---------------
  genRunAgain: 'Run everything again',
  genRunAgainHint: 'Runs every box again. Instructions set to “new each run” get new seeds, so their answers change.',

  // ---- the transcript's declared call, now with the seed and the real max_tokens (A1, A8) --
  genTxParams: 'model: {model} · response_format: {format} · max_tokens: {maxTokens} · seed: {seed} · priority: {priority}',
  genTxSeedNew: 'new each run',
  genTxSeedNewLast: 'new each run (last run: {seed})',
  genTxSeedPinned: '{seed} (pinned)',
  genCostSeed: 'seed {seed}',
  genCostSeedPinned: 'seed {seed} (pinned)',
  genCostCut: 'The answer hit max_tokens and was cut off: the end is missing.',
});
