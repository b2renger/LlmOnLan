// @ts-check
// K2-U3 in the real browser: the transcript drawer — "what gets sent" (COMPUTER_PLAN §8.1).
//
// The claim under test is the one the whole build leans on: you can read the prompt BEFORE you
// spend a generation, the thing you read keeps up with the graph you are editing, and after a run
// the same panel tells you what came back and what it cost. So every check here presses the
// shipped surface — the strip on the box when the Instruction is in the palette, the panel's own
// tab buttons, Run all, and a real Escape key — and reads the drawer's DOM rather than the module.
//
// The one door that is not a click is `h.computer.label()`: a label pill is edited in place on the
// SVG layer, and K2-U1's own scenario (`k2-labels`) is where that gesture is driven. Here the
// rename is a means, not the subject — what is being tested is that the open drawer noticed.

/** Network noise the farm's own error paths make in the console. */
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when the surface this unit decorates was faked or skipped. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};
    const missing = ['host', 'drawer', 'transcript', 'ask'].filter((k) => failed[k]);
    if (missing.length) {
        throw new Error(`K2-U3 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
    }
    if (!window.LolComputer.app.transcript) throw new Error('app.transcript was never published');
    if (!window.LolComputer.app.drawer) throw new Error('app.drawer was never published');
    return true;
});

/** A string as the page itself resolves it, so the test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

/** The Computer, shown, with a document open and the mock's counters reset. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await requireReal(h);
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null));
    await h.mock.reset();
    return true;
}

/** A Note wired into a thinking box, the wire NAMED, and an instruction that mentions the name. */
async function build(/** @type {any} */ h, /** @type {string} */ label, /** @type {string} */ instruction) {
    const note = await h.computer.place('note', 40, 40);
    const ask = await h.computer.place('ask', 360, 40);
    h.assert(note && ask, 'a Note and a thinking box were placed');
    await h.computer.set(note, { text: 'accessibility in museums' });
    await h.computer.set(ask, { instruction, model: 'mock-echo' });
    // The thinking box's one input port is `in` on the Instruction and `context` on the C1 `ask`
    // it replaces at the K2 landing. Ask for the first, accept the second: this scenario is about
    // the transcript, and it must read the same before and after the catalogue swaps.
    let wired = await h.computer.wire(note, ask, 'in');
    if (!wired.ok) wired = await h.computer.wire(note, ask, 'context');
    h.eq(wired.ok, true, 'the Note feeds the box');
    const state = await h.computer.state();
    const wire = state.wires[state.wires.length - 1];
    h.eq(await h.computer.label(wire.id, label), true, `the wire is named ${label}`);
    return { note, ask, wire: wire.id };
}

/** Open the transcript the way a reader does: the strip on the box, when the box has one. */
async function openSent(/** @type {any} */ h, /** @type {string} */ partId) {
    const clicked = await h.eval((id) => {
        const box = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"]`);
        const strip = box ? box.querySelector('.graph-ins-strip, [data-transcript]') : null;
        if (!strip) return false;
        strip.click();
        return true;
    }, partId);
    if (!clicked) {
        // Until the K2 landing swaps the catalogue row, the box on the canvas is still C1's `ask`,
        // which has no strip. The panel's own door is then the way in, and this is said out loud
        // rather than quietly skipped.
        h.note('no strip on the box yet (the catalogue still ships C1 ask) — opened through app.transcript.open');
        h.eq(await h.computer.transcript.open(partId, 'sent'), true, 'the transcript opened on the box');
    }
    const state = await h.computer.transcript.state();
    h.eq(state.open, true, 'the drawer is showing the transcript panel');
    h.eq(state.panel, 'transcript', 'and it is the panel, not the value inspector');
    return state;
}

/** `h.eq` compares whole values; this is the one assertion that is about a fragment of a long
 * body of text, so it says what it was looking for and shows what it read instead. */
function has(/** @type {any} */ h, /** @type {any} */ text, /** @type {string} */ needle, /** @type {string} */ msg) {
    const body = String(text == null ? '' : text);
    h.assert(body.indexOf(needle) >= 0, `${msg}: ${JSON.stringify(needle)} is not in ${JSON.stringify(body.slice(0, 400))}`);
    return true;
}

/** Click one of the panel's own tabs. */
const tab = (/** @type {any} */ h, /** @type {string} */ name) =>
    h.click(`#lolcomputer .comp-tx-tab[data-tab="${name}"]`);

/** What the drawer is actually showing. */
const panel = (/** @type {any} */ h) => h.eval(() => {
    const body = document.querySelector('#lolcomputer .comp-tx-body');
    const cards = Array.from(document.querySelectorAll('#lolcomputer .comp-tx-card'));
    return {
        text: body ? body.textContent : null,
        tab: body ? body.getAttribute('data-tab') : null,
        roles: cards.map((el) => el.getAttribute('data-role')),
        heads: cards.map((el) => (el.querySelector('.comp-tx-card-head') || {}).textContent || ''),
        pending: cards.filter((el) => el.getAttribute('data-pending') === 'true').length,
        call: (document.querySelector('#lolcomputer .comp-tx-call') || {}).textContent || '',
        rungs: Array.from(document.querySelectorAll('#lolcomputer .comp-tx-rung')).map((el) => el.textContent),
        drawerWidth: (document.querySelector('#lolcomputer .comp-drawer') || {}).style
            ? document.querySelector('#lolcomputer .comp-drawer').style.width : '',
    };
});

