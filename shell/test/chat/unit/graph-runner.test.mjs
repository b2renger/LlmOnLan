// graph/runner.mjs (C1-U3, rewritten by C2-U1): the run engine, driven in Node against a fake
// session and a fake ask spine.
//
// The runner is the one engine module whose whole value is in its INTERLEAVINGS — abort vs yield vs
// error vs cap, the blocked-downstream set, the per-item bookkeeping of a fan-out, the queued
// cleanup, re-entrancy — and an Electron scenario cannot reach any of them deliberately. Everything
// it needs is injected (`session`, `app`), so the real module runs here unchanged.
//
// What these assertions protect:
//   - the cap counts GENERATIONS where they are MADE (§2.6 BH-4) and stops at them; it never
//     truncates silently, and a cached or refused call never eats it;
//   - our own Stop reports `cancelled` and puts the interrupted part back to `stale`, while the
//     governor saying 'busy'/'aborted' reports `yielded` — two different sentences for the reader;
//   - a failed part blocks EXACTLY its downstream, and the rest of the run set still executes;
//   - a fanned part runs once per item, one bad item never touches its siblings, the value is the
//     successes in order, and it is `error` only when EVERY item failed (§2.6 BH-2/BH-3);
//   - fan-out PROPAGATES until a port that accepts a list joins it back;
//   - parts that never ran come back `stale`, so the next Run finds them;
//   - a re-entrant run() REFUSES (`busy`) instead of fabricating a `cancelled` report;
//   - the run set is marked `queued` in ONE patch, not N — the canvas renders per patch.
import assert from 'node:assert/strict';
import { createRunner } from '../../../renderer/chat/graph/runner.mjs';
import { createDoc, addPart, addWire, patchPart, partById } from '../../../renderer/chat/graph/model.mjs';
import { valueOf, listOf } from '../../../renderer/chat/graph/values.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';
import '../../../renderer/chat/strings/parts.en.mjs';
import { clock, ids } from './graph-fixture.mjs';

const text = (/** @type {string} */ s) => valueOf('text', s);

/**
 * Part types with real `run` bodies.
 *   note     a free source of one text (settings.text)
 *   list     a free source of a LIST (settings.items) — what Split/Repeat are, for the engine
 *   ask      the thinking part: it really goes through `input.ask.text`, which is where the cap,
 *            the metering and the cache live. `hooks.ask` replaces the whole body when a test needs
 *            a failure the spine cannot produce.
 *   collect  a port that ACCEPTS a list, so a fan-out ends here
 *   sink     `output: null` — the To-thread shape (§2.6 BH-6)
 */
function runnableSpecs(hooks = {}) {
  const base = {
    note: {
      type: 'note', label: 'Note', inputs: [], output: 'text', thinks: false,
      size: { w: 200, h: 100 }, defaults: () => ({ text: 'x' }),
      run: async (/** @type {any} */ input) => text(String(input.part.settings.text || 'note')),
    },
    list: {
      type: 'list', label: 'List', inputs: [], output: 'list', thinks: false,
      size: { w: 200, h: 100 }, defaults: () => ({ items: [] }),
      run: async (/** @type {any} */ input) => listOf((input.part.settings.items || []).map(text)),
    },
    // A list whose identical items are DELIBERATE — what Repeat emits (values.mjs `listOf`'s
    // `{repeats: true}`). The plain `list` above is what Split and Filter emit, and the difference
    // is money: only the deliberate one is salted into separate generations.
    repeat: {
      type: 'repeat', label: 'Repeat', inputs: [], output: 'list', thinks: false,
      size: { w: 200, h: 100 }, defaults: () => ({ items: [] }),
      run: async (/** @type {any} */ input) => listOf((input.part.settings.items || []).map(text), { repeats: true }),
    },
    ask: {
      type: 'ask', label: 'Ask', thinks: true, output: 'text',
      size: { w: 300, h: 220 },
      inputs: [
        { name: 'context', label: 'Context', accepts: ['text', 'json', 'file'], many: true },
        { name: 'extra', label: 'Extra', accepts: ['text'], many: true },
      ],
      defaults: () => ({}),
      run: async (/** @type {any} */ input) => {
        if (hooks.ask) return hooks.ask(input);
        const context = (input.inputs && input.inputs.context) || [];
        const prompt = context.length ? String(context[0].data) : `ask:${input.part.id}`;
        const res = await input.ask.text({ task: 'graph:ask', prompt });
        if (!res || !res.ok) {
          const err = new Error(String((res && res.error && res.error.message) || 'farm'));
          /** @type {any} */ (err).reason = (res && res.error && res.error.kind) || 'farm';
          throw err;
        }
        return text(String(res.value));
      },
    },
    collect: {
      type: 'collect', label: 'Collect', inputs: [{ name: 'items', label: 'Items', accepts: ['list', 'text'], many: true }],
      output: 'text', thinks: false, size: { w: 240, h: 160 }, defaults: () => ({}),
      run: async (/** @type {any} */ input) => {
        const v = (input.inputs.items || [])[0];
        const items = v && v.kind === 'list' ? v.data : [v];
        return text(items.map((/** @type {any} */ x) => String(x.data)).join('|'));
      },
    },
    // Two milliseconds of real work per item: enough that a fan of a dozen outlasts one yield
    // slice, which is what makes the etiquette below observable without a huge fixture.
    slow: {
      type: 'slow', label: 'Slow', inputs: [{ name: 'body', label: 'Body', accepts: ['text'], many: false }],
      output: 'text', thinks: false, size: { w: 200, h: 100 }, defaults: () => ({}),
      run: async (/** @type {any} */ input) => {
        const until = Date.now() + 2;
        while (Date.now() < until) { /* busy: a part that computes, not one that waits */ }
        return text(String((input.inputs.body || [])[0].data));
      },
    },
    sink: {
      type: 'sink', label: 'Sink', inputs: [{ name: 'body', label: 'Body', accepts: ['text'], many: false }],
      output: null, thinks: false, size: { w: 200, h: 100 }, defaults: () => ({}),
      run: async (/** @type {any} */ input) => {
        (hooks.posted || []).push(String((input.inputs.body || [])[0].data));
        return null;
      },
    },
  };
  return new Map(Object.entries(base));
}

