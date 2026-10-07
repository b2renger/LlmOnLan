// The vLLM the farm runs, end to end with a FAKE vLLM (docs/VLLM_MANAGED_PLAN.md §11.3, items 1-11). Opt-in, a few
// minutes, no GPU used:
//
//   LOL_VLLM_FAKE=1 [LOL_LITELLM=<path to litellm(.exe)>] node test/vllm-lifecycle.js [step numbers...]
//
// A real `lol up` from this worktree (cwd = a temp folder with its own lol.config.json), farm/vllm's real scripts,
// test/fake-vllm in place of vLLM (inside WSL on Windows, as the farm runs it), test/fake-ollama.js in place of
// Ollama, and a real LiteLLM (farm/.venv's, or LOL_LITELLM). It touches ONLY: ports 4300 (the gate), 4301
// (LiteLLM), 4302 (the fake Ollama), 41897 (the panel) and 8299 (the fake vLLM); the folder ~/lol-fake-a inside
// Linux (WSL); a temp folder; and this worktree's farm/.lol-runtime.json. A vLLM or a farm running elsewhere on
// this computer is only ever read (status.sh lists every serve.sh; nothing here stops one outside ~/lol-fake-a).
//
// Steps (the plan's numbering):
//   1 boot: the panel answers while vLLM starts, the farm healthy and busy "Starting vLLM", the gate's 503, Ollama
//     evicted first; then a chat through the gate
//   2 `lol up` killed alone: vLLM survives; the next `lol up` keeps it (same process group, no job)
//   3 restarted with another context: stopped and started; with Automatic memory: kept (D9)
//   4 Apply: the dry run; a name keeps vLLM running; a context restarts it
//   5 slow but answering: no restart; killed: one restart; killed again within 5 min: Ollama serves, with why
//   6 the memory guard: phase guard, the farm unhealthy, no restart, no fallback
//   7 Stop and Start; Stop on a start, at once and once it runs: nothing left
//   8 a download in its own slot; vLLM killed during it: restarted at once, not after the download
//   9 a switch to Ollama whose vLLM stop fails: nothing changes, vLLM keeps serving
//  10 the orphan rule: Ollama chosen while the farm's vLLM still runs: the boot stops it
//  11 `lol down` stops vLLM; with the runtime file gone, it still does (from the config)
//  12 the panel's controls through the admin API (slice C): a switch to Ollama and back, the name following; Download
//     then Use this (an Apply with another model, refused while its window is shorter than the context); the list's
//     add and remove (with its files); the log; Install refused while vLLM runs from its folder
//  13 the take-over (§9, the plan's §11.3-12): a vLLM started the operator's way (serve.sh with none of the farm's
//     argv) that the farm routes to as an external server: offered, taken over (same process, same LiteLLM, the file
//     rewritten without its external block, the copy, serve.sh's marker; serve.sh the old way then does nothing),
//     Undo puts it all back; taken over again, `lol down` stops it. Then with nothing running: offered, and the
//     take-over starts it.
//  14 Windows only (§11.3-13): step 13's take-over, Undo and `lol down` from a copy of the farm in a folder whose
//     name has a space, as the Farm app's own copy is (%APPDATA%/LlmOnLan Farm/farm)
// The review of 2026-10-07:
//  15 `lol down` never stops a vLLM the farm does not run: an operator's, routed to as an external server, whose
//     folder the farm downloads a model into (during the download, and once it ended)
//  16 another program on vLLM's port: the start says so, starts nothing, never routes to it; Ollama serves
//  17 vLLM and llama.cpp both on in the file: llama.cpp never starts beside vLLM
//  18 an Ollama download (an admin job) does not hide a vLLM that died: seen at once, restarted after the download
//  19 a fallback whose stop leaves vLLM's port answering: no Ollama beside it; the farm stays on vLLM, stopped
//  20 at boot, the farm's own vLLM that cannot serve as it is: stopped before Ollama serves

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const V = require('../src/vllm');
const { killTree, readRuntime, RUNTIME_FILE, venvLitellmPath } = require('../src/proc');
const { startFakeOllama } = require('./fake-ollama');

if (process.env.LOL_VLLM_FAKE !== '1') { console.log('skipped: set LOL_VLLM_FAKE=1 to run it'); process.exit(0); }
if (!V.supported().ok) { console.log(`skipped: ${V.UNSUPPORTED}`); process.exit(0); }

const FARM = path.join(__dirname, '..');
let FARM_DIR = FARM;   // the farm that runs: this worktree's, or step 14's copy
const LOL = () => path.join(FARM_DIR, 'bin', 'lol.js');
const readRt = () => { try { return JSON.parse(fs.readFileSync(path.join(FARM_DIR, '.lol-runtime.json'), 'utf8')); } catch { return null; } };
const LITELLM = process.env.LOL_LITELLM || venvLitellmPath();
const PORTS = { gate: 4300, litellm: 4301, ollama: 4302, panel: 41897, vllm: 8299 };
const TOKEN = 'lifecycle-test-token';
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = process.argv.slice(2).map(Number).filter(Boolean);

