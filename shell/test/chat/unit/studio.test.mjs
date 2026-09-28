// @ts-check
// The IDE's coding-agent runner (src/main/studio.ts; docs/IDE_PLAN.md): the profile patch keeps dsh on the farm with
// no shell, no web and no telemetry; a recorded session projects to small path-relative records; the runner speaks
// the SDK protocol (against test/mock-dsh.mjs), starts a fresh session with the recap, stops by killing the process,
// and says why when it cannot start; the Preview server serves the project folder only, to 127.0.0.1 only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.join(HERE, '..', '..', '..');
const BUILD = path.join(SHELL, 'build', 'main');
const MOCK = path.join(SHELL, 'test', 'mock-dsh.mjs');
const FIXTURE = path.join(SHELL, 'test', 'chat', 'fixtures', 'dsh', 'write-edit-error.jsonl');
const PID = 'demo-abcd1234';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `lol-studio-${name}-`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with a chosen Host header. @returns {Promise<{status: number, type: string, body: string}>} */
function get(url, o = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: o.path || u.pathname, method: o.method || 'GET', headers: o.host ? { host: o.host } : {} }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode || 0, type: String(res.headers['content-type'] || ''), body }));
    });
    req.on('error', reject);
    req.end();
  });
}

export default (test) => {
  const built = path.join(BUILD, 'studio.js');
  test('studio: build/main/studio.js is current', () => {
    assert.ok(fs.existsSync(built) && fs.statSync(built).mtimeMs >= fs.statSync(path.join(SHELL, 'src', 'main', 'studio.ts')).mtimeMs,
      'build/main/studio.js is older than studio.ts — run: npm --prefix shell run build');
  });
  /** @type {any} */ const S = require(built);

  test('studio: the patch points dsh at the farm, pins the skills and turns off the shell, the web and telemetry', () => {
    const p = S.buildPatch({ baseUrl: 'http://10.0.0.5:4000/v1', model: 'qwen3.8:latest', contextWindow: 1000, skillsDir: 'C:\\Users\\a b\\LOL: data\\skills' });
    assert.match(p, /baseURL: "http:\/\/10\.0\.0\.5:4000\/v1"/);
    assert.match(p, /- id: "qwen3\.8:latest"\n\s+contextWindow: 4096/, 'a tiny window is raised to a floor');
    assert.match(p, /apiKeyEnv: LOL_FARM_KEY/, 'the password travels by env, never in the file');
    assert.match(p, /includeDefaultRoots: false/, 'no ~/.claude or ~/.agents skills');
    assert.ok(p.includes(JSON.stringify('C:\\Users\\a b\\LOL: data\\skills')), 'a path with a colon and spaces stays one quoted string');
    for (const id of ['tool-pwsh', 'tool-bash', 'tool-web', 'web-fetch-http', 'web-search-deepseek', 'session-telemetry-otel',
      'session-log-deepseek', 'deepseek-account', 'llm-deepseek', 'tool-subagent', 'tool-workflow', 'tool-jobs', 'tool-goal']) {
      assert.ok(p.includes(`- { id: ${id}, disabled: true }`), `${id} is off`);
    }
  });

  test('studio: the runtime env carries our settings and none of the shell\'s other secrets', () => {
    const env = S.runtimeEnv({ PATH: '/bin', OPENAI_API_KEY: 'x', DEEPSEEK_API_KEY: 'y', ELECTRON_RUN_AS_NODE: '1', HF_TOKEN: 'z' }, { home: '/h', key: 'pw' });
    assert.equal(env.PATH, '/bin');
    for (const k of ['OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'ELECTRON_RUN_AS_NODE', 'HF_TOKEN']) assert.equal(env[k], undefined, `${k} is not passed`);
    assert.equal(env.LOL_FARM_KEY, 'pw');
    assert.equal(env.DSH_TELEMETRY_DISABLED, '1');
    assert.equal(env.DSH_MAX_TOKENS_AS_SUCCESS, 'false', 'running out of tokens is never "done"');
    assert.equal(env.DSH_HOME, '/h');
  });

  test('studio: a recorded session (write, edit, a failed read) becomes small records with project paths', () => {
    const dir = '<PROJECT>';
    const recs = fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((m) => m.method === 'session.event').map((m) => S.projectEvent(m.params.event, dir)).filter(Boolean);
    assert.deepEqual(recs.map((r) => r.kind + (r.name ? ':' + r.name : '')),
      ['step', 'call:write', 'result', 'step', 'call:edit', 'result', 'step', 'call:read', 'result', 'step', 'end']);
    assert.equal(recs[1].target, 'notes.txt');
    assert.equal(recs[2].ok, true);
    assert.equal(recs[2].created, true, 'a write that made a file says so');
    assert.equal(recs[2].callId, recs[1].callId, 'a result names its call');
    assert.deepEqual(recs[5].diffs, [{ path: 'notes.txt', oldText: 'one', newText: 'two' }]);
    assert.equal(recs[8].ok, false);
    assert.match(recs[8].error, /not found/);
    assert.ok(!recs[8].error.includes('<PROJECT>'), 'the project folder is not spelled out');
    assert.match(recs[9].text, /notes\.txt/);
    assert.equal(recs[9].stopReason, 'stop');
    assert.equal(recs[10].reason, 'completed');
  });

  test('studio: paths are made relative to the project, and one outside it is left as it is', () => {
    const d = tmp('rel');
    assert.equal(S.relPath(path.join(d, 'src', 'a.js'), d), 'src/a.js');
    assert.equal(S.relPath('./b.css', d), 'b.css');
    const outside = path.join(os.tmpdir(), 'elsewhere.txt');
    assert.equal(S.relPath(outside, d), outside);
  });

  test('studio: the runtime is found with its own Node, or LOL_DSH_NODE, and is absent otherwise', () => {
    const d = tmp('rt');
    assert.equal(S.resolveRuntime({ LOL_DSH_DIR: d }, d), null, 'no dsh');
    const bin = path.join(d, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, '');
    assert.equal(S.resolveRuntime({ LOL_DSH_DIR: d }, d), null, 'dsh without a Node');
    assert.deepEqual(S.resolveRuntime({ LOL_DSH_DIR: d, LOL_DSH_NODE: '/n' }, d), { node: '/n', bin });
    const own = path.join(d, 'node', process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'));
    fs.mkdirSync(path.dirname(own), { recursive: true });
    fs.writeFileSync(own, '');
    assert.deepEqual(S.resolveRuntime({ LOL_DSH_DIR: d }, d), { node: own, bin });
    assert.deepEqual(S.resolveRuntime({}, d), null, 'the default folder is <userData>/dsh-runtime');
  });

  /** A studio over a temp data folder with one project, the mock dsh and a recording emit. */
  function rig(o = {}) {
    const data = tmp('data');
    const root = path.join(data, 'LOL Studio Projects');
    fs.mkdirSync(path.join(root, PID), { recursive: true });
    const seed = tmp('seed');
    fs.mkdirSync(path.join(seed, 'ponytail'));
    fs.writeFileSync(path.join(seed, 'ponytail', 'SKILL.md'), '---\nname: ponytail\n---\n');
    /** @type {any[]} */ const got = [];
    const studio = S.createStudio({
      dataDir: () => data,
      projectsRoot: () => root,
      farm: () => ('farm' in o ? o.farm : { endpoint: 'http://127.0.0.1:9/v1', key: null, ctxPerSlot: null }),
      runtime: () => ('runtime' in o ? o.runtime : { node: process.execPath, bin: MOCK }),
      emit: (m) => got.push(m),
      seedSkills: seed,
    });
    const done = async (turnId, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const d = got.find((m) => m.turnId === turnId && m.done);
        if (d) return d.done;
        await sleep(20);
      }
      throw new Error(`turn ${turnId} did not end`);
    };
    const said = (turnId) => got.filter((m) => m.turnId === turnId && m.rec && m.rec.kind === 'step').map((m) => m.rec.text).join('|');
    return { data, root, studio, got, done, said, dir: path.join(root, PID) };
  }

  test('studio: a prompt runs a turn in the project folder — the file appears, the records and the end arrive', async () => {
    const r = rig();
    try {
      const a = await r.studio.prompt({ projectId: PID, threadId: 't1', model: 'qwen3.8:latest', text: 'write index.html: <h1>hi</h1>', recap: 'Earlier: nothing.' });
      assert.equal(a.ok, true, JSON.stringify(a));
      assert.equal(a.fresh, true);
      assert.deepEqual(await r.done(a.turnId), { reason: 'completed' });
      assert.equal(fs.readFileSync(path.join(r.dir, 'index.html'), 'utf8'), '<h1>hi</h1>');
      const kinds = r.got.filter((m) => m.turnId === a.turnId && m.rec).map((m) => m.rec.kind + (m.rec.name ? ':' + m.rec.name : ''));
      assert.deepEqual(kinds, ['step', 'call:write', 'result', 'step', 'end']);
      assert.match(r.said(a.turnId), /Earlier: nothing\./, 'a fresh session starts with the recap');
      const patch = fs.readFileSync(path.join(r.data, 'lol-studio', 'dsh', 'profiles', 'sdk', 'cordis.patch.yml'), 'utf8');
      assert.match(patch, /baseURL: "http:\/\/127\.0\.0\.1:9\/v1"/, 'the patch was written before the start');
      assert.ok(fs.existsSync(path.join(r.data, 'skills', 'ponytail', 'SKILL.md')), 'ponytail is seeded into DATA_DIR/skills');
      const log = await r.studio.history(PID);
      assert.deepEqual(log.commits.map((c) => c.message), ['Agent: write index.html: <h1>hi</h1>'], 'the reply is one commit, named by the prompt');
      assert.equal(log.commits[0].author, 'LOL Vibe agent');

      const b = await r.studio.prompt({ projectId: PID, threadId: 't1', model: 'qwen3.8:latest', text: 'replace hi with hello in index.html', recap: 'Earlier: nothing.' });
      assert.equal(b.ok && b.fresh, false, 'the same thread keeps its session');
      await r.done(b.turnId);
      assert.doesNotMatch(r.said(b.turnId), /Earlier/, 'no recap inside a live session');
      const diff = r.got.find((m) => m.turnId === b.turnId && m.rec && m.rec.kind === 'result').rec.diffs;
      assert.deepEqual(diff, [{ path: 'index.html', oldText: 'hi', newText: 'hello' }], 'an absolute path in a diff comes back relative');
      const two = (await r.studio.history(PID)).commits;
      assert.equal(two.length, 2);
      const ch = await r.studio.changes(PID, two[0].oid);
      assert.deepEqual(ch.files, [{ path: 'index.html', before: '<h1>hi</h1>', after: '<h1>hello</h1>', binary: false }]);
      assert.equal((await r.studio.changes(PID, 'not-an-oid')).code, 'E_ARGS');
      const back = await r.studio.restore(PID, two[1].oid);
      assert.equal(back.ok, true);
      assert.equal(fs.readFileSync(path.join(r.dir, 'index.html'), 'utf8'), '<h1>hi</h1>', 'back to the first reply');
      fs.writeFileSync(path.join(r.dir, 'index.html'), '<h1>mine</h1>');
      assert.match((await r.studio.commit(PID, 'index.html')).oid, /^[0-9a-f]{40}$/, 'a person\'s Save is a commit');
      assert.deepEqual((await r.studio.history(PID)).commits.map((c) => c.message).slice(0, 2), ['You: index.html', 'Back to: Agent: write index.html: <h1>hi</h1>']);

      const c = await r.studio.prompt({ projectId: PID, threadId: 't1', model: 'nemotron-3.5-lightning:30b', text: 'hello', recap: 'Earlier: two edits.' });
      assert.equal(c.ok && c.fresh, true, 'another model is another runtime, so a fresh session with the recap');
      await r.done(c.turnId);
      assert.match(r.said(c.turnId), /Earlier: two edits\./);
    } finally { await r.studio.dispose(); }
  });

  test('studio: one turn at a time; Stop ends it at once and the next prompt starts a fresh session', async () => {
    const r = rig();
    try {
      const a = await r.studio.prompt({ projectId: PID, threadId: 't1', model: 'm', text: 'slow' });
      assert.equal(a.ok, true);
      const busy = await r.studio.prompt({ projectId: PID, threadId: 't2', model: 'm', text: 'hi' });
      assert.equal(busy.code, 'E_BUSY');
      assert.equal(r.studio.status().running, true);
      await r.studio.stop();
      assert.deepEqual(await r.done(a.turnId, 2000), { reason: 'stopped' });
      assert.equal(r.studio.status().running, false);
      const b = await r.studio.prompt({ projectId: PID, threadId: 't1', model: 'm', text: 'again', recap: 'RECAP' });
      assert.equal(b.ok && b.fresh, true, 'the killed process took the session with it');
      await r.done(b.turnId);
      assert.match(r.said(b.turnId), /RECAP/);
    } finally { await r.studio.dispose(); }
  });

  test('studio: a runtime that dies mid-turn ends the turn with an error, and the next prompt starts again', async () => {
    const r = rig();
    try {
      const a = await r.studio.prompt({ projectId: PID, threadId: 't1', model: 'm', text: 'crash' });
      const end = await r.done(a.turnId);
      assert.equal(end.reason, 'error');
      assert.ok(end.error, 'with a sentence');
      const b = await r.studio.prompt({ projectId: PID, threadId: 't1', model: 'm', text: 'hi' });
      assert.equal(b.ok, true);
      await r.done(b.turnId);
    } finally { await r.studio.dispose(); }
  });

  test('studio: no farm, no runtime, no project or a runtime that cannot start — each is a sentence', async () => {
    assert.equal((await rig({ farm: null }).studio.prompt({ projectId: PID, threadId: 't', model: 'm', text: 'x' })).code, 'E_FARM');
    assert.equal((await rig({ runtime: null }).studio.prompt({ projectId: PID, threadId: 't', model: 'm', text: 'x' })).code, 'E_RUNTIME');
    assert.equal((await rig().studio.prompt({ projectId: 'gone-abcd1234', threadId: 't', model: 'm', text: 'x' })).code, 'E_PROJECT');
    assert.equal((await rig().studio.prompt({ projectId: '../x', threadId: 't', model: 'm', text: 'x' })).code, 'E_ARGS');
    const bad = path.join(tmp('bad'), 'bad.mjs');
    fs.writeFileSync(bad, "process.stderr.write('dsh: fatal uncaught exception: Error: cannot load\\n'); process.exit(1);\n");
    const r = rig({ runtime: { node: process.execPath, bin: bad } });
    const res = await r.studio.prompt({ projectId: PID, threadId: 't', model: 'm', text: 'x' });
    assert.equal(res.code, 'E_START');
    assert.match(res.message, /cannot load/, 'the runtime\'s own reason');
    assert.equal(r.studio.status().running, false);
  });

  test('studio: the Preview serves the project folder to 127.0.0.1 only — no escape, no other Host, no writes', async () => {
    const r = rig();
    try {
      fs.writeFileSync(path.join(r.dir, 'index.html'), '<h1>page</h1>');
      fs.writeFileSync(path.join(r.dir, 'app.js'), 'console.log(1)');
      fs.writeFileSync(path.join(r.root, 'secret.txt'), 'no');
      const s = await r.studio.serve(PID);
      assert.equal(s.ok, true);
      assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
      assert.deepEqual(await r.studio.serve(PID), s, 'one server per project');
      const port = new URL(s.url).port;
      const home = await get(s.url, { host: `127.0.0.1:${port}` });
      assert.equal(home.status, 200);
      assert.equal(home.body, '<h1>page</h1>');
      assert.match(home.type, /text\/html/);
      assert.match((await get(s.url, { host: `localhost:${port}`, path: '/app.js' })).type, /javascript/);
      assert.equal((await get(s.url, { host: `127.0.0.1:${port}`, path: '/../secret.txt' })).status, 404);
      assert.equal((await get(s.url, { host: `127.0.0.1:${port}`, path: '/%2e%2e/secret.txt' })).status, 404);
      assert.equal((await get(s.url, { host: `127.0.0.1:${port}`, path: '/nope.html' })).status, 404);
      assert.equal((await get(s.url, { host: `evil.example:${port}` })).status, 403, 'a rebound name is refused');
      assert.equal((await get(s.url, { host: `127.0.0.1:${port}`, method: 'POST' })).status, 405);
    } finally { await r.studio.dispose(); }
  });

  test('studio: the project fence refuses any file tool outside the project, a climbing glob and wider rights — and denies when unsure', async () => {
    const { spawnSync } = await import('node:child_process');
    const dir = tmp('fence');
    const project = path.join(dir, 'proj');
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.writeFileSync(path.join(project, 'index.html'), 'x');
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'no');
    const fence = path.join(dir, 'lol-fence.mjs');
    fs.writeFileSync(fence, S.FENCE_JS);
    const run = (/** @type {any} */ input, raw) => {
      const r = spawnSync(process.execPath, [fence], { input: raw !== undefined ? raw : JSON.stringify(input), env: { ...process.env, CLAUDE_PROJECT_DIR: project }, encoding: 'utf8' });
      return { code: r.status, why: r.stderr };
    };
    const call = (tool, args) => run({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: args, cwd: project });
    assert.equal(call('read', { file_path: path.join(project, 'index.html') }).code, 0, 'inside: allowed');
    assert.equal(call('read', { file_path: 'src/app.js' }).code, 0, 'relative inside');
    assert.equal(call('write', { file_path: 'src/new/file.js', content: 'y' }).code, 0, 'a new file inside');
    assert.equal(call('grep', { pattern: 'x' }).code, 0, 'no path: the project');
    const out = call('read', { file_path: path.join(dir, 'secret.txt') });
    assert.equal(out.code, 2, 'outside: refused');
    assert.match(out.why, /only files inside this project/);
    assert.equal(call('read', { file_path: '../secret.txt' }).code, 2, 'a relative escape');
    assert.equal(call('grep', { pattern: 'x', path: dir }).code, 2, 'a search root outside');
    assert.equal(call('glob', { pattern: '../*.txt' }).code, 2, 'a climbing glob');
    assert.equal(call('glob', { pattern: path.join(dir, '*.txt') }).code, 2, 'an absolute glob');
    assert.equal(call('glob', { pattern: 'src/**/*.js' }).code, 0);
    assert.equal(call('write', { file_path: 'a.js', content: 'y', sandbox_permissions: 'danger-full-access' }).code, 2, 'no wider rights');
    assert.equal(run(null, 'not json').code, 2, 'unsure: refused');
    if (process.platform === 'win32') {
      assert.equal(call('read', { file_path: path.join(project, 'index.html').toUpperCase() }).code, 0, 'Windows paths ignore case');
    }
    const link = path.join(project, 'escape');
    try { fs.symlinkSync(dir, link, 'junction'); } catch { /* no links here: nothing more to check */ }
    if (fs.existsSync(link)) assert.equal(call('read', { file_path: 'escape/secret.txt' }).code, 2, 'a link out of the project is followed, then refused');
  });

  test('studio: the fence\'s hook command, run through the shell dsh uses, hands on the refusal (exit 2) and the pass (0)', async () => {
    // dsh runs a hook command through its shell layer: PowerShell on Windows, `bash -c` elsewhere. Both traps found on
    // the real runtime (a parse error, then 2 turned into 1 — each reads as "pass") live in THAT hop, not in the script.
    const { spawnSync } = await import('node:child_process');
    const dir = tmp('fence-shell');
    const project = path.join(dir, 'p');
    fs.mkdirSync(project);
    const fence = path.join(dir, 'lol fence.mjs');   // a space in the path, like a real user folder
    fs.writeFileSync(fence, S.FENCE_JS);
    const command = JSON.parse(S.fenceHooks(process.execPath, fence)).hooks.PreToolUse[0].hooks[0].command;
    const shell = process.platform === 'win32' ? ['powershell', ['-NoProfile', '-NonInteractive', '-Command', command]] : ['bash', ['-c', command]];
    const via = (/** @type {any} */ input) => spawnSync(shell[0], shell[1], { input: JSON.stringify(input), env: { ...process.env, CLAUDE_PROJECT_DIR: project }, encoding: 'utf8' });
    const out = via({ tool_name: 'read', tool_input: { file_path: path.join(dir, 'elsewhere.txt') }, cwd: project });
    assert.equal(out.status, 2, `the refusal survives the shell: ${out.stderr}`);
    assert.match(out.stderr, /only files inside this project/);
    assert.equal(via({ tool_name: 'read', tool_input: { file_path: 'a.txt' }, cwd: project }).status, 0, 'and so does a pass');
  });

  test('studio: the bundled skills are copied out of app.asar — the installed app\'s case, where fs.cpSync fails', async () => {
    // In an installed client assets/skills/ lives INSIDE app.asar, and fs.cpSync fails there with ENOENT (probed
    // 2026-09-28): seeding threw inside the agent's start-up. This packs a real asar and copies out of it the way the
    // installed app does — in Electron's own Node.
    const { spawnSync } = await import('node:child_process');
    const asar = require(path.join(SHELL, 'node_modules', '@electron', 'asar'));
    const electron = /** @type {string} */ (require(path.join(SHELL, 'node_modules', 'electron')));
    const dir = tmp('asar');
    fs.mkdirSync(path.join(dir, 'src', 'assets', 'skills', 'graphify', 'refs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'package.json'), '{}');
    fs.writeFileSync(path.join(dir, 'src', 'assets', 'skills', 'graphify', 'SKILL.md'), 'top');
    fs.writeFileSync(path.join(dir, 'src', 'assets', 'skills', 'graphify', 'refs', 'deep.md'), 'deep');
    await asar.createPackage(path.join(dir, 'src'), path.join(dir, 'app.asar'));
    const probe = path.join(dir, 'probe.cjs');
    fs.writeFileSync(probe, [
      "const fs = require('fs'); const path = require('path');",
      'const S = require(process.argv[2]);',
      "const out = path.join(__dirname, 'out');",
      "S.copyTree(path.join(__dirname, 'app.asar', 'assets', 'skills'), out);",
      "console.log(JSON.stringify([fs.readFileSync(path.join(out, 'graphify', 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(out, 'graphify', 'refs', 'deep.md'), 'utf8')]));",
    ].join('\n'));
    const r = spawnSync(electron, [probe, built], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()), ['top', 'deep'], 'every file, nested folders too');
  });

  test('studio: the patch mounts the fence through the hook bridge', () => {
    const p = S.buildPatch({ baseUrl: 'http://x/v1', model: 'm', contextWindow: 8192, skillsDir: '/s', hooksConfig: 'C:\\home\\lol-hooks.json' });
    assert.match(p, /- insert:\n\s+- id: hooks-claude-code\n\s+name: '@deepseek-ai\/dsh-hooks-claude-code'/);
    assert.ok(p.includes(`configPath: ${JSON.stringify('C:\\home\\lol-hooks.json')}`));
    const hooks = JSON.parse(S.fenceHooks('C:\\n o d e\\node.exe', 'C:\\h\\lol-fence.mjs', 'win32'));
    assert.equal(hooks.hooks.PreToolUse[0].matcher, 'read|glob|grep|read_image|write|edit');
    assert.equal(hooks.hooks.PreToolUse[0].hooks[0].command, '& "C:\\n o d e\\node.exe" "C:\\h\\lol-fence.mjs"; exit $LASTEXITCODE',
      'PowerShell (dsh\'s Windows shell) needs the call operator and must hand on exit 2; paths with spaces stay quoted');
    assert.equal(JSON.parse(S.fenceHooks('/opt/n o/node', '/h/f.mjs', 'linux')).hooks.PreToolUse[0].hooks[0].command, '"/opt/n o/node" "/h/f.mjs"', 'bash -c elsewhere');
  });

  test('studio: a remote is a clean https address; its token is kept per host and never handed back; a failure is a sentence', async () => {
    assert.equal(S.remoteUrl('https://github.com/me/site.git'), 'https://github.com/me/site.git');
    for (const bad of ['http://github.com/me/site.git', 'https://me:pw@github.com/x.git', 'https://github.com/x.git?a=1', 'git@github.com:me/x.git', 'nope', 42]) {
      assert.equal(S.remoteUrl(bad), null, `refused: ${bad}`);
    }
    const data = tmp('remote');
    const root = path.join(data, 'LOL Studio Projects');
    fs.mkdirSync(path.join(root, PID), { recursive: true });
    fs.writeFileSync(path.join(root, PID, 'index.html'), '<p>x</p>');
    const kept = new Map();
    const studio = S.createStudio({
      dataDir: () => data, projectsRoot: () => root, farm: () => null, runtime: () => null, emit: () => {},
      tokens: { safe: () => true, get: (h) => kept.get(h) || null, set: (h, t) => { if (t) kept.set(h, t); else kept.delete(h); return true; } },
    });
    assert.deepEqual(await studio.remote(PID), { ok: true, url: null, token: { saved: false, safe: true } });
    assert.equal((await studio.token(PID, 'ghp_12345678')).code, 'E_ARGS', 'no address yet');
    assert.equal((await studio.remote(PID, 'http://127.0.0.1/x.git')).code, 'E_ARGS');
    const set = await studio.remote(PID, 'https://127.0.0.1:9/me/site.git');
    assert.deepEqual(set, { ok: true, url: 'https://127.0.0.1:9/me/site.git', token: { saved: false, safe: true } });
    assert.equal((await studio.token(PID, 'short')).code, 'E_ARGS');
    assert.equal((await studio.token(PID, 'ghp_12345678')).ok, true);
    assert.equal(kept.get('127.0.0.1:9'), 'ghp_12345678', 'kept by host');
    const back = await studio.remote(PID);
    assert.deepEqual(back.token, { saved: true, safe: true });
    assert.ok(!JSON.stringify(back).includes('ghp_'), 'the token never comes back to the page');
    const push = await studio.push(PID);
    assert.equal(push.code, 'E_RUNTIME');
    assert.match(push.message, /Could not push \(127\.0\.0\.1:9\)/, 'an unreachable host is a sentence');
    assert.equal((await studio.token(PID, null)).ok, true);
    assert.equal(kept.size, 0, 'forgotten');
    const unsafe = S.createStudio({
      dataDir: () => data, projectsRoot: () => root, farm: () => null, runtime: () => null, emit: () => {},
      tokens: { safe: () => false, get: () => null, set: () => false },
    });
    assert.equal((await unsafe.token(PID, 'ghp_12345678')).code, 'E_RUNTIME', 'no encryption: nothing is kept');
    await studio.dispose(); await unsafe.dispose();
  });

  test('studio: sharing on the LAN is a toggle — off by default, answers to this machine\'s addresses, gone when off', async () => {
    const data = tmp('share');
    const root = path.join(data, 'LOL Studio Projects');
    fs.mkdirSync(path.join(root, PID), { recursive: true });
    fs.writeFileSync(path.join(root, PID, 'index.html'), '<h1>shared</h1>');
    const studio = S.createStudio({
      dataDir: () => data, projectsRoot: () => root, farm: () => null, runtime: () => null, emit: () => {},
      lan: { host: '127.0.0.1', addresses: () => ['192.0.2.10'] },   // loopback in tests: no firewall prompt
    });
    try {
      const first = await studio.serve(PID);
      assert.deepEqual(first.lan, [], 'not shared until a person turns it on');
      const on = await studio.share(PID, true);
      assert.equal(on.ok, true);
      assert.equal(on.urls.length, 1);
      assert.match(on.urls[0], /^http:\/\/192\.0\.2\.10:\d+\/$/);
      const port = new URL(on.urls[0]).port;
      const lanUrl = `http://127.0.0.1:${port}/`;   // the TEST-NET name is only a Host header here
      const page = await get(lanUrl, { host: `192.0.2.10:${port}` });
      assert.equal(page.status, 200);
      assert.equal(page.body, '<h1>shared</h1>');
      assert.equal((await get(lanUrl, { host: `evil.example:${port}` })).status, 403, 'only this machine\'s names');
      assert.equal((await get(lanUrl, { host: `192.0.2.10:${port}`, method: 'PUT' })).status, 405, 'read-only');
      assert.deepEqual((await studio.serve(PID)).lan, on.urls, 'the panel learns the share state from serve()');
      assert.deepEqual((await studio.share(PID, true)).urls, on.urls, 'turning it on twice keeps one listener');
      assert.deepEqual((await studio.share(PID, false)).urls, []);
      await sleep(50);
      await assert.rejects(get(lanUrl, { host: `192.0.2.10:${port}` }), 'the port is closed');
      assert.deepEqual((await studio.serve(PID)).lan, []);
      assert.equal((await studio.share('gone-abcd1234', true)).code, 'E_PROJECT');
    } finally { await studio.dispose(); }
  });
};
