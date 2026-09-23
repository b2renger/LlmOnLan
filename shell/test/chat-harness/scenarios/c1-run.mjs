// @ts-check
// C1-U3 in the real browser against the real mock farm: the parts and the run engine
// (plan §2.6 BG-14, docs/LOLCHAT_COMPUTER_SPEC.md §7).
//
// The unit tests prove the runner's bookkeeping against a fake ask spine. These scenarios exist for
// the things a unit test structurally cannot see: how many requests really leave the window, what
// the wire body looked like, whether an aborted run really closed its socket, and whether the
// governor really hands the seat to a human who starts typing. So every assertion here counts POSTs
// in the mock's log or reads their bodies — never "it eventually returned something".
//
// The graph is driven through `window.LolComputer.debug.computer` (h.graph), which BG-9 freezes as the
// door a scenario uses. The CANVAS (what is painted for each of those parts) is C1-U2's
// scenarios/c1-canvas.mjs; the part BODIES are unit-tested against the runner's DOM shim.

const COMPLETIONS = '/v1/chat/completions';

/** Network noise the farm's own error paths make in the console (a 502 body, an aborted stream). */
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when this unit's modules were replaced by fakes or skipped. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    // K1: the graph's modules are loaded by the COMPUTER's loader now, not the chat's.
    const failed = (window.LolComputer && window.LolComputer.failed) || {};
    const missing = ['host', 'ask'].filter((k) => failed[k]);
    if (missing.length) {
        throw new Error(`C1-U3 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
    }
    if (!window.LolComputer.app.ask) throw new Error('the Computer app.ask was never published');
    return true;
});

/** A string as the page itself resolves it, so the test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key) => h.eval((k) => window.LolChat.app.t(k), key);

/** Completion POSTs the mock has seen, newest last. @returns {Promise<any[]>} */
const posts = (/** @type {any} */ h, /** @type {string} */ model) =>
    h.mock.log(model ? { path: COMPLETIONS, model } : { path: COMPLETIONS });

/** The user messages of one recorded request body. */
const userText = (/** @type {any} */ entry) => {
    const messages = (entry && entry.body && entry.body.messages) || [];
    const last = messages[messages.length - 1];
    return last ? last.content : null;
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
    await h.submit('a thread to hang a program on');
    await h.waitReply();
    // A thread the composer just CREATED is not the workbench's thread until it is selected
    // (§2.6 AP.1: a brand-new thread starts closed), and a panel with no thread refuses to place.
    await h.eval(async () => {
        const app = window.LolChat.app;
        const rows = await app.repo.listThreads();
        return app.controller.selectThread(rows[0].id);
    });
    await h.mock.reset();                       // every count below is about the GRAPH
    const state = await h.graph.open();
    h.eq(state.computer, true, 'the Computer panel is the one the rail opened');
    // attach() is async: the panel has no graph — and refuses to place — until this thread's
    // document has been loaded or created.
    await h.waitFor(() => ((window.LolComputer.debug.computer.doc() || {}).id ? true : null));
    return state;
}

/** Note -> Ask -> Collect, the three-part program the spec opens with. */
async function build(/** @type {any} */ h, /** @type {any} */ askSettings) {
    const note = await h.graph.place('note', 40, 40);
    const ask = await h.graph.place('ask', 320, 40);
    const collect = await h.graph.place('collect', 620, 40);
    h.assert(note && ask && collect, 'three parts were placed');
    await h.graph.set(note, { text: 'Paris' });
    await h.graph.set(ask, Object.assign({ instruction: 'name three things', model: 'mock-echo' }, askSettings || {}));
    await h.graph.set(collect, { mode: 'numbered' });
    const w1 = await h.graph.wire(note, ask, 'in');
    h.eq(w1.ok, true, 'Note feeds Ask');
    const w2 = await h.graph.wire(ask, collect, 'items');
    h.eq(w2.ok, true, 'Ask feeds Collect');
    return { note, ask, collect };
}

/** The live parts, by id. */
const parts = async (/** @type {any} */ h) => {
    const state = await h.graph.state();
    /** @type {Record<string, any>} */ const out = {};
    for (const p of state.parts) out[p.id] = p;
    return out;
};

/** Wait until the graph's request has really left the window (the mock is the only witness). */
async function waitForPost(/** @type {any} */ h, /** @type {string} */ model) {
    for (let i = 0; i < 100; i++) {
        const log = await posts(h, model);
        if (log.length) return log;
        await h.sleep(100);
    }
    throw new Error(`no ${model} request reached the mock`);
}

/** Start a run WITHOUT awaiting it (so the scenario can interrupt it), then await it later. */
const startRun = (/** @type {any} */ h) => h.eval(() => {
    /** @type {any} */ (window).__c1run = window.LolComputer.debug.computer.run();
    return true;
});
const awaitRun = (/** @type {any} */ h) => h.eval(() => /** @type {any} */ (window).__c1run);

export default [
    {
        name: 'c1-run-three-parts',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The whole point of the panel, end to end: three parts, one generation, and a body on the
        // wire that is EXACTLY the labelled context plus the instruction.
        async run(h) {
            await open(h);
            const ids = await build(h);

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `no part failed: ${JSON.stringify(report.errors)}`);
            h.eq(report.ran, 3, 'all three parts ran');
            h.eq(report.cancelled, false, 'and nothing was interrupted');

            const log = await posts(h, '');
            h.eq(log.length, 1, 'ONE generation for a three-part graph — only Ask thinks');
            h.eq(log[0].model, 'mock-echo', 'the part\'s own model setting chose the deployment');
            // K2: the C1 "Context:" preamble became §5.3's assembled prompt — the arrivals under
            // their headings first (this arrow has no label, so it is `## Input 1`), the
            // instruction LAST, which is the strongest lever on a small model.
            const inputsHeading = await str(h, 'parts.insInputsHeading');
            const positional = await str(h, 'parts.insPositional');
            const instructionHeading = await str(h, 'parts.insInstructionHeading');
            h.eq(userText(log[0]),
                `${inputsHeading}\n\n## ${positional.replace('{n}', '1')}\nParis\n\n${instructionHeading}\nname three things`,
                'the wired Note arrived under its own heading, followed by the instruction');
            // K2: TWO messages now — the Instruction's frozen system sentence (§5.3) and the one
            // user message. The system text is the part's, declared in strings/parts.en.mjs, not
            // something the spine invented.
            const messages = log[0].body.messages || [];
            h.eq(messages.length, 2, 'the frozen system sentence plus ONE user message');
            h.eq(messages[0].role, 'system');
            h.eq(messages[0].content, await str(h, 'parts.insSystem'), 'the §5.3 system text, verbatim');
            h.eq(messages[1].role, 'user');
            h.eq(log[0].body.stream, true, 'a part streams like everything else, so a stall is visible');

            const live = await parts(h);
            h.eq(live[ids.note].state, 'done');
            h.eq(live[ids.ask].state, 'done');
            h.eq(live[ids.collect].state, 'done');
            h.eq(live[ids.note].value.data, 'Paris', 'the Note is its own value');
            h.assert(live[ids.ask].value && live[ids.ask].value.kind === 'text', 'Ask produced a text value');
            h.eq(live[ids.collect].value.data, `1. ${live[ids.ask].value.data}`,
                'Collect joined exactly what Ask answered, in the mode that was set');

            const askLog = await h.ask.log();
            h.eq(askLog.length, 1, 'the ask spine saw one call');
            h.eq(askLog[0].task, 'graph:ask', 'tagged as the graph\'s, not as a chat turn');

            // An ask is not a turn: the run wrote no message into the conversation.
            const rows = await h.eval(() => document.querySelectorAll('#chat-messages .chat-msg').length);
            h.eq(rows, 2, 'the transcript still holds only the one question and its answer');
        },
    },

    {
        name: 'c1-run-dirty-subgraph',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // "A 30-part graph costs one generation after a typo fix" (spec §2), measured in POSTs.
        async run(h) {
            await open(h);
            const ids = await build(h);
            await h.graph.run();
            h.eq((await posts(h, '')).length, 1, 'the first run cost one generation');

            const again = await h.graph.run();
            h.eq(again.ran, 0, 'an up-to-date graph runs nothing');
            h.eq((await posts(h, '')).length, 1, 'and sends nothing');

            // Edit the LAST part: the dirty subgraph is that part alone.
            await h.graph.set(ids.collect, { mode: 'bullets' });
            let live = await parts(h);
            h.eq(live[ids.collect].state, 'stale', 'the edited part went stale');
            h.eq(live[ids.ask].state, 'done', 'its upstream did not');
            const third = await h.graph.run();
            h.eq(third.ran, 1, 'only the edited part ran');
            h.eq((await posts(h, '')).length, 1, 'the generation was NOT paid a second time');
            live = await parts(h);
            h.assert(live[ids.collect].value.data.startsWith('- '), 'and it really recomputed, in the new mode');

            // Edit the FIRST part: it and everything downstream are dirty — ONE new generation.
            await h.graph.set(ids.note, { text: 'Rome' });
            live = await parts(h);
            h.eq(live[ids.collect].state, 'stale', 'staleness travelled downstream');
            const fourth = await h.graph.run();
            h.eq(fourth.ran, 3, 'the whole chain re-ran');
            const log = await posts(h, '');
            h.eq(log.length, 2, 'for exactly one more generation');
            h.assert(String(userText(log[1])).includes('Rome'), 'and it carried the edited text');
        },
    },

    {
        name: 'c1-run-failing-part',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // One bad part never ends the run, and never poisons its downstream with a wrong value.
        async run(h) {
            await open(h);
            const ids = await build(h, { model: 'mock-502' });

            const report = await h.graph.run();
            h.eq(report.errors.length, 1, 'exactly one part failed');
            h.eq(report.errors[0].partId, ids.ask);
            const said = report.errors[0].message;
            h.assert(/502|upstream|refused|not answering/i.test(said), `the farm's own words reached the part: ${said}`);
            h.assert((said.match(/could not answer|farm refused/gi) || []).length <= 1,
                `the failure names the farm ONCE, not twice (§2.6 BI-3): ${said}`);
            h.eq(report.ran, 1, 'the Note upstream of it still ran');
            h.eq(report.skipped, 1, 'and the downstream was skipped, not run');

            const live = await parts(h);
            h.eq(live[ids.note].state, 'done');
            h.eq(live[ids.ask].state, 'error');
            h.eq(live[ids.collect].state, 'stale', 'downstream is stale, never error — it was not wrong');
            h.eq(live[ids.collect].value, null, 'and it holds no made-up value');
            h.eq((await posts(h, '')).length, 1, 'the skipped part sent nothing');

            // Point it at a model that answers: only the failed part and its downstream re-run.
            await h.graph.set(ids.ask, { model: 'mock-echo' });
            const second = await h.graph.run();
            h.eq(second.errors.length, 0, 'the fix took');
            h.eq(second.ran, 2, 'the Note did not run again');
        },
    },

    {
        name: 'c1-run-stop',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Stop aborts the ONE in-flight request, keeps every finished value, and leaves the
        // interrupted part stale rather than wrong (BG-6).
        async run(h) {
            await open(h);
            const ids = await build(h, { model: 'mock-slow' });     // 3 s before the first token

            await startRun(h);
            const sent = await waitForPost(h, 'mock-slow');
            h.eq(sent.length, 1, 'exactly one request went out');

            await h.graph.stop();
            const report = await awaitRun(h);
            h.eq(report.cancelled, true, 'the report says it was stopped');
            h.eq(await h.graph.running(), false, 'and nothing is left running');

            const after = await posts(h, 'mock-slow');
            h.eq(after.length, 1, 'Stop aborted exactly ONE request and started no other');
            h.eq(after[0].closedEarly, true, 'and the socket really closed before the answer');

            const live = await parts(h);
            h.eq(live[ids.note].state, 'done', 'the finished part kept its state');
            h.eq(live[ids.note].value.data, 'Paris', 'and its value');
            h.eq(live[ids.ask].state, 'stale', 'the interrupted part is stale, not error');
            h.eq(live[ids.ask].error === null || live[ids.ask].error === undefined, true, 'it carries no error — it was interrupted, not wrong');

            // Run again with a model that answers: the Note is NOT recomputed.
            await h.graph.set(ids.ask, { model: 'mock-echo' });
            const resumed = await h.graph.run();
            h.eq(resumed.ran, 2, 'the run resumed exactly where it stopped');
        },
    },

    {
        name: 'c1-run-yields-to-a-person',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Spec §2 etiquette: the graph is a BACKGROUND holder. A human pressing Send takes the seat,
        // the graph's request is aborted, and the part goes back to stale — no error, nothing lost.
        async run(h) {
            await open(h);
            const ids = await build(h, { model: 'mock-slow' });

            await startRun(h);
            const sent = await waitForPost(h, 'mock-slow');
            h.eq(sent.length, 1, 'the graph is talking to the farm');

            await sendHere(h, 'excuse me, I am typing');
            const reply = await h.waitReply();
            h.assert(reply && reply.text, 'the human got their answer');

            const report = await awaitRun(h);
            h.eq(report.yielded, true, 'the run reports that it gave way');
            h.eq(report.errors.length, 0, 'a yield is not a failure');
            h.eq(report.cancelled, false, 'and it was not the reader pressing Stop');

            // `closedEarly` is the MOCK's own observation, made when the server sees the socket
            // close — which happens a tick or two after the client aborts. Reading the log once,
            // straight after the run's promise settles, is a race the scenario loses whenever the
            // machine is quick (measured at the K1 landing: 2 runs in 3 failed at ~3.9 s and the
            // one that passed took 7.8 s). The GUARANTEE is unchanged — exactly one attempt, and
            // the governor cut it — only the observation now waits for the server to notice.
            let graphPosts = await posts(h, 'mock-slow');
            for (let i = 0; i < 60 && !(graphPosts[0] && graphPosts[0].closedEarly); i++) {
                await h.sleep(50);
                graphPosts = await posts(h, 'mock-slow');
            }
            h.eq(graphPosts.length, 1, 'the graph made exactly one attempt');
            h.eq(graphPosts[0].closedEarly, true, 'which the governor cut the moment Send was pressed');

            const live = await parts(h);
            h.eq(live[ids.note].state, 'done', 'the finished value survived the interruption');
            h.eq(live[ids.ask].state, 'stale', 'and the yielded part is simply due for a re-run');

            // The graph does not get the seat back until the human's own turn is over — which is
            // the etiquette itself, and is why a Run pressed too early yields again instead of
            // queueing ahead of them.
            await h.graph.set(ids.ask, { model: 'mock-echo' });
            const early = await h.graph.run();
            h.eq(early.yielded, true, 'a Run while the person is still streaming yields again');
            h.eq(early.ran, 0, 'and sends nothing');

            await h.waitFor(() => (window.LolChat.app.gov.state().foreground === 'idle' ? true : null));
            const resumed = await h.graph.run();
            h.eq(resumed.ran, 2, 'once the person is done, pressing Run finishes the job');
            h.eq(resumed.yielded, false);
        },
    },

    {
        name: 'c1-run-shapes',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // `list` and `json` ride the ask spine's structured ladder: ONE request each, a real
        // response_format on the wire, and a VALIDATED value on the part.
        async run(h) {
            await open(h);
            const ids = await build(h, { model: 'mock-studio-json', shape: 'list' });

            const listRun = await h.graph.run();
            h.eq(listRun.errors.length, 0, JSON.stringify(listRun.errors));
            let log = await posts(h, 'mock-studio-json');
            h.eq(log.length, 1, 'one request for one answer');
            h.eq(log[0].body.response_format.type, 'json_schema', 'the list shape asked for a schema');
            h.eq(log[0].body.response_format.json_schema.schema.required, ['items'], 'its own fixed items schema');

            let live = await parts(h);
            const value = live[ids.ask].value;
            h.eq(value.kind, 'list', 'Ask produced a list value');
            h.assert(Array.isArray(value.data) && value.data.length > 0, 'with items in it');
            h.eq(value.data[0].kind, 'text', 'each item is a text value');
            h.eq(live[ids.collect].value.data, value.data.map((/** @type {any} */ v, /** @type {number} */ i) => `${i + 1}. ${v.data}`).join('\n'),
                'and Collect joined the list ITEM BY ITEM — the C1 way a list travels');

            // The json shape, against a schema the reader typed.
            await h.graph.set(ids.ask, { shape: 'json', schema: '{"type":"object","properties":{"city":{"type":"string"}},"required":["city"],"additionalProperties":false}' });
            const jsonRun = await h.graph.run();
            h.eq(jsonRun.errors.length, 0, JSON.stringify(jsonRun.errors));
            log = await posts(h, 'mock-studio-json');
            h.eq(log.length, 2, 'one more request');
            h.eq(log[1].body.response_format.json_schema.schema.required, ['city'], "the reader's own schema rode out");
            live = await parts(h);
            h.eq(live[ids.ask].value.kind, 'json');
            h.eq(typeof live[ids.ask].value.data.city, 'string', 'and the value really matches the schema');

            // A bad schema never reaches the farm.
            await h.graph.set(ids.ask, { schema: '{not json' });
            const refused = await h.graph.run();
            h.eq(refused.errors.length, 1);
            h.eq(refused.errors[0].message, await str(h, 'parts.errBadSchema'), 'it says which half is wrong');
            h.eq((await posts(h, 'mock-studio-json')).length, 2, 'and spent no seat saying so');
        },
    },

    {
        name: 'c1-run-no-farm',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // §1.2: a part that cannot run says so on itself. It never resolves to an empty value.
        async run(h) {
            await open(h);
            const ids = await build(h);
            await h.setFarm(null);
            await h.waitFor(() => {
                const caps = window.LolChat.app.farm.get();
                return caps && caps.present ? null : true;
            });

            const report = await h.graph.run();
            h.eq(report.errors.length, 1, 'the thinking part failed');
            h.eq(report.errors[0].partId, ids.ask);
            h.eq(report.errors[0].message, await str(h, 'parts.errNoFarm'), 'with the sentence a person can act on');
            h.eq((await posts(h, '')).length, 0, 'and nothing was sent anywhere');

            const live = await parts(h);
            h.eq(live[ids.note].state, 'done', 'the parts that need no farm still ran');
            h.eq(live[ids.ask].state, 'error');
            h.eq(live[ids.ask].value, null, 'an unreachable farm produces NO value, not an empty one');
            h.eq(live[ids.collect].state, 'stale');
        },
    },

    {
        name: 'c1-run-cap',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The generation cap (spec §2): the run stops AT the cap and says how much is left, and
        // "raise it for this run" is one call away. Not a silent truncation.
        async run(h) {
            await open(h);
            await h.eval(() => window.LolChat.app.repo.kvSet('pref:computeMaxItems', 2));
            /** @type {string[]} */ const asks = [];
            for (let i = 0; i < 4; i++) {
                const id = await h.graph.place('ask', 40 + i * 260, 40);
                await h.graph.set(id, { instruction: `ask number ${i}`, model: 'mock-echo' });
                asks.push(id);
            }

            const capped = await h.graph.run();
            // C2, plan §2.6 BH-4: the cap moved out of a pre-pass and into the metered ask
            // wrapper (a fan-out's item count is only known at run time), so the report now also
            // says what it SPENT. The behaviour this scenario guards is unchanged.
            h.eq(capped.capped, { cap: 2, spent: 2, stopped: 2 }, 'it stopped at the cap and said how much is left');
            h.eq(capped.ran, 2, 'two parts ran');
            h.eq((await posts(h, '')).length, 2, 'two generations, not four');

            const raised = await h.graph.run({ maxItems: 10 });
            h.eq(raised.capped, null, 'raising the cap for this run cleared it');
            h.eq(raised.ran, 2, 'and only the two that had not run');
            h.eq((await posts(h, '')).length, 4, 'four generations in total, every one of them asked for');
            const live = await parts(h);
            for (const id of asks) h.eq(live[id].state, 'done', 'every part finished');
        },
    },
];
