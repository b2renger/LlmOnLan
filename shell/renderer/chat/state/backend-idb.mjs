// @ts-check
// The IndexedDB store backend (plan §3.7). Same surface as `backend-memory.mjs`, built from the
// same `schema.mjs`, so `repo.mjs` treats the two identically:
//   kind, ready, get, getAll, byIndex, put, del, bulk, scan, runTx, estimate, close
//
// `ready` resolves when the database is open and rejects on `error` / `blocked` / a VersionError —
// the repo turns that rejection into mode 'memory-final'. Nothing here throws at import time and
// nothing reads `window`: the IDBFactory is passed in (`indexedDB`), so tests can inject one or
// none. `openDelayMs` delays the open (flags.idbOpenDelayMs) to exercise the pending/memory window.
//
// Transaction note: `runTx(stores, mode, fn)` gives `fn` a promise-returning view of ONE real
// IndexedDB transaction. Awaiting one of its methods is safe (the next request is issued in the
// success callback's microtask, before the transaction can commit); awaiting anything else —
// a timer, fetch, another repo method — lets the transaction commit and the next request throws
// TransactionInactiveError. Callers (today: the v1 migration) only await tx methods.
// A callback that THROWS aborts the transaction (IndexedDB would otherwise auto-commit whatever it
// had already written), so runTx is all-or-nothing on both backends — the v1 import depends on it.

import { DB_NAME, DB_VERSION, STORE_NAMES, storeDef, keyOf, upgrade } from './schema.mjs';

/** @param {IDBRequest} req */
function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

/**
 * @param {{name?: string, version?: number, indexedDB?: IDBFactory|null, openDelayMs?: number,
 *          setTimeout?: (fn: () => void, ms: number) => any}} [opts]
 */
