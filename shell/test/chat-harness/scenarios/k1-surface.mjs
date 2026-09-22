// @ts-check
// K1-U1 in the real browser: the Computer as a THIRD SURFACE (COMPUTER_PLAN §2.3, §11 K1-U1).
//
// The whole of K1 rests on one structural claim — that two Apps can share one spine — and on one
// consequence of it that a unit test cannot reach: `app/ask.mjs` refuses with `busy` when
// `app.state.visible` is false, and the Computer surface is ALWAYS shown while `#lolchat` is
// hidden. If the two surfaces shared an App, every model call the Computer made would fail the
// moment it was the one on screen. So `k1-surface-ask-not-hidden` is the most important scenario
// in this phase: it runs a real generation, against the real mock farm, with the chat hidden, and
// counts the POST.
//
// What is NOT here, by decision (§0.3): the segmented control, `aria-pressed`, the OWUI webview
// surviving a switch, and `localStorage['lol:view']`. `chat-harness/page.html` has no topbar, no
// `.viewseg` and no `<webview>`, and never loads `app.js` — those four are rig items §13.1–4, and
// a scenario that "asserted" them here would be asserting code the harness never executes.
//
// The parked-run half of the `visible` rule is likewise not here and cannot be: parking arrives
// with K3's runner (`executing()` vs `running()`). It is proved in
// chat/unit/computer-surface.test.mjs against the shipped predicate; what this file proves is the
// other three quadrants, through the real MutationObserver and the real runner.

const COMPLETIONS = '/v1/chat/completions';

