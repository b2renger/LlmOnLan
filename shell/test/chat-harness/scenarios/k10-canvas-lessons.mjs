// @ts-check
// Critic S1, Package B, in the real browser with REAL input (h.input.*: CDP's Input domain —
// hit testing, pointer capture, focus, default actions). Every lesson step below is done EXACTLY
// as its text says, and the step must tick:
//
//   S1-5   lesson 2 s1 and lesson 4 s4: "drag from the dot on its right edge onto the box" — a
//          wire dropped on a box's BODY plugs into its first free input; a drop on nothing says so;
//          a picked-up wire end dropped on another box's body re-plugs there
//   S1-6   lesson 3 s2: click the "name me" tag, type `before` (the `f` must not Fit), Enter; the
//          rail's Show me puts that tag on screen; a selected arrow can be named by typing or F2
//   S1-9   Tab to a box that is off screen brings it on screen before anything can delete it
//   S2-3   Tab inside a box taller than the view brings each focused CONTROL on screen, and only
//          a Tab moves the view
//   S1-10  a Timer plan refused before it starts says its own arithmetic, not "stopped after 10"
//   S1-11  the toolbar's and the library card's Export… default the same way, in the same words;
//          the toolbar's file button says it replaces, the library's that it adds
//   S1-14  ONE Run button on the Computer
//   S1-15  Ctrl+0 zooms to 100 % (the key is matched by its place; AZERTY's `à` included)
//
// The pure half is chat-unit's computer-s1-canvas.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const COMPLETIONS = '/v1/chat/completions';

/** Two frames: the canvas's ONE rAF has run. */
const frame = (/** @type {any} */ h) => h.eval(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))));
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);
const said = (/** @type {any} */ h) => h.eval(() => window.LolComputer.debug.computer.state().said);
const doc = (/** @type {any} */ h) => h.computer.doc();
const sel = (/** @type {string} */ id, /** @type {string} */ inner) => `#lolcomputer .graph-part[data-id="${id}"]${inner ? ' ' + inner : ''}`;
const wiresOf = async (/** @type {any} */ h) => (await doc(h)).wires.map((/** @type {any} */ w) => ({ from: w.from, to: w.to, port: w.port, label: w.label || '' }));

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

/** Open a lesson by CLICKING it on the Learn shelf; wait for its fork and its rail. */
async function openLesson(/** @type {any} */ h, /** @type {string} */ id) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() && window.LolComputer.app.tutorial ? true : null), { timeout: 20000 });
    await h.input.click(`#lolcomputer .comp-lesson[data-lesson="${id}"]`);
    await h.waitFor((lid) => {
        const a = window.LolComputer.app.tutorial.active();
        const rail = document.querySelector('#lolcomputer .comp-rail');
        return a && a.lessonId === lid && window.LolComputer.debug.computer.docId() === a.docId
            && rail && !rail.classList.contains('hidden') ? a : null;
    }, { timeout: 15000, args: [id] });
    await frame(h);
}

/** Wait until the open lesson has ticked `n` steps. */
async function waitStep(/** @type {any} */ h, /** @type {number} */ n, /** @type {string} */ why) {
    try {
        return await h.waitFor((want) => {
            const a = window.LolComputer.app.tutorial.active();
            return a && a.step >= want ? a : null;
        }, { timeout: 20000, args: [n] });
    } catch (e) {
        const a = await h.eval(() => window.LolComputer.app.tutorial.active());
        throw new Error(`${why}: expected step ${n}, the rail is at ${JSON.stringify(a)}`);
    }
}

/** Press a box's ▶ in its title bar with the mouse, and wait for the run it starts to end. */
async function play(/** @type {any} */ h, /** @type {string} */ id) {
    const stamp = await h.eval(() => window.LolComputer.debug.computer.doc().updatedAt);
    await h.input.click(`#lolcomputer .graph-part-play[data-part="${id}"]`);
    await h.waitFor((was) => {
        const dbg = window.LolComputer.debug.computer;
        return !dbg.running() && dbg.doc().updatedAt !== was ? true : null;
    }, { timeout: 60000, args: [stamp] });
    await h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 60000 });
    return ((await doc(h)).parts.find((/** @type {any} */ p) => p.id === id) || {}).state;
}

