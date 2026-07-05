// Kokoro-82M TTS orchestration — ONE shared neural text-to-speech server on the
// farm box, so every OWUI client gets high-quality read-aloud / voice-call output
// with zero client setup (the client reads `ttsUrl`/`ttsVoice`/`ttsModel` from the
// beacon and sets OWUI's AUDIO_TTS_* env). Mirrors the SearXNG subsystem.
//
// Recipe (proven live on native Windows + the Blackwell GPU, 2026-07-02):
//   • Kokoro-FastAPI (github.com/remsky/Kokoro-FastAPI) pinned to a tag, run from a
//     source tarball via `<venv python> -m uvicorn api.src.main:app` — it already
//     serves an OpenAI-compatible /v1/audio/speech. (No Docker, no `uv`.)
//   • GPU-AGNOSTIC: `torch==2.8.0+cu128` carries BOTH Ada (sm_89: 4070/4090) AND
//     Blackwell (sm_120) kernels, so one wheel covers the whole fleet; a box with
//     no NVIDIA GPU gets the CPU torch wheel. USE_GPU is set from a post-install
//     `torch.cuda.is_available()` check (driver too old → falls back to CPU).
//   • espeak-ng needs NO native install: the `espeakng-loader` pip dep ships the
//     shared library; we point PHONEMIZER_ESPEAK_LIBRARY at it.
//   • Model weights (~312MB .pth) download from the stable v0.1.4 release asset;
//     the ~67 voices ship inside the tarball.
// `rm -rf farm/.kokoro` is a full uninstall. Auxiliary: any failure warns and the
// farm still comes up without TTS.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync, spawn } = require('child_process');
const log = require('./log');

// Bump deliberately: change the tag and re-run `lol up` — the next run re-fetches
// + reinstalls automatically (guarded by the .src-tag / .installed-tag markers).
const PINNED_TAG = 'v0.5.0';
const REPO_URL = 'https://github.com/remsky/Kokoro-FastAPI';
// Model weights live on a stable older release asset (reused across versions).
const MODEL_URL = 'https://github.com/remsky/Kokoro-FastAPI/releases/download/v0.1.4/kokoro-v1_0.pth';

const IS_WIN = process.platform === 'win32';
const ROOT = path.join(__dirname, '..', '.kokoro');
const SRC = path.join(ROOT, 'src');
const VENV = path.join(ROOT, 'venv');
const MODEL_PTH = path.join(SRC, 'api', 'src', 'models', 'v1_0', 'kokoro-v1_0.pth');
const TAG_FILE = path.join(ROOT, '.installed-tag'); // tag actually pip-installed
const SRC_TAG_FILE = path.join(ROOT, '.src-tag');   // tag actually extracted in src/
const BACKEND_FILE = path.join(ROOT, '.backend');   // 'gpu' | 'cpu' chosen at install

function venvPython() {
    return IS_WIN ? path.join(VENV, 'Scripts', 'python.exe') : path.join(VENV, 'bin', 'python');
}
function sh(cmd, opts = {}) { execSync(cmd, { stdio: 'inherit', ...opts }); }
function shCapture(cmd) {
    try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch { return null; }
}
function readTrim(p) { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; } }

// Kokoro pins requires-python >=3.10; kokoro 0.9.4 dislikes 3.13 — prefer 3.12.
function findPython() {
    const candidates = IS_WIN
        ? ['py -3.12', 'py -3.11', 'py -3.10', 'python', 'python3']
        : ['python3.12', 'python3.11', 'python3.10', 'python3', 'python'];
    for (const c of candidates) {
        const v = shCapture(`${c} --version`);
        if (v && /Python 3\.(10|11|12)\b/.test(v)) return { cmd: c, version: v };
    }
    return null;
}

// Is an NVIDIA GPU present? (picks the cu128 torch wheel; else CPU torch.)
function gpuPresent() {
    const out = shCapture('nvidia-smi -L');
    return !!out && /GPU \d+:/.test(out);
}

async function download(url, dest) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// Installed AND matching the pin: venv + source + model all present, and what was
// installed is exactly PINNED_TAG.
function installed() {
    return fs.existsSync(venvPython())
        && fs.existsSync(path.join(SRC, 'api', 'src', 'main.py'))
        && fs.existsSync(MODEL_PTH)
        && readTrim(TAG_FILE) === PINNED_TAG;
}