let distro = null; let home = null; let ROOT = null; let target = null;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lol-vllm-lifecycle-'));
const farmLog = path.join(scratch, 'farm.log');
let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => {
    if (ok) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`); }
    return ok;
};

// ---- Linux side --------------------------------------------------------------------------------------------------
function sh(script, { timeoutMs = 60000 } = {}) {
    const [cmd, args] = WIN ? ['wsl.exe', ['-d', distro, '-e', 'bash', '-c', script]] : ['bash', ['-c', script]];
    try { return { code: 0, out: execFileSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true }) }; }
    catch (e) { return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}
const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
function guardRoot() { if (!/^\/[\w./-]+\/lol-fake-a$/.test(ROOT)) throw new Error(`refusing a root that is not a lol-fake-* folder: ${ROOT}`); }
function makeRoot() {
    guardRoot();
    const fake = WIN ? sh(`wslpath -a ${q(path.join(__dirname, 'fake-vllm'))}`).out.trim() : path.join(__dirname, 'fake-vllm');
    const r = sh([
        'set -e', `R=${q(ROOT)}`, `F=${q(fake)}`,
        'pkill -KILL -f "$R/" 2>/dev/null || true', 'rm -rf "$R"',
        'mkdir -p "$R/.venv/bin" "$R/.venv/lib/python3.12/site-packages/vllm-0.30.0.dist-info" "$R/hf/fake-a"',
        'cp "$F/vllm" "$F/fake_vllm.py" "$F/hf" "$R/.venv/bin/"', 'chmod +x "$R/.venv/bin/vllm" "$R/.venv/bin/hf"',
        'ln -s /usr/bin/python3 "$R/.venv/bin/python"',
        'echo \'{"max_position_embeddings": 32768}\' > "$R/hf/fake-a/config.json"', ': > "$R/fake.env"', 'echo made',
    ].join('\n'));
    if (!/made/.test(r.out)) throw new Error(`could not make ${ROOT}: ${r.out}`);
}
const fakeEnv = (lines) => { guardRoot(); sh(`printf '%s\\n' ${lines.map(q).join(' ')} > ${q(`${ROOT}/fake.env`)}`); };
const touch = (name, on = true) => { guardRoot(); sh(on ? `: > ${q(`${ROOT}/${name}`)}` : `rm -f ${q(`${ROOT}/${name}`)}`); };
const killFake = () => { guardRoot(); sh(`pkill -KILL -f ${q(`${ROOT}/.venv/bin/fake_vllm.py`)} || true`); };
const leftInRoot = () => { guardRoot(); return sh(`pgrep -af ${q(`${ROOT}/`)} | grep -v pgrep || true`).out.trim(); };
const status = async () => (await V.status(target)).st;
const pgid = async () => { const s = await status(); return s && s.running ? s.running.pgid : null; };

// ---- the farm ----------------------------------------------------------------------------------------------------
const LIB = [
    { id: 'fake-a', label: 'Fake A', folder: 'fake-a', sizeGb: 0.1, weightsGib: 0.1, vision: false, args: ['--enable-prefix-caching'] },
    { id: 'fake-b', label: 'Fake B', repo: 'fake/fake-b', sizeGb: 0.1, weightsGib: 0.1, vision: false, args: ['--enable-prefix-caching'] },
];
function writeConfig(vllm = {}) {
    fs.writeFileSync(path.join(scratch, 'lol.config.json'), JSON.stringify({
        name: 'Fake vLLM farm',
        beacon: { enabled: false, httpPort: PORTS.panel },
        proxy: { host: '127.0.0.1', port: PORTS.gate, internalPort: PORTS.litellm },
        models: [{ id: 'fake-ollama:1b', default: true }],
        preinstall: [],
        ollama: { hosts: [`http://127.0.0.1:${PORTS.ollama}`], contextLength: 8192 },
        litellm: { command: LITELLM },
        websearch: { enabled: false }, ocr: { enabled: false },
        admin: { token: TOKEN },
        vllm: {
            enabled: true, root: ROOT, ...(distro ? { distro } : {}), port: PORTS.vllm, model: 'fake-a', contextLength: 8192,
            parallel: 4, kvCacheGib: 2, ocrReserveGib: 0, minFreeGb: 0, library: LIB, ...vllm,
        },
    }, null, 2));
}
const readConfig = () => JSON.parse(fs.readFileSync(path.join(scratch, 'lol.config.json'), 'utf8'));

let farm = null; let out = '';
function up() {
    out = '';
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(process.execPath, [LOL(), 'up', '--no-pick'], { cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const tap = (d) => { const s = d.toString(); out += s; fs.appendFileSync(farmLog, s); };
    child.stdout.on('data', tap); child.stderr.on('data', tap);
    farm = child;
    return child;
}
function lolDown() {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    try { return execFileSync(process.execPath, [LOL(), 'down'], { cwd: scratch, env, encoding: 'utf8', timeout: 240000, windowsHide: true }); }
    catch (e) { return `${e.stdout || ''}${e.stderr || ''}`; }
}
// `lol down`, then the farm must be gone: its process ended and its ports closed. One that lives on is a failure
// (it would answer the next step's checks in place of the farm under test), and is killed.
async function stopFarm() {
    const said = lolDown();
    fs.appendFileSync(farmLog, `\n--- lol down ---\n${said}\n`);
    if (farm) {
        const c = farm;
        const gone = await waitFor(() => c.exitCode !== null || c.signalCode !== null, 30000, 'lol up to exit').catch(() => false);
        if (!gone) { check('`lol up` exits after `lol down`', false, `pid ${c.pid} still running: killed`); await killTree(c.pid); }
    }
    farm = null;
    const closed = await waitFor(async () => !(await self()), 15000, 'the panel to close').catch(() => false);
    if (!closed) throw new Error(`a farm still answers on ${PORTS.panel} after \`lol down\``);
    return said;
}
// A crash of `lol up` alone (Windows: taskkill without /T, so its wsl.exe child lives on), then what the Farm app's
// crash restart does first (§3.12): the recorded LiteLLM, which outlives it on Windows, is reaped.
async function crashFarm() {
    const rt = readRuntime();
    if (WIN) execFileSync('taskkill', ['/F', '/PID', String(farm.pid)], { windowsHide: true, stdio: 'ignore' });
    else process.kill(farm.pid, 'SIGKILL');
    const c = farm;
    await waitFor(() => c.exitCode !== null || c.signalCode !== null, 10000);
    if (rt && rt.litellmPid) await killTree(rt.litellmPid);
    farm = null;
    await sleep(1500);
}

function req(method, port, p, body = null, { headers = {}, timeoutMs = 30000 } = {}) {
    return new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const r = http.request({ host: '127.0.0.1', port, method, path: p, timeout: timeoutMs,
            headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
            let buf = ''; res.on('data', (c) => { buf += c; });
            res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* text */ } resolve({ status: res.statusCode, json, text: buf, headers: res.headers }); });
        });
        r.on('timeout', () => r.destroy());
        r.on('error', () => resolve({ status: 0, json: null, text: '' }));
        r.end(data || undefined);
    });
}
const self = async () => (await req('GET', PORTS.panel, '/lol/self', null, { timeoutMs: 3000 })).json;
const admin = async (p, body = {}) => (await req('POST', PORTS.panel, `/lol/admin/${p}`, body, { headers: { authorization: `Bearer ${TOKEN}` }, timeoutMs: 120000 })).json;
const get = async (p) => (await req('GET', PORTS.panel, p, null, { headers: { authorization: `Bearer ${TOKEN}` } })).json;
const state = () => get('/lol/admin/state');
const chat = (model = 'assistant') => req('POST', PORTS.gate, '/v1/chat/completions', { model, messages: [{ role: 'user', content: 'hi' }], stream: false }, { timeoutMs: 60000 });
const replyOf = (r) => (r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.content) || '';

async function waitFor(fn, ms, what = 'a condition') {
    const end = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error(`timed out after ${Math.round(ms / 1000)} s waiting for ${what}`);
        await sleep(500);
    }
}
const ready = () => waitFor(async () => { const s = await state(); return s && s.vllm && s.vllm.phase === 'ready' && s; }, 180000, 'vLLM ready');
const jobDone = (label) => waitFor(async () => { const s = await state(); return s && s.job && (!label || s.job.label === label) && s.job.done && s; }, 240000, `the job ${label || ''}`);
async function bootReady() { up(); await waitFor(self, 120000, 'the panel'); return ready(); }

