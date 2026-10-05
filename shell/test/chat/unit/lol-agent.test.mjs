// assets/agent-page/lol-agent.mjs — the loop project pages use (IDE_PLAN §5 option A): the farm from /lol-farm.json,
// one of the page's tools per step, a malformed or wrong step fed back, the last step made to answer, the farm's own
// failures as sentences, a full farm waited out (Retry-After, bounded, abortable). A fake fetch plays LlmOnLan's server
// and the farm.
import assert from 'node:assert/strict';

/** @param {Array<string|{status: number, retryAfter?: string, body?: string, headers?: Record<string, string>}>} replies the model's replies in order @param {{requiresKey?: boolean, defaultModel?: string}} [o] */
function fakeFarm(replies, o = {}) {
  /** @type {any[]} */ const bodies = [];
  let listed = 0;
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    if (url === '/lol-farm.json') return new Response(JSON.stringify({ baseUrl: 'http://farm:4000/v1', requiresKey: !!o.requiresKey, ...(o.defaultModel ? { defaultModel: o.defaultModel } : {}) }));
    if (url.endsWith('/models')) { listed++; return new Response(JSON.stringify({ data: [{ id: 'qwen3.8:latest' }, { id: 'assistant' }] })); }
    const body = JSON.parse(init.body);
    bodies.push(body);
    const next = replies.shift();
    if (next && typeof next === 'object') return new Response(next.body || '{}', { status: next.status, headers: { ...next.headers, ...(next.retryAfter ? { 'retry-after': next.retryAfter } : {}) } });
    return new Response(JSON.stringify({ choices: [{ message: { content: next } }] }));
  });
  return { bodies, listed: () => listed, restore: () => { globalThis.fetch = real; } };
}
const fresh = async () => import(`../../../assets/agent-page/lol-agent.mjs?${Math.random()}`);   // a new farm cache each time

