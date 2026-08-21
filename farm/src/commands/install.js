// `lol install` — one-time bootstrap for a fresh pull on a GPU box.
//
// `lol up` orchestrates Ollama + LiteLLM but assumes both are already installed.
// This command does the install half so a fresh checkout is: `lol install` then
// `lol up`. Idempotent — anything already present is detected and skipped.
//
// Steps:
//   1. Ensure a lol.config.json exists (scaffold defaults if not).
//   2. Ensure Ollama is installed (winget / brew / official script per-OS).
//   3. Create a local Python .venv and pip-install litellm[proxy] (so the farm's
//      proxy needs no system Python pollution; proc.js auto-uses this venv).
//   4. Pull the configured models on the local Ollama (best-effort; `lol up`
//      pulls anything still missing on first run).
//
// External tools are invoked through the shell (execSync) so Windows resolves
// .exe/.cmd via PATHEXT; model pulls go over Ollama's HTTP API (no CLI needed).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');
const log = require('../log');
const ollama = require('../ollama');
const { venvLitellmPath } = require('../proc');
const { resolvePython } = require('../python');
const {
    CONFIG_FILENAME, defaultConfig, writeConfig, loadConfig, resolveConfigPath, configExists,
} = require('../config');

const FARM_DIR = path.join(__dirname, '..', '..');
const VENV_DIR = path.join(FARM_DIR, '.venv');
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const LOCAL_RX = /^(127\.0\.0\.1|localhost|::1|0\.0\.0\.0)$/i;

// --- tiny shell helpers -----------------------------------------------------

// True if a command resolves on PATH (shell so Windows honors PATHEXT).
function onPath(cmd) {
    try {
        execSync(`${IS_WIN ? 'where' : 'command -v'} ${cmd}`, { stdio: 'ignore' });
        return true;
    } catch { return false; }
}

// Run a shell command, inheriting stdio (so the user sees installer progress).
function sh(cmd, opts = {}) {
    execSync(cmd, { stdio: 'inherit', ...opts });
}

// Capture a command's stdout, or null on failure.
function shCapture(cmd) {
    try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch { return null; }
}

function isLocal(baseUrl) {
    try { return LOCAL_RX.test(new URL(baseUrl).hostname); } catch { return false; }
}

// --- 1. config --------------------------------------------------------------

function ensureConfig() {
    if (configExists()) {
        const { config, path: p } = loadConfig();
        log.ok(`Config: ${log.paint.grey(p)}`);
        return config;
    }
    const config = defaultConfig();
    config.name = `${os.hostname()} Farm`;
    const target = path.join(FARM_DIR, CONFIG_FILENAME);
    writeConfig(target, config);
    log.ok(`Scaffolded ${log.paint.bold(target)} (edit it to add hosts/models, then re-run).`);
    return config;
}

// --- 2. Ollama --------------------------------------------------------------

// Is Ollama present? Either the CLI is on PATH or a local daemon answers.
async function ollamaPresent(config) {
    if (onPath('ollama')) return true;
    const local = config.ollama.hosts.map(ollama.normalizeHost).find(isLocal);
    if (local && (await ollama.version(local))) return true;
    return false;
}

function installOllama() {
    if (IS_WIN) {
        if (onPath('winget')) {
            log.step('Installing Ollama via winget …');
            sh('winget install --id Ollama.Ollama -e --silent --accept-package-agreements --accept-source-agreements');
            return true;
        }
        log.warn('winget not found. Install Ollama from https://ollama.com/download, then re-run `lol install`.');
        return false;
    }
    if (IS_MAC) {
        if (onPath('brew')) {
            log.step('Installing Ollama via Homebrew …');
            sh('brew install ollama');
            return true;
        }
        log.warn('Homebrew not found. Install Ollama from https://ollama.com/download (or `brew install ollama`), then re-run.');
        return false;
    }
    // Linux: the official one-liner (installs the binary + a systemd service where available).
    log.step('Installing Ollama via the official install script …');
    sh('curl -fsSL https://ollama.com/install.sh | sh');
    return true;
}

// --- 3. LiteLLM venv --------------------------------------------------------

// Find a usable Python 3.9–3.13 interpreter command, or null. Honors $LOL_PYTHON
// (the desktop Farm app's bundled interpreter) via the shared resolver.
function findPython() {
    const candidates = IS_WIN
        ? ['py -3.12', 'py -3.11', 'py -3', 'python', 'python3']
        : ['python3.12', 'python3.11', 'python3', 'python'];
    return resolvePython(candidates, (v) => /Python 3\.(9|10|11|12|13)\b/.test(v));
}

