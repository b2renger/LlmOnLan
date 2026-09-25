// @ts-check
// Critic R1, Package B: the session and the library under REAL input (K-6, h.input.*).
//
//   B1  run, move a box, Ctrl+Z: the move is undone and every answer stays
//   B3  clicking the card of the graph that is already open does not stop its run
//   B4  deleting the open graph during a run: it stays deleted, journal and all, across a reload
//   B7  Escape: out of a field it only leaves the field; with the drawer open it closes the drawer
//       and the run goes on; only then does it stop the run
//   B8  switching to a graph whose parts reuse the same ids builds FRESH boxes
//
// The rest of Package B's session rules (the open race B11, no writes before an open B12, the
// card's last run B13, the migration's per-source marker B14) are pure and pinned in Node by
// `chat-unit.js computer-canvas-r1`.
//
// Critic S1-14: the canvas toolbar's Run/Stop are no longer drawn on the Computer — the run bar's
// Run all and Stop are its one run door — so these scenarios press those.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/, /aborted/i];
const COMPLETIONS = '/v1/chat/completions';

/** The library's debug door, by name. */
const lib = (/** @type {any} */ h, /** @type {string} */ name, /** @type {any[]} */ ...args) => h.eval((n, a) => window.LolComputer.debug.library[n](...a), name, args);

/** The Computer on a NEW document titled `title`; returns its id. */
async function freshDoc(/** @type {any} */ h, /** @type {string} */ title) {
    await h.view('computer');
    await h.waitFor(() => {
        const d = window.LolComputer && window.LolComputer.debug;
        return d && d.library && typeof d.library.openId === 'function' && d.library.openId() && d.computer ? true : null;
    }, { timeout: 20000 });
    const id = await lib(h, 'create', title);
    await h.waitFor((want) => (window.LolComputer.debug.computer.docId() === want ? true : null), { args: [id], timeout: 15000 });
    await h.eval(() => { window.LolComputer.app.host.canvas.setView({ x: 0, y: 0, zoom: 1 }); return true; });
    await frame(h);
    await h.mock.reset();
    return id;
}

const frame = (/** @type {any} */ h) => h.eval(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))));
const sel = (/** @type {string} */ id, /** @type {string} */ inner) => `#lolcomputer .graph-part[data-id="${id}"]${inner ? ' ' + inner : ''}`;
const part = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const p = window.LolComputer.debug.computer.doc().parts.find((x) => x.id === pid);
    return p ? { x: p.x, y: p.y, state: p.state, value: p.value } : null;
}, id);
const running = (/** @type {any} */ h) => h.eval(() => window.LolComputer.debug.computer.running());
const headOf = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + Math.min(60, r.width / 3), y: r.top + r.height / 2 };
}, sel(id, '.graph-part-head'));

/** Note ("Paris") → Instruction, on `model`. */
async function build(/** @type {any} */ h, /** @type {string} */ model) {
    const note = await h.graph.place('note', 40, 60);
    const ask = await h.graph.place('ask', 400, 40);
    await h.graph.set(note, { text: 'Paris' });
    await h.graph.set(ask, { instruction: 'name three things', model });
    const w = await h.graph.wire(note, ask, 'in');
    h.eq(w.ok, true, 'Note feeds the Instruction');
    await frame(h);
    return { note, ask };
}

/** Until the graph's request has really reached the mock. */
async function waitForPost(/** @type {any} */ h, /** @type {string} */ model) {
    for (let i = 0; i < 100; i++) {
        const log = await h.mock.log({ path: COMPLETIONS, model });
        if (log.length) return log;
        await h.sleep(100);
    }
    throw new Error(`no ${model} request reached the mock`);
}

const settled = (/** @type {any} */ h) => h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 30000 });

