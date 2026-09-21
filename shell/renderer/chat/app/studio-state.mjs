// @ts-check
// Per-thread studio state (S0-U1, studio plan §3.5.3). PURE — no DOM, no storage, no clock of its
// own: everything it needs (the known panel/graph/project ids, `now`, the timer) is passed in.
//
// What lives here and why:
//   `thread.studio` is the ONE record of "what was open in the workbench for this conversation".
//   The workbench reads it at show() and writes it back debounced and silently (§2.6 BB-7: neither
//   the thread list nor the header renders it). Every merge/validate/clamp decision is in this file
//   so it can be tested in Node, and so the rules are stated once:
//
//   - an unknown panel id (a panel whose module is gone, or a typo from an older build) reads as
//     `panel: null` — never as a tab that cannot exist;
//   - a panel-less studio is a CLOSED workbench, so `panel: null` forces `width: 'chat'`;
//   - an unknown width reads as 'chat';
//   - a `graphId`/`projectId`/`boardId` that no longer resolves is dropped ON READ and never
//     rewritten silently: sanitise returns a clean value and the store keeps the stale one until
//     the reader does something that writes anyway. A silent rewrite would delete the only evidence
//     that a project folder went missing.
//   - sanitise NEVER mutates its input (the caller usually passes the repo's cached thread row).

/** The three width states of studio plan §3.5.1, in cycle order. */
export const WIDTHS = Object.freeze(['chat', 'split', 'work']);

export const DEFAULT_WIDTH = 'chat';

/** The split column, as a fraction of the chat's width. CSS clamps the pixels (min 320px). */
export const MIN_FRACTION = 0.2;
export const MAX_FRACTION = 0.7;
export const DEFAULT_FRACTION = 0.46;

/** @param {number} [now] @returns {import('../core/types.mjs').StudioState} */
export function emptyStudio(now = 0) {
  return { panel: null, width: DEFAULT_WIDTH, graphId: null, projectId: null, boardId: null, updatedAt: now };
}

/** @param {any} x @returns {boolean} */
export function isWidth(x) {
  return typeof x === 'string' && WIDTHS.indexOf(/** @type {any} */(x)) >= 0;
}

/**
 * The next width in the cycle chat → split → work → chat.
 * @param {any} width @returns {string}
 */
export function nextWidth(width) {
  const i = WIDTHS.indexOf(isWidth(width) ? width : DEFAULT_WIDTH);
  return WIDTHS[(i + 1) % WIDTHS.length];
}

/** @param {any} n @returns {number} */
export function clampFraction(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_FRACTION;
  return Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, v));
}

/**
 * Read `kv ui:workWidth`. Accepts a number, '0.46' or '46%'; anything else (including a '320px'
 * an older note imagined) is not a fraction and reads as null, so the caller keeps its default.
 * @param {any} raw @returns {number|null}
 */
export function parseFraction(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? clampFraction(raw) : null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const pct = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(s);
  if (pct) return clampFraction(Number(pct[1]) / 100);
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return clampFraction(v > 1 ? v / 100 : v);
}

/** @param {number} n @returns {string} the kv form: a plain fraction, 4 decimals at most */
export function formatFraction(n) {
  return String(Math.round(clampFraction(n) * 10000) / 10000);
}

/** @param {any} set @param {string} id */
function known(set, id) {
  if (set == null) return true;                       // "not checked" is not "not found"
  if (typeof set.has === 'function') return !!set.has(id);
  if (Array.isArray(set)) return set.indexOf(id) >= 0;
  return true;
}

/** @param {any} v */
const str = (v) => (typeof v === 'string' && v ? v : null);

/**
 * Validate + clamp a stored (or half-built) studio record. Returns a NEW object every time.
 * @param {any} raw
 * @param {{panels?: any, graphs?: any, projects?: any, boards?: any, now?: number}} [opts]
 * @returns {import('../core/types.mjs').StudioState}
 */
export function sanitizeStudio(raw, opts = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = emptyStudio(Number.isFinite(Number(src.updatedAt)) ? Number(src.updatedAt) : (opts.now || 0));

  const panel = str(src.panel);
  out.panel = panel && known(opts.panels, panel) ? panel : null;
  const width = isWidth(src.width) ? String(src.width) : DEFAULT_WIDTH;
  out.width = /** @type {any} */ (out.panel ? width : DEFAULT_WIDTH);   // no panel = a closed workbench

  const graphId = str(src.graphId);
  out.graphId = graphId && known(opts.graphs, graphId) ? graphId : null;
  const projectId = str(src.projectId);
  out.projectId = projectId && known(opts.projects, projectId) ? projectId : null;
  const boardId = str(src.boardId);
  out.boardId = boardId && known(opts.boards, boardId) ? boardId : null;

  return out;
}

/**
 * @param {any} a @param {any} b
 * @returns {boolean} same studio, ignoring `updatedAt` (a re-save with no change is not a change)
 */
export function studioEquals(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.panel === b.panel && a.width === b.width && a.graphId === b.graphId
    && a.projectId === b.projectId && a.boardId === b.boardId;
}

/**
 * Merge a patch onto a studio record. Returns a record equal to `prev` when nothing moved (and the
 * SAME object when `prev` was already clean), so the caller can skip the write; otherwise a new
 * object with a fresh `updatedAt`.
 * @param {any} prev
 * @param {any} patch
 * @param {{now?: number, panels?: any, graphs?: any, projects?: any, boards?: any}} [opts]
 * @returns {import('../core/types.mjs').StudioState}
 */
export function mergeStudio(prev, patch, opts = {}) {
  const base = sanitizeStudio(prev, opts);
  const merged = sanitizeStudio({ ...base, ...(patch && typeof patch === 'object' ? patch : {}) }, opts);
  if (studioEquals(base, merged)) {
    if (prev && typeof prev === 'object' && studioEquals(prev, base) && prev.updatedAt === base.updatedAt) {
      return /** @type {any} */ (prev);
    }
    return base;
  }
  merged.updatedAt = Number.isFinite(Number(opts.now)) ? Number(opts.now) : base.updatedAt;
  return merged;
}

/**
 * The debounced writer behind `repo.updateThread(id, {studio}, {silent:true})`. Like drafts: 500 ms,
 * coalescing every put for the same thread into one save — and flushing IMMEDIATELY when the reader
 * switches to another thread, because the pending value belongs to the thread they are leaving.
 *
 * @param {{save: (id: string, studio: any) => any, delayMs?: number,
 *          setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (h: any) => void}} o
 */
export function createStudioWriter(o) {
  const delayMs = Number.isFinite(Number(o.delayMs)) ? Number(o.delayMs) : 500;
  const setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer || ((h) => clearTimeout(h));
  /** @type {string|null} */ let pendingId = null;
  /** @type {any} */ let pendingValue = null;
  /** @type {any} */ let timer = null;

  function stop() {
    if (timer != null) { clearTimer(timer); timer = null; }
  }

  function flush() {
    stop();
    const id = pendingId;
    const value = pendingValue;
    pendingId = null;
    pendingValue = null;
    if (id == null) return null;
    return o.save(id, value);
  }

  return {
    /** @param {string|null} id @param {any} studio */
    put(id, studio) {
      if (!id) return;
      if (pendingId && pendingId !== id) flush();     // never carry one thread's state into another
      pendingId = id;
      pendingValue = studio;
      stop();
      timer = setTimer(() => { timer = null; flush(); }, delayMs);
    },
    flush,
    cancel() { stop(); pendingId = null; pendingValue = null; },
    pending: () => (pendingId ? { id: pendingId, studio: pendingValue } : null),
  };
}
