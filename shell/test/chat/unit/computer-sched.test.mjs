// @ts-check
// K3-U1 (COMPUTER_PLAN §4, §7.3-§7.5, §11 K3-U1) — ONE scheduler, and the run journal.
//
// The runner is the one engine module whose whole value is in its INTERLEAVINGS, and K3 doubled
// them: push next to pull, a barrier that stops activation while the value still flows, a park that
// must NOT stop the other branches, a loop whose second pass has to cost real money, four ceilings,
// and a merge that arrives mid-run. An Electron scenario cannot reach any of that deliberately —
// everything the runner needs is injected, so the real module runs here, unchanged, in Node.
//
// The acceptance list this file owes (§11 K3-U1), in order below:
//   push, asserted by its PROPERTIES and not by a tautology, over 20 generated DAGs — (a) nothing
//   upstream of the seed runs unless the §4.2 prologue pulled it, and then exactly once and only
//   because it held no value; (b) a part reachable from the seed ONLY through a barred edge does
//   not run; (c) a `done` part inside the closure DOES re-run; (d) a `manual:true` part inside the
//   closure does NOT; (e) the prologue is idempotent · `cacheSalt` on iterations · a back edge with
//   no value contributes nothing · Run-all does not re-run an input-less `done` source and
//   `force:true` does · merge mid-run · `bar` · back edges and the unit delay · the four ceilings ·
//   a timer plan over `maxWallMs` refused AT PLAN TIME with the arithmetic · the journal.

import assert from 'node:assert/strict';

import { RUN_LIMITS } from '../../../renderer/chat/core/types.mjs';
import {
  MAX_EVENTS, MAX_RUNS, journalKey, ring, prune, resumable, createJournal,
} from '../../../renderer/chat/graph/journal.mjs';
import {
  order, forwardEdges, backEdges, cycleFor, gatedLoop, manualRoots, activeSet, unrunAncestors,
  loopParts, runPlan, GATE_TYPES,
} from '../../../renderer/chat/graph/topo.mjs';
import { createRunner } from '../../../renderer/chat/graph/runner.mjs';
import { partById } from '../../../renderer/chat/graph/model.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';
import { park, answer, cancelAll, pending } from '../../../renderer/chat/graph/parts/control-bus.mjs';

const text = (/** @type {string} */ s) => valueOf('text', s);

/** A tiny doc: parts and wires exactly as given, nothing normalised away.
 * @param {any[]} wires @param {any[]} [parts] */
function doc(wires, parts) {
  return {
    id: 'g1',
    threadId: null,
    title: '',
    createdAt: 0,
    updatedAt: 0,
    rev: 1,
    parts: (parts || [
      { id: 'a', type: 'note', state: 'idle', value: null },
      { id: 'b', type: 'ask', state: 'idle', value: null },
      { id: 'c', type: 'note', state: 'idle', value: null },
    ]).map((p) => ({
      x: 0, y: 0, w: 200, h: 100, settings: {}, error: null, stats: null, fanout: null, ...p,
    })),
    wires: wires.map((w, i) => ({ id: w.id || `w${i}`, port: 'in', ...w })),
    settings: {},
    view: { x: 0, y: 0, zoom: 1 },
  };
}

/** A session over a doc built by hand — the same doors the host gives the runner. */
function sessionOver(d, specs, { graphId = 'g1' } = {}) {
  let live = d;
  let openId = graphId;
  /** @type {any[]} */ const patches = [];
  return {
    specs,
    docId: () => openId,
    /** The library switching the surface to another graph, mid-run (§4.8). */
    swapDoc: (/** @type {string} */ id, /** @type {any} */ next) => { openId = id; if (next) live = next; },
    doc: () => live,
    thread: () => null,
    patchPart(id, fields) {
      patches.push({ ids: [id], fields });
      live = applyPatch(live, id, fields);
    },
    patchParts(list, fields) {
      patches.push({ ids: list.slice(), fields });
      for (const id of list) live = applyPatch(live, id, fields);
    },
    patches: () => patches,
    state: (id) => (partById(live, id) || {}).state,
    error: (id) => (partById(live, id) || {}).error,
    value: (id) => (partById(live, id) || {}).value,
    set: (id, fields) => { live = applyPatch(live, id, fields); },
  };
}

/** patchPart's whitelist, on a hand-built doc (model.mjs's own is asserted by graph-model). */
function applyPatch(d, id, fields) {
  return {
    ...d,
    parts: d.parts.map((p) => (p.id === id ? { ...p, ...fields } : p)),
  };
}

/** An ask spine that logs every call and caches by (prompt, salt), the way app/ask.mjs does — which
 * is what makes "a loop iteration is a new generation" measurable rather than asserted. */
function fakeApp(o = {}) {
  const kv = o.kv || {};
  /** @type {any[]} */ const log = [];
  /** @type {Map<string, any>} */ const cache = new Map();
  /** @type {any} */ const store = { ...(o.store || {}) };
  const call = async (/** @type {any} */ given) => {
    log.push(given);
    const key = JSON.stringify([given.prompt, given.cacheSalt === undefined ? null : given.cacheSalt]);
    if (given.cache !== false && cache.has(key)) return { ...cache.get(key), cached: true };
    const res = { ok: true, value: `answer:${given.prompt}`, usage: { total_tokens: 7 } };
    cache.set(key, res);
    return res;
  };
  return {
    now: () => Date.now(),
    repo: {
      kvGet: async (/** @type {string} */ k, /** @type {any} */ dflt) => {
        if (k in store) return store[k];
        return k in kv ? kv[k] : dflt;
      },
      kvSet: async (/** @type {string} */ k, /** @type {any} */ v) => { store[k] = v; },
    },
    store: () => store,
    log: () => log,
    ask: { text: call, json: call, mode: () => 'json', vision: () => 'unknown' },
  };
}

/** The part types these tests run. `runs` counts every ACTIVATION, which is what the ceilings and
 * the push properties are stated in. */
