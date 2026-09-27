// K1-U1: the Computer's library store, its session and the `visible` rule, in Node.
//
// This file replaces chat/unit/graph-store.test.mjs (deleted with graph/store.mjs at the K1
// landing — COMPUTER_PLAN §3.7). Every assertion that file made about the debounce, the races and
// the "last doc wins" rule is re-expressed here against computer/docstore.mjs, and the ones that
// were ABOUT thread keying are replaced by their library equivalents:
//
//   - a document with `threadId: null` is WRITTEN and READ BACK. graph/store.mjs returned early on
//     `!doc.threadId` in both write() and put(), so a library document persisted nothing at all —
//     that early return is the bug this unit exists to remove (§0.3), and it is asserted, not
//     assumed;
//   - `list()` is the library and only the library: thread-owned rows belong to a chat;
//   - create / rename / duplicate / remove round-trip, and a duplicate shares no part object with
//     the original (an aliased array would make editing the copy edit the original);
//   - the session's `thread()` is a SHIM returning null — runner.mjs:371 passes it into every
//     spec.run() — and `docId()` is the question that replaced it;
//   - the `visible` predicate: true while an activation EXECUTES, false while the run is merely
//     parked, false when hidden and idle. That is the whole of §2.3's narrowed rule, and it is
//     the one thing in K1 that the harness structurally cannot see (a park needs K3's runner).
import assert from 'node:assert/strict';
import { createDocStore, SAVE_DEBOUNCE_MS, LAST_KEY, isLibraryRow } from '../../../renderer/chat/computer/docstore.mjs';
import { createSession } from '../../../renderer/chat/computer/host.mjs';
import { computeVisible, runnerExecuting } from '../../../renderer/chat/computer/visible.mjs';
import { createDoc, addPart } from '../../../renderer/chat/graph/model.mjs';
import { specs, ids, clock } from './graph-fixture.mjs';

const map = specs();
const tick = (ms) => new Promise((done) => setTimeout(done, ms));

/** A repo with the four graph doors and kv, whose putGraph can be held open. */
function fakeRepo({ rows = [] } = {}) {
  const puts = [];
  /** @type {Function[]} */ const gates = [];
  const kv = new Map();
  let hold = false;
  return {
    puts,
    rows,
    kv,
    holdWrites(on) { hold = on; },
    releaseAll() { const fns = gates.splice(0); for (const fn of fns) fn(); },
    listGraphs: async (threadId) => (threadId ? rows.filter((r) => r.threadId === threadId) : rows.slice()),
    getGraph: async (id) => rows.find((r) => r.id === id) || null,
    putGraph: async (doc) => {
      puts.push(doc);
      const i = rows.findIndex((r) => r.id === doc.id);
      if (i >= 0) rows[i] = doc; else rows.push(doc);
      if (hold) await new Promise((done) => gates.push(done));
    },
    deleteGraph: async (id) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    },
    kvGet: async (key, fallback = null) => (kv.has(key) ? kv.get(key) : fallback),
    kvSet: async (key, value) => { kv.set(key, value); },
  };
}

function fakeApp(repo) {
  return { repo, now: clock(), newId: ids('g') };
}

/** A runner as the `visible` rule reads it. */
const runnerLike = (o) => {
  const r = {};
  if ('executing' in o) r.executing = () => o.executing;
  if ('running' in o) r.running = () => o.running;
  return r;
};

