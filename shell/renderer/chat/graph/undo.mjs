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
