// OCR / document-extraction orchestration — ONE shared "lol-extract" service on
// the farm box, so every OWUI client on the LAN gets scanned-document + image OCR
// with zero client setup. The client reads `extract` (url + key) from the beacon
// snapshot and points OWUI's CONTENT_EXTRACTION_ENGINE=external +
// EXTERNAL_DOCUMENT_LOADER_URL at it. Mirrors the SearXNG / Kokoro subsystems.
//
// The service source is COMMITTED at farm/src/pysvc/ (server.py + the vendored
// Ollama-OCR ocr_processor.py) — unlike SearXNG/Kokoro there's nothing to download;
// `ensureExtract` only builds a venv + pip-installs the deps. It's a small FastAPI
// that implements OWUI's verified External Document Loader contract (PUT /process,
// raw bytes → JSON page list) and routes images / scanned PDFs to a vision model on
// the farm's local Ollama (via the vendored OCRProcessor), born-digital docs to
// fast text extraction, and — when `ocr.docling:true` — office docs to Docling.
//
// `rm -rf farm/.extract` is a full uninstall. Auxiliary: any failure warns and the
// farm still comes up without OCR.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const log = require('./log');
const { serviceHosts } = require('./net');
const { resolvePython } = require('./python');

const IS_WIN = process.platform === 'win32';
const ROOT = path.join(__dirname, '..', '.extract');   // farm/.extract
const VENV = path.join(ROOT, 'venv');
const PYSVC = path.join(__dirname, 'pysvc');            // committed service source
const WORK = path.join(ROOT, 'work');                  // where the service works on an upload (clearWork)
const MARKER = path.join(ROOT, '.installed');          // records the installed deps signature

// Light, torch-free base deps (server.py + the vendored OCRProcessor). Docling is
// added on top ONLY when enabled — it pulls torch + OCR/layout models (multi-GB),
// which is why it's off by default (same rationale as TTS).
const BASE_DEPS = ['fastapi', 'uvicorn', 'requests', 'pymupdf', 'opencv-python-headless', 'numpy', 'python-docx', 'python-pptx', 'openpyxl', 'tqdm'];

function venvPython() {
    return IS_WIN ? path.join(VENV, 'Scripts', 'python.exe') : path.join(VENV, 'bin', 'python');
}
// Async (a spawned shell, awaited), as classify.js: Enable in the Plugins card and a preset's Apply run the install
// inside `lol up` (Docling's is multi-GB), so it must never freeze the seat gate, the beacon and the panel (review 2026-11-05).
function sh(cmd, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, { shell: true, stdio: 'inherit', windowsHide: true, ...opts });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd.split(' ')[0]} exited with ${code}`))));
    });
}
function readTrim(p) { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; } }

// Same Python ladder as the LiteLLM / SearXNG venvs. Honors $LOL_PYTHON (the Farm
// app's bundled interpreter) via the shared resolver.
function findPython() {
    const candidates = IS_WIN
        ? ['py -3.12', 'py -3.11', 'py -3', 'python', 'python3']
        : ['python3.12', 'python3.11', 'python3', 'python'];
    return resolvePython(candidates, (v) => /Python 3\.(10|11|12|13)\b/.test(v));
}

// A signature of what SHOULD be installed. Changing the docling flag changes it, so
// toggling ocr.docling triggers a reinstall on the next `lol up`.
function depsSignature(config) {
    // Bump the version when BASE_DEPS changes so existing installs reinstall.
    return `v2|docling=${config.ocr && config.ocr.docling ? 1 : 0}`;
}

// Installed AND matching the wanted deps (venv exists + the marker equals the
// current signature). A docling toggle invalidates the marker → reinstall.
function installed(config) {
    return fs.existsSync(venvPython()) && readTrim(MARKER) === depsSignature(config);
}

// Idempotent setup: own venv + pip install the deps (+docling when enabled).
// Returns true when ready to spawn; false (warned) when the farm should come up
// WITHOUT OCR (missing python / install failure).
async function ensureExtract(config) {
    if (installed(config)) return true;

    const py = findPython();
    if (!py) {
        log.warn('No Python 3.10–3.13 found — cannot install the OCR service (needs its own venv).');
        return false;
    }

    try {
        fs.mkdirSync(ROOT, { recursive: true });
        if (!fs.existsSync(venvPython())) {
            log.step(`Creating OCR venv with ${log.paint.bold(py.version)} …`);
            await sh(`${py.cmd} -m venv "${VENV}"`);
        }
        const vpy = venvPython();
        await sh(`"${vpy}" -m pip install -q -U pip`);
        log.step('Installing the OCR service deps …');
        await sh(`"${vpy}" -m pip install -q ${BASE_DEPS.join(' ')}`);
        if (config.ocr && config.ocr.docling) {
            log.step('Installing Docling (torch + OCR/layout models; multi-GB, first run only) …');
            await sh(`"${vpy}" -m pip install -q docling`);
        }
        fs.writeFileSync(MARKER, depsSignature(config) + '\n', 'utf8');
        log.ok(`OCR service installed → ${log.paint.grey(ROOT)}`);
        return true;
    } catch (e) {
        log.warn(`OCR service install failed (${e.message}) — the farm will run WITHOUT document OCR.`);
        log.info(`  Retry: turn it off and on again in the admin panel's Plugins card (or restart the farm). If it fails again, delete ${ROOT} first.`);
        return false;
    }
}