export default (test) => {
  // ---- the bug this file exists to prove is gone --------------------------------------------

  test('a threadless document is WRITTEN and read back — the library bug (§0.3) is gone', async () => {
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const store = createDocStore({ app, specs: map, debounceMs: 5 });
    const doc = createDoc({ id: 'lib-1', threadId: null, now: app.now, title: 'a library graph' });
    store.put(doc);
    await store.flush();
    assert.equal(repo.puts.length, 1, 'graph/store.mjs wrote ZERO here: !doc.threadId returned early');
    assert.equal(repo.rows[0].threadId, null, 'and threadId: null is what marks it as the library’s');
    const back = await store.load('lib-1');
    assert.equal(back.doc.id, 'lib-1');
    assert.equal(back.doc.title, 'a library graph');
    assert.equal(back.created, false);
  });

  test('the debounce is still 500 ms and two hundred edits still cost ONE write', async () => {
    assert.equal(SAVE_DEBOUNCE_MS, 500);
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const store = createDocStore({ app, specs: map, debounceMs: 5 });
    let doc = createDoc({ id: 'g1', threadId: null, now: app.now });
    for (let i = 0; i < 200; i++) {
      doc = { ...doc, rev: i };
      store.put(doc);
    }
    assert.equal(repo.puts.length, 0, 'nothing is written while the edits keep coming');
    await store.flush();
    assert.equal(repo.puts.length, 1, 'one write');
    assert.equal(repo.puts[0].rev, 199, 'and it is the LAST document, not the first');
  });

  test('pending() stays true until the write has really landed', async () => {
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const store = createDocStore({ app, specs: map, debounceMs: 5 });
    store.put(createDoc({ id: 'g1', threadId: null, now: app.now }));
    assert.equal(store.pending(), true, 'queued, timer running');
    repo.holdWrites(true);
    const flushed = store.flush();
    await tick(0);
    assert.equal(store.pending(), true, 'the write is in flight — the store is NOT settled');
    repo.holdWrites(false);
    repo.releaseAll();
    await flushed;
    assert.equal(store.pending(), false, 'now it is');
  });

  test('two overlapping flushes write the newest doc exactly once, in order', async () => {
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const store = createDocStore({ app, specs: map, debounceMs: 1000 });
    const base = createDoc({ id: 'g1', threadId: null, now: app.now });
    repo.holdWrites(true);
    store.put({ ...base, rev: 1 });
    const first = store.flush();
    await tick(0);
    store.put({ ...base, rev: 2 });
    const second = store.flush();
    await tick(0);
    repo.holdWrites(false);
    repo.releaseAll();
    await Promise.all([first, second]);
    repo.releaseAll();
    await Promise.all([first, second]);
    assert.deepEqual(repo.puts.map((d) => d.rev), [1, 2], 'both, in order, neither lost nor doubled');
    assert.equal(store.pending(), false);
  });

  test('destroy() stops accepting writes', async () => {
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const store = createDocStore({ app, specs: map, debounceMs: 5 });
    store.destroy();
    store.put(createDoc({ id: 'g1', threadId: null, now: app.now }));
    await tick(20);
    await store.flush();
    assert.equal(repo.puts.length, 0);
    assert.equal(store.writes(), 0);
  });

  // ---- the library ----------------------------------------------------------------------------

  test('list() is the library and only the library: thread-owned rows belong to a chat', async () => {
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const now = app.now;
    repo.rows.push({ ...createDoc({ id: 'lib-a', threadId: null, now }), updatedAt: 100 });
    repo.rows.push({ ...createDoc({ id: 'chat-a', threadId: 't1', now }), updatedAt: 900 });
    repo.rows.push({ ...createDoc({ id: 'lib-b', threadId: null, now }), updatedAt: 500 });
    const store = createDocStore({ app, specs: map, debounceMs: 5 });
    const rows = await store.list();
    assert.deepEqual(rows.map((r) => r.id), ['lib-b', 'lib-a'], 'newest first, and no thread-owned row');
    assert.equal(isLibraryRow({ threadId: undefined }), true, 'a row that predates the field is the library’s too');
    assert.equal(isLibraryRow({ threadId: 't1' }), false);
  });

  test('create / rename / duplicate / remove round-trip through the store', async () => {
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const store = createDocStore({ app, specs: map, debounceMs: 5 });

    const made = await store.create({ title: 'first' });
    assert.equal(made.threadId, null);
    assert.equal(made.title, 'first');
    assert.equal((await store.list()).length, 1, 'a created document is in the library at once');

    await store.rename(made.id, 'renamed');
    assert.equal((await store.load(made.id)).doc.title, 'renamed');

    const copyId = await store.duplicate(made.id, { title: 'renamed (copy)' });
    assert.notEqual(copyId, made.id, 'a copy is a new document, not an alias');
    const list = await store.list();
    assert.equal(list.length, 2);
    assert.equal((await store.load(copyId)).doc.title, 'renamed (copy)');

    assert.equal(await store.remove(made.id), true);
    assert.deepEqual((await store.list()).map((r) => r.id), [copyId], 'and only the copy is left');
  });

  test('a duplicate shares no part object with the original', async () => {
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const newId = ids('p');
    let doc = createDoc({ id: 'src', threadId: null, now: app.now, title: 'src' });
    doc = addPart(doc, { type: 'note', x: 0, y: 0 }, { specs: map, newId, now: app.now }).doc;
    repo.rows.push(doc);
    const store = createDocStore({ app, specs: map, debounceMs: 5 });
    const copyId = await store.duplicate('src', {});
    const copy = repo.rows.find((r) => r.id === copyId);
    assert.equal(copy.parts.length, 1);
    assert.notEqual(copy.parts[0], doc.parts[0], 'editing the copy must not edit the original');
    assert.equal(copy.rev, 1, 'a copy starts its own history');
  });

  test('load(id) on an id with no row creates it under THAT id and writes it straight away', async () => {
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const store = createDocStore({ app, specs: map, debounceMs: 5 });
    const out = await store.load('wanted');
    assert.equal(out.created, true);
    assert.equal(out.doc.id, 'wanted', 'the caller asked for a document by name; it gets that name');
    assert.equal(out.doc.threadId, null);
    assert.equal(repo.puts.length, 1, 'a reload must find it');
  });

  test('load(null) hands back a fresh UNSAVED doc — choosing which to open is the host’s job', async () => {
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const store = createDocStore({ app, specs: map, debounceMs: 5 });
    const out = await store.load(null);
    assert.equal(out.created, false);
    assert.equal(repo.puts.length, 0, 'a store that created a row per "nothing in particular" fills the library with blanks');
  });

  test('load() drops parts whose type this build does not know, and rewrites the row', async () => {
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const newId = ids('p');
    let doc = createDoc({ id: 'gA', threadId: null, now: app.now });
    doc = addPart(doc, { type: 'note', x: 0, y: 0 }, { specs: map, newId, now: app.now }).doc;
    doc = { ...doc, parts: doc.parts.concat([{ id: 'x1', type: 'from-k9', x: 0, y: 0, w: 10, h: 10, settings: {}, value: null, state: 'idle', error: null, stats: null }]) };
    repo.rows.push(doc);
    const store = createDocStore({ app, specs: map, debounceMs: 5 });
    const out = await store.load('gA');
    assert.deepEqual(out.dropped, ['part:unknown-type'], 'the reason, as normaliseDoc names it');
    assert.equal(out.doc.parts.length, 1);
    assert.equal(repo.puts.length, 1, 'the truncated document is honest on disk too');
  });

  test('the last-opened marker is kept, and cleared when that document is deleted', async () => {
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const store = createDocStore({ app, specs: map, debounceMs: 5 });
    assert.equal(await store.lastId(), null);
    const made = await store.create({});
    await store.setLastId(made.id);
    assert.equal(repo.kv.get(LAST_KEY), made.id, 'under the documented key, so the library reads the same one');
    assert.equal(await store.lastId(), made.id);
    await store.remove(made.id);
    assert.equal(await store.lastId(), null, 'a marker naming a deleted graph would open nothing on relaunch');
  });

  // ---- the session ----------------------------------------------------------------------------

  test('session.thread() is a SHIM returning null, and docId() is the question that replaced it', async () => {
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const session = createSession(app, null);

    assert.equal(typeof session.thread, 'function',
      'runner.mjs:371 passes thread: into EVERY spec.run() — deleting the method makes every run throw');
    assert.equal(session.thread(), null);
    assert.equal(session.docId(), null, 'nothing is open yet');

    const opened = await session.open(null);
    assert.equal(typeof opened.id, 'string');
    assert.equal(opened.created, true, 'an empty library gets its first document');
    assert.equal(session.docId(), opened.id, 'and docId() now names it');
    assert.equal(session.doc().id, opened.id);
    assert.equal(session.thread(), null, 'still null: a library document has no thread, ever');
    assert.equal(await session.store.lastId(), opened.id, 'the relaunch marker follows the open document');
  });

  test('session.open() reopens the last document, and falls back when the marker is stale', async () => {
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const now = app.now;
    repo.rows.push({ ...createDoc({ id: 'old', threadId: null, now }), updatedAt: 100 });
    repo.rows.push({ ...createDoc({ id: 'fresh', threadId: null, now }), updatedAt: 900 });

    const a = createSession(app, null);
    await a.store.setLastId('old');
    assert.equal((await a.open(null)).id, 'old', 'the reader comes back to the graph they left');

    await a.store.setLastId('gone-with-a-crash');
    const b = createSession(fakeApp(repo), null);
    assert.equal((await b.open(null)).id, 'fresh',
      'a marker naming a deleted graph falls through to the newest row, not to a fresh blank one');
  });

  test('a session edit really persists — the whole point of the library store', async () => {
    const repo = fakeRepo();
    const app = fakeApp(repo);
    const session = createSession(app, null);
    const opened = await session.open(null);
    const newId = ids('p');
    session.apply(addPart(session.doc(), { type: 'note', x: 20, y: 20 }, { specs: session.specs, newId, now: app.now }).doc, { label: 'place' });
    await session.save();
    const row = repo.rows.find((r) => r.id === opened.id);
    assert.equal(row.parts.length, 1, 'placed, saved, and on disk with no thread anywhere in sight');
    assert.equal(row.threadId, null);
  });

  // ---- the visible rule (§2.3, revision 2) ---------------------------------------------------

  test('visible is true while the surface is shown, whatever the runner is doing', () => {
    assert.equal(computeVisible({ shown: true, executing: false }), true);
    assert.equal(computeVisible({ shown: true, executing: true }), true);
  });

  test('visible is true while an activation EXECUTES behind another surface', () => {
    assert.equal(computeVisible({ shown: false, executing: true }), true,
      'a run the human started keeps its seat while they look at something else in the same window');
    assert.equal(runnerExecuting(runnerLike({ executing: true, running: true })), true);
  });

  test('visible is FALSE while a run is merely parked — the whole point of the narrowing', () => {
    // A parked run is `running()` but not `executing()`: K3's runner reports both. A Dialog nobody
    // answers must not hold `visible` open, because that is the exact condition app/ask.mjs's
    // hidden-means-idle rule exists to enforce.
    const parked = runnerLike({ executing: false, running: true });
    assert.equal(runnerExecuting(parked), false, 'executing() wins over running() when the runner has both');
    assert.equal(computeVisible({ shown: false, executing: runnerExecuting(parked) }), false);
    assert.equal(computeVisible({ shown: true, executing: runnerExecuting(parked) }), true,
      'shown again, of course — a park resolves by clicking the part');
  });

  test('visible is false when the surface is hidden and nothing is running', () => {
    assert.equal(computeVisible({ shown: false, executing: false }), false);
    assert.equal(runnerExecuting(null), false, 'no runner yet is not "running"');
    assert.equal(runnerExecuting(runnerLike({ running: true })), true,
      'K1’s runner has only running(), and in K1 there is no parking, so the two mean the same thing');
  });
};
