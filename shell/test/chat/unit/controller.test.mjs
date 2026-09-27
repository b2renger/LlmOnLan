// The controller (P1-U2) against the REAL repo (memory backend), the REAL governor, the REAL net
// modules and a stubbed `fetch`. Everything §4 P1-U2's acceptance list names is here: the title
// heuristic, the assistant stamp, the two local notes that send no request, stop semantics, the
// onFirstChunk abort, and `params-resolve`'s precedence.
//
// app/controller.mjs deliberately touches no DOM global, so the real module runs in Node; only the
// view/composer/sidebar/dialogs it drives are fakes, and they record what they were told.
import assert from 'node:assert/strict';
import { createApp } from '../../../renderer/chat/core/app.mjs';
import { EV } from '../../../renderer/chat/core/events.mjs';
import { SLOTS } from '../../../renderer/chat/core/registry.mjs';
import { API_KEYS } from '../../../renderer/chat/core/types.mjs';
import { openRepoSync } from '../../../renderer/chat/state/repo.mjs';
import { createMemoryBackend } from '../../../renderer/chat/state/backend-memory.mjs';
import { createGovernor } from '../../../renderer/chat/net/governor.mjs';
import { createController, titleFrom } from '../../../renderer/chat/app/controller.mjs';
import '../../../renderer/chat/strings/core.en.mjs';
import '../../../renderer/chat/strings/net.en.mjs';
import '../../../renderer/chat/strings/composer.en.mjs';

const realFetch = globalThis.fetch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Let the repo's write chain drain. */
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await sleep(0);
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

// ---------------------------------------------------------------------------------- fake world

function fakeView() {
  const calls = { showPath: [], upsert: [], begin: [], paints: [], ends: [], status: [] };
  return {
    calls,
    showPath: (thread, path, opts) => calls.showPath.push({ thread, path, opts }),
    upsert: (msg) => calls.upsert.push({ ...msg }),
    remove: () => {},
    beginStream: (id) => {
      calls.begin.push(id);
      return {
        paint: (content, reasoning) => calls.paints.push([content, reasoning]),
        setStatus: (s) => calls.status.push(s),
        end: (msg) => calls.ends.push({ ...msg }),
      };
    },
    scrollToMessage: () => {},
    isStuck: () => true,
    setOutsideContext: () => {},
    rowOf: () => null,
    debug: { paintStats: () => ({ count: 0, p50: 0, p95: 0, max: 0 }), renderOneShot: () => null },
  };
}

function fakeComposer() {
  const calls = { busy: [], focus: 0 };
  return { calls, setBusy: (v) => calls.busy.push(!!v), focus: () => { calls.focus += 1; } };
}

function fakeFarm(patch = {}) {
  const caps = {
    present: true, id: 'mockfarm0001', name: 'Mock Farm', baseUrl: 'http://farm.test/v1',
    proxyRoot: 'http://farm.test', apiKey: null, requiresKey: false, keyMissing: false,
    healthy: true, stale: false, lastSeen: null, defaultModel: 'assistant',
    models: [{ id: 'assistant', underlying: 'Qwen3.8-27B-UD-Q2_K_XL', default: true }],
    engine: 'llama.cpp', budget: { tokens: 16384, advertised: 16384, source: 'advertised' },
    seats: null, busy: null, perf: null, gpuUtil: null, search: null, tts: null, ocr: null,
    ...patch,
  };
  return {
    caps,
    update: () => {},
    get: () => caps,
    headers: () => (caps.apiKey ? { authorization: `Bearer ${caps.apiKey}` } : {}),
    fetchModels: async () => ({ ids: caps.models.map((m) => m.id), state: 'ok' }),
    modelInfo: (id) => caps.models.find((m) => m.id === id) || null,
    setCapResolver: () => {},
    cap: () => 'unknown',
  };
}

/** A whole world: real app + real repo + real governor + fakes, with the controller on top. */
async function makeWorld({ farm = fakeFarm(), dialogs = null } = {}) {
  const els = { live: { textContent: '' } };
  const app = createApp({ root: null, els: /** @type {any} */ (els) });
  app.repo = openRepoSync({ openPersistent: () => createMemoryBackend({ kind: 'idb' }), bus: app.bus, now: app.now, newId: app.newId });
  app.farm = /** @type {any} */ (farm);
  app.gov = createGovernor(app);
  app.view = /** @type {any} */ (fakeView());
  app.composer = /** @type {any} */ (fakeComposer());
  const sidebarRenders = { n: 0 };
  app.sidebar = /** @type {any} */ ({ render: () => { sidebarRenders.n += 1; }, highlight: () => {} });
  const toasts = [];
  app.dialogs = /** @type {any} */ (dialogs || { confirm: async () => true, prompt: async () => '', popover: () => ({ close() {} }), toast: (text) => toasts.push(text) });
  await app.repo.ready;
  const controller = createController(app);
  app.controller = /** @type {any} */ (controller);
  return { app, controller, farm, toasts, sidebarRenders, view: /** @type {any} */ (app.view), composer: /** @type {any} */ (app.composer) };
}

// ---------------------------------------------------------------------------------- fake stream

