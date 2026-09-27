// @ts-check
// COMPUTER_LIVE_PLAN, Builder E: what the model is told works in the REAL guest.
//
//   A three.js answer written the way the new system message asks — `lol.orbit(camera)` right
//   after the camera (K-7) — and one that reaches for OrbitControls anyway (the prelude's stand-in
//   now hands the camera to lol.orbit) both DRAW in the sandbox: state done, a picture with colour
//   in it. A p5 answer that reads mouseX/mouseY in draw() draws its first frame too. The ▶ is a
//   real click on the box.

const NL = '\n';

async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.computer
        && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    const d = await h.computer.doc();
    if (d.parts.length) await h.computer.remove(d.parts.map((/** @type {any} */ p) => p.id));
    await h.eval(() => { window.LolComputer.app.host.canvas.setView({ x: 0, y: 0, zoom: 1 }); return true; });
}

const settled = (/** @type {any} */ h, /** @type {string} */ id) => h.waitFor((pid) => {
    const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === pid);
    return p && (p.state === 'done' || p.state === 'error') ? { state: p.state, error: p.error || null } : null;
}, { args: [id], timeout: 30000 });

/** How many colours the box's picture holds (an empty canvas is a valid PNG too). */
const colours = (/** @type {any} */ h, /** @type {string} */ id) => h.eval(async (pid) => {
    const img = /** @type {any} */ (document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-tile'));
    if (!img) return 0;
    const im = new Image();
    await new Promise((resolve, reject) => { im.onload = resolve; im.onerror = reject; im.src = img.getAttribute('src'); });
    const c = document.createElement('canvas');
    c.width = 120; c.height = 90;
    const g = /** @type {any} */ (c.getContext('2d'));
    g.drawImage(im, 0, 0, 120, 90);
    const d = g.getImageData(0, 0, 120, 90).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 16) set.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
    return set.size;
}, id);

/** A box of `entry` with `code` in it, ▶ pressed for real, settled. */
async function drawCode(/** @type {any} */ h, /** @type {string} */ entry, /** @type {string} */ code, /** @type {number} */ x) {
    const id = await h.computer.add(entry);
    h.assert(id, `a ${entry} box was placed`);
    await h.computer.move(id, x, 40);
    await h.computer.set(id, { source: code });
    await h.eval(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))));
    const play = `#lolcomputer .graph-part-play[data-part="${id}"]`;
    const p = await h.input.click(play);
    const out = await settled(h, id).catch(async () => {
        const why = await h.eval((pid, sel, px, py) => {
            const part = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === pid);
            const hit = document.elementFromPoint(px, py);
            return { state: part && part.state, button: !!document.querySelector(sel), hit: hit ? `${hit.tagName}.${hit.className}` : null };
        }, id, play, p.x, p.y);
        throw new Error(`${entry} never settled: ${JSON.stringify(why)}`);
    });
    return { id, ...out };
}

const THREE_ORBIT = [
    'const W = window.innerWidth, H = window.innerHeight;',
    'const scene = new THREE.Scene();',
    'scene.background = new THREE.Color(0x1f1f23);',
    'const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);',
    'camera.position.set(0, 1.5, 5);',
    'lol.orbit(camera, { target: [0, 0.3, 0], damping: 0.1 });',
    'const renderer = new THREE.WebGLRenderer({ antialias: true });',
    'renderer.setSize(W, H);',
    'document.body.appendChild(renderer.domElement);',
    'scene.add(new THREE.AmbientLight(0xffffff, 0.5));',
    'const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(3, 4, 5); scene.add(sun);',
    'const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.3, 96, 16), new THREE.MeshStandardMaterial({ color: 0x66aaff }));',
    'scene.add(knot);',
    'function animate() {',
    '  requestAnimationFrame(animate);',
    '  knot.rotation.y += 0.01;',
    '  renderer.render(scene, camera);',
    '}',
    'renderer.render(scene, camera);',
    'animate();',
].join(NL);

const THREE_ORBITCONTROLS = [
    "import * as THREE from 'three';",
    "import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';",
    'const scene = new THREE.Scene();',
    'const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);',
    'camera.position.set(2, 2, 4);',
    'const renderer = new THREE.WebGLRenderer();',
    'renderer.setSize(innerWidth, innerHeight);',
    'document.body.appendChild(renderer.domElement);',
    'const controls = new OrbitControls(camera, renderer.domElement);',
    'controls.enableDamping = true;',
    'controls.target.set(0, 0, 0);',
    'scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial()));',
    'function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }',
    'animate();',
].join(NL);

const P5_MOUSE = [
    'let hue;',
    'function setup() {',
    '  createCanvas(windowWidth, windowHeight);',
    '  colorMode(HSB, 360, 100, 100);',
    '  hue = 200;',
    '}',
    'function draw() {',
    '  background(230, 30, 15);',
    '  const x = mouseIsPressed ? mouseX : width / 2;',
    '  const y = mouseIsPressed ? mouseY : height / 2;',
    '  noStroke();',
    '  fill(hue, 70, 95);',
    '  circle(x, y, 80);',
    '}',
    'function keyPressed() { hue = (hue + 40) % 360; }',
].join(NL);

export default [
    {
        name: 'k11-edit-model-code-with-lol-orbit-and-the-mouse-draws-in-the-guest',
        async run(h) {
            await open(h);
            const orbit = await drawCode(h, 'three', THREE_ORBIT, 40);
            h.eq(orbit.state, 'done', `a three.js answer calling lol.orbit(camera, opts) draws: ${orbit.error}`);
            const c1 = await colours(h, orbit.id);
            h.assert(c1 > 5, `and its picture is not empty: ${c1} colours`);
            await h.computer.remove([orbit.id]);        // one box on screen at a time: every ▶ is clickable

            const oc = await drawCode(h, 'three', THREE_ORBITCONTROLS, 40);
            h.eq(oc.state, 'done', `a three.js answer that reaches for OrbitControls still draws: ${oc.error}`);
            const c2 = await colours(h, oc.id);
            h.assert(c2 > 5, `with a picture: ${c2} colours`);
            await h.computer.remove([oc.id]);

            const p5 = await drawCode(h, 'p5', P5_MOUSE, 40);
            h.eq(p5.state, 'done', `a p5 answer reading mouseX/mouseY draws its first frame: ${p5.error}`);
            const c3 = await colours(h, p5.id);
            h.assert(c3 >= 2, `the circle is on it: ${c3} colours`);
        },
    },
];
