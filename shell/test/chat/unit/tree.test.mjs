// The conversation tree (P0-U4): sibling order, paths, the newest branch, subtrees and head repair,
// on a 3-level fork fixture. state/tree.mjs is pure, so these run straight in Node.
import assert from 'node:assert/strict';
import { indexNodes, pathTo, siblingsOf, deepestLatest, subtreeIds, repairHead } from '../../../renderer/chat/state/tree.mjs';

/**
 *   u1 ─ a1 ┬ u2 ─ a2
 *           └ u3 ─ a3 ─ u4          (u3 is newer than u2: the "latest" branch)
 */
function fork() {
  const m = (id, parentId, createdAt, role) => ({ id, threadId: 'T', parentId, createdAt, role, content: id });
  return [
    m('u1', null, 1000, 'user'),
    m('a1', 'u1', 2000, 'assistant'),
    m('u2', 'a1', 3000, 'user'),
    m('a2', 'u2', 4000, 'assistant'),
    m('u3', 'a1', 5000, 'user'),
    m('a3', 'u3', 6000, 'assistant'),
    m('u4', 'a3', 7000, 'user'),
  ];
}

const STATE = new URL('../../../renderer/chat/state/', import.meta.url);

export default (test) => {
  test('indexNodes: children sorted by createdAt then id; roots and order', () => {
    const ix = indexNodes(fork());
    assert.deepEqual(ix.roots.map((m) => m.id), ['u1']);
    assert.deepEqual((ix.childrenOf.get('a1') || []).map((m) => m.id), ['u2', 'u3']);
    assert.deepEqual(ix.order, ['u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'u4']);
    assert.equal(ix.byId.size, 7);
  });

  test('indexNodes: equal createdAt falls back to id order', () => {
    const same = [
      { id: 'r', parentId: null, createdAt: 1 },
      { id: 'zz', parentId: 'r', createdAt: 5 },
      { id: 'aa', parentId: 'r', createdAt: 5 },
      { id: 'mm', parentId: 'r', createdAt: 5 },
    ];
    assert.deepEqual((indexNodes(same).childrenOf.get('r') || []).map((m) => m.id), ['aa', 'mm', 'zz']);
  });

  test('indexNodes: an orphan (missing parent) is treated as a root, not dropped', () => {
    const ix = indexNodes([{ id: 'x', parentId: 'gone', createdAt: 1 }, { id: 'y', parentId: 'x', createdAt: 2 }]);
    assert.deepEqual(ix.roots.map((m) => m.id), ['x']);
    assert.deepEqual(pathTo(ix, 'y').map((m) => m.id), ['x', 'y']);
  });

  test('indexNodes: garbage in, empty index out', () => {
    const ix = indexNodes(/** @type {any} */ (null));
    assert.deepEqual(ix.roots, []);
    assert.equal(deepestLatest(ix), null);
    assert.deepEqual(subtreeIds(ix, 'nope'), []);
    assert.equal(repairHead(ix, 'nope'), null);
  });

  test('pathTo: root → head on both branches; unknown head gives []', () => {
    const ix = indexNodes(fork());
    assert.deepEqual(pathTo(ix, 'a2').map((m) => m.id), ['u1', 'a1', 'u2', 'a2']);
    assert.deepEqual(pathTo(ix, 'u4').map((m) => m.id), ['u1', 'a1', 'u3', 'a3', 'u4']);
    assert.deepEqual(pathTo(ix, 'nope'), []);
    assert.deepEqual(pathTo(ix, null), []);
  });

  test('pathTo: accepts a raw array and survives a cycle', () => {
    assert.deepEqual(pathTo(fork(), 'a1').map((m) => m.id), ['u1', 'a1']);
    const cyclic = [{ id: 'a', parentId: 'b', createdAt: 1 }, { id: 'b', parentId: 'a', createdAt: 2 }];
    const path = pathTo(cyclic, 'a').map((m) => m.id);
    assert.equal(path.length, 2);
    assert.equal(path[path.length - 1], 'a');
  });

  test('siblingsOf: position is 1-based inside the sorted sibling list', () => {
    const ix = indexNodes(fork());
    assert.deepEqual(siblingsOf(ix, 'u2'), { list: ix.childrenOf.get('a1'), position: 1, count: 2 });
    assert.equal(siblingsOf(ix, 'u3').position, 2);
    assert.equal(siblingsOf(ix, 'u1').count, 1);
    assert.deepEqual(siblingsOf(ix, 'nope'), { list: [], position: 0, count: 0 });
  });

  test('deepestLatest: follows the newest child to a leaf', () => {
    const ix = indexNodes(fork());
    assert.equal(deepestLatest(ix), 'u4');
    assert.equal(deepestLatest(ix, 'u2'), 'a2');
    assert.equal(deepestLatest(ix, 'u4'), 'u4');
    assert.equal(deepestLatest(ix, 'nope'), null);
  });

  test('deepestLatest: with several roots the newest root wins', () => {
    const ix = indexNodes([
      { id: 'r1', parentId: null, createdAt: 10 },
      { id: 'r2', parentId: null, createdAt: 20 },
      { id: 'c', parentId: 'r1', createdAt: 30 },
    ]);
    assert.equal(deepestLatest(ix), 'r2');
  });

  test('subtreeIds: the node itself plus every descendant, parents first', () => {
    const ix = indexNodes(fork());
    assert.deepEqual(subtreeIds(ix, 'a1'), ['a1', 'u2', 'u3', 'a2', 'a3', 'u4']);
    assert.deepEqual(subtreeIds(ix, 'u4'), ['u4']);
    assert.deepEqual(subtreeIds(ix, 'u1').length, 7);
    assert.deepEqual(subtreeIds(ix, 'nope'), []);
  });

  test('repairHead: keeps a live head, replaces a dead one with the newest leaf', () => {
    const all = fork();
    const ix = indexNodes(all);
    assert.equal(repairHead(ix, 'a2'), 'a2');
    const pruned = indexNodes(all.filter((m) => !['u3', 'a3', 'u4'].includes(m.id)));
    assert.equal(repairHead(pruned, 'u4'), 'a2');
    assert.equal(repairHead(indexNodes([]), 'u4'), null);
  });

  test('a 10,000-message chain indexes without blowing the stack', () => {
    // A chat thread IS a chain, so the tree's depth equals its message count. indexNodes used to
    // walk it recursively: RangeError past ~2,000, which repo.getPath() would have turned into an
    // empty thread rather than an error the user could see.
    const chain = [];
    for (let i = 0; i < 10000; i++) {
      chain.push({ id: 'm' + i, parentId: i ? 'm' + (i - 1) : null, createdAt: 1000 + i, role: i % 2 ? 'assistant' : 'user', content: 'x' });
    }
    const ix = indexNodes(chain);
    assert.equal(ix.order.length, 10000, 'every message is in display order');
    assert.equal(ix.order[0], 'm0');
    assert.equal(ix.order[9999], 'm9999');
    assert.equal(ix.roots.length, 1);
    assert.equal(pathTo(ix, 'm9999').length, 10000, 'the whole path comes back');
    assert.equal(deepestLatest(ix), 'm9999');
    assert.equal(subtreeIds(ix, 'm0').length, 10000);
  }, { timeoutMs: 30000 });

  test('state/tree.mjs is pure: it imports and runs with window/document/localStorage/indexedDB trapped', async () => {
    const names = ['window', 'document', 'localStorage', 'indexedDB'];
    const saved = names.map((n) => Object.getOwnPropertyDescriptor(globalThis, n));
    for (const n of names) Object.defineProperty(globalThis, n, { configurable: true, get() { throw new Error(`pure module touched ${n}`); } });
    try {
      const mod = await import(new URL('tree.mjs?trap=' + Date.now(), STATE).href);
      assert.equal(mod.deepestLatest(mod.indexNodes(fork())), 'u4');
    } finally {
      names.forEach((n, i) => { if (saved[i]) Object.defineProperty(globalThis, n, saved[i]); else delete globalThis[n]; });
    }
  });
};
