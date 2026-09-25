// Critic S2 (docs/reviews/COMPUTER_CRITIC_S2.md), the pure and Node halves, with the REAL pieces
// (the real planFor and budgetFor, the real runner over the real Button and Instruction, the real
// Condition and Filter, and a fake `fetch`/ask that records what would go on the wire):
//   S2-1  a long input no longer leaves the answer 512 tokens: the answer keeps a quarter of the
//         window (up to its ceiling) and the PROMPT is cut around it — the critic's table, re-run;
//   S2-2  a box behind an unpressed Button is `held`: the report names the Button, the bar says
//         "press “…”", and "Run everything again" is not offered; a press then runs it;
//   S2-3  the pure half of Tab in a box bigger than the view (the real-input half is k10);
//   S2-4  a verdict's 4096 ceiling is clamped to what its prompt leaves of the window.
import assert from 'node:assert/strict';
import { createAsk } from '../../../renderer/chat/app/ask.mjs';
import { createGovernor } from '../../../renderer/chat/net/governor.mjs';
import { createBus } from '../../../renderer/chat/core/events.mjs';
import { createRunner } from '../../../renderer/chat/graph/runner.mjs';
import { createDoc, addPart, addWire, patchPart, partById, setSettings } from '../../../renderer/chat/graph/model.mjs';
import { valueOf, listOf } from '../../../renderer/chat/graph/values.mjs';
import { instruction } from '../../../renderer/chat/graph/parts/instruction.mjs';
import { button, notePress, clearPresses, faceText } from '../../../renderer/chat/graph/parts/button.mjs';
import { condition, VERDICT_MAX_TOKENS } from '../../../renderer/chat/graph/parts/condition.mjs';
import { filter } from '../../../renderer/chat/graph/parts/filter.mjs';
import { planFor, bindArrivals, promptTokensOf, MAX_TOKENS_MARGIN, MAX_TOKENS_FLOOR } from '../../../renderer/chat/graph/bind.mjs';
import { budgetFor } from '../../../renderer/chat/ctx/budget.mjs';
import { outcomeOf, outcomeText, nothingRan, faceNamesIn } from '../../../renderer/chat/computer/runbar.mjs';
import { fitsView, controlRect, panToShow } from '../../../renderer/chat/graph/canvas.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';
import '../../../renderer/chat/strings/ask.en.mjs';
import '../../../renderer/chat/strings/parts.en.mjs';
import '../../../renderer/chat/strings/computer.en.mjs';
import '../../../renderer/chat/strings/computer-gen.en.mjs';
import '../../../renderer/chat/strings/graph.en.mjs';
import { clock, ids } from './graph-fixture.mjs';

const BASE = 'http://10.0.0.5:4000/v1';

/** About `tokens` tokens of prose, the way the S1 tests build a document. */
const docOf = (/** @type {number} */ tokens) => 'lorem ipsum dolor sit amet. '.repeat(Math.ceil((tokens * 3.6) / 28));

/** A fake farm that counts every body it is sent and answers `ok`. */
function fakeFarm() {
  /** @type {any[]} */ const posts = [];
  const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`
    + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: 1, total_tokens: 5 } })}\n\n`
    + 'data: [DONE]\n\n';
  const impl = async (/** @type {string} */ _url, /** @type {any} */ init) => {
    posts.push(JSON.parse(init.body));
    return new Response(sse, { status: 200 });
  };
  return { impl, posts };
}

