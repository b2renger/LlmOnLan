// @ts-check
// The Classify box (ecosystem plan v2 §3.2): what counts as items, what Laya reads, how doubt is
// passed on, the no-Laya fallback, and the door's error table. The farm service itself is tested in
// farm/test/run.js and was measured against the real Laya (docs/research/ECOSYSTEM_RESEARCH_2026-09-27.md).
import assert from 'node:assert/strict';
import { classifyPart, itemsOf, stateOf, optionsOf, labelsFrom } from '../../../renderer/chat/graph/parts/classify.mjs';
import { classifyItems, readAnswers } from '../../../renderer/chat/net/classify.mjs';

const listValue = (items) => ({ kind: 'json', data: { stories: items } });
const app = (classify) => ({ farm: { get: () => ({ classify }) } });
const part = (settings = {}) => ({ id: 'c1', type: 'classify', settings: { question: 'What is it about?', options: 'ai\nscience\nbusiness', threshold: 0.6, ...settings } });

/** Swap globalThis.fetch for one call. */
async function withFetch(impl, fn) {
  const saved = globalThis.fetch;
  /** @type {any} */ (globalThis).fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = saved; }
}

export default (test) => {
  test('classify: items from a list, an object holding a list, or lines; ids kept or numbered', () => {
    assert.deepEqual(itemsOf(['a', 'b']).map((r) => r.id), [1, 2]);
    assert.deepEqual(itemsOf({ source: 'x', stories: [{ id: 7, title: 't' }] }).map((r) => r.id), [7]);
    assert.deepEqual(itemsOf('one\n\n two \n').map((r) => r.item), ['one', 'two']);
    assert.deepEqual(itemsOf(42), []);
    assert.equal(stateOf({ title: 'A story', points: 3 }), 'A story', 'a title is what Laya reads, not the numbers');
    assert.deepEqual(stateOf({ a: 1 }), { a: 1 });
    assert.deepEqual(optionsOf('AI, Science\nai\n'), ['ai', 'science'], 'trimmed, lowercased, unique');
  });

  test('classify: below the threshold is unsure; a missing answer is unsure; the ids line up', () => {
    const out = labelsFrom([{ id: 1 }, { id: 2 }, { id: 3 }], [
      { choice: 'ai', confidence: 0.91 }, { choice: 'science', confidence: 0.52 }, { choice: null, confidence: 0.99 },
    ], 0.6, 120);
    assert.deepEqual(out.labels.map((l) => [l.id, l.label, l.sure]), [[1, 'ai', true], [2, 'science', false], [3, null, false]]);
    assert.deepEqual(out.unsure, [2, 3]);
    assert.equal(out.by, 'laya');
  });

  test('classify: with no Laya on the farm nothing is sent and every item is passed on as unsure', async () => {
    let calls = 0;
    const v = await withFetch(async () => { calls++; return new Response('{}'); }, () => classifyPart.run(/** @type {any} */ ({
      part: part(), inputs: { items: [listValue([{ id: 1, title: 'x' }, { id: 2, title: 'y' }])] }, app: app(null), signal: new AbortController().signal,
    })));
    assert.equal(calls, 0, 'nothing leaves the laptop');
    assert.equal(v.data.by, 'none');
    assert.deepEqual(v.data.unsure, [1, 2]);
  });

  test('classify: one POST with the key, the titles and the options; answers become labels', async () => {
    /** @type {any} */ let seen = null;
    const v = await withFetch(async (url, init) => {
      seen = { url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ answers: [{ choice: 'ai', confidence: 0.8 }, { choice: 'business', confidence: 0.4 }], ms: 400, model: 'laya' }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }, () => classifyPart.run(/** @type {any} */ ({
      part: part(), inputs: { items: [listValue([{ id: 1, title: 'LLMs' }, { id: 2, title: 'Rates' }])], options: [{ kind: 'text', data: 'ai\nbusiness' }] },
      app: app({ url: 'http://farm:8891', key: 'kk' }), signal: new AbortController().signal,
    })));
    assert.equal(seen.url, 'http://farm:8891/classify');
    assert.equal(seen.auth, 'Bearer kk');
    assert.deepEqual(seen.body, { items: ['LLMs', 'Rates'], question: { instructions: 'What is it about?', options: ['ai', 'business'] } }, 'the wired options win over the box\'s own');
    assert.deepEqual(v.data.labels.map((l) => [l.label, l.sure]), [['ai', true], ['business', false]]);
  });

  // The owner's J21 (2026-11-27): a Text box's lines on `items`, nothing on `options`, the options TYPED in the box as
  // "sports,\npolitics,\nbusiness" (trailing commas). The typed options are used; the owner's failure was a wire on the
  // `options` dot (the middle one), which replaces them and leaves `items` empty.
  test('classify: a Text box on items and options typed in the box with commas: the typed options are sent', async () => {
    const lines = 'Le PSG bat Marseille 3-1\nParliament votes the budget\nLe Sénat rejette la réforme\nShares fall 8%\nA runner wins the marathon';
    /** @type {any} */ let seen = null;
    const answer = (choice) => ({ choice, confidence: 0.9 });
    const v = await withFetch(async (_url, init) => {
      seen = JSON.parse(init.body);
      return new Response(JSON.stringify({ answers: ['sports', 'politics', 'politics', 'business', 'sports'].map(answer), ms: 485, model: 'qwen3.6-35b-a3b' }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }, () => classifyPart.run(/** @type {any} */ ({
      part: part({ question: 'What is each item mainly about?', options: 'sports,\npolitics,\nbusiness' }),
      inputs: { items: [{ kind: 'text', data: lines }] },
      app: app({ url: 'http://farm:8891', key: 'kk' }), signal: new AbortController().signal,
    })));
    assert.equal(seen.items.length, 5, 'every line is an item');
    assert.deepEqual(seen.question.options, ['sports', 'politics', 'business'], 'the typed options, commas dropped');
    assert.deepEqual(v.data.labels.map((l) => l.label), ['sports', 'politics', 'politics', 'business', 'sports']);
    // The same box with the Text box on `options` instead (the owner's first wiring): nothing on items, refused.
    await assert.rejects(() => classifyPart.run(/** @type {any} */ ({
      part: part({ options: 'sports\npolitics\nbusiness' }), inputs: { options: [{ kind: 'text', data: lines }] },
      app: app({ url: 'http://farm:8891', key: 'kk' }), signal: new AbortController().signal,
    })), /Nothing to classify/);
  });

  // CLASSIFY_VLLM_PLAN (2026-11-27): the farm's own vLLM answers when it serves Qwen3.6 or Qwen3.8, and its reply's
  // `model` says so; the box's output and its status line name who answered instead of always "Laya".
  test('classify: the output names who answered, Laya or the farm\'s model (CLASSIFY_VLLM_PLAN)', async () => {
    const reply = (model) => withFetch(async () => new Response(JSON.stringify({ answers: [{ choice: 'ai', confidence: 0.8 }], ms: 40, model }),
      { status: 200, headers: { 'content-type': 'application/json' } }), () => classifyPart.run(/** @type {any} */ ({
      part: part(), inputs: { items: [listValue([{ id: 1, title: 'LLMs' }])] }, app: app({ url: 'http://farm:8891', key: 'kk' }), signal: new AbortController().signal,
    })));
    assert.equal((await reply('qwen3.6-35b-a3b')).data.by, 'qwen3.6-35b-a3b');
    assert.equal((await reply('convaiinnovations/laya')).data.by, 'laya', "Laya's own id still reads 'laya'");
    assert.equal(labelsFrom([{ id: 1 }], null, 0.6, 0, 'qwen3.6-35b-a3b').by, 'none', 'no answers: none, whoever was asked');
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../../renderer/chat/graph/parts/classify.mjs', import.meta.url), 'utf8');
    assert.ok(src.includes("const who = value.by === 'laya' ? 'Laya' : t('parts.classifyByModel', { model: value.by });") && /classifyStatus', \{[^}]*who \}/.test(src), 'the status line names who answered');
    const strings = fs.readFileSync(new URL('../../../renderer/chat/strings/parts-classify.en.mjs', import.meta.url), 'utf8');
    assert.ok(strings.includes("classifyStatus: '{n} items · {unsure} unsure (below {thr}) · {sec} s · {who}'"));
  });

  test('classify: a busy or warming farm is "not now" (the run puts the box back); other failures are the box\'s', async () => {
    const run = (status, headers = {}) => withFetch(async () => new Response('{}', { status, headers }), () => classifyPart.run(/** @type {any} */ ({
      part: part(), inputs: { items: [listValue([{ title: 'x' }])] }, app: app({ url: 'http://farm:8891', key: 'kk' }), signal: new AbortController().signal,
    })));
    await assert.rejects(run(429, { 'retry-after': '2' }), (e) => /** @type {any} */ (e).reason === 'busy');
    await assert.rejects(run(503), (e) => /** @type {any} */ (e).reason === 'busy');
    await assert.rejects(run(401), (e) => /** @type {any} */ (e).reason === 'part' && /key/.test(/** @type {any} */ (e).message));
    await assert.rejects(run(500), (e) => /** @type {any} */ (e).reason === 'part');
  });

  test('classify: bad options or no items are refused before anything is sent', async () => {
    const base = { app: app({ url: 'http://farm:8891', key: 'kk' }), signal: new AbortController().signal };
    await assert.rejects(classifyPart.run(/** @type {any} */ ({ ...base, part: part({ options: 'only' }), inputs: { items: [listValue([{ title: 'x' }])] } })), /2 and 20/);
    await assert.rejects(classifyPart.run(/** @type {any} */ ({ ...base, part: part(), inputs: {} })), /Nothing to classify/);
  });

  test('classify door: the contract is checked, a wrong count is not an answer', async () => {
    assert.equal(readAnswers({ answers: [{ choice: 'a', confidence: 0.5 }] }, 2), null);
    assert.deepEqual(readAnswers({ answers: [{ choice: 'a', confidence: '0.5' }] }, 1), [{ choice: 'a', confidence: 0.5 }]);
    const out = await classifyItems({ url: '', key: null, items: ['x'], instructions: 'q', options: ['a', 'b'] });
    assert.equal(/** @type {any} */ (out).code, 'no-classify');
  });
};
