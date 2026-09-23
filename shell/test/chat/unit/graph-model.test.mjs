// graph/model.mjs (C1-U1): the document and every legal mutation of it.
//
// What these assertions protect:
//   - IMMUTABILITY. Undo is a snapshot stack: if one mutation wrote through to the doc it was
//     handed, every snapshot behind it would change too and Ctrl+Z would restore the present.
//     Every mutation test therefore also asserts the input is untouched;
//   - the SEVEN frozen wire refusal codes, and which one wins when a wire is wrong twice over.
//     The canvas turns a code into a sentence; if the engine invented sentences the two would
//     drift apart in every language;
//   - the split between SEMANTIC edits (settings/wires/deletes mark stale) and cosmetic ones
//     (move/resize/view mark nothing and do not even bump `rev`) — dragging a part must not cost
//     a generation;
//   - `normaliseDoc` as the gate: a row written by a later phase, or a hand-edited file, comes
//     back RUNNABLE (no unknown type, no dangling wire, no cycle) or comes back without that
//     piece, and says which pieces it dropped.
import assert from 'node:assert/strict';
import {
  DEFAULT_SIZE, STATES, WIRE_REASONS, createDoc, partById, normaliseDoc, addPart, removeParts,
  movePart, resizePart, setSettings, patchPart, addWire, removeWire, inputsOf, setView,
} from '../../../renderer/chat/graph/model.mjs';
import { runSet } from '../../../renderer/chat/graph/topo.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';
import { MAX_ITEM_ERRORS } from '../../../renderer/chat/graph/fanout.mjs';
import { specs, ids, clock } from './graph-fixture.mjs';

const map = specs();

/** A doc with `n` notes, plus the tools to keep mutating it. */
function seed(now = clock()) {
  const newId = ids('p');
  const wireId = ids('w');
  const doc = createDoc({ id: 'g1', threadId: 't1', now });
  return { doc, newId, wireId, now, o: { specs: map, newId, now } };
}

/** place a part and return [doc, id] */
function place(doc, type, o, x = 0, y = 0) {
  const res = addPart(doc, { type, x, y }, o);
  return [res.doc, res.part.id];
}

