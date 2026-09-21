// graph/store.mjs (C1-U1/BG-7): the debounced one-graph-per-thread persistence, in Node.
//
// The store is the other stateful C1 module, and every interesting thing about it is a RACE: the
// debounce coalescing a drag into one write, a flush landing while another is in flight, load()
// creating and WRITING a fresh document (the write a second attach must not duplicate), and which
// row load() picks when more than one exists. A scenario cannot schedule those; a fake repo can.
//
// What these assertions protect:
//   - dragging a part 200 px costs ONE write, not two hundred (the drafts rule);
//   - the LAST document wins: an older snapshot never lands on a newer;
//   - two overlapping flush()es write the newest doc exactly once, in order;
//   - pending() stays true until the write has really landed — a caller that waits on it and then
//     reads the store must not read it mid-write;
//   - load() opens the NEWEST row, not whichever the threadId index happened to yield first: an
//     older row is a graph that lost its parts;
//   - a thread with no row gets one, written straight away, so a reload finds it;
//   - destroy() stops accepting writes.
import assert from 'node:assert/strict';
import { createGraphStore, SAVE_DEBOUNCE_MS } from '../../../renderer/chat/graph/store.mjs';
import { createDoc, addPart } from '../../../renderer/chat/graph/model.mjs';
import { specs, ids, clock } from './graph-fixture.mjs';

const map = specs();

/** A repo whose putGraph can be held open, so a test can interleave two writes. */
function fakeRepo({ rows = [] } = {}) {
  const puts = [];
  /** @type {Function[]} */ const gates = [];
  let hold = false;
  return {
    puts,
    rows,
    holdWrites(on) { hold = on; },
    releaseAll() { const fns = gates.splice(0); for (const fn of fns) fn(); },
    listGraphs: async (threadId) => rows.filter((r) => r.threadId === threadId),
    putGraph: async (doc) => {
      puts.push(doc);
      const i = rows.findIndex((r) => r.id === doc.id);
      if (i >= 0) rows[i] = doc; else rows.push(doc);
      if (hold) await new Promise((done) => gates.push(done));
    },
  };
}

function fakeApp(repo) {
  const now = clock();
  const newId = ids('g');
  return { repo, now, newId };
}

const tick = (ms) => new Promise((done) => setTimeout(done, ms));

export default (test) => {
  test('the debounce is 500 ms and two hundred edits cost ONE write', async () => {
    assert.equal(SAVE_DEBOUNCE_MS, 500);
    const repo = fakeRepo();
    const store = createGraphStore({ app: fakeApp(repo), specs: map, debounceMs: 5 });
    const now = clock();
    let doc = createDoc({ id: 'g1', threadId: 't1', now });
    for (let i = 0; i < 200; i++) {
      doc = { ...doc, parts: [], rev: i };
      store.put(doc);
    }
    assert.equal(repo.puts.length, 0, 'nothing is written while the edits keep coming');
    await store.flush();
    assert.equal(repo.puts.length, 1, 'one write');
    assert.equal(repo.puts[0].rev, 199, 'and it is the LAST document, not the first');
  });

  test('pending() stays true until the write has really landed', async () => {
    const repo = fakeRepo();
    const store = createGraphStore({ app: fakeApp(repo), specs: map, debounceMs: 5 });
    const now = clock();
    store.put(createDoc({ id: 'g1', threadId: 't1', now }));
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
    const store = createGraphStore({ app: fakeApp(repo), specs: map, debounceMs: 1000 });
    const now = clock();
    const base = createDoc({ id: 'g1', threadId: 't1', now });
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

  test('load() opens the NEWEST row when the thread somehow has more than one', async () => {
    const now = clock();
    const old = { ...createDoc({ id: 'gA', threadId: 't1', now }), updatedAt: 100, parts: [] };
    const fresh = { ...createDoc({ id: 'gB', threadId: 't1', now }), updatedAt: 900, parts: [] };
    // The index scan's order is the INDEX's, not updatedAt's: the stale row comes back first.
    const repo = fakeRepo({ rows: [old, fresh] });
    const store = createGraphStore({ app: fakeApp(repo), specs: map, debounceMs: 5 });
    const out = await store.load('t1');
    assert.equal(out.created, false);
    assert.equal(out.doc.id, 'gB', 'an older row is a graph that lost its parts');
  });

  test('a thread with no graph gets a fresh one, WRITTEN straight away', async () => {
    const repo = fakeRepo();
    const store = createGraphStore({ app: fakeApp(repo), specs: map, debounceMs: 5 });
    const out = await store.load('t9');
    assert.equal(out.created, true);
    assert.equal(out.doc.threadId, 't9');
    assert.equal(repo.puts.length, 1, 'a reload must find it');
    assert.equal(repo.puts[0].id, out.doc.id);
  });

  test('load() drops parts whose type this build does not know, and rewrites the row', async () => {
    const now = clock();
    const newId = ids('p');
    let doc = createDoc({ id: 'gA', threadId: 't1', now });
    doc = addPart(doc, { type: 'note', x: 0, y: 0 }, { specs: map, newId, now }).doc;
    doc = { ...doc, updatedAt: 10, parts: doc.parts.concat([{ id: 'x1', type: 'from-c3', x: 0, y: 0, w: 10, h: 10, settings: {}, value: null, state: 'idle', error: null, stats: null }]) };
    const repo = fakeRepo({ rows: [doc] });
    const store = createGraphStore({ app: fakeApp(repo), specs: map, debounceMs: 5 });
    const out = await store.load('t1');
    assert.deepEqual(out.dropped, ['part:unknown-type'], 'the reason, as normaliseDoc names it');
    assert.equal(out.doc.parts.length, 1);
    assert.equal(repo.puts.length, 1, 'the truncated document is honest on disk too');
  });

  test('load() with no thread hands back a fresh unsaved doc and writes nothing', async () => {
    const repo = fakeRepo();
    const store = createGraphStore({ app: fakeApp(repo), specs: map, debounceMs: 5 });
    const out = await store.load(null);
    assert.equal(out.doc.threadId, null);
    assert.equal(out.created, false);
    assert.equal(repo.puts.length, 0);
  });

  test('destroy() stops accepting writes', async () => {
    const repo = fakeRepo();
    const store = createGraphStore({ app: fakeApp(repo), specs: map, debounceMs: 5 });
    const now = clock();
    store.destroy();
    store.put(createDoc({ id: 'g1', threadId: 't1', now }));
    await tick(20);
    await store.flush();
    assert.equal(repo.puts.length, 0);
    assert.equal(store.writes(), 0);
  });
};
