// @ts-check
// The LOL Chat store (plan §3.4 Repo API + §3.7). One object over two backends:
//
//   openRepoSync(opts) returns AT ONCE — the chat never waits on IndexedDB. Until the database is
//   open the repo is a memory store plus a replay JOURNAL:
//     'pending'      opening; reads come from memory, writes go to memory and to the journal
//     'idb'          open: the journal was replayed in one transaction, reads/writes are IndexedDB
//     'memory'       the open passed `timeoutMs` — keep working, KEEP WAITING (a late open still
//                    attaches, replays the journal exactly once and emits THREADS_CHANGED 'attach')
//     'memory-final' no IndexedDB, forceMemory, or the open failed: nothing will be saved
//   Every transition emits EV.STORE_MODE with the bare mode string (P1-U4 renders the banner).
//
// Shape rules the rest of the app relies on:
//   - `createThread` and `appendMessage` are SYNCHRONOUS and return the record they wrote — the same
//     object, not a copy, so a caller can keep mutating it while a reply streams and hand it to
//     checkpoint()/finalize(). Every backend write takes a snapshot, so later mutations never leak
//     into an already-issued write. Reads return copies.
//   - Writes run on ONE promise chain in call order; reads join the same chain, so a read always
//     sees every write issued before it. A failing write emits EV.STORE_ERROR and resolves — store
//     trouble must never throw into UI code (`runTx` is the one exception: its caller, the v1
//     migration, needs to know).
//   - `checkpoint(msg)` is a trailing 1 s throttle per message id (crash safety while streaming
//     costs at most one write per second); `finalize(msg)` cancels the timer and writes now.
//   - Ephemeral threads live in a SEPARATE memory backend for the whole session: never journaled,
//     never written to IndexedDB, gone when the window closes.
//   - `appendMessage` takes the parent from the thread's cached head, so a thread must have been
//     created or read in this session before messages are appended to it (the controller always
//     selects a thread first); pass `parentId` explicitly to branch.
//
// NOT a pure module: it reaches for globalThis.indexedDB and navigator.storage when they exist.
// Both are injectable, so Node unit tests run the real repo over `backend-memory.mjs`.

import { EV } from '../core/events.mjs';
import { t } from '../core/i18n.mjs';
import { newId as makeId } from '../core/ids.mjs';
import { createMemoryBackend } from './backend-memory.mjs';
import { createIdbBackend } from './backend-idb.mjs';
import { indexNodes, pathTo, subtreeIds, repairHead } from './tree.mjs';
import { DB_NAME } from './schema.mjs';
import '../strings/core.en.mjs';

/** How long a streaming message may sit unwritten (plan §3.4: ≤ 1 put per second per id). */
export const CHECKPOINT_MS = 1000;

const clone = (/** @type {any} */ v) => (v === undefined || v === null ? v : structuredClone(v));

/** Messages are stored with parentId '' for roots (schema.mjs); the API speaks null. */
const toStoreMsg = (/** @type {any} */ m) => ({ ...m, parentId: m.parentId == null ? '' : m.parentId });
const fromStoreMsg = (/** @type {any} */ m) => (m ? { ...m, parentId: m.parentId === '' || m.parentId == null ? null : m.parentId } : null);

/**
 * @param {import('../core/types.mjs').RepoOptions & {
 *   openPersistent?: (o: any) => any,          // test seam: the "IndexedDB" backend factory
 *   setTimeout?: (fn: () => void, ms: number) => any,
 *   clearTimeout?: (h: any) => void,
 * }} [options]
 * @returns {import('../core/types.mjs').Repo}
 */
