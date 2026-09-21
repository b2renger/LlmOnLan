// The behavioural order test for REQUEST_TRANSFORMS (plan §3.6.3). INTEGRATOR-OWNED: created at the
// P2 kickoff with the two cases that can run today, extended at the P2 landing (`budget-trim`
// reserve, `regenerate-with` call params) and again at the P3/P4 landings.
//
// It asserts RESULTS, never order numbers: it imports the REAL modules that register transforms,
// installs them on a real app + real repo, and runs the whole chain through
// `controller.preview()` — the one call that is exactly "draftFromPath → every REQUEST_TRANSFORM in
// order", with no network and no writes.
//
// A module whose unit has not landed yet makes its case SKIP with a loud name. The P2 landing gate
// requires this file to report 0 skipped (§2.6 AH).

import assert from 'node:assert/strict';
import { createApp } from '../../../renderer/chat/core/app.mjs';
import { SLOTS } from '../../../renderer/chat/core/registry.mjs';
import { openRepoSync } from '../../../renderer/chat/state/repo.mjs';
import { createMemoryBackend } from '../../../renderer/chat/state/backend-memory.mjs';
import { createGovernor } from '../../../renderer/chat/net/governor.mjs';
import { createController } from '../../../renderer/chat/app/controller.mjs';
import { toOpenAIBody } from '../../../renderer/chat/net/request.mjs';
import '../../../renderer/chat/strings/core.en.mjs';
import '../../../renderer/chat/strings/net.en.mjs';
import '../../../renderer/chat/strings/composer.en.mjs';

/** Import a module that may not be written yet; null when it is not on disk. */
async function tryImport(rel) {
  try {
    return await import(new URL(rel, import.meta.url).href);
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (/Cannot find module|ERR_MODULE_NOT_FOUND/i.test(msg)) return null;
    throw err;                                  // a module that EXISTS and throws is a real failure
  }
}

// ------------------------------------------------------------------------------- a headless world

/** The §3.5 Els, built from the unit runner's DOM shim, so a ui/* install() can run in Node. */
function shimEls(doc) {
  const el = () => doc.createElement('div');
  return {
    root: el(), side: el(), sideHead: el(), newBtn: el(), sideTools: el(), list: el(), sideFoot: el(),
    main: el(), banner: el(), topline: el(), header: el(), model: doc.createElement('select'),
    strip: el(), messages: el(), jump: doc.createElement('button'), empty: el(),
    form: doc.createElement('form'), above: el(), tray: el(), tools: el(),
    input: doc.createElement('textarea'), meter: el(), send: doc.createElement('button'),
    stop: doc.createElement('button'), live: el(),
  };
}

/** Make `document` exist for the duration of a UI module's install(app). Restored by the caller. */
function withShimDocument() {
  const doc = globalThis.__chatTestDom.createDocument();
  doc.body = doc.createElement('body');
  doc.documentElement = doc.createElement('html');
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};
  doc.getElementById = () => null;
  doc.querySelector = () => null;
  doc.querySelectorAll = () => [];
  const hadDoc = 'document' in globalThis;
  const hadWin = 'window' in globalThis;
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  globalThis.document = doc;
  if (!hadWin) globalThis.window = globalThis;
  return {
    doc,
    restore() {
      if (hadDoc) globalThis.document = prevDoc; else delete globalThis.document;
      if (hadWin) globalThis.window = prevWin; else delete globalThis.window;
    },
  };
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
    update: () => {}, get: () => caps, headers: () => ({}),
    fetchModels: async () => ({ ids: caps.models.map((m) => m.id), state: 'ok' }),
    modelInfo: (id) => caps.models.find((m) => m.id === id) || null,
    setCapResolver: () => {}, cap: () => 'unknown',
  };
}

/**
 * A real app with a real repo, governor and controller (which registers `params-resolve`), plus a
 * seeded thread and one user turn. `installs` are the REAL feature modules under test.
 * @param {{installs?: any[], thread?: object}} [o]
 */
