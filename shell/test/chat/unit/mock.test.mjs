// Unit tests for the mock farm (plan §2.3 / P0-U1 acceptance).
//
// Everything runs in-process on EPHEMERAL ports (0): no test may bind 4009/4010/4011/41987,
// because parallel builders own those slots, and none may touch a live-stack port at all.
// The beacon tests spy on dgram.createSocket — if the spy ever failed to install, the fake
// socket's send() would not be there to refuse, so it throws instead of sending.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';

import {
    startMock, parseArgs, beaconAllowed, assertPortAllowed, assertPortsAllowed,
    portsForSlot, FORBIDDEN_PORTS, BASE_PORTS, BEACON_DISABLED_LINE,
} from '../../mock/index.js';
import { defaults } from '../../mock/state.js';
import { seatsFullBody, upstreamDownBody } from '../../mock/seats-body.js';
import { echoLines, MODEL_IDS } from '../../mock/scenario-models.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const FARM_SEATS = path.join(REPO, 'farm', 'src', 'seats.js');

const EPHEMERAL = { port: 0, keyedPort: 0, servicesPort: 0, httpPort: 0, quiet: true };

/** Start a mock on ephemeral ports, run fn, always close. */
async function withMock(opts, fn) {
    const mock = await startMock({ ...EPHEMERAL, ...opts });
    try { return await fn(mock); } finally { await mock.close(); }
}

const post = (url, body, headers) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: JSON.stringify(body),
});

/** Parse a finished SSE body into its events. */
function parseSSE(text) {
    const events = [];
    for (const block of text.split('\n\n')) {
        const line = block.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') { events.push({ done: true }); continue; }
        try { events.push({ json: JSON.parse(payload) }); } catch { events.push({ bad: payload }); }
    }
    const deltaOf = (e) => (e.json && e.json.choices && e.json.choices[0] && e.json.choices[0].delta) || {};
    return {
        events,
        done: events.some((e) => e.done),
        last: events[events.length - 1],
        reasoning: events.filter((e) => typeof deltaOf(e).reasoning_content === 'string').length,
        content: events.filter((e) => typeof deltaOf(e).content === 'string').length,
        usage: events.filter((e) => e.json && e.json.usage).map((e) => e.json.usage),
        errors: events.filter((e) => e.json && e.json.error).map((e) => e.json.error),
        text: events.map((e) => deltaOf(e).content || '').join(''),
        reasoningText: events.map((e) => deltaOf(e).reasoning_content || '').join(''),
        finish: events.map((e) => e.json && e.json.choices && e.json.choices[0] && e.json.choices[0].finish_reason)
            .filter((f) => f != null),
    };
}

const chat = async (mock, model, extra = {}) => {
    const res = await post(`${mock.urls.proxy}/v1/chat/completions`, {
        model, stream: true, messages: [{ role: 'user', content: 'hi' }], ...extra,
    });
    return { res, sse: parseSSE(await res.text()) };
};

