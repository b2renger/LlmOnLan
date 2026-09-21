// @ts-check
// C2-U1 in the real browser against the real mock farm: FAN-OUT, per-item errors, the generation
// cap and the etiquette that keeps a colleague's chat fast while a graph runs (plan §2.6
// BH-2/BH-3/BH-4/BH-8, docs/LOLCHAT_COMPUTER_SPEC.md §2-§3).
//
// The unit tests prove the runner's bookkeeping against a fake spine. These scenarios exist for the
// one thing a unit test structurally cannot see: how many requests really left the window, and what
// each of them carried. So every assertion below counts POSTs in the mock's log or reads their
// bodies — a fan of five is only real if the farm saw five DIFFERENT items.
//
// The fan source is Note -> Split, which is the shape a reader actually builds (a pasted list, one
// item per line). `mock-item` answers with the last line of the last user message, so the Ask part
// runs with an EMPTY instruction and its prompt's last line is the item itself — which is how these
// tests tell "five calls" apart from "five calls about the same thing".

const COMPLETIONS = '/v1/chat/completions';

/** Network noise the farm's own error paths make in the console (a 502 body, an aborted stream). */
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** The five items every fan in this file runs over. */
const ITEMS = ['apple', 'banana', 'cherry', 'pear', 'plum'];

/** Fail loudly when this unit's modules were replaced by fakes or skipped. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolChat && window.LolChat.failed) || {};
    const missing = ['computer', 'ask'].filter((k) => failed[k]);
    if (missing.length) {
        throw new Error(`C2-U1 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
    }
    return true;
});

/** A string as the page itself resolves it, so the test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((a) => window.LolChat.app.t(a.key, a.vars || undefined), { key, vars: vars || null });

/** Completion POSTs the mock has seen, newest last. @returns {Promise<any[]>} */
const posts = (/** @type {any} */ h, /** @type {string} */ model) =>
    h.mock.log(model ? { path: COMPLETIONS, model } : { path: COMPLETIONS });

/** The last user message of one recorded request body. */
const userText = (/** @type {any} */ entry) => {
    const messages = (entry && entry.body && entry.body.messages) || [];
    const last = messages[messages.length - 1];
    return last ? String(last.content) : '';
};

/** The ITEM one recorded request was about: the last line of its prompt (what mock-item reads). */
const itemOf = (/** @type {any} */ entry) => {
    const lines = userText(entry).split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.length ? lines[lines.length - 1] : '';
};

/** Send into the CURRENT thread (h.submit would click "new chat" and move the panel's graph). */
const sendHere = (/** @type {any} */ h, /** @type {string} */ text) => h.eval((v) => {
    const input = /** @type {any} */ (document.getElementById('chat-input'));
    const form = /** @type {any} */ (document.getElementById('chat-form'));
    if (!input || !form) throw new Error('sendHere: composer not in the DOM');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(input, v); else input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    return true;
}, text);

/** A thread, then the Computer panel open on it. */
async function open(/** @type {any} */ h) {
    await requireReal(h);
    await h.submit('a thread to fan a program over');
    await h.waitReply();
    await h.eval(async () => {
        const app = window.LolChat.app;
        const rows = await app.repo.listThreads();
        return app.controller.selectThread(rows[0].id);
    });
    await h.mock.reset();                       // every count below is about the GRAPH
    const state = await h.graph.open();
    h.eq(state.panel, 'computer', 'the Computer panel is the one the rail opened');
    await h.waitFor(() => (window.LolChat.debug.computer.doc().threadId ? true : null));
}

/**
 * Note -> Split -> Ask -> Collect: the fan-out a reader actually builds.
 * @param {any} h @param {{items?: string[], model?: string}} [o]
 */
async function build(h, o = {}) {
    const note = await h.graph.place('note', 40, 40);
    const split = await h.graph.place('split', 300, 40);
    const ask = await h.graph.place('ask', 560, 40);
    const collect = await h.graph.place('collect', 860, 40);
    await h.graph.set(note, { text: (o.items || ITEMS).join('\n') });
    await h.graph.set(split, { mode: 'lines' });
    // An EMPTY instruction on purpose: the prompt is then the labelled item and nothing else, so
    // mock-item's answer names the item the request was really about.
    await h.graph.set(ask, { instruction: '', model: o.model || 'mock-item' });
    await h.graph.set(collect, { mode: 'numbered' });
    h.eq((await h.graph.wire(note, split, 'text')).ok, true, 'Note feeds Split');
    h.eq((await h.graph.wire(split, ask, 'context')).ok, true, 'Split feeds Ask — this is the fan');
    h.eq((await h.graph.wire(ask, collect, 'items')).ok, true, 'Ask feeds Collect — this ends it');
    return { note, split, ask, collect };
}

