// STT orchestration — speech to text on the farm as ONE shared "lol-stt" service (docs/ECOSYSTEM_PLAN.md
// v2 §3.3). Two clients read `stt` (url + key + model) from the beacon snapshot and send a recording by the
// OpenAI transcription contract: the Computer's Sound box in Listen mode, and (2026-10-09) Open WebUI on each
// laptop, whose microphone and Call mode then transcribe here instead of on the laptop's CPU (shell
// configBridge.ts). The farm answers with the words and keeps nothing. Mirrors classify.js: the service source
// is COMMITTED (farm/src/pysvc/stt_server.py); `ensureStt` only builds a venv + pip-installs faster-whisper —
// the same library and version Open WebUI uses on the client (MIT code and weights). NO torch.
//
// GPU or CPU (owner, 2026-10-09): `stt.device` 'auto' (the default) = the NVIDIA GPU when this computer has one
// and CTranslate2 ships CUDA for it (Windows and Linux x64; a DGX Spark's arm64 wheel is CPU only), else the CPU.
// On the GPU the default model is Whisper large-v3-turbo, int8 weights with float16 math (~1.6 GB download, RESERVE_GIB of the GPU);
// on the CPU it is "small" in int8 (~0.5 GB). Measured on the RTX PRO 6000, 2026-10-09: docs/DEVLOG.md.
// The CUDA libraries come as pip wheels into the venv (cuBLAS; cuDNN too on Linux), never a system install, and
// the service falls back to the CPU model by itself when the GPU does not load (/health says why).
//
// OFF by default. The model downloads at the first start into farm/.stt/models, so `rm -rf farm/.stt` is a full
// uninstall. Confucius4-R2T2 (streaming, GPU, Linux/vLLM, a NetEase weight licence) is NOT installed here: an
// operator who wants it runs it themselves once its licence is read (plan v2 §3.3).
// Auxiliary: any failure warns and the farm still comes up.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const log = require('./log');
const { serviceHosts } = require('./net');
const { resolvePython } = require('./python');

const IS_WIN = process.platform === 'win32';
const ROOT = path.join(__dirname, '..', '.stt');        // farm/.stt
const VENV = path.join(ROOT, 'venv');
const PYSVC = path.join(__dirname, 'pysvc');
const MARKER = path.join(ROOT, '.installed');
const MODELS_DIR = path.join(ROOT, 'models');   // faster-whisper's download_root (a Hugging Face cache layout)

// Pinned to what Open WebUI 0.11.4's sidecar runs: faster-whisper 1.2.1, CTranslate2 4.8.2 (CUDA 12) and PyAV 18.1.0.
// PyAV 19 dropped the `metadata_errors` argument faster-whisper 1.2.1 passes: an unpinned install from 2026-10 on
// refused every recording ("could not read the audio").
const FW_VERSION = '1.2.1';
const CT2_VERSION = '4.8.2';
const AV_VERSION = '18.1.0';
const DEPS = [`faster-whisper==${FW_VERSION}`, `ctranslate2==${CT2_VERSION}`, `av==${AV_VERSION}`, 'fastapi', 'uvicorn', 'python-multipart'];
// The CUDA 12 libraries CTranslate2 loads, as pip wheels in the venv. On Windows its wheel carries cuDNN's loader and
// Whisper ran on the GPU with cuBLAS alone (2026-10-09); on Linux it links libcudnn 9 too (faster-whisper's README).
const CUDA_DEPS = {
    win32: ['nvidia-cublas-cu12==12.9.2.10'],
    linux: ['nvidia-cublas-cu12==12.9.2.10', 'nvidia-cudnn-cu12==9.27.0.42'],
};
// The model and number format per device when `stt.model` / `stt.device` say 'auto'.
const MODELS = { cuda: 'large-v3-turbo', cpu: 'small' };
const COMPUTE = { cuda: 'int8_float16', cpu: 'int8' };   // int8_float16: float16's speed and words in 1.7 GB, not 2.7 (measured)
// GPU memory the service holds with large-v3-turbo in int8_float16 while it transcribes (1.7 GB at its peak on a 30 s clip, RTX PRO 6000, 2026-10-09), rounded up.
// vLLM's Automatic memory keeps it free while speech to text is on but not running yet (up.js), as for document search.
const RESERVE_GIB = 2;

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

// Can this computer run it on the GPU: an NVIDIA GPU nvidia-smi names (systemInfo.detectHardware) on a platform
// CTranslate2 ships CUDA for.
function cudaPossible(hw, platform = process.platform, arch = process.arch) {
    return !!(hw && hw.gpu && hw.gpu !== 'Unknown GPU') && !!CUDA_DEPS[platform] && arch === 'x64';
}
// 'auto' → a device and a model, once at boot (up.js), in memory only (the file keeps 'auto'), as embed.js does.
function resolveStt(config, hw, platform = process.platform, arch = process.arch) {
    const s = config.stt;
    if (s.device === 'auto') s.device = cudaPossible(hw, platform, arch) ? 'cuda' : 'cpu';
    if (s.model === 'auto') s.model = MODELS[s.device] || MODELS.cpu;
    return s;
}
const onGpu = (config) => config.stt.device === 'cuda';
// What vLLM's Automatic memory keeps for it while it is on but not running yet (up.js).
function reserveGib(config) {
    return config.stt && config.stt.enabled && onGpu(config) ? RESERVE_GIB : 0;
}

/** What SHOULD be installed; a change reinstalls on the next `lol up`. */
function depsSignature(device = 'cpu', platform = process.platform) {
    const cuda = device === 'cuda' && CUDA_DEPS[platform] ? `|cuda=${CUDA_DEPS[platform].join(',')}` : '';
    return `v2|faster-whisper=${FW_VERSION}|ctranslate2=${CT2_VERSION}|av=${AV_VERSION}${cuda}`;
}

