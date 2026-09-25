// @ts-check
// Critic round L1 (docs/reviews/COMPUTER_CRITIC_L1.md), proven with REAL input (h.input.*, CDP's
// Input domain: hit testing, pointer capture, focus).
//
//   L1-1  a canvas drag released OVER a live frame ends on release: a marquee selects, a wire
//         dropped on a live Preview's picture plugs into it (S1-5's body drop), a Hand pan commits
//         — and while no drag is held, the frame takes the pointer again
//   L1-4  the stage shows, with an outline, that the sketch holds the keyboard; Escape removes it
//   L1-2  a run that lands inside the drawer's typing pause keeps the typed text, in the box AND
//         the drawer, and the next keystroke builds on it
//   L1-3  Live is view state: pressing it, a takeover and a press the sandbox refuses (L1-5) leave
//         no undo entry, and Ctrl+Z / Ctrl+Y never leave a box saying live with no frame

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

const frame = (/** @type {any} */ h) => h.eval(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))));
const wait = (/** @type {any} */ h, /** @type {number} */ ms) => h.eval((m) => new Promise((done) => setTimeout(done, m)), ms);
const sel = (/** @type {string} */ id, /** @type {string} */ inner) => `#lolcomputer .graph-part[data-id="${id}"]${inner ? ' ' + inner : ''}`;
const part = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === pid);
    return p ? { x: p.x, y: p.y, w: p.w, h: p.h, state: p.state, settings: p.settings } : null;
}, id);
const depth = (/** @type {any} */ h) => h.eval(() => window.LolComputer.debug.computer.session().undoDepth());
/** The canvas's drag state as a person would see it. */
const dragState = (/** @type {any} */ h) => h.eval(() => {
    const c = document.querySelector('#lolcomputer .graph-canvas');
    const m = document.querySelector('#lolcomputer .graph-marquee');
    return {
        dragging: c.hasAttribute('data-dragging'),
        wiring: c.classList.contains('graph-wiring'),
        grabbing: c.classList.contains('graph-grabbing'),
        marquee: !!m && !m.hidden,
        dropTarget: document.querySelectorAll('#lolcomputer .graph-part[data-drop-target]').length,
    };
});
const IDLE = { dragging: false, wiring: false, grabbing: false, marquee: false, dropTarget: 0 };

/** A Preview in `mode` holding `source`, drawing 300 x 200, in a box of `bw` x `bh`. */
async function box(/** @type {any} */ h, /** @type {string} */ mode, /** @type {string} */ source, /** @type {any} */ o) {
    const id = await h.computer.place('preview', o.x, o.y);
    await h.computer.set(id, { mode, source, w: 300, h: 200 });
    if (o.bw || o.bh) {
        await h.eval((pid, bw, bh) => {
            const s = window.LolComputer.debug.computer.session();
            const doc = s.doc();
            s.apply({ ...doc, parts: doc.parts.map((p) => (p.id === pid ? { ...p, w: bw || p.w, h: bh || p.h } : p)) }, { label: 'resize' });
            return true;
        }, id, o.bw || 0, o.bh || 0);
    }
    await frame(h);
    return id;
}

const waitLive = (/** @type {any} */ h, /** @type {string} */ id, timeout = 20000) => h.waitFor((pid) => {
    const sb = window.LolComputer.debug.computer.session().sandboxNow();
    const l = sb && sb.liveNow ? sb.liveNow() : null;
    const fr = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .sandbox-live-frame');
    return l && fr && l.state() === 'running' ? true : null;
}, { args: [id], timeout });

/** The live frame's centre on screen. */
const frameCentre = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((s) => {
    const fr = document.querySelector(s + ' .sandbox-live-frame');
    if (!fr) return null;
    const r = fr.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}, sel(id, ''));

