// net/request.mjs (P1-U1): a thread path → the RequestDraft → the wire body.
// These assertions are the privacy/parity contract of the send path: no reasoning ever goes back,
// the chat's own notes are never history, and the only parameters that reach the farm are the five
// on the whitelist — no Ollama context key, no `options` bag.
import assert from 'node:assert/strict';
import { draftFromPath, resolveParams, toOpenAIBody, PARAM_KEYS } from '../../../renderer/chat/net/request.mjs';

/** A Message as the repo stores it (§3.3), with only the fields this module reads. */
const msg = (id, role, content, extra = {}) => ({
  id, threadId: 'T', parentId: null, role, content,
  reasoning: role === 'assistant' ? 'secret thinking' : null,
  status: role === 'assistant' ? 'done' : 'done', parts: [], pinned: false, ...extra,
});

const simplePath = () => [
  msg('u1', 'user', 'what GPU?'),
  msg('a1', 'assistant', 'an A6000 Pro'),
  msg('u2', 'user', 'how much VRAM?'),
];

export default (test) => {
  test('a plain path becomes user/assistant blocks in order', () => {
    const req = draftFromPath(simplePath(), { model: 'assistant' });
    assert.deepEqual(req.messages.map((m) => [m.role, m.blocks[0].text, m.blocks[0].tag]), [
      ['user', 'what GPU?', 'user'],
      ['assistant', 'an A6000 Pro', 'assistant'],
      ['user', 'how much VRAM?', 'user'],
    ]);
    assert.equal(req.model, 'assistant');
    assert.equal(req.mode, 'new');
    assert.deepEqual(req.systemAppend, []);
    assert.deepEqual(req.meta.allowances, []);
  });

  test("the chat's own notes are never history: local / error / waiting / empty are dropped", () => {
    const path = [
      msg('u1', 'user', 'hi'),
      msg('a1', 'assistant', '⏳ The server is busy: switching. Try again in a moment.', { status: 'local' }),
      msg('u2', 'user', 'again'),
      msg('a2', 'assistant', 'half an answer', { status: 'error' }),
      msg('u3', 'user', 'once more'),
      msg('a3', 'assistant', '', { status: 'waiting' }),
      msg('u4', 'user', 'now'),
      msg('a4', 'assistant', '   ', { status: 'done' }),
    ];
    const req = draftFromPath(path, {});
    assert.deepEqual(req.messages.map((m) => m.msgId), ['u1', 'u2', 'u3', 'u4']);
  });

  test('an interrupted or aborted assistant with real text IS history', () => {
    const path = [msg('u1', 'user', 'hi'), msg('a1', 'assistant', 'partial', { status: 'interrupted' })];
    assert.deepEqual(draftFromPath(path, {}).messages.map((m) => m.msgId), ['u1', 'a1']);
  });

  test('NO message ever carries a reasoning field, in the draft or on the wire', () => {
    const req = draftFromPath(simplePath(), { model: 'assistant' });
    assert.ok(!JSON.stringify(req.messages).includes('secret thinking'));
    assert.ok(!JSON.stringify(req.messages).includes('reasoning'));
    const body = toOpenAIBody(req, {});
    assert.ok(!JSON.stringify(body).includes('reasoning'));
    assert.ok(!JSON.stringify(body).includes('secret thinking'));
  });

  test('the wire body is text-only strings, streaming, with usage requested', () => {
    const body = toOpenAIBody(draftFromPath(simplePath(), { model: 'assistant' }), {});
    assert.deepEqual(body.messages, [
      { role: 'user', content: 'what GPU?' },
      { role: 'assistant', content: 'an A6000 Pro' },
      { role: 'user', content: 'how much VRAM?' },
    ]);
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.equal(body.model, 'assistant');
    assert.equal(body.response_format, undefined);
  });

  test('the farm sizes its own context: no num_ctx and no options, whatever is thrown at it', () => {
    const req = draftFromPath(simplePath(), { model: 'assistant' });
    // A transform that misbehaves (or a recipe from an import) cannot smuggle keys through.
    req.params = { temperature: 0.7, num_ctx: 262144, options: { num_ctx: 4096 }, keep_alive: -1 };
    const body = toOpenAIBody(req, {});
    const json = JSON.stringify(body);
    assert.ok(!json.includes('num_ctx'), 'the Ollama context key never reaches the wire');
    assert.ok(!json.includes('keep_alive'));
    assert.deepEqual(
      Object.keys(body).sort(),
      ['messages', 'model', 'stream', 'stream_options', 'temperature'],
      'no Ollama options bag: the body has exactly the OpenAI keys (stream_options is the usage flag)',
    );
    assert.equal(body.temperature, 0.7, 'the whitelisted parameter does go');
  });

  test('params precedence is call > thread > recipe, whitelist only', () => {
    const params = resolveParams({
      recipe: { temperature: 0.1, top_p: 0.5, max_tokens: 100, num_ctx: 8192 },
      thread: { temperature: 0.5, seed: 7 },
      call: { temperature: 0.9 },
    });
    assert.deepEqual(params, { temperature: 0.9, top_p: 0.5, max_tokens: 100, seed: 7 });
    assert.deepEqual(PARAM_KEYS, ['temperature', 'top_p', 'max_tokens', 'seed', 'stop']);
  });

  test('a layer cannot un-set a lower layer with null or undefined', () => {
    assert.deepEqual(resolveParams({ recipe: { seed: 7 }, thread: { seed: null }, call: { seed: undefined } }), { seed: 7 });
    assert.deepEqual(resolveParams({}), {});
    assert.deepEqual(resolveParams(), {});
  });

  test('draftFromPath copies the param layers rather than aliasing the thread object', () => {
    const thread = { temperature: 0.3 };
    const req = draftFromPath(simplePath(), { paramLayers: { thread } });
    req.paramLayers.thread.temperature = 1;
    assert.equal(thread.temperature, 0.3, 'the caller\'s object is untouched');
  });

  test('the system message is the prompt then every systemAppend, joined by a blank line', () => {
    const req = draftFromPath(simplePath(), { model: 'assistant', system: 'You are terse.' });
    req.systemAppend.push('Answer as JSON.', 'Cite sources.');
    const body = toOpenAIBody(req, {});
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[0].content, 'You are terse.\n\nAnswer as JSON.\n\nCite sources.');
    assert.equal(body.messages.length, 4);
  });

  test('systemAppend alone still produces a system message; nothing produces none', () => {
    const a = draftFromPath(simplePath(), {});
    a.systemAppend.push('Answer as JSON.');
    assert.equal(toOpenAIBody(a, {}).messages[0].content, 'Answer as JSON.');
    assert.equal(toOpenAIBody(draftFromPath(simplePath(), {}), {}).messages[0].role, 'user');
  });

  test('an image block turns the message into OpenAI content parts', () => {
    const req = draftFromPath([msg('u1', 'user', 'what is this?')], { model: 'gemma4:12b' });
    req.messages[0].blocks.push({ type: 'image', attId: 'att1' });
    const body = toOpenAIBody(req, { resolveImage: (b) => (b.attId === 'att1' ? 'data:image/png;base64,AAAA' : null) });
    assert.deepEqual(body.messages[0].content, [
      { type: 'text', text: 'what is this?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
  });

  test('an image block already carrying a dataUrl does not need the resolver', () => {
    const req = draftFromPath([msg('u1', 'user', 'see')], {});
    req.messages[0].blocks.push({ type: 'image', attId: 'a', dataUrl: 'data:image/png;base64,BBBB' });
    const body = toOpenAIBody(req, {});
    assert.equal(body.messages[0].content[1].image_url.url, 'data:image/png;base64,BBBB');
  });

  test('an image the resolver cannot supply (preview mode) is dropped, not sent as null', () => {
    const req = draftFromPath([msg('u1', 'user', 'see')], {});
    req.messages[0].blocks.push({ type: 'image', attId: 'a' });
    const body = toOpenAIBody(req, { resolveImage: () => null });
    assert.deepEqual(body.messages[0].content, [{ type: 'text', text: 'see' }]);
  });

  test('several text blocks in one message are joined by a blank line', () => {
    const req = draftFromPath([msg('u1', 'user', 'question')], {});
    req.messages[0].blocks.unshift({ type: 'text', text: '<<document>>', tag: 'doc' });
    assert.equal(toOpenAIBody(req, {}).messages[0].content, '<<document>>\n\nquestion');
  });

  test('continue mode keeps the trailing assistant last and tags it', () => {
    const path = [...simplePath(), msg('a2', 'assistant', 'It has 48 GB and')];
    const req = draftFromPath(path, { model: 'assistant', mode: 'continue' });
    assert.equal(req.mode, 'continue');
    const last = req.messages[req.messages.length - 1];
    assert.equal(last.role, 'assistant');
    assert.equal(last.blocks[0].tag, 'continue');
    const body = toOpenAIBody(req, {});
    assert.equal(body.messages[body.messages.length - 1].content, 'It has 48 GB and', 'the prefill is last on the wire');
  });

  test('a mid-path assistant is never tagged continue', () => {
    const req = draftFromPath(simplePath(), { mode: 'continue' });
    assert.equal(req.messages[1].blocks[0].tag, 'assistant');
  });

  test('responseFormat becomes response_format', () => {
    const req = draftFromPath(simplePath(), {});
    req.responseFormat = { type: 'json_schema', json_schema: { name: 'x', schema: {} } };
    assert.deepEqual(toOpenAIBody(req, {}).response_format, req.responseFormat);
  });

  test('meta carries the engine and the budget for the transforms downstream', () => {
    const req = draftFromPath(simplePath(), { engine: 'llama.cpp', budget: 16384 });
    assert.equal(req.meta.engine, 'llama.cpp');
    assert.equal(req.meta.budget, 16384);
    assert.deepEqual(req.meta.trimmedIds, []);
  });

  test('an empty or junk path is a valid empty draft', () => {
    assert.deepEqual(draftFromPath([], {}).messages, []);
    assert.deepEqual(draftFromPath(/** @type {any} */ (null), {}).messages, []);
    assert.deepEqual(draftFromPath([null, { role: 'system', content: 'x' }], {}).messages, []);
  });
};
