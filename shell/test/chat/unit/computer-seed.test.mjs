// Critic R1 A1 + B2 + B18 (Package A): the seed, end to end in Node.
//
// "When we rerun we need a new seed, because we always get the same results; we want control
// about the seed" — the owner. Before R1 a re-run returned the ask cache's answer bit for bit
// (no seed in the request, none in the cache key), so ▶ twice sent ONE request. Here the REAL
// pieces run together: graph/runner.mjs picks the seed, graph/parts/instruction.mjs sends it,
// app/ask.mjs keys its cache on it, and a fake `fetch` answers with real SSE bytes through the
// real net/run.mjs — so "how many requests actually left, and with which seed" is measured, not
// assumed.
//
// The matrix:
//   - new each run: ▶ twice → 2 requests, 2 different seeds, none cached; the box's stats say
//     which seed the answer came from;
//   - pinned: ▶ twice → 1 request with exactly that seed, then a cache hit (deterministic, honest);
//   - a Repeat ×4 fan → 4 distinct seeds; pinned → the SAME 4 in a fresh window;
//   - a yield mid-fan, then Run → the carried nonce: finished items come back cached, only the
//     rest are asked;
//   - the ask spine: `seed`/`temperature` on the wire, the cache key differs by seed,
//     `finishReason` is returned, and a cut JSON answer is not retried on the second rung;
//   - B2: an edit made while the box runs leaves it STALE with the old answer, not done;
//   - B18: `mode:'button'` is gone (a run is 'all' or 'from').
import assert from 'node:assert/strict';
import { createAsk } from '../../../renderer/chat/app/ask.mjs';
import { createGovernor } from '../../../renderer/chat/net/governor.mjs';
import { createBus } from '../../../renderer/chat/core/events.mjs';
import { createRunner } from '../../../renderer/chat/graph/runner.mjs';
import { createDoc, addPart, addWire, patchPart, partById, setSettings, normaliseDoc } from '../../../renderer/chat/graph/model.mjs';
import { valueOf, listOf } from '../../../renderer/chat/graph/values.mjs';
import { instruction } from '../../../renderer/chat/graph/parts/instruction.mjs';
import { seedFor, baseSeed, parseSeed, SEED_ITEM_STEP, SEED_ITERATION_STEP, SEED_MAX, SEED_SPAN } from '../../../renderer/chat/graph/bind.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';
import '../../../renderer/chat/strings/parts.en.mjs';
import '../../../renderer/chat/strings/computer-gen.en.mjs';
import { clock, ids } from './graph-fixture.mjs';

const BASE = 'http://10.0.0.5:4000/v1';

/** One SSE body: the content, then a finish chunk with `finish_reason`, then [DONE]. */
function sseBody(text, finish) {
  let out = '';
  if (text) out += `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
  out += `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish || 'stop' }], usage: { completion_tokens: 3, total_tokens: 11 } })}\n\n`;
  out += 'data: [DONE]\n\n';
  return out;
}

/**
 * A fake farm: records every body; answers `answer seed=<seed> #<n>` (or `reply(body, n)`).
 * @param {(body: any, n: number) => (string|{text: string, finish?: string})} [reply]
 */
function fakeFarm(reply) {
  /** @type {any[]} */ const posts = [];
  const impl = async (/** @type {string} */ url, /** @type {any} */ init) => {
    const body = JSON.parse(init.body);
    posts.push(body);
    const out = reply ? reply(body, posts.length) : `answer seed=${body.seed} #${posts.length}`;
    if (out && typeof out === 'object' && /** @type {any} */ (out).status) {
      return new Response(JSON.stringify({ error: { message: 'upstream is down' } }), { status: /** @type {any} */ (out).status });
    }
    const text = typeof out === 'string' ? out : out.text;
    const finish = typeof out === 'string' ? 'stop' : (out.finish || 'stop');
    return new Response(sseBody(text, finish), { status: 200 });
  };
  return { impl, posts };
}

