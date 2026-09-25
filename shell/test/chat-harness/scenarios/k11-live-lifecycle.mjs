// @ts-check
// K-9 (docs/COMPUTER_LIVE_PLAN.md, builder L): what starts, stops and pauses a live box — with
// REAL input wherever a person would act (h.input.*), and the harness's own doors only for what a
// person does outside the page (hiding the Computer, minimising the window).
//
//   one at a time   ▶ Live on a second box stops the first, which forgets its choice
//   pauses          hiding the Computer, hiding the window, or panning the box off screen stops
//                   the sketch; coming back resumes the box that was chosen
//   ■ Stop          the frame goes and the snapshot comes back
//   the box         stays draggable by its title bar while live, and the SAME frame keeps running
//   Run code        Ctrl+Enter in the box's code restarts the live sketch with the edit — and runs
//                   neither the graph nor this box as a run
//   Edit code       opens the drawer's editor on this box's code (K-8, builder E's side)
//   perf            nothing live → no frame, no observer: .graph-part keeps content-visibility:auto

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

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
const part = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === pid);
    return p ? { x: p.x, y: p.y, w: p.w, h: p.h, state: p.state, settings: p.settings } : null;
}, id);
const sel = (/** @type {string} */ id, /** @type {string} */ inner) => `#lolcomputer .graph-part[data-id="${id}"]${inner ? ' ' + inner : ''}`;

async function box(/** @type {any} */ h, /** @type {string} */ mode, /** @type {string} */ source, /** @type {number} */ x, /** @type {number} */ y) {
    const id = await h.computer.place('preview', x, y);
    await h.computer.set(id, { mode, source, w: 300, h: 200 });
    await frame(h);
    return id;
}

/** Which box is live (the id of the box whose stage holds the live frame), or ''. */
const liveBox = (/** @type {any} */ h) => h.eval(() => {
    const fr = document.querySelector('#lolcomputer .sandbox-live-frame');
    const p = fr ? fr.closest('.graph-part') : null;
    return p ? p.getAttribute('data-id') : '';
});
/** The live handle's state, or null. */
const liveState = (/** @type {any} */ h) => h.eval(() => {
    const sb = window.LolComputer.debug.computer.session().sandboxNow();
    const l = sb && sb.liveNow ? sb.liveNow() : null;
    return l ? l.state() : null;
});
const waitLive = (/** @type {any} */ h, /** @type {string} */ id, timeout = 20000) => h.waitFor((pid) => {
    const sb = window.LolComputer.debug.computer.session().sandboxNow();
    const l = sb && sb.liveNow ? sb.liveNow() : null;
    const fr = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .sandbox-live-frame');
    return l && fr && l.state() === 'running' ? true : null;
}, { args: [id], timeout });
const waitNotLive = (/** @type {any} */ h, timeout = 10000) => h.waitFor(() => {
    const sb = window.LolComputer.debug.computer.session().sandboxNow();
    const l = sb && sb.liveNow ? sb.liveNow() : null;
    return !l && !document.querySelector('.sandbox-live-frame') ? true : null;
}, { timeout });
const liveLogs = (/** @type {any} */ h) => h.eval(() => {
    const sb = window.LolComputer.debug.computer.session().sandboxNow();
    const l = sb && sb.liveNow ? sb.liveNow() : null;
    return l ? l.logs().map((x) => x.text) : [];
});
const pressed = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((s) => {
    const b = document.querySelector(s);
    return b ? b.getAttribute('aria-pressed') : null;
}, sel(id, '.graph-preview-live'));

const P5_A = [
    "function setup() { createCanvas(windowWidth, windowHeight); console.log('A up'); }",
    'function draw() { background(20, 60, 120); fill(255); circle(width / 2, height / 2, 40 + 20 * Math.sin(frameCount / 10)); }',
].join('\n');
const P5_B = [
    "function setup() { createCanvas(windowWidth, windowHeight); console.log('B up'); }",
    'function draw() { background(120, 40, 20); fill(255); rect(20, 20, width - 40, 10 + (frameCount % 40)); }',
].join('\n');

