// Critic round 3 (docs/reviews/COMPUTER_CRITIC_R3.md), the integrator's polish pass:
//   R3-2  a control box saved at its old, shorter default is raised to what it needs on load, and
//         the resize handle stops at the same floor — so a reload never fights a resize;
//   R3-4  undoing a Keep (a seed-only change) does not mark the answer that seed produced stale.
// R3-1 (the Model picker's width) is measured in the real browser by chat-harness k9-fit.
import assert from 'node:assert/strict';

import { normaliseDoc } from '../../../renderer/chat/graph/model.mjs';
import { restoreProgram } from '../../../renderer/chat/graph/undo.mjs';
import { resizeRect } from '../../../renderer/chat/graph/gestures.mjs';
import { specMap } from '../../../renderer/chat/graph/parts/index.mjs';

const SPECS = specMap();
const CONTROLS = ['button', 'condition', 'confirm', 'dialog', 'timer', 'toggle'];

export default (test) => {
  test('R3-2: every control part declares minH = its default height, and a shorter saved box is raised on load', () => {
    const raw = {
      id: 'g', title: 'old', parts: CONTROLS.map((type, i) => ({ id: `p${i}`, type, x: 0, y: i * 300, w: 200, h: 100, settings: {} })),
      wires: [],
    };
    const { doc } = normaliseDoc(raw, { specs: SPECS, now: () => 0 });
    for (const type of CONTROLS) {
      const spec = SPECS.get(type);
      assert.ok(spec.minH > 0, `${type} declares minH`);
      assert.equal(spec.minH, spec.size.h, `${type}: minH is its default height`);
      const part = doc.parts.find((p) => p.type === type);
      assert.equal(part.h, spec.minH, `${type} saved at 100 px opens at ${spec.minH}`);
    }
    // A taller box stays as tall as the person made it.
    const tall = normaliseDoc({ id: 'g', parts: [{ id: 'a', type: 'condition', x: 0, y: 0, w: 240, h: 500 }], wires: [] }, { specs: SPECS, now: () => 0 }).doc;
    assert.equal(tall.parts[0].h, 500);
    // A part type with no minH keeps its saved height.
    const note = normaliseDoc({ id: 'g', parts: [{ id: 'a', type: 'note', x: 0, y: 0, w: 200, h: 90 }], wires: [] }, { specs: SPECS, now: () => 0 }).doc;
    assert.equal(note.parts[0].h, 90);
  });

  test('R3-2: the resize handle stops at the type\'s floor, so a reload never undoes a resize', () => {
    const min = { w: 0, h: SPECS.get('condition').minH };
    const r = resizeRect({ w: 240, h: 260 }, 0, -500, 1, min, 1);
    assert.equal(r.h, min.h, 'dragging far up stops at minH');
    assert.ok(r.w >= 80, 'the width keeps its own floor');
  });

  test('R3-4: undoing a Keep (seed only) keeps the answer done; any other setting still stales', () => {
    const answered = { id: 'a', type: 'ask', x: 0, y: 0, w: 300, h: 300, state: 'done', value: { kind: 'text', data: 'hi' }, settings: { instruction: 'x', seed: 4242 } };
    const current = { id: 'g', rev: 3, parts: [answered], wires: [] };
    const beforeKeep = { id: 'g', rev: 2, parts: [{ ...answered, settings: { instruction: 'x' } }], wires: [] };
    const undone = restoreProgram(current, beforeKeep, { now: () => 1 });
    assert.equal(undone.parts[0].state, 'done', 'the answer that seed produced is not stale');
    assert.equal(undone.parts[0].settings.seed, undefined, 'the seed itself is taken back');
    const beforeEdit = { id: 'g', rev: 2, parts: [{ ...answered, settings: { instruction: 'y', seed: 4242 } }], wires: [] };
    assert.equal(restoreProgram(current, beforeEdit, { now: () => 1 }).parts[0].state, 'stale', 'a prompt change still stales');
  });

  test('R4-3: a restored PINNED seed that did not produce the answer on screen stales it; the one that did does not', () => {
    // Pinned 42 → re-pinned 99 → Run (the answer came from 99) → Undo brings 42 back.
    const ran99 = { id: 'a', type: 'ask', x: 0, y: 0, w: 300, h: 300, state: 'done', value: { kind: 'text', data: 'from 99' }, stats: { ms: 1, tokens: 1, calls: 1, seed: 99 }, settings: { instruction: 'x', seed: 99 } };
    const current = { id: 'g', rev: 5, parts: [ran99], wires: [] };
    const pinned42 = { id: 'g', rev: 4, parts: [{ ...ran99, settings: { instruction: 'x', seed: 42 } }], wires: [] };
    assert.equal(restoreProgram(current, pinned42, { now: () => 1 }).parts[0].state, 'stale', '42 did not make this answer');
    const pinned99 = { id: 'g', rev: 4, parts: [{ ...ran99, settings: { instruction: 'x', seed: 99 } }], wires: [] };
    const keptFrom = { id: 'g', rev: 5, parts: [{ ...ran99, settings: { instruction: 'x' } }], wires: [] };
    assert.equal(restoreProgram(keptFrom, pinned99, { now: () => 1 }).parts[0].state, 'done', 'redoing a Keep of the seed on screen stays done');
  });
};
