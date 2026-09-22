// @ts-check
// The Computer's library store (COMPUTER_PLAN §7.1), owned by K1-U1.
//
// This is graph/store.mjs's debounced writer with ONE thing changed and one bug removed:
//   - it keys by GRAPH ID, not by thread id — a library document is a `graphs` row whose
//     `threadId` is null, which is the marker of the whole library;
//   - `write()` and `put()` no longer return early on `!doc.threadId`. That early return is the
//     reason a threadless document silently persisted NOTHING (§0.3), i.e. the reason a standalone
//     Computer could not have existed before K1.
//
// No DB version bump is needed and none is taken: `graphs` already keys on `id` and indexes
// `updatedAt`, `repo.listGraphs()` with no argument already does `getAll('graphs')`, and
// `repo.putGraph` routes ephemeral by `isEph(doc.threadId)` — and `isEph(null)` is false, so a
// library document lands in the PERSISTENT backend on its own.
//
// Everything that was true of the old store is still true here: writes are debounced 500 ms (the
// drafts rule), the LAST document wins, `flush()` resolves only when the store really has it, and
// `pending()` stays true until then. Dragging a part 200 px costs one write, not two hundred.

import { createDoc, normaliseDoc } from '../graph/model.mjs';

/** How long a document edit waits for the next one before it is written. */
export const SAVE_DEBOUNCE_MS = 500;

/** Where "the graph you were last looking at" lives. Mirrors `ui:lastThreadId`. */
export const LAST_KEY = 'computer:lastGraphId';

/** A library document is a `graphs` row with no thread. A row that predates the field counts too:
 * `undefined` is "nobody wrote a thread here", which is exactly what null means.
 * @param {any} row */
export const isLibraryRow = (row) => !!row && (row.threadId === null || row.threadId === undefined);

/** A copy deep enough that two documents never share a part or a wire object. @param {any} row */
function cloneDoc(row) {
  return {
    ...row,
    parts: (Array.isArray(row.parts) ? row.parts : []).map((/** @type {any} */ p) => ({ ...p })),
    wires: (Array.isArray(row.wires) ? row.wires : []).map((/** @type {any} */ w) => ({ ...w })),
    settings: { ...(row.settings || {}) },
    view: { ...(row.view || {}) },
  };
}

/**
 * @param {{app: any, specs: Map<string, any>, debounceMs?: number}} o
 * @returns {any}
 */
