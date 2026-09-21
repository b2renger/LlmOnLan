// @ts-check
// C2-U3 in Node: the two bridges between the canvas and the conversation — `From thread` and
// `To thread` (plan §2.6 BH-1/BH-6/BH-7, docs/LOLCHAT_COMPUTER_SPEC.md §3).
//
// What these tests are really about is the pair of promises the bridges make:
//   - From thread reads the conversation through `repo.getPath()` — the branch the reader is on —
//     and REFUSES (never invents) when the message it means is missing, still streaming, or has no
//     text of its own.
//   - To thread writes exactly ONE message per run through `repo.appendMessage()`, tells the view
//     only when that thread is on screen, emits EV.MESSAGE_PUT, and resolves `null` — the one part
//     in C2 whose `output` is null (BH-6), which the runner must mark `done` rather than failing.
// The DOM half (what the parts paint, and that they clean up) rides the unit runner's DOM shim;
// the wire-level half is the harness (scenarios/c2-bridges.mjs).

import assert from 'node:assert/strict';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import { EV } from '../../../renderer/chat/core/events.mjs';
import { createDoc, addPart, addWire, patchPart } from '../../../renderer/chat/graph/model.mjs';
import { valueOf, listOf } from '../../../renderer/chat/graph/values.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import { createRunner } from '../../../renderer/chat/graph/runner.mjs';
import { fromThread, pick, messageText, optionLabel, sourceOf, SOURCES } from '../../../renderer/chat/graph/parts/from-thread.mjs';
import { toThread, bodyOf, roleOf, ROLES } from '../../../renderer/chat/graph/parts/to-thread.mjs';

const SPECS = specMap();
let seq = 0;
const newId = () => `p${++seq}`;
const now = () => 1000;

/** Run `fn` with the unit runner's DOM shim installed as `globalThis.document`. */
async function withDom(fn) {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = doc;
  try { return await fn(doc); } finally {
    if (had) /** @type {any} */ (globalThis).document = prev;
    else delete (/** @type {any} */ (globalThis).document);
  }
}

/** A message as the repo really shapes one. */
function msg(id, role, content, extra = {}) {
  return { id, threadId: 'th1', role, content, parts: [{ type: 'text', text: content }], status: 'done', ...extra };
}

/** A path: question, answer, question, answer. */
const PATH = [
  msg('m1', 'user', 'first question'),
  msg('m2', 'assistant', 'first answer'),
  msg('m3', 'user', 'second question'),
  msg('m4', 'assistant', 'second answer'),
];

/** An app with just the doors the bridges use, recording everything they do. */
function fakeApp(path = PATH, { threadId = 'th1' } = {}) {
  /** @type {any[]} */ const appended = [];
  /** @type {any[]} */ const upserted = [];
  /** @type {any[]} */ const events = [];
  let n = 0;
  const app = {
    now,
    state: { threadId },
    repo: {
      getPath: async (/** @type {string} */ id) => (id === 'th1' ? path.slice() : []),
      appendMessage(/** @type {string} */ id, /** @type {any} */ partial) {
        const created = { id: `new${++n}`, threadId: id, parentId: null, createdAt: now(), ...partial };
        appended.push(created);
        return created;
      },
    },
    view: { upsert: (/** @type {any} */ m) => { upserted.push(m); return null; } },
    bus: { emit: (/** @type {string} */ type, /** @type {any} */ payload) => events.push({ type, payload }) },
  };
  return { app, appended, upserted, events };
}

/** What the runner hands a part's run(). */
function runInput(part, inputs, app, thread = { id: 'th1' }) {
  return { part, inputs, app, ask: null, signal: new AbortController().signal, thread, cache: true };
}

/** The error a part threw, or null when it resolved. */
async function failure(promise) {
  try { await promise; return null; } catch (err) { return /** @type {any} */ (err); }
}

