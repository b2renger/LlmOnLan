// The conversation tree (P2-U3) against the REAL repo (memory backend), the REAL governor and the
// REAL controller, with `fetch` stubbed. The planners are pure and are checked on records the repo
// actually wrote — the shapes a plan produces have to be appendMessage/createThread arguments, so
// testing them against hand-written literals would prove nothing.
//
// app/branching.mjs touches no DOM global, so the real module runs in Node; the view, composer,
// sidebar and dialogs are fakes that record what they were told.
import assert from 'node:assert/strict';
import { createApp } from '../../../renderer/chat/core/app.mjs';
import { EV } from '../../../renderer/chat/core/events.mjs';
import { SLOTS } from '../../../renderer/chat/core/registry.mjs';
import { API_KEYS } from '../../../renderer/chat/core/types.mjs';
import { openRepoSync } from '../../../renderer/chat/state/repo.mjs';
import { createMemoryBackend } from '../../../renderer/chat/state/backend-memory.mjs';
import { createGovernor } from '../../../renderer/chat/net/governor.mjs';
import { createController } from '../../../renderer/chat/app/controller.mjs';
import { install as installBranching, planRegenerate, planEdit, planFork } from '../../../renderer/chat/app/branching.mjs';
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

// ---------------------------------------------------------------------------------- fake world

function fakeView() {
  const calls = { showPath: [], upsert: [], removed: [] };
  return {
    calls,
    showPath: (thread, path, opts) => calls.showPath.push({ ids: (path || []).map((m) => m.id), opts }),
    upsert: (msg) => calls.upsert.push(msg.id),
    remove: (ids) => calls.removed.push(...(ids || [])),
    beginStream: () => ({ paint: () => {}, setStatus: () => {}, end: () => {} }),
    scrollToMessage: () => {},
    isStuck: () => true,
    setOutsideContext: () => {},
    rowOf: () => null,
    debug: { paintStats: () => ({ count: 0, p50: 0, p95: 0, max: 0 }), renderOneShot: () => null },
  };
}

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

/** A whole world: real app + repo + governor + controller, with branching installed. */
async function makeWorld({ confirm = async () => true } = {}) {
  const els = { live: { textContent: '' } };
  const app = createApp({ root: null, els: /** @type {any} */ (els) });
  app.repo = openRepoSync({ openPersistent: () => createMemoryBackend({ kind: 'idb' }), bus: app.bus, now: app.now, newId: app.newId });
  app.farm = /** @type {any} */ (fakeFarm());
  app.gov = createGovernor(app);
  app.view = /** @type {any} */ (fakeView());
  app.composer = /** @type {any} */ ({ setBusy: () => {}, focus: () => {} });
  const renders = { n: 0 };
  app.sidebar = /** @type {any} */ ({ render: () => { renders.n += 1; }, highlight: () => {} });
  const confirms = [];
  app.dialogs = /** @type {any} */ ({
    confirm: async (o) => { confirms.push(o); return confirm(o); },
    prompt: async () => '', popover: () => ({ close() {} }), toast: () => {},
  });
  await app.repo.ready;
  const controller = createController(app);
  app.controller = /** @type {any} */ (controller);
  const branching = installBranching(app);
  return { app, controller, branching, renders, confirms, view: /** @type {any} */ (app.view) };
}

// ---------------------------------------------------------------------------------- fake stream

const chunk = (delta, finish = null) => ({ id: 'x', object: 'chat.completion.chunk', model: 'assistant', choices: [{ index: 0, delta, finish_reason: finish }] });
const usageChunk = (completion, prompt = 7) => ({ id: 'x', object: 'chat.completion.chunk', model: 'assistant', choices: [], usage: { completion_tokens: completion, prompt_tokens: prompt, total_tokens: completion + prompt } });