/** An SSE response whose chunks arrive one per microtask tick (or on a timer when `gapMs`). */
function sseResponse(events, { gapMs = 0, status = 200, headers = {}, endAbruptly = false } = {}) {
  return (init) => {
    const signal = init && init.signal;
    let i = 0;
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
        const push = async () => {
          const enc = new TextEncoder();
          while (i < events.length && !closed) {
            const ev = events[i++];
            const line = typeof ev === 'string' ? ev : `data: ${JSON.stringify(ev)}\n\n`;
            ctrl.enqueue(enc.encode(line));
            if (gapMs) await sleep(gapMs); else await Promise.resolve();
          }
          if (closed) return;
          if (!endAbruptly) ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
          closed = true;
          ctrl.close();
        };
        void push();
      },
    });
    return new Response(stream, { status, headers: { 'content-type': 'text/event-stream', ...headers } });
  };
}

/** A chunk of the OpenAI streaming shape. */
const chunk = (delta, finish = null) => ({ id: 'x', object: 'chat.completion.chunk', model: 'assistant', choices: [{ index: 0, delta, finish_reason: finish }] });
const usageChunk = (completion, prompt = 7) => ({ id: 'x', object: 'chat.completion.chunk', model: 'assistant', choices: [], usage: { completion_tokens: completion, prompt_tokens: prompt, total_tokens: completion + prompt } });

/** Install a fetch stub; returns the recorded calls (and restores on `calls.restore()`). */
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    let body = null;
    try { body = JSON.parse(init.body); } catch { body = init.body; }
    calls.push({ url: String(url), init, body, headers: (init && init.headers) || {} });
    return handler(init, calls.length - 1);
  };
  calls.restore = () => { globalThis.fetch = realFetch; };
  return calls;
}

// ---------------------------------------------------------------------------------- the tests

