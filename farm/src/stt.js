// STT orchestration — speech to text on the farm as ONE shared "lol-stt" service (docs/ECOSYSTEM_PLAN.md
// v2 §3.3). The Computer's Sound box, in Listen mode, reads `stt` (url + key) from the beacon snapshot
// and sends a recording by the OpenAI transcription contract; the farm answers with its words and
// keeps nothing. Mirrors classify.js: the service source is COMMITTED (farm/src/pysvc/stt_server.py);
// `ensureStt` only builds a venv + pip-installs faster-whisper — the same library and version Open
// WebUI uses on the client (MIT code and weights), CPU int8, NO torch (a ~0.3 GB venv).
//
// OFF by default. The model (`stt.model`, default "small" ≈ 0.5 GB: 2.1 s for a 7.4 s clip on the dev
// box's CPU; "base" ≈ 0.15 GB is ~4× faster and rougher) downloads at the first start.
// Confucius4-R2T2 (streaming, GPU, Linux/vLLM, a NetEase weight licence) is NOT installed here: an
// operator who wants it runs it themselves once its licence is read (plan v2 §3.3).
//
// `rm -rf farm/.stt` is a full uninstall. Auxiliary: any failure warns and the farm still comes up.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync, spawn } = require('child_process');
const log = require('./log');
const { serviceHosts } = require('./net');
const { resolvePython } = require('./python');

const IS_WIN = process.platform === 'win32';
const ROOT = path.join(__dirname, '..', '.stt');        // farm/.stt
const VENV = path.join(ROOT, 'venv');
const PYSVC = path.join(__dirname, 'pysvc');
const MARKER = path.join(ROOT, '.installed');

// Pinned to the faster-whisper Open WebUI 0.10.2 and 0.11.4 both pin.
const FW_VERSION = '1.2.1';
const DEPS = [`faster-whisper==${FW_VERSION}`, 'fastapi', 'uvicorn', 'python-multipart'];

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
    return `v1|faster-whisper=${FW_VERSION}`;
}

function installed() {
    return fs.existsSync(venvPython()) && readTrim(MARKER) === depsSignature();
}

// Idempotent setup. Returns true when ready to spawn; false (warned) when the farm should come up
// WITHOUT speech to text.
async function ensureStt() {
    if (installed()) return true;
    const py = findPython();
    if (!py) {
        log.warn('No Python 3.10–3.13 found — cannot install speech to text (needs its own venv).');
        return false;
    }
    try {
        fs.mkdirSync(ROOT, { recursive: true });
        if (!fs.existsSync(venvPython())) {
            log.step(`Creating the speech-to-text venv with ${log.paint.bold(py.version)} …`);
            sh(`${py.cmd} -m venv "${VENV}"`);
        }
        const vpy = venvPython();
        sh(`"${vpy}" -m pip install -q -U pip`);
        log.step(`Installing faster-whisper ${FW_VERSION} (CPU, no torch) …`);
        sh(`"${vpy}" -m pip install -q ${DEPS.join(' ')}`);
        fs.writeFileSync(MARKER, depsSignature() + '\n', 'utf8');
        log.ok(`Speech to text installed → ${log.paint.grey(ROOT)} (the model downloads at its first start)`);
        return true;
    } catch (e) {
        log.warn(`Speech-to-text install failed (${e.message}) — the farm will run WITHOUT it.`);
        log.info(`  Retry: delete ${ROOT} and re-run \`lol up\`.`);
        return false;
    }
}

// Spawn <venv python> -m uvicorn stt_server:app, cwd = pysvc, bound where config.proxy.host says
// (net.serviceHosts). opts = { key }. `spawnFn` is for tests.
function spawnStt(config, opts, spawnFn = spawn) {
    const bind = serviceHosts(config.proxy && config.proxy.host).bind;
    return spawnFn(venvPython(), ['-m', 'uvicorn', 'stt_server:app', '--host', bind, '--port', String(config.stt.port), '--no-access-log'], {
        cwd: PYSVC,
        windowsHide: true,
        detached: !IS_WIN,
        env: {
            ...process.env,
            PYTHONPATH: PYSVC,
            STT_API_KEY: opts.key,
            STT_MODEL: String(config.stt.model),
            STT_THREADS: String(config.stt.threads),
            STT_MAX_MB: String(config.stt.maxMb),
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

// Wait for /health = 200 (the model is loaded). Generous: the first start downloads it.
async function waitForStt(port, timeoutMs = 10 * 60 * 1000, host = '127.0.0.1') {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if ((await get(`http://${host}:${port}/health`)) === 200) return { up: true };
        await new Promise((r) => setTimeout(r, 1000));
    }
    return { up: false };
}

async function sttAlive(port, host = '127.0.0.1') {
    return (await get(`http://${host}:${port}/health`)) === 200;
}

module.exports = { ensureStt, spawnStt, waitForStt, sttAlive, depsSignature, FW_VERSION };
