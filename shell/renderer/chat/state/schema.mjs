// @ts-check
// The IndexedDB shape of the LOL Chat store: database `lol-chat`, version 2 (plan §3.7; v2 added
// at the S0 kickoff, studio plan §3.6.1).
//
// This file is the ONE place the store layout is written down. `backend-idb.mjs` builds the real
// object stores from it in onupgradeneeded; `backend-memory.mjs` emulates the same stores and
// indexes from it, so a memory-backed repo and an IDB-backed repo answer identically.
//
// NOT listed as a pure module (plan §2.6 C) — it is however global-free: `upgrade(db, oldVersion)`
// takes the database it upgrades, so Node tests can drive it with a fake.
//
// Two shape rules the rest of the store depends on:
//   - `messages.parentId` is stored as '' for roots, never null, so the compound index
//     ['threadId','parentId'] indexes root messages too (null is not a valid IndexedDB key).
//     repo.mjs converts on the way in (toStore) and out (fromStore); everything above the backend
//     sees `parentId: string|null` as in the §3.3 typedef.
//   - `threads.pinned` is a boolean, which is NOT a valid IndexedDB key either: the `pinned` index
//     exists because §3.7 declares it, but it stays empty and nothing queries it (listThreads sorts
//     in memory). Declared, not used — deleting it later would be a schema change for nothing.
//
// Upgrades: add `if (oldVersion < N) { … }` blocks, never delete a store (§3.7).

export const DB_NAME = 'lol-chat';
export const DB_VERSION = 2;

/** @typedef {{keyPath: string, indexes: Record<string, string|string[]>, unique?: string[]}} StoreDef */

/** @type {Record<string, StoreDef>} */
export const STORES = Object.freeze({
  threads: { keyPath: 'id', indexes: { updatedAt: 'updatedAt', pinned: 'pinned', legacy: ['legacyId', 'legacyHash'] } },
  messages: { keyPath: 'id', indexes: { threadId: 'threadId', threadParent: ['threadId', 'parentId'] } },
  attachments: { keyPath: 'id', indexes: { threadId: 'threadId', threadSha: ['threadId', 'sha256'] } },
  recipes: { keyPath: 'id', indexes: { trigger: 'trigger' } },
  kv: { keyPath: 'key', indexes: {} },
  // v2 (S0 kickoff). `graphs` holds the Computer panel's graph documents (one per thread today;
  // the index is not unique so a thread may grow more later). `projects` is a METADATA MIRROR of
  // the scratch-project folders — the files themselves live on disk and never in IndexedDB.
  graphs: { keyPath: 'id', indexes: { threadId: 'threadId', updatedAt: 'updatedAt' } },
  projects: { keyPath: 'id', indexes: { threadId: 'threadId', updatedAt: 'updatedAt' } },
});

/** The stores each DB version introduced, so `upgrade` never guesses. */
const V1_STORES = Object.freeze(['threads', 'messages', 'attachments', 'recipes', 'kv']);
const V2_STORES = Object.freeze(['graphs', 'projects']);

/** Every store name, in a stable order. @type {string[]} */
export const STORE_NAMES = Object.freeze(Object.keys(STORES));

/** @param {string} name @returns {StoreDef} */
export function storeDef(name) {
  const def = /** @type {any} */ (STORES)[name];
  if (!def) throw new Error(`unknown store "${name}"`);
  return def;
}

/**
 * The primary key of a record.
 * @param {string} store @param {any} record @returns {any}
 */
export function keyOf(store, record) {
  return record == null ? undefined : record[storeDef(store).keyPath];
}

/**
 * The value an index would hold for a record, or `undefined` when the record is not indexable
 * (a missing part of a compound key, or a non-key type such as a boolean) — exactly the records
 * IndexedDB silently leaves out of the index.
 * @param {string} store @param {string} index @param {any} record @returns {any}
 */
export function indexKeyOf(store, index, record) {
  const path = storeDef(store).indexes[index];
  if (path === undefined) throw new Error(`unknown index "${store}.${index}"`);
  const valid = (/** @type {any} */ v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
  if (Array.isArray(path)) {
    const parts = path.map((p) => (record ? record[p] : undefined));
    return parts.every(valid) ? parts : undefined;
  }
  const v = record ? record[path] : undefined;
  return valid(v) ? v : undefined;
}

/** Deep equality for index keys (a compound key is an array of primitives). */
export function sameIndexKey(/** @type {any} */ a, /** @type {any} */ b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => x === b[i]);
  }
  return a === b;
}

/**
 * onupgradeneeded: create the stores/indexes this version needs. Switch-fallthrough style so a
 * future version only adds a block.
 * @param {IDBDatabase} db @param {number} oldVersion @param {IDBTransaction|null} [tx]
 */
export function upgrade(db, oldVersion, tx) {
  /** @param {readonly string[]} names */
  const create = (names) => {
    for (const name of names) {
      const def = storeDef(name);
      const store = db.objectStoreNames.contains(name)
        ? (tx ? tx.objectStore(name) : null)
        : db.createObjectStore(name, { keyPath: def.keyPath });
      if (!store) continue;
      for (const [index, path] of Object.entries(def.indexes)) {
        if (!store.indexNames.contains(index)) store.createIndex(index, /** @type {any} */ (path), { unique: false });
      }
    }
  };
  if (oldVersion < 1) create(V1_STORES);
  // A fresh profile (oldVersion === 0) runs BOTH blocks and lands on v2 through the same code path
  // a v1 → v2 upgrade takes. Nothing is ever deleted.
  if (oldVersion < 2) create(V2_STORES);
}
