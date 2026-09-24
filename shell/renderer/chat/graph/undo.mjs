// @ts-check
// C1-U1 — the canvas's own undo stack (spec §4, plan §2.6 BG-4). PURE.
//
// Snapshot based, not command based: a graph document is small, every mutation in graph/model.mjs
// returns a NEW doc, and a snapshot stack cannot drift from the document the way an inverse-command
// stack can. The rules:
//   - `push(doc, label)` records the doc AS IT WAS BEFORE the edit `label` describes;
//   - `undo(current)` hands back that older doc and parks `current` on the redo stack;
//   - any `push` clears redo — the classic rule: once you edit after undoing, the future is gone;
//   - the past is capped at `limit` (oldest dropped first), so a long session cannot grow forever.
//
// Critic R1, B1: a snapshot is the WHOLE document, runtime included — and "runtime writes are
// never undoable" (COMPUTER_PLAN §7). Handing a snapshot back verbatim rewound every answer a run
// had produced since, brought back `running` spinners for a run long finished, and reverted a
// title the reader had set with an un-undoable rename. `restoreProgram()` below is what the
// session applies instead: the snapshot's PROGRAM, the present's RUNTIME, title and view.

import { markStale } from './topo.mjs';

/** @typedef {import('../core/types.mjs').GraphDoc} GraphDoc */
/** @typedef {{doc: GraphDoc, label: string}} UndoEntry */

export const DEFAULT_LIMIT = 100;

/** @param {{limit?: number}} [o] */
export function createUndo(o = {}) {
  const raw = Number(o && o.limit);
  const limit = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_LIMIT;
  /** @type {UndoEntry[]} */ let past = [];
  /** @type {UndoEntry[]} */ let future = [];

  return {
    limit,

    /** Record the doc as it was BEFORE the edit `label` describes.
     * @param {GraphDoc} doc @param {string} [label] */
    push(doc, label) {
      if (!doc) return;
      past.push({ doc, label: typeof label === 'string' ? label : '' });
      if (past.length > limit) past = past.slice(past.length - limit);
      future = [];
    },

    /** @param {GraphDoc} current @returns {UndoEntry|null} */
    undo(current) {
      const entry = past.pop();
      if (!entry) return null;
      future.push({ doc: current, label: entry.label });
      if (future.length > limit) future = future.slice(future.length - limit);
      return entry;
    },

    /** @param {GraphDoc} current @returns {UndoEntry|null} */
    redo(current) {
      const entry = future.pop();
      if (!entry) return null;
      past.push({ doc: current, label: entry.label });
      if (past.length > limit) past = past.slice(past.length - limit);
      return entry;
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,

    /** What the toolbar shows next to its two arrows. @returns {{past: number, future: number}} */
    depth: () => ({ past: past.length, future: future.length }),

    /** The labels, oldest first — the undo menu, and what the tests read to prove ordering.
     * @returns {{past: string[], future: string[]}} */
    labels: () => ({ past: past.map((e) => e.label), future: future.map((e) => e.label) }),

    /** Every document the stack holds, past and future (K6 fix round): the file store must not
     * sweep a file an Undo or a Redo would bring back. @returns {GraphDoc[]} */
    docs: () => [...past.map((e) => e.doc), ...future.map((e) => e.doc)],

    clear() { past = []; future = []; },
  };
}

/** The fields of a part that ARE the program. Everything else on a part is runtime (state, value,
 * error, stats, fanout, demo, and whatever a later phase adds) and is grafted from the present. */
export const PROGRAM_FIELDS = Object.freeze(['type', 'x', 'y', 'w', 'h', 'settings']);

/** States that only mean something while a run is working on the part. */
const TRANSIENT = new Set(['running', 'queued', 'waiting']);

/** @param {any} v */
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
}

/** A part's settings without its seed (critic R3-4). @param {any} settings */
function withoutSeed(settings) {
  if (!settings || typeof settings !== 'object' || !('seed' in settings)) return settings || {};
  const { seed, ...rest } = settings;
  return rest;
}

