// @ts-check
// C2-U3 in the real browser against the real mock farm: the two bridges between the canvas and the
// conversation (plan §2.6 BH-1/BH-6/BH-7, docs/LOLCHAT_COMPUTER_SPEC.md §3 and §7).
//
// The unit tests prove the bridges' bookkeeping against fake doors. These scenarios exist for the
// three things a unit test structurally cannot see:
//   1. `From thread` really reads the conversation the reader is looking at — the message the
//      thread VIEW is showing, through the same repo the controller writes.
//   2. `To thread` really lands in the transcript: a new `.chat-msg` row, rendered by the ordinary
//      safe markdown renderer (so `**bold**` becomes a <strong> and an injected <script> does not
//      become an element), and a row the store still has after a reload.
//   3. Neither bridge spends a generation, and a round trip through `Ask` spends exactly one.
// Every count below comes from the mock's own log or from the DOM — never from "it returned".

const COMPLETIONS = '/v1/chat/completions';

/** Network noise the farm's own error paths make in the console. */
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when this unit's modules were replaced by fakes or skipped. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolChat && window.LolChat.failed) || {};
    const missing = ['computer', 'ask'].filter((k) => failed[k]);
    if (missing.length) {
        throw new Error(`C2-U3 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
    }
    return true;
});

/** A string as the page itself resolves it, so the test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key) => h.eval((k) => window.LolChat.app.t(k), key);

/** Completion POSTs the mock has seen, newest last. */
const posts = (/** @type {any} */ h, /** @type {string} */ model) =>
    h.mock.log(model ? { path: COMPLETIONS, model } : { path: COMPLETIONS });

/** The live parts, by id. */
const parts = async (/** @type {any} */ h) => {
    const state = await h.graph.state();
    /** @type {Record<string, any>} */ const out = {};
    for (const p of state.parts) out[p.id] = p;
    return out;
};

/** The transcript as the reader sees it: one entry per row, with the rendered body. */
const transcript = (/** @type {any} */ h) => h.eval(() => {
    const rows = Array.prototype.slice.call(document.querySelectorAll('#chat-messages .chat-msg'));
    return rows.map((row) => {
        const body = row.querySelector('.chat-body');
        return {
            id: row.getAttribute('data-id'),
            role: row.classList.contains('user') ? 'user' : 'assistant',
            text: body ? body.textContent : '',
            strong: body ? body.querySelectorAll('strong').length : 0,
            scripts: body ? body.querySelectorAll('script').length : 0,
            images: body ? body.querySelectorAll('img[onerror]').length : 0,
            inGraph: !!row.closest('.graph'),
        };
    });
});

/** What the STORE holds for the open thread — the half the DOM cannot prove. */
const stored = (/** @type {any} */ h) => h.eval(async () => {
    const app = window.LolChat.app;
    const id = app.state.threadId;
    const path = await app.repo.getPath(id);
    return path.map((m) => ({ id: m.id, role: m.role, content: m.content, source: (m.params && m.params.source) || null }));
});

/** A thread with one real exchange in it, then the Computer panel open on that thread. */
async function open(/** @type {any} */ h, /** @type {string} */ question) {
    await requireReal(h);
    await h.submit(question);
    const reply = await h.waitReply();
    // A thread the composer just CREATED is not the workbench's thread until it is selected
    // (§2.6 AP.1), and a panel with no thread refuses to place.
    await h.eval(async () => {
        const app = window.LolChat.app;
        const rows = await app.repo.listThreads();
        return app.controller.selectThread(rows[0].id);
    });
    await h.mock.reset();                       // every count below is about the GRAPH
    await h.graph.open();
    await h.waitFor(() => (window.LolChat.debug.computer.doc().threadId ? true : null));
    return reply;
}

/** Where the inspector is in the page, told from the DOM alone. */
const inspector = (/** @type {any} */ h) => h.eval(() => {
    const el = document.querySelector('#lolchat .graph-inspect');
    if (!el) return { open: false };
    const main = window.LolChat.app.els.main;
    const form = window.LolChat.app.els.form;
    return {
        open: true,
        text: (el.querySelector('.graph-inspect-body') || {}).textContent || '',
        head: !!el.querySelector('.graph-inspect-head'),
        inMain: el.parentNode === main,
        beforeComposer: el.nextSibling === form,
        inMessages: !!el.closest('#chat-messages'),
        inGraph: !!el.closest('.graph'),
        count: document.querySelectorAll('.graph-inspect').length,
    };
});

/** Click the value chip of one part — the door a reader really uses. */
const openValue = (/** @type {any} */ h, /** @type {string} */ partId) => h.eval((id) => {
    const part = document.querySelector(`#lolchat .graph-part[data-id="${id}"]`);
    if (!part) throw new Error(`no part ${id} on the canvas`);
    const chip = part.querySelector('.graph-value');
    if (!chip || chip.hidden) throw new Error(`part ${id} shows no value to open`);
    chip.click();
    return true;
}, partId);

