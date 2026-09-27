// graph/values.mjs (C1-U1): value kinds, port acceptance, the coercion table (spec §2).
//
// What these assertions protect:
//   - `accepts` has THREE answers, not two: a list reaching a text port is a fan-out, not an
//     error — C1 refuses it by name and C2 implements it, and both read this one verdict;
//   - nothing is coerced on the way through a wire; `coerceTo` is only for the parts that ask,
//     and the table of what is convertible is asserted whole, so a "forgiving" conversion cannot
//     be added by accident (an image silently becoming the text "[object Object]" is exactly the
//     silent coercion spec §2 forbids);
//   - `preview` never throws and never returns a wall of text, because it runs on every part of a
//     500-part canvas.
import assert from 'node:assert/strict';
import {
  KINDS, isKind, valueOf, isValue, listOf, itemsOf, accepts, coerceTo, coercionTable, preview,
} from '../../../renderer/chat/graph/values.mjs';

export default (test) => {
  test('the kinds are the five of spec §2, and the list is frozen', () => {
    assert.deepEqual([...KINDS], ['text', 'image', 'list', 'json', 'file']);
    assert.ok(Object.isFrozen(KINDS));
    assert.ok(isKind('json'));
    assert.ok(!isKind('number'));
    assert.ok(!isKind(null));
  });

  test('valueOf falls back to text rather than minting an unusable kind', () => {
    assert.deepEqual(valueOf('text', 'hi'), { kind: 'text', data: 'hi' });
    assert.deepEqual(valueOf('nope', 'hi'), { kind: 'text', data: 'hi' });
    assert.equal(valueOf('json', null).kind, 'json');
  });

  test('isValue takes {kind, data} and nothing else', () => {
    assert.ok(isValue({ kind: 'text', data: '' }));
    assert.ok(isValue({ kind: 'json', data: null }));
    assert.ok(!isValue(null));
    assert.ok(!isValue('text'));
    assert.ok(!isValue([{ kind: 'text', data: 'x' }]));
    assert.ok(!isValue({ kind: 'text' }), 'a value with no data key is not a value');
    assert.ok(!isValue({ kind: 'nope', data: 1 }));
  });

  test('listOf wraps raw items so a list never holds a non-value', () => {
    const v = listOf(['a', 2, null, { kind: 'json', data: { x: 1 } }]);
    assert.equal(v.kind, 'list');
    assert.deepEqual(v.data.map((i) => i.kind), ['text', 'text', 'text', 'json']);
    assert.deepEqual(v.data.map((i) => i.data), ['a', '2', '', { x: 1 }]);
    assert.deepEqual(listOf(null).data, []);
    assert.deepEqual(itemsOf(valueOf('text', 'x')), [], 'itemsOf on a non-list is empty, not a throw');
    assert.equal(itemsOf(v).length, 4);
  });

  // ------------------------------------------------------------------- accepts
  test('accepts: exact kind, any, and the non-value', () => {
    assert.equal(accepts(['text'], valueOf('text', 'x')), 'ok');
    assert.equal(accepts(['any'], valueOf('image', {})), 'ok');
    assert.equal(accepts(['json', 'text'], valueOf('json', {})), 'ok');
    assert.equal(accepts(['text'], valueOf('image', {})), 'no');
    assert.equal(accepts([], valueOf('text', 'x')), 'no');
    assert.equal(accepts(['text'], null), 'no');
    assert.equal(accepts(null, valueOf('text', 'x')), 'no');
  });

  test('accepts: a list into a text port is a FAN-OUT, not an error and not a join', () => {
    assert.equal(accepts(['text'], listOf(['a', 'b'])), 'fanout');
    assert.equal(accepts(['list'], listOf(['a'])), 'ok', 'a port that wants a list just takes it');
    assert.equal(accepts(['any'], listOf(['a'])), 'ok');
    assert.equal(accepts(['json'], listOf(['a'])), 'no', 'fan-out is the text exception only');
  });

  // ------------------------------------------------------------------- coercion
  test('the coercion table is exactly what spec §2 allows (5×5, asserted whole)', () => {
    // rows = target kind, columns = source kind. `true` = there is an honest conversion.
    assert.deepEqual(coercionTable(), {
      text: { text: true, image: false, list: true, json: true, file: true },
      image: { text: false, image: true, list: false, json: false, file: false },
      list: { text: true, image: true, list: true, json: true, file: true },
      json: { text: true, image: false, list: true, json: true, file: false },
      file: { text: false, image: false, list: false, json: false, file: true },
    });
  });

  test('coerceTo performs the conversions the table promises', () => {
    assert.deepEqual(coerceTo('text', valueOf('json', { a: 1 })), { kind: 'text', data: '{\n  "a": 1\n}' });
    assert.deepEqual(coerceTo('text', listOf(['a', 'b'])), { kind: 'text', data: 'a\nb' });
    assert.deepEqual(coerceTo('text', valueOf('file', { path: 'out/x.md' })), { kind: 'text', data: 'out/x.md' });
    assert.deepEqual(coerceTo('json', valueOf('text', '[1,2]')), { kind: 'json', data: [1, 2] });
    assert.deepEqual(coerceTo('json', listOf([valueOf('text', '1'), valueOf('text', 'two')])),
      { kind: 'json', data: [1, 'two'] }, 'items that are not json fall back to their own data');
    const wrapped = coerceTo('list', valueOf('text', 'solo'));
    assert.deepEqual(wrapped, { kind: 'list', data: [{ kind: 'text', data: 'solo' }] });
    assert.deepEqual(coerceTo('list', valueOf('json', [1, 2])).data.map((i) => i.data), [1, 2]);
  });

  test('coerceTo returns null where there is no honest conversion — never a stringified object', () => {
    assert.equal(coerceTo('text', valueOf('image', { id: 'a1' })), null);
    assert.equal(coerceTo('json', valueOf('text', 'not json')), null);
    assert.equal(coerceTo('json', valueOf('file', { path: 'x' })), null);
    assert.equal(coerceTo('image', valueOf('text', 'x')), null);
    assert.equal(coerceTo('file', valueOf('text', 'x')), null);
    assert.equal(coerceTo('text', null), null);
    assert.equal(coerceTo('nope', valueOf('text', 'x')), null);
  });

  test('coerceTo of the same kind is the identity, and never copies', () => {
    const v = valueOf('json', { a: 1 });
    assert.equal(coerceTo('json', v), v);
  });

  // ------------------------------------------------------------------- preview
  test('preview truncates, collapses whitespace and describes each kind', () => {
    assert.equal(preview(valueOf('text', 'hello   \n world')), 'hello world');
    assert.equal(preview(valueOf('text', 'x'.repeat(200))).length, 121);
    assert.ok(preview(valueOf('text', 'x'.repeat(200))).endsWith('…'));
    assert.equal(preview(valueOf('text', 'abcdef'), 3), 'abc…');
    assert.equal(preview(listOf(['one', 'two'])), 'one · two');
    assert.equal(preview(valueOf('image', { name: 'shot.png' })), 'shot.png');
    assert.equal(preview(valueOf('file', { path: 'out/names.md' })), 'out/names.md');
    assert.equal(preview(valueOf('json', { a: 1 })), '{ "a": 1 }');
    assert.equal(preview(null), '');
    assert.equal(preview(valueOf('text', null)), '');
  });

  test('preview survives data JSON cannot stringify', () => {
    const cyclic = { a: 1 };
    cyclic.self = cyclic;
    assert.equal(typeof preview(valueOf('json', cyclic)), 'string');
  });
};
