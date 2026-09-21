// graph/fanout.mjs (C2-U1): what one part's gathered inputs MEAN for one run (plan §2.6 BH-2).
//
// This module is pure and tiny, and every ambiguity of spec §2's one-line rule ("a list at a port
// that wants text runs the part once per item") lives in it. These assertions are the contract the
// runner, the canvas and the five C2 parts all read:
//
//   - exactly ONE port may fan; two at once is a REFUSAL, never a zip (a guessed pairing that drops
//     the tail of the longer list is the silent loss §1.2 bans);
//   - every other input BROADCASTS — execution i sees it unchanged;
//   - an empty list fans ZERO times and a one-item list still FANS (its output stays a list);
//   - the joined value is the items that SUCCEEDED, in order — a failure is an entry in the
//     per-item record, never a hole in the list;
//   - identical items are SALTED so `Repeat`'s four copies are four generations, not one answer
//     shown four times.
import assert from 'node:assert/strict';
import { planFan, joinResults, fanoutRecord, MAX_ITEM_ERRORS } from '../../../renderer/chat/graph/fanout.mjs';
import { valueOf, listOf } from '../../../renderer/chat/graph/values.mjs';

/** A spec with just the ports planFan reads. @param {{name: string, accepts: string[]}[]} ports */
const spec = (ports) => ({ inputs: ports.map((p) => ({ label: p.name, ...p })) });

const askish = spec([
  { name: 'context', accepts: ['text', 'json', 'file'] },
  { name: 'extra', accepts: ['text'] },
]);

const text = (s) => valueOf('text', s);

