// @ts-check
// C2-U2 in Node: the fan-out parts — Split, Repeat and Filter (plan §2.6 BH, spec §3/§7).
//
// What belongs here rather than in the harness: everything a fake ask spine can prove. The cutting
// rules are pure functions and are asserted as functions (a mode that quietly changed is a bug no
// screenshot would catch); the model mode is asserted for the SHAPE of what it spends — one call
// per item, the criterion and the item on the wire, a control failure rethrown rather than blamed
// on an item. How many requests really leave the window, and what the mock saw, is
// scenarios/c2-fanout-parts.mjs.

import assert from 'node:assert/strict';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import { valueOf, listOf } from '../../../renderer/chat/graph/values.mjs';
import { planFan } from '../../../renderer/chat/graph/fanout.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import { split, numbered, modeOf, MODES } from '../../../renderer/chat/graph/parts/split.mjs';
import { passes, timesOf, MAX_TIMES } from '../../../renderer/chat/graph/parts/repeat.mjs';
import { keeps, verdictPrompt, KEEP_SCHEMA, safePattern, MAX_PATTERN } from '../../../renderer/chat/graph/parts/filter.mjs';
import { countText } from '../../../renderer/chat/graph/parts/fields.mjs';
import { itemsOf } from '../../../renderer/chat/graph/parts/common.mjs';

const SPECS = specMap();

/** Run `fn` with the unit runner's DOM shim installed as `globalThis.document`. */
async function withDom(fn) {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = doc;
  try { return await fn(doc); } finally {
    if (had) /** @type {any} */ (globalThis).document = prev;
    else delete (/** @type {any} */ (globalThis).document);
  }
}

/** The strings a part's own settings text through. */
const text = (s) => valueOf('text', s);
/** The plain strings of a list value. */
const strings = (value) => itemsOf(value).map((v) => String(/** @type {any} */ (v).data));

/** One part's run(), with the inputs a wire would have gathered. */
function run(type, inputs, settings, extra) {
  const spec = SPECS.get(type);
  const part = { id: 'p1', type, settings: { ...spec.defaults(), ...(settings || {}) }, value: null };
  return spec.run({ part, inputs, app: {}, ask: null, signal: null, thread: null, cache: true, item: null, ...(extra || {}) });
}

/** A fake metered ask: records every call, answers from `reply(i)`. */
function fakeAsk(reply) {
  /** @type {any[]} */ const calls = [];
  return {
    calls,
    json: async (o) => { calls.push(o); return reply(calls.length - 1, o); },
    text: async (o) => { calls.push(o); return reply(calls.length - 1, o); },
    mode: () => 'json',
    vision: () => 'yes',
  };
}

const keepRes = (keep) => ({ ok: true, value: { keep }, mode: 'schema', raw: '', usage: { total_tokens: 7 }, ms: 3, error: null });
const askFail = (kind, message) => ({ ok: false, value: null, mode: 'text', raw: '', usage: null, ms: 1, error: { kind, message: message || '' } });

/** A ctx a render() can be driven through. */
function fakeCtx(part, app) {
  /** @type {any} */ const rec = { patches: [], commits: [], part };
  rec.ctx = {
    update: (p) => { rec.patches.push(p); rec.part = { ...rec.part, settings: { ...rec.part.settings, ...p } }; rec.ctx.part = rec.part; },
    commit: (label) => rec.commits.push(label),
    open: () => {},
    app: app || { farm: { get: () => ({ models: [] }) } },
    part,
  };
  return rec;
}

