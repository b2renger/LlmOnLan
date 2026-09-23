// @ts-check
// K3-U2 (COMPUTER_PLAN §11 K3-U2, §6.6, §4.5, §4.6) — the six control parts and the loop rules.
//
// The acceptance list this file owns, verbatim:
//
//   Condition's text classifier table, INCLUDING "anything unmatched → maybe" · a self-wire is
//   still refused · a cycle is created with `back:true` · a cycle with no gate is refused
//   `loop-ungated` · the owner's lesson-11 loop (state → Toggle → Instruction → state) is
//   accepted · Toggle off bars and STILL PUBLISHES · Dialog `askEveryRun:false` is satisfied by a
//   stored value and `true` is not · Timer's `repeats` clamp.
//
// What is asserted here and nowhere else: the SEPARATION of §4.5 — a barrier refuses to ACTIVATE
// what comes next, and the value still flows. Every one of the six is checked for it, because a
// single part that conflates the two turns "stop here" into "lose this", and the reader finds out
// three boxes later.

import assert from 'node:assert/strict';

import { classify, readVerdict, verdictPrompt, branchOf, modeOf, condition, BRANCHES, MODES, VERDICT_SCHEMA }
  from '../../../renderer/chat/graph/parts/condition.mjs';
import { secondsOf, repeatsOf, plannedWaitMs, timer, MIN_SECONDS, MAX_SECONDS }
  from '../../../renderer/chat/graph/parts/timer.mjs';
import { toggle, passthrough } from '../../../renderer/chat/graph/parts/toggle.mjs';
import { button, notePress, consumePress, isReady, clearPresses }
  from '../../../renderer/chat/graph/parts/button.mjs';
import { dialog, asksEveryRun, fallbackOf } from '../../../renderer/chat/graph/parts/dialog.mjs';
import { confirm, lastOutcome } from '../../../renderer/chat/graph/parts/confirm.mjs';
import {
  park, answer, pending, isParked, parkOf, cancelAll, onParks,
} from '../../../renderer/chat/graph/parts/control-bus.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import { createDoc, addPart, addWire, setSettings } from '../../../renderer/chat/graph/model.mjs';
import { forwardEdges, order, gatedLoop, cycleFor } from '../../../renderer/chat/graph/topo.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';
import { ids, clock } from './graph-fixture.mjs';

const specs = specMap();

/** A document, and the tools to keep building it, against the REAL part catalogue. */
function seed() {
  const now = clock();
  const newId = ids('p');
  return { doc: createDoc({ id: 'g1', threadId: null, now }), o: { specs, newId, now } };
}

/** place → [doc, id] */
function place(doc, type, o, x = 0, y = 0) {
  const res = addPart(doc, { type, x, y }, o);
  assert.ok(res.part, `${type} is not in the catalogue`);
  return [res.doc, res.part.id];
}

/** The one input a control part reads, as the runner hands it over. */
const feed = (value) => ({ in: value === undefined ? [] : [value] });

