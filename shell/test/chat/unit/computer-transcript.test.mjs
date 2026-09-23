// @ts-check
// K2-U3: the transcript drawer — "what gets sent" (COMPUTER_PLAN §8.1, §11 K2-U3).
//
// The plan's acceptance for this file, in its own words: "the pre-run placeholder rendering; the
// repair-ladder summary from a recorded `ask` result; the cost line's fields." Each is a section
// below, and each is driven through the SHIPPED function rather than a copy of it.
//
// The first section is the one that matters most. §8.1's whole claim is that what you read in the
// Sent tab is what will be sent — so the tab is not allowed to re-render a value, re-order a
// parameter or re-word a heading. It SPLITS the assembled prompt at its own headings, and the
// tests here hold that line: a `##` inside a fenced code value is body text, not a card, and the
// card bodies concatenate back into the bytes `bind.mjs` produced.

import assert from 'node:assert/strict';

import * as model from '../../../renderer/chat/graph/model.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';
import { bindInputs, planFor as planFrom } from '../../../renderer/chat/graph/bind.mjs';
import { budgetFor } from '../../../renderer/chat/ctx/budget.mjs';
import { t } from '../../../renderer/chat/core/i18n.mjs';
import { install as installDrawer } from '../../../renderer/chat/computer/drawer.mjs';
import {
  install as installTranscript, PANEL, TABS, THINK_TYPES,
  splitAssembled, sentView, ladderFor, costView, callLine, truncatedLine,
} from '../../../renderer/chat/computer/transcript.mjs';
import { specs, ids, clock } from './graph-fixture.mjs';
import '../../../renderer/chat/strings/computer.en.mjs';
import '../../../renderer/chat/strings/parts.en.mjs';

// ---------------------------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------------------------

/**
 * A Note (or several) into one Ask, each wire labelled, each upstream value optional.
 * `null` as a value is an upstream that has NOT run — which is the pre-run case this unit exists
 * to render honestly.
 * @param {{instruction?: string, inputs?: {label: string, value: any}[], shape?: string}} o
 */
function graph(o) {
  const now = clock();
  const map = specs();
  const newId = ids('p');
  const newWire = ids('w');
  let doc = model.createDoc({ id: 'g1', threadId: null, now });
  const added = model.addPart(doc, { type: 'ask', x: 0, y: 0 }, { specs: map, newId, now });
  doc = added.doc;
  const ask = added.part.id;
  doc = model.setSettings(doc, ask, {
    instruction: o.instruction || '', shape: o.shape || 'text',
  }, { specs: map, now });
  for (const input of (o.inputs || [])) {
    const up = model.addPart(doc, { type: 'note', x: 0, y: 0 }, { specs: map, newId, now });
    doc = up.doc;
    const wired = model.addWire(doc, { from: up.part.id, to: ask, port: 'in', label: input.label },
      { specs: map, newId: newWire, now });
    assert.equal(wired.ok, true, 'the fixture wired a Note into the Ask');
    doc = wired.doc;
    if (input.value) doc = model.patchPart(doc, up.part.id, { value: input.value }, { now });
  }
  return { doc, ask, specs: map, now };
}

/** The plan exactly as the transcript builds it — the ONE assembly (§2.6 KB-4). */
function planOf(doc, partId, caps) {
  return planFrom({
    part: model.partById(doc, partId),
    bind: bindInputs(doc, partId),
    budget: budgetFor(caps || null),
  });
}

/** Run `fn` with the unit runner's DOM shim installed, as computer-drawer.test.mjs does. */
async function withDom(fn) {
  const doc = /** @type {any} */ (globalThis).__chatTestDom.createDocument();
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const prev = /** @type {any} */ (globalThis).document;
  /** @type {any} */ (globalThis).document = doc;
  const hadWin = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prevWin = /** @type {any} */ (globalThis).window;
  /** @type {any} */ (globalThis).window = { addEventListener() {}, removeEventListener() {} };
  try { return await fn(doc); } finally {
    if (had) /** @type {any} */ (globalThis).document = prev;
    else delete (/** @type {any} */ (globalThis).document);
    if (hadWin) /** @type {any} */ (globalThis).window = prevWin;
    else delete (/** @type {any} */ (globalThis).window);
  }
}

/**
 * The Computer, as much of it as the transcript touches: the skeleton, the REAL drawer (so the
 * panel door is the shipped one and not a stand-in), a farm and a live session whose document the
 * test can advance.
 * @param {any} doc @param {any} [caps]
 */