async function withFarm(/** @type {any} */ farm, /** @type {() => Promise<any>} */ fn) {
  const real = globalThis.fetch;
  globalThis.fetch = farm.impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

/** A real ask spine over a real governor (the S1 fixture's shape). */
function makeApp() {
  const caps = {
    present: true, id: 'farm-1', baseUrl: BASE, apiKey: 'pw', requiresKey: true, keyMissing: false,
    defaultModel: 'gemma4:12b', models: [{ id: 'gemma4:12b', underlying: 'gemma4:12b', default: true }], seats: null,
  };
  /** @type {any} */ const app = {
    bus: createBus(),
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

/** A session around the REAL Button and the REAL Instruction. */
function makeSession() {
  const specs = new Map(Object.entries({ ask: instruction, button }));
  const now = clock();
  const newId = ids('p');
  const wireId = ids('w');
  let doc = createDoc({ id: 'g2', threadId: null, now });
  return {
    specs,
    doc: () => doc,
    docId: () => 'g2',
    thread: () => null,
    patchPart(/** @type {string} */ id, /** @type {any} */ f) { doc = patchPart(doc, id, f, { now }); },
    patchParts(/** @type {string[]} */ list, /** @type {any} */ f) { for (const id of list) doc = patchPart(doc, id, f, { now }); },
    add(/** @type {string} */ type, /** @type {any} */ settings) {
      const out = addPart(doc, { type, x: 0, y: 0 }, { specs, newId, now });
      doc = out.doc;
      if (settings) doc = setSettings(doc, out.part.id, settings, { specs, now });
      return out.part.id;
    },
    wire(/** @type {string} */ from, /** @type {string} */ to) {
      const out = addWire(doc, { from, to, port: 'in' }, { specs, newId: wireId, now });
      if (!out.ok) throw new Error(`fixture wire refused: ${out.reason}`);
      doc = out.doc;
    },
    part: (/** @type {string} */ id) => partById(doc, id),
  };
}

export default (test) => {
  // ------------------------------------------------------------------ S2-1: the answer's share

  test('S2-1 the critic\'s table, re-run: 16k rows keep 4096, the 32k row 8192, and prompt + answer fit', () => {
    const rows = [
      { caps: null, window: 32768, input: 40000, want: 8192 },           // no advertised window
      { caps: { budget: { tokens: 16384 } }, window: 16384, input: 20000, want: 4096 },
      { caps: { budget: { tokens: 16384 } }, window: 16384, input: 15000, want: 4096 },
      { caps: { budget: { tokens: 8192 } }, window: 8192, input: 9000, want: 2048 },  // 16k at parallel 2
    ];
    const instr = 'Summarise the report in a page';
    for (const row of rows) {
      for (const code of ['', 'svg']) {
        const plan = planFor({
          part: { id: 'a', settings: { instruction: instr, code, shape: 'text' } },
          bind: bindArrivals({ values: [valueOf('text', docOf(row.input))], labels: ['report'], instruction: instr }),
          budget: budgetFor(row.caps),
        });
        const where = `${row.window} window, ${row.input} input, ${code || 'prose'}`;
        assert.equal(plan.call.maxTokens, row.want, `${where}: the answer keeps its share (${plan.call.maxTokens})`);
        assert.ok(plan.assembled.truncated, `${where}: the prompt is cut, and says so`);
        const prompt = promptTokensOf(plan.assembled.system, plan.assembled.prompt, 0);
        assert.ok(prompt + plan.call.maxTokens <= row.window, `${where}: prompt ${prompt} + answer ${plan.call.maxTokens} fit`);
      }
    }
  });

  test('S2-1 a short prompt still gets the whole ceiling (the S1-3 case is unchanged)', () => {
    const plan = planFor({
      part: { id: 'a', settings: { instruction: 'Draw a sun.', code: 'p5', shape: 'text' } },
      bind: bindArrivals({ values: [], labels: [], instruction: 'Draw a sun.' }),
      budget: budgetFor({ budget: { tokens: 65536 } }),
    });
    assert.equal(plan.call.maxTokens, 16384, 'the code ceiling, whole');
    assert.equal(plan.assembled.truncated, null);
  });

  // ------------------------------------------------------------------ S2-2: held by a Button

  test('S2-2 outcomeOf: a report held by a Button is `held`, never "nothing", and names the Button', () => {
    const r = { ran: 0, skipped: 1, heldBy: ['b'] };
    assert.equal(outcomeOf(r).id, 'heldOne');
    assert.equal(nothingRan(r), false, '"Run everything again" is not offered');
    assert.equal(outcomeText(r), t('computer.runOutcomeHeldOne', { button: t('parts.btnPress') }), 'the default face without a resolver');
    assert.equal(outcomeText(r, { nameOf: () => 'Go' }), t('computer.runOutcomeHeldOne', { button: 'Go' }));
    const two = { ran: 0, skipped: 2, heldBy: ['b'], held: ['x', 'y'] };
    assert.equal(outcomeText(two, { nameOf: () => 'Go' }), t('computer.runOutcomeHeld', { button: 'Go', n: 2 }));
    assert.equal(nothingRan(two), false);
    // Something else ran, something failed: the press still leads, the rest rides after it.
    const mixed = { ran: 1, ms: 1500, skipped: 1, heldBy: ['b'], held: ['x'], errors: [{ partId: 'e', message: 'm' }] };
    assert.equal(outcomeText(mixed, { nameOf: () => 'Go' }), [
      t('computer.runOutcomeHeldOne', { button: 'Go' }),
      t('computer.runOutcomeDoneOne', { sec: '1.5' }),
      t('computer.runOutcomeErrorsOne'),
    ].join(' · '));
    // No held Button: unchanged.
    assert.equal(outcomeOf({ ran: 0, heldBy: [] }).id, 'nothing');
    assert.equal(outcomeText({ ran: 0, barred: ['x'] }), [t('computer.runOutcomeDone', { n: 0, sec: '0.0' }), t('computer.runBarredOne')].join(' · '));
    assert.equal(faceNamesIn({ parts: [{ id: 'b', settings: { text: 'Go' } }, { id: 'c', settings: {} }] })('b'), 'Go');
    assert.equal(faceNamesIn({ parts: [{ id: 'c', settings: {} }] })('c'), faceText({}), 'an unnamed Button reads its default face');
  });

  test('S2-2 the runner: Run all behind an unpressed Button reports heldBy, sends nothing; a press runs it', async () => {
    clearPresses();
    const app = makeApp();
    const session = makeSession();
    const btn = session.add('button', { text: 'Go' });
    const ins = session.add('ask', { instruction: 'Say hi.' });
    const after = session.add('ask', { instruction: 'Say it louder.' });
    session.wire(btn, ins);
    session.wire(ins, after);
    const farm = fakeFarm();
    const runner = createRunner({ session, app });

    const report = /** @type {any} */ (await withFarm(farm, () => runner.run()));
    assert.equal(farm.posts.length, 0, 'nothing was sent');
    assert.equal(report.ran, 0);
    assert.deepEqual(report.heldBy, [btn], 'the report names the Button that held the run');
    assert.deepEqual([...report.held].sort(), [ins, after].sort(), 'and both boxes waiting for its press');
    assert.notEqual(session.part(btn).state, 'done', 'Run all never presses a Button');
    assert.equal(session.part(ins).state, 'stale');
    assert.equal(session.part(after).state, 'stale');
    assert.equal(nothingRan(report), false, 'this run did NOT find every box up to date');
    assert.equal(outcomeText(report, { nameOf: faceNamesIn(session.doc()) }), t('computer.runOutcomeHeld', { button: 'Go', n: 2 }));

    // The press: the Button's face records it and starts a `from` run seeded on the Button.
    notePress(btn);
    const pressed = /** @type {any} */ (await withFarm(farm, () => runner.run({ mode: 'from', seeds: [btn] })));
    assert.equal(farm.posts.length, 2, 'the two boxes after it ran');
    assert.equal(session.part(ins).state, 'done');
    assert.equal(session.part(after).state, 'done');
    assert.deepEqual(pressed.heldBy, [], 'nothing is held any more');
    assert.equal(outcomeOf(pressed).id, 'done');
    clearPresses();
  });

  test('S3-1 a press that JOINS a running run clears the held lists: the report no longer says "waiting for a press"', async () => {
    clearPresses();
    const app = makeApp();
    const session = makeSession();
    const slow = session.add('ask', { instruction: 'Take your time.' });   // not behind the Button
    const btn = session.add('button', { text: 'Go' });
    const ins = session.add('ask', { instruction: 'Say hi.' });
    session.wire(btn, ins);
    const farm = fakeFarm();
    // The first request is held open until the press has joined the run.
    /** @type {() => void} */ let release = () => {};
    const gate = new Promise((r) => { release = () => r(undefined); });
    const inner = farm.impl;
    let first = true;
    farm.impl = async (/** @type {string} */ url, /** @type {any} */ init) => {
      if (first) { first = false; await gate; }
      return inner(url, init);
    };
    const runner = createRunner({ session, app });
    const running = withFarm(farm, () => runner.run());
    await new Promise((r) => setTimeout(r, 20));
    notePress(btn);
    // The host's door for a press during a live run: it JOINS the run (§4.4), it does not start one.
    const merged = /** @type {any} */ (runner).addToRun([btn]);
    release();
    const report = /** @type {any} */ (await running);
    assert.ok(Number(merged) >= 1, 'the press joined the live run');
    assert.equal(session.part(ins).state, 'done', 'the held box ran once the Button was pressed');
    assert.deepEqual(report.held, [], 'nothing is still held');
    assert.deepEqual(report.heldBy, [], 'and no Button is named as holding anything');
    assert.notEqual(outcomeOf(report).id, 'held', 'so the bar does not say "waiting for a press"');
    clearPresses();
  });

  // ------------------------------------------------------------------ S2-3: Tab in a big box

  test('S2-3 fitsView and controlRect: a box taller than the view pans to the focused control', () => {
    const viewport = { w: 1000, h: 707 };
    assert.equal(fitsView({ w: 320, h: 300 }, 1, viewport), true);
    assert.equal(fitsView({ w: 320, h: 300 }, 3.5, viewport), false, '1050 px tall at 350 % does not fit 707');
    // A box at world (40, 40), 320 wide, drawn at 3.5: a control 240 px below its top (client).
    const part = { x: 40, y: 40, w: 320 };
    const box = { left: 140, top: 228, width: 1120 };
    const el = { left: 175, top: 952, width: 300, height: 35 };
    const r = /** @type {any} */ (controlRect(el, box, part));
    assert.ok(Math.abs(r.x - (40 + 35 / 3.5)) < 1e-9 && Math.abs(r.y - (40 + 724 / 3.5)) < 1e-9, JSON.stringify(r));
    assert.ok(Math.abs(r.w - 300 / 3.5) < 1e-9 && Math.abs(r.h - 10) < 1e-9);
    // The pan that shows THAT rect puts the control on screen (the box's top-left would not).
    const view = { x: 0, y: 0, zoom: 3.5 };
    const next = /** @type {any} */ (panToShow(view, r, viewport));
    const top = r.y * 3.5 + next.y;
    assert.ok(top >= 24 && top + r.h * 3.5 <= viewport.h - 24, `the control lands inside the view: ${top}`);
    assert.equal(controlRect(el, { left: 0, top: 0, width: 0 }, part), null, 'a box not drawn gives no rect');
  });

  // ------------------------------------------------------------------ S2-4: verdict ceilings

  test('S2-4 Condition and Filter: an 8k window and a 6k prompt send at most 8192 − 6000 − 256', async () => {
    /** @type {any[]} */ const asked = [];
    const ask = { json: async (/** @type {any} */ o) => { asked.push(o); return { ok: true, value: { verdict: 'yes', keep: true } }; } };
    const small = { farm: { get: () => ({ budget: { tokens: 8192 } }) } };
    const long = docOf(6000);

    await condition.run(/** @type {any} */ ({
      part: { id: 'c1', settings: { mode: 'model', question: 'Is it long?', branch: 'yes' } },
      inputs: { in: [valueOf('text', long)] }, ask, app: small,
    }));
    const cond = asked.pop();
    const condPrompt = promptTokensOf(cond.system, cond.prompt, 0);
    assert.ok(condPrompt >= 6000, `the prompt is at least the 6k document: ${condPrompt}`);
    assert.equal(cond.maxTokens, 8192 - condPrompt - MAX_TOKENS_MARGIN, 'the ceiling, clamped to what the prompt leaves');
    assert.ok(cond.maxTokens <= 8192 - 6000 - 256 && cond.maxTokens >= MAX_TOKENS_FLOOR, String(cond.maxTokens));

    await filter.run(/** @type {any} */ ({
      part: { id: 'f1', settings: { mode: 'model', text: 'Keep the long ones.' } },
      inputs: { items: [listOf([valueOf('text', long), valueOf('text', 'short')])] }, ask, app: small,
    }));
    assert.equal(asked.length, 2, 'one verdict per item');
    const [first, second] = asked;
    assert.ok(first.maxTokens <= 8192 - 6000 - 256, `the long item is clamped: ${first.maxTokens}`);
    assert.equal(first.maxTokens, 8192 - promptTokensOf(first.system, first.prompt, 0) - MAX_TOKENS_MARGIN);
    assert.equal(second.maxTokens, VERDICT_MAX_TOKENS, 'a short item keeps the whole 4096 ceiling');

    // No farm caps at all: the conservative default window, and the ceiling stands for a short prompt.
    asked.length = 0;
    await condition.run(/** @type {any} */ ({
      part: { id: 'c2', settings: { mode: 'model', question: 'q' } }, inputs: { in: [valueOf('text', 'yes')] }, ask, app: {},
    }));
    assert.equal(asked[0].maxTokens, VERDICT_MAX_TOKENS);
  });
};
