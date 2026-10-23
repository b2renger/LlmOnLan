// The IDE's coding agent on real tasks, as LOL Vibe runs it: shell/build/main/studio.js createStudio (the profile
// patch, the project fence, the syntax check, dsh on its own Node), one prompt per task in a fresh project folder,
// then the task's check.js on what the agent left. Added for the Flint evaluation (docs/spike/RESULTS.md, 2026-10-23).
//
//   npm --prefix shell run build          # once: the runner uses the built studio.js
//   node docs/spike/ide/run.js <label> <farm /v1 URL> <context per person> <model id> <maxTokens> <task,task,...> [rep]
//
// The coding agent: <userData>/dsh-runtime (the installed client's "Install the coding agent"), or LOL_DSH_DIR (+
// LOL_DSH_NODE) as in dev. The farm password, if any: LOL_FARM_KEY. Projects and dsh's own files go to IDE_DATA
// (default <tmp>/lol-ide-<label>); one JSON line per task is appended to <IDE_DATA>/results.jsonl and printed.
// maxTokens: what LOL Vibe sends for the model (renderer/chat/projects/models.mjs: 8192 for a model it does not know).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const S = require(path.join(ROOT, 'shell', 'build', 'main', 'studio.js'));
const TASKS = path.join(__dirname, 'tasks');
const [, , label, endpoint, ctxArg, model, maxTokArg, taskArg, repArg] = process.argv;
if (!taskArg) { console.log('usage: node run.js <label> <farm /v1 URL> <context per person> <model id> <maxTokens> <task,...> [rep]'); process.exit(2); }
const rep = repArg || '1';
const dataDir = process.env.IDE_DATA || path.join(os.tmpdir(), `lol-ide-${label}`);
const root = path.join(dataDir, 'LOL Studio Projects');
fs.mkdirSync(root, { recursive: true });
const userData = process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'LlmOnLan')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'LlmOnLan') : path.join(os.homedir(), '.config', 'LlmOnLan');
const runtime = S.resolveRuntime(process.env, userData);
if (!runtime) { console.log('No coding agent: install it from the client, or set LOL_DSH_DIR.'); process.exit(2); }

let onEmit = () => {};
const studio = S.createStudio({
    dataDir: () => dataDir,
    projectsRoot: () => root,
    farm: () => ({ endpoint, key: process.env.LOL_FARM_KEY || null, ctxPerSlot: Number(ctxArg), model }),
    runtime: () => runtime,
    emit: (m) => onEmit(m),
    seedSkills: path.join(ROOT, 'shell', 'assets', 'skills'),
});

const rand = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');
function copyDir(a, b) { fs.mkdirSync(b, { recursive: true }); for (const f of fs.readdirSync(a)) fs.copyFileSync(path.join(a, f), path.join(b, f)); }

async function runTask(task) {
    const id = `${task}-${rand()}`;
    const dir = path.join(root, id);
    copyDir(path.join(TASKS, task, 'seed'), dir);
    const prompt = fs.readFileSync(path.join(TASKS, task, 'prompt.txt'), 'utf8').trim();
    const recs = [];
    const t0 = Date.now();
    const done = new Promise((resolve) => {
        onEmit = (m) => {
            if (m.rec) recs.push({ t: Date.now() - t0, ...m.rec });
            if (m.done) resolve(m.done);
        };
    });
    const r = await studio.prompt({ projectId: id, threadId: `${task}-${rep}-${Date.now()}`, model, text: prompt, maxTokens: Number(maxTokArg) });
    if (!r.ok) return { task, rep, error: r.message };
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ reason: 'harness-timeout' }), 20 * 60000));
    const end = await Promise.race([done, timeout]);
    if (end.reason === 'harness-timeout') await studio.stop();
    const wallS = (Date.now() - t0) / 1000;
    const chk = spawnSync(process.execPath, [path.join(TASKS, task, 'check.js'), dir], { encoding: 'utf8', timeout: 120000 });
    let check; try { check = JSON.parse(chk.stdout.trim().split('\n').pop()); } catch { check = { pass: false, raw: chk.stdout + chk.stderr }; }
    const steps = recs.filter((x) => x.kind === 'step');
    // dsh's own token count for the session (input not served from the engine's cache, from it, and output).
    let usage = null;
    try {
        const sd = path.join(dataDir, 'lol-studio', 'dsh', 'storages', 'session_projcache', 'sessions');
        const f = fs.readdirSync(sd).map((n) => path.join(sd, n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
        usage = JSON.parse(fs.readFileSync(f, 'utf8')).record.rows.tokenUsage.val.totals;
    } catch { /* none */ }
    // A step whose text or reasoning still holds template markup: a tool call the engine did not parse.
    const leaks = steps.filter((x) => /<tool_call>|<arg_key>|<\/?think>|<\|observation\|>/.test((x.text || '') + (x.reasoning || ''))).length;
    const calls = recs.filter((x) => x.kind === 'call');
    const results = recs.filter((x) => x.kind === 'result');
    return {
        task, rep, id, end, wallS, check,
        steps: steps.length,
        outTokens: steps.reduce((s, x) => s + (x.outTokens || 0), 0),
        usage, leaks,
        stopReasons: steps.map((x) => x.stopReason).join(','),
        calls: calls.length,
        callNames: calls.map((c) => `${c.name}:${c.target}`),
        failedResults: results.filter((x) => !x.ok).map((x) => x.error),
        reasoningChars: steps.reduce((s, x) => s + (x.reasoning || '').length, 0),
        finalText: ((steps.filter((x) => x.text).pop() || {}).text || '').slice(0, 400),
    };
}

(async () => {
    for (const task of taskArg.split(',')) {
        const r = await runTask(task);
        console.log(JSON.stringify(r));
        fs.appendFileSync(path.join(dataDir, 'results.jsonl'), JSON.stringify(r) + '\n');
        await studio.stop();   // a fresh runtime (and dsh session) per task
    }
    process.exit(0);
})().catch((e) => { console.log('FAILED ' + (e.stack || e)); process.exit(1); });