/**
 * The live parts, by id, READ OFF THE DOCUMENT rather than off `state()`. The runtime fields this
 * unit writes (`fanout`, `stats.calls`) are part of the doc from the moment the runner patches
 * them; whether the panel's debug summary republishes them is C2-U2's door, and this unit's
 * scenarios must not go red waiting for it.
 */
const parts = async (/** @type {any} */ h) => {
    const doc = await h.graph.doc();
    /** @type {Record<string, any>} */ const out = {};
    for (const p of doc.parts) out[p.id] = p;
    return out;
};

/** Wait until at least `n` requests for `model` have really left the window. */
async function waitForPosts(/** @type {any} */ h, /** @type {string} */ model, /** @type {number} */ n) {
    for (let i = 0; i < 100; i++) {
        const log = await posts(h, model);
        if (log.length >= n) return log;
        await h.sleep(100);
    }
    throw new Error(`fewer than ${n} ${model} requests reached the mock`);
}

/** Start a run WITHOUT awaiting it (so the scenario can interrupt it), then await it later. */
const startRun = (/** @type {any} */ h) => h.eval(() => {
    /** @type {any} */ (window).__c2run = window.LolChat.debug.computer.run();
    return true;
});
const awaitRun = (/** @type {any} */ h) => h.eval(() => /** @type {any} */ (window).__c2run);

