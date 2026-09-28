#!/usr/bin/env node
// P5-0 spike, exit criterion 4: an app drives dsh with no window — the SDK profile over JSON-RPC 2.0 on stdio
// (newline-delimited): `initialize` {cwd, provider, model, maxTokens} → `session/prompt` → `session.event` /
// `session.status` notifications until the agent is idle again. This is how the IDE's main process would embed it.
//
//   node docs/research/p5-spike/sdk.mjs --dsh-dir <dir> --home <DSH_HOME> --key <farm password> \
//        [--model qwen3.8:latest] [--max-tokens 8192] [--out <project dir>]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const model = args.model || 'qwen3.8:latest';
const cwd = path.resolve(args.out || path.join(args['dsh-dir'], 'sdk-proj'));
fs.rmSync(cwd, { recursive: true, force: true });
fs.mkdirSync(cwd, { recursive: true });
// --task edit: start from seed-index.html and add a speed slider (the run.mjs edit task, under the SDK's cap).
const EDIT = args.task === 'edit';
if (EDIT) fs.copyFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'seed-index.html'), path.join(cwd, 'index.html'));
const TEXT = EDIT
  ? 'index.html is a three.js page. Add an HTML range slider with id "speed" (from 0 to 5, starting at 1) in a corner of the page, and make it multiply the cube\'s rotation speed. Change nothing else.'
  : 'Create index.html here: a single-file three.js page with a slowly rotating cube (three.js 0.160.0 as an ES module from cdn.jsdelivr.net). Keep it minimal.';

const bin = path.join(args['dsh-dir'], 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const child = spawn(process.execPath, [bin, '--profile', 'sdk'], {
  cwd, env: { ...process.env, DSH_HOME: args.home, LOL_FARM_KEY: args.key }, stdio: ['pipe', 'pipe', 'pipe'],
});
let buf = '';
let nextId = 1;
const pending = new Map();
const seen = { events: 0, toolCalls: [], statuses: [] };
let idle = null;
const done = new Promise((resolve) => { idle = resolve; });

child.stdout.on('data', (d) => {
  buf += d;
  let at;
  while ((at = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, at).trim();
    buf = buf.slice(at + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && !msg.method && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); continue; }
    if (msg.method === 'session.event') {
      seen.events += 1;
      const e = msg.params && msg.params.event;
      const s = JSON.stringify(e || {});
      const tool = /"type":"tool_use"[^}]*"name":"([^"]+)"/.exec(s) || /"toolName":"([^"]+)"/.exec(s);
      if (tool) seen.toolCalls.push(tool[1]);
    }
    if (msg.method === 'session.status') {
      seen.statuses.push(msg.params.status);
      if (msg.params.status === 'idle' && seen.statuses.includes('running')) idle();
    }
  }
});
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });

const call = (method, params) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});

const t0 = Date.now();
const init = await call('initialize', { cwd, provider: 'lolfarm', model, maxTokens: Number(args['max-tokens'] || 8192) });
console.log('initialize →', JSON.stringify(init.result || init.error));
// Session ids are DURABLE (dsh keeps every session under DSH_HOME/sessions): a new one per run.
const prompt = await call('session/prompt', {
  sessionId: `spike-${Date.now()}`,
  contentBlocks: [{ type: 'text', text: TEXT }],
});
console.log('session/prompt →', JSON.stringify(prompt.result || prompt.error));
if (prompt.error) { child.stdin.end(); process.exit(1); }
const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 10 * 60 * 1000));
const how = await Promise.race([done.then(() => 'idle'), timeout]);
child.kill();
const file = path.join(cwd, 'index.html');
const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
console.log(JSON.stringify({
  model, ended: how, seconds: Math.round((Date.now() - t0) / 1000), events: seen.events,
  statuses: seen.statuses.join(' → '), page: { file: !!html, three: /three/.test(html), renderer: /WebGLRenderer/.test(html), cube: /BoxGeometry/.test(html), ...(EDIT ? { slider: /type=["']?range/i.test(html) && /id=["']?speed/.test(html), kept: /DirectionalLight/.test(html) && /MeshStandardMaterial/.test(html) } : {}) },
  stderr: stderr.slice(-400) || undefined,
}));
// On Windows kill() does not take down dsh's own children and the open pipes keep this process alive: the SDK
// has no close method (a client ends a runtime by closing it), so end the stdin and leave.
child.stdin.end();
process.exit(0);