function installed(device = 'cpu') {
    return fs.existsSync(venvPython()) && readTrim(MARKER) === depsSignature(device);
}

// The model is on disk (download_root's Hugging Face layout: models--<org>--faster-whisper-<name>/snapshots/*/model.bin).
function modelOnDisk(model, root = MODELS_DIR) {
    let dirs = [];
    try { dirs = fs.readdirSync(root).filter((d) => d.endsWith(`--faster-whisper-${model}`)); } catch { return false; }
    return dirs.some((d) => {
        const snaps = path.join(root, d, 'snapshots');
        try { return fs.readdirSync(snaps).some((r) => fs.existsSync(path.join(snaps, r, 'model.bin'))); } catch { return false; }
    });
}
// Everything on disk for a GPU start: a boot then starts it BEFORE the engine sizes its memory (registry `early`), as
// document search. On the CPU, or with a download ahead, it starts once the farm is public.
function ready(config) {
    return onGpu(config) && installed('cuda') && modelOnDisk(config.stt.model);
}

// Where the venv's CUDA wheels put their libraries: added to the DLL search (Windows) or LD_LIBRARY_PATH (Linux).
function cudaLibDirs(venv = VENV, platform = process.platform) {
    const names = ['cublas', 'cudnn'];
    if (platform === 'win32') {
        return names.map((n) => path.join(venv, 'Lib', 'site-packages', 'nvidia', n, 'bin')).filter((d) => fs.existsSync(d));
    }
    let pys = [];
    try { pys = fs.readdirSync(path.join(venv, 'lib')).filter((d) => /^python3/.test(d)); } catch { return []; }
    return pys.flatMap((py) => names.map((n) => path.join(venv, 'lib', py, 'site-packages', 'nvidia', n, 'lib'))).filter((d) => fs.existsSync(d));
}

// Idempotent setup. Returns true when ready to spawn; false (warned) when the farm should come up
// WITHOUT speech to text.
async function ensureStt(config) {
    const device = config.stt.device;
    if (installed(device)) return true;
    const py = findPython();
    if (!py) {
        log.warn('No Python 3.10–3.13 found — cannot install speech to text (needs its own venv).');
        return false;
    }
    try {
        fs.mkdirSync(ROOT, { recursive: true });
        if (!fs.existsSync(venvPython())) {
            log.step(`Creating the speech-to-text venv with ${log.paint.bold(py.version)} …`);
            await sh(`${py.cmd} -m venv "${VENV}"`);
        }
        const vpy = venvPython();
        await sh(`"${vpy}" -m pip install -q -U pip`);
        const cuda = device === 'cuda' ? CUDA_DEPS[process.platform] || [] : [];
        log.step(`Installing faster-whisper ${FW_VERSION} (${cuda.length ? 'with the CUDA libraries for the GPU, ~1 GB' : 'CPU'}, no torch) …`);
        await sh(`"${vpy}" -m pip install -q ${[...DEPS, ...cuda].join(' ')}`);
        fs.writeFileSync(MARKER, depsSignature(device) + '\n', 'utf8');
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
    const s = config.stt;
    const device = onGpu(config) ? 'cuda' : 'cpu';
    const libs = device === 'cuda' ? cudaLibDirs() : [];
    return spawnFn(venvPython(), ['-m', 'uvicorn', 'stt_server:app', '--host', bind, '--port', String(config.stt.port), '--no-access-log'], {
        cwd: PYSVC,
        windowsHide: true,
        detached: !IS_WIN,
        env: {
            ...process.env,
            PYTHONPATH: PYSVC,
            STT_API_KEY: opts.key,
            STT_DEVICE: device,
            STT_MODEL: String(s.model),
            STT_COMPUTE: COMPUTE[device],
            STT_CPU_MODEL: MODELS.cpu,           // what it loads when the GPU does not
            STT_MODELS_DIR: MODELS_DIR,
            STT_CUDA_LIBS: libs.join(path.delimiter),
            ...(libs.length && !IS_WIN ? { LD_LIBRARY_PATH: [...libs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : {}),
            STT_THREADS: String(s.threads),
            STT_MAX_MB: String(s.maxMb),
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

// What /health says it runs: { device, model, fallback } (fallback = why the GPU did not load, or null).
function healthInfo(r) {
    try {
        const b = JSON.parse(r.body);
        return { device: b.device || null, model: b.model || null, fallback: b.fallback || null };
    } catch { return { device: null, model: null, fallback: null }; }
}

// Wait for /health = 200 (the model is loaded). Generous: the first start downloads it.
// `isDead` (the registry's "the child exited") and a load error both end the wait early.
async function waitForStt(port, timeoutMs = 10 * 60 * 1000, host = '127.0.0.1', isDead = () => false) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (isDead()) return { up: false };
        const r = await get(`http://${host}:${port}/health`);
        if (r && r.status === 200) return { up: true, ...healthInfo(r) };
        const error = loadError(r);
        if (error) return { up: false, error };
        await new Promise((res) => setTimeout(res, 1000));
    }
    return { up: false };
}

async function sttAlive(port, host = '127.0.0.1') {
    const r = await get(`http://${host}:${port}/health`);
    return !!(r && r.status === 200);
}

module.exports = {
    loadError, healthInfo, ensureStt, spawnStt, waitForStt, sttAlive, depsSignature, FW_VERSION, AV_VERSION, CUDA_DEPS, MODELS,
    RESERVE_GIB, cudaPossible, resolveStt, reserveGib, modelOnDisk, ready, cudaLibDirs, MODELS_DIR,
};
