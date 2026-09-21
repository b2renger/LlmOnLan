// Continue (P2-U3): the pure restart detector, and the whole discovery round trip against the REAL
// controller (real repo, real governor, stubbed `fetch`).
//
// The round trip is the point: a model that ignores an assistant prefill must cost the reader
// nothing but one extra request — no duplicated paragraph on screen, and the verdict remembered in
// kv so the next Continue on that model goes straight to the user-turn form.
import assert from 'node:assert/strict';
import { createApp } from '../../../renderer/chat/core/app.mjs';
import { SLOTS } from '../../../renderer/chat/core/registry.mjs';
import { KV_KEYS } from '../../../renderer/chat/core/types.mjs';
import { openRepoSync } from '../../../renderer/chat/state/repo.mjs';
import { createMemoryBackend } from '../../../renderer/chat/state/backend-memory.mjs';
import { createGovernor } from '../../../renderer/chat/net/governor.mjs';
import { createController } from '../../../renderer/chat/app/controller.mjs';
import { install as installContinue, looksLikeRestart, canContinue } from '../../../renderer/chat/app/continue.mjs';
import '../../../renderer/chat/strings/core.en.mjs';
import '../../../renderer/chat/strings/net.en.mjs';
import '../../../renderer/chat/strings/composer.en.mjs';
import '../../../renderer/chat/strings/tree.en.mjs';

const realFetch = globalThis.fetch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await sleep(0);
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

/** 200 tokens, the shape mock-length streams. */
const PARTIAL = Array.from({ length: 200 }, (_, i) => `tok${i} `).join('');

// ---------------------------------------------------------------------------------- fake world

function fakeFarm() {
  const caps = {
    present: true, id: 'mockfarm0001', name: 'Mock Farm', baseUrl: 'http://farm.test/v1',
    proxyRoot: 'http://farm.test', apiKey: null, requiresKey: false, keyMissing: false,
    healthy: true, stale: false, lastSeen: null, defaultModel: 'assistant',
    models: [{ id: 'assistant', underlying: 'Qwen3.8-27B-UD-Q2_K_XL', default: true }],
    engine: 'llama.cpp', budget: { tokens: 16384, advertised: 16384, source: 'advertised' },
    seats: null, busy: null, perf: null, gpuUtil: null, search: null, tts: null, ocr: null,
  };
  return {
    update: () => {}, get: () => caps, headers: () => ({}),
    fetchModels: async () => ({ ids: ['assistant'], state: 'ok' }),
    modelInfo: (id) => caps.models.find((m) => m.id === id) || null,
    setCapResolver: () => {}, cap: () => 'unknown',
  };
}

async function makeWorld() {
  const els = { live: { textContent: '' } };
  const app = createApp({ root: null, els: /** @type {any} */ (els) });
  app.repo = openRepoSync({ openPersistent: () => createMemoryBackend({ kind: 'idb' }), bus: app.bus, now: app.now, newId: app.newId });
  app.farm = /** @type {any} */ (fakeFarm());
  app.gov = createGovernor(app);
  const paints = [];
  app.view = /** @type {any} */ ({
    showPath: () => {}, upsert: () => {}, remove: () => {},
    beginStream: () => ({ paint: (c) => paints.push(c), setStatus: () => {}, end: () => {} }),
    scrollToMessage: () => {}, isStuck: () => true, setOutsideContext: () => {}, rowOf: () => null,
    debug: { paintStats: () => ({ count: 0, p50: 0, p95: 0, max: 0 }), renderOneShot: () => null },
  });
  app.composer = /** @type {any} */ ({ setBusy: () => {}, focus: () => {} });
  app.sidebar = /** @type {any} */ ({ render: () => {}, highlight: () => {} });
  app.dialogs = /** @type {any} */ ({ confirm: async () => true, prompt: async () => '', popover: () => ({ close() {} }), toast: () => {} });
  await app.repo.ready;
  const controller = createController(app);
  app.controller = /** @type {any} */ (controller);
  const api = installContinue(app);

  // a thread whose last reply stopped on `length`
  const thread = controller.newThread();
  app.repo.appendMessage(thread.id, { role: 'user', content: 'count for me', parts: [{ type: 'text', text: 'count for me' }], status: 'done' });
  const reply = app.repo.appendMessage(thread.id, {
    role: 'assistant', content: PARTIAL, status: 'done', model: 'assistant',
    stats: { promptTokens: 7, completionTokens: 200, ttftMs: 10, tokPerSec: 40, finishReason: 'length', text: '200 tok' },
  });
  await settle();
  return { app, controller, api, thread, reply, paints };
}

// ---------------------------------------------------------------------------------- fake stream