// The GPU/CPU backend for the CURRENT hardware: a real cuda.is_available() check
// (against the installed torch) when an NVIDIA GPU is present, else CPU. Cheap
// enough to run every `lol up` so a driver change self-heals.
function currentBackend() {
    if (!gpuPresent()) return 'cpu';
    const avail = shCapture(`"${venvPython()}" -c "import torch;print(torch.cuda.is_available())"`);
    return avail === 'True' ? 'gpu' : 'cpu';
}

// Idempotent setup: source tarball (pinned tag) + venv + torch (gpu/cpu) + the
// Kokoro stack + model weights. Returns true when ready to spawn; false (warned)
// when the farm should come up WITHOUT TTS.
async function ensureKokoro() {
    if (installed()) {
        // Re-verify GPU/CPU each run — a box that lost CUDA (driver update/rollback)
        // falls back to CPU instead of USE_GPU=true hard-failing synthesis.
        const b = currentBackend();
        if (b !== readTrim(BACKEND_FILE)) {
            fs.writeFileSync(BACKEND_FILE, b + '\n', 'utf8');
            log.info(`Kokoro backend updated → ${b.toUpperCase()} (hardware/driver changed).`);
        }
        return true;
    }

    const py = findPython();
    if (!py) {
        log.warn('No Python 3.10–3.12 found — cannot install Kokoro TTS (needs its own venv).');
        return false;
    }

    try {
        // 1. Source at the pinned tag (tarball, like SearXNG — no git prereq). Guard
        //    re-extract on the recorded src tag so bumping PINNED_TAG re-fetches.
        if (!fs.existsSync(path.join(SRC, 'api', 'src', 'main.py')) || readTrim(SRC_TAG_FILE) !== PINNED_TAG) {
            log.step(`Downloading Kokoro-FastAPI ${PINNED_TAG} …`);
            fs.rmSync(SRC, { recursive: true, force: true });
            fs.mkdirSync(SRC, { recursive: true });
            const tarball = path.join(ROOT, 'kokoro-src.tar.gz');
            await download(`${REPO_URL}/archive/refs/tags/${PINNED_TAG}.tar.gz`, tarball);
            sh('tar -xzf kokoro-src.tar.gz -C src --strip-components=1', { cwd: ROOT });
            fs.rmSync(tarball, { force: true });
            if (!fs.existsSync(path.join(SRC, 'api', 'src', 'main.py'))) throw new Error('extraction produced no api/src/main.py');
            fs.writeFileSync(SRC_TAG_FILE, PINNED_TAG + '\n', 'utf8');
        }

        // 2. Own venv (never the farm/.venv — torch is huge + version-specific).
        if (!fs.existsSync(venvPython())) {
            log.step(`Creating Kokoro venv with ${log.paint.bold(py.version)} …`);
            sh(`${py.cmd} -m venv "${VENV}"`);
        }
        const vpy = venvPython();
        sh(`"${vpy}" -m pip install -q -U pip`);

        // 3. torch — cu128 (Ada+Blackwell) when an NVIDIA GPU is present, else CPU.
        //    torch lives only in Kokoro's *extras*, so we install it explicitly from
        //    the right PyTorch index, then the app (base deps) sees it satisfied.
        const gpu = gpuPresent();
        if (gpu) {
            log.step('Installing PyTorch (CUDA cu128 — Ada + Blackwell; multi-GB) …');
            sh(`"${vpy}" -m pip install -q "torch==2.8.0+cu128" --index-url https://download.pytorch.org/whl/cu128`);
        } else {
            log.step('No NVIDIA GPU — installing CPU PyTorch …');
            sh(`"${vpy}" -m pip install -q "torch==2.8.0" --index-url https://download.pytorch.org/whl/cpu`);
        }

        // 4. The Kokoro stack (fastapi/uvicorn/kokoro/misaki/espeakng-loader/spacy +
        //    en-core-web-sm URL wheel — all base deps, torch already satisfied).
        log.step('Installing the Kokoro TTS stack (a few minutes) …');
        sh(`"${vpy}" -m pip install -q -e "${SRC}"`, { cwd: SRC });

        // 5. Model weights (~312MB) — voices already ship in the tarball.
        if (!fs.existsSync(MODEL_PTH)) {
            log.step('Downloading the Kokoro voice model (~312MB) …');
            await download(MODEL_URL, MODEL_PTH);
        }

        // 6. Confirm CUDA actually engages (driver may be too old for cu128) → pick
        //    the runtime backend. GPU-torch still runs on CPU with USE_GPU=false.
        const backend = currentBackend();
        if (gpu && backend === 'cpu') log.warn('NVIDIA GPU present but CUDA 12.8 unavailable (driver too old?) — Kokoro will run on CPU.');
        fs.writeFileSync(BACKEND_FILE, backend + '\n', 'utf8');
        fs.writeFileSync(TAG_FILE, PINNED_TAG + '\n', 'utf8');
        log.ok(`Kokoro TTS installed → ${log.paint.grey(ROOT)} (${backend.toUpperCase()})`);
        return true;
    } catch (e) {
        log.warn(`Kokoro install failed (${e.message}) — the farm will run WITHOUT voice output.`);
        log.info(`  Retry: delete ${ROOT} and re-run \`lol up\`.`);
        return false;
    }
}

