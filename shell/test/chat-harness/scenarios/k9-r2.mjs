// @ts-check
// Critic R2's four minor findings, driven with REAL input (K-6: CDP's Input domain) wherever a
// person's hand is involved. The debug door only places boxes and draws wires.
//
//   N2  the run bar's zoom chip opened its menu off the top of the window;
//   N3  Keep staled the box and everything downstream, so the next Run all quietly regenerated;
//   N4  tour step 1 said "drag the empty canvas to move", which under Select draws a selection box;
//   N5  one Ctrl+V of a picture WITH text (cells from a spreadsheet, a captioned picture) made two
//       boxes: the intake adopted the picture and the canvas still made a Text box of the words.
//
// N5's paste is a synthetic ClipboardEvent carrying a real PNG File and text/plain, dispatched on
// the canvas: a real Ctrl+V would read the SYSTEM clipboard, and this box's clipboard is the
// owner's. The mock farm answers `mock-echo`; it never beacons.

import { lessonById } from '../../../renderer/chat/computer/tutorial/registry.mjs';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const COMPLETIONS = '/v1/chat/completions';
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TOUR = /** @type {any} */ (lessonById('l00-tour'));
/** The zoom menu (the right-click menu borrows its class, so it is named by what it is not). */
const ZOOM_MENU = '#lolcomputer .graph-zoom-menu:not(.graph-ctx-menu)';

/** The Computer, shown, on a NEW empty document at 100 %, the mock's counters at zero. */
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
    await h.mock.reset();
    return id;
}

/** Two frames: the canvas's ONE rAF has run. */
const frame = (/** @type {any} */ h) => h.eval(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))));
const view = (/** @type {any} */ h) => h.eval(() => window.LolComputer.debug.computer.view());
const inBox = (/** @type {string} */ id, /** @type {string} */ sel) => `#lolcomputer .graph-part[data-id="${id}"] ${sel}`;
const partOf = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === pid);
    return p ? JSON.parse(JSON.stringify(p)) : null;
}, id);
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

/** Remember the runner's last report, so a wait can tell THIS run's end from the previous one's. */
const markRun = (/** @type {any} */ h) => h.eval(() => {
    /** @type {any} */ (window).__k9Report = window.LolComputer.app.host.runner.report();
    return true;
});
const runEnded = (/** @type {any} */ h) => h.waitFor(() => {
    const r = window.LolComputer.app.host.runner;
    return !r.running() && r.report() && r.report() !== /** @type {any} */ (window).__k9Report ? true : null;
}, { timeout: 20000 });

/** Press the run bar's Run all with a real click and wait for THAT run to end. */
async function runAll(/** @type {any} */ h) {
    await markRun(h);
    await h.input.click('#lolcomputer .comp-run-all');
    await runEnded(h);
}

/** An empty spot of canvas — nothing but canvas under it and 30 px around it. */
const emptySpot = (/** @type {any} */ h) => h.eval(() => {
    const c = document.querySelector('#lolcomputer .graph-canvas');
    const r = c.getBoundingClientRect();
    const ok = (/** @type {number} */ x, /** @type {number} */ y) => {
        const el = document.elementFromPoint(x, y);
        return !!el && c.contains(el) && !el.closest('.graph-part, .graph-wire-pill, .graph-cap, .graph-drop, button');
    };
    for (let y = r.top + 90; y < r.bottom - 70; y += 40) {
        for (let x = r.right - 70; x > r.left + 70; x -= 40) {
            if (ok(x, y) && ok(x - 30, y) && ok(x + 30, y) && ok(x, y - 30) && ok(x, y + 30)) return { x, y };
        }
    }
    throw new Error('no empty canvas to aim at');
});

