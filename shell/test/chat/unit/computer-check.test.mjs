// K5-U3 (COMPUTER_PLAN §10.1 mechanism 3; addendum KE-5): the checkpoint interpreter, PURE, tested
// in Node against fixture docs built with the SAME model functions the canvas uses — every matcher
// shape, the latch, the manual step, the progress record — and against the SHIPPED lessons: the
// Tour walked step by step, and every lesson on the shelf checked for the two promises the
// mechanic makes (a lesson never starts pre-ticked; a lesson that needs the farm is never a dead
// end without it).
import assert from 'node:assert/strict';

import {
  CHECK_KINDS, CHECK_FIELDS, cmp, evaluate, advance, tickManual, freshProgress, refsOf,
} from '../../../renderer/chat/computer/tutorial/check.mjs';
import { LESSONS, lessonById } from '../../../renderer/chat/computer/tutorial/registry.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';
import { creativePresets } from '../../../renderer/chat/graph/parts/creative.mjs';
import { createDoc, addPart, addWire, removeParts, patchPart, setSettings, normaliseDoc, setWireLabel } from '../../../renderer/chat/graph/model.mjs';

const SPECS = specMap();
let n = 0;
const newId = () => `x${++n}`;
const O = { specs: SPECS, newId, now: () => 1 };

/** A doc with parts placed through addPart (so defaults are real). */
function build() {
  let doc = createDoc({ id: 'd', threadId: null, now: () => 1 });
  const place = (type, settings = {}) => {
    const out = addPart(doc, { type, x: 0, y: 0, settings }, O);
    doc = out.doc;
    return out.part.id;
  };
  const wire = (from, to, port, label) => {
    const out = addWire(doc, { from, to, port, label }, O);
    assert.ok(out.ok, `fixture wire ${from}→${to}:${port} (${out.reason || ''})`);
    doc = out.doc;
    return out.wire.id;
  };
  return { get doc() { return doc; }, set doc(d) { doc = d; }, place, wire };
}

/** The shipped doc as the rail forks it (normalised, authored ids). */
const fork = (lesson) => normaliseDoc({ ...lesson.doc, id: 'fork', threadId: null }, { specs: SPECS, now: () => 1 }).doc;

/** Every sub-check, walking all/any. */
function* flat(check) {
  if (!check || typeof check !== 'object') return;
  yield check;
  for (const k of ['all', 'any']) if (Array.isArray(check[k])) for (const c of check[k]) yield* flat(c);
}

