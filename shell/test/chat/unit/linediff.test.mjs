// @ts-check
// The History tab's line diff (renderer/chat/projects/linediff.mjs): kept, removed and added lines in order, a new or
// deleted file, a big rewrite without an LCS table, and hunks that keep a little context around each change.
import assert from 'node:assert/strict';
import { diffLines, hunks, MAX_CELLS } from '../../../renderer/chat/projects/linediff.mjs';

const tags = (/** @type {any[]} */ lines) => lines.map((l) => l.kind + l.text).join('|');

export default (test) => {
  test('linediff: one changed line between kept ones; an insertion; a deletion', () => {
    assert.equal(tags(diffLines('a\nb\nc\n', 'a\nB\nc\n')), ' a|-b|+B| c');
    assert.equal(tags(diffLines('a\nc', 'a\nb\nc')), ' a|+b| c');
    assert.equal(tags(diffLines('a\nb\nc', 'a\nc')), ' a|-b| c');
    assert.equal(tags(diffLines('same\n', 'same\n')), ' same');
  });

  test('linediff: a new file is all added, a deleted one all removed; the LCS finds moved-around lines', () => {
    assert.equal(tags(diffLines(null, 'x\ny\n')), '+x|+y');
    assert.equal(tags(diffLines('x\ny', '')), '-x|-y');
    assert.equal(tags(diffLines('1\n2\n3\n4', '1\nX\n3\nY')), ' 1|-2|+X| 3|-4|+Y');
  });

  test('linediff: a rewrite too big for the table reads as removed then added, in order', () => {
    const n = Math.ceil(Math.sqrt(MAX_CELLS)) + 10;
    const a = Array.from({ length: n }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: n }, (_, i) => `b${i}`).join('\n');
    const out = diffLines(`top\n${a}\nend`, `top\n${b}\nend`);
    assert.equal(out.length, 2 * n + 2);
    assert.equal(out[0].kind, ' ');
    assert.equal(out[1].kind, '-');
    assert.equal(out[n + 1].kind, '+');
    assert.equal(out[out.length - 1].text, 'end');
  });

  test('linediff: hunks keep context around each change and fold the rest into one line', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const after = before.replace('l10', 'CHANGED');
    const h = hunks(diffLines(before, after), 2);
    assert.equal(tags(h), '…| l8| l9|-l10|+CHANGED| l11| l12|…');
    assert.equal(tags(hunks(diffLines('a', 'b'))), '-a|+b');
  });
};