/** An empty spot of canvas — nothing but canvas under it and 30 px around it. */
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

/** Does this element's box overlap the canvas's (i.e. can a person see it)? */
const onCanvas = (/** @type {any} */ h, /** @type {string} */ selector) => h.eval((s) => {
    const el = document.querySelector(s);
    const c = document.querySelector('#lolcomputer .graph-canvas');
    if (!el || !c) return false;
    const a = el.getBoundingClientRect();
    const b = c.getBoundingClientRect();
    return a.width > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}, selector);

const pillOf = (/** @type {string} */ wireId) => `#lolcomputer .graph-wire-pill[data-wire="${wireId}"]`;
const wireIdOf = async (/** @type {any} */ h, /** @type {string} */ from, /** @type {string} */ to) =>
    ((await doc(h)).wires.find((/** @type {any} */ w) => w.from === from && w.to === to) || {}).id || '';

/** Type a word one REAL key at a time — the path on which a leaked `f` would Fit the canvas. */
async function typeKeys(/** @type {any} */ h, /** @type {string} */ word) {
    for (const ch of word) await h.input.key(ch);
}

/** A client point on a wire's drawn curve, `at` of the way along it. */
const onWire = (/** @type {any} */ h, /** @type {string} */ wireId, /** @type {number} */ at) => h.eval((id, k) => {
    const path = /** @type {any} */ (document.querySelector(`#lolcomputer path.graph-wire[data-wire="${id}"]`));
    const p = path.getPointAtLength(path.getTotalLength() * k);
    const m = path.getScreenCTM();
    return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
}, wireId, at);

