// @ts-check
// The IDE's coding-agent runner (src/main/studio.ts; docs/IDE_PLAN.md): the profile patch keeps dsh on the farm with
// no shell, no web and no telemetry; a recorded session projects to small path-relative records; the runner speaks
// the SDK protocol (against test/mock-dsh.mjs), starts a fresh session with the recap, stops by killing the process,
// and says why when it cannot start; the Preview server serves the project folder only, to 127.0.0.1 only.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
    // Compaction fits a small window: its default 65536-token headroom made it never compact on 32k (P5-L spike).
    assert.match(p, /- id: compaction-basic\n {2}config:\n {4}headroomTokens: 4096\n {4}maxTokens: 4096/);
  });

  test('studio: dsh\'s goal loop is in the patch only when a person switched on "keep going"', () => {
    const base = { baseUrl: 'http://x/v1', model: 'm', contextWindow: 32768, skillsDir: '/s' };
    const off = S.buildPatch(base);
    for (const id of ['tool-goal', 'goal-round-driver', 'command-goal']) assert.ok(off.includes(`- { id: ${id}, disabled: true }`), `${id} off by default`);
    assert.doesNotMatch(off, /defaultMaxGoalRounds/);
    const on = S.buildPatch({ ...base, goals: true });
    for (const id of ['tool-goal', 'goal-round-driver']) assert.ok(!on.includes(`- { id: ${id}, disabled: true }`), `${id} on`);
    assert.ok(on.includes('- { id: command-goal, disabled: true }'), 'the slash command stays off: nothing in the SDK reaches it');
    assert.match(on, new RegExp(`- id: goal\\n {2}config:\\n {4}defaultMaxGoalRounds: ${S.GOAL_ROUNDS}`));
    for (const id of ['tool-bash', 'tool-web', 'tool-ralph']) assert.ok(on.includes(`- { id: ${id}, disabled: true }`), `${id} still off in a loop`);
  });

  test('studio: "Use the Computer" adds the Computer\'s MCP server to the patch — its bearer only in the runtime env', () => {
    const base = { baseUrl: 'http://x/v1', model: 'm', contextWindow: 32768, skillsDir: '/s', hooksConfig: '/h.json' };
    const off = S.buildPatch(base);
    assert.doesNotMatch(off, /mcp-client|mcp-computer/, 'files only by default');
    const on = S.buildPatch({ ...base, computer: { url: 'http://127.0.0.1:41995/mcp' } });
    assert.equal(on.split('\n').filter((l) => l === '- insert:').length, 1, 'the fence and the Computer share one insert list');
    assert.match(on, /- id: hooks-claude-code[\s\S]*- id: mcp-computer\n {6}name: '@deepseek-ai\/dsh-mcp-client'/, 'the fence stays');
    assert.match(on, /url: "http:\/\/127\.0\.0\.1:41995\/mcp"/);
    assert.match(on, /Authorization: !!js "`Bearer \$\{process\.env\.LOL_MCP_TOKEN\}`"/, 'the bearer is read from the env, never written here');
    assert.ok(!S.runtimeEnv({}, { home: '/h', key: 'k' }).LOL_MCP_TOKEN, 'no token without the switch');
    assert.equal(S.runtimeEnv({}, { home: '/h', key: 'k', mcpToken: 'tok' }).LOL_MCP_TOKEN, 'tok');
    const call = S.projectEvent({ type: 'tool/call', data: { callId: 'c', name: 'mcp__computer__add_box', arguments: '{"type":"code"}' } }, '/p');
    assert.deepEqual(call, { kind: 'call', callId: 'c', name: 'Computer: add_box', target: 'code' }, 'the step log says what it did on the Computer');
  });

  test('studio: goal events become goal and round records; a person\'s own message is not repeated', () => {
    const g = S.projectEvent({ type: 'goal/change', data: { operation: 'create', roundsStarted: 2, goal: { phase: 'active', maxGoalRounds: 10, objective: 'Build it' } } }, '/p');
    assert.deepEqual(g, { kind: 'goal', phase: 'active', rounds: 2, max: 10, objective: 'Build it', blocked: '' });
    assert.deepEqual(S.projectEvent({ type: 'user/message', data: { source: { kind: 'goal', round: 3 }, content: [] } }, '/p'), { kind: 'round', n: 3 });
    assert.equal(S.projectEvent({ type: 'user/message', data: { source: { kind: 'user' }, content: [] } }, '/p'), null);
  });

  test('studio: dsh itself composes the patch — compaction gets our headroom (when the runtime is built)', () => {
    const rt = path.join(HERE, '..', '..', '..', 'dsh', 'build', 'dsh-runtime');
    const node = path.join(rt, 'node', process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'));
    const bin = path.join(rt, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (!fs.existsSync(node) || !fs.existsSync(bin)) { console.log('     (no dsh runtime in shell/dsh/build: skipped)'); return; }
    const home = tmp('dump');
    fs.mkdirSync(path.join(home, 'profiles', 'sdk'), { recursive: true });
    fs.writeFileSync(path.join(home, 'profiles', 'sdk', 'cordis.patch.yml'),
      S.buildPatch({ baseUrl: 'http://127.0.0.1:1/v1', model: 'm', contextWindow: 32768, skillsDir: home.replace(/\\/g, '/') }));
    const r = spawnSync(node, [bin, '--profile', 'sdk', '--dump-config'], { encoding: 'utf8', timeout: 60000, env: { ...S.runtimeEnv(process.env, { home, key: 'x' }) } });
    assert.match(String(r.stdout), /- id: compaction-basic\n {2}name: '@deepseek-ai\/dsh-compaction-basic'\n {2}config:\n {4}headroomTokens: 4096/, String(r.stderr).slice(-400));
  });

  // Multi-user 1.6 (c): dsh's llm-retry knocked five times on a full farm and the reply never reached LOL Vibe's seat-wait.
  const SEATS_429 = `429: ${JSON.stringify({ message: 'All 2 seats on this server are in use. Try again in a moment.', type: 'rate_limit_error', code: 'lol_seats_full' })}`;
  test('studio: a 429 is the seat gate\'s — dsh never retries it and the turn ends as seats-full; the rest is still retried; no title call', () => {
    const p = S.buildPatch({ baseUrl: 'http://x/v1', model: 'm', contextWindow: 32768, skillsDir: '/s' });
    assert.match(p, /apiKeyEnv: LOL_FARM_KEY\n {8}retryPolicy:\n {10}mode: normal\n {10}retryableCodes: \[EMPTY_RESPONSE, SERVER, TIMEOUT, TRANSPORT\]\n {8}models:/);
    assert.ok(p.includes('- { id: session-title-llm, disabled: true }'), 'no second request for a title nobody shows');
    const end = (error) => S.projectEvent({ type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error } } }, '/p');
    assert.deepEqual(end({ code: 'RATE_LIMIT', message: SEATS_429 }), { kind: 'end', reason: 'seats-full', error: SEATS_429 });
    assert.deepEqual(end({ code: 'SERVER', message: '502 Bad Gateway' }), { kind: 'end', reason: 'error' }, 'any other failure ends as before');
  });

  test('studio: the REAL dsh with our patch — one request on a 429, retries on a 502 (when the runtime is built)', async () => {
    const rt = path.join(SHELL, 'dsh', 'build', 'dsh-runtime');
    const node = path.join(rt, 'node', process.platform === 'win32' ? 'node.exe' : path.join('bin', 'node'));
    const bin = path.join(rt, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (!fs.existsSync(node) || !fs.existsSync(bin)) { console.log('     (no dsh runtime in shell/dsh/build: skipped)'); return; }
    /** Run one prompt against a fake farm that answers every completion with `status`; resolve at the turn's end or once `enough` POSTs came. */
    const run = (status, enough) => new Promise((resolve, reject) => {
      let posts = 0; /** @type {any} */ let child = null;
      const server = http.createServer((req, res) => {
        req.resume();
        req.on('end', () => {
          if (req.method === 'POST' && ++posts >= enough) finish(null);
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(status === 429 ? JSON.stringify({ error: JSON.parse(SEATS_429.slice(5)) }) : '{"error":{"message":"Bad Gateway"}}');
        });
      });
      let over = false;
      const finish = (/** @type {any} */ end) => { if (over) return; over = true; if (child) child.kill(); server.close(); resolve({ posts, end }); };
      server.listen(0, '127.0.0.1', () => {
        const home = tmp('retry');
        fs.mkdirSync(path.join(home, 'profiles', 'sdk'), { recursive: true });
        fs.writeFileSync(path.join(home, 'profiles', 'sdk', 'cordis.patch.yml'),
          S.buildPatch({ baseUrl: `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/v1`, model: 'm', contextWindow: 32768, skillsDir: home.split(path.sep).join('/') }));
        child = spawn(node, [bin, '--profile', 'sdk'], { cwd: home, env: S.runtimeEnv(process.env, { home, key: 'x' }), stdio: ['pipe', 'pipe', 'pipe'] });
        const send = (/** @type {any} */ m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
        let buf = '';
        child.stdout.on('data', (/** @type {Buffer} */ d) => {
          buf += d;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            let m; try { m = JSON.parse(buf.slice(0, i)); } catch { m = null; }
            buf = buf.slice(i + 1);
            if (m && m.id === 1) send({ id: 2, method: 'session/prompt', params: { sessionId: 's', contentBlocks: [{ type: 'text', text: 'hi' }] } });
            if (m && m.method === 'session.event' && m.params.event.type === 'turn/end') finish(S.projectEvent(m.params.event, home));
          }
        });
        child.on('error', reject);
        send({ id: 1, method: 'initialize', params: { cwd: home, provider: 'lolfarm', model: 'm', maxTokens: 8192 } });
      });
    });
    const full = /** @type {any} */ (await run(429, 99));
    assert.equal(full.posts, 1, 'the seat gate is asked once — the seat-wait does the waiting');
    assert.deepEqual(full.end, { kind: 'end', reason: 'seats-full', error: SEATS_429 }, 'pi-ai\'s text, as projectEvent reads it');
    const down = /** @type {any} */ (await run(502, 2));
    assert.equal(down.posts, 2, 'a 502 (LiteLLM restarting) is still retried');
  }, { timeoutMs: 60000 });

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
      ...(o.roundWaitMs ? { roundWaitMs: o.roundWaitMs } : {}),
      ...('computer' in o ? { computer: () => o.computer } : {}),
      ...(o.agentLib ? { agentLib: o.agentLib } : {}),
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

  test('studio: "keep going" is ONE reply across the rounds dsh starts, until the model completes the goal', async () => {
    const r = rig();
    const patchFile = path.join(r.data, 'lol-studio', 'dsh', 'profiles', 'sdk', 'cordis.patch.yml');
    try {
      const a = await r.studio.prompt({ projectId: PID, threadId: 'g', model: 'm', text: 'rounds 3: build it', goal: true });
      assert.equal(a.ok, true, JSON.stringify(a));
      assert.deepEqual(await r.done(a.turnId), { reason: 'completed' }, 'the reply ends when the goal is complete — not at the first idle');
      const recs = r.got.filter((m) => m.turnId === a.turnId && m.rec).map((m) => m.rec);
      assert.deepEqual(recs.filter((x) => x.kind === 'round').map((x) => x.n), [1, 2, 3], 'each round dsh started reached the page');
      assert.deepEqual(recs.filter((x) => x.kind === 'goal').map((x) => x.phase), ['active', 'complete']);
      for (const n of [1, 2, 3]) assert.ok(fs.existsSync(path.join(r.dir, `round-${n}.txt`)), `round ${n} worked in the project`);
      assert.match(fs.readFileSync(patchFile, 'utf8'), /defaultMaxGoalRounds/, 'the runtime started with the goal loop on');
      assert.deepEqual((await r.studio.history(PID)).commits.map((c) => c.message), ['Agent: rounds 3: build it'], 'the whole loop is one commit');

      const b = await r.studio.prompt({ projectId: PID, threadId: 'g', model: 'm', text: 'write a.txt: x' });
      assert.deepEqual(await r.done(b.turnId), { reason: 'completed' });
      assert.doesNotMatch(fs.readFileSync(patchFile, 'utf8'), /defaultMaxGoalRounds/, 'without the switch the loop is off again');
    } finally { await r.studio.dispose(); }
  });

  test('studio: agent pages — the Preview serves the loop library and where the farm is, never its password; the LAN share neither', async () => {
    const lib = path.join(HERE, '..', '..', '..', 'assets', 'agent-page', 'lol-agent.mjs');
    const r = rig({ agentLib: lib, farm: { endpoint: 'http://10.0.0.5:4000/v1', key: 'the-farm-password', ctxPerSlot: 32768, model: 'assistant' } });
    try {
      const s = await r.studio.serve(PID);
      const port = new URL(s.url).port;
      const info = await get(s.url, { host: `127.0.0.1:${port}`, path: '/lol-farm.json' });
      assert.equal(info.status, 200);
      assert.deepEqual(JSON.parse(info.body), { baseUrl: 'http://10.0.0.5:4000/v1', requiresKey: true, defaultModel: 'assistant' }, 'and the farm\'s default model (multi-user 1.6)');
      assert.ok(!info.body.includes('the-farm-password'), 'never the password: the page asks the person');
      const js = await get(s.url, { host: `127.0.0.1:${port}`, path: '/lol-agent.mjs' });
      assert.equal(js.status, 200);
      assert.match(js.type, /javascript/);
      assert.match(js.body, /export async function runAgent/);
    } finally { await r.studio.dispose(); }
  });

  test('studio: no model chosen is a sentence that says what to do, not "bad arguments"', async () => {
    const r = rig();
    try {
      const a = await r.studio.prompt({ projectId: PID, threadId: 't', model: '', text: 'hi' });
      assert.equal(a.ok, false);
      assert.match(a.message, /No model is chosen for this chat: pick one in the model menu/);
      assert.equal((await r.studio.prompt({ projectId: 'bad id!', threadId: 't', model: 'm', text: 'hi' })).message, 'bad arguments', 'a programming error stays terse');
    } finally { await r.studio.dispose(); }
  });

  test('studio: "Use the Computer" reaches dsh only when a person asked AND this session serves the Computer', async () => {
    const r = rig({ computer: { url: 'http://127.0.0.1:41995/mcp', token: 'tok-123' } });
    const patchFile = path.join(r.data, 'lol-studio', 'dsh', 'profiles', 'sdk', 'cordis.patch.yml');
    try {
      assert.equal(r.studio.status().computer, true);
      const a = await r.studio.prompt({ projectId: PID, threadId: 'c', model: 'm', text: 'mcp?', computer: true });
      await r.done(a.turnId);
      assert.match(r.said(a.turnId), /the Computer's token: set/, 'the bearer reached the runtime\'s env');
      const patch = fs.readFileSync(patchFile, 'utf8');
      assert.match(patch, /- id: mcp-computer/);
      assert.ok(!patch.includes('tok-123'), 'and never the patch file (it lives in the data folder)');
      const b = await r.studio.prompt({ projectId: PID, threadId: 'c', model: 'm', text: 'mcp?' });
      await r.done(b.turnId);
      assert.match(r.said(b.turnId), /token: unset/, 'switched off: a runtime without it');
      assert.doesNotMatch(fs.readFileSync(patchFile, 'utf8'), /mcp-computer/);
    } finally { await r.studio.dispose(); }
    const n = rig();
    try {
      assert.equal(n.studio.status().computer, false, 'no MCP server this session');
      const c = await n.studio.prompt({ projectId: PID, threadId: 'd', model: 'm', text: 'mcp?', computer: true });
      await n.done(c.turnId);
      assert.match(n.said(c.turnId), /token: unset/, 'asked for, but not there: files only');
    } finally { await n.studio.dispose(); }
  });

  test('studio: "keep going" says why it ended early — max-tokens, a goal that stalled, our round cap', async () => {
    const r = rig({ roundWaitMs: 300 });
    try {
      const a = await r.studio.prompt({ projectId: PID, threadId: 'x', model: 'm', text: 'goal-maxtokens', goal: true });
      assert.deepEqual(await r.done(a.turnId), { reason: 'max-tokens' }, 'dsh disarms the goal on a max-tokens end: the reply says so');
      const b = await r.studio.prompt({ projectId: PID, threadId: 'x', model: 'm', text: 'goal-stall', goal: true });
      assert.deepEqual(await r.done(b.turnId), { reason: 'stalled' }, 'no round came: the reply does not hang');
      // A model that would go on for 30 rounds: at round cap+1 the runtime is stopped (a real round takes seconds;
      // the mock's take 30 ms, so one may start before the kill lands — but none after it).
      const c = await r.studio.prompt({ projectId: PID, threadId: 'y', model: 'm', text: 'rounds 30', goal: true });
      assert.deepEqual(await r.done(c.turnId, 20000), { reason: 'round-limit' }, 'whatever max_goal_rounds the model set, our cap holds');
      const rounds = () => fs.readdirSync(r.dir).filter((f) => /^round-\d+\.txt$/.test(f)).length;
      await sleep(400);
      const n1 = rounds();
      await sleep(600);
      assert.equal(rounds(), n1, 'the runtime is stopped: no round runs after the cap');
      assert.ok(n1 >= S.GOAL_ROUNDS && n1 <= S.GOAL_ROUNDS + 2, `the rounds up to the cap ran, and about none past it (${n1})`);
      assert.equal(r.studio.status().running, false);
    } finally { await r.studio.dispose(); }
  });

  test('studio: a turn the seat gate refused ends as seats-full with the farm\'s text, for the page\'s seat-wait', async () => {
    const r = rig();
    try {
      const a = await r.studio.prompt({ projectId: PID, threadId: 'f', model: 'm', text: 'farm-full' });
      assert.deepEqual(await r.done(a.turnId), { reason: 'seats-full', error: SEATS_429 });
      const b = await r.studio.prompt({ projectId: PID, threadId: 'f', model: 'm', text: 'write ok.txt: yes' });
      assert.deepEqual(await r.done(b.turnId), { reason: 'completed' }, 'the next turn carries no stale error');
    } finally { await r.studio.dispose(); }
  });

  // Multi-user 1.6 (d): dsh compacts at min(0.8·W, W − out − 4096). "Keep going" asked 16384 whatever the window: a 24k
  // window compacted at 4k, a ≤ 20k one never — and the window itself was taken from the farm unclamped.
  test('studio: the agent\'s window is clamped like LOL Vibe\'s meter; "keep going" shrinks its room on a small window', () => {
    assert.deepEqual([null, undefined, 0, -5, 'x', 500, 16384, 1048576].map((w) => S.agentWindow(w)),
      [32768, 32768, 32768, 32768, 32768, 1024, 16384, 262144]);
    const trigger = (/** @type {number} */ w, /** @type {number} */ out) => Math.floor(Math.min(0.8 * w, w - out - 4096));
    for (const w of [16384, 20480, 24576, 32768, 131072, 262144]) {
      const loop = S.agentMaxTokens(8192, w, true);
      assert.ok(loop >= 8192 && loop <= 16384, `${w}: between a plain turn's room and 16384 (${loop})`);
      assert.ok(trigger(w, loop) >= w / 4, `${w}: compaction still starts at a quarter of the window or later (${trigger(w, loop)})`);
    }
    assert.equal(S.agentMaxTokens(8192, 32768, true), 16384, 'the P5-L room where it fits (a 32k window compacts at 12288)');
    assert.equal(S.agentMaxTokens(8192, 24576, true), 14336);
    assert.equal(S.agentMaxTokens(8192, 8192, true), 8192, 'never below a plain turn\'s room');
    assert.deepEqual([S.agentMaxTokens(8192, 4096, false), S.agentMaxTokens(100, 32768, false), S.agentMaxTokens(undefined, 32768, false), S.agentMaxTokens(1e6, 32768, true)],
      [8192, 512, 8192, 65536], 'a plain turn is unchanged: what was asked, 512–65536');
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
    // The executable's path the way electron/index.js finds it — NOT require('…/electron'): shell-main.test.mjs stubs
    // that module in the require cache, so in a full run the require returned the stub object.
    const eDir = path.join(SHELL, 'node_modules', 'electron');
    const electron = path.join(eDir, 'dist', fs.readFileSync(path.join(eDir, 'path.txt'), 'utf8').trim());
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
    const both = JSON.parse(S.fenceHooks('C:\\n\\node.exe', 'C:\\h\\f.mjs', 'win32', 'C:\\h\\check.mjs')).hooks;
    assert.equal(both.PostToolUse[0].matcher, 'write|edit', 'the syntax check after every write and edit');
    assert.equal(both.PostToolUse[0].hooks[0].command, '& "C:\\n\\node.exe" --no-warnings --experimental-vm-modules "C:\\h\\check.mjs"; exit $LASTEXITCODE',
      'wrapped like the fence, with the flag vm modules need');
    assert.equal(JSON.parse(S.fenceHooks('n', 'f', 'linux')).hooks.PostToolUse, undefined);
  });

  test('studio: the syntax check tells the agent at once when a page\'s JavaScript does not parse — with the file\'s line', () => {
    const dir = tmp('check');
    const check = path.join(dir, 'check.mjs');
    fs.writeFileSync(check, S.CHECK_JS);
    const run = (file, content) => {
      fs.writeFileSync(path.join(dir, file), content);
      return spawnSync(process.execPath, ['--no-warnings', '--experimental-vm-modules', check], { input: JSON.stringify({ tool_name: 'write', tool_input: { file_path: file }, cwd: dir }), encoding: 'utf8' });
    };
    // What the real agent page had (2026-09-30): `throw` is not an expression, so the whole module did not parse.
    const bad = run('index.html', '<!doctype html>\n<p>x</p>\n<script type="module">\nimport { a } from "/lol-agent.mjs";\nconst f = (n) => n\n  ? 1\n  : throw new Error("x");\n</script>\n');
    assert.equal(bad.status, 2, 'exit 2: the stderr is what the model reads');
    assert.match(bad.stderr, /index\.html: its JavaScript does not parse[\s\S]*line 7: SyntaxError: Unexpected token 'throw'/, bad.stderr);
    assert.equal(run('ok.html', '<script>let x = 1;</script><script src="a.js"></script><script type="application/json">{not js</script>').status, 0, 'external and non-JavaScript scripts are not checked');
    assert.equal(run('app.mjs', 'export const a = ;\n').status, 2, 'a module file');
    assert.equal(run('app.js', 'const ok = 1;\n').status, 0);
    assert.equal(run('notes.md', 'const = broken').status, 0, 'only JavaScript is checked');
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
      agentLib: path.join(HERE, '..', '..', '..', 'assets', 'agent-page', 'lol-agent.mjs'),
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
      // Never a hidden file or folder: .git holds the whole history (files deleted since included), .env a secret.
      // Windows folds case, so .GIT is the same folder. And never a link leading out of the project (a pulled
      // repository can carry one).
      fs.mkdirSync(path.join(root, PID, '.git'), { recursive: true });
      fs.writeFileSync(path.join(root, PID, '.git', 'config'), '[remote "origin"]');
      fs.writeFileSync(path.join(root, PID, '.env'), 'TOKEN=secret');
      fs.writeFileSync(path.join(data, 'outside.txt'), 'outside the project');
      let linked = true;
      try { fs.symlinkSync(path.join(data, 'outside.txt'), path.join(root, PID, 'leak.txt'), 'file'); } catch { linked = false; }
      for (const p of ['/.git/config', '/.GIT/config', '/.env', '/lol-farm.json', '/lol-agent.mjs', ...(linked ? ['/leak.txt'] : [])]) {
        assert.equal((await get(lanUrl, { host: `192.0.2.10:${port}`, path: p })).status, 404, `${p} is not served on the LAN`);
      }
      if (!linked) console.log('     (no symlink permission on this machine: the link case is checked where links can be made)');
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

  test('studio: a bundled skill nobody edited is refreshed when the app brings a newer one; an edited one, or a person\'s own, is left', () => {
    const bundled = tmp('bundled');
    const dir = tmp('skills');
    const stamp = path.join(tmp('home'), 'lol-studio', 'skills-seeded.json');
    const put = (root, name, text) => { fs.mkdirSync(path.join(root, name), { recursive: true }); fs.writeFileSync(path.join(root, name, 'SKILL.md'), text); };
    const read = (name) => fs.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8');
    put(bundled, 'agent-page', 'v1');
    fs.writeFileSync(path.join(bundled, 'agent-page', 'old.md'), 'dropped in v2');
    put(bundled, 'ponytail', 'p1');
    put(dir, 'ponytail', 'mine');   // a folder of the person's own by that name
    S.seedSkills(bundled, dir, stamp);
    assert.equal(read('agent-page'), 'v1', 'one they do not have: copied');
    assert.equal(read('ponytail'), 'mine', 'their own: never touched');
    put(bundled, 'agent-page', 'v2');
    fs.rmSync(path.join(bundled, 'agent-page', 'old.md'));
    put(bundled, 'ponytail', 'p2');
    S.seedSkills(bundled, dir, stamp);
    assert.equal(read('agent-page'), 'v2', 'unedited: the newer bundled one replaces it');
    assert.ok(!fs.existsSync(path.join(dir, 'agent-page', 'old.md')), 'whole, not merged');
    assert.equal(read('ponytail'), 'mine');
    // Looked at in Finder (or Explorer, or from a non-Mac disk): the files the OS adds are not a person's edit.
    for (const f of ['.DS_Store', '._SKILL.md', 'Thumbs.db', 'desktop.ini']) fs.writeFileSync(path.join(dir, 'agent-page', f), 'os');
    put(bundled, 'agent-page', 'v2.1');
    S.seedSkills(bundled, dir, stamp);
    assert.equal(read('agent-page'), 'v2.1', 'only browsed: still refreshed');
    fs.writeFileSync(path.join(dir, 'agent-page', 'SKILL.md'), 'v2 and my own rule');
    put(bundled, 'agent-page', 'v3');
    S.seedSkills(bundled, dir, stamp);
    assert.equal(read('agent-page'), 'v2 and my own rule', 'edited: left as the person wrote it');
    // An install from before the stamp (v0.2.6–v0.2.7) has the agent-page those releases shipped: it is refreshed too.
    const old = spawnSync('git', ['cat-file', 'blob', '71bfb9524743d25184ee30cc741d028310aace1e'], { cwd: SHELL });
    if (old.status !== 0) { console.log('     (no git history here: the pre-stamp agent-page is checked in a full clone)'); return; }
    const legacy = tmp('legacy');
    fs.mkdirSync(path.join(legacy, 'agent-page'));
    fs.writeFileSync(path.join(legacy, 'agent-page', 'SKILL.md'), old.stdout);
    const real = path.join(SHELL, 'assets', 'skills');
    S.seedSkills(real, legacy, path.join(tmp('home'), 'skills-seeded.json'));
    assert.equal(fs.readFileSync(path.join(legacy, 'agent-page', 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(real, 'agent-page', 'SKILL.md'), 'utf8'));
  });
};
