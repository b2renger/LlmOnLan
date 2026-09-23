// K2-U1 — `wire.label` through the engine (COMPUTER_PLAN §5.1, §7.6, §11).
//
// An arrow's label is the NAME an instruction refers to. That makes it a program edit, not a
// decoration, and this file is where the three consequences of that sentence are pinned:
//
//   1. NORMALISATION. `name()` is what the model reads as a `## heading` — the reader's own case,
//      whitespace collapsed. `key()` is what matching uses — the same, casefolded. A label that
//      normalises to empty IS an unlabelled arrow (§5.2 rule 8), so the stored form of "no name"
//      is exactly `''`. `model.mjs` and `bind.mjs` each own a copy of the display rule (they cannot
//      import each other without a cycle), so the copies are asserted equal here, over the awkward
//      inputs, rather than trusted to stay equal.
//   2. STALENESS. Renaming `country` to `topic` changes which parameter an input arrives as, so the
//      Instruction below it must re-run: the edit stales `to` AND everything downstream and bumps
//      `rev`. Dragging the same wire's parts around does neither — a move must never cost a
//      generation (the C1 rule this build inherits).
//   3. THE FILE. v2 carries the label; a v1 file still opens (an absent label is an unlabelled
//      arrow); and a v3 file is REFUSED WHOLE with `unsupported-version`, nothing imported —
//      because importing the parts of a newer file we happen to understand is exactly the quiet
//      loss §1.3 rule 4 bans (§7.6, revision 2).

import assert from 'node:assert/strict';
import {
  addPart, addWire, createDoc, movePart, normaliseDoc, partById, setWireLabel, wireLabel,
} from '../../../renderer/chat/graph/model.mjs';
import { labelKey, labelName } from '../../../renderer/chat/graph/bind.mjs';
import { FORMAT, FORMAT_VERSION, fromJson, toJson } from '../../../renderer/chat/graph/serialize.mjs';
import { valueOf } from '../../../renderer/chat/graph/values.mjs';
import { wireMid, wireDistance, LABEL_BOX } from '../../../renderer/chat/graph/wires.mjs';
import { specs, ids, clock } from './graph-fixture.mjs';

const map = specs();

/** note → ask → collect, wired, with the wire ids to hand. */
function chain(now = clock()) {
  const newId = ids('p');
  const o = { specs: map, newId, now };
  let doc = createDoc({ id: 'g1', threadId: null, now });
  const place = (/** @type {string} */ type) => {
    const out = addPart(doc, { type, x: 0, y: 0 }, o);
    doc = out.doc;
    return out.part.id;
  };
  const note = place('note');
  const ask = place('ask');
  const sink = place('sink');
  const w1 = addWire(doc, { from: note, to: ask, port: 'in' }, o);
  doc = w1.doc;
  const w2 = addWire(doc, { from: ask, to: sink, port: 'in' }, o);
  doc = w2.doc;
  return { doc, o, now, note, ask, sink, w1: w1.wire.id, w2: w2.wire.id };
}

/** Everything settled, so a later `stale` is this test's doing and nobody else's. */
function settle(doc) {
  return { ...doc, parts: doc.parts.map((/** @type {any} */ p) => ({ ...p, state: 'done' })) };
}

const stateOf = (/** @type {any} */ doc, /** @type {string} */ id) => partById(doc, id).state;

