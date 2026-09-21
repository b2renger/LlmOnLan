// @ts-check
// The conversation tree (plan §3.4 / P0-U4). PURE: no window, document, storage or clock.
//
// A thread is a tree of messages linked by `parentId` (null at a root). The visible conversation is
// one root→head PATH through it; regenerating or editing a message adds a SIBLING, which is what the
// ◀ n/m ▶ control walks. Everything here works on a plain array of Message records and never mutates
// them.
//
//   indexNodes(messages)        → an index: byId, childrenOf (sorted), roots, order
//   pathTo(index, headId)       → root → head, [] when headId is unknown
//   siblingsOf(index, id)       → {list, position, count}  (position is 1-based; 0/0 when unknown)
//   deepestLatest(index, from?) → the id of the newest leaf under `from` (or in the whole tree)
//   subtreeIds(index, id)       → the id itself plus every descendant, parents before children
//   repairHead(index, headId)   → headId when it still exists, else the newest leaf, else null
//
// Sibling order is (createdAt, then id) — ids are time-sortable (core/ids.mjs), so equal timestamps
// still order by creation. "Latest" always means last in that order.

/** @typedef {import('../core/types.mjs').Message} Message */
/** @typedef {{byId: Map<string, any>, childrenOf: Map<string, any[]>, roots: any[], order: string[]}} TreeIndex */

const ROOT = '';

/** @param {any} a @param {any} b */
function bySortKey(a, b) {
  const ta = Number(a && a.createdAt) || 0;
  const tb = Number(b && b.createdAt) || 0;
  if (ta !== tb) return ta - tb;
  return String(a && a.id) < String(b && b.id) ? -1 : (String(a && a.id) > String(b && b.id) ? 1 : 0);
}

/**
 * Index a thread's messages. Children of a node are sorted by (createdAt, id); `roots` holds the
 * nodes with no parent (or whose parent is missing — an orphan is treated as a root so a damaged
 * store still shows its messages).
 * @param {any[]} messages
 * @returns {TreeIndex}
 */
export function indexNodes(messages) {
  const list = Array.isArray(messages) ? messages.filter((m) => m && typeof m.id === 'string') : [];
  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const m of list) byId.set(m.id, m);

  /** @type {Map<string, any[]>} */
  const childrenOf = new Map();
  for (const m of list) {
    const parent = m.parentId && byId.has(m.parentId) ? m.parentId : ROOT;
    const kids = childrenOf.get(parent) || [];
    kids.push(m);
    childrenOf.set(parent, kids);
  }
  for (const kids of childrenOf.values()) kids.sort(bySortKey);

  const roots = childrenOf.get(ROOT) || [];
  /** @type {string[]} */
  const order = [];
  // An explicit stack, not recursion: a chat thread IS a chain, so the tree's depth equals its
  // message count and a recursive walk threw RangeError somewhere past 2,000 messages - which
  // repo.getPath() would have swallowed into an empty thread.
  /** @type {any[]} */
  const stack = [];
  for (let i = roots.length - 1; i >= 0; i--) stack.push(roots[i]);
  while (stack.length) {
    const n = stack.pop();
    order.push(n.id);
    const kids = childrenOf.get(n.id);
    if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return { byId, childrenOf, roots, order };
}

/** @param {TreeIndex|any[]} index */
function asIndex(index) {
  return Array.isArray(index) ? indexNodes(index) : index;
}

/**
 * The path from a root down to `headId`, in display order. An unknown id gives []. A cycle (only
 * possible in a corrupted store) stops at the first repeat instead of hanging.
 * @param {TreeIndex|any[]} index @param {string|null|undefined} headId
 * @returns {any[]}
 */
export function pathTo(index, headId) {
  const ix = asIndex(index);
  const out = [];
  const seen = new Set();
  let id = headId || null;
  while (id && ix.byId.has(id) && !seen.has(id)) {
    seen.add(id);
    const m = ix.byId.get(id);
    out.push(m);
    id = m.parentId || null;
  }
  return out.reverse();
}

/**
 * The messages sharing `messageId`'s parent, and where it sits among them.
 * @param {TreeIndex|any[]} index @param {string} messageId
 * @returns {{list: any[], position: number, count: number}}
 */
export function siblingsOf(index, messageId) {
  const ix = asIndex(index);
  const m = ix.byId.get(messageId);
  if (!m) return { list: [], position: 0, count: 0 };
  const parent = m.parentId && ix.byId.has(m.parentId) ? m.parentId : ROOT;
  const list = ix.childrenOf.get(parent) || [];
  return { list, position: list.findIndex((x) => x.id === messageId) + 1, count: list.length };
}

/**
 * Follow the newest child at every step and return the leaf's id — the branch a user was last on.
 * `fromId` starts the walk at that node (it is returned when it has no children); without it the
 * walk starts at the newest root. Empty tree → null.
 * @param {TreeIndex|any[]} index @param {string|null} [fromId]
 * @returns {string|null}
 */
export function deepestLatest(index, fromId = null) {
  const ix = asIndex(index);
  let node = null;
  if (fromId) {
    node = ix.byId.get(fromId) || null;
    if (!node) return null;
  } else {
    node = ix.roots.length ? ix.roots[ix.roots.length - 1] : null;
    if (!node) return null;
  }
  const seen = new Set();
  for (;;) {
    if (seen.has(node.id)) return node.id;
    seen.add(node.id);
    const kids = ix.childrenOf.get(node.id) || [];
    if (!kids.length) return node.id;
    node = kids[kids.length - 1];
  }
}

/**
 * `messageId` and every descendant, parents before children (so a caller may delete in order).
 * An unknown id gives [].
 * @param {TreeIndex|any[]} index @param {string} messageId
 * @returns {string[]}
 */
export function subtreeIds(index, messageId) {
  const ix = asIndex(index);
  if (!ix.byId.has(messageId)) return [];
  const out = [messageId];
  for (let i = 0; i < out.length; i++) {
    for (const kid of ix.childrenOf.get(out[i]) || []) {
      if (!out.includes(kid.id)) out.push(kid.id);
    }
  }
  return out;
}

/**
 * A head id that is guaranteed to exist in the tree: the given one when it is still there, else the
 * newest leaf, else null (empty thread).
 * @param {TreeIndex|any[]} index @param {string|null|undefined} headId
 * @returns {string|null}
 */
export function repairHead(index, headId) {
  const ix = asIndex(index);
  if (headId && ix.byId.has(headId)) return headId;
  return deepestLatest(ix);
}
