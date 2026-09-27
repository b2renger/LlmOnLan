// @ts-check
// C2 in the real browser: what the CANVAS shows while a graph fans out (plan §2.6 BH-3/BH-4/BH-7,
// docs/LOLCHAT_COMPUTER_SPEC.md §3-§4). The runner's bookkeeping is proved by c2-fanout; these
// scenarios exist for the half a unit test structurally cannot see — what a person looking at the
// panel is actually told:
//
//   - a fanned part counts its items WHILE it runs (`3/5`), not only when it is over;
//   - a failed item is readable, by number, under the part that produced it, and its siblings
//     still show a value;
//   - a done thinking part says what it cost, call count and all;
//   - a run stopped by the cap says so in a banner whose ONE button finishes the work, while the
//     stored preference lives in the toolbar rather than in a settings page;
//   - the value inspector opens in the CONVERSATION column, never inside #chat-messages, closes
//     on Escape without stopping a run, and leaves nothing behind when the panel is destroyed;
//   - `state().parts[]` carries error/stats/fanout while `API_KEYS.graphDebug` does not move.

import { API_KEYS } from '../../../renderer/chat/core/types.mjs';

const COMPLETIONS = '/v1/chat/completions';
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const ITEMS = ['apple', 'banana', 'cherry', 'pear', 'plum'];

/** Fail loudly when the panel or the spine was faked — a green run would otherwise mean nothing. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};   // K1: the Computer's own loader
    const missing = ['host', 'ask'].filter((k) => failed[k]);
    if (missing.length) throw new Error(`C2 canvas needs the REAL modules, the loader dropped: ${missing.join(', ')}`);
    return true;
});

/** A string as the page itself resolves it, so a test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((a) => window.LolChat.app.t(a.key, a.vars || undefined), { key, vars: vars || null });

/** `h.waitFor` runs its function IN THE PAGE; this one polls something the SCENARIO computes. */
async function poll(/** @type {any} */ h, /** @type {() => Promise<any>} */ fn, /** @type {string} */ what, ms = 25000) {
    const deadline = Date.now() + ms;
    let last = null;
    for (;;) {
        last = await fn();
        if (last) return last;
        if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}; last: ${JSON.stringify(last)}`);
        await h.sleep(100);
    }
}

/** A thread, then the Computer panel open on it, with the mock log reset. */
async function open(/** @type {any} */ h) {
    await requireReal(h);
    await h.submit('a thread for the canvas to paint a fan on');
    await h.waitReply();
    await h.eval(async () => {
        const app = window.LolChat.app;
        const rows = await app.repo.listThreads();
        return app.controller.selectThread(rows[0].id);
    });
    await h.mock.reset();                       // every count below is about the GRAPH
    const state = await h.graph.open();
    h.eq(state.computer, true, 'the rail opened the Computer');
    await h.waitFor(() => ((window.LolComputer.debug.computer.doc() || {}).id ? true : null));
}

/** Note -> Split -> Ask -> Collect: the shape a reader actually builds. */
async function build(/** @type {any} */ h, /** @type {any} */ o = {}) {
    const note = await h.graph.place('note', 40, 40);
    const split = await h.graph.place('split', 300, 40);
    const ask = await h.graph.place('ask', 560, 40);
    const collect = await h.graph.place('collect', 860, 40);
    await h.graph.set(note, { text: (o.items || ITEMS).join('\n') });
    await h.graph.set(split, { mode: 'lines' });
    // An EMPTY instruction on purpose: mock-item then answers with the item itself.
    await h.graph.set(ask, { instruction: '', model: o.model || 'mock-item' });
    await h.graph.set(collect, { mode: 'numbered' });
    h.eq((await h.graph.wire(note, split, 'text')).ok, true, 'Note feeds Split');
    h.eq((await h.graph.wire(split, ask, 'in')).ok, true, 'Split feeds Ask — this is the fan');
    h.eq((await h.graph.wire(ask, collect, 'items')).ok, true, 'Ask feeds Collect — this ends it');
    return { note, split, ask, collect };
}

/** What ONE part's box really shows, read out of the live DOM. */
const boxOf = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((partId) => {
    const node = document.querySelector(`#lolcomputer .graph-part[data-id="${partId}"]`);
    if (!node) return null;
    /** @param {string} sel */
    const one = (sel) => {
        const el = /** @type {any} */ (node.querySelector(sel));
        return el ? { text: (el.textContent || '').trim(), hidden: !!el.hidden } : null;
    };
    const list = /** @type {any} */ (node.querySelector('.graph-item-errors'));
    return {
        state: node.getAttribute('data-state'),
        fanout: one('.graph-part-fanout'),
        cost: one('.graph-part-cost'),
        value: one('.graph-value'),
        itemErrors: Array.from(node.querySelectorAll('.graph-item-errors li')).map((li) => (li.textContent || '').trim()),
        itemErrorsHidden: list ? !!list.hidden : true,
        // the per-item list must sit UNDER the value preview, not above the settings
        errorsAfterFoot: !!node.querySelector('.graph-part-foot ~ .graph-item-errors'),
    };
}, id);