/** The app a Computer run sees: a real ask spine over a real governor, the fake farm's caps. */
function makeApp() {
  const bus = createBus();
  const caps = {
    present: true, id: 'farm-1', baseUrl: BASE, proxyRoot: 'http://10.0.0.5:4000', apiKey: 'pw',
    requiresKey: true, keyMissing: false, defaultModel: 'gemma4:12b',
    models: [{ id: 'gemma4:12b', underlying: 'gemma4:12b', default: true }], seats: null,
  };
  /** @type {any} */ const app = {
    bus,
    now: () => Date.now(),
    state: { threadId: null, visible: true, pageVisible: true, storeMode: 'idb' },
    repo: { kvGet: async (/** @type {string} */ _k, /** @type {any} */ d) => d, kvSet: async () => {} },
    farm: {
      get: () => caps,
      headers: () => ({ authorization: 'Bearer pw' }),
      modelInfo: (/** @type {string} */ id) => caps.models.find((m) => m.id === id) || null,
      cap: () => 'unknown',
    },
  };
  app.gov = createGovernor(app);
  app.ask = createAsk(app).api;
  return app;
}

/** Plain parts around the real Instruction: a Note, and a Repeat-shaped list source. */
function specsWith() {
  return new Map(Object.entries({
    ask: instruction,
    note: {
      type: 'note', label: 'Note', inputs: [], output: 'text', thinks: false,
      size: { w: 200, h: 100 }, defaults: () => ({ text: 'x' }),
      run: async (/** @type {any} */ input) => valueOf('text', String(input.part.settings.text || '')),
    },
    repeat: {
      type: 'repeat', label: 'Repeat', inputs: [], output: 'list', thinks: false,
      size: { w: 200, h: 100 }, defaults: () => ({ items: [] }),
      run: async (/** @type {any} */ input) => listOf((input.part.settings.items || []).map((/** @type {string} */ s) => valueOf('text', s)), { repeats: true }),
    },
  }));
}

/** A session with the doors the runner uses. */
function makeSession(specs) {
  const now = clock();
  const newId = ids('p');
  let doc = createDoc({ id: 'g1', threadId: null, now });
  return {
    specs,
    doc: () => doc,
    docId: () => 'g1',
    thread: () => null,
    patchPart(/** @type {string} */ id, /** @type {any} */ f) { doc = patchPart(doc, id, f, { now }); },
    patchParts(/** @type {string[]} */ list, /** @type {any} */ f) { for (const id of list) doc = patchPart(doc, id, f, { now }); },
    add(/** @type {string} */ type, /** @type {any} */ settings) {
      const out = addPart(doc, { type, x: 0, y: 0 }, { specs, newId, now });
      doc = out.doc;
      if (settings) doc = setSettings(doc, out.part.id, settings, { specs, now });
      return out.part.id;
    },
    wire(/** @type {string} */ from, /** @type {string} */ to, /** @type {string} */ port, /** @type {string} */ label) {
      const out = addWire(doc, { from, to, port, label }, { specs, newId: ids('w'), now });
      if (!out.ok) throw new Error(`fixture wire refused: ${out.reason}`);
      doc = out.doc;
    },
    set(/** @type {string} */ id, /** @type {any} */ patch) { doc = setSettings(doc, id, patch, { specs, now }); },
    part: (/** @type {string} */ id) => partById(doc, id),
  };
}

/** Run `fn` with the unit runner's DOM shim as `globalThis.document`. */
async function withDom(/** @type {(doc: any) => any} */ fn) {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  const had = 'document' in globalThis;
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = doc;
  try { return await fn(doc); } finally {
    if (had) /** @type {any} */ (globalThis).document = prev;
    else delete /** @type {any} */ (globalThis).document;
  }
}

