// @ts-check
// C1-U3 in Node: the three C1 parts and the run engine (plan §2.6 BG-5/BG-6, spec §7).
//
// The runner is exercised against REAL graph docs built with the real engine (graph/model.mjs) and
// a fake `app.ask`, because what these tests are about is the behaviour a fake farm can prove:
// how many generations a run spends, which parts a stale edit re-runs, what Stop leaves behind,
// what a failing part does to its downstream, and that a busy farm is a yield and not an error.
// The wire bodies themselves are asserted in the harness (scenarios/c1-run.mjs) against the mock.

import assert from 'node:assert/strict';

import { t } from '../../../renderer/chat/core/i18n.mjs';
import { createDoc, addPart, addWire, setSettings, patchPart } from '../../../renderer/chat/graph/model.mjs';
import { runSet } from '../../../renderer/chat/graph/topo.mjs';
import { valueOf, listOf } from '../../../renderer/chat/graph/values.mjs';
import { specMap, partSpecs } from '../../../renderer/chat/graph/parts/index.mjs';
import { LIST_SCHEMA, stripSig } from '../../../renderer/chat/graph/parts/instruction.mjs';
import { join } from '../../../renderer/chat/graph/parts/collect.mjs';
import { textOf, itemsOf, fillTemplate } from '../../../renderer/chat/graph/parts/common.mjs';
import { createRunner, DEFAULT_MAX_ITEMS } from '../../../renderer/chat/graph/runner.mjs';

const SPECS = specMap();
let seq = 0;
const newId = () => `p${++seq}`;
const now = () => 1000;

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

/** A session exactly as graph/panel.mjs builds one, over a doc held in a closure. */
function makeSession(doc) {
  /** @type {any[]} */ const events = [];
  const session = {
    specs: SPECS,
    doc: () => doc,
    thread: () => null,
    apply(next) { doc = next; },
    patchPart(id, patch) { doc = patchPart(doc, id, patch, { now }); events.push({ id, patch }); },
    select() {}, selected: () => [], setView() {}, undo() {}, redo() {}, undoDepth: () => 0,
    save: async () => {}, inspect() {}, on: () => () => {},
    attach: async () => {},
  };
  return { session, events, get: () => doc };
}

/** A graph: Note -> Instruction -> Collect, the three-part program the spec opens with. The type
 * id is still `ask` (COMPUTER_PLAN §6.3); the port is the Instruction's single `in`. */
function buildGraph(settings = {}) {
  let doc = createDoc({ id: 'g1', threadId: 'th1', now });
  const a = addPart(doc, { type: 'note', x: 0, y: 0, settings: { text: 'Paris' } }, { specs: SPECS, newId, now });
  doc = a.doc;
  const b = addPart(doc, { type: 'ask', x: 200, y: 0, settings: { instruction: 'name three things', ...settings } }, { specs: SPECS, newId, now });
  doc = b.doc;
  const c = addPart(doc, { type: 'collect', x: 400, y: 0 }, { specs: SPECS, newId, now });
  doc = c.doc;
  const w1 = addWire(doc, { from: a.part.id, to: b.part.id, port: 'in' }, { specs: SPECS, newId, now });
  assert.equal(w1.ok, true, 'note -> ask is a legal wire');
  doc = w1.doc;
  const w2 = addWire(doc, { from: b.part.id, to: c.part.id, port: 'items' }, { specs: SPECS, newId, now });
  assert.equal(w2.ok, true, 'ask -> collect is a legal wire');
  doc = w2.doc;
  return { doc, note: a.part.id, ask: b.part.id, collect: c.part.id };
}

/** A fake ask spine that records every call. */
function fakeAsk(answer) {
  /** @type {any[]} */ const calls = [];
  const reply = typeof answer === 'function' ? answer : () => answer;
  const api = {
    calls,
    text: async (o) => { calls.push({ lane: 'text', ...o }); return reply(o, calls.length - 1); },
    json: async (o) => { calls.push({ lane: 'json', ...o }); return reply(o, calls.length - 1); },
    mode: () => 'json',
    vision: () => 'yes',
  };
  return api;
}