/** The cap banner and the cap field, as the DOM has them. */
const capBanner = (/** @type {any} */ h) => h.eval(() => {
    const el = /** @type {any} */ (document.querySelector('#lolcomputer .graph-cap'));
    const btn = /** @type {any} */ (document.querySelector('#lolcomputer .graph-cap-raise'));
    const field = /** @type {any} */ (document.querySelector('#lolcomputer .graph-cap-input'));
    return {
        present: !!el,
        hidden: el ? !!el.hidden : true,
        text: el ? (el.textContent || '').trim() : '',
        underToolbar: !!(el && el.previousElementSibling && el.previousElementSibling.classList.contains('graph-toolbar')),
        button: !!btn,
        fieldValue: field ? field.value : null,
        fieldInToolbar: !!(field && field.closest('.graph-toolbar')),
    };
});

/** Start a run WITHOUT awaiting it, so the scenario can watch it happen. */
const startRun = (/** @type {any} */ h, /** @type {any} */ opts) => h.eval((o) => {
    /** @type {any} */ (window).__c2canvasRun = window.LolComputer.debug.computer.run(o || {});
    return true;
}, opts || null);
const awaitRun = (/** @type {any} */ h) => h.eval(() => /** @type {any} */ (window).__c2canvasRun);

export default [
    {
        name: 'c2-canvas-fanout-badge-and-cost',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // `3/5` WHILE it runs. A fan that reported itself only at the end would leave a reader
        // watching a spinner through forty generations with nothing to read.
        async run(h) {
            await open(h);
            const ids = await build(h);
            await h.mock.state({ askDelayMs: 250 });

            await startRun(h, null);
            const mid = await poll(h, async () => {
                const box = await boxOf(h, ids.ask);
                if (!box || !box.fanout || box.fanout.hidden) return null;
                const m = /^(\d+)\/(\d+)$/.exec(box.fanout.text);
                return m && Number(m[1]) > 0 && Number(m[1]) < 5 ? box : null;
            }, 'the badge to show a PARTIAL count');
            h.eq(/^[1-4]\/5$/.test(mid.fanout.text), true, `the badge counts items as they land, got "${mid.fanout.text}"`);
            h.eq(mid.state, 'running', 'and it says so while the part is still running');

            const report = await awaitRun(h);
            await h.mock.state({ askDelayMs: 0 });
            h.eq(report.errors.length, 0, JSON.stringify(report.errors));

            const done = await boxOf(h, ids.ask);
            h.eq(done.state, 'done');
            h.eq(done.fanout.text, await str(h, 'graph.fanout', { done: 5, n: 5 }), 'the finished badge is 5/5');
            h.eq(done.itemErrorsHidden, true, 'nothing failed, so there is no failure list at all');
            h.eq(/5 calls$/.test(done.cost.text), true, `a fanned part's cost names its call count, got "${done.cost.text}"`);
            h.eq(done.value.hidden, false, 'and the value preview is there to click');

            const single = await boxOf(h, ids.collect);
            h.eq(single.fanout === null || single.fanout.hidden, true, 'a part that never fanned shows no badge');
            h.eq(/calls$/.test((single.cost || { text: '' }).text), false,
                'and one call reads as seconds and tokens, not as "1 calls"');
        },
    },

    {
        name: 'c2-canvas-one-bad-item-is-readable',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // §1.2: a failure is a sentence, not a hole. The four good items keep their value and the
        // bad one is named BY NUMBER under the part that produced it.
        async run(h) {
            await open(h);
            const ids = await build(h);
            await h.mock.state({ failWhen: 'pear' });       // ONE item the farm refuses

            const report = await h.graph.run();
            await h.mock.state({ failWhen: '' });
            h.eq(report.errors.length, 0, 'one bad item is not a failed run');

            const box = await boxOf(h, ids.ask);
            h.eq(box.state, 'done', 'the part is DONE: four of its five items succeeded');
            h.eq(box.fanout.text, await str(h, 'graph.fanout', { done: 5, n: 5 }), 'every item was attempted');
            h.eq(box.itemErrors.length, 1, `exactly one failure line, got ${JSON.stringify(box.itemErrors)}`);
            h.eq(box.itemErrors[0].startsWith('Item 4:'), true,
                `named by its ONE-BASED number — pear is the fourth item — got "${box.itemErrors[0]}"`);
            h.eq(box.itemErrors[0].length > 10, true, 'and it carries the farm\'s own words, not just a number');
            h.eq(box.errorsAfterFoot, true, 'the failures sit under the value preview, where the value they belong to is');
            h.eq(box.value.hidden, false, 'the four that worked still show their value');

            const state = await h.graph.state();
            const part = state.parts.find((/** @type {any} */ p) => p.id === ids.ask);
            h.eq(part.fanout.n, 5, 'state() republishes the per-item record (BH-13)');
            h.eq(part.fanout.ok, 4);
            h.eq(part.fanout.failed, 1);
            h.eq(part.fanout.errors.length, 1);
            h.eq(part.fanout.errors[0].i, 3, 'zero-based in the record, one-based on the screen');
            h.eq(part.stats.calls, 5, 'and the cost record counts every call, the failed one included');
            h.eq(part.error, null, 'a part with survivors has no part-level error');
        },
    },

    {
        name: 'c2-canvas-cap-banner-raises-and-finishes',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The cap is the promise that a graph cannot quietly spend the farm. It has to be SAID,
        // and the way out of it has to be one button.
        async run(h) {
            await open(h);
            const ids = await build(h);

            const before = await capBanner(h);
            h.eq(before.present, true, 'the banner element exists from the start');
            h.eq(before.hidden, true, 'hidden until a run is actually stopped');
            h.eq(before.underToolbar, true, 'it sits between the toolbar and the canvas, over the graph');
            h.eq(before.fieldInToolbar, true, 'and the STORED cap is a toolbar field, not a settings page');
            h.eq(before.fieldValue, '50', 'seeded from pref:computeMaxItems, default 50');

            // A cap of two against a fan of FIVE: the item ceiling, which stops the run BEFORE the
            // part runs rather than after a silent slice of it (fix pass, finding 1).
            const capped = await h.graph.run({ maxItems: 2 });
            h.eq(capped.capped.cap, 2, 'the run stopped at the cap it was given');
            h.eq(capped.capped.items, 5, 'and said how many times the part would have run');
            h.eq((await h.mock.log({ path: COMPLETIONS })).length, 0,
                'having spent NOTHING: a fan over the ceiling is refused, never half-run');

            const shown = await capBanner(h);
            h.eq(shown.hidden, false, 'the banner is up');
            h.eq(shown.text.includes(await str(h, 'graph.capItemsTitle', { items: 5 })), true,
                `and says what stopped it, got "${shown.text}"`);
            h.eq(shown.text.includes(String(capped.capped.raiseTo)), true,
                'and what raising it has to reach for the work to finish');
            h.eq(shown.button, true, 'with one button out of it');
            h.eq(shown.fieldValue, '50', 'a run-only raise never moved the stored preference');

            // A real click, and it must FINISH the work at twice the cap it stopped at.
            await h.click('#lolcomputer .graph-cap-raise');
            await poll(h, async () => ((await h.graph.running()) === false ? true : null), 'the raised run to end');
            await poll(h, async () => {
                const box = await boxOf(h, ids.collect);
                return box && box.state === 'done' ? true : null;
            }, 'Collect to finish');

            const after = await capBanner(h);
            h.eq(after.hidden, true, 'the banner is gone once the run it described finished');
            const log = await h.mock.log({ path: COMPLETIONS });
            h.eq(log.length, 5, `the raise finished the work: five items, five generations (got ${log.length})`);
            h.eq((await boxOf(h, ids.ask)).fanout.text, await str(h, 'graph.fanout', { done: 5, n: 5 }));
        },
    },

    {
        name: 'c2-canvas-cap-field-persists',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The toolbar field IS the preference: typing in it must change what the NEXT run spends
        // and survive a re-opened panel, or it is decoration.
        async run(h) {
            await open(h);
            await build(h);

            await h.eval(() => {
                const el = /** @type {any} */ (document.querySelector('#lolcomputer .graph-cap-input'));
                el.value = '3';
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            });
            await h.waitFor(async () => {
                const v = await window.LolChat.app.repo.kvGet('pref:computeMaxItems', null);
                return Number(v) === 3 ? true : null;
            });
            h.eq((await h.graph.state()).said.includes('3'), true, 'the change is announced in the live region');

            const report = await h.graph.run();
            h.eq(report.capped.cap, 3, 'the NEXT run honours the field with no maxItems of its own');
            h.eq(report.capped.items, 5, 'a fan of five is over a cap of three, so it is refused by number');
            h.eq((await h.mock.log({ path: COMPLETIONS })).length, 0,
                'and the farm was never touched — the field really is what governs the run');

            // A freshly mounted panel re-seeds the field from the store.
            await h.view('computer');                       // the live tab toggles shut
            await h.view('computer');                       // and back open: a NEW canvas
            await poll(h, async () => {
                const b = await capBanner(h);
                return b.fieldValue === '3' ? true : null;
            }, 'the re-opened panel to re-seed the cap field');
        },
    },

    {
        name: 'c2-canvas-inspector-is-never-in-the-chat',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // AMENDED AT THE K1 LANDING (COMPUTER_PLAN §3.7). BH-7 read "the value is read in the
        // conversation column, above the composer". There is no conversation column beside the
        // canvas any more: the Computer is its own surface and the value opens in ITS drawer
        // (`k1-runbar-drawer` proves the drawer's own behaviour — one value at a time, a real
        // width, the grip). What survives here is the half that is still a HARD boundary and that
        // no other scenario watches: a value the reader opens must never become a foreign node
        // inside `#chat-messages`, which thread-view owns and re-renders, and closing it must
        // never read as "stop the run".
        async run(h) {
            await open(h);
            const ids = await build(h, { items: ['one', 'two'] });
            await h.graph.run();

            await h.click(`#lolcomputer .graph-part[data-id="${ids.collect}"] .graph-value`);
            const placed = await h.waitFor(() => {
                const el = document.querySelector('#lolcomputer .graph-inspect');
                if (!el) return null;
                const messages = document.getElementById('chat-messages');
                const chat = document.getElementById('lolchat');
                return {
                    insideMessages: !!(messages && messages.contains(el)),
                    insideChat: !!(chat && chat.contains(el)),
                    inDrawer: !!el.closest('.comp-drawer'),
                    onCanvas: !!el.closest('.graph-layer'),
                    body: (el.textContent || '').trim(),
                    count: document.querySelectorAll('.graph-inspect').length,
                };
            }, { timeout: 15000 });
            h.eq(placed.insideMessages, false, 'NEVER inside #chat-messages (§2.6 AE: thread-view owns that subtree)');
            h.eq(placed.insideChat, false, 'and never anywhere in the chat surface at all');
            h.eq(placed.inDrawer, true, "the value is read in the Computer's own drawer");
            h.eq(placed.onCanvas, false, 'and not dropped on the canvas on top of the graph');
            h.eq(placed.count, 1, 'one inspector at a time, on either surface');
            h.eq(placed.body.includes('one'), true, `showing the value it was opened on, got "${placed.body.slice(0, 80)}"`);

            // Escape closes it, and nothing upstream may read that as "stop the run".
            await h.eval(() => {
                const el = /** @type {any} */ (document.querySelector('#lolcomputer .comp-drawer'));
                el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                return true;
            });
            await h.waitFor(() => (document.querySelector('#lolcomputer .graph-inspect') ? null : true));
            h.eq(await h.graph.running(), false, 'no run was started, and none was stopped');

            // Opened again and then the surface is hidden: the chat it goes back to is untouched.
            await h.click(`#lolcomputer .graph-part[data-id="${ids.collect}"] .graph-value`);
            await h.waitFor(() => (document.querySelector('#lolcomputer .graph-inspect') ? true : null));
            await h.view('chat');
            const chat = await h.eval(() => ({
                inspectors: document.querySelectorAll('#lolchat .graph-inspect').length,
                canvases: document.querySelectorAll('#lolchat .graph').length,
            }));
            h.eq(chat.inspectors, 0, 'the chat has an inspector in it');
            h.eq(chat.canvases, 0, 'and a canvas');
        },
    },

    {
        name: 'c2-canvas-debug-door-did-not-move',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // BH-13's last line: state() grew three FIELDS, not three keys. A phase that quietly widens
        // the door is a phase whose scenarios stop proving what they claim to.
        async run(h) {
            await open(h);
            const got = await h.eval(() => Object.keys(window.LolComputer.debug.computer).sort());
            h.eq(got, [...API_KEYS.computerDebug].sort(), 'the debug door is still exactly the frozen key list (BG-9 + K1)');

            const ids = await build(h, { items: ['solo'] });
            await h.graph.run();
            const part = (await h.graph.state()).parts.find((/** @type {any} */ p) => p.id === ids.ask);
            h.eq(Object.keys(part).sort(),
                ['error', 'fanout', 'id', 'settings', 'state', 'stats', 'type', 'value', 'x', 'y'],
                'and state().parts[] carries error, stats and fanout');
            h.eq(part.stats.calls, 1, 'one item, one call');
            h.eq(part.fanout, { n: 1, done: 1, ok: 1, failed: 0, hidden: 0, errors: [] }, 'a fan of one is still a fan');
        },
    },
];
