// @ts-check
// K-9 / K-7 (docs/COMPUTER_LIVE_PLAN.md, builder L): LIVE previews, proven with REAL input.
//
// "the key events, or mouse events are not passed on the canvas, for instance in the threejs it
// would be cool to have a camera control and be sure it works when we interact with the node."
//                                                                                   — the owner
//
// Every gesture below goes through CDP's Input domain (h.input.*): trusted events with hit testing,
// pointer capture and focus — the same pipeline a mouse, a trackpad and a keyboard use. What a
// gesture did INSIDE the sketch is read back from the sketch itself: its pixels through the live
// guest's snapshot door (`liveNow().snapshot()`), and what it logged (`liveNow().logs()`).
//
//   three  ▶ Live on a scene that calls lol.orbit: a drag over it rotates the camera (the pixels
//          change) and the canvas view does not move; the wheel zooms the scene, not the canvas;
//          Shift-drag pans; a scene drawn ONCE (no loop of its own) still follows the drag
//   p5     mouseX follows the pointer; a key typed into the live frame reaches keyPressed() and
//          fires no canvas shortcut (Delete does not delete the box); Escape hands the keyboard
//          back, after which Delete is the canvas's again

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** The Computer, shown, on a NEW empty document, at 100 % with the origin top-left. */
async function freshDoc(/** @type {any} */ h, /** @type {string} */ title) {
    await h.view('computer');
    await h.waitFor(() => {
        const d = window.LolComputer && window.LolComputer.debug;
        return d && d.library && typeof d.library.openId === 'function' && d.library.openId() && d.computer ? true : null;
    }, { timeout: 20000 });
    const id = await h.eval((t) => window.LolComputer.debug.library.create(t), title);
    await h.waitFor((want) => (window.LolComputer.debug.computer.docId() === want ? true : null), { args: [id], timeout: 15000 });
    await h.eval(() => {
        const c = window.LolComputer.app.host.canvas;
        c.setView({ x: 0, y: 0, zoom: 1 });
        c.setTool('select');
        c.closePalette();
        return true;
    });
    await frame(h);
    return id;
}

/** Two frames: the canvas's ONE rAF has run. */
const frame = (/** @type {any} */ h) => h.eval(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))));
const view = (/** @type {any} */ h) => h.eval(() => window.LolComputer.debug.computer.view());
const part = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === pid);
    return p ? { x: p.x, y: p.y, w: p.w, h: p.h, settings: p.settings } : null;
}, id);
const sel = (/** @type {string} */ id, /** @type {string} */ inner) => `#lolcomputer .graph-part[data-id="${id}"]${inner ? ' ' + inner : ''}`;

/** A Preview in `mode` holding `source`, drawing `w` x `h`, in a box of `bw` x `bh`. */
async function box(/** @type {any} */ h, /** @type {string} */ mode, /** @type {string} */ source, /** @type {any} */ o = {}) {
    const id = await h.computer.place('preview', o.x || 40, o.y || 40);
    await h.computer.set(id, { mode, source, w: o.w || 320, h: o.h || 240 });
    if (o.bw || o.bh) {
        await h.eval((pid, bw, bh) => {
            const s = window.LolComputer.debug.computer.session();
            const doc = s.doc();
            const next = { ...doc, parts: doc.parts.map((p) => (p.id === pid ? { ...p, w: bw || p.w, h: bh || p.h } : p)) };
            s.apply(next, { label: 'resize' });
            return true;
        }, id, o.bw || 0, o.bh || 0);
    }
    await frame(h);
    return id;
}

/** The live guest's state, or null when no box is live. */
const liveState = (/** @type {any} */ h) => h.eval(() => {
    const s = window.LolComputer.debug.computer.session().sandboxNow();
    const l = s && typeof s.liveNow === 'function' ? s.liveNow() : null;
    return l ? l.state() : null;
});

/** Press ▶ Live on a box (a real click) and wait for its sketch to be running inside that box. */
async function goLive(/** @type {any} */ h, /** @type {string} */ id) {
    await h.input.click(sel(id, '.graph-preview-live'));
    await h.waitFor((s) => {
        const sb = window.LolComputer.debug.computer.session().sandboxNow();
        const l = sb && sb.liveNow ? sb.liveNow() : null;
        const fr = document.querySelector(s + ' .graph-preview-stage .sandbox-live-frame');
        return l && fr && l.state() === 'running' ? true : (l ? l.state() : null);
    }, { args: [sel(id, '')], timeout: 20000 });
    // A few painted frames, so the first picture is on screen before anything is compared.
    await h.eval(() => new Promise((done) => setTimeout(done, 400)));
}

