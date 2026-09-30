#!/usr/bin/env node
// P5-L spike (2026-09-29): can qwen3.8 run AGENT LOOPS in the DeepSeek Harness we ship? The shipped profile patch
// (shell/build/main/studio.js buildPatch — the fence, no shell, no web, telemetry off) with three changes only:
// dsh's own goal loop turned back on (tool-goal + goal-round-driver, a round cap), the compaction headroom fitted to
// a small window, and — for the Computer tasks — the Computer's MCP server as a tool source. The model decides to
// create a goal; dsh then starts round after round until the model marks it complete or blocked, or the cap is hit.
//
//   node docs/research/p5-loop-spike/loop.mjs --task project|computer|research --model qwen3.8:latest
//        [--window 32768] [--no-compaction-fix] [--rounds 8] [--minutes 15] [--tag run1]
// Needs: the private farm on 127.0.0.1:4100 (no password), shell/build (npm run build), the dsh runtime in
// shell/dsh/build/dsh-runtime, and for computer/research an isolated dev client serving the Computer's MCP on
// 127.0.0.1:41995 (its token: --mcp-token or LOL_MCP_TOKEN). Writes <out>/<tag>/{events.jsonl,result.json}.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const require = createRequire(import.meta.url);
const S = require(path.join(REPO, 'shell', 'build', 'main', 'studio.js'));

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const task = arg('task', 'project');
const model = arg('model', 'qwen3.8:latest');
const windowTokens = Number(arg('window', '32768'));
const rounds = Number(arg('rounds', '8'));
const minutes = Number(arg('minutes', '15'));
const fixCompaction = !flag('no-compaction-fix');
const tag = arg('tag', `${task}-${model.replace(/[^a-z0-9]+/gi, '_')}-${Date.now()}`);
const out = path.resolve(arg('out', path.join(os.tmpdir(), 'claude', 'p5loop')), tag);
const mcpToken = arg('mcp-token', process.env.LOL_MCP_TOKEN || '');
const useMcp = task === 'computer' || task === 'research';
if (useMcp && !mcpToken) { console.error('computer/research need --mcp-token (the dev client\'s mcpToken)'); process.exit(2); }