function testSpecs(o = {}) {
  /** @type {Map<string, number>} */ const runs = new Map();
  /** @type {any[]} */ const seen = [];
  const count = (/** @type {string} */ id) => runs.set(id, (runs.get(id) || 0) + 1);
  const port = { name: 'in', label: 'In', accepts: ['text'], many: true, required: false };
  const base = {
    // A free step: a source when nothing feeds it, a pass-through when something does.
    step: {
      type: 'step', label: 'Step', inputs: [port], output: 'text', thinks: false,
      size: { w: 200, h: 100 }, defaults: () => ({}),
      run: async (/** @type {any} */ input) => {
        count(input.part.id);
        seen.push({ id: input.part.id, iteration: input.iteration, n: (input.inputs.in || []).length });
        return text(`v:${input.part.id}:${input.iteration}`);
      },
    },
    // The thinking part: it really goes through `input.ask.text`, where the cap, the metering and
    // the salt live.
    ask: {
      type: 'ask', label: 'Ask', inputs: [port], output: 'text', thinks: true,
      size: { w: 200, h: 100 }, defaults: () => ({}),
      run: async (/** @type {any} */ input) => {
        count(input.part.id);
        seen.push({ id: input.part.id, iteration: input.iteration, n: (input.inputs.in || []).length });
        const res = await input.ask.text({ prompt: `p:${input.part.id}` });
        return text(String(res && res.value));
      },
    },
    // A gate: the `{value, bar}` outcome of §4.5. `settings.barAfter` passes n times, then bars.
    gate: {
      type: 'gate', label: 'Gate', inputs: [port], output: 'any', thinks: false, control: true,
      size: { w: 200, h: 100 }, defaults: () => ({ barAfter: 0 }),
      run: async (/** @type {any} */ input) => {
        count(input.part.id);
        const passes = Number(input.part.settings.barAfter) || 0;
        const value = (input.inputs.in || [])[0] || text(`gate:${input.part.id}`);
        return { value, bar: input.iteration > passes };
      },
    },
    // A part that SUSPENDS: the fourth PartOutcome shape, through the real park registry.
    asker: {
      type: 'asker', label: 'Asker', inputs: [port], output: 'text', thinks: false, control: true,
      size: { w: 200, h: 100 }, defaults: () => ({}),
      run: async (/** @type {any} */ input) => {
        count(input.part.id);
        const { request, promise } = park(input.part.id, 'dialog', { question: 'Which one?' });
        return { park: request, settle: promise.then((a) => (a && a.ok ? text(String(a.text || 'yes')) : { value: text('no'), bar: true })) };
      },
    },
    // An unpressed Button: `manual:true` keeps it out of every pull run.
    button: {
      type: 'button', label: 'Button', inputs: [port], output: 'any', thinks: false,
      control: true, manual: true, size: { w: 200, h: 100 }, defaults: () => ({}),
      run: async (/** @type {any} */ input) => { count(input.part.id); return text('pressed'); },
    },
    // A Timer, for the PLAN-TIME wall-clock refusal. It must never be reached by these tests.
    timer: {
      type: 'timer', label: 'Timer', inputs: [port], output: 'any', thinks: false, control: true,
      size: { w: 200, h: 100 }, defaults: () => ({ seconds: 3, repeats: 1 }),
      run: async (/** @type {any} */ input) => { count(input.part.id); return text('tick'); },
    },
    // A part that takes real wall clock, for `maxWallMs`.
    slow: {
      type: 'slow', label: 'Slow', inputs: [port], output: 'text', thinks: false,
      size: { w: 200, h: 100 }, defaults: () => ({}),
      run: async (/** @type {any} */ input) => {
        count(input.part.id);
        await new Promise((r) => { setTimeout(r, Number(input.part.settings.ms) || 12); });
        return text('slow');
      },
    },
    // A part whose completion the TEST decides: the merge cases need a run held open.
    held: {
      type: 'held', label: 'Held', inputs: [port], output: 'text', thinks: false,
      size: { w: 200, h: 100 }, defaults: () => ({}),
      run: async (/** @type {any} */ input) => {
        count(input.part.id);
        if (o.hold) await o.hold(input.part.id, runs.get(input.part.id));
        return text(`held:${runs.get(input.part.id)}`);
      },
    },
  };
  const map = new Map(Object.entries(base));
  /** @type {any} */ (map).runs = runs;
  /** @type {any} */ (map).seen = seen;
  /** @type {any} */ (map).ran = (/** @type {string} */ id) => runs.get(id) || 0;
  return map;
}

/** A deterministic PRNG, so "20 generated DAGs" is the same twenty every time this gate runs. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random DAG of `n` `step` parts: an edge only ever goes from a lower index to a higher one, so
 * it is a DAG by construction and the generator never has to reject one. */
function randomDag(rand, n) {
  /** @type {any[]} */ const parts = [];
  /** @type {any[]} */ const wires = [];
  for (let i = 0; i < n; i++) parts.push({ id: `p${i}`, type: 'step', state: 'idle', value: null });
  for (let to = 1; to < n; to++) {
    for (let from = 0; from < to; from++) {
      if (rand() < 0.35) wires.push({ id: `w${from}-${to}`, from: `p${from}`, to: `p${to}`, port: 'in' });
    }
  }
  return doc(wires, parts);
}

/** Everything that can reach `id` over the forward graph. */
function ancestorsOf(d, id) {
  const into = new Map(d.parts.map((p) => [p.id, []]));
  for (const w of d.wires) if (!w.back) /** @type {any} */ (into.get(w.to)).push(w.from);
  const out = new Set();
  const stack = [id];
  while (stack.length) {
    const at = stack.pop();
    for (const from of into.get(at) || []) if (!out.has(from)) { out.add(from); stack.push(from); }
  }
  return out;
}

/** Everything reachable from `id`, optionally with one part's out-edges CUT. */
function reachableFrom(d, id, cut) {
  const outMap = new Map(d.parts.map((p) => [p.id, []]));
  for (const w of d.wires) if (!w.back && w.from !== cut) /** @type {any} */ (outMap.get(w.from)).push(w.to);
  const out = new Set();
  const stack = [id];
  while (stack.length) {
    const at = stack.pop();
    for (const to of outMap.get(at) || []) if (!out.has(to)) { out.add(to); stack.push(to); }
  }
  return out;
}

