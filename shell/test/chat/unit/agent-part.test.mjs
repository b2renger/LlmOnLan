// @ts-check
// P4, the Agent box: which hosts it may read, the step schema it asks for, what the model reads each step,
// and the loop itself against a SCRIPTED farm — run code over the inputs, fetch only an allowed host, Laya
// over an earlier list, the last step forced to answer, a failed tool fed back instead of thrown, and the
// run plan quoting "up to N generations".
import assert from 'node:assert/strict';
import { hostsOf, allowedUrl, toolsFor, stepSchema, promptFor, reportOf, preview, agentPart, MAX_STEPS } from '../../../renderer/chat/graph/parts/agent.mjs';
import { runPlan } from '../../../renderer/chat/graph/topo.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';

/** A sandbox that runs the code as a function of `inputs`, as the real guest does. */
const sandbox = async () => ({
  compute: async (/** @type {any} */ o) => {
    try { return { ok: true, json: JSON.stringify(new Function('inputs', o.code)(o.inputs)) }; } catch (e) { return { ok: false, error: { message: String((/** @type {any} */ (e)).message) } }; }
  },
});

/** A farm that answers the scripted steps in order, recording every call. @param {any[]} script */
function farm(script) {
  /** @type {any[]} */ const calls = [];
  return {
    calls,
    ask: { json: async (/** @type {any} */ call) => { calls.push(call); const v = script[Math.min(calls.length - 1, script.length - 1)]; return v && v.fail ? v.fail : { ok: true, value: v }; } },
  };
}

/** Run the Agent box. @param {any} settings @param {any} f @param {any} [extra] */
async function runAgent(settings, f, extra = {}) {
  const part = { id: 'a1', type: 'agent', settings: { ...agentPart.defaults(), ...settings } };
  return agentPart.run(/** @type {any} */ ({
    part,
    inputs: { in: [valueOf('json', [12, 7, 30, 5, 18, 22, 9])] },
    labels: { in: ['readings'] },
    app: extra.app || { farm: { get: () => extra.caps || { models: [] } } },
    ask: f.ask,
    sandbox,
    signal: new AbortController().signal,
  }));
}