/** An SSE response of `events`, one per microtask. */
function sseResponse(events) {
  return () => {
    const stream = new ReadableStream({
      start(ctrl) {
        const enc = new TextEncoder();
        void (async () => {
          for (const ev of events) {
            ctrl.enqueue(enc.encode(typeof ev === 'string' ? ev : `data: ${JSON.stringify(ev)}\n\n`));
            await Promise.resolve();
          }
          ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
          ctrl.close();
        })();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

/** Install a fetch stub answering with `text`; returns the recorded request bodies. */
function stubFetch(textFor) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    let body = null;
    try { body = JSON.parse(init.body); } catch { body = init.body; }
    calls.push({ url: String(url), body });
    const text = typeof textFor === 'function' ? textFor(body, calls.length - 1) : String(textFor);
    return sseResponse([chunk({ content: text }), usageChunk(3), chunk({}, 'stop')])();
  };
  calls.restore = () => { globalThis.fetch = realFetch; };
  return calls;
}

/** Send one user turn and wait for its reply to settle. */
async function sendTurn(app, controller, text) {
  await controller.send({ text, parts: [], model: 'assistant' });
  await settle();
  const path = (await app.repo.getPath(app.state.threadId)).slice();
  return path[path.length - 1];
}

// ---------------------------------------------------------------------------------- the tests

export default (test) => {
  test('the installed API is exactly API_KEYS.branching, and the SIBLINGS provider is registered', async () => {
    const { app, branching } = await makeWorld();
    assert.deepEqual(Object.keys(branching).sort(), [...API_KEYS.branching].sort());
    assert.equal(app.branching, branching, 'install() attaches it to the app');
    const provider = app.registry.first(SLOTS.SIBLINGS);
    assert.ok(provider, 'the controller asks for exactly one SIBLINGS provider');
    assert.equal(provider.id, 'tree');
  });

  // P2 review, blocker: regenerate() moved the persisted head to the branch point and editUser()
  // appended the new user turn BEFORE generate() asked the governor. On a busy slot — a running
  // stream, or a seat wait, which HOLDS the slot — the controller then only toasted, and nothing
  // put the head back: the reader's conversation collapsed to the first question, with no sibling
  // switcher to get out of it and no message saying why.
  test('regenerate and editUser refuse on a HELD slot, and write NOTHING', async () => {
    const { app, controller, branching } = await makeWorld();
    const calls = stubFetch('an answer');
    try {
      const thread = controller.newThread();
      const a1 = await sendTurn(app, controller, 'q1');
      await sendTurn(app, controller, 'q2');
      const before = await app.repo.getThread(thread.id);
      const messagesBefore = await app.repo.getMessages(thread.id);
      const user = messagesBefore.find((m) => m.role === 'user');
      const pathBefore = (await app.repo.getPath(thread.id)).map((m) => m.role);
      assert.deepEqual(pathBefore, ['user', 'assistant', 'user', 'assistant']);

      /** @type {string[]} */ const toasts = [];
      app.dialogs.toast = (text) => { toasts.push(text); };
      // Exactly what a seat wait does while it queues behind a full farm.
      app.gov.hold('some-waiting-msg-id', { note: 'Still waiting for a seat.' });
      const sent = calls.length;

      assert.equal(await branching.regenerate(a1), null, 'regenerate says no');
      await settle();
      assert.equal(await branching.editUser(user, 'q1 edited'), null, 'and so does an edit');
      await settle();

      const after = await app.repo.getThread(thread.id);
      assert.equal(after.headId, before.headId, 'the persisted head never moved');
      assert.equal((await app.repo.getMessages(thread.id)).length, messagesBefore.length, 'no orphan turn');
      assert.deepEqual((await app.repo.getPath(thread.id)).map((m) => m.role), pathBefore, 'the chat is intact');
      assert.equal(calls.length, sent, 'and nothing left the machine');
      assert.deepEqual(toasts, ['Still waiting for a seat.', 'Still waiting for a seat.'],
        'the hold says what it is, instead of "a reply is already running"');
    } finally { calls.restore(); }
  });

  test('regenerate refuses while a reply is STREAMING, with the ordinary sentence', async () => {
    const { app, controller, branching } = await makeWorld();
    const calls = stubFetch('an answer');
    try {
      const thread = controller.newThread();
      const a1 = await sendTurn(app, controller, 'q1');
      const before = await app.repo.getThread(thread.id);
      /** @type {string[]} */ const toasts = [];
      app.dialogs.toast = (text) => { toasts.push(text); };
      const release = app.gov.acquire('foreground', { holder: 'send' });
      assert.ok(release);

      assert.equal(await branching.regenerate(a1), null);
      await settle();
      assert.equal((await app.repo.getThread(thread.id)).headId, before.headId);
      assert.deepEqual(toasts, ['A reply is already running.']);
      release();
    } finally { calls.restore(); }
  });

  test('planRegenerate: another child of the same parent, and only for an assistant', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch('an answer');
    try {
      const thread = controller.newThread();
      const reply = await sendTurn(app, controller, 'How do I bevel?');
      const messages = await app.repo.getMessages(thread.id);
      const user = messages.find((m) => m.role === 'user');

      const plan = planRegenerate(messages, reply.id);
      assert.equal(plan.ok, true);
      assert.equal(plan.parentId, user.id, 'the new answer hangs off the same question');
      assert.equal(plan.threadId, thread.id);
      assert.equal(plan.siblingCount, 1, 'one answer so far');

      assert.equal(planRegenerate(messages, user.id).ok, false, 'a user message is not regenerated');
      assert.equal(planRegenerate(messages, user.id).reason, 'not-assistant');
      assert.equal(planRegenerate(messages, 'nope').ok, false);
    } finally { calls.restore(); }
  });

  test('regenerate: a second answer under the same question, with the call params winning', async () => {
    const { app, controller, branching } = await makeWorld();
    const calls = stubFetch((body) => `answer at ${body.temperature}`);
    try {
      const thread = controller.newThread();
      await app.repo.updateThread(thread.id, { params: { temperature: 0.5 } });
      const first = await sendTurn(app, controller, 'How do I bevel?');
      assert.equal(calls[0].body.temperature, 0.5, 'the thread layer set the first temperature');

      await branching.regenerate(first, { params: { temperature: 1 } });
      await settle();

      assert.equal(calls.length, 2);
      assert.equal(calls[1].body.temperature, 1, 'the CALL layer beats the thread (plan §3.6.3)');

      const messages = await app.repo.getMessages(thread.id);
      const answers = messages.filter((m) => m.role === 'assistant');
      assert.equal(answers.length, 2, 'the old answer is kept — nothing is overwritten');
      assert.equal(answers[0].parentId, answers[1].parentId, 'siblings');
      const record = await app.repo.getThread(thread.id);
      assert.equal(record.headId, answers[1].id, 'the head follows the newest branch');

      // the history the second request saw is the QUESTION, not the first answer
      const roles = calls[1].body.messages.map((m) => m.role);
      assert.deepEqual(roles, ['user'], 'a regenerate never sends the answer it is replacing');
    } finally { calls.restore(); }
  });

  test('the SIBLINGS provider reports position/count for the visible path only', async () => {
    const { app, controller, branching } = await makeWorld();
    const calls = stubFetch('answer');
    try {
      const thread = controller.newThread();
      const first = await sendTurn(app, controller, 'question');
      await branching.regenerate(first, {});
      await settle();

      const provider = app.registry.first(SLOTS.SIBLINGS);
      const record = await app.repo.getThread(thread.id);
      const path = await app.repo.getPath(thread.id);
      const map = await provider.provide(record, path);
      const head = path[path.length - 1];
      assert.equal(map.size, 1, 'only the message that HAS siblings is listed');
      assert.deepEqual(map.get(head.id), { position: 2, count: 2 });
    } finally { calls.restore(); }
  });

  test('switchSibling walks back to the first answer, moves the head and repaints', async () => {
    const { app, controller, branching, view } = await makeWorld();
    const calls = stubFetch('answer');
    try {
      const thread = controller.newThread();
      const first = await sendTurn(app, controller, 'question');
      await branching.regenerate(first, {});
      await settle();

      const before = view.calls.showPath.length;
      const headId = await branching.switchSibling((await app.repo.getThread(thread.id)).headId, -1);
      await settle();
      assert.equal(headId, first.id, 'one step back is the first answer');
      assert.equal((await app.repo.getThread(thread.id)).headId, first.id, 'persisted: a reload keeps it');
      assert.ok(view.calls.showPath.length > before, 'the view was repainted');

      // and forward again
      const forward = await branching.switchSibling(first.id, 1);
      assert.notEqual(forward, first.id);
      assert.equal(await branching.switchSibling(first.id, -1), null, 'there is nothing before the first');
    } finally { calls.restore(); }
  });

  test('EV.BRANCH_SWITCH from the ◀ ▶ buttons drives switchSibling', async () => {
    const { app, controller, branching } = await makeWorld();
    const calls = stubFetch('answer');
    try {
      const thread = controller.newThread();
      const first = await sendTurn(app, controller, 'question');
      await branching.regenerate(first, {});
      await settle();
      const head = (await app.repo.getThread(thread.id)).headId;

      app.bus.emit(EV.BRANCH_SWITCH, { messageId: head, dir: -1 });
      await settle();
      await settle();
      assert.equal((await app.repo.getThread(thread.id)).headId, first.id);
    } finally { calls.restore(); }
  });

  test('planEdit: a user sibling with the parts copied and the text replaced', async () => {
    const { app, controller } = await makeWorld();
    const calls = stubFetch('answer');
    try {
      const thread = controller.newThread();
      app.repo.appendMessage(thread.id, {
        role: 'user', content: 'bevel?', status: 'done',
        parts: [{ type: 'text', text: 'bevel?' }, { type: 'image', attId: 'att1' }],
      });
      await settle();
      const messages = await app.repo.getMessages(thread.id);
      const user = messages[0];

      const plan = planEdit(messages, user.id, 'chamfer?');
      assert.equal(plan.ok, true);
      assert.equal(plan.parentId, null, 'a first turn has no parent — the sibling is a second root');
      assert.equal(plan.message.content, 'chamfer?');
      assert.deepEqual(plan.message.parts, [{ type: 'text', text: 'chamfer?' }, { type: 'image', attId: 'att1' }]);
      assert.notEqual(plan.message.parts[1], user.parts[1], 'the parts are COPIES, not the originals');

      assert.equal(planEdit(messages, user.id, '   ').ok, false, 'an empty edit is not a send');
      assert.equal(planEdit(messages, 'nope', 'x').ok, false);

      const withoutText = planEdit([{ id: 'm1', threadId: thread.id, parentId: null, role: 'user', parts: [{ type: 'image', attId: 'a' }], content: '' }], 'm1', 'hello');
      assert.deepEqual(withoutText.message.parts[0], { type: 'text', text: 'hello' }, 'a message with no text part gets one, in front');
    } finally { calls.restore(); }
  });

  test('editUser: the old question and its answer stay in the tree, one branch away', async () => {
    const { app, controller, branching } = await makeWorld();
    const calls = stubFetch('answer');
    try {
      const thread = controller.newThread();
      const firstAnswer = await sendTurn(app, controller, 'bevel?');
      const firstUser = (await app.repo.getMessages(thread.id)).find((m) => m.role === 'user');

      await branching.editUser(firstUser, 'chamfer?');
      await settle();

      const messages = await app.repo.getMessages(thread.id);
      const users = messages.filter((m) => m.role === 'user');
      assert.equal(users.length, 2, 'the edit is a SIBLING, not a rewrite');
      assert.equal(users[0].content, 'bevel?', 'the original wording is untouched');
      assert.equal(users[1].content, 'chamfer?');
      assert.equal(users[1].parentId, users[0].parentId);
      assert.ok(messages.some((m) => m.id === firstAnswer.id), 'the first answer is still there');

      const path = await app.repo.getPath(thread.id);
      assert.deepEqual(path.map((m) => m.content), ['chamfer?', 'answer'], 'the new branch is the visible one');
      assert.equal(calls[1].body.messages[0].content, 'chamfer?', 'and it is what the farm was asked');
    } finally { calls.restore(); }
  });

  test('planFork: root→message copied with fresh ids, notes dropped, attachments listed', async () => {
    const { app, controller } = await makeWorld();
    const thread = controller.newThread();
    const u1 = app.repo.appendMessage(thread.id, { role: 'user', content: 'q1', status: 'done', parts: [{ type: 'doc', attId: 'att1', pages: null }] });
    const busy = app.repo.appendMessage(thread.id, { role: 'assistant', content: 'busy note', status: 'local', parentId: u1.id });
    const a1 = app.repo.appendMessage(thread.id, { role: 'assistant', content: 'a1', status: 'done', parentId: busy.id });
    await settle();

    let n = 0;
    const plan = planFork({
      thread,
      messages: await app.repo.getMessages(thread.id),
      messageId: a1.id,
      threadId: 'newthread',
      newId: () => `copy${++n}`,
      now: () => 1234,
      title: 'q1 (fork)',
    });

    assert.equal(plan.ok, true);
    assert.deepEqual(plan.messages.map((m) => m.content), ['q1', 'a1'], 'the local busy note is not history');
    assert.deepEqual(plan.messages.map((m) => m.id), ['copy1', 'copy2']);
    assert.equal(plan.messages[0].parentId, null);
    assert.equal(plan.messages[1].parentId, 'copy1', 'the chain is re-linked to the new ids');
    assert.equal(plan.messages[0].threadId, 'newthread');
    assert.deepEqual(plan.attachmentIds, ['att1']);
    assert.notEqual(plan.messages[0].parts[0], u1.parts[0], 'parts are copies');
    assert.equal(plan.init.title, 'q1 (fork)');
    assert.equal(plan.init.id, 'newthread');
    assert.equal(plan.init.createdAt, 1234);
    assert.equal(planFork({ thread, messages: [], messageId: 'nope', threadId: 'x', newId: () => 'y' }).ok, false);
  });

  test('fork: a new thread holding a copy, with its own attachment records, selected', async () => {
    const { app, controller, branching } = await makeWorld();
    const calls = stubFetch('answer');
    try {
      const thread = controller.newThread();
      const attId = await app.repo.putAttachment({ threadId: thread.id, name: 'a.txt', mime: 'text/plain', size: 3, sha256: 'abc', text: 'hey', status: 'ready' });
      app.repo.appendMessage(thread.id, { role: 'user', content: 'q1', status: 'done', parts: [{ type: 'doc', attId, pages: null }] });
      await settle();
      const answer = await sendTurn(app, controller, 'q2');

      const forked = await branching.fork(answer);
      await settle();

      assert.ok(forked && forked.id !== thread.id);
      assert.match(forked.title, /\(fork\)$/);
      assert.equal(app.state.threadId, forked.id, 'the fork is opened');

      const copied = await app.repo.getMessages(forked.id);
      assert.deepEqual(copied.map((m) => m.content), ['q1', 'q2', 'answer']);
      assert.ok(copied.every((m) => m.threadId === forked.id));
      const original = await app.repo.getMessages(thread.id);
      assert.equal(original.length, 3, 'the original thread is untouched');
      assert.ok(copied.every((m) => !original.some((o) => o.id === m.id)), 'fresh ids');

      const copiedAtt = (await app.repo.listAttachments(forked.id))[0];
      assert.ok(copiedAtt, 'the attachment came with it');
      assert.notEqual(copiedAtt.id, attId, 'as its own record');
      assert.equal(copied[0].parts[0].attId, copiedAtt.id, 'and the part points at the copy');
    } finally { calls.restore(); }
  });

  test('deleteSubtree: confirmed, the branch goes and the head is repaired', async () => {
    const { app, controller, branching, confirms, view } = await makeWorld();
    const calls = stubFetch('answer');
    try {
      const thread = controller.newThread();
      const first = await sendTurn(app, controller, 'q1');
      await branching.regenerate(first, {});
      await settle();
      const messages = await app.repo.getMessages(thread.id);
      const newest = messages.filter((m) => m.role === 'assistant')[1];

      const result = await branching.deleteSubtree(newest);
      await settle();

      assert.equal(confirms.length, 1, 'it asks first');
      assert.deepEqual(result.removed, [newest.id]);
      assert.ok(view.calls.removed.includes(newest.id), 'the row is dropped from the view');
      const after = await app.repo.getMessages(thread.id);
      assert.equal(after.length, 2, 'the sibling and the question survive');
      assert.equal((await app.repo.getThread(thread.id)).headId, first.id, 'the head is repaired onto what is left');
    } finally { calls.restore(); }
  });

  test('deleteSubtree: a refused confirm changes nothing', async () => {
    const { app, controller, branching } = await makeWorld({ confirm: async () => false });
    const calls = stubFetch('answer');
    try {
      const thread = controller.newThread();
      const first = await sendTurn(app, controller, 'q1');
      const result = await branching.deleteSubtree(first);
      await settle();
      assert.equal(result, null);
      assert.equal((await app.repo.getMessages(thread.id)).length, 2);
    } finally { calls.restore(); }
  });
};
