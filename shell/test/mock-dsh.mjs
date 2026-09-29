#!/usr/bin/env node
// A stand-in for DeepSeek Harness's SDK runtime (`dsh --profile sdk`), for the IDE's unit tests and the harness: the
// same wire (JSON-RPC 2.0, one message per line on stdio) and the same event shapes as the recorded sessions in
// test/chat/fixtures/dsh/, with a scripted "model" that reads the prompt:
//   "write <file>: <text>"             → a `write` tool call that really creates the file (in cwd)
//   "replace <old> with <new> in <file>" → an `edit` tool call that really edits it, with meta.diffs
//   "read <file>"                      → a `read` call (a missing file is an isError result)
//   "slow"                             → the turn waits 60 s before it answers (for Stop)
//   "crash"                            → the process dies mid-turn (for the runtime-died path)
// With the "keep going" sentence (studio.ts GOAL_PROMPT) it acts out dsh's goal loop, with the real event shapes
// (goal/change; each round a user/message whose source is {kind:"goal", round}):
//   "rounds N"                         → create_goal, then N rounds, each writing round-<n>.txt; the last completes it
//   "goal-maxtokens"                   → create_goal, then the turn ends on max-tokens (dsh disarms the goal)
//   "goal-stall"                       → create_goal, a normal end, and no round ever comes (a disarmed goal)
// Its final answer quotes the whole prompt it received, so a test can see a recap arrive.
import fs from 'node:fs';
import path from 'node:path';

let seq = 0;
let buf = '';
const sessions = new Set();
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
const event = (sessionId, type, data) => send({ method: 'session.event', params: { sessionId, event: { type, seq: seq++, time: Date.now(), data } } });
const status = (sessionId, s) => send({ method: 'session.status', params: { sessionId, status: s } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let callN = 0;

async function tool(sessionId, step, name, args, run) {
  const callId = `call-${++callN}`;
  event(sessionId, 'assistant/message', {
    turn: 1, step, usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    message: { role: 'assistant', content: [{ type: 'reasoning', text: `I will ${name} ${args.file_path}.` }, { type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }], source: { kind: 'model', replayState: { response: { stopReason: 'toolUse' } } } },
  });
  event(sessionId, 'tool/call', { turn: 1, step, callId, name, arguments: JSON.stringify(args) });
  let out;
  try { out = run(); } catch (e) { out = { isError: true, text: `Error: ${e.message}` }; }
  event(sessionId, 'tool/result', {
    turn: 1, step,
    message: { role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: out.text }], isError: !!out.isError },
    ...(out.meta ? { meta: out.meta } : {}),
  });
}

/** dsh's goal loop, as the recorded sessions show it: the model creates the goal; after each idle dsh starts a round. */
async function goalTurn(sessionId, text) {
  const goal = { id: 'goal-mock', revision: 1, objective: text.split('\n\n').pop().slice(0, 200), phase: 'active', maxGoalRounds: 10 };
  const change = (operation, rounds) => event(sessionId, 'goal/change', { kind: 'goal/change', version: 1, operation, goal: { ...goal }, roundsStarted: rounds });
  const say = (turnN, words) => event(sessionId, 'assistant/message', {
    turn: turnN, step: 9, usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
    message: { role: 'assistant', content: [{ type: 'text', text: words }], source: { kind: 'model', replayState: { response: { stopReason: 'stop' } } } },
  });
  status(sessionId, 'running');
  event(sessionId, 'turn/start', { turn: 1 });
  await tool(sessionId, 1, 'create_goal', { objective: goal.objective }, () => { change('create', 0); return { text: JSON.stringify({ goal }) }; });
  if (/goal-maxtokens/.test(text)) {
    event(sessionId, 'turn/end', { turn: 1, reason: { kind: 'max-tokens' } });
    status(sessionId, 'idle');
    return;
  }
  say(1, 'Goal set: working on it round by round.');
  event(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } });
  status(sessionId, 'idle');
  if (/goal-stall/.test(text)) return;
  const n = Number((/rounds (\d+)/.exec(text) || [])[1] || 2);
  for (let r = 1; r <= n; r++) {
    await sleep(200);   // a real round takes seconds; this is still far quicker
    status(sessionId, 'running');
    event(sessionId, 'user/message', { content: [{ type: 'text', text: `<goal_round>\nRound: ${r}/${goal.maxGoalRounds}` }], source: { kind: 'goal', goalId: goal.id, revision: goal.revision, round: r }, role: 'user', id: `round-${r}` });
    event(sessionId, 'turn/start', { turn: r + 1 });
    await tool(sessionId, 1, 'write', { file_path: `round-${r}.txt`, content: `round ${r}` }, () => {
      fs.writeFileSync(path.resolve(`round-${r}.txt`), `round ${r}`);
      return { text: 'Created file', meta: { operation: 'create', diffs: [] } };
    });
    if (r === n) {
      await tool(sessionId, 2, 'update_goal', { goal_id: goal.id, revision: goal.revision, action: 'complete' }, () => {
        goal.phase = 'complete'; goal.revision += 1; change('complete', r);
        return { text: JSON.stringify({ goal }) };
      });
    }
    say(r + 1, r === n ? `Goal complete after ${n} rounds.` : `Round ${r} done.`);
    event(sessionId, 'turn/end', { turn: r + 1, reason: { kind: 'completed' } });
    status(sessionId, 'idle');
  }
}

