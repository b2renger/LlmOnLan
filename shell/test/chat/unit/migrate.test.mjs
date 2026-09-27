// The v1 → v2 history migration (P0-U4) against real-shaped fixtures of the v0.1.45 localStorage
// key. `transformV1` is pure, so it is tested directly; `migrateV1`/`v1Status`/`removeV1Copy` run
// against the REAL repo over a memory backend and a fake Storage that records every call.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformV1, migrateV1, v1Status, removeV1Copy, V1_KEY } from '../../../renderer/chat/state/migrate-v0.mjs';
import { openRepoSync } from '../../../renderer/chat/state/repo.mjs';
import { createMemoryBackend } from '../../../renderer/chat/state/backend-memory.mjs';
import { createBus, EV } from '../../../renderer/chat/core/events.mjs';
import { hash } from '../../../renderer/chat/core/ids.mjs';

const FIXTURES = new URL('../fixtures/v1/', import.meta.url);
const fixture = (/** @type {string} */ name) => readFileSync(new URL(name, FIXTURES), 'utf8');
const parsed = (/** @type {string} */ name) => JSON.parse(fixture(name));

/** 2026-09-10T…, comfortably after every fixture id and before "now + 1 day". */
const NOW = 1_789_100_000_000;

/** A Storage-like object that counts what the migration does to it. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const calls = { get: 0, set: 0, remove: 0 };
  return {
    map,
    calls,
    getItem: (/** @type {string} */ k) => { calls.get++; return map.has(k) ? /** @type {string} */ (map.get(k)) : null; },
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { calls.set++; map.set(k, String(v)); },
    removeItem: (/** @type {string} */ k) => { calls.remove++; map.delete(k); },
  };
}

/** A repo in 'idb' mode over a memory backend; pass a backend to survive a "reload". */
function makeRepo(backend = createMemoryBackend({ kind: 'idb' }), bus = null) {
  const repo = openRepoSync({ bus, openPersistent: () => backend });
  return { repo, backend };
}

const titlesOf = async (/** @type {any} */ repo) => (await repo.listThreads()).map((t) => t.title);

const STATE = new URL('../../../renderer/chat/state/', import.meta.url);

