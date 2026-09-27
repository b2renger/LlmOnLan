// @ts-check
// C1-U2 in the real browser: the Computer panel's canvas (spec §4, DOM contract §2.6 BG-8).
//
// The unit tests (graph-canvas) prove the maths — fit, snap, marquee hits, the clipboard payload,
// the port geometry. Only these scenarios can prove the parts that are not arithmetic:
//
//   - that a place/wire/move done through the REAL pointer path lands in the model AND in the DOM;
//   - that a refused wire snaps back and SAYS why, in words, in the live region;
//   - that pan and zoom transform `.graph-layer` and the wire layer and nothing else — the
//     invariant the 500-part perf scenario then measures;
//   - that the graph survives a reload and follows the thread it belongs to;
//   - that a destroyed panel leaves no DOM, no debug door and no listener behind;
//   - that `API_KEYS.computerDebug` and the live door are the same names (K1: graphDebug + two).
//
// Every gesture here is a real PointerEvent on a real element at a real client coordinate: a test
// that called the debug door for everything would pass with the pointer code deleted.

import { API_KEYS } from '../../../renderer/chat/core/types.mjs';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when the panel is faked or absent — a green run would otherwise mean nothing. */
const requireReal = async (/** @type {any} */ h) => {
    await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));
    await h.waitFor(() => (window.LolComputer && window.LolComputer.ready ? true : null));
    await h.eval(() => {
        // K1: the Computer is its own surface with its own loader, so "is it real?" is asked of
        // window.LolComputer, not of a workbench panel that no longer exists.
        const failed = (window.LolComputer && window.LolComputer.failed) || {};
        if (failed.host) throw new Error(`C1-U2 needs the REAL computer/host.mjs: ${failed.host.error}`);
        if (!document.querySelector('#lolcomputer .graph')) throw new Error('the Computer canvas never mounted');
        return true;
    });
};

/** A thread to hang a graph on (the mock answers instantly). */
const newThread = async (/** @type {any} */ h, /** @type {string} */ text) => {
    await h.submit(text);
    await h.waitReply();
    return h.eval(() => window.LolChat.app.state.threadId);
};

/** Open the Computer panel through the rail — WITHOUT toggling it shut when it is already open. */
const openGraph = async (/** @type {any} */ h) => {
    await h.view('computer');
    return h.waitFor(() => {
        const dbg = window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.computer;
        if (!dbg) return null;
        const s = dbg.state();
        return s.docId ? s : null;
    }, { timeout: 15000 });
};