// ---- the steps ----------------------------------------------------------------------------------------------------
let fakeOllama = null;
const STEPS = {
    async 1() {
        fakeEnv(['FAKE_DELAY=10']);
        const t0 = Date.now();
        up();
        const snap = await waitFor(self, 120000, 'the panel');
        const tSelf = (Date.now() - t0) / 1000;
        const s0 = await state();
        check(`the panel answers before vLLM is ready (after ${tSelf.toFixed(1)} s, LiteLLM's own start included)`, s0.vllm.phase !== 'ready', `phase ${s0.vllm.phase}`);
        check('healthy while it starts, busy says "Starting vLLM"', snap.healthy === true && snap.busy && snap.busy.label === 'Starting vLLM', JSON.stringify({ healthy: snap.healthy, busy: snap.busy }));
        check('the engine is vLLM', snap.backend.engine === 'vllm');
        const r = await chat();
        check('a chat meanwhile gets 503 "starting"', r.status === 503 && r.json && r.json.error.code === 'lol_engine_starting' && /starting/.test(r.json.error.message), `${r.status} ${r.text.slice(0, 200)}`);
        const evicted = await waitFor(() => fakeOllama.requests.includes('POST /api/generate unload fake-ollama:1b'), 20000, 'the eviction').catch(() => false);
        check('Ollama\'s loaded model was evicted before the start', evicted, fakeOllama.requests.join(', '));
        const seen = new Set();
        await waitFor(async () => { const s = await state(); if (s.vllm.phaseText) seen.add(s.vllm.phaseText); return s.vllm.phase === 'ready'; }, 120000, 'vLLM ready');
        check(`the panel saw the start's phases (${[...seen].join(' / ')})`, [...seen].some((x) => /loading the model weights|capturing GPU graphs|almost ready|reading the model/.test(x)));
        const s1 = await state();
        check('ready: 4 people at once, the pool read from vLLM\'s log', s1.vllm.parallelResolved === 4 && s1.vllm.poolTokens === 50000 && s1.backend.slots === 4, JSON.stringify({ seats: s1.vllm.parallelResolved, pool: s1.vllm.poolTokens }));
        const c = await chat();
        check('a chat through the gate reaches vLLM', c.status === 200 && replyOf(c) === 'fake reply', `${c.status} ${c.text.slice(0, 200)}`);
        const snap2 = await self();
        check('busy is gone, healthy', snap2.busy === null && snap2.healthy === true);
        check('the runtime file records where vLLM lives', readRuntime() && readRuntime().vllm && readRuntime().vllm.root === ROOT, JSON.stringify(readRuntime() && readRuntime().vllm));
    },
    async 2() {
        const before = await pgid();
        await crashFarm();
        check('`lol up` killed alone: vLLM survives', (await pgid()) === before && await V.answers(`http://127.0.0.1:${PORTS.vllm}/v1`, 3000), `pgid ${before} → ${await pgid()}`);
        up();
        await waitFor(self, 120000, 'the panel');
        const s = await state();
        check('the next `lol up` keeps it at once: ready, adopted, no job', s.vllm.phase === 'ready' && s.vllm.adopted === true && s.job === null, JSON.stringify({ phase: s.vllm.phase, adopted: s.vllm.adopted, job: s.job && s.job.label }));
        check('same process group', (await pgid()) === before);
        check('a chat goes through', replyOf(await chat()) === 'fake reply');
    },
    async 3() {
        const before = await pgid();
        await crashFarm();
        const cfg = readConfig(); cfg.vllm.contextLength = 16384; fs.writeFileSync(path.join(scratch, 'lol.config.json'), JSON.stringify(cfg, null, 2));
        await bootReady();
        const after = await pgid();
        check('another context: stopped and started again (a new process group)', after && after !== before, `${before} → ${after}`);
        check('the farm said why', /restarts with this farm's/.test(out));
        await crashFarm();
        const cfg2 = readConfig(); cfg2.vllm.kvCacheGib = 'auto'; fs.writeFileSync(path.join(scratch, 'lol.config.json'), JSON.stringify(cfg2, null, 2));
        up();
        await waitFor(self, 120000, 'the panel');
        const s = await state();
        check('Automatic memory accepts what runs (D9): kept, same group', s.vllm.phase === 'ready' && s.vllm.adopted && (await pgid()) === after, JSON.stringify({ phase: s.vllm.phase, adopted: s.vllm.adopted }));
        check('…with the amount it runs with', s.vllm.kvResolvedGib === 2, String(s.vllm.kvResolvedGib));
    },
    async 4() {
        const before = await pgid();
        const dryCtx = await admin('apply', { context: 8192, kvCacheGib: 2, dryRun: true });
        const dryName = await admin('apply', { name: 'fake-renamed', dryRun: true });
        check('the dry run: a context restarts vLLM, a name does not', dryCtx.dryRun && dryCtx.restart === true && dryName.dryRun && dryName.restart === false, JSON.stringify({ dryCtx, dryName }));
        const r1 = await admin('apply', { name: 'fake-renamed' });
        check('Apply a name: a job', r1.ok && r1.started);
        const j1 = await jobDone('Applying the farm settings');
        check('…done, vLLM kept running (same group)', j1.job.ok && (await pgid()) === before, j1.job.error || j1.job.message);
        check('…clients see the new name', replyOf(await chat('fake-renamed')) === 'fake reply');
        const r2 = await admin('apply', { context: 8192, kvCacheGib: 2 });
        check('Apply a context: a job', r2.ok && r2.started, JSON.stringify(r2));
        const j2 = await jobDone('Applying the farm settings');
        const after = await pgid();
        check('…done in one restart of vLLM (a new group)', j2.job.ok && after && after !== before, `${j2.job.error || j2.job.message} ${before} → ${after}`);
        check('…saved for the next start', readConfig().vllm.contextLength === 8192 && readConfig().vllm.alias === 'fake-renamed');
    },
    async 5() {
        if (!farm) { writeConfig({ alias: 'fake-renamed' }); await bootReady(); }   // run on its own
        const before = await pgid();
        touch('fake-slow-models');
        const mark = out.length;
        await waitFor(() => /vLLM was only slow/.test(out.slice(mark)), 120000, 'the slow check');
        touch('fake-slow-models', false);
        const s = await state();
        check('slow but answering: looked at, not restarted (same group, no job)', (await pgid()) === before && (!s.job || s.job.label !== 'Restarting vLLM after it stopped unexpectedly') && s.vllm.phase === 'ready');
        killFake();
        const j = await jobDone('Restarting vLLM after it stopped unexpectedly');
        const after = await pgid();
        check('killed: one restart, at once', j.job.ok && after && after !== before && j.vllm.phase === 'ready', `${j.job.error || ''} ${before} → ${after}`);
        check('…a chat goes through again', replyOf(await chat('fake-renamed')) === 'fake reply');
        killFake();
        // Healthy means it answers: the first moment the farm says healthy on Ollama, a chat must go through.
        const first = await waitFor(async () => { const x = await self(); return x && x.healthy && x.backend.engine === 'ollama' && chat('fake-renamed'); }, 120000, 'the farm healthy on Ollama');
        check('…the farm says healthy only once Ollama is routed', first.status === 200, `${first.status} ${first.text.slice(0, 160)}`);
        const f = await waitFor(async () => { const x = await state(); return x.vllm.phase === 'failed' && x; }, 120000, 'the fallback to Ollama');
        check('killed again within 5 minutes: Ollama serves, with why', /stopped twice in 5 minutes/.test(f.vllm.bootError || ''), f.vllm.bootError);
        const snap = await self();
        check('…the farm healthy, no vLLM left', snap.healthy === true && !(await pgid()));
        const c = await chat('fake-renamed');
        check('…a chat under vLLM\'s name goes to Ollama', c.status === 200 && replyOf(c) === 'fake ollama reply', `${c.status} ${c.text.slice(0, 200)}`);
        check('…the file still says vLLM (the next start tries it again)', readConfig().vllm.enabled === true);
        await stopFarm();
    },
    async 6() {
        writeConfig({ minFreeGb: 100000 });
        fakeEnv(['FAKE_DELAY=8']);
        up();
        await waitFor(self, 120000, 'the panel');
        const s = await waitFor(async () => { const x = await state(); return x.vllm.phase === 'guard' && x; }, 120000, 'the guard');
        check('the memory guard stopped it: phase guard, said in plain words', /running out of memory/.test(s.vllm.phaseText || ''), s.vllm.phaseText);
        const snap = await self();
        check('…the farm unhealthy (clients fail over), still on vLLM', snap.healthy === false && snap.backend.engine === 'vllm');
        await sleep(25000);
        const s2 = await state();
        check('…no restart, no fallback', s2.vllm.phase === 'guard' && s2.backend.engine === 'vllm' && !(await pgid()) && !(s2.job && /Restarting/.test(s2.job.label)));
        const r = await chat();
        check('…a chat gets 503 "stopped"', r.status === 503 && /stopped for now/.test((r.json && r.json.error.message) || ''), r.text.slice(0, 200));
        await stopFarm();
    },
    async 7() {
        writeConfig();
        fakeEnv(['FAKE_DELAY=3']);
        await bootReady();
        const r = await admin('vllm/stop');
        check('Stop: a job', r.ok && r.started, JSON.stringify(r));
        const j = await jobDone('Stopping vLLM');
        const snap = await self();
        check('…stopped: nothing runs, the farm unhealthy', j.job.ok && j.vllm.phase === 'stopped' && !(await pgid()) && snap.healthy === false, j.job.error || '');
        check('…a chat gets 503 "stopped"', /stopped for now/.test(((await chat()).json || { error: {} }).error.message || ''));
        check('Start: a job', (await admin('vllm/start')).started);
        await jobDone('Starting vLLM');
        check('…ready, a chat goes through', (await state()).vllm.phase === 'ready' && replyOf(await chat()) === 'fake reply');
        await admin('vllm/stop'); await jobDone('Stopping vLLM');
        // Stop on a start at once (before anything was spawned), then once its process group runs.
        fakeEnv(['FAKE_DELAY=30']);
        await admin('vllm/start');
        const c1 = await admin('job/cancel', { slot: 'job' });
        const j1 = await jobDone('Starting vLLM');
        check('Stop on a start at once: cancelled, phase stopped', c1.ok && j1.job.cancelled && j1.vllm.phase === 'stopped', JSON.stringify({ c1, cancelled: j1.job.cancelled, phase: j1.vllm.phase }));
        await sleep(3000);
        check('…nothing left running', !(await pgid()) && !leftInRoot(), leftInRoot());
        await admin('vllm/start');
        await waitFor(pgid, 60000, 'the start\'s process group');
        await admin('job/cancel', { slot: 'job' });
        const j2 = await jobDone('Starting vLLM');
        await sleep(3000);
        check('Stop on a start that runs: cancelled, nothing left', j2.job.cancelled && j2.vllm.phase === 'stopped' && !(await pgid()) && !leftInRoot(), leftInRoot());
        check('…the message says how to go on', /press Start vLLM/.test(j2.job.error || ''), j2.job.error);
    },
    async 8() {
        fakeEnv(['FAKE_DELAY=3', 'FAKE_HF=slow']);
        if ((await state()).vllm.phase !== 'ready') { await admin('vllm/start'); await ready(); }
        const before = await pgid();
        const d = await admin('vllm/download', { id: 'fake-b' });
        check('a download starts in its own slot', d.ok && d.started, JSON.stringify(d));
        await waitFor(async () => { const s = await status(); return s && s.installing; }, 60000, 'install.sh');
        const snap = await self();
        check('…clients do not see it (not busy)', snap.busy === null && snap.healthy === true, JSON.stringify(snap.busy));
        killFake();
        const t0 = Date.now();
        const j = await jobDone('Restarting vLLM after it stopped unexpectedly');
        const s = await state();
        check(`vLLM killed during the download: restarted at once (${Math.round((Date.now() - t0) / 1000)} s)`, j.job.ok && s.vllm.phase === 'ready' && (await pgid()) !== before);
        check('…while the download still runs', s.download && s.download.done === false, JSON.stringify(s.download && { done: s.download.done, message: s.download.message }));
        const c = await admin('job/cancel', { slot: 'download' });
        const dd = await waitFor(async () => { const x = await state(); return x.download && x.download.done && x; }, 60000, 'the download to stop');
        check('Stop on the download: stopped, resumable', c.ok && dd.download.cancelled && /continue where it left off/.test(dd.download.error || ''), dd.download.error);
        const st = await status();
        check('…install.sh is gone', !st.installing);
        fakeEnv(['FAKE_DELAY=3']);
    },
    async 9() {
        if ((await state()).vllm.phase !== 'ready') { await admin('vllm/start'); await ready(); }
        touch('fake-linger');
        const r = await admin('backend', { engine: 'ollama' });
        check('a switch to Ollama: a job', r.ok && r.started, JSON.stringify(r));
        const j = await jobDone('Switching to Ollama');
        check('…vLLM\'s stop fails (its port still answers): the switch says so and changes nothing', !j.job.ok && /still answers on port 8299/.test(j.job.error) && /Nothing changed/.test(j.job.error), j.job.error);
        check('…still on vLLM, in memory and in the file', j.backend.engine === 'vllm' && readConfig().vllm.enabled === true && readConfig().llamacpp === undefined);
        const c = await chat();
        check('…and it keeps serving', c.status === 200 && replyOf(c) === 'fake reply', `${c.status} ${c.text.slice(0, 160)}`);
        touch('fake-linger', false);
        killFake();
        await stopFarm();
    },
    async 10() {
        writeConfig();
        await bootReady();
        const before = await pgid();
        await crashFarm();
        check('the farm crashed with vLLM running (marked as the farm\'s)', (await pgid()) === before && (await status()).managed);
        writeConfig({ enabled: false });
        up();
        await waitFor(self, 120000, 'the panel');
        check('Ollama chosen: the boot stopped the vLLM left running', /Stopped a vLLM left running from .*: this farm serves with Ollama now\./.test(out) && !(await pgid()), out.split('\n').filter((l) => /vLLM/.test(l)).join(' | '));
        check('…and serves with Ollama', (await self()).backend.engine !== 'vllm' && replyOf(await chat('fake-ollama:1b')) === 'fake ollama reply');
        await stopFarm();
    },
    async 11() {
        writeConfig();
        await bootReady();
        const said = await stopFarm();
        check('`lol down` stops vLLM', /Stopping vLLM/.test(said) && !(await pgid()) && !leftInRoot(), said);
        check('…and clears the runtime file', !fs.existsSync(RUNTIME_FILE));
        await bootReady();
        await crashFarm();
        try { fs.unlinkSync(RUNTIME_FILE); } catch { /* gone */ }
        check('a crashed farm left vLLM running, and no runtime file', !!(await pgid()) && !fs.existsSync(RUNTIME_FILE));
        const said2 = lolDown();
        check('`lol down` still stops it, from the config', /Stopping vLLM/.test(said2) && !(await pgid()) && !leftInRoot(), said2);
    },
    async 12() {
        writeConfig({ alias: 'fake-12' });
        fakeEnv(['FAKE_DELAY=3']);
        await bootReady();
        // A planned switch never says unhealthy (D5: clients would scatter to slower farms and stay there): sampled
        // every 200 ms through both switches, LiteLLM's two restarts included.
        const unhealthy = []; let sampling = true;
        const sampler = (async () => { while (sampling) { const x = await self(); if (x && x.healthy === false) unhealthy.push(`${new Date().toISOString().slice(11, 19)} ${x.busy ? x.busy.label : '-'} proxy ${(((await state()) || {}).health || {}).proxyUp ? 'up' : 'down'}`); await sleep(200); } })();
        // A switch to Ollama: vLLM stops first; chats bound to vLLM's name keep working.
        const r = await admin('backend', { engine: 'ollama' });
        check('a switch to Ollama through the admin API: a job', r.ok && r.started, JSON.stringify(r));
        const j = await jobDone('Switching to Ollama');
        check('…done: vLLM stopped, Ollama serves', j.job.ok && !(await pgid()) && j.backend.engine === 'ollama' && !leftInRoot(), `${j.job.error || ''} ${leftInRoot()}`);
        check('…under vLLM\'s name', replyOf(await chat('fake-12')) === 'fake ollama reply');
        check('…saved: vLLM no longer the engine', readConfig().vllm.enabled === false);
        // And back: the farm stays healthy while vLLM starts, and serves under the same name.
        const r2 = await admin('backend', { engine: 'vllm' });
        check('a switch back to vLLM: a job', r2.ok && r2.started, JSON.stringify(r2));
        const during = await self();
        check('…healthy while it starts, busy says so', during.healthy === true && during.busy && during.busy.label === 'Switching to vLLM',
            JSON.stringify({ healthy: during.healthy, busy: during.busy, health: (await state()).health }));
        const j2 = await jobDone('Switching to vLLM');
        check('…done: vLLM serves under the same name', j2.job.ok && j2.vllm.phase === 'ready' && replyOf(await chat('fake-12')) === 'fake reply', j2.job.error || '');
        check('…saved: vLLM the engine, with its name', readConfig().vllm.enabled === true && readConfig().vllm.alias === 'fake-12', JSON.stringify(readConfig().vllm.alias));
        sampling = false; await sampler;
        check('…healthy at every sample through both switches', unhealthy.length === 0, unhealthy.slice(0, 5).join(', '));
        // Download, then Use this: an Apply with another model of the list.
        const d = await admin('vllm/download', { id: 'fake-b' });
        const dd = await waitFor(async () => { const x = await state(); return x.download && x.download.done && x; }, 120000, 'the download');
        const b = dd.vllm.library.find((e) => e.id === 'fake-b');
        check('Download: in its own slot, done, and the list says downloaded', d.ok && dd.download.ok && b && b.downloaded, JSON.stringify({ d, dl: dd.download && dd.download.error, b }));
        const refused = await admin('apply', { model: 'fake-b', dryRun: true });
        check('Use this, with a context longer than the model reads: refused, saying why', refused.ok === false && /reads at most 4096 tokens/.test(refused.error), JSON.stringify(refused));
        const dry = await admin('apply', { model: 'fake-b', context: 4096, dryRun: true });
        check('…with a context it reads: the dry run says vLLM restarts', dry.ok && dry.restart === true, JSON.stringify(dry));
        const before = await pgid();
        const u = await admin('apply', { model: 'fake-b', context: 4096 });
        const ju = await jobDone('Applying the farm settings');
        const run = (await status()).running;
        check('Use this: one restart of vLLM, now serving fake-b', u.started && ju.job.ok && (await pgid()) !== before && run && /\/hf\/fake-b$/.test(run.argv[0]) && run.argv.includes('fake-b'), `${ju.job.error || ''} ${run && run.argv.slice(0, 4).join(' ')}`);
        check('…saved, and a chat goes through', readConfig().vllm.model === 'fake-b' && readConfig().vllm.contextLength === 4096 && replyOf(await chat('fake-12')) === 'fake reply');
        // The list: add by a link, never twice; the model serving is never removed; another goes, with its files.
        const add = await admin('vllm/library/add', { repo: 'https://huggingface.co/fake/Fake-C' });
        const added = readConfig().vllm.library.find((e) => e.repo === 'fake/Fake-C');
        check('Add a model by its link: saved in the list', add.ok && added && added.id === add.id, JSON.stringify(add));
        check('…not twice', (await admin('vllm/library/add', { repo: 'fake/Fake-C' })).ok === false);
        check('the model serving cannot be removed', /is the model vLLM serves/.test((await admin('vllm/library/remove', { id: 'fake-b' })).error || ''));
        const rmC = await admin('vllm/library/remove', { id: add.id });
        check('…another can', rmC.ok && !readConfig().vllm.library.some((e) => e.repo === 'fake/Fake-C'));
        const rmA = await admin('vllm/library/remove', { id: 'fake-a', deleteFiles: true });
        check('Remove with its files: out of the list, its folder deleted', rmA.ok && !readConfig().vllm.library.some((e) => e.id === 'fake-a') && !/yes/.test(sh(`test -d ${q(`${ROOT}/hf/fake-a`)} && echo yes`).out), JSON.stringify(rmA));
        // The log, through the panel's route.
        const lg = await get('/lol/admin/vllm/log?lines=50');
        const last = lg && lg.lines ? lg.lines.filter(Boolean).pop() : null;
        const tail = sh(`tail -n 20 ${q(`${ROOT}/logs/vllm.log`)}`).out.split('\n').map((l) => l.split('\r').filter(Boolean).pop() || '');
        check('the log: vLLM\'s last lines, as its file ends', lg && lg.ok && lg.lines.length > 0 && lg.lines.length <= 51 && tail.includes(last), JSON.stringify({ last, tail: tail.slice(-3) }));
        // Install refuses while vLLM runs from its folder.
        const ins = await admin('vllm/install');
        check('Install is refused while vLLM runs from its folder, saying what to do', ins.ok === false && /press Stop vLLM first/.test(ins.error || ''), JSON.stringify(ins));
        // What the panel reads to show its rows.
        const s = await state();
        check('the admin state carries the panel\'s fields', s.vllm && s.vllm.seatsAuto && s.vllm.facts && 'autoKvGib' in s.vllm && 'ocrFits' in s && s.vllm.takeOver === null && s.externalConfigured === false,
            JSON.stringify(s.vllm && { seatsAuto: s.vllm.seatsAuto, facts: s.vllm.facts }));
        await stopFarm();
    },
    async 13() { await takeOver({ notRunning: true }); },
    async 14() {
        if (!WIN) { console.log('  (Windows only)'); return; }
        // The farm from a copy in a folder whose name has a space, as the Farm app's is: its scripts then run through
        // `wsl.exe --cd "<…>\\LlmOnLan Farm\\farm\\vllm"`. Its own node_modules is a junction to this one's.
        const copy = path.join(scratch, 'LlmOnLan Farm', 'farm');
        for (const x of ['bin', 'src', 'vllm', 'package.json']) fs.cpSync(path.join(FARM, x), path.join(copy, x), { recursive: true });
        fs.symlinkSync(fs.realpathSync(path.join(FARM, 'node_modules')), path.join(copy, 'node_modules'), 'junction');
        FARM_DIR = copy;
        try { await takeOver({ notRunning: false }); } finally {
            FARM_DIR = FARM;
            execFileSync('cmd', ['/c', 'rmdir', path.join(copy, 'node_modules')], { windowsHide: true });   // the link only, never what it points to
        }
    },
    // ---- the review of 2026-10-07 ----
    async 15() {
        // `lol down` never stops a vLLM the farm does not run: an operator's (no marker), which the farm routes to as an
        // external server and downloads a second model for (production before the take-over, Download on its card).
        const before = await startOperatorWay();
        writeExternalConfig({ root: ROOT, ...(distro ? { distro } : {}), port: PORTS.vllm, library: LIB });
        fakeEnv(['FAKE_DELAY=3', 'FAKE_HF=slow']);
        up();
        await waitFor(self, 120000, 'the panel');
        const d = await admin('vllm/download', { id: 'fake-b' });
        await waitFor(async () => { const s = await status(); return s && s.installing; }, 60000, 'install.sh');
        check('the external engine, a download into the operator\'s folder: recorded as not the farm\'s engine', d.ok && d.started && readRt().vllm && readRt().vllm.root === ROOT && readRt().vllm.serving === false,
            JSON.stringify({ d, vllm: readRt() && readRt().vllm }));
        const said = await stopFarm();
        const after = await status();
        check('`lol down` during it: the operator\'s vLLM keeps running (the same process group, answering)', !/Stopping vLLM \(this frees/.test(said)
            && after.running && after.running.pgid === before && await V.answers(`http://127.0.0.1:${PORTS.vllm}/v1`, 3000), `${said} | running ${JSON.stringify(after.running && after.running.pgid)} before ${before}`);
        check('…and the download stopped', !after.installing, JSON.stringify(after.installing));
        // A download that ended is not recorded any more.
        fakeEnv(['FAKE_DELAY=3']);
        up();
        await waitFor(self, 120000, 'the panel');
        await admin('vllm/download', { id: 'fake-b' });
        const dd = await waitFor(async () => { const x = await state(); return x.download && x.download.done && x; }, 120000, 'the download');
        await sleep(500);
        check('a download that ended: done, and the runtime file no longer names the folder', dd.download.ok && !readRt().vllm, JSON.stringify({ dl: dd.download.error, vllm: readRt().vllm }));
        const said2 = await stopFarm();
        check('…`lol down` leaves the operator\'s vLLM running', !/Stopping vLLM/.test(said2) && (await pgid()) === before, said2);
        killFake();
    },
    async 16() {
        // Another program answers on vLLM's port: the start says so, starts nothing, and never takes that program's
        // answers for its own (it would route chats to someone else's model).
        killFake(); touch('run/managed-by-farm', false);
        // Once the last fake's relay let the port go: under WSL's mirrored networking Windows holds a port while
        // Linux keeps a connection to it in TIME_WAIT (60 s).
        const other = await waitFor(() => new Promise((r) => {
            const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end('{"object":"list","data":[{"id":"someone-else"}]}'); });
            srv.once('error', () => r(null));
            srv.listen(PORTS.vllm, '127.0.0.1', () => r(srv));
        }), 150000, 'the port to be free');
        try {
            writeConfig();
            fakeEnv(['FAKE_DELAY=3']);
            up();
            await waitFor(self, 120000, 'the panel');
            const s = await waitFor(async () => { const x = await state(); return x.vllm.phase === 'failed' && x; }, 120000, 'the start to give up');
            check('another program on vLLM\'s port: the start says so and starts nothing', /Another program uses port 8299/.test(s.vllm.bootError || '') && !/vLLM: starting Fake A/.test(out) && !(await pgid()),
                `${s.vllm.bootError} ${out.split('\n').filter((l) => /vLLM/.test(l)).slice(-4).join(' | ')}`);
            check('…Ollama serves instead, never that program', s.backend.engine === 'ollama' && replyOf(await chat('assistant')) === 'fake ollama reply');
            await stopFarm();
        } finally { await new Promise((r) => other.close(r)); }
    },
    async 17() {
        // vLLM and llama.cpp both on in the file (a farm that served llama.cpp before an operator's vLLM, then taken
        // over): vLLM serves, and llama.cpp is never started beside it.
        writeConfig();
        const cfg = readConfig(); cfg.llamacpp = { enabled: true, binDir: path.join(scratch, 'no-llama-here') };
        fs.writeFileSync(path.join(scratch, 'lol.config.json'), JSON.stringify(cfg, null, 2));
        fakeEnv(['FAKE_DELAY=3']);
        const s = await bootReady();
        check('vLLM and llama.cpp both on: llama.cpp stands down, never started', /llama\.cpp stands down — one engine at a time\./.test(out) && !/llama\.cpp backend:|llama\.cpp: /.test(out),
            out.split('\n').filter((l) => /llama/.test(l)).join(' | '));
        check('…vLLM serves, a chat goes through', s.backend.engine === 'vllm' && s.llamacpp.enabled === false && replyOf(await chat()) === 'fake reply');
        await stopFarm();
    },
    async 18() {
        // An Ollama download (an admin job) does not hide a vLLM that died: the farm says so at once, so clients go
        // elsewhere; the restart follows once the download ends. Adopted, so no process of its own tells the farm.
        writeConfig();
        fakeEnv(['FAKE_DELAY=3']);
        await bootReady();
        await crashFarm();
        up();
        await waitFor(self, 120000, 'the panel');
        const s0 = await state();
        check('adopted after a farm crash: only its port tells it is alive', s0.vllm.phase === 'ready' && s0.vllm.adopted);
        fakeOllama.knobs.pullMs = 90000;
        try {
            const p = await admin('ollama/pull', { id: 'slow:1b' });
            check('an Ollama download: the job', p.ok && p.started, JSON.stringify(p));
            killFake();
            const t0 = Date.now();
            const seen = await waitFor(async () => { const x = await state(); const y = await self(); return x.vllm.phase !== 'ready' && y && y.healthy === false && x; }, 60000, 'the farm to see it').catch(() => null);
            check(`vLLM died during the download: seen in ${Math.round((Date.now() - t0) / 1000)} s, the farm unhealthy, the download still running`,
                !!seen && !!seen.job && seen.job.kind === 'pull' && !seen.job.done, seen ? JSON.stringify({ phase: seen.vllm.phase, job: seen.job && seen.job.label }) : 'not seen while the download ran');
            const j = await jobDone('Restarting vLLM after it stopped unexpectedly');
            check('…restarted once the download ended', j.job.ok && j.vllm.phase === 'ready', j.job.error || '');
        } finally { fakeOllama.knobs.pullMs = 3000; }
        await stopFarm();
    },
    async 19() {
        // vLLM stops twice in 5 minutes and the farm falls back, but its stop leaves something answering on vLLM's
        // port: the farm does not load Ollama's model beside it. It stays on vLLM, stopped, and says why.
        writeConfig();
        fakeEnv(['FAKE_DELAY=3']);
        await bootReady();
        killFake();
        await jobDone('Restarting vLLM after it stopped unexpectedly');
        const loads = () => fakeOllama.requests.filter((r) => r === 'POST /api/chat' || /^POST \/api\/generate$/.test(r)).length;
        const loadsBefore = loads();
        // The second time: its port dies (the relay), vLLM itself still runs; stopped, a copy keeps the port.
        touch('fake-linger');
        sh(`pkill -f ${q(`relay.py 127.0.0.1 ${PORTS.vllm} ${ROOT}/run/vllm.sock`)} || true`);
        try {
            const s = await waitFor(async () => { const x = await state(); return x.vllm.phase === 'stopped' && x.vllm.phaseText && x; }, 180000, 'the fallback that cannot stop vLLM');
            check('the stop failed: still vLLM, stopped, saying why', s.backend.engine === 'vllm' && /does not start Ollama beside it/.test(s.vllm.phaseText) && /still answers on port 8299/.test(s.vllm.phaseText), s.vllm.phaseText);
            const snap = await self();
            check('…the farm unhealthy, and Ollama never loaded a model', snap.healthy === false && loads() === loadsBefore && readConfig().vllm.enabled === true, JSON.stringify({ healthy: snap.healthy, loads: loads() - loadsBefore }));
            check('…a chat is told it is stopped', /stopped for now/.test(((await chat()).json || { error: {} }).error.message || ''));
        } finally { touch('fake-linger', false); killFake(); }
        await stopFarm();
    },
    async 20() {
        // At boot, the farm's own vLLM runs but cannot serve as it is, and the check says why (here: the model the
        // file now names is not on disk): it is stopped before Ollama serves, never left beside it.
        writeConfig();
        fakeEnv(['FAKE_DELAY=3']);
        await bootReady();
        await crashFarm();
        check('the farm crashed with its vLLM running', !!(await pgid()) && (await status()).managed);
        sh(`rm -rf ${q(`${ROOT}/hf/fake-b`)}`);
        writeConfig({ model: 'fake-b' });
        up();
        await waitFor(self, 120000, 'the panel');
        const s = await state();
        check('…the next boot cannot use it: stopped first, then Ollama serves, saying why', s.backend.engine === 'ollama' && !(await pgid()) && /Fake B is not downloaded yet/.test(s.vllm.bootError || ''),
            JSON.stringify({ engine: s.backend.engine, pgid: await pgid(), why: s.vllm.bootError }));
        await stopFarm();
    },
};