export default (test) => {
  // ---------------------------------------------------------------- transformV1 (pure)
  test('transformV1: three real threads keep their order, chain and metadata', () => {
    const out = transformV1(fixture('three.json'), { now: NOW });
    assert.equal(out.skipped, 0);
    assert.deepEqual(out.threads.map((t) => t.title), ['Rig notes', 'Kitchen table', 'New chat']);
    assert.deepEqual(out.threads.map((t) => t.createdAt), [1789000300000, 1789000200000, 1789000100000]);
    assert.ok(out.threads[0].createdAt > out.threads[1].createdAt, 'newest first, as v1 stored them');

    const [first] = out.threads;
    const own = out.messages.filter((m) => m.threadId === first.id);
    assert.deepEqual(own.map((m) => m.role), ['user', 'assistant']);
    assert.equal(own[0].parentId, null);
    assert.equal(own[1].parentId, own[0].id);
    assert.equal(own[1].createdAt, own[0].createdAt + 1000);
    assert.equal(first.headId, own[1].id);
    assert.equal(first.updatedAt, own[1].updatedAt);
    assert.deepEqual(own[0].parts, [{ type: 'text', text: 'What GPU does the farm have?' }]);
    assert.deepEqual(own[1].parts, []);
    assert.equal(own[1].stats.text, '128 tok · 42.0 tok/s · first token 0.31s');
    assert.equal(own[1].stats.completionTokens, null);
    assert.equal(own[0].status, 'done');
    assert.equal(own[0].error, null);

    assert.equal(first.imported, true);
    assert.equal(first.legacyId, '1789000300000abcde');
    assert.equal(first.legacyHash, hash(JSON.stringify(parsed('three.json')[0].messages)));
    assert.equal(first.titleSource, 'auto');
    assert.equal(first.pinned, false);
    assert.equal(first.ephemeral, false);
  });

  test('transformV1: the empty store gives nothing at all', () => {
    assert.deepEqual(transformV1(fixture('empty.json'), { now: NOW }), { threads: [], messages: [], skipped: 0 });
  });

  test('transformV1: corrupt JSON throws (migrateV1 turns that into "failed")', () => {
    assert.throws(() => transformV1(fixture('corrupt.json'), { now: NOW }));
    assert.throws(() => transformV1('{"not":"an array"}', { now: NOW }), /not an array/);
  });

  test('transformV1: createdAt comes from a plausible id prefix, else is synthesised', () => {
    const out = transformV1(fixture('ids.json'), { now: NOW });
    const [prefixed, noPrefix, future, ancient] = out.threads;
    assert.equal(prefixed.createdAt, 1789000400000, 'a 13-digit prefix in range is the creation time');
    assert.equal(noPrefix.createdAt, NOW - 1 * 60_000, 'no prefix → synthesised, one minute apart');
    assert.equal(future.createdAt, NOW - 2 * 60_000, 'year 2286 is not a plausible v1 id');
    assert.equal(ancient.createdAt, NOW - 3 * 60_000, 'year 2001 is before LOL Chat existed');
    assert.deepEqual(out.threads.map((t) => t.title), ['Prefixed', 'No prefix', 'Implausible future', 'Too old (2001)']);
  });

  test('transformV1: the v1 busy/error notes become real statuses', () => {
    const out = transformV1(fixture('notes.json'), { now: NOW });
    const msgsOf = (/** @type {number} */ i) => out.messages.filter((m) => m.threadId === out.threads[i].id);

    const [, busyOnly] = msgsOf(0);
    assert.equal(busyOnly.status, 'local', 'the client wrote it; nothing was ever sent');
    assert.equal(busyOnly.content, '⏳ The server is busy: loading gemma4:12b (42%). Try again in a moment.');
    assert.equal(busyOnly.error, null);
    assert.equal(busyOnly.reasoning, null, 'an empty v1 reasoning string is null, not ""');

    const [, errored] = msgsOf(1);
    assert.equal(errored.status, 'error');
    assert.equal(errored.content, 'Half an answer', 'the tail is stripped out of the text');
    assert.equal(errored.error.message, 'HTTP 500');
    assert.equal(errored.error.kind, 'stream_error');

    const [, busyTail] = msgsOf(2);
    assert.equal(busyTail.status, 'error');
    assert.equal(busyTail.content, 'Half an answer');
    assert.equal(busyTail.error.message, '⏳ The server is busy: switching model. Try again in a moment.');
    assert.equal(busyTail.error.kind, 'upstream_down');
  });

  // The markers are APPENDED by the v1 client, so they only count at the END of the message.
  // An unanchored search truncated a real answer that merely quoted one (and gave it status
  // 'error', which draftFromPath drops from the history) - silent history loss at upgrade time.
  test('transformV1: a QUOTED busy/error marker is not a status - the whole text survives', () => {
    const out = transformV1(fixture('quoted-markers.json'), { now: NOW });
    const msgsOf = (/** @type {number} */ i) => out.messages.filter((m) => m.threadId === out.threads[i].id);

    const [, quotedError] = msgsOf(0);
    assert.equal(quotedError.status, 'done', 'a mid-text [error: ...] is prose, not a failed turn');
    assert.equal(quotedError.error, null);
    assert.equal(
      quotedError.content,
      'The log says:\n\n[error: connection refused]\n\nwhich means the port is closed. Restart the farm and retry.',
      'nothing after the quoted marker may be dropped',
    );

    const [, quotedBusy] = msgsOf(1);
    assert.equal(quotedBusy.status, 'done', 'a quoted busy sentence with text after it is prose');
    assert.equal(quotedBusy.error, null);
    assert.ok(quotedBusy.content.endsWith('so just wait.'), 'the text after the quoted note survives');

    // ...and when a real tail DOES end the message, the earlier quote stays in the content.
    const [, quotedThenFailed] = msgsOf(2);
    assert.equal(quotedThenFailed.status, 'error');
    assert.equal(quotedThenFailed.error.message, 'HTTP 500', 'the LAST marker is the real one');
    assert.equal(quotedThenFailed.content, 'You will see\n\n[error: quota]\n\nin the log. Now, the actual');
  });

  test('transformV1: reasoning and stats survive', () => {
    const out = transformV1(fixture('reasoning-stats.json'), { now: NOW });
    const a = out.messages[1];
    assert.equal(a.reasoning, 'step 1\nstep 2');
    assert.equal(a.reasoningMs, null);
    assert.equal(a.stats.text, '56 tok · 12.5 tok/s · first token 0.90s');
    assert.equal(out.messages[0].reasoning, null, 'user messages never carry reasoning');
  });

  test('transformV1: unusable messages are skipped and the chain closes over them', () => {
    const out = transformV1(fixture('non-string-content.json'), { now: NOW });
    assert.equal(out.skipped, 2, 'an object content and a system role');
    assert.equal(out.messages.length, 2);
    assert.deepEqual(out.messages.map((m) => m.content), ['ok', 'fine']);
    assert.equal(out.messages[1].parentId, out.messages[0].id, 'the survivors stay one chain');
    assert.equal(out.threads[0].headId, out.messages[1].id);
  });

  test('transformV1: injected ids and hash make the output deterministic', () => {
    let n = 0;
    const inject = { now: NOW, newId: () => `id${++n}`, hash: () => 'HASH' };
    const a = transformV1(fixture('three.json'), inject);
    n = 0;
    const b = transformV1(fixture('three.json'), inject);
    assert.deepEqual(a, b);
    assert.equal(a.threads[0].id, 'id1');
    assert.equal(a.threads[0].legacyHash, 'HASH');
  });

  // ---------------------------------------------------------------- migrateV1
  test('migrateV1: nothing to do when the key is absent or unreadable', async () => {
    const { repo } = makeRepo();
    await repo.ready;
    assert.deepEqual(await migrateV1({ repo, storage: fakeStorage(), now: () => NOW }), { status: 'none', imported: 0, copies: 0, skipped: 0 });

    const storage = fakeStorage({ [V1_KEY]: fixture('corrupt.json') });
    const result = await migrateV1({ repo, storage, now: () => NOW });
    assert.equal(result.status, 'failed');
    assert.equal(storage.map.get(V1_KEY), fixture('corrupt.json'), 'the key is left exactly as it was');
    assert.equal(storage.calls.set + storage.calls.remove, 0, 'storage is never written by the migration');
    assert.deepEqual(await repo.listThreads(), []);
    assert.equal(await repo.kvGet('v1RawHash', null), null, 'a failed read is retried next boot');
  });

  test('migrateV1: imports the three fixture threads in v1 order and keeps the key', async () => {
    const bus = createBus();
    /** @type {any[]} */ const changes = [];
    bus.on(EV.THREADS_CHANGED, (p) => changes.push(p));
    const { repo } = makeRepo(undefined, bus);
    await repo.ready;
    const storage = fakeStorage({ [V1_KEY]: fixture('three.json') });

    const result = await migrateV1({ repo, storage, now: () => NOW, bus });
    assert.deepEqual(result, { status: 'done', imported: 3, copies: 0, skipped: 0 });
    assert.deepEqual(await titlesOf(repo), ['Rig notes', 'Kitchen table', 'New chat']);
    assert.equal(storage.map.get(V1_KEY), fixture('three.json'), 'the v1 copy is never removed automatically');
    assert.equal(storage.calls.remove, 0);
    assert.equal(await repo.kvGet('v1RawHash', null), hash(fixture('three.json')));

    const migrated = changes.filter((c) => c.reason === 'migrate');
    assert.equal(migrated.length, 1);
    assert.equal(migrated[0].ids.length, 3);

    // The imported thread reads back as a real conversation.
    const [first] = await repo.listThreads();
    const path = await repo.getPath(first.id);
    assert.deepEqual(path.map((m) => m.role), ['user', 'assistant']);
    assert.equal(path[0].parentId, null);
    assert.equal(path[1].parentId, path[0].id);
    assert.equal(path[1].content, 'An RTX A6000 Pro.');
    assert.ok(await repo.findLegacy(first.legacyId, first.legacyHash));
  });

  test('migrateV1: a second run is "already" and imports nothing twice', async () => {
    const { repo, backend } = makeRepo();
    await repo.ready;
    const storage = fakeStorage({ [V1_KEY]: fixture('three.json') });
    await migrateV1({ repo, storage, now: () => NOW });
    const again = await migrateV1({ repo, storage, now: () => NOW });
    assert.deepEqual(again, { status: 'already', imported: 0, copies: 0, skipped: 0 });
    assert.equal((await repo.listThreads()).length, 3);

    // …and so is the next boot, which is a brand new repo over the same database.
    const { repo: reopened } = makeRepo(backend);
    await reopened.ready;
    assert.equal((await migrateV1({ repo: reopened, storage, now: () => NOW })).status, 'already');
    assert.equal((await reopened.listThreads()).length, 3);
  });

  test('migrateV1: the cheap path is skipped when the raw text changed, and merges by (legacyId, legacyHash)', async () => {
    const { repo } = makeRepo();
    await repo.ready;
    const storage = fakeStorage({ [V1_KEY]: fixture('three.json') });
    await migrateV1({ repo, storage, now: () => NOW });

    // The v1 client (still installed) started one more chat: same three threads plus a new one.
    const grown = JSON.stringify([{ id: '1789000950000nnnnn', title: 'Newer', messages: [{ role: 'user', content: 'fresh' }] }, ...parsed('three.json')]);
    storage.map.set(V1_KEY, grown);
    const result = await migrateV1({ repo, storage, now: () => NOW });
    assert.deepEqual(result, { status: 'done', imported: 1, copies: 0, skipped: 0 });
    assert.deepEqual((await titlesOf(repo)).sort(), ['Kitchen table', 'New chat', 'Newer', 'Rig notes']);
  });

  test('migrateV1: a rolled-back thread arrives as one "(older version)" copy', async () => {
    const { repo } = makeRepo();
    await repo.ready;
    const storage = fakeStorage({ [V1_KEY]: fixture('rolled-back-a.json') });
    assert.equal((await migrateV1({ repo, storage, now: () => NOW })).imported, 1);
    const [original] = await repo.listThreads();
    const originalPath = await repo.getPath(original.id);

    storage.map.set(V1_KEY, fixture('rolled-back-b.json'));      // same id, one more message
    const result = await migrateV1({ repo, storage, now: () => NOW });
    assert.deepEqual(result, { status: 'done', imported: 0, copies: 1, skipped: 0 });

    const all = await repo.listThreads();
    assert.equal(all.length, 2);
    assert.deepEqual(all.map((t) => t.title).sort(), ['Rollback', 'Rollback (older version)']);
    assert.equal(all.filter((t) => t.legacyId === '1789001000000rrrrr').length, 2);

    const untouched = await repo.getThread(original.id);
    assert.equal(untouched.title, 'Rollback');
    assert.deepEqual((await repo.getPath(original.id)).map((m) => m.content), originalPath.map((m) => m.content));
    const copy = all.find((t) => t.title.endsWith('(older version)'));
    assert.equal((await repo.getPath(copy.id)).length, 3);
    assert.notEqual(copy.legacyHash, original.legacyHash);
  });

  test('migrateV1: 100 threads import in one go, in order', async () => {
    const { repo } = makeRepo();
    await repo.ready;
    const storage = fakeStorage({ [V1_KEY]: fixture('hundred.json') });
    const result = await migrateV1({ repo, storage, now: () => NOW });
    assert.deepEqual(result, { status: 'done', imported: 100, copies: 0, skipped: 0 });
    const titles = await titlesOf(repo);
    assert.equal(titles.length, 100);
    assert.deepEqual(titles.slice(0, 3), ['Chat 1', 'Chat 2', 'Chat 3']);
    assert.equal(titles[99], 'Chat 100');
    assert.equal((await repo.getMessages((await repo.listThreads())[0].id)).length, 2);
  });

  test('migrateV1: skipped messages are reported, not silently dropped', async () => {
    const { repo } = makeRepo();
    await repo.ready;
    const storage = fakeStorage({ [V1_KEY]: fixture('non-string-content.json') });
    const result = await migrateV1({ repo, storage, now: () => NOW });
    assert.deepEqual(result, { status: 'done', imported: 1, copies: 0, skipped: 2 });
    const [th] = await repo.listThreads();
    assert.deepEqual((await repo.getPath(th.id)).map((m) => m.content), ['ok', 'fine']);
  });

  // ---------------------------------------------------------------- v1Status / removeV1Copy
  test('v1Status: counts what is already here', async () => {
    const { repo } = makeRepo();
    await repo.ready;
    assert.deepEqual(await v1Status({ repo, storage: fakeStorage() }), { present: false, total: 0, migrated: 0, pending: 0 });

    const storage = fakeStorage({ [V1_KEY]: fixture('three.json') });
    assert.deepEqual(await v1Status({ repo, storage }), { present: true, total: 3, migrated: 0, pending: 3 });
    await migrateV1({ repo, storage, now: () => NOW });
    assert.deepEqual(await v1Status({ repo, storage }), { present: true, total: 3, migrated: 3, pending: 0 });

    const corrupt = fakeStorage({ [V1_KEY]: fixture('corrupt.json') });
    assert.deepEqual(await v1Status({ repo, storage: corrupt }), { present: true, total: 0, migrated: 0, pending: 0 });
  });

  test('removeV1Copy: refuses while anything is pending, then removes the key exactly once', async () => {
    const { repo } = makeRepo();
    await repo.ready;
    const storage = fakeStorage({ [V1_KEY]: fixture('three.json') });

    // Nothing migrated yet: it migrates first, then removes.
    assert.equal(storage.calls.remove, 0);
    assert.equal(await removeV1Copy({ repo, storage, now: () => NOW }), true);
    assert.equal(storage.map.has(V1_KEY), false);
    assert.equal(storage.calls.remove, 1);
    assert.equal((await repo.listThreads()).length, 3);

    // Nothing left to remove.
    assert.equal(await removeV1Copy({ repo, storage, now: () => NOW }), false);
    assert.equal(storage.calls.remove, 1);
  });

  test('removeV1Copy: refuses when a v1 thread cannot be imported', async () => {
    const { repo } = makeRepo();
    await repo.ready;
    const storage = fakeStorage({ [V1_KEY]: fixture('corrupt.json') });
    assert.equal(await removeV1Copy({ repo, storage, now: () => NOW }), false);
    assert.equal(storage.map.get(V1_KEY), fixture('corrupt.json'));
    assert.equal(storage.calls.remove, 0);
  });

  test('storage.removeItem is called by removeV1Copy and by nothing else', async () => {
    const { repo } = makeRepo();
    await repo.ready;
    const storage = fakeStorage({ [V1_KEY]: fixture('three.json') });
    await migrateV1({ repo, storage, now: () => NOW });
    await migrateV1({ repo, storage, now: () => NOW });
    await v1Status({ repo, storage });
    await transformV1(fixture('three.json'), { now: NOW });
    assert.equal(storage.calls.remove, 0);
    assert.equal(storage.calls.set, 0);
    await removeV1Copy({ repo, storage, now: () => NOW });
    assert.equal(storage.calls.remove, 1);
  });

  test('migrateV1: a Storage that throws is treated as absent', async () => {
    const { repo } = makeRepo();
    await repo.ready;
    const angry = { getItem() { throw new Error('SecurityError'); }, setItem() {}, removeItem() {} };
    assert.equal((await migrateV1({ repo, storage: angry, now: () => NOW })).status, 'none');
    assert.deepEqual(await v1Status({ repo, storage: angry }), { present: false, total: 0, migrated: 0, pending: 0 });
  });

  test('state/migrate-v0.mjs is pure: it imports and runs with window/document/localStorage/indexedDB trapped', async () => {
    const names = ['window', 'document', 'localStorage', 'indexedDB'];
    const saved = names.map((n) => Object.getOwnPropertyDescriptor(globalThis, n));
    for (const n of names) Object.defineProperty(globalThis, n, { configurable: true, get() { throw new Error(`pure module touched ${n}`); } });
    try {
      const mod = await import(new URL('migrate-v0.mjs?trap=' + Date.now(), STATE).href);
      assert.equal(mod.V1_KEY, V1_KEY);
      assert.equal(mod.transformV1(fixture('three.json'), { now: NOW }).threads.length, 3);
    } finally {
      names.forEach((n, i) => { if (saved[i]) Object.defineProperty(globalThis, n, saved[i]); else delete globalThis[n]; });
    }
  });
};