export default [
    {
        name: 'c2-fanout-five-items',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The phase in one scenario: one list, five generations, five DIFFERENT items, and a list
        // of five answers that Collect joins back into one text.
        async run(h) {
            await open(h);
            const ids = await build(h);

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `no part failed: ${JSON.stringify(report.errors)}`);
            h.eq(report.ran, 4, 'all four parts ran');
            h.eq(report.generations, 5, 'and the run says it spent five generations');

            const log = await posts(h, 'mock-item');
            h.eq(log.length, 5, 'a fan of five made EXACTLY five completions');
            h.eq(log.map(itemOf), ITEMS, 'each one carried its own item, in order');
            for (const entry of log) h.eq(entry.body.stream, true, 'an item streams like any other request');

            const live = await parts(h);
            h.eq(live[ids.ask].state, 'done');
            h.eq(live[ids.ask].value.kind, 'list', 'the fanned part produced a LIST');
            h.eq(live[ids.ask].value.data.map((/** @type {any} */ v) => v.data),
                ITEMS.map((i) => `item: ${i}`), 'holding one answer per item, in order');
            h.eq(live[ids.ask].fanout, { n: 5, done: 5, ok: 5, failed: 0, hidden: 0, errors: [] },
                'and a per-item record the canvas can paint');
            h.eq(live[ids.ask].stats.calls, 5, 'the cost line counts five calls');
            h.eq(live[ids.collect].value.data,
                ITEMS.map((i, n) => `${n + 1}. item: ${i}`).join('\n'),
                'Collect accepts a list, which is what ENDS a fan-out');

            // An up-to-date fan re-runs nothing: the cap exists for work, not for repetition.
            const again = await h.graph.run();
            h.eq(again.ran, 0);
            h.eq((await posts(h, 'mock-item')).length, 5, 'and it sent nothing');
        },
    },

    {
        name: 'c2-fanout-one-bad-item',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // §2.6 BH-3, the sentence this whole phase is for: one bad item never fails the run or its
        // siblings. Four are done, the fifth is NAMED, and the downstream still gets its list.
        async run(h) {
            await open(h);
            const ids = await build(h);
            await h.mock.state({ failWhen: 'pear' });     // ONE item the farm refuses

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, 'one bad item is not a failed run');
            h.eq(report.ran, 4, 'and not a failed part either');

            const log = await posts(h, 'mock-item');
            h.eq(log.length, 5, 'every item was still attempted — a failure stops no sibling');
            h.eq(log.map(itemOf), ITEMS);

            const live = await parts(h);
            h.eq(live[ids.ask].state, 'done', 'the part succeeded — partly, and says so');
            h.eq(live[ids.ask].fanout.n, 5);
            h.eq(live[ids.ask].fanout.ok, 4);
            h.eq(live[ids.ask].fanout.failed, 1);
            h.eq(live[ids.ask].fanout.errors.map((/** @type {any} */ e) => e.i), [3],
                'the record names WHICH item failed, by index');
            const said = live[ids.ask].fanout.errors[0].message;
            h.assert(/502|upstream|refused|not answering/i.test(said),
                `the farm's own words reached the item: ${said}`);
            h.assert((said.match(/could not answer|farm refused/gi) || []).length <= 1,
                `the item's failure names the farm ONCE, not twice (§2.6 BI-3): ${said}`);
            h.eq(live[ids.ask].value.data.map((/** @type {any} */ v) => v.data),
                ['apple', 'banana', 'cherry', 'plum'].map((i) => `item: ${i}`),
                'the value is the successes IN ORDER — a failure is not a hole in the list');
            h.eq(live[ids.collect].state, 'done', 'and the downstream is not blocked by one bad item');

            // Fix the farm and re-run: only the item that never answered costs anything, because
            // the four that did are in the ask cache.
            await h.mock.state({ failWhen: '' });
            await h.graph.set(ids.ask, { instruction: ' ' });     // a settings edit: the fan is stale
            const fixed = await h.graph.run();
            h.eq(fixed.errors.length, 0, JSON.stringify(fixed.errors));
            const after = await posts(h, 'mock-item');
            h.eq(after.length, 6, 'ONE more generation: only the item that never answered was re-paid');
            h.eq(itemOf(after[5]), 'pear', 'and it was the failed one');
            h.eq(fixed.generations, 1, 'the four cached answers cost neither the farm nor the cap');
            const live2 = await parts(h);
            h.eq(live2[ids.ask].fanout.failed, 0, 'and this time nothing failed');
            h.eq(live2[ids.ask].value.data.length, 5);
        },
    },

    {
        name: 'c2-fanout-every-item-fails',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The other half of BH-3: `done` when ONE item survived, `error` only when none did — with
        // the first item's own words, and a downstream that is stale rather than wrong.
        async run(h) {
            await open(h);
            const ids = await build(h, { items: ['fruit-a', 'fruit-b', 'fruit-c'] });
            await h.mock.state({ failWhen: 'fruit-' });

            const report = await h.graph.run();
            h.eq(report.errors.length, 1, 'a fan in which everything failed IS a failed part');
            h.eq(report.errors[0].partId, ids.ask);

            const live = await parts(h);
            h.eq(live[ids.ask].state, 'error');
            h.eq(live[ids.ask].value, null, 'an all-failed fan produces NO value, not an empty one');
            h.eq(live[ids.ask].fanout.failed, 3, 'every failure is still on the part for the reader');
            h.assert(String(live[ids.ask].error).includes(live[ids.ask].fanout.errors[0].message.slice(0, 12)),
                `the part carries the FIRST item's words: ${live[ids.ask].error}`);
            h.eq(live[ids.collect].state, 'stale', 'the downstream is stale, never error');
            h.eq(live[ids.collect].value, null, 'and holds no made-up value');
            h.eq((await posts(h, 'mock-item')).length, 3, 'all three were attempted');
        },
    },

    {
        name: 'c2-fanout-empty-and-refused',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Two edges the engine must not guess at: an EMPTY list fans zero times (no generation, no
        // error), and TWO lists at once are refused rather than zipped by index (BH-2).
        async run(h) {
            await open(h);
            const ids = await build(h, { items: [] });

            const empty = await h.graph.run();
            h.eq((await posts(h, 'mock-item')).length, 0, 'a fan of zero costs nothing at the farm');
            let live = await parts(h);
            h.eq(live[ids.ask].state, 'done', 'an empty list is not an error ON THE FANNED PART');
            h.eq(live[ids.ask].error === null || live[ids.ask].error === undefined, true);
            h.eq(live[ids.ask].value.kind, 'list');
            h.eq(live[ids.ask].value.data.length, 0, 'the fan of zero produced an empty list');
            h.eq(live[ids.ask].fanout.n, 0, 'and a record that says it ran zero items');
            // Collect is where an empty list becomes visible: "nothing came in" is a failure, not an
            // empty value (§1.2, C1-U3's rule). The fan produced nothing to join, and SAYS so.
            h.eq(empty.errors.length, 1, JSON.stringify(empty.errors));
            h.eq(empty.errors[0].partId, ids.collect);

            // A SECOND list into the same port: two fanning inputs, which is a refusal.
            const note2 = await h.graph.place('note', 40, 320);
            const split2 = await h.graph.place('split', 300, 320);
            await h.graph.set(note2, { text: 'one\ntwo' });
            await h.graph.set(split2, { mode: 'lines' });
            await h.graph.set(ids.note, { text: 'a\nb\nc' });
            h.eq((await h.graph.wire(note2, split2, 'text')).ok, true);
            h.eq((await h.graph.wire(split2, ids.ask, 'context')).ok, true, 'the wire itself is legal');

            const refused = await h.graph.run();
            h.eq(refused.errors.length, 1, 'the part refuses at run time, when it can see both lists');
            h.eq(refused.errors[0].partId, ids.ask);
            h.eq(refused.errors[0].message, await str(h, 'parts.errFanoutMany'),
                'it says what to do about it instead of guessing a pairing');
            h.eq((await posts(h, 'mock-item')).length, 0, 'and spent nothing saying so');
            live = await parts(h);
            h.eq(live[ids.collect].state, 'stale', 'the downstream of a refusal is stale');
        },
    },

    {
        name: 'c2-fanout-cap',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The cap is the item ceiling too (BH-4 + fix pass, finding 1): a fan of five under a cap
        // of three never starts, because the alternative — running the first three and leaving the
        // rest — is the silent slice §1.2 bans. Nothing is spent, the report says how many items
        // the part WOULD have run, and "raise it for this run" finishes the job.
        async run(h) {
            await open(h);
            const ids = await build(h);
            await h.eval(() => window.LolChat.app.repo.kvSet('pref:computeMaxItems', 3));

            const capped = await h.graph.run();
            h.eq(capped.capped.cap, 3, 'it stopped at the cap the reader stored');
            h.eq(capped.capped.items, 5, 'and said how many times the part would have run');
            h.eq(capped.capped.raiseTo, 6, 'and what raising it has to reach');
            h.eq(capped.generations, 0);
            h.eq((await posts(h, 'mock-item')).length, 0, 'nothing was sent at all');

            let live = await parts(h);
            h.eq(live[ids.ask].state, 'stale', 'refused is interrupted, not wrong');
            h.eq(live[ids.ask].error === null || live[ids.ask].error === undefined, true);
            h.eq(live[ids.ask].value, null, 'and it produced no half-list');

            const raised = await h.graph.run({ maxItems: 20 });
            h.eq(raised.capped, null, 'raising the cap for this run cleared it');
            h.eq(raised.errors.length, 0, JSON.stringify(raised.errors));
            h.eq((await posts(h, 'mock-item')).length, 5, 'five items, five generations');
            h.eq(raised.generations, 5, 'and the run says what it spent');

            live = await parts(h);
            h.eq(live[ids.ask].state, 'done');
            h.eq(live[ids.ask].value.data.length, 5);
            h.eq(live[ids.collect].state, 'done');
        },
    },

    {
        name: 'c2-fanout-stop',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Stop mid-fan aborts EXACTLY ONE request — the one in flight — and starts no other. One
        // request at a time is the whole of the etiquette on the wire.
        async run(h) {
            await open(h);
            const ids = await build(h, { model: 'mock-slow' });    // 3 s before the first token

            await startRun(h);
            const sent = await waitForPosts(h, 'mock-slow', 1);
            h.eq(sent.length, 1, 'ONE item is in flight, never five at once');

            await h.graph.stop();
            const report = await awaitRun(h);
            h.eq(report.cancelled, true, 'the report says it was stopped');
            h.eq(await h.graph.running(), false, 'and nothing is left running');

            const after = await posts(h, 'mock-slow');
            h.eq(after.length, 1, 'Stop aborted exactly ONE request and started no other item');
            h.eq(after[0].closedEarly, true, 'and the socket really closed before the answer');

            const live = await parts(h);
            h.eq(live[ids.split].state, 'done', 'the finished parts kept their values');
            h.eq(live[ids.split].value.data.length, 5);
            h.eq(live[ids.ask].state, 'stale', 'the interrupted fan is stale, not error');
            h.eq(live[ids.ask].error === null || live[ids.ask].error === undefined, true,
                'it was interrupted, not wrong');

            // Point it at a model that answers: the run resumes and the Split is NOT recomputed.
            await h.graph.set(ids.ask, { model: 'mock-item' });
            const resumed = await h.graph.run();
            h.eq(resumed.ran, 2, 'only the fan and its downstream re-ran');
            h.eq((await posts(h, 'mock-item')).length, 5, 'and the fan really finished');
        },
    },

    {
        name: 'c2-fanout-yields-to-a-person',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Spec §2 etiquette, under a fan-out: a colleague pressing Send takes the seat mid-fan. The
        // item in flight is abandoned, NOTHING is blamed on it, and Run picks up where it stopped.
        async run(h) {
            await open(h);
            const ids = await build(h, { model: 'mock-slow' });

            await startRun(h);
            await waitForPosts(h, 'mock-slow', 1);

            await sendHere(h, 'excuse me, I am typing');
            const reply = await h.waitReply();
            h.assert(reply && reply.text, 'the human got their answer');

            const report = await awaitRun(h);
            h.eq(report.yielded, true, 'the run reports that it gave way');
            h.eq(report.errors.length, 0, 'a yield is not a failure');
            h.eq(report.cancelled, false, 'and it was not the reader pressing Stop');

            const graphPosts = await posts(h, 'mock-slow');
            h.eq(graphPosts.length, 1, 'the graph made exactly one attempt');
            // The mock marks the request closed when the SOCKET closes, and Chromium may keep a
            // cancelled stream's socket for a moment to drain it — under a full-suite load that
            // lands after this line used to read the flag. The claim is unchanged (the request the
            // graph had in flight must be CUT, not left running); it is just given time to arrive.
            let cut = graphPosts[0].closedEarly;
            for (let i = 0; !cut && i < 60; i++) {
                await h.sleep(100);
                const again = await posts(h, 'mock-slow');
                cut = !!(again[0] && again[0].closedEarly);
            }
            h.eq(cut, true, 'which the governor cut the moment Send was pressed');

            const live = await parts(h);
            h.eq(live[ids.ask].state, 'stale', 'the yielded fan is simply due for a re-run');
            h.eq(live[ids.ask].fanout === null || live[ids.ask].fanout.failed === 0, true,
                'a busy farm is NEVER written against an item — "item 1 is bad" would be a lie');

            await h.waitFor(() => (window.LolChat.app.gov.state().foreground === 'idle' ? true : null));
            await h.graph.set(ids.ask, { model: 'mock-item' });
            const resumed = await h.graph.run();
            h.eq(resumed.yielded, false, 'once the person is done, pressing Run finishes the job');
            h.eq(resumed.errors.length, 0, JSON.stringify(resumed.errors));
            h.eq((await posts(h, 'mock-item')).length, 5, 'all five items, once each');
        },
    },

    {
        name: 'c2-fanout-propagates',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // A fan-out PROPAGATES: the fanned list meets the next text port and fans again, until a
        // port that accepts a list joins it back (BH-2). Three items through two thinking parts is
        // six generations — and the cap is what keeps that honest.
        async run(h) {
            await open(h);
            const ids = await build(h, { items: ['one', 'two', 'three'] });
            const second = await h.graph.place('ask', 560, 320);
            await h.graph.set(second, { instruction: '', model: 'mock-item' });
            h.eq((await h.graph.wire(ids.ask, second, 'context')).ok, true,
                'a list output into a text port: the fan travels');

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, JSON.stringify(report.errors));
            h.eq(report.generations, 6, 'three items through two thinking parts');
            const log = await posts(h, 'mock-item');
            h.eq(log.length, 6);
            h.eq(log.slice(3).map(itemOf), ['item: one', 'item: two', 'item: three'],
                'the second part fanned over the FIRST part\'s three answers');

            const live = await parts(h);
            h.eq(live[second].fanout, { n: 3, done: 3, ok: 3, failed: 0, hidden: 0, errors: [] });
            h.eq(live[second].value.kind, 'list', 'and it is still a list at the end');
            h.eq(live[ids.collect].value.data,
                ['one', 'two', 'three'].map((s, i) => `${i + 1}. item: ${s}`).join('\n'),
                'while Collect, which accepts a list, ends the fan-out it was wired to');
        },
    },
];
