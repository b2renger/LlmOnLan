// app/ask.mjs (S0-U2, studio plan §3.4): the one-shot typed call, its fallback ladder, its
// etiquette and its batch queue. The farm here is a fake `fetch` returning real SSE bytes through
// the real net/run.mjs + net/delta.mjs, and the governor is the REAL one — the two things this
// module is most likely to get wrong are "how many requests actually left" and "who was allowed to
// send them", and a stubbed governor or a stubbed stream would hide both.
import assert from 'node:assert/strict';
import { createAsk, install, MIN_MAX_TOKENS, QUEUE_EVENT, NO_VISION_EVENT } from '../../../renderer/chat/app/ask.mjs';
import { createGovernor } from '../../../renderer/chat/net/governor.mjs';
import { createBus, EV } from '../../../renderer/chat/core/events.mjs';
import { API_KEYS, KV_KEYS } from '../../../renderer/chat/core/types.mjs';
import { createCaps, install as installCaps, readModelGroupInfo } from '../../../renderer/chat/app/caps.mjs';

const FARM_ID = 'farm-1';
const BASE = 'http://10.0.0.5:4000/v1';

/** One SSE body, as LiteLLM writes it (content deltas, then a usage-only chunk, then [DONE]). */
function sseBody(chunks, opts) {
  const o = opts || {};
  const field = o.reasoning ? 'reasoning_content' : 'content';
  let out = '';
  for (const c of chunks) out += `data: ${JSON.stringify({ choices: [{ delta: { [field]: c } }] })}\n\n`;
  out += `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: chunks.length, total_tokens: 9 } })}\n\n`;
  out += 'data: [DONE]\n\n';
  return out;
}

/**
 * A fake farm endpoint. `reply(body, n)` returns either a string (the assistant's text), an
 * {reasoning} object, or {status, json} for an error response.
 */
function fakeFarm(reply) {
  /** @type {any[]} */ const posts = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    posts.push({ url, body, headers: init.headers });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const out = await reply(body, posts.length - 1);
      // A real fetch rejects when its signal fires; the fake must too, or an abort that arrives
      // mid-request (the governor cutting a background call) would look like a clean answer.
      if (init.signal && init.signal.aborted) {
        throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
      }
      if (out && typeof out === 'object' && out.status) {
        return new Response(JSON.stringify(out.json || { error: { message: out.message || 'no' } }), { status: out.status });
      }
      const text = typeof out === 'string' ? out : (out && out.text) || '';
      const chunks = text ? [text] : [];
      return new Response(sseBody(chunks, { reasoning: !!(out && out.reasoning) }), { status: 200 });
    } finally {
      inFlight--;
    }
  };
  return { impl, posts, stats: () => ({ maxInFlight }) };
}

/** @param {{seats?: any, models?: any[], present?: boolean, caps?: any, vision?: string}} [o] */
function stubApp(o) {
  const opts = o || {};
  const bus = createBus();
  /** @type {Map<string, any>} */ const kv = new Map();
  const caps = {
    present: opts.present === false ? false : true,
    id: FARM_ID,
    baseUrl: opts.present === false ? null : BASE,
    proxyRoot: 'http://10.0.0.5:4000',
    apiKey: 'pw',
    requiresKey: true,
    keyMissing: false,
    defaultModel: 'gemma4:12b',
    models: opts.models || [{ id: 'gemma4:12b', underlying: 'gemma4:12b', default: true }],
    seats: opts.seats === undefined ? null : opts.seats,
    ...(opts.caps || {}),
  };
  const app = /** @type {any} */ ({
    bus,
    now: () => Date.now(),
    state: { threadId: null, visible: true, pageVisible: true, storeMode: 'idb' },
    repo: {
      kvGet: async (k, d) => (kv.has(k) ? kv.get(k) : d),
      kvSet: async (k, v) => { kv.set(k, v); },
    },
    farm: {
      get: () => caps,
      headers: () => ({ authorization: 'Bearer pw' }),
      modelInfo: (id) => caps.models.find((m) => m.id === id) || null,
      cap: () => opts.vision || 'unknown',
    },
  });
  app.gov = createGovernor(app);
  return { app, kv, caps, bus };
}

const SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' }, count: { type: 'integer' } },
  required: ['name', 'count'],
  additionalProperties: false,
};