// A vLLM started the operator's way (serve.sh with none of the farm's argv, as the old log-on task does), on the fake
// root's port; the farm's file routes to it as an external server, with no vllm block (production's file).
const EXT = { enabled: true, alias: 'fake-ext', baseUrl: `http://127.0.0.1:${PORTS.vllm}/v1`, model: 'qwen3.6-35b-a3b', contextLength: 65536, parallel: 48, vision: true, presencePenalty: 1.5, label: 'Fake (vLLM)' };
function writeExternalConfig(vllm = null, ext = {}) {
    fs.writeFileSync(path.join(scratch, 'lol.config.json'), JSON.stringify({
        name: 'Fake vLLM farm',
        beacon: { enabled: false, httpPort: PORTS.panel },
        proxy: { host: '127.0.0.1', port: PORTS.gate, internalPort: PORTS.litellm },
        models: [{ id: 'fake-ollama:1b', default: true }],
        preinstall: [],
        ollama: { hosts: [`http://127.0.0.1:${PORTS.ollama}`], contextLength: 8192 },
        litellm: { command: LITELLM },
        websearch: { enabled: false }, ocr: { enabled: false },
        admin: { token: TOKEN },
        external: { ...EXT, ...ext },
        ...(vllm ? { vllm } : {}),
    }, null, 2));
    return fs.readFileSync(path.join(scratch, 'lol.config.json'), 'utf8');
}
async function startOperatorWay() {
    guardRoot();
    killFake(); touch('run/managed-by-farm', false);
    fakeEnv(['FAKE_DELAY=3']);
    sh(`mkdir -p ${q(`${ROOT}/hf/fake-a`)} && echo '{"max_position_embeddings": 32768}' > ${q(`${ROOT}/hf/fake-a/config.json`)}`);   // step 12 deletes it
    const { child } = await V.start(target, { env: { LOL_VLLM_DAEMON: '1', LOL_VLLM_ROOT: ROOT, LOL_VLLM_PORT: String(PORTS.vllm), LOL_VLLM_MODEL: `${ROOT}/hf/fake-a` } });
    child.unref();
    await waitFor(() => V.answers(`http://127.0.0.1:${PORTS.vllm}/v1`, 2000), 60000, 'the fake started the operator\'s way');
    return pgid();
}
const marked = () => /yes/.test(sh(`test -e ${q(`${ROOT}/run/managed-by-farm`)} && echo yes`).out);
async function takeOver({ notRunning }) {
    const cfgPath = path.join(scratch, 'lol.config.json');
    const backup = `${cfgPath}.before-managed-vllm`;
    const before = await startOperatorWay();
    check('the fake runs the operator\'s way: not marked as the farm\'s', !!before && !marked() && !(await status()).managed);
    const original = writeExternalConfig();
    up();
    await waitFor(self, 120000, 'the panel');
    check('the farm serves it as an external server', (await self()).backend.engine === 'external' && replyOf(await chat('fake-ext')) === 'fake reply');
    const offered = await waitFor(async () => { const x = await state(); return x.vllm.takeOver && x; }, 120000, 'the offer');
    check('the panel offers to let the farm run it, from its own folder', offered.vllm.takeOver.root === ROOT && offered.vllm.takeOver.running === true, JSON.stringify(offered.vllm.takeOver));
    const litellm = readRt().litellmPid;
    const r = await admin('vllm/take-over');
    check('taken over: "Nothing was restarted."', r.ok && /^The farm now runs vLLM\. Nothing was restarted\./.test(r.message || ''), JSON.stringify(r));
    const s = await state();
    check('…vLLM serves, kept as it ran: the same process, adopted, no job', s.backend.engine === 'vllm' && s.vllm.phase === 'ready' && s.vllm.adopted && !s.job && (await pgid()) === before,
        JSON.stringify({ engine: s.backend.engine, phase: s.vllm.phase, adopted: s.vllm.adopted, job: s.job && s.job.label }));
    check('…LiteLLM was not restarted (the same process)', readRt().litellmPid === litellm && require('../src/proc').isAlive(litellm));
    const snap = await self();
    check('…clients see the same: the name, 48 people at once, 64k each', snap.healthy && snap.models[0].id === 'fake-ext' && snap.backend.slots === 48 && snap.backend.contextPerSlot === 65536, JSON.stringify(snap.backend));
    check('…and a chat goes through', replyOf(await chat('fake-ext')) === 'fake reply');
    const now = readConfig();
    check('the file: the vllm block in, the external block out', !('external' in now) && now.vllm.enabled === true && now.vllm.root === ROOT && now.vllm.port === PORTS.vllm && now.vllm.kvCacheGib === 50 && now.vllm.parallel === 48 && now.vllm.alias === 'fake-ext',
        JSON.stringify(now.vllm));
    check('…a copy of it as it was', fs.existsSync(backup) && fs.readFileSync(backup, 'utf8') === original);
    check('…serve.sh\'s marker in its folder', marked() && (await status()).managed);
    check('…the runtime file says where vLLM lives (for `lol down`)', readRt().vllm && readRt().vllm.root === ROOT);
    check('the panel says so, with Undo', s.vllm.takenOver && s.vllm.takenOver.undo === true && s.vllm.takeOver === null, JSON.stringify(s.vllm.takenOver));
    // The old launchers: serve.sh without the farm's argv now does nothing.
    const old = await V.spawnScript({ vllm: { distro } }, 'serve.sh', { LOL_VLLM_DAEMON: '1', LOL_VLLM_ROOT: ROOT, LOL_VLLM_PORT: String(PORTS.vllm) }, { timeoutMs: 30000, distro });
    check('serve.sh started the old way now does nothing, and says why', old.code === 0 && /The LlmOnLan farm runs this vLLM now/.test(old.out) && (await pgid()) === before, `${old.code} ${old.out.slice(0, 200)}`);
    // Undo.
    const u = await admin('vllm/take-over/undo');
    check('Undo: back as before', u.ok && /Back as before/.test(u.message || ''), JSON.stringify(u));
    check('…the file byte for byte, and its copy used up', fs.readFileSync(cfgPath, 'utf8') === original && !fs.existsSync(backup));
    check('…the marker gone', !marked());
    const s2 = await state();
    check('…routed as an external server again, the same vLLM and LiteLLM, the offer back', s2.backend.engine === 'external' && (await pgid()) === before && readRt().litellmPid === litellm && s2.vllm.takeOver && !s2.vllm.takenOver,
        JSON.stringify({ engine: s2.backend.engine, takeOver: s2.vllm.takeOver }));
    check('…and a chat goes through', replyOf(await chat('fake-ext')) === 'fake reply');
    // Taken over again: now `lol down` stops it, as the farm's.
    const r2 = await admin('vllm/take-over');
    check('taken over again', r2.ok && (await state()).backend.engine === 'vllm', JSON.stringify(r2));
    const said = await stopFarm();
    check('…`lol down` stops it now', /Stopping vLLM/.test(said) && !(await pgid()) && !leftInRoot(), said);
    if (!notRunning) return;
    // Nothing runs: the farm's file still routes to an external server on this computer, whose folder has the model.
    touch('run/managed-by-farm', false);
    const original2 = writeExternalConfig({ root: ROOT, ...(distro ? { distro } : {}), kvCacheGib: 2, minFreeGb: 0, ocrReserveGib: 0, library: LIB }, { model: 'fake-a', contextLength: 8192, parallel: 4, vision: false, presencePenalty: null });
    up();
    await waitFor(self, 120000, 'the panel');
    check('nothing answers: the farm serves with Ollama for now', (await self()).backend.engine === 'ollama');
    const o2 = await waitFor(async () => { const x = await state(); return x.vllm.takeOver && x; }, 120000, 'the offer');
    check('…and offers to run vLLM, starting it', o2.vllm.takeOver.running === false && o2.vllm.takeOver.root === ROOT);
    const r3 = await admin('vllm/take-over');
    check('taken over: the start is a job', r3.ok && r3.started && r3.job.label === 'Starting vLLM', JSON.stringify(r3));
    const j = await jobDone('Starting vLLM');
    check('…vLLM started by the farm serves under the same name', j.job.ok && j.backend.engine === 'vllm' && j.vllm.phase === 'ready' && replyOf(await chat('fake-ext')) === 'fake reply', j.job.error || '');
    check('…the file says vLLM, no external block, and its copy is there', readConfig().vllm.enabled === true && !('external' in readConfig()) && fs.readFileSync(backup, 'utf8') === original2);
    check('…no Undo for a vLLM the farm started', j.vllm.takenOver && j.vllm.takenOver.undo === false);
    await stopFarm();
    fs.rmSync(backup, { force: true });
}

