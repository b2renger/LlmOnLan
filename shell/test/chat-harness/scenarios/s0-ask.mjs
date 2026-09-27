// @ts-check
// S0-U2 in the real browser against the real mock farm: the ask spine (studio plan §3.4).
//
// The unit tests already prove the ladder against a fake `fetch`. These scenarios exist for the two
// things a unit test structurally cannot see: how many requests really leave the window, and what
// the wire body looked like when they did. So every one of them counts POSTs in the mock's log and
// reads `/mock/last-body` — "exactly one request" and "strict:true actually rode out" are the
// assertions, not "it eventually returned something".
//
// The models are the S0 kickoff additions (§2.6 BD-11): `mock-studio-json` answers an instance of
// whatever schema it was sent (or, with no schema, prose around a fenced instance of it),
// `mock-json-reasoning-only` puts the whole thing in reasoning, `mock-json-empty` says nothing at
// all, and `mock-vision-refuse` 400s on an image.

const COMPLETIONS = '/v1/chat/completions';
const GROUP_INFO = '/model_group/info';

/** Network noise the farm's own error paths make in the console (a 400 body, an aborted stream). */
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when this unit's modules were replaced by fakes or skipped. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolChat && window.LolChat.failed) || {};
    const missing = ['ask', 'caps'].filter((k) => failed[k]);
    if (missing.length) {
        throw new Error(`S0-U2 needs the REAL modules, but the loader dropped: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
    }
    if (!window.LolChat.app.ask) throw new Error('app.ask was never published');
    return true;
});

/** Wait until the farm reached the page (the ask spine refuses without one, correctly). */
const waitForFarm = (/** @type {any} */ h) => h.waitFor(() => {
    const app = window.LolChat && window.LolChat.app;
    const caps = app && app.farm ? app.farm.get() : null;
    return caps && caps.present && caps.baseUrl ? { id: caps.id, baseUrl: caps.baseUrl } : null;
});

/** One ask, from the page, exactly as a panel would make it. */
const ask = (/** @type {any} */ h, /** @type {any} */ opts) => h.eval(
    (o) => window.LolChat.app.ask.json(o),
    opts,
);

const askText = (/** @type {any} */ h, /** @type {any} */ opts) => h.eval(
    (o) => window.LolChat.app.ask.text(o),
    opts,
);

const SCHEMA = {
    type: 'object',
    properties: { title: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } },
    required: ['title', 'steps'],
    additionalProperties: false,
};

/**
 * The schema `s0-ask-drop` uses. It is deliberately the shape `mock-studio-json` falls back to when
 * NO schema reached it (§2.6 BD-11's default instance), because that is exactly the situation the
 * scenario reproduces: with `structuredDrop` the proxy deletes `response_format` before dispatch,
 * so the mock cannot echo our schema back and answers its default one instead. Asking for a
 * different shape here would test the mock's fixture, not the client's fallback.
 */
const DROP_SCHEMA = {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
};

/** How many completion POSTs the mock has seen, ever. */
const posts = async (/** @type {any} */ h) => (await h.mock.log({ path: COMPLETIONS })).length;

export default [
    {
        name: 's0-ask-schema',
        needsMock: true,
        async run(h) {
            await requireReal(h);
            await waitForFarm(h);

            const r = await ask(h, { task: 'outline', schema: SCHEMA, prompt: 'outline a sketch', model: 'mock-studio-json' });
            h.eq(r.ok, true, 'a typed answer came back');
            h.eq(r.mode, 'schema', 'through the schema rung');
            h.assert(r.value && typeof r.value.title === 'string', 'and it has the schema\'s own shape');
            h.assert(Array.isArray(r.value.steps), 'including the array');

            h.eq(await posts(h), 1, 'ONE request for one answer');

            const body = await h.mock.lastBody();
            h.eq(body.response_format.type, 'json_schema', 'response_format actually rode out');
            h.eq(body.response_format.json_schema.strict, true, 'strict:true, as §3.4.2 rung 1 says');
            h.assert(body.max_tokens >= 512, `max_tokens ${body.max_tokens} is at or above the floor`);
            h.eq(body.stream, true, 'an ask streams like everything else, so a stall is visible');
            h.note(`ask.log: ${JSON.stringify(await h.ask.log())}`);
            const log = await h.ask.log();
            h.eq(log.length, 1, 'the debug door records exactly the calls that happened');
            h.eq(log[0].task, 'outline');
            h.eq(log[0].model, 'mock-studio-json');

            // An ask is not a turn: nothing was written to the transcript or the store.
            const traces = await h.eval(async () => {
                const app = window.LolChat.app;
                const threads = await app.repo.listThreads();
                return { threads: threads.length, rows: document.querySelectorAll('.chat-msg').length };
            });
            h.eq(traces.threads, 0, 'no thread was created');
            h.eq(traces.rows, 0, 'and no message row was painted');
        },
    },

    {
        name: 's0-ask-drop',
        needsMock: true,
        async run(h) {
            await requireReal(h);
            const farm = await waitForFarm(h);
            // LiteLLM's drop_params on a deployment that does not claim schema support.
            await h.mock.state({ structuredDrop: true });

            const first = await ask(h, { task: 'outline', schema: DROP_SCHEMA, prompt: 'first', model: 'mock-studio-json' });
            h.eq(first.ok, true, 'the answer is still an answer — it just arrived wrapped in prose');
            h.eq(first.mode, 'prompt', 'and is reported as what it really was');
            h.eq(await posts(h), 1, 'which cost ONE seat, not two');

            const sent = await h.mock.lastBody();
            h.assert(sent.response_format, 'the CLIENT did send a schema; the proxy is what dropped it');

            const key = `structuredMode:${farm.id}:mock-studio-json`;
            h.eq(await h.eval((k) => window.LolChat.app.repo.kvGet(k, null), key), null, 'one disappointment is not a verdict');

            await ask(h, { task: 'outline', schema: DROP_SCHEMA, prompt: 'second', model: 'mock-studio-json' });
            const verdict = await h.waitFor((k) => window.LolChat.app.repo.kvGet(k, null), { args: [key] });
            h.eq(verdict, 'prompt', 'two consecutive ones are');

            // From now on the schema is rendered into the system text instead.
            await ask(h, { task: 'outline', schema: DROP_SCHEMA, prompt: 'third', model: 'mock-studio-json' });
            const third = await h.mock.lastBody();
            h.eq(third.response_format, undefined, 'no response_format is sent to a model that ignores it');
            h.eq(third.messages[0].role, 'system');
            h.assert(/JSON only/.test(third.messages[0].content), 'the schema rides in the prompt instead');
            h.eq(await posts(h), 3, 'three asks, three requests');
            h.eq(await h.eval(() => window.LolChat.app.ask.mode('mock-studio-json')), 'prompt', 'and mode() says so out loud');
        },
    },

    {
        name: 's0-ask-reasoning-only',
        needsMock: true,
        async run(h) {
            await requireReal(h);
            await waitForFarm(h);
            const r = await ask(h, { task: 'outline', schema: SCHEMA, prompt: 'think it through', model: 'mock-json-reasoning-only' });
            h.eq(r.ok, true, 'a model that thought in JSON has answered (F8)');
            h.assert(typeof r.value.title === 'string', 'and the value is typed');
            h.eq(await posts(h), 1, 'without a second attempt');
        },
    },

    {
        name: 's0-ask-empty',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await requireReal(h);
            await waitForFarm(h);

            const r = await ask(h, { task: 'outline', schema: SCHEMA, prompt: 'say nothing', model: 'mock-json-empty' });
            h.eq(r.ok, false, 'nothing came back, and the result says so');
            h.eq(r.error.kind, 'empty');
            h.assert(r.error.message && r.error.message.length > 3, 'with a sentence a panel can show');
            h.eq(r.value, null);
            h.eq(await posts(h), 2, 'the ladder tried the prompt rung before giving up');

            // §1.2 / §3.4.2 rung 3: a panel must render this as a VISIBLE row with a Retry, never a
            // silent resolve. There is no panel in S0, so the scenario builds the smallest possible
            // host out of the same pieces a panel has — the result's own sentence and the `ask.retry`
            // string — and proves both are really there and really rendered.
            const host = await h.eval((result) => {
                const el = document.createElement('div');
                el.className = 'ask-test-host';
                const p = document.createElement('p');
                p.textContent = result.error.message;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = window.LolChat.app.t('ask.retry');
                btn.dataset.retry = '1';
                el.append(p, btn);
                document.getElementById('lolchat').appendChild(el);
                const shown = document.querySelector('.ask-test-host');
                return {
                    text: shown.querySelector('p').textContent,
                    retry: shown.querySelector('[data-retry]').textContent,
                    visible: shown.getBoundingClientRect().height > 0,
                };
            }, r);
            h.assert(host.visible, 'the failure is on screen, not in the console');
            h.eq(host.text, r.error.message);
            h.assert(host.retry && host.retry !== 'ask.retry', 'the Retry label is a registered string');
            h.note(`empty-result host: ${JSON.stringify(host)}`);
        },
    },

    {
        name: 's0-ask-busy',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await requireReal(h);
            await waitForFarm(h);

            // The reader's own message is streaming: the spine must refuse without touching the wire.
            await h.submit('a long answer please');
            await h.waitFor(() => (document.querySelector('.chat-msg.assistant[data-status="streaming"]') ? true : null));
            const before = await posts(h);

            const r = await ask(h, { task: 'outline', schema: SCHEMA, prompt: 'meanwhile', model: 'mock-studio-json' });
            h.eq(r.ok, false);
            h.eq(r.error.kind, 'busy', 'refused immediately');
            h.eq(await posts(h), before, 'and issued ZERO requests');
            h.assert(r.error.message.length > 3, 'with a sentence of its own to show');

            await h.click('#chat-stop');
            await h.waitFor(() => (document.querySelector('.chat-msg.assistant[data-status="aborted"]') ? true : null));
            // The row turns 'aborted' when the view repaints; the SLOT comes back when the
            // controller's finally runs. Wait for the governor itself, not for the pixels.
            await h.waitFor(() => (window.LolChat.app.gov.state().foreground === 'idle' ? true : null));

            // The slot came back: the same ask now goes through.
            const after = await ask(h, { task: 'outline', schema: SCHEMA, prompt: 'meanwhile', model: 'mock-studio-json' });
            h.eq(after.ok, true, 'and it works the moment the reader is done');
            h.eq(await posts(h), before + 1);
        },
    },

    {
        name: 's0-ask-queue',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        timeoutMs: 90000,
        async run(h) {
            await requireReal(h);
            await waitForFarm(h);

            // A 4-item batch: exactly 4 requests, never two in flight.
            const out = await h.eval(async (schema) => {
                const app = window.LolChat.app;
                window.__askQueue = app.ask.queue({
                    label: 'Naming 4 sketches',
                    items: ['one', 'two', 'three', 'four'],
                    run: (item) => app.ask.json({ task: 'name', schema, prompt: item, model: 'mock-studio-json' }),
                });
                return window.__askQueue.promise;
            }, SCHEMA);
            h.eq(out.done, 4, 'every item ran');
            h.eq(out.cancelled, false);

            const log = await h.mock.log({ path: COMPLETIONS });
            h.eq(log.length, 4, 'exactly one request per item');
            // Strictly serial: no request started before the previous one finished. `closedEarly`
            // would mark an overlap-induced abort; the timestamps prove the ordering.
            const overlapped = log.some((e, i) => i > 0 && e.ts < log[i - 1].ts);
            h.assert(!overlapped, 'the mock saw them in order, one after another');
            h.eq(log.filter((e) => e.closedEarly).length, 0, 'and none of them was cut off');

            // Cancel mid-batch: the in-flight item finishes, nothing after it starts.
            await h.mock.reset();
            const cancelled = await h.eval(async (schema) => {
                const app = window.LolChat.app;
                const q = app.ask.queue({
                    label: 'Naming 4 more',
                    items: ['a', 'b', 'c', 'd'],
                    run: async (item, i) => {
                        const r = await app.ask.json({ task: 'name', schema, prompt: item, model: 'mock-studio-json' });
                        if (i === 0) q.cancel();
                        return r;
                    },
                });
                const result = await q.promise;
                return { result, state: q.state() };
            }, SCHEMA);
            h.eq(cancelled.result.cancelled, true, 'the batch says it was cancelled');
            h.eq(cancelled.state.running, false, 'and stopped');
            h.eq(await posts(h), 1, 'the mock saw no request after the cancel');

            // Hidden means idle: a batch started while the window is in the background sends nothing
            // until it comes back. The farm snapshot is the only clock, so the queue resumes on a
            // tick, not on a timer.
            await h.mock.reset();
            await h.eval(() => { window.__harness.setPageVisible(false); return true; });
            const started = await h.eval((schema) => {
                const app = window.LolChat.app;
                window.__hiddenQueue = app.ask.queue({
                    label: 'Hidden batch',
                    items: ['x', 'y'],
                    run: (item) => app.ask.json({ task: 'name', schema, prompt: item, model: 'mock-studio-json' }),
                });
                return true;
            }, SCHEMA);
            h.assert(started, 'the batch was started while hidden');
            await h.sleep(1200);
            h.eq(await posts(h), 0, 'nothing left the machine while nobody was looking');

            await h.eval(() => { window.__harness.setPageVisible(true); return true; });
            const resumed = await h.eval(() => window.__hiddenQueue.promise);
            h.eq(resumed.done, 2, 'and it picked itself up when the window came back');
            h.eq(await posts(h), 2);
        },
    },

    {
        name: 's0-ask-vision-cap',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            // The catalogue says this model is blind: one GET, no POST, and the answer is a sentence
            // naming what the operator has to change.
            await h.mock.state({
                modelGroupInfo: {
                    data: [
                        { model_group: 'mock-vision-echo', supports_vision: false },
                        { model_group: 'mock-studio-json', supports_vision: false },
                    ],
                },
            });
            // The scenario's own first page load already probed the DEFAULT catalogue (h.fresh()
            // navigates before this function runs), so everything below is counted from the reload
            // that carries the override — not from the beginning of time.
            const mark = Date.now();
            await h.reload();
            await requireReal(h);
            await waitForFarm(h);

            const verdict = await h.waitFor(() => {
                const v = window.LolChat.app.ask.vision('mock-vision-echo');
                return v === 'no' ? v : null;
            });
            h.eq(verdict, 'no', 'the probe answered, and it is remembered');

            const gets = await h.mock.log({ path: GROUP_INFO, since: mark });
            h.assert(gets.length >= 1, 'the catalogue was actually read');
            h.eq(gets.length, 1, 'exactly once — a capability is not re-asked on every tick');
            h.eq(gets[0].method, 'GET', 'a GET: the seat gate never counts it');
            h.eq(await posts(h), 0, 'and nothing was generated to find this out');
            h.note(`group-info reads since the reload: ${gets.length}; probes: ${await h.eval(() => window.LolChat.debug.caps.probes())}`);

            const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
            const refused = await askText(h, { task: 'look', prompt: 'what is this', images: [px], model: 'mock-vision-echo' });
            h.eq(refused.ok, false);
            h.eq(refused.error.kind, 'no_vision');
            // Critic S1-13: the reader changes it (a model that can see), and no model id is named.
            h.assert(/Pick a model that can see/.test(refused.error.message), 'the sentence names what has to change');
            h.assert(!/gemma|:\d+b/.test(refused.error.message), 'and promises no particular model');
            h.eq(await posts(h), 0, 'a known-blind model is refused locally');

            // A model the catalogue never mentioned is 'unknown' — so we ASK, and the farm's own 400
            // is what downgrades it. Unknown is not "no".
            h.eq(await h.eval(() => window.LolChat.app.ask.vision('mock-vision-refuse')), 'unknown');
            const tried = await askText(h, { task: 'look', prompt: 'what is this', images: [px], model: 'mock-vision-refuse' });
            h.eq(tried.ok, false);
            h.eq(tried.error.kind, 'no_vision');
            h.eq(await posts(h), 1, 'exactly one attempt, and never a second');
            const downgraded = await h.waitFor(() => {
                const v = window.LolChat.app.ask.vision('mock-vision-refuse');
                return v === 'no' ? v : null;
            });
            h.eq(downgraded, 'no', 'the engine had the last word');
            h.note(`vision verdicts: ${JSON.stringify(await h.eval(() => window.LolChat.debug.caps.verdicts()))}`);
        },
    },
];