/** An empty spot on the canvas (k10's), for a click that gives the canvas the keyboard. */
const emptySpot = (/** @type {any} */ h) => h.eval(() => {
    const c = document.querySelector('#lolcomputer .graph-canvas');
    const r = c.getBoundingClientRect();
    const ok = (x, y) => {
        const el = document.elementFromPoint(x, y);
        return !!el && c.contains(el) && !el.closest('.graph-part, .graph-wire-pill, .graph-cap, .graph-drop, button');
    };
    for (let yy = r.top + 90; yy < r.bottom - 70; yy += 40) {
        for (let xx = r.right - 70; xx > r.left + 70; xx -= 40) {
            if (ok(xx, yy) && ok(xx - 30, yy) && ok(xx + 30, yy) && ok(xx, yy - 30) && ok(xx, yy + 30)) return { x: xx, y: yy };
        }
    }
    throw new Error('no empty spot on the canvas');
});

/** A client point `dx, dy` from the canvas's top-left, checked to be EMPTY canvas. */
const canvasPoint = (/** @type {any} */ h, /** @type {number} */ dx, /** @type {number} */ dy) => h.eval((x0, y0) => {
    const c = document.querySelector('#lolcomputer .graph-canvas');
    const r = c.getBoundingClientRect();
    const x = r.left + x0, y = r.top + y0;
    const el = document.elementFromPoint(x, y);
    const empty = !!el && c.contains(el) && !el.closest('.graph-part, .graph-wire-pill, .graph-toolbar, button');
    return { x, y, empty, what: el ? `${el.tagName.toLowerCase()}.${String(el.getAttribute('class') || '')}` : '' };
}, dx, dy);

const P5_DOT = [
    'function setup() { createCanvas(windowWidth, windowHeight); }',
    'function draw() { background(30, 60, 90); fill(255); circle(width / 2, height / 2, 30 + 10 * Math.sin(frameCount / 8)); }',
].join('\n');
const P5_A = [
    "function setup() { createCanvas(windowWidth, windowHeight); console.log('A up'); }",
    'function draw() { background(20, 60, 120); circle(width / 2, height / 2, 40); }',
].join('\n');
const P5_B = [
    "function setup() { createCanvas(windowWidth, windowHeight); console.log('B up'); }",
    'function draw() { background(120, 40, 20); rect(20, 20, width - 40, 20); }',
].join('\n');

