// Critic S1, Package A (docs/reviews/COMPUTER_CRITIC_S1.md): run outcomes, asks and sentences.
//
// What is proven here, in Node, with the REAL pieces (the ask spine over a real governor, the real
// runner, the real Instruction, and a fake `fetch` that answers real SSE bytes):
//   S1-1  a run refused because the window is hidden carries `yieldedBy.hidden`; `outcomeOf` says
//         so and `nothingRan` is false for it — every report shape has ONE sentence;
//   S1-3  max_tokens is a CEILING clamped to the farm's window (a 16k slot and a 10k prompt give
//         about 6k, never under 512), the prompt's reserve follows it, and a cut answer that went
//         on thinking is flagged `thought` and named `errCutOffThinking`;
//   S1-4  cut off while still thinking is `ok:false` with NO value — never the thoughts — while
//         F8 (JSON in reasoning, finish `stop`) still parses;
//   S1-7  a farm that needs its password says so (failFromAsk keeps the ask's own sentence);
//   S1-12 every "lesson N" a string mentions ships in LESSONS;
//   S1-13 no ask.* or parts.* sentence names a model id.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAsk, thoughtOut } from '../../../renderer/chat/app/ask.mjs';
import { createGovernor } from '../../../renderer/chat/net/governor.mjs';
import { createBus } from '../../../renderer/chat/core/events.mjs';
import { createRunner } from '../../../renderer/chat/graph/runner.mjs';
import { createDoc, addPart, addWire, patchPart, partById, setSettings } from '../../../renderer/chat/graph/model.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';
import { instruction } from '../../../renderer/chat/graph/parts/instruction.mjs';
import { failFromAsk, isControl } from '../../../renderer/chat/graph/parts/common.mjs';
import {
  planFor, bindArrivals, clampMaxTokens, promptTokensOf, maxTokensOf,
  MAX_TOKENS_CODE, MAX_TOKENS_TEXT, MAX_TOKENS_FLOOR, MAX_TOKENS_MARGIN,
} from '../../../renderer/chat/graph/bind.mjs';
import { budgetFor } from '../../../renderer/chat/ctx/budget.mjs';
import { outcomeOf, outcomeText, nothingRan } from '../../../renderer/chat/computer/runbar.mjs';
import { LESSONS } from '../../../renderer/chat/computer/tutorial/registry.mjs';
import { t, allKeys } from '../../../renderer/chat/core/i18n.mjs';
import '../../../renderer/chat/strings/ask.en.mjs';
import '../../../renderer/chat/strings/parts.en.mjs';
import '../../../renderer/chat/strings/computer.en.mjs';
import '../../../renderer/chat/strings/computer-gen.en.mjs';
import '../../../renderer/chat/strings/graph.en.mjs';
import '../../../renderer/chat/strings/parts-image.en.mjs';
import '../../../renderer/chat/strings/parts-preview.en.mjs';
import { clock, ids } from './graph-fixture.mjs';

const BASE = 'http://10.0.0.5:4000/v1';
const STRINGS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'renderer', 'chat', 'strings');

/** One SSE body: optional reasoning, optional content, then `finish_reason`, then [DONE]. */
function sseBody(o) {
  let out = '';
  if (o.reasoning) out += `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: o.reasoning } }] })}\n\n`;
  if (o.text) out += `data: ${JSON.stringify({ choices: [{ delta: { content: o.text } }] })}\n\n`;
  out += `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: o.finish || 'stop' }], usage: { completion_tokens: 3, total_tokens: 11 } })}\n\n`;
  out += 'data: [DONE]\n\n';
  return out;
}

/** A fake farm: records every body, answers `reply(body, n)` = {text?, reasoning?, finish?}. */
function fakeFarm(/** @type {(body: any, n: number) => any} */ reply) {
  /** @type {any[]} */ const posts = [];
  const impl = async (/** @type {string} */ _url, /** @type {any} */ init) => {
    const body = JSON.parse(init.body);
    posts.push(body);
    return new Response(sseBody(reply(body, posts.length) || { text: 'ok' }), { status: 200 });
  };
  return { impl, posts };
}