/** A real Escape on the inspector, as a keyboard would deliver it. */
const escape = (/** @type {any} */ h) => h.eval(() => {
    const el = document.querySelector('#lolchat .graph-inspect');
    if (!el) throw new Error('no inspector to close');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return true;
});

export default [
    {
        name: 'c2-bridges-from-thread',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The bridge IN: the answer on screen becomes a value on the canvas, for free.
        async run(h) {
            const question = 'what is the capital of France?';
            const reply = await open(h, question);

            const from = await h.graph.place('from-thread', 40, 40);
            h.assert(from, 'From thread was placed');

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `no part failed: ${JSON.stringify(report.errors)}`);
            h.eq(report.ran, 1, 'the one part ran');
            h.eq((await posts(h, '')).length, 0, 'reading the conversation costs NO generation');

            let live = await parts(h);
            h.eq(live[from].state, 'done');
            h.eq(live[from].value.kind, 'text', 'the message arrives as text');
            h.eq(live[from].value.data, reply.text, 'and it is exactly the answer the reader is looking at');

            // The other end of the same branch.
            await h.graph.set(from, { source: 'lastQuestion' });
            h.eq((await parts(h))[from].state, 'stale', 'changing what it takes makes it due for a re-run');
            const second = await h.graph.run();
            h.eq(second.errors.length, 0);
            live = await parts(h);
            h.eq(live[from].value.data, question, 'the last question, verbatim');

            // One chosen message, by id: the door the message actions will use.
            const first = await h.eval(async () => {
                const app = window.LolChat.app;
                const path = await app.repo.getPath(app.state.threadId);
                return path[0].id;
            });
            await h.graph.set(from, { source: 'message', messageId: first });
            await h.graph.run();
            live = await parts(h);
            h.eq(live[from].value.data, question, 'a chosen message is that message and no neighbour');

            // A message that is not there is a REFUSAL with a sentence, never an empty value.
            await h.graph.set(from, { source: 'message', messageId: 'no-such-message' });
            const third = await h.graph.run();
            h.eq(third.errors.length, 1, 'the part failed');
            h.eq(third.errors[0].message, await str(h, 'parts.errNoMessage'));
            live = await parts(h);
            h.eq(live[from].state, 'error');
            // (`state().parts[]` carries no `error` field until C2-U2 adds it — BH-13 — so the
            // sentence is asserted on the report above.)
            // The runner leaves a failed part's LAST value alone (it marks state + error, and the
            // downstream is blocked), so what matters here is that the refusal invented nothing new:
            // the value is still the one the previous run produced.
            h.eq(live[from].value.data, question, 'the refusal produced no new value of its own');
            h.eq((await posts(h, '')).length, 0, 'still not one generation');
        },
    },

    {
        name: 'c2-bridges-to-thread',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The bridge OUT: a value becomes a message in the transcript — rendered by the ordinary
        // safe renderer, and really in the store.
        async run(h) {
            await open(h, 'a thread to post into');
            const before = (await transcript(h)).length;

            const note = await h.graph.place('note', 40, 40);
            const to = await h.graph.place('to-thread', 360, 40);
            const body = '**bold** and <script>window.__pwned = 1</script> and <img src=x onerror="window.__pwned = 2">';
            await h.graph.set(note, { text: body });
            await h.graph.set(to, { role: 'assistant', prefix: 'From the Computer:' });
            const wired = await h.graph.wire(note, to, 'value');
            h.eq(wired.ok, true, 'a Note may feed To thread');

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `no part failed: ${JSON.stringify(report.errors)}`);
            h.eq(report.ran, 2, 'both parts ran');
            h.eq((await posts(h, '')).length, 0, 'posting into the conversation costs NO generation');

            const live = await parts(h);
            h.eq(live[to].state, 'done', 'a part with no output is done, not failed (BH-6)');
            h.eq(live[to].value, null, 'and it invents no value');

            const rows = await transcript(h);
            h.eq(rows.length, before + 1, 'exactly ONE new row in the transcript');
            const posted = rows[rows.length - 1];
            h.eq(posted.role, 'assistant', 'posted as the assistant, as asked');
            h.assert(posted.text.includes('From the Computer:'), 'the line above the value is there');
            h.eq(posted.strong, 1, '**bold** went through the markdown renderer');
            h.eq(posted.scripts, 0, 'the injected <script> is NOT an element');
            h.eq(posted.images, 0, 'and neither is the onerror image');
            h.assert(posted.text.includes('<script>'), 'the injection is shown as the text it is');
            h.eq(posted.inGraph, false, 'the message is in the conversation column, not on the canvas');
            h.eq(await h.eval(() => !!window.__pwned), false, 'nothing ran');

            const rowsInStore = await stored(h);
            h.eq(rowsInStore.length, before + 1, 'the store has it too — this is a real turn, not a painting');
            h.eq(rowsInStore[rowsInStore.length - 1].source, 'computer', 'and it says where it came from');

            // A re-run of an up-to-date graph must not post a second copy.
            const again = await h.graph.run();
            h.eq(again.ran, 0, 'nothing was stale');
            h.eq((await transcript(h)).length, before + 1, 'so the conversation was not spammed');

            // Re-running the part ITSELF is a deliberate second post, which is the reader's choice.
            await h.graph.run({ only: [to] });
            h.eq((await transcript(h)).length, before + 2, 'an explicit re-run posts again');
        },
    },

    {
        name: 'c2-bridges-round-trip',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Both directions in one graph: take the answer, work on it, put the result back — the
        // program spec §3 opens the Computer with. ONE generation for the whole round trip.
        async run(h) {
            const reply = await open(h, 'tell me about Paris');
            const before = (await transcript(h)).length;

            const from = await h.graph.place('from-thread', 40, 40);
            const ask = await h.graph.place('ask', 340, 40);
            const to = await h.graph.place('to-thread', 660, 40);
            await h.graph.set(ask, { instruction: 'shorten this', model: 'mock-echo' });
            h.eq((await h.graph.wire(from, ask, 'context')).ok, true, 'From thread feeds Ask');
            h.eq((await h.graph.wire(ask, to, 'value')).ok, true, 'Ask feeds To thread');

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `no part failed: ${JSON.stringify(report.errors)}`);
            h.eq(report.ran, 3, 'all three parts ran');

            const log = await posts(h, '');
            h.eq(log.length, 1, 'ONE generation for the whole round trip — only Ask thinks');
            const sent = log[0].body.messages[log[0].body.messages.length - 1].content;
            h.assert(String(sent).includes(reply.text), 'the answer from the conversation really went out as context');

            const live = await parts(h);
            const answer = live[ask].value.data;
            const rows = await transcript(h);
            h.eq(rows.length, before + 1, 'and one message came back');
            h.assert(rows[rows.length - 1].text.includes(answer), 'the posted message carries what the farm answered');
            h.eq(live[to].state, 'done');
        },
    },
    {
        name: 'c2-bridges-inspector',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The other door into the conversation column (BH-7): a value opened FULL SIZE where
        // reading happens — above the composer, outside #chat-messages, one at a time, and closing
        // on Escape WITHOUT stopping the run that is still going.
        async run(h) {
            await open(h, 'a thread to read values next to');

            const note = await h.graph.place('note', 40, 40);
            const ask = await h.graph.place('ask', 360, 40);
            const long = 'line one\nline two\nline three';
            await h.graph.set(note, { text: long });
            await h.graph.set(ask, { instruction: 'slow one', model: 'mock-slow' });
            h.eq((await h.graph.wire(note, ask, 'context')).ok, true, 'Note feeds Ask');

            h.eq((await inspector(h)).open, false, 'nothing is open before anything is clicked');

            // Start a run that will NOT finish on its own: the Escape below has a live run to
            // (not) stop.
            await h.eval(() => { window.__c2run = window.LolChat.debug.computer.run(); return true; });
            await h.waitFor(() => (document.querySelector('#lolchat .graph-part[data-id] .graph-value:not([hidden])') ? true : null));

            await openValue(h, note);
            let view = await inspector(h);
            h.eq(view.open, true, 'clicking the value opened the inspector');
            h.eq(view.inMain, true, 'it is a direct child of the conversation column');
            h.eq(view.beforeComposer, true, 'immediately above the composer (BH-7)');
            h.eq(view.inMessages, false, 'and NEVER inside #chat-messages');
            h.eq(view.inGraph, false, 'nor on the canvas');
            h.eq(view.text, long, 'the whole value, line breaks and all');
            h.eq(view.count, 1, 'exactly one');

            // Opening another value replaces it rather than stacking.
            await openValue(h, note);
            h.eq((await inspector(h)).count, 1, 'a second opening replaces the first');

            h.eq(await h.graph.running(), true, 'the run is still going while the reader reads');
            await escape(h);
            h.eq((await inspector(h)).open, false, 'Escape closed the inspector');
            h.eq(await h.graph.running(), true, 'and the run did NOT stop — the key never reached it');

            // Now really stop, so the scenario leaves nothing in flight.
            await h.graph.stop();
            await h.eval(() => window.__c2run);
            h.eq(await h.graph.running(), false);

            // A thread change takes the value with it: it belonged to the other conversation.
            await openValue(h, note);
            h.eq((await inspector(h)).open, true);
            await h.eval(async () => {
                const app = window.LolChat.app;
                const thread = app.controller.newThread();
                return app.controller.selectThread(thread.id);
            });
            await h.waitFor(() => (document.querySelector('#lolchat .graph-inspect') ? null : true));
            h.eq((await inspector(h)).open, false, 'a thread change closed it');
        },
    },
];
