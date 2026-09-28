// @ts-check
// The IDE's agent reply in LOL Vibe (renderer/chat/projects/agent.mjs + models.mjs): main's records fold into the
// answer, a step log and the edits; a turn ends as done, stopped, refused or "ran out of room" — never a silent
// "done" with nothing in it; the recap keeps the newest turns; a model is trusted with edits only when measured.
import assert from 'node:assert/strict';
import { buildRecap, emptyTurn, applyRecord, resultOf, startAgentTurn } from '../../../renderer/chat/projects/agent.mjs';
import { profileFor, pickEditor } from '../../../renderer/chat/projects/models.mjs';

const REC = {
  thought: { kind: 'step', text: '', reasoning: 'I will write the page.', stopReason: 'toolUse', outTokens: 20 },
  write: { kind: 'call', callId: 'c1', name: 'write', target: 'index.html' },
  wrote: { kind: 'result', callId: 'c1', ok: true, created: true, diffs: [], error: null },
  edit: { kind: 'call', callId: 'c2', name: 'edit', target: 'index.html' },
  edited: { kind: 'result', callId: 'c2', ok: true, created: false, diffs: [{ path: 'index.html', oldText: 'a', newText: 'b' }], error: null },
  read: { kind: 'call', callId: 'c3', name: 'read', target: 'missing.txt' },
  failed: { kind: 'result', callId: 'c3', ok: false, created: false, diffs: [], error: 'Error: cannot read "./missing.txt": not found\nmore' },
  answer: { kind: 'step', text: 'Done: a page with a cube.', reasoning: '', stopReason: 'stop', outTokens: 30 },
  end: { kind: 'end', reason: 'completed' },
};

/** A door that records calls and lets the test push events. */
function fakeDoor(answer = { ok: true }) {
  /** @type {any[]} */ const prompts = [];
  let stops = 0;
  return {
    prompts, get stops() { return stops; },
    prompt: async (/** @type {any} */ o) => { prompts.push(o); return answer; },
    stop: async () => { stops += 1; return { ok: true }; },
  };
}

