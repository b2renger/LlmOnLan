// graph/tidy.mjs (C3-U3): the layered left-to-right layout behind the Tidy button.
//
// What these assertions protect (spec §4, plan §2.6 BJ-17):
//   - LAYERING: a part sits one column right of its right-most input, so a graph reads left to
//     right and every source sits on the left edge;
//   - IT MOVES PARTS AND NOTHING ELSE: same ids, types, settings, values and wires, same counts —
//     asserted field by field so a later "improvement" cannot quietly drop a wire;
//   - STABILITY: tidy(tidy(doc)) returns the SAME OBJECT, which is what makes pressing the button
//     twice safe and is the property a y-based row order would break;
//   - it survives the graphs a reader can really be holding: an empty canvas, one lone part,
//     several disconnected components, and a half-wired graph with a cycle in it (the engine
//     refuses to RUN one, but the layout button must not hang or throw on one).
import assert from 'node:assert/strict';
import { tidy, tidyPlan, columns, rowOrder, TIDY, TIDY_GRID } from '../../../renderer/chat/graph/tidy.mjs';
import { createDoc, addPart, addWire } from '../../../renderer/chat/graph/model.mjs';
import { specs, ids, clock } from './graph-fixture.mjs';

const map = specs();

/** A builder over the fixture specs: `b.part('note', x, y)` then `b.wire(a, b, 'in')`. */
function builder(seed = 1000) {
  const now = clock(seed);
  const newId = ids('p');
  const o = { specs: map, newId, now };
  let doc = createDoc({ id: 'g1', threadId: 't1', title: 'Layout', now });
  return {
    part(/** @type {string} */ type, /** @type {number} */ x, /** @type {number} */ y, /** @type {any} */ settings) {
      const out = addPart(doc, { type, x, y, settings }, o);
      doc = out.doc;
      return out.part.id;
    },
    wire(/** @type {string} */ from, /** @type {string} */ to, /** @type {string} */ port) {
      const out = addWire(doc, { from, to, port }, o);
      // A refused wire returns no document at all. A layout test that quietly built a DIFFERENT
      // graph from the one it describes is worse than a failing one.
      assert.ok(out.ok, `the fixture wire ${from}->${to}.${port} was refused: ${out.reason}`);
      doc = out.doc;
      return out.ok;
    },
    get doc() { return doc; },
    set doc(next) { doc = next; },
    now,
  };
}

const at = (/** @type {any} */ doc, /** @type {string} */ id) => doc.parts.find((/** @type {any} */ p) => p.id === id);