export default (test) => {
  test('no list anywhere: one execution, and nothing about the inputs changes', () => {
    const plan = planFan(askish, { context: [text('a')], extra: [text('b')] });
    assert.equal(plan.kind, 'single');
  });

  test('a list at a text port fans once per item, and the OTHER inputs broadcast', () => {
    const inputs = { context: [listOf([text('x'), text('y'), text('z')])], extra: [text('same')] };
    const plan = planFan(askish, inputs);
    assert.equal(plan.kind, 'fan');
    assert.equal(plan.port, 'context');
    assert.equal(plan.n, 3);
    for (let i = 0; i < 3; i++) {
      const got = plan.inputsFor(i);
      assert.deepEqual(got.context, [text(['x', 'y', 'z'][i])], 'the fanning wire carries item i');
      assert.deepEqual(got.extra, [text('same')], 'and every other input is unchanged');
    }
    // The plan must not hand out the SAME object twice: a part that mutated its inputs would
    // otherwise poison its siblings.
    assert.notEqual(plan.inputsFor(0).extra, plan.inputsFor(1).extra);
  });

  test('a port that ACCEPTS list does not fan — that is what ends a fan-out', () => {
    const collectish = spec([{ name: 'items', accepts: ['list', 'text'] }]);
    const plan = planFan(collectish, { items: [listOf([text('x'), text('y')])] });
    assert.equal(plan.kind, 'single', "Collect's port accepts a list, so the list arrives whole");
  });

  test('TWO lists at once are refused, never zipped', () => {
    const inputs = { context: [listOf([text('a')])], extra: [listOf([text('b'), text('c')])] };
    const plan = planFan(askish, inputs);
    assert.equal(plan.kind, 'refuse');
    assert.equal(plan.reason, 'many');
  });

  test('two lists on the SAME many-port are also refused (one fanning INPUT, not one port)', () => {
    const plan = planFan(askish, { context: [listOf([text('a')]), listOf([text('b')])], extra: [] });
    assert.equal(plan.kind, 'refuse');
  });

  test('one list beside a plain value on the same port fans, and the sibling broadcasts', () => {
    const plan = planFan(askish, { context: [text('head'), listOf([text('a'), text('b')])], extra: [] });
    assert.equal(plan.kind, 'fan');
    assert.equal(plan.n, 2);
    assert.deepEqual(plan.inputsFor(1).context, [text('head'), text('b')],
      'the wire that was not a list keeps its place and its value');
  });

  test('an empty list fans ZERO times, and a one-item list still fans', () => {
    const empty = planFan(askish, { context: [listOf([])], extra: [] });
    assert.equal(empty.kind, 'fan');
    assert.equal(empty.n, 0, 'no executions at all — and no error');

    const one = planFan(askish, { context: [listOf([text('only')])], extra: [] });
    assert.equal(one.kind, 'fan', 'a fan of one is a fan: the output stays a list');
    assert.equal(one.n, 1);
  });

  test('identical items are salted when the PRODUCER says the repeats are deliberate', () => {
    const plan = planFan(askish, {
      context: [listOf([text('same'), text('same'), text('other'), text('same')], { repeats: true })],
      extra: [],
    });
    assert.equal(plan.saltFor(0), null, 'the first of a kind is unsalted, so a resume hits the cache');
    assert.equal(plan.saltFor(1), 1, 'the repeat asks again');
    assert.equal(plan.saltFor(2), null, 'a distinct item needs no salt');
    assert.equal(plan.saltFor(3), 3);
    assert.notEqual(plan.saltFor(1), plan.saltFor(3), 'and two repeats are two different generations');
  });

  test('identical items in an ORDINARY list are one question, asked once', () => {
    // Who repeated decides what a repeat MEANS (fix pass, finding 7). Repeat's copies are the point
    // — four variants of one answer. Two identical lines out of a Split or a Filter are a pasted
    // document repeating itself, and salting those charged the reader twice for one question and
    // took two units off a cap of fifty.
    const plan = planFan(askish, {
      context: [listOf([text('same'), text('same'), text('other')])],
      extra: [],
    });
    assert.deepEqual([plan.saltFor(0), plan.saltFor(1), plan.saltFor(2)], [null, null, null],
      'nothing is salted, so the second identical item is a cache hit');
  });

  test('joinResults keeps the successes IN ORDER and drops nothing else in', () => {
    const value = joinResults([
      { ok: true, value: text('one') },
      { ok: false, message: 'boom' },
      { ok: true, value: text('three') },
    ]);
    assert.equal(value.kind, 'list');
    assert.deepEqual(value.data, [text('one'), text('three')], 'a failure is not a hole in the list');
  });

  test('joinResults of an all-failed fan is an EMPTY list, which the runner turns into one error', () => {
    const value = joinResults([{ ok: false, message: 'a' }, { ok: false, message: 'b' }]);
    assert.equal(value.kind, 'list');
    assert.deepEqual(value.data, []);
  });

  test('joinResults tolerates a part that resolved nothing (To thread) without inventing a value', () => {
    const value = joinResults([{ ok: true, value: null }, { ok: true, value: null }]);
    assert.deepEqual(value.data, [], 'nothing to carry, and no fabricated empty strings');
  });

  test('the per-item record counts what happened and NAMES every failure by index', () => {
    const record = fanoutRecord([
      { ok: true, value: text('a') },
      { ok: false, message: 'item two is bad' },
      { ok: true, value: text('c') },
    ], 5);
    assert.deepEqual(record, {
      n: 5,                       // five were planned…
      done: 3,                    // …three have been attempted so far (a run in progress)
      ok: 2,
      failed: 1,
      hidden: 0,
      errors: [{ i: 1, message: 'item two is bad' }],
    });
  });

  test('the kept failures are BOUNDED, and the ones past the bound are counted', () => {
    // This record is written into the graph row while the fan runs, so an unbounded array is
    // unbounded storage: a two-thousand-item fan that failed wrote two thousand messages into
    // IndexedDB (fix pass, finding 4). The canvas paints five of them either way.
    const results = [];
    for (let i = 0; i < 200; i++) results.push({ ok: false, message: `item ${i} is bad` });
    const record = fanoutRecord(results, 200);
    assert.equal(record.failed, 200, 'the count is the whole truth');
    assert.equal(record.errors.length, MAX_ITEM_ERRORS, 'the messages are bounded');
    assert.equal(record.hidden, 200 - MAX_ITEM_ERRORS, 'and the difference is stated, not hidden');
    assert.equal(record.errors[0].message, 'item 0 is bad', 'the FIRST failures are the ones kept');
  });

  test('the record falls back to what it has when no item count is given', () => {
    const record = fanoutRecord([{ ok: true, value: text('a') }]);
    assert.equal(record.n, 1);
    assert.equal(record.done, 1);
  });

  test('a malformed result is counted as a failure, never as a silent success', () => {
    const record = fanoutRecord([null, undefined, { ok: true }], 3);
    assert.equal(record.failed, 2);
    assert.equal(record.ok, 1, 'ok is the FLAG; joinResults is what drops the valueless one');
    assert.deepEqual(joinResults([{ ok: true }]).data, []);
  });
};
