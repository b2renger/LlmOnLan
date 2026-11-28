// Classify orchestration — the farm's Laya decision model as ONE shared "lol-classify" service
// (docs/archive/plans/ECOSYSTEM_PLAN.md v2 §3.2). The Computer's Classify box reads `classify` (url + key) from
// the beacon snapshot and sends a list of items with ONE `choice` question; the farm answers each
// with a label and its (uncalibrated) confidence. Mirrors extract.js: the service source is
// COMMITTED (farm/src/pysvc/classify_server.py); `ensureClassify` only builds a venv + pip-installs.
//
// CPU-first and OFF by default (plan v2): torch comes from the PyTorch CPU index (no CUDA download),
// threads are capped, and nothing is on until an operator turns the plugin on in the panel. Laya is
// pinned to the version measured on 2026-09-27 (docs/research/ECOSYSTEM_RESEARCH_2026-09-27.md).
//
// `rm -rf farm/.classify` is a full uninstall. Auxiliary: any failure warns and the farm still comes
// up without Classify.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const log = require('./log');
const { serviceHosts } = require('./net');
const { resolvePython } = require('./python');
const { pipInstall } = require('./plugins/progress');

const IS_WIN = process.platform === 'win32';
const ROOT = path.join(__dirname, '..', '.classify');   // farm/.classify
const VENV = path.join(ROOT, 'venv');
const PYSVC = path.join(__dirname, 'pysvc');             // committed service source
const MARKER = path.join(ROOT, '.installed');

// ponytail: Laya's PACKAGE is pinned; its weights are fetched by the package from Hugging Face at
// first start and not pinned to a revision. Upgrade path: pass a revision once laya exposes one.
const LAYA_VERSION = '0.3.20';
// PLUGIN_PROGRESS_PLAN: Laya's English checkpoint, which the service downloads at its first start (its allow_patterns:
// rl_agent_config.json, model.safetensors, tokenizer/*, encoder/*; laya/agent.py). 846,201,885 bytes on disk, snapshot
// 55cf4c4 (read 2026-11-28 from the 2026-09-27 spike's cache). ponytail: a constant that drifts with Laya's repo; the
// job bar only uses it for its percentage, capped at 99 % until the service answers. Upgrade path: the Hub's file sizes.
const LAYA_REPO_DIR = 'models--convaiinnovations--laya';
const WEIGHTS_BYTES = 846201885;
const TORCH_CPU_INDEX = 'https://download.pytorch.org/whl/cpu';
const DEPS = [`laya==${LAYA_VERSION}`, 'fastapi', 'uvicorn'];

function venvPython() {
    return IS_WIN ? path.join(VENV, 'Scripts', 'python.exe') : path.join(VENV, 'bin', 'python');
}
// Async (a spawned shell, awaited): a first install is ~1 GB of pip, and it runs while the farm is already
// public (up.js starts this plugin late), so it must never freeze the event loop the seat gate and the
// beacon run on.
function sh(cmd, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, { shell: true, stdio: 'inherit', windowsHide: true, ...opts });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd.split(' ')[0]} exited with ${code}`))));
    });
}
function readTrim(p) { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; } }

function findPython() {
    const candidates = IS_WIN
        ? ['py -3.12', 'py -3.11', 'py -3', 'python', 'python3']
        : ['python3.12', 'python3.11', 'python3', 'python'];
    return resolvePython(candidates, (v) => /Python 3\.(10|11|12|13)\b/.test(v));
}

/** What SHOULD be installed; a change reinstalls on the next `lol up`. */
function depsSignature() {
    return `v1|laya=${LAYA_VERSION}|torch=cpu`;
}

function installed() {
    return fs.existsSync(venvPython()) && readTrim(MARKER) === depsSignature();
}

/** Where the service's Hugging Face cache keeps Laya: the farm's model folder once one is chosen, else the machine's
 * shared cache (the same rule as spawnClassify's HF_HUB_CACHE). */
function weightsDir() {
    const storage = require('./storage');
    return path.join(storage.classifyCache() || storage.hfHubDir(), LAYA_REPO_DIR);
}
/** Laya's English checkpoint is on disk (a snapshot holding its model.safetensors). */
function weightsOnDisk(dir = weightsDir()) {
    let snaps = [];
    try { snaps = fs.readdirSync(path.join(dir, 'snapshots')); } catch { return false; }
    return snaps.some((r) => fs.existsSync(path.join(dir, 'snapshots', r, 'model.safetensors')));
}
/** All a start needs, on disk: the venv AND the weights. A farm with the venv but not the weights would otherwise turn
 * Classify on as installed, and download 0.8 GB with nothing on the panel (PLUGIN_PROGRESS_PLAN step 3). */
function ready() { return installed() && weightsOnDisk(); }

// Idempotent setup. Returns true when ready to spawn; false (warned) when the farm should come up
// WITHOUT Classify. `progress` (PLUGIN_PROGRESS_PLAN): the panel's job, told each step and pip's bytes.
async function ensureClassify(progress = null) {
    if (installed()) return true;
    const step = (msg) => { log.step(msg); if (progress) progress(msg, null); };
    const py = findPython();
    if (!py) {
        log.warn('No Python 3.10–3.13 found — cannot install Classify (needs its own venv).');
        return false;
    }
    try {
        fs.mkdirSync(ROOT, { recursive: true });
        if (!fs.existsSync(venvPython())) {
            step(`Creating Classify's Python environment (${py.version}) …`);
            await sh(`${py.cmd} -m venv "${VENV}"`);
        }
        const vpy = venvPython();
        step('Updating pip in it …');
        await pipInstall(vpy, ['-U', 'pip'], { progress, what: 'Updating pip' });
        step('Installing torch (CPU build, ~0.9 GB) for Classify …');
        await pipInstall(vpy, ['torch', '--index-url', TORCH_CPU_INDEX], { progress, what: 'Installing torch (CPU build)' });
        step(`Installing Laya ${LAYA_VERSION} …`);
        await pipInstall(vpy, DEPS, { progress, what: `Installing Laya ${LAYA_VERSION}` });
        fs.writeFileSync(MARKER, depsSignature() + '\n', 'utf8');
        log.ok(`Classify installed → ${log.paint.grey(ROOT)} (its ~0.8 GB of weights download at first start)`);
        return true;
    } catch (e) {
        log.warn(`Classify install failed (${e.message}) — the farm will run WITHOUT Classify.`);
        log.info(`  Retry: turn it off and on again in the admin panel's Plugins card (or restart the farm). If it fails again, delete ${ROOT} first.`);
        return false;
    }
}

