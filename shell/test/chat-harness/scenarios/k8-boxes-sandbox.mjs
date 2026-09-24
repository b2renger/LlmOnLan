// @ts-check
// Critic R1 A8, GUEST SIDE (Package C): "write SVG, p5js and threejs do not work".
//
// Two of the reasons were the guest's, and both are asserted here with the REAL guest (the opaque
// sandbox iframe, the vendored three.js and p5.js), with the farm gone:
//   1. The guest frame sits off-screen, where Chromium throttles animation frames, and the box
//      photographs it right after the run. A three.js scene that renders only inside
//      `renderer.setAnimationLoop`, or a p5 sketch drawn only by p5's own loop, came back BLANK.
//      The runner now calls every callback a run queued once, before it answers (runner.html
//      `flushFirstFrame`) — so these pictures must hold more than one colour.
//   2. The box's Width and Height were only a hint: the frame was always 640 x 480, so
//      `windowWidth`/`innerWidth` lied and a 500 x 200 box got a squashed 500 x 375 picture. K-4:
//      the frame IS the box's size now — so a 500 x 200 Preview photographs 500 x 200.
// Plus the sentence a failed sketch shows: the engine's message and, when Package A's explainer
// knows the mistake, what to do about it.
//
// Boxes are placed and filled through the debug door (setup); what is under test is the guest.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** The Computer, shown, an empty document open, the farm gone (nothing here may think). */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    const d = await h.computer.doc();
    if (d.parts.length) await h.computer.remove(d.parts.map((/** @type {any} */ p) => p.id));
    await h.setFarm(null);
    await h.mock.reset();
    return true;
}

/** Wait until a part settles, and return it. */
const settled = (/** @type {any} */ h, /** @type {string} */ id, timeout = 30000) => h.waitFor((pid) => {
    const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === pid);
    return p && (p.state === 'done' || p.state === 'error') ? { state: p.state, error: p.error || null } : null;
}, { args: [id], timeout });

/**
 * Decode a box's picture: its size, how much of it is opaque, and how many distinct colours (in
 * 4-bit buckets) it holds. An empty canvas is a valid PNG, so "a picture came back" proves nothing.
 */
const pixels = (/** @type {any} */ h, /** @type {string} */ id) => h.eval(async (pid) => {
    const img = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-tile');
    if (!img) return null;
    const src = String(img.getAttribute('src') || '');
    const im = new Image();
    await new Promise((resolve, reject) => { im.onload = resolve; im.onerror = () => reject(new Error('the tile did not decode')); im.src = src; });
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = /** @type {any} */ (c.getContext('2d'));
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const colours = new Set();
    let opaque = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
        n++;
        if (d[i + 3] > 16) { opaque++; colours.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)); }
    }
    return { kind: src.slice(5, src.indexOf(';')), w: im.naturalWidth, h: im.naturalHeight, opaque: n ? opaque / n : 0, colours: colours.size };
}, id);

/** A Preview in `mode`, `w` x `h`, holding `source`, run with its own ▶. → the settled part */
async function draw(/** @type {any} */ h, /** @type {string} */ mode, /** @type {string} */ source, /** @type {number} */ w, /** @type {number} */ hh) {
    const id = await h.computer.place('preview', 40, 40);
    await h.computer.set(id, { mode, source, w, h: hh });
    await h.computer.play(id);
    const out = await settled(h, id);
    return { id, ...out };
}

/** three.js, drawn ONLY inside setAnimationLoop — nothing renders synchronously. */
const THREE_LOOP_ONLY = [
    'const W = window.innerWidth, H = window.innerHeight;',
    'const scene = new THREE.Scene();',
    'scene.background = new THREE.Color(0x203040);',
    'const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);',
    'camera.position.z = 4;',
    'const renderer = new THREE.WebGLRenderer({ antialias: true });',
    'renderer.setSize(W, H);',
    'document.body.appendChild(renderer.domElement);',
    'scene.add(new THREE.AmbientLight(0xffffff, 0.6));',
    'const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(3, 4, 5); scene.add(sun);',
    'const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), new THREE.MeshStandardMaterial({ color: 0xff8844 }));',
    'mesh.rotation.set(0.5, 0.6, 0);',
    'scene.add(mesh);',
    'renderer.setAnimationLoop(() => { mesh.rotation.y += 0.01; renderer.render(scene, camera); });',
].join('\n');