// The bundled espeak-ng shared library path (so NO native eSpeak-NG install is
// needed). Resolved from the venv's espeakng-loader; '' if unavailable.
function espeakLibrary() {
    return shCapture(`"${venvPython()}" -c "import espeakng_loader,sys;sys.stdout.write(espeakng_loader.get_library_path())"`) || '';
}

// Spawn the server: <venv python> -m uvicorn api.src.main:app. Replicates upstream
// start-gpu.ps1's env (relative MODEL_DIR/VOICES_DIR resolve against api/), but
// points espeak at the bundled DLL and drops the `uv run` wrapper.
function spawnKokoro(config) {
    const backend = readTrim(BACKEND_FILE) || 'cpu';
    const esp = espeakLibrary();
    const child = spawn(venvPython(), ['-m', 'uvicorn', 'api.src.main:app', '--host', '0.0.0.0', '--port', String(config.tts.port)], {
        cwd: SRC,
        windowsHide: true,
        detached: !IS_WIN,
        env: {
            ...process.env,
            USE_GPU: backend === 'gpu' ? 'true' : 'false',
            USE_ONNX: 'false',
            // Kokoro-FastAPI defaults to DEBUG (per-request path scans + audio-chunk
            // shapes → a wall of log lines). A shared voice server doesn't need that;
            // WARNING keeps the [kokoro] prefix quiet (errors still surface).
            API_LOG_LEVEL: 'WARNING',
            PROJECT_ROOT: SRC,
            PYTHONPATH: `${SRC}${path.delimiter}${path.join(SRC, 'api')}`,
            MODEL_DIR: 'src/models',
            VOICES_DIR: 'src/voices/v1_0',
            WEB_PLAYER_PATH: path.join(SRC, 'web'),
            ...(esp ? { PHONEMIZER_ESPEAK_LIBRARY: esp } : {}),
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return child;
}

function get(url, timeoutMs = 4000) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
    });
}

// POST a tiny synthesis and confirm we get real (non-empty) audio back — proves the
// model loaded, voices are present, and espeak resolved. Resolves bytes or 0.
function synthProbe(port, voice, timeoutMs = 60000) {
    return new Promise((resolve) => {
        const body = Buffer.from(JSON.stringify({ model: 'kokoro', input: 'ok', voice: voice || 'af_heart', response_format: 'mp3' }));
        const req = http.request({
            method: 'POST', hostname: '127.0.0.1', port, path: '/v1/audio/speech', timeout: timeoutMs,
            headers: { 'content-type': 'application/json', 'content-length': body.length },
        }, (res) => {
            let n = 0;
            res.on('data', (c) => { n += c.length; });
            res.on('end', () => resolve(res.statusCode === 200 ? n : 0));
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(0));
        req.write(body); req.end();
    });
}

// Wait for /health, then a real synthesis. Generous timeout — model warmup is slow
// (esp. on CPU). Returns { up, synthOk }.
async function waitForKokoro(port, voice, timeoutMs = 120000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if ((await get(`http://127.0.0.1:${port}/health`)) === 200) {
            const bytes = await synthProbe(port, voice);
            return { up: true, synthOk: bytes > 0 };
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    return { up: false, synthOk: false };
}

// Single quick liveness probe (for the farm's health timer).
async function kokoroAlive(port) {
    return (await get(`http://127.0.0.1:${port}/health`)) === 200;
}

module.exports = { ensureKokoro, spawnKokoro, waitForKokoro, kokoroAlive, PINNED_TAG };