// Spawn <venv python> -m uvicorn classify_server:app, cwd = pysvc, bound where config.proxy.host
// says (net.serviceHosts). opts = { key }. `spawnFn` is for tests. Laya's weights: in the farm's model folder once one is
// chosen (<dir>/classify, its own Hugging Face cache: storage.js), else the machine's shared Hugging Face cache.
function spawnClassify(config, opts, spawnFn = spawn) {
    const bind = serviceHosts(config.proxy && config.proxy.host).bind;
    return spawnFn(venvPython(), ['-m', 'uvicorn', 'classify_server:app', '--host', bind, '--port', String(config.classify.port), '--no-access-log'], {
        cwd: PYSVC,
        windowsHide: true,
        detached: !IS_WIN,
        env: {
            ...process.env,
            PYTHONPATH: PYSVC,
            CLASSIFY_API_KEY: opts.key,
            CLASSIFY_THREADS: String(config.classify.threads),
            CLASSIFY_MAX_ITEMS: String(config.classify.maxItems),
            // The farm's vLLM relay on this computer (CLASSIFY_VLLM_PLAN): the service reads what it serves at each
            // request and asks it only when that is Qwen3.6 or Qwen3.8, so an engine switch needs no restart here.
            CLASSIFY_VLLM_URL: `http://127.0.0.1:${config.vllm.port}`,
            ...(require('./storage').classifyCache() ? { HF_HUB_CACHE: require('./storage').classifyCache() } : {}),
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function get(url, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            let b = '';
            res.on('data', (c) => { if (b.length < 4096) b += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: b }));
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
    });
}

// The service answers 503 {"error": "..."} once loading has FAILED (not while it is still loading):
// no point waiting out the timeout for it.
function loadError(r) {
    if (!r || r.status !== 503) return null;
    try { return JSON.parse(r.body).error || null; } catch { return null; }
}

// Wait for /health = 200, which the service only answers once the model is WARM. Generous: the
// first start downloads ~0.8 GB of weights, then loads them (13.7 s cold on the dev box's CPU).
// `isDead` (the registry's "the child exited") and a load error both end the wait early.
async function waitForClassify(port, timeoutMs = 10 * 60 * 1000, host = '127.0.0.1', isDead = () => false) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (isDead()) return { up: false };
        const r = await get(`http://${host}:${port}/health`);
        if (r && r.status === 200) return { up: true };
        const error = loadError(r);
        if (error) return { up: false, error };
        await new Promise((res) => setTimeout(res, 1000));
    }
    return { up: false };
}

async function classifyAlive(port, host = '127.0.0.1') {
    const r = await get(`http://${host}:${port}/health`);
    return !!(r && r.status === 200);
}

module.exports = { loadError, ensureClassify, spawnClassify, waitForClassify, classifyAlive, depsSignature, installed, ready, weightsDir, weightsOnDisk, WEIGHTS_BYTES, LAYA_VERSION };