function surface(doc, caps) {
  const root = document.createElement('div');
  root.id = 'lolcomputer';
  const drawerEl = document.createElement('div');
  drawerEl.className = 'comp-drawer';
  root.appendChild(drawerEl);
  /** @type {Set<Function>} */ const listeners = new Set();
  let live = doc;
  const app = /** @type {any} */ ({
    els: { root, drawer: drawerEl },
    repo: null,
    farm: { get: () => caps || null },
    host: {
      session: {
        doc: () => live,
        on(/** @type {Function} */ fn) { listeners.add(fn); return () => listeners.delete(fn); },
      },
    },
  });
  installDrawer(app);
  installTranscript(app);
  return {
    app,
    root,
    /** Advance the document the way the host's `apply`/`patchPart` do: new doc, then the event. */
    advance(next) { live = next; for (const fn of Array.from(listeners)) fn({ type: 'doc', doc: next }); },
    text: () => root.querySelector('.comp-tx-body').textContent,
    cards: () => Array.from(root.querySelectorAll('.comp-tx-card')),
  };
}

export default (test) => {
  // ---- the contract the other two units import -------------------------------------------------

  test('the panel name and the three tabs are the frozen ones', () => {
    assert.equal(PANEL, 'transcript');
    assert.deepEqual([...TABS], ['sent', 'got', 'cost']);
    assert.deepEqual([...THINK_TYPES], ['ask'], 'the Instruction keeps the type id `ask` (§6.3)');
  });

  // ---- splitting the assembled prompt ----------------------------------------------------------

  test('splitAssembled cuts the prompt at its own headings, instruction last', () => {
    const { doc, ask } = graph({
      instruction: 'write about the topic',
      inputs: [
        { label: 'topic', value: valueOf('text', 'museums') },
        { label: 'notes', value: valueOf('text', 'second') },
      ],
    });
    const plan = planOf(doc, ask);
    const split = splitAssembled(plan.assembled.prompt);
    assert.deepEqual(split.cards.map((c) => c.name), ['topic', 'notes']);
    assert.deepEqual(split.cards.map((c) => c.body), ['museums', 'second']);
    assert.equal(split.instruction, 'write about the topic');
  });

  test('a `##` inside a fenced code value is body, not a card', () => {
    const { doc, ask } = graph({
      instruction: 'explain',
      inputs: [{ label: 'script', value: valueOf('text', '# title\n## not a heading\nx = 1', { format: 'code', lang: 'python' }) }],
    });
    const split = splitAssembled(planOf(doc, ask).assembled.prompt);
    assert.deepEqual(split.cards.map((c) => c.name), ['script'],
      'the fence is opaque — a heading inside it is Python, not structure (§2.6 KB-7)');
    assert.match(split.cards[0].body, /## not a heading/);
  });

  test('an instruction with no inputs still splits, and a prompt with neither is empty', () => {
    const only = graph({ instruction: 'say hello' });
    const split = splitAssembled(planOf(only.doc, only.ask).assembled.prompt);
    assert.deepEqual(split.cards, []);
    assert.equal(split.instruction, 'say hello');

    const nothing = graph({});
    const plan = planOf(nothing.doc, nothing.ask);
    assert.equal(plan.error, 'no-instruction', 'no inputs and no instruction is the one real error');
    assert.deepEqual(splitAssembled(plan.assembled.prompt), { cards: [], instruction: '' });
  });

  // ---- the pre-run placeholder (the plan's first acceptance) -----------------------------------

  test('sentView renders the pre-run placeholder for an input that has not run', () => {
    const { doc, ask } = graph({
      instruction: 'write a problematic about the topic',
      inputs: [{ label: 'topic', value: null }],
    });
    const view = sentView(planOf(doc, ask));
    assert.equal(view.cards.length, 1);
    assert.equal(view.cards[0].name, 'topic');
    assert.equal(view.cards[0].pending, true, 'the card knows it is standing in for a value');
    assert.equal(view.cards[0].body, t('parts.insPending', { name: 'topic' }),
      'and it shows EXACTLY the text the real value will replace');
    assert.equal(view.cards[0].mentioned, true, 'the instruction names it');
  });

  test('sentView pairs each card with its bound parameter, so the tint is the wire\'s kind', () => {
    const { doc, ask } = graph({
      instruction: 'use the list and the code',
      inputs: [
        { label: 'list', value: valueOf('list', ['a', 'b']) },
        { label: 'code', value: valueOf('text', 'x = 1', { format: 'code', lang: 'python' }) },
        { label: '', value: valueOf('text', 'unlabelled') },
      ],
    });
    const view = sentView(planOf(doc, ask));
    assert.deepEqual(view.cards.map((c) => c.kind), ['list', 'code', 'text']);
    assert.equal(view.cards[2].name, t('parts.insPositional', { n: 1 }),
      'an unlabelled arrival is a positional heading, and it is last (rule 9c)');
    assert.equal(view.cards[2].unlabelled, true);
  });

  test('sentView reports the unused and unwired chips, and neither is an error', () => {
    const { doc, ask } = graph({
      instruction: 'write about {theme} using the sources',
      inputs: [
        { label: 'sources', value: valueOf('text', 'a') },
        { label: 'country', value: valueOf('text', 'b') },
      ],
    });
    const view = sentView(planOf(doc, ask));
    assert.deepEqual(view.unused, ['country'], 'supplied last, reported, not dropped (rule 4)');
    assert.deepEqual(view.unwired, ['theme'], 'named with no arrow (rule 5)');
    assert.equal(sentView(null), null, 'and no plan is no view, not a throw');
  });

  test('the call line says what will be asked for, and says `automatic` rather than null', () => {
    const line = callLine({ model: null, shape: 'text', maxTokens: null, priority: 'background' });
    assert.match(line, /model: /);
    assert.equal(line.includes('null'), false, 'a reader is never shown the word null');
    assert.equal(line.split(t('computer.txParamsAuto')).length - 1, 2,
      'both the model and the token cap are the spine\'s to decide');
    const json = callLine({ model: 'gemma4:12b', shape: 'json', maxTokens: 2048, priority: 'background' });
    assert.match(json, /json_schema/);
    assert.match(json, /gemma4:12b/);
    assert.match(json, /2048/);
  });

  test('the truncation badge says `assumed` when the farm never advertised a window', () => {
    const cut = { cut: 120, of: 400, params: [{ name: 'topic', omitted: 120 }] };
    const assumed = truncatedLine({ assembled: { truncated: cut }, budget: { tokens: 28672, chars: 0, assumed: true } });
    const known = truncatedLine({ assembled: { truncated: cut }, budget: { tokens: 28672, chars: 0, assumed: false } });
    assert.equal(assumed, t('parts.insTruncatedAssumed', { cut: 120, of: 400, tokens: 28672 }));
    assert.equal(known, t('parts.insTruncated', { cut: 120, of: 400, tokens: 28672 }));
    assert.equal(truncatedLine({ assembled: { truncated: null }, budget: {} }), '',
      'nothing cut, nothing said');
  });

  // ---- the repair ladder (the plan's second acceptance) -----------------------------------------

  test('a text answer has no ladder — there was nothing to repair', () => {
    assert.deepEqual(ladderFor({ ok: true, mode: 'text', raw: 'hello' }, { shape: 'text' }), []);
    assert.deepEqual(ladderFor(null, { shape: 'json' }), [], 'and no result is no ladder');
  });

  test('a schema answer that came back as JSON is two rungs', () => {
    const rungs = ladderFor({ ok: true, mode: 'schema', raw: '{"a":1}' }, { shape: 'json' });
    assert.deepEqual(rungs.map((r) => r.text), [t('computer.txLadderSchema'), t('computer.txLadderValid')]);
    assert.equal(rungs.every((r) => r.ok), true);
  });

  test('prose with a fenced object is the four-rung ladder §8.1 prints', () => {
    const raw = 'Sure! Here you go:\n```json\n{"a":1}\n```';
    const rungs = ladderFor({ ok: true, mode: 'prompt', raw }, { shape: 'json' });
    assert.deepEqual(rungs.map((r) => r.text), [
      t('computer.txLadderSchema'),
      t('computer.txLadderProse'),
      t('computer.txLadderExtract'),
      t('computer.txLadderValid'),
    ], 'asked with schema -> returned prose -> extracted -> validated');
  });

  test('an answer that never validated ends on a rung that says so', () => {
    const rungs = ladderFor({ ok: false, mode: 'schema', raw: 'I cannot do that.' }, { shape: 'json' });
    assert.equal(rungs[rungs.length - 1].text, t('computer.txLadderFailed'));
    assert.equal(rungs[rungs.length - 1].ok, false, 'the failed rung is the one that is marked');
  });

  // ---- the cost line (the plan's third acceptance) ----------------------------------------------

  test('the cost line carries the seconds, the tokens, the cache verdict and the farm', () => {
    const cost = costView({
      stats: { ms: 3412, tokens: 612, calls: 1 },
      farm: 'Studio Farm',
      value: valueOf('text', 'x'),
    });
    assert.equal(cost.seconds, 3.4, 'tenths of a second, the way §8.1 writes it');
    assert.equal(cost.tokens, 612);
    assert.equal(cost.cached, false);
    assert.equal(cost.farm, 'Studio Farm');
    assert.equal(cost.line, t('computer.txCostLine', {
      seconds: 3.4, tokens: 612, cached: t('computer.txNotCached'), farm: 'Studio Farm',
    }));
  });

  test('a part that produced a value having made no call was answered from the cache', () => {
    const cached = costView({ stats: { ms: 2, tokens: 0, calls: 0 }, farm: 'F', value: valueOf('text', 'x') });
    assert.equal(cached.cached, true, 'the runner meters a call only when one really left the window');
    assert.match(cached.line, new RegExp(t('computer.txCached')));

    const noValue = costView({ stats: { ms: 2, tokens: 0, calls: 0 }, farm: 'F', value: null });
    assert.equal(noValue.cached, false, 'but a part with nothing to show did not hit a cache');
    assert.equal(costView({ stats: null }), null, 'and no run is no cost, not a zero');
  });

  test('with no farm the cost line names that, rather than an empty space', () => {
    const cost = costView({ stats: { ms: 100, tokens: 3, calls: 1 }, farm: '', value: null });
    assert.equal(cost.farm, t('computer.txUnknownFarm'));
  });

  // ---- the panel, mounted in the real drawer ----------------------------------------------------

  test('install publishes the door and mounts a panel into the drawer', async () => {
    await withDom(async () => {
      const { doc, ask } = graph({ instruction: 'hello', inputs: [{ label: 'topic', value: null }] });
      const s = surface(doc);
      const tx = s.app.transcript;
      assert.equal(typeof tx.planFor, 'function', 'the door host.mjs\'s debug.preview() resolves');
      assert.equal(tx.isOpen(), false);
      assert.equal(s.app.drawer.panel(), '', 'nothing is up until something opens');
      assert.equal(tx.open(ask), true);
      assert.equal(s.app.drawer.panel(), PANEL, 'the drawer is showing THIS panel');
      assert.equal(s.app.drawer.isOpen(), true);
      assert.equal(tx.tab(), 'sent', 'Sent is the tab you land on');
      assert.equal(tx.part(), ask);
      assert.equal(tx.close(), true);
      assert.equal(tx.isOpen(), false, 'and closing the drawer puts the panel away');
    });
  });

  test('planFor is the transcript\'s door and answers only for a thinking part', async () => {
    await withDom(async () => {
      const { doc, ask } = graph({ instruction: 'write about the topic', inputs: [{ label: 'topic', value: valueOf('text', 'museums') }] });
      const s = surface(doc);
      const mine = s.app.transcript.planFor(ask);
      const theirs = planOf(doc, ask);
      assert.equal(mine.assembled.prompt, theirs.assembled.prompt,
        'ONE assembly: what the Sent tab reads is byte-identical to what run() will send (§8.1)');
      assert.equal(mine.assembled.system, theirs.assembled.system);
      const note = doc.parts.find((/** @type {any} */ p) => p.type === 'note');
      assert.equal(s.app.transcript.planFor(note.id), null, 'a Note has nothing to send');
      assert.equal(s.app.transcript.planFor('nope'), null);
    });
  });

  test('the Sent tab shows the placeholder, the instruction and the declared call', async () => {
    await withDom(async () => {
      const { doc, ask } = graph({
        instruction: 'write a problematic about the topic',
        inputs: [{ label: 'topic', value: null }],
      });
      const s = surface(doc);
      s.app.transcript.open(ask);
      const text = s.text();
      assert.match(text, new RegExp(escape(t('parts.insPending', { name: 'topic' }))),
        'the pre-run placeholder is on screen before a single generation is spent');
      assert.match(text, /write a problematic about the topic/);
      assert.match(text, new RegExp(escape(callLine({ model: null, shape: 'text', maxTokens: null, priority: 'background' }))));
      const roles = s.cards().map((el) => el.getAttribute('data-role'));
      assert.deepEqual(roles, ['system', 'param', 'instruction'],
        'the system first, the parameters in order, the INSTRUCTION LAST (§5.3)');
      assert.equal(s.cards()[1].getAttribute('data-pending'), 'true');
    });
  });

  test('a renamed wire repaints the open panel — what would be sent changed', async () => {
    await withDom(async () => {
      const g = graph({ instruction: 'write about the topic', inputs: [{ label: 'country', value: valueOf('text', 'France') }] });
      const s = surface(g.doc);
      s.app.transcript.open(g.ask);
      assert.match(s.text(), /## country|country/, 'it starts under the name the wire had');
      assert.equal(s.text().includes('## topic'), false);

      const wire = g.doc.wires[0];
      s.advance(model.setWireLabel(g.doc, wire.id, 'topic', { now: g.now }));
      const after = s.text();
      assert.match(after, /topic/, 'the card is now the name the reader just typed');
      assert.equal(after.includes('country'), false, 'and the old name is gone from the prompt');
    });
  });

  test('Got shows the recorded raw reply verbatim, with its ladder', async () => {
    await withDom(async () => {
      const g = graph({ instruction: 'list three', shape: 'json', inputs: [{ label: 'topic', value: valueOf('text', 'x') }] });
      const s = surface(g.doc);
      s.app.transcript.open(g.ask, 'got');
      assert.equal(s.app.transcript.tab(), 'got');
      assert.equal(s.text(), t('computer.txGotEmpty'), 'nothing ran, and it says so plainly');

      const raw = 'Sure!\n```json\n{"a":1}\n```';
      assert.equal(s.app.transcript.record(g.ask, { ok: true, mode: 'prompt', raw }), true);
      const text = s.text();
      assert.match(text, /\{"a":1\}/, 'the reply, verbatim — nothing paraphrased');
      assert.match(text, new RegExp(escape(t('computer.txLadderExtract'))));
      assert.deepEqual(Object.keys(s.app.transcript.results()), [g.ask]);
    });
  });

  test('Got falls back to the part\'s value when nothing recorded a raw reply', async () => {
    await withDom(async () => {
      const g = graph({ instruction: 'say', inputs: [{ label: 'topic', value: valueOf('text', 'x') }] });
      const s = surface(g.doc);
      s.advance(model.patchPart(g.doc, g.ask, {
        state: 'done', value: valueOf('text', 'the model said this'), stats: { ms: 1200, tokens: 42, calls: 1 },
      }, { now: g.now }));
      s.app.transcript.open(g.ask, 'got');
      assert.match(s.text(), /the model said this/);
      assert.equal(s.text().includes(t('computer.txLadderSchema')), false,
        'a text answer shows no ladder, because nothing was repaired');
    });
  });

  test('Cost shows the run, and a refusal is shown in the box\'s own sentence', async () => {
    await withDom(async () => {
      const g = graph({ instruction: 'say', inputs: [{ label: 'topic', value: valueOf('text', 'x') }] });
      const s = surface(g.doc, { name: 'Studio Farm' });
      s.app.transcript.open(g.ask, 'cost');
      assert.equal(s.text(), t('computer.txCostEmpty'));

      s.advance(model.patchPart(g.doc, g.ask, {
        state: 'done', value: valueOf('text', 'ok'), stats: { ms: 3412, tokens: 612, calls: 1 },
      }, { now: g.now }));
      const text = s.text();
      assert.match(text, /3\.4/);
      assert.match(text, /612/);
      assert.match(text, /Studio Farm/);
      assert.match(text, new RegExp(escape(t('computer.txNotCached'))));

      const refused = model.patchPart(g.doc, g.ask, { state: 'error', error: 'The farm is busy.' }, { now: g.now });
      s.advance(refused);
      assert.match(s.text(), /The farm is busy\./, 'one sentence, no code, no stack (§8.4)');
    });
  });

  test('every tab answers for a part that cannot send anything', async () => {
    await withDom(async () => {
      const g = graph({});
      const s = surface(g.doc);
      s.app.transcript.open(g.ask);
      assert.equal(s.text(), t('computer.txSentEmpty'),
        'no inputs and no instruction: the panel says what is missing rather than showing an empty page');
    });
  });
};

/** A literal string as a regexp fragment — the sentences here carry `·`, `⟨` and `(`. */
function escape(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