export function createIdbBackend(opts = {}) {
  const name = opts.name || DB_NAME;
  const version = opts.version || DB_VERSION;
  const factory = opts.indexedDB !== undefined ? opts.indexedDB : (typeof indexedDB !== 'undefined' ? indexedDB : null);
  const delay = Number(opts.openDelayMs) || 0;
  const later = opts.setTimeout || ((fn, ms) => setTimeout(fn, ms));

  /** @type {IDBDatabase|null} */
  let db = null;
  let closed = false;

  const ready = new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('no IndexedDB in this context')); return; }
    const start = () => {
      /** @type {IDBOpenDBRequest} */
      let req;
      try {
        req = factory.open(name, version);
      } catch (err) {
        reject(err);
        return;
      }
      req.onupgradeneeded = (ev) => {
        try {
          upgrade(req.result, /** @type {any} */ (ev).oldVersion || 0, req.transaction);
        } catch (err) {
          try { if (req.transaction) req.transaction.abort(); } catch { /* already aborting */ }
          reject(err);
        }
      };
      req.onblocked = () => reject(new Error('IndexedDB open blocked by another connection'));
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onsuccess = () => {
        db = req.result;
        // Another tab (or a future version of this app) upgrading must not be blocked by us.
        db.onversionchange = () => { try { if (db) db.close(); } catch { /* closing anyway */ } db = null; };
        if (closed) { try { db.close(); } catch { /* ignore */ } db = null; reject(new Error('closed before open')); return; }
        // A store missing here means someone else created the database at this version with a
        // different shape: better to fall back to memory than to write into a store that is not there.
        const open = /** @type {IDBDatabase} */ (db);
        const missing = STORE_NAMES.filter((s) => !open.objectStoreNames.contains(s));
        if (missing.length) { reject(new Error(`database "${name}" is missing stores: ${missing.join(', ')}`)); return; }
        resolve(undefined);
      };
    };
    if (delay > 0) later(start, delay); else start();
  });

  /** @returns {IDBDatabase} */
  function handle() {
    if (!db) throw new Error('IndexedDB is not open');
    return db;
  }

  /** @param {string[]} names @param {'readonly'|'readwrite'} mode */
  function transaction(names, mode) {
    const t = handle().transaction(names, mode);
    const done = new Promise((resolve, reject) => {
      t.oncomplete = () => resolve(undefined);
      t.onerror = () => reject(t.error || new Error('IndexedDB transaction failed'));
      t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
    });
    return { t, done };
  }

  /** @param {IDBTransaction} t */
  function viewOf(t) {
    return {
      /** @param {string} store @param {any} key */
      get: async (store, key) => (await reqP(t.objectStore(store).get(key))) ?? null,
      /** @param {string} store */
      getAll: async (store) => /** @type {any[]} */ (await reqP(t.objectStore(store).getAll())),
      /** @param {string} store @param {string} index @param {any} key */
      byIndex: async (store, index, key) => /** @type {any[]} */ (await reqP(t.objectStore(store).index(index).getAll(key))),
      /** @param {string} store @param {any} value */
      put: async (store, value) => { await reqP(t.objectStore(store).put(value)); },
      /** @param {string} store @param {any} key */
      del: async (store, key) => { await reqP(t.objectStore(store).delete(key)); },
    };
  }

  /**
   * One short transaction per call. The promise settles when the transaction completes, so a caller
   * that awaits it knows the write is durable.
   * @param {string[]} names @param {'readonly'|'readwrite'} mode @param {(v: ReturnType<typeof viewOf>) => any} fn
   */
  async function inTx(names, mode, fn) {
    const { t, done } = transaction(names, mode);
    let result;
    try {
      result = await fn(viewOf(t));
    } catch (err) {
      // IndexedDB auto-commits: a throwing callback would otherwise COMMIT the writes it had
      // already made (verified on Electron 42.5.1 — two puts then a throw left both rows behind),
      // while backend-memory rolls them back. Abort so both backends are all-or-nothing, and
      // swallow `done`'s abort rejection: nobody is left to await it, and an unhandled rejection
      // surfaces as a renderer console error.
      try { t.abort(); } catch { /* already finished or aborting */ }
      done.catch(() => undefined);
      throw err;
    }
    await done;
    return result;
  }

  return {
    kind: 'idb',
    ready,
    /** @param {string} store @param {any} key */
    get: (store, key) => inTx([store], 'readonly', (v) => v.get(store, key)),
    /** @param {string} store */
    getAll: (store) => inTx([store], 'readonly', (v) => v.getAll(store)),
    /** @param {string} store @param {string} index @param {any} key */
    byIndex: (store, index, key) => inTx([store], 'readonly', (v) => v.byIndex(store, index, key)),
    /** @param {string} store @param {any} value */
    put: (store, value) => inTx([store], 'readwrite', (v) => v.put(store, value)),
    /** @param {string} store @param {any} key */
    del: (store, key) => inTx([store], 'readwrite', (v) => v.del(store, key)),
    /** @param {{op: 'put'|'del', store: string, value?: any, key?: any}[]} ops */
    async bulk(ops) {
      if (!ops.length) return;
      const names = [...new Set(ops.map((o) => o.store))];
      await inTx(names, 'readwrite', async (v) => {
        for (const op of ops) {
          if (op.op === 'put') await v.put(op.store, op.value);
          else await v.del(op.store, op.key !== undefined ? op.key : keyOf(op.store, op.value));
        }
      });
    },
    /**
     * Cursor scan; `visitor` returning false stops it (and the transaction ends there).
     * @param {string} store @param {(rec: any) => boolean|void} visitor
     */
    async scan(store, visitor) {
      const { t, done } = transaction([store], 'readonly');
      await new Promise((resolve, reject) => {
        const req = t.objectStore(store).openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) { resolve(undefined); return; }
          let go = true;
          try { go = visitor(cur.value) !== false; } catch (err) { reject(err); return; }
          if (!go) { resolve(undefined); return; }
          cur.continue();
        };
        req.onerror = () => reject(req.error || new Error('cursor failed'));
      });
      await done.catch(() => undefined);
    },
    /** @param {string[]} names @param {'readonly'|'readwrite'} mode @param {(v: any) => any} fn */
    runTx: (names, mode, fn) => inTx(names, mode, fn),
    async estimate() {
      try {
        const nav = /** @type {any} */ (globalThis).navigator;
        if (!nav || !nav.storage || typeof nav.storage.estimate !== 'function') return null;
        const e = await nav.storage.estimate();
        return { usage: Number(e.usage) || 0, quota: Number(e.quota) || 0 };
      } catch {
        return null;
      }
    },
    close() {
      closed = true;
      try { if (db) db.close(); } catch { /* ignore */ }
      db = null;
    },
  };
}

/** Re-exported so a caller needs only this module to know the database it opens. */
export { storeDef, DB_NAME, DB_VERSION };