export function openRepoSync(options = {}) {
  const opts = options || {};
  const idbName = opts.idbName || DB_NAME;
  const forceMemory = !!opts.forceMemory;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Number(opts.timeoutMs) : 3000;
  const idbOpenDelayMs = Number(opts.idbOpenDelayMs) || 0;
  const bus = opts.bus || null;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const newId = typeof opts.newId === 'function' ? opts.newId : () => makeId({ now });
  const later = opts.setTimeout || ((/** @type {() => void} */ fn, /** @type {number} */ ms) => setTimeout(fn, ms));
  const cancel = opts.clearTimeout || ((/** @type {any} */ h) => clearTimeout(h));
  const openPersistent = opts.openPersistent || ((/** @type {any} */ o) => createIdbBackend(o));

  const mem = createMemoryBackend();
  const eph = createMemoryBackend({ kind: 'ephemeral' });
  /** @type {any} The backend that holds everything non-ephemeral right now. */
  let persist = mem;

  /** @type {{op: 'put'|'del', store: string, value?: any, key?: any}[]} */
  const journal = [];
  /** @type {Set<string>} */
  const ephemeralIds = new Set();
  /** @type {Map<string, any>} Last known thread record, for the synchronous appendMessage. */
  const threadCache = new Map();
  /** @type {Set<string>} Thread ids this session wrote to the PERSISTENT backend (debug). */
  const persisted = new Set();
  /** @type {Map<string, {msg: any, timer: any}>} */
  const pendingCheckpoints = new Map();

  let attached = false;
  let readyDone = false;
  /** @type {() => void} */
  let resolveReady = () => {};
  const ready = new Promise((resolve) => { resolveReady = () => { if (!readyDone) { readyDone = true; resolve(undefined); } }; });
  /** @type {any} */
  let timeoutTimer = null;

  const emit = (/** @type {string} */ name, /** @type {any} */ payload) => { if (bus) bus.emit(name, payload); };

  /** @param {'pending'|'idb'|'memory'|'memory-final'} next */
  function setMode(next) {
    if (api.mode === next) return;
    api.mode = next;
    emit(EV.STORE_MODE, next);
  }

  /** @param {string} op @param {any} error */
  function fail(op, error) {
    // Never console.error: a store hiccup must not fail a harness scenario, and the UI hears about
    // it on the bus.
    console.warn(`[lolchat] store ${op} failed`, error);
    emit(EV.STORE_ERROR, { op, error });
  }

  // ---------------------------------------------------------------------------- write chain
  /** @type {Promise<any>} */
  let chain = Promise.resolve();

  /** @param {string} op @param {() => Promise<any>} fn @returns {Promise<any>} */
  function enqueue(op, fn) {
    const run = chain.then(fn).catch((err) => { fail(op, err); return undefined; });
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  /** A read runs after every write issued before it. Failures answer with `fallback`. */
  function read(/** @type {string} */ op, /** @type {() => Promise<any>} */ fn, /** @type {any} */ fallback) {
    const tail = chain;
    return tail.then(fn).catch((err) => { fail(op, err); return fallback; });
  }

  const journaling = () => !attached && (api.mode === 'pending' || api.mode === 'memory');

  /**
   * Apply writes as one unit, journalling them while the store is still in memory.
   * @param {{op: 'put'|'del', store: string, value?: any, key?: any}[]} ops
   * @param {boolean} ephemeral
   */
  async function applyOps(ops, ephemeral) {
    if (!ops.length) return;
    if (ephemeral) { await eph.bulk(ops); return; }
    await persist.bulk(ops);
    if (journaling()) for (const op of ops) journal.push(op);
    for (const op of ops) {
      if (op.store === 'threads') persisted.add(op.op === 'put' ? op.value.id : op.key);
    }
  }

  const isEph = (/** @type {string} */ threadId) => ephemeralIds.has(threadId);
  const backendFor = (/** @type {string} */ threadId) => (isEph(threadId) ? eph : persist);

  /** @param {any} th */
  function cacheThread(th) {
    if (th && typeof th.id === 'string') threadCache.set(th.id, th);
    return th;
  }

  /** @param {string} id @returns {Promise<any|null>} */
  async function loadThread(id) {
    const fromEph = await eph.get('threads', id);
    if (fromEph) return fromEph;
    return (await persist.get('threads', id)) || null;
  }

  /** @param {string} threadId @returns {Promise<any[]>} raw (stored) message records */
  async function loadMessages(threadId) {
    const rows = await backendFor(threadId).byIndex('messages', 'threadId', threadId);
    return rows;
  }

  // ---------------------------------------------------------------------------- opening
  /** @param {any} err */
  function failOpen(err) {
    if (timeoutTimer) { cancel(timeoutTimer); timeoutTimer = null; }
    journal.length = 0;
    setMode('memory-final');
    resolveReady();
    if (err) emit(EV.STORE_ERROR, { op: 'open', error: err });
  }

  /** @param {any} backend */
  function attach(backend) {
    if (api.mode === 'memory-final' || attached) { try { backend.close(); } catch { /* ignore */ } return; }
    const late = api.mode === 'memory';
    if (timeoutTimer) { cancel(timeoutTimer); timeoutTimer = null; }
    enqueue('attach', async () => {
      try {
        if (journal.length) await backend.bulk(journal.slice());
        journal.length = 0;
        persist = backend;
        attached = true;
      } catch (err) {
        fail('attach', err);
        try { backend.close(); } catch { /* ignore */ }
        failOpen(null);
        return;
      }
      setMode('idb');
      resolveReady();
      // The sidebar only now sees history from earlier sessions (plan §3.7 late success).
      if (late) emit(EV.THREADS_CHANGED, { reason: 'attach', ids: [] });
      askToPersist();
    });
  }

  /** navigator.storage.persist(), once per profile (kv `persistRequested`). Backend-direct: this
   *  runs inside the write chain, so it must not call the public read/write API. */
  async function askToPersist() {
    try {
      const nav = /** @type {any} */ (globalThis).navigator;
      if (!nav || !nav.storage || typeof nav.storage.persist !== 'function') return;
      const rec = await persist.get('kv', 'persistRequested');
      if (rec && rec.value) return;
      await nav.storage.persist();
      await persist.put('kv', { key: 'persistRequested', value: true });
    } catch { /* a refused or missing persist() changes nothing we can act on */ }
  }

  function startOpening() {
    if (forceMemory) { setMode('memory-final'); resolveReady(); return; }
    /** @type {any} */
    let backend = null;
    try {
      backend = openPersistent({ name: idbName, indexedDB: opts.indexedDB, openDelayMs: idbOpenDelayMs, setTimeout: later });
    } catch (err) {
      failOpen(err);
      return;
    }
    if (!backend || !backend.ready) { failOpen(new Error('persistent backend has no ready promise')); return; }
    backend.ready.then(() => attach(backend), (/** @type {any} */ err) => { try { backend.close(); } catch { /* ignore */ } failOpen(err); });
    timeoutTimer = later(() => {
      timeoutTimer = null;
      if (api.mode !== 'pending') return;
      setMode('memory');           // keep working, keep waiting
      resolveReady();
    }, timeoutMs);
  }

  // ---------------------------------------------------------------------------- the API
  const api = {
    /** @type {'pending'|'idb'|'memory'|'memory-final'} */
    mode: 'pending',
    ready,

    async listThreads() {
      return read('listThreads', async () => {
        const rows = [...(await persist.getAll('threads')), ...(await eph.getAll('threads'))];
        for (const th of rows) if (!threadCache.has(th.id)) cacheThread(clone(th));
        return rows.sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
      }, []);
    },

    /** @param {string} id */
    async getThread(id) {
      return read('getThread', async () => {
        const th = await loadThread(id);
        if (th) cacheThread(clone(th));
        return th || null;
      }, null);
    },

    /** @param {any} [init] */
    createThread(init = {}) {
      const ts = now();
      const th = {
        id: newId(), title: t('core.newChat'), titleSource: 'auto', createdAt: ts, updatedAt: ts,
        headId: null, pinned: false, ephemeral: false, recipeId: null, systemOverride: null,
        params: null, model: null, modelSource: null, farmId: null, draft: null,
      };
      Object.assign(th, init || {});
      if (typeof th.id !== 'string' || !th.id) th.id = newId();
      const ephemeral = !!th.ephemeral;
      if (ephemeral) ephemeralIds.add(th.id);
      cacheThread(th);
      const snapshot = clone(th);
      enqueue('createThread', () => applyOps([{ op: 'put', store: 'threads', value: snapshot }], ephemeral));
      emit(EV.THREADS_CHANGED, { reason: 'create', ids: [th.id] });
      return th;
    },

    /**
     * @param {string} id @param {any} patch
     * @param {{silent?: boolean}} [opts] `silent` writes WITHOUT emitting THREADS_CHANGED.
     *
     * Only for a field no list and no header renders — today exactly one: `draft`, written on a
     * 500 ms debounce while the reader types. Its event re-rendered the whole sidebar (a full
     * `listThreads()`) and the thread header twice a second for a value neither of them reads
     * (P2 review). Anything that moves, renames or reorders a row emits.
     */
    async updateThread(id, patch, opts) {
      const result = await enqueue('updateThread', async () => {
        const th = (await loadThread(id)) || null;
        if (!th) return null;
        Object.assign(th, patch || {}, { id });
        const ephemeral = !!th.ephemeral || isEph(id);
        if (ephemeral) ephemeralIds.add(id);
        cacheThread(clone(th));
        await applyOps([{ op: 'put', store: 'threads', value: clone(th) }], ephemeral);
        return th;
      });
      if (result && !(opts && opts.silent)) emit(EV.THREADS_CHANGED, { reason: 'update', ids: [id] });
      return result || null;
    },

    /** Cascades to the thread's messages, attachments, graphs and project REFS (never to files on
     * disk), in one transaction. @param {string} id */
    async deleteThread(id) {
      // A checkpoint already on its 1 s timer would fire AFTER the cascade and re-insert one of the
      // messages this call is deleting (an orphan row with no thread). Drop them first.
      for (const [key, entry] of [...pendingCheckpoints]) {
        if (!entry || !entry.msg || entry.msg.threadId !== id) continue;
        cancel(entry.timer);
        pendingCheckpoints.delete(key);
      }
      await enqueue('deleteThread', async () => {
        const ephemeral = isEph(id);
        const backend = ephemeral ? eph : persist;
        const msgs = await backend.byIndex('messages', 'threadId', id);
        const atts = await backend.byIndex('attachments', 'threadId', id);
        // S0 kickoff: the cascade reaches the two Studio stores as well — ROWS only. The project
        // FOLDER on disk outlives the thread on purpose (studio plan §3.6.2); the UI says so.
        const graphs = await backend.byIndex('graphs', 'threadId', id);
        const refs = ephemeral ? [] : await backend.byIndex('projects', 'threadId', id);
        /** @type {any[]} */
        const ops = [{ op: 'del', store: 'threads', key: id }];
        for (const m of msgs) ops.push({ op: 'del', store: 'messages', key: m.id });
        for (const a of atts) ops.push({ op: 'del', store: 'attachments', key: a.id });
        for (const g of graphs) ops.push({ op: 'del', store: 'graphs', key: g.id });
        for (const r of refs) ops.push({ op: 'del', store: 'projects', key: r.id });
        await applyOps(ops, ephemeral);
        threadCache.delete(id);
        ephemeralIds.delete(id);
      });
      emit(EV.THREADS_CHANGED, { reason: 'delete', ids: [id] });
    },

    /** @param {string} threadId */
    async getMessages(threadId) {
      return read('getMessages', async () => (await loadMessages(threadId)).map(fromStoreMsg), []);
    },

    /** Root → head. Without `headId` the thread's own head is used. @param {string} threadId @param {string|null} [headId] */
    async getPath(threadId, headId) {
      return read('getPath', async () => {
        const rows = (await loadMessages(threadId)).map(fromStoreMsg);
        let head = headId;
        if (head === undefined) {
          const th = await loadThread(threadId);
          head = th ? th.headId : null;
        }
        const index = indexNodes(rows);
        return pathTo(index, repairHead(index, head));
      }, []);
    },

    /** @param {string} threadId @param {any} [partial] */
    appendMessage(threadId, partial = {}) {
      const ts = now();
      const cached = threadCache.get(threadId);
      const msg = {
        id: newId(), threadId, parentId: cached ? (cached.headId || null) : null, role: 'user',
        createdAt: ts, updatedAt: ts, parts: [], content: '', reasoning: null, reasoningMs: null,
        sawToolCalls: false, model: null, underlying: null, farmName: null, farmId: null,
        params: null, recipeId: null, stats: null, status: 'done', error: null, pinned: false,
      };
      Object.assign(msg, partial || {});
      if (typeof msg.id !== 'string' || !msg.id) msg.id = newId();
      if (msg.parentId === undefined) msg.parentId = null;
      msg.threadId = threadId;
      if (cached) { cached.headId = msg.id; cached.updatedAt = msg.updatedAt || ts; }
      const ephemeral = isEph(threadId);
      const snapshot = toStoreMsg(clone(msg));
      enqueue('appendMessage', async () => {
        const th = await loadThread(threadId);
        /** @type {any[]} */
        const ops = [{ op: 'put', store: 'messages', value: snapshot }];
        if (th) {
          // A thread this session never read has no cached head: take it from the record now, and
          // fix the message we already handed back (nothing has been written yet).
          if (!cached && th.headId && snapshot.parentId === '') { snapshot.parentId = th.headId; msg.parentId = th.headId; }
          th.headId = msg.id;
          th.updatedAt = msg.updatedAt || ts;
          cacheThread(clone(th));
          ops.push({ op: 'put', store: 'threads', value: clone(th) });
        }
        await applyOps(ops, ephemeral);
      });
      return msg;
    },

    /** @param {any} msg */
    async putMessage(msg) {
      const snapshot = toStoreMsg(clone(msg));
      await enqueue('putMessage', () => applyOps([{ op: 'put', store: 'messages', value: snapshot }], isEph(msg.threadId)));
    },

    /** Trailing 1 s throttle per message id — crash safety while a reply streams. @param {any} msg */
    checkpoint(msg) {
      if (!msg || typeof msg.id !== 'string') return;
      const open = pendingCheckpoints.get(msg.id);
      if (open) { open.msg = msg; return; }
      const entry = { msg, timer: null };
      entry.timer = later(() => {
        pendingCheckpoints.delete(msg.id);
        const snapshot = toStoreMsg(clone(entry.msg));
        enqueue('checkpoint', () => applyOps([{ op: 'put', store: 'messages', value: snapshot }], isEph(entry.msg.threadId)));
      }, CHECKPOINT_MS);
      pendingCheckpoints.set(msg.id, entry);
    },

    /** Cancels a pending checkpoint for this message and writes it now. @param {any} msg */
    async finalize(msg) {
      if (msg && typeof msg.id === 'string') {
        const open = pendingCheckpoints.get(msg.id);
        if (open) { cancel(open.timer); pendingCheckpoints.delete(msg.id); }
      }
      await api.putMessage(msg);
    },

    /** Removes a message and everything under it; repairs the thread head. @param {string} messageId */
    async deleteSubtree(messageId) {
      const result = await enqueue('deleteSubtree', async () => {
        const raw = (await persist.get('messages', messageId)) || (await eph.get('messages', messageId));
        if (!raw) return { removed: [], headId: null };
        const threadId = raw.threadId;
        const ephemeral = isEph(threadId);
        const rows = (await loadMessages(threadId)).map(fromStoreMsg);
        const before = indexNodes(rows);
        const removed = subtreeIds(before, messageId);
        const removedSet = new Set(removed);
        const rest = rows.filter((m) => !removedSet.has(m.id));
        const after = indexNodes(rest);
        const th = await loadThread(threadId);
        let headId = th ? th.headId : null;
        if (!headId || removedSet.has(headId)) {
          const parentId = fromStoreMsg(raw).parentId;
          headId = parentId && after.byId.has(parentId) ? parentId : repairHead(after, null);
        } else {
          headId = repairHead(after, headId);
        }
        /** @type {any[]} */
        const ops = removed.map((id) => ({ op: 'del', store: 'messages', key: id }));
        if (th && th.headId !== headId) {
          th.headId = headId;
          cacheThread(clone(th));
          ops.push({ op: 'put', store: 'threads', value: clone(th) });
        }
        await applyOps(ops, ephemeral);
        return { removed, headId };
      });
      return result || { removed: [], headId: null };
    },

    /** Cursor over every message (persistent, then ephemeral). Return false to stop. @param {(m: any) => any} visitor */
    async scanMessages(visitor) {
      await read('scanMessages', async () => {
        let go = true;
        await persist.scan('messages', (/** @type {any} */ rec) => {
          go = visitor(fromStoreMsg(rec)) !== false;
          return go;
        });
        if (!go) return undefined;
        await eph.scan('messages', (/** @type {any} */ rec) => visitor(fromStoreMsg(rec)) !== false);
        return undefined;
      }, undefined);
    },

    /** Deduped by (threadId, sha256): the same bytes attached twice give the same id. @param {any} att */
    async putAttachment(att) {
      const id = await enqueue('putAttachment', async () => {
        const ephemeral = isEph(att.threadId);
        const backend = ephemeral ? eph : persist;
        if (att.sha256) {
          const hit = await backend.byIndex('attachments', 'threadSha', [att.threadId, att.sha256]);
          if (hit && hit.length) return hit[0].id;
        }
        const rec = { ...att, id: att.id || newId() };
        await applyOps([{ op: 'put', store: 'attachments', value: rec }], ephemeral);
        return rec.id;
      });
      return id || null;
    },

    /** @param {string} id */
    async getAttachment(id) {
      return read('getAttachment', async () => (await persist.get('attachments', id)) || (await eph.get('attachments', id)) || null, null);
    },

    /** @param {string} threadId */
    async listAttachments(threadId) {
      return read('listAttachments', () => backendFor(threadId).byIndex('attachments', 'threadId', threadId), []);
    },

    /** @param {string} id */
    async deleteAttachment(id) {
      await enqueue('deleteAttachment', async () => {
        const rec = (await persist.get('attachments', id)) || (await eph.get('attachments', id));
        if (!rec) return;
        await applyOps([{ op: 'del', store: 'attachments', key: id }], isEph(rec.threadId));
      });
    },

    // ---- Studio stores (S0 kickoff, studio plan §3.6.2) --------------------------------------
    // Rows only. A scratch project's FILES live on disk under the projects root and are never
    // touched from here — deleting a chat must not delete the user's files.
    // An ephemeral thread's graph lives in the ephemeral backend and is never journalled (AZ-5).

    /** @param {string} [threadId] */
    async listGraphs(threadId) {
      return read('listGraphs', async () => {
        const from = async (/** @type {any} */ b) => (threadId ? b.byIndex('graphs', 'threadId', threadId) : b.getAll('graphs'));
        return [...(await from(persist)), ...(await from(eph))];
      }, []);
    },
    /** @param {string} id */
    async getGraph(id) { return read('getGraph', async () => (await persist.get('graphs', id)) || (await eph.get('graphs', id)) || null, null); },
    /** @param {any} doc */
    async putGraph(doc) {
      await enqueue('putGraph', () => applyOps([{ op: 'put', store: 'graphs', value: clone(doc) }], isEph(doc && doc.threadId)));
    },
    /** @param {string} id */
    async deleteGraph(id) {
      await enqueue('deleteGraph', async () => {
        const rec = (await persist.get('graphs', id)) || (await eph.get('graphs', id));
        if (!rec) return;
        await applyOps([{ op: 'del', store: 'graphs', key: id }], isEph(rec.threadId));
      });
    },

    /** @param {string} [threadId] */
    async listProjectRefs(threadId) {
      return read('listProjectRefs', () => (threadId
        ? persist.byIndex('projects', 'threadId', threadId)
        : persist.getAll('projects')), []);
    },
    /** @param {string} id */
    async getProjectRef(id) { return read('getProjectRef', async () => (await persist.get('projects', id)) || null, null); },
    /** An ephemeral thread never gets a project ref (§2.6 AZ-5): the call is a no-op. @param {any} ref */
    async putProjectRef(ref) {
      if (!ref || isEph(ref.threadId)) return;
      await enqueue('putProjectRef', () => applyOps([{ op: 'put', store: 'projects', value: clone(ref) }], false));
    },
    /** @param {string} id */
    async deleteProjectRef(id) {
      await enqueue('deleteProjectRef', () => applyOps([{ op: 'del', store: 'projects', key: id }], false));
    },

    async listRecipes() { return read('listRecipes', () => persist.getAll('recipes'), []); },
    /** @param {any} r */
    async putRecipe(r) { await enqueue('putRecipe', () => applyOps([{ op: 'put', store: 'recipes', value: clone(r) }], false)); },
    /** @param {string} id */
    async deleteRecipe(id) { await enqueue('deleteRecipe', () => applyOps([{ op: 'del', store: 'recipes', key: id }], false)); },

    /** The migrated thread for a v1 (id, messages-hash) pair, or null. @param {string} legacyId @param {string} legacyHash */
    async findLegacy(legacyId, legacyHash) {
      return read('findLegacy', async () => {
        const hit = await persist.byIndex('threads', 'legacy', [legacyId, legacyHash]);
        return hit && hit.length ? hit[0] : null;
      }, null);
    },

    /** @param {string} key @param {any} [fallback] */
    async kvGet(key, fallback = null) {
      return read('kvGet', async () => {
        const rec = await persist.get('kv', key);
        return rec ? rec.value : fallback;
      }, fallback);
    },

    /** @param {string} key @param {any} value */
    async kvSet(key, value) {
      await enqueue('kvSet', () => applyOps([{ op: 'put', store: 'kv', value: { key, value: clone(value) } }], false));
    },

    /** Crash recovery: every message still 'streaming' becomes 'interrupted'. @returns {Promise<number>} */
    async recoverInterrupted() {
      const n = await enqueue('recoverInterrupted', async () => {
        let count = 0;
        for (const [backend, ephemeral] of /** @type {[any, boolean][]} */ ([[persist, false], [eph, true]])) {
          /** @type {any[]} */
          const ops = [];
          await backend.scan('messages', (/** @type {any} */ rec) => {
            // 'waiting' (a seat wait, P2-U1) is recovered too: the waiter itself died with the
            // window, so a row left waiting has no Try now / Cancel behind it any more.
            if (rec && (rec.status === 'streaming' || rec.status === 'waiting')) ops.push({ op: 'put', store: 'messages', value: { ...rec, status: 'interrupted' } });
            return true;
          });
          if (ops.length) { await applyOps(ops, ephemeral); count += ops.length; }
        }
        return count;
      });
      return Number(n) || 0;
    },

    /** Writes every pending checkpoint and waits for the queue to drain. */
    async flush() {
      for (const [id, entry] of [...pendingCheckpoints]) {
        cancel(entry.timer);
        pendingCheckpoints.delete(id);
        const snapshot = toStoreMsg(clone(entry.msg));
        enqueue('checkpoint', () => applyOps([{ op: 'put', store: 'messages', value: snapshot }], isEph(entry.msg.threadId)));
      }
      await chain;
    },

    async estimate() { return read('estimate', () => persist.estimate(), null); },

    /**
     * One transaction over the given stores. The callback gets a promise-returning view
     * ({get, getAll, byIndex, put, del}) and must await ONLY those methods (§backend-idb). Unlike
     * every other method this one REJECTS on failure — its caller (the v1 migration) has to know.
     * All-or-nothing on both backends (a throwing callback aborts the transaction), and its writes
     * are JOURNALLED like every other write while the store is still in memory, so a late
     * IndexedDB attach replays them instead of dropping them.
     * @param {string[]} stores @param {'readonly'|'readwrite'} mode @param {(tx: any) => any} fn
     */
    async runTx(stores, mode, fn) {
      let failed = null;
      const result = await enqueue('runTx', async () => {
        /** @type {{op: 'put'|'del', store: string, value?: any, key?: any}[]} */
        const written = [];
        // The tx view, plus a tap on the two writing methods. `journaling()` cannot change while
        // this runs: `attach` is queued on the same chain, so it is either before or after us.
        const record = journaling() && mode === 'readwrite'
          ? (/** @type {any} */ tx) => ({
            ...tx,
            get: (/** @type {string} */ s, /** @type {any} */ k) => tx.get(s, k),
            getAll: (/** @type {string} */ s) => tx.getAll(s),
            byIndex: (/** @type {string} */ s, /** @type {string} */ i, /** @type {any} */ k) => tx.byIndex(s, i, k),
            put: async (/** @type {string} */ s, /** @type {any} */ v) => { await tx.put(s, v); written.push({ op: 'put', store: s, value: clone(v) }); },
            del: async (/** @type {string} */ s, /** @type {any} */ k) => { await tx.del(s, k); written.push({ op: 'del', store: s, key: k }); },
          })
          : null;
        try {
          const out = await persist.runTx(stores, mode, record ? (/** @type {any} */ tx) => fn(record(tx)) : fn);
          // Only a COMMITTED transaction is replayable; a failed one wrote nothing.
          for (const op of written) {
            journal.push(op);
            if (op.store === 'threads') persisted.add(op.op === 'put' ? op.value.id : op.key);
          }
          return out;
        } catch (err) {
          failed = err;
          throw err;
        }
      });
      if (failed) throw failed;
      return result;
    },

    debug: {
      journalLength: () => journal.length,
      persistentIds: () => [...persisted],
    },
  };

  startOpening();
  return /** @type {any} */ (api);
}