export function createDocStore(o) {
  const app = o.app;
  const wait = typeof o.debounceMs === 'number' ? o.debounceMs : SAVE_DEBOUNCE_MS;
  /** @type {any} */ let timer = null;
  /** @type {any} */ let queued = null;
  /** @type {Promise<void>|null} */ let inFlight = null;
  let writes = 0;
  let destroyed = false;

  const repo = () => (app && app.repo && typeof app.repo.putGraph === 'function' ? app.repo : null);
  const now = () => (app && typeof app.now === 'function' ? app.now() : Date.now());

  /** @param {any} doc */
  async function write(doc) {
    const r = repo();
    // The ONE guard: a document needs an id. NOT a threadId — see the header.
    if (!r || !doc || !doc.id) return;
    writes++;
    try { await r.putGraph(doc); } catch (err) { console.warn('[lolcomputer] graph save failed', err); }
  }

  /** Write whatever is queued, now. Resolves when the store has it. */
  async function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    const doc = queued;
    queued = null;
    if (inFlight) await inFlight;
    if (!doc) return;
    inFlight = write(doc);
    await inFlight;
    inFlight = null;
  }

  /** Queue `doc` for the next write. The LAST doc wins — an older snapshot never lands on a newer.
   * @param {any} doc */
  function put(doc) {
    if (destroyed || !doc || !doc.id) return;
    queued = doc;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; flush(); }, wait);
  }

  /**
   * ONE document, by id, normalised against the live part catalogue.
   *
   * `load(null)` hands back a fresh UNSAVED document and writes nothing: choosing WHICH document to
   * open is the host's question (last → newest → new), not the store's, and a store that created a
   * row every time it was asked for "nothing in particular" would fill the library with blanks.
   * An id that has no row yet DOES get one, written straight away, so a reload finds it.
   * @param {string|null} graphId
   * @returns {Promise<{doc: any, dropped: string[], created: boolean}>}
   */
  async function load(graphId) {
    await flush();
    const r = repo();
    if (!graphId || !r || typeof r.getGraph !== 'function') {
      return { doc: createDoc({ id: app.newId(), threadId: null, now: app.now }), dropped: [], created: false };
    }
    /** @type {any} */ let row = null;
    try { row = await r.getGraph(graphId); } catch { row = null; }
    if (!row) {
      const doc = createDoc({ id: graphId, threadId: null, now: app.now });
      await write(doc);
      return { doc, dropped: [], created: true };
    }
    const out = normaliseDoc(row, { specs: o.specs, now: app.now });
    // A row that lost parts is rewritten immediately: the next save would do it anyway, and this
    // way a graph opened by an older build is honest about what survived.
    if (out.dropped.length) await write(out.doc);
    return { doc: out.doc, dropped: out.dropped, created: false };
  }

  /**
   * The library: every threadless row, newest first. Thread-owned rows are somebody else's — the
   * chat's, until the K1 landing deletes the panel, and the migration's originals forever after.
   * @returns {Promise<any[]>}
   */
  async function list() {
    const r = repo();
    if (!r || typeof r.listGraphs !== 'function') return [];
    /** @type {any[]} */ let rows = [];
    try { rows = (await r.listGraphs()) || []; } catch { rows = []; }
    return rows
      .filter(isLibraryRow)
      .sort((a, b) => (Number(b && b.updatedAt) || 0) - (Number(a && a.updatedAt) || 0));
  }

  /** A new, empty library document, written straight away. @param {{title?: string}} [opts] */
  async function create(opts = {}) {
    const doc = createDoc({
      id: app.newId(),
      threadId: null,
      now: app.now,
      title: String((opts && opts.title) || ''),
    });
    await write(doc);
    return doc;
  }

  /**
   * Retitle a row that is NOT open. The open document is renamed through the session instead
   * (`host.rename`), because a row rewritten behind the session's back is overwritten by the next
   * debounced save.
   * @param {string} id @param {string} title
   */
  async function rename(id, title) {
    const r = repo();
    if (!r || !id) return null;
    await flush();
    /** @type {any} */ let row = null;
    try { row = await r.getGraph(id); } catch { row = null; }
    if (!row) return null;
    const next = { ...row, title: String(title || ''), updatedAt: now(), rev: (Number(row.rev) || 1) + 1 };
    await write(next);
    return next;
  }

  /**
   * A copy with a new id, always in the library even when the original was thread-owned — which is
   * how "duplicate" doubles as "get this graph out of a chat".
   * @param {string} id @param {{title?: string}} [opts] @returns {Promise<string|null>}
   */
  async function duplicate(id, opts = {}) {
    const r = repo();
    if (!r || !id) return null;
    await flush();
    /** @type {any} */ let row = null;
    try { row = await r.getGraph(id); } catch { row = null; }
    if (!row) return null;
    const stamp = now();
    const copy = cloneDoc(row);
    copy.id = app.newId();
    copy.threadId = null;
    copy.title = String((opts && opts.title) || row.title || '');
    copy.createdAt = stamp;
    copy.updatedAt = stamp;
    copy.rev = 1;
    await write(copy);
    return copy.id;
  }

  /** Delete a row. A queued write for that same document is dropped, never resurrected. @param {string} id */
  async function remove(id) {
    const r = repo();
    if (!r || !id) return false;
    if (queued && queued.id === id) { queued = null; if (timer) { clearTimeout(timer); timer = null; } }
    await flush();
    if (typeof r.deleteGraph !== 'function') return false;
    try { await r.deleteGraph(id); } catch (err) { console.warn('[lolcomputer] graph delete failed', err); return false; }
    const last = await lastId();
    if (last === id) await setLastId(null);
    return true;
  }

  /** The graph the reader left, or null. @returns {Promise<string|null>} */
  async function lastId() {
    const r = repo();
    if (!r || typeof r.kvGet !== 'function') return null;
    try {
      const v = await r.kvGet(LAST_KEY, null);
      return typeof v === 'string' && v ? v : null;
    } catch { return null; }
  }

  /** @param {string|null} id */
  async function setLastId(id) {
    const r = repo();
    if (!r || typeof r.kvSet !== 'function') return;
    try { await r.kvSet(LAST_KEY, id || null); } catch { /* the store speaks through its own banner */ }
  }

  return {
    load,
    put,
    flush,
    list,
    create,
    rename,
    duplicate,
    remove,
    lastId,
    setLastId,
    // A write that has left `queued` but not yet resolved is STILL pending: a caller that waits on
    // this before reading the store would otherwise read it mid-write.
    pending: () => !!timer || !!queued || !!inFlight,
    writes: () => writes,
    destroy() { destroyed = true; if (timer) clearTimeout(timer); timer = null; queued = null; },
  };
}
