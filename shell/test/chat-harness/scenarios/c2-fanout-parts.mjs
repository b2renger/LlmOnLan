// @ts-check
// C2-U2 in the real browser against the real mock farm: the fan-out parts (plan §2.6 BH-13,
// docs/LOLCHAT_COMPUTER_SPEC.md §3/§7).
//
// The unit tests prove the cutting rules and the model mode's bookkeeping against a fake ask spine.
// These scenarios exist for the things a unit test structurally cannot see: how many requests
// really left the window, WHICH item each one carried, that four identical passes are four
// generations rather than one cached answer shown four times, and that a filtered list re-runs for
// free because every verdict was cached by its item. So every assertion below counts POSTs in the
// mock's log or reads their bodies — never "it eventually returned something".
//
// Two mock behaviours from the C2 kickoff carry the weight (§2.6 BH-11): `mock-item` answers with
// the LAST LINE of the last user message, so forty generations can be shown to have carried forty
// different items; `state.failWhen` fails exactly the request whose text contains a substring,
// which is how "one bad item in a fan of five" is expressed at all.

const COMPLETIONS = '/v1/chat/completions';

/** Network noise the farm's own error paths make in the console (a 502 body, an aborted stream). */
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when this unit's modules were replaced by fakes or skipped. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};   // K1: the Computer's own loader
    const missing = ['host', 'ask'].filter((k) => failed[k]);
    if (missing.length) {
        throw new Error(`C2-U2 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
    }
    return true;
});

/** A string as the page itself resolves it, so the test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolChat.app.t(k, v || undefined), key, vars || null);

/** Completion POSTs the mock has seen, newest last. @returns {Promise<any[]>} */
const posts = (/** @type {any} */ h, /** @type {string} */ model) =>
    h.mock.log(model ? { path: COMPLETIONS, model } : { path: COMPLETIONS });

/** The last user message of one recorded request body. */
const userText = (/** @type {any} */ entry) => {
    const messages = (entry && entry.body && entry.body.messages) || [];
    const last = [...messages].reverse().find((m) => m && m.role === 'user');
    return last ? String(last.content) : '';
};

/** A thread, then the Computer panel open on it (the C1 opening, unchanged). */
async function open(/** @type {any} */ h) {
    await requireReal(h);
    await h.submit('a thread to hang a fan-out on');
    await h.waitReply();
    await h.eval(async () => {
        const app = window.LolChat.app;
        const rows = await app.repo.listThreads();
        return app.controller.selectThread(rows[0].id);
    });
    await h.mock.reset();                       // every count below is about the GRAPH
    await h.graph.open();
    await h.waitFor(() => ((window.LolComputer.debug.computer.doc() || {}).id ? true : null));
}

/** The live parts, by id — off the DOC, which is where the runner writes value/state/error/fanout.
 * (The panel's `state()` door carries the canvas's view of a part; the per-item record and the
 * error sentence are asserted at their source.) */
const parts = async (/** @type {any} */ h) => {
    const doc = await h.graph.doc();
    /** @type {Record<string, any>} */ const out = {};
    for (const p of doc.parts) out[p.id] = p;
    return out;
};

/** The plain strings of a list value. */
const items = (/** @type {any} */ value) =>
    ((value && value.kind === 'list' && Array.isArray(value.data)) ? value.data : []).map((v) => String(v && v.data));

/** The ITEM one request was about. K2: §5.3 puts the inputs under `## ` headings FIRST and the
 * instruction LAST, so the item is the first line under the first heading, not the last line. */
const itemAsked = (/** @type {string} */ text) => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const at = lines.findIndex((l) => l.startsWith('## '));
    const under = at >= 0 ? lines.slice(at + 1).find((l) => !l.startsWith('#')) : '';
    return under || (lines.length ? lines[lines.length - 1] : '');
};

export default [
    {
        name: 'c2-parts-split-fans-one-generation-per-item',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The program the Computer exists for: one list, one Ask, one generation PER ITEM, each
        // carrying its own item — and a Collect that joins them back.
        async run(h) {
            await open(h);
            const note = await h.graph.place('note', 40, 40);
            const split = await h.graph.place('split', 300, 40);
            const ask = await h.graph.place('ask', 560, 40);
            const collect = await h.graph.place('collect', 860, 40);
            await h.graph.set(note, { text: 'Paris\nRome\nLisbon' });
            await h.graph.set(split, { mode: 'lines' });
            // No instruction: the prompt IS the labelled item, so `mock-item` echoes back the very
            // item that request carried — which is how forty generations are shown to be forty
            // DIFFERENT questions rather than forty calls (§2.6 BH-11).
            await h.graph.set(ask, { instruction: '', model: 'mock-item' });
            await h.graph.set(collect, { mode: 'numbered' });
            h.eq((await h.graph.wire(note, split, 'text')).ok, true, 'Note feeds Split');
            h.eq((await h.graph.wire(split, ask, 'in')).ok, true, 'a list into a text port is a legal wire');
            h.eq((await h.graph.wire(ask, collect, 'items')).ok, true, 'Ask feeds Collect');

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `no part failed: ${JSON.stringify(report.errors)}`);

            const log = await posts(h, 'mock-item');
            h.eq(log.length, 3, 'THREE generations for three items — the fan really fanned');
            const carried = log.map((e) => itemAsked(userText(e)));
            h.eq(carried.join('|'), 'Paris|Rome|Lisbon', 'each generation carried its OWN item, in order');

            const live = await parts(h);
            h.eq(live[split].state, 'done');
            h.eq(items(live[split].value).join('|'), 'Paris|Rome|Lisbon', 'Split produced the list');
            h.eq(live[ask].value.kind, 'list', 'a fanned part answers with a list, whatever its static output says');
            h.eq(items(live[ask].value).length, 3, 'one answer per item');
            h.eq(live[ask].fanout && live[ask].fanout.n, 3, 'and the per-item record says how many');
            h.eq(live[ask].fanout.failed, 0, 'with nothing failed');
            h.eq(items(live[ask].value).join('|'), 'item: Paris|item: Rome|item: Lisbon',
                'and each ANSWER is about its own item, in order');
            const joined = String(live[collect].value.data);
            h.assert(joined.includes('Paris') && joined.includes('Rome') && joined.includes('Lisbon'),
                `Collect joined every answer: ${joined}`);
        },
    },

    {
        name: 'c2-parts-split-one-bad-item-never-kills-the-run',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Spec §2: "one bad item never kills the run". Measured: five items, the farm refusing
        // exactly one of them, four answers kept in order and the failure named per item.
        async run(h) {
            await open(h);
            await h.mock.state({ failWhen: 'Rome' });
            const note = await h.graph.place('note', 40, 40);
            const split = await h.graph.place('split', 300, 40);
            const ask = await h.graph.place('ask', 560, 40);
            await h.graph.set(note, { text: 'Paris, Rome, Lisbon, Oslo, Madrid' });
            await h.graph.set(split, { mode: 'separator', separator: ',' });
            await h.graph.set(ask, { instruction: '', model: 'mock-item' });
            await h.graph.wire(note, split, 'text');
            await h.graph.wire(split, ask, 'in');

            const report = await h.graph.run();
            const live = await parts(h);
            h.eq(live[split].state, 'done', 'the split itself is fine');
            h.eq(live[ask].state, 'done', 'the fanned part is DONE: four of five items answered');
            h.eq(items(live[ask].value).length, 4, 'the value is the items that SUCCEEDED');
            h.eq(live[ask].fanout.n, 5, 'out of five');
            h.eq(live[ask].fanout.failed, 1, 'with exactly one failure recorded');
            h.eq(live[ask].fanout.errors[0].i, 1, 'against the item it happened on (Rome is second)');
            h.assert(String(live[ask].fanout.errors[0].message).length > 0, 'and it says something');
            h.eq(report.errors.length, 0, 'a part that kept going is not a run error');

            await h.mock.state({ failWhen: '' });
        },
    },

    {
        name: 'c2-parts-repeat-four-variants-are-four-generations',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The "four variants" button. Four IDENTICAL prompts must leave the window four times —
        // the ask spine's cache would otherwise answer three of them for free, which is exactly the
        // silent-duplicate result §1.2 bans. The salt (§2.6 BH-5) is what buys the four.
        async run(h) {
            await open(h);
            const note = await h.graph.place('note', 40, 40);
            const repeat = await h.graph.place('repeat', 300, 40);
            const ask = await h.graph.place('ask', 560, 40);
            const collect = await h.graph.place('collect', 860, 40);
            await h.graph.set(note, { text: 'a poster brief' });
            await h.graph.set(repeat, { times: 4, template: '' });
            await h.graph.set(ask, { instruction: 'one variant', model: 'mock-item' });
            await h.graph.wire(note, repeat, 'value');
            await h.graph.wire(repeat, ask, 'in');
            await h.graph.wire(ask, collect, 'items');

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, JSON.stringify(report.errors));
            const log = await posts(h, 'mock-item');
            h.eq(log.length, 4, 'four passes, four real generations');
            const bodies = log.map(userText);
            h.eq(new Set(bodies).size, 1, 'and all four asked exactly the same question');
            h.assert(bodies[0].includes('a poster brief'), `carrying the wired value: ${bodies[0]}`);

            const live = await parts(h);
            h.eq(items(live[repeat].value).length, 4, 'Repeat is a list of four');
            h.eq(items(live[ask].value).length, 4, 'and four answers came back');

            // The pass number, for graphs that want it in the text.
            await h.graph.set(repeat, { template: '{item} — variant {i} of {n}' });
            await h.graph.run();
            const after = (await posts(h, 'mock-item')).slice(4).map(userText);
            h.eq(after.length, 4, 'a new template is a new question, so four more generations');
            h.assert(after[0].includes('variant 1 of 4') && after[3].includes('variant 4 of 4'),
                `each pass carried its index: ${JSON.stringify(after.map((s) => s.split('\n').pop()))}`);
        },
    },

    {
        name: 'c2-parts-filter-model-mode-asks-once-per-item-and-caches',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Model mode: one cheap yes/no per item, each carrying the criterion AND that item — then
        // the same list filtered the other way for FREE, because every verdict is cached by item.
        async run(h) {
            await open(h);
            const note = await h.graph.place('note', 40, 40);
            const split = await h.graph.place('split', 300, 40);
            const filter = await h.graph.place('filter', 560, 40);
            await h.graph.set(note, { text: '1. Paris\n2. Rome\n3. Lisbon' });
            await h.graph.set(split, { mode: 'numbered' });
            await h.graph.set(filter, { mode: 'model', text: 'is it a capital?', model: 'mock-studio-json' });
            await h.graph.wire(note, split, 'text');
            await h.graph.wire(split, filter, 'items');

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `the filter ran: ${JSON.stringify(report.errors)}`);
            const log = await posts(h, 'mock-studio-json');
            h.eq(log.length, 3, 'ONE generation per item — a filter never batches behind the reader\'s back');
            const bodies = log.map(userText);
            h.assert(bodies.every((b) => b.includes('is it a capital?')), 'every request carried the criterion');
            h.eq(bodies.map((b) => b.trim().split('\n').pop()).join('|'), 'Paris|Rome|Lisbon',
                'and each one carried its own item');
            const system = (log[0].body.messages || []).some((m) => m.role === 'system');
            h.assert(system, 'with the yes/no instruction as a system message');

            const live = await parts(h);
            h.eq(live[filter].state, 'done');
            h.eq(items(live[filter].value).join('|'), 'Paris|Rome|Lisbon', 'the mock says yes to everything, so nothing was dropped');

            // Flip the verdict: the same three questions, already answered.
            await h.graph.set(filter, { invert: true });
            const second = await h.graph.run();
            h.eq(second.errors.length, 0, JSON.stringify(second.errors));
            h.eq((await posts(h, 'mock-studio-json')).length, 3, 'the re-run cost NOTHING: the verdicts were cached by item');
            const flipped = await parts(h);
            h.eq(items(flipped[filter].value).length, 0, 'and inverting really re-used them');
        },
    },

    {
        name: 'c2-parts-filter-deterministic-modes-spend-nothing',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The other half of the part: contains / matches / length are free, and a farm error on ONE
        // item in model mode fails the part by NAME rather than quietly dropping the item.
        async run(h) {
            await open(h);
            const note = await h.graph.place('note', 40, 40);
            const split = await h.graph.place('split', 300, 40);
            const filter = await h.graph.place('filter', 560, 40);
            await h.graph.set(note, { text: 'Paris\nRome\nParma\nOslo' });
            await h.graph.set(filter, { mode: 'contains', text: 'par' });
            await h.graph.wire(note, split, 'text');
            await h.graph.wire(split, filter, 'items');

            await h.graph.run();
            h.eq((await posts(h, '')).length, 0, 'a deterministic filter spends no generation at all');
            let live = await parts(h);
            h.eq(items(live[filter].value).join('|'), 'Paris|Parma', 'and it filtered');

            await h.graph.set(filter, { mode: 'length', min: 5 });
            await h.graph.run();
            live = await parts(h);
            h.eq(items(live[filter].value).join('|'), 'Paris|Parma', 'length keeps the same two here');
            h.eq((await posts(h, '')).length, 0, 'still free');

            // One item the farm refuses: the part fails, naming the item, instead of returning a
            // shorter list nobody would notice.
            await h.mock.state({ failWhen: 'Rome' });
            await h.graph.set(filter, { mode: 'model', text: 'is it French?', model: 'mock-studio-json' });
            const report = await h.graph.run();
            h.eq(report.errors.length, 1, 'the part failed out loud');
            live = await parts(h);
            h.eq(live[filter].state, 'error');
            h.assert(String(live[filter].error).includes('2'),
                `the sentence names the item: ${live[filter].error}`);
            const head = await str(h, 'parts.itemError', { i: 2, message: '' });
            h.assert(String(live[filter].error).startsWith(head.trim()),
                `it is the per-item sentence: ${live[filter].error}`);
            await h.mock.state({ failWhen: '' });
        },
    },

    {
        name: 'c2-parts-split-refuses-instead-of-fanning-nothing',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // A Split whose mode does not fit its text would otherwise emit an empty list, and an empty
        // list fans ZERO times: the Ask downstream would sit there looking successful having done
        // nothing. The part says so instead, and the run spends nothing.
        async run(h) {
            await open(h);
            const note = await h.graph.place('note', 40, 40);
            const split = await h.graph.place('split', 300, 40);
            const ask = await h.graph.place('ask', 560, 40);
            await h.graph.set(note, { text: 'a paragraph with no list markers in it at all' });
            await h.graph.set(split, { mode: 'numbered' });
            await h.graph.set(ask, { instruction: '', model: 'mock-item' });
            await h.graph.wire(note, split, 'text');
            await h.graph.wire(split, ask, 'in');

            const report = await h.graph.run();
            h.eq((await posts(h, '')).length, 0, 'nothing was generated');
            h.eq(report.errors.length, 1, 'the split refused');
            const live = await parts(h);
            h.eq(live[split].state, 'error');
            h.eq(live[split].error, await str(h, 'parts.errNoItems'));
            h.eq(live[ask].state, 'stale', 'and its downstream was not run on nothing');

            // The same text, split a way that FITS, is a working fan of one.
            await h.graph.set(split, { mode: 'lines' });
            const again = await h.graph.run();
            h.eq(again.errors.length, 0, JSON.stringify(again.errors));
            h.eq((await posts(h, 'mock-item')).length, 1, 'a fan of one is still a fan');
            const after = await parts(h);
            h.eq(after[ask].value.kind, 'list', 'and it answers with a list of one');
            h.eq(after[ask].fanout.n, 1);
        },
    },
];