/** three.js, drawn ONLY by an rAF loop that is never called once by hand. */
const THREE_RAF_ONLY = [
    'const W = window.innerWidth, H = window.innerHeight;',
    'const scene = new THREE.Scene();',
    'scene.background = new THREE.Color(0x183028);',
    'const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);',
    'camera.position.z = 4;',
    'const renderer = new THREE.WebGLRenderer();',
    'renderer.setSize(W, H);',
    'document.body.appendChild(renderer.domElement);',
    'const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2), new THREE.MeshBasicMaterial({ color: 0x66ccff }));',
    'scene.add(mesh);',
    'function animate() { requestAnimationFrame(animate); mesh.rotation.y += 0.01; renderer.render(scene, camera); }',
    'requestAnimationFrame(animate);',
].join('\n');

/** p5 in INSTANCE mode: p5's own loop is the only painter (no hand-off trailer applies). */
const P5_INSTANCE_DRAW_ONLY = [
    'return function (p) {',
    '  p.setup = function () { p.createCanvas(p.windowWidth, p.windowHeight); };',
    '  p.draw = function () {',
    '    p.background(30, 40, 90);',
    '    p.noStroke();',
    '    p.fill(255, 200, 0);',
    '    p.circle(p.width / 2, p.height / 2, Math.min(p.width, p.height) * 0.6);',
    '  };',
    '};',
].join('\n');

/** p5 in GLOBAL mode, painting only in draw(), sized by windowWidth/windowHeight. */
const P5_GLOBAL_DRAW_ONLY = [
    'let t;',
    'function setup() {',
    '  createCanvas(windowWidth, windowHeight);',
    '  t = 0;',
    '}',
    'function draw() {',
    '  background(240, 230, 210);',
    '  noStroke();',
    '  fill(200, 60, 40);',
    '  rect(10, 10, width - 20, height / 2);',
    '  t += 0.01;',
    '}',
].join('\n');

