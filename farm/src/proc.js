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

// Spawn LiteLLM: `<command> --config <yaml> --port <port> --host <host> [extra]`.
// Returns the child process. Caller wires stdout/stderr/exit.
function spawnLitellm(config, configYamlPath, { env = {} } = {}) {
    const { command, useShell } = resolveSpawn(config.litellm.command);
    const args = [
        '--config', configYamlPath,
        '--port', String(config.proxy.port),
        '--host', config.proxy.host,
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
    resolveSpawn,
    spawnLitellm,
};