function venvPython() {
    return IS_WIN
        ? path.join(VENV_DIR, 'Scripts', 'python.exe')
        : path.join(VENV_DIR, 'bin', 'python');
}

// litellm 1.97.0's proxy imports fastapi's internal `get_flat_dependant`, which fastapi
// REMOVED in 0.140.7 — so an unconstrained install picks a newer fastapi and the proxy
// dies on startup with `ImportError: cannot import name 'get_flat_dependant'` (the farm
// then never comes up).
//
// The bound must stay INSIDE litellm[proxy]'s own declared `fastapi<1.0,>=0.136.3`. An
// earlier attempt used `fastapi<0.116`, which contradicts that floor: pip could not
// satisfy both, backtracked through litellm versions hunting for one that accepted it,
// reached 1.93.0 (source-only on Windows) and tried to COMPILE it → "Rust not found" →
// fresh installs failed outright (rig-hit 2026-08-19). `<0.140.7` is the newest bound
// that satisfies litellm's floor AND keeps the symbol — verified in a clean venv:
// litellm 1.97.0 + fastapi 0.140.6 + starlette 1.6.0, and `import
// litellm.proxy.proxy_server` succeeds with no dependency conflicts.
// Re-derive this bound when bumping litellm.
const FASTAPI_PIN = 'fastapi>=0.136.3,<0.140.7';

function ensureLitellm() {
    if (venvLitellmPath()) {
        // Repair a drifted venv (an older install may have pulled an incompatible fastapi):
        // enforce the pin. Idempotent + fast when already satisfied; best-effort if offline.
        try { sh(`"${venvPython()}" -m pip install "${FASTAPI_PIN}"`); }
        catch { log.warn('Could not verify the LiteLLM fastapi pin (offline?) — proxy may need `lol install` re-run if it fails to start.'); }
        log.ok(`LiteLLM venv ready: ${log.paint.grey(VENV_DIR)}`);
        return true;
    }

    const py = findPython();
    if (!py) {
        log.warn('No Python 3.9–3.13 found. Install Python 3.12 (https://python.org), then re-run `lol install`.');
        log.info('  (Or set litellm.command in lol.config.json to a LiteLLM you installed yourself.)');
        return false;
    }
    log.step(`Creating LiteLLM venv with ${log.paint.bold(py.version)} …`);
    sh(`${py.cmd} -m venv "${VENV_DIR}"`);
    const vpy = venvPython();
    log.step('Installing litellm[proxy] (this can take a minute) …');
    sh(`"${vpy}" -m pip install --upgrade pip`);
    sh(`"${vpy}" -m pip install "litellm[proxy]" "${FASTAPI_PIN}"`);
    if (!venvLitellmPath()) { log.err('LiteLLM did not land in the venv as expected.'); return false; }
    log.ok(`LiteLLM installed → ${log.paint.grey(VENV_DIR)}`);
    return true;
}

// --- 4. pull models ---------------------------------------------------------

// Wait for a local Ollama daemon to answer (the installer usually auto-starts it;
// otherwise spawn one). Returns a reachable local base URL, or null.
async function ensureLocalOllamaUp(config) {
    const local = config.ollama.hosts.map(ollama.normalizeHost).find(isLocal);
    if (!local) return null; // only remote hosts configured — not ours to start
    if (await ollama.version(local)) return local;

    // Give a freshly-installed daemon a moment, then try to start one ourselves.
    log.step('Waiting for the Ollama service to come up …');
    for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        if (await ollama.version(local)) return local;
    }
    try {
        const child = spawn('ollama', ['serve'], { shell: true, detached: !IS_WIN, windowsHide: true, stdio: 'ignore' });
        child.unref();
    } catch { /* CLI not on this process's PATH yet (fresh install) */ }
    for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        if (await ollama.version(local)) return local;
    }
    return null;
}