export default (test) => {
  // -------------------------------------------------------------------------------------------
  // The seams, frozen at the kickoff. They are cross-unit, so they are asserted first.
  // -------------------------------------------------------------------------------------------

  test('the four ceilings are the frozen numbers (§4.6)', () => {
    assert.deepEqual({ ...RUN_LIMITS }, {
      maxIterations: 8, maxGenerations: 50, maxWallMs: 600000, maxActivations: 2000,
    });
    // The arithmetic coincidence §4.6 asks builders to notice: 8 × 250 parts = 2000 exactly.
    assert.equal(RUN_LIMITS.maxIterations * 250, RUN_LIMITS.maxActivations);
  });

  test('forwardEdges/backEdges split the graph the way order() needs (§4.6)', () => {
    const d = doc([
      { id: 'w1', from: 'a', to: 'b', port: 'in' },
      { id: 'w2', from: 'b', to: 'c', port: 'in' },
      { id: 'w3', from: 'c', to: 'a', port: 'in', back: true },
    ]);
    assert.deepEqual(forwardEdges(d).wires.map((w) => w.id), ['w1', 'w2']);
    assert.deepEqual(backEdges(d).map((w) => w.id), ['w3']);
    // A doc with no back edge is returned UNCHANGED, not copied: `order()` runs every iteration
    // of the loop (§4.3) and must not allocate a document per part on a plain DAG.
    const plain = doc([{ id: 'w1', from: 'a', to: 'b', port: 'in' }]);
    assert.equal(forwardEdges(plain), plain);
    // And the loop is ORDERABLE: `order()` ignores the back edge, so a loop head never waits.
    assert.equal(order(forwardEdges(d)).ok, true);
    assert.deepEqual(order(forwardEdges(d)).ids, ['a', 'b', 'c']);
    assert.equal(order(d).ok, false, 'the RAW doc really is cyclic — the split is what saves it');
  });

  test('cycleFor names the loop an edge would close, over the FORWARD graph only', () => {
    const d = doc([
      { id: 'w1', from: 'a', to: 'b', port: 'in' },
      { id: 'w2', from: 'b', to: 'c', port: 'in' },
    ]);
    assert.deepEqual(cycleFor(d, { from: 'c', to: 'a' }), ['a', 'b', 'c', 'a']);
    assert.equal(cycleFor(d, { from: 'a', to: 'c' }), null, 'a forward edge closes nothing');
    assert.deepEqual(cycleFor(d, { from: 'a', to: 'a' }), ['a', 'a'], 'a self-wire is its own cycle');
  });

  test('loopParts is exactly the walk each back edge closes (§4.6)', () => {
    const d = doc([
      { id: 'w1', from: 'a', to: 'b', port: 'in' },
      { id: 'w2', from: 'b', to: 'c', port: 'in' },
      { id: 'w3', from: 'b', to: 'a', port: 'in', back: true },
    ]);
    assert.deepEqual(loopParts(d), ['a', 'b'], 'c is downstream of the loop, not on it');
    assert.deepEqual(loopParts(doc([{ from: 'a', to: 'b' }])), [], 'no back edge, no loop');
  });

  test('a loop needs a gate, and a gate is a type OR a declaration (§4.6)', () => {
    const d = doc([], [
      { id: 'a', type: 'note' }, { id: 'b', type: 'ask' }, { id: 'c', type: 'toggle' },
    ]);
    assert.equal(gatedLoop(d, ['a', 'b', 'a']), false, 'two data parts cannot stop themselves');
    assert.equal(gatedLoop(d, ['a', 'c', 'a']), true, 'a Toggle in the cycle is the gate');
    assert.deepEqual([...GATE_TYPES].sort(),
      ['button', 'condition', 'confirm', 'dialog', 'timer', 'toggle']);
    // A part type added later is a gate by DECLARING itself one, not by joining the list.
    const specs = new Map([['note', { control: true }]]);
    assert.equal(gatedLoop(d, ['a', 'b', 'a'], specs), true);
  });

  test('manualRoots is exactly the specs that declare it (§4.2)', () => {
    const d = doc([], [
      { id: 'a', type: 'button', state: 'idle', value: null },
      { id: 'b', type: 'note', state: 'idle', value: null },
    ]);
    const specs = new Map([['button', { manual: true }], ['note', {}]]);
    assert.deepEqual(manualRoots(d, specs), ['a']);
    assert.deepEqual(activeSet(d, [], { mode: 'all', specs }), ['b'],
      'a mode:all run never places an unpressed Button in A');
    assert.deepEqual(activeSet(d, ['a'], { mode: 'from', specs }), ['a'],
      'but a ▶ ON the Button is exactly how a Button runs');
  });

  // -------------------------------------------------------------------------------------------
  // PUSH, asserted by its properties over 20 generated DAGs (§11 K3-U1, revision 2).
  // -------------------------------------------------------------------------------------------

  test('push over 20 generated DAGs: the five properties of §4.2 hold on every one', async () => {
    const rand = rng(20260923);
    for (let trial = 0; trial < 20; trial++) {
      const n = 4 + Math.floor(rand() * 5);
      const base = randomDag(rand, n);
      // One part in the middle is an unpressed Button: property (d).
      // Never the seed itself: pressing ▶ ON a Button is how a Button runs (§4.2).
      const manualId = `p${1 + Math.floor(rand() * (n - 2))}`;
      const d0 = {
        ...base,
        parts: base.parts.map((p) => (p.id === manualId
          ? { ...p, type: 'button', state: 'done', value: text('pressed-earlier') }
          : p)),
      };
      const specs = testSpecs();
      const session = sessionOver(d0, specs);
      const runner = createRunner({ session, app: fakeApp() });

      // 1. A cold Run-all warms the whole graph.
      await runner.run({});
      // 2. Some ancestors lose their value — a fresh import, a crash, a part never run.
      const seed = `p${n - 1}`;
      const ancestors = ancestorsOf(d0, seed);
      /** @type {Set<string>} */ const emptied = new Set();
      for (const id of ancestors) {
        if (id === manualId) continue;
        if (rand() < 0.5) { emptied.add(id); session.set(id, { state: 'idle', value: null }); }
      }
      const before = new Map(specs.runs);
      const report = await runner.run({ mode: 'from', seeds: [seed] });
      const ranNow = (/** @type {string} */ id) => (specs.runs.get(id) || 0) - (before.get(id) || 0);

      const closure = new Set([seed, ...reachableFrom(d0, seed, null)]);
      // What §4.2 says the prologue must pull, computed from the TEST's own knowledge rather than
      // from `activeSet` — walk upstream through parts that hold no value, stopping at anything
      // that does (it is read, never re-run) and at the Button (never pressed on someone's behalf).
      /** @type {Set<string>} */ const mustPull = new Set();
      {
        const seenUp = new Set([seed]);
        const stack = [seed];
        while (stack.length) {
          const at = stack.pop();
          for (const w of d0.wires) {
            if (w.back || w.to !== at || seenUp.has(w.from)) continue;
            seenUp.add(w.from);
            if (w.from === manualId || !emptied.has(w.from)) continue;
            mustPull.add(w.from);
            stack.push(w.from);
          }
        }
      }
      for (const p of d0.parts) {
        const id = p.id;
        if (id === manualId) {
          // (d) a `manual:true` part inside the closure does NOT run.
          assert.equal(ranNow(id), 0, `trial ${trial}: the Button ran without being pressed`);
          continue;
        }
        if (closure.has(id)) {
          // (c) a `done` part inside the closure DOES re-run — ▶ means "do this again".
          assert.equal(ranNow(id), 1, `trial ${trial}: ${id} is in the closure and ran ${ranNow(id)}×`);
          continue;
        }
        if (ancestors.has(id)) {
          // (a) nothing upstream runs UNLESS the prologue pulled it, and then exactly once and
          //     only because it held no value.
          if (mustPull.has(id)) {
            assert.equal(ranNow(id), 1, `trial ${trial}: the prologue must pull ${id} exactly once`);
          } else {
            assert.equal(ranNow(id), 0,
              `trial ${trial}: ${id} is upstream but nothing had to pull it (it holds a value, or`
              + ' only reaches the seed through one that does)');
          }
          continue;
        }
        assert.equal(ranNow(id), 0, `trial ${trial}: ${id} is neither upstream nor downstream`);
      }
      assert.equal(report.mode, 'from');
      assert.deepEqual(report.seeds, [seed]);

      // (e) the prologue is idempotent: a second ▶ on the now-warm graph pulls NOTHING.
      assert.deepEqual(unrunAncestors(session.doc(), [seed], { specs }), [],
        `trial ${trial}: a warm graph must have no unrun ancestors`);
      const before2 = new Map(specs.runs);
      await runner.run({ mode: 'from', seeds: [seed] });
      for (const id of ancestors) {
        if (id === manualId || closure.has(id)) continue;
        assert.equal((specs.runs.get(id) || 0) - (before2.get(id) || 0), 0,
          `trial ${trial}: the second ▶ pulled ${id} again`);
      }

      // (b) a part reachable from the seed ONLY through a barred edge does not run.
      const kids = d0.wires.filter((w) => w.from === seed).map((w) => w.to);
      if (!kids.length) continue;
      const gateId = kids[0];
      const withGate = {
        ...session.doc(),
        parts: session.doc().parts.map((p) => (p.id === gateId
          ? { ...p, type: 'gate', settings: { barAfter: 0 }, state: 'stale' } : p)),
      };
      const specs2 = testSpecs();
      const session2 = sessionOver(withGate, specs2);
      const runner2 = createRunner({ session: session2, app: fakeApp() });
      await runner2.run({ mode: 'from', seeds: [seed] });
      const viaGateOnly = [...reachableFrom(withGate, seed, null)]
        .filter((id) => id !== gateId && !reachableFrom(withGate, seed, gateId).has(id));
      for (const id of viaGateOnly) {
        assert.equal(specs2.ran(id), 0, `trial ${trial}: ${id} is only reachable through a barred gate`);
        assert.equal(session2.state(id), 'stale', 'a barred part is stale, never error');
      }
    }
  });

  // -------------------------------------------------------------------------------------------
  // Loops: the unit delay, the salt, and what iteration 1 is allowed to be missing.
  // -------------------------------------------------------------------------------------------

  /** The shipped loop shape: a source, a thinking part, and a gate that closes the cycle. */
  function loopGraph({ barAfter = 99 } = {}) {
    return doc([
      { id: 'w1', from: 'src', to: 'think', port: 'in' },
      { id: 'w2', from: 'think', to: 'gate', port: 'in' },
      { id: 'w3', from: 'gate', to: 'think', port: 'in', back: true },
    ], [
      { id: 'src', type: 'step', state: 'idle', value: null },
      { id: 'think', type: 'ask', state: 'idle', value: null },
      { id: 'gate', type: 'gate', state: 'idle', value: null, settings: { barAfter } },
    ]);
  }

  test('a back edge with no value contributes nothing, and the unit delay is the previous pass', async () => {
    const specs = testSpecs();
    const session = sessionOver(loopGraph({ barAfter: 2 }), specs);
    const runner = createRunner({ session, app: fakeApp() });
    const report = await runner.run({});
    assert.equal(report.errors.length, 0, 'iteration 1 of a loop is not an error (§4.6, frozen)');
    const passes = /** @type {any} */ (specs).seen.filter((s) => s.id === 'think');
    assert.equal(passes.length, 3, 'the gate passed twice, so the head ran three times');
    assert.deepEqual(passes.map((p) => p.iteration), [1, 2, 3]);
    assert.equal(passes[0].n, 1, 'iteration 1 sees ONLY its forward input — the back edge is skipped');
    assert.equal(passes[1].n, 2, 'iteration 2 reads the loop-carried value: the unit delay');
    assert.equal(session.state('think'), 'done');
    assert.equal(session.state('gate'), 'done', 'a gate that barred still COMPLETED and published');
  });

  test('a loop iteration is a new generation: cacheSalt is the iteration, and it reaches the cap', async () => {
    const specs = testSpecs();
    const session = sessionOver(loopGraph(), specs);
    const app = fakeApp();
    const runner = createRunner({ session, app });
    const report = await runner.run({ maxItems: 3 });
    const calls = app.log();
    assert.equal(calls.length, 3, 'three real calls, then the cap refused the fourth');
    assert.equal(calls[0].cacheSalt, undefined, 'iteration 1 is UNSALTED — re-running a settled graph is free');
    assert.equal(calls[1].cacheSalt, 2, 'iteration 2 is a real second generation');
    assert.equal(calls[2].cacheSalt, 3);
    assert.equal(report.generations, 3, 'the salt is what lets a loop reach maxGenerations at all');
    assert.deepEqual(report.capped, { cap: 3, spent: 3, stopped: 1 });
    assert.equal(report.limited.ceiling, 'maxGenerations');
    assert.equal(report.limited.partId, 'think', 'and the ceiling NAMES the part it stopped');
    assert.equal(report.limited.raiseTo, 6);
  });

  test('re-running a SETTLED graph is still near-free: iteration 1 hits the ask cache', async () => {
    const specs = testSpecs();
    const session = sessionOver(loopGraph({ barAfter: 0 }), specs);
    const app = fakeApp();
    const runner = createRunner({ session, app });
    await runner.run({});
    assert.equal(app.log().length, 1);
    const again = await runner.run({ force: true });
    assert.equal(again.generations, 0, 'the second Run paid for nothing');
    assert.equal(app.log().length, 2, 'it asked, and the ask spine answered from the cache');
  });

  // -------------------------------------------------------------------------------------------
  // Pull: what Run-all may and may not re-run.
  // -------------------------------------------------------------------------------------------

  test('Run-all does not re-run an input-less `done` source; force:true does; manual is never in A', async () => {
    const specs = testSpecs();
    const d = doc([{ from: 'src', to: 'out', port: 'in' }, { from: 'btn', to: 'out', port: 'in' }], [
      { id: 'src', type: 'step', state: 'done', value: text('warm') },
      { id: 'btn', type: 'button', state: 'done', value: text('pressed') },
      { id: 'out', type: 'step', state: 'stale', value: null },
    ]);
    const session = sessionOver(d, specs);
    const runner = createRunner({ session, app: fakeApp() });
    await runner.run({});
    assert.equal(specs.ran('src'), 0, 'a done source with no inputs stays done');
    assert.equal(specs.ran('btn'), 0, 'and an unpressed Button is never in A');
    assert.equal(specs.ran('out'), 1, 'the stale part is what Run-all is for');
    await runner.run({ force: true });
    assert.equal(specs.ran('src'), 1, 'shift-Run runs EVERYTHING…');
    assert.equal(specs.ran('btn'), 0, '…except the parts only a human may start');
  });

  test('a volatile part is never satisfied by its stored value (Dialog askEveryRun)', () => {
    const specs = new Map([
      ['note', {}],
      ['dlg', { volatileFor: (/** @type {any} */ p) => !!p.settings.askEveryRun }],
    ]);
    const d = doc([], [
      { id: 'n', type: 'note', state: 'done', value: text('x') },
      { id: 'keeps', type: 'dlg', state: 'done', value: text('x'), settings: {} },
      { id: 'asks', type: 'dlg', state: 'done', value: text('x'), settings: { askEveryRun: true } },
    ]);
    assert.deepEqual(activeSet(d, [], { mode: 'all', specs }), ['asks']);
  });

  // -------------------------------------------------------------------------------------------
  // Barriers (§4.5): activation stops, the value does not.
  // -------------------------------------------------------------------------------------------

  test('a part reachable by a SECOND, unbarred path keeps running — and reads through the gate', async () => {
    const specs = testSpecs();
    const d = doc([
      { from: 'src', to: 'gate', port: 'in' },
      { from: 'gate', to: 'both', port: 'in' },
      { from: 'src', to: 'both', port: 'in' },
      { from: 'gate', to: 'only', port: 'in' },
    ], [
      { id: 'src', type: 'step', state: 'idle', value: null },
      { id: 'gate', type: 'gate', state: 'idle', value: null, settings: { barAfter: 0 } },
      { id: 'both', type: 'step', state: 'idle', value: null },
      { id: 'only', type: 'step', state: 'idle', value: null },
    ]);
    const session = sessionOver(d, specs);
    const runner = createRunner({ session, app: fakeApp() });
    const report = await runner.run({});
    assert.equal(specs.ran('only'), 0, 'the branch behind the gate stopped');
    assert.equal(session.state('only'), 'stale', 'barred is STALE, never error and never idle');
    assert.equal(session.error('only'), null);
    assert.equal(specs.ran('both'), 1, 'the second, unbarred path keeps running');
    const sawBoth = /** @type {any} */ (specs).seen.find((s) => s.id === 'both');
    assert.equal(sawBoth.n, 2, 'and gather() read STRAIGHT THROUGH the barred gate: two arrivals');
    assert.deepEqual(report.barred, ['only']);
    assert.equal(report.errors.length, 0, 'a gate is not a failure');
  });

  // -------------------------------------------------------------------------------------------
  // Parks (§4.3): a question never stops the other branches.
  // -------------------------------------------------------------------------------------------

  test('a parked part goes `waiting` and the OTHER branch keeps running', async () => {
    cancelAll();
    const specs = testSpecs();
    const d = doc([{ from: 'q', to: 'after', port: 'in' }], [
      { id: 'q', type: 'asker', state: 'idle', value: null },
      { id: 'after', type: 'step', state: 'idle', value: null },
      { id: 'other', type: 'step', state: 'idle', value: null },
    ]);
    const session = sessionOver(d, specs);
    const runner = createRunner({ session, app: fakeApp() });
    const running = runner.run({});
    // Let the loop reach the park and move on to the independent branch.
    await new Promise((r) => { setTimeout(r, 30); });
    assert.equal(session.state('q'), 'waiting', 'the parked part says so');
    assert.equal(specs.ran('other'), 1, 'and the branch that could run, ran');
    assert.equal(specs.ran('after'), 0, 'while its own downstream waited');
    assert.equal(answer('q', { ok: true, text: 'because' }), true);
    const report = await running;
    assert.equal(report.waited, 1);
    assert.equal(session.state('q'), 'done');
    assert.equal(specs.ran('after'), 1, 'the answer released the branch behind it');
  });

  test('Stop rejects every park, and everything unfinished comes back stale with its value kept', async () => {
    cancelAll();
    const specs = testSpecs();
    const d = doc([{ from: 'q', to: 'after', port: 'in' }], [
      { id: 'src', type: 'step', state: 'idle', value: null },
      { id: 'q', type: 'asker', state: 'idle', value: null },
      { id: 'after', type: 'step', state: 'idle', value: null },
    ]);
    const session = sessionOver(d, specs);
    const runner = createRunner({ session, app: fakeApp() });
    const running = runner.run({});
    await new Promise((r) => { setTimeout(r, 30); });
    assert.equal(session.state('q'), 'waiting');
    runner.stop();
    const report = await running;
    assert.equal(report.cancelled, true);
    assert.equal(session.state('after'), 'stale');
    assert.equal(session.value('src').data, 'v:src:1', 'the finished value is KEPT (§4.8)');
    assert.equal(specs.ran('after'), 0);
  });

  test('a run that ends on a ceiling with a branch parked does NOT leave the question behind', async () => {
    cancelAll();
    const specs = testSpecs();
    const d = doc([{ from: 'q', to: 'after', port: 'in' }], [
      { id: 'q', type: 'asker', state: 'idle', value: null },
      { id: 'after', type: 'step', state: 'idle', value: null },
    ]);
    const session = sessionOver(d, specs);
    const runner = createRunner({ session, app: fakeApp() });
    const report = await runner.run({ limits: { maxWallMs: 40 } });
    assert.equal(report.limited.ceiling, 'maxWallMs');
    assert.equal(runner.running(), false);
    // THE BUG THIS GUARDS (K3 fix pass): only `stop()` used to cancel parks, so a run that ended
    // on a ceiling, on the generation cap or on a cycle left the park registered. The run bar went
    // on counting "1 question waiting", the box went on painting the field and Send, and the
    // answer the person typed resolved a promise nobody was awaiting — their words vanished.
    assert.deepEqual(pending(), [], 'the park went with the run that owned it');
    assert.equal(answer('q', { ok: true, text: 'too late' }), false,
      'and a stale Send is told so rather than swallowed');
    assert.equal(session.state('q'), 'stale', 'the question comes back stale, and will ask again');
  });

  test('barring a parked branch rejects its park too — no question on a box the run cut', async () => {
    cancelAll();
    const specs = testSpecs();
    // `barrier` passes nothing on (barAfter:0 bars on iteration 1), so `q` — reachable ONLY through
    // it — is dropped while it is parked.
    const d = doc([
      { from: 'src', to: 'barrier', port: 'in' },
      { from: 'src', to: 'q', port: 'in' },
      { from: 'q', to: 'tail', port: 'in' },
      { from: 'barrier', to: 'q', port: 'in' },
    ], [
      { id: 'src', type: 'step', state: 'idle', value: null },
      { id: 'q', type: 'asker', state: 'idle', value: null },
      { id: 'barrier', type: 'gate', state: 'idle', value: null, settings: { barAfter: 0 } },
      { id: 'tail', type: 'step', state: 'idle', value: null },
    ]);
    const session = sessionOver(d, specs);
    const runner = createRunner({ session, app: fakeApp() });
    const report = await runner.run({ limits: { maxWallMs: 400 } });
    assert.ok(report, 'the run ended on its own');
    assert.deepEqual(pending(), [], 'nothing is still asking');
    cancelAll();
  });

  test('`executing()` is false while the run is merely PARKED, and true mid-activation', async () => {
    cancelAll();
    const specs = testSpecs();
    const d = doc([{ from: 'q', to: 'after', port: 'in' }], [
      { id: 'q', type: 'asker', state: 'idle', value: null },
      { id: 'after', type: 'slow', state: 'idle', value: null, settings: { ms: 60 } },
    ]);
    const session = sessionOver(d, specs);
    const runner = createRunner({ session, app: fakeApp() });
    assert.equal(typeof runner.executing, 'function', 'the runner answers §2.3 itself');
    assert.equal(runner.executing(), false, 'nothing runs before the run');
    const running = runner.run({ limits: { maxWallMs: 4000 } });
    await new Promise((r) => { setTimeout(r, 30); });
    assert.equal(session.state('q'), 'waiting');
    assert.equal(runner.running(), true, 'the run is alive');
    // THE RULE (§2.3): a Dialog nobody answers must NOT keep a hidden Computer's farm seat, nor
    // keep its sandbox awake, for the ten minutes of `maxWallMs`. `running()` cannot tell the
    // difference; this is the question the surface actually asks.
    assert.equal(runner.executing(), false, 'a parked run is executing nothing');
    assert.equal(answer('q', { ok: true, text: 'go' }), true);
    await new Promise((r) => { setTimeout(r, 20); });
    assert.equal(runner.executing(), true, 'and the activation it released IS in flight');
    const report = await running;
    assert.equal(report.waited, 1);
    assert.equal(runner.executing(), false, 'and false again once the run is over');
  });

  test('a run whose document is swapped out stops writing into the graph that replaced it', async () => {
    /** @type {() => void} */ let release = () => {};
    const specs = testSpecs({ hold: () => new Promise((r) => { release = () => r(undefined); }) });
    const d = doc([{ from: 'a', to: 'b', port: 'in' }], [
      { id: 'a', type: 'held', state: 'idle', value: null },
      { id: 'b', type: 'step', state: 'idle', value: null },
    ]);
    const session = sessionOver(d, specs);
    const runner = createRunner({ session, app: fakeApp() });
    const running = runner.run({});
    await new Promise((r) => { setTimeout(r, 20); });
    // The library opens ANOTHER graph. Same ids, different boxes — which is exactly why a run that
    // went on marking would paint states onto parts nobody asked it about (K3 fix pass).
    const other = doc([], [
      { id: 'a', type: 'step', state: 'idle', value: null },
      { id: 'b', type: 'step', state: 'idle', value: null },
    ]);
    session.swapDoc('g2', other);
    runner.stop();
    release();
    await running;
    assert.equal(session.state('a'), 'idle', 'the new document was not touched');
    assert.equal(session.state('b'), 'idle');
  });

  // -------------------------------------------------------------------------------------------
  // Merge (§4.4): the user's press is never swallowed.
  // -------------------------------------------------------------------------------------------

  test('a ▶ pressed mid-run MERGES: behind the cursor, already completed, or still running', async () => {
    /** @type {Map<string, () => void>} */ const gates = new Map();
    const waitFor = (id) => new Promise((resolve) => { gates.set(id, () => resolve(undefined)); });
    const specs = testSpecs({ hold: (id, n) => (id === 'slow' && n === 1 ? waitFor('slow') : null) });
    const d = doc([{ from: 'other', to: 'kid', port: 'in' }], [
      { id: 'slow', type: 'held', state: 'idle', value: null },
      { id: 'other', type: 'step', state: 'idle', value: null },
      { id: 'kid', type: 'step', state: 'idle', value: null },
    ]);
    const session = sessionOver(d, specs);
    const runner = createRunner({ session, app: fakeApp() });
    const running = runner.run({ mode: 'from', seeds: ['slow'] });
    await new Promise((r) => { setTimeout(r, 20); });
    assert.equal(session.state('slow'), 'running');
    // A seed the run never had: it JOINS, with its own downstream.
    const joined = runner.addToRun(['other']);
    assert.equal(joined, 2, 'the merged seed brought its closure with it');
    // And the part that is running right now: re-queued on completion, never swallowed.
    assert.equal(runner.addToRun(['slow']), 1);
    /** @type {any} */ (gates.get('slow'))();
    const report = await running;
    assert.equal(report.merged, 3);
    assert.equal(specs.ran('other'), 1, 'the merged branch really ran');
    assert.equal(specs.ran('kid'), 1);
    assert.equal(specs.ran('slow'), 2, 'the press on a RUNNING part re-ran it, rather than being lost');
    assert.equal(session.state('slow'), 'done');
  });

  test('addToRun between runs is 0, and a second mode:all is still a refusal', async () => {
    const specs = testSpecs();
    const session = sessionOver(doc([], [{ id: 'a', type: 'step', state: 'idle', value: null }]), specs);
    const runner = createRunner({ session, app: fakeApp() });
    assert.equal(runner.addToRun(['a']), 0, 'no run, nothing to merge into');
    const first = runner.run({});
    const second = await runner.run({});
    assert.equal(second.busy, true, 'a second Run-all is a refusal, not a fabricated cancel');
    await first;
  });

  // -------------------------------------------------------------------------------------------
  // The four ceilings (§4.6): every one a STOP, every one naming its part, every one raisable.
  // -------------------------------------------------------------------------------------------

  test('maxIterations stops a spinning loop, names the part, and is raisable for that run', async () => {
    const specs = testSpecs();
    const session = sessionOver(loopGraph(), specs);
    const runner = createRunner({ session, app: fakeApp() });
    const report = await runner.run({ limits: { maxIterations: 3 } });
    assert.equal(report.limited.ceiling, 'maxIterations');
    assert.equal(report.limited.partId, 'think');
    assert.equal(report.limited.limit, 3);
    assert.equal(report.limited.raiseTo, 6, 'and what raising it has to reach');
    assert.equal(specs.ran('think'), 3, 'three passes, and the fourth was refused before it ran');
    assert.equal(session.state('think'), 'stale', 'a ceiling is a STOP: stale, not error');
    assert.equal(report.errors.length, 0);
    assert.equal(report.iterations.think, 3, 'and the report says how far each part got');
    const raised = await runner.run({ limits: { maxIterations: report.limited.raiseTo } });
    assert.equal(raised.iterations.think, 6, 'the raise really applies to the next run');
  });

  test('maxActivations stops a graph of many small loops, and names where it stopped', async () => {
    const specs = testSpecs();
    const parts = [];
    for (let i = 0; i < 6; i++) parts.push({ id: `p${i}`, type: 'step', state: 'idle', value: null });
    const session = sessionOver(doc([], parts), specs);
    const runner = createRunner({ session, app: fakeApp() });
    const report = await runner.run({ limits: { maxActivations: 2 } });
    assert.equal(report.limited.ceiling, 'maxActivations');
    assert.equal(report.limited.limit, 2);
    assert.equal(report.limited.partId, 'p2', 'the part that would have been the third');
    assert.equal(report.activations, 2);
    assert.equal(session.state('p2'), 'stale');
  });

  test('maxWallMs stops a run of FREE parts that grinds, parked time included', async () => {
    const specs = testSpecs();
    const parts = [];
    for (let i = 0; i < 6; i++) parts.push({ id: `p${i}`, type: 'slow', state: 'idle', value: null, settings: { ms: 12 } });
    const session = sessionOver(doc([], parts), specs);
    const runner = createRunner({ session, app: fakeApp() });
    const report = await runner.run({ limits: { maxWallMs: 20 } });
    assert.equal(report.limited.ceiling, 'maxWallMs');
    assert.equal(report.limited.limit, 20);
    assert.ok(report.limited.reached >= 20, 'and says how long it really took');
    assert.ok(report.activations < 6, 'it stopped short');
    assert.equal(report.errors.length, 0, 'a ceiling is never an error');
  });

  test('an unanswered question ends the run at maxWallMs rather than waiting for ever', async () => {
    cancelAll();
    const specs = testSpecs();
    const d = doc([], [{ id: 'q', type: 'asker', state: 'idle', value: null }]);
    const session = sessionOver(d, specs);
    const runner = createRunner({ session, app: fakeApp() });
    const report = await runner.run({ limits: { maxWallMs: 40 } });
    assert.equal(report.limited.ceiling, 'maxWallMs');
    assert.equal(report.limited.partId, 'q', 'and it names the question nobody answered');
    assert.equal(session.state('q'), 'stale');
    cancelAll();
  });

  test('a timer plan longer than maxWallMs is refused AT PLAN TIME, with the arithmetic', async () => {
    const specs = testSpecs();
    const d = doc([], [
      { id: 't1', type: 'timer', state: 'idle', value: null, settings: { seconds: 400, repeats: 1 } },
      { id: 't2', type: 'timer', state: 'idle', value: null, settings: { seconds: 400, repeats: 1 } },
    ]);
    const session = sessionOver(d, specs);
    const runner = createRunner({ session, app: fakeApp() });
    const report = await runner.run({});
    assert.equal(report.limited.ceiling, 'maxWallMs');
    assert.equal(report.limited.planned, true, 'refused BEFORE anything ran');
    assert.equal(report.limited.reached, 800000, 'the arithmetic: 400 s + 400 s');
    assert.equal(report.limited.limit, RUN_LIMITS.maxWallMs);
    assert.equal(report.limited.raiseTo, 1200000, 'and raising it doubles the limit, which clears 800 s');
    assert.equal(report.ran, 0);
    assert.equal(specs.ran('t1'), 0, 'and no Timer ever started');
    // The plan says the same thing on its own, which is what the run bar quotes.
    const plan = runPlan(d, { specs });
    assert.equal(plan.waitMs, 800000);
  });

  test('a Timer INSIDE a loop is planned at the loop ceiling, not one pass (§4.6)', async () => {
    const specs = testSpecs();
    const seconds = 100;
    const d = doc([
      { from: 'g', to: 't', port: 'in' },
      { from: 't', to: 'g', port: 'in', back: true },
    ], [
      { id: 'g', type: 'gate', state: 'idle', value: null, settings: { barAfter: 99 } },
      { id: 't', type: 'timer', state: 'idle', value: null, settings: { seconds, repeats: 1 } },
    ]);
    const plan = runPlan(d, { specs });
    // THE BUG THIS GUARDS (K3 fix pass): `waitMs` summed each Timer's OWN repeats and ignored the
    // loop, so this planned as 100 s, passed the plan-time refusal, and was then discovered ten
    // minutes in by the runtime ceiling — the opposite of §4.6's "refused before it starts, with
    // the arithmetic shown". `costMax` two lines away had the multiplier all along.
    assert.deepEqual(plan.loops, ['g', 't'], 'both boxes really are in the loop');
    assert.equal(plan.waitMs, seconds * 1000 * RUN_LIMITS.maxIterations,
      'the wait is the ceiling on the loop, not one pass round it');
    const session = sessionOver(d, specs);
    const runner = createRunner({ session, app: fakeApp() });
    const report = await runner.run({});
    assert.equal(report.limited.ceiling, 'maxWallMs');
    assert.equal(report.limited.planned, true, 'and it is refused BEFORE the first tick');
    assert.equal(specs.ran('t'), 0);
  });

  test('the run plan is a RANGE when the graph loops, and counts thinksFor honestly (§4.6)', () => {
    const specs = testSpecs();
    const plan = runPlan(loopGraph(), { specs });
    assert.equal(plan.costMin, 1, 'one pass');
    assert.equal(plan.costMax, RUN_LIMITS.maxIterations, 'and at most maxIterations of the loop');
    assert.deepEqual(plan.loops, ['think', 'gate']);
    const flat = runPlan(doc([{ from: 'src', to: 'think', port: 'in' }], [
      { id: 'src', type: 'step', state: 'idle', value: null },
      { id: 'think', type: 'ask', state: 'idle', value: null },
    ]), { specs });
    assert.equal(flat.costMin, 1);
    assert.equal(flat.costMax, 1, 'no loop, no range');
    // A part that THINKS only in some settings must not be over-quoted (Condition in text mode).
    const sometimes = new Map([['cond', { thinks: true, thinksFor: (/** @type {any} */ p) => p.settings.mode === 'model', inputs: [], output: 'any' }]]);
    const d = doc([], [{ id: 'c', type: 'cond', state: 'idle', value: null, settings: { mode: 'text' } }]);
    assert.equal(runPlan(d, { specs: sometimes }).cost, 0);
    d.parts[0].settings.mode = 'model';
    assert.equal(runPlan(d, { specs: sometimes }).cost, 1);
  });

  // -------------------------------------------------------------------------------------------
  // The journal (§7.3-§7.5).
  // -------------------------------------------------------------------------------------------

  test('the journal ring and the prune are the frozen numbers (§7.3)', () => {
    assert.equal(MAX_EVENTS, 200);
    assert.equal(MAX_RUNS, 5);
    assert.equal(journalKey('g1'), 'computer:runs:g1');
    const events = Array.from({ length: 205 }, (_, i) => ({ t: i }));
    assert.equal(ring(events).length, 200);
    assert.equal(ring(events)[0].t, 5, 'the ring drops the OLDEST, never the newest');
    const rows = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}` }));
    assert.deepEqual(prune(rows).map((r) => r.id), ['r3', 'r4', 'r5', 'r6', 'r7']);
  });

  test('a row a crash left behind is what puts the resume banner up (§7.5)', () => {
    assert.equal(resumable([]), null);
    assert.equal(resumable([{ id: 'r1', endedAt: 9, status: 'done' }]), null);
    const live = { id: 'r2', endedAt: null, status: 'waiting' };
    assert.equal(resumable([{ id: 'r1', endedAt: 9, status: 'done' }, live]), live);
  });

  test('a run writes a row, and closing it stores a verdict', async () => {
    const kv = new Map();
    const repo = {
      kvGet: async (k, d) => (kv.has(k) ? kv.get(k) : d),
      kvSet: async (k, v) => { kv.set(k, v); },
    };
    const j = createJournal({ repo, graphId: 'g1', now: () => 1000 });
    const run = j.openRun({ mode: 'from', seeds: ['a'], cap: 50 });
    run.event({ partId: 'a', kind: 'start' });
    await run.wait('b', 'dialog', { question: 'Your answer?' });
    assert.equal(run.row().status, 'waiting');
    assert.deepEqual(run.row().waits.map((w) => w.partId), ['b']);
    run.resume('b');
    assert.equal(run.row().status, 'running');
    await run.close({ ran: 2, errors: [], cancelled: false });
    const rows = await j.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'done');
    assert.equal(rows[0].endedAt, 1000);
    assert.equal(rows[0].mode, 'from');
    assert.deepEqual(rows[0].seeds, ['a']);
    assert.equal(kv.get('computer:runs:g1').length, 1, 'it really reached the store');
  });

  test('the flush policy: a wait is forced, ordinary events are debounced (§7.4)', async () => {
    const kv = new Map();
    const repo = { kvGet: async () => [], kvSet: async (k, v) => { kv.set(k, v); } };
    const j = createJournal({ repo, graphId: 'g2', now: () => 7 });
    const run = j.openRun({ mode: 'all', seeds: [], cap: 50 });
    await new Promise((r) => { setTimeout(r, 5); });      // the row's own first write has landed
    const opened = run.writes();
    run.event({ partId: 'a', kind: 'start' });
    run.event({ partId: 'a', kind: 'done' });
    assert.equal(run.writes(), opened, 'three free events do not write the store three times');
    await run.wait('b', 'dialog', {});
    assert.equal(run.writes(), opened + 1, 'entering `waiting` is forced through immediately');
    assert.equal(kv.get('computer:runs:g2')[0].status, 'waiting', 'and the STORE says waiting');
  });

  test('the journal records a run end to end, and a run left waiting is resumable (§7.5)', async () => {
    cancelAll();
    const specs = testSpecs();
    const d = doc([{ from: 'src', to: 'q', port: 'in' }], [
      { id: 'src', type: 'ask', state: 'idle', value: null },
      { id: 'q', type: 'asker', state: 'idle', value: null },
    ]);
    const app = fakeApp();
    const session = sessionOver(d, specs, { graphId: 'g9' });
    const runner = createRunner({ session, app });
    const running = runner.run({ limits: { maxWallMs: 60 } });
    await new Promise((r) => { setTimeout(r, 25); });
    // While the question stands, the STORE already says a run is live and waiting — which is the
    // whole of §7.5: a crash here comes back with the resume banner, not with silence.
    const mid = app.store()['computer:runs:g9'];
    assert.equal(mid.length, 1);
    assert.equal(mid[0].status, 'waiting');
    assert.equal(mid[0].endedAt, null);
    assert.equal(resumable(mid), mid[0], 'and that is exactly what puts the banner up');
    assert.deepEqual(mid[0].waits.map((w) => w.partId), ['q']);
    assert.equal(mid[0].waits[0].question, 'Which one?');
    assert.ok(mid[0].spent >= 1, 'the generation already paid for was flushed before the park');
    const report = await running;
    const rows = app.store()['computer:runs:g9'];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].endedAt !== null, true, 'a finished run is not resumable');
    assert.equal(resumable(rows), null);
    assert.equal(rows[0].status, 'limited');
    assert.equal(rows[0].report.journalId, report.journalId);
    assert.deepEqual(rows[0].iterations, { src: 1, q: 1 });
    assert.ok(rows[0].events.some((e) => e.kind === 'wait' && e.partId === 'q'));
    cancelAll();
  });

  test('five runs are kept per graph and the sixth prunes the oldest (§7.3)', async () => {
    const specs = testSpecs();
    const app = fakeApp();
    const session = sessionOver(doc([], [{ id: 'a', type: 'step', state: 'idle', value: null }]), specs, { graphId: 'g5' });
    const runner = createRunner({ session, app });
    for (let i = 0; i < 7; i++) {
      // eslint-disable-next-line no-await-in-loop
      await runner.run({ force: true });
    }
    const rows = app.store()['computer:runs:g5'];
    assert.equal(rows.length, MAX_RUNS);
    assert.equal(rows[rows.length - 1].report.activations, 1, 'and the NEWEST is the one kept');
  });
};