/** The page-side gesture kit: real PointerEvents at coordinates derived from the live view. */
const installGestures = (/** @type {any} */ h) => h.eval(() => {
    const g = {
        canvas: () => document.querySelector('#lolcomputer .graph-canvas'),
        view: () => window.LolComputer.debug.computer.view(),
        /** world point → client point, through the canvas rect and the live pan/zoom */
        client(wx, wy) {
            const r = g.canvas().getBoundingClientRect();
            const v = g.view();
            return { x: r.left + wx * v.zoom + v.x, y: r.top + wy * v.zoom + v.y };
        },
        part: (id) => document.querySelector(`#lolcomputer .graph-part[data-id="${id}"]`),
        port: (id, port, dir) => document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-port[data-port="${port}"][data-dir="${dir}"]`),
        fire(type, target, pt, opts) {
            const init = Object.assign({
                bubbles: true, cancelable: true, composed: true, pointerId: 1, isPrimary: true,
                pointerType: 'mouse', clientX: pt.x, clientY: pt.y,
                button: type === 'pointerup' ? 0 : 0,
                buttons: type === 'pointerup' ? 0 : 1,
            }, opts || {});
            const ev = new PointerEvent(type, init);
            target.dispatchEvent(ev);
            return ev.defaultPrevented;
        },
        /** press at `from`, walk to `to` in `steps`, release. Coordinates are CLIENT points. */
        drag(downOn, from, to, opt) {
            const o = opt || {};
            const canvas = g.canvas();
            g.fire('pointerdown', downOn, from, o.down);
            const steps = o.steps || 4;
            for (let i = 1; i <= steps; i++) {
                g.fire('pointermove', canvas, {
                    x: from.x + ((to.x - from.x) * i) / steps,
                    y: from.y + ((to.y - from.y) * i) / steps,
                }, o.move);
            }
            g.fire('pointerup', o.upOn || canvas, to, o.up);
        },
        /** `pt` is CANVAS-LOCAL, like everything the canvas itself computes. */
        wheel(pt, dx, dy, ctrl) {
            const r = g.canvas().getBoundingClientRect();
            g.canvas().dispatchEvent(new WheelEvent('wheel', {
                bubbles: true, cancelable: true, clientX: r.left + pt.x, clientY: r.top + pt.y,
                deltaX: dx, deltaY: dy, ctrlKey: !!ctrl,
            }));
        },
        /** The midpoint of a wire's DRAWN path, in world units — where a reader would click it. */
        wireMid(index) {
            const path = document.querySelectorAll('#lolcomputer .graph-wires path')[index || 0];
            if (!path) throw new Error('no wire path in the svg');
            const p = path.getPointAtLength(path.getTotalLength() / 2);
            return { x: p.x, y: p.y };
        },
        /** Let the canvas's ONE rAF run before reading the picture. */
        frame: () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        said: () => {
            const el = document.querySelector('#lolcomputer .graph-live');
            return el ? (el.textContent || '').trim() : '';
        },
    };
    window.__g = g;
    return true;
});

/** What the DOM really shows, next to what the model says. */
const picture = (/** @type {any} */ h) => h.eval(async () => {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const layer = document.querySelector('#lolcomputer .graph-layer');
    const svg = document.querySelector('#lolcomputer .graph-wires');
    const parts = Array.from(document.querySelectorAll('#lolcomputer .graph-part'));
    return {
        root: !!document.querySelector('#lolcomputer .graph'),
        parts: parts.length,
        wires: svg ? svg.querySelectorAll('path').length : 0,
        layerTransform: layer ? getComputedStyle(layer).transform : '',
        svgTransform: svg && svg.querySelector('g') ? svg.querySelector('g').getAttribute('transform') : '',
        partTransforms: parts.map((el) => getComputedStyle(el).transform),
        positions: parts.map((el) => ({ id: el.dataset.id, left: el.style.left, top: el.style.top })),
        states: parts.map((el) => el.getAttribute('data-state')),
        stateLabels: parts.map((el) => {
            const s = el.querySelector('.graph-state-label');
            return s ? s.textContent : '';
        }),
        selected: parts.filter((el) => el.getAttribute('aria-selected') === 'true').map((el) => el.dataset.id),
        empty: (() => {
            const e = document.querySelector('#lolcomputer .graph-empty');
            return e ? !e.hidden : false;
        })(),
    };
});

/** Register a second, throwaway panel so switching away DESTROYS the Computer at once (no grace). */
// (The `c1probe` workbench panel that used to live here went with c1-canvas-lifecycle's panel
// half at the K1 landing: there is no panel to switch away FROM any more.)

export default [
    {
        name: 'c1-canvas-build',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Place → wire → move → undo → redo → reload, all through the pointer, and the picture
        // agrees with the model at every step.
        run: async (h) => {
            await requireReal(h);
            const threadId = await newThread(h, 'graph one');
            await openGraph(h);
            await installGestures(h);

            let shot = await picture(h);
            h.eq(shot.root, true, 'the canvas is in the DOM');
            h.eq(shot.empty, true, 'an empty graph says so');

            // Place through the toolbar's Add menu — the reader's real route.
            await h.click('#lolcomputer .graph-add');
            await h.click('#lolcomputer .graph-add-item[data-type="note"]');
            let state = await h.graph.state();
            h.eq(state.parts.length, 1, 'the Add menu placed a Note');
            h.eq(state.parts[0].type, 'note');
            const note = state.parts[0].id;

            const ask = await h.graph.place('ask', 460, 60);
            h.assert(!!ask, 'an Ask part was placed');
            shot = await picture(h);
            h.eq(shot.parts, 2, 'both parts are painted');
            h.eq(shot.empty, false, 'the hint is gone once something is on the canvas');
            h.eq(shot.partTransforms.every((tr) => tr === 'none'), true,
                `no part may carry a transform (BG-8): ${shot.partTransforms.join(' | ')}`);

            // Wire by DRAGGING from the Note's output port to the Instruction's `in` port.
            const wired = await h.eval((ids) => {
                const g = window.__g;
                const from = g.port(ids.note, 'out', 'out');
                const to = g.port(ids.ask, 'in', 'in');
                if (!from || !to) throw new Error('a port is missing from the DOM');
                const a = from.getBoundingClientRect();
                const b = to.getBoundingClientRect();
                g.drag(from,
                    { x: a.left + a.width / 2, y: a.top + a.height / 2 },
                    { x: b.left + b.width / 2, y: b.top + b.height / 2 },
                    { upOn: to });
                return g.said();
            }, { note, ask });
            state = await h.graph.state();
            h.eq(state.wires.length, 1, `the drag made a wire (live region said: "${wired}")`);
            h.eq(state.wires[0].from, note);
            h.eq(state.wires[0].to, ask);
            h.eq(state.wires[0].port, 'in');
            shot = await picture(h);
            h.eq(shot.wires, 1, 'and exactly one <path> is drawn for it');

            // Drag the Ask 100 px right and 40 px down; it snaps to the grid.
            const before = state.parts.find((/** @type {any} */ p) => p.id === ask);
            await h.eval((id) => {
                const g = window.__g;
                const el = g.part(id);
                const r = el.getBoundingClientRect();
                const from = { x: r.left + r.width / 2, y: r.top + 6 };
                g.drag(el, from, { x: from.x + 103, y: from.y + 42 });
                return true;
            }, ask);
            state = await h.graph.state();
            const after = state.parts.find((/** @type {any} */ p) => p.id === ask);
            h.eq(after.x, before.x + 100, 'the move snapped to the 10 px grid');
            h.eq(after.y, before.y + 40);
            shot = await picture(h);
            const painted = shot.positions.find((/** @type {any} */ p) => p.id === ask);
            h.eq(painted.left, `${after.x}px`, 'the DOM followed the model');

            // One drag is ONE undo entry.
            h.eq(await h.graph.undo(), true);
            state = await h.graph.state();
            h.eq(state.parts.find((/** @type {any} */ p) => p.id === ask).x, before.x, 'undo put the part back');
            h.eq(await h.graph.redo(), true);
            state = await h.graph.state();
            h.eq(state.parts.find((/** @type {any} */ p) => p.id === ask).x, before.x + 100, 'redo moved it again');

            // …and it is all still there after a reload.
            await h.graph.save();
            await h.reload();
            await requireReal(h);
            await h.eval((id) => window.LolChat.app.controller.selectThread(id), threadId);
            const reopened = await openGraph(h);
            h.eq(reopened.parts.length, 2, 'both parts came back from the graphs store');
            h.eq(reopened.wires.length, 1, 'and so did the wire');
            h.eq(reopened.wires[0].port, 'in');
            h.eq(reopened.parts.find((/** @type {any} */ p) => p.id === ask).x, before.x + 100, 'at the position it was left at');
            h.eq((await picture(h)).parts, 2, 'and the canvas painted them');
        },
    },

    {
        name: 'c1-canvas-refusals',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // A wire the engine refuses changes NOTHING and says why in words — one sentence per
        // reason code (BG-4/BG-11), never a code and never silence.
        run: async (h) => {
            await requireReal(h);
            await newThread(h, 'graph refusals');
            await openGraph(h);
            await installGestures(h);

            const note = await h.graph.place('note', 40, 40);
            const ask = await h.graph.place('ask', 400, 40);
            const collect = await h.graph.place('collect', 760, 40);
            h.eq((await h.graph.wire(note, ask, 'in')).ok, true);
            h.eq((await h.graph.wire(ask, collect, 'items')).ok, true);

            // K3-U2 (COMPUTER_PLAN §4.6): a loop is legal once something in it can STOP it, so
            // the refusal this ring gets is `loop-ungated` — a Note, an Ask and a Collect can
            // none of them stop anything. The sentence still has to name the fix, which is what
            // the check below is really about.
            const cycle = await h.graph.wire(collect, ask, 'in');
            h.eq(cycle.ok, false);
            h.eq(cycle.reason, 'loop-ungated');
            let said = await h.eval(() => window.__g.said());
            h.assert(/loop/i.test(said), `a refused cycle must say why in words: "${said}"`);
            h.eq((await h.graph.state()).wires.length, 2, 'and nothing was added');

            const dup = await h.graph.wire(note, ask, 'in');
            h.eq(dup.reason, 'duplicate');
            said = await h.eval(() => window.__g.said());
            h.assert(/already/i.test(said), `the duplicate explained itself: "${said}"`);

            h.eq((await h.graph.wire(note, note, 'context')).reason, 'self');
            h.eq((await h.graph.wire(note, ask, 'nope')).reason, 'unknown-port');
            said = await h.eval(() => window.__g.said());
            h.assert(said.length > 0 && !/unknown-port/.test(said), `a reason CODE must never reach the reader: "${said}"`);

            // A drag that lands on empty canvas adds nothing and leaves no preview behind.
            const before = (await h.graph.state()).wires.length;
            await h.eval((id) => {
                const g = window.__g;
                const from = g.port(id, 'out', 'out');
                const r = from.getBoundingClientRect();
                g.drag(from, { x: r.left + 5, y: r.top + 5 }, { x: r.left + 5, y: r.top + 400 });
                return true;
            }, collect);
            h.eq((await h.graph.state()).wires.length, before, 'a wire dropped on nothing is not a wire');
            h.eq((await picture(h)).wires, before, 'and the preview path was cleaned up');
        },
    },

    {
        name: 'c1-canvas-select',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Clicking a wire selects it; Delete removes it. A marquee takes several parts; Delete
        // removes them and the wires that hung off them. Escape and undo put it all back.
        run: async (h) => {
            await requireReal(h);
            await newThread(h, 'graph select');
            await openGraph(h);
            await installGestures(h);

            const note = await h.graph.place('note', 40, 40);
            const ask = await h.graph.place('ask', 400, 40);
            await h.graph.wire(note, ask, 'in');

            // Click the wire at its midpoint — geometry, not a fat invisible second path.
            const hit = await h.eval(async () => {
                const g = window.__g;
                const dbg = window.LolComputer.debug.computer;
                await g.frame();
                const pt = g.client(g.wireMid(0).x, g.wireMid(0).y);
                g.fire('pointerdown', g.canvas(), pt);
                g.fire('pointerup', g.canvas(), pt);
                return dbg.state().selectedWires;
            });
            h.eq(hit.length, 1, 'clicking the wire selected it');

            await h.key('#lolcomputer .graph-canvas', 'Delete');
            let state = await h.graph.state();
            h.eq(state.wires.length, 0, 'Delete removed the selected wire');
            h.eq(state.parts.length, 2, 'and left both parts alone');
            h.eq((await picture(h)).wires, 0, 'the path went with it');

            h.eq(await h.graph.undo(), true, 'and the wire comes back');
            h.eq((await h.graph.state()).wires.length, 1);

            // Marquee across both parts, then delete them.
            const selected = await h.eval(() => {
                const g = window.__g;
                const a = g.client(-40, -40);
                const b = g.client(900, 400);
                g.drag(g.canvas(), a, b, { steps: 6 });
                return window.LolComputer.debug.computer.state().selected;
            });
            h.eq(selected.length, 2, 'the marquee took both parts');
            h.eq((await picture(h)).selected.length, 2, 'and both boxes show it');

            // A multi-selection moves as ONE thing, in ONE undo entry.
            const beforeMove = (await h.graph.state()).parts.map((/** @type {any} */ q) => ({ id: q.id, x: q.x, y: q.y }));
            const depth = (await h.graph.state()).undo.past;
            await h.eval((id) => {
                const g = window.__g;
                const el = g.part(id);
                const r = el.getBoundingClientRect();
                const from = { x: r.left + r.width / 2, y: r.top + 6 };
                g.drag(el, from, { x: from.x + 60, y: from.y + 20 });
                return true;
            }, note);
            const afterMove = (await h.graph.state()).parts.map((/** @type {any} */ q) => ({ id: q.id, x: q.x, y: q.y }));
            for (const was of beforeMove) {
                const is = afterMove.find((/** @type {any} */ q) => q.id === was.id);
                h.eq({ x: is.x, y: is.y }, { x: was.x + 60, y: was.y + 20 }, `every selected part moved together (${was.id})`);
            }
            h.eq((await h.graph.state()).undo.past, depth + 1, 'and the whole drag is one undo entry');
            h.eq(await h.graph.undo(), true);
            h.eq((await h.graph.state()).parts.map((/** @type {any} */ q) => ({ id: q.id, x: q.x, y: q.y })), beforeMove,
                'one undo puts the whole group back');
            await h.graph.select([note, ask]);

            await h.key('#lolcomputer .graph-canvas', 'Delete');
            state = await h.graph.state();
            h.eq(state.parts.length, 0, 'Delete removed the selection');
            h.eq(state.wires.length, 0, 'and the wire that hung off them');
            h.eq((await picture(h)).empty, true, 'the empty hint is back');

            h.eq(await h.graph.undo(), true);
            state = await h.graph.state();
            h.eq(state.parts.length, 2, 'one undo restores the whole deletion');
            h.eq(state.wires.length, 1);
        },
    },

    {
        name: 'c1-canvas-view',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Pan, zoom and fit move `.graph-layer` and the wire layer's <g> — and NOTHING else. This
        // is the invariant the perf scenario then leans on.
        run: async (h) => {
            await requireReal(h);
            await newThread(h, 'graph view');
            await openGraph(h);
            await installGestures(h);

            const note = await h.graph.place('note', 40, 40);
            await h.graph.place('ask', 1400, 900);

            const start = await h.graph.call('view');
            h.eq(start.zoom, 1, 'a fresh canvas is at 100%');

            // wheel pan
            await h.eval(() => { window.__g.wheel({ x: 200, y: 200 }, 120, 80, false); return true; });
            const panned = await h.waitFor((s) => {
                const v = window.LolComputer.debug.computer.view();
                return v.x !== s.x ? v : null;
            }, { args: [start] });
            h.eq(panned.x, start.x - 120, 'the wheel panned by exactly its delta');
            h.eq(panned.y, start.y - 80);
            h.eq(panned.zoom, 1, 'a plain wheel never zooms');

            // ctrl+wheel zoom about the cursor
            await h.eval(() => { window.__g.wheel({ x: 300, y: 150 }, 0, -200, true); return true; });
            const zoomed = await h.waitFor((s) => {
                const v = window.LolComputer.debug.computer.view();
                return v.zoom !== s.zoom ? v : null;
            }, { args: [panned] });
            h.assert(zoomed.zoom > panned.zoom, `ctrl+wheel zoomed in: ${zoomed.zoom}`);
            const anchor = {
                before: { x: (300 - panned.x) / panned.zoom, y: (150 - panned.y) / panned.zoom },
                after: { x: (300 - zoomed.x) / zoomed.zoom, y: (150 - zoomed.y) / zoomed.zoom },
            };
            // Half a pixel, not zero: the canvas rect's own left/top are fractional, so the client
            // coordinate the test synthesises and the local one the canvas computes differ in the
            // last float digits. Anything bigger than a pixel would be a real anchoring bug.
            h.assert(Math.abs(anchor.before.x - anchor.after.x) < 0.5 && Math.abs(anchor.before.y - anchor.after.y) < 0.5,
                `the point under the cursor must not move: ${JSON.stringify(anchor)}`);

            // …and the picture moved the way the model says
            let shot = await picture(h);
            h.assert(/matrix/.test(shot.layerTransform), `the layer carries the transform: "${shot.layerTransform}"`);
            h.assert(shot.svgTransform.indexOf('translate') === 0, `and so does the wire group: "${shot.svgTransform}"`);
            h.eq(shot.partTransforms.every((tr) => tr === 'none'), true,
                `pan/zoom must not transform a part (BG-8): ${shot.partTransforms.join(' | ')}`);
            h.eq(shot.positions.find((/** @type {any} */ p) => p.id === note).left, '40px',
                'a part keeps its WORLD position through a pan — the layer moved, not the box');

            // clamped: no amount of scrolling goes past the floor
            await h.eval(() => {
                for (let i = 0; i < 40; i++) window.__g.wheel({ x: 200, y: 200 }, 0, 200, true);
                return true;
            });
            // Critic R1, A4: the floor is 10 % now (it was 25 %, which left Fit unable to fit a graph
            // more than four windows wide). Still a floor, still not zero.
            const floor = await h.waitFor(() => {
                const v = window.LolComputer.debug.computer.view();
                return v.zoom <= 0.11 ? v : null;
            });
            h.eq(floor.zoom, 0.1, 'zoom clamps at the floor instead of vanishing');

            // fit brings both parts back on screen
            const fitted = await h.graph.call('fit');
            h.assert(fitted.zoom > 0.25 && fitted.zoom <= 1, `fit chose a legible zoom: ${fitted.zoom}`);
            const onScreen = await h.eval(async () => {
                await window.__g.frame();
                const canvas = document.querySelector('#lolcomputer .graph-canvas');
                const r = canvas.getBoundingClientRect();
                return Array.from(document.querySelectorAll('#lolcomputer .graph-part')).map((el) => {
                    const b = el.getBoundingClientRect();
                    return {
                        id: el.dataset.id,
                        inside: b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1,
                        box: [Math.round(b.left - r.left), Math.round(b.top - r.top), Math.round(b.right - r.left), Math.round(b.bottom - r.top)],
                        viewport: [Math.round(r.width), Math.round(r.height)],
                    };
                });
            });
            h.eq(onScreen.every((p2) => p2.inside), true, `fit must put every part inside the viewport: ${JSON.stringify(onScreen)}`);

            // space+drag pans too
            const beforePan = await h.graph.call('view');
            await h.eval(() => {
                const g = window.__g;
                const canvas = g.canvas();
                canvas.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
                const r = canvas.getBoundingClientRect();
                g.drag(canvas, { x: r.left + 200, y: r.top + 200 }, { x: r.left + 260, y: r.top + 230 });
                canvas.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
                return true;
            });
            const afterPan = await h.waitFor((b) => {
                const v = window.LolComputer.debug.computer.view();
                return v.x !== b.x ? v : null;
            }, { args: [beforePan] });
            h.assert(Math.abs(afterPan.x - (beforePan.x + 60)) < 0.5 && Math.abs(afterPan.y - (beforePan.y + 30)) < 0.5,
                `space+drag panned by the pointer delta: ${JSON.stringify(afterPan)} vs ${JSON.stringify(beforePan)}`);

            // the view rides the save, not undo
            const depth = (await h.graph.state()).undo;
            await h.graph.call('view', { x: 10, y: 10, zoom: 1 });
            h.eq((await h.graph.state()).undo.past, depth.past, 'panning is not an undo step');

            shot = await picture(h);
            h.eq(shot.wires, 0, 'no wires in this graph, so no paths');
        },
    },

    {
        name: 'c1-canvas-keyboard',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Tab reaches a part, arrows move it, the live region says what changed, and copy/paste
        // carries a selection as JSON.
        run: async (h) => {
            await requireReal(h);
            await newThread(h, 'graph keys');
            await openGraph(h);
            await installGestures(h);

            const note = await h.graph.place('note', 100, 100);
            const ask = await h.graph.place('ask', 500, 100);
            await h.graph.wire(note, ask, 'in');

            // every part is reachable by keyboard and shows a focus ring
            const focus = await h.eval((id) => {
                const el = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"]`);
                el.focus();
                const style = getComputedStyle(el);
                const out = {
                    tabIndex: el.tabIndex,
                    focused: document.activeElement === el,
                    outlineWidth: style.outlineWidth,
                    outlineStyle: style.outlineStyle,
                    outlineColor: style.outlineColor,
                    accentHover: style.getPropertyValue('--accent-hover'),
                    rings: (() => {
                        const found = [];
                        const walk = (sheet) => {
                            let rules = [];
                            try { rules = Array.from(sheet.cssRules || []); } catch (e) { return; }
                            for (const rule of rules) {
                                if (rule.styleSheet) { walk(rule.styleSheet); continue; }
                                if (!rule.selectorText || !rule.style) continue;
                                // The part's OWN focus ring: :focus / :focus-visible, not :focus-within (critic R1:
                                // a Text box styles its head while its editor has focus, and that is not a ring).
                                if (!/.graph-part:focus(?!-within)/.test(rule.selectorText)) continue;
                                found.push({
                                    selector: rule.selectorText,
                                    outline: rule.style.outline || `${rule.style.outlineWidth} ${rule.style.outlineStyle}`,
                                });
                            }
                        };
                        Array.from(document.styleSheets).forEach(walk);
                        return found;
                    })(),
                    selected: window.LolComputer.debug.computer.state().selected,
                };
                out.ring = out.rings.length > 0 && out.rings.every((r) => /\d/.test(r.outline) && r.outline.indexOf('none') < 0);
                return out;
            }, note);
            h.eq(focus.tabIndex, 0, 'a part is in the tab order');
            h.eq(focus.focused, true, 'and takes focus');
            // The harness window has no system focus, so `:focus` never MATCHES here however
            // correct the CSS is (outline-style stays `none`). The shippable assertion is that the
            // rule exists in the stylesheet we load and really paints a ring.
            h.eq(focus.ring, true, `graph.css must give a focused part a visible outline: ${JSON.stringify(focus.rings)}`);

            await h.key(`#lolcomputer .graph-part[data-id="${note}"]`, 'ArrowRight');
            await h.key(`#lolcomputer .graph-part[data-id="${note}"]`, 'ArrowDown');
            let state = await h.graph.state();
            let p = state.parts.find((/** @type {any} */ q) => q.id === note);
            h.eq({ x: p.x, y: p.y }, { x: 110, y: 110 },
                'arrows move the FOCUSED part by one grid step, even though the last placed part is the selected one');
            h.eq(state.parts.find((/** @type {any} */ q) => q.id === ask).x, 500, 'and left the selected part where it was');
            const said = await h.eval(() => window.__g.said());
            h.assert(said.length > 0, 'and the live region said so');

            await h.key(`#lolcomputer .graph-part[data-id="${note}"]`, 'ArrowLeft', { shift: true });
            state = await h.graph.state();
            p = state.parts.find((/** @type {any} */ q) => q.id === note);
            h.eq(p.x, 109, 'shift+arrow is the one-pixel nudge');

            // typing in a Note must not be eaten by the canvas shortcuts
            const typed = await h.eval((id) => {
                const area = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] textarea`);
                if (!area) throw new Error('the Note part has no textarea to type in');
                area.focus();
                const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
                setter.set.call(area, 'ffff');
                area.dispatchEvent(new Event('input', { bubbles: true }));
                area.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }));
                area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
                return { value: area.value, parts: window.LolComputer.debug.computer.state().parts.length };
            }, note);
            h.eq(typed.parts, 2, 'Delete inside a textarea must not delete the part');
            h.eq(typed.value, 'ffff');
            state = await h.graph.state();
            h.eq(state.parts.find((/** @type {any} */ q) => q.id === note).settings.text, 'ffff', 'the Note kept what was typed');

            // select all → copy → paste
            const clip = await h.eval(() => {
                const canvas = document.querySelector('#lolcomputer .graph-canvas');
                canvas.focus();
                canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
                const dt = new DataTransfer();
                const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true });
                canvas.dispatchEvent(ev);
                return { text: dt.getData('text/plain'), selected: window.LolComputer.debug.computer.state().selected.length };
            });
            h.eq(clip.selected, 2, 'ctrl+a selected every part');
            h.assert(clip.text.indexOf('"lolgraph":1') > 0, `copy put our format on the clipboard: ${clip.text.slice(0, 60)}`);
            h.assert(clip.text.indexOf('ffff') > 0, 'including the settings the reader typed');

            const pasted = await h.eval((text) => {
                const canvas = document.querySelector('#lolcomputer .graph-canvas');
                const dt = new DataTransfer();
                dt.setData('text/plain', text);
                canvas.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
                return window.LolComputer.debug.computer.state();
            }, clip.text);
            h.eq(pasted.parts.length, 4, 'paste added a copy of the selection');
            h.eq(pasted.wires.length, 2, 'and re-made the wire between the copies');
            h.eq(pasted.selected.length, 2, 'the pasted parts are what is selected now');
            const ids = new Set(pasted.parts.map((/** @type {any} */ q) => q.id));
            h.eq(ids.size, 4, 'every pasted part got a NEW id');
            const copies = pasted.parts.filter((/** @type {any} */ q) => q.settings && q.settings.text === 'ffff');
            h.eq(copies.length, 2, 'the copy carries the settings');
            h.assert(copies[0].x !== copies[1].x || copies[0].y !== copies[1].y, 'and is offset, not stacked exactly on top');

            // Critic R1, A7 (the tldraw gesture): plain WORDS pasted onto the canvas become one Text
            // box holding them. (Until R1 a foreign clipboard was ignored here.)
            const words = 'just some text a reader copied from a chat';
            const asText = await h.eval((w) => {
                const canvas = document.querySelector('#lolcomputer .graph-canvas');
                const dt = new DataTransfer();
                dt.setData('text/plain', w);
                const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
                canvas.dispatchEvent(ev);
                const st = window.LolComputer.debug.computer.state();
                const made = st.parts.find((q) => q.settings && q.settings.text === w);
                return { parts: st.parts.length, prevented: ev.defaultPrevented, type: made ? made.type : null };
            }, words);
            h.eq(asText.parts, 5, 'pasted words became ONE new box');
            h.eq(asText.type, 'note', 'a Text box holding them');
            h.eq(asText.prevented, true, 'and the canvas took the paste');
            // …and a paste with no words in it is still left alone.
            const untouched = await h.eval(() => {
                const canvas = document.querySelector('#lolcomputer .graph-canvas');
                const dt = new DataTransfer();
                dt.setData('text/plain', '   ');
                const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
                canvas.dispatchEvent(ev);
                return { parts: window.LolComputer.debug.computer.state().parts.length, prevented: ev.defaultPrevented };
            });
            h.eq(untouched.parts, 5, 'a clipboard with nothing in it is left alone');
            h.eq(untouched.prevented, false, 'and the event is not swallowed');
        },
    },

    {
        name: 'c1-canvas-lifecycle',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // AMENDED AT THE K1 LANDING (COMPUTER_PLAN §3.7). This used to read "the panel follows the
        // thread, and a destroyed panel leaves nothing behind". Both halves were about a workbench
        // panel that no longer exists: a graph belongs to a LIBRARY DOCUMENT now, and the surface
        // is never destroyed — it is hidden. The two facts worth keeping, re-expressed:
        //   1. two documents keep their own parts, and opening one repaints the canvas as its own;
        //   2. hiding the surface and showing it again leaves the canvas whole, with no second
        //      canvas, no lost listener and the same document open.
        run: async (h) => {
            await requireReal(h);
            await newThread(h, 'a thread that owns nothing now');
            await openGraph(h);

            const first = await h.graph.call('docId');
            h.assert(!!first, 'the Computer opened a document of its own');
            const note = await h.graph.place('note', 60, 60);
            h.assert(!!note, 'placed a part in the first document');
            await h.graph.save();

            // A second document starts EMPTY — it is not a view of the first.
            const second = await h.eval(async () => {
                const dbg = window.LolComputer.debug.computer;
                const row = await window.LolComputer.app.host.store.create({ title: 'the second document' });
                await dbg.open(row.id);
                return row.id;
            });
            h.assert(second !== first, 'a second library document');
            let state = await h.waitFor((id) => {
                const s = window.LolComputer.debug.computer.state();
                return s.docId === id ? s : null;
            }, { args: [second], timeout: 15000 });
            h.eq(state.parts.length, 0, "a new document starts with an empty canvas, not the other document's");
            const askTwo = await h.graph.place('ask', 200, 200);
            await h.graph.save();
            h.eq((await picture(h)).parts, 1, 'and the canvas painted the new document, not the old one');

            // …and opening the first one again brings ITS graph back.
            await h.eval((id) => window.LolComputer.debug.computer.open(id), first);
            state = await h.waitFor((id) => {
                const s = window.LolComputer.debug.computer.state();
                return s.docId === id ? s : null;
            }, { args: [first], timeout: 15000 });
            h.eq(state.parts.length, 1, 'the first document kept its own graph');
            h.eq(state.parts[0].id, note);
            h.eq(state.parts[0].type, 'note');
            h.eq((await picture(h)).parts, 1, 'and the canvas repainted it');
            h.assert(askTwo !== note, 'the two graphs are different documents');

            // Hiding the surface does NOT destroy it (§2.2: the canvas is never torn down), and
            // keys that land while it is hidden reach nothing and throw nothing.
            await h.view('chat');
            const hidden = await h.eval(() => {
                document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
                document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }));
                return {
                    roots: document.querySelectorAll('#lolcomputer .graph').length,
                    parts: document.querySelectorAll('#lolcomputer .graph-part').length,
                    door: !!(window.LolComputer.debug && window.LolComputer.debug.computer),
                };
            });
            h.eq(hidden.door, true, 'the debug door survives being hidden');
            h.eq(hidden.parts, 1, 'and so does the part box — hidden is not destroyed');

            // Coming back shows the same document, and exactly one canvas.
            await h.view('computer');
            const back = await h.waitFor((id) => {
                const dbg = window.LolComputer.debug && window.LolComputer.debug.computer;
                if (!dbg) return null;
                const s = dbg.state();
                return s.docId === id ? s : null;
            }, { args: [first], timeout: 15000 });
            h.eq(back.parts.length, 1, 'the same document is still open');
            h.eq(back.parts[0].id, note);
            h.eq(hidden.roots, 1, 'there is one canvas, not a second one mounted on the way back');
        },
    },

    {
        name: 'c1-canvas-contract',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The debug door is exactly API_KEYS.graphDebug (BG-9), the DOM is exactly the BG-8
        // contract, and every part state reads as colour AND text.
        run: async (h) => {
            await requireReal(h);
            await newThread(h, 'graph contract');
            await openGraph(h);

            const got = await h.eval(() => Object.keys(window.LolComputer.debug.computer).sort());
            h.eq(got, [...API_KEYS.computerDebug].sort(),
                'the debug door is exactly the frozen key list (BG-9, extended by K1 with docId + open)');

            const dom = await h.eval(() => {
                const root = document.querySelector('#lolcomputer .graph');
                const canvas = root.querySelector('.graph-canvas');
                const svg = canvas.querySelector('.graph-wires');
                const layer = canvas.querySelector('.graph-layer');
                return {
                    toolbar: !!root.querySelector('.graph-toolbar'),
                    canvas: !!canvas,
                    svg: !!svg,
                    layer: !!layer,
                    svgBeforeLayer: !!(svg && layer && (svg.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING)),
                    live: (() => {
                        const el = root.querySelector('[aria-live]');
                        return el ? el.getAttribute('aria-live') : null;
                    })(),
                    canvasRole: canvas.getAttribute('role'),
                    canvasLabel: canvas.getAttribute('aria-label'),
                };
            });
            h.eq(dom.toolbar, true, '.graph-toolbar');
            h.eq(dom.canvas, true, '.graph-canvas');
            h.eq(dom.svg, true, '.graph-wires');
            h.eq(dom.layer, true, '.graph-layer');
            h.eq(dom.svgBeforeLayer, true, 'the wires are painted BENEATH the parts');
            h.eq(dom.live, 'polite', 'the canvas has one polite live region');
            h.assert(dom.canvasLabel && dom.canvasLabel.length > 2, `the canvas names itself: "${dom.canvasLabel}"`);
            h.eq(dom.canvasRole, 'application');

            // state = colour AND text, for every state the model can be in
            const id = await h.graph.place('note', 40, 40);
            const states = ['idle', 'stale', 'queued', 'running', 'done', 'error'];
            const seen = [];
            for (const state of states) {
                // eslint-disable-next-line no-await-in-loop
                const row = await h.eval((args) => {
                    const dbg = window.LolComputer.debug.computer;
                    dbg.session().patchPart(args.id, { state: args.state });
                    const el = document.querySelector(`#lolcomputer .graph-part[data-id="${args.id}"]`);
                    const dot = el.querySelector('.graph-dot');
                    const label = el.querySelector('.graph-state-label');
                    return {
                        attr: el.getAttribute('data-state'),
                        label: (label && label.textContent) || '',
                        colour: getComputedStyle(dot).backgroundColor,
                    };
                }, { id, state });
                seen.push(row);
            }
            h.eq(seen.map((r) => r.attr), states, 'every state reaches the DOM');
            h.eq(seen.every((r) => r.label.length > 2), true,
                `a state must read as TEXT as well as colour: ${JSON.stringify(seen.map((r) => r.label))}`);
            h.eq(new Set(seen.map((r) => r.label)).size, states.length, 'and each state says something different');
            h.assert(new Set(seen.map((r) => r.colour)).size >= 4,
                `the colours carry information too: ${JSON.stringify(seen.map((r) => r.colour))}`);

            // a value preview is a button that opens the value.
            // K4 landing (COMPUTER_PLAN §6.2, addendum KD-3): the Text part (type id `note`) now
            // RENDERS its own value as markdown in its body, and declares `quiet` so the canvas
            // does not print the same words again in the foot strip. The foot strip itself is
            // unchanged and every other part keeps it — so this probe uses one of those. `collect`
            // is the nearest neighbour: a plain part with a plain text value.
            const valueId = await h.graph.place('collect', 240, 40);
            const shown = await h.eval((partId) => {
                const dbg = window.LolComputer.debug.computer;
                dbg.session().patchPart(partId, { state: 'done', value: { kind: 'text', data: 'the answer' } });
                const el = document.querySelector(`#lolcomputer .graph-part[data-id="${partId}"] .graph-value`);
                return { hidden: el.hidden, text: el.textContent, tag: el.tagName };
            }, valueId);
            h.eq(shown.hidden, false, 'a done part shows its value');
            h.eq(shown.text, 'the answer');
            h.eq(shown.tag, 'BUTTON', 'and the preview is operable');
        },
    },
];
