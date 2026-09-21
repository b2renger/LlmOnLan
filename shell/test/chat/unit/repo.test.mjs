// The store (P0-U4): the real state/repo.mjs over backend-memory.mjs, plus a scripted "slow IDB"
// backend (the same memory backend behind a promise a test resolves when it likes). Everything the
// plan's §3.7 store-mode rules promise is exercised here: the write queue, the journal, the late
// attach, memory-final, the checkpoint throttle, ephemeral isolation and attachment dedupe.
import assert from 'node:assert/strict';
import { openRepoSync, CHECKPOINT_MS } from '../../../renderer/chat/state/repo.mjs';
import { createMemoryBackend } from '../../../renderer/chat/state/backend-memory.mjs';
import { createBus, EV } from '../../../renderer/chat/core/events.mjs';
import { API_KEYS } from '../../../renderer/chat/core/types.mjs';

const realTimeout = setTimeout;

/** Let the repo's promise chain (and any backend.ready callback) run to the end. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => realTimeout(r, 0));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** A backend that records every write, so a test can prove what did (not) reach the store. */
function spyBackend(inner = createMemoryBackend({ kind: 'idb' })) {
  /** @type {any[]} */ const ops = [];
  /** @type {any[][]} */ const bulks = [];
  return {
    ...inner,
    ops,
    bulks,
    async put(store, value) { ops.push({ op: 'put', store, value }); return inner.put(store, value); },
    async del(store, key) { ops.push({ op: 'del', store, key }); return inner.del(store, key); },
    async bulk(list) { bulks.push(list); for (const o of list) ops.push(o); return inner.bulk(list); },
    async runTx(stores, mode, fn) { ops.push({ op: 'tx', store: stores.join('+') }); return inner.runTx(stores, mode, fn); },
  };
}

/** Deterministic clock + timers: nothing in these tests waits on the wall clock. */
function fakeTimers(start = 1_700_000_000_000) {
  let time = 0;
  let seq = 0;
  /** @type {Map<number, {fn: () => void, at: number}>} */
  const timers = new Map();
  return {
    now: () => start + time,
    setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ ms) => { const id = ++seq; timers.set(id, { fn, at: time + ms }); return id; },
    clearTimeout: (/** @type {number} */ id) => { timers.delete(id); },
    pending: () => timers.size,
    advance(/** @type {number} */ ms) {
      time += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= time) { timers.delete(id); timer.fn(); }
      }
    },
  };
}

/** A repo whose "IndexedDB" is `backend` (attaches at once unless its ready is scripted). */
function makeRepo(backend, extra = {}) {
  return openRepoSync({ openPersistent: () => backend, ...extra });
}