/** What the live sketch shows right now, as a PNG data URL (the guest's own pixels). */
const liveShot = (/** @type {any} */ h) => h.eval(async () => {
    const sb = window.LolComputer.debug.computer.session().sandboxNow();
    const l = sb && sb.liveNow ? sb.liveNow() : null;
    const s = l ? await l.snapshot({ maxPx: 256 }) : null;
    return s ? s.dataUrl : null;
});

/** What the live sketch logged, as text lines. */
const liveLogs = (/** @type {any} */ h) => h.eval(() => {
    const sb = window.LolComputer.debug.computer.session().sandboxNow();
    const l = sb && sb.liveNow ? sb.liveNow() : null;
    return l ? l.logs().map((x) => x.text) : [];
});

/** The share of sampled pixels that differ between two PNGs (0..1). */
const differ = (/** @type {any} */ h, /** @type {string} */ a, /** @type {string} */ b) => h.eval(async (x, y) => {
    const load = (src) => new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('undecodable')); im.src = src; });
    const [ia, ib] = await Promise.all([load(x), load(y)]);
    const px = (im) => {
        const c = document.createElement('canvas');
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(im, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
    };
    const da = px(ia), db = px(ib);
    if (da.length !== db.length) return 1;
    let n = 0, d = 0;
    for (let i = 0; i < da.length; i += 4 * 3) {
        n++;
        if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) d++;
    }
    return n ? d / n : 0;
}, a, b);

/** The client rect of the live frame (its transformed box on screen). */
const frameRect = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((s) => {
    const fr = document.querySelector(s + ' .sandbox-live-frame');
    if (!fr) return null;
    const r = fr.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
}, sel(id, ''));

/** A static cube, six coloured faces, rendered every frame; the camera is the orbit's. */
const THREE_ORBIT = [
    'const W = window.innerWidth, H = window.innerHeight;',
    'const scene = new THREE.Scene();',
    'scene.background = new THREE.Color(0x202830);',
    'const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);',
    'camera.position.set(0, 0, 5);',
    'const renderer = new THREE.WebGLRenderer();',
    'renderer.setSize(W, H);',
    'document.body.appendChild(renderer.domElement);',
    'const faces = [0xff4444, 0x44ff44, 0x4466ff, 0xffff44, 0xff44ff, 0x44ffff].map((c) => new THREE.MeshBasicMaterial({ color: c }));',
    'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), faces));',
    'lol.orbit(camera);',
    'function animate() { requestAnimationFrame(animate); renderer.render(scene, camera); }',
    'animate();',
].join('\n');

/** The same cube drawn ONCE: no loop of its own, so only the orbit can redraw it. */
const THREE_ONCE = [
    'const W = window.innerWidth, H = window.innerHeight;',
    'const scene = new THREE.Scene();',
    'scene.background = new THREE.Color(0x302028);',
    'const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);',
    'camera.position.set(0, 0, 5);',
    'const renderer = new THREE.WebGLRenderer();',
    'renderer.setSize(W, H);',
    'const faces = [0xff4444, 0x44ff44, 0x4466ff, 0xffff44, 0xff44ff, 0x44ffff].map((c) => new THREE.MeshBasicMaterial({ color: c }));',
    'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), faces));',
    'lol.orbit(camera);',
    'renderer.render(scene, camera);',
].join('\n');

/** p5: a dot under the mouse; every move and every key is logged. */
const P5_INPUT = [
    'function setup() { createCanvas(windowWidth, windowHeight); }',
    'function draw() { background(30); noStroke(); fill(255, 200, 0); circle(mouseX, mouseY, 24); }',
    "function mouseMoved() { console.log('mouse ' + Math.round(mouseX) + ' ' + Math.round(mouseY)); }",
    "function keyPressed() { console.log('key ' + key); }",
].join('\n');