const chunk = (delta, finish = null) => ({ id: 'x', object: 'chat.completion.chunk', model: 'assistant', choices: [{ index: 0, delta, finish_reason: finish }] });
const usageChunk = (completion) => ({ id: 'x', object: 'chat.completion.chunk', model: 'assistant', choices: [], usage: { completion_tokens: completion, prompt_tokens: 7, total_tokens: completion + 7 } });

/** An SSE response that aborts cleanly when the controller pulls the plug. */
function sseResponse(events) {
  return (init) => {
    const signal = init && init.signal;
    let closed = false;
    const stream = new ReadableStream({
      start(ctrl) {
        const fail = () => {
          if (closed) return;
          closed = true;
          try { ctrl.error(new DOMException('The user aborted a request.', 'AbortError')); } catch { /* already errored */ }
        };
        if (signal) {
          if (signal.aborted) return fail();
          signal.addEventListener('abort', fail);
        }
        void (async () => {
          const enc = new TextEncoder();
          for (const ev of events) {
            if (closed) return;
            ctrl.enqueue(enc.encode(typeof ev === 'string' ? ev : `data: ${JSON.stringify(ev)}\n\n`));
            await sleep(1);
          }
          if (closed) return;
          ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
          closed = true;
          ctrl.close();
        })();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

/** `answer(body, n)` returns the text the farm streams for that request. */
function stubFetch(answer) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    let body = null;
    try { body = JSON.parse(init.body); } catch { body = init.body; }
    calls.push({ url: String(url), body });
    const text = answer(body, calls.length - 1);
    return sseResponse([chunk({ content: text }), usageChunk(200), chunk({}, 'stop')])(init);
  };
  calls.restore = () => { globalThis.fetch = realFetch; };
  return calls;
}

const lastMessage = (body) => body.messages[body.messages.length - 1];

// ---------------------------------------------------------------------------------- the tests

export default (test) => {
  test('looksLikeRestart: the truth table of §4 P2-U3', () => {
    // overlap — the new text repeats the partial's own opening
    const partial = 'The bevel modifier rounds an edge by inserting extra geometry along it, which you then shade.';
    assert.equal(looksLikeRestart(partial, 'The bevel modifier rounds an edge by inserting extra geometry'), true);

    // a greeting right after a partial that stopped mid-sentence
    assert.equal(looksLikeRestart('You can bevel an edge with the', 'Sure! Here is how you bevel an edge in Blender.'), true);
    assert.equal(looksLikeRestart('You can bevel an edge with the', 'Hello! Let me explain.'), true);

    // a capital letter alone is NOT a trigger: this is an ordinary continuation
    assert.equal(looksLikeRestart('…open the', 'Blender window and press Ctrl+B.'), false);

    // an OPEN fence: code repeats itself, and the model is mid-block
    const fenced = 'Here is the script:\n\n```python\nimport bpy\nbpy.ops.mesh.bevel(';
    assert.equal(looksLikeRestart(fenced, 'offset=0.1)\nbpy.ops.object.shade_smooth()'), false);

    // a partial that ended on a full stop may legitimately be followed by a greeting-ish word
    assert.equal(looksLikeRestart('That is the whole recipe.', 'Hello is also how you greet the API.'), false);

    // a CLOSED fence is not an open one
    const closed = 'Here:\n\n```python\nimport bpy\n```\nand then the';
    assert.equal(looksLikeRestart(closed, 'Sure! Let me start over.'), true);

    // nothing to compare against
    assert.equal(looksLikeRestart('', 'Hello!'), false);
    assert.equal(looksLikeRestart('something', ''), false);
  });

  test('canContinue: a length stop, or something half written that was cut off', () => {
    const base = { role: 'assistant', content: 'half an answer', status: 'done', stats: null };
    assert.equal(canContinue({ ...base, stats: { finishReason: 'length' } }), true);
    assert.equal(canContinue({ ...base, stats: { finishReason: 'stop' } }), false);
    assert.equal(canContinue({ ...base, status: 'aborted' }), true, 'you stopped it: offer to resume');
    assert.equal(canContinue({ ...base, status: 'interrupted' }), true);
    assert.equal(canContinue({ ...base, status: 'aborted', content: '' }), false, 'nothing to continue from');
    assert.equal(canContinue({ ...base, status: 'streaming' }), false);
    assert.equal(canContinue({ ...base, role: 'user' }), false);
    assert.equal(canContinue(null), false);
  });

  test('the Continue action is a MESSAGE_ACTIONS item, visible on exactly those messages', async () => {
    const { app, reply } = await makeWorld();
    const item = app.registry.list(SLOTS.MESSAGE_ACTIONS).find((x) => x.id === 'continue');
    assert.ok(item, 'registered');
    assert.equal(item.visible(reply, {}), true);
    assert.equal(item.visible({ ...reply, stats: { finishReason: 'stop' } }, {}), false);
  });

  test('a well-behaved model: the prefill is continued, in place, with one request', async () => {
    const { app, api, thread, reply } = await makeWorld();
    const calls = stubFetch(() => 'tok200 tok201 tok202 and so on until the answer is finally complete.');
    try {
      await api.run(reply);
      await settle();

      assert.equal(calls.length, 1, 'no fallback was needed');
      assert.equal(lastMessage(calls[0].body).role, 'assistant', 'the request ENDS with the half-written reply');
      assert.ok(!JSON.stringify(calls[0].body).includes('Continue exactly where you stopped'), 'no extra user turn');

      const stored = (await app.repo.getMessages(thread.id)).find((m) => m.id === reply.id);
      assert.ok(stored.content.startsWith(PARTIAL), 'the partial is kept, byte for byte');
      assert.ok(stored.content.includes('tok200'), 'and the continuation was appended to it');
      assert.equal(stored.content.indexOf('tok0 '), 0);
      assert.equal(stored.content.split('tok0 ').length - 1, 1, 'nothing is duplicated');
      assert.equal(stored.status, 'done');

      const mode = await app.repo.kvGet(KV_KEYS.continueMode('Qwen3.8-27B-UD-Q2_K_XL'), null);
      assert.equal(mode, null, 'a model that behaves is never marked');
    } finally { calls.restore(); }
  });

  test('a model that restarts: aborted before a single character is painted, retried with the user turn, remembered', async () => {
    const { app, api, thread, reply, paints } = await makeWorld();
    const calls = stubFetch((body) => {
      const last = lastMessage(body);
      const asked = last.role === 'user' && String(last.content).includes('Continue exactly where you stopped');
      // The mock farm's `mock-restart-on-prefill` behaviour, in one line.
      return asked ? '(continuing) tok200 tok201 tok202 and the rest of the answer.' : `Hello! ${PARTIAL}`;
    });
    try {
      await api.run(reply);
      await settle();

      assert.equal(calls.length, 2, 'one wasted request, then the fallback');
      assert.equal(lastMessage(calls[0].body).role, 'assistant', 'the first attempt was a prefill');
      const second = lastMessage(calls[1].body);
      assert.equal(second.role, 'user');
      assert.match(String(second.content), /Continue exactly where you stopped/);
      assert.equal(calls[1].body.messages.filter((m) => m.role === 'assistant').length, 1,
        'the prefill is still there — the extra turn is APPENDED after it');
      assert.ok(!JSON.stringify(calls[1].body).includes('"reasoning"'), 'no reasoning field ever goes on the wire');

      assert.ok(!paints.some((p) => p.includes('Hello!')), 'the restart was never painted');

      const stored = (await app.repo.getMessages(thread.id)).find((m) => m.id === reply.id);
      assert.ok(stored.content.startsWith(PARTIAL));
      assert.ok(!stored.content.includes('Hello!'), 'the restart never reached the record either');
      assert.ok(stored.content.includes('(continuing) tok200'));
      assert.equal(stored.content.split('tok0 ').length - 1, 1, 'the first 200 tokens are not repeated');

      const mode = await app.repo.kvGet(KV_KEYS.continueMode('Qwen3.8-27B-UD-Q2_K_XL'), null);
      assert.equal(mode, 'userTurn', 'the verdict is remembered per underlying model');
    } finally { calls.restore(); }
  });

  test('once remembered, the next Continue asks with the user turn straight away', async () => {
    const { app, api, reply } = await makeWorld();
    await app.repo.kvSet(KV_KEYS.continueMode('Qwen3.8-27B-UD-Q2_K_XL'), 'userTurn');
    const calls = stubFetch(() => '(continuing) tok200 tok201 and the rest of the answer follows here.');
    try {
      await api.run(reply);
      await settle();
      assert.equal(calls.length, 1, 'no discovery this time');
      const last = lastMessage(calls[0].body);
      assert.equal(last.role, 'user');
      assert.match(String(last.content), /Continue exactly where you stopped/);
    } finally { calls.restore(); }
  });

  test('the extra turn is never stored: the thread keeps exactly two messages', async () => {
    const { app, api, thread, reply } = await makeWorld();
    await app.repo.kvSet(KV_KEYS.continueMode('Qwen3.8-27B-UD-Q2_K_XL'), 'userTurn');
    const calls = stubFetch(() => '(continuing) and the rest of the answer follows right here, at last.');
    try {
      await api.run(reply);
      await settle();
      const messages = await app.repo.getMessages(thread.id);
      assert.equal(messages.length, 2, 'the continue prompt exists only on the wire (plan §2.6 AC)');
      assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant']);
    } finally { calls.restore(); }
  });
};
