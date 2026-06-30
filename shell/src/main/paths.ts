// Resolve filesystem paths the shell needs: the Open WebUI sidecar executable,
// and the default local DATA_DIR. Handles dev (the repo's sidecar/.venv) vs a
// packaged build (the sidecar DOWNLOADED to userData/sidecar on first run — it is
// no longer bundled in the installer; see sidecarManager.ts).

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

const isWin = process.platform === 'win32';
const EXE = isWin ? 'open-webui.exe' : 'open-webui';

// Where the downloaded OWUI sidecar lives in a packaged build (relocatable
// standalone CPython + launcher.py + OPENWEBUI_VERSION, extracted here on first run).
export function sidecarRoot(): string {
    return path.join(app.getPath('userData'), 'sidecar');
}

// The Open WebUI sidecar command + args. Order of resolution:
//   1. $LOL_SIDECAR_CMD — explicit override (an executable path; e.g. a venv's
//      open-webui console script). args defaults to ['serve'].
//   2. Packaged: the standalone Python + launcher.py under userData/sidecar/
//      (downloaded by sidecarManager — NOT bundled in the installer).
//   3. Dev: the repo's sidecar/.venv console script.
// `args` is the leading args BEFORE the supervisor appends --host/--port.
export function resolveSidecarCommand(): { command: string; args: string[]; source: string } {
    const override = process.env.LOL_SIDECAR_CMD;
    if (override) return { command: override, args: ['serve'], source: 'env' };

    if (app.isPackaged) {
        // Downloaded to userData/sidecar on first run. Run it as
        //   <python> launcher.py serve --host --port
        const root = sidecarRoot();
        const py = isWin ? path.join(root, 'python', 'python.exe') : path.join(root, 'python', 'bin', 'python3');
        return { command: py, args: [path.join(root, 'launcher.py'), 'serve'], source: 'downloaded' };
    }

    // Dev: the repo's venv console script. shell/ is app.getAppPath().
    const repoRoot = path.join(app.getAppPath(), '..');
    const devScript = isWin
        ? path.join(repoRoot, 'sidecar', '.venv', 'Scripts', EXE)
        : path.join(repoRoot, 'sidecar', '.venv', 'bin', EXE);
    return { command: devScript, args: ['serve'], source: 'dev-venv' };
}

// True if the resolved sidecar is actually present on disk (used to decide whether
// the first-run download is needed in a packaged build).
export function sidecarInstalled(): boolean {
    return sidecarExists(resolveSidecarCommand().command);
}

// True if the resolved sidecar command actually exists on disk (a bare PATH name
// can't be stat-checked, so we treat those as present).
export function sidecarExists(command: string): boolean {
    if (!command.includes('/') && !command.includes('\\')) return true; // PATH lookup
    try { return fs.existsSync(command); } catch { return false; }
}

// Default per-user DATA_DIR (all OWUI user data lives here unless the user picks
// another folder). Under Electron's userData so it's per-user + writable.
export function defaultDataDir(): string {
    return path.join(app.getPath('userData'), 'owui-data');
}

// The shell-settings JSON file location.
export function settingsFile(): string {
    return path.join(app.getPath('userData'), 'shell-settings.json');
}

// The installed Open WebUI version (the pin), read from OPENWEBUI_VERSION. Dev:
// the repo's sidecar/. Packaged: the downloaded userData/sidecar/. Returns
// 'unknown' if the sidecar isn't installed yet (pre-first-run download).
export function bundledOwuiVersion(): string {
    const candidates = app.isPackaged
        ? [path.join(sidecarRoot(), 'OPENWEBUI_VERSION')]
        : [path.join(app.getAppPath(), '..', 'sidecar', 'OPENWEBUI_VERSION')];
    for (const c of candidates) {
        try { const v = fs.readFileSync(c, 'utf8').trim(); if (v) return v; } catch { /* next */ }
    }
    return 'unknown';
}