export default (test) => {
  test('agent: records fold into the answer, one step line per tool call, and the edits', () => {
    const s = emptyTurn();
    for (const r of [REC.thought, REC.write, REC.wrote, REC.edit, REC.edited, REC.read, REC.failed, REC.answer, REC.end]) applyRecord(s, r);
    assert.equal(s.content, 'Done: a page with a cube.');
    assert.deepEqual(s.reasoning.split('\n'), [
      'I will write the page.',
      '→ write index.html ✓',
      '→ edit index.html ✓ (1 change)',
      '→ read missing.txt ✗ Error: cannot read "./missing.txt": not found',
    ]);
    assert.deepEqual(s.changes, [{ path: 'index.html', oldText: 'a', newText: 'b' }]);
    assert.deepEqual(s.created, ['index.html']);
    assert.equal(s.outTokens, 50);
    assert.equal(s.sawToolCalls, false, 'never the farm-tool-call flag the controller refuses');
    assert.deepEqual(resultOf(s, { reason: 'completed' }), { status: 'done', abortedBy: null, error: null });
  });

  test('agent: a turn is stopped, refused, broken or out of room — each says so, none reads as done', () => {
    assert.equal(resultOf(emptyTurn(), { reason: 'stopped' }).status, 'aborted');
    const refused = resultOf(emptyTurn(), { reason: 'refused', error: 'The coding agent is not installed on this computer yet.' });
    assert.equal(refused.status, 'error');
    assert.equal(refused.error.kind, 'local');
    assert.match(refused.error.farmMessage, /not installed/);
    const broke = resultOf(emptyTurn(), { reason: 'error', error: 'The coding agent stopped.' });
    assert.equal(broke.error.kind, 'stream_error');
    const room = emptyTurn();
    applyRecord(room, { kind: 'step', text: '', reasoning: 'thinking a lot', stopReason: 'length', outTokens: 4096 });
    const out = resultOf(room, { reason: 'completed' });
    assert.equal(out.status, 'error', 'an empty answer that hit the cap is not "done"');
    assert.match(out.error.farmMessage, /ran out of room/);
    const quiet = emptyTurn();
    assert.equal(resultOf(quiet, { reason: 'completed' }).status, 'done');
    assert.match(quiet.content, /Changes tab/, 'a turn with only tool calls still says something');
  });

  test('agent: the recap keeps the newest turns within its budget, and is empty with no history', () => {
    assert.equal(buildRecap([]), '');
    const path = [];
    for (let i = 0; i < 40; i++) path.push({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i} ` + 'x'.repeat(300) });
    const r = buildRecap(path);
    assert.ok(r.length < 6600, `bounded: ${r.length}`);
    assert.match(r, /^Earlier in this conversation/);
    assert.match(r, /turn 39 /, 'the newest turn is kept');
    assert.doesNotMatch(r, /turn 0 /, 'the oldest is dropped');
    assert.match(r, /Now:$/);
    assert.match(buildRecap([{ role: 'user', content: 'make a cube' }, { role: 'assistant', content: 'Done.' }]), /Person: make a cube\nYou: Done\./);
  });

  test('agent: a turn asks main with its own id, paints each record, and ends with a result', async () => {
    const door = fakeDoor();
    /** @type {any[]} */ const tails = [];
    const turn = startAgentTurn({ projectId: 'p-abcd1234', threadId: 't', model: 'qwen3.8:latest', text: 'hi', recap: 'R', maxTokens: 8192, door, onTail: (s) => tails.push(s.reasoning) });
    await Promise.resolve();
    assert.equal(door.prompts.length, 1);
    const ask = door.prompts[0];
    assert.match(ask.turnId, /^t[a-z0-9]+$/);
    assert.deepEqual({ ...ask, turnId: '' }, { turnId: '', projectId: 'p-abcd1234', threadId: 't', model: 'qwen3.8:latest', text: 'hi', recap: 'R', maxTokens: 8192 });
    assert.equal(turn.state.content, '');
    assert.equal(door.stops, 0);
    turn.abort();
    const r = await turn.done;
    assert.equal(r.status, 'aborted');
    assert.equal(door.stops, 1, 'Stop reaches main');
    const refused = startAgentTurn({ projectId: 'p', threadId: 't', model: 'm', text: 'x', door: fakeDoor({ ok: false, code: 'E_RUNTIME', message: 'The coding agent is not installed on this computer yet.' }) });
    const rr = await refused.done;
    assert.equal(rr.status, 'error');
    assert.match(rr.error.message, /not installed/);
  });

  test('agent: outside the app (no door) the turn is refused in words', async () => {
    const r = await startAgentTurn({ projectId: 'p', threadId: 't', model: 'm', text: 'x', door: null }).done;
    // door:null falls back to the real door, which the unit runner does not have.
    assert.equal(r.status, 'error');
    assert.match(r.error.message, /LlmOnLan app/);
  });

  test('models: qwen3.8 and nemotron are trusted with edits, gemma4 is not, a new model is unknown', () => {
    assert.equal(profileFor('qwen3.8:latest').edits, 'good');
    assert.equal(profileFor('Qwen3.8-latest').edits, 'good', 'the live farm\'s alias');
    assert.equal(profileFor('nemotron-3.5-lightning:30b').edits, 'good');
    assert.equal(profileFor('gemma4:12b').edits, 'weak');
    assert.equal(profileFor('gemma4:12b').maxTokens, 4096);
    assert.deepEqual(profileFor('brand-new:7b'), { edits: 'unknown', maxTokens: 8192, measured: '' });
    assert.equal(profileFor(null).edits, 'unknown');
  });

  test('models: a project chat moves off a weak default to a good model the farm serves — never off a person\'s pick', () => {
    const farm = [{ id: 'gemma4:12b' }, { id: 'Qwen3.8-latest', underlying: 'qwen3.8:latest' }, { id: 'nemotron-3.5-lightning:30b' }];
    assert.equal(pickEditor('gemma4:12b', farm, false), 'Qwen3.8-latest', 'the first good one, judged behind its alias');
    assert.equal(pickEditor('gemma4:12b', farm, true), 'gemma4:12b', 'a person chose it on this thread: it stays');
    assert.equal(pickEditor('nemotron-3.5-lightning:30b', farm, false), 'nemotron-3.5-lightning:30b', 'already good');
    assert.equal(pickEditor('assistant', [{ id: 'assistant', underlying: 'Qwen3.8-27B-UD-IQ2_S' }], false), 'assistant', 'good behind llama.cpp\'s alias');
    assert.equal(pickEditor('gemma4:12b', [{ id: 'gemma4:12b' }], false), 'gemma4:12b', 'nothing better served: unchanged');
    assert.equal(pickEditor('', farm, false), 'Qwen3.8-latest', 'no model yet');
    assert.equal(pickEditor('x', null, false), 'x');
  });
};