async function withFarm(/** @type {any} */ farm, /** @type {() => Promise<any>} */ fn) {
  const real = globalThis.fetch;
  globalThis.fetch = farm.impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

/** A real ask spine over a real governor, against a farm with these caps. */
function makeApp(/** @type {any} */ over = {}) {
  const caps = {
    present: true, id: 'farm-1', baseUrl: BASE, apiKey: 'pw', requiresKey: true, keyMissing: false,
    defaultModel: 'gemma4:12b', models: [{ id: 'gemma4:12b', underlying: 'gemma4:12b', default: true }], seats: null,
    ...(over.caps || {}),
  };
  /** @type {any} */ const app = {
    bus: createBus(),
    now: () => Date.now(),
    state: { threadId: null, visible: true, pageVisible: true, storeMode: 'idb', ...(over.state || {}) },
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

/** A session with the doors the runner uses, around the REAL Instruction and a plain Note. */
function makeSession() {
  const specs = new Map(Object.entries({
    ask: instruction,
    note: {
      type: 'note', label: 'Note', inputs: [], output: 'text', thinks: false,
      size: { w: 200, h: 100 }, defaults: () => ({ text: 'x' }),
      run: async (/** @type {any} */ input) => valueOf('text', String(input.part.settings.text || '')),
    },
  }));
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
    wire(/** @type {string} */ from, /** @type {string} */ to) {
      const out = addWire(doc, { from, to, port: 'in', label: 'brief' }, { specs, newId: ids('w'), now });
      if (!out.ok) throw new Error(`fixture wire refused: ${out.reason}`);
      doc = out.doc;
    },
    part: (/** @type {string} */ id) => partById(doc, id),
  };
}

/** A Note wired into an Instruction with these settings. */
function oneInstruction(/** @type {any} */ settings) {
  const session = makeSession();
  const brief = session.add('note', { text: 'a spiral' });
  const ins = session.add('ask', { instruction: 'Draw the brief.', ...(settings || {}) });
  session.wire(brief, ins);
  return { session, brief, ins };
}

/** Every string value registered by every strings/*.en.mjs, as [key, text]. */
async function everyString() {
  for (const f of fs.readdirSync(STRINGS_DIR).filter((x) => x.endsWith('.en.mjs'))) {
    await import(pathToFileURL(path.join(STRINGS_DIR, f)).href);
  }
  return allKeys().map((k) => [k, t(k)]);
}

export default (test) => {
  // ------------------------------------------------------------------------------ S1-3: the cap

  test('S1-3 clamp: a ceiling, not a target — a 16k slot and a 10k prompt give about 6k, never under 512', () => {
    const six = clampMaxTokens({ ceiling: MAX_TOKENS_CODE, window: 16384, promptTokens: 10000 });
    assert.equal(six, 16384 - 10000 - MAX_TOKENS_MARGIN);
    assert.ok(six > 5800 && six < 6200, `about 6k: ${six}`);
    assert.equal(clampMaxTokens({ ceiling: MAX_TOKENS_CODE, window: 16384, promptTokens: 16000 }), MAX_TOKENS_FLOOR, 'never below the floor');
    assert.equal(clampMaxTokens({ ceiling: MAX_TOKENS_TEXT, window: 262144, promptTokens: 100 }), MAX_TOKENS_TEXT, 'a big window leaves the ceiling');
    assert.equal(clampMaxTokens({ ceiling: MAX_TOKENS_CODE, window: 0, promptTokens: 100 }), MAX_TOKENS_CODE, 'no window: the ceiling');
    assert.equal(MAX_TOKENS_CODE, 16384);
    assert.equal(MAX_TOKENS_TEXT, 8192);
    assert.equal(maxTokensOf({ code: 'svg', shape: 'text' }), MAX_TOKENS_CODE);
    assert.equal(maxTokensOf({ shape: 'json' }), MAX_TOKENS_TEXT);
  });

  test('S1-3 planFor: resolved ONCE, from the window — the answer and the prompt never overrun a 16k slot', () => {
    const caps = { budget: { tokens: 16384, advertised: 16384, source: 'advertised' } };   // parallel 2: 16k PER slot
    const small = planFor({
      part: { id: 'a', settings: { instruction: 'Draw a sun.', code: 'svg', shape: 'text' } },
      bind: bindArrivals({ values: [], labels: [], instruction: 'Draw a sun.' }),
      budget: budgetFor(caps),
    });
    const smallPrompt = promptTokensOf(small.assembled.system, small.assembled.prompt, 0);
    assert.equal(small.call.maxTokens, 16384 - smallPrompt - MAX_TOKENS_MARGIN, 'a short prompt: the rest of the slot');
    assert.ok(small.call.maxTokens + smallPrompt <= 16384, 'prompt + answer fit the slot');
    assert.equal(small.assembled.truncated, null, 'nothing cut');

    // A 10k-token document: the answer gets what is left (~6k), and the prompt is NOT cut for it.
    const doc = 'lorem ipsum dolor sit amet. '.repeat(Math.ceil((10000 * 3.6) / 28));
    const tenK = planFor({
      part: { id: 'b', settings: { instruction: 'Summarise the report.' } },
      bind: bindArrivals({ values: [valueOf('text', doc)], labels: ['report'], instruction: 'Summarise the report.' }),
      budget: budgetFor(caps),
    });
    const tenKPrompt = promptTokensOf(tenK.assembled.system, tenK.assembled.prompt, 0);
    assert.ok(tenK.call.maxTokens > 5500 && tenK.call.maxTokens < 6300, `about 6k: ${tenK.call.maxTokens}`);
    assert.equal(tenK.assembled.truncated, null, 'the prompt is whole; the answer shrank instead');
    assert.ok(tenK.call.maxTokens + tenKPrompt <= 16384);
    // The reserve follows maxTokens: the prompt's budget is what the answer leaves.
    assert.ok(tenK.budget.tokens + tenK.call.maxTokens <= 16384, `budget ${tenK.budget.tokens} + answer ${tenK.call.maxTokens}`);
    assert.equal(tenK.budget.window, 16384);

    // A prompt bigger than the slot: the floor, and the prompt is cut to fit around it.
    const huge = planFor({
      part: { id: 'c', settings: { instruction: 'Summarise the report.' } },
      bind: bindArrivals({ values: [valueOf('text', doc.repeat(3))], labels: ['report'], instruction: 'Summarise the report.' }),
      budget: budgetFor(caps),
    });
    assert.equal(huge.call.maxTokens, MAX_TOKENS_FLOOR);
    assert.ok(huge.assembled.truncated, 'the prompt was cut, and says so');
    const hugePrompt = promptTokensOf(huge.assembled.system, huge.assembled.prompt, 0);
    assert.ok(hugePrompt + MAX_TOKENS_FLOOR <= 16384, `cut prompt ${hugePrompt} + 512 fit the slot`);

    // A budget with no window (a hand-built one) sends the ceiling, as before.
    const bare = planFor({ part: { id: 'd', settings: { instruction: 'x', code: 'p5' } }, bind: bindArrivals({ values: [], labels: [], instruction: 'x' }), budget: { chars: 0, tokens: 0, assumed: true } });
    assert.equal(bare.call.maxTokens, MAX_TOKENS_CODE);
  });

  // ------------------------------------------------------------- S1-3 / S1-4: cut while thinking

  test('S1-3 thoughtOut: length with an empty answer, or one under a tenth of what was written', () => {
    assert.equal(thoughtOut('', 'thinking…', 'length'), true);
    assert.equal(thoughtOut('   ', '', 'length'), true, 'no visible answer at all');
    assert.equal(thoughtOut('<svg', 'x'.repeat(1000), 'length'), true, 'four characters after a thousand of thought');
    assert.equal(thoughtOut('x'.repeat(500), 'x'.repeat(1000), 'length'), false, 'a real (cut) answer');
    assert.equal(thoughtOut('', 'thinking', 'stop'), false, 'only a cut reply');
  });

  test('S1-4 ask.text: cut off while thinking is ok:false with NO value — never the thoughts', async () => {
    const app = makeApp();
    const farm = fakeFarm(() => ({ reasoning: 'Let me think about the spiral… the radius grows…', finish: 'length' }));
    const r = await withFarm(farm, () => app.ask.text({ task: 't', prompt: 'p', maxTokens: 4096 }));
    assert.equal(r.ok, false);
    assert.equal(r.value, null, 'the reasoning is not the answer');
    assert.equal(r.error.kind, 'empty');
    assert.equal(r.error.message, t('ask.cutThinking'));
    assert.equal(r.finishReason, 'length');
    assert.equal(r.thought, true);
    assert.equal(r.maxTokens, 4096);
    const again = await withFarm(farm, () => app.ask.text({ task: 't', prompt: 'p', maxTokens: 4096 }));
    assert.equal(again.cached, undefined, 'a failure is never cached');
  });

  test('S1-4 ask.json: cut while thinking never parses an object the model was only considering; F8 under stop still parses', async () => {
    const schema = { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] };
    const app = makeApp();
    const cut = fakeFarm(() => ({ reasoning: 'Maybe {"items": ["a", "b"]} — or should it be three?', finish: 'length' }));
    const r = await withFarm(cut, () => app.ask.json({ task: 'list', schema, prompt: 'p', maxTokens: 2048 }));
    assert.equal(r.ok, false);
    assert.equal(r.value, null);
    assert.equal(r.thought, true);
    assert.equal(cut.posts.length, 1, 'the same limit would cut a second rung too');

    const app2 = makeApp();
    const f8 = fakeFarm(() => ({ reasoning: '{"items": ["a", "b"]}', finish: 'stop' }));
    const ok = await withFarm(f8, () => app2.ask.json({ task: 'list', schema, prompt: 'p' }));
    assert.equal(ok.ok, true, 'F8: JSON in reasoning with finish stop has answered');
    assert.deepEqual(ok.value, { items: ['a', 'b'] });
  });

  test('S1-3/S1-4 an Instruction cut while thinking: code and prose both fail with errCutOffThinking, and keep no value', async () => {
    for (const settings of [{ code: 'p5', shape: 'text' }, {}]) {
      const app = makeApp();
      const { session, ins } = oneInstruction(settings);
      const runner = createRunner({ session, app });
      const farm = fakeFarm(() => ({ reasoning: 'thinking about it '.repeat(40), finish: 'length' }));
      await withFarm(farm, () => runner.run({ mode: 'from', seeds: [ins] }));
      const part = session.part(ins);
      const n = farm.posts[0].max_tokens;
      assert.equal(n, maxTokensOf(settings), 'no window advertised: the ceiling');
      assert.equal(part.state, 'error', JSON.stringify(settings));
      assert.equal(part.error, t('parts.errCutOffThinking', { n }));
      assert.equal(part.value, null, 'no thoughts downstream');
    }
    // A code answer cut after it DID write, mostly thinking: still the thinking sentence.
    const app = makeApp();
    const { session, ins } = oneInstruction({ code: 'svg', shape: 'text' });
    const farm = fakeFarm(() => ({ reasoning: 'x'.repeat(4000), text: '```svg\n<svg', finish: 'length' }));
    await withFarm(farm, () => createRunner({ session, app }).run({ mode: 'from', seeds: [ins] }));
    assert.equal(session.part(ins).error, t('parts.errCutOffThinking', { n: MAX_TOKENS_CODE }));
  });

  // -------------------------------------------------------------- S1-1 / S1-7 / S1-13: failFromAsk

  test('failFromAsk keeps the ask\'s own sentence: hidden, the password, no vision, thinking', async () => {
    const hidden = failFromAsk({ ok: false, error: { kind: 'busy', message: t('ask.hidden'), hidden: true } });
    assert.equal(hidden.message, t('ask.hidden'), 'S1-1: "paused while in the background", not "the farm is busy"');
    assert.equal(/** @type {any} */ (hidden).reason, 'busy');
    assert.equal(/** @type {any} */ (hidden).hidden, true);
    assert.equal(isControl(hidden), true, 'still a control failure: the runner yields');

    const key = failFromAsk({ ok: false, error: { kind: 'no_farm', message: t('ask.keyMissing') } });
    assert.equal(key.message, t('ask.keyMissing'), 'S1-7: a farm that needs its password is not "no farm"');
    assert.equal(/** @type {any} */ (key).reason, 'no-farm');

    const blind = failFromAsk({ ok: false, error: { kind: 'no_vision', message: t('ask.noVision') } }, { model: 'mock-nocaps' });
    assert.equal(blind.message, t('parts.errNoVision', { model: 'mock-nocaps' }));
    assert.match(blind.message, /mock-nocaps/);
    assert.match(blind.message, /Model menu/, 'S1-13: the fix is this box\'s Model menu');

    const thought = failFromAsk({ ok: false, error: { kind: 'empty', message: t('ask.cutThinking') }, thought: true, maxTokens: 512 });
    assert.equal(thought.message, t('parts.errCutOffThinking', { n: 512 }));
    assert.equal(failFromAsk({ ok: false, error: { kind: 'empty', message: 'x' } }).message, t('parts.errEmpty'));
    assert.equal(failFromAsk({ ok: false, error: { kind: 'farm', message: 'boom' } }).message, t('parts.errFarm', { message: 'boom' }));

    // The real ask, end to end: a farm that needs its password.
    const app = makeApp({ caps: { keyMissing: true } });
    const res = await app.ask.text({ task: 't', prompt: 'p' });
    assert.equal(failFromAsk(res).message, t('ask.keyMissing'));
    // And a hidden window: the ask refuses with busy + hidden, sending nothing.
    const away = makeApp({ state: { pageVisible: false } });
    const farm = fakeFarm(() => ({ text: 'never' }));
    const refused = await withFarm(farm, () => away.ask.text({ task: 't', prompt: 'p' }));
    assert.equal(refused.error.kind, 'busy');
    assert.equal(refused.error.hidden, true);
    assert.equal(farm.posts.length, 0);
  });

  // ---------------------------------------------------------------------------- S1-1: the report

  test('S1-1 the runner: a hidden window yields with yieldedBy {partId, message, hidden}, and nothing is sent', async () => {
    const app = makeApp({ state: { pageVisible: false } });
    const { session, ins } = oneInstruction();
    const farm = fakeFarm(() => ({ text: 'never' }));
    const report = /** @type {any} */ (await withFarm(farm, () => createRunner({ session, app }).run({ mode: 'from', seeds: [ins] })));
    assert.equal(farm.posts.length, 0, '0 requests went out');
    assert.equal(report.yielded, true);
    assert.deepEqual(report.yieldedBy, { partId: ins, message: t('ask.hidden'), hidden: true });
    assert.equal(session.part(ins).state, 'stale');
    assert.equal(nothingRan(report), false, 'a hidden run did NOT find everything up to date');
    assert.equal(outcomeOf(report).id, 'hidden');
    assert.equal(outcomeText(report), t('computer.runOutcomeHidden'));
  });

  test('S1-1 outcomeOf: one sentence for every report shape; only "nothing" offers Run everything again', () => {
    /** @param {any} r */ const id = (r) => (outcomeOf(r) || { id: null }).id;
    assert.equal(outcomeOf(null), null);
    assert.equal(outcomeText(null), '');
    assert.equal(id({ ran: 0, yielded: true, yieldedBy: { partId: 'a', message: 'm', hidden: true } }), 'hidden');
    assert.equal(id({ ran: 0, yielded: true, yieldedBy: { partId: 'a', message: 'm', hidden: false } }), 'busy');
    assert.equal(id({ ran: 1, yielded: true }), 'busy', 'a yield with no reason recorded: the seat was taken');
    assert.equal(id({ ran: 0, errors: [{ partId: 'a', message: 'x' }] }), 'errorsOne', 'errors with ran 0');
    assert.equal(outcomeText({ ran: 2, errors: [{}, {}] }), t('computer.runOutcomeErrors', { n: 2 }));
    assert.equal(id({ ran: 0, cancelled: true }), 'stopped');
    assert.equal(id({ ran: 0, busy: true }), 'already');
    assert.equal(id({ ran: 0, cycle: true }), 'cycle');
    assert.equal(outcomeText({ ran: 3, capped: { cap: 50, spent: 50, stopped: 4 }, limited: { ceiling: 'maxGenerations' } }),
      t('computer.runOutcomeCapped', { cap: 50, n: 4 }), 'capped beats the limit it also sets');
    assert.equal(outcomeText({ ran: 0, capped: { cap: 10, items: 40 } }), t('computer.runOutcomeCappedItems', { items: 40, cap: 10 }));
    assert.equal(id({ ran: 0, limited: { ceiling: 'maxWallMs', planned: true } }), 'planned', 'a Timer plan refused before it starts');
    assert.equal(id({ ran: 2, limited: { ceiling: 'maxIterations' } }), 'limited');
    assert.equal(id({ ran: 0, errors: [], barred: [] }), 'nothing');
    assert.equal(outcomeText({ ran: 0 }), t('computer.runNothing'));
    assert.equal(outcomeText({ ran: 1, ms: 1234 }), t('computer.runOutcomeDoneOne', { sec: '1.2' }), 'a plural for runDone');
    assert.equal(outcomeText({ ran: 3, ms: 500, barred: ['x'], leftStale: ['y', 'z'] }),
      [t('computer.runOutcomeDone', { n: 3, sec: '0.5' }), t('computer.runBarredOne'), t('computer.runLeftStale', { n: 2 })].join(' · '));

    assert.equal(nothingRan({ ran: 0, yielded: true }), false);
    for (const r of [{ ran: 0, cancelled: true }, { ran: 0, busy: true }, { ran: 0, capped: { cap: 1 } },
      { ran: 0, limited: { ceiling: 'maxWallMs', planned: true } }, { ran: 0, barred: ['x'] }, { ran: 2 }, null]) {
      assert.equal(nothingRan(r), false, JSON.stringify(r));
    }
    assert.equal(nothingRan({ ran: 0, errors: [], barred: [] }), true);
  });

  // -------------------------------------------------------------------------- S1-12 / S1-13: words

  test('S1-12: every "lesson N" a string mentions is a lesson this build ships', async () => {
    const shipped = new Set(LESSONS.map((l) => Number(/** @type {any} */ (l).n)));
    const bad = [];
    for (const [key, text] of await everyString()) {
      for (const m of String(text).matchAll(/\blessons?\s+(\d+)/gi)) {
        if (!shipped.has(Number(m[1]))) bad.push(`${key}: lesson ${m[1]}`);
      }
    }
    assert.deepEqual(bad, [], 'a lesson that does not ship is a button that can never work');
  });

  test('S1-13: no ask.* or parts.* sentence names a model id', async () => {
    const MODEL_ID = /\b(?:gemma|qwen|llama|mistral|deepseek)[\w.-]*|\b[a-z][\w.-]*:\d+(?:\.\d+)?b\b/i;
    const bad = (await everyString())
      .filter(([key]) => key.startsWith('ask.') || key.startsWith('parts.'))
      .filter(([, text]) => MODEL_ID.test(String(text)))
      .map(([key, text]) => `${key}: ${text}`);
    assert.deepEqual(bad, [], 'the reader picks the model; a sentence must not promise one');
  });

  test('S1-12: one sentence per image refusal, and the Condition says what it really does', () => {
    assert.notEqual(t('parts.imageTooBigFile', { mb: 40, capMb: 32 }), t('parts.imageTooBig', { mb: 40, capMb: 32 }));
    assert.doesNotMatch(t('parts.imageTooBigFile', { mb: 40, capMb: 32 }), /resized/);
    assert.match(t('parts.imageTooManyPixels', { mp: 256, capMp: 50 }), /megapixels/);
    assert.doesNotMatch(t('parts.previewKept'), /Unlock/);
    assert.doesNotMatch(t('computer.legacyNoThread'), /\bNote\b/);
    assert.doesNotMatch(t('graph.errImportVersion'), /LOL Chat/);
  });
};