// Spawn the service: <venv python> -m uvicorn server:app, cwd = pysvc source (so
// `import ocr_processor` resolves), bound where config.proxy.host says (the LAN on a
// shared farm, loopback on a private one — net.serviceHosts). opts = { key, model,
// ollamaUrl }. `spawnFn` is for tests.
// The service writes each upload and its page images under WORK and removes them when it is done, in a Python
// `finally` that a hard kill skips (`lol down`, the plugin switch, a preset, a crash). The farm keeps no document: so
// WORK is emptied at every start and stop, and at a start the `lolocr_*` folders older versions left in the temp
// folder go too (review 2026-11-05, LOG-2). A file still held goes at the next start.
function clearWork({ tempToo = false } = {}) {
    const drop = (d) => { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* next start */ } };
    drop(WORK);
    if (!tempToo) return;
    let names = [];
    try { names = fs.readdirSync(os.tmpdir()); } catch { /* no temp folder to read: nothing to sweep */ }
    for (const n of names) if (n.startsWith('lolocr_')) drop(path.join(os.tmpdir(), n));
}

function spawnExtract(config, opts, spawnFn = spawn) {
    clearWork({ tempToo: true });
    fs.mkdirSync(WORK, { recursive: true });
    const bind = serviceHosts(config.proxy && config.proxy.host).bind;
    const child = spawnFn(venvPython(), ['-m', 'uvicorn', 'server:app', '--host', bind, '--port', String(config.ocr.port)], {
        cwd: PYSVC,
        windowsHide: true,
        detached: !IS_WIN,
        env: {
            ...process.env,
            PYTHONPATH: PYSVC,
            EXTRACT_API_KEY: opts.key,
            EXTRACT_PORT: String(config.ocr.port),
            OCR_WORKDIR: WORK,
            OCR_MODEL: opts.model || '',
            OCR_OLLAMA_URL: opts.ollamaUrl,
            OCR_FORMAT: config.ocr.format,
            OCR_PDF_ENGINE: config.ocr.pdfEngine,
            OCR_PREPROCESS: config.ocr.preprocess ? '1' : '0',
            OCR_DOCLING: config.ocr.docling ? '1' : '0',
            // Same cp1252 crash-guard as the other Python spawns (Windows consoles).
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return child;
}

function get(url, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
    });
}

// Wait for /health. Generous timeout — the first run may still be importing the
// (heavy) deps. Returns { up }.
async function waitForExtract(port, timeoutMs = 90000, host = '127.0.0.1') {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if ((await get(`http://${host}:${port}/health`)) === 200) return { up: true };
        await new Promise((r) => setTimeout(r, 1000));
    }
    return { up: false };
}

// Single quick liveness probe (for the farm's health timer).
async function extractAlive(port, host = '127.0.0.1') {
    return (await get(`http://${host}:${port}/health`)) === 200;
}

module.exports = { ensureExtract, spawnExtract, waitForExtract, extractAlive, depsSignature, installed, clearWork, WORK };
