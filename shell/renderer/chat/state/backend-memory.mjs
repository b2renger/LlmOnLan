// @ts-check
// The in-memory store backend (plan §3.7). Three jobs:
//   1. it IS the store while IndexedDB is still opening (`mode: 'pending'`), when the open timed out
//      (`'memory'`) and when there is no IndexedDB at all (`'memory-final'`);
//   2. it holds ephemeral threads for the whole session — they are never journaled and never written
//      to IndexedDB;
//   3. it is what Node unit tests run the repo against (no fake IndexedDB needed).
//
// It implements exactly the backend surface `backend-idb.mjs` implements, from the same
// `schema.mjs` definitions, so the repo above cannot tell them apart:
//   kind, ready, get, getAll, byIndex, put, del, bulk, scan, runTx, estimate, close
// plus a `sync` view of the same reads/writes, which only tests use (IndexedDB has no such thing).
// Every value in and out is structured-cloned, so a caller can never mutate what the store holds.
//
// NOT a pure module by the plan's list, but it touches no global except structuredClone.

import { STORE_NAMES, storeDef, keyOf, indexKeyOf, sameIndexKey } from './schema.mjs';

const clone = (/** @type {any} */ v) => (v === undefined || v === null ? v : structuredClone(v));

/**
 * @param {{ready?: Promise<void>, kind?: string}} [opts]
 *   `ready` lets a test script a slow or failing open while keeping memory semantics.
 */
export function createMemoryBackend(opts = {}) {
  /** @type {Map<string, Map<any, any>>} */
  const stores = new Map(STORE_NAMES.map((n) => [n, new Map()]));

  /** @param {string} name */
  function map(name) {
    const m = stores.get(name);
    if (!m) throw new Error(`unknown store "${name}"`);
    return m;
  }

  /** @param {string} store @param {any} value */
  function putSync(store, value) {
    const key = keyOf(store, value);
    if (key === undefined || key === null) throw new Error(`${store}: record has no ${storeDef(store).keyPath}`);
    map(store).set(key, clone(value));
  }

  /** @param {string} store @param {string} index @param {any} key */
  function byIndexSync(store, index, key) {
    const out = [];
    for (const rec of map(store).values()) {
      const k = indexKeyOf(store, index, rec);
      if (k !== undefined && sameIndexKey(k, key)) out.push(clone(rec));
    }
    return out;
  }

  const sync = {
    /** @param {string} store @param {any} key */
    get: (store, key) => clone(map(store).get(key) ?? null),
    /** @param {string} store */
    getAll: (store) => [...map(store).values()].map(clone),
    byIndex: byIndexSync,
    put: putSync,
    /** @param {string} store @param {any} key */
    del: (store, key) => { map(store).delete(key); },
    /** @param {string} store */
    count: (store) => map(store).size,
  };

  /** The transaction view handed to runTx(fn) — the same methods, promise-returning. */
  const tx = {
    /** @param {string} store @param {any} key */
    get: async (store, key) => sync.get(store, key),
    /** @param {string} store */
    getAll: async (store) => sync.getAll(store),
    /** @param {string} store @param {string} index @param {any} key */
    byIndex: async (store, index, key) => sync.byIndex(store, index, key),
    /** @param {string} store @param {any} value */
    put: async (store, value) => { sync.put(store, value); },
    /** @param {string} store @param {any} key */
    del: async (store, key) => { sync.del(store, key); },
  };

  const backend = {
    kind: opts.kind || 'memory',
    ready: opts.ready || Promise.resolve(),
    sync,
    ...tx,
    /**
     * Apply a list of writes as one unit. On a failure nothing is applied (the snapshot is restored),
     * which is what the journal replay needs.
     * @param {{op: 'put'|'del', store: string, value?: any, key?: any}[]} ops
     */
    async bulk(ops) {
      /** @type {Map<string, Map<any, any>>} */
      const backup = new Map([...stores].map(([n, m]) => [n, new Map(m)]));
      try {
        for (const op of ops) {
          if (op.op === 'put') sync.put(op.store, op.value);
          else sync.del(op.store, op.key !== undefined ? op.key : keyOf(op.store, op.value));
        }
      } catch (err) {
        for (const [n, m] of backup) stores.set(n, m);
        throw err;
      }
    },
    /**
     * Visit every record of a store. `visitor` returning false stops the scan.
     * @param {string} store @param {(rec: any) => boolean|void} visitor
     */
    async scan(store, visitor) {
      for (const rec of [...map(store).values()]) {
        if (visitor(clone(rec)) === false) return;
      }
    },
    /**
     * @param {string[]} _stores @param {'readonly'|'readwrite'} _mode @param {(t: typeof tx) => any} fn
     */
    async runTx(_stores, _mode, fn) {
      /** @type {Map<string, Map<any, any>>} */
      const backup = new Map([...stores].map(([n, m]) => [n, new Map(m)]));
      try {
        return await fn(tx);
      } catch (err) {
        for (const [n, m] of backup) stores.set(n, m);
        throw err;
      }
    },
    async estimate() { return null; },
    close() {},
  };
  return backend;
}

/** @typedef {ReturnType<typeof createMemoryBackend>} Backend */