/** Network noise the farm's own error paths make in the console. */
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when the Computer's own modules were skipped or replaced. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const g = window.LolComputer;
    if (!g) throw new Error('window.LolComputer is absent: computer/main.mjs never mounted');
    const failed = g.failed || {};
    const missing = ['host', 'ask'].filter((k) => failed[k]);
    if (missing.length) {
        throw new Error(`K1-U1 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
    }
    return true;
});

/** Completion POSTs the mock has seen, ever. */
const completions = async (/** @type {any} */ h) => (await h.mock.log({ path: COMPLETIONS })).length;

/** Show the Computer and wait until it really has a document open. */
async function open(/** @type {any} */ h, /** @type {any} */ opts) {
    await h.fresh(Object.assign({ refreshMs: 500 }, opts || {}));
    await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));
    await requireReal(h);
    const view = await h.computer.open();
    h.eq(view.computer, true, 'the Computer surface is showing');
    // The host opens the last document (or makes the first one) as soon as the store settles; the
    // canvas refuses to place a part until it has one.
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    await h.mock.reset();                    // every count below is about the GRAPH
    return view;
}

/** The parts of the open document, by id. */
const parts = async (/** @type {any} */ h) => {
    const state = await h.computer.state();
    /** @type {Record<string, any>} */ const by = {};
    for (const p of state.parts) by[p.id] = p;
    return by;
};

/** One Ask box that will really talk to the mock farm. */
async function askBox(/** @type {any} */ h, /** @type {string} */ instruction) {
    const id = await h.computer.place('ask', 60, 60);
    h.assert(id, 'the Computer refused to place a part: it has no document open');
    await h.computer.set(id, { instruction, model: 'mock-echo' });
    return id;
}

export default [
    {
        name: 'k1-surface-mount',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        // The surface exists, mounts its own canvas inside its own root, and does not take the
        // chat away with it — `#lolchat` is HIDDEN, not removed, because its App, its store and
        // its farm listeners go on living behind it.
        async run(/** @type {any} */ h) {
            await open(h);

            const spine = await h.computer.spine();
            h.eq(spine.ready, true, 'window.LolComputer.ready resolved');
            h.eq(spine.failed.filter((/** @type {string} */ k) => k === 'host').length, 0, 'the host component loaded');

            const dom = await h.computer.dom();
            h.eq(dom.hidden, false, 'the Computer is showing');
            h.eq(dom.root, true, 'and its canvas mounted INSIDE #lolcomputer');
            h.eq(dom.side, true, 'the library sidebar frame is there');
            h.eq(dom.chatHidden, true, 'the chat is hidden…');
            h.eq(dom.chatPresent, true, '…and still in the DOM, App and all');

            // The canvas belongs to the Computer and to nothing else: no second `.graph` grew
            // inside #lolchat just because the modules are shared.
            const leaked = await h.eval(() => document.querySelectorAll('#lolchat .graph-canvas').length);
            h.eq(leaked, 0, 'the chat has no canvas of its own on this surface');

            const id = await h.computer.place('note', 40, 40);
            h.assert(id, 'a part can be placed with no thread anywhere in the window');
            const state = await h.computer.state();
            h.eq(state.parts.length, 1);
            h.eq(state.threadId, null, 'a library document has no thread, by definition');
            h.eq(state.docId, (await h.computer.doc()).id, 'and docId names the open document');

            // And it survives a reload — which is the bug §0.3 names: graph/store.mjs returned
            // early on !doc.threadId, so a threadless document persisted nothing at all.
            await h.computer.save();
            await h.reload({ refreshMs: 500 });
            await h.computer.open();
            await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
            const after = await h.computer.state();
            h.eq(after.parts.length, 1, 'the document came back from IndexedDB with its part');
            h.eq(after.docId, state.docId, 'and it is the same document, not a fresh blank one');
        },
    },

    {
        name: 'k1-surface-two-apps',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        // Two Apps, one spine (§2.3). The three shared instances are shared by IDENTITY; the buses
        // are not, or `ask` would read the wrong surface's `visible`.
        async run(/** @type {any} */ h) {
            await open(h);
            const s = await h.computer.spine();
            h.eq(s.sameApp, false, 'the Computer builds its OWN App — this is the whole of §2.3');
            h.eq(s.sameRepo, true, 'one IndexedDB connection: two would fight the journal');
            h.eq(s.sameFarm, true, 'one snapshot model, one capability cache');
            h.eq(s.sameGov, true, 'one governor: two would each allow a background call');
            h.eq(s.sameBus, false, 'separate buses — that is what the mirror exists to bridge');

            const roots = await h.eval(() => ({
                chat: window.LolChat.app.root.id,
                computer: window.LolComputer.app.root.id,
            }));
            h.eq(roots.chat, 'lolchat');
            h.eq(roots.computer, 'lolcomputer', 'each App is rooted in its own section');
        },
    },

    {
        name: 'k1-surface-ask-not-hidden',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        // THE scenario of K1. `app/ask.mjs` refuses with `busy` when app.state.visible is false and
        // `state.visible` is derived from the root's `hidden` class. With one shared App, every
        // Computer generation would fail the moment the Computer was the surface on screen.
        async run(/** @type {any} */ h) {
            await open(h);

            const hidden = await h.eval(() => ({
                chatVisible: window.LolChat.app.state.visible,
                computerVisible: window.LolComputer.app.state.visible,
            }));
            h.eq(hidden.chatVisible, false, 'the chat is hidden, so ITS ask would refuse — correctly');
            h.eq(hidden.computerVisible, true, 'the Computer is shown, so ITS ask must not');

            const id = await askBox(h, 'say hello from the Computer');
            const before = await completions(h);
            const report = await h.computer.run();

            h.assert(!report.busy, 'the run must not come back `busy`: that is ask.mjs refusing a hidden surface');
            h.eq(report.ran, 1, 'one part ran');
            h.eq((report.errors || []).length, 0, `no errors: ${JSON.stringify(report.errors || [])}`);
            h.eq(await completions(h) - before, 1, 'and exactly one generation really left the window');

            const live = await parts(h);
            h.eq(live[id].state, 'done');
            h.assert(live[id].value && live[id].value.kind, 'the part carries a real value');
        },
    },

    {
        name: 'k1-surface-no-seats',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        // §3.5: `freeSeat()` used to return FALSE when the farm advertised no seats, and every
        // graph run is background — so on an older farm build, an `external` engine, or before the
        // first snapshot lands, the Computer could never run at all.
        async run(/** @type {any} */ h) {
            await open(h);
            await h.mock.state({ capacity: null });
            const seats = await h.waitFor(() => {
                const farm = window.LolComputer.app.farm;
                const caps = farm ? farm.get() : null;
                return caps && caps.seats === null ? { seats: caps.seats } : null;
            }, { timeout: 15000 });
            h.eq(seats.seats, null, 'the farm advertises no seat gate at all');

            const allowed = await h.eval(() => window.LolComputer.app.gov.canStart('background'));
            h.eq(allowed, true, 'seats unknown must allow the ONE background slot, not refuse it');

            const id = await askBox(h, 'a run on a farm with no seat gate');
            const before = await completions(h);
            const report = await h.computer.run();
            h.assert(!report.busy, 'a farm with no seats must not read as a full one');
            h.eq(report.ran, 1);
            h.eq(await completions(h) - before, 1, 'the generation really went');
            h.eq((await parts(h))[id].state, 'done');
        },
    },

    {
        name: 'k1-surface-mirror',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        // §2.3, revision 2: net/farm.mjs emits on the bus of the App it was CONSTRUCTED with — the
        // chat's. Mirroring only GOV_CHANGE would leave the Computer's farm chip, its plan preview
        // and (through caps) its vision verdict frozen at boot.
        async run(/** @type {any} */ h) {
            await open(h);

            await h.eval(() => {
                const seen = [];
                window.__k1mirror = seen;
                const bus = window.LolComputer.app.bus;
                bus.on('farm:change', () => seen.push('change'));
                bus.on('farm:tick', () => seen.push('tick'));
                return true;
            });

            await h.mock.state({ capacity: { slots: 4, clients: 2, seatsUsed: 1, seatIdleSec: 900 } });
            const seen = await h.waitFor(() => {
                const m = window.__k1mirror || [];
                return m.indexOf('change') >= 0 && m.indexOf('tick') >= 0 ? m.slice() : null;
            }, { timeout: 15000 });
            h.assert(seen.indexOf('change') >= 0, 'FARM_CHANGE reached the Computer’s bus');
            h.assert(seen.indexOf('tick') >= 0, 'and so did FARM_TICK — the wall-clock rules run there');

            const caps = await h.eval(() => {
                const chat = window.LolChat.app.farm.get();
                const comp = window.LolComputer.app.farm.get();
                return {
                    chatSlots: chat.seats ? chat.seats.slots : null,
                    compSlots: comp.seats ? comp.seats.slots : null,
                    sameModel: chat.defaultModel === comp.defaultModel,
                };
            });
            h.eq(caps.compSlots, 4, 'the Computer sees the snapshot that just changed');
            h.eq(caps.chatSlots, caps.compSlots, 'both surfaces read ONE farm model');

            // `caps` is installed exactly once, on the SHARED farm, so the cap resolver answers the
            // same on both surfaces — a second install would have overwritten the first's.
            const vision = await h.eval(() => {
                const model = window.LolComputer.app.farm.get().defaultModel || 'mock-echo';
                return {
                    chat: window.LolChat.app.farm.cap(model, 'vision'),
                    computer: window.LolComputer.app.farm.cap(model, 'vision'),
                };
            });
            h.eq(vision.computer, vision.chat, 'one cap resolver, one answer — §2.3’s single caps install');
        },
    },

    {
        name: 'k1-surface-park-idle',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        // The `visible` rule from the outside (§2.3, revision 2). The parked quadrant needs K3's
        // runner and lives in the unit test; these are the three the browser can really show.
        async run(/** @type {any} */ h) {
            await open(h);
            h.eq(await h.eval(() => window.LolComputer.debug.visible()), true, 'shown → visible');

            // Hidden and idle: false. This is the quadrant that matters for etiquette — a surface
            // nobody is looking at, with nothing running, must not hold a seat open.
            await h.view('chat');
            const idle = await h.waitFor(() => {
                const v = window.LolComputer.debug.visible();
                return v === false ? { visible: v } : null;
            }, { timeout: 8000 });
            h.eq(idle.visible, false, 'hidden and idle → NOT visible');

            // Hidden while an activation EXECUTES: true. A run the human deliberately started,
            // bounded by the run's own ceilings, keeps its seat while they look elsewhere.
            await h.computer.open();
            const id = await askBox(h, 'a slow one, so we can look away mid-run');
            // A lead-in on the mock, so "hide the surface WHILE it runs" is a real window and not
            // a race against a reply that lands in eight milliseconds.
            await h.mock.state({ askDelayMs: 1500 });
            const running = h.computer.run();
            await h.waitFor(() => (window.LolComputer.debug.computer.running() ? true : null), { timeout: 10000 });
            await h.view('chat');
            const duringRun = await h.eval(() => ({
                visible: window.LolComputer.debug.visible(),
                running: window.LolComputer.debug.computer.running(),
                hidden: document.getElementById('lolcomputer').classList.contains('hidden'),
            }));
            h.eq(duringRun.hidden, true, 'the surface really is hidden…');
            h.eq(duringRun.running, true, '…and the run really is still going…');
            h.eq(duringRun.visible, true, '…so visible stays true and the generation is not refused');

            const report = await running;
            await h.mock.state({ askDelayMs: 0 });
            h.eq((report.errors || []).length, 0, `the run finished behind the chat: ${JSON.stringify(report.errors || [])}`);
            h.eq((await parts(h))[id].state, 'done');

            // And it comes back down when the run ends, with the surface still hidden.
            const after = await h.waitFor(() => {
                const v = window.LolComputer.debug.visible();
                return v === false ? { visible: v } : null;
            }, { timeout: 8000 });
            h.eq(after.visible, false, 'the run ended, the surface is still hidden: visible drops again');
        },
    },

    {
        name: 'k1-surface-copy-export',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        // §3.2: copy/paste and the toolbar asked "is there a THREAD"; export and import REFUSED
        // without one. A library document has no thread and never will, so those five sites are
        // `session.docId()` now and the two guards are gone.
        async run(/** @type {any} */ h) {
            await open(h);

            const toolbar = await h.eval(() => {
                const add = document.querySelector('#lolcomputer .graph-add');
                const run = document.querySelector('#lolcomputer .graph-run');
                const empty = document.querySelector('#lolcomputer .graph-empty');
                return {
                    addDisabled: add ? add.disabled : null,
                    runDisabled: run ? run.disabled : null,
                    empty: empty ? (empty.textContent || '').trim() : '',
                };
            });
            h.eq(toolbar.addDisabled, false, 'the toolbar is live with a document and no thread');
            h.eq(toolbar.runDisabled, false);
            h.assert(!/conversation/i.test(toolbar.empty), `the empty canvas must not ask for a chat: "${toolbar.empty}"`);

            const note = await h.computer.place('note', 40, 40);
            await h.computer.set(note, { text: 'copied with no thread in sight' });
            await h.computer.select([note]);

            const clip = await h.eval(() => {
                const canvas = document.querySelector('#lolcomputer .graph-canvas');
                canvas.focus();
                const dt = new DataTransfer();
                canvas.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
                return dt.getData('text/plain');
            });
            h.assert(clip.indexOf('"lolgraph":1') > 0, `copy put our format on the clipboard: ${clip.slice(0, 60)}`);

            const pasted = await h.eval((text) => {
                const canvas = document.querySelector('#lolcomputer .graph-canvas');
                const dt = new DataTransfer();
                dt.setData('text/plain', text);
                canvas.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
                return window.LolComputer.debug.computer.state();
            }, clip);
            h.eq(pasted.parts.length, 2, 'paste worked with no thread: the guard was the only thing stopping it');
            h.assert(pasted.parts[0].id !== pasted.parts[1].id, 'the pasted part got a new id');

            // Export, then import into a second document: both used to return early without a
            // thread, and K1-U2's library depends on their absence.
            const text = await h.computer.exportText({ values: false });
            h.assert(typeof text === 'string' && text.length > 0, 'export produced a file with no thread');
            h.assert(text.indexOf('copied with no thread in sight') > 0, 'and it carries the reader’s own words');

            const fresh = await h.computer.call('open', null).then(() => h.computer.call('open', 'k1-import-target'));
            h.eq(fresh.id, 'k1-import-target', 'a second library document, opened by id');
            h.eq((await h.computer.state()).parts.length, 0, 'and it starts empty');

            const imported = await h.computer.importText(text, { confirm: false });
            h.eq(imported.ok, true, `import must not refuse without a thread: ${imported.message}`);
            h.eq(imported.parts, 2, 'both parts came in');
            const back = await h.computer.state();
            h.eq(back.parts.length, 2);
            h.eq(back.docId, 'k1-import-target', 'into the document that was open, not into a thread');
        },
    },
];
