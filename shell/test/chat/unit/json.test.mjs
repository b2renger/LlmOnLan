// app/json.mjs (S0-U2, studio plan §3.4.2): getting a typed value out of whatever a local model
// actually said. Every case here is a shape a 12B model on the office box really produces —
// fenced, prefaced, truncated, reasoning-only, or (rarely, and only with response_format intact)
// a bare object.
import assert from 'node:assert/strict';
import {
  extractJson, validate, coerce, promptFor, stableStringify, hashKey,
} from '../../../renderer/chat/app/json.mjs';

export default (test) => {
  // ---- extractJson --------------------------------------------------------------------------

  test('a bare object is how:body', () => {
    const r = extractJson('{"a":1,"b":"x"}');
    assert.equal(r.ok, true);
    assert.equal(r.how, 'body');
    assert.deepEqual(r.value, { a: 1, b: 'x' });
  });

  test('an array root is a find too', () => {
    const r = extractJson('  [1, 2, 3]  ');
    assert.equal(r.how, 'body');
    assert.deepEqual(r.value, [1, 2, 3]);
  });

  test('a scalar is NOT a find — "Sure." must not become a successful answer', () => {
    for (const raw of ['"Sure."', '42', 'true', 'null']) {
      const r = extractJson(raw);
      assert.equal(r.ok, false, raw);
      assert.equal(r.how, 'none', raw);
    }
  });

  test('a fenced block wins over the prose around it', () => {
    const raw = 'Here is the result.\n\n```json\n{"a":1}\n```\n\nHope that helps!';
    const r = extractJson(raw);
    assert.equal(r.how, 'fence');
    assert.deepEqual(r.value, { a: 1 });
  });

  test('a fence with no language tag, and a tilde fence, both parse', () => {
    assert.deepEqual(extractJson('```\n{"a":1}\n```').value, { a: 1 });
    assert.deepEqual(extractJson('~~~\n{"a":2}\n~~~').value, { a: 2 });
  });

  test('prose then a fence whose first block is NOT json falls through to the second', () => {
    const raw = 'thinking:\n```text\nnot json at all\n```\nand the answer:\n```json\n{"ok":true}\n```';
    const r = extractJson(raw);
    assert.equal(r.how, 'fence');
    assert.deepEqual(r.value, { ok: true });
  });

  test('an object mid-sentence is how:slice', () => {
    const r = extractJson('The answer is {"a":1} — I hope that helps.');
    assert.equal(r.how, 'slice');
    assert.deepEqual(r.value, { a: 1 });
  });

  test('two objects: the FIRST one wins', () => {
    const r = extractJson('first {"n":1} then {"n":2}');
    assert.deepEqual(r.value, { n: 1 });
  });

  test('a truncated object finds nothing rather than half an answer', () => {
    const r = extractJson('{"a":1,"b":');
    assert.equal(r.ok, false);
    assert.equal(r.how, 'none');
  });

  test('a truncated object followed by a complete one still finds the complete one', () => {
    const r = extractJson('{"a":1,"b": ... {"c":3}');
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, { c: 3 });
  });

  test('braces inside strings do not confuse the scanner', () => {
    const r = extractJson('note: {"text":"a } b { c","n":1} end');
    assert.equal(r.how, 'slice');
    assert.deepEqual(r.value, { text: 'a } b { c', n: 1 });
  });

  test('an escaped quote inside a string does not end it', () => {
    const r = extractJson('x {"text":"he said \\"} \\" and left","n":2} y');
    assert.deepEqual(r.value, { text: 'he said "} " and left', n: 2 });
  });

  test('a BOM and CRLF newlines are survivable', () => {
    const r = extractJson('﻿{\r\n  "a": 1\r\n}');
    assert.equal(r.how, 'body');
    assert.deepEqual(r.value, { a: 1 });
  });

  test('an empty or whitespace-only reply is how:none', () => {
    for (const raw of ['', '   ', '\n\n', null, undefined]) {
      assert.equal(extractJson(/** @type {any} */ (raw)).how, 'none');
    }
  });

  test('an unclosed fence still yields its body (a truncated reply is when we most want to try)', () => {
    const r = extractJson('```json\n{"a":1}\n');
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, { a: 1 });
  });

  // ---- validate -----------------------------------------------------------------------------

  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string', maxLength: 8 },
      count: { type: 'integer', minimum: 1, maximum: 10 },
      kind: { enum: ['a', 'b'] },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'count'],
    additionalProperties: false,
  };

  test('a conforming value validates with no errors', () => {
    const r = validate({ name: 'ok', count: 3, kind: 'a', tags: ['x'] }, schema);
    assert.deepEqual(r.errors, []);
    assert.equal(r.ok, true);
  });

  test('a missing required field is named, not silently accepted', () => {
    const r = validate({ name: 'ok' }, schema);
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /\$\.count: required/);
  });

  test('a wrong type reports once, not once per nested rule', () => {
    const r = validate({ name: 'ok', count: 'three' }, schema);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /expected integer, got string/);
  });

  test('minimum, maximum and maxLength are enforced', () => {
    assert.match(validate({ name: 'ok', count: 0 }, schema).errors[0], /below the minimum 1/);
    assert.match(validate({ name: 'ok', count: 99 }, schema).errors[0], /above the maximum 10/);
    assert.match(validate({ name: 'far too long', count: 1 }, schema).errors[0], /longer than 8 characters/);
  });

  test('enum membership is checked, and only against the listed values', () => {
    const r = validate({ name: 'ok', count: 1, kind: 'c' }, schema);
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /not one of the allowed values/);
  });

  test('additionalProperties:false names the extra key', () => {
    const r = validate({ name: 'ok', count: 1, surprise: 1 }, schema);
    assert.match(r.errors[0], /\$\.surprise: not allowed/);
  });

  test('array items are validated element by element, with an index in the path', () => {
    const r = validate({ name: 'ok', count: 1, tags: ['x', 7] }, schema);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /\$\.tags\[1\]: expected string/);
  });

  test('an integer schema refuses a float; a number schema accepts one', () => {
    assert.equal(validate(1.5, { type: 'integer' }).ok, false);
    assert.equal(validate(1.5, { type: 'number' }).ok, true);
  });

  test('null is its own type and is not an object', () => {
    assert.equal(validate(null, { type: 'object' }).ok, false);
    assert.equal(validate(null, { type: 'null' }).ok, true);
  });

  // ---- coerce -------------------------------------------------------------------------------

  test('coerce drops unknown properties', () => {
    const v = coerce({ name: 'ok', count: 1, surprise: 'nope' }, schema);
    assert.deepEqual(Object.keys(v).sort(), ['count', 'name']);
  });

  test('coerce keeps unknown properties when additionalProperties is true', () => {
    const open = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: true };
    assert.deepEqual(coerce({ a: 'x', b: 2 }, open), { a: 'x', b: 2 });
  });

  test('coerce NEVER invents a missing required field', () => {
    const v = coerce({ name: 'ok' }, schema);
    assert.equal(Object.prototype.hasOwnProperty.call(v, 'count'), false);
    assert.equal(validate(v, schema).ok, false, 'and the gap still reports');
  });

  test('a single value is wrapped where the schema says array', () => {
    assert.deepEqual(coerce('x', { type: 'array', items: { type: 'string' } }), ['x']);
    assert.deepEqual(coerce(['x'], { type: 'array', items: { type: 'string' } }), ['x']);
    assert.equal(coerce(null, { type: 'array' }), null, 'null is absence, not a one-element list');
  });

  test('numeric strings become numbers, but only real ones', () => {
    assert.equal(coerce('3', { type: 'integer' }), 3);
    assert.equal(coerce('3.5', { type: 'number' }), 3.5);
    assert.equal(coerce('3.5', { type: 'integer' }), '3.5', 'not an integer: left alone to report');
    assert.equal(coerce('three', { type: 'number' }), 'three');
    assert.equal(coerce('', { type: 'number' }), '');
  });

  test('"true"/"false" become booleans; other strings do not', () => {
    assert.equal(coerce('true', { type: 'boolean' }), true);
    assert.equal(coerce(' FALSE ', { type: 'boolean' }), false);
    assert.equal(coerce('yes', { type: 'boolean' }), 'yes');
  });

  test('coerce recurses into properties and array items', () => {
    const nested = {
      type: 'object',
      properties: { list: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' } }, additionalProperties: false } } },
      additionalProperties: false,
    };
    assert.deepEqual(coerce({ list: [{ n: '1', junk: true }], junk: 1 }, nested), { list: [{ n: 1 }] });
  });

  test('a coerced answer that was fenced prose validates end to end', () => {
    const raw = 'Sure!\n```json\n{"name":"box","count":"2","extra":1}\n```';
    const found = extractJson(raw);
    const value = coerce(found.value, schema);
    assert.deepEqual(validate(value, schema), { ok: true, value: { name: 'box', count: 2 }, errors: [] });
  });

  // ---- promptFor / stableStringify / hashKey --------------------------------------------------

  test('promptFor is deterministic and key-order independent', () => {
    const a = promptFor({ type: 'object', properties: { b: { type: 'string' }, a: { type: 'string' } } });
    const b = promptFor({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } });
    assert.equal(a, b);
    assert.equal(a, promptFor({ properties: { a: { type: 'string' }, b: { type: 'string' } }, type: 'object' }));
  });

  test('promptFor says JSON only, carries the schema, and adds the example when given', () => {
    const text = promptFor({ type: 'object' }, { example: { a: 1 } });
    assert.match(text, /JSON only/);
    assert.match(text, /\{"type":"object"\}/);
    assert.match(text, /\{"a":1\}/);
    assert.equal(promptFor({ type: 'object' }).includes('valid answer looks like'), false);
  });

  test('stableStringify sorts object keys but keeps array order', () => {
    assert.equal(stableStringify({ b: 1, a: [3, 1, 2] }), '{"a":[3,1,2],"b":1}');
  });

  test('stableStringify survives a cycle instead of throwing', () => {
    /** @type {any} */ const o = { a: 1 };
    o.self = o;
    assert.equal(stableStringify(o), '{"a":1,"self":null}');
  });

  test('hashKey is stable, 8 hex digits, and separates near-identical inputs', () => {
    assert.equal(hashKey('abc'), hashKey('abc'));
    assert.match(hashKey('abc'), /^[0-9a-f]{8}$/);
    assert.notEqual(hashKey('abc'), hashKey('abd'));
    assert.match(hashKey(''), /^[0-9a-f]{8}$/);
  });
};
