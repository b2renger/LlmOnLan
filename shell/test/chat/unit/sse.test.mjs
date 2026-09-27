// net/sse.mjs (P1-U1): SSE framing. The one property that matters on a real stream is that the
// result does NOT depend on where the TCP chunks fall — so the headline test replays a fixture
// split at EVERY offset and demands byte-identical events each time. chat.js's `buf.indexOf('\n')`
// loop fails that test the moment a CRLF or a multi-line data payload straddles a chunk boundary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSSEParser } from '../../../renderer/chat/net/sse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, '..', 'fixtures', 'net', 'legacy-stream.sse');

/** Feed `chunks` through a parser and collect every dispatched event. */
function parse(chunks) {
  /** @type {{data: string, meta: any}[]} */ const events = [];
  const p = createSSEParser((data, meta) => events.push({ data, meta }));
  for (const c of chunks) p.feed(c);
  p.end();
  return events;
}

export default (test) => {
  const raw = fs.readFileSync(FIXTURE, 'utf8');

  test('the fixture parses into the events the mock sent', () => {
    const events = parse([raw]);
    const datas = events.map((e) => e.data);
    assert.equal(datas.length, 6, 'reasoning x2, content x2, usage, [DONE] — the comment lines are not events');
    assert.equal(datas[datas.length - 1], '[DONE]', '[DONE] is passed through verbatim');
    const first = JSON.parse(datas[0]);
    assert.equal(first.choices[0].delta.reasoning_content, 'think0 ');
    const usage = JSON.parse(datas[4]);
    assert.equal(usage.usage.completion_tokens, 2);
    assert.equal(events[2].meta.event, 'chunk', 'the event: field rides along in the meta');
  });

  test('every split point of the fixture yields identical events', () => {
    const want = JSON.stringify(parse([raw]).map((e) => e.data));
    for (let i = 1; i < raw.length; i++) {
      const got = JSON.stringify(parse([raw.slice(0, i), raw.slice(i)]).map((e) => e.data));
      assert.equal(got, want, `split at ${i} (…${JSON.stringify(raw.slice(Math.max(0, i - 6), i + 6))}…)`);
    }
  });

  test('every 3-way split of the fixture yields identical events', () => {
    const want = JSON.stringify(parse([raw]).map((e) => e.data));
    for (let i = 1; i < raw.length; i += 7) {
      for (let j = i + 1; j < raw.length; j += 11) {
        const got = JSON.stringify(parse([raw.slice(0, i), raw.slice(i, j), raw.slice(j)]).map((e) => e.data));
        assert.equal(got, want, `split at ${i}/${j}`);
      }
    }
  });

  test('one character at a time still yields identical events', () => {
    const want = parse([raw]).map((e) => e.data);
    const got = parse([...raw]).map((e) => e.data);
    assert.deepEqual(got, want);
  });

  test('CRLF split across a chunk boundary is one terminator, not two', () => {
    const events = parse(['data: a\r', '\n\r', '\ndata: b\r\n\r\n']);
    assert.deepEqual(events.map((e) => e.data), ['a', 'b']);
  });

  test('a lone CR terminates a line', () => {
    assert.deepEqual(parse(['data: a\r\rdata: b\r\r']).map((e) => e.data), ['a', 'b']);
  });

  test('comments and unknown fields are ignored, and a comment-only block dispatches nothing', () => {
    const events = parse([': keep-alive\n\nretry: 3000\nfoo: bar\ndata: x\n\n']);
    assert.deepEqual(events.map((e) => e.data), ['x']);
  });

  test('multiple data: lines are joined with a newline', () => {
    assert.deepEqual(parse(['data: {"a":1,\ndata: "b":2}\n\n']).map((e) => e.data), ['{"a":1,\n"b":2}']);
  });

  test('exactly one leading space is removed from a value', () => {
    assert.deepEqual(parse(['data:no-space\n\ndata:  two\n\n']).map((e) => e.data), ['no-space', ' two']);
  });

  test('an empty data field is still an event', () => {
    assert.deepEqual(parse(['data:\n\n']).map((e) => e.data), ['']);
  });

  test('end() flushes an event that never got its blank line', () => {
    assert.deepEqual(parse(['data: last']).map((e) => e.data), ['last'], 'a server that just closes');
  });

  test('end() after a complete stream dispatches nothing extra', () => {
    assert.equal(parse(['data: a\n\n']).length, 1);
  });

  test('id: is remembered across events, event: is not', () => {
    const events = parse(['id: 7\nevent: one\ndata: a\n\ndata: b\n\n']);
    assert.deepEqual(events.map((e) => e.meta), [{ event: 'one', id: '7' }, { event: null, id: '7' }]);
  });

  test('onData must be a function', () => {
    assert.throws(() => createSSEParser(/** @type {any} */ (null)), /must be a function/);
  });
};