/** A session with the same doors the panel gives the runner, plus a log of the patches it made. */
function fakeSession(specs, { thread = { id: 't1' } } = {}) {
  const now = clock();
  const newId = ids('p');
  let doc = createDoc({ id: 'g1', threadId: thread ? thread.id : null, now });
  const patches = [];
  const api = {
    specs,
    now,
    doc: () => doc,
    thread: () => thread,
    patchPart(id, fields) { doc = patchPart(doc, id, fields, { now }); patches.push({ ids: [id] }); },
    patchParts(list, fields) {
      for (const id of list) doc = patchPart(doc, id, fields, { now });
      patches.push({ ids: list.slice() });
    },
    patches: () => patches,
    add(type, settings) {
      const out = addPart(doc, { type, x: 0, y: 0 }, { specs, newId, now });
      doc = out.doc;
      if (settings) doc = { ...doc, parts: doc.parts.map((p) => (p.id === out.part.id ? { ...p, settings: { ...p.settings, ...settings } } : p)) };
      return out.part.id;
    },
    wire(from, to, port = 'context') {
      const out = addWire(doc, { from, to, port }, { specs, newId: ids('w'), now });
      if (!out.ok) throw new Error(`fixture wire refused: ${out.reason}`);
      doc = out.doc;
    },
    part: (id) => partById(doc, id),
    state: (id) => (partById(doc, id) || {}).state,
    error: (id) => (partById(doc, id) || {}).error,
    value: (id) => (partById(doc, id) || {}).value,
    fanout: (id) => (partById(doc, id) || {}).fanout,
  };
  return api;
}

/**
 * An ask spine that logs every call, answers `answer:<prompt>` and CACHES by (prompt, salt) the way
 * app/ask.mjs does — which is what makes "resuming a half-finished fan-out re-pays for nothing"
 * measurable here rather than only in the browser.
 * @param {{kv?: object, answer?: Function}} [o]
 */
function fakeApp(o = {}) {
  const kv = o.kv || {};
  /** @type {any[]} */ const log = [];
  /** @type {Map<string, any>} */ const cache = new Map();
  const call = async (/** @type {any} */ given) => {
    log.push(given);
    const key = JSON.stringify([given.prompt, given.cacheSalt === undefined ? null : given.cacheSalt]);
    if (given.cache !== false && cache.has(key)) return { ...cache.get(key), cached: true };
    const res = o.answer
      ? await o.answer(given, log.length)
      : { ok: true, value: `answer:${given.prompt}`, usage: { total_tokens: 7 } };
    if (res && res.ok) cache.set(key, res);
    return res;
  };
  return {
    now: () => Date.now(),
    repo: { kvGet: async (/** @type {string} */ k, /** @type {any} */ dflt) => (k in kv ? kv[k] : dflt) },
    log: () => log,
    posts: () => log.filter((g) => !g.__cached),
    ask: { text: call, json: call, mode: () => 'json', vision: () => 'unknown' },
  };
}