async function pullModels(config) {
    const local = await ensureLocalOllamaUp(config);
    if (!local) {
        log.warn('Ollama isn\'t reachable yet — skipping the model pull. `lol up` will pull on first run.');
        return;
    }
    const present = await ollama.listModels(local);
    // Served models AND preinstalled ones — `preinstall` exists precisely so a heavy
    // model is on disk and startable by the farm admin without a download, while
    // staying invisible to clients until the admin serves it.
    for (const m of config.models.concat(config.preinstall || [])) {
        // A derived model (see ModelSchema.source) is pulled by its UPSTREAM tag —
        // `m.id` is the local name we create afterwards and does not exist on any
        // registry, so pulling it would 404.
        const upstream = m.source || m.id;
        if (!ollama.hasModel(present, upstream)) {
            log.step(`Pulling ${log.paint.bold(upstream)} (first pull can be slow) …`);
            try {
                let last = '';
                await ollama.pullModel(local, upstream, (s) => {
                    if (s !== last) { last = s; process.stdout.write(`\r${log.paint.grey('[pull]')} ${s}            `); }
                });
                process.stdout.write('\n');
                log.ok(`${upstream} ready.`);
            } catch (e) {
                process.stdout.write('\n');
                log.warn(`Could not pull ${upstream} — ${e.message}. \`lol up\` will retry.`);
                continue;
            }
        } else {
            log.ok(`${upstream} already present.`);
        }

        // Bake in the Modelfile PARAMETERs the upstream pull does not carry — above
        // all draft_num_predict (MTP), worth ~1.8x. `lol up` re-derives on every run
        // to track contextLength; doing it here too means the box is ready to serve
        // at full speed straight after `lol install`, with no first-run penalty.
        if (m.source) {
            const params = Object.assign({ num_ctx: config.ollama.contextLength }, m.params || {});
            try {
                await ollama.createModel(local, m.id, m.source, params);
                const shown = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(' ');
                log.ok(`${log.paint.bold(m.id)} derived from ${m.source} ${log.paint.grey(`(${shown})`)}`);
            } catch (e) {
                log.warn(`Could not derive ${m.id} — ${e.message}. \`lol up\` will retry.`);
            }
        }
    }
}

// --- 5. web search (SearXNG) ------------------------------------------------

// Pre-install the shared SearXNG metasearch when enabled (the default) so the
// first `lol up` starts instantly instead of stalling on a first-run install.
// Idempotent + non-fatal: SearXNG is auxiliary, so a hiccup here just means
// `lol up` retries and the farm still serves chat. TTS is deliberately NOT
// pre-installed here — it's off by default and its torch download is multi-GB;
// `lol up` installs it lazily if an operator turns it on.
async function ensureWebsearch(config) {
    if (!config.websearch || !config.websearch.enabled) {
        log.info('Disabled (set websearch.enabled:true to host shared web search for clients).');
        return;
    }
    try {
        const { ensureSearxng } = require('../searxng');
        const ok = await ensureSearxng();
        if (ok) log.ok('SearXNG ready — every client gets web search, zero setup.');
        else log.warn('Web search not set up yet — `lol up` will retry on first run.');
    } catch (e) {
        log.warn(`Web search setup skipped — ${e.message}. \`lol up\` will retry.`);
    }
}

// --- 6. OCR / document extraction -------------------------------------------

// Pre-install the shared OCR service when enabled (ON by default since 2026-07-05 —
// document upload is a core workshop flow; it reroutes ALL of OWUI's document
// ingestion through the farm, so a box opts out via ocr.enabled:false). Idempotent +
// non-fatal, like web search; `lol up` installs it lazily otherwise.
async function ensureOcr(config) {
    if (!config.ocr || !config.ocr.enabled) {
        log.info('Disabled (set ocr.enabled:true to host shared document OCR for clients).');
        return;
    }
    try {
        const { ensureExtract } = require('../extract');
        const ok = await ensureExtract(config);
        if (ok) log.ok('OCR service ready — every client gets scanned-doc + image OCR, zero setup.');
        else log.warn('OCR not set up yet — `lol up` will retry on first run.');
    } catch (e) {
        log.warn(`OCR setup skipped — ${e.message}. \`lol up\` will retry.`);
    }
}

// --- orchestrate ------------------------------------------------------------

async function run() {
    log.info(log.paint.bold('lol install') + ' — bootstrapping the farm …');
    log.plain('');

    const config = ensureConfig();

    log.plain('');
    log.info('Ollama …');
    if (await ollamaPresent(config)) log.ok('Ollama already installed.');
    else installOllama();

    log.plain('');
    log.info('LiteLLM …');
    const litellmOk = ensureLitellm();

    log.plain('');
    log.info('Models …');
    await pullModels(config);

    log.plain('');
    log.info('Web search …');
    await ensureWebsearch(config);

    log.plain('');
    log.info('OCR …');
    await ensureOcr(config);

    log.plain('');
    if (litellmOk) {
        log.ok(log.paint.bold(`${config.name} is ready to serve.`));
        log.plain(`     Start it with:  ${log.paint.cyan('lol up')}   ${log.paint.grey('(or `node bin/lol.js up`)')}`);
    } else {
        log.warn('Bootstrap incomplete — resolve the notes above and re-run `lol install`.');
    }
    log.plain('');
    return litellmOk ? 0 : 1;
}

module.exports = { run };
