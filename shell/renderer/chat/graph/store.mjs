// @ts-check
// The `graphs` store, as the Computer panel uses it: ONE graph per thread in C1 (plan §2.6 BG-7).
// Nothing else in the renderer writes this store.
//
// Writes are debounced 500 ms (the drafts rule) and flushed on hide/destroy/thread change/save, so
// dragging a part 200 px costs one write, not two hundred. An ephemeral thread's graph rides the
// ephemeral backend for free (BD-6) — repo.putGraph routes on doc.threadId, so there is no case here.

import { createDoc, normaliseDoc } from './model.mjs';

/** How long a document edit waits for the next one before it is written. */
export const SAVE_DEBOUNCE_MS = 500;

/** @param {{app: any, specs: Map<string, any>, debounceMs?: number}} o */
export function createGraphStore(o) {
  const app = o.app;
  const wait = typeof o.debounceMs === 'number' ? o.debounceMs : SAVE_DEBOUNCE_MS;
  /** @type {any} */ let timer = null;
  /** @type {any} */ let queued = null;
  /** @type {Promise<void>|null} */ let inFlight = null;
  let writes = 0;
  let destroyed = false;

  const repo = () => (app && app.repo && typeof app.repo.putGraph === 'function' ? app.repo : null);

  async function write(doc) {
    const r = repo();
    if (!r || !doc || !doc.threadId) return;
    writes++;
    try { await r.putGraph(doc); } catch (err) { console.warn('[lolchat] graph save failed', err); }
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
    if (destroyed || !doc || !doc.threadId) return;
    queued = doc;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; flush(); }, wait);
  }

  /**
   * THIS thread's graph: the first row of `listGraphs(threadId)`, normalised against the live part
   * catalogue, or a fresh one (written straight away, so a reload finds it).
   * @param {string|null} threadId @returns {Promise<{doc: any, dropped: string[], created: boolean}>}
   */
  async function load(threadId) {
    await flush();
    const r = repo();
    if (!threadId || !r || typeof r.listGraphs !== 'function') {
      return { doc: createDoc({ id: app.newId(), threadId: threadId || null, now: app.now }), dropped: [], created: false };
    }
    /** @type {any[]} */ let rows = [];
    try { rows = (await r.listGraphs(threadId)) || []; } catch { rows = []; }
    // `listGraphs` is an index scan, and the index is `threadId` — its ORDER is the index's, not
    // `updatedAt`'s. One row per thread is the C1 invariant, but the moment a second exists (a
    // crash between the fresh-doc write and the next save, or C2's multi-graph) the panel must
    // open the NEWEST, not an arbitrary one: an older row is a graph that lost its parts.
    const row = rows.length
      ? rows.slice().sort((a, b) => (Number(b && b.updatedAt) || 0) - (Number(a && a.updatedAt) || 0))[0]
      : null;
    if (!row) {
      const doc = createDoc({ id: app.newId(), threadId, now: app.now });
      await write(doc);
      return { doc, dropped: [], created: true };
    }
    const out = normaliseDoc(row, { specs: o.specs, now: app.now });
    // A row that lost parts is rewritten immediately: the next save would do it anyway, and this
    // way a C2/C3 graph opened by a C1 client is honest about what survived.
    if (out.dropped.length) await write(out.doc);
    return { doc: out.doc, dropped: out.dropped, created: false };
  }

  return {
    load,
    put,
    flush,
    // A write that has left `queued` but not yet resolved is STILL pending: a caller that waits on
    // this before reading the store would otherwise read it mid-write.
    pending: () => !!timer || !!queued || !!inFlight,
    writes: () => writes,
    destroy() { destroyed = true; if (timer) clearTimeout(timer); timer = null; queued = null; },
  };
}