/** Render the REAL Instruction box against a one-part document; record what it writes. */
function renderBox(/** @type {any} */ settings, /** @type {any} */ o = {}) {
  const models = o.models || [{ id: 'gemma4:12b' }];
  const caps = { present: true, id: 'f', baseUrl: BASE, defaultModel: 'gemma4:12b', models };
  const specs = new Map([['ask', instruction], ['note', { type: 'note', inputs: [], output: 'text', defaults: () => ({}) }]]);
  const part = { id: 'i', type: 'ask', x: 0, y: 0, w: 300, h: 260, settings: { ...instruction.defaults(), ...settings }, state: 'idle', value: null, stats: null };
  const parts = [part].concat(o.extraParts || []);
  const doc = { id: 'g', rev: 1, parts, wires: o.wires || [] };
  /** @type {any[]} */ const updates = [];
  /** @type {string[]} */ const commits = [];
  const app = {
    bus: createBus(),
    farm: { get: () => caps, modelInfo: () => null, cap: () => 'unknown' },
    host: { session: { doc: () => doc, specs } },
  };
  const host = document.createElement('div');
  const inst = instruction.render(host, part, {
    app,
    update: (/** @type {any} */ p) => updates.push(p),
    commit: (/** @type {string} */ label) => commits.push(label),
  });
  const q = (/** @type {string} */ sel) => host.querySelector(sel);
  const click = (/** @type {string} */ sel) => q(sel).dispatchEvent({ type: 'click' });
  return { host, inst, part, doc, caps, updates, commits, q, click };
}