const okText = (value, tokens = 11) => ({ ok: true, value, mode: 'text', raw: value, usage: { total_tokens: tokens }, ms: 5, error: null });
const askFail = (kind, message) => ({ ok: false, value: null, mode: 'text', raw: '', usage: null, ms: 1, error: { kind, message } });

export default (test) => {
  // ---- the catalogue -------------------------------------------------------------------------

  test('the catalogue is exactly the shipped parts, each a complete PartSpec', () => {
    // C3 kickoff (plan §2.6 BJ, amending BH-1): the catalogue is the ONE place a part type
    // exists. K1 landing (COMPUTER_PLAN §3.2) DEMOTES two of them: `from-thread` and `to-thread`
    // move out of `partSpecs()` — the palette a reader picks from — and stay in `specMap()`, the
    // set the engine can LOAD, so a graph migrated out of an old chat still opens. Nine in the
    // palette; eleven loadable. Image and Look still wait on P3's attachment intake (BH-10).
    // K3 kickoff (COMPUTER_PLAN §6.6): the six control parts join the palette, at the END — the
    // nine data parts are what a first-time reader meets, the controls are what lesson 9 adds.
    // K4 kickoff (COMPUTER_PLAN §6.4, §6.5, §6.7): Image joins "bring in", Preview REPLACES
    // Render in the palette (Render stays loadable), and the three annotation parts land at the
    // end. `note` keeps its type id and becomes the Text part (graph/parts/text.mjs).
    assert.deepEqual(partSpecs().map((s) => s.type),
      ['note', 'ask', 'split', 'repeat', 'filter', 'code', 'collect', 'preview', 'file', 'image',
        'button', 'condition', 'confirm', 'dialog', 'toggle', 'timer',
        'sticky', 'section', 'title']);
    assert.deepEqual([...specMap().keys()].sort(),
      ['ask', 'button', 'code', 'collect', 'condition', 'confirm', 'dialog', 'file', 'filter',
        'from-thread', 'image', 'note', 'preview', 'render', 'repeat', 'section', 'split',
        'sticky', 'timer', 'title', 'to-thread', 'toggle'],
      'a legacy part left specMap() too — a migrated graph would trip part:unknown-type');
    for (const spec of [...specMap().values()]) {
      assert.equal(typeof spec.label, 'string', `${spec.type} has a resolved label`);
      assert.notEqual(spec.label, '', `${spec.type}'s label is not empty`);
      assert.ok(Array.isArray(spec.inputs), `${spec.type} declares inputs`);
      assert.equal(typeof spec.defaults, 'function');
      assert.equal(typeof spec.render, 'function');
      assert.equal(typeof spec.run, 'function');
      for (const port of spec.inputs) assert.ok(Array.isArray(port.accepts) && port.accepts.length, `${spec.type}.${port.name} declares what it accepts`);
    }
    // `thinks` is what the cap counts (BG-5). Ask always generates; Filter does in model mode.
    // Condition declares `thinks` because `mode:'model'` really does spend one generation — and
    // `thinksFor`, so the plan preview does NOT quote one for a free text-mode Condition (§4.6).
    assert.deepEqual(partSpecs().filter((s) => s.thinks).map((s) => s.type), ['ask', 'filter', 'condition']);
    assert.equal(typeof specMap().get('condition').thinksFor, 'function');
    assert.equal(specMap().get('condition').thinksFor({ settings: { mode: 'text' } }), false);
    assert.equal(specMap().get('condition').thinksFor({ settings: { mode: 'model' } }), true);
    // §4.2's two scheduler declarations exist and belong to exactly the parts that need them.
    assert.deepEqual(partSpecs().filter((s) => s.manual).map((s) => s.type), ['button']);
    assert.deepEqual(partSpecs().filter((s) => s.control).map((s) => s.type),
      ['button', 'condition', 'confirm', 'dialog', 'toggle', 'timer']);
    // The parts with no output are the ones that are an END: Preview SHOWS what arrived (§6.5),
    // the three annotation parts are there for the reader (§6.7), and To thread is the legacy
    // part whose result WAS the conversation (BH-6) — reachable through specMap(), never the
    // palette. K4 kickoff: the annotation three also declare `inert`, which is what keeps them
    // out of every active set (graph/topo.mjs), and `quiet`, which keeps the canvas from
    // printing a value strip under a part that draws its own (graph/canvas.mjs).
    assert.deepEqual([...specMap().values()].filter((s) => s.output === null).map((s) => s.type),
      ['preview', 'sticky', 'section', 'title', 'to-thread']);
    assert.deepEqual(partSpecs().filter((s) => s.inert).map((s) => s.type), ['sticky', 'section', 'title']);
    for (const s of partSpecs().filter((p) => p.inert)) {
      assert.deepEqual(s.inputs, [], `${s.type} is inert, so it has no ports`);
      assert.equal(s.output, null, `${s.type} is inert, so it produces nothing`);
    }
  });

  // ---- values --------------------------------------------------------------------------------

  test('textOf is total: every kind has an honest rendering', () => {
    assert.equal(textOf(valueOf('text', 'hi')), 'hi');
    assert.equal(textOf(valueOf('json', { a: 1 })), '{\n  "a": 1\n}');
    assert.equal(textOf(listOf([valueOf('text', 'a'), valueOf('text', 'b')])), 'a\nb');
    assert.equal(textOf(valueOf('file', { path: 'out/x.md' })), 'out/x.md');
    assert.equal(textOf(null), '');
  });

  test('itemsOf flattens a list and leaves anything else alone', () => {
    assert.equal(itemsOf(listOf([valueOf('text', 'a'), valueOf('text', 'b')])).length, 2);
    assert.equal(itemsOf(valueOf('text', 'a')).length, 1);
    assert.equal(itemsOf(null).length, 0);
  });

  test('fillTemplate fills {item}, {i} and {n}', () => {
    assert.equal(fillTemplate('{i}/{n}: {item}', 'x', 0, 3), '1/3: x');
  });

  // ---- Note ----------------------------------------------------------------------------------

  test('Note answers its own text and never touches the farm', async () => {
    const spec = SPECS.get('note');
    const value = await spec.run({ part: { settings: { text: 'Paris' } }, inputs: {}, app: null, ask: null, signal: null, thread: null, cache: true });
    assert.deepEqual(value, { kind: 'text', data: 'Paris' });
    assert.equal(spec.thinks, false);
  });

  // ---- Instruction (the part `ask` became at the K2 landing) ---------------------------------

  test('an arrow\'s LABEL is the heading its value arrives under, and the instruction is last', async () => {
    // K2: the assembly itself is graph/bind.mjs's, exhaustively covered by computer-bind. What is
    // asserted HERE is that the part hands the runner's arrivals AND their wire labels to it — an
    // unlabelled arrival is numbered, a labelled one keeps the reader's own spelling.
    const ask = fakeAsk(okText('ok'));
    await SPECS.get('ask').run({
      part: { settings: { instruction: 'compare them', model: '', shape: 'text' } },
      inputs: { in: [valueOf('text', 'Paris'), valueOf('text', 'Lyon')] },
      labels: { in: ['', 'second city'] },
      app: null, ask, signal: null, thread: null, cache: true,
    });
    const prompt = ask.calls[0].prompt;
    const positional = `## ${t('parts.insPositional', { n: 1 })}`;
    assert.ok(prompt.startsWith(`${t('parts.insInputsHeading')}\n`), prompt);
    assert.ok(prompt.includes('## second city\nLyon'), prompt);
    assert.ok(prompt.includes(`${positional}\nParis`), prompt);
    assert.ok(prompt.endsWith(`${t('parts.insInstructionHeading')}\ncompare them`), prompt);
    assert.ok(prompt.indexOf('## second city') < prompt.indexOf(positional),
      'rule 9: named parameters come before the unlabelled ones');
  });

  test('Instruction (text) sends the assembled prompt and the chosen model, and returns a text value', async () => {
    const ask = fakeAsk(okText('three things'));
    const spec = SPECS.get('ask');
    const value = await spec.run({
      part: { settings: { instruction: 'name three', model: 'mock-echo', shape: 'text' } },
      inputs: { in: [valueOf('text', 'Paris')] },
      app: null, ask, signal: null, thread: null, cache: true,
    });
    assert.deepEqual(value, { kind: 'text', data: 'three things' });
    assert.equal(ask.calls.length, 1, 'one generation');
    assert.equal(ask.calls[0].lane, 'text');
    assert.equal(ask.calls[0].model, 'mock-echo');
    assert.equal(ask.calls[0].task, 'graph:ask');
    assert.equal(ask.calls[0].prompt, [
      t('parts.insInputsHeading'), '',
      `## ${t('parts.insPositional', { n: 1 })}`, 'Paris', '',
      t('parts.insInstructionHeading'), 'name three',
    ].join('\n'), 'the §5.3 shape: the inputs under their headings, the instruction LAST');
    assert.equal(ask.calls[0].system, t('parts.insSystem'), 'and the frozen system sentence rides with it');
  });

  test('Instruction (list) goes through the json lane and produces a list of text values', async () => {
    const ask = fakeAsk({ ok: true, value: { items: ['a', 'b', 'c'] }, mode: 'schema', usage: null, ms: 1, error: null });
    const value = await SPECS.get('ask').run({
      part: { settings: { instruction: 'three cities', shape: 'list' } },
      inputs: {}, app: null, ask, signal: null, thread: null, cache: true,
    });
    assert.equal(value.kind, 'list');
    assert.equal(value.data.length, 3);
    assert.deepEqual(value.data[0], { kind: 'text', data: 'a' });
    assert.equal(ask.calls[0].lane, 'json');
    assert.deepEqual(ask.calls[0].schema, LIST_SCHEMA);
  });

  // Fix pass, finding 4. The strip advertises the word count of the prompt this box WOULD send,
  // and it is only re-assembled when this signature moves. A runtime write does not move
  // `doc.rev` (`patchPart` is deliberately neither undoable nor rev-bumping), so fingerprinting an
  // arrival by `data.length` left the signature identical when an upstream re-ran and produced a
  // different list or json of the same size — and the box went on showing the old number.
  test('the strip signature moves when an upstream re-runs, whatever kind it produced', () => {
    let doc = createDoc({ id: 'g1', threadId: null, now });
    const up = addPart(doc, { type: 'split', x: 0, y: 0 }, { specs: SPECS, newId, now });
    doc = up.doc;
    const ins = addPart(doc, { type: 'ask', x: 0, y: 0 }, { specs: SPECS, newId, now });
    doc = ins.doc;
    const wired = addWire(doc, { from: up.part.id, to: ins.part.id, port: 'in', label: 'item' },
      { specs: SPECS, newId, now });
    assert.equal(wired.ok, true);
    doc = wired.doc;
    const app = { host: { session: { doc: () => doc } } };
    const part = () => doc.parts.find((p) => p.id === ins.part.id);

    doc = patchPart(doc, up.part.id, { value: listOf([valueOf('text', 'a'), valueOf('text', 'b')]) }, { now });
    const first = stripSig(app, part());
    doc = patchPart(doc, up.part.id, { value: listOf([valueOf('text', 'x'), valueOf('text', 'y')]) }, { now });
    assert.notEqual(stripSig(app, part()), first,
      'a different list of the same size is a different prompt, and the strip has to know');
    const second = stripSig(app, part());
    assert.equal(stripSig(app, part()), second, 'and an unchanged document costs nothing');
  });

  test('Instruction (json) needs a schema, and says so instead of asking for nothing', async () => {
    const ask = fakeAsk(okText('never sent'));
    await assert.rejects(
      SPECS.get('ask').run({ part: { settings: { instruction: 'x', shape: 'json' } }, inputs: {}, app: null, ask, signal: null, thread: null, cache: true }),
      (err) => err.message === t('parts.errNoSchema'),
    );
    await assert.rejects(
      SPECS.get('ask').run({ part: { settings: { instruction: 'x', shape: 'json', schema: '{nope' } }, inputs: {}, app: null, ask, signal: null, thread: null, cache: true }),
      (err) => err.message === t('parts.errBadSchema'),
    );
    assert.equal(ask.calls.length, 0, 'neither refusal spent a seat');
  });

  test('Instruction (json) validates against the reader\'s own schema and answers a json value', async () => {
    const ask = fakeAsk({ ok: true, value: { city: 'Paris' }, mode: 'schema', usage: null, ms: 1, error: null });
    const value = await SPECS.get('ask').run({
      part: { settings: { instruction: 'x', shape: 'json', schema: '{"type":"object","properties":{"city":{"type":"string"}}}' } },
      inputs: {}, app: null, ask, signal: null, thread: null, cache: true,
    });
    assert.deepEqual(value, { kind: 'json', data: { city: 'Paris' } });
    assert.deepEqual(ask.calls[0].schema, { type: 'object', properties: { city: { type: 'string' } } });
  });

  test('an empty Instruction refuses before the farm, and a farmless Ask names the farm', async () => {
    await assert.rejects(
      SPECS.get('ask').run({ part: { settings: {} }, inputs: {}, app: null, ask: fakeAsk(okText('x')), signal: null, thread: null, cache: true }),
      (err) => err.message === t('parts.errNoInstruction'),
    );
    await assert.rejects(
      SPECS.get('ask').run({ part: { settings: { instruction: 'x' } }, inputs: {}, app: null, ask: null, signal: null, thread: null, cache: true }),
      (err) => err.message === t('parts.errNoFarm') && err.reason === 'no-farm',
    );
  });

  test('every ask failure kind becomes its own sentence and its own reason', async () => {
    const cases = [
      ['no_farm', t('parts.errNoFarm'), 'no-farm'],
      ['busy', t('parts.errBusy'), 'busy'],
      ['aborted', t('parts.errAborted'), 'aborted'],
      ['empty', t('parts.errEmpty'), 'empty'],
      ['invalid', t('parts.errInvalid'), 'invalid'],
      ['farm', t('parts.errFarm', { message: 'boom' }), 'farm'],
    ];
    for (const [kind, message, reason] of cases) {
      await assert.rejects(
        SPECS.get('ask').run({
          part: { settings: { instruction: 'x' } }, inputs: {}, app: null,
          ask: fakeAsk(askFail(kind, 'boom')), signal: null, thread: null, cache: true,
        }),
        (err) => err.message === message && err.reason === reason,
        `${kind} -> ${message}`,
      );
    }
  });

  // ---- Collect -------------------------------------------------------------------------------

  test('Collect joins four ways', () => {
    const items = [valueOf('text', 'a'), valueOf('text', 'b')];
    assert.deepEqual(join(items, { mode: 'bullets' }), { kind: 'text', data: '- a\n- b' });
    assert.deepEqual(join(items, { mode: 'numbered' }), { kind: 'text', data: '1. a\n2. b' });
    assert.deepEqual(join(items, { mode: 'json' }), { kind: 'json', data: ['a', 'b'] });
    assert.deepEqual(join(items, { mode: 'template', template: '<{item}>', separator: ', ' }), { kind: 'text', data: '<a>, <b>' });
    assert.deepEqual(join(items, {}).data, '- a\n- b', 'the default is bullets');
  });

  test('Collect flattens a list input and refuses an empty one out loud', async () => {
    const spec = SPECS.get('collect');
    const value = await spec.run({
      part: { settings: { mode: 'numbered' } },
      inputs: { items: [listOf([valueOf('text', 'a'), valueOf('text', 'b')]), valueOf('text', 'c')] },
      app: null, ask: null, signal: null, thread: null, cache: true,
    });
    assert.deepEqual(value, { kind: 'text', data: '1. a\n2. b\n3. c' });
    await assert.rejects(
      spec.run({ part: { settings: {} }, inputs: { items: [listOf([])] }, app: null, ask: null, signal: null, thread: null, cache: true }),
      (err) => err.message === t('parts.errNoInput', { port: t('parts.collectItems') }),
    );
  });

  // ---- rendering -----------------------------------------------------------------------------

  test('every part renders a body, follows an external edit and cleans up after itself', async () => {
    await withDom(async (doc) => {
      for (const spec of partSpecs()) {
        const host = doc.createElement('div');
        const patches = [];
        const commits = [];
        const part = { id: 'x', type: spec.type, settings: spec.defaults(), value: null, state: 'idle' };
        const view = spec.render(host, part, {
          update: (p) => patches.push(p),
          commit: (label) => commits.push(label),
          open: () => {},
          app: { farm: { get: () => ({ models: [{ id: 'mock-echo' }] }) } },
          part,
        });
        assert.ok(host.childNodes.length, `${spec.type} painted something`);
        view.update({ ...part, settings: { ...part.settings, text: 'edited', instruction: 'edited', mode: 'json' } });
        view.destroy();
        assert.equal(host.childNodes.length, 0, `${spec.type} left nothing behind`);
      }
    });
  });

  test('Note\'s textarea reports typing live and commits once on change', async () => {
    await withDom(async (doc) => {
      const host = doc.createElement('div');
      const patches = [];
      const commits = [];
      const part = { id: 'x', type: 'note', settings: { text: '' } };
      SPECS.get('note').render(host, part, { update: (p) => patches.push(p), commit: (l) => commits.push(l), open: () => {}, app: {}, part });
      const area = host.querySelector('textarea');
      area.value = 'hello';
      area.dispatchEvent({ type: 'input' });
      area.dispatchEvent({ type: 'change' });
      assert.deepEqual(patches, [{ text: 'hello' }]);
      assert.equal(commits.length, 1, 'one history entry per edit, not per keystroke');
    });
  });

  // ---- the runner ----------------------------------------------------------------------------

  test('a three-part graph runs in topological order and spends exactly one generation', async () => {
    const g = buildGraph();
    const s = makeSession(g.doc);
    const ask = fakeAsk(okText('three things'));
    const runner = createRunner({ session: s.session, app: { ask, now, repo: null } });

    const report = await runner.run();
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    assert.equal(report.ran, 3, 'all three parts ran');
    assert.equal(report.cancelled, false);
    assert.equal(ask.calls.length, 1, 'exactly one generation — only Ask thinks');
    assert.equal(ask.calls[0].priority, 'background', 'and it went out in the background lane');
    assert.ok(ask.calls[0].signal, 'with the run\'s signal, so Stop can reach it');

    const doc = s.get();
    const states = doc.parts.map((p) => p.state);
    assert.deepEqual(states, ['done', 'done', 'done']);
    const collect = doc.parts.find((p) => p.id === g.collect);
    assert.deepEqual(collect.value, { kind: 'text', data: '- three things' }, 'the Ask answer arrived at Collect as ONE item');
    const asked = doc.parts.find((p) => p.id === g.ask);
    assert.equal(asked.stats.tokens, 11, 'the cost is recorded on the part that spent it');
    assert.equal(typeof asked.stats.ms, 'number');
  });

  test('a stale edit re-runs only the dirty subgraph', async () => {
    const g = buildGraph();
    const s = makeSession(g.doc);
    const ask = fakeAsk(okText('a'));
    const runner = createRunner({ session: s.session, app: { ask, now, repo: null } });
    await runner.run();
    assert.equal(ask.calls.length, 1);

    // Nothing changed: there is nothing to run, and nothing is sent.
    const second = await runner.run();
    assert.equal(second.ran, 0, 'an up-to-date graph runs nothing');
    assert.equal(ask.calls.length, 1, 'and costs nothing');

    // Edit the LAST part: only it is dirty.
    s.session.apply(setSettings(s.get(), g.collect, { mode: 'numbered' }, { specs: SPECS, now }));
    assert.deepEqual(runSet(s.get()), [g.collect]);
    const third = await runner.run();
    assert.equal(third.ran, 1, 'only the edited part ran');
    assert.equal(ask.calls.length, 1, 'the generation was NOT paid twice');
    assert.deepEqual(s.get().parts.find((p) => p.id === g.collect).value, { kind: 'text', data: '1. a' });

    // Edit the FIRST part: it and everything downstream are dirty — one generation again.
    s.session.apply(setSettings(s.get(), g.note, { text: 'Rome' }, { specs: SPECS, now }));
    const fourth = await runner.run();
    assert.equal(fourth.ran, 3);
    assert.equal(ask.calls.length, 2, 'exactly one more generation');
  });

  test('a failing part leaves the rest done and its downstream stale', async () => {
    const g = buildGraph();
    const s = makeSession(g.doc);
    const ask = fakeAsk(askFail('farm', 'upstream is down'));
    const runner = createRunner({ session: s.session, app: { ask, now, repo: null } });

    const report = await runner.run();
    assert.equal(report.errors.length, 1, 'one part failed');
    assert.equal(report.errors[0].partId, g.ask);
    assert.equal(report.errors[0].message, t('parts.errFarm', { message: 'upstream is down' }));
    assert.equal(report.skipped, 1, 'and its downstream was skipped, not run');
    assert.equal(report.ran, 1, 'the Note upstream of it still ran');

    const byId = new Map(s.get().parts.map((p) => [p.id, p]));
    assert.equal(byId.get(g.note).state, 'done');
    assert.equal(byId.get(g.ask).state, 'error');
    assert.equal(byId.get(g.collect).state, 'stale', 'downstream is stale, never error — it was not wrong');
    assert.equal(byId.get(g.collect).value, null);
  });

  test('Stop aborts the in-flight part, keeps every finished value and reports cancelled', async () => {
    const g = buildGraph();
    const s = makeSession(g.doc);
    /** @type {any} */ let runner = null;
    const ask = fakeAsk(async (o) => {
      runner.stop();                                   // the reader presses Stop mid-request
      await new Promise((r) => setTimeout(r, 0));
      return askFail('aborted', 'aborted');
    });
    runner = createRunner({ session: s.session, app: { ask, now, repo: null } });

    const report = await runner.run();
    assert.equal(report.cancelled, true);
    assert.equal(ask.calls.length, 1, 'exactly one request went out, and it was the one aborted');
    const byId = new Map(s.get().parts.map((p) => [p.id, p]));
    assert.deepEqual(byId.get(g.note).value, { kind: 'text', data: 'Paris' }, 'the finished value survived');
    assert.equal(byId.get(g.note).state, 'done');
    assert.equal(byId.get(g.ask).state, 'stale', 'the interrupted part is stale, not error');
    assert.equal(byId.get(g.ask).error, null, 'and carries no error — it was interrupted, not wrong');
    assert.equal(runner.running(), false);

    // Pressing Run again resumes exactly where it stopped.
    ask.calls.length = 0;
    const resumed = await createRunner({ session: s.session, app: { ask: fakeAsk(okText('a')), now, repo: null } }).run();
    assert.equal(resumed.ran, 2, 'the Note did not run again');
  });

  test('a busy farm is a YIELD: the part goes back to stale and the run ends without an error', async () => {
    const g = buildGraph();
    const s = makeSession(g.doc);
    const ask = fakeAsk(askFail('busy', 'busy'));
    const runner = createRunner({ session: s.session, app: { ask, now, repo: null } });

    const report = await runner.run();
    assert.equal(report.yielded, true, 'the report says the graph gave way');
    assert.equal(report.errors.length, 0, 'a yield is not a failure');
    assert.equal(report.cancelled, false, 'nor a cancel');
    const byId = new Map(s.get().parts.map((p) => [p.id, p]));
    assert.equal(byId.get(g.ask).state, 'stale');
    assert.equal(byId.get(g.collect).state, 'stale', 'and the rest is left for the next Run');
    assert.equal(report.skipped, 1);
  });

  test('a list wired into Ask FANS: it runs once per item, where C1 refused', async () => {
    let doc = createDoc({ id: 'g2', threadId: 'th1', now });
    const a = addPart(doc, { type: 'ask', x: 0, y: 0, settings: { instruction: 'list three', shape: 'list' } }, { specs: SPECS, newId, now });
    doc = a.doc;
    const b = addPart(doc, { type: 'ask', x: 200, y: 0, settings: { instruction: 'summarise' } }, { specs: SPECS, newId, now });
    doc = b.doc;
    const w = addWire(doc, { from: a.part.id, to: b.part.id, port: 'in' }, { specs: SPECS, newId, now });
    assert.equal(w.ok, true, 'the wire is legal — Ask declares a text output');
    doc = w.doc;

    const s = makeSession(doc);
    // C1 REFUSED this wire at run time (parts.errFanout) because fan-out did not exist yet. §2.6
    // BH-2 is what the engine does now, and this is the test where C1's sentence became it.
    const ask = fakeAsk({ ok: true, value: { items: ['a', 'b'] }, mode: 'schema', usage: null, ms: 1, error: null });
    const report = await createRunner({ session: s.session, app: { ask, now, repo: null } }).run();
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    assert.equal(ask.calls.length, 3, 'one generation for the list, then ONE PER ITEM downstream');
    const fanned = s.get().parts.find((p) => p.id === b.part.id);
    assert.equal(fanned.state, 'done');
    assert.equal(fanned.value.kind, 'list', 'a fanned part outputs a list, whatever its static output says');
    assert.equal(fanned.value.data.length, 2);
    assert.deepEqual(fanned.fanout, { n: 2, done: 2, ok: 2, failed: 0, hidden: 0, errors: [] });
  });

  test('a port with nothing in it fails the part instead of asking about nothing', async () => {
    let doc = createDoc({ id: 'g3', threadId: 'th1', now });
    const c = addPart(doc, { type: 'collect', x: 0, y: 0 }, { specs: SPECS, newId, now });
    doc = c.doc;
    const s = makeSession(doc);
    const report = await createRunner({ session: s.session, app: { ask: fakeAsk(okText('x')), now, repo: null } }).run();
    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0].message, t('parts.errNoInput', { port: t('parts.collectItems') }));
  });

  test('the cap stops the run at N generations and says so; raising it for this run finishes the job', async () => {
    let doc = createDoc({ id: 'g4', threadId: 'th1', now });
    /** @type {string[]} */ const asks = [];
    for (let i = 0; i < 4; i++) {
      const p = addPart(doc, { type: 'ask', x: i * 100, y: 0, settings: { instruction: `ask ${i}` } }, { specs: SPECS, newId, now });
      doc = p.doc;
      asks.push(p.part.id);
    }
    const s = makeSession(doc);
    const ask = fakeAsk(okText('ok'));
    const runner = createRunner({ session: s.session, app: { ask, now, repo: { kvGet: async () => 2 } } });

    const capped = await runner.run();
    // §2.6 BH-4: the cap moved into the metered ask wrapper, so the report also says what it SPENT.
    assert.deepEqual(capped.capped, { cap: 2, spent: 2, stopped: 2 }, 'it stopped AT the cap and said how much is left');
    assert.equal(ask.calls.length, 2, 'two generations, not four');
    assert.equal(capped.ran, 2);
    assert.equal(s.get().parts.filter((p) => p.state === 'done').length, 2);

    // "Raise the cap for this run" — the same door the toolbar button uses.
    const raised = await runner.run({ maxItems: 10 });
    assert.equal(raised.capped, null);
    assert.equal(raised.ran, 2, 'only the two that had not run');
    assert.equal(ask.calls.length, 4);
    assert.equal(DEFAULT_MAX_ITEMS, 50, 'the default cap is the spec\'s 50 generations');
  });

  test('the run reports progress while it runs and refuses to start twice', async () => {
    const g = buildGraph();
    const s = makeSession(g.doc);
    /** @type {any[]} */ const seen = [];
    /** @type {any} */ let runner = null;
    const ask = fakeAsk(() => {
      seen.push(runner.progress());
      assert.equal(runner.running(), true);
      return okText('a');
    });
    runner = createRunner({ session: s.session, app: { ask, now, repo: null } });
    const off = runner.on((ev) => seen.push(ev.type));

    const both = await Promise.all([runner.run(), runner.run()]);
    off();
    assert.equal(both[1].busy, true, 'the second Run while one is live is refused, not queued');
    assert.equal(both[1].cancelled, false, 'a REFUSAL is not an abort: only a real Stop says cancelled');
    assert.ok(seen.includes('start') && seen.includes('done'), 'listeners heard the run begin and end');
    assert.ok(seen.some((x) => x && x.partId), 'progress named the part being computed');
    assert.equal(runner.progress(), null, 'and there is no progress once it is over');
  });

  test('`only` runs one part and nothing else', async () => {
    const g = buildGraph();
    const s = makeSession(g.doc);
    const ask = fakeAsk(okText('a'));
    const runner = createRunner({ session: s.session, app: { ask, now, repo: null } });
    await runner.run();
    const before = ask.calls.length;
    const report = await runner.run({ only: [g.ask], cache: false });
    assert.equal(report.ran, 1);
    assert.equal(ask.calls.length, before + 1);
    assert.equal(ask.calls[ask.calls.length - 1].cache, false, 'a per-part Re-run does not replay a cached answer');
  });
};
