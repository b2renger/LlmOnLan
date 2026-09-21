// net/delta.mjs (P1-U1): OpenAI chunks → content / reasoning / usage / finishReason / error.
// The headline property mirrors sse's: a <think> tag split at ANY offset must produce the same
// reasoning and content, because the mock (and llama.cpp) really do split "<th" + "ink>".
import assert from 'node:assert/strict';
import { createAccumulator } from '../../../renderer/chat/net/delta.mjs';

const delta = (d, finish) => ({ choices: [{ index: 0, delta: d, finish_reason: finish === undefined ? null : finish }] });

/** Feed a content string as `chunks` pieces. */
function feedContent(pieces, opts) {
  const acc = createAccumulator(opts || {});
  for (const p of pieces) acc.push(delta({ content: p }));
  acc.end();
  return acc.state;
}

/** Every way of cutting `text` into `n` pieces at one offset. */
function splits(text) {
  const out = [];
  for (let i = 1; i < text.length; i++) out.push([text.slice(0, i), text.slice(i)]);
  return out;
}

export default (test) => {
  test('reasoning arrives as `reasoning` (Ollama) or `reasoning_content` (llama.cpp)', () => {
    const acc = createAccumulator({});
    acc.push(delta({ reasoning: 'a ' }));
    acc.push(delta({ reasoning_content: 'b' }));
    acc.push(delta({ content: 'answer' }));
    assert.equal(acc.state.reasoning, 'a b');
    assert.equal(acc.state.content, 'answer');
    assert.equal(acc.state.reasoningDeltas, 2);
    assert.equal(acc.state.contentDeltas, 1);
  });

  test('<think> tags in content become reasoning', () => {
    const s = feedContent(['<think>weighing it</think>Here: **42**.']);
    assert.equal(s.reasoning, 'weighing it');
    assert.equal(s.content, 'Here: **42**.');
  });

  test('think tags split at EVERY offset give the same result', () => {
    const text = '\n<think>weighing the options</think>Here is the answer: **42**.';
    for (const pieces of splits(text)) {
      const s = feedContent(pieces);
      assert.equal(s.reasoning, 'weighing the options', `split ${JSON.stringify(pieces[0].slice(-8))}`);
      assert.equal(s.content, '\nHere is the answer: **42**.', `split ${JSON.stringify(pieces[0].slice(-8))}`);
    }
  });

  test('the mock-think-tags chunk list (tags split mid-tag) is handled', () => {
    const s = feedContent([
      '<th', 'ink>', 'weighing ', 'the ', 'options ', 'care', 'fully', '</thi', 'nk>',
      'Here ', 'is ', 'the ', 'answer: ', '**42**.',
    ]);
    assert.equal(s.reasoning, 'weighing the options carefully');
    assert.equal(s.content, 'Here is the answer: **42**.');
  });

  test('at most 7 characters are ever held back, and end() flushes a dangling partial tag', () => {
    // At the head only "<think>" can start: 5 characters withheld, 7 at most.
    const open = createAccumulator({});
    open.push(delta({ content: '\n<thin' }));
    assert.equal(open.state.content, '\n', 'the possible tag start is withheld');
    open.end();
    assert.equal(open.state.content, '\n<thin', 'end() releases it rather than losing text');

    // Inside one, "</think>" is what may be starting — its longest proper prefix is 7 characters.
    const close = createAccumulator({});
    close.push(delta({ content: '<think>abc</think' }));
    assert.equal(close.state.reasoning, 'abc', 'the 7-character partial close tag is withheld');
    assert.equal(close.state.content, '');
    close.end();
    // The block never closed, so end() hands its text back to the body (nothing is deleted).
    assert.equal(close.state.reasoning, '');
    assert.equal(close.state.content, 'abc</think');
  });

  test('a close tag outside a think block is ordinary text', () => {
    const s = feedContent(['hello </thin', 'k> world']);
    assert.equal(s.content, 'hello </think> world', 'nothing is withheld for a tag that cannot open');
    assert.equal(s.reasoning, '');
  });

  test('text that merely looks like a tag start is released as soon as it cannot be one', () => {
    const acc = createAccumulator({});
    acc.push(delta({ content: '<t' }));
    assert.equal(acc.state.content, '');
    acc.push(delta({ content: 'able' }));
    assert.equal(acc.state.content, '<table');
  });

  // ---- the split is HEAD-ONLY: a tag the model TYPED is the model's own text ------------------

  test('a think tag mid-sentence is left in the content, tags and all', () => {
    const s = feedContent(['The `<think>` tag is used by some models. `</think>` closes it.']);
    assert.equal(s.content, 'The `<think>` tag is used by some models. `</think>` closes it.');
    assert.equal(s.reasoning, '', 'nothing of the answer is moved into reasoning');
  });

  test('a think tag inside a fence survives, split at EVERY offset', () => {
    const text = 'Use this format:\n\n```\n<think>your reasoning</think>\n```\n\nThat is all.';
    assert.equal(feedContent([text]).content, text);
    for (const pieces of splits(text)) {
      const s = feedContent(pieces);
      assert.equal(s.content, text, `split ${JSON.stringify(pieces[0].slice(-8))}`);
      assert.equal(s.reasoning, '');
    }
  });

  test('an unclosed think block is given back to the content by end()', () => {
    const s = feedContent(['<think>', 'I am still thinking and the stream got cut']);
    assert.equal(s.content, 'I am still thinking and the stream got cut', 'the body is never empty');
    assert.equal(s.reasoning, '', 'and nothing is left hiding in a collapsed Thought block');
  });

  test('an unclosed block gives back only its own text, not delta-field reasoning', () => {
    const acc = createAccumulator({});
    acc.push(delta({ reasoning: 'from the field' }));
    acc.push(delta({ content: '<think>cut off' }));
    acc.end();
    assert.equal(acc.state.reasoning, 'from the field');
    assert.equal(acc.state.content, 'cut off');
  });

  test('only the FIRST block splits: a later one is the model quoting itself', () => {
    const s = feedContent(['<think>one</think>mid<think>two</think>end']);
    assert.equal(s.reasoning, 'one');
    assert.equal(s.content, 'mid<think>two</think>end');
  });

  test('a think block still opens after leading whitespace only', () => {
    const s = feedContent(['\n\n  <think>yes</think>body']);
    assert.equal(s.reasoning, 'yes');
    assert.equal(s.content.trim(), 'body');
  });

  test('splitThinkTags:false leaves the tags in the content', () => {
    const s = feedContent(['<think>x</think>y'], { splitThinkTags: false });
    assert.equal(s.content, '<think>x</think>y');
    assert.equal(s.reasoning, '');
  });

  test('a usage-only chunk (choices: []) records usage without touching the text', () => {
    const acc = createAccumulator({});
    acc.push(delta({ content: 'hi' }));
    acc.push({ choices: [], usage: { completion_tokens: 1000, prompt_tokens: 7, total_tokens: 1007 } });
    assert.equal(acc.state.usage.completion_tokens, 1000);
    assert.equal(acc.state.content, 'hi');
  });

  test('finish_reason is recorded, including on a usage chunk', () => {
    const acc = createAccumulator({});
    acc.push({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] });
    assert.equal(acc.state.finishReason, 'length');
  });

  test('tool calls are noticed but never accumulated', () => {
    const a = createAccumulator({});
    a.push(delta({ tool_calls: [{ index: 0, function: { name: 'x', arguments: '{}' } }] }));
    assert.equal(a.state.sawToolCalls, true);
    assert.equal(a.state.content, '', 'nothing in LOL Chat can run a tool call');

    const b = createAccumulator({});
    b.push(delta({}, 'tool_calls'));
    assert.equal(b.state.sawToolCalls, true);
    assert.equal(b.state.finishReason, 'tool_calls');
  });

  test('a top-level error object classifies as stream_error and keeps what arrived', () => {
    const acc = createAccumulator({});
    acc.push(delta({ content: 'tok0 tok1 ' }));
    acc.push({ error: { message: 'upstream exploded', type: 'api_error', code: 500 } });
    assert.equal(acc.state.error.kind, 'stream_error');
    assert.equal(acc.state.error.message, 'upstream exploded');
    assert.equal(acc.state.error.code, '500');
    assert.equal(acc.state.content, 'tok0 tok1 ', 'the partial answer survives');
  });

  test('junk chunks are ignored', () => {
    const acc = createAccumulator({});
    acc.push(null);
    acc.push('nope');
    acc.push({});
    acc.push({ choices: [{ index: 0 }] });
    assert.equal(acc.state.content, '');
    assert.equal(acc.state.error, null);
  });

  test('a whole turn delivered as `message` instead of `delta` still lands', () => {
    const acc = createAccumulator({});
    acc.push({ choices: [{ index: 0, message: { content: 'all at once' }, finish_reason: 'stop' }] });
    assert.equal(acc.state.content, 'all at once');
  });

  test('end() is idempotent', () => {
    const acc = createAccumulator({});
    acc.push(delta({ content: 'x </th' }));
    acc.end();
    acc.end();
    assert.equal(acc.state.content, 'x </th');
  });
};
