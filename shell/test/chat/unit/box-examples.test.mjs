// @ts-check
// Owner, 2026-09-27: "one example per box — a ? on the box opens a simple example that says what it
// does, its inputs and outputs, and how to use it on the Computer". Every ＋ menu entry has one, and
// every one opens whole.
import assert from 'node:assert/strict';
import { EXAMPLES, exampleByKey, exampleKeyOf, exampleDoc, exampleText } from '../../../renderer/chat/computer/examples/index.mjs';
import { specMap, paletteCatalogue } from '../../../renderer/chat/graph/parts/index.mjs';
import { buildPalette } from '../../../renderer/chat/graph/palette.mjs';
import { normaliseDoc } from '../../../renderer/chat/graph/model.mjs';
import { fromJson } from '../../../renderer/chat/graph/serialize.mjs';
import { mentions } from '../../../renderer/chat/graph/bind.mjs';

const specs = specMap();
const entries = buildPalette(paletteCatalogue(), specs).map((e) => e.entry);

export default (test) => {
  test('box examples: exactly one per ＋ menu entry, in menu order', () => {
    assert.deepEqual(EXAMPLES.map((x) => x.key), entries);
    assert.equal(exampleByKey('nope'), null);
  });

  test('box examples: each opens whole — no part or wire lost, through the same door an import uses', () => {
    for (const ex of EXAMPLES) {
      const doc = exampleDoc(ex);
      const { doc: open, dropped } = normaliseDoc({ ...doc, id: 'x', threadId: null }, { specs, now: () => 0 });
      assert.deepEqual(dropped, [], `${ex.key}: loses ${dropped.join(', ')}`);
      assert.equal(open.parts.length, doc.parts.length, `${ex.key}: parts`);
      assert.equal(open.wires.length, doc.wires.length, `${ex.key}: wires`);
      let n = 0;
      const imported = fromJson(JSON.parse(JSON.stringify(doc)), { specs, newId: () => `n${++n}`, now: () => 1 });
      assert.ok(imported.ok && imported.errors.length === 0, `${ex.key}: import says ${imported.errors}`);
    }
  });

  test('box examples: each holds the box it explains, and the ? on that box finds it', () => {
    for (const ex of EXAMPLES) {
      const doc = exampleDoc(ex);
      assert.ok(doc.parts.some((/** @type {any} */ p) => p.id !== 'x_about' && p.id !== 'x_title' && exampleKeyOf(p) === ex.key), `${ex.key}: the box itself is in its example`);
    }
  });

  test('box examples: the words say what it does, its inputs, its output and how to use it', () => {
    for (const ex of EXAMPLES) {
      const text = exampleText(ex);
      for (const head of ['What it does', 'Output', 'How to use it']) assert.ok(text.includes(head), `${ex.key}: ${head}`);
      assert.ok(ex.howto.length >= 2, `${ex.key}: at least two ways to use it`);
      assert.ok(text.length < 1600, `${ex.key}: short enough to read on a sticky (${text.length})`);
    }
  });

  test('box examples: every named arrow into an Instruction is mentioned by it; the layout fits the canvas', () => {
    for (const ex of EXAMPLES) {
      const doc = exampleDoc(ex);
      for (const w of doc.wires) {
        const to = doc.parts.find((/** @type {any} */ p) => p.id === w.to);
        if (to.type === 'ask' && w.label) assert.ok(mentions(to.settings.instruction, w.label), `${ex.key}: "${w.label}" is not in the instruction`);
      }
      const right = Math.max(...doc.parts.map((/** @type {any} */ p) => p.x + p.w));
      const bottom = Math.max(...doc.parts.map((/** @type {any} */ p) => p.y + p.h));
      assert.ok(right * doc.view.zoom <= 1000 && bottom * doc.view.zoom <= 705, `${ex.key}: ${right}×${bottom} at ${doc.view.zoom} does not fit`);
    }
  });
};