export default (test) => {
  test('the API surface is exactly §3.4 (API_KEYS.controller)', async () => {
    const { controller } = await makeWorld();
    assert.deepEqual(Object.keys(controller).sort(), [...API_KEYS.controller].sort());
  });

  // ---------------------------------------------------------------- title heuristic
  test('titleFrom: the first sentence, whitespace collapsed, ≤ 60 chars', () => {
    assert.equal(titleFrom('What GPU is in the rig? And how much VRAM?'), 'What GPU is in the rig?');
    assert.equal(titleFrom('  hello   there \n\n friend '), 'hello there friend');
    assert.equal(titleFrom('x'.repeat(200)).length, 60);
    assert.equal(titleFrom('   '), null);
    assert.equal(titleFrom(''), null);
    const long = `${'word '.repeat(30)}. tail`;
    assert.ok(titleFrom(long).length <= 60);
  });

  test('send: the first user message titles the thread, later ones do not', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse([chunk({ content: 'ok' }), usageChunk(1)]));
    try {
      await controller.send({ text: 'What GPU is in the rig? Tell me everything.', parts: [], model: 'assistant' });
      await settle();
      const id = app.state.threadId;
      let thread = await app.repo.getThread(id);
      assert.equal(thread.title, 'What GPU is in the rig?');
      assert.equal(thread.titleSource, 'auto');

      await controller.send({ text: 'And the VRAM?', parts: [], model: 'assistant' });
      await settle();
      thread = await app.repo.getThread(id);
      assert.equal(thread.title, 'What GPU is in the rig?', 'the second turn must not rename the thread');
      assert.equal(calls.length, 2);
    } finally { calls.restore(); }
  });

  test('send: the user message keeps the draft\'s parts, recipeId and vars', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse([chunk({ content: 'ok' }), usageChunk(1)]));
    try {
      await controller.send({
        text: 'describe this',
        parts: [{ type: 'image', attId: 'att-7' }],
        recipeId: 'rec-1',
        vars: { tone: 'terse' },
        model: 'assistant',
      });
      await settle();
      const path = await app.repo.getPath(app.state.threadId);
      const user = path.find((m) => m.role === 'user');
      assert.equal(user.content, 'describe this');
      assert.deepEqual(
        user.parts,
        [{ type: 'text', text: 'describe this' }, { type: 'image', attId: 'att-7' }],
        'the text is part 0, the draft parts follow, in order',
      );
      assert.equal(user.recipeId, 'rec-1');
      assert.deepEqual(user.vars, { tone: 'terse' });
      assert.equal(user.status, 'done');
    } finally { calls.restore(); }
  });

  test('send: a draft with parts but no text still sends; an empty draft does not', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse([chunk({ content: 'ok' }), usageChunk(1)]));
    try {
      await controller.send({ text: '   ', parts: [], model: 'assistant' });
      await settle();
      assert.equal(calls.length, 0, 'nothing to say, nothing sent');
      assert.equal(app.state.threadId, null, 'and no thread was created for it');

      await controller.send({ text: '', parts: [{ type: 'image', attId: 'att-9' }], model: 'assistant' });
      await settle();
      assert.equal(calls.length, 1, 'an attachment alone is a message');
      const path = await app.repo.getPath(app.state.threadId);
      const user = path.find((m) => m.role === 'user');
      assert.deepEqual(user.parts, [{ type: 'image', attId: 'att-9' }]);
      const thread = await app.repo.getThread(app.state.threadId);
      assert.equal(thread.title, 'New chat', 'an empty text cannot title a thread: the default stands');
      assert.equal(thread.titleSource, 'auto');
    } finally { calls.restore(); }
  });

  // ---------------------------------------------------------------- newThread / selectThread
  test('newThread is synchronous: record, THREAD_SELECTED, empty view — no await', async () => {
    const { app, controller, view } = await makeWorld();
    const seen = [];
    app.bus.on(EV.THREAD_SELECTED, (p) => seen.push(p.threadId));
    const thread = controller.newThread();
    assert.ok(thread && thread.id, 'a thread record came back from the same tick');
    assert.deepEqual(seen, [thread.id]);
    assert.equal(app.state.threadId, thread.id, 'core keeps app.state.threadId from the event');
    assert.equal(view.calls.showPath.length, 1);
    assert.equal(view.calls.showPath[0].thread.id, thread.id);
    assert.deepEqual(view.calls.showPath[0].path, []);
  });

  test('selectThread re-reads the path and passes a siblings Map to showPath', async () => {
    const { app, controller, view } = await makeWorld();
    const calls = stubFetch(sseResponse([chunk({ content: 'hi' }), usageChunk(1)]));
    try {
      await controller.send({ text: 'first', parts: [], model: 'assistant' });
      await settle();
      const id = app.state.threadId;
      await controller.selectThread(null);
      assert.equal(app.state.threadId, null);
      view.calls.showPath.length = 0;
      await controller.selectThread(id);
      const last = view.calls.showPath[view.calls.showPath.length - 1];
      assert.equal(last.thread.id, id);
      assert.equal(last.path.length, 2, 'user + assistant');
      assert.ok(last.opts.siblings instanceof Map, 'an empty Map by default (SIBLINGS lands in P2)');

      const provided = new Map([['a', { position: 1, count: 2 }]]);
      app.registry.add(SLOTS.SIBLINGS, { id: 'test', provide: async () => provided });
      await controller.refreshView();
      const after = view.calls.showPath[view.calls.showPath.length - 1];
      assert.equal(after.opts.siblings, provided);
    } finally { calls.restore(); }
  });

  // ---------------------------------------------------------------- the stamp + params
  test('the assistant message is stamped with model, underlying, farm and resolved params', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse([chunk({ content: 'ok' }), usageChunk(1)]));
    try {
      const thread = controller.newThread({ params: { temperature: 0.2, top_p: 0.1 } });
      await controller.send({ text: 'hello', parts: [], model: 'assistant', params: { top_p: 0.9 } });
      await settle();
      const path = await app.repo.getPath(thread.id);
      const assistant = path[path.length - 1];
      assert.equal(assistant.role, 'assistant');
      assert.equal(assistant.model, 'assistant');
      assert.equal(assistant.underlying, 'Qwen3.8-27B-UD-Q2_K_XL');
      assert.equal(assistant.farmName, 'Mock Farm');
      assert.equal(assistant.farmId, 'mockfarm0001');
      // call > thread (§3.6.3, the `params-resolve` transform this unit registers at order 250)
      assert.deepEqual(assistant.params, { temperature: 0.2, top_p: 0.9 });
      assert.equal(calls[0].body.temperature, 0.2);
      assert.equal(calls[0].body.top_p, 0.9);
      assert.equal(calls[0].body.stream, true);
      assert.deepEqual(calls[0].body.stream_options, { include_usage: true });
    } finally { calls.restore(); }
  });

  test('params-resolve is registered once, at order 250, and is the only transform in P1', async () => {
    const { app } = await makeWorld();
    const items = app.registry.list(SLOTS.REQUEST_TRANSFORMS);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'params-resolve');
    assert.equal(items[0].order, 250);
    const req = { paramLayers: { recipe: { temperature: 1, seed: 5 }, thread: { temperature: 0.5 }, call: { max_tokens: 9, nope: 1 } }, params: {} };
    items[0].apply(req, {});
    assert.deepEqual(req.params, { temperature: 0.5, max_tokens: 9, seed: 5 }, 'call > thread > recipe, whitelisted');
  });

  // ---------------------------------------------------------------- stats + reasoning
  test('stats read exactly "N tok · X.X tok/s · first token Y.YYs" and reasoning is kept', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse([
      chunk({ reasoning_content: 'weighing ' }),
      chunk({ reasoning_content: 'options' }),
      chunk({ content: 'The ' }), chunk({ content: 'answer.' }),
      usageChunk(42),
    ]));
    try {
      const thread = controller.newThread();
      await controller.send({ text: 'why?', parts: [], model: 'assistant' });
      await settle();
      const path = await app.repo.getPath(thread.id);
      const assistant = path[path.length - 1];
      assert.equal(assistant.status, 'done');
      assert.equal(assistant.content, 'The answer.');
      assert.equal(assistant.reasoning, 'weighing options');
      assert.match(assistant.stats.text, /^42 tok · \d+\.\d tok\/s · first token \d+\.\d\ds$/);
      assert.equal(assistant.stats.completionTokens, 42);
      assert.equal(assistant.stats.promptTokens, 7);
      // the request never carries reasoning (plan §3.6.3)
      assert.ok(calls[0].body.messages.every((m) => m.reasoning === undefined && m.reasoning_content === undefined));
    } finally { calls.restore(); }
  });

  test('no usage in the stream → one token per content delta (chat.js parity)', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse([chunk({ content: 'a ' }), chunk({ content: 'b ' }), chunk({ content: 'c' }, 'stop')]));
    try {
      const thread = controller.newThread();
      await controller.send({ text: 'count', parts: [], model: 'assistant' });
      await settle();
      const path = await app.repo.getPath(thread.id);
      const assistant = path[path.length - 1];
      assert.equal(assistant.stats.completionTokens, 3);
      assert.match(assistant.stats.text, /^3 tok · /);
    } finally { calls.restore(); }
  });

  test('an empty reasoning is stored as null, never ""', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse([chunk({ content: 'plain' }), usageChunk(1)]));
    try {
      const thread = controller.newThread();
      await controller.send({ text: 'hi', parts: [], model: 'assistant' });
      await settle();
      const path = await app.repo.getPath(thread.id);
      assert.equal(path[path.length - 1].reasoning, null);
    } finally { calls.restore(); }
  });

  // ---------------------------------------------------------------- local notes (no request)
  test('a busy farm answers locally with the v0.1.45 sentence and sends NO request', async () => {
    const farm = fakeFarm({ busy: { label: 'Switching model', percent: 40 } });
    const { app, controller, composer } = await makeWorld({ farm });
    const calls = stubFetch(sseResponse([]));
    try {
      const thread = controller.newThread();
      await controller.send({ text: 'hello', parts: [], model: 'assistant' });
      await settle();
      const path = await app.repo.getPath(thread.id);
      const assistant = path[path.length - 1];
      assert.equal(assistant.status, 'local');
      assert.equal(assistant.content, '⏳ The server is busy: Switching model (40%). Try again in a moment.');
      assert.equal(calls.length, 0, 'not one request left the client');
      assert.equal(composer.calls.busy[composer.calls.busy.length - 1], false, 'the composer is released');
      assert.equal(app.gov.state().foreground, 'idle');
    } finally { calls.restore(); }
  });

  test('a busy farm with no percent omits the parenthesis', async () => {
    const farm = fakeFarm({ busy: { label: 'Restarting llama-server' } });
    const { app, controller } = await makeWorld({ farm });
    const calls = stubFetch(sseResponse([]));
    try {
      const thread = controller.newThread();
      await controller.send({ text: 'hello', parts: [], model: 'assistant' });
      await settle();
      const path = await app.repo.getPath(thread.id);
      assert.equal(path[path.length - 1].content, '⏳ The server is busy: Restarting llama-server. Try again in a moment.');
      assert.equal(calls.length, 0);
    } finally { calls.restore(); }
  });

  test('a farm that needs a password we do not have: the note, and NO request', async () => {
    const farm = fakeFarm({ requiresKey: true, apiKey: null, keyMissing: true });
    const { app, controller } = await makeWorld({ farm });
    const calls = stubFetch(sseResponse([]));
    try {
      const thread = controller.newThread();
      await controller.send({ text: 'hello', parts: [], model: 'assistant' });
      await settle();
      const path = await app.repo.getPath(thread.id);
      const assistant = path[path.length - 1];
      assert.equal(assistant.error.kind, 'key_missing');
      assert.equal(assistant.error.message, 'Password needed — enter it on the farm card');
      assert.equal(calls.length, 0);
    } finally { calls.restore(); }
  });

  test('the farm password rides on every completion as a Bearer header', async () => {
    const farm = fakeFarm({ requiresKey: true, apiKey: 'harness-pw' });
    const { controller } = await makeWorld({ farm });
    const calls = stubFetch(sseResponse([chunk({ content: 'ok' }), usageChunk(1)]));
    try {
      controller.newThread();
      await controller.send({ text: 'hello', parts: [], model: 'assistant' });
      await settle();
      assert.equal(calls[0].headers.authorization, 'Bearer harness-pw');
      assert.equal(calls[0].headers['content-type'], 'application/json');
    } finally { calls.restore(); }
  });

  // ---------------------------------------------------------------- errors
  test('an HTTP failure keeps the farm sentence verbatim in the note', async () => {
    const { app, controller } = await makeWorld();
    const seats = "All 2 seats on this server are in use. A seat frees after ~15 min without activity — try again in a moment, or ask around who's done.";
    const calls = stubFetch(() => new Response(JSON.stringify({ error: { message: seats, type: 'rate_limit_error', code: 'lol_seats_full' } }), {
      status: 429, headers: { 'content-type': 'application/json', 'retry-after': '30' },
    }));
    try {
      const thread = controller.newThread();
      await controller.send({ text: 'hello', parts: [], model: 'assistant' });
      await settle();
      const path = await app.repo.getPath(thread.id);
      const assistant = path[path.length - 1];
      assert.equal(assistant.status, 'error');
      assert.equal(assistant.error.kind, 'seats_full');
      assert.ok(assistant.error.message.includes(seats), `the note must quote the farm: ${assistant.error.message}`);
      assert.notEqual(assistant.error.message.trim(), 'HTTP 429');
      assert.equal(assistant.error.retryAfter, 30);
    } finally { calls.restore(); }
  });

  test('a failure while the farm is busy says the busy sentence instead (chat.js:296-299)', async () => {
    const farm = fakeFarm();
    const { app, controller } = await makeWorld({ farm });
    const calls = stubFetch(() => {
      // the farm goes busy WHILE the request is in flight, exactly as a model switch does
      farm.caps.busy = { label: 'Switching model' };
      return new Response('nope', { status: 502 });
    });
    try {
      const thread = controller.newThread();
      await controller.send({ text: 'hello', parts: [], model: 'assistant' });
      await settle();
      const path = await app.repo.getPath(thread.id);
      const note = path[path.length - 1].error.message;
      assert.ok(note.includes('⏳ The server is busy: Switching model. Try again in a moment.'), note);
      assert.ok(!note.includes('nope'), 'the raw upstream text is not shown when the farm said why');
    } finally { calls.restore(); }
  });

  test('a mid-stream error keeps the partial answer and adds a note', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse([
      chunk({ content: 'tok0 ' }), chunk({ content: 'tok1 ' }),
      { error: { message: 'upstream exploded', type: 'api_error', code: 500 } },
    ], { endAbruptly: true }));
    try {
      const thread = controller.newThread();
      await controller.send({ text: 'hello', parts: [], model: 'assistant' });
      await settle();
      const path = await app.repo.getPath(thread.id);
      const assistant = path[path.length - 1];
      assert.equal(assistant.status, 'error');
      assert.equal(assistant.content, 'tok0 tok1 ', 'the partial survives');
      assert.ok(assistant.error.message.includes('upstream exploded'), assistant.error.message);
    } finally { calls.restore(); }
  });

  test('an ERROR_HANDLERS item that returns true owns the message (no note is written)', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(() => new Response('{}', { status: 500 }));
    try {
      const seen = [];
      app.registry.add(SLOTS.ERROR_HANDLERS, {
        id: 'test-handler',
        order: 100,
        async handle(err, msg) { seen.push(err.kind); msg.status = 'waiting'; return true; },
      });
      const thread = controller.newThread();
      await controller.send({ text: 'hello', parts: [], model: 'assistant' });
      await settle();
      const path = await app.repo.getPath(thread.id);
      assert.equal(seen.length, 1);
      assert.equal(path[path.length - 1].status, 'waiting');
      assert.equal(path[path.length - 1].error, null);
    } finally { calls.restore(); }
  });

  test('a tool call with no content is answered with the "no tools" note', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse([
      chunk({ tool_calls: [{ index: 0, function: { name: 'do_thing', arguments: '{}' } }] }, 'tool_calls'),
      usageChunk(0),
    ]));
    try {
      const thread = controller.newThread();
      await controller.send({ text: 'do it', parts: [], model: 'assistant' });
      await settle();
      const path = await app.repo.getPath(thread.id);
      const assistant = path[path.length - 1];
      assert.equal(assistant.sawToolCalls, true);
      assert.equal(assistant.error.kind, 'tool_calls');
      assert.equal(assistant.error.message, "The model tried to use a tool; LOL Chat doesn't run tools.");
    } finally { calls.restore(); }
  });

  // ---------------------------------------------------------------- governor + stop
  test('a second generation while one streams is refused with a toast', async () => {
    const { controller, toasts } = await makeWorld();
    const calls = stubFetch(sseResponse(Array.from({ length: 40 }, (_, i) => chunk({ content: `tok${i} ` })), { gapMs: 5 }));
    try {
      const thread = controller.newThread();
      const first = controller.send({ text: 'slow one', parts: [], model: 'assistant' });
      await sleep(15);
      const second = await controller.generate({ threadId: thread.id, parentId: null, model: 'assistant' });
      assert.equal(second, null);
      assert.deepEqual(toasts, ['A reply is already running.']);
      await first;
      await settle();
      assert.equal(calls.length, 1, 'the refused generation sent nothing');
    } finally { calls.restore(); }
  });

  // P2 review, blocker (§2.6 AU.4): the seat wait is the one caller that generates into a thread
  // the reader may have left, and generate()'s view writes were unguarded — the answer streamed
  // live into whatever conversation was open, including a brand-new empty one, until the
  // post-stream refreshView() rebuilt the path.
  test('a generation into a thread that is NOT on screen paints nothing into the open one', async () => {
    const { app, controller, view } = await makeWorld();
    const calls = stubFetch(sseResponse([chunk({ content: 'the answer' }), usageChunk(2)]));
    try {
      const a = controller.newThread();
      await controller.send({ text: 'question in A', parts: [], model: 'assistant' });
      await settle();

      const b = controller.newThread();                      // the reader moved on
      assert.equal(app.state.threadId, b.id);
      view.calls.upsert.length = 0;
      view.calls.begin.length = 0;
      view.calls.ends.length = 0;

      const out = await controller.generate({ threadId: a.id, parentId: null, model: 'assistant' });
      await settle();
      assert.equal(out.status, 'done', 'the generation itself ran normally');
      assert.deepEqual(view.calls.begin, [], 'no stream was opened into the chat on screen');
      assert.deepEqual(view.calls.upsert.map((m) => m.threadId), [], 'and no row was painted into it');
      assert.deepEqual(view.calls.ends, []);

      // …and it really landed, in its own thread, where the reader will find it.
      const inA = await app.repo.getMessages(a.id);
      const reply = inA.filter((m) => m.role === 'assistant').pop();
      assert.equal(reply.status, 'done');
      assert.equal(reply.content, 'the answer');
      assert.equal(calls.length, 2, 'one send + this generation');
    } finally { calls.restore(); }
  });

  test('stop() aborts the stream: the partial is kept, status aborted, stats when tokens arrived', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse(Array.from({ length: 200 }, (_, i) => chunk({ content: `tok${i} ` })), { gapMs: 5 }));
    try {
      const thread = controller.newThread();
      const sent = controller.send({ text: 'long', parts: [], model: 'assistant' });
      await sleep(40);
      assert.equal(controller.isStreaming(), true);
      assert.equal(controller.stop(), true);
      await sent;
      await settle();
      const path = await app.repo.getPath(thread.id);
      const assistant = path[path.length - 1];
      assert.equal(assistant.status, 'aborted');
      assert.ok(assistant.content.startsWith('tok0 '), assistant.content);
      assert.ok(assistant.content.length < 'tok'.length * 200, 'it really stopped early');
      assert.ok(assistant.stats && assistant.stats.completionTokens > 0);
      assert.equal(controller.isStreaming(), false);
      assert.equal(app.gov.state().foreground, 'idle');
    } finally { calls.restore(); }
  });

  test('stop() with nothing streaming runs the first ACTIVE cancel handler', async () => {
    const { app, controller } = await makeWorld();
    const ran = [];
    app.registry.add(SLOTS.CANCEL_HANDLERS, { id: 'inactive', order: 100, active: () => false, cancel: () => ran.push('inactive') });
    app.registry.add(SLOTS.CANCEL_HANDLERS, { id: 'active-a', order: 200, active: () => true, cancel: () => ran.push('active-a') });
    app.registry.add(SLOTS.CANCEL_HANDLERS, { id: 'active-b', order: 300, active: () => true, cancel: () => ran.push('active-b') });
    assert.equal(controller.stop(), true);
    assert.deepEqual(ran, ['active-a']);
    assert.equal(controller.stop(), true);
    assert.deepEqual(ran, ['active-a', 'active-a']);
  });

  test('stop() with nothing streaming and no handler is a no-op', async () => {
    const { controller } = await makeWorld();
    assert.equal(controller.stop(), false);
  });

  // ---------------------------------------------------------------- onFirstChunk
  test('onFirstChunk sees the opening; an "abort" restores the partial (continue mode)', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse([
      chunk({ content: 'Sorry, I cannot help with that, here is why: ' }),
      chunk({ content: 'more and more text' }),
      usageChunk(2),
    ], { gapMs: 2 }));
    try {
      const thread = controller.newThread();
      // A finished answer we then ask the model to CONTINUE.
      const assistant = app.repo.appendMessage(thread.id, { role: 'assistant', content: 'The first half.', status: 'done', model: 'assistant' });
      await settle();
      const seen = [];
      app.registry.add(SLOTS.STREAM_OBSERVERS, {
        id: 'restart-detector',
        onFirstChunk: ({ text, mode, partial }) => {
          seen.push({ text, mode, partial });
          return 'abort';
        },
      });
      const result = await controller.generate({ threadId: thread.id, into: assistant, mode: 'continue', model: 'assistant' });
      await settle();
      assert.equal(seen.length, 1);
      assert.ok(seen[0].text.length >= 40, `the observer waits for the opening: ${seen[0].text}`);
      assert.equal(seen[0].mode, 'continue');
      assert.equal(seen[0].partial, 'The first half.');
      assert.equal(result.abortedBy, 'observer');
      const path = await app.repo.getPath(thread.id);
      const stored = path[path.length - 1];
      assert.equal(stored.content, 'The first half.', 'the partial is restored, the restart is thrown away');
      assert.equal(stored.status, 'done');
      assert.equal(calls.length, 1);
    } finally { calls.restore(); }
  });

  test('continue mode appends content and reasoning, and never sends prior reasoning', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse([chunk({ reasoning_content: 'more thought' }), chunk({ content: ' and the rest.' }), usageChunk(3)]));
    try {
      const thread = controller.newThread();
      const assistant = app.repo.appendMessage(thread.id, {
        role: 'assistant', content: 'The first half.', reasoning: 'first thought', reasoningMs: 120, status: 'done', model: 'assistant',
      });
      await settle();
      await controller.generate({ threadId: thread.id, into: assistant, mode: 'continue', model: 'assistant' });
      await settle();
      const path = await app.repo.getPath(thread.id);
      const stored = path[path.length - 1];
      assert.equal(stored.content, 'The first half. and the rest.');
      assert.equal(stored.reasoning, 'first thought\n\nmore thought');
      assert.ok(stored.reasoningMs >= 120);
      const sent = calls[0].body.messages;
      assert.ok(sent.every((m) => m.reasoning === undefined && m.reasoning_content === undefined), 'prior reasoning never goes back');
      assert.equal(sent[sent.length - 1].role, 'assistant', 'continue keeps the trailing assistant last');
      assert.equal(sent[sent.length - 1].content, 'The first half.');
    } finally { calls.restore(); }
  });

  // ---------------------------------------------------------------- history rules
  test('local and error messages are never sent as history', async () => {
    const farm = fakeFarm({ busy: { label: 'Switching model' } });
    const { app, controller } = await makeWorld({ farm });
    const calls = stubFetch(sseResponse([chunk({ content: 'ok' }), usageChunk(1)]));
    try {
      const thread = controller.newThread();
      await controller.send({ text: 'while busy', parts: [], model: 'assistant' });   // → a local note
      await settle();
      farm.caps.busy = null;
      await controller.send({ text: 'now for real', parts: [], model: 'assistant' });
      await settle();
      assert.equal(calls.length, 1);
      const roles = calls[0].body.messages.map((m) => m.role);
      assert.deepEqual(roles, ['user', 'user'], 'the busy note is not part of the conversation');
      assert.ok(!JSON.stringify(calls[0].body).includes('The server is busy'));
    } finally { calls.restore(); }
  });

  // ---------------------------------------------------------------- preview
  test('preview() runs the transforms with ctx.preview and touches neither repo nor network', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse([]));
    try {
      const thread = controller.newThread();
      const seen = [];
      app.registry.add(SLOTS.REQUEST_TRANSFORMS, {
        id: 'spy', order: 900, apply: (req, ctx) => { seen.push(ctx.preview); },
      });
      const req = await controller.preview({ draft: { text: 'what would you send?', parts: [], model: 'assistant' } });
      assert.deepEqual(seen, [true]);
      assert.equal(req.messages.length, 1);
      assert.equal(req.messages[0].blocks[0].text, 'what would you send?');
      assert.equal(req.model, 'assistant');
      assert.equal(calls.length, 0);
      const path = await app.repo.getPath(thread.id);
      assert.equal(path.length, 0, 'preview writes nothing');
    } finally { calls.restore(); }
  });
  // ------------------------------------------------- fix round: the slot, the stutter, the draft
  test('a throw between acquire() and the stream still releases the foreground slot', async () => {
    // Everything after gov.acquire() used to run OUTSIDE the try/finally that releases it: one
    // rejected repo write and the governor stayed 'streaming' for the rest of the session, so the
    // composer refused every later send ("A reply is already running") until a reload.
    const { app, controller, toasts } = await makeWorld();
    const thread = controller.newThread();
    const real = app.repo.appendMessage;
    app.repo.appendMessage = () => { throw new Error('the store said no'); };
    try {
      const out = await controller.generate({ threadId: thread.id, parentId: null, model: 'assistant' });
      assert.equal(out.status, 'error', 'the failure is reported, not swallowed');
    } finally {
      app.repo.appendMessage = real;
    }
    assert.equal(app.gov.state().foreground, 'idle', 'the slot came back');
    assert.ok(toasts.length >= 1, 'and the reader was told something');

    // ...and the NEXT send works, which is the whole point.
    const calls = stubFetch(sseResponse([chunk({ content: 'second time lucky' }), usageChunk(3)]));
    try {
      await controller.send({ text: 'again', parts: [], model: 'assistant' });
      await settle();
      const path = await app.repo.getPath(thread.id);
      assert.equal(path[path.length - 1].content, 'second time lucky');
    } finally { calls.restore(); }
  });

  test('the farm-busy note says the sentence ONCE, not title + the same sentence again', async () => {
    const farm = fakeFarm();
    const { app, controller } = await makeWorld({ farm });
    const calls = stubFetch(() => {
      farm.caps.busy = { label: 'Switching model' };
      return new Response('nope', { status: 502 });
    });
    try {
      const thread = controller.newThread();
      await controller.send({ text: 'hello', parts: [], model: 'assistant' });
      await settle();
      const path = await app.repo.getPath(thread.id);
      const note = path[path.length - 1].error.message;
      assert.equal(note, '⏳ The server is busy: Switching model. Try again in a moment.');
      assert.equal(note.split('The server is busy').length - 1, 1, `stuttered: ${note}`);
    } finally { calls.restore(); }
  });

  test('THREAD_SELECTED says created:true for newThread and nothing for selectThread', async () => {
    // The model picker writes a held pick (one made before any thread existed) onto a BRAND NEW
    // thread only: applying it on every selection pinned old chats to a model they never used.
    const { app, controller } = await makeWorld();
    const seen = [];
    app.bus.on(EV.THREAD_SELECTED, (p) => seen.push({ id: p.threadId, created: !!p.created }));
    const thread = controller.newThread();
    await controller.selectThread(thread.id);
    await controller.selectThread(null);
    assert.deepEqual(seen, [
      { id: thread.id, created: true },
      { id: thread.id, created: false },
      { id: null, created: false },
    ]);
  });

  test('meta.budget is the token COUNT, not the FarmCaps budget object (§3.3)', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse([chunk({ content: 'ok' }), usageChunk(1)]));
    try {
      const seen = [];
      app.registry.add(SLOTS.REQUEST_TRANSFORMS, { id: 'budget-spy', order: 900, apply: (req) => { seen.push(req.meta.budget); } });
      controller.newThread();
      await controller.send({ text: 'how big is the window?', parts: [], model: 'assistant' });
      await settle();
      assert.deepEqual(seen, [16384], 'P2-U2 planTrim/gateVerdict and the §3.9 meter all want a number');
    } finally { calls.restore(); }
  });
  // ---------------------------------------------------------------- fix round 2

  test('deleting the thread a reply streams into: the request is aborted and nothing is written back', async () => {
    // The generation used to run on after the delete: the farm kept generating (and kept the seat
    // it gave this client), the governor stayed busy so every later send was refused, and the last
    // checkpoint re-inserted the assistant row into a thread that no longer existed.
    const { app, controller } = await makeWorld();
    let aborted = false;
    const calls = stubFetch((init) => {
      if (init && init.signal) init.signal.addEventListener('abort', () => { aborted = true; });
      return sseResponse(Array.from({ length: 400 }, (_, i) => chunk({ content: `tok${i} ` })), { gapMs: 5 })(init);
    });
    try {
      const thread = controller.newThread();
      const sent = controller.send({ text: 'a long one', parts: [], model: 'assistant' });
      await sleep(40);
      assert.equal(controller.isStreaming(), true);

      assert.equal(await controller.abortThread(thread.id), true, 'the streaming thread is the one being deleted');
      await app.repo.deleteThread(thread.id);
      await sent;
      await settle();

      assert.equal(aborted, true, 'the POST really reached the server’s abort, not just the promise');
      assert.equal(controller.isStreaming(), false);
      assert.equal(app.gov.state().foreground, 'idle', 'the composer can send again');
      assert.equal(await app.repo.getThread(thread.id), null);
      const orphans = [];
      await app.repo.scanMessages((m) => { if (m.threadId === thread.id) orphans.push(m); });
      assert.deepEqual(orphans, [], 'no message survived the thread it belonged to');
    } finally { calls.restore(); }
  });

  test('a delete that RACES the stream (no abortThread) still leaves no orphan message', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse(Array.from({ length: 400 }, (_, i) => chunk({ content: `tok${i} ` })), { gapMs: 5 }));
    try {
      const thread = controller.newThread();
      const sent = controller.send({ text: 'a long one', parts: [], model: 'assistant' });
      await sleep(60);
      await app.repo.deleteThread(thread.id);      // straight through, as any other caller might
      await sent;
      await settle();
      assert.equal(controller.isStreaming(), false);
      assert.equal(app.gov.state().foreground, 'idle');
      const orphans = [];
      await app.repo.scanMessages((m) => { if (m.threadId === thread.id) orphans.push(m); });
      assert.deepEqual(orphans, [], 'the checkpoint/finalize of a deleted thread is a no-op');
    } finally { calls.restore(); }
  });

  test('abortThread ignores a thread that is not the one streaming', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch(sseResponse(Array.from({ length: 200 }, (_, i) => chunk({ content: `tok${i} ` })), { gapMs: 5 }));
    try {
      const thread = controller.newThread();
      const sent = controller.send({ text: 'long', parts: [], model: 'assistant' });
      await sleep(40);
      assert.equal(await controller.abortThread('some-other-thread'), false);
      assert.equal(controller.isStreaming(), true, 'the wrong id must not stop the reply');
      controller.stop();
      await sent;
      await settle();
      assert.equal(app.gov.state().foreground, 'idle');
      void thread;
    } finally { calls.restore(); }
  });

  test('a repo.finalize that rejects still ENDS the stream, so the row can be repainted', async () => {
    // `const stream = …` used to live inside the try, so the catch could not end it: the row stayed
    // `streaming` for ever and thread-view's ensureRow() then skipped every later repaint.
    const { app, controller, view } = await makeWorld();
    const calls = stubFetch(sseResponse([chunk({ content: 'hello' }), usageChunk(1)]));
    const realFinalize = app.repo.finalize;
    app.repo.finalize = async () => { throw new Error('the store said no'); };
    try {
      const thread = controller.newThread();
      const out = await controller.generate({ threadId: thread.id, parentId: null, model: 'assistant' });
      assert.equal(out.status, 'error');
      assert.equal(view.calls.begin.length, 1, 'the stream was opened');
      assert.equal(view.calls.ends.length, 1, 'and it was ended, on the error path too');
      assert.equal(view.calls.ends[0].status, 'error');
      assert.equal(app.gov.state().foreground, 'idle');
    } finally {
      app.repo.finalize = realFinalize;
      calls.restore();
    }
  });

  test('no farm at all: a local note, and no request to `null/chat/completions`', async () => {
    const farm = fakeFarm({ present: false, baseUrl: null, defaultModel: null, models: [] });
    const { app, controller } = await makeWorld({ farm });
    const calls = stubFetch(sseResponse([chunk({ content: 'never' })]));
    try {
      const thread = controller.newThread();
      await controller.send({ text: 'anyone there?', parts: [], model: null });
      await settle();
      assert.equal(calls.length, 0, 'the pipeline must not build a request against a null baseUrl');
      const path = await app.repo.getPath(thread.id);
      const last = path[path.length - 1];
      assert.equal(last.role, 'assistant');
      assert.equal(last.status, 'error');
      assert.match(last.error.message, /No farm yet/);
      assert.equal(app.gov.state().foreground, 'idle');
    } finally { calls.restore(); }
  });

  test('the composer’s busy state is DERIVED from the governor: a handler’s hold survives', async () => {
    // §3.6.2: "gov release (a hold placed by a handler survives)". The finally used to call
    // setBusy(false) unconditionally, so Send came back while the governor was still held — and
    // the composer’s own doSubmit then refused every click, with Stop hidden.
    const { app, controller, composer } = await makeWorld();
    app.registry.add(SLOTS.ERROR_HANDLERS, {
      id: 'seat-wait',
      order: 100,
      handle: () => { app.gov.hold('seat-wait', { cancel: () => {} }); return true; },
    });
    const calls = stubFetch(() => new Response('{"error":{"message":"no seats"}}', { status: 429 }));
    try {
      const thread = controller.newThread();
      await controller.generate({ threadId: thread.id, parentId: null, model: 'assistant' });
      await settle();
      assert.equal(app.gov.state().foreground, 'held', 'the handler’s hold is still in place');
      assert.equal(composer.calls.busy[composer.calls.busy.length - 1], true, 'so the composer stays on Stop');
      app.gov.release('seat-wait');
      assert.equal(app.gov.state().foreground, 'idle');
    } finally { calls.restore(); }
  });
};
