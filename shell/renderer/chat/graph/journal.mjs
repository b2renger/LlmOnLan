// @ts-check
// The run journal (COMPUTER_PLAN §7.3-§7.5, §11 K3-U1). PURE: it is handed a `repo` and a clock
// and touches no DOM, no network and no global.
//
// THE FLUSH POLICY (§7.4, K3-U1) is in `persist()` below, and it is one sentence:
//
//   > Anything the farm was paid for is flushed before the next part starts.
//
// So an ordinary event (a start, an item, a resume) is written on a 500 ms DEBOUNCE — a run of
// three hundred free activations must not write the store three hundred times — while `wait()`,
// `close()` and the runner's own `flush()` after a paid completion write IMMEDIATELY and cancel
// the pending debounce. A crash then loses at most the free bookkeeping of the last half second,
// and never loses the record of a generation somebody paid for.
//
// Why it exists at all (§7.3): this surface is for LEARNING what an agent is, and "show me what
// just happened" is a feature. It is also the crash-resume record and the per-run cost record. It
// never leaves the machine.

import { KV_KEYS } from '../core/types.mjs';

/** @typedef {import('../core/types.mjs').RunJournal} RunJournal */

/** The event ring per run (§7.3). The 201st event drops the 1st. */
export const MAX_EVENTS = 200;

/** Runs kept per graph. The 6th write prunes the oldest (§7.3). */
export const MAX_RUNS = 5;

/** The debounce between ORDINARY writes (§7.4). A forced flush ignores it and cancels it. */
export const FLUSH_DEBOUNCE_MS = 500;

/** @param {string} graphId @returns {string} */
export function journalKey(graphId) {
  return KV_KEYS.computerRuns(String(graphId || ''));
}

/** Keep the ring at MAX_EVENTS. @param {any[]} events @returns {any[]} */
export function ring(events) {
  const list = Array.isArray(events) ? events : [];
  return list.length <= MAX_EVENTS ? list : list.slice(list.length - MAX_EVENTS);
}

/** Keep the last MAX_RUNS rows, newest LAST (the order they were started in).
 * @param {any[]} rows @returns {any[]} */
export function prune(rows) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [];
  return list.length <= MAX_RUNS ? list : list.slice(list.length - MAX_RUNS);
}

/** Every stored run for a graph, oldest first. Never throws: no journal is an empty journal.
 * @param {any} repo @param {string} graphId @returns {Promise<RunJournal[]>} */
export async function readRuns(repo, graphId) {
  if (!repo || typeof repo.kvGet !== 'function' || !graphId) return [];
  try {
    const rows = await repo.kvGet(journalKey(graphId), []);
    return prune(Array.isArray(rows) ? rows : []);
  } catch { return []; }
}

/** The row a crash left behind, or null (§7.5). It is what puts the resume banner on screen:
 * a run whose `endedAt` is null and whose status never reached an ending.
 * @param {RunJournal[]} rows @returns {RunJournal|null} */
export function resumable(rows) {
  const list = Array.isArray(rows) ? rows : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (r && r.endedAt === null && (r.status === 'running' || r.status === 'waiting')) return r;
  }
  return null;
}

/**
 * The journal of one graph. One instance per open document; the runner opens a run on it.
 * @param {{repo: any, graphId: string, now?: () => number, newId?: () => string}} o
 * @returns {any}
 */
