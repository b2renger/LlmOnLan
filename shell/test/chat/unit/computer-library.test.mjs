// computer/migrate.mjs + the library sidebar's pure half (COMPUTER_PLAN §7.1, §7.2, K1-U2).
//
// The migration is the one piece of K1 that touches data the reader already has, and every
// interesting thing about it is a RERUN: a marker that did not land, a crash halfway through the
// loop, a second launch, a chat deleted between the two. A scenario cannot schedule those; a fake
// repo can.
//
// What these assertions protect:
//   - running the migration twice leaves N library documents, never 2N;
//   - the derived id (`'lib-' + hash(row.id)`) is what makes that true even with the kv marker
//     gone — so a crash mid-loop cannot duplicate the library;
//   - a graph whose chat has been deleted still comes over, with words instead of a blank title;
//   - the ORIGINAL row is untouched: this is a COPY, and `repo.deleteThread`'s cascade must have
//     nothing of the library left to take with it;
//   - a document that has never run never claims to have.
import assert from 'node:assert/strict';
import { migrateGraphsV1, derivedId, titleFor, MIGRATED_KEY, MIGRATED_COUNT_KEY } from '../../../renderer/chat/computer/migrate.mjs';
import { lastRunAt, cardMeta, matches, whenText } from '../../../renderer/chat/computer/library.mjs';

/** A repo with just enough of state/repo.mjs for the migration: graphs, threads and kv. */
function fakeRepo({ graphs = [], threads = [] } = {}) {
  const kv = new Map();
  const rows = graphs.slice();
  const puts = [];
  return {
    rows,
    kv,
    puts,
    mode: 'idb',
    listGraphs: async (threadId) => (threadId ? rows.filter((r) => r.threadId === threadId) : rows.slice()),
    getGraph: async (id) => rows.find((r) => r.id === id) || null,
    putGraph: async (doc) => {
      puts.push(doc);
      const i = rows.findIndex((r) => r.id === doc.id);
      if (i >= 0) rows[i] = doc; else rows.push(doc);
    },
    deleteGraph: async (id) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    },
    getThread: async (id) => threads.find((th) => th.id === id) || null,
    /** state/repo.mjs:320-326 — deleting a chat deletes every graphs row INDEXED TO IT. */
    deleteThread: async (id) => {
      for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].threadId === id) rows.splice(i, 1);
    },
    kvGet: async (key, fallback = null) => (kv.has(key) ? kv.get(key) : fallback),
    kvSet: async (key, value) => { kv.set(key, value); },
  };
}

/** @param {string} id @param {string|null} threadId @param {object} [extra] */
const graph = (id, threadId, extra = {}) => ({
  id, threadId, title: '', parts: [], wires: [], rev: 1, createdAt: 10, updatedAt: 20, ...extra,
});

const libraryRows = (repo) => repo.rows.filter((r) => r.threadId === null);