async function turn(sessionId, text) {
  if (/Take this on as a goal/.test(text)) return goalTurn(sessionId, text);
  status(sessionId, 'running');
  event(sessionId, 'turn/start', { turn: 1 });
  if (/crash/.test(text)) { await sleep(50); process.exit(3); }
  if (/slow/.test(text)) await sleep(60000);
  let step = 1;
  const w = /write (\S+): ([^\n]+)/.exec(text);
  if (w) {
    await tool(sessionId, step++, 'write', { file_path: w[1], content: w[2] }, () => {
      fs.mkdirSync(path.dirname(path.resolve(w[1])), { recursive: true });   // dsh's write makes the folders too
      fs.writeFileSync(path.resolve(w[1]), w[2]);
      return { text: `<path>${path.resolve(w[1])}</path>\nCreated file`, meta: { operation: 'create', diffs: [] } };
    });
  }
  const r = /replace (\S+) with (\S+) in (\S+)/.exec(text);
  if (r) {
    await tool(sessionId, step++, 'edit', { file_path: path.resolve(r[3]), old_string: r[1], new_string: r[2] }, () => {
      const abs = path.resolve(r[3]);
      const before = fs.readFileSync(abs, 'utf8');
      if (!before.includes(r[1])) return { isError: true, text: `Error: old_string not found in ${abs}` };
      fs.writeFileSync(abs, before.replace(r[1], r[2]));
      return { text: `The file ${abs} has been updated successfully.`, meta: { diffs: [{ path: abs, oldText: r[1], newText: r[2] }] } };
    });
  }
  const rd = /read (\S+)/.exec(text);
  if (rd) {
    await tool(sessionId, step++, 'read', { file_path: rd[1] }, () => {
      const abs = path.resolve(rd[1]);
      if (!fs.existsSync(abs)) return { isError: true, text: `Error: cannot read "${abs}": not found` };
      return { text: fs.readFileSync(abs, 'utf8') };
    });
  }
  event(sessionId, 'assistant/message', {
    turn: 1, step, usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
    message: { role: 'assistant', content: [{ type: 'reasoning', text: 'Done.' }, { type: 'text', text: `Done. I saw: ${text}${/mcp\?/.test(text) ? ` [the Computer's token: ${process.env.LOL_MCP_TOKEN ? 'set' : 'unset'}]` : ''}` }], source: { kind: 'model', replayState: { response: { stopReason: 'stop' } } } },
  });
  event(sessionId, 'turn/end', { turn: 1, reason: { kind: 'completed' } });
  status(sessionId, 'idle');
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let at;
  while ((at = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, at).trim();
    buf = buf.slice(at + 1);
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.method === 'initialize') send({ id: m.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } } });
    else if (m.method === 'session/prompt') {
      const p = m.params || {};
      sessions.add(p.sessionId);
      send({ id: m.id, result: { messageId: `msg-${seq}` } });
      const text = (p.contentBlocks || []).map((b) => b.text || '').join('');
      void turn(p.sessionId, text);
    } else if (m.id != null) send({ id: m.id, error: { code: -32601, message: 'method not found' } });
  }
});
process.stdin.on('end', () => process.exit(0));