export default (test) => {
  test('Condition: the free classifier, and anything unmatched is MAYBE (§6.6)', () => {
    assert.deepEqual([...BRANCHES], ['yes', 'no', 'maybe']);
    assert.deepEqual([...MODES], ['text', 'model']);
    const table = [
      ['yes', 'yes'], ['Yes.', 'yes'], ['TRUE', 'yes'], ['y', 'yes'], ['oui', 'yes'],
      ['affirmative', 'yes'], ['1', 'yes'],
      ['no', 'no'], ['No, never', 'no'], ['false', 'no'], ['n', 'no'], ['non', 'no'], ['0', 'no'],
      ['maybe', 'maybe'], ['perhaps', 'maybe'], ['unsure', 'maybe'], ['it depends', 'maybe'],
      // The rule that matters: an answer nobody anticipated goes to MAYBE, never silently to no.
      ['banana', 'maybe'], ['', 'maybe'], ['I would rather not say', 'maybe'],
    ];
    for (const [input, want] of table) {
      assert.equal(classify(input), want, `classify(${JSON.stringify(input)})`);
    }
    // JSON true/false/null are the three the table names explicitly.
    assert.equal(classify({ kind: 'json', data: true }), 'yes');
    assert.equal(classify({ kind: 'json', data: false }), 'no');
    assert.equal(classify({ kind: 'json', data: null }), 'maybe');
    // The settings readers, which is where a hand-edited file lands.
    assert.equal(branchOf({ branch: 'no' }), 'no');
    assert.equal(branchOf({ branch: 'sideways' }), 'yes');
    assert.equal(modeOf({}), 'text', 'free unless asked otherwise');
    assert.equal(modeOf({ mode: 'oracle' }), 'text');
  });

  test('Condition: text mode bars every branch but its own, and the value still flows (§4.5)', async () => {
    const value = valueOf('text', 'Yes — the study says so');
    const yes = await condition.run({ part: { id: 'c1', settings: { branch: 'yes' } }, inputs: feed(value) });
    assert.equal(yes.bar, false, 'the matching branch continues');
    assert.equal(yes.value, value, 'and passes its input straight through');
    const no = await condition.run({ part: { id: 'c2', settings: { branch: 'no' } }, inputs: feed(value) });
    assert.equal(no.bar, true, 'a branch whose verdict did not match is barred');
    assert.equal(no.value, value, 'BARRED IS NOT LOST: the value is published either way (§4.5)');
    // Nothing wired is not an error — it reads as `maybe`, which is what the maybe branch is for.
    const bare = await condition.run({ part: { id: 'c3', settings: { branch: 'maybe' } }, inputs: feed() });
    assert.equal(bare.bar, false);
  });

  test('Condition: model mode asks ONCE, with a fixed shape, and reads the verdict back', async () => {
    assert.equal(condition.thinks, true);
    assert.equal(condition.thinksFor({ settings: { mode: 'text' } }), false,
      'the plan preview must not quote a generation for a FREE Condition (§4.6)');
    assert.equal(condition.thinksFor({ settings: { mode: 'model' } }), true);

    /** @type {any[]} */ const calls = [];
    const ask = { json: async (/** @type {any} */ call) => { calls.push(call); return { ok: true, value: { verdict: 'no' } }; } };
    const part = { id: 'c1', settings: { branch: 'no', mode: 'model', question: 'Is it finished?', model: 'mock-verdict' } };
    const out = await condition.run({ part, inputs: feed(valueOf('text', 'the draft is half written')), ask });
    assert.equal(out.bar, false, 'the farm said no and this IS the no branch');
    assert.equal(calls.length, 1, 'ONE cheap generation, never one per branch');
    assert.deepEqual(calls[0].schema, VERDICT_SCHEMA, 'a FIXED schema, so the ask cache can hit');
    assert.equal(calls[0].model, 'mock-verdict');
    assert.ok(calls[0].prompt.includes('Is it finished?') && calls[0].prompt.includes('half written'),
      `the prompt carries exactly the question and the text: ${calls[0].prompt}`);

    // The cache key IS the prompt: same question, same text → the identical string, so two
    // Conditions in a fan cost one generation between them.
    assert.equal(verdictPrompt('Is it finished?', 'x'), verdictPrompt('Is it finished?', 'x'));
    assert.notEqual(verdictPrompt('Is it finished?', 'x'), verdictPrompt('Is it finished?', 'y'));

    // Whatever comes back that is not one of the three reads as MAYBE, never as "no" (§6.6).
    assert.equal(readVerdict('YES'), 'yes');
    assert.equal(readVerdict('probably not'), 'maybe');
    assert.equal(readVerdict(null), 'maybe');
    assert.equal(readVerdict(undefined), 'maybe');

    // A farm that refuses is an error on the box, not a silent "no" down a branch.
    const refusing = { json: async () => ({ ok: false, error: { kind: 'busy' } }) };
    await assert.rejects(
      () => condition.run({ part, inputs: feed(valueOf('text', 'x')), ask: refusing }),
      (/** @type {any} */ err) => err.reason === 'busy',
      'a busy farm travels up as a CONTROL failure, never as a verdict',
    );
    await assert.rejects(
      () => condition.run({ part, inputs: feed(valueOf('text', 'x')), ask: null }),
      (/** @type {any} */ err) => err.reason === 'no-farm',
    );
  });

  test('Toggle: off BARS and still publishes — the rule the whole phase rests on (§4.5)', async () => {
    const value = valueOf('text', 'carried');
    const on = await toggle.run({ part: { id: 't1', settings: { on: true } }, inputs: feed(value) });
    assert.deepEqual(on, { value, bar: false });
    const off = await toggle.run({ part: { id: 't1', settings: { on: false } }, inputs: feed(value) });
    assert.equal(off.bar, true, 'off refuses to ACTIVATE what comes next');
    assert.equal(off.value, value, 'and the value flows anyway, untouched');
    assert.equal(passthrough({}).kind, 'text', 'nothing wired is an empty text, not a failure');
    assert.equal(toggle.output, 'any', 'a control passes its input through, whatever kind it was');
  });

  test('Button: manual, and a wave that reaches it unpressed stops there (§6.6)', async () => {
    clearPresses();
    assert.equal(button.manual, true, 'Run-all must never press it');
    // Unwired: the press IS the value, and there is nothing to hold back.
    const bare = await button.run({ part: { id: 'b1', settings: {} }, inputs: feed() });
    assert.equal(bare.bar, false);
    assert.deepEqual(bare.value.data, { pressed: true });

    // Fed, unpressed: the wave stops, the value flows, and the box says it is ready.
    const value = valueOf('text', 'expensive');
    const held = await button.run({ part: { id: 'b1', settings: {} }, inputs: feed(value) });
    assert.equal(held.bar, true, 'the manual gate that makes an expensive branch safe');
    assert.equal(held.value, value);
    assert.equal(isReady('b1'), true, '…and the box knows to say "ready — click to continue"');

    // Fed, pressed: the wave carries on, and the press is SPENT — the next wave waits again.
    notePress('b1');
    assert.equal(isReady('b1'), false, 'a press clears the held state the moment it happens');
    const go = await button.run({ part: { id: 'b1', settings: {} }, inputs: feed(value) });
    assert.equal(go.bar, false);
    assert.equal(consumePress('b1'), false, 'the press was consumed by the activation it authorised');
    const again = await button.run({ part: { id: 'b1', settings: {} }, inputs: feed(value) });
    assert.equal(again.bar, true, 'one press, one wave');
    clearPresses();
  });

  test('Dialog: a stored answer satisfies it, unless it asks every run (§6.6)', async () => {
    cancelAll();
    assert.equal(dialog.volatile, false, 'the STATIC flag is false; the per-box answer is volatileFor');
    assert.equal(dialog.volatileFor({ settings: { askEveryRun: false } }), false,
      'askEveryRun:false — a done Dialog is simply not in the run set, and needs no new machinery');
    assert.equal(dialog.volatileFor({ settings: { askEveryRun: true } }), true,
      'askEveryRun:true — never satisfied by a stored value');
    assert.equal(asksEveryRun({ settings: {} }), false);
    assert.equal(fallbackOf({ settings: { default: 'nobody answered' } }), 'nobody answered');

    // It parks rather than blocking: the outcome is `{park, settle}`, and the run loop is free.
    const part = { id: 'd1', settings: { question: 'Which door?', default: 'left' } };
    const out = await dialog.run({ part, signal: null });
    assert.equal(out.park.kind, 'dialog');
    assert.equal(out.park.question, 'Which door?');
    assert.equal(isParked('d1'), true);
    assert.equal(answer('d1', { ok: true, text: 'the red one' }), true);
    const settled = await out.settle;
    assert.equal(settled.bar, false);
    assert.equal(settled.value.data, 'the red one');

    // Cancelled: the default flows and the branch stops. Never an error — a person declining is
    // not a failure (§6.6).
    const two = await dialog.run({ part, signal: null });
    answer('d1', { ok: false, cancelled: true });
    const stopped = await two.settle;
    assert.equal(stopped.bar, true);
    assert.equal(stopped.value.data, 'left', 'the value still flows: it is the declared default');
    cancelAll();
  });

  test('Confirm: OK continues, Cancel stops THIS branch, a timeout says it timed out (§6.6)', async () => {
    cancelAll();
    const value = valueOf('text', 'the thing to confirm');
    const part = { id: 'k1', settings: { message: 'Send it?' } };

    const ok = await confirm.run({ part, inputs: feed(value), signal: null });
    assert.equal(ok.park.kind, 'confirm');
    assert.equal(ok.park.question, 'Send it?');
    answer('k1', { ok: true });
    assert.deepEqual(await ok.settle, { value, bar: false });
    assert.equal(lastOutcome('k1'), '', 'an accepted Confirm has nothing to report');

    const no = await confirm.run({ part, inputs: feed(value), signal: null });
    answer('k1', { ok: false });
    const stopped = await no.settle;
    assert.equal(stopped.bar, true);
    assert.equal(stopped.value, value, 'Cancel refuses the activation and keeps the value (§4.5)');
    assert.equal(lastOutcome('k1'), 'cancelled', 'and the box says a person stopped it');

    const timed = await confirm.run({ part, inputs: feed(value), signal: null });
    answer('k1', { ok: false, timeout: true });
    assert.equal((await timed.settle).bar, true);
    assert.equal(lastOutcome('k1'), 'timeout', 'a timeout counts as Cancel AND SAYS SO');
    cancelAll();
  });

  test('Timer clamps, and says what it will cost the wall clock before it runs (§4.6)', async () => {
    assert.equal(secondsOf({}), 3, 'the default');
    assert.equal(secondsOf({ seconds: 0 }), MIN_SECONDS, 'never zero — that is not a wait');
    assert.equal(secondsOf({ seconds: 99999 }), MAX_SECONDS);
    assert.equal(secondsOf({ seconds: 'x' }), 3);
    assert.equal(repeatsOf({}), 1, 'the default is ONE — there is no "forever"');
    assert.equal(repeatsOf({ repeats: 0 }), 1);
    assert.equal(repeatsOf({ repeats: 999 }), 8, 'clamped to maxIterations');
    assert.equal(repeatsOf({ repeats: 999 }, 100), 100, 'a run that raised it gets the raise');
    assert.equal(repeatsOf({ repeats: 2.9 }), 2, 'a fraction of a repeat is not a repeat');
    assert.equal(plannedWaitMs({ settings: { seconds: 2, repeats: 3 } }), 6000);
    assert.equal(plannedWaitMs({ settings: { seconds: 2, repeats: 999 } }), 16000,
      'the plan-time arithmetic uses the CLAMPED repeats, or it would refuse a run that cannot happen');

    // One activation is ONE wait: the part parks and passes through, and repeating what comes
    // after it is the run loop's business.
    cancelAll();
    const value = valueOf('text', 'tick');
    const out = await timer.run({ part: { id: 'm1', settings: { seconds: 0.1, repeats: 4 } }, inputs: feed(value), signal: null });
    assert.equal(out.park.kind, 'timer');
    assert.ok(typeof out.park.untilMs === 'number', 'a deadline the run bar can count down');
    const settled = await out.settle;                       // its own setTimeout answers it
    assert.deepEqual(settled, { value, bar: false });
    cancelAll();
  });

  test('a self-wire is still refused — the one cycle that is never a loop (§4.6)', () => {
    const s = seed();
    let [doc, a] = place(s.doc, 'toggle', s.o);
    assert.equal(addWire(doc, { from: a, to: a, port: 'in' }, s.o).reason, 'self');
    assert.equal(doc.wires.length, 0, 'and nothing was added');
  });

  test('a cycle with no gate is refused `loop-ungated`, before a generation is spent (§4.6)', () => {
    const s = seed();
    let [doc, a] = place(s.doc, 'ask', s.o);
    let b; [doc, b] = place(doc, 'ask', s.o);
    doc = addWire(doc, { from: a, to: b, port: 'in' }, s.o).doc;
    const back = addWire(doc, { from: b, to: a, port: 'in' }, s.o);
    assert.equal(back.ok, false);
    assert.equal(back.reason, 'loop-ungated',
      'two Instructions feeding each other is exactly the runaway this refusal exists for');
    assert.equal(doc.wires.length, 1, 'a refused wire changes nothing');
    // A Note cannot gate either — being cheap is not the same as being able to stop.
    let n; [doc, n] = place(doc, 'note', s.o);
    doc = addWire(doc, { from: b, to: n, port: 'in' }, s.o).doc || doc;
    assert.equal(addWire(doc, { from: b, to: a, port: 'in' }, s.o).reason, 'loop-ungated');
  });

  test("the owner's lesson-11 loop is ACCEPTED, and its back edge is declared (§4.6)", () => {
    // state → Toggle → Instruction → state. The Toggle is what makes it legal, and the back edge
    // is what gives it its unit delay: `order()` runs on the graph WITHOUT it, so the loop head
    // never deadlocks waiting for a value it is supposed to produce.
    const s = seed();
    let [doc, state] = place(s.doc, 'collect', s.o);
    let tog; [doc, tog] = place(doc, 'toggle', s.o);
    let ins; [doc, ins] = place(doc, 'ask', s.o);
    doc = addWire(doc, { from: state, to: tog, port: 'in' }, s.o).doc;
    doc = addWire(doc, { from: tog, to: ins, port: 'in' }, s.o).doc;
    const closing = addWire(doc, { from: ins, to: state, port: 'items' }, s.o);
    assert.equal(closing.ok, true, 'a loop with something that can stop it is a graph we draw');
    assert.equal(closing.wire.back, true, 'and the closing edge is DECLARED, not inferred later');
    doc = closing.doc;

    assert.equal(doc.wires.filter((w) => w.back).length, 1, 'exactly one back edge');
    assert.equal(forwardEdges(doc).wires.length, 2, 'the forward graph is the doc minus that edge');
    assert.equal(order(doc).ok, false, 'the raw doc really is cyclic…');
    assert.equal(order(forwardEdges(doc)).ok, true, '…and the graph the scheduler orders is not');
    assert.ok(gatedLoop(doc, cycleFor(forwardEdges(doc), { from: ins, to: state }), specs),
      'the gate the refusal looked for is the Toggle, and it is IN the cycle');

    // A forward wire added AFTER the loop exists is still a forward wire: `cycleFor` walks the
    // forward graph, so an existing loop does not make every later edge look like a second one.
    let sink; [doc, sink] = place(doc, 'collect', s.o);
    const later = addWire(doc, { from: ins, to: sink, port: 'items' }, s.o);
    assert.equal(later.ok, true);
    assert.equal(later.wire.back, false);
  });

  test('a loop is legal only while its gate is IN it — and each of the six is a gate', () => {
    for (const gate of ['button', 'condition', 'confirm', 'dialog', 'toggle', 'timer']) {
      const s = seed();
      let [doc, a] = place(s.doc, 'ask', s.o);
      let g; [doc, g] = place(doc, gate, s.o);
      doc = addWire(doc, { from: a, to: g, port: 'in' }, s.o).doc;
      const closing = addWire(doc, { from: g, to: a, port: 'in' }, s.o);
      assert.equal(closing.ok, true, `${gate} must be able to gate a loop`);
      assert.equal(closing.wire.back, true);
      assert.equal(specs.get(gate).control, true, `${gate} declares control:true`);
      // Five pass their input through, so they declare `output:'any'` and `wireRefusal` skips the
      // outgoing kind check for them (KC-6). Dialog is the exception by design: what it publishes
      // is the ANSWER a human typed, which is text whatever arrived on its context port.
      assert.equal(specs.get(gate).output, gate === 'dialog' ? 'text' : 'any',
        `${gate} publishes what §6.6 says it publishes`);
    }
  });

  test('flipping a Toggle is a settings edit: it marks downstream stale and runs nothing', () => {
    const s = seed();
    let [doc, n] = place(s.doc, 'note', s.o);
    let tog; [doc, tog] = place(doc, 'toggle', s.o);
    let ins; [doc, ins] = place(doc, 'ask', s.o);
    doc = addWire(doc, { from: n, to: tog, port: 'in' }, s.o).doc;
    doc = addWire(doc, { from: tog, to: ins, port: 'in' }, s.o).doc;
    const done = { ...doc, parts: doc.parts.map((p) => ({ ...p, state: 'done', value: valueOf('text', 'x') })) };
    const after = setSettings(done, tog, { on: false }, s.o);
    const state = Object.fromEntries(after.parts.map((p) => [p.id, p.state]));
    assert.equal(state[tog], 'stale');
    assert.equal(state[ins], 'stale', 'what came after it must be re-decided');
    assert.equal(state[n], 'done', 'and what came BEFORE it is untouched — no generation is re-spent');
  });

  test('the park registry is the one seam between a control part, the runner and the canvas', async () => {
    cancelAll();
    assert.deepEqual(pending(), []);

    /** @type {any[]} */ const seen = [];
    const off = onParks((list) => seen.push(list.length));

    const a = park('p1', 'dialog', { question: 'Your answer?', now: () => 10 });
    const b = park('p2', 'confirm', { now: () => 20 });
    assert.equal(isParked('p1'), true);
    assert.deepEqual(pending().map((p) => p.partId), ['p1', 'p2'], 'oldest first');
    assert.equal(parkOf('p1').question, 'Your answer?');
    assert.equal(parkOf('nope'), null);

    assert.equal(answer('p1', { ok: true, text: 'hello' }), true);
    assert.deepEqual(await a.promise, { ok: true, text: 'hello' });
    assert.equal(isParked('p1'), false);
    assert.equal(answer('p1', { ok: true }), false, 'a stale click is answered honestly, not thrown');

    // Stop (§4.8) rejects every park — as an ANSWER, never a rejection: a cancelled Confirm is
    // not an error, and a rejected promise would reach the runner as a part that threw.
    assert.equal(cancelAll(), 1);
    assert.deepEqual(await b.promise, { ok: false, cancelled: true });
    off();
    assert.ok(seen.length >= 4, 'every change announced');
  });

  test('a second park on the same part cancels the first — a part cannot wait twice', async () => {
    cancelAll();
    const first = park('p1', 'confirm', {});
    park('p1', 'confirm', {});
    assert.deepEqual(await first.promise, { ok: false, cancelled: true });
    assert.equal(pending().length, 1);
    cancelAll();
  });

  test('Stop reaches a parked part: the settle resolves BARRED, and nothing throws (§4.8)', async () => {
    cancelAll();
    const ac = new AbortController();
    const d = await dialog.run({ part: { id: 'd9', settings: { question: 'wait for me' } }, signal: ac.signal });
    const k = await confirm.run({ part: { id: 'k9', settings: {} }, inputs: feed(valueOf('text', 'v')), signal: ac.signal });
    assert.equal(pending().length, 2, 'two questions waiting at once — the run bar counts them');
    ac.abort();
    assert.equal((await d.settle).bar, true);
    assert.equal((await k.settle).bar, true);
    assert.deepEqual(pending(), [], 'and nothing is left waiting behind the run');
  });
};