export default (test) => {
  // ---- From thread: the pure half -----------------------------------------------------------

  test('pick() takes the LAST message of the kind asked for, from the end of the branch', () => {
    assert.equal(pick(PATH, { source: 'lastAnswer' }).id, 'm4');
    assert.equal(pick(PATH, { source: 'lastQuestion' }).id, 'm3');
    assert.equal(pick(PATH, {}).id, 'm4', 'the default is the current answer');
    assert.equal(pick(PATH, { source: 'nonsense' }).id, 'm4', 'an unknown source falls back, it does not throw');
    assert.deepEqual(SOURCES, ['lastAnswer', 'lastQuestion', 'message']);
    assert.equal(sourceOf({ source: 'message' }), 'message');
  });

  test('pick() by id never substitutes a neighbour, and an empty thread picks nothing', () => {
    assert.equal(pick(PATH, { source: 'message', messageId: 'm2' }).id, 'm2');
    assert.equal(pick(PATH, { source: 'message', messageId: 'gone' }), null, 'a missing id is null, not "the nearest"');
    assert.equal(pick(PATH, { source: 'message', messageId: '' }), null, 'no id chosen yet is null');
    assert.equal(pick([], { source: 'lastAnswer' }), null);
    assert.equal(pick(null, { source: 'lastAnswer' }), null, 'a path that never loaded is not a crash');
  });

  test('messageText() prefers content and falls back to the text parts', () => {
    assert.equal(messageText(msg('a', 'user', 'hello')), 'hello');
    assert.equal(messageText({ id: 'b', role: 'user', content: '', parts: [{ type: 'text', text: 'from parts' }] }), 'from parts');
    assert.equal(messageText({ id: 'c', role: 'user', content: '  ', parts: [{ type: 'image', id: 'i1' }] }), '',
      'a message that is only an attachment has no text — which the part refuses rather than sending ""');
    assert.equal(messageText(null), '');
  });

  test('optionLabel() says who spoke and shortens what they said', () => {
    const long = msg('m', 'assistant', 'x'.repeat(200));
    const label = optionLabel(long);
    assert.ok(label.includes(t('parts.fromThreadWhoAssistant')), 'the role is named');
    assert.ok(label.length < 100, `one option stays one line: ${label.length}`);
    assert.ok(label.endsWith('…'), 'and says it was cut');
    assert.ok(optionLabel(msg('m', 'user', 'short')).includes(t('parts.fromThreadWhoYou')));
    assert.ok(optionLabel(msg('m', 'user', 'a\n\nb')).includes('a b'), 'newlines collapse so the option cannot break the row');
  });

  // ---- From thread: run() -------------------------------------------------------------------

  test('From thread answers the last answer as a text value, read through repo.getPath', async () => {
    const f = fakeApp();
    const part = { id: 'p', type: 'from-thread', settings: { source: 'lastAnswer' } };
    const value = await fromThread.run(runInput(part, {}, f.app));
    assert.deepEqual(value, valueOf('text', 'second answer'));
    const q = await fromThread.run(runInput({ ...part, settings: { source: 'lastQuestion' } }, {}, f.app));
    assert.equal(/** @type {any} */ (q).data, 'second question');
    const one = await fromThread.run(runInput({ ...part, settings: { source: 'message', messageId: 'm2' } }, {}, f.app));
    assert.equal(/** @type {any} */ (one).data, 'first answer');
    assert.equal(f.appended.length, 0, 'reading the thread never writes to it');
  });

  test('From thread refuses, in the reader\'s own words, instead of answering ""', async () => {
    const f = fakeApp();
    const part = { id: 'p', type: 'from-thread', settings: { source: 'lastAnswer' } };

    const noThread = await failure(fromThread.run(runInput(part, {}, f.app, null)));
    assert.equal(noThread.message, t('parts.errNoThread'));
    assert.equal(noThread.reason, 'invalid');

    const empty = fakeApp([]);
    const none = await failure(fromThread.run(runInput(part, {}, empty.app)));
    assert.equal(none.message, t('parts.errNoMessage'));
    assert.equal(none.reason, 'empty', 'a missing message is not a farm failure');

    const streaming = fakeApp([msg('m1', 'user', 'q'), msg('m2', 'assistant', 'half an ans', { status: 'streaming' })]);
    const mid = await failure(fromThread.run(runInput(part, {}, streaming.app)));
    assert.equal(mid.message, t('parts.errStillWriting'),
      'half an answer on the canvas is indistinguishable from a whole one — so it is refused');

    const blank = fakeApp([msg('m1', 'assistant', '   ')]);
    const nothing = await failure(fromThread.run(runInput(part, {}, blank.app)));
    assert.equal(nothing.message, t('parts.errEmptyMessage'));

    const gone = await failure(fromThread.run(runInput({ ...part, settings: { source: 'message', messageId: 'nope' } }, {}, f.app)));
    assert.equal(gone.message, t('parts.errNoMessage'));
  });

  // ---- To thread: the pure half --------------------------------------------------------------

  test('bodyOf() joins every wired value into ONE message, under an optional line', () => {
    const values = [valueOf('text', 'one'), valueOf('text', 'two')];
    assert.equal(bodyOf(values, ''), 'one\n\ntwo', 'two wires are two paragraphs, never two turns');
    assert.equal(bodyOf(values, 'Here:'), 'Here:\n\none\n\ntwo');
    assert.equal(bodyOf([valueOf('text', ' '), valueOf('text', 'kept')], ''), 'kept', 'an empty value does not leave a hole');
    assert.equal(bodyOf([], 'Here:'), '', 'a prefix alone is not something to post');
    assert.equal(bodyOf([listOf([valueOf('text', 'a'), valueOf('text', 'b')])], ''), 'a\nb', 'a list posts as its items');
    assert.deepEqual(ROLES, ['assistant', 'user']);
    assert.equal(roleOf({ role: 'user' }), 'user');
    assert.equal(roleOf({ role: 'system' }), 'assistant', 'only the two roles a conversation has');
  });

  // ---- To thread: run() ----------------------------------------------------------------------

  test('To thread appends exactly one message, shows it, announces it, and returns null', async () => {
    const f = fakeApp();
    const part = { id: 'pt', type: 'to-thread', settings: { role: 'assistant', prefix: '' } };
    const out = await toThread.run(runInput(part, { value: [valueOf('text', 'the result')] }, f.app));

    assert.equal(out, null, 'a part with no output resolves null (BH-6)');
    assert.equal(f.appended.length, 1, 'ONE message per run');
    assert.equal(f.appended[0].role, 'assistant');
    assert.equal(f.appended[0].content, 'the result');
    assert.deepEqual(f.appended[0].parts, [{ type: 'text', text: 'the result' }], 'a text part, which the view renders through the safe renderer');
    assert.equal(f.appended[0].status, 'done');
    assert.equal(f.appended[0].params.source, 'computer', 'the message says where it came from');
    assert.equal(f.upserted.length, 1, 'the open conversation shows it at once');
    assert.equal(f.upserted[0].id, f.appended[0].id, 'the SAME record the repo wrote, never a copy');
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].type, EV.MESSAGE_PUT);
  });

  test('To thread posts as the reader when asked, and puts the prefix above the value', async () => {
    const f = fakeApp();
    const part = { id: 'pt', type: 'to-thread', settings: { role: 'user', prefix: 'Summary:' } };
    await toThread.run(runInput(part, { value: [valueOf('text', 'body')] }, f.app));
    assert.equal(f.appended[0].role, 'user');
    assert.equal(f.appended[0].content, 'Summary:\n\nbody');
  });

  test('To thread never paints into a conversation that is not on screen', async () => {
    const f = fakeApp(PATH, { threadId: 'another-thread' });
    const part = { id: 'pt', type: 'to-thread', settings: {} };
    await toThread.run(runInput(part, { value: [valueOf('text', 'the result')] }, f.app));
    assert.equal(f.appended.length, 1, 'the message is still written to ITS thread');
    assert.equal(f.upserted.length, 0, 'but the view the reader is looking at is left alone');
    assert.equal(f.events.length, 1, 'the sidebar still hears about it');
  });

  test('To thread refuses to post nothing, and refuses without a conversation', async () => {
    const f = fakeApp();
    const part = { id: 'pt', type: 'to-thread', settings: {} };

    const empty = await failure(toThread.run(runInput(part, { value: [valueOf('text', '   ')] }, f.app)));
    assert.equal(empty.message, t('parts.errNothingToPost'));
    assert.equal(empty.reason, 'empty');
    assert.equal(f.appended.length, 0, 'and nothing was written');

    const noThread = await failure(toThread.run(runInput(part, { value: [valueOf('text', 'x')] }, f.app, null)));
    assert.equal(noThread.message, t('parts.errNoThread'));
    assert.equal(f.appended.length, 0);
  });

  // ---- the catalogue and the DOM -------------------------------------------------------------

  test('the bridges declare the shapes the engine reads', () => {
    const from = SPECS.get('from-thread');
    const to = SPECS.get('to-thread');
    assert.equal(from.inputs.length, 0, 'From thread is a source: it has no input port');
    assert.equal(from.output, 'text');
    assert.equal(from.thinks, false, 'reading the thread is free — it must not count against the cap');
    assert.equal(to.output, null, 'To thread is the one part with no output (BH-6)');
    assert.equal(to.thinks, false);
    assert.equal(to.inputs[0].many, true, 'several wires may feed one post');
    assert.equal(to.inputs[0].required, true);
  });

  test('both bridges render, follow an external edit and clean up after themselves', async () => {
    await withDom(async () => {
      for (const spec of [fromThread, toThread]) {
        const host = document.createElement('div');
        const part = { id: 'x', type: spec.type, state: 'idle', value: null, settings: spec.defaults() };
        /** @type {any[]} */ const patches = [];
        const ctx = {
          app: { state: { threadId: null }, repo: null },
          part,
          update: (p) => { patches.push(p); Object.assign(part.settings, p); },
          commit: () => {},
          open: () => {},
        };
        const view = spec.render(host, part, ctx);
        assert.ok(host.children.length, `${spec.type} painted something`);
        view.update({ ...part, state: 'done', settings: part.settings });
        view.destroy();
        assert.equal(host.children.length, 0, `${spec.type} left nothing behind`);
      }
    });
  });

  test('To thread says whether it has posted yet, and From thread only offers the chooser it needs', async () => {
    await withDom(async () => {
      const host = document.createElement('div');
      const part = { id: 'x', type: 'to-thread', state: 'stale', value: null, settings: toThread.defaults() };
      const view = toThread.render(host, part, { app: {}, part, update() {}, commit() {}, open() {} });
      const note = host.querySelector('.graph-part-note');
      assert.equal(note.textContent, t('parts.toThreadHint'));
      view.update({ ...part, state: 'done' });
      assert.equal(note.textContent, t('parts.toThreadPosted'), 'the part itself reports the post');
      view.destroy();

      const fhost = document.createElement('div');
      const fpart = { id: 'y', type: 'from-thread', state: 'idle', value: null, settings: fromThread.defaults() };
      const fview = fromThread.render(fhost, fpart, {
        app: { state: { threadId: null }, repo: null }, part: fpart, update() {}, commit() {}, open() {},
      });
      const rows = fhost.querySelectorAll('.graph-part-field');
      assert.equal(rows.length, 2, 'the source picker and the message chooser');
      assert.equal(rows[1].hidden, true, 'the chooser is hidden until a chosen message is what you asked for');
      fview.update({ ...fpart, settings: { source: 'message', messageId: '' } });
      assert.equal(rows[1].hidden, false, 'and appears when it is');
      fview.destroy();
    });
  });

  // ---- through the real runner ----------------------------------------------------------------

  test('the runner marks To thread done with no value, and the post really happened', async () => {
    const f = fakeApp();
    let doc = createDoc({ id: 'g1', threadId: 'th1', now });
    const a = addPart(doc, { type: 'note', x: 0, y: 0, settings: { text: 'a graph result' } }, { specs: SPECS, newId, now });
    doc = a.doc;
    const b = addPart(doc, { type: 'to-thread', x: 200, y: 0 }, { specs: SPECS, newId, now });
    doc = b.doc;
    const w = addWire(doc, { from: a.part.id, to: b.part.id, port: 'value' }, { specs: SPECS, newId, now });
    assert.equal(w.ok, true, 'a Note may feed To thread');
    doc = w.doc;

    const session = {
      specs: SPECS,
      doc: () => doc,
      thread: () => ({ id: 'th1' }),
      patchPart(id, patch) { doc = patchPart(doc, id, patch, { now }); },
      patchParts(ids, patch) { for (const id of ids) doc = patchPart(doc, id, patch, { now }); },
    };
    const runner = createRunner({ session: /** @type {any} */ (session), app: f.app });
    const report = await runner.run();

    assert.deepEqual(report.errors, [], 'a part with no output is not a failure (BH-6)');
    assert.equal(report.ran, 2);
    const posted = doc.parts.find((/** @type {any} */ p) => p.type === 'to-thread');
    assert.equal(posted.state, 'done');
    assert.equal(posted.value, null, 'and it holds no invented value');
    assert.equal(f.appended.length, 1, 'exactly one message reached the conversation');
    assert.equal(f.appended[0].content, 'a graph result');

    // Running again with nothing dirty must not post a second copy.
    const again = await runner.run();
    assert.equal(again.ran, 0, 'an up-to-date graph runs nothing');
    assert.equal(f.appended.length, 1, 'so the conversation is not spammed by a re-run');
  });
};