export default [
    {
        name: 'k11-live-three-drag-rotates-the-scene-and-the-canvas-stays-put',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await freshDoc(h, 'k11 three orbit');
            const id = await box(h, 'three', THREE_ORBIT, { w: 320, h: 240, bw: 380, bh: 460 });
            const btn = await h.eval((s) => {
                const b = document.querySelector(s);
                return b ? { text: b.textContent, hidden: b.hidden, disabled: b.disabled } : null;
            }, sel(id, '.graph-preview-live'));
            h.assert(btn && !btn.hidden && !btn.disabled, `a three.js box shows a pressable ▶ Live: ${JSON.stringify(btn)}`);

            await goLive(h, id);
            const pressed = await h.eval((s) => document.querySelector(s).getAttribute('aria-pressed'), sel(id, '.graph-preview-live'));
            h.eq(pressed, 'true', 'the button now says ■ Stop (pressed)');
            const settings = (await part(h, id)).settings;
            h.eq(settings.live, true, 'the `live` setting records the choice');

            const v0 = await view(h);
            const p0 = await part(h, id);
            const a = await liveShot(h);
            h.assert(a, 'the live sketch can be photographed through its door');
            await h.eval(() => new Promise((done) => setTimeout(done, 300)));
            const a2 = await liveShot(h);
            h.assert((await differ(h, a, a2)) < 0.01, 'left alone, the static scene does not change');

            // A real drag across the sketch: rotate.
            const r = await frameRect(h, id);
            h.assert(r && r.width > 100, `the live frame is on the box: ${JSON.stringify(r)}`);
            const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            await h.input.drag(c, { x: c.x + 90, y: c.y + 20 }, { steps: 12 });
            await h.eval(() => new Promise((done) => setTimeout(done, 700)));
            const b = await liveShot(h);
            const turned = await differ(h, a, b);
            h.assert(turned > 0.05, `a drag over the sketch rotated the camera: ${(turned * 100).toFixed(1)} % of the pixels changed`);
            h.eq(await view(h), v0, 'and the canvas did not pan or zoom');
            h.eq(await h.eval(() => (document.activeElement ? document.activeElement.tagName : '')), 'IFRAME',
                'the press that started the orbit gave the sketch the keyboard too');
            const p1 = await part(h, id);
            h.eq([p1.x, p1.y], [p0.x, p0.y], 'and the box did not move');
            const marquee = await h.eval(() => { const m = document.querySelector('#lolcomputer .graph-marquee'); return !!m && !m.hidden; });
            h.eq(marquee, false, 'and no marquee was drawn');

            // The canvas's own guard (graph/canvas.mjs overLive): the stage AROUND a scaled frame is
            // in the canvas's document — a drag or a wheel there must not move anything either.
            const gap = await h.eval((s) => {
                const st = document.querySelector(s + ' .graph-preview-stage').getBoundingClientRect();
                const fr = document.querySelector(s + ' .sandbox-live-frame').getBoundingClientRect();
                if (fr.left - st.left >= 12) return { x: st.left + (fr.left - st.left) / 2, y: st.top + st.height / 2 };
                if (fr.top - st.top >= 12) return { x: st.left + st.width / 2, y: st.top + (fr.top - st.top) / 2 };
                return null;
            }, sel(id, ''));
            if (gap) {
                const hit = await h.input.hit(gap.x, gap.y);
                h.assert(hit && /graph-preview-stage/.test(hit.cls), `the gap is the live stage: ${JSON.stringify(hit)}`);
                await h.input.drag(gap, { x: gap.x + 70, y: gap.y + 40 }, { steps: 8 });
                await frame(h);
                const p2 = await part(h, id);
                h.eq([p2.x, p2.y], [p0.x, p0.y], 'a drag on the live stage does not move the box');
                h.eq(await view(h), v0, 'or pan the canvas');
                await h.input.wheel({ x: gap.x, y: gap.y, dy: 300 });
                await frame(h);
                h.eq(await view(h), v0, 'and a wheel there does not zoom or pan it');
            } else {
                h.note('the frame filled the stage: no gap to press on');
            }

            // The wheel zooms the scene, not the canvas.
            await h.input.wheel({ x: c.x, y: c.y, dy: 400 });
            await h.eval(() => new Promise((done) => setTimeout(done, 700)));
            const z = await liveShot(h);
            const zoomed = await differ(h, b, z);
            h.assert(zoomed > 0.03, `the wheel zoomed the scene: ${(zoomed * 100).toFixed(1)} % changed`);
            h.eq(await view(h), v0, 'and the canvas zoom did not move');
            // A pinch (ctrl + wheel) is the scene's too.
            await h.input.wheel({ x: c.x, y: c.y, dy: -60, ctrl: true });
            await h.eval(() => new Promise((done) => setTimeout(done, 500)));
            h.eq(await view(h), v0, 'a pinch over the sketch does not zoom the canvas');

            // Shift-drag pans the scene.
            const before = await liveShot(h);
            await h.input.drag(c, { x: c.x - 60, y: c.y - 40 }, { steps: 10, shift: true });
            await h.eval(() => new Promise((done) => setTimeout(done, 700)));
            const panned = await differ(h, before, await liveShot(h));
            h.assert(panned > 0.03, `Shift-drag panned the scene: ${(panned * 100).toFixed(1)} % changed`);
            h.eq(await view(h), v0, 'and not the canvas');
            await h.screenshot('k11-live-three-orbit');

            // A scene drawn ONCE, with no loop of its own, still follows the drag: the orbit redraws.
            await h.input.click(sel(id, '.graph-preview-live'));             // ■ Stop
            await h.waitFor(() => {
                const sb = window.LolComputer.debug.computer.session().sandboxNow();
                return sb && !sb.liveNow() ? true : null;
            });
            await h.computer.set(id, { source: THREE_ONCE });
            await frame(h);
            await goLive(h, id);
            const o1 = await liveShot(h);
            const r2 = await frameRect(h, id);
            const c2 = { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2 };
            await h.input.drag(c2, { x: c2.x - 80, y: c2.y + 30 }, { steps: 10 });
            await h.eval(() => new Promise((done) => setTimeout(done, 700)));
            const once = await differ(h, o1, await liveShot(h));
            h.assert(once > 0.05, `a render-once scene is redrawn by the orbit: ${(once * 100).toFixed(1)} % changed`);
            h.note(`drag ${(turned * 100).toFixed(0)} % · wheel ${(zoomed * 100).toFixed(0)} % · shift-pan ${(panned * 100).toFixed(0)} % · render-once ${(once * 100).toFixed(0)} %`);
        },
    },
    {
        name: 'k11-live-p5-sees-the-mouse-and-the-keys-and-the-canvas-does-not',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await freshDoc(h, 'k11 p5 input');
            const id = await box(h, 'p5', P5_INPUT, { w: 300, h: 200, bw: 380, bh: 460 });
            await goLive(h, id);
            const r = await frameRect(h, id);
            h.assert(r && r.width > 100, `the live frame is on the box: ${JSON.stringify(r)}`);
            const k = 300 / r.width;                                    // sketch px per client px

            // mouseX follows the pointer, in the SKETCH's coordinates (the frame is scaled to fit).
            const at = [{ fx: 0.25, fy: 0.5 }, { fx: 0.75, fy: 0.3 }];
            /** @type {any[]} */ const seen = [];
            for (const p of at) {
                const x = r.left + r.width * p.fx, y = r.top + r.height * p.fy;
                await h.input.move({ x: x - 3, y });
                await h.input.move({ x, y });
                await h.eval(() => new Promise((done) => setTimeout(done, 150)));
                const logs = (await liveLogs(h)).filter((l) => l.startsWith('mouse '));
                h.assert(logs.length, 'the sketch saw the mouse move');
                const last = logs[logs.length - 1].split(' ').map(Number);
                seen.push({ want: [Math.round(r.width * p.fx * k), Math.round(r.height * p.fy * k)], got: [last[1], last[2]] });
            }
            for (const s of seen) {
                h.assert(Math.abs(s.got[0] - s.want[0]) <= 4 && Math.abs(s.got[1] - s.want[1]) <= 4,
                    `mouseX/mouseY follow the pointer: ${JSON.stringify(seen)}`);
            }

            // A click gives the sketch the keyboard; keys reach keyPressed(), not the canvas.
            const v0 = await view(h);
            await h.input.click({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
            const focus = await h.eval(() => (document.activeElement ? document.activeElement.tagName : ''));
            h.eq(focus, 'IFRAME', 'clicking the live sketch gives it the keyboard');
            await h.input.key('a');
            await h.input.key('f');                       // the canvas's Fit key
            await h.input.key('Delete');                  // the canvas's Delete key
            await h.eval(() => new Promise((done) => setTimeout(done, 300)));
            const keys = (await liveLogs(h)).filter((l) => l.startsWith('key '));
            h.assert(keys.indexOf('key a') >= 0 && keys.indexOf('key f') >= 0 && keys.indexOf('key Delete') >= 0,
                `the keys reached the sketch: ${JSON.stringify(keys)}`);
            h.assert(await part(h, id), 'Delete typed into the sketch did not delete the box');
            h.eq(await view(h), v0, 'and f did not Fit the canvas');
            h.eq(await liveState(h), 'running', 'the sketch is still live');

            // Escape hands the keyboard back to the canvas, on this box — and then Delete is the
            // canvas's own again.
            await h.input.key('Escape');
            await h.waitFor((s) => {
                const a = document.activeElement;
                return a && a.matches && a.matches(s) ? true : (a ? a.tagName + '.' + a.className : null);
            }, { args: [sel(id, '')], timeout: 5000 });
            await h.input.key('Delete');
            await h.waitFor((pid) => (window.LolComputer.debug.computer.doc().parts.some((p) => p.id === pid) ? null : true), { args: [id], timeout: 5000 });
            h.eq(await liveState(h), null, 'deleting the live box stopped its sketch');
            const frames = await h.eval(() => document.querySelectorAll('.sandbox-live-frame').length);
            h.eq(frames, 0, 'and took its frame away');
        },
    },
];