export default [
    {
        name: 'k11-live-l1-drags-released-over-a-live-frame-end-and-the-stage-shows-the-keys',
        needsMock: true,
        timeoutMs: 150000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await freshDoc(h, 'k11 L1 drags over live');
            const note = await h.computer.place('note', 40, 120);
            await h.computer.set(note, { text: 'hello' });
            const pv = await box(h, 'p5', P5_DOT, { x: 420, y: 60, bw: 380, bh: 460 });
            await h.input.click(sel(pv, '.graph-preview-live'));
            await waitLive(h, pv);
            await wait(h, 300);
            h.eq(await dragState(h), IDLE, 'nothing held: the canvas is not dragging');

            // ---- L1-4: the stage says the sketch holds the keyboard -----------------------------
            const outline = () => h.eval((s) => {
                const st = document.querySelector(s + ' .graph-preview-stage');
                const cs = getComputedStyle(st);
                return { width: cs.outlineWidth, style: cs.outlineStyle, keys: st.getAttribute('data-keys'), active: document.activeElement ? document.activeElement.tagName : '' };
            }, sel(pv, ''));
            const idle = await outline();
            let c = await frameCentre(h, pv);
            h.assert(c && c.w > 100, `the live frame is on the box: ${JSON.stringify(c)}`);
            await h.input.click({ x: c.x, y: c.y });
            const held = await outline();
            h.eq(held.active, 'IFRAME', 'a click in the sketch gives it the keyboard');
            h.eq([held.keys, held.style, held.width], ['sketch', 'solid', '2px'], `and the stage shows it with a 2 px outline (idle: ${JSON.stringify(idle)})`);
            await h.input.key('Escape');
            await h.waitFor((s) => {
                const a = document.activeElement;
                return a && a.matches && a.matches(s) ? true : null;
            }, { args: [sel(pv, '')], timeout: 5000 });
            const back = await outline();
            h.eq([back.keys, back.style, back.width], [null, idle.style, idle.width], 'Escape gives the keys back, and the outline goes with them');

            // ---- L1-1 (a): a marquee released over the frame selects on release ----------------
            c = await frameCentre(h, pv);
            const hitFrame = await h.input.hit(c.x, c.y);
            h.eq(hitFrame && hitFrame.tag, 'iframe', `the release point is the live frame itself: ${JSON.stringify(hitFrame)}`);
            const start = await canvasPoint(h, 20, 100);
            h.assert(start.empty, `the marquee starts on empty canvas: ${JSON.stringify(start)}`);
            await h.input.drag(start, { x: c.x, y: c.y }, { steps: 14 });
            await frame(h);
            h.eq(await dragState(h), IDLE, 'the marquee ended on release, over the frame');
            const picked = await h.eval(() => window.LolComputer.debug.computer.session().selected().slice().sort());
            h.eq(picked, [note, pv].sort(), 'and selected what it crossed');
            h.eq(await h.eval(() => window.LolComputer.debug.computer.session().sandboxNow().liveNow().state()), 'running', 'the sketch kept running');

            // ---- L1-1 (b): a wire released on the live picture plugs into that box (S1-5) -----
            const wiresBefore = (await h.computer.doc()).wires.length;
            await h.input.drag(sel(note, '.graph-port[data-dir="out"]'), { x: c.x, y: c.y }, { steps: 14 });
            await frame(h);
            h.eq(await dragState(h), IDLE, 'the wire drag ended on release: no graph-wiring, no outline left');
            const wires = (await h.computer.doc()).wires;
            h.eq(wires.length, wiresBefore + 1, 'ONE wire was made, on release');
            const made = wires.find((/** @type {any} */ w) => w.from === note);
            h.eq(made && [made.to, made.port], [pv, 'content'], 'from the Text box into the live Preview\'s input');

            // ---- L1-1 (c): a Hand pan released over the frame commits the view ----------------
            // A pan moves the frame WITH the pointer, so a release lands on the frame only when the
            // page is a frame behind — a busy main thread, a fast flick. Frames are held for the
            // gesture (the canvas applies a pan on its next frame): the frame stays where it was
            // and the pointer really crosses into it, as on a slow machine.
            await h.eval(() => { window.LolComputer.app.host.canvas.setTool('hand'); return true; });
            const v0 = await h.eval(() => ({ ...window.LolComputer.debug.computer.session().doc().view }));
            c = await frameCentre(h, pv);
            const left = await h.eval((s) => document.querySelector(s).getBoundingClientRect().left, sel(pv, ''));
            const cr = await h.eval(() => { const r = document.querySelector('#lolcomputer .graph-canvas').getBoundingClientRect(); return { left: r.left, top: r.top }; });
            const p0 = await canvasPoint(h, left - 25 - cr.left, c.y - cr.top);
            h.assert(p0.empty, `the pan starts on empty canvas, just left of the live box: ${JSON.stringify(p0)}`);
            await h.eval(() => {
                const w = /** @type {any} */ (window);
                w.__l1raf = { real: w.requestAnimationFrame, queue: [] };
                w.requestAnimationFrame = (/** @type {any} */ cb) => { w.__l1raf.queue.push(cb); return w.__l1raf.queue.length; };
                w.__l1up = null;
                w.addEventListener('pointerup', (/** @type {any} */ ev) => {
                    const fr = document.querySelector('#lolcomputer .sandbox-live-frame');
                    const r = fr ? fr.getBoundingClientRect() : null;
                    w.__l1up = { inFrame: !!r && ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom };
                }, { capture: true, once: true });
                return true;
            });
            let up = null;
            try {
                await h.input.drag(p0, { x: c.x, y: c.y }, { steps: 10 });
                up = await h.eval(() => /** @type {any} */ (window).__l1up);
            } finally {
                await h.eval(() => {
                    const w = /** @type {any} */ (window);
                    const held = w.__l1raf;
                    w.requestAnimationFrame = held.real;
                    for (const cb of held.queue) held.real.call(w, cb);
                    return true;
                });
            }
            h.assert(up && up.inFrame, `the release reached the canvas, and it was over the live frame: ${JSON.stringify(up)}`);
            await wait(h, 400);                                  // commitView waits 150 ms
            h.eq(await dragState(h), IDLE, 'the pan ended on release');
            const v1 = await h.eval(() => ({ ...window.LolComputer.debug.computer.session().doc().view }));
            h.eq([Math.round(v1.x - v0.x), Math.round(v1.y - v0.y), v1.zoom], [Math.round(c.x - p0.x), Math.round(c.y - p0.y), v0.zoom],
                'and the view it made was committed to the document');
            await h.eval(() => { window.LolComputer.app.host.canvas.setTool('select'); return true; });

            // No drag held: the frame takes the pointer again.
            c = await frameCentre(h, pv);
            const again = await h.input.hit(c.x, c.y);
            h.eq(again && again.tag, 'iframe', 'with no drag held, the live frame is hit-tested again');
            h.eq(await h.eval(() => window.LolComputer.debug.computer.session().sandboxNow().liveNow().state()), 'running', 'and the sketch never stopped');
            await h.screenshot('k11-live-l1-drags');
        },
    },
    {
        name: 'k11-live-l1-a-run-inside-the-drawer-typing-pause-keeps-the-typed-text',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await freshDoc(h, 'k11 L1 drawer typing');
            const note = await h.computer.place('note', 40, 200);
            await h.computer.set(note, { text: '# first' });
            const pv = await h.computer.place('preview', 440, 60);
            await h.computer.set(pv, { mode: 'markdown' });
            await h.computer.wire(note, pv, 'content');
            await h.computer.run({});
            const BOX = sel(pv, '.graph-preview-source');
            const DRAWER = '#lolcomputer .comp-drawer .comp-code-area';
            await h.waitFor((s) => {
                const a = /** @type {any} */ (document.querySelector(s));
                return a && a.value === '# first' ? true : null;
            }, { args: [BOX], timeout: 20000 });

            await h.input.click(sel(pv, '.graph-preview-edit'));
            await h.waitFor((s) => {
                const a = /** @type {any} */ (document.querySelector(s));
                return a && a.value === '# first' ? true : null;
            }, { args: [DRAWER], timeout: 5000 });
            await h.input.key('End', { ctrl: true });
            await h.eval((s) => {
                document.querySelector(s).addEventListener('input', () => { /** @type {any} */ (window).__l1typed = performance.now(); }, { once: true });
                return true;
            }, DRAWER);
            await h.input.type('X');
            // Inside the 250 ms typing pause: the Text changes and the graph runs, as a model's
            // answer landing while the person has just started typing.
            const timing = await h.eval(async (nid) => {
                const d = window.LolComputer.debug.computer;
                d.setSettings(nid, { text: '# second' });
                await d.run({});
                return { ms: performance.now() - /** @type {any} */ (window).__l1typed };
            }, note);
            if (timing.ms >= 250) h.note(`the run landed ${Math.round(timing.ms)} ms after the keystroke — after the typing pause, not inside it`);
            else h.note(`the run landed ${Math.round(timing.ms)} ms after the keystroke, inside the 250 ms pause`);
            await wait(h, 700);
            const read = () => h.eval((b, dr, pid) => ({
                box: /** @type {any} */ (document.querySelector(b)).value,
                drawer: /** @type {any} */ (document.querySelector(dr)).value,
                doc: String(window.LolComputer.debug.computer.doc().parts.find((p) => p.id === pid).settings.source || ''),
            }), BOX, DRAWER, pv);
            h.eq(await read(), { box: '# firstX', drawer: '# firstX', doc: '# firstX' },
                'the typed X survives in the box, the drawer and the document — the arrival did not replace it');
            await h.input.type('Y');
            await h.waitFor((b) => (/** @type {any} */ (document.querySelector(b)).value === '# firstXY' ? true : null), { args: [BOX], timeout: 5000 });
            h.eq(await read(), { box: '# firstXY', drawer: '# firstXY', doc: '# firstXY' }, 'and the next keystroke builds on it');
            await h.input.key('Escape');
        },
    },
    {
        name: 'k11-live-l1-live-is-not-an-undo-step',
        needsMock: true,
        timeoutMs: 150000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await freshDoc(h, 'k11 L1 live undo');
            const a = await box(h, 'p5', P5_A, { x: 40, y: 40 });
            const b = await box(h, 'p5', P5_B, { x: 440, y: 40 });
            /** Each Preview's flag against its frame, after anything asynchronous has settled. */
            const state = async () => {
                await wait(h, 700);
                return h.eval((ids) => {
                    const doc = window.LolComputer.debug.computer.doc();
                    const out = {};
                    for (const id of ids) {
                        const p = doc.parts.find((x) => x.id === id);
                        out[id] = { live: !!(p && p.settings && p.settings.live), frame: !!document.querySelector('#lolcomputer .graph-part[data-id="' + id + '"] .sandbox-live-frame') };
                    }
                    return { boxes: out, frames: document.querySelectorAll('.sandbox-live-frame').length };
                }, [a, b]);
            };
            const want = (/** @type {boolean} */ aLive, /** @type {boolean} */ bLive) => ({
                boxes: { [a]: { live: aLive, frame: aLive }, [b]: { live: bLive, frame: bLive } },
                frames: (aLive ? 1 : 0) + (bLive ? 1 : 0),
            });

            const d0 = await depth(h);
            const states0 = [(await part(h, a)).state, (await part(h, b)).state];
            await h.input.click(sel(a, '.graph-preview-live'));
            await waitLive(h, a);
            await h.input.click(sel(b, '.graph-preview-live'));
            await waitLive(h, b);
            h.eq(await state(), want(false, true), 'B took over from A');
            h.eq(await depth(h), d0, 'pressing Live twice, a takeover included, made no undo entry');
            h.eq([(await part(h, a)).state, (await part(h, b)).state], states0, 'and changed no box’s state (nothing marked stale)');

            // Two real edits after the takeover, then Ctrl+Z / Ctrl+Y on the canvas.
            await h.computer.move(a, 60, 80);
            await h.computer.move(b, 460, 80);
            const d1 = await depth(h);
            h.eq(d1.past, d0.past + 2, 'the two moves are the undo steps');
            await h.input.click(await emptySpot(h));
            for (const [key, label] of [['z', 'Ctrl+Z'], ['z', 'Ctrl+Z twice'], ['y', 'Ctrl+Y'], ['y', 'Ctrl+Y twice']]) {
                await h.input.key(key, { ctrl: true });
                h.eq(await state(), want(false, true), `${label}: B is still the live one, A is not, and no box says live without a frame`);
            }
            h.eq([(await part(h, a)).x, (await part(h, b)).x], [60, 460], 'the moves came back with Ctrl+Y (the undo stack worked)');

            // L1-5: a press the sandbox refuses leaves no undo entry and no box claiming live.
            await h.input.click(sel(b, '.graph-preview-live'));                // ■ Stop B first
            await h.waitFor(() => (document.querySelector('.sandbox-live-frame') ? null : true), { timeout: 10000 });
            const d2 = await depth(h);
            await h.eval(() => {
                const s = /** @type {any} */ (window.LolComputer.debug.computer.session());
                s.__l1sandbox = s.sandbox;
                s.sandbox = async () => null;
                return true;
            });
            try {
                await h.input.click(sel(a, '.graph-preview-live'));
                await h.waitFor((s) => {
                    const e = document.querySelector(s);
                    return e && !e.hidden && e.textContent ? e.textContent : null;
                }, { args: [sel(a, '.graph-preview-error')], timeout: 5000 }).catch(() => null);
            } finally {
                await h.eval(() => {
                    const s = /** @type {any} */ (window.LolComputer.debug.computer.session());
                    s.sandbox = s.__l1sandbox;
                    delete s.__l1sandbox;
                    return true;
                });
            }
            h.eq(await state(), want(false, false), 'the refused press left nothing live and no box claiming it');
            h.eq(await depth(h), d2, 'and no undo entry');
            h.eq(await h.eval((s) => document.querySelector(s).getAttribute('aria-pressed'), sel(a, '.graph-preview-live')), 'false', 'A says ▶ Live again');
        },
    },
];
