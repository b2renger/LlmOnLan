// @ts-check
// K1-U3 in the real browser: the run bar, the drawer, and the two demoted thread bridges
// (COMPUTER_PLAN §8.1, §8.3, §11 K1-U3).
//
// Everything here presses the SHIPPED control. `h.computer.run()` would drive the same run door
// from the debug side and prove nothing about the bar — so Run all is a click on
// `#lolcomputer .comp-run-all`, Stop is a click on `.comp-run-stop`, the drawer opens because a
// value CHIP was clicked, and Escape is a real KeyboardEvent on the element that has focus.
//
// The unit tests own the pure halves (the cap meter's threshold, the two count labels, bodyText).
// What only a browser can answer is here: that the bar reads the runner rather than keeping its
// own tally, that Stop leaves a half-finished run in a state a person can understand, and that
// Escape closes the drawer without also stopping the run behind it.

/** Network noise the farm's own error paths make in the console. */
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when the surface this unit decorates was faked or skipped. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};
    const missing = ['host', 'runbar', 'drawer', 'ask'].filter((k) => failed[k]);
    if (missing.length) {
        throw new Error(`K1-U3 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
    }
    const app = window.LolComputer.app;
    if (!app.runbar) throw new Error('app.runbar was never published');
    if (!app.drawer) throw new Error('app.drawer was never published');
    return true;
});

/** A string as the page itself resolves it, so the test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolComputer.app.t(k, v || undefined), key, vars || null);

/** `{n} parts`, resolved by the page, so a plural rule change is not a test change. */
const partsStr = (/** @type {any} */ h, /** @type {number} */ n) => (n === 1
    ? str(h, 'computer.runPartsOne')
    : str(h, 'computer.runParts', { n }));

/** The Computer, shown, with a document open. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await requireReal(h);
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null));
    await h.mock.reset();                       // every count below is about THIS graph
    return true;
}

/** What the run bar is actually showing. */
const bar = (/** @type {any} */ h) => h.eval(() => {
    const pick = (sel) => document.querySelector(`#lolcomputer ${sel}`);
    const text = (sel) => { const el = pick(sel); return el ? el.textContent : null; };
    const runBtn = pick('.comp-run-all');
    const stopBtn = pick('.comp-run-stop');
    return {
        run: text('.comp-run-all'),
        stop: text('.comp-run-stop'),
        runShown: !!runBtn && !runBtn.classList.contains('hidden'),
        stopShown: !!stopBtn && !stopBtn.classList.contains('hidden'),
        parts: text('.comp-run-parts'),
        gens: text('.comp-run-gens'),
        cap: text('.comp-run-cap'),
        capAmber: (pick('.comp-run-cap') || {}).dataset ? pick('.comp-run-cap').dataset.amber : null,
        zoom: text('.comp-run-zoom'),
        help: !!pick('.comp-run-help'),
        status: text('.comp-run-status'),
    };
});

/** What the drawer is showing. */
const drawer = (/** @type {any} */ h) => h.eval(() => {
    const el = document.querySelector('#lolcomputer .comp-drawer');
    const body = document.querySelector('#lolcomputer .comp-drawer .graph-inspect-body');
    const head = document.querySelector('#lolcomputer .comp-drawer .graph-inspect-head h3');
    return {
        present: !!el,
        open: !!el && !el.classList.contains('hidden'),
        heading: head ? head.textContent : null,
        body: body ? body.textContent : null,
        closes: document.querySelectorAll('#lolcomputer .comp-drawer .comp-drawer-close').length,
        empty: !!document.querySelector('#lolcomputer .comp-drawer .comp-drawer-empty'),
        width: el ? el.style.width : null,
    };
});

/** The live parts, by id. */
const parts = async (/** @type {any} */ h) => {
    const state = await h.computer.state();
    /** @type {Record<string, any>} */ const out = {};
    for (const p of state.parts) out[p.id] = p;
    return out;
};

/** Note -> Ask -> Collect: one generation, three parts. */
async function build(/** @type {any} */ h, /** @type {any} */ askSettings) {
    const note = await h.computer.place('note', 40, 40);
    const ask = await h.computer.place('ask', 320, 40);
    const collect = await h.computer.place('collect', 620, 40);
    h.assert(note && ask && collect, 'three parts were placed');
    await h.computer.set(note, { text: 'Paris' });
    await h.computer.set(ask, Object.assign({ instruction: 'name three things', model: 'mock-echo' }, askSettings || {}));
    await h.computer.set(collect, { mode: 'numbered' });
    h.eq((await h.computer.wire(note, ask, 'context')).ok, true, 'Note feeds Ask');
    h.eq((await h.computer.wire(ask, collect, 'items')).ok, true, 'Ask feeds Collect');
    return { note, ask, collect };
}