export default [
    {
        name: 'k11-live-one-box-at-a-time-and-hiding-pauses-it',
        needsMock: true,
        timeoutMs: 150000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await freshDoc(h, 'k11 one at a time');
            const a = await box(h, 'p5', P5_A, 40, 40);
            const b = await box(h, 'p5', P5_B, 440, 40);

            // A photograph first, so "leaving live restores the snapshot" has one to restore.
            await h.computer.play(b);
            await h.waitFor((pid) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === pid);
                return p && (p.state === 'done' || p.state === 'error') ? p.state : null;
            }, { args: [b], timeout: 30000 });
            const tile = await h.eval((s) => { const i = document.querySelector(s); return i ? i.getAttribute('src') : null; }, sel(b, '.graph-preview-tile'));
            h.assert(tile && tile.startsWith('data:image/png'), 'B has a snapshot to come back to');

            await h.input.click(sel(a, '.graph-preview-live'));
            await waitLive(h, a);
            h.eq(await liveBox(h), a, 'A is live');
            await h.input.click(sel(b, '.graph-preview-live'));
            await waitLive(h, b);
            h.eq(await liveBox(h), b, 'pressing ▶ Live on B moves the live sketch to B');
            h.eq(await h.eval(() => document.querySelectorAll('.sandbox-live-frame').length), 1, 'ONE live frame in the page, never two');
            h.eq(await pressed(h, a), 'false', 'A says ▶ Live again');
            h.eq((await part(h, a)).settings.live, false, 'and A forgot its choice (it was replaced, not paused)');
            h.eq((await part(h, b)).settings.live, true, 'B remembers it');
            h.eq((await part(h, b)).state, 'done', 'going live marks nothing stale: B is still done');
            h.assert((await liveLogs(h)).indexOf('B up') >= 0, 'and it is B\'s own code that runs');

            // Hiding the Computer stops it; showing it again resumes the box that was chosen.
            await h.view('chat');
            await waitNotLive(h);
            h.eq((await part(h, b)).settings.live, true, 'a pause keeps the choice');
            await h.view('computer');
            await waitLive(h, b);
            h.note('hide → stopped, show → resumed');

            // Hiding the WINDOW does the same.
            await h.setPageVisible(false);
            await waitNotLive(h);
            await h.setPageVisible(true);
            await waitLive(h, b);

            // Panning the box off screen stops it; panning back resumes it.
            await h.eval(() => { window.LolComputer.app.host.canvas.setView({ x: -4000, y: 0, zoom: 1 }); return true; });
            await waitNotLive(h);
            await h.eval(() => { window.LolComputer.app.host.canvas.setView({ x: 0, y: 0, zoom: 1 }); return true; });
            await waitLive(h, b);

            // ■ Stop: the frame goes, the snapshot comes back, the choice is forgotten.
            await h.input.click(sel(b, '.graph-preview-live'));
            await waitNotLive(h);
            const back = await h.eval((s) => { const i = document.querySelector(s); return i ? i.getAttribute('src') : null; }, sel(b, '.graph-preview-tile'));
            h.eq(back, tile, 'leaving live shows the snapshot again');
            h.eq((await part(h, b)).settings.live, false, 'Stop forgets the choice');
            await h.view('chat');
            await h.view('computer');
            await wait(h, 600);
            h.eq(await liveState(h), null, 'a stopped box does not come back by itself');
        },
    },
    {
        name: 'k11-live-box-drags-by-its-title-and-ctrl-enter-restarts-the-sketch',
        needsMock: true,
        timeoutMs: 150000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await freshDoc(h, 'k11 title and run code');
            // Perf: with no box live there is no live frame, and the boxes keep content-visibility.
            const cv = await h.eval(() => {
                const p = document.querySelector('#lolcomputer .graph-part');
                return p ? getComputedStyle(p).contentVisibility : 'no part';
            });
            const id = await box(h, 'p5', P5_A, 60, 60);
            h.eq(await h.eval(() => document.querySelectorAll('.sandbox-live-frame').length), 0, 'nothing live: no live frame');
            h.eq(await h.eval((s) => getComputedStyle(document.querySelector(s)).contentVisibility, sel(id, '')), 'auto',
                `a box keeps content-visibility:auto (was ${cv})`);

            await h.input.click(sel(id, '.graph-preview-live'));
            await waitLive(h, id);
            await h.eval(() => {
                window.__k11Frame = document.querySelector('.sandbox-live-frame');
                const sb = window.LolComputer.debug.computer.session().sandboxNow();
                window.__k11Handle = sb.liveNow();
                return true;
            });

            // The title bar still moves the box, and the sketch keeps running in the SAME frame.
            const p0 = await part(h, id);
            const head = await h.eval((s) => {
                const r = document.querySelector(s).getBoundingClientRect();
                return { x: r.left + Math.min(60, r.width / 3), y: r.top + r.height / 2 };
            }, sel(id, '.graph-part-head'));
            await h.input.drag(head, { x: head.x + 120, y: head.y + 50 }, { steps: 10 });
            await frame(h);
            const p1 = await part(h, id);
            h.eq([p1.x - p0.x, p1.y - p0.y], [120, 50], 'the live box moved with its title bar');
            const same = await h.eval(() => {
                const sb = window.LolComputer.debug.computer.session().sandboxNow();
                return sb.liveNow() === window.__k11Handle && document.querySelector('.sandbox-live-frame') === window.__k11Frame
                    && window.__k11Handle.state() === 'running' && window.__k11Handle.debug().runs === 1;
            });
            h.eq(same, true, 'the same live frame kept running (nothing was reloaded or re-run)');

            // Ctrl+Enter in the box's code: restart the live sketch with the edit.
            await h.input.click(sel(id, '.graph-preview-source'));
            await h.input.key('End', { ctrl: true });
            await h.input.type("\nconsole.log('edited ' + 42);");
            await h.input.key('Enter', { ctrl: true });
            await h.waitFor(() => {
                const sb = window.LolComputer.debug.computer.session().sandboxNow();
                const l = sb.liveNow();
                return l && l.logs().some((x) => x.text === 'edited 42') ? true : null;
            }, { timeout: 10000 });
            const after = await h.eval(() => {
                const sb = window.LolComputer.debug.computer.session().sandboxNow();
                return { same: sb.liveNow() === window.__k11Handle, runs: window.__k11Handle.debug().runs };
            });
            h.eq(after, { same: true, runs: 2 }, 'Ctrl+Enter re-ran the edit in the same live frame');
            h.eq(await h.computer.running(), false, 'and did not start a run of the graph');
            h.assert(/edited/.test(String((await part(h, id)).settings.source)), 'the edit is the box\'s own code now');

            // Run code (the button) does the same.
            await h.input.click(sel(id, '.graph-preview-run'));
            await h.waitFor(() => (window.__k11Handle.debug().runs === 3 ? true : null), { timeout: 10000 });

            // The box's own ▶ (a run of this box) redraws its picture — and the live sketch follows.
            await h.computer.play(id);
            await h.waitFor((pid) => {
                const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === pid);
                return p && p.state === 'done' && window.__k11Handle.debug().runs === 4 ? true : null;
            }, { args: [id], timeout: 30000 });
            h.eq(await h.eval(() => window.LolComputer.debug.computer.session().sandboxNow().liveNow() === window.__k11Handle), true,
                'a run of the live box restarted the same live sketch');

            // Edit code opens the drawer's editor on THIS box's code (builder E's K-8).
            const hasEdit = await h.eval((s) => { const b = document.querySelector(s); return !!b && !b.hidden; }, sel(id, '.graph-preview-edit'));
            if (hasEdit) {
                await h.input.click(sel(id, '.graph-preview-edit'));
                const ed = await h.waitFor((pid) => {
                    const area = document.querySelector('#lolcomputer .comp-code-area[data-part="' + pid + '"]');
                    return area ? area.value : null;
                }, { args: [id], timeout: 5000 });
                h.assert(/edited ' \+ 42/.test(ed), `the drawer's editor holds the box's code, edit included: ${JSON.stringify(String(ed).slice(-60))}`);
            } else {
                h.note('Edit code hidden: app.drawer.editCode is not there (builder E not landed)');
            }
            await h.screenshot('k11-live-run-code');
        },
    },
];