async function main() {
    console.log(`scratch ${scratch} (the farm's output: farm.log)`);
    if (!LITELLM || !fs.existsSync(LITELLM)) { console.log('skipped: no LiteLLM (set LOL_LITELLM, or run `lol install`)'); return; }
    for (const [name, port] of Object.entries(PORTS)) {
        if (await V.answers(`http://127.0.0.1:${port}`, 1500) || (await req('GET', port, '/', null, { timeoutMs: 1500 })).status) throw new Error(`port ${port} (${name}) is in use: this test needs it free`);
    }
    if (fs.existsSync(RUNTIME_FILE)) throw new Error(`${RUNTIME_FILE} exists: a farm from this folder may be running`);
    if (WIN) {
        const list = await V.wslDistros();
        distro = Array.isArray(list) ? V.defaultDistro(list) : null;
        if (!distro) throw new Error(`no WSL distribution (${JSON.stringify(list)})`);
    }
    home = sh('echo $HOME').out.trim();
    ROOT = `${home}/lol-fake-a`;
    target = { platform: process.platform, distro, root: ROOT, port: PORTS.vllm };
    // What runs elsewhere on this computer is read before and after, never touched.
    const foundBefore = ((await V.status(target)).st || { found: [] }).found.filter((f) => f.root !== ROOT);
    console.log(`left alone: ${foundBefore.map((f) => `${f.root} :${f.port} pgid ${f.pgid}`).join(', ') || 'no other vLLM'}`);
    // The take-over writes a marker that makes a root's old launchers do nothing: never in another root than the fake's.
    const markers = () => ['~/lol-vllm', '~/lol-spike', ...foundBefore.map((f) => f.root)].map((r) => `${r}:${sh(`test -e ${r.replace(/^~/, home)}/run/managed-by-farm && echo 1 || echo 0`).out.trim()}`).join(' ');
    const markersBefore = markers();
    makeRoot();
    fakeOllama = await startFakeOllama(PORTS.ollama);
    writeConfig();
    try {
        for (const n of Object.keys(STEPS).map(Number)) {
            if (ONLY.length && !ONLY.includes(n)) continue;
            console.log(`\nstep ${n}`);
            try { await STEPS[n](); } catch (e) { check(`step ${n} ran to its end`, false, e.message); await stopFarm().catch((x) => check('the farm stopped', false, x.message)); }
        }
    } finally {
        if (farm || fs.existsSync(RUNTIME_FILE)) await stopFarm().catch((e) => check('the farm stopped', false, e.message));
        lolDown();
        killFake();
        touch('fake-linger', false);
        sh(`pkill -KILL -f ${q(`${ROOT}/`)} || true`);
        await fakeOllama.close();
        const foundAfter = ((await V.status(target)).st || { found: [] }).found.filter((f) => f.root !== ROOT);
        check('every other vLLM on this computer is as it was', JSON.stringify(foundAfter) === JSON.stringify(foundBefore), `${JSON.stringify(foundBefore)} → ${JSON.stringify(foundAfter)}`);
        check(`no other folder got the farm's marker (${markersBefore})`, markers() === markersBefore, markers());
        guardRoot();
        sh(`rm -rf ${q(ROOT)}`);
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
