// assets/agent-page/lol-agent.mjs — the loop project pages use (IDE_PLAN §5 option A): the farm from /lol-farm.json,
// one of the page's tools per step, a malformed or wrong step fed back, the last step made to answer, the farm's own
// failures as sentences. A fake fetch plays LlmOnLan's server and the farm.
import assert from 'node:assert/strict';

/** @param {Array<string|{status: number}>} replies the model's replies in order @param {{requiresKey?: boolean, defaultModel?: string}} [o] */
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
    if (next && typeof next === 'object') return new Response('{}', { status: next.status });
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

  test('lol-agent: the farm\'s own failures end the run with a sentence — busy, a password', async () => {
    const busy = fakeFarm([{ status: 429 }]);
    try {
      const { runAgent } = await fresh();
      await assert.rejects(runAgent({ task: 't' }), /The farm is busy/);
    } finally { busy.restore(); }
    const keyed = fakeFarm([{ status: 401 }], { requiresKey: true });
    try {
      const { ask } = await fresh();
      await assert.rejects(ask({ messages: [] }), /needs its password: ask the person/);
    } finally { keyed.restore(); }
  });
};
