// @ts-check
// state/schema.mjs `upgrade()` — the v1 → v2 IndexedDB migration (studio plan §3.6.1).
//
// Every user on shipped v0.1.45 has a version-1 database holding their chats. DB_VERSION went to 2
// and two stores were added; nothing in the gates proved that opening a v1 database at v2 keeps the
// chats (S0 review, finding 5). A migration is the one thing you do not ship on a code read.
//
// This is the FAKE-IDB half: it drives `upgrade(db, oldVersion, tx)` directly, which is why
// schema.mjs takes the database as an argument instead of reaching for a global. The other half —
// a real IndexedDB opened at v1 and reopened at v2 — is the harness scenario `s0-store-v2`.
import assert from 'node:assert/strict';
import { upgrade, STORES, STORE_NAMES, DB_VERSION, DB_NAME } from '../../../renderer/chat/state/schema.mjs';

const V1_STORES = ['threads', 'messages', 'attachments', 'recipes', 'kv'];
const V2_STORES = ['graphs', 'projects'];

/** A fake object store that remembers its indexes and its records. */
function fakeStore(name, keyPath) {
  /** @type {string[]} */ const indexes = [];
  return {
    name,
    keyPath,
    records: new Map(),
    createdIndexes: indexes,
    indexNames: { contains: (/** @type {string} */ i) => indexes.includes(i) },
    createIndex: (/** @type {string} */ i, /** @type {any} */ path, /** @type {any} */ o) => {
      if (indexes.includes(i)) throw new Error(`duplicate index ${name}.${i}`);
      indexes.push(i);
      return { name: i, keyPath: path, unique: !!(o && o.unique) };
    },
  };
}

/**
 * A fake IDBDatabase + the upgrade transaction that goes with it. `seed` names the stores that
 * already exist (with the indexes the version that made them would have created).
 * @param {string[]} seed
 */
function fakeDb(seed) {
  /** @type {Map<string, any>} */ const stores = new Map();
  for (const name of seed) {
    const def = STORES[name];
    const store = fakeStore(name, def.keyPath);
    for (const [index, path] of Object.entries(def.indexes)) store.createIndex(index, path, { unique: false });
    stores.set(name, store);
  }
  /** @type {string[]} */ const created = [];
  /** @type {string[]} */ const deleted = [];
  const db = {
    stores,
    created,
    deleted,
    objectStoreNames: { contains: (/** @type {string} */ n) => stores.has(n), get length() { return stores.size; } },
    createObjectStore: (/** @type {string} */ n, /** @type {any} */ o) => {
      if (stores.has(n)) throw new Error(`createObjectStore on an existing store: ${n}`);
      created.push(n);
      const s = fakeStore(n, o && o.keyPath);
      stores.set(n, s);
      return s;
    },
    deleteObjectStore: (/** @type {string} */ n) => { deleted.push(n); stores.delete(n); },
  };
  const tx = { objectStore: (/** @type {string} */ n) => stores.get(n) || null };
  return { db, tx };
}

export default (test) => {
  test('the pin is what the app opens: name lol-chat at version 2', () => {
    assert.equal(DB_NAME, 'lol-chat');
    assert.equal(DB_VERSION, 2);
    assert.deepEqual([...STORE_NAMES], [...V1_STORES, ...V2_STORES]);
  });

  test('a FRESH profile (oldVersion 0) lands on the full v2 shape', () => {
    const { db, tx } = fakeDb([]);
    upgrade(db, 0, tx);
    assert.deepEqual(db.created, [...V1_STORES, ...V2_STORES], 'both blocks ran, in order');
    for (const name of STORE_NAMES) {
      const store = db.stores.get(name);
      assert.ok(store, `${name} exists`);
      assert.equal(store.keyPath, STORES[name].keyPath);
      assert.deepEqual(store.createdIndexes.sort(), Object.keys(STORES[name].indexes).sort(), `${name} indexes`);
    }
  });

  test('a v1 database becomes v2 by ADDING two stores and touching nothing else', () => {
    const { db, tx } = fakeDb(V1_STORES);
    // A user's chats, as v1 left them.
    db.stores.get('threads').records.set('t1', { id: 't1', title: 'Rig notes' });
    db.stores.get('messages').records.set('m1', { id: 'm1', threadId: 't1', parentId: '', content: 'what GPU?' });
    db.stores.get('kv').records.set('ui:lastThreadId', { key: 'ui:lastThreadId', value: 't1' });

    upgrade(db, 1, tx);

    assert.deepEqual(db.created, V2_STORES, 'only the two new stores were created');
    assert.deepEqual(db.deleted, [], 'nothing is ever deleted (§3.7)');
    assert.equal(db.stores.get('threads').records.get('t1').title, 'Rig notes', 'the thread survived');
    assert.equal(db.stores.get('messages').records.get('m1').content, 'what GPU?', 'so did its message');
    assert.equal(db.stores.get('kv').records.get('ui:lastThreadId').value, 't1');
    for (const name of V1_STORES) {
      assert.deepEqual(db.stores.get(name).createdIndexes.sort(), Object.keys(STORES[name].indexes).sort(),
        `${name} kept exactly its indexes — no duplicate createIndex, which would throw in a real upgrade`);
    }
    for (const name of V2_STORES) {
      assert.deepEqual(db.stores.get(name).createdIndexes.sort(), Object.keys(STORES[name].indexes).sort());
    }
  });

  test('re-running the v2 block is a no-op, and a half-made store gets only its missing index', () => {
    // An interrupted upgrade (the tab closed mid-onupgradeneeded) leaves the store without one of
    // its indexes. The next open must ADD that index, not re-create the store and lose it.
    const { db, tx } = fakeDb([...V1_STORES, 'graphs']);
    db.stores.get('graphs').createdIndexes.length = 0;      // a store with no indexes yet
    db.stores.get('graphs').records.set('g1', { id: 'g1', threadId: 't1' });

    upgrade(db, 1, tx);

    assert.deepEqual(db.created, ['projects'], 'graphs already existed, so only projects was made');
    assert.deepEqual(db.stores.get('graphs').createdIndexes.sort(), ['threadId', 'updatedAt']);
    assert.equal(db.stores.get('graphs').records.get('g1').threadId, 't1', 'its rows are untouched');
  });

  test('opening an already-v2 database runs no block at all', () => {
    const { db, tx } = fakeDb([...V1_STORES, ...V2_STORES]);
    upgrade(db, 2, tx);
    assert.deepEqual(db.created, []);
    assert.deepEqual(db.deleted, []);
  });

  test('upgrade without a transaction never throws on an existing store', () => {
    // backend-idb passes the versionchange transaction; a caller that does not must still be safe.
    const { db } = fakeDb(V1_STORES);
    upgrade(db, 1, null);
    assert.deepEqual(db.created, V2_STORES);
  });
};