export function createJournal(o) {
  const repo = o && o.repo;
  const graphId = String((o && o.graphId) || '');
  const now = (o && o.now) || Date.now;
  let seq = 0;
  const newId = (o && o.newId) || (() => `run:${now()}:${(seq += 1)}`);

  /** @type {RunJournal[]} */ let rows = [];
  let loaded = false;

  async function load() {
    if (loaded) return rows;
    rows = await readRuns(repo, graphId);
    loaded = true;
    return rows;
  }

  /** @type {any} */ let pending = null;
  let writes = 0;

  /** Write now, and cancel any debounced write standing behind us (§7.4). */
  async function persist() {
    if (pending) { clearTimeout(pending); pending = null; }
    if (!repo || typeof repo.kvSet !== 'function' || !graphId) return;
    writes += 1;
    try { await repo.kvSet(journalKey(graphId), prune(rows)); } catch { /* a journal is never worth a thrown run */ }
  }

  /** Write within FLUSH_DEBOUNCE_MS — what an ordinary, unpaid event gets (§7.4). */
  function persistSoon() {
    if (pending || !repo || typeof repo.kvSet !== 'function' || !graphId) return;
    pending = setTimeout(() => { pending = null; persist(); }, FLUSH_DEBOUNCE_MS);
    // A debounced write must never hold a Node process (or an Electron quit) open by itself.
    if (pending && typeof pending.unref === 'function') pending.unref();
  }

  return {
    graphId,
    /** Every stored run, oldest first. @returns {Promise<RunJournal[]>} */
    list: () => load().then(() => rows.slice()),
    /** The newest run, or null. @returns {Promise<RunJournal|null>} */
    last: () => load().then(() => (rows.length ? rows[rows.length - 1] : null)),
    /** The row a crash left behind (§7.5). @returns {Promise<RunJournal|null>} */
    resumable: () => load().then(() => resumable(rows)),

    /**
     * Open a run. Returns the handle the runner writes through — every method is synchronous and
     * mutates the in-memory row; only `flush()` and `close()` touch the store.
     * @param {{mode?: 'all'|'from'|'button', seeds?: string[], cap?: number, model?: string|null}} init
     */
    openRun(init = {}) {
      /** @type {RunJournal} */
      const row = {
        id: newId(),
        startedAt: now(),
        endedAt: null,
        mode: /** @type {any} */ (init.mode || 'all'),
        seeds: Array.isArray(init.seeds) ? init.seeds.slice() : [],
        status: 'running',
        cap: Number(init.cap) || 0,
        spent: 0,
        tokens: 0,
        model: init.model === undefined ? null : init.model,
        iterations: {},
        waits: [],
        events: [],
        report: null,
      };
      // Pushed synchronously so a crash between here and the first flush still leaves a row that
      // says a run was live; `load()` merges it with whatever was already stored.
      load().then(() => { rows.push(row); rows = prune(rows); persist(); });

      return {
        id: row.id,
        row: () => row,
        /** @param {{partId?: string|null, kind: string, by?: string}} ev */
        event(ev) {
          row.events = ring([...row.events, {
            t: now(),
            partId: ev && ev.partId ? String(ev.partId) : null,
            kind: /** @type {any} */ ((ev && ev.kind) || 'start'),
            ...(ev && ev.by ? { by: String(ev.by) } : {}),
          }]);
          persistSoon();                       // ordinary bookkeeping: debounced (§7.4)
          return row.events.length;
        },
        /** @param {string} partId @param {string} kind @param {{question?: string}} [meta] */
        wait(partId, kind, meta = {}) {
          row.waits = [...row.waits.filter((w) => w.partId !== partId),
            { partId, kind, since: now(), ...(meta.question ? { question: meta.question } : {}) }];
          row.status = 'waiting';
          this.event({ partId, kind: 'wait' });
          return persist();                    // (b) entering `waiting` is forced (§7.4)
        },
        /** @param {string} partId */
        resume(partId) {
          row.waits = row.waits.filter((w) => w.partId !== partId);
          if (!row.waits.length && row.status === 'waiting') row.status = 'running';
          this.event({ partId, kind: 'resume' });
        },
        /** @param {string} partId @param {number} n */
        iteration(partId, n) { row.iterations[partId] = Number(n) || 0; persistSoon(); },
        /** @param {{spent?: number, tokens?: number}} m */
        spend(m) {
          if (Number(m && m.spent) > 0) row.spent = Number(m.spent);
          if (Number(m && m.tokens) > 0) row.tokens = Number(m.tokens);
          persistSoon();
        },
        /** @param {string} s */
        status(s) { row.status = /** @type {any} */ (s); persistSoon(); },
        /** How many times this journal really reached the store — the flush policy, measurable. */
        writes: () => writes,
        /** @param {any} report @param {string} [status] */
        close(report, status) {
          row.endedAt = now();
          row.report = report || null;
          row.waits = [];
          row.status = /** @type {any} */ (status || (report && report.cancelled ? 'stopped'
            : report && report.limited ? 'limited'
              : report && report.capped ? 'capped'
                : report && report.errors && report.errors.length ? 'error' : 'done'));
          return persist();
        },
        flush: () => persist(),
      };
    },
    flush: () => persist(),
  };
}
