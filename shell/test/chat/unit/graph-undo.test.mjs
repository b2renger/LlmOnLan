// graph/undo.mjs (C1-U1): the canvas's snapshot undo stack.
//
// What these assertions protect:
//   - the stack stores the doc AS IT WAS BEFORE the edit, so one Ctrl+Z is one edit — not one
//     half-edit, and not two;
//   - a new edit after an undo CLEARS redo. Without that rule the redo stack would replay a future
//     that no longer connects to the present document, and Ctrl+Y would resurrect deleted parts;
//   - the cap drops the OLDEST entry, never the newest, so a long session keeps its recent history;
//   - undo really restores the earlier document, snapshot-identical, because graph/model.mjs never
//     mutates in place (this test is the other half of that promise).
import assert from 'node:assert/strict';
import { createUndo, DEFAULT_LIMIT } from '../../../renderer/chat/graph/undo.mjs';
import { createDoc, addPart, removeParts, setSettings, partById } from '../../../renderer/chat/graph/model.mjs';
import { specs, ids, clock } from './graph-fixture.mjs';

const map = specs();

export default (test) => {
  test('an empty stack undoes and redoes nothing', () => {
    const u = createUndo();
    assert.equal(u.canUndo(), false);
    assert.equal(u.canRedo(), false);
    assert.equal(u.undo({ id: 'now' }), null);
    assert.equal(u.redo({ id: 'now' }), null);
    assert.deepEqual(u.depth(), { past: 0, future: 0 });
    assert.equal(u.limit, DEFAULT_LIMIT);
    assert.equal(DEFAULT_LIMIT, 100);
  });

  test('push records the BEFORE doc; undo hands it back and parks the present on redo', () => {
    const u = createUndo();
    const v1 = { id: 'v1' };
    const v2 = { id: 'v2' };
    u.push(v1, 'place');
    assert.deepEqual(u.depth(), { past: 1, future: 0 });
    const back = u.undo(v2);
    assert.equal(back.doc, v1, 'the same object, not a copy');
    assert.equal(back.label, 'place');
    assert.deepEqual(u.depth(), { past: 0, future: 1 });
    const forward = u.redo(v1);
    assert.equal(forward.doc, v2);
    assert.deepEqual(u.depth(), { past: 1, future: 0 });
  });

  test('a new edit after an undo clears the future', () => {
    const u = createUndo();
    u.push({ id: 'v1' }, 'a');
    u.push({ id: 'v2' }, 'b');
    u.undo({ id: 'v3' });
    assert.equal(u.canRedo(), true);
    u.push({ id: 'v2' }, 'c');
    assert.equal(u.canRedo(), false, 'the branch you abandoned is gone');
    assert.deepEqual(u.labels().past, ['a', 'c']);
  });

  test('the cap drops the oldest entry, not the newest', () => {
    const u = createUndo({ limit: 3 });
    for (const label of ['a', 'b', 'c', 'd', 'e']) u.push({ id: label }, label);
    assert.deepEqual(u.depth(), { past: 3, future: 0 });
    assert.deepEqual(u.labels().past, ['c', 'd', 'e']);
    assert.equal(u.undo({ id: 'now' }).doc.id, 'e');
  });

  test('a nonsense limit falls back to the default; clear() empties both stacks', () => {
    assert.equal(createUndo({ limit: 0 }).limit, DEFAULT_LIMIT);
    assert.equal(createUndo({ limit: -5 }).limit, DEFAULT_LIMIT);
    assert.equal(createUndo({ limit: 'x' }).limit, DEFAULT_LIMIT);
    assert.equal(createUndo({ limit: 2.9 }).limit, 2);
    const u = createUndo();
    u.push({ id: 'a' }, 'a');
    u.undo({ id: 'b' });
    u.clear();
    assert.deepEqual(u.depth(), { past: 0, future: 0 });
    u.push(null, 'ignored');
    assert.equal(u.canUndo(), false, 'there is no snapshot of nothing');
  });

  test('undo/redo over real documents restores them exactly — place, wire-settings, delete', () => {
    const now = clock();
    const newId = ids('p');
    const u = createUndo();
    const v0 = createDoc({ id: 'g1', threadId: 't1', now });

    u.push(v0, 'place');
    const placed = addPart(v0, { type: 'note', x: 0, y: 0 }, { specs: map, newId, now }).doc;
    const id = placed.parts[0].id;

    u.push(placed, 'edit');
    const edited = setSettings(placed, id, { text: 'hello' }, { specs: map, now });

    u.push(edited, 'delete');
    const deleted = removeParts(edited, [id], { now });
    assert.equal(deleted.parts.length, 0);

    let cur = deleted;
    let step = u.undo(cur);
    cur = step.doc;
    assert.equal(step.label, 'delete');
    assert.equal(partById(cur, id).settings.text, 'hello', 'the deleted part is back, with its text');

    step = u.undo(cur);
    cur = step.doc;
    assert.equal(partById(cur, id).settings.text, '', 'and now before the edit');

    step = u.undo(cur);
    cur = step.doc;
    assert.equal(cur, v0, 'all the way back to the empty canvas');
    assert.equal(u.canUndo(), false);

    // and forward again, to exactly the same documents
    assert.equal(u.redo(cur).doc.parts.length, 1);
    assert.equal(u.redo(placed).doc, edited);
    assert.equal(u.redo(edited).doc, deleted);
    assert.equal(u.canRedo(), false);
  });
};