export default (test) => {
  // ---- the derived id ------------------------------------------------------------------------

  test("the derived id is 'lib-' + the FNV-1a hash, and it is stable", () => {
    const a = derivedId('g1');
    assert.match(a, /^lib-[0-9a-f]{8}$/);
    assert.equal(a, derivedId('g1'), 'the same row must always derive the same library id');
    assert.notEqual(a, derivedId('g2'));
  });

  // ---- the kv marker gates the whole thing ------------------------------------------------------

  test('the kv marker gates the whole thing: a set marker migrates nothing', async () => {
    const repo = fakeRepo({ graphs: [graph('g1', 't1'), graph('g2', 't2')] });
    await repo.kvSet(MIGRATED_KEY, true);
    await repo.kvSet(MIGRATED_COUNT_KEY, 2);
    const out = await migrateGraphsV1({ repo, now: () => 100 });
    assert.equal(out.status, 'already');
    assert.equal(out.imported, 0);
    assert.equal(repo.puts.length, 0, 'not one row was written');
    assert.equal(libraryRows(repo).length, 0);
  });

  test('with nothing to carry over the marker is still set, so the cost is paid once', async () => {
    const repo = fakeRepo({ graphs: [graph('lib-1', null)] });
    const out = await migrateGraphsV1({ repo, now: () => 100 });
    assert.equal(out.status, 'none');
    assert.equal(await repo.kvGet(MIGRATED_KEY, null), true);
    assert.equal(libraryRows(repo).length, 1, 'the library document that was already there is left alone');
  });

  // ---- idempotency ------------------------------------------------------------------------------

  test('two runs leave N library documents, not 2N', async () => {
    const repo = fakeRepo({
      graphs: [graph('g1', 't1'), graph('g2', 't2'), graph('g3', 't3')],
      threads: [{ id: 't1', title: 'One' }, { id: 't2', title: 'Two' }, { id: 't3', title: 'Three' }],
    });
    const first = await migrateGraphsV1({ repo, now: () => 100 });
    assert.equal(first.status, 'done');
    assert.equal(first.imported, 3);
    assert.equal(libraryRows(repo).length, 3);

    const second = await migrateGraphsV1({ repo, now: () => 200 });
    assert.equal(second.status, 'already', 'the marker is the fast path on the second launch');
    assert.equal(libraryRows(repo).length, 3, 'three, not six');
  });

  test('the derived id, not the marker, is what makes a crash mid-loop safe', async () => {
    const repo = fakeRepo({
      graphs: [graph('g1', 't1'), graph('g2', 't2')],
      threads: [{ id: 't1', title: 'One' }, { id: 't2', title: 'Two' }],
    });
    await migrateGraphsV1({ repo, now: () => 100 });
    assert.equal(libraryRows(repo).length, 2);

    // A marker that never landed (the crash), with the rows already written.
    repo.kv.delete(MIGRATED_KEY);
    const again = await migrateGraphsV1({ repo, now: () => 200 });
    assert.equal(again.status, 'done');
    assert.equal(again.imported, 0, 'nothing was written a second time');
    assert.equal(again.skipped, 2, 'both were recognised by their derived ids');
    assert.equal(libraryRows(repo).length, 2);
  });

  test('a half-done migration finishes the rest and duplicates none of the first half', async () => {
    const repo = fakeRepo({
      graphs: [graph('g1', 't1'), graph('g2', 't2'), graph('g3', 't3')],
      threads: [{ id: 't1', title: 'One' }],
    });
    // g1 was written just before the crash.
    await repo.putGraph({ ...graph('g1', 't1'), id: derivedId('g1'), threadId: null, title: 'One' });
    const out = await migrateGraphsV1({ repo, now: () => 100 });
    assert.equal(out.imported, 2);
    assert.equal(out.skipped, 1);
    assert.equal(libraryRows(repo).length, 3);
  });

  // ---- titles ------------------------------------------------------------------------------------

  test('a row whose chat is gone still migrates, with words instead of a blank title', async () => {
    const repo = fakeRepo({
      graphs: [graph('g1', 'dead-thread')],
      threads: [],
    });
    const out = await migrateGraphsV1({ repo, now: () => 100 });
    assert.equal(out.imported, 1);
    const [row] = libraryRows(repo);
    assert.equal(row.title, 'From a deleted chat');
    assert.equal(row.threadId, null);
  });

  test("a chat that still exists names the document, and the row's own title always wins", async () => {
    assert.equal(titleFor({ title: '' }, { title: 'Rig notes' }), 'From: Rig notes');
    assert.equal(titleFor({ title: 'My graph' }, { title: 'Rig notes' }), 'My graph');
    assert.equal(titleFor({ title: '   ' }, null), 'From a deleted chat');
  });

  // ---- copy, never move ---------------------------------------------------------------------------

  test('the original row is untouched, so deleting the chat cannot take the library copy', async () => {
    const repo = fakeRepo({
      graphs: [graph('g1', 't1', { parts: [{ id: 'p1', type: 'note' }] })],
      threads: [{ id: 't1', title: 'One' }],
    });
    await migrateGraphsV1({ repo, now: () => 100 });
    const original = await repo.getGraph('g1');
    assert.ok(original, 'the per-thread row is still there');
    assert.equal(original.threadId, 't1', 'and it still belongs to its chat');

    const copy = await repo.getGraph(derivedId('g1'));
    assert.equal(copy.threadId, null);
    assert.equal(copy.parts.length, 1, 'the parts came with it');

    // THE point of the copy: the cascade takes the original and leaves the library alone.
    await repo.deleteThread('t1');
    assert.equal(await repo.getGraph('g1'), null);
    assert.ok(await repo.getGraph(derivedId('g1')), 'the library document survived the chat');
  });

  test('a library document is never re-migrated into another library document', async () => {
    const repo = fakeRepo({ graphs: [graph('lib-abc', null, { title: 'Mine' }), graph('g1', 't1')] });
    const out = await migrateGraphsV1({ repo, now: () => 100 });
    assert.equal(out.imported, 1);
    assert.equal(libraryRows(repo).length, 2);
    assert.ok(!repo.rows.some((r) => r.id === derivedId('lib-abc')));
  });

  test('an ephemeral chat is not copied into a permanent library', async () => {
    const repo = fakeRepo({
      graphs: [graph('g1', 'eph-1')],
      threads: [{ id: 'eph-1', title: 'A one-off', ephemeral: true }],
    });
    const out = await migrateGraphsV1({ repo, now: () => 100 });
    assert.equal(out.imported, 0);
    assert.equal(out.skipped, 1);
    assert.equal(libraryRows(repo).length, 0);
  });

  test('a repo that cannot list is a skip, never a throw', async () => {
    const repo = fakeRepo();
    repo.listGraphs = async () => { throw new Error('nope'); };
    const out = await migrateGraphsV1({ repo, now: () => 100 });
    assert.equal(out.status, 'failed');
    assert.equal(out.imported, 0);
    assert.equal(await migrateGraphsV1({ repo: null }).then((r) => r.status), 'skipped');
  });

  // ---- the card's honesty --------------------------------------------------------------------------

  test('a document that has never run never claims to have', () => {
    assert.equal(lastRunAt({ parts: [], updatedAt: 500 }), 0);
    assert.equal(lastRunAt({ parts: [{ id: 'p', stats: null }], updatedAt: 500 }), 0);
    assert.equal(lastRunAt({ parts: [{ id: 'p', stats: { ms: 0, calls: 0, tokens: 0 } }], updatedAt: 500 }), 0,
      'an all-zero stats bag is not proof that anything ran');
    assert.equal(lastRunAt({ parts: [{ id: 'p', stats: { ms: 12, calls: 1, tokens: 40 } }], updatedAt: 500 }), 500);
  });

  test('the card line counts parts and says whether it has ever run', () => {
    const now = Date.UTC(2026, 8, 22, 12, 0, 0);
    assert.equal(cardMeta({ parts: [], updatedAt: now }, now), '0 parts · never run');
    assert.equal(cardMeta({ parts: [{ id: 'a' }], updatedAt: now }, now), '1 part · never run');
    const ran = cardMeta({ parts: [{ id: 'a', stats: { calls: 1 } }, { id: 'b' }], updatedAt: now }, now);
    assert.match(ran, /^2 parts · last run /);
    assert.ok(!ran.includes('{when}'), 'the placeholder was substituted');
  });

  test('"when" is same-day time and otherwise a date', () => {
    const now = Date.UTC(2026, 8, 22, 12, 0, 0);
    const sameDay = whenText(now - 3600_000, now);
    const older = whenText(now - 40 * 24 * 3600_000, now);
    assert.ok(sameDay.length > 0 && older.length > 0);
    assert.notEqual(sameDay, older);
  });

  // ---- search --------------------------------------------------------------------------------------

  test('search matches a title case-insensitively and an empty query matches everything', () => {
    assert.equal(matches({ title: 'Rig notes' }, ''), true);
    assert.equal(matches({ title: 'Rig notes' }, '  '), true);
    assert.equal(matches({ title: 'Rig notes' }, 'RIG'), true);
    assert.equal(matches({ title: 'Rig notes' }, 'notes'), true);
    assert.equal(matches({ title: 'Rig notes' }, 'zzz'), false);
  });

  test('an untitled document is findable by the word its card shows', () => {
    assert.equal(matches({ title: '' }, 'untitled'), true);
    assert.equal(matches({ title: 'Rig notes' }, 'untitled'), false);
  });
};