export default (test) => {
  test('the vocabulary is frozen: eight kinds, the fields per kind', () => {
    assert.deepEqual([...CHECK_KINDS], ['has', 'wire', 'ran', 'report', 'edited', 'all', 'any', 'manual']);
    assert.ok(Object.isFrozen(CHECK_KINDS) && Object.isFrozen(CHECK_FIELDS));
    assert.deepEqual([...CHECK_FIELDS.has], ['id', 'type', 'preset', 'setting', 'nonEmpty', 'equals', 'count']);
    assert.deepEqual([...CHECK_FIELDS.wire], ['from', 'to', 'fromType', 'toType', 'fromPreset', 'toPreset', 'port', 'label', 'count']);
    assert.deepEqual([...CHECK_FIELDS.ran], ['partId', 'type', 'preset', 'state', 'demoOk']);
    assert.deepEqual([...CHECK_FIELDS.report], ['generations', 'ran', 'errors', 'stopped']);
    assert.deepEqual([...CHECK_FIELDS.edited], ['partId', 'setting']);
  });

  test('cmp: a number is ==, the five operators, whitespace, and a malformed count is never true', () => {
    assert.equal(cmp(3, 3), true);
    assert.equal(cmp(3, 2), false);
    assert.equal(cmp(3, '>=3'), true);
    assert.equal(cmp(2, '>=3'), false);
    assert.equal(cmp(2, '<=2'), true);
    assert.equal(cmp(3, '<=2'), false);
    assert.equal(cmp(2, '>1'), true);
    assert.equal(cmp(1, '>1'), false);
    assert.equal(cmp(3, '<4'), true);
    assert.equal(cmp(4, '<4'), false);
    assert.equal(cmp(0, '==0'), true);
    assert.equal(cmp(1, '==0'), false);
    assert.equal(cmp(5, ' >= 5 '), true);
    assert.equal(cmp(2, '2'), true, 'a bare number string is ==');
    assert.equal(cmp(1, undefined), true, 'absent means at least one');
    assert.equal(cmp(0, undefined), false);
    for (const bad of ['lots', '=>2', '>=', '', '2.5', '-1', null]) assert.equal(cmp(2, bad), false, `"${bad}" is never satisfied`);
  });

  test('has: by id, type and preset; a setting non-empty or equal; counts including zero', () => {
    const b = build();
    const note = b.place('note');
    const ask = b.place('ask', { instruction: '' });
    const svg = b.place('preview', { mode: 'svg' });
    assert.equal(evaluate({ has: { type: 'note' } }, { doc: b.doc }), true);
    assert.equal(evaluate({ has: { type: 'split' } }, { doc: b.doc }), false);
    assert.equal(evaluate({ has: { id: note } }, { doc: b.doc }), true);
    assert.equal(evaluate({ has: { id: 'nope' } }, { doc: b.doc }), false);
    assert.equal(evaluate({ has: { id: 'nope', count: 0 } }, { doc: b.doc }), true, 'count 0 asks for absence');
    assert.equal(evaluate({ has: { id: note, count: '==0' } }, { doc: b.doc }), false);
    assert.equal(evaluate({ has: { preset: 'svg' } }, { doc: b.doc }), true);
    assert.equal(evaluate({ has: { preset: 'p5' } }, { doc: b.doc }), false);
    assert.equal(evaluate({ has: { type: 'preview', preset: 'svg', id: svg } }, { doc: b.doc }), true, 'fields AND together');
    assert.equal(evaluate({ has: { type: 'note', preset: 'svg' } }, { doc: b.doc }), false);
    assert.equal(evaluate({ has: { id: ask, setting: 'instruction', nonEmpty: true } }, { doc: b.doc }), false, 'empty is not non-empty');
    b.doc = setSettings(b.doc, ask, { instruction: '   ' }, O);
    assert.equal(evaluate({ has: { id: ask, setting: 'instruction', nonEmpty: true } }, { doc: b.doc }), false, 'whitespace is not non-empty');
    b.doc = setSettings(b.doc, ask, { instruction: 'A haiku about the sea.' }, O);
    assert.equal(evaluate({ has: { id: ask, setting: 'instruction', nonEmpty: true } }, { doc: b.doc }), true);
    assert.equal(evaluate({ has: { type: 'preview', setting: 'mode', equals: 'svg' } }, { doc: b.doc }), true);
    assert.equal(evaluate({ has: { type: 'preview', setting: 'mode', equals: 'html' } }, { doc: b.doc }), false);
    b.place('note', { text: 'two' });
    assert.equal(evaluate({ has: { type: 'note', count: '>=2' } }, { doc: b.doc }), true);
    assert.equal(evaluate({ has: { type: 'note', setting: 'text', nonEmpty: true, count: 1 } }, { doc: b.doc }), true, 'the setting filter narrows the count');
  });

  test('wire: ends by id, type and preset; the port; the label blank, non-empty or a name (casefolded)', () => {
    const b = build();
    const note = b.place('note', { text: 'x' });
    const ask = b.place('ask', { instruction: 'y' });
    const write = b.place('ask', { code: 'svg' });
    const svg = b.place('preview', { mode: 'svg' });
    const w1 = b.wire(note, ask, 'in');
    b.wire(write, svg, 'content');
    assert.equal(evaluate({ wire: { from: note, to: ask } }, { doc: b.doc }), true);
    assert.equal(evaluate({ wire: { from: ask, to: note } }, { doc: b.doc }), false, 'direction matters');
    assert.equal(evaluate({ wire: { fromType: 'note', toType: 'ask' } }, { doc: b.doc }), true);
    assert.equal(evaluate({ wire: { fromPreset: 'write-svg', toPreset: 'svg' } }, { doc: b.doc }), true);
    assert.equal(evaluate({ wire: { fromPreset: 'write-p5' } }, { doc: b.doc }), false);
    assert.equal(evaluate({ wire: { to: svg, port: 'content' } }, { doc: b.doc }), true);
    assert.equal(evaluate({ wire: { to: svg, port: 'in' } }, { doc: b.doc }), false);
    assert.equal(evaluate({ wire: { from: note, label: 'blank' } }, { doc: b.doc }), true);
    assert.equal(evaluate({ wire: { from: note, label: 'nonEmpty' } }, { doc: b.doc }), false);
    b.doc = setWireLabel(b.doc, w1, '  The   Topic ', O);
    assert.equal(evaluate({ wire: { from: note, label: 'nonEmpty' } }, { doc: b.doc }), true);
    assert.equal(evaluate({ wire: { from: note, label: 'blank' } }, { doc: b.doc }), false);
    assert.equal(evaluate({ wire: { from: note, label: 'the topic' } }, { doc: b.doc }), true, 'a name compares casefolded, whitespace collapsed');
    assert.equal(evaluate({ wire: { from: note, label: 'country' } }, { doc: b.doc }), false);
    assert.equal(evaluate({ wire: { count: 2 } }, { doc: b.doc }), true);
    assert.equal(evaluate({ wire: { count: '>=3' } }, { doc: b.doc }), false);
    // A wire whose end is gone does not count (removeParts drops it anyway; a hand-made doc may not).
    const dangling = { ...b.doc, wires: [...b.doc.wires, { id: 'wz', from: 'ghost', to: ask, port: 'in', label: '' }] };
    assert.equal(evaluate({ wire: { to: ask, count: 1 } }, { doc: dangling }), true, 'only real wires are counted');
  });

  test('ran: a state (done by default), by id, type or preset — and a demo answer counts unless demoOk:false', () => {
    const b = build();
    const ask = b.place('ask', { instruction: 'x' });
    const svg = b.place('preview', { mode: 'svg' });
    assert.equal(evaluate({ ran: { partId: ask } }, { doc: b.doc }), false, 'idle is not ran');
    b.doc = patchPart(b.doc, ask, { state: 'error', error: 'no farm' }, O);
    assert.equal(evaluate({ ran: { partId: ask } }, { doc: b.doc }), false);
    assert.equal(evaluate({ ran: { partId: ask, state: 'error' } }, { doc: b.doc }), true, 'a state can be asked for');
    b.doc = patchPart(b.doc, ask, { value: { kind: 'text', data: 'saved' }, state: 'done', error: null, demo: true }, O);
    assert.equal(evaluate({ ran: { partId: ask } }, { doc: b.doc }), true, 'the saved answer ticks a ran: step (§10.2)');
    assert.equal(evaluate({ ran: { type: 'ask' } }, { doc: b.doc }), true);
    assert.equal(evaluate({ ran: { partId: ask, demoOk: false } }, { doc: b.doc }), false, 'unless the step insists on a real generation');
    b.doc = patchPart(b.doc, ask, { value: { kind: 'text', data: 'real' }, state: 'done' }, O);
    assert.equal(evaluate({ ran: { partId: ask, demoOk: false } }, { doc: b.doc }), true, 'a real value clears the flag, and then it counts');
    assert.equal(evaluate({ ran: { preset: 'svg' } }, { doc: b.doc }), false);
    b.doc = patchPart(b.doc, svg, { value: { kind: 'text', data: '<svg/>' }, state: 'done' }, O);
    assert.equal(evaluate({ ran: { preset: 'svg' } }, { doc: b.doc }), true);
  });

  test('report: nothing before a run; generations, ran, errors and each kind of stop', () => {
    const doc = createDoc({ id: 'd', threadId: null, now: () => 1 });
    assert.equal(evaluate({ report: { generations: '>=0' } }, { doc, report: null }), false, 'no run yet, no report');
    const r = { ran: 4, generations: 3, errors: [{ partId: 'a', message: 'x' }], capped: null, cancelled: false, yielded: false };
    assert.equal(evaluate({ report: { generations: '>=3' } }, { doc, report: r }), true);
    assert.equal(evaluate({ report: { generations: '>=4' } }, { doc, report: r }), false);
    assert.equal(evaluate({ report: { ran: 4, errors: 1 } }, { doc, report: r }), true, 'every field must hold');
    assert.equal(evaluate({ report: { ran: 4, errors: 0 } }, { doc, report: r }), false);
    assert.equal(evaluate({ report: { stopped: 'capped' } }, { doc, report: r }), false);
    assert.equal(evaluate({ report: { stopped: 'capped' } }, { doc, report: { ...r, capped: { cap: 50, spent: 50, stopped: 2 } } }), true);
    assert.equal(evaluate({ report: { stopped: 'cancelled' } }, { doc, report: { ...r, cancelled: true } }), true);
    assert.equal(evaluate({ report: { stopped: 'yielded' } }, { doc, report: { ...r, yielded: true } }), true);
    assert.equal(evaluate({ report: { stopped: 'yielded' } }, { doc, report: r }), false);
  });

  test('edited: a setting that differs from the SHIPPED doc; the default an author left out counts as shipped', () => {
    const lesson = { doc: { lolgraph: 1, parts: [{ id: 'p_ask', type: 'ask', x: 0, y: 0, settings: { instruction: 'Write a haiku.' } }], wires: [] } };
    const base = fork(lesson);
    assert.equal(evaluate({ edited: { partId: 'p_ask', setting: 'instruction' } }, { doc: base, base }), false, 'untouched');
    const changed = setSettings(base, 'p_ask', { instruction: 'Write a limerick.' }, O);
    assert.equal(evaluate({ edited: { partId: 'p_ask', setting: 'instruction' } }, { doc: changed, base }), true);
    // `model` was never written by the author: normalisation gives it the default on both sides.
    assert.equal(evaluate({ edited: { partId: 'p_ask', setting: 'model' } }, { doc: changed, base }), false, 'a default is not an edit');
    assert.equal(evaluate({ edited: { partId: 'gone', setting: 'instruction' } }, { doc: changed, base }), false, 'a part that is not there was not edited');
    const removed = removeParts(changed, ['p_ask'], O);
    assert.equal(evaluate({ edited: { partId: 'p_ask', setting: 'instruction' } }, { doc: removed, base }), false);
  });

  test('all / any / manual, and malformed checks are never satisfied', () => {
    const b = build();
    b.place('note', { text: 'x' });
    const T = { has: { type: 'note' } };
    const F = { has: { type: 'split' } };
    assert.equal(evaluate({ all: [T, T] }, { doc: b.doc }), true);
    assert.equal(evaluate({ all: [T, F] }, { doc: b.doc }), false);
    assert.equal(evaluate({ all: [] }, { doc: b.doc }), false, 'an empty all is not a free tick');
    assert.equal(evaluate({ any: [F, T] }, { doc: b.doc }), true);
    assert.equal(evaluate({ any: [F, F] }, { doc: b.doc }), false);
    assert.equal(evaluate({ any: [] }, { doc: b.doc }), false);
    assert.equal(evaluate({ all: [T, { any: [F, { all: [T] }] }] }, { doc: b.doc }), true, 'nests');
    assert.equal(evaluate({ manual: true }, { doc: b.doc }), false, 'a manual step is never ticked by a predicate');
    assert.equal(evaluate({ all: [T, { manual: true }] }, { doc: b.doc }), false);
    assert.equal(evaluate({ has: { type: 'note' }, wire: {} }, { doc: b.doc }), false, 'two keys is not a check');
    assert.equal(evaluate({}, { doc: b.doc }), false);
    assert.equal(evaluate({ sparkle: {} }, { doc: b.doc }), false);
    assert.equal(evaluate(null, { doc: b.doc }), false);
    assert.equal(evaluate([T], { doc: b.doc }), false);
    assert.equal(evaluate(T, { doc: null }), false, 'no doc, nothing is there');
  });

  test('advance: ticks in order, stops at the first open step, never skips ahead, latches, never mutates', () => {
    const lesson = {
      id: 'lx', steps: [
        { id: 'a', text: 'a', check: { has: { type: 'note' } } },
        { id: 'b', text: 'b', check: { has: { type: 'ask' } } },
        { id: 'c', text: 'c', check: { has: { type: 'split' } } },
      ],
    };
    const b = build();
    const empty = b.doc;
    let p = advance(lesson, freshProgress(), { doc: empty, now: 9 });
    assert.deepEqual([p.step, p.ticks], [0, []]);
    // b is satisfied, a is not: nothing ticks — the rail teaches in order.
    const askOnly = addPart(empty, { type: 'ask', x: 0, y: 0 }, O).doc;
    p = advance(lesson, p, { doc: askOnly, now: 9 });
    assert.deepEqual([p.step, p.ticks], [0, []], 'a later step being true does not tick while an earlier one is open');
    // a and b both true: both tick in one pass.
    const both = addPart(askOnly, { type: 'note', x: 0, y: 0 }, O).doc;
    const frozen = Object.freeze({ ...p, ticks: Object.freeze([...p.ticks]) });
    p = advance(lesson, frozen, { doc: both, now: 9 });
    assert.deepEqual([p.step, p.ticks], [2, ['a', 'b']]);
    assert.deepEqual(frozen.ticks, [], 'the input progress is untouched');
    assert.equal(p.doneAt, null);
    // Break a and b: the ticks stay (latch).
    p = advance(lesson, p, { doc: empty, now: 9 });
    assert.deepEqual([p.step, p.ticks], [2, ['a', 'b']], 'a latched tick never un-ticks');
    const all = addPart(empty, { type: 'split', x: 0, y: 0 }, O).doc;
    p = advance(lesson, p, { doc: all, now: 42 });
    assert.deepEqual([p.step, p.ticks, p.doneAt], [3, ['a', 'b', 'c'], 42], 'the last tick stamps doneAt from ctx.now');
    p = advance(lesson, p, { doc: all, now: 99 });
    assert.equal(p.doneAt, 42, 'doneAt is stamped once');
  });

  test('advance survives stored progress it did not write: missing fields, junk, a step past the end', () => {
    const lesson = { id: 'lx', steps: [{ id: 'a', text: 'a', check: { has: { type: 'note' } } }, { id: 'b', text: 'b', check: { manual: true } }] };
    const doc = createDoc({ id: 'd', threadId: null, now: () => 1 });
    for (const junk of [null, undefined, 7, 'x', {}, { ticks: 'no', demo: 3 }, { step: -4 }, { step: 'two' }]) {
      const p = advance(lesson, junk, { doc });
      assert.equal(p.step, 0, `from ${JSON.stringify(junk)}`);
      assert.ok(Array.isArray(p.ticks) && Array.isArray(p.demo));
      assert.equal(p.forkedDocId, null);
    }
    const past = advance(lesson, { step: 17, ticks: ['a', 'b'], doneAt: 5 }, { doc });
    assert.equal(past.step, 2, 'a step past the end (a lesson that lost a step) is clamped');
    assert.equal(past.doneAt, 5);
    const kept = advance(lesson, { step: 0, ticks: ['a'], forkedDocId: 'f1' }, { doc });
    assert.deepEqual([kept.step, kept.forkedDocId], [1, 'f1'], 'a step already ticked is passed over; the fork id is kept');
  });

  test('tickManual: only the CURRENT step, only a manual one; the next predicate step then ticks through advance', () => {
    const lesson = {
      id: 'lx', steps: [
        { id: 'look', text: 'look', check: { manual: true } },
        { id: 'add', text: 'add', check: { has: { type: 'note' } } },
        { id: 'bye', text: 'bye', check: { manual: true } },
      ],
    };
    const b = build();
    b.place('note');
    let p = advance(lesson, freshProgress(), { doc: b.doc });
    assert.equal(p.step, 0, 'the manual step waits for its button even though step 2 is already true');
    assert.equal(tickManual(lesson, p, 'bye').step, 0, 'a button for a step that is not current does nothing');
    assert.equal(tickManual(lesson, p, 'add').step, 0, 'nor for a step that is not manual');
    p = tickManual(lesson, p, 'look');
    assert.deepEqual([p.step, p.ticks], [1, ['look']]);
    p = advance(lesson, p, { doc: b.doc, now: 3 });
    assert.deepEqual([p.step, p.ticks], [2, ['look', 'add']]);
    p = tickManual(lesson, p, 'bye');
    p = advance(lesson, p, { doc: b.doc, now: 4 });
    assert.deepEqual([p.step, p.doneAt], [3, 4], 'the last manual tick finishes the lesson');
    assert.equal(tickManual(lesson, p, 'bye').ticks.length, 3, 'a finished lesson takes no more ticks');
  });

  test('refsOf: every id, preset, type and count a check names, through all/any', () => {
    const r = refsOf({
      all: [
        { has: { id: 'p_a', type: 'ask', count: '>=2' } },
        { any: [{ wire: { from: 'p_a', toPreset: 'svg', fromType: 'note' } }, { ran: { preset: 'write-svg', partId: 'p_b' } }] },
        { report: { generations: '>=3', errors: 0 } },
        { manual: true },
      ],
    });
    assert.deepEqual(r.kinds, ['all', 'has', 'any', 'wire', 'ran', 'report', 'manual']);
    assert.deepEqual(r.parts.sort(), ['p_a', 'p_a', 'p_b']);
    assert.deepEqual(r.presets.sort(), ['svg', 'write-svg']);
    assert.deepEqual(r.types.sort(), ['ask', 'note']);
    assert.deepEqual(r.cmps, ['>=2', '>=3', 0]);
    assert.ok(r.fields.includes('ran.preset') && r.fields.includes('wire.toPreset'));
  });

  test('the Tour: needs no farm, and walks step by step — each tick earned by its own action, none before', () => {
    const tour = lessonById('l00-tour');
    assert.ok(tour, 'the Tour is on the shelf');
    assert.equal(LESSONS[0].id, 'l00-tour', 'the Tour is first on the shelf');
    assert.equal(tour.n, 0);
    assert.equal(tour.needsFarm, 'no');
    assert.ok(lessonById(tour.next), 'the Tour leads somewhere');
    // Nothing in it thinks: no Instruction, no step that waits on a generation.
    const thinking = new Set(['ask']);
    assert.ok(!tour.doc.parts.some((p) => thinking.has(p.type)), 'the Tour ships no thinking part');
    for (const s of tour.steps) {
      for (const c of flat(s.check)) {
        if (c.ran) assert.ok(!thinking.has(c.ran.type) && !(c.ran.preset || '').startsWith('write-'), `${s.id} never waits on the farm`);
        if (c.report) assert.ok(!c.report.generations || cmp(0, c.report.generations), `${s.id} needs no generation`);
      }
    }
    const base = fork(tour);
    const { dropped } = normaliseDoc({ ...tour.doc, id: 'fork', threadId: null }, { specs: SPECS, now: () => 1 });
    assert.deepEqual(dropped, [], 'the Tour opens whole');
    const ctx = (doc) => ({ doc, base, report: null, now: 7 });
    const ids = tour.steps.map((s) => s.id);
    const expectStep = (p, id, why) => assert.equal(tour.steps[p.step] && tour.steps[p.step].id, id, why);

    let doc = base;
    let p = advance(tour, freshProgress(), ctx(doc));
    assert.equal(p.step, 0, 'the shipped Tour ticks nothing by itself');
    expectStep(p, 's-look', 'it starts by looking around');
    p = tickManual(tour, p, 's-look');
    p = advance(tour, p, ctx(doc));
    expectStep(p, 's-add', 'Got it moves to adding a box, and nothing else ticks');

    // The learner picks Text from the ＋ menu (addPart is what placeEntry calls).
    const added = addPart(doc, { type: 'note', x: 300, y: 300 }, O);
    doc = added.doc;
    const note = added.part.id;
    p = advance(tour, p, ctx(doc));
    expectStep(p, 's-type', 'adding a Text box ticks "add"');

    doc = setSettings(doc, note, { text: 'Hello from the tour.' }, O);
    p = advance(tour, p, ctx(doc));
    expectStep(p, 's-wire', 'typing ticks "type"');

    // Wiring into the WRONG box does not tick; into the Markdown view does.
    const view = doc.parts.find((x) => x.id === 'p_view');
    assert.ok(view && view.settings.mode === 'markdown', 'the Tour ships a Markdown view');
    const w = addWire(doc, { from: note, to: 'p_view', port: 'content' }, O);
    assert.ok(w.ok, `the Text box wires into the Markdown view (${w.reason || ''})`);
    doc = w.doc;
    p = advance(tour, p, ctx(doc));
    expectStep(p, 's-run', 'the wire ticks "wire"');

    doc = patchPart(doc, note, { value: { kind: 'text', data: 'Hello from the tour.' }, state: 'done' }, O);
    doc = patchPart(doc, 'p_view', { value: { kind: 'text', data: 'Hello from the tour.' }, state: 'done' }, O);
    p = advance(tour, p, ctx(doc));
    expectStep(p, 's-delete', 'running the view ticks "run" — no farm involved');

    doc = removeParts(doc, ['p_bin'], O);
    p = advance(tour, p, ctx(doc));
    expectStep(p, 's-undo', 'deleting the sticky ticks "delete", and "undo" is NOT ticked by the same doc');

    doc = base.parts.find((x) => x.id === 'p_bin') ? { ...doc, parts: [...doc.parts, base.parts.find((x) => x.id === 'p_bin')] } : doc;
    p = advance(tour, p, ctx(doc));
    expectStep(p, 's-library', 'the sticky coming back ticks "undo"');
    assert.equal(p.doneAt, null, 'not finished before the last Got it');
    p = tickManual(tour, p, 's-library');
    p = advance(tour, p, ctx(doc));
    assert.equal(p.step, tour.steps.length);
    assert.deepEqual(p.ticks, ids, 'every step ticked, in order');
    assert.equal(p.doneAt, 7);
  });

  test('the Tour: every step says something, every Show points at a real box or a real ＋ row', () => {
    const tour = lessonById('l00-tour');
    const entries = new Set([...SPECS.keys(), ...creativePresets().map((x) => x.id)]);
    const partIds = new Set(tour.doc.parts.map((x) => x.id));
    for (const s of tour.steps) {
      assert.ok(s.text.length > 20 && s.text.length < 180, `${s.id} is one sentence`);
      if (!s.show) continue;
      if (s.show.menu) assert.ok(entries.has(s.show.menu), `${s.id} opens the menu on a real row`);
      if (s.show.partId) assert.ok(partIds.has(s.show.partId), `${s.id} points at a box the Tour ships`);
    }
    // The furniture sits clear of the rail's dock (bottom-left, ~300 px wide) at the shipped view.
    for (const part of tour.doc.parts) {
      const underRail = part.x < 320 && part.y + part.h > 400;
      assert.ok(!underRail, `${part.id} is not under the step rail`);
    }
  });

  test('every lesson on the shelf: opens whole, starts on step 1 unticked, and needs-farm lessons carry saved answers', () => {
    for (const lesson of LESSONS) {
      const base = fork(lesson);
      const p = advance(lesson, freshProgress(), { doc: base, base, report: null, now: 1 });
      assert.equal(p.step, 0, `${lesson.id}: the shipped doc ticks no step — a tick is earned, never given`);
      assert.equal(p.doneAt, null);
      if (lesson.needsFarm === 'no') continue;
      // Never a dead end (§10.2): every thinking part a `ran` step waits on has a saved answer —
      // by part id for a box the lesson ships, by `@preset` for one the learner adds.
      const demo = lesson.demo || {};
      const shippedTypes = new Map(lesson.doc.parts.map((x) => [x.id, x.type]));
      const presetType = new Map(creativePresets().map((x) => [x.id, x.type]));
      for (const s of lesson.steps) {
        for (const c of flat(s.check)) {
          if (!c.ran || c.ran.demoOk === false) continue;
          if (c.ran.partId && shippedTypes.get(c.ran.partId) === 'ask') {
            assert.ok(demo[c.ran.partId], `${lesson.id} ${s.id}: ${c.ran.partId} has a saved answer`);
          }
          if (c.ran.preset && presetType.get(c.ran.preset) === 'ask') {
            assert.ok(demo[`@${c.ran.preset}`], `${lesson.id} ${s.id}: @${c.ran.preset} has a saved answer`);
          }
        }
      }
    }
  });
};