// ---- the tasks (what a person would type) and their checks -----------------------------------------------------
const REGIONS = ['Bretagne', 'Occitanie', 'Grand Est', 'Normandie', 'Hauts-de-France'];
const DISCIPLINES = ['Musique', 'Théâtre', 'Cinéma', 'Danse', 'Livre'];
function seedCsv() {   // deterministic but irregular (a seeded LCG): 73 festivals, uneven counts nobody can guess
  const rows = ['name,region,discipline,visitors'];
  let x = 20260929;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const pick = (list, skew) => list[Math.min(list.length - 1, Math.floor(Math.pow(rnd(), skew) * list.length))];
  for (let i = 0; i < 73; i++) rows.push(`Festival ${i + 1},${pick(REGIONS, 1.6)},${pick(DISCIPLINES, 1.9)},${1000 + Math.floor(rnd() * 9000)}`);
  return rows.join('\n') + '\n';
}
function csvTruth(csv) {
  const byRegion = {}; const byDisc = {};
  for (const line of csv.trim().split('\n').slice(1)) {
    const [, r, d] = line.split(',');
    byRegion[r] = (byRegion[r] || 0) + 1; byDisc[d] = (byDisc[d] || 0) + 1;
  }
  const top3 = Object.entries(byDisc).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
  return { byRegion, top3 };
}
const TASKS = {
  project: {
    seed: () => {},
    text: 'Make a small browser game in this folder and keep working until it is finished: Snake, in index.html and '
      + 'game.js (and style.css if you want). Finished means all four of these work: (1) the score is shown on screen '
      + 'and goes up when the snake eats; (2) a Restart button starts a new game; (3) the best score is kept in '
      + 'localStorage and shown; (4) the arrow keys and W A S D both steer. Check your own files against the four '
      + 'points before you say it is finished.',
    check: (dir) => {
      const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
      const html = read('index.html'); const js = read('game.js') + '\n' + (html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || []).join('\n');
      const syntax = fs.existsSync(path.join(dir, 'game.js'))
        ? spawnSync(process.execPath, ['--check', path.join(dir, 'game.js')], { encoding: 'utf8' }).status === 0 : false;
      return {
        files: { html: !!html, gameJs: fs.existsSync(path.join(dir, 'game.js')) },
        loadsGameJs: /<script[^>]+src=["']?\.?\/?game\.js/i.test(html),
        gameJsParses: syntax,
        score: /score/i.test(js) && /score/i.test(html + js),
        restart: /restart/i.test(html + js),
        localStorage: /localStorage\.(setItem|getItem)|localStorage\[/.test(js),
        arrows: /ArrowUp|ArrowLeft|keyCode\s*===?\s*3[7-9]|keyCode\s*===?\s*40/.test(js),
        wasd: /KeyW|['"]w['"]|\bw\s*:/i.test(js) && /KeyS|['"]s['"]|\bs\s*:/i.test(js),
      };
    },
  },
  game: {   // bigger than one turn: eight requirements, each checked in the files
    seed: () => {},
    text: 'Make a complete browser Snake game in this folder (index.html, game.js, style.css). Finished means all eight '
      + 'work: (1) the score is shown and goes up when the snake eats; (2) a Restart button; (3) the best score kept in '
      + 'localStorage and shown; (4) arrow keys and W A S D steer; (5) P or Space pauses and resumes, with "Paused" '
      + 'shown; (6) the snake speeds up every 5 foods, and the level is shown; (7) a short beep on eating, made with the '
      + 'Web Audio API (no sound files), with a mute button; (8) swipe gestures steer on a touch screen. Check each '
      + 'point in your own files before you say it is finished.',
    check: (dir) => {
      const base = TASKS.project.check(dir);
      const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
      const all = read('index.html') + '\n' + read('game.js');
      return {
        ...base,
        pause: /paus/i.test(all) && /(Space|' '|"\s"|KeyP|['"]p['"]|\bp\s*:)/i.test(all),
        level: /level/i.test(all),
        webAudio: /AudioContext|webkitAudioContext/.test(all) && /mute/i.test(all),
        swipe: /touchstart/.test(all) && /touchend|touchmove/.test(all),
      };
    },
  },
  computer: {
    seed: () => {},
    text: 'Use the LlmOnLan Computer (its tools are available to you) to build and test a small program, and keep '
      + 'going until it works: a new graph called "Room monitor" where a Text box holds a temperature reading, a Code '
      + 'box decides "too hot" when the reading is above 26 and "fine" otherwise, a Preview shows the verdict, and a '
      + 'Send box would send the verdict by OSC to 127.0.0.1:9000 at the address /room/alert (it stays a dry run: only '
      + 'a person arms outputs). Run it with the reading 24, then with 29, and tell me both verdicts.',
    check: null,   // judged from the Computer's own state after the run (read over MCP below) and the final answer
  },
  research: {
    seed: (dir) => fs.writeFileSync(path.join(dir, 'data.csv'), seedCsv()),
    text: 'data.csv in this folder lists festivals. Write report.md: the number of festivals in each region, and the '
      + 'three most common disciplines with their counts. The numbers must be computed by code on the LlmOnLan '
      + 'Computer (its tools are available to you: put the CSV text in a Text box, count in a Code box, run it) — '
      + 'never counted by you. Keep working until report.md holds the numbers the Computer computed.',
    check: (dir) => {
      const truth = csvTruth(seedCsv());
      let md = ''; try { md = fs.readFileSync(path.join(dir, 'report.md'), 'utf8'); } catch { /* none */ }
      const near = (name, n) => new RegExp(`${name.replace(/[-]/g, '.')}[^\\n]{0,40}?\\b${n}\\b`, 'i').test(md);
      const regions = Object.entries(truth.byRegion).map(([r, n]) => ({ r, n, found: near(r, n) }));
      const top = truth.top3.map(([d, n]) => ({ d, n, found: near(d, n) }));
      return { report: !!md, regionsRight: regions.filter((x) => x.found).length + '/' + regions.length, top3Right: top.filter((x) => x.found).length + '/3', regions, top };
    },
  },
};
const T = TASKS[task];
// --goal: the sentence a person's 'keep going until it is done' switch would add (only the model can start a dsh goal).
const GOAL = 'Take this on as a goal and keep working on it round after round until it is really finished. ';
const promptText = (flag('goal') ? GOAL : '') + (arg('text', '') || T.text);
// --rounds-mode: make the goal outlast one turn, to exercise dsh's round driver (a long job would).
const ROUNDS_MODE = 'Do ONE of the numbered requirements per round: finish it, check it, then end your turn with a one-line progress note (do not mark the goal complete until all of them are done). ';
const finalText = flag('rounds-mode') ? promptText.replace(GOAL, GOAL + ROUNDS_MODE) : promptText;
if (!T) { console.error('unknown --task'); process.exit(2); }

// ---- a private DSH_HOME, the shipped patch with the loop turned on -----------------------------------------------
fs.rmSync(out, { recursive: true, force: true });
const home = path.join(out, 'home');
const proj = path.join(out, 'project');
const skills = path.join(home, 'skills');
fs.mkdirSync(path.join(home, 'profiles', 'sdk'), { recursive: true });
fs.mkdirSync(proj, { recursive: true });
S.copyTree(path.join(REPO, 'shell', 'assets', 'skills'), skills);
const fence = path.join(home, 'fence.mjs');
const check = path.join(home, 'check.mjs');
fs.writeFileSync(fence, S.FENCE_JS);
fs.writeFileSync(check, S.CHECK_JS);
const runtime = S.resolveRuntime({ LOL_DSH_DIR: path.join(REPO, 'shell', 'dsh', 'build', 'dsh-runtime') }, home);
if (!runtime) { console.error('no dsh runtime in shell/dsh/build/dsh-runtime'); process.exit(2); }
// The hooks config is a FILE whose path the patch names, as in studio.ts (the first spike runs passed the JSON itself,
// so the fence was not loaded then — no task tried to leave its project; corrected 2026-09-30).
const hooksFile = path.join(home, 'hooks.json');
fs.writeFileSync(hooksFile, S.fenceHooks(runtime.node, fence, process.platform, check));
let patch = S.buildPatch({
  baseUrl: 'http://127.0.0.1:4100/v1', model, contextWindow: windowTokens, skillsDir: skills.replace(/\\/g, '/'),
  hooksConfig: hooksFile,
});
const ON = ['tool-goal', 'goal-round-driver', 'command-goal'];
patch = patch.split('\n').filter((l) => !ON.some((id) => l.trim() === `- { id: ${id}, disabled: true }`)).join('\n');
const extra = [`- id: goal`, `  config:`, `    defaultMaxGoalRounds: ${rounds}`];
if (fixCompaction) extra.push('- id: compaction-basic', '  config:', '    headroomTokens: 4096', '    maxTokens: 4096');
patch = patch.replace('\n- insert:\n', '\n' + extra.join('\n') + '\n- insert:\n');
if (useMcp) {
  patch += [
    '    - id: mcp-lol',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: computer',
    '        transport: streamable-http',
    '        url: "http://127.0.0.1:41995/mcp"',
    '        headers:',
    `          Authorization: ${JSON.stringify('Bearer ' + mcpToken)}`,
    '        toolCallTimeoutMs: 180000',
    '        failOnStartupError: true',
    '',
  ].join('\n');
}
fs.writeFileSync(path.join(home, 'profiles', 'sdk', 'cordis.patch.yml'), patch);
T.seed(proj);

// ---- run: one person's message, then whatever rounds the goal loop starts ---------------------------------------
const child = spawn(runtime.node, [runtime.bin, '--profile', 'sdk'], {
  cwd: proj, env: S.runtimeEnv(process.env, { home, key: 'sk-lol-lan' }), stdio: ['pipe', 'pipe', 'pipe'],
});
const log = fs.createWriteStream(path.join(out, 'events.jsonl'));
let buf = ''; let nextId = 1; let stderr = '';
const pending = new Map();
const seen = { types: {}, tools: {}, toolErrors: 0, goalRounds: 0, goal: null, goalOps: [], statuses: [], lastText: '', refused: 0 };
let status = 'idle'; let idleAt = Date.now(); let lastEventAt = Date.now();
child.stderr.on('data', (d) => { stderr += d; });
child.stdout.on('data', (d) => {
  buf += d;
  let at;
  while ((at = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, at).trim(); buf = buf.slice(at + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && !msg.method && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); continue; }
    log.write(JSON.stringify({ t: Date.now(), ...msg }) + '\n');
    lastEventAt = Date.now();
    if (msg.method === 'session.status') {
      status = msg.params.status; seen.statuses.push(status);
      if (status === 'idle') idleAt = Date.now();
    }
    if (msg.method !== 'session.event') continue;
    const e = (msg.params && msg.params.event) || {};
    seen.types[e.type] = (seen.types[e.type] || 0) + 1;
    const s = JSON.stringify(e);
    if (e.type === 'goal/change') {
      const g = (e.data && e.data.goal) || null;
      seen.goalOps.push(`${e.data && e.data.operation}:${g ? g.phase : 'none'}:${g ? g.roundsStarted : 0}`);
      seen.goal = g;
    }
    if (/"kind":"goal"/.test(s) && e.type === 'user/message') seen.goalRounds += 1;
    if (e.type === 'tool/call' && e.data && e.data.name) seen.tools[e.data.name] = (seen.tools[e.data.name] || 0) + 1;
    if (e.type === 'tool/result' && e.data && e.data.message && e.data.message.isError === true) seen.toolErrors += 1;
    if (/only files inside this project/.test(s)) seen.refused += 1;
    if (e.type === 'assistant/message' || e.type === 'agent/message') {
      const txt = (/"text":"((?:[^"\\]|\\.)*)"/.exec(s) || [])[1];
      if (txt) seen.lastText = JSON.parse(`"${txt}"`).slice(0, 1500);
    }
  }
});
const call = (method, params) => new Promise((resolve) => {
  const id = nextId++; pending.set(id, resolve);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});

const t0 = Date.now();
const init = await call('initialize', { cwd: proj, provider: 'lolfarm', model, maxTokens: Number(arg('max-tokens', '8192')) });
if (init.error) { console.log(JSON.stringify({ tag, error: init.error, stderr: stderr.slice(-800) })); child.stdin.end(); process.exit(1); }
const sessionId = `loop-${Date.now()}`;
const sent = await call('session/prompt', { sessionId, contentBlocks: [{ type: 'text', text: finalText }] });
if (sent.error) { console.log(JSON.stringify({ tag, error: sent.error })); child.stdin.end(); process.exit(1); }

// End: the goal settled (complete/blocked) and the agent idle; or idle with no goal armed for 20 s; or the time cap.
let ended = 'timeout';
for (;;) {
  await new Promise((r) => setTimeout(r, 1000));
  const g = seen.goal;
  const settled = g && ['complete', 'blocked', 'paused'].includes(g.phase);
  if (status === 'idle' && settled && Date.now() - idleAt > 3000) { ended = `goal-${g.phase}`; break; }
  if (status === 'idle' && !g && seen.statuses.includes('running') && Date.now() - idleAt > 20000) { ended = 'idle-no-goal'; break; }
  if (status === 'idle' && g && g.phase === 'active' && Date.now() - lastEventAt > 60000) { ended = 'idle-goal-stuck'; break; }
  if (Date.now() - t0 > minutes * 60000) break;
}
const seconds = Math.round((Date.now() - t0) / 1000);
child.stdin.end();
if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)]); else child.kill();