/**
 * Does the seed a restore brings back fit the answer on screen (critic R4-3)? Yes when it is "new
 * each run" (none), or the seed that answer was produced with (`stats.seed`). A pinned 42 restored
 * over an answer made with 99 does not: that answer is stale.
 * @param {any} settings @param {any} part
 */
function seedFits(settings, part) {
  const s = settings && typeof settings === 'object' ? settings.seed : undefined;
  if (s === undefined || s === null || s === '') return true;
  const used = part && part.stats ? part.stats.seed : undefined;
  return used !== undefined && Number(s) === Number(used);
}

/** What arrives at a part, in arrival order: the input side of the program. @param {any} doc @param {string} id */
function incoming(doc, id) {
  return (doc.wires || [])
    .filter((/** @type {any} */ w) => w.to === id)
    .map((/** @type {any} */ w) => `${w.from}|${w.port}|${w.label || ''}|${w.back ? 1 : 0}`)
    .join(',');
}

/**
 * Undo/Redo without rewinding what a run produced (critic R1, B1). PURE.
 *
 *   - the PART SET, each part's type/x/y/w/h/settings, the wires and the document's settings come
 *     from `snapshot` (the edit is taken back);
 *   - a part that exists in both keeps the PRESENT's runtime fields — its answer, state, stats and
 *     anything else that is not program — so "move, Run all, undo the move" keeps every answer;
 *   - a part the snapshot brings back (an undone delete) keeps the runtime it had, except that a
 *     `running`/`queued`/`waiting` it was photographed in becomes `stale`: no run is working on it;
 *   - a part whose settings or incoming wires differ between the two is marked stale, with
 *     everything downstream: its answer came from a program that is no longer on the canvas;
 *   - `title` and `view` stay the present's (a rename is not undoable and a pan is not an edit),
 *     except for an `import` entry, which is the whole file coming back out.
 *
 * @param {GraphDoc} current the document on screen now
 * @param {GraphDoc} snapshot the document the undo (or redo) entry holds
 * @param {{label?: string, now?: () => number}} [o]
 * @returns {GraphDoc}
 */
export function restoreProgram(current, snapshot, o = {}) {
  if (!snapshot) return current;
  if (!current) return snapshot;
  const now = (o && o.now) || Date.now;
  /** @type {Map<string, any>} */ const live = new Map();
  for (const p of /** @type {any[]} */ (current.parts || [])) live.set(p.id, p);
  /** @type {string[]} */ const changed = [];
  const parts = /** @type {any[]} */ (snapshot.parts || []).map((sp) => {
    const cp = live.get(sp.id);
    if (!cp) return TRANSIENT.has(sp.state) ? { ...sp, state: 'stale' } : sp;
    // A difference in the SEED alone is not a program change (critic R3-4): undoing a Keep must not
    // mark an answer stale that that very seed produced. Every other setting still counts.
    if (cp.type !== sp.type || stable(withoutSeed(cp.settings)) !== stable(withoutSeed(sp.settings))) changed.push(sp.id);
    else if (!seedFits(sp.settings, cp)) changed.push(sp.id);
    else if (incoming(current, sp.id) !== incoming(snapshot, sp.id)) changed.push(sp.id);
    /** @type {any} */ const out = { ...cp };
    for (const k of PROGRAM_FIELDS) {
      if (k in sp) out[k] = /** @type {any} */ (sp)[k];
      else delete out[k];
    }
    return out;
  });
  const keepFile = o && o.label === 'import';
  const next = /** @type {any} */ ({
    ...snapshot,
    parts,
    title: keepFile ? snapshot.title : current.title,
    view: keepFile ? snapshot.view : current.view,
    // An undo is a new revision of the program, never an old one handed back: anything keyed on
    // `rev` (a cache, a stale check) must not mistake the restored graph for the one it last saw.
    rev: Math.max(Number(current.rev) || 1, Number(snapshot.rev) || 1) + 1,
    updatedAt: now(),
  });
  return changed.length ? markStale(next, Array.from(new Set(changed)), { now }) : next;
}