export default (test) => {
  // ---- Split -----------------------------------------------------------------------------------

  test('Split: lines drops blank lines and trims, and an unknown mode falls back to lines', () => {
    const value = text('  alpha \n\n beta\n\n\ngamma  \n');
    assert.deepEqual(strings(split(value, { mode: 'lines' })), ['alpha', 'beta', 'gamma']);
    assert.deepEqual(strings(split(value, { mode: 'nonsense' })), ['alpha', 'beta', 'gamma']);
    assert.equal(modeOf({ mode: 'nonsense' }), 'lines');
    assert.deepEqual(MODES, ['lines', 'numbered', 'json', 'separator', 'paragraphs']);
  });

  test('Split: numbered drops the preamble, strips the marker and keeps a wrapped line with its item', () => {
    const answer = 'Here are three things:\n1. Paris\n2) Rome\n   the second city\n- Lisbon\n\nHope that helps';
    assert.deepEqual(numbered(answer), ['Paris', 'Rome\nthe second city', 'Lisbon\nHope that helps']);
    assert.deepEqual(strings(split(text(answer), { mode: 'numbered' })), numbered(answer));
    // A preamble alone is not a list: nothing is invented out of it.
    assert.deepEqual(numbered('no markers at all'), []);
  });

  test('Split: json takes an array apart and keeps object items as json', () => {
    const arr = split(text('["a", "b"]'), { mode: 'json' });
    assert.deepEqual(strings(arr), ['a', 'b']);
    assert.deepEqual(itemsOf(arr).map((v) => /** @type {any} */ (v).kind), ['text', 'text']);
    const objs = split(text('[{"id":1},{"id":2}]'), { mode: 'json' });
    assert.deepEqual(itemsOf(objs).map((v) => /** @type {any} */ (v).kind), ['json', 'json']);
    assert.deepEqual(itemsOf(objs).map((v) => /** @type {any} */ (v).data.id), [1, 2]);
    // A json VALUE arrives already parsed, and a lone object is one item, not zero.
    assert.equal(itemsOf(split(valueOf('json', { a: 1 }), { mode: 'json' })).length, 1);
    assert.equal(itemsOf(split(valueOf('json', [1, 2, 3]), { mode: 'json' })).length, 3);
  });

  test('Split: json refuses text that is not JSON instead of making it one item', () => {
    assert.throws(() => split(text('Paris, Rome'), { mode: 'json' }), (err) => {
      assert.equal(err.message, t('parts.errNotJson'));
      assert.equal(err.reason, 'invalid');
      return true;
    });
    assert.throws(() => split(text('   '), { mode: 'json' }), /JSON/);
  });

  test('Split: separator cuts on the typed string and refuses an empty one', () => {
    assert.deepEqual(strings(split(text('a; b;c'), { mode: 'separator', separator: ';' })), ['a', 'b', 'c']);
    assert.deepEqual(strings(split(text('a, b'), { mode: 'separator' })), ['a', 'b'], 'the default separator is a comma');
    assert.throws(() => split(text('a, b'), { mode: 'separator', separator: '' }), (err) => {
      assert.equal(err.message, t('parts.errNoSeparator'));
      return true;
    });
  });

  test('Split: paragraphs cut on blank lines, and `limit` keeps the first n', () => {
    const value = text('one\nstill one\n\ntwo\n\n\nthree');
    assert.deepEqual(strings(split(value, { mode: 'paragraphs' })), ['one\nstill one', 'two', 'three']);
    assert.deepEqual(strings(split(value, { mode: 'paragraphs', limit: 2 })), ['one\nstill one', 'two']);
    assert.deepEqual(strings(split(value, { mode: 'paragraphs', limit: 0 })).length, 3);
  });

  test('Split: run() refuses a split that produced nothing out of text that had some', async () => {
    await assert.rejects(() => run('split', { text: [text('a paragraph with no markers')] }, { mode: 'numbered' }), (err) => {
      assert.equal(err.message, t('parts.errNoItems'));
      return true;
    });
    // Empty text in, empty list out: that is not a failed split, it is an empty one, and an empty
    // list fans zero times (BH-2).
    const out = await run('split', { text: [text('   ')] }, { mode: 'lines' });
    assert.equal(itemsOf(out).length, 0);
    assert.equal(/** @type {any} */ (out).kind, 'list');
  });

  test('Split: the settings UI shows the separator only in separator mode and counts its items', async () => {
    await withDom(async (doc) => {
      const host = doc.createElement('div');
      const part = { id: 'p', type: 'split', settings: { ...SPECS.get('split').defaults() }, value: null };
      const rec = fakeCtx(part);
      const view = SPECS.get('split').render(host, part, rec.ctx);
      const rows = host.querySelectorAll('.graph-part-field');
      assert.ok(rows.length >= 3, 'mode, separator and limit');
      assert.equal(rows[1].hidden, true, 'the separator is hidden while splitting by lines');

      const select = host.querySelector('select');
      select.value = 'separator';
      select.dispatchEvent({ type: 'change' });
      assert.deepEqual(rec.patches, [{ mode: 'separator' }]);
      assert.equal(rec.commits.length, 1, 'one undo entry per pick');
      assert.equal(rows[1].hidden, false, 'and now the separator is the control that matters');

      view.update({ ...part, settings: { ...part.settings, mode: 'separator' }, value: listOf([text('a'), text('b')]) });
      assert.equal(host.querySelector('.graph-part-items').textContent, t('parts.itemsCount', { n: 2 }));
      view.update({ ...part, settings: part.settings, value: listOf([text('a')]) });
      assert.equal(host.querySelector('.graph-part-items').textContent, t('parts.itemsOne'), 'never "1 items"');
      view.destroy();
      assert.equal(host.childNodes.length, 0);
    });
  });

  test('countText says nothing about a value that is not a list', () => {
    assert.equal(countText(null), '');
    assert.equal(countText(text('hello')), '');
    assert.equal(countText(listOf([])), t('parts.itemsCount', { n: 0 }));
  });

  // ---- Repeat ----------------------------------------------------------------------------------

  test('Repeat: N identical items, which the fan plan turns into N real generations', () => {
    const out = passes(text('a poster brief'), { times: 4 });
    assert.equal(itemsOf(out).length, 4);
    assert.deepEqual(strings(out), ['a poster brief', 'a poster brief', 'a poster brief', 'a poster brief']);

    // The salt is what makes four identical prompts four generations (§2.6 BH-5): only the FIRST
    // of a repeated item is unsalted.
    const plan = planFan(SPECS.get('ask'), { in: [out] });
    assert.equal(plan.kind, 'fan');
    assert.equal(plan.n, 4);
    assert.equal(plan.saltFor(0), null, 'the first pass is the plain question');
    assert.deepEqual([plan.saltFor(1), plan.saltFor(2), plan.saltFor(3)], [1, 2, 3]);
  });

  test('Repeat: the template carries the pass number, and a bad count is floored at one', () => {
    const out = passes(text('brief'), { times: 3, template: '{item} — variant {i} of {n}' });
    assert.deepEqual(strings(out), ['brief — variant 1 of 3', 'brief — variant 2 of 3', 'brief — variant 3 of 3']);
    assert.equal(timesOf({ times: 0 }), 1);
    assert.equal(timesOf({ times: -4 }), 1);
    assert.equal(timesOf({}), 1);
    assert.equal(timesOf({ times: '6' }), 6);
    // Distinct texts need no salt — they are already different questions.
    const plan = planFan(SPECS.get('ask'), { in: [out] });
    assert.deepEqual([plan.saltFor(0), plan.saltFor(1), plan.saltFor(2)], [null, null, null]);
  });

  test('Repeat: an unwired Repeat still produces N passes, and a runaway count is refused by name', async () => {
    const bare = await run('repeat', {}, { times: 2 });
    assert.equal(itemsOf(bare).length, 2, 'the downstream part is what repeats — the input is optional');
    assert.throws(() => passes(null, { times: MAX_TIMES + 1 }), (err) => {
      assert.equal(err.message, t('parts.errTooMany', { max: MAX_TIMES }));
      assert.equal(err.reason, 'invalid');
      return true;
    });
    assert.equal(itemsOf(passes(null, { times: MAX_TIMES })).length, MAX_TIMES, 'the limit itself is allowed');
  });

  // ---- Filter: the deterministic modes ----------------------------------------------------------

  test('Filter: contains is case-insensitive, matches is a regex, length is a range', () => {
    assert.equal(keeps('Paris', { mode: 'contains', text: 'ris' }), true);
    assert.equal(keeps('Paris', { mode: 'contains', text: 'PAR' }), true);
    assert.equal(keeps('Rome', { mode: 'contains', text: 'ris' }), false);

    assert.equal(keeps('Paris', { mode: 'matches', text: '^p.ris$' }), true);
    assert.equal(keeps('Paris', { mode: 'matches', text: '^rome' }), false);
    assert.equal(keeps('Paris', { mode: 'matches', text: '' }), false, 'an empty pattern keeps nothing, rather than everything');
    assert.throws(() => keeps('Paris', { mode: 'matches', text: '[' }), (err) => {
      assert.equal(err.message, t('parts.errBadPattern'));
      return true;
    });

    assert.equal(keeps('abcd', { mode: 'length', min: 4 }), true);
    assert.equal(keeps('abc', { mode: 'length', min: 4 }), false);
    assert.equal(keeps('abcdef', { mode: 'length', min: 0, max: 5 }), false);
    assert.equal(keeps('abcde', { mode: 'length', min: 0, max: 5 }), true);
    assert.equal(keeps('anything at all', { mode: 'length', min: 0, max: 0 }), true, 'max 0 means no maximum');
  });

  test('Filter: a pattern that could run for ever is refused, and a model may not write one at all', async () => {
    // `new RegExp(source).test(s)` has no timeout: a nested quantifier backtracks exponentially and
    // the renderer simply stops — with Stop unclickable, because the freeze is inside one macrotask
    // (fix pass, finding 3). Construction was guarded; EXECUTION was not.
    for (const source of ['(a+)+$', '(a*)*b', '(a|aa)+$', '(x+x+)+y']) {
      assert.throws(() => keeps('aaaaaaaaaaaaaaaaaaaaaaaaaaa!', { mode: 'matches', text: source }), (err) => {
        assert.equal(err.message, t('parts.errUnsafePattern'), source);
        assert.equal(err.reason, 'invalid');
        return true;
      }, source);
    }
    assert.equal(safePattern('^p.ris$'), true, 'an ordinary pattern is untouched');
    assert.equal(safePattern('x'.repeat(MAX_PATTERN + 1)), false, 'and a pasted monster is not one');

    // The criterion port accepts text, so an Ask part's output wires straight into it: that is a
    // MODEL-written regular expression, compiled and run over the reader's own text. Refused by
    // name — the pattern belongs in the box, where a person can see it.
    const items = listOf([text('Paris'), text('Rome')]);
    await assert.rejects(
      () => run('filter', { items: [items], criterion: [text('(a+)+$')] }, { mode: 'matches', text: '^p' }),
      (err) => {
        assert.equal(err.message, t('parts.errWiredPattern'));
        assert.equal(err.reason, 'invalid');
        return true;
      },
    );
    assert.deepEqual(
      strings(await run('filter', { items: [items], criterion: [text('rome')] }, { mode: 'contains' })),
      ['Rome'],
      'a wired criterion is still perfectly good in the modes where it is not a program',
    );
  });

  test('Filter: run() keeps the matching items, invert keeps the others, and the wire beats the setting', async () => {
    const items = listOf([text('Paris'), text('Rome'), text('Parma')]);
    assert.deepEqual(strings(await run('filter', { items: [items] }, { mode: 'contains', text: 'par' })), ['Paris', 'Parma']);
    assert.deepEqual(strings(await run('filter', { items: [items] }, { mode: 'contains', text: 'par', invert: true })), ['Rome']);
    assert.deepEqual(
      strings(await run('filter', { items: [items], criterion: [text('rome')] }, { mode: 'contains', text: 'par' })),
      ['Rome'],
      'a wired criterion is the one that counts',
    );
    assert.deepEqual(strings(await run('filter', { items: [listOf([])] }, { mode: 'contains', text: 'par' })), []);
    await assert.rejects(() => run('filter', { items: [items] }, { mode: 'contains', text: '' }), (err) => {
      assert.equal(err.message, t('parts.errNoCriterion'));
      return true;
    });
    // Length needs no criterion at all.
    assert.deepEqual(strings(await run('filter', { items: [items] }, { mode: 'length', min: 5 })), ['Paris', 'Parma']);
  });

  // ---- Filter: the model mode --------------------------------------------------------------------

  test('Filter model mode: one cheap yes/no per item, carrying the criterion and that item', async () => {
    const items = listOf([text('Paris'), text('Rome'), text('Lisbon')]);
    const ask = fakeAsk((i) => keepRes(i !== 1));
    const out = await run('filter', { items: [items] }, { mode: 'model', text: 'is it in France?', model: 'mock-studio-json' }, { ask });

    assert.equal(ask.calls.length, 3, 'one generation per item, no batching behind the reader\'s back');
    assert.deepEqual(strings(out), ['Paris', 'Lisbon'], 'the model\'s verdict is what decides');
    assert.deepEqual(ask.calls.map((c) => c.prompt), [
      verdictPrompt('is it in France?', 'Paris'),
      verdictPrompt('is it in France?', 'Rome'),
      verdictPrompt('is it in France?', 'Lisbon'),
    ]);
    assert.equal(ask.calls[0].task, 'graph:filter', 'tagged as the graph\'s work, not a chat turn');
    assert.equal(ask.calls[0].model, 'mock-studio-json', 'the part\'s own model setting chose the deployment');
    assert.deepEqual(ask.calls[0].schema, KEEP_SCHEMA, 'the same fixed schema every time, so the cache hits');
    assert.equal(ask.calls[0].cacheSalt, undefined, 'never salted: the same item is the same question');
    assert.equal(ask.calls[0].system, t('parts.filterSystem'));

    // inverted: the same three calls, the opposite survivors.
    const ask2 = fakeAsk((i) => keepRes(i !== 1));
    const flipped = await run('filter', { items: [items] }, { mode: 'model', text: 'is it in France?', invert: true }, { ask: ask2 });
    assert.deepEqual(strings(flipped), ['Rome']);
    assert.equal(ask2.calls.length, 3);
  });

  test('Filter model mode: a busy farm is rethrown as a control failure, not blamed on an item', async () => {
    const items = listOf([text('a'), text('b'), text('c')]);
    const ask = fakeAsk((i) => (i === 1 ? askFail('busy', 'seats full') : keepRes(true)));
    await assert.rejects(() => run('filter', { items: [items] }, { mode: 'model', text: 'keep?' }, { ask }), (err) => {
      assert.equal(err.reason, 'busy', 'the runner must see a YIELD, not a wrong part');
      // Critic S1-1: the ask's own sentence rides up to the runner's report (`yieldedBy`).
      assert.equal(err.message, 'seats full');
      return true;
    });
    assert.equal(ask.calls.length, 2, 'and it stopped asking the moment the farm said no');
  });

  test('Filter model mode: the cap thrown by the metered ask travels up untouched', async () => {
    const items = listOf([text('a'), text('b')]);
    const capped = new Error(t('parts.errCapped', { cap: 50 }));
    /** @type {any} */ (capped).reason = 'capped';
    const ask = { json: async () => { throw capped; }, text: async () => { throw capped; }, mode: () => 'json', vision: () => 'yes' };
    await assert.rejects(() => run('filter', { items: [items] }, { mode: 'model', text: 'keep?' }, { ask }), (err) => {
      assert.equal(err, capped, 'the SAME error object: a loop must never re-label the cap');
      assert.equal(err.reason, 'capped');
      return true;
    });
  });

  test('Filter model mode: a farm error on one item fails the part and names the item', async () => {
    const items = listOf([text('a'), text('b'), text('c')]);
    const ask = fakeAsk((i) => (i === 1 ? askFail('farm', 'upstream down') : keepRes(true)));
    await assert.rejects(() => run('filter', { items: [items] }, { mode: 'model', text: 'keep?' }, { ask }), (err) => {
      assert.equal(err.reason, 'part', 'a wrong answer is the part\'s failure, not the run\'s');
      assert.ok(err.message.includes('2'), `the item index is in the sentence: ${err.message}`);
      assert.ok(err.message.includes('upstream down'), err.message);
      return true;
    });
  });

  test('Filter model mode: no criterion and no farm are refused before anything is spent', async () => {
    const items = listOf([text('a')]);
    const ask = fakeAsk(() => keepRes(true));
    await assert.rejects(() => run('filter', { items: [items] }, { mode: 'model', text: '' }, { ask }), (err) => {
      assert.equal(err.message, t('parts.errNoCriterion'));
      return true;
    });
    assert.equal(ask.calls.length, 0);
    await assert.rejects(() => run('filter', { items: [items] }, { mode: 'model', text: 'keep?' }, { ask: null }), (err) => {
      assert.equal(err.message, t('parts.errNoFarm'));
      return true;
    });
  });

  test('Filter: the settings UI swaps its controls per mode and lists the farm\'s models', async () => {
    await withDom(async (doc) => {
      const host = doc.createElement('div');
      const part = { id: 'p', type: 'filter', settings: { ...SPECS.get('filter').defaults() }, value: null };
      const rec = fakeCtx(part, { farm: { get: () => ({ models: [{ id: 'mock-echo' }] }) } });
      const view = SPECS.get('filter').render(host, part, rec.ctx);

      const fields = host.querySelectorAll('.graph-part-field');
      const byLabel = (label) => Array.prototype.find.call(fields, (f) => f.textContent.includes(label));
      assert.ok(byLabel(t('parts.filterMin')).hidden, 'the length range is out of the way in contains mode');
      assert.equal(byLabel(t('parts.filterCriterion')).hidden, false);

      view.update({ ...part, settings: { ...part.settings, mode: 'length' } });
      assert.equal(byLabel(t('parts.filterMin')).hidden, false, 'length mode shows the range');
      assert.equal(byLabel(t('parts.filterCriterion')).hidden, true, 'and hides the criterion it does not use');

      const invert = host.querySelector('.graph-part-check input');
      invert.checked = true;
      invert.dispatchEvent({ type: 'change' });
      assert.deepEqual(rec.patches, [{ invert: true }]);

      const selects = host.querySelectorAll('select');
      const models = Array.prototype.map.call(selects[selects.length - 1].childNodes, (o) => o.value);
      assert.deepEqual(models, ['', 'mock-echo'], 'Automatic plus whatever the farm serves');
      view.destroy();
      assert.equal(host.childNodes.length, 0);
    });
  });
};