// ---- the checks ------------------------------------------------------------------------------------------------
let checks = T.check ? T.check(proj) : null;
if (task === 'computer') {
  const mcp = async (method, params) => (await (await fetch('http://127.0.0.1:41995/mcp', {
    method: 'POST', headers: { authorization: `Bearer ${mcpToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })).json());
  const graphs = await mcp('tools/call', { name: 'list_graphs', arguments: {} });
  const open = await mcp('tools/call', { name: 'read_graph', arguments: {} });
  const text = JSON.stringify(open);
  checks = {
    graphTitled: /Room monitor/i.test(JSON.stringify(graphs)),
    boxes: ['note', 'code', 'preview', 'send'].map((b) => `${b}:${new RegExp(`\\\\?"type\\\\?":\\s*\\\\?"${b}\\\\?"`).test(text)}`).join(' '),
    answerSaysBoth: /fine/i.test(seen.lastText) && /too hot/i.test(seen.lastText),
  };
}
const result = {
  tag, task, model, window: windowTokens, maxTokens: Number(arg('max-tokens', '8192')), compactionFix: fixCompaction, roundsCap: rounds, ended, seconds,
  goal: seen.goal && { phase: seen.goal.phase, roundsStarted: seen.goal.roundsStarted, max: seen.goal.maxGoalRounds, blockedReason: seen.goal.blockedReason },
  goalOps: seen.goalOps, roundMessages: seen.goalRounds, tools: seen.tools, toolErrors: seen.toolErrors, fenceRefusals: seen.refused,
  eventTypes: seen.types, checks, lastText: seen.lastText.slice(0, 600), stderr: stderr.slice(-600) || undefined,
};
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
process.exit(0);