/** Wait until a run started from the UI has finished. */
const settled = (/** @type {any} */ h) => h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true), { timeout: 20000 });

export default [
    {
        // §8.1's headline: "You can read your prompt, fix it, and read it again, for free."
        name: 'k2-transcript-sent-before-a-run',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const ids = await build(h, 'topic', 'write a problematic about the topic');
            await openSent(h, ids.ask);

            const view = await panel(h);
            h.eq(view.tab, 'sent', 'Sent is the tab you land on');
            has(h, view.text, await str(h, 'parts.insPending', { name: 'topic' }),
                'an input that has not run yet reads as the placeholder that will be replaced');
            has(h, view.text, 'write a problematic about the topic', 'and the instruction is there in full');
            h.eq(view.roles[0], 'system', 'the system message is shown, because it IS sent');
            h.eq(view.roles[view.roles.length - 1], 'instruction',
                'and the instruction is LAST, exactly as §5.3 assembles it');
            h.eq(view.heads.indexOf('topic') > 0, true, 'the card is headed by the wire\'s own name');
            h.eq(view.pending, 1, 'one card knows it is standing in for a value');
            has(h, view.call, 'mock-echo', 'the declared call names the model the box will use');

            const log = await h.mock.log({ path: '/v1/chat/completions' });
            h.eq(log.length, 0, 'READING the prompt cost nothing: not one request left the window');
        },
    },
    {
        // A prompt you read once and cannot trust afterwards is worse than none. Rename the arrow
        // and the open drawer has to follow, because what WOULD be sent just changed.
        name: 'k2-transcript-follows-the-graph',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const ids = await build(h, 'country', 'write about the topic');
            await openSent(h, ids.ask);
            const before = await panel(h);
            has(h, before.text, 'country', 'it opens under the name the wire has now');

            h.eq(await h.computer.label(ids.wire, 'topic'), true, 'the wire is renamed');
            const after = await h.waitFor(() => {
                const body = document.querySelector('#lolcomputer .comp-tx-body');
                const text = body ? body.textContent : '';
                return text && text.indexOf('country') < 0 ? text : null;
            }, { timeout: 4000 });
            h.assert(after, 'the open drawer repainted itself when the graph changed');
            has(h, after, 'topic', 'under the name the reader just typed');

            // And an instruction edited in place is the same event: the prompt moved.
            await h.computer.set(ids.ask, { instruction: 'summarise the topic in one line' });
            const edited = await h.waitFor(() => {
                const body = document.querySelector('#lolcomputer .comp-tx-body');
                const text = body ? body.textContent : '';
                return text && text.indexOf('summarise the topic in one line') >= 0 ? text : null;
            }, { timeout: 4000 });
            h.assert(edited, 'editing the instruction repaints the panel too');
        },
    },
    {
        // After a run: what came back, verbatim, and what it cost — then Escape, which closes the
        // drawer and nothing else (§8.1's ladder, rung 2).
        name: 'k2-transcript-got-cost-escape',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const ids = await build(h, 'topic', 'write about the topic');
            await openSent(h, ids.ask);
            await tab(h, 'got');
            h.eq((await panel(h)).text, await str(h, 'computer.txGotEmpty'),
                'before a run, Got says so and points at Sent');

            await h.click('#lolcomputer .comp-run-all');
            await settled(h);

            const parts = (await h.computer.state()).parts;
            const box = parts.find((/** @type {any} */ p) => p.id === ids.ask);
            h.eq(box.state, 'done', 'the box ran');
            h.assert(box.value && box.value.data, 'and produced a value');

            const got = await h.waitFor(() => {
                const body = document.querySelector('#lolcomputer .comp-tx-body');
                const text = body ? body.textContent : '';
                return text && text.indexOf('model: mock-echo') >= 0 ? text : null;
            }, { timeout: 5000 });
            h.assert(got, 'Got shows the reply the farm really sent back, verbatim');
            has(h, String(box.value.data).split('\n')[0], 'model: mock-echo',
                'and it is the same text the box is carrying as its value');

            await tab(h, 'cost');
            const cost = await panel(h);
            h.eq(cost.tab, 'cost');
            h.assert(box.stats && box.stats.tokens > 0, 'the run reported tokens');
            has(h, cost.text, String(box.stats.tokens), 'Cost quotes the tokens the run really spent');
            has(h, cost.text, await str(h, 'computer.txNotCached'),
                'and says plainly that this one was paid for');

            // Escape, on the element that has focus inside the drawer.
            const sent = await h.eval(() => {
                const el = document.activeElement;
                const inDrawer = !!(el && el.closest && el.closest('#lolcomputer .comp-drawer'));
                (inDrawer ? el : document.querySelector('#lolcomputer .comp-drawer-close'))
                    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
                return inDrawer;
            });
            h.eq(sent, true, 'focus was inside the drawer, where Escape means "close this"');
            const shut = await h.computer.transcript.state();
            h.eq(shut.open, false, 'Escape closed the transcript');
            h.eq(shut.drawerOpen, false, 'and the drawer with it');
            h.eq(await h.computer.running(), false, 'and did NOT reach the surface\'s stop gesture');

            const log = await h.mock.log({ path: '/v1/chat/completions' });
            h.eq(log.length, 1, 'ONE generation was spent for all of that reading');
        },
    },
];
