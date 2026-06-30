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

// Find a usable Python 3.9–3.13 interpreter command, or null.
function findPython() {
    const candidates = IS_WIN
        ? ['py -3.12', 'py -3.11', 'py -3', 'python', 'python3']
        : ['python3.12', 'python3.11', 'python3', 'python'];
    for (const c of candidates) {
        const v = shCapture(`${c} --version`);
        if (v && /Python 3\.(9|10|11|12|13)\b/.test(v)) return { cmd: c, version: v };
    }
    return null;
}

function venvPython() {
    return IS_WIN
        ? path.join(VENV_DIR, 'Scripts', 'python.exe')
        : path.join(VENV_DIR, 'bin', 'python');
}

function ensureLitellm() {
    if (venvLitellmPath()) { log.ok(`LiteLLM venv ready: ${log.paint.grey(VENV_DIR)}`); return true; }

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
    sh(`"${vpy}" -m pip install "litellm[proxy]"`);
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
    for (const m of config.models) {
        if (ollama.hasModel(present, m.id)) { log.ok(`${m.id} already present.`); continue; }
        log.step(`Pulling ${log.paint.bold(m.id)} (first pull can be slow) …`);
        try {
            let last = '';
            await ollama.pullModel(local, m.id, (s) => {
                if (s !== last) { last = s; process.stdout.write(`\r${log.paint.grey('[pull]')} ${s}            `); }
            });
            process.stdout.write('\n');
            log.ok(`${m.id} ready.`);
        } catch (e) {
            process.stdout.write('\n');
            log.warn(`Could not pull ${m.id} — ${e.message}. \`lol up\` will retry.`);
        }
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