/** An Error the way graph/parts/common.mjs makes one. */
function fail(message, reason) {
  const err = new Error(message);
  err.reason = reason;
  return err;
}

/** An AskResult the way app/ask.mjs makes a failure. */
const askFail = (kind, message) => ({ ok: false, error: { kind, message: message || kind } });

export default (test) => {
  // -------------------------------------------------------------------------------------------
  // C1: the run set, the blocked downstream, Stop, yield, re-entrancy
  // -------------------------------------------------------------------------------------------

  test('Stop reports cancelled and the interrupted part goes back to stale, not error', async () => {
    let stopNow = null;
    const specs = runnableSpecs({
      ask: (input) => new Promise((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(fail('aborted', 'aborted')));
        stopNow();
      }),
    });
    const session = fakeSession(specs);
    const a = session.add('ask');
    const b = session.add('ask');
    const runner = createRunner({ session, app: fakeApp() });
    stopNow = () => runner.stop();
    const report = await runner.run({});
    assert.equal(report.cancelled, true, 'our own abort');
    assert.equal(report.yielded, false, 'and NOT a yield');
    assert.equal(session.state(a), 'stale');
    assert.equal(session.error(a), null, 'interrupted is not wrong');
    assert.equal(session.state(b), 'stale', 'everything still queued comes back stale');
    assert.equal(report.skipped, 1, 'the part that never ran is counted');
  });

  test("the governor saying 'busy' is a YIELD: nothing is wrong and Run resumes here", async () => {
    const specs = runnableSpecs({ ask: () => Promise.reject(fail('the farm is busy', 'busy')) });
    const session = fakeSession(specs);
    const a = session.add('ask');
    const runner = createRunner({ session, app: fakeApp() });
    const report = await runner.run({});
    assert.equal(report.yielded, true);
    assert.equal(report.cancelled, false, 'a yield is not a Stop');
    assert.equal(report.errors.length, 0, 'and not an error');
    assert.equal(session.state(a), 'stale');
    assert.equal(session.error(a), null);
  });

  test('a failed part blocks EXACTLY its downstream; the rest of the run set still runs', async () => {
    let badId = null;
    const specs = runnableSpecs({
      ask: (input) => (input.part.id === badId
        ? Promise.reject(fail('boom', 'part'))
        : Promise.resolve(text('ok'))),
    });
    const session = fakeSession(specs);
    const src = session.add('note');
    const bad = session.add('ask');
    const down = session.add('ask');
    const other = session.add('ask');
    badId = bad;
    session.wire(src, bad);
    session.wire(bad, down);
    const runner = createRunner({ session, app: fakeApp() });
    const report = await runner.run({});
    assert.equal(session.state(bad), 'error');
    assert.equal(session.error(bad), 'boom');
    assert.equal(session.state(down), 'stale', 'blocked, never run');
    assert.equal(session.state(other), 'done', 'an unrelated part still runs');
    assert.equal(session.state(src), 'done');
    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0].partId, bad);
    assert.equal(report.skipped, 1, 'the blocked part is counted, not silently dropped');
    assert.equal(report.ran, 2);
  });

  test('a re-entrant run REFUSES (busy) instead of claiming the run was cancelled', async () => {
    let release = null;
    const specs = runnableSpecs({ ask: () => new Promise((done) => { release = () => done(text('ok')); }) });
    const session = fakeSession(specs);
    session.add('ask');
    const runner = createRunner({ session, app: fakeApp() });
    const first = runner.run({});
    await new Promise((r) => setTimeout(r, 0));
    const second = await runner.run({});
    assert.equal(second.busy, true, 'the refusal says so');
    assert.equal(second.cancelled, false, 'a cancelled report may ONLY come from a real abort');
    assert.equal(second.ran, 0);
    release();
    const report = await first;
    assert.equal(report.ran, 1);
    assert.equal(report.busy, undefined);
  });

  test('the whole run set is marked queued in ONE patch, not one per part', async () => {
    const specs = runnableSpecs();
    const session = fakeSession(specs);
    for (let i = 0; i < 6; i++) session.add('note');
    const runner = createRunner({ session, app: fakeApp() });
    await runner.run({});
    const multi = session.patches().filter((p) => p.ids.length > 1);
    assert.equal(multi.length, 1, 'exactly one multi-id patch: the queued marking');
    assert.equal(multi[0].ids.length, 6, 'all six named at once');
    const singles = session.patches().filter((p) => p.ids.length === 1);
    assert.equal(singles.length, 12, 'running + done for each of the six, and nothing more');
  });

  test('a part whose input never produced a value REFUSES out loud instead of running empty', async () => {
    const specs = runnableSpecs();
    const session = fakeSession(specs);
    const src = session.add('note');
    const ask = session.add('ask');
    session.wire(src, ask);
    // The source is already `done` with NO value — the shape a crashed save can leave behind.
    session.patchPart(src, { state: 'done', value: null });
    const runner = createRunner({ session, app: fakeApp() });
    const report = await runner.run({ only: [ask] });
    assert.equal(session.state(ask), 'error');
    assert.equal(report.errors.length, 1);
    assert.match(report.errors[0].message, /Context/);
  });

  test('a run over an empty graph is a finished run, not a refusal', async () => {
    const session = fakeSession(runnableSpecs());
    const runner = createRunner({ session, app: fakeApp() });
    const report = await runner.run({});
    assert.equal(report.ran, 0);
    assert.equal(report.cancelled, false);
    assert.equal(report.cycle, false);
    assert.equal(runner.report(), report, 'the last report is readable by a panel that mounted after it');
  });

  // -------------------------------------------------------------------------------------------
  // C2: the cap, counted where the generations are MADE (§2.6 BH-4)
  // -------------------------------------------------------------------------------------------

  test('the cap counts GENERATIONS, stops at them, and says what it spent and what is left', async () => {
    const specs = runnableSpecs();
    const session = fakeSession(specs);
    for (let i = 0; i < 5; i++) session.add('note');
    const a = session.add('ask'); const b = session.add('ask'); const c = session.add('ask');
    const app = fakeApp();
    const runner = createRunner({ session, app });
    const report = await runner.run({ maxItems: 2 });
    // The five free notes and two asks ran; the THIRD ask's very first call was refused, so the
    // part is stale and exactly one part was left unrun — and SAID SO.
    assert.equal(report.ran, 7);
    assert.deepEqual(report.capped, { cap: 2, spent: 2, stopped: 1 });
    assert.equal(report.generations, 2, 'and the report carries the true generation count');
    assert.equal(app.log().length, 2, 'the third request never left the runner');
    assert.equal(session.state(a), 'done');
    assert.equal(session.state(b), 'done');
    assert.equal(session.state(c), 'stale', 'capped is interrupted, not wrong');
    assert.equal(session.error(c), null);
    assert.equal(report.cancelled, false);
    assert.equal(report.yielded, false);
  });

  test('the cap comes from the stored preference when the run does not raise it', async () => {
    const specs = runnableSpecs();
    const session = fakeSession(specs);
    session.add('ask'); session.add('ask'); session.add('ask');
    const runner = createRunner({ session, app: fakeApp({ kv: { 'pref:computeMaxItems': 1 } }) });
    const report = await runner.run({});
    assert.equal(report.capped.cap, 1);
    assert.equal(report.ran, 1);
    assert.deepEqual(report.capped, { cap: 1, spent: 1, stopped: 2 },
      '`stopped` counts every part the cap left unrun, the interrupted one included');
    assert.equal(report.skipped, 1,
      'while `skipped` counts only the parts never reached — the capped one is stale, not skipped');
  });

  test('a refusal that took no seat does not eat the cap', async () => {
    let n = 0;
    const specs = runnableSpecs();
    const session = fakeSession(specs);
    session.add('ask'); session.add('ask');
    const app = fakeApp({ answer: () => { n++; return n === 1 ? askFail('busy') : { ok: true, value: 'x' }; } });
    const runner = createRunner({ session, app });
    const report = await runner.run({ maxItems: 1 });
    assert.equal(report.yielded, true, 'a busy farm ends the run');
    assert.equal(report.generations, 0, 'and cost the reader nothing');
  });

  // -------------------------------------------------------------------------------------------
  // C2: fan-out (§2.6 BH-2/BH-3)
  // -------------------------------------------------------------------------------------------

  /** list(items) -> ask -> collect. Returns the three ids. `type` picks the list SOURCE: 'list'
   * (a Split/Filter-shaped list) or 'repeat' (identical items on purpose). */
  function fanGraph(session, items, type = 'list') {
    const src = session.add(type, { items });
    const ask = session.add('ask');
    const collect = session.add('collect');
    session.wire(src, ask, 'context');
    session.wire(ask, collect, 'items');
    return { src, ask, collect };
  }

  test('a list at a text port runs the part once per item and the output is a list', async () => {
    const session = fakeSession(runnableSpecs());
    const g = fanGraph(session, ['a', 'b', 'c', 'd', 'e']);
    const app = fakeApp();
    const report = await createRunner({ session, app }).run({});

    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    assert.equal(report.ran, 3, 'three PARTS ran');
    assert.equal(app.log().length, 5, 'and the fanned one made exactly five generations');
    assert.deepEqual(app.log().map((c) => c.prompt), ['a', 'b', 'c', 'd', 'e'],
      'each execution saw its OWN item, in order');

    const value = session.value(g.ask);
    assert.equal(value.kind, 'list', 'the fanned part produced a list');
    assert.deepEqual(value.data.map((v) => v.data), ['answer:a', 'answer:b', 'answer:c', 'answer:d', 'answer:e']);
    assert.deepEqual(session.fanout(g.ask), { n: 5, done: 5, ok: 5, failed: 0, hidden: 0, errors: [] });
    assert.equal(session.part(g.ask).stats.calls, 5, 'the cost line counts the five calls');
    assert.equal(session.value(g.collect).data, 'answer:a|answer:b|answer:c|answer:d|answer:e',
      'and a port that accepts a list ENDS the fan-out');
  });

  test('one bad item is recorded against that item and its four siblings still finish', async () => {
    const session = fakeSession(runnableSpecs());
    const g = fanGraph(session, ['a', 'b', 'bad', 'd', 'e']);
    const app = fakeApp({ answer: (given) => (given.prompt === 'bad' ? askFail('farm', 'item three is bad') : { ok: true, value: `answer:${given.prompt}` }) });
    const report = await createRunner({ session, app }).run({});

    assert.equal(report.errors.length, 0, 'ONE bad item is not a failed run');
    assert.equal(app.log().length, 5, 'every item was still attempted');
    assert.equal(session.state(g.ask), 'done', 'the part succeeded — partly');
    const record = session.fanout(g.ask);
    assert.equal(record.n, 5);
    assert.equal(record.ok, 4);
    assert.equal(record.failed, 1);
    assert.deepEqual(record.errors.map((e) => e.i), [2], 'the record names WHICH item failed');
    assert.match(record.errors[0].message, /item three is bad/);
    assert.deepEqual(session.value(g.ask).data.map((v) => v.data),
      ['answer:a', 'answer:b', 'answer:d', 'answer:e'],
      'the value is the successes IN ORDER — a failure is not a hole in the list');
    assert.equal(session.state(g.collect), 'done', 'and the downstream is not blocked by one bad item');
  });

  test('a fan in which EVERY item fails is a failed part, with the first item\'s own words', async () => {
    const session = fakeSession(runnableSpecs());
    const g = fanGraph(session, ['a', 'b']);
    const app = fakeApp({ answer: (given) => askFail('farm', `no: ${given.prompt}`) });
    const report = await createRunner({ session, app }).run({});

    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0].partId, g.ask);
    assert.equal(session.state(g.ask), 'error');
    assert.equal(session.error(g.ask), t('parts.errAllItems', { message: 'no: a' }));
    assert.equal(session.state(g.collect), 'stale', 'the downstream is stale, never error');
    assert.equal(session.value(g.collect), null, 'and holds no made-up value');
    assert.equal(session.fanout(g.ask).failed, 2, 'both failures are still on the part for the reader');
  });

  test('an empty list fans ZERO times: no generation, no error, an empty list, done', async () => {
    const session = fakeSession(runnableSpecs());
    const g = fanGraph(session, []);
    const app = fakeApp();
    const report = await createRunner({ session, app }).run({});

    assert.equal(report.errors.length, 0);
    assert.equal(app.log().length, 0, 'nothing was asked');
    assert.equal(session.state(g.ask), 'done');
    assert.deepEqual(session.value(g.ask), { kind: 'list', data: [] });
    assert.deepEqual(session.fanout(g.ask), { n: 0, done: 0, ok: 0, failed: 0, hidden: 0, errors: [] });
    assert.equal(session.value(g.collect).data, '', 'the downstream ran on an empty list');
  });

  test('TWO lists at once are refused on the part, and nothing is sent', async () => {
    const session = fakeSession(runnableSpecs());
    const one = session.add('list', { items: ['a', 'b'] });
    const two = session.add('list', { items: ['c', 'd', 'e'] });
    const ask = session.add('ask');
    session.wire(one, ask, 'context');
    session.wire(two, ask, 'extra');
    const app = fakeApp();
    const report = await createRunner({ session, app }).run({});

    assert.equal(report.errors.length, 1);
    assert.equal(session.state(ask), 'error');
    assert.equal(session.error(ask), t('parts.errFanoutMany'), 'it says what to do about it');
    assert.equal(app.log().length, 0, 'a guess is never made at the farm\'s expense');
  });

  test('every other input BROADCASTS: the fanned part sees the same extra each time', async () => {
    const session = fakeSession(runnableSpecs({
      ask: async (input) => {
        const item = input.inputs.context[0].data;
        const extra = input.inputs.extra[0].data;
        const res = await input.ask.text({ task: 'graph:ask', prompt: `${item}+${extra}` });
        return text(String(res.value));
      },
    }));
    const src = session.add('list', { items: ['a', 'b'] });
    const side = session.add('note', { text: 'shared' });
    const ask = session.add('ask');
    session.wire(src, ask, 'context');
    session.wire(side, ask, 'extra');
    const app = fakeApp();
    await createRunner({ session, app }).run({});
    assert.deepEqual(app.log().map((c) => c.prompt), ['a+shared', 'b+shared']);
  });

  test('fan-out PROPAGATES: a fanned list meets the next text port and fans again', async () => {
    const session = fakeSession(runnableSpecs());
    const src = session.add('list', { items: ['a', 'b', 'c'] });
    const first = session.add('ask');
    const second = session.add('ask');
    const collect = session.add('collect');
    session.wire(src, first, 'context');
    session.wire(first, second, 'context');
    session.wire(second, collect, 'items');
    const app = fakeApp();
    const report = await createRunner({ session, app }).run({});

    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    assert.equal(app.log().length, 6, 'three items through two thinking parts');
    assert.deepEqual(session.fanout(second), { n: 3, done: 3, ok: 3, failed: 0, hidden: 0, errors: [] },
      'the second part fanned over the first part\'s three answers');
    assert.equal(session.value(collect).data,
      'answer:answer:a|answer:answer:b|answer:answer:c',
      'and Collect joined the three, which is what ends the fan-out');
  });

  test('identical items really become separate generations (Repeat is honest)', async () => {
    const session = fakeSession(runnableSpecs());
    const g = fanGraph(session, ['same', 'same', 'same'], 'repeat');
    const app = fakeApp({ answer: (given, n) => ({ ok: true, value: `take ${n}` }) });
    await createRunner({ session, app }).run({});
    assert.equal(app.log().length, 3, 'three calls, not one answer shown three times');
    assert.deepEqual(app.log().map((c) => c.cacheSalt), [undefined, 1, 2],
      'the repeats are salted apart; the first stays cacheable');
    assert.deepEqual(session.value(g.ask).data.map((v) => v.data), ['take 1', 'take 2', 'take 3']);
  });

  test('identical items from a SPLIT are one question: one generation, one unit of the cap', async () => {
    // The mirror of the test above, and the whole point of asking WHO repeated (fix pass, finding
    // 7). Two identical lines out of a pasted document are the same question; charging the reader
    // twice for them — and twice off a cap of 50 — is a bug you can only see on the bill.
    const session = fakeSession(runnableSpecs());
    const g = fanGraph(session, ['same', 'same', 'other']);
    const app = fakeApp({ answer: (given, n) => ({ ok: true, value: `take ${n}` }) });
    const report = await createRunner({ session, app }).run({});
    assert.deepEqual(app.log().map((c) => c.cacheSalt), [undefined, undefined, undefined],
      'nothing is salted: the producer never said the repeats were deliberate');
    assert.equal(report.generations, 2, 'two distinct questions, not three');
    assert.deepEqual(session.value(g.ask).data.map((v) => v.data), ['take 1', 'take 1', 'take 3'],
      'and the repeated line gets the cached answer, in its own place in the list');
  });

  test('a part with NO output may resolve null under a fan without being called empty', async () => {
    const posted = [];
    const session = fakeSession(runnableSpecs({ posted }));
    const src = session.add('list', { items: ['one', 'two'] });
    const sink = session.add('sink');
    session.wire(src, sink, 'body');
    const report = await createRunner({ session, app: fakeApp() }).run({});
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    assert.equal(session.state(sink), 'done');
    assert.equal(session.value(sink), null, 'it declares no output, so it holds none');
    assert.deepEqual(posted, ['one', 'two'], 'and it really ran once per item');
    assert.equal(session.fanout(sink).ok, 2);
  });

  // -------------------------------------------------------------------------------------------
  // C2: the cap and the etiquette ACROSS a fan-out
  // -------------------------------------------------------------------------------------------

  test('the cap is spent ACROSS the whole run, items included, and a raised cap finishes it', async () => {
    // TWO fans of three, and a cap of five: neither fan is over the item ceiling by itself, so what
    // stops this run is the generations the FIRST one already spent — the mid-fan stop, which keeps
    // every finished item.
    const session = fakeSession(runnableSpecs());
    const one = fanGraph(session, ['a', 'b', 'c']);
    const two = fanGraph(session, ['d', 'e', 'f']);
    const app = fakeApp();
    const runner = createRunner({ session, app });

    const capped = await runner.run({ maxItems: 5 });
    assert.deepEqual(capped.capped, { cap: 5, spent: 5, stopped: 2 },
      'it stopped mid-fan and said what it spent and what is left');
    assert.equal(session.state(two.ask), 'stale', 'the fanned part is interrupted, not wrong');
    assert.equal(session.value(two.ask), null, 'and produced no half-list');
    assert.deepEqual(session.fanout(two.ask), { n: 3, done: 2, ok: 2, failed: 0, hidden: 0, errors: [] },
      'the reader can still see how far it got');
    assert.equal(session.state(one.collect), 'done', 'the fan that DID finish kept everything');

    // Raise the cap for this run: everything already answered comes back from the ask cache, so
    // only the one item that was never asked costs anything.
    const raised = await runner.run({ maxItems: 10 });
    assert.equal(raised.capped, null, 'raising the cap cleared it');
    assert.equal(raised.errors.length, 0, JSON.stringify(raised.errors));
    assert.equal(raised.generations, 1, 'and the resume RE-PAID for nothing');
    assert.deepEqual(session.value(two.ask).data.map((v) => v.data), ['answer:d', 'answer:e', 'answer:f']);
    assert.equal(session.state(two.collect), 'done');
  });

  test('a cached item costs the farm nothing, so it costs the cap nothing', async () => {
    // The same two fans, resumed at the SAME cap that stopped them: if a cache hit cost a unit, the
    // resume would stop in exactly the same place for ever and the reader could never finish.
    const session = fakeSession(runnableSpecs());
    fanGraph(session, ['a', 'b', 'c']);
    const two = fanGraph(session, ['d', 'e', 'f']);
    const app = fakeApp();
    const runner = createRunner({ session, app });
    const capped = await runner.run({ maxItems: 5 });
    assert.equal(capped.capped.spent, 5);

    const second = await runner.run({ maxItems: 5 });
    assert.equal(second.capped, null, 'free answers never trip the cap');
    assert.equal(second.generations, 1, 'only the item nobody had asked yet');
    assert.equal(session.fanout(two.ask).ok, 3);
  });

  test('a fan BIGGER than the cap is refused before it runs, loudly and with a way through', async () => {
    // The ceiling the generation cap cannot provide (fix pass, finding 1): a part that spends
    // NOTHING — a Split into a Split, a Filter over a pasted document — was bounded by nothing at
    // all, and twenty thousand items froze the window with the badge unable to paint. The cap the
    // reader set is the item ceiling too, and going over it stops the run BEFORE that part runs
    // rather than silently running the first few.
    const session = fakeSession(runnableSpecs());
    const g = fanGraph(session, ['a', 'b', 'c', 'd', 'e']);
    const app = fakeApp();
    const runner = createRunner({ session, app });
    const events = [];
    runner.on((ev) => { if (ev.type === 'capped') events.push(ev); });

    const report = await runner.run({ maxItems: 3 });
    assert.equal(report.capped.cap, 3);
    assert.equal(report.capped.items, 5, 'it says how many the part WOULD have run');
    assert.equal(report.capped.raiseTo, 6, 'and what raising the cap has to reach for it to finish');
    assert.equal(report.generations, 0, 'nothing was spent…');
    assert.equal(app.log().length, 0, '…and nothing was sent');
    assert.equal(session.state(g.ask), 'stale', 'refused is not wrong');
    assert.equal(session.value(g.ask), null, 'and there is no half-list to mistake for the answer');
    assert.equal(events.length, 1, 'the canvas is told once, so the banner can offer the raise');

    const raised = await runner.run({ maxItems: report.capped.raiseTo });
    assert.equal(raised.capped, null);
    assert.deepEqual(session.value(g.ask).data.map((v) => v.data),
      ['answer:a', 'answer:b', 'answer:c', 'answer:d', 'answer:e']);
  });

  test('a fan of FREE items hands the main thread back while it runs', async () => {
    // `await spec.run(...)` on a part that makes no farm call resolves on the microtask queue, so a
    // fan used to run start to finish inside ONE macrotask: a timer scheduled before the run did
    // not fire until it was over, which is exactly why the `7/40` badge could not paint and Stop
    // could not be clicked (fix pass, finding 1).
    const session = fakeSession(runnableSpecs());
    const items = [];
    for (let i = 0; i < 12; i++) items.push(`item ${i}`);
    const src = session.add('list', { items });
    const slow = session.add('slow');
    session.wire(src, slow, 'body');

    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 1);
    const report = await createRunner({ session, app: fakeApp() }).run({ maxItems: items.length });
    clearInterval(timer);
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    assert.equal(session.fanout(slow).ok, items.length, 'every item really ran');
    assert.ok(ticks > 0, 'a timer scheduled before the run must get its turn DURING it');
    assert.ok(session.patches().length < items.length,
      'and the per-item record is written once a slice, not once an item: a two-thousand-item fan '
      + 'must not rewrite the graph row two thousand times');
  });

  test('a busy farm mid-fan YIELDS, keeps what finished, and resumes without re-paying', async () => {
    const session = fakeSession(runnableSpecs());
    const g = fanGraph(session, ['a', 'b', 'c', 'd']);
    let busy = true;
    const app = fakeApp({ answer: (given, n) => (busy && n === 3 ? askFail('busy') : { ok: true, value: `answer:${given.prompt}` }) });
    const runner = createRunner({ session, app });

    const yielded = await runner.run({});
    assert.equal(yielded.yielded, true, 'the run gave the seat back');
    assert.equal(yielded.errors.length, 0, 'a yield is not a failure — and item c is NOT blamed');
    assert.equal(session.state(g.ask), 'stale');
    assert.equal(session.fanout(g.ask).failed, 0, 'the busy farm was never written against an item');
    assert.equal(session.fanout(g.ask).done, 2);

    busy = false;
    const resumed = await runner.run({});
    assert.equal(resumed.errors.length, 0, JSON.stringify(resumed.errors));
    assert.equal(resumed.generations, 2, 'items a and b came back from the cache');
    assert.deepEqual(session.value(g.ask).data.map((v) => v.data),
      ['answer:a', 'answer:b', 'answer:c', 'answer:d']);
  });

  test('Stop mid-fan aborts exactly ONE request and leaves the finished items cached', async () => {
    const session = fakeSession(runnableSpecs());
    const g = fanGraph(session, ['a', 'b', 'c', 'd', 'e']);
    /** @type {any} */ let runner = null;
    const app = fakeApp({
      answer: (given, n) => {
        if (n === 2) runner.stop();
        return { ok: true, value: `answer:${given.prompt}` };
      },
    });
    runner = createRunner({ session, app });
    const report = await runner.run({});

    assert.equal(report.cancelled, true);
    assert.equal(app.log().length, 2, 'the third item was never asked for');
    assert.equal(session.state(g.ask), 'stale');
    assert.equal(session.error(g.ask), null, 'interrupted, not wrong');
    assert.equal(session.fanout(g.ask).done, 2);
    assert.equal(runner.running(), false);

    const resumed = await runner.run({});
    assert.equal(resumed.generations, 3, 'the two finished items were not paid for twice');
    assert.equal(session.state(g.ask), 'done');
  });

  test('progress and the event stream carry the ITEM, so the canvas can paint 7/40', async () => {
    const session = fakeSession(runnableSpecs());
    const g = fanGraph(session, ['a', 'b', 'c']);
    /** @type {any[]} */ const items = [];
    /** @type {any[]} */ const seen = [];
    /** @type {any} */ let runner = null;
    const app = fakeApp({
      answer: (given) => { seen.push(runner.progress()); return { ok: true, value: given.prompt }; },
    });
    runner = createRunner({ session, app });
    runner.on((ev) => { if (ev.type === 'item') items.push({ partId: ev.partId, i: ev.i, n: ev.n }); });
    await runner.run({});

    assert.deepEqual(items, [
      { partId: g.ask, i: 0, n: 3 },
      { partId: g.ask, i: 1, n: 3 },
      { partId: g.ask, i: 2, n: 3 },
    ], 'one item event per item, naming the part and the count');
    assert.deepEqual(seen.map((p) => p.item), [{ i: 0, n: 3 }, { i: 1, n: 3 }, { i: 2, n: 3 }],
      'and progress() reports which item is in flight');
    assert.equal(runner.progress(), null, 'which is cleared when the run ends');
  });

  test('a fanned part that re-runs does not show the previous run\'s per-item record', async () => {
    const session = fakeSession(runnableSpecs());
    const g = fanGraph(session, ['a', 'b', 'bad']);
    const app = fakeApp({ answer: (given) => (given.prompt === 'bad' ? askFail('farm', 'nope') : { ok: true, value: given.prompt }) });
    const runner = createRunner({ session, app });
    await runner.run({});
    assert.equal(session.fanout(g.ask).failed, 1);

    /** @type {any[]} */ const records = [];
    runner.on((ev) => { if (ev.type === 'part' && ev.partId === g.ask && ev.state === 'running') records.push(session.fanout(g.ask)); });
    session.patchPart(g.ask, { state: 'stale' });
    await runner.run({ only: [g.ask] });
    assert.deepEqual(records, [null], 'the badge starts empty, not at last run\'s 2/3');
  });
};
