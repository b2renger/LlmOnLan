// Process supervision + on-disk runtime state.
//
// `lol up` runs in the foreground and supervises the LiteLLM proxy child; it also
// records a small runtime file so `lol status` / `lol down` work from ANOTHER
// shell. Killing a Node-spawned LiteLLM cleanly means killing its uvicorn worker
// tree, so we tree-kill (taskkill /T on Windows, process-group on POSIX).

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const RUNTIME_FILE = path.join(__dirname, '..', '.lol-runtime.json');

// ---- runtime state file ----------------------------------------------------

function readRuntime() {
    try {
        if (fs.existsSync(RUNTIME_FILE)) return JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));
    } catch { /* corrupt → treat as none */ }
    return null;
}
function writeRuntime(state) {
    fs.writeFileSync(RUNTIME_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}
function clearRuntime() {
    try { fs.unlinkSync(RUNTIME_FILE); } catch { /* already gone */ }
}

// ---- pid helpers -----------------------------------------------------------

// True if a pid is alive (signal 0 probes without killing).
function isAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Kill a process and its children, cross-platform. Resolves when done.
function killTree(pid) {
    return new Promise((resolve) => {
        if (!pid || !isAlive(pid)) return resolve();
        if (process.platform === 'win32') {
            execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => resolve());
        } else {
            // Negative pid → the whole process group (children spawned with detached).
            try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
            setTimeout(() => {
                try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
                resolve();
            }, 1500);
        }
    });
}

// The program a pid runs now ("ollama.exe", "ollama"), or null when it cannot be told. A pid the farm recorded may
// belong to another program by now (its Ollama died and the number was given again): read before killing it.
function processName(pid, { platform = process.platform, run = execFile } = {}) {
    return new Promise((resolve) => {
        if (!pid || !isAlive(pid)) return resolve(null);
        if (platform === 'linux') { try { return resolve(fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() || null); } catch { return resolve(null); } }
        const [cmd, args] = platform === 'win32'
            ? ['tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']]
            : ['ps', ['-p', String(pid), '-o', 'comm=']];
        run(cmd, args, { windowsHide: true, timeout: 10000 }, (err, out) => {
            if (err) return resolve(null);
            const t = String(out || '').trim();
            resolve(platform === 'win32' ? ((/^"([^"]+)"/.exec(t) || [])[1] || null) : (path.basename(t) || null));
        });
    });
}
// Is `pid` an Ollama? Unknown counts as yes (the farm's own record, as before); another program's name, no.
async function isOllamaProcess(pid, opts) {
    const n = await processName(pid, opts);
    return n == null ? isAlive(pid) : /ollama/i.test(n);
}

// ---- spawning the proxy ----------------------------------------------------

// Resolve how to invoke a command. A path-like command (contains a separator or
// ends in .exe) runs directly (shell:false); a bare name on Windows needs the
// shell to resolve .cmd/.exe via PATHEXT.
function resolveSpawn(command) {
    const looksLikePath =
        command.includes('/') || command.includes('\\') || /\.(exe|cmd|bat)$/i.test(command);
    const useShell = process.platform === 'win32' && !looksLikePath;
    return { command, useShell };
}

// Path to a LiteLLM installed into the farm's own .venv (created by `lol install`),
// or null if there isn't one.
function venvLitellmPath() {
    const venv = path.join(__dirname, '..', '.venv');
    const p = process.platform === 'win32'
        ? path.join(venv, 'Scripts', 'litellm.exe')
        : path.join(venv, 'bin', 'litellm');
    try { return fs.existsSync(p) ? p : null; } catch { return null; }
}

// What to actually launch LiteLLM with: an explicit litellm.command wins; else the
// farm's .venv if `lol install` made one; else a bare `litellm` from PATH. So a
// fresh pull works with the default config (litellm.command:"litellm") and no edit.
function resolveLitellmCommand(config) {
    const configured = config.litellm.command;
    if (configured && configured !== 'litellm') return configured;
    return venvLitellmPath() || 'litellm';
}

// Spawn LiteLLM: `<command> --config <yaml> --port <port> --host <host> [extra]`.
// Returns the child process. Caller wires stdout/stderr/exit.
// port/host override the config binding — with the seat gate on, LiteLLM binds
// loopback-only behind the farm's own listener on the public proxy.port.
function spawnLitellm(config, configYamlPath, { env = {}, port = null, host = null } = {}) {
    const { command, useShell } = resolveSpawn(resolveLitellmCommand(config));
    const args = [
        '--config', configYamlPath,
        '--port', String(port ?? config.proxy.port),
        '--host', host ?? config.proxy.host,
        ...config.litellm.extraArgs,
    ];
    const child = spawn(command, args, {
        shell: useShell,
        windowsHide: true,
        // detached on POSIX → its own process group so killTree(-pid) reaps uvicorn.
        detached: process.platform !== 'win32',
        env: {
            ...process.env,
            // Force UTF-8 for the child's stdio (these win over an inherited
            // cp1252 setting). Without this, LiteLLM's startup banner
            // (box-drawing/emoji glyphs) crashes the proxy on a Windows cp1252
            // console with UnicodeEncodeError before it ever serves.
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
            ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return child;
}

module.exports = {
    RUNTIME_FILE,
    readRuntime,
    writeRuntime,
    clearRuntime,
    isAlive,
    killTree,
    processName,
    isOllamaProcess,
    resolveSpawn,
    venvLitellmPath,
    resolveLitellmCommand,
    spawnLitellm,
};