export default [
    {
        name: 'k8-boxes-sandbox-a-three-scene-drawn-only-in-setAnimationLoop-photographs-non-blank',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const a = await draw(h, 'three', THREE_LOOP_ONLY, 480, 320);
            h.eq(a.state, 'done', `the scene ran: ${a.error || ''}`);
            const pa = await pixels(h, a.id);
            h.assert(pa && pa.kind === 'image/png', `a PNG came back: ${JSON.stringify(pa)}`);
            h.assert(pa.opaque > 0.9, `the picture is painted, not transparent (opaque ${pa.opaque.toFixed(2)})`);
            h.assert(pa.colours >= 3, `and holds a scene — background, lit faces — not one flat colour (${pa.colours} colours)`);

            const b = await draw(h, 'three', THREE_RAF_ONLY, 480, 320);
            h.eq(b.state, 'done', `the rAF-only scene ran: ${b.error || ''}`);
            const pb = await pixels(h, b.id);
            h.assert(pb.opaque > 0.9 && pb.colours >= 2, `an rAF-only loop photographs non-blank: ${JSON.stringify(pb)}`);
            await h.screenshot('k8-boxes-three-loop-only');
            h.note(`setAnimationLoop: ${pa.w}x${pa.h}, ${pa.colours} colours · rAF: ${pb.colours} colours`);
        },
    },
    {
        name: 'k8-boxes-sandbox-a-p5-sketch-drawn-only-by-its-loop-photographs-non-blank',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const a = await draw(h, 'p5', P5_INSTANCE_DRAW_ONLY, 400, 300);
            h.eq(a.state, 'done', `the instance-mode sketch ran: ${a.error || ''}`);
            const pa = await pixels(h, a.id);
            h.assert(pa && pa.opaque > 0.9 && pa.colours >= 2, `p5's own loop, photographed non-blank: ${JSON.stringify(pa)}`);

            const b = await draw(h, 'p5', P5_GLOBAL_DRAW_ONLY, 400, 300);
            h.eq(b.state, 'done', `the global-mode sketch ran: ${b.error || ''}`);
            const pb = await pixels(h, b.id);
            h.assert(pb && pb.opaque > 0.9 && pb.colours >= 2, `draw()-only, photographed non-blank: ${JSON.stringify(pb)}`);
            await h.screenshot('k8-boxes-p5-loop-only');
            h.note(`p5 instance: ${pa.colours} colours · p5 global: ${pb.colours} colours`);
        },
    },
    {
        name: 'k8-boxes-sandbox-a-500x200-preview-photographs-500x200',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            // windowWidth x windowHeight IS the box's Width x Height: the canvas is made from them,
            // so the picture's shape proves what the sketch was told.
            const p = await draw(h, 'p5', P5_GLOBAL_DRAW_ONLY, 500, 200);
            h.eq(p.state, 'done', `ran: ${p.error || ''}`);
            const px = await pixels(h, p.id);
            h.eq([px.w, px.h], [500, 200], 'a 500 x 200 Preview photographs 500 x 200');

            // The same for three.js (W and H from innerWidth/innerHeight) and a web page (the root).
            const t3 = await draw(h, 'three', THREE_LOOP_ONLY, 500, 200);
            h.eq(t3.state, 'done', `three ran: ${t3.error || ''}`);
            const p3 = await pixels(h, t3.id);
            h.eq([p3.w, p3.h], [500, 200], 'three.js: innerWidth x innerHeight is the box');

            const page = await draw(h, 'html', '<h1>Hello</h1><p>A page, 300 x 150.</p>', 300, 150);
            h.eq(page.state, 'done', `the page drew: ${page.error || ''}`);
            const pp = await pixels(h, page.id);
            h.eq([pp.w, pp.h], [300, 150], 'a web page is photographed at the box\'s size too');
            h.assert(pp.opaque > 0.9, `the paper fills the picture (opaque ${pp.opaque.toFixed(2)})`);

            // And the guest itself reports it: lol.size and innerWidth, read back through a sketch
            // that paints them as a width.
            const probe = await draw(h, 'p5', [
                'function setup() {',
                '  createCanvas(lol.size.w, lol.size.h);',
                '  noLoop();',
                '  background(window.innerWidth === 320 && window.innerHeight === 180 ? 0 : 255, 120, 60);',
                '}',
            ].join('\n'), 320, 180);
            h.eq(probe.state, 'done', `the probe ran: ${probe.error || ''}`);
            const inside = await h.eval(async (pid) => {
                const img = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-tile');
                const im = new Image();
                await new Promise((r) => { im.onload = r; im.src = String(img && img.getAttribute('src')); });
                const c = document.createElement('canvas');
                c.width = im.naturalWidth; c.height = im.naturalHeight;
                const g = /** @type {any} */ (c.getContext('2d'));
                g.drawImage(im, 0, 0);
                const d = g.getImageData(5, 5, 1, 1).data;
                return { w: im.naturalWidth, h: im.naturalHeight, red: d[0] };
            }, probe.id);
            h.eq([inside.w, inside.h], [320, 180], 'lol.size is the box');
            h.assert(inside.red < 40, `and innerWidth x innerHeight inside the guest are 320 x 180 (red channel ${inside.red})`);
            await h.screenshot('k8-boxes-sizes');
        },
    },
    {
        name: 'k8-boxes-sandbox-a-broken-sketch-says-what-went-wrong-and-what-to-do',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            // The mistake a model makes most: a p5 function called at the top of the sketch, before
            // p5 has made its functions global.
            const p = await draw(h, 'p5', [
                'let palette = [color(255, 0, 0)];',
                'function setup() { createCanvas(windowWidth, windowHeight); }',
                'function draw() { background(palette[0]); }',
            ].join('\n'), 300, 200);
            h.eq(p.state, 'error', 'a sketch that throws is an error, not a blank picture');
            const shown = await h.eval((pid) => {
                const box = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"]');
                const strip = box && box.querySelector('.graph-part-error');
                return strip ? strip.textContent : '';
            }, p.id);
            h.assert(/color is not defined/.test(String(p.error)), `the engine's own sentence is kept: ${p.error}`);
            const explainer = await h.eval(() => !!(window.LolComputer && window.LolComputer.app));
            h.assert(explainer, 'the app is up');
            const said = await h.eval((m) => window.LolComputer.app.t('parts.genErrP5Function', { name: m }), 'color');
            if (said && said !== 'parts.genErrP5Function') {
                h.assert(String(p.error).indexOf(said) >= 0, `and it says what to DO about it: ${p.error}`);
                h.assert(String(shown).indexOf('setup()') >= 0, `on the box, where the person is looking: ${shown}`);
            } else {
                h.note('Package A\'s explainGuestError strings are not registered in this build: only the engine sentence was checked');
            }
        },
    },
];