export default [
    {
        // S1-5 in lesson 2 (s1): "drag from the dot on its right edge onto the Instruction".
        name: 'k10-canvas-lessons-lesson-2-a-wire-dropped-on-the-box-connects-and-ticks',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await openLesson(h, 'l02-wires');
            h.eq((await h.eval(() => window.LolComputer.app.tutorial.active())).step, 0, 'the lesson opens on step 1');
            h.eq((await wiresOf(h)).length, 1, 'the lesson ships one wire (story → title)');

            // A release on nothing: no wire, and the reader is told where to drop.
            const out = sel('p_note', '.graph-port[data-dir="out"]');
            await h.input.drag(out, await emptySpot(h), { steps: 10 });
            await frame(h);
            h.eq((await wiresOf(h)).length, 1, 'dropped on nothing, no wire is made');
            h.eq(await said(h), await str(h, 'graph.wireDropNowhere'), 'and the live region says where to drop it');

            // As the step says: onto the Instruction — the middle of its prompt, not its dot.
            await h.input.drag(out, sel('p_story', '.graph-ins-instruction'), { steps: 12 });
            await frame(h);
            const made = (await wiresOf(h)).filter((w) => w.from === 'p_note' && w.to === 'p_story');
            h.eq(made.length, 1, 'dropped on the box, the Text box is wired into the story');
            h.eq(made[0].port, 'in', 'into its first free input');
            h.assert(/p_note|Text/.test(await said(h)) || (await said(h)).length > 0, 'the wiring is announced');
            await waitStep(h, 1, 'the wire made as the step says ticks step 1');
            h.eq(await h.eval(() => document.querySelectorAll('#lolcomputer .graph-part[data-drop-target]').length), 0,
                'no box is left outlined as a drop target');
        },
    },

    {
        // S1-5 in lesson 4 (s1–s4, all by hand): the SVG box, its code, ＋ "Write an SVG", then the
        // wire "onto the SVG box".
        name: 'k10-canvas-lessons-lesson-4-wire-onto-the-svg-box-ticks',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await openLesson(h, 'l04-draw');
            h.eq(await play(h, 'p_svg'), 'done', '▶ on the SVG box draws its own code');
            await waitStep(h, 1, 's1');

            await h.input.click(sel('p_svg', '.graph-preview-source'));
            await h.input.key('End', { ctrl: true });
            await h.input.type('\n<!-- k10 -->');
            await waitStep(h, 2, 's2: changing the code ticks it');

            await h.input.click('#lolcomputer .graph-add');
            await h.input.click('#lolcomputer .graph-add-menu:not([hidden]) .graph-add-item[data-entry="write-svg"]');
            const writer = await h.waitFor(() => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.type === 'ask' && x.settings && x.settings.code === 'svg');
                return p ? p.id : null;
            }, { timeout: 5000 });
            await waitStep(h, 3, 's3: “Write an SVG” from ＋');
            await frame(h);

            // As the step says: from the dot on its right edge onto the SVG box — its middle.
            await h.input.drag(sel(writer, '.graph-port[data-dir="out"]'), sel('p_svg'), { steps: 12 });
            await frame(h);
            const made = (await wiresOf(h)).filter((w) => w.from === writer && w.to === 'p_svg');
            h.eq(made.length, 1, 'dropped on the SVG box, “Write an SVG” feeds it');
            h.eq(made[0].port, 'content', 'through its one input');
            await waitStep(h, 4, 's4 ticks');
            h.eq((await h.mock.log({ path: COMPLETIONS })).length, 0, 'none of it asked the farm anything');
        },
    },

    {
        // S1-5 off the lessons: a box that takes nothing says so; a picked-up end re-plugs on a body.
        name: 'k10-canvas-lessons-drops-on-bodies-plug-in-refuse-out-loud-and-re-plug',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await freshDoc(h, 'k10 body drops');
            const note = await h.computer.place('note', 40, 60);
            const a1 = await h.computer.place('ask', 420, 40);
            const a2 = await h.computer.place('ask', 420, 380);
            const sticky = await h.computer.place('sticky', 60, 420);
            await frame(h);

            await h.input.drag(sel(note, '.graph-port[data-dir="out"]'), sel(sticky), { steps: 10 });
            await frame(h);
            h.eq((await wiresOf(h)).length, 0, 'a sticky note takes no input: no wire');
            h.assert(/takes nothing in/.test(await said(h)), `and it says so: ${await said(h)}`);

            await h.input.drag(sel(note, '.graph-port[data-dir="out"]'), sel(a1, '.graph-part-head'), { steps: 10 });
            await frame(h);
            h.eq(await wiresOf(h), [{ from: note, to: a1, port: 'in', label: '' }], 'dropped on the title bar, it plugs in too');

            // Pick the end up at a1's input and drop it on a2's BODY: re-plugged there, one entry.
            await h.input.drag(sel(a1, '.graph-port[data-dir="in"]'), sel(a2, '.graph-ins-instruction'), { steps: 10 });
            await frame(h);
            h.eq((await wiresOf(h)).map((w) => [w.from, w.to]), [[note, a2]], 'the picked-up end re-plugs into the box it was dropped on');
            await h.input.click(await emptySpot(h));
            await h.input.key('z', { ctrl: true });
            await frame(h);
            h.eq((await wiresOf(h)).map((w) => [w.from, w.to]), [[note, a1]], 'and one undo takes the re-plug back');
        },
    },

    {
        // S1-6 in lesson 3 (s1, s2): the blank run, then name each arrow AS THE STEP SAYS.
        name: 'k10-canvas-lessons-lesson-3-the-name-me-tag-names-the-arrow-and-ticks',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await openLesson(h, 'l03-labels');
            h.eq(await play(h, 'p_ask'), 'done', 'the blank run answers');
            await waitStep(h, 1, 's1: the blank run');

            const tag = await str(h, 'graph.wireNameMe');
            const rail = await h.computer.tutorial.rail();
            h.assert(String(rail.text).includes(`“${tag}”`), `step 2 points at the tag the canvas draws: ${rail.text}`);

            // Show me, from far away: the tag of the busy street's arrow comes into view.
            const cars = await wireIdOf(h, 'p_cars', 'p_ask');
            const trees = await wireIdOf(h, 'p_trees', 'p_ask');
            await h.eval(() => { window.LolComputer.app.host.canvas.setView({ x: -4000, y: -3000, zoom: 0.85 }); return true; });
            await frame(h);
            h.eq(await onCanvas(h, pillOf(cars)), false, 'panned away, the tag is off screen');
            await h.input.click('#lolcomputer .comp-rail .comp-rail-show');
            await frame(h);
            h.eq(await onCanvas(h, pillOf(cars)), true, 'Show me puts the “name me” tag on screen');
            const ph = await h.eval((s) => (document.querySelector(s) || {}).textContent || '', `${pillOf(cars)} .graph-wire-ph`);
            h.eq(ph, tag, 'and it is the tag the step names');

            // Click the tag, type `before` one real key at a time, Enter.
            await h.input.click(`${pillOf(cars)} .graph-wire-ph`);
            const fitSaid = await str(h, 'graph.saidFit');
            await typeKeys(h, 'before');
            h.assert((await said(h)) !== fitSaid, 'the `f` in "before" did not Fit the canvas');
            await h.input.key('Enter');
            await frame(h);
            h.eq((await wiresOf(h)).find((w) => w.from === 'p_cars').label, 'before', 'the arrow is named before');

            await h.input.click(`${pillOf(trees)} .graph-wire-ph`);
            await typeKeys(h, 'after');
            await h.input.key('Enter');
            await frame(h);
            h.eq((await wiresOf(h)).find((w) => w.from === 'p_trees').label, 'after', 'the other is named after');
            await waitStep(h, 2, 's2: both arrows named as the step says');
        },
    },

    {
        // S1-6 off the lesson: a selected arrow is named by typing (or F2), never by shortcuts.
        name: 'k10-canvas-lessons-a-selected-arrow-is-named-by-typing-or-f2',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await freshDoc(h, 'k10 arrow typing');
            const a = await h.computer.place('note', 40, 40);
            const b = await h.computer.place('ask', 640, 300);
            const w = await h.computer.wire(a, b, 'in');
            h.eq(w.ok, true);
            await frame(h);

            // Click the LINE (a fifth of the way along, clear of the tag), then just type.
            await h.input.click(await onWire(h, w.id, 0.2));
            h.eq(await h.eval(() => window.LolComputer.debug.computer.state().selectedWires.length), 1, 'the click selected the arrow');
            const before = await h.eval(() => window.LolComputer.debug.computer.view());
            await typeKeys(h, 'before');
            await h.input.key('Enter');
            await frame(h);
            h.eq((await wiresOf(h))[0].label, 'before', 'typing with the arrow selected named it');
            h.eq(await h.eval(() => window.LolComputer.debug.computer.view()), before, 'and no key was a shortcut: the view did not move');
            h.eq(await h.eval(() => window.LolComputer.debug.computer.state().tool || window.LolComputer.app.host.canvas.tool()), 'select', 'nor did `h`/`v` switch tools');

            // F2 on the selected arrow: its name, selected, typed over.
            await h.input.click(await onWire(h, w.id, 0.2));
            await h.input.key('F2');
            await typeKeys(h, 'topic');
            await h.input.key('Enter');
            await frame(h);
            h.eq((await wiresOf(h))[0].label, 'topic', 'F2 renames the selected arrow');
        },
    },

    {
        // S1-9: "Tab focuses and selects a box that is off screen … Delete then removes a box
        // nobody can see."
        name: 'k10-canvas-lessons-tab-brings-the-focused-box-on-screen',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await freshDoc(h, 'k10 tab');
            const a = await h.computer.place('note', 40, 40);
            const b = await h.computer.place('note', 3000, 2000);
            await frame(h);
            h.eq(await onCanvas(h, sel(b)), false, 'B starts off screen');
            await h.input.click(sel(a, '.graph-part-title'));

            let reached = false;
            for (let i = 0; i < 12 && !reached; i++) {
                await h.input.key('Tab');
                await frame(h);
                const where = await h.eval(() => {
                    const el = document.activeElement;
                    const part = el && el.closest ? el.closest('#lolcomputer .graph-part') : null;
                    return part ? part.getAttribute('data-id') : null;
                });
                if (where) h.assert(await onCanvas(h, sel(where)), `Tab #${i + 1} focused ${where}, which must be on screen`);
                if (where === b) reached = true;
            }
            h.assert(reached, 'Tab reaches B');
            h.eq(await h.eval(() => window.LolComputer.debug.computer.state().selected), [b], 'B is focused AND selected');
            h.eq(await onCanvas(h, sel(b)), true, 'and the view followed it: B is on screen');
            await h.input.key('Delete');
            h.eq((await doc(h)).parts.map((/** @type {any} */ p) => p.id), [a], 'Delete removed the box the person could see');
        },
    },

    {
        // S2-3: an Instruction at 350 % is taller than the canvas. Tab through it from the prompt:
        // the Model picker, the seed, 🎲, ✕ and the strip each used to stay below the view while it
        // sat on the box's top. Every control Tab reaches must be on screen.
        name: 'k10-canvas-lessons-tab-inside-a-box-taller-than-the-view-keeps-each-control-on-screen',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await freshDoc(h, 'k10 tab tall');
            const ins = await h.computer.place('ask', 40, 40);
            await h.computer.set(ins, { instruction: 'Summarise the report in a page.' });
            await h.eval(() => { window.LolComputer.app.host.canvas.setView({ x: 0, y: 0, zoom: 3.5 }); return true; });
            await frame(h);
            const tall = await h.eval((s) => {
                const box = document.querySelector(s).getBoundingClientRect();
                const c = document.querySelector('#lolcomputer .graph-canvas').getBoundingClientRect();
                return box.height > c.height;
            }, sel(ins));
            h.eq(tall, true, 'at 350 % the box is taller than the canvas');
            await h.input.click(sel(ins, '.graph-ins-instruction'));
            h.eq(await h.eval(() => (document.activeElement ? document.activeElement.className : '')), 'graph-ins-instruction',
                'the click put the caret in the prompt');
            const viewY = async () => (await h.eval(() => window.LolComputer.debug.computer.view())).y;
            const startY = await viewY();

            let checked = 0;
            for (let i = 0; i < 12; i++) {
                await h.input.key('Tab');
                await frame(h);
                const got = await h.eval((id) => {
                    const a = /** @type {any} */ (document.activeElement);
                    const part = a && a.closest ? a.closest('#lolcomputer .graph-part') : null;
                    if (!part || part.getAttribute('data-id') !== id) return { inBox: false };
                    const r = a.getBoundingClientRect();
                    const c = document.querySelector('#lolcomputer .graph-canvas').getBoundingClientRect();
                    // Wholly inside when it fits the canvas on that axis, overlapping when it cannot.
                    const axis = (/** @type {number} */ lo, /** @type {number} */ hi, /** @type {number} */ a0, /** @type {number} */ a1) =>
                        (a1 - a0 <= hi - lo ? a0 >= lo - 1 && a1 <= hi + 1 : a0 < hi && a1 > lo);
                    return {
                        inBox: true,
                        what: `${a.tagName.toLowerCase()}.${String(a.className || '')}`,
                        onScreen: r.width > 0 && axis(c.left, c.right, r.left, r.right) && axis(c.top, c.bottom, r.top, r.bottom),
                        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
                        canvas: [Math.round(c.left), Math.round(c.top), Math.round(c.right), Math.round(c.bottom)],
                    };
                }, ins);
                if (!got.inBox) break;
                checked += 1;
                h.assert(got.onScreen, `Tab #${i + 1} focused ${got.what} at ${JSON.stringify(got.rect)}, which must be inside the canvas ${JSON.stringify(got.canvas)}`);
            }
            h.assert(checked >= 3, `Tab walked through at least three controls of the box (${checked})`);
            const movedY = await viewY();
            h.assert(movedY < startY, `the view followed the focus down the box (${startY} → ${movedY})`);

            // Tab only: a focus no Tab caused (a script's re-focus) leaves the view where it is, even
            // on a control that is now off screen.
            const promptInside = await h.eval((s) => {
                const r = document.querySelector(s).getBoundingClientRect();
                const c = document.querySelector('#lolcomputer .graph-canvas').getBoundingClientRect();
                return r.top >= c.top && r.bottom <= c.bottom;
            }, sel(ins, '.graph-ins-instruction'));
            h.eq(promptInside, false, 'the prompt is no longer wholly in view (a Tab-caused focus there WOULD pan)');
            await h.eval((s) => { document.querySelector(s).focus(); return true; }, sel(ins, '.graph-ins-instruction'));
            await frame(h);
            h.eq(await viewY(), movedY, 'a programmatic focus does not move the view');
        },
    },

    {
        // S1-10: a Timer at 3600 s is refused before it starts, in its own words.
        name: 'k10-canvas-lessons-a-refused-timer-plan-says-its-arithmetic',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await freshDoc(h, 'k10 timer plan');
            await h.mock.reset();
            const timer = await h.computer.place('timer', 60, 60);
            await h.computer.set(timer, { seconds: 3600 });
            await frame(h);
            await h.input.click('#lolcomputer .comp-run-all');
            const notice = await h.waitFor(() => {
                const cap = document.querySelector('#lolcomputer .graph-cap');
                const title = cap && !cap.hidden ? (cap.querySelector('.graph-cap-title') || {}).textContent : '';
                return title || null;
            }, { timeout: 10000 });
            h.eq(notice, await str(h, 'computer.limitTimerPlan', { minutes: 60, limitMinutes: 10 }), 'the notice is the plan’s arithmetic');
            h.assert(notice !== await str(h, 'computer.limitWall', { minutes: 10 }), 'not "the run stopped after 10 minutes"');
            const raise = await h.eval(() => {
                const b = document.querySelector('#lolcomputer .graph-cap .graph-cap-raise');
                return b && !b.hidden && !b.disabled ? b.textContent : '';
            });
            h.eq(raise, await str(h, 'computer.limitRaise'), 'with the one button the sentence names');
            h.eq((await h.mock.log({ path: COMPLETIONS })).length, 0, 'nothing was sent');
            h.eq((await doc(h)).parts[0].state === 'running', false, 'and nothing is left running');
        },
    },

    {
        // S1-11, S1-14, S1-15: the toolbar agrees with the library, the Computer has one Run, and
        // Ctrl+0 zooms to 100 %.
        name: 'k10-canvas-lessons-export-and-import-agree-one-run-button-and-ctrl-0',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            const id = await freshDoc(h, 'k10 export');
            await h.computer.place('note', 60, 60);
            await frame(h);
            const include = await str(h, 'computer.libExportValues');

            // The toolbar's Export…
            await h.input.click('#lolcomputer .graph-export');
            const bar = await h.eval(() => {
                const m = document.querySelector('#lolcomputer .graph-export-menu');
                const box = /** @type {any} */ (m.querySelector('.graph-export-values-input'));
                const note = /** @type {any} */ (m.querySelector('.graph-export-note'));
                return { open: !m.hidden, checked: box.checked, label: m.querySelector('.graph-export-values').textContent, note: note.getClientRects().length > 0 };
            });
            h.eq(bar.open, true, 'Export… opens');
            h.eq(bar.checked, true, 'results are included by default');
            h.eq(bar.label, include, 'in the library card’s words');
            h.eq(bar.note, true, 'and the note about pictures shows');
            await h.input.click('#lolcomputer .graph-export-values-input');
            h.eq(await h.eval(() => document.querySelector('#lolcomputer .graph-export-note').getClientRects().length), 0,
                'unticked, the note about pictures going in the file is gone');
            await h.input.click('#lolcomputer .graph-export');

            // The library card's Export…
            await h.input.move(`#lolcomputer .comp-card[data-id="${id}"] .comp-card-open`);
            await h.input.click(`#lolcomputer .comp-card[data-id="${id}"] .comp-card-act[data-act="export"]`);
            const card = await h.waitFor(() => {
                const box = /** @type {any} */ (document.querySelector('.chat-popover [data-act="export-values"]'));
                if (!box) return null;
                const pop = box.closest('.chat-popover');
                const note = pop.querySelector('.comp-export-note');
                return { checked: box.checked, label: box.closest('label').textContent, note: !!note && note.getClientRects().length > 0 };
            }, { timeout: 5000 });
            h.eq(card, { checked: true, label: include, note: true }, 'the card’s Export… asks the same thing the same way');
            await h.input.key('Escape');

            // The two file buttons say what they do.
            const files = await h.eval(() => {
                const rep = /** @type {any} */ (document.querySelector('#lolcomputer .graph-import'));
                const imp = /** @type {any} */ (document.querySelector('#lolcomputer .comp-side [data-act="import"], #lolcomputer [data-act="import"]'));
                return { rep: rep.textContent, repTitle: rep.title, imp: imp.textContent, impTitle: imp.title };
            });
            h.eq(files.rep, await str(h, 'graph.replaceFromFile'), 'the toolbar button REPLACES, and says so');
            h.assert(/Import… in the library/.test(files.repTitle), `and points at the library's Import…: ${files.repTitle}`);
            h.eq(files.imp, await str(h, 'computer.libImport'));
            h.eq(files.impTitle, await str(h, 'graph.importNewHint'), 'the library’s adds a new graph, and says so');

            // One Run button.
            const runs = await h.eval(() => {
                const shown = (/** @type {any} */ el) => !!el && el.getClientRects().length > 0;
                const all = Array.from(document.querySelectorAll('#lolcomputer button')).filter(shown);
                return {
                    toolbarRun: shown(document.querySelector('#lolcomputer .graph-run')),
                    toolbarStop: shown(document.querySelector('#lolcomputer .graph-stop')),
                    runAll: shown(document.querySelector('#lolcomputer .comp-run-all')),
                    named: all.map((b) => (b.textContent || '').trim()).filter((t) => /^Run( all)?$/i.test(t)),
                };
            });
            h.eq(runs.toolbarRun, false, 'the toolbar’s Run is not drawn on the Computer');
            h.eq(runs.toolbarStop, false, 'nor its Stop');
            h.eq(runs.runAll, true, 'the run bar’s Run all is the run door');
            h.eq(runs.named.length, 1, `exactly one Run button: ${JSON.stringify(runs.named)}`);

            // Ctrl+0: a real key, and the AZERTY key (`à` at Digit0) through the same handler.
            await h.eval(() => { window.LolComputer.app.host.canvas.setView({ x: 0, y: 0, zoom: 0.5 }); return true; });
            await h.input.click(await emptySpot(h));
            await h.input.key('0', { ctrl: true });
            await frame(h);
            h.eq((await h.eval(() => window.LolComputer.debug.computer.view())).zoom, 1, 'Ctrl+0 zooms to 100 %');
            await h.eval(() => { window.LolComputer.app.host.canvas.setView({ x: 0, y: 0, zoom: 0.5 }); return true; });
            const azerty = await h.eval(() => {
                const c = document.querySelector('#lolcomputer .graph-canvas');
                const ev = new KeyboardEvent('keydown', { key: 'à', code: 'Digit0', ctrlKey: true, bubbles: true, cancelable: true });
                c.dispatchEvent(ev);
                return ev.defaultPrevented;
            });
            await frame(h);
            h.eq(azerty, true, 'AZERTY’s Ctrl+à (the 0 key) is taken');
            h.eq((await h.eval(() => window.LolComputer.debug.computer.view())).zoom, 1, 'and zooms to 100 %');
        },
    },
];