export default (test) => {
  test('lol-agent: one tool per step, its result fed to the next step, then the answer', async () => {
    const f = fakeFarm(['{"tool":"add","args":{"a":2,"b":3},"why":"sum them"}', '{"answer":"The sum is 5."}']);
    try {
      const { runAgent } = await fresh();
      /** @type {any[]} */ const seen = [];
      const r = await runAgent({ task: 'Add 2 and 3.', tools: { add: { description: 'adds two numbers', args: { a: 'number', b: 'number' }, run: (a) => a.a + a.b } }, onStep: (s) => seen.push(s) });
      assert.equal(r.answer, 'The sum is 5.');
      assert.deepEqual(r.steps.map((s) => [s.tool, s.ok, s.result]), [['add', true, 5]]);
      assert.equal(f.bodies[0].model, 'qwen3.8:latest', 'a /lol-farm.json without a default (an older LlmOnLan): the farm\'s first model');
      assert.deepEqual(f.bodies[0].response_format, { type: 'json_object' });
      assert.match(f.bodies[0].messages[1].content, /- add: adds two numbers Args: \{"a":"number","b":"number"\}/);
      assert.match(f.bodies[1].messages[1].content, /1\. add \{"a":2,"b":3\} — sum them\n {3}result: 5/, 'the result reaches the next step');
      assert.deepEqual(seen.map((s) => s.tool), ['add', 'answer']);
    } finally { f.restore(); }
  });

  test('lol-agent: the farm\'s default model (from /lol-farm.json) unless the page names one — no catalogue fetch', async () => {
    const f = fakeFarm(['{"answer":"a"}', 'b'], { defaultModel: 'assistant' });
    try {
      const { runAgent, ask } = await fresh();
      await runAgent({ task: 't' });
      assert.equal(f.bodies[0].model, 'assistant', 'the farm\'s default, not the first id it lists');
      await ask({ messages: [], model: 'qwen3.8:latest' });
      assert.equal(f.bodies[1].model, 'qwen3.8:latest', 'a model the page names wins');
      assert.equal(f.listed(), 0);
    } finally { f.restore(); }
  });

  test('lol-agent: a malformed reply, an unknown tool and a throwing tool are fed back; the last step must answer', async () => {
    const f = fakeFarm(['not json', '{"tool":"nope"}', '{"tool":"boom","args":{}}', '{"tool":"boom","args":{}}']);
    try {
      const { runAgent } = await fresh();
      const r = await runAgent({ task: 't', maxSteps: 4, tools: { boom: { description: 'fails', run: () => { throw new Error('it broke'); } } } });
      assert.equal(r.stopped, 'max-steps');
      assert.equal(r.answer, '');
      assert.deepEqual(r.steps.map((s) => s.error.split(':')[0].split(' —')[0]), ['the reply was not the JSON object asked for', 'there is no tool "nope"', 'it broke', 'it broke']);
      assert.match(f.bodies[3].messages[1].content, /Step 4 of 4, the LAST/, 'the last step is told to answer');
    } finally { f.restore(); }
  });

  test('lol-agent: the farm\'s own failures end the run with a sentence — full (a page that shows no wait), a password', async () => {
    const busy = fakeFarm([{ status: 429 }, { status: 429, retryAfter: '40' }]);
    try {
      const { runAgent } = await fresh();
      await assert.rejects(runAgent({ task: 't', waitFor: 0 }), /^Error: The farm is full \(every seat is taken\): try again in a few minutes\.$/, 'no Retry-After to read: no estimate invented');
      // A page written before onWait (the old skill) shows nothing while waiting: it fails at once, with the farm's
      // estimate — even when that estimate (40 s) is well inside the 5 min a page that shows the wait would sit out.
      const t0 = Date.now();
      await assert.rejects(runAgent({ task: 't' }), /^Error: The farm is full \(every seat is taken\): the next seat frees in about 40 s\.$/);
      assert.ok(Date.now() - t0 < 500, 'no silent wait');
      assert.equal(busy.bodies.length, 2, 'one ask each');
    } finally { busy.restore(); }
    // The seat gate's own 401 (farm/src/seats.js): readable in a page since the gate sends CORS headers.
    const gate401 = { status: 401, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Retry-After' },
      body: JSON.stringify({ error: { message: 'Wrong or missing farm password. Send it as the API key (Authorization: Bearer <password>).', type: 'invalid_request_error', code: 'invalid_api_key' } }) };
    // LiteLLM refuses a wrong key with a 400 that names it; its context overflow is a 400 too, and is not the password.
    const lite400 = { status: 400, body: JSON.stringify({ error: { message: 'Authentication Error, Invalid proxy server token passed. Received Key=sk-...rong' } }) };
    const overflow = { status: 400, body: JSON.stringify({ error: { message: 'litellm.ContextWindowExceededError: maximum context length is 8192 tokens' } }) };
    // The gate's own 502 (readable since its CORS headers) says what is wrong; a bare 503 gets a sentence, not a code.
    const gate502 = { status: 502, headers: gate401.headers, body: JSON.stringify({ error: { message: 'The model server is not answering (it may be restarting) — try again in a few seconds.', code: 'lol_upstream_down' } }) };
    const bare503 = { status: 503, body: 'Service Unavailable' };
    const keyed = fakeFarm([gate401, lite400, overflow, gate502, bare503], { requiresKey: true });
    const kept = new Map();
    globalThis.sessionStorage = /** @type {any} */ ({ getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => kept.set(k, v) });
    try {
      const { ask, setKey } = await fresh();
      await assert.rejects(ask({ messages: [] }), /^Error: The farm needs its password: ask the person for it and call setKey\(password\)\.$/);
      assert.equal(keyed.bodies.length, 0, 'no password yet: said before asking, since an older farm\'s 401 is unreadable in a page');
      setKey('wrong');
      await assert.rejects(ask({ messages: [] }), /^Error: The farm did not accept the password: ask the person for it again and call setKey\(password\)\.$/, 'the gate\'s 401');
      await assert.rejects(ask({ messages: [] }), /did not accept the password/, 'LiteLLM\'s 400 that names the key');
      await assert.rejects(ask({ messages: [] }), /^Error: The farm answered 400\.$/, 'a 400 about the context is not the password');
      await assert.rejects(ask({ messages: [] }), /^Error: The model server is not answering \(it may be restarting\)/, 'the gate\'s 502 sentence');
      await assert.rejects(ask({ messages: [] }), /^Error: The farm's model server is not answering \(it may be restarting\): try again in a few minutes\.$/, 'a bare 503');
      assert.equal(keyed.bodies.length, 5);
    } finally { keyed.restore(); }
    // An older farm (farm-v0.0.41 and before): the gate's 401 had no CORS header, so the page saw only "Failed to fetch".
    const old = fakeFarm([], { requiresKey: true });
    const fake = globalThis.fetch;
    globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
      if (url.endsWith('/chat/completions')) throw new TypeError('Failed to fetch');
      return fake(url, init);
    });
    try {
      const { ask } = await fresh();
      await assert.rejects(ask({ messages: [] }), /^Error: The farm did not answer, or did not accept the password: ask the person for it again and call setKey\(password\)\. It may also be off the network, restarting, or full\.$/,
        'the password is named, so the page shows its password field');
    } finally { old.restore(); delete globalThis.sessionStorage; }
  });

  test('lol-agent: "Failed to fetch" becomes a sentence — the browser hides whether the farm is down or refused without CORS', async () => {
    const f = fakeFarm([]);
    const fake = globalThis.fetch;
    globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
      if (url.endsWith('/chat/completions')) throw new TypeError('Failed to fetch');
      return fake(url, init);
    });
    try {
      const { ask } = await fresh();
      await assert.rejects(ask({ messages: [] }), /^Error: The farm did not answer \(it may be off the network, restarting, or full\): try again in a few minutes\.$/);
      const ctl = new AbortController();
      ctl.abort();
      globalThis.fetch = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
        if (url.endsWith('/chat/completions')) throw new DOMException('This operation was aborted', 'AbortError');
        return fake(url, init);
      });
      await assert.rejects(ask({ messages: [], signal: ctl.signal }), { name: 'AbortError' }, 'Stop stays a Stop');
    } finally { f.restore(); }
  });

  test('lol-agent: a full farm is waited out — Retry-After honoured, the page told the farm\'s estimate, then the step goes on', async () => {
    const f = fakeFarm([{ status: 429, retryAfter: '1' }, '{"answer":"done"}']);
    try {
      const { runAgent } = await fresh();
      /** @type {any[]} */ const waits = [];
      const t0 = Date.now();
      const r = await runAgent({ task: 't', onWait: (w) => waits.push(w) });
      assert.equal(r.answer, 'done');
      assert.deepEqual(waits, [{ seconds: 1, waited: 0, message: 'The farm is full: a seat frees in about 1 s; checking again in 1 s.' }]);
      assert.ok(Date.now() - t0 >= 950, 'it really waited the second the farm asked for');
      assert.equal(f.bodies.length, 2, 'one refused ask, one answered');
    } finally { f.restore(); }
  });

  test('lol-agent: the wait is bounded — a minute at most at a time, waitFor in all, the farm\'s estimate past it, and Stop ends it', async () => {
    const two = fakeFarm([{ status: 429, retryAfter: '120' }]);
    try {
      const { ask } = await fresh();
      const ctl = new AbortController();
      /** @type {any[]} */ const waits = [];
      const t0 = Date.now();
      await assert.rejects(ask({ messages: [], signal: ctl.signal, onWait: (w) => { waits.push(w); ctl.abort(); } }), /^Error: stopped$/);
      assert.deepEqual(waits, [{ seconds: 60, waited: 0, message: 'The farm is full: a seat frees in about 2 min; checking again in 60 s.' }], 'checked a minute apart, the estimate said');
      assert.ok(Date.now() - t0 < 500, 'Stop ends the wait at once');
    } finally { two.restore(); }
    // Every seat generating: the farm sends its idle window (15 min), past the 5 a page waits: said at once, not slept on.
    const long = fakeFarm([{ status: 429, retryAfter: '900' }]);
    try {
      const { ask } = await fresh();
      /** @type {any[]} */ const waits = [];
      await assert.rejects(ask({ messages: [], onWait: (w) => waits.push(w) }), /^Error: The farm is full \(every seat is taken\): the next seat frees in about 15 min\.$/);
      assert.deepEqual(waits, []);
      assert.equal(long.bodies.length, 1);
    } finally { long.restore(); }
    const full = fakeFarm([{ status: 429, retryAfter: '1' }, { status: 429, retryAfter: '1' }, '{"answer":"never"}']);
    try {
      const { ask } = await fresh();
      await assert.rejects(ask({ messages: [], waitFor: 1 }), /^Error: The farm stayed full for 1 s \(every seat is taken\): the next seat frees in about 1 s\.$/);
      assert.equal(full.bodies.length, 2, 'gave up instead of asking a third time');
    } finally { full.restore(); }
  });
};