/** Install the fake endpoint for one test. */
async function withFarm(/** @type {any} */ farm, /** @type {() => Promise<any>} */ fn) {
  const real = globalThis.fetch;
  globalThis.fetch = farm.impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

/** One Instruction with a text brief wired in, ready to run. */
function oneInstruction(settings) {
  const specs = specsWith();
  const session = makeSession(specs);
  const brief = session.add('note', { text: 'a spiral' });
  const ins = session.add('ask', { instruction: 'Draw {brief}.', ...(settings || {}) });
  session.wire(brief, ins, 'in', 'brief');
  return { session, brief, ins };
}

export default (test) => {
  // ---------------------------------------------------------------------------------- the maths

  test('seed maths: parseSeed, the base and the per-item/iteration seeds', () => {
    assert.equal(parseSeed(''), null, "'' is new each run");
    assert.equal(parseSeed('48213'), 48213);
    assert.equal(parseSeed(' 7 '), 7);
    assert.equal(parseSeed('12a'), null);
    assert.equal(parseSeed('-3'), null);
    assert.equal(parseSeed(String(SEED_MAX)), SEED_MAX);
    assert.equal(parseSeed(String(SEED_MAX + 1)), null, 'too big to send is not silently clamped');
    assert.equal(parseSeed(12), 12);
    assert.equal(parseSeed(1.5), null);
    assert.equal(baseSeed({ pinned: 99, nonce: 1, partId: 'a' }), 99, 'pinned wins');
    const a = baseSeed({ pinned: null, nonce: 1, partId: 'a' });
    assert.ok(a >= 0 && a < SEED_SPAN, 'new each run is a short number');
    assert.equal(baseSeed({ pinned: null, nonce: 1, partId: 'a' }), a, 'deterministic in (nonce, part)');
    assert.notEqual(baseSeed({ pinned: null, nonce: 2, partId: 'a' }), a, 'a new nonce moves it');
    assert.notEqual(baseSeed({ pinned: null, nonce: 1, partId: 'b' }), a, 'another part, another stream');
    assert.equal(seedFor(500, 0, 1), 500, 'item 0 of iteration 1 IS the base');
    assert.equal(seedFor(500, 3, 1), 500 + 3 * SEED_ITEM_STEP);
    assert.equal(seedFor(500, 0, 2), 500 + SEED_ITERATION_STEP);
    assert.ok(seedFor(SEED_MAX, 5, 9) <= SEED_MAX, 'wraps, never exceeds what every engine takes');
  });

  // -------------------------------------------------------------------------------- the matrix

  test('new each run: ▶ twice = 2 requests with 2 different seeds, none cached; the box says which', async () => {
    const app = makeApp();
    const { session, ins } = oneInstruction();
    let n = 0;
    const runner = createRunner({ session, app, nonce: () => 1000 + (n++) });
    const farm = fakeFarm();
    await withFarm(farm, async () => {
      const r1 = await runner.run({ mode: 'from', seeds: [ins] });
      const s1 = session.part(ins).stats;
      const r2 = await runner.run({ mode: 'from', seeds: [ins] });
      const s2 = session.part(ins).stats;
      assert.equal(r1.generations, 1);
      assert.equal(r2.generations, 1, 'the second ▶ is a real generation, not a cache replay');
      assert.equal(farm.posts.length, 2);
      assert.equal(typeof farm.posts[0].seed, 'number');
      assert.notEqual(farm.posts[0].seed, farm.posts[1].seed, 'two seeds');
      assert.equal(s1.seed, farm.posts[0].seed, 'the box shows the seed that produced its answer');
      assert.equal(s2.seed, farm.posts[1].seed);
      assert.equal(s1.pinned, false);
      assert.equal(s2.calls, 1, 'not cached');
      assert.match(String(session.part(ins).value.data), new RegExp(`seed=${farm.posts[1].seed}`));
    });
  });

  test('new each run, REAL nonce: two runs still send two seeds', async () => {
    const app = makeApp();
    const { session, ins } = oneInstruction();
    const runner = createRunner({ session, app });            // crypto.getRandomValues
    const farm = fakeFarm();
    await withFarm(farm, async () => {
      await runner.run({ mode: 'from', seeds: [ins] });
      await runner.run({ mode: 'from', seeds: [ins] });
    });
    assert.equal(farm.posts.length, 2);
    assert.notEqual(farm.posts[0].seed, farm.posts[1].seed);
  });

  test('pinned: ▶ twice = ONE request with exactly that seed, then a cache hit', async () => {
    const app = makeApp();
    const { session, ins } = oneInstruction({ seed: '4242' });
    const runner = createRunner({ session, app });
    const farm = fakeFarm();
    await withFarm(farm, async () => {
      await runner.run({ mode: 'from', seeds: [ins] });
      const first = session.part(ins).value.data;
      const r2 = await runner.run({ mode: 'from', seeds: [ins] });
      assert.equal(r2.generations, 0, 'the same seed on the same inputs is the same answer');
      assert.equal(session.part(ins).value.data, first);
      assert.equal(session.part(ins).stats.calls, 0, 'answered from the cache');
    });
    assert.equal(farm.posts.length, 1);
    assert.equal(farm.posts[0].seed, 4242);
    assert.equal(session.part(ins).stats.seed, 4242);
    assert.equal(session.part(ins).stats.pinned, true);
  });

  test('Keep pins the seed a new-each-run answer came from: the next run asks for it again (cached)', async () => {
    const app = makeApp();
    const { session, ins } = oneInstruction();
    const runner = createRunner({ session, app });
    const farm = fakeFarm();
    await withFarm(farm, async () => {
      await runner.run({ mode: 'from', seeds: [ins] });
      const used = session.part(ins).stats.seed;
      session.set(ins, { seed: String(used) });               // what the box's Keep writes
      assert.equal(session.part(ins).state, 'stale', 'a seed is a setting: changing it stales the box');
      const r = await runner.run({});
      assert.equal(r.generations, 0, 'the kept seed + the same prompt = the answer already paid for');
    });
    assert.equal(farm.posts.length, 1);
  });

  test('a Repeat ×4 fan: 4 distinct seeds; pinned, the SAME 4 in a fresh window', async () => {
    const seedsOf = async (/** @type {any} */ settings) => {
      const app = makeApp();
      const specs = specsWith();
      const session = makeSession(specs);
      const rep = session.add('repeat', { items: ['go', 'go', 'go', 'go'] });
      const ins = session.add('ask', { instruction: 'A variation of {v}.', ...(settings || {}) });
      session.wire(rep, ins, 'in', 'v');
      const farm = fakeFarm();
      const runner = createRunner({ session, app });
      await withFarm(farm, () => runner.run({}));
      assert.equal(session.part(ins).fanout.ok, 4);
      return farm.posts.map((p) => p.seed);
    };
    const free = await seedsOf();
    assert.equal(free.length, 4);
    assert.equal(new Set(free).size, 4, 'four different generations');
    const pinnedA = await seedsOf({ seed: '100' });
    const pinnedB = await seedsOf({ seed: '100' });
    assert.deepEqual(pinnedA, [100, 100 + SEED_ITEM_STEP, 100 + 2 * SEED_ITEM_STEP, 100 + 3 * SEED_ITEM_STEP]);
    assert.deepEqual(pinnedB, pinnedA, 'reproducible under a pinned seed');
  });

  test('a yield mid-fan, then Run: the carried nonce replays the finished items for free', async () => {
    const app = makeApp();
    const specs = specsWith();
    const session = makeSession(specs);
    const rep = session.add('repeat', { items: ['go', 'go', 'go', 'go'] });
    const ins = session.add('ask', { instruction: 'A variation of {v}.' });
    session.wire(rep, ins, 'in', 'v');
    let n = 0;
    const runner = createRunner({ session, app, nonce: () => 7000 + (n++) });
    // The reader hides the window after the second answer: the ask spine refuses `busy`, and the
    // runner YIELDS (§4.3) with two items paid for.
    const farm = fakeFarm((body, count) => {
      if (count === 2) app.state.pageVisible = false;
      return `item seed=${body.seed}`;
    });
    await withFarm(farm, async () => {
      const r1 = await runner.run({});
      assert.equal(r1.yielded, true);
      assert.equal(session.part(ins).state, 'stale');
      assert.equal(farm.posts.length, 2);
      app.state.pageVisible = true;
      const r2 = await runner.run({});
      assert.equal(r2.yielded, false);
      assert.equal(r2.generations, 2, 'only the two unfinished items are generated');
    });
    assert.equal(farm.posts.length, 4);
    const seeds = farm.posts.map((p) => p.seed);
    assert.equal(new Set(seeds).size, 4, 'the resumed items continue the SAME seed sequence');
    assert.equal(seeds[1] - seeds[0], SEED_ITEM_STEP);
    assert.equal(seeds[3] - seeds[0], 3 * SEED_ITEM_STEP, 'items 2 and 3 use the carried nonce, not the new run’s');
    assert.equal(session.part(ins).fanout.ok, 4);
    // …and once it completed, the carry is spent: the next run brings new seeds.
    await withFarm(farm, () => runner.run({ force: true }));
    assert.equal(farm.posts.length, 8);
    assert.ok(!seeds.includes(farm.posts[4].seed), 'a completed part does not keep its nonce');
  });

  test('a fan with one FAILED item: the next run repairs it — the three that answered come back cached', async () => {
    const app = makeApp();
    const specs = specsWith();
    const session = makeSession(specs);
    const rep = session.add('repeat', { items: ['apple', 'banana', 'cherry', 'plum'] });
    const ins = session.add('ask', { instruction: 'Describe {v}.' });
    session.wire(rep, ins, 'in', 'v');
    const runner = createRunner({ session, app });
    let broken = true;
    const farm = fakeFarm((body) => {
      const prompt = JSON.stringify(body.messages);
      return broken && prompt.includes('cherry') ? /** @type {any} */ ({ status: 502 }) : `about seed=${body.seed}`;
    });
    await withFarm(farm, async () => {
      await runner.run({});
      assert.equal(session.part(ins).fanout.failed, 1);
      broken = false;
      session.set(ins, { instruction: 'Describe {v}.' });     // any edit: the fan is stale
      const again = await runner.run({});
      assert.equal(again.generations, 1, 'only the item that failed is paid for again');
    });
    assert.equal(farm.posts.length, 5);
    assert.equal(session.part(ins).fanout.ok, 4);
  });

  // ---------------------------------------------------------------------------- the ask spine

  test('ask: seed and temperature ride the body, and the cache key differs by seed', async () => {
    const app = makeApp();
    const farm = fakeFarm();
    await withFarm(farm, async () => {
      const a = await app.ask.text({ task: 't', prompt: 'p', seed: 1, temperature: 0.7 });
      const b = await app.ask.text({ task: 't', prompt: 'p', seed: 1, temperature: 0.7 });
      const c = await app.ask.text({ task: 't', prompt: 'p', seed: 2, temperature: 0.7 });
      assert.equal(a.cached, undefined);
      assert.equal(b.cached, true, 'same seed, same question: the cache');
      assert.equal(c.cached, undefined, 'another seed: another generation');
    });
    assert.equal(farm.posts.length, 2);
    assert.equal(farm.posts[0].seed, 1);
    assert.equal(farm.posts[0].temperature, 0.7);
    assert.equal(farm.posts[1].seed, 2);
    const none = fakeFarm();
    await withFarm(none, () => app.ask.text({ task: 't', prompt: 'q' }));
    assert.equal('seed' in none.posts[0], false, 'no seed asked, none sent');
    assert.equal('temperature' in none.posts[0], false);
  });

  test('ask: max_tokens is what the caller asked (over the floor), and finishReason comes back', async () => {
    const app = makeApp();
    const farm = fakeFarm(() => ({ text: 'function setup() {', finish: 'length' }));
    const r = await withFarm(farm, () => app.ask.text({ task: 't', prompt: 'p', maxTokens: 4096 }));
    assert.equal(farm.posts[0].max_tokens, 4096);
    assert.equal(r.ok, true, 'a cut answer is still an answer to the spine');
    assert.equal(r.finishReason, 'length');
    const ok = fakeFarm();
    const r2 = await withFarm(ok, () => app.ask.text({ task: 't', prompt: 'p2' }));
    assert.equal(r2.finishReason, 'stop');
  });

  test('ask.json: an answer CUT OFF mid-object is not retried on the second rung, and is no schema strike', async () => {
    const app = makeApp();
    const farm = fakeFarm(() => ({ text: '{"items": ["a", "b", "c', finish: 'length' }));
    const schema = { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] };
    const r = await withFarm(farm, () => app.ask.json({ task: 'list', schema, prompt: 'p', maxTokens: 2048 }));
    assert.equal(r.ok, false);
    assert.equal(r.finishReason, 'length');
    assert.equal(farm.posts.length, 1, 'the same limit would cut the second attempt too');
  });

  // ------------------------------------------------------------------------- A8 at the runner

  test('a CODE answer cut off at max_tokens is a named error; prose keeps its answer and a cut flag', async () => {
    const app = makeApp();
    const { session, ins } = oneInstruction({ code: 'p5' });
    const runner = createRunner({ session, app });
    const farm = fakeFarm(() => ({ text: '```javascript\nfunction setup() {\n  createCanvas(', finish: 'length' }));
    await withFarm(farm, () => runner.run({ mode: 'from', seeds: [ins] }));
    assert.equal(farm.posts[0].max_tokens, 4096, 'code gets 4096');
    assert.match(String(farm.posts[0].messages[0].content), /You write ONE p5\.js sketch/, 'the p5 rules ride the system message');
    const part = session.part(ins);
    assert.equal(part.state, 'error');
    assert.equal(part.error, t('parts.errCutOff', { n: 4096 }));

    const prose = oneInstruction();
    const r2 = createRunner({ session: prose.session, app: makeApp() });
    const farm2 = fakeFarm(() => ({ text: 'A long essay that stops mid-', finish: 'length' }));
    await withFarm(farm2, () => r2.run({ mode: 'from', seeds: [prose.ins] }));
    assert.equal(farm2.posts[0].max_tokens, 2048, 'prose gets 2048');
    const p2 = prose.session.part(prose.ins);
    assert.equal(p2.state, 'done', 'prose that was cut is still worth reading');
    assert.equal(p2.stats.cut, true, 'and the box is told the end is missing');
  });

  // ---------------------------------------------------------------------------------------- B2

  test('B2: an edit made while the box runs is not overwritten — the old answer lands STALE', async () => {
    const app = makeApp();
    const { session, ins } = oneInstruction();
    /** @type {(v: any) => void} */ let release = () => {};
    const gate = new Promise((r) => { release = r; });
    app.ask = {
      ...app.ask,
      text: async () => { await gate; return { ok: true, value: 'answer for the OLD prompt', mode: 'text', usage: { total_tokens: 5 }, finishReason: 'stop' }; },
    };
    const runner = createRunner({ session, app });
    const running = runner.run({ mode: 'from', seeds: [ins] });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(session.part(ins).state, 'running');
    session.set(ins, { instruction: 'Draw {brief}, but blue.' });   // the person fixes a typo mid-run
    release(undefined);
    const report = await running;
    const part = session.part(ins);
    assert.equal(part.state, 'stale', 'the box is not Done: its answer is for the old prompt');
    assert.equal(part.value.data, 'answer for the OLD prompt', 'the answer is kept, it was paid for');
    assert.equal(report.ran, 1, 'only the brief ran: the edited Instruction is not counted');
    assert.equal(report.generations, 1);
    assert.deepEqual(report.leftStale, [ins], 'the report says it was left stale');
  });

  test('B2: without an edit the same run ends Done (the check is not a false alarm)', async () => {
    const app = makeApp();
    const { session, ins } = oneInstruction();
    const runner = createRunner({ session, app });
    const report = await withFarm(fakeFarm(), () => runner.run({ mode: 'from', seeds: [ins] }));
    assert.equal(session.part(ins).state, 'done');
    assert.equal(report.ran, 2, 'the brief and the Instruction');
  });

  // --------------------------------------------------------------------------------------- B18

  test('B18: a run is `all` or `from`; the dead `button` mode is gone', async () => {
    const app = makeApp();
    const { session } = oneInstruction();
    const runner = createRunner({ session, app });
    const report = await withFarm(fakeFarm(), () => runner.run(/** @type {any} */ ({ mode: 'button' })));
    assert.equal(report.mode, 'all', 'an unknown mode is a Run all, never a third behaviour');
  });

  // ------------------------------------------------------------------------- the box (A1, A2, B9)

  test('the seed row is in the box’s visible settings: type digits, 🎲 pins, ✕ goes back to new each run', async () => {
    await withDom(() => {
      const b = renderBox({ instruction: 'go' });
      const input = b.q('.graph-ins-seed-input');
      assert.ok(input, 'a seed field on the box');
      assert.equal(input.placeholder, t('parts.genSeedNew'), 'empty reads "new each run"');
      assert.equal(input.title, t('parts.genSeedHint'));
      assert.ok(b.q('.graph-part-fields .graph-ins-seed'), 'beside Model and Answer shape');
      input.value = '12a3';
      input.dispatchEvent({ type: 'input' });
      assert.equal(input.value, '123', 'digits only');
      assert.deepEqual(b.updates.at(-1), { seed: '123' });
      input.dispatchEvent({ type: 'change' });
      assert.equal(b.commits.at(-1), t('parts.genSeed'), 'one undo entry when the field is left');
      b.click('.graph-ins-seed-dice');
      const rolled = b.updates.at(-1).seed;
      assert.match(rolled, /^\d+$/);
      assert.ok(parseSeed(rolled) !== null, 'a seed that can be sent');
      assert.equal(b.commits.at(-1), t('parts.genSeedDiceTitle'));
      b.click('.graph-ins-seed-clear');
      assert.deepEqual(b.updates.at(-1), { seed: '' });
      assert.equal(input.value, '');
      input.value = '99999999999';
      input.dispatchEvent({ type: 'input' });
      assert.equal(input.getAttribute('aria-invalid'), 'true', 'too big to send is flagged');
    });
  });

  test('after a run the box says which seed it used, and Keep pins exactly that one', async () => {
    await withDom(() => {
      const b = renderBox({ instruction: 'go' });
      assert.equal(b.q('.graph-ins-run').hidden, true, 'nothing to say before a run');
      b.inst.update({ ...b.part, stats: { ms: 1, tokens: 1, calls: 1, seed: 48213, pinned: false } });
      assert.equal(b.q('.graph-ins-run').hidden, false);
      assert.equal(b.q('.graph-ins-seed-used').textContent, t('parts.genSeedUsed', { seed: 48213 }));
      assert.equal(b.q('.graph-ins-seed-keep').hidden, false);
      b.click('.graph-ins-seed-keep');
      assert.deepEqual(b.updates.at(-1), { seed: '48213' });
      assert.equal(b.commits.at(-1), t('parts.genSeedKeep'), 'Keep is one undoable edit');
      // once pinned, there is nothing to keep, and the line says pinned
      b.inst.update({ ...b.part, settings: { ...b.part.settings, seed: '48213' }, stats: { ms: 1, tokens: 1, calls: 0, seed: 48213, pinned: true } });
      assert.equal(b.q('.graph-ins-seed-used').textContent, t('parts.genSeedUsedPinned', { seed: 48213 }));
      assert.equal(b.q('.graph-ins-seed-keep').hidden, true);
      assert.equal(b.q('.graph-ins-seed-input').value, '48213', 'the field follows the document');
      // a prose answer cut at max_tokens says so on the box
      b.inst.update({ ...b.part, stats: { ms: 1, tokens: 1, calls: 1, cut: true } });
      assert.equal(b.q('.graph-ins-cut').hidden, false);
      assert.equal(b.q('.graph-ins-cut').textContent, t('parts.genCutChip', { n: 2048 }));
    });
  });

  test('A2: "Fill in {names}" is named, hinted, and offered only when a bound name is written in braces', async () => {
    await withDom(() => {
      const note = { id: 'n', type: 'note', x: 0, y: 0, settings: {}, state: 'done', value: valueOf('text', 'cats') };
      const wires = [{ id: 'w', from: 'n', to: 'i', port: 'in', label: 'topic' }];
      const bare = renderBox({ instruction: 'Write about the topic.' }, { extraParts: [note], wires });
      assert.equal(bare.q('.graph-ins-inline-wrap').hidden, true, 'a bare word is not a slot: nothing to fill');
      const braced = renderBox({ instruction: 'Write about {topic}.' }, { extraParts: [note], wires });
      const wrap = braced.q('.graph-ins-inline-wrap');
      assert.equal(wrap.hidden, false);
      assert.equal(braced.q('.graph-ins-inline span').textContent, t('parts.insInline'));
      assert.equal(t('parts.insInline'), 'Fill in {names} with their values');
      assert.equal(braced.q('.graph-ins-inline').title, t('parts.insInlineHint'));
      assert.equal(braced.q('.graph-ins-hint').textContent, t('parts.insInlineHint'), 'the one-line helper is on screen');
      const on = renderBox({ instruction: 'Write about the topic.', inlineVars: true }, { extraParts: [note], wires });
      assert.equal(on.q('.graph-ins-inline-wrap').hidden, false, 'while it is ON it stays, so it can be switched off');
    });
  });

  test('B9: a model picker focused when the catalogue arrives is rebuilt once it is left', async () => {
    await withDom((doc) => {
      const b = renderBox({ instruction: 'go' }, { models: [] });
      const select = b.q('select');
      const count = () => select.children.length;
      assert.equal(count(), 1, 'Automatic only: the farm has said nothing yet');
      b.caps.models = [{ id: 'gemma4:12b' }, { id: 'qwen3:8b' }];
      doc.activeElement = select;                           // the person has the picker open
      b.inst.update(b.part);
      assert.equal(count(), 1, 'never rebuilt under the person’s hand');
      doc.activeElement = null;
      b.inst.update(b.part);
      assert.equal(count(), 3, 'rebuilt as soon as it is not focused — it used to stay stale for good');
    });
  });

  // ------------------------------------------------------------------- stats survive a reload

  test('stats.seed / pinned / cut survive patchPart and a reload; junk is dropped', () => {
    const specs = specsWith();
    const now = clock();
    let doc = createDoc({ id: 'g1', threadId: null, now });
    const out = addPart(doc, { type: 'ask', x: 0, y: 0 }, { specs, newId: ids('p'), now });
    doc = patchPart(out.doc, out.part.id, { stats: { ms: 5, tokens: 9, calls: 1, seed: 48213, pinned: false, cut: true } }, { now });
    const got = partById(doc, out.part.id).stats;
    assert.deepEqual(got, { ms: 5, tokens: 9, calls: 1, seed: 48213, pinned: false, cut: true });
    const back = normaliseDoc(JSON.parse(JSON.stringify(doc)), { specs, now }).doc;
    assert.deepEqual(partById(back, out.part.id).stats, got, 'a reload keeps what the box shows');
    doc = patchPart(doc, out.part.id, { stats: { ms: 1, tokens: 0, calls: 0, seed: 'x', cut: 'yes' } }, { now });
    assert.deepEqual(partById(doc, out.part.id).stats, { ms: 1, tokens: 0, calls: 0 }, 'not a seed, not a flag: dropped');
    assert.equal(partById(doc, out.part.id).settings.seed, '', 'the Instruction declares `seed` (serialize exports it)');
  });
};
