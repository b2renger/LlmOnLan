// graph/topo.mjs (C1-U1): order, cycle detection, the stale set, the run set, the run plan.
//
// What these assertions protect:
//   - the FROZEN runSet rule (plan §2.6 BG-4). "A 30-part graph costs one generation after a typo
//     fix" is a promise about GPU seats on a shared farm, and this is where it is either true or
//     not: a `done` part whose whole upstream is `done` must not be re-run, and everything below a
//     re-run part must be;
//   - `markStale` keeps values. A stale part still shows its last answer — losing it on every edit
//     would make the canvas unreadable while you type;
//   - order() is stable, so two runs of the same graph hit the farm in the same order;
//   - a cycle is reported as a real closed walk, because the canvas has to point at it;
//   - the cap is ACCOUNTED for in C1 (one generation per thinking part) so C2 only has to multiply.
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_ITEMS, order, wouldCycle, downstream, markStale, runSet, runPlan,
} from '../../../renderer/chat/graph/topo.mjs';
import * as model from '../../../renderer/chat/graph/model.mjs';
import { specs, clock, build } from './graph-fixture.mjs';

/** A doc built by hand: the topo module never looks at part types, only at ids and wires. */
function doc(parts, wires) {
  return /** @type {any} */ ({
    id: 'g', threadId: 't', title: '', createdAt: 0, updatedAt: 0, rev: 1, settings: {},
    view: { x: 0, y: 0, zoom: 1 },
    parts: parts.map((p) => (typeof p === 'string' ? { id: p, type: 'note', state: 'idle' } : p)),
    wires: wires.map(([from, to], i) => ({ id: `w${i}`, from, to, port: 'in' })),
  });
}