export default (test) => {
  test('a chain lands in left-to-right columns, sources on the left edge', () => {
    const b = builder();
    const note = b.part('note', 900, 900);
    const ask = b.part('ask', 20, 400);
    const second = b.part('ask', 50, 50);
    b.wire(note, ask, 'in');
    b.wire(ask, second, 'in');

    const col = columns(b.doc);
    assert.equal(col.get(note), 0);
    assert.equal(col.get(ask), 1);
    assert.equal(col.get(second), 2);

    const out = tidy(b.doc, { now: b.now });
    assert.equal(at(out, note).x, TIDY.originX, 'the source sits on the left edge');
    assert.equal(at(out, note).y, TIDY.originY);
    assert.ok(at(out, ask).x > at(out, note).x, 'its reader is to its right');
    assert.ok(at(out, second).x > at(out, ask).x);
    // One column apart, in the order the wires say — and every part on the canvas grid.
    for (const p of out.parts) {
      assert.equal(p.x % TIDY_GRID, 0, `x on the grid: ${p.x}`);
      assert.equal(p.y % TIDY_GRID, 0, `y on the grid: ${p.y}`);
    }
  });

  test('a part is one column right of its RIGHT-MOST input, not its first one', () => {
    // note → ask → last, and ALSO note → last directly. The long path wins.
    const b = builder();
    const note = b.part('note', 0, 0);
    const ask = b.part('ask', 0, 200);
    const last = b.part('ask', 0, 400);
    b.wire(note, ask, 'in');
    b.wire(ask, last, 'in');
    b.wire(note, last, 'in');
    const col = columns(b.doc);
    assert.equal(col.get(last), 2, 'the longest path decides the column');
  });

  test('it moves parts and NOTHING else', () => {
    const b = builder();
    const note = b.part('note', 300, 300, { text: 'five names' });
    const ask = b.part('ask', 10, 10, { prompt: 'go', shape: 'text' });
    b.part('ask', 700, 40, { prompt: 'again', shape: 'text' });
    b.wire(note, ask, 'in');
    const before = b.doc;
    const after = tidy(before, { now: b.now });

    assert.notEqual(after, before, 'a graph that had to move is a NEW document');
    assert.equal(after.parts.length, before.parts.length);
    assert.equal(after.wires.length, before.wires.length);
    assert.deepEqual(after.wires, before.wires, 'not one wire touched');
    assert.equal(after.title, before.title);
    assert.equal(after.threadId, before.threadId);
    assert.equal(after.id, before.id);
    assert.ok(after.rev > before.rev, 'the revision moves, so the store writes it');
    for (const p of before.parts) {
      const q = at(after, p.id);
      assert.ok(q, `part ${p.id} survived`);
      assert.equal(q.type, p.type);
      assert.deepEqual(q.settings, p.settings);
      assert.equal(q.state, p.state);
      assert.deepEqual(q.value, p.value);
      assert.equal(q.w, p.w);
      assert.equal(q.h, p.h);
      // Everything except x and y is identical, key for key.
      assert.deepEqual(
        Object.keys(q).sort().filter((k) => k !== 'x' && k !== 'y').map((k) => [k, q[k]]),
        Object.keys(p).sort().filter((k) => k !== 'x' && k !== 'y').map((k) => [k, p[k]]),
      );
    }
  });

  test('tidying an already tidy graph returns the SAME document (stability)', () => {
    const b = builder();
    const note = b.part('note', 33, 77);
    const ask = b.part('ask', 500, 13);
    const last = b.part('ask', 120, 900);
    b.wire(note, ask, 'in');
    b.wire(ask, last, 'in');
    const once = tidy(b.doc, { now: b.now });
    const twice = tidy(once, { now: b.now });
    assert.equal(twice, once, 'the second press moves nothing and allocates nothing');
    assert.equal(tidyPlan(once).moved.length, 0);
  });

  test('a 30-part graph is stable, laid out in columns, and moves every part exactly once', () => {
    const b = builder();
    /** @type {string[]} */ const sources = [];
    /** @type {string[]} */ const asks = [];
    for (let i = 0; i < 10; i++) {
      // Deliberately scattered, and deliberately NOT in wire order.
      sources.push(b.part('note', 700 - i * 13, (i * 97) % 500));
      asks.push(b.part('ask', 40 + ((i * 31) % 300), 600 - i * 7));
    }
    /** @type {string[]} */ const tails = [];
    for (let i = 0; i < 10; i++) {
      tails.push(b.part('ask', (i * 71) % 900, (i * 53) % 900));
      b.wire(sources[i], asks[i], 'in');
      b.wire(asks[i], tails[i], 'in');
    }
    assert.equal(b.doc.parts.length, 30);

    const plan = tidyPlan(b.doc);
    assert.equal(plan.moved.length, 30, 'every part in this scatter has somewhere better to be');
    const out = tidy(b.doc, { now: b.now });
    assert.equal(tidy(out, { now: b.now }), out, 'stable on a real-sized graph');

    // Three columns, ten rows each, and no two parts sharing a spot.
    const xs = new Set(out.parts.map((/** @type {any} */ p) => p.x));
    assert.equal(xs.size, 3, `three columns, got ${Array.from(xs).join(',')}`);
    const spots = new Set(out.parts.map((/** @type {any} */ p) => `${p.x}:${p.y}`));
    assert.equal(spots.size, 30, 'no two parts land on top of each other');
    for (const id of sources) assert.equal(at(out, id).x, TIDY.originX);
    for (let i = 0; i < 10; i++) {
      assert.ok(at(out, asks[i]).x > at(out, sources[i]).x);
      assert.ok(at(out, tails[i]).x > at(out, asks[i]).x);
    }
  });

  test('rows follow the feeders: a fan keeps its readers beside what feeds them', () => {
    const b = builder();
    const a = b.part('note', 0, 0);
    const c = b.part('note', 0, 300);
    // Wired in REVERSE order, so only the barycentre can put them back in feeder order.
    const askC = b.part('ask', 900, 20);
    const askA = b.part('ask', 900, 400);
    b.wire(c, askC, 'in');
    b.wire(a, askA, 'in');
    const out = tidy(b.doc, { now: b.now });
    assert.ok(at(out, a).y < at(out, c).y, 'the two sources keep the order the reader had them in');
    assert.ok(
      at(out, askA).y < at(out, askC).y,
      'and each reader sits in the row of the source that feeds it, not where it happened to be',
    );
  });

  test('an empty canvas, and a single lone part', () => {
    const empty = createDoc({ id: 'g0', threadId: null, now: clock(1) });
    assert.equal(tidy(empty), empty, 'nothing to lay out is not a change');
    assert.equal(tidyPlan(empty).moved.length, 0);
    assert.equal(tidyPlan(/** @type {any} */ (null)).moved.length, 0, 'never throws on a missing doc');

    const b = builder();
    b.part('note', 640, 480);
    const out = tidy(b.doc, { now: b.now });
    assert.equal(out.parts[0].x, TIDY.originX);
    assert.equal(out.parts[0].y, TIDY.originY);
  });

  test('disconnected components share the columns rather than overlapping', () => {
    const b = builder();
    const n1 = b.part('note', 10, 10);
    const a1 = b.part('ask', 10, 10);
    const n2 = b.part('note', 10, 10);
    const a2 = b.part('ask', 10, 10);
    b.wire(n1, a1, 'in');
    b.wire(n2, a2, 'in');
    const out = tidy(b.doc, { now: b.now });
    assert.equal(at(out, n1).x, at(out, n2).x, 'both sources are in column 0');
    assert.notEqual(at(out, n1).y, at(out, n2).y, 'and they are packed down the column, not stacked');
    assert.equal(at(out, a1).x, at(out, a2).x);
    assert.notEqual(at(out, a1).y, at(out, a2).y);
  });

  test('a graph with a cycle in it lays out, terminates, and keeps every part', () => {
    // addWire refuses a cycle, so build one the only way a document can really carry one: by hand,
    // which is also what an imported file from a newer version could hand us.
    const b = builder();
    const a = b.part('ask', 100, 100);
    const c = b.part('ask', 300, 100);
    b.doc = {
      ...b.doc,
      wires: [
        { id: 'w1', from: a, to: c, port: 'in' },
        { id: 'w2', from: c, to: a, port: 'in' },
      ],
    };
    const out = tidy(b.doc, { now: b.now });
    assert.equal(out.parts.length, 2, 'both parts are still there');
    assert.equal(out.wires.length, 2, 'both wires are still there');
    for (const p of out.parts) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `finite position, got ${p.x},${p.y}`);
    }
  });

  test('rowOrder and columns are exported and agree with the placement', () => {
    const b = builder();
    const note = b.part('note', 0, 0);
    const ask = b.part('ask', 0, 0);
    b.wire(note, ask, 'in');
    const col = columns(b.doc);
    const { cols, rows } = rowOrder(b.doc, col);
    assert.deepEqual(cols, [0, 1]);
    assert.deepEqual((rows.get(0) || []).map((/** @type {any} */ p) => p.id), [note]);
    assert.deepEqual((rows.get(1) || []).map((/** @type {any} */ p) => p.id), [ask]);
    const plan = tidyPlan(b.doc);
    assert.equal(plan.places.get(note).x, TIDY.originX);
    assert.ok(plan.places.get(ask).x > TIDY.originX);
  });
};