export default (test) => {
    // -----------------------------------------------------------------------------------
    // ports and the beacon: the live-box safety rules
    // -----------------------------------------------------------------------------------

    test('it refuses every forbidden port, in every role', async () => {
        for (const p of FORBIDDEN_PORTS) {
            assert.throws(() => assertPortAllowed('proxy', p), /forbidden port/, `port ${p} was allowed`);
            for (const role of ['proxy', 'keyed', 'services', 'http']) {
                assert.throws(() => assertPortsAllowed({ [role]: p }), /forbidden port/);
            }
        }
        assert.doesNotThrow(() => assertPortAllowed('proxy', 0));
        assert.doesNotThrow(() => assertPortAllowed('proxy', 4009));
        await assert.rejects(startMock({ ...EPHEMERAL, port: 41998 }), /forbidden port 41998/);
        // 41997 has NO escape hatch, on any machine and with any env: the README used to promise CI
        // could pass --http-port 41997, and this is the assertion that says it cannot.
        await assert.rejects(startMock({ ...EPHEMERAL, httpPort: 41997 }), /forbidden port 41997/);
        await assert.rejects(
            startMock({ ...parseArgs(['--http-port', '41997'], { LOL_MOCK_BEACON_OK: '1' }), quiet: true }),
            /forbidden port 41997/);
        await assert.rejects(
            startMock({ ...EPHEMERAL, keyedPort: 11434, key: 'pw' }), /forbidden port 11434/);
        // A configured port is refused even when THIS call would not bind it: `--slot 244` computes
        // keyed=8890 (a live-farm port) and used to start anyway without a --key (P0 landing fix).
        await assert.rejects(
            startMock({ ...parseArgs(['--slot', '244'], {}), quiet: true }), /forbidden port 8890/);
    });

    test('a slot offsets every default port by 20n and never lands on a forbidden one', () => {
        assert.deepEqual(portsForSlot(0), BASE_PORTS);
        assert.deepEqual(portsForSlot(1), { port: 4029, keyedPort: 4030, servicesPort: 4031, httpPort: 42007 });
        for (let n = 0; n <= 9; n++) {
            for (const p of Object.values(portsForSlot(n))) {
                assert.ok(!FORBIDDEN_PORTS.includes(p), `slot ${n} computes forbidden port ${p}`);
            }
        }
        // Explicit ports are used as given; the slot only moves the defaults.
        assert.equal(parseArgs(['--slot', '1'], {}).port, 4029);
        assert.equal(parseArgs(['--slot', '1'], {}).httpPort, 42007);
        assert.equal(parseArgs(['--slot', '1', '--port', '5000'], {}).port, 5000);
        assert.equal(parseArgs([], {}).port, 4009);
        assert.equal(parseArgs(['--key', 'harness-pw'], {}).key, 'harness-pw');
        assert.equal(parseArgs(['--coordinator'], {}).coordinator, true);
    });

    test('beaconAllowed: only the env var, and never with --no-beacon', () => {
        assert.equal(beaconAllowed([], {}), false);
        assert.equal(beaconAllowed(['--coordinator'], {}), false);
        assert.equal(beaconAllowed([], { LOL_MOCK_BEACON_OK: '0' }), false);
        assert.equal(beaconAllowed(['--no-beacon'], { LOL_MOCK_BEACON_OK: '1' }), false);
        assert.equal(beaconAllowed([], { LOL_MOCK_BEACON_OK: '1' }), true);
        assert.match(BEACON_DISABLED_LINE, /^beacon disabled \(set LOL_MOCK_BEACON_OK=1 only on a machine with no LlmOnLan client running\)$/);
    });

    test('no UDP socket is ever created without the env var, and exactly one with it', async () => {
        const real = dgram.createSocket;
        const calls = [];
        const fake = () => ({
            // bind() never calls back, so no interval is ever scheduled...
            bind() { },
            // ...and send() is a tripwire: nothing may leave this box.
            send() { throw new Error('the mock tried to SEND a beacon packet in a unit test'); },
            close() { },
            setBroadcast() { }, setMulticastTTL() { }, unref() { },
        });
        dgram.createSocket = (...a) => { calls.push(a); return fake(); };
        const envBefore = process.env.LOL_MOCK_BEACON_OK;
        const run = async (argv, env) => {
            const o = parseArgs(argv, env);
            if (env.LOL_MOCK_BEACON_OK === undefined) delete process.env.LOL_MOCK_BEACON_OK;
            else process.env.LOL_MOCK_BEACON_OK = env.LOL_MOCK_BEACON_OK;
            const mock = await startMock({ ...o, ...EPHEMERAL, key: null, beaconPort: 41998 });
            try {
                const health = await (await fetch(`${mock.urls.services}/mock/health`)).json();
                return { beacon: mock.beacon, health };
            } finally { await mock.close(); }
        };
        try {
            let r = await run(['--coordinator'], {});
            assert.equal(calls.length, 0, 'a socket was created without LOL_MOCK_BEACON_OK');
            assert.equal(r.beacon, false);
            assert.equal(r.health.beacon, false);

            r = await run(['--no-beacon'], { LOL_MOCK_BEACON_OK: '1' });
            assert.equal(calls.length, 0, 'a socket was created despite --no-beacon');
            assert.equal(r.beacon, false);

            r = await run([], { LOL_MOCK_BEACON_OK: '1' });
            assert.equal(calls.length, 1, 'expected exactly one createSocket call');
            assert.deepEqual(calls[0], ['udp4']);
            assert.equal(r.beacon, true);
            assert.equal(r.health.beacon, true);
        } finally {
            dgram.createSocket = real;
            if (envBefore === undefined) delete process.env.LOL_MOCK_BEACON_OK;
            else process.env.LOL_MOCK_BEACON_OK = envBefore;
        }
    });

    // -----------------------------------------------------------------------------------
    // the endpoints
    // -----------------------------------------------------------------------------------

    // shell/test/e2e.js is BYTE-FROZEN (plan §1.1/§2.5) and is the only test that guards
    // "seats are not conflated with connected clients". It reads this default snapshot through
    // mock-farm.js, so the two numbers must stay different here — a scenario that wants them
    // equal says so with POST /mock/state.
    test('the default snapshot keeps capacity.clients !== capacity.seatsUsed (frozen for e2e.js)', async () => {
        assert.deepEqual(defaults().capacity, { slots: 2, clients: 3, seatsUsed: 1, seatIdleSec: 900 });
        await withMock({}, async (mock) => {
            const self = await (await fetch(`${mock.urls.services}/lol/self`)).json();
            const c = self.capacity;
            assert.notEqual(c.clients, c.seatsUsed, 'e2e.js asserts a "3 connected" bit that app.js only emits when they differ');
            assert.ok(c.clients > c.seatsUsed, 'more apps open than seats held is the case e2e.js renders');
            assert.ok(c.slots - c.seatsUsed > 0, 'e2e.js also asserts "1 of 2 seats free"');
        });
    });

    test('GET /v1/models lists every scenario model, /model_group/info carries vision', async () => {
        await withMock({}, async (mock) => {
            const models = await (await fetch(`${mock.urls.proxy}/v1/models`)).json();
            const ids = models.data.map((m) => m.id);
            assert.deepEqual(ids, MODEL_IDS);
            for (const must of ['assistant', 'gemma4:12b', 'mock-echo', 'mock-429', 'mock-perf:mixed']) {
                assert.ok(ids.includes(must), `missing model ${must}`);
            }
            const groups = await (await fetch(`${mock.urls.proxy}/model_group/info`)).json();
            const byId = Object.fromEntries(groups.data.map((g) => [g.model_group, g.supports_vision]));
            assert.equal(byId['gemma4:12b'], true);
            assert.equal(byId.assistant, false);
        });
    });

    test('the assistant stream is 100 reasoning + 1000 content + usage + [DONE]', async () => {
        await withMock({}, async (mock) => {
            const { res, sse } = await chat(mock, 'assistant');
            assert.equal(res.status, 200);
            assert.equal(res.headers.get('content-type'), 'text/event-stream');
            assert.equal(sse.reasoning, 100);
            assert.equal(sse.content, 1000);
            assert.equal(sse.usage.length, 1);
            assert.equal(sse.usage[0].completion_tokens, 1000);
            // prompt_tokens = ceil(JSON.stringify(messages).length / 3) — deterministic.
            const msgs = [{ role: 'user', content: 'hi' }];
            assert.equal(sse.usage[0].prompt_tokens, Math.ceil(JSON.stringify(msgs).length / 3));
            assert.ok(sse.done, 'no [DONE]');
            assert.equal(sse.last.done, true, '[DONE] must be last');
            assert.ok(sse.reasoningText.startsWith('think0 '));
            assert.ok(sse.text.startsWith('tok0 '));
            assert.deepEqual(sse.finish, ['stop']);
        });
    }, { timeoutMs: 20000 });

    test('a full farm 429s every completion with the farm\'s own seat text', async () => {
        await withMock({}, async (mock) => {
            mock.store.merge({ capacity: { slots: 2, seatsUsed: 2, seatIdleSec: 900 } });
            const res = await post(`${mock.urls.proxy}/v1/chat/completions`, {
                model: 'assistant', stream: true, messages: [{ role: 'user', content: 'hi' }],
            });
            assert.equal(res.status, 429);
            assert.equal(res.headers.get('retry-after'), '30');
            const body = await res.json();
            assert.equal(body.error.code, 'lol_seats_full');
            assert.equal(body.error.type, 'rate_limit_error');

            // The wording must equal farm/src/seats.js, not our idea of it.
            const farmSrc = fs.readFileSync(FARM_SEATS, 'utf8');
            const tmpl = /message: `([^`]*)`/.exec(farmSrc);
            assert.ok(tmpl, 'could not find the 429 template in farm/src/seats.js');
            const expected = tmpl[1].replace('${a.cap}', '2').replace('${mins}', '15');
            assert.equal(body.error.message, expected);
            assert.equal(seatsFullBody({ cap: 2, idleSec: 900 }).error.message, expected);

            const up = /message: '([^']*)'/.exec(farmSrc);
            assert.ok(up, 'could not find the 502 message in farm/src/seats.js');
            assert.equal(upstreamDownBody().error.message, up[1]);

            // A different capacity re-renders the sentence the same way the farm does.
            mock.store.merge({ capacity: { slots: 4, seatsUsed: 4, seatIdleSec: 120 } });
            const b2 = await (await post(`${mock.urls.proxy}/v1/chat/completions`, {
                model: 'mock-echo', stream: true, messages: [],
            })).json();
            assert.match(b2.error.message, /^All 4 seats /);
            assert.match(b2.error.message, /~2 min without activity/);
        });
    });

    test('the keyed listener is 400 without the key and 200 with it', async () => {
        await withMock({ key: 'harness-pw' }, async (mock) => {
            const body = { model: 'mock-usage-none', stream: true, messages: [{ role: 'user', content: 'hi' }] };
            const bare = await post(`${mock.urls.keyed}/v1/chat/completions`, body);
            assert.equal(bare.status, 400);
            const err = await bare.json();
            assert.equal(err.error.type, 'auth_error');
            assert.equal(err.error.code, '400');
            assert.match(err.error.message, /^Authentication Error, Invalid proxy server token passed/);

            const wrong = await post(`${mock.urls.keyed}/v1/models`, {}, { authorization: 'Bearer nope' });
            assert.equal(wrong.status, 400);

            const good = await post(`${mock.urls.keyed}/v1/chat/completions`, body, { authorization: 'Bearer harness-pw' });
            assert.equal(good.status, 200);
            const sse = parseSSE(await good.text());
            assert.equal(sse.content, 100);
            assert.equal(sse.usage.length, 0, 'mock-usage-none must not send usage');
            assert.ok(sse.done);

            // The OPEN listener takes anything, key or no key.
            const open = await post(`${mock.urls.proxy}/v1/chat/completions`, body);
            assert.equal(open.status, 200);
            open.body.cancel();
        });
    });

    test('mock-length continues a trailing assistant', async () => {
        await withMock({}, async (mock) => {
            const fresh = await chat(mock, 'mock-length');
            assert.equal(fresh.sse.content, 200);
            assert.deepEqual(fresh.sse.finish, ['length']);
            assert.ok(fresh.sse.text.startsWith('tok0 '), fresh.sse.text.slice(0, 20));

            const cont = await chat(mock, 'mock-length', {
                messages: [
                    { role: 'user', content: 'go' },
                    { role: 'assistant', content: 'tok0 tok1 tok2' },
                ],
            });
            assert.equal(cont.sse.content, 200);
            assert.ok(cont.sse.text.startsWith('tok3 tok4 '), cont.sse.text.slice(0, 30));
            assert.deepEqual(cont.sse.finish, ['length']);
        });
    });

    test('mock-restart-on-prefill restarts on a prefill and continues on the "continue" turn', async () => {
        await withMock({}, async (mock) => {
            const prefill = await chat(mock, 'mock-restart-on-prefill', {
                messages: [{ role: 'user', content: 'go' }, { role: 'assistant', content: 'tok0 tok1 tok2' }],
            });
            assert.ok(prefill.sse.text.startsWith('Hello! '), prefill.sse.text.slice(0, 30));

            const cont = await chat(mock, 'mock-restart-on-prefill', {
                messages: [
                    { role: 'user', content: 'go' },
                    { role: 'assistant', content: 'tok0 tok1 tok2' },
                    { role: 'user', content: 'Continue exactly where you stopped.' },
                ],
            });
            assert.ok(!cont.sse.text.startsWith('Hello! '), 'it restarted on the continue turn');
            assert.ok(cont.sse.text.startsWith('(continuing) tok3 '), cont.sse.text.slice(0, 30));
        });
    });

    test('mock-echo reports hasReasoningField when a message carries reasoning', async () => {
        await withMock({}, async (mock) => {
            const read = (text) => Object.fromEntries(text.split('\n').filter(Boolean).map((l) => {
                const i = l.indexOf(': ');
                return [l.slice(0, i), l.slice(i + 2)];
            }));

            const clean = await chat(mock, 'mock-echo', {
                messages: [{ role: 'system', content: 'be nice' }, { role: 'user', content: 'hi there' }],
                temperature: 0.7,
            });
            const a = read(clean.sse.text);
            assert.equal(a.hasReasoningField, 'false');
            assert.equal(a.roles, 'system,user');
            assert.equal(a.lastRole, 'user');
            assert.equal(a.systemText, '"be nice"');
            assert.equal(a.params, 'temperature=0.7');
            assert.equal(a.textLengths, '7,8');
            assert.equal(a.imageCount, '0');

            const dirty = await chat(mock, 'mock-echo', {
                messages: [
                    { role: 'user', content: 'hi' },
                    { role: 'assistant', content: 'yes', reasoning: 'thought hard' },
                ],
            });
            const b = read(dirty.sse.text);
            assert.equal(b.hasReasoningField, 'true');
            assert.equal(b.lastRole, 'assistant');

            const legacy = await chat(mock, 'mock-echo', {
                messages: [{ role: 'assistant', content: 'yes', reasoning_content: 'x' }],
            });
            assert.equal(read(legacy.sse.text).hasReasoningField, 'true');

            // Content parts, images and the injection markers.
            const rich = await chat(mock, 'mock-echo', {
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: '<' + '<document a.pdf>>\nWeb search results\n<' + '<blender-scene>>' },
                        { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } },
                    ],
                }],
                response_format: { type: 'json_schema', json_schema: { name: 'x' } },
            });
            const c = read(rich.sse.text);
            assert.equal(c.partTypes, 'text,image_url');
            assert.equal(c.imageCount, '1');
            assert.equal(c.markerDocument, 'true');
            assert.equal(c.markerWebSearch, 'true');
            assert.equal(c.markerBlenderScene, 'true');
            assert.match(c.responseFormat, /json_schema/);

            // GET /mock/last-body hands back the raw request text.
            const raw = await (await fetch(`${mock.urls.services}/mock/last-body`)).json();
            assert.equal(raw.model, 'mock-echo');
            assert.equal(raw.messages[0].content[1].type, 'image_url');
        });
    });

    test('echoLines is a pure function of the body (same body, same lines)', () => {
        const body = { model: 'mock-echo', messages: [{ role: 'user', content: 'hi' }], top_p: 1 };
        assert.deepEqual(echoLines(body), echoLines(body));
        assert.ok(echoLines(body).every((l) => /^[a-zA-Z]+: /.test(l)), 'every line must be "key: value"');
    });

    test('the failure models produce the real farm/LiteLLM bodies', async () => {
        await withMock({}, async (mock) => {
            const r429 = await post(`${mock.urls.proxy}/v1/chat/completions`, { model: 'mock-429', messages: [] });
            assert.equal(r429.status, 429);
            assert.equal(r429.headers.get('retry-after'), '30');
            assert.equal((await r429.json()).error.code, 'lol_seats_full');

            const r502 = await post(`${mock.urls.proxy}/v1/chat/completions`, { model: 'mock-502', messages: [] });
            assert.equal(r502.status, 502);
            assert.equal((await r502.json()).error.code, 'lol_upstream_down');

            const rctx = await post(`${mock.urls.proxy}/v1/chat/completions`, { model: 'mock-context-overflow', messages: [] });
            assert.equal(rctx.status, 400);
            const ctxBody = await rctx.json();
            assert.match(ctxBody.error.message, /ContextWindowExceeded/);
            assert.match(ctxBody.error.message, /maximum context length/);

            const unknown = await post(`${mock.urls.proxy}/v1/chat/completions`, { model: 'mock-nope', messages: [] });
            assert.equal(unknown.status, 400);
            assert.match((await unknown.json()).error.message, /Invalid model name/);

            // The client must never embed on the farm; an accidental call is loud.
            const emb = await post(`${mock.urls.proxy}/v1/embeddings`, { input: 'x' });
            assert.equal(emb.status, 418);
        });
    });

    test('mock-midstream-error, mock-reset and mock-think-tags', async () => {
        await withMock({}, async (mock) => {
            const mid = await chat(mock, 'mock-midstream-error');
            assert.equal(mid.res.status, 200);
            assert.equal(mid.sse.content, 50);
            assert.equal(mid.sse.errors.length, 1);
            assert.equal(mid.sse.errors[0].message, 'upstream exploded');
            assert.equal(mid.sse.done, false, 'a mid-stream error must not be followed by [DONE]');

            // mock-reset destroys the socket: reading the body must FAIL, not end cleanly.
            const res = await post(`${mock.urls.proxy}/v1/chat/completions`, { model: 'mock-reset', messages: [] });
            let failed = false;
            let text = '';
            try {
                const reader = res.body.getReader();
                const dec = new TextDecoder();
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    text += dec.decode(value, { stream: true });
                }
            } catch { failed = true; }
            assert.ok(failed, 'mock-reset ended the stream cleanly instead of resetting it');
            assert.ok(parseSSE(text).content > 0, 'no deltas arrived before the reset');

            const think = await chat(mock, 'mock-think-tags');
            assert.match(think.sse.text, /<think>weighing the options carefully<\/think>Here is the answer/);
            assert.equal(think.sse.reasoning, 0, 'the tags must ride in content, not reasoning_content');
            assert.ok(think.sse.events.some((e) => {
                const d = e.json && e.json.choices && e.json.choices[0] && e.json.choices[0].delta;
                return d && d.content === '<th';
            }), 'the opening tag must be split across chunks');
        });
    });

    test('state.proxyDown drops the connection; /lol/self and the control API stay up', async () => {
        await withMock({}, async (mock) => {
            const self1 = await (await fetch(`${mock.urls.services}/lol/self`)).json();
            assert.equal(self1.name, 'Mock Farm');
            assert.equal(self1.id, 'mockfarm0001');
            assert.equal(self1.httpPort, mock.ports.http);
            assert.notEqual(self1.httpPort, 41997);
            assert.equal(self1.openaiBaseUrl, `http://127.0.0.1:${mock.ports.proxy}/v1`);
            assert.equal(self1.backend.contextPerSlot, 16384);
            assert.equal(self1.capacity.slots, 2);
            assert.equal(self1.models[0].id, 'assistant');
            assert.equal(self1.models[0].default, true);
            assert.equal(self1.searxngUrl, null);

            // The same snapshot is served on the --http-port listener.
            const self2 = await (await fetch(`http://127.0.0.1:${mock.ports.http}/lol/self`)).json();
            assert.equal(self2.id, self1.id);

            await post(`${mock.urls.services}/mock/state`, { proxyDown: true, name: 'Down Farm', busy: { label: 'switching' } });
            const self3 = await (await fetch(`${mock.urls.services}/lol/self`)).json();
            assert.equal(self3.name, 'Down Farm');
            assert.equal(self3.busy.label, 'switching');

            await assert.rejects(fetch(`${mock.urls.proxy}/v1/models`), /fetch failed|socket hang up|terminated/i);

            await post(`${mock.urls.services}/mock/reset`, {});
            const self4 = await (await fetch(`${mock.urls.services}/lol/self`)).json();
            assert.equal(self4.name, 'Mock Farm');
            assert.equal(self4.busy, null);
            assert.equal((await fetch(`${mock.urls.proxy}/v1/models`)).status, 200);
        });
    });

    test('the log records method, path, headers, body and closedEarly', async () => {
        await withMock({}, async (mock) => {
            const t0 = Date.now();
            await fetch(`${mock.urls.proxy}/v1/models`);
            await post(`${mock.urls.proxy}/v1/chat/completions`, {
                model: 'mock-echo', messages: [{ role: 'user', content: 'logged' }],
            }, { 'x-filename': 'note.pdf' });

            const entries = await (await fetch(`${mock.urls.services}/mock/log?since=${t0}`)).json();
            assert.ok(Array.isArray(entries), 'GET /mock/log must return a bare array');
            const completion = entries.find((e) => e.path === '/v1/chat/completions');
            assert.ok(completion, 'the completion was not logged');
            assert.equal(completion.method, 'POST');
            assert.equal(completion.model, 'mock-echo');
            assert.equal(completion.role, 'proxy');
            assert.equal(completion.headers['x-filename'], 'note.pdf');
            assert.equal(completion.headers['content-type'], 'application/json');
            assert.equal(completion.body.messages[0].content, 'logged');
            assert.equal(completion.status, 200);
            assert.ok(entries.some((e) => e.path === '/v1/models' && e.method === 'GET'));
            // A control call must not pollute the log the scenario is reading.
            assert.ok(!entries.some((e) => String(e.path).startsWith('/mock/')));

            // Filters.
            const onlyChat = await (await fetch(`${mock.urls.services}/mock/log?path=/v1/chat/completions`)).json();
            assert.equal(onlyChat.length, 1);
            const byModel = await (await fetch(`${mock.urls.services}/mock/log?model=mock-echo`)).json();
            assert.equal(byModel.length, 1);

            // An aborted generation is marked closedEarly.
            const ac = new AbortController();
            const p = fetch(`${mock.urls.proxy}/v1/chat/completions`, {
                method: 'POST', signal: ac.signal,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ model: 'assistant', stream: true, messages: [] }),
            }).then((r) => r.text()).catch(() => 'aborted');
            await new Promise((r) => setTimeout(r, 250));
            ac.abort();
            await p;
            await new Promise((r) => setTimeout(r, 150));
            const after = await (await fetch(`${mock.urls.services}/mock/log?model=assistant`)).json();
            assert.equal(after.length, 1);
            assert.equal(after[0].closedEarly, true, 'the abandoned stream was not marked closedEarly');
        });
    });

    test('mock-md and mock-perf stream a fixture (or warn and stand in for it)', async () => {
        await withMock({}, async (mock) => {
            const md = await chat(mock, 'mock-md');
            assert.ok(md.sse.content > 5, 'mock-md streamed nothing');
            assert.ok(md.sse.text.length > 50);
            assert.ok(md.sse.done);
            // Deterministic chunking: the same seed gives the same split.
            const again = await chat(mock, 'mock-md');
            assert.deepEqual(
                again.sse.events.slice(0, 5).map((e) => e.json.choices[0].delta.content),
                md.sse.events.slice(0, 5).map((e) => e.json.choices[0].delta.content));

            const warnings = await (await fetch(`${mock.urls.services}/mock/warnings`)).json();
            const fixturesLanded = fs.existsSync(path.join(REPO, 'shell', 'test', 'chat', 'fixtures', 'md', 'stream.md'));
            if (!fixturesLanded) {
                assert.ok(warnings.some((w) => /fixture missing/.test(w)), 'a missing fixture must warn');
            } else {
                assert.equal(warnings.length, 0, `unexpected warnings: ${warnings.join(' | ')}`);
            }

            // reasoning-40k is ~9,000 deltas: at the default ~330 deltas/s it takes ~24 s, which is a
            // paint-stress rate meant for the harness, not for a unit test. state.streamRate is the
            // documented override and MUST beat the model's own opts (pace() in scenario-models.js).
            await post(`${mock.urls.services}/mock/state`, { streamRate: { tickMs: 1, perTick: 400 } });
            const t0 = Date.now();
            const perf = await chat(mock, 'mock-perf:reasoning-40k');
            const elapsed = Date.now() - t0;
            assert.ok(perf.sse.reasoning > 0, 'reasoning-40k streams reasoning first');
            assert.ok(perf.sse.text.startsWith('Done. '));
            assert.ok(perf.sse.reasoningText.length > 39000, `reasoning was ${perf.sse.reasoningText.length} chars`);
            assert.ok(elapsed < 8000, `streamRate did not override the model's pacing (${elapsed} ms)`);
            await post(`${mock.urls.services}/mock/state`, { streamRate: {} });
        });
    }, { timeoutMs: 30000 });
};