export default [
    {
        name: 'k9-zoom-chip-menu-opens-on-screen',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await freshDoc(h, 'k9 zoom chip');
            await h.computer.place('note', 40, 40);
            await h.computer.place('note', 2600, 1600);
            await frame(h);
            await h.input.click('#lolcomputer .comp-run-zoom');
            await h.waitFor((sel) => {
                const m = /** @type {any} */ (document.querySelector(sel));
                return m && !m.hidden ? true : null;
            }, { args: [ZOOM_MENU] });
            const seen = await h.eval((sel) => {
                const m = /** @type {any} */ (document.querySelector(sel));
                const chip = document.querySelector('#lolcomputer .comp-run-zoom').getBoundingClientRect();
                const rec = document.querySelector('#lolcomputer .comp-rec');
                const r = m.getBoundingClientRect();
                const first = /** @type {any} */ (m.querySelector('.graph-zoom-item'));
                const f = first.getBoundingClientRect();
                const under = document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2);
                const rr = rec ? rec.getBoundingClientRect() : null;
                const hits = (/** @type {DOMRect} */ a, /** @type {DOMRect} */ b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
                return {
                    rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
                    win: [window.innerWidth, window.innerHeight],
                    chipBottom: Math.round(chip.bottom),
                    firstAct: first.dataset.act,
                    firstHit: !!under && first.contains(under),
                    coversRecord: rr ? hits(r, rr) : false,
                };
            }, ZOOM_MENU);
            h.note(JSON.stringify(seen));
            const [l, t, r, b] = seen.rect;
            h.assert(l >= 0 && t >= 0 && r <= seen.win[0] && b <= seen.win[1], `the whole menu is inside the window: ${JSON.stringify(seen)}`);
            h.assert(t >= seen.chipBottom, `it opens below the chip: ${JSON.stringify(seen)}`);
            h.eq(seen.firstAct, 'fit', 'its first row is "Zoom to fit"');
            h.eq(seen.firstHit, true, 'and the first row is what is under the pointer where it is drawn — nothing covers it');
            h.eq(seen.coversRecord, false, 'the menu does not cover "Record log"');

            // The row works with a real click, and the menu closes.
            const z0 = (await view(h)).zoom;
            await h.input.click(`${ZOOM_MENU} .graph-zoom-item[data-act="fit"]`);
            await frame(h);
            h.assert((await view(h)).zoom < z0, 'Zoom to fit from the chip brings both far-apart boxes into view');
            h.eq(await h.eval((sel) => /** @type {any} */ (document.querySelector(sel)).hidden, ZOOM_MENU), true, 'and the menu closes');

            // The toolbar's own % button still opens it under itself, inside the toolbar.
            await h.input.click('#lolcomputer .graph-zoom');
            const own = await h.eval((sel) => {
                const m = /** @type {any} */ (document.querySelector(sel));
                const btn = document.querySelector('#lolcomputer .graph-zoom').getBoundingClientRect();
                const r = m.getBoundingClientRect();
                return { shown: !m.hidden, floating: m.classList.contains('graph-zoom-menu-floating'), below: r.top >= btn.bottom, inside: r.right <= window.innerWidth && r.bottom <= window.innerHeight };
            }, ZOOM_MENU);
            h.eq(own, { shown: true, floating: false, below: true, inside: true }, 'the % button opens it under itself, as before');
        },
    },

    {
        name: 'k9-keep-pins-the-seed-and-stales-nothing',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await freshDoc(h, 'k9 keep');
            const note = await h.computer.place('note', 40, 60);
            await h.computer.set(note, { text: 'a slow spiral' });
            const a = await h.computer.place('ask', 340, 40);
            await h.computer.set(a, { instruction: 'Describe the brief.', model: 'mock-echo' });
            const b = await h.computer.place('ask', 700, 40);
            await h.computer.set(b, { instruction: 'Give it a title.', model: 'mock-echo' });
            h.eq((await h.computer.wire(note, a, 'in')).ok, true);
            h.eq((await h.computer.wire(a, b, 'in')).ok, true, 'A feeds B, both new each run');

            await runAll(h);
            h.eq((await h.mock.log({ path: COMPLETIONS })).length, 2, 'the first Run all asks for A and B');
            const before = await partOf(h, b);
            h.eq([(await partOf(h, a)).state, before.state], ['done', 'done']);
            const seedA = (await partOf(h, a)).stats.seed;

            // Keep, with a real click: A's seed is pinned, and NOTHING turns stale.
            await h.input.click(inBox(a, '.graph-ins-seed-keep'));
            h.eq((await partOf(h, a)).settings.seed, String(seedA), 'Keep pins exactly the seed A answered with');
            h.eq([(await partOf(h, a)).state, (await partOf(h, b)).state], ['done', 'done'],
                'pinning the seed the answer on screen came from changes nothing that was computed');

            // Run all: nothing to run, nothing sent, B keeps its answer and its seed.
            await runAll(h);
            await h.waitFor(() => ((document.querySelector('#lolcomputer .comp-run-status') || {}).textContent ? true : null));
            h.eq(await h.eval(() => document.querySelector('#lolcomputer .comp-run-status').textContent), await str(h, 'computer.runNothing'),
                'the next Run all says there is nothing to run');
            h.eq((await h.mock.log({ path: COMPLETIONS })).length, 2, 'and sends nothing');
            const after = await partOf(h, b);
            h.eq([after.value.data, after.stats.seed], [before.value.data, before.stats.seed], 'B keeps its answer and its seed');

            // Keep is still one undoable edit.
            await h.computer.undo();
            h.eq((await partOf(h, a)).settings.seed, '', 'one undo takes the pin back');

            // A seed that did NOT make the answer on screen is a real edit: 🎲 stales A and B.
            await h.input.click(inBox(a, '.graph-ins-seed-dice'));
            h.assert(/^\d+$/.test((await partOf(h, a)).settings.seed), '🎲 pinned a number');
            h.eq([(await partOf(h, a)).state, (await partOf(h, b)).state], ['stale', 'stale'], 'a new seed stales A and what it feeds');
        },
    },

    {
        name: 'k9-tour-step-one-says-what-the-canvas-does',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await h.fresh();
            await h.view('computer');
            await h.waitFor(() => (window.LolComputer && window.LolComputer.ready && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
            await h.setFarm(null);
            await h.computer.welcome.press('tour');
            await h.waitFor(() => (window.LolComputer.debug.computer.doc().parts.some((/** @type {any} */ p) => p.id === 'p_bin') ? true : null), { timeout: 10000 });
            await h.waitFor(() => (document.querySelector('#lolcomputer .comp-rail .comp-rail-text') ? true : null), { timeout: 10000 });
            const step = TOUR.steps.find((/** @type {any} */ s) => s.id === 's-look');
            h.eq((await h.computer.tutorial.rail()).text, step.text, 'the rail shows step 1 as written');
            h.assert(!/drag the empty canvas to move/i.test(step.text), 'it no longer says "drag the empty canvas to move"');
            await h.eval(() => { window.LolComputer.app.host.canvas.setView({ x: 0, y: 0, zoom: 1 }); return true; });
            await frame(h);

            // "Dragging empty canvas draws a box that selects": a real drag around the sticky note.
            const v0 = await view(h);
            const from = await h.eval(() => {
                const r = document.querySelector('#lolcomputer .graph-part[data-id="p_bin"]').getBoundingClientRect();
                return { a: { x: r.left - 14, y: r.top - 8 }, b: { x: r.right + 14, y: r.bottom + 8 } };
            });
            h.eq((await h.input.hit(from.a.x, from.a.y)) && (await h.input.hit(from.a.x, from.a.y)).part, null, 'the drag starts on empty canvas');
            await h.input.drag(from.a, from.b, { steps: 10 });
            await frame(h);
            h.eq((await h.computer.state()).selected, ['p_bin'], 'the drag drew a selection box around the note');
            h.eq(await view(h), v0, 'and did not move the canvas');

            // "scroll … to move": a plain wheel over empty canvas pans.
            const spot = await emptySpot(h);
            await h.input.wheel({ x: spot.x, y: spot.y, dy: 120 });
            await frame(h);
            const v1 = await view(h);
            h.eq([v1.y, v1.zoom], [v0.y - 120, v0.zoom], 'the wheel moved the canvas, it did not zoom');

            // "pinch or hold Ctrl while you scroll to zoom".
            await h.sleep(250);
            for (let i = 0; i < 3; i++) await h.input.wheel({ x: spot.x, y: spot.y, dy: -10, ctrl: true });
            await frame(h);
            h.assert((await view(h)).zoom > v1.zoom, 'Ctrl+scroll zoomed in');

            // The hint: "the Hand tool (H)" and "the middle mouse button" drag the canvas itself.
            h.assert(/Hand tool \(H\)/.test(step.hint) && /middle mouse button/.test(step.hint) && /Space/.test(step.hint), 'the hint names the ways to drag the canvas');
            await h.eval(() => /** @type {any} */ (document.querySelector('#lolcomputer .graph-canvas')).focus({ preventScroll: true }));
            await h.input.key('h');
            const v2 = await view(h);
            const spot2 = await emptySpot(h);
            await h.input.drag(spot2, { x: spot2.x - 80, y: spot2.y - 50 }, { steps: 6 });
            await frame(h);
            const v3 = await view(h);
            h.eq([Math.round(v3.x - v2.x), Math.round(v3.y - v2.y)], [-80, -50], 'with the Hand tool a drag moves the canvas');
            await h.input.key('v');
            const spot3 = await emptySpot(h);
            await h.input.drag(spot3, { x: spot3.x + 60, y: spot3.y + 40 }, { steps: 6, button: 'middle' });
            await frame(h);
            const v4 = await view(h);
            h.eq([Math.round(v4.x - v3.x), Math.round(v4.y - v3.y)], [60, 40], 'and so does the middle button, under Select');
            h.eq(await h.eval(() => (document.querySelector('#lolcomputer .graph-tool-select') || {}).getAttribute('aria-pressed')), 'true', 'V is back to Select');
        },
    },

    {
        name: 'k9-paste-a-picture-with-text-makes-one-box',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await freshDoc(h, 'k9 paste');
            await h.eval(() => {
                const a = /** @type {any} */ (document.activeElement);
                if (a && typeof a.blur === 'function') a.blur();
                /** @type {any} */ (document.querySelector('#lolcomputer .graph-canvas')).focus({ preventScroll: true });
                return true;
            });
            const took = await h.eval((b64) => {
                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const dt = new DataTransfer();
                dt.items.add(new File([bytes], 'cells.png', { type: 'image/png' }));
                dt.setData('text/plain', 'Q1\t120\nQ2\t140');
                const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
                document.querySelector('#lolcomputer .graph-canvas').dispatchEvent(ev);
                return ev.defaultPrevented;
            }, PNG_1PX);
            h.eq(took, true, 'the paste was taken');
            await h.waitFor(() => {
                const img = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ p) => p.type === 'image');
                return img && img.settings && img.settings.dataUrl ? true : null;
            }, { timeout: 10000 });
            await h.sleep(300);
            const types = await h.eval(() => window.LolComputer.debug.computer.doc().parts.map((/** @type {any} */ p) => p.type));
            h.eq(types, ['image'], 'one Ctrl+V of a picture with text is ONE box: the picture');

            // Plain words alone still become a Text box (A7).
            await h.eval(() => {
                const dt = new DataTransfer();
                dt.setData('text/plain', 'Just words.');
                document.querySelector('#lolcomputer .graph-canvas').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
                return true;
            });
            await h.waitFor(() => (window.LolComputer.debug.computer.doc().parts.some((/** @type {any} */ p) => p.type === 'note') ? true : null), { timeout: 5000 });
            const notes = await h.eval(() => window.LolComputer.debug.computer.doc().parts.filter((/** @type {any} */ p) => p.type === 'note').map((/** @type {any} */ p) => p.settings.text));
            h.eq(notes, ['Just words.'], 'words on their own still paste as a Text box');
        },
    },
];