export default (test) => {
  test('agent: the hosts a person listed, exactly — nothing else can be fetched', () => {
    assert.deepEqual(hostsOf('tabular-api.data.gouv.fr, https://www.data.gouv.fr/datasets/x  localhost  not a host  example.org:8080'),
      ['tabular-api.data.gouv.fr', 'www.data.gouv.fr', 'example.org:8080']);
    assert.deepEqual(hostsOf(''), []);
    const hosts = ['tabular-api.data.gouv.fr'];
    assert.equal(allowedUrl('https://tabular-api.data.gouv.fr/api/resources/x/data/', hosts), true);
    assert.equal(allowedUrl('https://evil.tabular-api.data.gouv.fr/x', hosts), false, 'a subdomain is another host');
    assert.equal(allowedUrl('https://tabular-api.data.gouv.fr.evil.example/x', hosts), false);
    assert.equal(allowedUrl('https://user:pw@tabular-api.data.gouv.fr/x', hosts), false, 'no credentials');
    assert.equal(allowedUrl('file:///etc/passwd', hosts), false);
    assert.equal(allowedUrl('not a url', hosts), false);
  });

  test('agent: the tools on offer and the step schema — every field required, only the tools\' own', () => {
    assert.deepEqual(toolsFor({ hosts: [], laya: false }), ['run_code', 'answer']);
    assert.deepEqual(toolsFor({ hosts: ['a.b'], laya: true }), ['run_code', 'fetch', 'laya', 'answer']);
    const s = stepSchema(['run_code', 'answer']);
    assert.deepEqual(s.required, ['tool', 'why', 'code', 'answer']);
    assert.equal(s.additionalProperties, false);
    assert.deepEqual(stepSchema(['answer']).properties.tool.enum, ['answer'], 'the last step can only answer');
    assert.deepEqual(stepSchema(['run_code', 'fetch', 'laya', 'answer']).required, ['tool', 'why', 'code', 'url', 'question', 'options', 'from', 'answer']);
  });

  test('agent: what the model reads — the task, a look at each input, the tools, every result, what now', () => {
    const { system, prompt } = promptFor({
      task: 'Find the average.', inputs: { readings: [1, 2, 3] }, hosts: [], k: 2, max: 3, tools: ['run_code', 'answer'],
      steps: [{ tool: 'run_code', why: 'sum them', code: 'return 6', result: { ok: true, value: 6 } }],
    });
    assert.match(system, /ONE tool/);
    assert.match(prompt, /## Task\nFind the average\./);
    assert.match(prompt, /inputs\["readings"\] \(an array of 3\): \[1,2,3\]/);
    // A Text box's "[1, 2, 3]" is a string, and the prompt says so (a bare one read as an array on the rig).
    assert.match(promptFor({ task: 'x', inputs: { readings: '[1, 2, 3]' }, hosts: [], k: 1, max: 3, tools: ['answer'], steps: [] }).prompt,
      /inputs\["readings"\] \(a string\): \[1, 2, 3\]/);
    assert.match(prompt, /- run_code: run JavaScript/);
    assert.match(prompt, /1\. run_code — sum them\n {3}code: return 6\n {3}result \(results\[0\]\): 6/);
    assert.match(prompt, /step 2 of at most 3/);
    assert.match(promptFor({ task: 'x', inputs: {}, hosts: [], k: 3, max: 3, tools: ['answer'], steps: [] }).prompt, /the LAST: use answer now/);
    assert.equal(preview('x'.repeat(2000), 10), 'xxxxxxxxxx… (1990 more characters)');
  });

  test('agent: code over the inputs, then an answer — with every step shown under it', async () => {
    const f = farm([
      { tool: 'run_code', why: 'average and max', code: 'const r = inputs.readings; return { avg: r.reduce((a, b) => a + b, 0) / r.length, max: Math.max(...r) };', answer: '' },
      { tool: 'answer', why: 'done', code: '', answer: 'The average is 14.71 and the largest is 30.' },
    ]);
    const out = await runAgent({ task: 'Average and largest?' }, f);
    assert.equal(out.kind, 'text');
    assert.match(out.data, /^The average is 14\.71 and the largest is 30\.\n\n---\n\*\*How it got there\*\* — 1 step \(/);
    assert.match(out.data, /1\. \*\*run_code\*\* — average and max\n {3}→ \{"avg":14\.714285714285714,"max":30\}/);
    assert.equal(f.calls.length, 2, 'two generations');
    assert.match(f.calls[1].prompt, /result \(results\[0\]\): \{"avg":14\.714285714285714,"max":30\}/, 'the model saw the computed numbers');
    assert.equal(f.calls[0].task, 'graph:agent');
    assert.deepEqual(f.calls[0].schema.properties.tool.enum, ['run_code', 'answer'], 'no hosts, no Laya: no fetch, no laya');
  });

  test('agent: a failed tool is fed back (the model can fix it); an unlisted host is refused; the last step must answer', async () => {
    const f = farm([
      { tool: 'run_code', why: 'try', code: 'return inputs.nope.length;', url: '', answer: '' },
      { tool: 'fetch', why: 'look it up', code: '', url: 'https://example.org/data.json', answer: '' },
      { tool: 'run_code', why: 'again', code: 'return 1;', url: '', answer: 'too early' },
    ]);
    const out = await runAgent({ task: 'x', maxSteps: 3, hosts: 'tabular-api.data.gouv.fr' }, f);
    assert.match(f.calls[1].prompt, /ERROR: .*undefined/, 'the code error, fed back');
    assert.match(f.calls[2].prompt, /ERROR: not an allowed host; you may only fetch from: tabular-api\.data\.gouv\.fr/);
    assert.deepEqual(f.calls[2].schema.properties.tool.enum, ['answer'], 'step 3 of 3: answer only');
    assert.match(out.data, /^too early/, 'on the last step its answer is taken');
    const never = farm([{ tool: 'run_code', why: 'loop', code: 'return 1;', answer: '' }]);
    await assert.rejects(runAgent({ task: 'x', maxSteps: 2 }, never), /No answer after 2 steps \(run_code → run_code\)/);
    // JSON mode lands ~90% per call: a step that is not the JSON asked for is fed back, never fatal.
    const sloppy = farm([
      { fail: { ok: false, error: { kind: 'invalid', message: 'bad' }, raw: 'Sure! Here is my plan' } },
      { tool: 'answer', why: 'ok', code: '', answer: 'Fine.' },
    ]);
    assert.match((await runAgent({ task: 'x' }, sloppy)).data, /^Fine\./);
    assert.match(sloppy.calls[1].prompt, /1\. invalid — \n {3}ERROR: your answer was not the JSON object asked for \(it began: Sure! Here is my plan\)/);
  });

  test('agent: fetch reads an allowed host through the io door; Laya classifies a list an earlier step made', async () => {
    /** @type {string[]} */ const got = [];
    const saved = globalThis.window;
    const savedFetch = globalThis.fetch;
    /** @type {any[]} */ const opts = [];
    /** @type {any} */ (globalThis).window = { lol: { io: { get: async (/** @type {string} */ url, /** @type {any} */ o) => { got.push(url); opts.push(o); return { ok: true, url, status: 200, contentType: 'application/json', text: '{"data":[{"t":"a"},{"t":"b"}]}', bytes: 30 }; } } } };
    /** @type {any} */ (globalThis).fetch = async () => ({ ok: true, status: 200, json: async () => ({ answers: [{ choice: 'music', confidence: 0.9 }, { choice: 'books', confidence: 0.4 }] }), text: async () => '' });
    try {
      const f = farm([
        { tool: 'fetch', why: 'the rows', code: '', url: 'https://tabular-api.data.gouv.fr/api/resources/x/data/?page_size=2', question: '', options: [], from: 0, answer: '' },
        { tool: 'run_code', why: 'titles', code: 'return results[0].data.map((r) => r.t);', url: '', question: '', options: [], from: 0, answer: '' },
        { tool: 'laya', why: 'label them', code: '', url: '', question: 'Which kind?', options: ['music', 'books'], from: 2, answer: '' },
        { tool: 'answer', why: 'done', code: '', url: '', question: '', options: [], from: 0, answer: 'One music, one books.' },
      ]);
      const out = await runAgent({ task: 'x', hosts: 'tabular-api.data.gouv.fr' }, f, { caps: { models: [], classify: { url: 'http://laya.test', key: 'k' } } });
      assert.deepEqual(got, ['https://tabular-api.data.gouv.fr/api/resources/x/data/?page_size=2']);
      assert.deepEqual(opts, [{ hosts: ['tabular-api.data.gouv.fr'] }], 'the listed hosts go to main, which checks every hop (critic S3)');
      assert.match(f.calls[3].prompt, /result \(results\[2\]\): \[\{"text":"a","label":"music","confidence":0\.9\},\{"text":"b","label":"books","confidence":0\.4\}\]/);
      assert.deepEqual(f.calls[0].schema.properties.tool.enum, ['run_code', 'fetch', 'laya', 'answer']);
      assert.match(out.data, /3\. \*\*laya — Which kind\?\*\*/);
    } finally {
      /** @type {any} */ (globalThis).window = saved;
      /** @type {any} */ (globalThis).fetch = savedFetch;
    }
  });

  test('agent: a farm that fails is the ask\'s own sentence; no task, no farm are refused before any call', async () => {
    const busy = farm([{ fail: { ok: false, error: { kind: 'farm', message: 'the model crashed' } } }]);
    await assert.rejects(runAgent({ task: 'x' }, busy), /the model crashed/);
    await assert.rejects(runAgent({ task: '  ' }, farm([])), /Write the task first/);
    await assert.rejects(agentPart.run(/** @type {any} */ ({ part: { id: 'a', type: 'agent', settings: { task: 'x' } }, inputs: {}, labels: {}, app: null, ask: null, sandbox })), /farm/i);
  });

  test('agent: the run plan quotes up to one generation per step', () => {
    const doc = /** @type {any} */ ({ parts: [{ id: 'a', type: 'agent', x: 0, y: 0, w: 320, h: 330, settings: { task: 'x', maxSteps: 5 } }], wires: [] });
    const p = runPlan(doc, { specs: specMap(), only: ['a'] });
    assert.deepEqual([p.costMin, p.costMax], [1, 5]);
    assert.equal(agentPart.mostGenerations({ settings: { maxSteps: 99 } }), MAX_STEPS);
    assert.deepEqual(agentPart.inputs[0].accepts, ['text', 'json', 'list'], 'a list arrives whole');
    assert.match(reportOf('Hi', []), /^Hi\n\n---\n/);
    assert.match(reportOf('Hi', [{ tool: 'answer', why: 'done' }]), /— 1 step \(/, 'one step, not "1 steps"');
  });
};