export default (test) => {
  // ------------------------------------------------------------------ API surface
  test('repo: the object is exactly the §3.4 API', async () => {
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }));
    await repo.ready;
    assert.deepEqual(Object.keys(repo).sort(), [...API_KEYS.repo].sort());
    assert.deepEqual(Object.keys(repo.debug).sort(), [...API_KEYS.repoDebug].sort());
    assert.equal(repo.mode, 'idb');
  });

  // ------------------------------------------------------------------ sync writes
  test('repo: createThread/appendMessage are synchronous and land in the store', async () => {
    const backend = spyBackend();
    const bus = createBus();
    /** @type {any[]} */ const changes = [];
    bus.on(EV.THREADS_CHANGED, (p) => changes.push(p));
    const repo = makeRepo(backend, { bus });
    await repo.ready;

    const th = repo.createThread({ title: 'Rig notes' });
    assert.equal(typeof th.id, 'string');
    assert.equal(th.headId, null);
    assert.equal(th.pinned, false);
    assert.equal(th.titleSource, 'auto');
    const u = repo.appendMessage(th.id, { role: 'user', content: 'hello' });
    const a = repo.appendMessage(th.id, { role: 'assistant', content: 'hi', status: 'done' });
    assert.equal(u.parentId, null);
    assert.equal(a.parentId, u.id);

    const path = await repo.getPath(th.id);
    assert.deepEqual(path.map((m) => m.id), [u.id, a.id]);
    assert.deepEqual(path.map((m) => m.parentId), [null, u.id]);
    const stored = await repo.getThread(th.id);
    assert.equal(stored.headId, a.id);
    assert.ok(stored.updatedAt >= stored.createdAt);
    assert.deepEqual(changes.map((c) => c.reason), ['create']);
    assert.deepEqual((await repo.getMessages(th.id)).map((m) => m.id).sort(), [u.id, a.id].sort());
  });

  test('repo: the default title comes from the strings table, not the key', async () => {
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }));
    assert.equal(repo.createThread().title, 'New chat');
  });

  test('repo: createThread defaults do not overwrite what the caller passes', async () => {
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }));
    const th = repo.createThread({ id: 'fixed-id', title: 'Kept', pinned: true, model: 'gemma4:12b', modelSource: 'user' });
    assert.equal(th.id, 'fixed-id');
    assert.equal(th.pinned, true);
    assert.equal(th.model, 'gemma4:12b');
    assert.deepEqual(await repo.getThread('fixed-id'), { ...th });
  });

  test('repo: a read always sees every write issued before it', async () => {
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }));
    const a = repo.createThread({ title: 'A' });
    const b = repo.createThread({ title: 'B', pinned: true });
    repo.appendMessage(a.id, { content: 'x' });
    const list = await repo.listThreads();
    assert.deepEqual(list.map((t) => t.title), ['B', 'A']);          // pinned first
    await repo.updateThread(a.id, { pinned: true, updatedAt: b.updatedAt + 10 });
    assert.deepEqual((await repo.listThreads()).map((t) => t.title), ['A', 'B']);
  });

  test('repo: updateThread on a missing thread answers null and emits nothing', async () => {
    const bus = createBus();
    /** @type {any[]} */ const changes = [];
    bus.on(EV.THREADS_CHANGED, (p) => changes.push(p));
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }), { bus });
    assert.equal(await repo.updateThread('nope', { title: 'x' }), null);
    assert.deepEqual(changes, []);
  });

  // P2 review, minor: app/drafts.mjs writes `thread.draft` every 500 ms while the reader types, and
  // the THREADS_CHANGED it emitted re-rendered the whole sidebar (a full listThreads()) and the
  // thread header twice a second — for a field neither of them renders. `silent` is for exactly
  // that: a write that moves no row, renames nothing and reorders nothing.
  test('repo: a silent updateThread still writes, and emits nothing', async () => {
    const bus = createBus();
    /** @type {any[]} */ const changes = [];
    bus.on(EV.THREADS_CHANGED, (p) => changes.push(p));
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }), { bus });
    const th = repo.createThread({ title: 'Typing' });
    changes.length = 0;

    const out = await repo.updateThread(th.id, { draft: 'half a sen' }, { silent: true });
    assert.equal(out.draft, 'half a sen');
    assert.equal((await repo.getThread(th.id)).draft, 'half a sen', 'the value really landed');
    assert.deepEqual(changes, [], 'and nobody was woken up for it');

    await repo.updateThread(th.id, { title: 'Renamed' });
    assert.deepEqual(changes.map((c) => c.reason), ['update'], 'an ordinary write still announces itself');
  });

  test('repo: deleteThread cascades to messages and attachments in one transaction', async () => {
    const backend = spyBackend();
    const repo = makeRepo(backend);
    const th = repo.createThread({ title: 'doomed' });
    repo.appendMessage(th.id, { content: 'one' });
    repo.appendMessage(th.id, { content: 'two' });
    await repo.putAttachment({ threadId: th.id, name: 'a.png', mime: 'image/png', size: 3, sha256: 'aaa', status: 'ready' });
    const other = repo.createThread({ title: 'kept' });
    repo.appendMessage(other.id, { content: 'safe' });
    await repo.deleteThread(th.id);

    assert.equal(await repo.getThread(th.id), null);
    assert.deepEqual(await repo.getMessages(th.id), []);
    assert.deepEqual(await repo.listAttachments(th.id), []);
    assert.equal((await repo.getMessages(other.id)).length, 1);
    const cascade = backend.bulks.find((ops) => ops.some((o) => o.op === 'del' && o.store === 'threads' && o.key === th.id));
    assert.ok(cascade, 'the delete went through as one bulk');
    assert.deepEqual([...new Set(cascade.map((o) => o.store))].sort(), ['attachments', 'messages', 'threads']);
  });

  // ------------------------------------------------------------------ tree operations
  test('repo: deleteSubtree removes the branch and repairs the head', async () => {
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }));
    const th = repo.createThread({ title: 'fork' });
    const u1 = repo.appendMessage(th.id, { role: 'user', content: 'q' });
    const a1 = repo.appendMessage(th.id, { role: 'assistant', content: 'first try' });
    const a2 = repo.appendMessage(th.id, { role: 'assistant', content: 'regenerated', parentId: u1.id });
    const u2 = repo.appendMessage(th.id, { role: 'user', content: 'follow up' });
    assert.equal(u2.parentId, a2.id);
    assert.equal((await repo.getThread(th.id)).headId, u2.id);

    const { removed, headId } = await repo.deleteSubtree(a2.id);
    assert.deepEqual(removed.sort(), [a2.id, u2.id].sort());
    assert.equal(headId, u1.id, 'head falls back to the parent of the removed branch');
    assert.equal((await repo.getThread(th.id)).headId, u1.id);
    assert.deepEqual((await repo.getPath(th.id)).map((m) => m.id), [u1.id]);
    // The other branch is untouched and reachable by explicit head.
    assert.deepEqual((await repo.getPath(th.id, a1.id)).map((m) => m.id), [u1.id, a1.id]);
    assert.deepEqual(await repo.deleteSubtree('nope'), { removed: [], headId: null });
  });

  test('repo: getPath repairs a dangling head instead of showing nothing', async () => {
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }));
    const th = repo.createThread();
    const u = repo.appendMessage(th.id, { content: 'only' });
    await repo.updateThread(th.id, { headId: 'ghost' });
    assert.deepEqual((await repo.getPath(th.id)).map((m) => m.id), [u.id]);
  });

  test('repo: scanMessages visits every message and stops on false', async () => {
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }));
    const th = repo.createThread();
    for (let i = 0; i < 5; i++) repo.appendMessage(th.id, { content: `m${i}` });
    /** @type {string[]} */ const seen = [];
    await repo.scanMessages((m) => { seen.push(m.content); });
    assert.equal(seen.length, 5);
    /** @type {string[]} */ const partial = [];
    await repo.scanMessages((m) => { partial.push(m.content); return partial.length < 2; });
    assert.equal(partial.length, 2);
  });

  test('repo: recoverInterrupted turns streaming messages into interrupted', async () => {
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }));
    const th = repo.createThread();
    repo.appendMessage(th.id, { content: 'done one', status: 'done' });
    const live = repo.appendMessage(th.id, { content: 'half', status: 'streaming' });
    assert.equal(await repo.recoverInterrupted(), 1);
    assert.equal((await repo.getMessages(th.id)).find((m) => m.id === live.id).status, 'interrupted');
    assert.equal(await repo.recoverInterrupted(), 0);
  });

  test('repo: recoverInterrupted also recovers a seat wait nobody is waiting on any more', async () => {
    // A row left at status 'waiting' (P2-U1) reopens with Try now / Cancel buttons that do
    // nothing: the waiter died with the window. Recovery is what makes the row honest again.
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }));
    const th = repo.createThread();
    const waitingMsg = repo.appendMessage(th.id, {
      content: '', status: 'waiting',
      error: { kind: 'seats_full', code: 'lol_seats_full', message: 'All 2 seats are in use.', retryAfter: null },
    });
    assert.equal(await repo.recoverInterrupted(), 1);
    const back = (await repo.getMessages(th.id)).find((m) => m.id === waitingMsg.id);
    assert.equal(back.status, 'interrupted');
    assert.equal(back.error.kind, 'seats_full', 'the reason it never started is kept');
    assert.equal(await repo.recoverInterrupted(), 0);
  });

  // ------------------------------------------------------------------ checkpoint throttle
  test('repo: checkpoint writes at most once per second per message; finalize writes now', async () => {
    const timers = fakeTimers();
    const backend = spyBackend();
    const repo = makeRepo(backend, { now: timers.now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
    await settle();
    const th = repo.createThread();
    const msg = repo.appendMessage(th.id, { role: 'assistant', content: '', status: 'streaming' });
    await repo.listThreads();                                     // drain the queue
    const puts = () => backend.ops.filter((o) => o.op === 'put' && o.store === 'messages' && o.value.id === msg.id).length;
    const base = puts();

    for (const chunk of ['a', 'b', 'c', 'd']) { msg.content += chunk; repo.checkpoint(msg); }
    timers.advance(CHECKPOINT_MS - 1);
    await settle();
    assert.equal(puts(), base, 'nothing written inside the window');
    timers.advance(1);
    await settle();
    assert.equal(puts(), base + 1, 'exactly one write per window');
    const written = await repo.getMessages(th.id);
    assert.equal(written.find((m) => m.id === msg.id).content, 'abcd', 'the latest content wins');

    msg.content += 'e';
    repo.checkpoint(msg);
    timers.advance(CHECKPOINT_MS);
    await settle();
    assert.equal(puts(), base + 2);

    msg.content += 'f';
    msg.status = 'done';
    repo.checkpoint(msg);
    await repo.finalize(msg);                                     // cancels the pending timer
    assert.equal(puts(), base + 3);
    timers.advance(CHECKPOINT_MS * 3);
    await settle();
    assert.equal(puts(), base + 3, 'the cancelled timer never fired');
    assert.equal((await repo.getMessages(th.id)).find((m) => m.id === msg.id).status, 'done');
  });

  test('repo: flush writes a pending checkpoint without waiting for the timer', async () => {
    const timers = fakeTimers();
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }), { now: timers.now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
    const th = repo.createThread();
    const msg = repo.appendMessage(th.id, { role: 'assistant', content: 'partial', status: 'streaming' });
    msg.content = 'partial+more';
    repo.checkpoint(msg);
    await repo.flush();
    assert.equal((await repo.getMessages(th.id)).find((m) => m.id === msg.id).content, 'partial+more');
  });

  // ------------------------------------------------------------------ ephemeral
  test('repo: an ephemeral thread never reaches the persistent backend', async () => {
    const backend = spyBackend();
    const repo = makeRepo(backend);
    await repo.ready;
    const keep = repo.createThread({ title: 'kept' });
    const ghost = repo.createThread({ title: 'ghost', ephemeral: true });
    const m = repo.appendMessage(ghost.id, { content: 'secret' });
    await repo.putAttachment({ threadId: ghost.id, name: 's.png', mime: 'image/png', size: 1, sha256: 'sss', status: 'ready' });
    repo.appendMessage(keep.id, { content: 'public' });
    await repo.flush();

    const touched = JSON.stringify(backend.ops);
    assert.ok(!touched.includes(ghost.id), 'no write mentioning the ephemeral thread');
    assert.ok(!touched.includes('secret'));
    assert.ok(touched.includes(keep.id));
    assert.deepEqual(repo.debug.persistentIds(), [keep.id]);
    // …but it is a first-class thread for the session.
    assert.deepEqual((await repo.getPath(ghost.id)).map((m2) => m2.id), [m.id]);
    assert.ok((await repo.listThreads()).some((t) => t.id === ghost.id));
    assert.equal((await repo.listAttachments(ghost.id)).length, 1);
    await repo.deleteThread(ghost.id);
    assert.equal(await repo.getThread(ghost.id), null);
    assert.equal(backend.ops.some((o) => o.key === ghost.id), false);
  });

  // ------------------------------------------------------------------ attachments
  test('repo: attachments dedupe by (threadId, sha256)', async () => {
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }));
    const a = repo.createThread();
    const b = repo.createThread();
    const att = { threadId: a.id, name: 'shot.png', mime: 'image/png', size: 12, sha256: 'deadbeef', status: 'ready' };
    const id1 = await repo.putAttachment({ ...att });
    const id2 = await repo.putAttachment({ ...att, name: 'shot-copy.png' });
    assert.equal(id1, id2, 'the same bytes in the same thread give one record');
    assert.equal((await repo.listAttachments(a.id)).length, 1);
    const id3 = await repo.putAttachment({ ...att, threadId: b.id });
    assert.notEqual(id3, id1, 'another thread keeps its own copy');
    const id4 = await repo.putAttachment({ threadId: a.id, name: 'no-hash.bin', mime: 'application/octet-stream', size: 1, sha256: null, status: 'ready' });
    assert.notEqual(id4, id1);
    assert.equal((await repo.getAttachment(id1)).name, 'shot.png');
    await repo.deleteAttachment(id1);
    assert.equal(await repo.getAttachment(id1), null);
  });

  test('repo: kv and recipes round-trip', async () => {
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }));
    assert.equal(await repo.kvGet('missing', 'fallback'), 'fallback');
    await repo.kvSet('ui:wrap', true);
    await repo.kvSet('tokRatio:gemma4:12b', 3.6);
    assert.equal(await repo.kvGet('ui:wrap', false), true);
    assert.equal(await repo.kvGet('tokRatio:gemma4:12b', 0), 3.6);
    await repo.putRecipe({ lolrecipe: 1, id: 'r1', name: 'Translate', trigger: '/tr' });
    assert.deepEqual((await repo.listRecipes()).map((r) => r.id), ['r1']);
    await repo.deleteRecipe('r1');
    assert.deepEqual(await repo.listRecipes(), []);
  });

  // ------------------------------------------------------------------ store modes
  test('repo: pending → idb replays the journal exactly once and switches reads', async () => {
    /** @type {() => void} */ let openNow = () => {};
    const inner = createMemoryBackend({ kind: 'idb', ready: new Promise((r) => { openNow = () => r(undefined); }) });
    const backend = spyBackend(inner);
    backend.ready = inner.ready;
    const timers = fakeTimers();
    const bus = createBus();
    /** @type {string[]} */ const modes = [];
    /** @type {any[]} */ const changes = [];
    bus.on(EV.STORE_MODE, (m) => modes.push(m));
    bus.on(EV.THREADS_CHANGED, (p) => changes.push(p));
    const repo = makeRepo(backend, { bus, now: timers.now, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });

    assert.equal(repo.mode, 'pending');
    const early = repo.createThread({ title: 'while pending' });
    repo.appendMessage(early.id, { content: 'typed before the database opened' });
    await repo.listThreads();
    assert.equal(backend.ops.length, 0, 'nothing reaches IndexedDB while pending');
    assert.ok(repo.debug.journalLength() >= 3);

    timers.advance(3000);                                          // the open timed out
    await settle();
    assert.equal(repo.mode, 'memory');
    assert.deepEqual(modes, ['memory']);
    const late = repo.createThread({ title: 'while memory' });
    await repo.listThreads();
    const journalled = repo.debug.journalLength();
    assert.ok(journalled >= 4);

    openNow();                                                     // the database finally opened
    await settle();
    assert.equal(repo.mode, 'idb');
    assert.deepEqual(modes, ['memory', 'idb']);
    assert.equal(repo.debug.journalLength(), 0);
    assert.equal(backend.bulks.length, 1, 'the journal replayed in ONE transaction');
    assert.equal(backend.bulks[0].length, journalled, 'and carried every journalled write, once');
    assert.deepEqual(changes.filter((c) => c.reason === 'attach').length, 1);

    // Reads now come from the persistent backend, and a reload sees both threads.
    const titles = (await repo.listThreads()).map((t) => t.title);
    assert.deepEqual(titles.sort(), ['while memory', 'while pending']);
    const reopened = makeRepo(inner);
    await reopened.ready;
    assert.equal(reopened.mode, 'idb');
    assert.deepEqual((await reopened.listThreads()).map((t) => t.title).sort(), ['while memory', 'while pending']);
    assert.deepEqual((await reopened.getPath(early.id)).map((m) => m.content), ['typed before the database opened']);
  });

  test('repo: runTx writes are journalled too, so a late attach keeps them', async () => {
    /** @type {() => void} */ let openNow = () => {};
    const inner = createMemoryBackend({ kind: 'idb', ready: new Promise((r) => { openNow = () => r(undefined); }) });
    const backend = spyBackend(inner);
    backend.ready = inner.ready;
    const repo = makeRepo(backend);

    assert.equal(repo.mode, 'pending');
    // What migrateV1 does: one transaction over threads + messages + kv, before the database is up.
    await repo.runTx(['threads', 'messages', 'kv'], 'readwrite', async (tx) => {
      await tx.put('threads', { id: 'imported', title: 'from v1', createdAt: 1, updatedAt: 1, headId: 'm1', legacyId: 'L1', legacyHash: 'H1' });
      await tx.put('messages', { id: 'm1', threadId: 'imported', parentId: '', role: 'user', content: 'hello from v1', createdAt: 1, updatedAt: 1 });
      await tx.put('kv', { key: 'v1RawHash', value: 'H' });
    });
    assert.equal(backend.ops.filter((o) => o.op === 'put').length, 0, 'nothing reached IndexedDB while pending');
    assert.equal(repo.debug.journalLength(), 3, 'every runTx write is in the replay journal');

    // A failed transaction wrote nothing, so it must journal nothing either.
    await assert.rejects(() => repo.runTx(['threads'], 'readwrite', async (tx) => {
      await tx.put('threads', { id: 'doomed', title: 'rolled back', createdAt: 2, updatedAt: 2 });
      throw new Error('disk on fire');
    }), /disk on fire/);
    assert.equal(repo.debug.journalLength(), 3, 'a rolled-back transaction leaves the journal alone');

    openNow();
    await settle();
    assert.equal(repo.mode, 'idb');
    assert.equal(repo.debug.journalLength(), 0);
    // The imported chat survived the attach — and is there for the next session.
    const reopened = makeRepo(inner);
    await reopened.ready;
    assert.deepEqual((await reopened.listThreads()).map((t) => t.title), ['from v1']);
    assert.deepEqual((await reopened.getPath('imported')).map((m) => m.content), ['hello from v1']);
    assert.equal(await reopened.kvGet('v1RawHash', null), 'H');
    assert.equal(await reopened.getThread('doomed'), null);
    assert.ok(await reopened.findLegacy('L1', 'H1'), 'and findLegacy can still recognise it');
  });

  test('repo: an early open needs no attach event (nobody was shown a memory banner)', async () => {
    const bus = createBus();
    /** @type {any[]} */ const changes = [];
    /** @type {string[]} */ const modes = [];
    bus.on(EV.THREADS_CHANGED, (p) => changes.push(p));
    bus.on(EV.STORE_MODE, (m) => modes.push(m));
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }), { bus });
    await repo.ready;
    await settle();
    assert.equal(repo.mode, 'idb');
    assert.deepEqual(modes, ['idb']);
    assert.deepEqual(changes.filter((c) => c.reason === 'attach'), []);
  });

  test('repo: forceMemory gives memory-final, keeps working and never replays', async () => {
    let opened = false;
    const bus = createBus();
    /** @type {string[]} */ const modes = [];
    bus.on(EV.STORE_MODE, (m) => modes.push(m));
    const repo = openRepoSync({ bus, forceMemory: true, openPersistent: () => { opened = true; return createMemoryBackend(); } });
    await repo.ready;
    assert.equal(repo.mode, 'memory-final');
    assert.deepEqual(modes, ['memory-final']);
    assert.equal(opened, false, 'no database was ever opened');
    const th = repo.createThread({ title: 'this session only' });
    repo.appendMessage(th.id, { content: 'still works' });
    assert.deepEqual((await repo.getPath(th.id)).map((m) => m.content), ['still works']);
    assert.equal(repo.debug.journalLength(), 0, 'memory-final journals nothing to replay');
  });

  test('repo: an open error gives memory-final and drops the journal', async () => {
    const bus = createBus();
    /** @type {string[]} */ const modes = [];
    /** @type {any[]} */ const errors = [];
    bus.on(EV.STORE_MODE, (m) => modes.push(m));
    bus.on(EV.STORE_ERROR, (e) => errors.push(e));
    /** @type {(e: any) => void} */ let boom = () => {};
    const inner = createMemoryBackend({ kind: 'idb', ready: new Promise((_, rej) => { boom = rej; }) });
    const backend = spyBackend(inner);
    backend.ready = inner.ready;
    const repo = makeRepo(backend, { bus });
    const th = repo.createThread({ title: 'typed while opening' });
    await repo.listThreads();
    assert.ok(repo.debug.journalLength() > 0);

    boom(new Error('VersionError'));
    await settle();
    assert.equal(repo.mode, 'memory-final');
    assert.deepEqual(modes, ['memory-final']);
    assert.equal(repo.debug.journalLength(), 0);
    assert.equal(backend.ops.length, 0, 'a failed database is never written to');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].op, 'open');
    assert.deepEqual((await repo.listThreads()).map((t) => t.title), ['typed while opening']);
  });

  test('repo: no IndexedDB at all (Node/blocked) is memory-final, not a crash', async () => {
    const repo = openRepoSync({ indexedDB: null });
    await repo.ready;
    assert.equal(repo.mode, 'memory-final');
    const th = repo.createThread({ title: 'no store' });
    assert.equal((await repo.listThreads())[0].title, 'no store');
  });

  test('repo: a write failure emits STORE_ERROR instead of throwing at the caller', async () => {
    const bus = createBus();
    /** @type {any[]} */ const errors = [];
    bus.on(EV.STORE_ERROR, (e) => errors.push(e));
    const inner = createMemoryBackend({ kind: 'idb' });
    const backend = { ...inner, async bulk() { throw new Error('disk on fire'); } };
    const repo = makeRepo(backend, { bus });
    await repo.ready;
    const th = repo.createThread({ title: 'doomed' });            // sync, must not throw
    await repo.putMessage({ id: 'm1', threadId: th.id, parentId: null, content: 'x' });
    await repo.kvSet('k', 1);
    assert.ok(errors.length >= 2, 'every failed op reported on the bus');
    assert.deepEqual([...new Set(errors.map((e) => e.op))].sort(), ['createThread', 'kvSet', 'putMessage']);
  });

  test('repo: runTx is the one call that reports failure to its caller', async () => {
    const repo = makeRepo(createMemoryBackend({ kind: 'idb' }));
    await repo.ready;
    const th = repo.createThread({ title: 'tx' });
    const seen = await repo.runTx(['threads'], 'readonly', async (tx) => (await tx.getAll('threads')).map((t) => t.id));
    assert.deepEqual(seen, [th.id]);
    await assert.rejects(() => repo.runTx(['threads'], 'readwrite', async () => { throw new Error('nope'); }), /nope/);
    // …and a failed transaction leaves nothing behind.
    assert.deepEqual((await repo.listThreads()).map((t) => t.id), [th.id]);
  });
};