async function makeWorld(o = {}) {
  const dom = withShimDocument();
  const els = shimEls(dom.doc);
  const app = createApp({ root: /** @type {any} */ (els.root), els: /** @type {any} */ (els) });
  app.repo = openRepoSync({ openPersistent: () => createMemoryBackend({ kind: 'idb' }), bus: app.bus, now: app.now, newId: app.newId });
  app.farm = /** @type {any} */ (fakeFarm(o.farm || {}));
  app.gov = createGovernor(app);
  app.view = /** @type {any} */ ({
    showPath: () => {}, upsert: () => {}, remove: () => {},
    beginStream: () => ({ paint: () => {}, setStatus: () => {}, end: () => {} }),
    scrollToMessage: () => {}, isStuck: () => true, setOutsideContext: () => {}, rowOf: () => null,
    debug: { paintStats: () => ({ count: 0, p50: 0, p95: 0, max: 0 }), renderOneShot: () => null },
  });
  app.composer = /** @type {any} */ ({ setBusy: () => {}, focus: () => {}, setSendState: () => {}, getDraft: () => ({ text: '', parts: [] }), region: () => els.tools, on: () => () => {} });
  app.sidebar = /** @type {any} */ ({ render: () => {}, highlight: () => {} });
  app.dialogs = /** @type {any} */ ({ confirm: async () => true, prompt: async () => '', popover: () => ({ close() {} }), toast: () => {} });
  await app.repo.ready;
  const controller = createController(app);
  app.controller = /** @type {any} */ (controller);

  const thread = app.repo.createThread(o.thread || {});
  // `turns` seeds N complete exchanges BEFORE the question, for the cases that need history to trim.
  for (let i = 0; i < (Number(o.turns) || 0); i++) {
    const q = `turn ${i}: ${'how do I bevel an edge? '.repeat(40)}`;
    app.repo.appendMessage(thread.id, { role: 'user', content: q, parts: [{ type: 'text', text: q }], status: 'done' });
    const a = `answer ${i}: ${'select the edge and press ctrl+b. '.repeat(40)}`;
    app.repo.appendMessage(thread.id, { role: 'assistant', content: a, parts: [], status: 'done', model: 'assistant', underlying: 'Qwen3.8-27B-UD-Q2_K_XL' });
  }
  app.repo.appendMessage(thread.id, { role: 'user', content: 'How do I bevel an edge?', parts: [{ type: 'text', text: 'How do I bevel an edge?' }], status: 'done' });

  try {
    for (const mod of o.installs || []) mod.install(app);
  } finally {
    // The installs are done; nothing below needs a document, and leaving one on globalThis would
    // leak into the next test FILE (core.test.mjs traps these globals on purpose).
    dom.restore();
  }
  return { app, controller, thread, els };
}

/** The P4-U1 recipe transform, stubbed at its contract position (§3.6.3 order 100). */
function recipeTransform(app, { system = null, params = {} } = {}) {
  app.registry.add(SLOTS.REQUEST_TRANSFORMS, {
    id: 'recipe',
    order: 100,
    apply(req) {
      if (system != null) req.system = system;
      req.paramLayers.recipe = params;
    },
  });
}

// ------------------------------------------------------------------------------------- the cases

