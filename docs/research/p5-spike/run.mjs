#!/usr/bin/env node
// P5-0 spike (docs/ECOSYSTEM_PLAN.md §4.3): does DeepSeek Harness (dsh) drive a small coding task on the farm's
// models? One headless session per model, each in a fresh project folder, on the plan's task: a three.js page.
//
//   node docs/research/p5-spike/run.mjs --dsh-dir <folder where @deepseek-ai/dsh is installed> \
//        --home <DSH_HOME whose headless profile routes to the farm> --key <farm password> \
//        [--models qwen3.8:latest,nemotron-3.5-lightning:30b] [--reps 2] [--out <dir>]
//
// Per run it records: the tool calls and how many came back `completed` (the plan's bar: ≥ 80% correct), whether
// the ponytail skill was loaded, the wall time, and whether the page it left is a three.js page (static checks —
// a file, the three module, a scene, a renderer, an animation loop). Raw events go to <out>/<model>-<n>.jsonl.
// Nothing here talks to the farm directly: dsh does, through its own llm-pi-ai route.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const DSH_DIR = args['dsh-dir'];
const HOME = args.home;
if (!DSH_DIR || !HOME || !args.key) { console.error('usage: --dsh-dir <dir> --home <DSH_HOME> --key <farm password>'); process.exit(2); }
const MODELS = String(args.models || 'qwen3.8:latest').split(',');
const REPS = Number(args.reps || 1);
const OUT = path.resolve(args.out || path.join(DSH_DIR, 'runs'));
const TIMEOUT_MS = 10 * 60 * 1000;
// --task build (default): make the page from nothing. --task edit: change seed-index.html without breaking it —
// the IDE's everyday job, where errors compound.
const MODE = args.task === 'edit' ? 'edit' : 'build';
const SEED = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'seed-index.html');
const TASK = MODE === 'edit'
  ? 'index.html is a three.js page. Add an HTML range slider with id "speed" (from 0 to 5, starting at 1) in a '
    + 'corner of the page, and make it multiply the cube\'s rotation speed. Change nothing else. When done, say so in one sentence.'
  : 'In this folder, create index.html: a single-file three.js page that shows a slowly rotating cube lit by '
    + 'one light, filling the window. Load three.js as an ES module from https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js '
    + '(an import map is fine). Keep it minimal. When the file is written, say so in one sentence.';

/** Run one headless session; resolve its events and wall time. */
function session(model, cwd) {
  const patch = path.join(OUT, `model-${model.replace(/[^a-z0-9.-]/gi, '_')}.yml`);
  fs.writeFileSync(patch, `- id: agent-default-model\n  config:\n    provider: lolfarm\n    model: ${JSON.stringify(model)}\n`);
  const bin = path.join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, '--profile', 'headless', '--patch', patch, '--json', TASK], {
      cwd, env: { ...process.env, DSH_HOME: HOME, LOL_FARM_KEY: args.key }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      const events = out.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { type: 'raw', text: l }; } });
      resolve({ code, events, err: err.slice(-2000), ms: Date.now() - t0 });
    });
  });
}

/** Is what the model left a three.js page? */
function pageCheck(cwd) {
  const file = path.join(cwd, 'index.html');
  if (!fs.existsSync(file)) return { file: false };
  const html = fs.readFileSync(file, 'utf8');
  return {
    file: true, bytes: html.length,
    three: /three(@[\d.]+)?\/build\/three\.module\.js|from ['"]three['"]/.test(html),
    scene: /new\s+THREE\.Scene\s*\(|new\s+Scene\s*\(/.test(html),
    renderer: /WebGLRenderer/.test(html),
    loop: /requestAnimationFrame|setAnimationLoop/.test(html),
    cube: /BoxGeometry/.test(html),
    ...(MODE === 'edit' ? {
      slider: /<input[^>]*type=["']?range[^>]*>/i.test(html) && /id=["']?speed/.test(html),
      // "Change nothing else": what the seed had is still there.
      kept: /DirectionalLight/.test(html) && /addEventListener\(\s*['"]resize/.test(html) && /MeshStandardMaterial/.test(html),
      wired: /speed/.test(html.slice(html.indexOf('rotation'))),
    } : {}),
  };
}

fs.mkdirSync(OUT, { recursive: true });
const results = [];
for (const model of MODELS) {
  for (let n = 1; n <= REPS; n += 1) {
    const cwd = path.join(OUT, `proj-${model.replace(/[^a-z0-9.-]/gi, '_')}-${n}`);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.mkdirSync(cwd, { recursive: true });
    if (MODE === 'edit') fs.copyFileSync(SEED, path.join(cwd, 'index.html'));
    const r = await session(model, cwd);
    fs.writeFileSync(path.join(OUT, `${model.replace(/[^a-z0-9.-]/gi, '_')}-${n}.jsonl`), r.events.map((e) => JSON.stringify(e)).join('\n'));
    const calls = r.events.filter((e) => e.type === 'tool_call');
    const results_ = r.events.filter((e) => e.type === 'tool_result');
    const ok = results_.filter((e) => e.status === 'completed').length;
    const skill = calls.some((c) => c.tool === 'skill' && JSON.stringify(c.input || {}).includes('ponytail'));
    const page = pageCheck(cwd);
    const final = (r.events.find((e) => e.type === 'final') || {}).text || '';
    const row = {
      model, n, exit: r.code, seconds: Math.round(r.ms / 1000),
      toolCalls: calls.length, completed: ok, failed: results_.length - ok,
      tools: calls.map((c) => c.tool).join(' → '),
      ponytail: skill, page, final: final.slice(0, 200), err: r.code ? r.err : undefined,
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