export default (test) => {
  test('createDoc: an empty, runnable document stamped once', () => {
    const now = clock(5000);
    const d = createDoc({ id: 'g1', threadId: 't1', title: 'Study', now });
    assert.deepEqual(d, {
      id: 'g1', threadId: 't1', title: 'Study', createdAt: 5000, updatedAt: 5000, rev: 1,
      parts: [], wires: [], settings: {}, view: { x: 0, y: 0, zoom: 1 },
    });
    assert.equal(createDoc({ id: 'g', threadId: undefined, now }).threadId, null);
    assert.deepEqual(runSet(d), []);
  });

  test('the frozen vocabularies are exactly the ones the canvas draws', () => {
    assert.deepEqual([...STATES], ['idle', 'stale', 'queued', 'running', 'done', 'error']);
    assert.deepEqual([...WIRE_REASONS].sort(),
      ['cycle', 'duplicate', 'no-output', 'self', 'type', 'unknown-part', 'unknown-port']);
  });

  // ------------------------------------------------------------------- parts
  test('addPart: the spec supplies the defaults and the size, the caller the position', () => {
    const s = seed();
    const { doc, part } = addPart(s.doc, { type: 'note', x: 40, y: 12 }, s.o);
    assert.equal(part.id, 'p1');
    assert.deepEqual(part.settings, { text: '' }, 'defaults() from the part type');
    assert.deepEqual([part.x, part.y, part.w, part.h], [40, 12, 200, 100], 'size from the spec');
    assert.deepEqual([part.state, part.value, part.error, part.stats], ['idle', null, null, null]);
    assert.equal(doc.rev, 2);
    assert.equal(s.doc.parts.length, 0, 'the input doc is untouched');
    const ask = addPart(doc, { type: 'ask', x: 0, y: 0 }, s.o).part;
    assert.deepEqual([ask.w, ask.h], [DEFAULT_SIZE.w, DEFAULT_SIZE.h], 'no spec size: the default');
  });

  test('addPart: settings from the caller override the defaults; an unknown type places nothing', () => {
    const s = seed();
    const { part } = addPart(s.doc, { type: 'note', x: 0, y: 0, settings: { text: 'hi' } }, s.o);
    assert.deepEqual(part.settings, { text: 'hi' });
    const bad = addPart(s.doc, { type: 'ghost', x: 0, y: 0 }, s.o);
    assert.equal(bad.part, null);
    assert.equal(bad.doc, s.doc, 'and the doc is not even copied');
  });

  test('removeParts: the wires go too, and whatever the part fed goes stale', () => {
    const s = seed();
    let [doc, a] = place(s.doc, 'note', s.o);
    let b; [doc, b] = place(doc, 'ask', s.o);
    doc = addWire(doc, { from: a, to: b, port: 'in' }, s.o).doc;
    doc = patchPart(doc, b, { state: 'done', value: valueOf('text', 'kept') });
    const before = doc;
    doc = removeParts(doc, [a]);
    assert.equal(doc.parts.length, 1);
    assert.equal(doc.wires.length, 0, 'a dangling wire is never left behind');
    assert.equal(partById(doc, b).state, 'stale');
    assert.equal(partById(doc, b).value.data, 'kept', 'the value survives the edit');
    assert.equal(before.parts.length, 2, 'the input doc is untouched');
    assert.equal(removeParts(doc, ['ghost']), doc, 'removing nothing returns the same doc');
  });

  test('movePart / resizePart: cosmetic — they never mark anything stale', () => {
    const s = seed();
    let [doc, a] = place(s.doc, 'note', s.o);
    let b; [doc, b] = place(doc, 'ask', s.o);
    doc = addWire(doc, { from: a, to: b, port: 'in' }, s.o).doc;
    doc = patchPart(doc, a, { state: 'done' });
    doc = patchPart(doc, b, { state: 'done' });
    const moved = movePart(doc, a, { x: 99, y: 7 });
    assert.deepEqual([partById(moved, a).x, partById(moved, a).y], [99, 7]);
    assert.deepEqual(moved.parts.map((p) => p.state), ['done', 'done'], 'dragging costs no generation');
    assert.deepEqual(runSet(moved), []);
    const sized = resizePart(moved, a, { w: 400, h: 300 });
    assert.deepEqual([partById(sized, a).w, partById(sized, a).h], [400, 300]);
    assert.deepEqual(runSet(sized), []);
    const tiny = resizePart(sized, a, { w: 1, h: 1 });
    assert.deepEqual([partById(tiny, a).w, partById(tiny, a).h], [80, 60], 'a floor keeps a part grabbable');
    assert.equal(movePart(doc, 'ghost', { x: 1, y: 1 }), doc);
  });

  test('setSettings: a semantic edit — the part and everything downstream go stale', () => {
    const s = seed();
    let [doc, a] = place(s.doc, 'note', s.o);
    let b; [doc, b] = place(doc, 'ask', s.o);
    let c; [doc, c] = place(doc, 'ask', s.o);
    doc = addWire(doc, { from: a, to: b, port: 'in' }, s.o).doc;
    doc = addWire(doc, { from: b, to: c, port: 'in' }, s.o).doc;
    for (const id of [a, b, c]) doc = patchPart(doc, id, { state: 'done' });
    const edited = setSettings(doc, a, { text: 'typo fixed' }, s.o);
    assert.equal(partById(edited, a).settings.text, 'typo fixed');
    assert.deepEqual(edited.parts.map((p) => p.state), ['stale', 'stale', 'stale']);
    assert.deepEqual(runSet(edited), [a, b, c]);
    // the OTHER direction: editing the last part costs exactly one generation
    const tail = setSettings(doc, c, { prompt: 'x' }, s.o);
    assert.deepEqual(runSet(tail), [c]);
    assert.equal(setSettings(doc, 'ghost', { x: 1 }, s.o), doc);
  });

  test('patchPart: runtime fields only, validated, and never a document edit', () => {
    const s = seed();
    const [doc, a] = place(s.doc, 'note', s.o);
    const ran = patchPart(doc, a, {
      state: 'done', value: valueOf('text', 'A'), stats: { ms: '12', tokens: 3 }, error: '',
      settings: { text: 'HACK' }, x: 999,
    });
    const p = partById(ran, a);
    assert.equal(p.state, 'done');
    assert.deepEqual(p.value, { kind: 'text', data: 'A' });
    // C2 kickoff (plan §2.6 BH-3): `calls` rides in stats, because a fan-out's cost is "how many
    // generations", not only how many tokens. An absent field normalises to 0, like the other two.
    assert.deepEqual(p.stats, { ms: 12, tokens: 3, calls: 0 });
    assert.equal(p.error, null, 'an empty error string is no error');
    assert.deepEqual(p.settings, { text: '' }, 'settings are NOT a runtime field');
    assert.equal(p.x, 0);
    assert.equal(ran.rev, doc.rev, 'a run does not bump rev: it is not an edit of the program');
    assert.deepEqual(runSet(patchPart(ran, a, { state: 'nonsense' })), [], 'a bad state is ignored');
    assert.equal(partById(patchPart(ran, a, { value: 'not a value' }), a).value, null);
    assert.equal(patchPart(doc, 'ghost', { state: 'done' }), doc);
    assert.equal(patchPart(doc, a, {}), doc, 'an empty patch does not even copy');

    // The fan-out record is a runtime field too, and it is DROPPED, not trusted, when malformed.
    const fanned = patchPart(ran, a, {
      fanout: { n: '3', done: 3, ok: 2, failed: 1, errors: [{ i: 2, message: 'nope' }, 'junk'] },
    });
    assert.deepEqual(partById(fanned, a).fanout, {
      n: 3, done: 3, ok: 2, failed: 1, hidden: 0, errors: [{ i: 2, message: 'nope' }],
    });
    assert.equal(partById(patchPart(ran, a, { fanout: 'not a record' }), a).fanout, null);
  });

  test('normaliseDoc: the per-item record SURVIVES a reload, the way stats and the error do', () => {
    // It did not (fix pass, finding 2): `patchPart` sanitised `fanout` on the way in and the store
    // wrote it, but `normalisePart` rebuilt each part from a field list that did not mention it. A
    // reloaded graph therefore said "0.1s · 50 tokens · 5 calls" on a part whose three failed items
    // had vanished — no badge, no list, and no record of which items to re-run. That is the quiet
    // loss §1.2 bans, on the one field a fan-out exists to produce.
    const s = seed();
    let [doc, a] = place(s.doc, 'note', s.o);
    doc = patchPart(doc, a, {
      state: 'done',
      stats: { ms: 100, tokens: 50, calls: 5 },
      fanout: { n: 10, done: 10, ok: 7, failed: 3, errors: [{ i: 1, message: 'one' }, { i: 4, message: 'two' }, { i: 9, message: 'three' }] },
    });
    const back = normaliseDoc(JSON.parse(JSON.stringify(doc)), s.o).doc;
    const part = partById(back, a);
    assert.deepEqual(part.stats, { ms: 100, tokens: 50, calls: 5 }, 'the control: stats always came back');
    assert.deepEqual(part.fanout, {
      n: 10, done: 10, ok: 7, failed: 3, hidden: 0,
      errors: [{ i: 1, message: 'one' }, { i: 4, message: 'two' }, { i: 9, message: 'three' }],
    }, 'and now the per-item record does too — the same shape, the same sanitising');
    const junk = normaliseDoc({ parts: [{ id: 'x', type: 'note', fanout: 'junk' }] }, s.o).doc;
    assert.equal(partById(junk, 'x').fanout, null, 'and junk is still dropped rather than trusted');
  });

  test('normaliseDoc: a stored record can never grow without bound, however it was written', () => {
    // The record is written to the graph row once a slice while a fan runs, so an unbounded error
    // list is unbounded STORAGE (fix pass, finding 4). Past the cap the count survives in `hidden`
    // — the reader is told how many are not listed, never quietly shown fewer.
    const s = seed();
    let [doc, a] = place(s.doc, 'note', s.o);
    const errors = [];
    for (let i = 0; i < 300; i++) errors.push({ i, message: `item ${i} failed` });
    doc = patchPart(doc, a, { fanout: { n: 300, done: 300, ok: 0, failed: 300, errors } });
    const kept = partById(doc, a).fanout;
    assert.equal(kept.errors.length, MAX_ITEM_ERRORS, 'the row keeps a bounded number of messages');
    assert.equal(kept.failed, 300, 'while the COUNT is the whole truth');
    assert.equal(kept.hidden, 300 - MAX_ITEM_ERRORS, 'and the rest are counted, not forgotten');
    const back = partById(normaliseDoc(JSON.parse(JSON.stringify(doc)), s.o).doc, a);
    assert.deepEqual(back.fanout, kept, 'the reload path applies the same bound');
  });

  // ------------------------------------------------------------------- wires
  test('addWire: a legal wire marks its target stale and keeps wire order per port', () => {
    const s = seed();
    let [doc, a] = place(s.doc, 'note', s.o);
    let b; [doc, b] = place(doc, 'note', s.o);
    let ask; [doc, ask] = place(doc, 'ask', s.o);
    doc = patchPart(doc, ask, { state: 'done' });
    const first = addWire(doc, { from: b, to: ask, port: 'in' }, s.o);
    assert.equal(first.ok, true);
    assert.deepEqual({ ...first.wire, id: typeof first.wire.id },
      { id: 'string', from: b, to: ask, port: 'in', label: '' },
      'K2-U1: every wire carries a label, and an arrow nobody named carries the empty one');
    assert.deepEqual(first.doc.wires, [first.wire]);
    assert.equal(partById(first.doc, ask).state, 'stale');
    assert.equal(doc.wires.length, 0, 'the input doc is untouched');
    const second = addWire(first.doc, { from: a, to: ask, port: 'in' }, s.o);
    assert.deepEqual(inputsOf(second.doc, ask), { in: [b, a] }, 'several wires into one port keep order');
    assert.deepEqual(inputsOf(second.doc, a), {});
  });

  test('addWire: the seven refusals, each by its own code', () => {
    const s = seed();
    let [doc, n1] = place(s.doc, 'note', s.o);
    let n2; [doc, n2] = place(doc, 'note', s.o);
    let ask; [doc, ask] = place(doc, 'ask', s.o);
    let look; [doc, look] = place(doc, 'looker', s.o);
    let sink; [doc, sink] = place(doc, 'sink', s.o);
    const refuse = (edge, d = doc) => {
      const res = addWire(d, edge, s.o);
      assert.equal(res.ok, false, `expected a refusal for ${JSON.stringify(edge)}`);
      return res.reason;
    };
    assert.equal(refuse({ from: n1, to: 'ghost', port: 'in' }), 'unknown-part');
    assert.equal(refuse({ from: n1, to: n1, port: 'in' }), 'self');
    assert.equal(refuse({ from: sink, to: ask, port: 'in' }), 'no-output', 'a part with no output');
    assert.equal(refuse({ from: n1, to: ask, port: 'nope' }), 'unknown-port');
    assert.equal(refuse({ from: n1, to: n2, port: 'in' }), 'unknown-port', 'a Note has no inputs at all');
    assert.equal(refuse({ from: n1, to: look, port: 'image' }), 'type', 'text into an image-only port');
    const wired = addWire(doc, { from: n1, to: ask, port: 'in' }, s.o).doc;
    assert.equal(refuse({ from: n1, to: ask, port: 'in' }, wired), 'duplicate');
    const chain = addWire(wired, { from: ask, to: sink, port: 'in' }, s.o).doc;
    assert.equal(refuse({ from: sink, to: n1, port: 'in' }, chain), 'no-output',
      'the output check comes first: a sink can never be a source');
  });

  test('addWire: a cycle is refused at draw time — the loop that eats a farm never exists', () => {
    const s = seed();
    let [doc, a] = place(s.doc, 'ask', s.o);
    let b; [doc, b] = place(doc, 'ask', s.o);
    let c; [doc, c] = place(doc, 'ask', s.o);
    doc = addWire(doc, { from: a, to: b, port: 'in' }, s.o).doc;
    doc = addWire(doc, { from: b, to: c, port: 'in' }, s.o).doc;
    assert.equal(addWire(doc, { from: c, to: a, port: 'in' }, s.o).reason, 'cycle');
    assert.equal(addWire(doc, { from: c, to: b, port: 'in' }, s.o).reason, 'cycle');
    assert.equal(addWire(doc, { from: a, to: c, port: 'in' }, s.o).ok, true, 'a forward shortcut is legal');
    assert.equal(doc.wires.length, 2, 'a refused wire changes nothing');
  });

  test('addWire: a port declaring many:false holds exactly one wire', () => {
    const s = seed();
    let [doc, l1] = place(s.doc, 'lister', s.o);
    let l2; [doc, l2] = place(doc, 'lister', s.o);
    let col; [doc, col] = place(doc, 'collect', s.o);
    const first = addWire(doc, { from: l1, to: col, port: 'items' }, s.o);
    assert.equal(first.ok, true);
    assert.equal(addWire(first.doc, { from: l2, to: col, port: 'items' }, s.o).reason, 'duplicate');
  });

  test('addWire: a list output into a text port is allowed through — C1 refuses it at RUN time', () => {
    // spec §2: that combination is a fan-out, not a type error. C2 implements it; the wire must
    // already be drawable or the canvas would teach the wrong rule.
    const s = seed();
    let [doc, lister] = place(s.doc, 'lister', s.o);
    let ask; [doc, ask] = place(doc, 'ask', s.o);
    assert.equal(addWire(doc, { from: lister, to: ask, port: 'in' }, s.o).ok, true);
  });

  test('removeWire: the target goes stale, and removing a ghost changes nothing', () => {
    const s = seed();
    let [doc, a] = place(s.doc, 'note', s.o);
    let b; [doc, b] = place(doc, 'ask', s.o);
    const w = addWire(doc, { from: a, to: b, port: 'in' }, s.o);
    doc = patchPart(w.doc, b, { state: 'done' });
    const cut = removeWire(doc, w.wire.id);
    assert.equal(cut.wires.length, 0);
    assert.equal(partById(cut, b).state, 'stale');
    assert.equal(removeWire(cut, 'w99'), cut);
  });

  test('setView: pan and zoom are not an edit — no rev bump, no stale, numbers validated', () => {
    const s = seed();
    const [doc] = place(s.doc, 'note', s.o);
    const panned = setView(doc, { x: -10, y: 20, zoom: 0.5 });
    assert.deepEqual(panned.view, { x: -10, y: 20, zoom: 0.5 });
    assert.equal(panned.rev, doc.rev);
    assert.deepEqual(setView(doc, { x: 'a', y: null, zoom: 0 }).view, { x: 0, y: 0, zoom: 1 });
    assert.deepEqual(setView(doc, null).view, { x: 0, y: 0, zoom: 1 });
  });

  // ------------------------------------------------------------------- normaliseDoc
  test('normaliseDoc: an unknown part type is dropped and the rest of the graph survives', () => {
    const { doc, dropped } = normaliseDoc({
      id: 'g1', threadId: 't1',
      parts: [
        { id: 'a', type: 'note', x: 1, y: 2, settings: { text: 'keep' } },
        { id: 'b', type: 'repeat', x: 0, y: 0 },          // a C2 part, on a C1 client
        { id: 'c', type: 'ask', x: 0, y: 0 },
      ],
      wires: [
        { id: 'w1', from: 'a', to: 'c', port: 'in' },
        { id: 'w2', from: 'a', to: 'b', port: 'in' },     // into the dropped part
      ],
    }, { specs: map, now: clock(7) });
    assert.deepEqual(doc.parts.map((p) => p.id), ['a', 'c']);
    assert.equal(doc.parts[0].settings.text, 'keep');
    assert.deepEqual(doc.wires.map((w) => w.id), ['w1']);
    assert.deepEqual(dropped, ['part:unknown-type', 'wire:unknown-part']);
  });

  test('normaliseDoc: every wire a runnable graph cannot have is dropped, by name', () => {
    const { doc, dropped } = normaliseDoc({
      parts: [{ id: 'a', type: 'ask' }, { id: 'b', type: 'ask' }, { id: 's', type: 'sink' }],
      wires: [
        { id: 'w1', from: 'a', to: 'b', port: 'in' },
        { id: 'w2', from: 'b', to: 'a', port: 'in' },     // closes a loop
        { id: 'w3', from: 'a', to: 'b', port: 'in' },     // the same wire twice
        { id: 'w4', from: 'a', to: 'a', port: 'in' },
        { id: 'w5', from: 's', to: 'a', port: 'in' },     // a source with no output
        { id: 'w6', from: 'a', to: 'b', port: 'ghost' },
        'nonsense',
      ],
    }, { specs: map });
    assert.deepEqual(doc.wires.map((w) => w.id), ['w1']);
    assert.deepEqual(dropped, ['wire:cycle', 'wire:duplicate', 'wire:self', 'wire:no-output',
      'wire:unknown-port', 'wire:malformed']);
    assert.equal(runSet(doc).length, 3, 'what comes back is runnable');
  });

  test('normaliseDoc: a C1 graph keeps its wires when a port is RENAMED under it (K2 landing)', async () => {
    // The Instruction replaced the C1 Ask and its `context` port became `in`. Every graph the
    // owner already drew stores `port: 'context'`, and an unknown port is DROPPED — so without the
    // rename table in model.mjs the catalogue swap would quietly cut every arrow into every
    // Instruction. Read against the REAL catalogue, because the rename is a fact about it.
    const { specMap } = await import('../../../renderer/chat/graph/parts/index.mjs');
    const real = specMap();
    const { doc, dropped } = normaliseDoc({
      id: 'g1', threadId: null,
      parts: [{ id: 'a', type: 'note', settings: { text: 'Paris' } }, { id: 'b', type: 'ask' }],
      wires: [{ id: 'w1', from: 'a', to: 'b', port: 'context', label: 'topic' }],
    }, { specs: real, now: clock(7) });
    assert.deepEqual(dropped, [], 'nothing was dropped');
    assert.equal(doc.wires.length, 1, 'the arrow survived the rename');
    assert.equal(doc.wires[0].port, 'in', 'and it now names the port the part really has');
    assert.equal(doc.wires[0].label, 'topic', 'its label came with it');
    // A port that was never renamed is still refused: the table is a rename, not an amnesty.
    const junk = normaliseDoc({
      parts: [{ id: 'a', type: 'note' }, { id: 'b', type: 'ask' }],
      wires: [{ id: 'w1', from: 'a', to: 'b', port: 'nonsense' }],
    }, { specs: real, now: clock(7) });
    assert.deepEqual(junk.dropped, ['wire:unknown-port']);
  });

  test('normaliseDoc: a part interrupted by a crash comes back stale, never mid-flight', () => {
    const { doc } = normaliseDoc({
      parts: [
        { id: 'a', type: 'ask', state: 'running', value: { kind: 'text', data: 'half' } },
        { id: 'b', type: 'ask', state: 'queued' },
        { id: 'c', type: 'ask', state: 'done', value: { kind: 'text', data: 'whole' } },
        { id: 'd', type: 'ask', state: 'nonsense' },
      ],
      wires: [],
    }, { specs: map });
    assert.deepEqual(doc.parts.map((p) => p.state), ['stale', 'stale', 'done', 'idle']);
    assert.equal(doc.parts[0].value.data, 'half', 'a partial value is kept, just not trusted');
  });

  test('normaliseDoc: junk is coerced, not trusted — ids, numbers, values, settings, view', () => {
    const { doc, dropped } = normaliseDoc({
      parts: [
        { id: 'a', type: 'note', x: '12', y: null, w: 'wide', settings: 'nope', value: { kind: 'nope' } },
        { id: 'a', type: 'note' },                        // the same id twice
        { type: 'note' },                                 // no id at all
        null,
      ],
      wires: [],
      view: { x: '4', zoom: -1 },
      settings: 'nope',
    }, { specs: map, now: clock(9) });
    assert.equal(doc.parts.length, 1);
    assert.deepEqual([doc.parts[0].x, doc.parts[0].y, doc.parts[0].w], [12, 0, 200]);
    assert.deepEqual(doc.parts[0].settings, { text: '' }, 'settings fall back to the spec defaults');
    assert.equal(doc.parts[0].value, null, 'a malformed value is no value');
    assert.deepEqual(doc.view, { x: 4, y: 0, zoom: 1 });
    assert.deepEqual(doc.settings, {});
    assert.deepEqual(doc.createdAt, 9);
    assert.deepEqual(dropped, ['part:duplicate', 'part:no-id', 'part:no-id']);
  });

  test('normaliseDoc: nothing at all is an empty document, not a throw', () => {
    for (const junk of [null, undefined, 42, 'x', []]) {
      const { doc } = normaliseDoc(junk, { specs: map, now: clock(3) });
      assert.deepEqual(doc.parts, []);
      assert.deepEqual(doc.wires, []);
      assert.equal(doc.threadId, null);
    }
  });
};