export default async (test) => {
  const threadHeader = await tryImport('../../../renderer/chat/ui/thread-header.mjs');
  const context = await tryImport('../../../renderer/chat/app/context.mjs');
  const messageActions = await tryImport('../../../renderer/chat/ui/message-actions.mjs');

  test('params-resolve: call > thread > recipe, and only the whitelist reaches the wire', async () => {
    const { app, controller, thread } = await makeWorld({ thread: { params: { temperature: 0.5, max_tokens: 512 } } });
    recipeTransform(app, { params: { temperature: 0.1, top_p: 0.9, max_tokens: 256 } });

    const req = await controller.preview({ threadId: thread.id, draft: { text: 'bevel', parts: [], model: 'assistant', params: { temperature: 1, seed: 7, stream: true } } });

    assert.equal(req.params.temperature, 1, 'the call layer wins');
    assert.equal(req.params.max_tokens, 512, 'the thread layer beats the recipe');
    assert.equal(req.params.top_p, 0.9, 'a recipe-only key survives');
    assert.equal(req.params.seed, 7);
    assert.equal('stream' in req.params, false, 'a non-whitelisted key never becomes a param');

    const body = toOpenAIBody(req, {});
    assert.equal(body.temperature, 1);
    assert.equal(body.max_tokens, 512);
    assert.equal(body.stream, true, 'stream is the wire flag, not a param');
  });

  const treeCase = threadHeader ? test : test.skip;
  treeCase(threadHeader
    ? 'thread-system: the thread override replaces the system prompt byte-for-byte, and later stages only append'
    : 'thread-system: SKIPPED — ui/thread-header.mjs (P2-U3) has not landed yet', async () => {
    const OVERRIDE = 'You are a Blender assistant.\n\nAnswer in French.  ';
    const { app, controller, thread } = await makeWorld({ installs: [threadHeader], thread: { systemOverride: OVERRIDE } });
    recipeTransform(app, { system: 'You are a recipe.' });
    // P4-U2's response-format transform in its prompt branch: order 500, appends, never assigns.
    app.registry.add(SLOTS.REQUEST_TRANSFORMS, {
      id: 'response-format-stub',
      order: 500,
      apply(req) { req.systemAppend.push('Answer as JSON.'); },
    });

    const req = await controller.preview({ threadId: thread.id, draft: { text: 'bevel', parts: [], model: 'assistant' } });

    assert.equal(req.system, OVERRIDE, 'byte-stable: no trim, no normalisation, the recipe lost');
    assert.deepEqual(req.systemAppend, ['Answer as JSON.']);

    const body = toOpenAIBody(req, {});
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[0].content, `${OVERRIDE}\n\nAnswer as JSON.`);
  });

  // --------------------------------------------------------------------------- P2 landing cases

  const budgetCase = context ? test : test.skip;
  budgetCase(context
    ? 'budget-trim: the reserve is the RESOLVED max_tokens, so a longer answer costs history'
    : 'budget-trim: SKIPPED — app/context.mjs (P2-U2) has not landed yet', async () => {
    // Two previews of the SAME thread on the SAME small farm: only the reply reserve differs.
    // `params-resolve` (250) has already merged call > thread > recipe when `budget-trim` (800)
    // reads max_tokens, so asking for a long answer must drop strictly more history.
    const small = { budget: { tokens: 4096, advertised: 4096, source: 'advertised' } };
    const roomy = await (async () => {
      const w = await makeWorld({ installs: [context], farm: small, turns: 12 });
      return w.controller.preview({ threadId: w.thread.id, draft: { text: 'and now?', parts: [], model: 'assistant', params: { max_tokens: 64 } } });
    })();
    const greedy = await (async () => {
      const w = await makeWorld({ installs: [context], farm: small, turns: 12 });
      return w.controller.preview({ threadId: w.thread.id, draft: { text: 'and now?', parts: [], model: 'assistant', params: { max_tokens: 3000 } } });
    })();

    assert.equal(roomy.params.max_tokens, 64);
    assert.equal(greedy.params.max_tokens, 3000);
    assert.equal(greedy.meta.reserve, 3000, 'the reserve is the resolved param, not a constant');
    assert.equal(roomy.meta.reserve, 64);
    assert.ok(roomy.messages.length > greedy.messages.length,
      `a 3000-token reply must cost history: ${roomy.messages.length} vs ${greedy.messages.length} messages`);
    assert.ok(greedy.messages.length >= 1, 'the newest user turn is never trimmed away');
    assert.equal(greedy.messages[greedy.messages.length - 1].blocks[0].text, 'and now?');
    // Nothing after 250 touches params: the trim only removes messages (§3.6.3).
    assert.deepEqual(Object.keys(greedy.params).sort(), Object.keys(roomy.params).sort());
    assert.ok(greedy.meta.trimmedIds.length > roomy.meta.trimmedIds.length,
      `the trim REPORTS what it dropped, for the dimmed rows (${roomy.meta.trimmedIds.length} vs ${greedy.meta.trimmedIds.length})`);
    assert.equal(greedy.meta.trimmedIds.length + greedy.messages.length, roomy.meta.trimmedIds.length + roomy.messages.length,
      'trimmed + sent is the same conversation in both previews');
  });

  const regenCase = messageActions ? test : test.skip;
  regenCase(messageActions
    ? 'regenerate-with: the popover option travels as the CALL layer and beats the thread'
    : 'regenerate-with: SKIPPED — ui/message-actions.mjs (P2-U3) has not landed yet', async () => {
    const { app, controller, thread } = await makeWorld({
      installs: [messageActions], thread: { params: { temperature: 0.5, max_tokens: 512 } },
    });
    recipeTransform(app, { params: { temperature: 0.1, top_p: 0.9 } });

    // Read the REAL built-ins off the slot rather than retyping their numbers here.
    const options = app.registry.list(SLOTS.REGENERATE_OPTIONS);
    const creative = options.find((o) => o.id === 'creative');
    const precise = options.find((o) => o.id === 'precise');
    assert.ok(creative && precise, 'both built-in regenerate options are registered');

    // What branching.regenerate() does with them: generate({params: opt.params}) → the call layer.
    const hot = await controller.preview({ threadId: thread.id, params: creative.params });
    const cold = await controller.preview({ threadId: thread.id, params: precise.params });

    assert.equal(hot.params.temperature, creative.params.temperature, 'the option beats the thread');
    assert.equal(cold.params.temperature, precise.params.temperature);
    assert.notEqual(hot.params.temperature, cold.params.temperature);
    assert.equal(hot.params.max_tokens, 512, 'the rest of the thread layer is untouched');
    assert.equal(hot.params.top_p, 0.9, 'and a recipe-only key still survives');
  });
};