export default (test) => {
  // ---------------------------------------------------------------- §5.1 normalisation

  test('name() keeps the reader\'s own spelling; key() is the same casefolded', () => {
    const table = [
      ['societal research', 'societal research', 'societal research'],
      ['Societal Research', 'Societal Research', 'societal research'],
      ['  societal   research  ', 'societal research', 'societal research'],
      ['societal\tresearch\nnotes', 'societal research notes', 'societal research notes'],
      ['TOPIC', 'TOPIC', 'topic'],
      ['Über Alles', 'Über Alles', 'über alles'],
    ];
    for (const [raw, name, key] of table) {
      assert.equal(labelName(raw), name, `name(${JSON.stringify(raw)})`);
      assert.equal(labelKey(raw), key, `key(${JSON.stringify(raw)})`);
    }
  });

  test('a label that normalises to empty IS an unlabelled arrow (§5.2 rule 8)', () => {
    for (const raw of ['', '   ', '\t\n ', null, undefined, { not: 'a string' }, 42]) {
      assert.equal(wireLabel(raw), '', `wireLabel(${JSON.stringify(raw)})`);
      if (typeof raw === 'string') assert.equal(labelKey(raw), '', `key(${JSON.stringify(raw)})`);
    }
  });

  // Over STRINGS, which is the whole contract: a label reaches `bind.mjs` only after `model.mjs`
  // has already made it one (a non-string in a hand-edited file is an unlabelled arrow, below).
  test('model.mjs and bind.mjs normalise identically — the duplicated rule cannot drift', () => {
    const awkward = ['topic', ' topic ', 'A  B', 'Ünïcode  Name', '', '   ', 'x'.repeat(200),
      'trailing nbsp', '{topic}', '$topic', '1', 'a\r\nb'];
    for (const raw of awkward) {
      assert.equal(wireLabel(raw), labelName(raw), `the two display rules disagree on ${JSON.stringify(raw)}`);
    }
  });

  test('a 65+ character label is ACCEPTED whole — truncation is the UI\'s problem, not the model\'s', () => {
    const long = 'a very long name for an arrow '.repeat(4).trim();
    assert.ok(long.length > 64);
    const s = chain();
    const doc = setWireLabel(s.doc, s.w1, long, { now: s.now });
    assert.equal(doc.wires[0].label, long, 'the model sees the reader\'s own words, in full');
  });

  // ---------------------------------------------------------------- §5.1 the edit

  test('addWire carries an optional label, normalised like every other', () => {
    const s = chain();
    const o = { specs: map, newId: ids('w'), now: s.now };
    const out = addWire(s.doc, { from: s.note, to: s.sink, port: 'in', label: '  Societal   Research ' }, o);
    assert.equal(out.ok, true);
    assert.equal(out.wire.label, 'Societal Research');
    assert.equal(s.doc.wires.length, 2, 'the input doc is untouched');
  });

  test('naming an arrow stales `to` and everything downstream, and bumps rev', () => {
    const s = chain();
    const before = settle(s.doc);
    const rev = before.rev;
    const after = setWireLabel(before, s.w1, 'societal research', { now: s.now });
    assert.equal(after.wires.find((/** @type {any} */ w) => w.id === s.w1).label, 'societal research');
    assert.equal(stateOf(after, s.ask), 'stale', 'the part the arrow feeds must re-run');
    assert.equal(stateOf(after, s.sink), 'stale', 'and so must everything that read its answer');
    assert.equal(stateOf(after, s.note), 'done', 'but nothing UPSTREAM is touched');
    assert.equal(after.rev, rev + 1, 'a program edit bumps rev');
    assert.equal(before.wires.find((/** @type {any} */ w) => w.id === s.w1).label, '',
      'and the doc it was handed is untouched — undo is a snapshot stack');
  });

  test('renaming to the same normalised text is not an edit at all', () => {
    const s = chain();
    const named = setWireLabel(settle(s.doc), s.w1, 'topic', { now: s.now });
    const again = setWireLabel(named, s.w1, '  Topic  ', { now: s.now });
    assert.notEqual(again, named, 'a different CASE is a different name the model will read');
    const same = setWireLabel(named, s.w1, ' topic ', { now: s.now });
    assert.equal(same, named, 'the same name, differently typed, costs neither an undo entry nor a re-run');
    assert.equal(setWireLabel(named, 'w-nope', 'x', { now: s.now }), named, 'an unknown wire changes nothing');
  });

  test('clearing a name is an edit too, and it stales what it fed', () => {
    const s = chain();
    const named = settle(setWireLabel(s.doc, s.w1, 'topic', { now: s.now }));
    const cleared = setWireLabel(named, s.w1, '   ', { now: s.now });
    assert.equal(cleared.wires.find((/** @type {any} */ w) => w.id === s.w1).label, '');
    assert.equal(stateOf(cleared, s.ask), 'stale', 'the Instruction below loses a named parameter: it must re-run');
    assert.equal(cleared.rev, named.rev + 1);
  });

  test('a MOVE still costs nothing — neither a re-run nor a rev', () => {
    const s = chain();
    const named = settle(setWireLabel(s.doc, s.w1, 'topic', { now: s.now }));
    const moved = movePart(named, s.note, { x: 400, y: 120 }, { now: s.now });
    assert.equal(stateOf(moved, s.ask), 'done', 'dragging a box must never cost a generation');
    assert.equal(stateOf(moved, s.sink), 'done', 'nor anything downstream of it');
    assert.equal(moved.wires.find((/** @type {any} */ w) => w.id === s.w1).label, 'topic',
      'the name rides with the arrow');
  });

  test('normaliseDoc: every wire comes back with a label, and a junk one comes back empty', () => {
    const s = chain();
    const raw = JSON.parse(JSON.stringify(setWireLabel(s.doc, s.w1, ' Topic ', { now: s.now })));
    raw.wires[1].label = { not: 'a string' };
    const { doc } = normaliseDoc(raw, { specs: map, now: s.now });
    assert.equal(doc.wires[0].label, 'Topic');
    assert.equal(doc.wires[1].label, '', 'a hand-edited file cannot put an object where a name goes');
  });

  // ---------------------------------------------------------------- §7.6 the file

  test('v2 writes a label only when there IS one — an unlabelled graph is byte-identical to v1', () => {
    const s = chain();
    const doc = setWireLabel(s.doc, s.w1, 'societal research', { now: s.now });
    const file = toJson(doc, { specs: map });
    assert.equal(file[FORMAT], 2, 'the format version is 2 (K2 kickoff)');
    assert.deepEqual(file.wires[0], { from: s.note, to: s.ask, port: 'in', label: 'societal research' });
    assert.deepEqual(file.wires[1], { from: s.ask, to: s.sink, port: 'in' },
      'an unlabelled arrow writes exactly the three keys v1 wrote');
  });

  test('a v2 file round-trips its labels AND its value facets', () => {
    const s = chain();
    let doc = setWireLabel(s.doc, s.w1, 'societal research', { now: s.now });
    doc = {
      ...doc,
      parts: doc.parts.map((/** @type {any} */ p) => (p.id === s.note
        ? { ...p, value: valueOf('text', '# Heading\n\nbody', { format: 'markdown' }), state: 'done' }
        : p)),
    };
    const file = toJson(doc, { specs: map, values: true });
    const back = fromJson(file, { specs: map, newId: ids('n'), now: s.now, values: true });
    assert.equal(back.ok, true, `import failed: ${back.errors}`);
    assert.deepEqual(back.errors, []);
    const labels = back.doc.wires.map((/** @type {any} */ w) => w.label);
    assert.deepEqual(labels, ['societal research', ''], 'in wire order, and the unnamed one stays unnamed');
    const note = back.doc.parts.find((/** @type {any} */ p) => p.type === 'note');
    assert.equal(note.value.format, 'markdown', 'the facet survives the same trip the label does');
  });

  test('a v1 file still opens: an absent label is an unlabelled arrow', () => {
    const v1 = {
      [FORMAT]: 1,
      title: 'From an older build',
      settings: {},
      parts: [
        { id: 'a', type: 'note', x: 0, y: 0, w: 200, h: 100, settings: { text: 'hi' } },
        { id: 'b', type: 'ask', x: 300, y: 0, w: 220, h: 120, settings: { prompt: 'go' } },
      ],
      wires: [{ from: 'a', to: 'b', port: 'in' }],
    };
    const out = fromJson(v1, { specs: map, newId: ids('n'), now: clock() });
    assert.equal(out.ok, true, `a v1 file must still open: ${out.errors}`);
    assert.equal(out.doc.wires.length, 1);
    assert.equal(out.doc.wires[0].label, '', 'no label in the file means an unlabelled arrow, not a broken one');
  });

  test('a v3 file is REFUSED WHOLE — unsupported-version, and nothing is imported', () => {
    const newer = {
      [FORMAT]: FORMAT_VERSION + 1,
      title: 'Made by a later Computer',
      settings: {},
      parts: [{ id: 'a', type: 'note', x: 0, y: 0, settings: { text: 'hi' } }],
      wires: [],
    };
    const out = fromJson(newer, { specs: map, newId: ids('n'), now: clock() });
    assert.equal(out.ok, false, 'importing what we happen to understand is the quiet loss §1.3 rule 4 bans');
    assert.deepEqual(out.errors, ['unsupported-version']);
    assert.equal(out.doc, null, 'and there is no half-read document to put on a canvas');
  });

  // ---------------------------------------------------------------- §8.2 where the pill sits

  test('the pill sits on the curve, not on the chord between the ends', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 400, y: 200 };
    const mid = wireMid(a, b);
    assert.ok(wireDistance(a, b, mid) < 0.001,
      'the pill must land ON the drawn curve, or it points at a wire that is not there');
    // Awkward shapes too: a wire that doubles back, and one with no horizontal run at all.
    for (const [p, q] of [[{ x: 400, y: 0 }, { x: 0, y: 40 }], [{ x: 10, y: 0 }, { x: 10, y: 300 }]]) {
      assert.ok(wireDistance(p, q, wireMid(p, q)) < 0.001, `the pill left the curve for ${JSON.stringify([p, q])}`);
    }
    assert.ok(LABEL_BOX.w > 0 && LABEL_BOX.h > 0, 'the pill has a box to be centred in');
  });
};
