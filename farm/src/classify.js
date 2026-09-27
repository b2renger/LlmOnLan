// Classify orchestration — the farm's Laya decision model as ONE shared "lol-classify" service
// (docs/ECOSYSTEM_PLAN.md v2 §3.2). The Computer's Classify box reads `classify` (url + key) from
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
const { execSync, spawn } = require('child_process');
const log = require('./log');
const { serviceHosts } = require('./net');
const { resolvePython } = require('./python');

const IS_WIN = process.platform === 'win32';
const ROOT = path.join(__dirname, '..', '.classify');   // farm/.classify
const VENV = path.join(ROOT, 'venv');
const PYSVC = path.join(__dirname, 'pysvc');             // committed service source
const MARKER = path.join(ROOT, '.installed');

// ponytail: Laya's PACKAGE is pinned; its weights are fetched by the package from Hugging Face at
// first start and not pinned to a revision. Upgrade path: pass a revision once laya exposes one.
const LAYA_VERSION = '0.3.20';
const TORCH_CPU_INDEX = 'https://download.pytorch.org/whl/cpu';
const DEPS = [`laya==${LAYA_VERSION}`, 'fastapi', 'uvicorn'];

function venvPython() {
    return IS_WIN ? path.join(VENV, 'Scripts', 'python.exe') : path.join(VENV, 'bin', 'python');
}
function sh(cmd, opts = {}) { execSync(cmd, { stdio: 'inherit', ...opts }); }
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

// Idempotent setup. Returns true when ready to spawn; false (warned) when the farm should come up
// WITHOUT Classify.
async function ensureClassify() {
    if (installed()) return true;
    const py = findPython();
    if (!py) {
        log.warn('No Python 3.10–3.13 found — cannot install Classify (needs its own venv).');
        return false;
    }
    try {
        fs.mkdirSync(ROOT, { recursive: true });
        if (!fs.existsSync(venvPython())) {
            log.step(`Creating the Classify venv with ${log.paint.bold(py.version)} …`);
            sh(`${py.cmd} -m venv "${VENV}"`);
        }
        const vpy = venvPython();
        sh(`"${vpy}" -m pip install -q -U pip`);
        log.step('Installing torch (CPU build, ~0.9 GB) for Classify …');
        sh(`"${vpy}" -m pip install -q torch --index-url ${TORCH_CPU_INDEX}`);
        log.step(`Installing Laya ${LAYA_VERSION} …`);
        sh(`"${vpy}" -m pip install -q ${DEPS.join(' ')}`);
        fs.writeFileSync(MARKER, depsSignature() + '\n', 'utf8');
        log.ok(`Classify installed → ${log.paint.grey(ROOT)} (its ~0.8 GB of weights download at first start)`);
        return true;
    } catch (e) {
        log.warn(`Classify install failed (${e.message}) — the farm will run WITHOUT Classify.`);
        log.info(`  Retry: delete ${ROOT} and re-run \`lol up\`.`);
        return false;
    }
}

// Spawn <venv python> -m uvicorn classify_server:app, cwd = pysvc, bound where config.proxy.host
// says (net.serviceHosts). opts = { key }. `spawnFn` is for tests. HF_HOME stays the default
// (the weights cache is shared with anything else on the box that uses Hugging Face).
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
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function get(url, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
    });
}

// Wait for /health = 200, which the service only answers once the model is WARM. Generous: the
// first start downloads ~0.8 GB of weights, then loads them (13.7 s cold on the dev box's CPU).
async function waitForClassify(port, timeoutMs = 10 * 60 * 1000, host = '127.0.0.1') {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if ((await get(`http://${host}:${port}/health`)) === 200) return { up: true };
        await new Promise((r) => setTimeout(r, 1000));
    }
    return { up: false };
}

async function classifyAlive(port, host = '127.0.0.1') {
    return (await get(`http://${host}:${port}/health`)) === 200;
}

module.exports = { ensureClassify, spawnClassify, waitForClassify, classifyAlive, depsSignature, LAYA_VERSION };