export default [
    {
        // B1 (a): "move a box, press Run all, then Ctrl+Z the move: every answer vanishes".
        name: 'k8-input-run-move-undo-keeps-the-answers',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await freshDoc(h, 'k8 undo keeps answers');
            const { note, ask } = await build(h, 'mock-echo');
            await h.input.click('#lolcomputer .comp-run-all');
            await h.waitFor(() => (window.LolComputer.debug.computer.running() ? true : null), { timeout: 5000 }).catch(() => true);
            await settled(h);
            const ran = await part(h, ask);
            h.eq(ran.state, 'done', 'the Run button ran the graph');
            h.assert(ran.value && ran.value.data, 'and the Instruction has an answer');

            const from = await headOf(h, note);
            const x0 = (await part(h, note)).x;
            await h.input.drag(from, { x: from.x + 120, y: from.y + 40 }, { steps: 8 });
            await frame(h);
            h.eq((await part(h, note)).x, x0 + 120, 'the box moved by its title bar');

            await h.input.key('z', { ctrl: true });
            await frame(h);
            const back = await part(h, note);
            const answer = await part(h, ask);
            h.eq(back.x, x0, 'Ctrl+Z put the box back');
            h.eq(answer.state, 'done', 'the answer was NOT rewound to "not run"');
            h.eq(answer.value && answer.value.data, ran.value.data, 'and it is the same answer');
            h.eq((await part(h, note)).state, 'done', 'the source kept its state too');
        },
    },

    {
        // B3: a click on the highlighted card during a slow run used to stop it.
        name: 'k8-input-clicking-the-open-card-keeps-the-run',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            const id = await freshDoc(h, 'k8 open card');
            await build(h, 'mock-slow');
            await h.input.click('#lolcomputer .comp-run-all');
            await waitForPost(h, 'mock-slow');
            h.eq(await running(h), true, 'the run is live, waiting on the slow model');
            const card = `#lolcomputer .comp-card[data-id="${id}"] .comp-card-open`;
            h.eq(await h.eval((s) => !!document.querySelector(s), card), true, 'the open graph has its card');
            await h.input.click(card);
            await h.sleep(300);
            h.eq(await running(h), true, 'clicking the card of the graph already open does not stop its run');
            h.eq(await h.eval(() => window.LolComputer.debug.computer.docId()), id, 'and nothing was switched');
            h.eq((await h.mock.log({ path: COMPLETIONS, model: 'mock-slow' })).filter((e) => e.closedEarly).length, 0, 'no request was aborted');
            await h.input.click('#lolcomputer .comp-run-stop');
            await settled(h);
        },
    },

    {
        // B4: "Deleting the open graph during a run brings it back."
        name: 'k8-input-delete-the-open-graph-during-a-run-and-it-stays-deleted',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await freshDoc(h, 'k8 keeper');                    // somewhere to land after the delete
            const doomed = await freshDoc(h, 'k8 doomed');
            await build(h, 'mock-slow');
            await h.input.click('#lolcomputer .comp-run-all');
            await waitForPost(h, 'mock-slow');
            h.eq(await running(h), true, 'a run is live on the graph about to be deleted');

            await h.input.move(`#lolcomputer .comp-card[data-id="${doomed}"] .comp-card-open`);
            await h.input.click(`#lolcomputer .comp-card[data-id="${doomed}"] .comp-card-act[data-act="delete"]`);
            await h.waitFor(() => (document.querySelector('dialog.chat-dialog .chat-dialog-ok') ? true : null), { timeout: 5000 });
            await h.input.click('dialog.chat-dialog .chat-dialog-ok');
            await h.waitFor((d) => (window.LolComputer.debug.computer.docId() && window.LolComputer.debug.computer.docId() !== d ? true : null), { args: [doomed], timeout: 10000 });
            h.eq(await running(h), false, 'switching away stopped the run');
            // Past the save debounce and the stopped run's last journal write.
            await h.sleep(1500);
            const stored = await h.eval(async (d) => {
                const repo = window.LolComputer.app.repo;
                return { row: !!(await repo.getGraph(d)), journal: await repo.kvGet('computer:runs:' + d, null) };
            }, doomed);
            h.eq(stored.row, false, 'the row did not come back');
            h.eq(stored.journal, null, 'its run journal went with it');
            h.eq(await h.eval((d) => window.LolComputer.debug.library.cards().some((c) => c.id === d), doomed), false, 'the card is gone');

            await h.reload();
            await h.view('computer');
            await h.waitFor(() => {
                const d = window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.library;
                return d && typeof d.openId === 'function' && d.openId() ? true : null;
            }, { timeout: 20000 });
            const after = await h.eval((d) => window.LolComputer.debug.library.list().some((r) => r.id === d), doomed);
            h.eq(after, false, 'after a reload the deleted graph is still deleted');
        },
    },

    {
        // B7: Escape follows §8.1's ladder.
        name: 'k8-input-escape-leaves-a-field-then-closes-the-drawer-then-stops-the-run',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await freshDoc(h, 'k8 escape');
            const { ask } = await build(h, 'mock-slow');
            await h.input.click('#lolcomputer .comp-run-all');
            await waitForPost(h, 'mock-slow');

            // 1. In a field: Escape leaves the field and nothing else.
            await h.input.click(sel(ask, '.graph-ins-instruction'));
            h.eq(await h.eval(() => document.activeElement && document.activeElement.className), 'graph-ins-instruction', 'the prompt field has the caret');
            await h.input.key('Escape');
            h.eq(await h.eval(() => document.activeElement && document.activeElement.className === 'graph-ins-instruction'), false, 'Escape left the field');
            h.eq(await running(h), true, 'and did NOT stop a run');

            // 2. The drawer is open, the focus is on the canvas: Escape closes the drawer only.
            await h.eval(() => { window.LolComputer.app.drawer.open({ kind: 'text', data: 'a value being read' }); return true; });
            h.eq(await h.eval(() => window.LolComputer.app.drawer.isOpen()), true, 'the drawer is open');
            await h.eval(() => { document.querySelector('#lolcomputer .graph-canvas').focus({ preventScroll: true }); return true; });
            await h.input.key('Escape');
            h.eq(await h.eval(() => window.LolComputer.app.drawer.isOpen()), false, 'the first Escape closed the drawer');
            h.eq(await running(h), true, 'and the run goes on');

            // 3. Nothing else to close: the next Escape stops the run.
            await h.input.key('Escape');
            await settled(h);
            h.eq(await running(h), false, 'the next Escape stopped the run');
        },
    },

    {
        // B8: lessons reuse part ids across graphs; a switch must not keep the last graph's boxes.
        name: 'k8-input-a-graph-switch-builds-fresh-boxes',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            const a = await freshDoc(h, 'k8 same ids A');
            const b = await lib(h, 'create', 'k8 same ids B');
            // Two documents holding a part with the SAME id (as two lessons do).
            await h.eval(async (ids) => {
                const repo = window.LolComputer.app.repo;
                for (const [gid, text] of [[ids.a, 'from A'], [ids.b, 'from B']]) {
                    const row = await repo.getGraph(gid);
                    row.parts = [{ id: 'n_same', type: 'note', x: 60, y: 60, w: 260, h: 170, settings: { text, locked: false }, value: null, state: 'idle', error: null, stats: null }];
                    row.wires = [];
                    await repo.putGraph(row);
                }
                return true;
            }, { a, b });
            await lib(h, 'open', b);
            await lib(h, 'open', a);
            await h.waitFor((d) => (window.LolComputer.debug.computer.docId() === d && document.querySelector('#lolcomputer .graph-part[data-id="n_same"]') ? true : null), { args: [a] });
            await h.eval(() => { document.querySelector('#lolcomputer .graph-part[data-id="n_same"]').dataset.k8mark = 'A'; return true; });
            await h.input.click(`#lolcomputer .comp-card[data-id="${b}"] .comp-card-open`);
            await h.waitFor((d) => (window.LolComputer.debug.computer.docId() === d ? true : null), { args: [b] });
            await frame(h);
            const box = await h.eval(() => {
                const el = document.querySelector('#lolcomputer .graph-part[data-id="n_same"]');
                return el ? { mark: el.dataset.k8mark || '', text: el.textContent || '' } : null;
            });
            h.assert(box, 'graph B shows its box');
            h.eq(box.mark, '', 'it is a NEW box, not graph A\'s box reused');
            h.assert(box.text.indexOf('from B') >= 0, `and it shows B's words: ${box.text.slice(0, 60)}`);
        },
    },
];