/** Install the fake endpoint for the duration of one test. */
async function withFarm(farm, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = farm.impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

export default (test) => {
  // ---- shape ---------------------------------------------------------------------------------

  test('install publishes app.ask with EXACTLY the API_KEYS.ask keys', () => {
    const { app } = stubApp();
    install(app);
    assert.deepEqual(Object.keys(app.ask).sort(), [...API_KEYS.ask].sort());
  });

  test('install publishes the harness debug door without widening the API', () => {
    const { app } = stubApp();
    const bag = {};
    globalThis.window = /** @type {any} */ ({ LolChat: { debug: bag } });
    try {
      install(app);
      assert.equal(typeof (/** @type {any} */ (bag).ask.log), 'function');
      assert.deepEqual(/** @type {any} */ (bag).ask.log(), []);
      assert.equal('debug' in app.ask, false);
    } finally { delete globalThis.window; }
  });

  // ---- the schema rung -------------------------------------------------------------------------

  test('the schema rung sends strict json_schema and parses a bare object', async () => {
    const { app, kv } = stubApp();
    const { api } = createAsk(app);
    const farm = fakeFarm(() => JSON.stringify({ name: 'box', count: 2 }));
    const r = await withFarm(farm, () => api.json({ task: 'title', schema: SCHEMA, prompt: 'name it' }));

    assert.equal(r.ok, true);
    assert.equal(r.mode, 'schema');
    assert.deepEqual(r.value, { name: 'box', count: 2 });
    assert.equal(farm.posts.length, 1);
    const body = farm.posts[0].body;
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.response_format.json_schema.schema, SCHEMA);
    assert.ok(body.max_tokens >= MIN_MAX_TOKENS, `max_tokens ${body.max_tokens} is under the floor`);
    assert.equal(farm.posts[0].url, `${BASE}/chat/completions`);
    assert.equal(kv.get(KV_KEYS.structuredMode(FARM_ID, 'gemma4:12b')), 'json', 'a clean schema answer is remembered');
  });

  test('the caller may raise max_tokens but never lower it below the floor', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    const farm = fakeFarm(() => JSON.stringify({ name: 'a', count: 1 }));
    await withFarm(farm, async () => {
      await api.json({ task: 't', schema: SCHEMA, prompt: 'p1', maxTokens: 10 });
      await api.json({ task: 't', schema: SCHEMA, prompt: 'p2', maxTokens: 9000 });
    });
    assert.ok(farm.posts[0].body.max_tokens >= MIN_MAX_TOKENS);
    assert.equal(farm.posts[1].body.max_tokens, 9000);
  });

  test('a coerced answer is returned; an unknown field never survives', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    const farm = fakeFarm(() => JSON.stringify({ name: 'box', count: '3', surprise: true }));
    const r = await withFarm(farm, () => api.json({ task: 't', schema: SCHEMA, prompt: 'p' }));
    assert.deepEqual(r.value, { name: 'box', count: 3 });
  });

  // ---- the ladder ------------------------------------------------------------------------------

  test('a stripped response_format comes back as prose: one request, mode prompt, verdict flips after two', async () => {
    const { app, kv } = stubApp();
    const { api } = createAsk(app);
    const farm = fakeFarm(() => 'Here you go.\n```json\n{"name":"box","count":1}\n```');
    const key = KV_KEYS.structuredMode(FARM_ID, 'gemma4:12b');

    const first = await withFarm(farm, () => api.json({ task: 't', schema: SCHEMA, prompt: 'one' }));
    assert.equal(first.ok, true, 'the answer is still an answer');
    assert.equal(first.mode, 'prompt', 'reported as what it really was');
    assert.equal(farm.posts.length, 1, 'and it cost ONE seat, not two');
    assert.equal(kv.get(key), undefined, 'one disappointment is not a verdict');

    await withFarm(farm, () => api.json({ task: 't', schema: SCHEMA, prompt: 'two' }));
    assert.equal(kv.get(key), 'prompt', 'two consecutive ones are');

    // From here on the schema is rendered into the system text and never sent as response_format.
    const third = await withFarm(farm, () => api.json({ task: 't', schema: SCHEMA, prompt: 'three' }));
    const body = farm.posts[2].body;
    assert.equal(body.response_format, undefined);
    assert.match(body.messages[0].content, /JSON only/);
    assert.equal(body.messages[0].role, 'system');
    assert.equal(third.ok, true);
  });

  test('an unparseable reply takes the second rung, then reports mode text with kind invalid', async () => {
    const { app, kv } = stubApp();
    const { api } = createAsk(app);
    const farm = fakeFarm(() => 'I would rather not answer that.');
    const r = await withFarm(farm, () => api.json({ task: 't', schema: SCHEMA, prompt: 'p' }));

    assert.equal(farm.posts.length, 2, 'schema rung, then prompt rung');
    assert.equal(farm.posts[0].body.response_format.type, 'json_schema');
    assert.equal(farm.posts[1].body.response_format, undefined);
    assert.equal(r.ok, false);
    assert.equal(r.mode, 'text');
    assert.equal(r.error.kind, 'invalid');
    assert.equal(r.raw, 'I would rather not answer that.', 'the text the model DID say comes back for the panel to show');
    assert.ok(r.error.message.length > 0, 'never a silent empty result');
    assert.equal(kv.get(KV_KEYS.structuredMode(FARM_ID, 'gemma4:12b')), undefined, 'one failure is not a verdict');
  });

  test('a valid-JSON-but-wrong-shape answer is invalid, and says which field', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    const farm = fakeFarm(() => JSON.stringify({ name: 'box' }));
    const r = await withFarm(farm, () => api.json({ task: 't', schema: SCHEMA, prompt: 'p' }));
    assert.equal(r.ok, false);
    assert.equal(r.error.kind, 'invalid');
    assert.match(r.errors.join(' '), /count: required/);
  });

  test('an empty reply is kind empty — and never moves the structured verdict', async () => {
    const { app, kv } = stubApp();
    const { api } = createAsk(app);
    const farm = fakeFarm(() => '');
    const r = await withFarm(farm, () => api.json({ task: 't', schema: SCHEMA, prompt: 'p' }));
    assert.equal(r.ok, false);
    assert.equal(r.error.kind, 'empty');
    assert.equal(r.mode, 'text');
    assert.equal(kv.get(KV_KEYS.structuredMode(FARM_ID, 'gemma4:12b')), undefined);
  });

  test('JSON that arrived only as reasoning is an answer, not a failure (F8)', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    const farm = fakeFarm(() => ({ text: JSON.stringify({ name: 'box', count: 4 }), reasoning: true }));
    const r = await withFarm(farm, () => api.json({ task: 't', schema: SCHEMA, prompt: 'p' }));
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, { name: 'box', count: 4 });
    assert.equal(farm.posts.length, 1);
  });

  test('text() returns the prose and needs no schema', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    const farm = fakeFarm(() => 'a short answer');
    const r = await withFarm(farm, () => api.text({ task: 'blurb', prompt: 'p' }));
    assert.equal(r.ok, true);
    assert.equal(r.mode, 'text');
    assert.equal(r.value, 'a short answer');
    assert.equal(farm.posts[0].body.response_format, undefined);
    assert.ok(farm.posts[0].body.max_tokens >= MIN_MAX_TOKENS);
  });

  // ---- etiquette --------------------------------------------------------------------------------

  test('a busy governor refuses immediately and issues ZERO requests', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    const release = app.gov.acquire('foreground', { holder: 'send' });
    const farm = fakeFarm(() => 'never');
    const r = await withFarm(farm, () => api.json({ task: 't', schema: SCHEMA, prompt: 'p' }));
    assert.equal(r.ok, false);
    assert.equal(r.error.kind, 'busy');
    assert.equal(farm.posts.length, 0);
    release();
  });

  test('the ask holds the foreground as `ask:<task>` and gives it back', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    /** @type {any[]} */ const seen = [];
    app.gov.onChange((s) => seen.push({ ...s }));
    const farm = fakeFarm(() => JSON.stringify({ name: 'a', count: 1 }));
    await withFarm(farm, () => api.json({ task: 'title', schema: SCHEMA, prompt: 'p' }));
    assert.deepEqual(seen[0], { foreground: 'streaming', holder: 'ask:title' });
    assert.deepEqual(app.gov.state(), { foreground: 'idle', holder: null });
  });

  test('a hidden window spends no seat', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    app.state.pageVisible = false;
    const farm = fakeFarm(() => 'never');
    const r = await withFarm(farm, () => api.text({ task: 't', prompt: 'p' }));
    assert.equal(r.error.kind, 'busy');
    assert.equal(farm.posts.length, 0);
    assert.deepEqual(app.gov.state(), { foreground: 'idle', holder: null }, 'and the slot was never taken');
  });

  test('no farm is its own answer, not a network error', async () => {
    const { app } = stubApp({ present: false });
    const { api } = createAsk(app);
    const farm = fakeFarm(() => 'never');
    const r = await withFarm(farm, () => api.text({ task: 't', prompt: 'p' }));
    assert.equal(r.error.kind, 'no_farm');
    assert.equal(farm.posts.length, 0);
  });

  test('background priority takes the background lane: refused with no free seat, allowed with one', async () => {
    const noSeats = stubApp({ seats: { used: 2, slots: 2 } });
    const askA = createAsk(noSeats.app).api;
    const farmA = fakeFarm(() => JSON.stringify({ name: 'a', count: 1 }));
    const refused = await withFarm(farmA, () => askA.json({ task: 'graph', schema: SCHEMA, prompt: 'p', priority: 'background' }));
    assert.equal(refused.error.kind, 'busy');
    assert.equal(farmA.posts.length, 0, 'a full farm gets nothing from a background caller');

    const free = stubApp({ seats: { used: 0, slots: 2 } });
    const askB = createAsk(free.app).api;
    const farmB = fakeFarm(() => JSON.stringify({ name: 'a', count: 1 }));
    /** @type {any[]} */ const seen = [];
    free.app.gov.onChange((s) => seen.push({ ...s }));
    const ok = await withFarm(farmB, () => askB.json({ task: 'graph', schema: SCHEMA, prompt: 'p', priority: 'background' }));
    assert.equal(ok.ok, true);
    assert.deepEqual(seen, [], 'background never makes the foreground look busy to the composer');
  });

  test('the reader always wins: a send aborts a running background ask', async () => {
    const { app } = stubApp({ seats: { used: 0, slots: 2 } });
    const { api } = createAsk(app);
    let release = null;
    const farm = fakeFarm(async () => {
      // The reader presses Send while the background call is on the wire.
      release = app.gov.acquire('foreground', { holder: 'send' });
      return JSON.stringify({ name: 'a', count: 1 });
    });
    const r = await withFarm(farm, () => api.json({ task: 'graph', schema: SCHEMA, prompt: 'p', priority: 'background' }));
    assert.equal(r.ok, false);
    assert.equal(r.error.kind, 'aborted');
    if (release) release();
  });

  test('an AbortSignal cancels the generation and releases the slot', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    const ac = new AbortController();
    const farm = fakeFarm(async () => { ac.abort(); return 'too late'; });
    const r = await withFarm(farm, () => api.text({ task: 't', prompt: 'p', signal: ac.signal }));
    assert.equal(r.ok, false);
    assert.equal(r.error.kind, 'aborted');
    assert.deepEqual(app.gov.state(), { foreground: 'idle', holder: null });
  });

  test('a signal already aborted never reaches the farm', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    const ac = new AbortController();
    ac.abort();
    const farm = fakeFarm(() => 'never');
    const r = await withFarm(farm, () => api.text({ task: 't', prompt: 'p', signal: ac.signal }));
    assert.equal(r.error.kind, 'aborted');
    assert.equal(farm.posts.length, 0);
  });

  // ---- vision ------------------------------------------------------------------------------------

  test('a known-blind model refuses the image locally, with the operator sentence', async () => {
    const { app } = stubApp({ vision: 'no' });
    const { api } = createAsk(app);
    const farm = fakeFarm(() => 'never');
    const r = await withFarm(farm, () => api.text({ task: 't', prompt: 'p', images: ['data:image/png;base64,AAA'] }));
    assert.equal(r.error.kind, 'no_vision');
    assert.match(r.error.message, /vision model/);
    assert.equal(farm.posts.length, 0);
    assert.equal(api.vision('gemma4:12b'), 'no');
  });

  test('images ride as OpenAI content parts when the model can see', async () => {
    const { app } = stubApp({ vision: 'yes' });
    const { api } = createAsk(app);
    const farm = fakeFarm(() => 'I see one image.');
    await withFarm(farm, () => api.text({ task: 't', prompt: 'look', images: ['data:image/png;base64,AAA'] }));
    const parts = farm.posts[0].body.messages[0].content;
    assert.equal(Array.isArray(parts), true);
    assert.deepEqual(parts.map((p) => p.type), ['text', 'image_url']);
    assert.equal(parts[1].image_url.url, 'data:image/png;base64,AAA');
  });

  test('a 400 about images downgrades the capability through the bus', async () => {
    const { app, bus } = stubApp({ vision: 'unknown' });
    const { api } = createAsk(app);
    /** @type {any[]} */ const seen = [];
    bus.on(NO_VISION_EVENT, (p) => seen.push(p));
    const farm = fakeFarm(() => ({ status: 400, json: { error: { message: 'this model does not support image input' } } }));
    const r = await withFarm(farm, () => api.text({ task: 't', prompt: 'p', images: ['data:image/png;base64,AAA'] }));
    assert.equal(r.error.kind, 'no_vision');
    assert.deepEqual(seen.map((s) => s.underlying), ['gemma4:12b']);
  });

  test('any other farm error is reported verbatim, not swallowed', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    const farm = fakeFarm(() => ({ status: 500, json: { error: { message: 'the engine fell over' } } }));
    const r = await withFarm(farm, () => api.text({ task: 't', prompt: 'p' }));
    assert.equal(r.ok, false);
    assert.equal(r.error.kind, 'farm');
    assert.match(r.error.message, /engine fell over/);
  });

  // ---- the cache ----------------------------------------------------------------------------------

  test('an identical ask is answered from the cache, and cache:false is honoured', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    const farm = fakeFarm(() => JSON.stringify({ name: 'box', count: 1 }));
    await withFarm(farm, async () => {
      const a = await api.json({ task: 't', schema: SCHEMA, prompt: 'same' });
      const b = await api.json({ task: 't', schema: SCHEMA, prompt: 'same' });
      assert.equal(farm.posts.length, 1, 'the second one cost nothing');
      assert.equal(b.cached, true);
      assert.deepEqual(b.value, a.value);

      await api.json({ task: 't', schema: SCHEMA, prompt: 'same', cache: false });
      assert.equal(farm.posts.length, 2, 'a Retry always really asks');

      await api.json({ task: 't', schema: SCHEMA, prompt: 'different' });
      assert.equal(farm.posts.length, 3);
    });
  });

  test('a failure is never cached', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    let n = 0;
    const farm = fakeFarm(() => { n++; return 'not json'; });
    await withFarm(farm, async () => {
      await api.json({ task: 't', schema: SCHEMA, prompt: 'p' });
      await api.json({ task: 't', schema: SCHEMA, prompt: 'p' });
    });
    assert.equal(n, 4, 'two asks, two rungs each — nothing was served from the cache');
  });

  // ---- the queue -----------------------------------------------------------------------------------

  test('a batch runs strictly serially and reports progress', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    let inFlight = 0;
    let maxInFlight = 0;
    /** @type {any[]} */ const events = [];
    app.bus.on(QUEUE_EVENT, (p) => events.push(p));

    const farm = fakeFarm(() => JSON.stringify({ name: 'a', count: 1 }));
    const batch = await withFarm(farm, () => {
      const q = api.queue({
        label: 'Naming 4 sketches',
        items: ['a', 'b', 'c', 'd'],
        run: async (item) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try { return await api.json({ task: 'name', schema: SCHEMA, prompt: item }); } finally { inFlight--; }
        },
      });
      return q.promise;
    });

    assert.equal(batch.done, 4);
    assert.equal(batch.cancelled, false);
    assert.equal(maxInFlight, 1, 'never two items in flight');
    assert.equal(farm.stats().maxInFlight, 1, 'and never two requests on the wire');
    assert.equal(farm.posts.length, 4, 'exactly one request per item');
    assert.equal(events[0].phase, 'start');
    assert.equal(events[0].n, 4);
    assert.equal(events[events.length - 1].phase, 'end');
    assert.equal(events[events.length - 1].running, false);
  });

  test('five concurrent BACKGROUND asks put exactly ONE request on the wire', async () => {
    // S0 review, finding 1. The governor's freeSeat() reads the FARM_TICK snapshot, which does not
    // move between two calls in the same frame, so a fan-out of background asks all saw the same
    // spare seat and all went out — five generations from one client on a two-seat farm.
    const { app } = stubApp({ seats: { used: 0, slots: 2, clients: 1, idleSec: 900 } });
    app.gov = createGovernor(app);
    const { api } = createAsk(app);
    const farm = fakeFarm(async () => {
      await new Promise((r) => setTimeout(r, 5));      // hold the wire long enough to overlap
      return JSON.stringify({ name: 'a', count: 1 });
    });
    const out = await withFarm(farm, () => Promise.all([1, 2, 3, 4, 5].map((i) => api.json({
      task: `graph${i}`, schema: SCHEMA, prompt: `p${i}`, priority: 'background', cache: false,
    }))));
    assert.equal(farm.stats().maxInFlight, 1, 'the background lane is a single file');
    assert.equal(out.filter((r) => r.ok).length, 1, 'exactly one of the five got through');
    const refused = out.filter((r) => !r.ok);
    assert.equal(refused.length, 4);
    for (const r of refused) assert.equal(r.error.kind, 'busy', 'and the other four are told so, never silent');
  });

  test('a second batch is refused while one runs', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    let resolveFirst = () => {};
    const gate = new Promise((r) => { resolveFirst = r; });
    const first = api.queue({ label: 'one', items: [1], run: () => gate });
    const second = api.queue({ label: 'two', items: [1], run: async () => 'nope' });
    const secondOut = await second.promise;
    assert.equal(secondOut.refused, true);
    assert.equal(secondOut.done, 0);
    resolveFirst('ok');
    await first.promise;
    assert.equal(api.queue({ label: 'three', items: [1], run: async () => 'ok' }).state().running, true, 'and the lane frees up again');
  });

  test('cancel stops the batch after the in-flight item, and says so', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    /** @type {any[]} */ const ran = [];
    /** @type {any} */ let handle = null;
    handle = api.queue({
      label: 'four',
      items: [1, 2, 3, 4],
      run: async (item) => { ran.push(item); if (item === 2) handle.cancel(); return { ok: true }; },
    });
    const out = await handle.promise;
    assert.deepEqual(ran, [1, 2], 'the third never started');
    assert.equal(out.cancelled, true);
    assert.equal(handle.state().running, false);
  });

  test('pref:queueMax caps the batch, and SAYS how many it dropped', async () => {
    const { app, kv } = stubApp();
    kv.set(KV_KEYS.prefQueueMax, 2);
    const { api } = createAsk(app);
    /** @type {any[]} */ const ran = [];
    const handle = api.queue({ label: 'six', items: [1, 2, 3, 4, 5, 6], run: async (i) => { ran.push(i); return { ok: true }; } });
    const out = await handle.promise;
    assert.deepEqual(ran, [1, 2]);
    assert.equal(out.done, 2);
    // S0 review, finding 6: `done: 2` alone cannot be told apart from a batch of two that finished.
    assert.equal(out.truncated, 4, 'four items never ran, and the caller is told');
    assert.equal(handle.state().truncated, 4, 'the chip can read it too');
  });

  test("a caller's own max beats pref:queueMax (C2 kickoff, plan BH-5)", async () => {
    // The Computer's cap is `pref:computeMaxItems`, not the reader's queue chip ceiling: a
    // fan-out of 40 that the person asked for must not be silently cut to four.
    const { app, kv } = stubApp();
    kv.set(KV_KEYS.prefQueueMax, 2);
    const { api } = createAsk(app);
    /** @type {any[]} */ const ran = [];
    const handle = api.queue({ label: 'six', max: 6, items: [1, 2, 3, 4, 5, 6], run: async (i) => { ran.push(i); return { ok: true }; } });
    const out = await handle.promise;
    assert.deepEqual(ran, [1, 2, 3, 4, 5, 6], 'all six ran');
    assert.equal(out.truncated, 0);
  });

  test('an explicit max still caps, and still says how many it dropped', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    /** @type {any[]} */ const ran = [];
    const out = await api.queue({ label: 'three', max: 3, items: [1, 2, 3, 4, 5], run: async (i) => { ran.push(i); return { ok: true }; } }).promise;
    assert.deepEqual(ran, [1, 2, 3]);
    assert.equal(out.truncated, 2, 'a cap the caller set is still a cap the caller is told about');
  });

  test('cacheSalt makes the SAME prompt a second real generation (C2 kickoff, plan BH-5)', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    const farm = fakeFarm(() => 'an answer');
    await withFarm(farm, async () => {
      const a = await api.text({ task: 't', prompt: 'same' });
      const b = await api.text({ task: 't', prompt: 'same' });
      assert.equal(farm.posts.length, 1, 'the second identical ask is served from the cache');
      assert.equal(b.value, a.value);
      const c = await api.text({ task: 't', prompt: 'same', cacheSalt: 1 });
      assert.equal(farm.posts.length, 2, 'a salted ask really goes to the farm');
      assert.equal(c.ok, true);
      await api.text({ task: 't', prompt: 'same', cacheSalt: 1 });
      assert.equal(farm.posts.length, 2, 'and the salted answer is itself cached');
    });
  });

  test('a batch inside the cap reports truncated: 0', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    const out = await api.queue({ label: 'two', items: [1, 2], run: async () => ({ ok: true }) }).promise;
    assert.equal(out.truncated, 0);
  });

  test("a finished batch's handle cannot cancel the NEXT batch", async () => {
    // S0 review, finding 4: both methods closed over module-level state with no batch identity, so
    // a stale handle aborted the run the reader had just started and reported its progress as its
    // own. The Computer panel holds one handle per graph run; this is exactly that shape.
    const { app } = stubApp();
    const { api } = createAsk(app);
    const first = api.queue({ label: 'A', items: [1, 2], run: async () => ({ ok: true }) });
    const firstOut = await first.promise;
    assert.equal(firstOut.done, 2);

    /** @type {any[]} */ const ran = [];
    let release = () => {};
    const gate = new Promise((r) => { release = r; });
    const second = api.queue({
      label: 'B',
      items: [1, 2],
      run: async (item) => { ran.push(item); if (item === 1) await gate; return { ok: true }; },
    });
    first.cancel();                                   // the stale handle
    release();
    const secondOut = await second.promise;
    assert.equal(secondOut.cancelled, false, "batch A's cancel() must not touch batch B");
    assert.deepEqual(ran, [1, 2], 'B ran to the end');
    // And a stale state() answers with A's frozen final state, never B's progress.
    assert.equal(first.state().label, 'A');
    assert.equal(first.state().running, false);
    assert.equal(second.state().label, 'B');
  });

  test('an item the governor refused waits for a FARM_TICK, then gives up saying the farm is busy', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    let attempts = 0;
    const busy = { ok: false, error: { kind: 'busy', message: 'busy' } };
    const handle = api.queue({
      label: 'retry',
      items: [1],
      run: async () => { attempts++; return attempts < 3 ? busy : { ok: true }; },
    });
    // The farm snapshot is the only clock (§3.9): nothing moves until a tick arrives.
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 0));
      app.bus.emit(EV.FARM_TICK, { caps: null, now: i });
    }
    const out = await handle.promise;
    assert.equal(attempts, 3);
    assert.equal(out.done, 1);
    assert.equal(out.stalled, false, 'it succeeded before the retry budget ran out');
    assert.equal(out.results[0].ok, true);
  });

  test('state() is the QueueState the chip renders, and is idle between batches', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    const idle = api.queue({ label: '', items: [], run: async () => ({}) });
    assert.deepEqual(Object.keys(idle.state()).sort(), ['cancelled', 'i', 'label', 'n', 'running', 'truncated']);
    await idle.promise;
    assert.equal(idle.state().running, false);
  });

  // ---- the debug door -------------------------------------------------------------------------------

  test('the debug log records one entry per completed ask, oldest first', async () => {
    const { app } = stubApp();
    const { api, debug } = createAsk(app);
    const farm = fakeFarm((body, n) => (n === 0 ? JSON.stringify({ name: 'a', count: 1 }) : 'not json'));
    await withFarm(farm, async () => {
      await api.json({ task: 'first', schema: SCHEMA, prompt: 'a' });
      await api.text({ task: 'second', prompt: 'b' });
    });
    const log = debug.log();
    assert.equal(log.length, 2);
    assert.deepEqual(log.map((e) => e.task), ['first', 'second']);
    assert.deepEqual(log.map((e) => e.ok), [true, true]);
    assert.deepEqual(Object.keys(log[0]).sort(), ['mode', 'model', 'ms', 'ok', 'task']);
    assert.equal(log[0].model, 'gemma4:12b');
    assert.equal(debug.stats().calls, 2);
  });

  test('mode() is synchronous: unknown on the first call, the stored verdict once it has landed', async () => {
    const { app, kv } = stubApp();
    kv.set(KV_KEYS.structuredMode(FARM_ID, 'gemma4:12b'), 'prompt');
    const { api } = createAsk(app);
    assert.equal(api.mode('gemma4:12b'), 'unknown', 'the store has not answered yet, and it says so');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(api.mode('gemma4:12b'), 'prompt');
    assert.equal(api.mode(''), 'unknown', 'no model, no verdict');
  });


  // ---- app/caps.mjs: the capability probe (studio plan §3.4.3) ---------------------------------
  // It lives in this file because it is the other half of the same contract: `ask.vision()` answers
  // from what caps learned, and S0-U2 owns both.

  test('readModelGroupInfo keeps only explicit verdicts', () => {
    const rows = readModelGroupInfo({
      data: [
        { model_group: 'gemma4:12b', supports_vision: true },
        { model_group: 'assistant', supports_vision: false },
        { model_group: 'mystery' },
        { supports_vision: true },
        null,
      ],
    });
    assert.deepEqual(rows, [
      { underlying: 'gemma4:12b', vision: 'yes' },
      { underlying: 'assistant', vision: 'no' },
    ]);
    assert.deepEqual(readModelGroupInfo(null), [], 'a body that is not a catalogue is not a verdict');
    assert.deepEqual(readModelGroupInfo({ data: 'nope' }), []);
  });

  test('the probe is ONE GET, is cached per farm signature, and never POSTs', async () => {
    const { app } = stubApp();
    /** @type {any[]} */ const gets = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      gets.push({ url, method: (init && init.method) || 'GET' });
      return new Response(JSON.stringify({ data: [{ model_group: 'gemma4:12b', supports_vision: false }] }), { status: 200 });
    };
    try {
      const caps = createCaps(app);
      assert.equal(await caps.probe(), true);
      assert.equal(await caps.probe(), false, 'the same farm is not asked twice');
      assert.equal(gets.length, 1);
      assert.equal(gets[0].url, 'http://10.0.0.5:4000/model_group/info');
      assert.equal(gets[0].method, 'GET');
      assert.equal(caps.resolver('gemma4:12b', 'vision'), 'no');
      assert.equal(caps.resolver('gemma4:12b', 'tools'), 'unknown', 'it answers about vision and nothing else');
      assert.equal(caps.resolver('other', 'vision'), 'unknown');
    } finally { globalThis.fetch = real; }
  });

  test('a verdict is written to kv and read back on the next window', async () => {
    const first = stubApp();
    const real = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ model_group: 'gemma4:12b', supports_vision: true }] }), { status: 200 });
    try {
      await createCaps(first.app).probe();
      assert.equal(first.kv.get(KV_KEYS.vision(FARM_ID, 'gemma4:12b')), 'yes');
    } finally { globalThis.fetch = real; }

    // A fresh window with the same store: what we knew survives, with no network at all.
    const second = stubApp();
    second.kv.set(KV_KEYS.vision(FARM_ID, 'gemma4:12b'), 'yes');
    const caps2 = createCaps(second.app);
    await caps2.primeFromStore();
    assert.equal(caps2.resolver('gemma4:12b', 'vision'), 'yes');
    assert.equal(caps2.debug.probes(), 0);
  });

  test('a probe that fails leaves the verdict UNKNOWN, never no', async () => {
    const { app } = stubApp();
    const real = globalThis.fetch;
    globalThis.fetch = async () => { throw new TypeError('connection refused'); };
    try {
      const caps = createCaps(app);
      assert.equal(await caps.probe(), false);
      assert.equal(caps.resolver('gemma4:12b', 'vision'), 'unknown');
      assert.equal(await caps.probe(), false, 'and it will try again on the next farm change');
    } finally { globalThis.fetch = real; }
  });

  test('a non-2xx catalogue is not a verdict either', async () => {
    const { app } = stubApp();
    const real = globalThis.fetch;
    globalThis.fetch = async () => new Response('nope', { status: 404 });
    try {
      const caps = createCaps(app);
      assert.equal(await caps.probe(), false);
      assert.equal(caps.resolver('gemma4:12b', 'vision'), 'unknown');
    } finally { globalThis.fetch = real; }
  });

  test('install wires the resolver, probes on a real farm change, and ignores a seat-count tick', async () => {
    const { app, bus, caps } = stubApp();
    let resolver = null;
    let gets = 0;
    app.farm.setCapResolver = (fn) => { resolver = fn; };
    const real = globalThis.fetch;
    globalThis.fetch = async () => {
      gets++;
      return new Response(JSON.stringify({ data: [{ model_group: 'gemma4:12b', supports_vision: false }] }), { status: 200 });
    };
    try {
      installCaps(app);
      assert.equal(typeof resolver, 'function');
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(gets, 1, 'the farm was already present at install');

      bus.emit(EV.FARM_CHANGE, { caps, prev: caps, changed: ['seats', 'gpuUtil'] });
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(gets, 1, 'seats move every few seconds; capabilities do not');

      assert.equal(resolver('gemma4:12b', 'vision'), 'no');
    } finally { globalThis.fetch = real; }
  });

  test('a 400 about images downgrades the cached verdict through the bus', async () => {
    const { app, bus, kv } = stubApp();
    app.farm.setCapResolver = () => {};
    const real = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ model_group: 'gemma4:12b', supports_vision: true }] }), { status: 200 });
    try {
      const caps = installCaps(app);
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(caps.resolver('gemma4:12b', 'vision'), 'yes');
      bus.emit(NO_VISION_EVENT, { underlying: 'gemma4:12b' });
      assert.equal(caps.resolver('gemma4:12b', 'vision'), 'no', 'the engine itself outranks the catalogue');
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(kv.get(KV_KEYS.vision(FARM_ID, 'gemma4:12b')), 'no');
    } finally { globalThis.fetch = real; }
  });

  test('a verdict this window just wrote is readable immediately', async () => {
    const { app } = stubApp();
    const { api } = createAsk(app);
    const farm = fakeFarm(() => JSON.stringify({ name: 'a', count: 1 }));
    await withFarm(farm, () => api.json({ task: 't', schema: SCHEMA, prompt: 'p' }));
    assert.equal(api.mode('gemma4:12b'), 'schema');
  });
};