export default (test) => {
  // ------------------------------------------------------------------- order
  test('order: a chain comes out in dependency order', () => {
    const ord = order(doc(['c', 'a', 'b'], [['a', 'b'], ['b', 'c']]));
    assert.equal(ord.ok, true);
    assert.deepEqual(ord.ids, ['a', 'b', 'c']);
  });

  test('order: a diamond places both middles before the join, document order breaking the tie', () => {
    const ord = order(doc(['a', 'b', 'c', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]));
    assert.deepEqual(ord.ids, ['a', 'b', 'c', 'd']);
    const flipped = order(doc(['a', 'c', 'b', 'd'], [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd']]));
    assert.deepEqual(flipped.ids, ['a', 'c', 'b', 'd'], 'stable: ties keep document order');
  });

  test('order: islands and an empty graph are both fine', () => {
    assert.deepEqual(order(doc(['a', 'b'], [])).ids, ['a', 'b']);
    assert.deepEqual(order(doc([], [])).ids, []);
  });

  test('order: a cycle is reported as a closed walk, not as "some parts are left"', () => {
    const ord = order(doc(['a', 'b', 'c', 'x'], [['a', 'b'], ['b', 'c'], ['c', 'a'], ['x', 'a']]));
    assert.equal(ord.ok, false);
    assert.equal(ord.cycle[0], ord.cycle[ord.cycle.length - 1], 'the walk closes on itself');
    assert.deepEqual([...ord.cycle].sort().filter((v, i, s) => s.indexOf(v) === i), ['a', 'b', 'c']);
    assert.ok(!ord.cycle.includes('x'), 'a part feeding the cycle is not part of it');
  });

  test('order: a self-wire is a cycle', () => {
    assert.equal(order(doc(['a'], [['a', 'a']])).ok, false);
  });

  // ------------------------------------------------------------------- wouldCycle
  test('wouldCycle: only edges that close a loop', () => {
    const d = doc(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    assert.equal(wouldCycle(d, { from: 'c', to: 'a' }), true);
    assert.equal(wouldCycle(d, { from: 'c', to: 'b' }), true);
    assert.equal(wouldCycle(d, { from: 'a', to: 'a' }), true);
    assert.equal(wouldCycle(d, { from: 'a', to: 'c' }), false, 'a shortcut forward is not a cycle');
    assert.equal(wouldCycle(d, { from: 'b', to: 'a' }), true);
    assert.equal(wouldCycle(d, {}), false);
  });

  // ------------------------------------------------------------------- downstream
  test('downstream: everything reachable, topological, seeds excluded', () => {
    const d = doc(['a', 'b', 'c', 'd', 'e'], [['a', 'b'], ['b', 'c'], ['c', 'd'], ['e', 'c']]);
    assert.deepEqual(downstream(d, ['a']), ['b', 'c', 'd']);
    assert.deepEqual(downstream(d, ['c']), ['d']);
    assert.deepEqual(downstream(d, ['d']), []);
    assert.deepEqual(downstream(d, []), []);
    assert.deepEqual(downstream(d, ['a', 'e']), ['b', 'c', 'd'], 'two seeds, each excluded');
  });

  // ------------------------------------------------------------------- markStale
  test('markStale: the seed and its downstream go stale, values are KEPT', () => {
    const d = doc([
      { id: 'a', state: 'done', value: { kind: 'text', data: 'A' } },
      { id: 'b', state: 'done', value: { kind: 'text', data: 'B' } },
      { id: 'c', state: 'done', value: { kind: 'text', data: 'C' } },
    ], [['a', 'b'], ['b', 'c']]);
    const next = markStale(d, ['b'], { now: () => 42 });
    assert.deepEqual(next.parts.map((p) => p.state), ['done', 'stale', 'stale']);
    assert.deepEqual(next.parts.map((p) => p.value.data), ['A', 'B', 'C']);
    assert.equal(next.updatedAt, 42);
    assert.deepEqual(d.parts.map((p) => p.state), ['done', 'done', 'done'], 'the input is untouched');
  });

  test('markStale: nothing to change returns the SAME doc (no needless save, no needless render)', () => {
    const d = doc([{ id: 'a', type: 'note', state: 'stale' }, { id: 'b', type: 'note', state: 'stale' }],
      [['a', 'b']]);
    assert.equal(markStale(d, ['a']), d, 'already stale: identical reference');
    assert.equal(markStale(d, []), d);
    assert.equal(markStale(d, ['ghost']), d, 'an unknown id marks nothing');
  });

  // ------------------------------------------------------------------- runSet
  test('runSet: a fresh graph runs whole, in order', () => {
    assert.deepEqual(runSet(doc(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']])), ['a', 'b', 'c']);
  });

  test('runSet: a fully done graph runs nothing — pressing Run twice costs zero generations', () => {
    const done = ['a', 'b', 'c'].map((id) => ({ id, type: 'note', state: 'done' }));
    assert.deepEqual(runSet(doc(done, [['a', 'b'], ['b', 'c']])), []);
  });

  test('runSet: one stale part re-runs itself and its downstream ONLY (the typo-fix promise)', () => {
    const parts = ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'note', state: id === 'b' ? 'stale' : 'done' }));
    assert.deepEqual(runSet(doc(parts, [['a', 'b'], ['b', 'c'], ['c', 'd']])), ['b', 'c', 'd']);
  });

  test('runSet: a done join whose other parent is stale still re-runs', () => {
    const parts = [
      { id: 'a', type: 'note', state: 'done' },
      { id: 'b', type: 'note', state: 'stale' },
      { id: 'j', type: 'note', state: 'done' },
    ];
    assert.deepEqual(runSet(doc(parts, [['a', 'j'], ['b', 'j']])), ['b', 'j']);
  });

  test('runSet: error counts as dirty, queued and running do not (a run in flight is not re-queued)', () => {
    const at = (state) => doc([{ id: 'a', type: 'note', state }], []);
    assert.deepEqual(runSet(at('error')), ['a']);
    assert.deepEqual(runSet(at('idle')), ['a']);
    assert.deepEqual(runSet(at('stale')), ['a']);
    assert.deepEqual(runSet(at('queued')), []);
    assert.deepEqual(runSet(at('running')), []);
    assert.deepEqual(runSet(at('done')), []);
  });

  test('runSet: a cycle runs nothing at all', () => {
    assert.deepEqual(runSet(doc(['a', 'b'], [['a', 'b'], ['b', 'a']])), []);
  });

  // ------------------------------------------------------------------- runPlan
  test('runPlan: cost is one generation per THINKING part, not per part', () => {
    const map = specs();
    const now = clock();
    const { doc: d, id } = build(model, {
      types: ['n1:note', 'a1:ask', 'c1:collect'], wires: ['n1>a1:in'], specs: map, now,
    });
    const plan = runPlan(d, { specs: map });
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.ids, [id('n1'), id('a1'), id('c1')]);
    assert.deepEqual(plan.thinking, [id('a1')]);
    assert.equal(plan.cost, 1);
    assert.equal(plan.cap, DEFAULT_MAX_ITEMS);
    assert.equal(DEFAULT_MAX_ITEMS, 50, 'spec §2: the default cap is 50 generations');
    assert.equal(plan.overflow, 0);
  });

  test('runPlan: past the cap the extra thinking parts are counted as overflow, never dropped silently', () => {
    const map = specs();
    const types = Array.from({ length: 4 }, (_, i) => `a${i}:ask`);
    const { doc: d } = build(model, { types, specs: map });
    const plan = runPlan(d, { specs: map, cap: 2 });
    assert.equal(plan.cost, 4);
    assert.equal(plan.capped.length, 2);
    assert.equal(plan.overflow, 2);
    assert.equal(plan.ids.length, 4, 'the plan still lists every part: the cap is a decision, not a filter');
  });

  test('runPlan: `only` restricts the plan but keeps topological order', () => {
    const map = specs();
    const { doc: d, id } = build(model, {
      types: ['n1:note', 'a1:ask', 'a2:ask'], wires: ['n1>a1:in', 'a1>a2:in'], specs: map,
    });
    const plan = runPlan(d, { specs: map, only: [id('a2'), id('n1')] });
    assert.deepEqual(plan.ids, [id('n1'), id('a2')]);
    assert.equal(plan.cost, 1);
  });

  test('runPlan: a cycle plans nothing and hands back the cycle', () => {
    const plan = runPlan(doc(['a', 'b'], [['a', 'b'], ['b', 'a']]), { specs: specs() });
    assert.equal(plan.ok, false);
    assert.deepEqual(plan.ids, []);
    assert.ok(plan.cycle.length >= 2);
  });
};