/** Wait until a run that was started from the UI has finished. */
const settled = (/** @type {any} */ h) => h.waitFor(() => (window.LolComputer.debug.computer.running() ? null : true));

export default [
    {
        name: 'k1-runbar-run-all',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The bar is a readout, not a tally: press the real button and every number on it has to
        // come back from the runner's own report.
        async run(h) {
            await open(h);
            const before = await bar(h);
            h.eq(before.run, await str(h, 'computer.runAll'), 'the bar offers Run all');
            h.eq(before.runShown, true, 'and Stop is not offered while nothing is running');
            h.eq(before.stopShown, false);
            h.eq(before.help, true, 'the ? is on the bar from K1, even though K5 is what fills it');

            await build(h);
            const placed = await bar(h);
            h.eq(placed.parts, await partsStr(h, 3),
                'before the first run the bar counts what is ON the canvas');

            await h.click('#lolcomputer .comp-run-all');
            await settled(h);

            const after = await bar(h);
            h.eq(after.parts, await partsStr(h, 3),
                'Run all on a three-part graph announces 3 parts');
            h.eq(after.gens, await str(h, 'computer.runGenerationsOne'),
                'and ONE generation — only Ask thinks, and the bar reads that off the report');
            h.eq(after.cap, '1 / 50', 'the cap meter is this run\'s spend against the limit it ran under');
            h.eq(after.capAmber, 'false', 'one generation out of fifty is not worth a colour');
            h.eq(after.status, '', 'a run that did something says nothing extra');
            h.eq(after.runShown, true, 'and the bar is offering Run all again');

            const log = await h.mock.log({ path: '/v1/chat/completions' });
            h.eq(log.length, 1, 'ONE request really left the window');

            const live = await parts(h);
            h.eq(Object.values(live).every((/** @type {any} */ p) => p.state === 'done'), true,
                'every part finished');

            // Nothing left to do: the bar says so rather than looking like it failed.
            await h.click('#lolcomputer .comp-run-all');
            await settled(h);
            const again = await bar(h);
            h.eq(again.status, await str(h, 'computer.runNothing'),
                'a second Run all with nothing stale says so, instead of looking broken');
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 1, 'and spent nothing');
        },
    },

    {
        name: 'k1-runbar-stop',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Stop is the promise that a run is yours to end. What it must NOT do is throw away what
        // you already paid for.
        async run(h) {
            await open(h);
            await h.mock.state({ delayMs: 4000 });      // the reply is still coming when Stop lands
            const ids = await build(h);

            await h.click('#lolcomputer .comp-run-all');
            await h.waitFor(() => (window.LolComputer.debug.computer.running() ? true : null));
            const during = await bar(h);
            h.eq(during.stopShown, true, 'Stop takes Run all\'s place while a run is in flight');
            h.eq(during.runShown, false, 'so the bar never offers two ways to think about one run');
            h.eq(during.stop, await str(h, 'computer.runStop'));

            // The Note finished before the Ask ever reached the farm, so it is what "kept" means.
            await h.waitFor(() => {
                const p = window.LolComputer.debug.computer.state().parts.find((x) => x.type === 'note');
                return p && p.state === 'done' ? true : null;
            });

            await h.click('#lolcomputer .comp-run-stop');
            await settled(h);

            const live = await parts(h);
            h.eq(live[ids.note].state, 'done', 'the part that had finished kept its state');
            h.assert(live[ids.note].value && live[ids.note].value.data === 'Paris',
                'and its value: Stop is not Undo');
            h.eq(live[ids.ask].state, 'stale',
                'the part the stop interrupted is stale — "will re-run", not "failed" (§8.3)');
            h.eq(live[ids.collect].state, 'stale', 'and so is everything that was still waiting');

            const after = await bar(h);
            h.eq(after.runShown, true, 'the bar is back to offering Run all');
            h.eq(after.stopShown, false);
        },
    },

    {
        name: 'k1-runbar-drawer',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // §8.1: a value you are reading gets a column of its own, and closing it is not stopping
        // the run behind it.
        async run(h) {
            await open(h);
            const shut = await drawer(h);
            h.eq(shut.present, true, 'the drawer is in the skeleton from the start');
            h.eq(shut.open, false, 'closed until there is something to read');
            h.eq(shut.empty, true, 'and it says what it is for rather than showing a blank column');

            const ids = await build(h);
            await h.click('#lolcomputer .comp-run-all');
            await settled(h);

            // The value CHIP on the Note — the shipped door into the inspector since C2.
            await h.click(`#lolcomputer .graph-part[data-id="${ids.note}"] .graph-value`);
            const openDrawer = await drawer(h);
            h.eq(openDrawer.open, true, 'clicking a value chip opened the drawer');
            h.eq(openDrawer.body, 'Paris', 'with the whole value in it');
            h.eq(openDrawer.closes, 1, 'exactly ONE close button — the drawer\'s, not the inspector\'s too');
            h.assert(/px$/.test(String(openDrawer.width)), `the drawer has a real width: ${openDrawer.width}`);

            // A second value replaces the first: one drawer, one value (§8.1).
            await h.click(`#lolcomputer .graph-part[data-id="${ids.ask}"] .graph-value`);
            const second = await drawer(h);
            h.eq(second.open, true);
            h.assert(second.body !== 'Paris', 'the second value replaced the first rather than stacking');
            h.eq(await h.eval(() => document.querySelectorAll('#lolcomputer .comp-drawer .graph-inspect').length), 1,
                'and there is still only one inspector in there');

            // Resizable, and remembered: the grip is dragged with real pointer events, and the
            // width that comes back is the clamped one, from kv.
            const dragged = await h.eval(() => {
                const el = document.querySelector('#lolcomputer .comp-drawer');
                const grip = document.querySelector('#lolcomputer .comp-drawer-grip');
                const from = parseInt(el.style.width, 10);
                const x = grip.getBoundingClientRect().left;
                grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x }));
                // Left is wider: the drawer is pinned to the right edge.
                window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x - 9000 }));
                window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x - 9000 }));
                return { from, to: parseInt(el.style.width, 10) };
            });
            h.assert(dragged.to > dragged.from, `dragging the grip left widened the drawer: ${dragged.from} → ${dragged.to}`);
            h.eq(dragged.to, 720, 'and stopped at the maximum rather than eating the canvas');
            h.eq(await h.eval(() => window.LolComputer.app.repo.kvGet('computer:drawerWidth', null)), 720,
                'the width you chose is remembered, so the next document opens the way you left it');

            // Escape, on the element that really has focus after an open.
            const esc = await h.key('#lolcomputer .comp-drawer-close', 'Escape');
            h.eq(esc.defaultPrevented, true, 'the drawer consumed the key');
            const closed = await drawer(h);
            h.eq(closed.open, false, 'Escape closed the drawer');
            h.eq(closed.empty, true, 'and it is back to saying what it is for');

            const after = await bar(h);
            h.eq(after.parts, await partsStr(h, 3),
                'the run behind it is untouched — Escape closed a drawer, it did not stop anything');
        },
    },

    {
        name: 'k1-runbar-legacy',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The two thread bridges outlive the chat panel only so a MIGRATED graph opens. On this
        // surface they cannot work, so they say so — and the rest of the graph runs anyway.
        async run(h) {
            await open(h);
            const ids = await build(h);
            const from = await h.computer.place('from-thread', 40, 320);
            h.assert(from, 'a migrated graph can still contain one, so it can still be placed');

            const badge = await h.eval((id) => {
                const part = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"]`);
                const strip = part ? part.querySelector('.graph-part-legacy') : null;
                return {
                    painted: !!part,
                    strip: strip ? strip.textContent : null,
                    tag: strip && strip.querySelector('strong') ? strip.querySelector('strong').textContent : null,
                };
            }, from);
            h.eq(badge.painted, true, 'the part still renders — a migrated graph must open');
            h.eq(badge.tag, await str(h, 'computer.legacyBadge'), 'and wears the legacy badge');
            h.assert(String(badge.strip).includes(await str(h, 'computer.legacyNoThread')),
                'with the one sentence that says what to do about it');

            await h.click('#lolcomputer .comp-run-all');
            await settled(h);

            const live = await parts(h);
            h.eq(live[from].state, 'error', 'it refused rather than inventing a value');
            h.eq(live[from].error, await str(h, 'parts.errNoThread'),
                'in one sentence, in the reader\'s own words — never a code');
            h.eq(live[ids.note].state, 'done', 'and the rest of the run carried on');
            h.eq(live[ids.ask].state, 'done');
            h.eq(live[ids.collect].state, 'done');

            const after = await bar(h);
            h.eq(after.gens, await str(h, 'computer.runGenerationsOne'),
                'a part that cannot run costs no generation');
        },
    },
];
