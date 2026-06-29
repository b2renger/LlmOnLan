// Resolve filesystem paths the shell needs: the bundled Open WebUI sidecar
// executable, and the default local DATA_DIR. Handles dev (the repo's
// sidecar/.venv) vs a packaged build (a binary under resources/).

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

const isWin = process.platform === 'win32';
const EXE = isWin ? 'open-webui.exe' : 'open-webui';

// The Open WebUI sidecar executable + args. Order of resolution:
//   1. $LOL_SIDECAR_CMD — explicit override (a path, or "py:<python>" form).
//   2. Packaged: the bundled binary under process.resourcesPath/sidecar/.
//   3. Dev: the repo's sidecar/.venv console script.
// Returns { command, args } where args is the leading args BEFORE host/port.
export function resolveSidecarCommand(): { command: string; args: string[]; source: string } {
    const override = process.env.LOL_SIDECAR_CMD;
    if (override) return { command: override, args: [], source: 'env' };

    if (app.isPackaged) {
        // M5 packaging puts a self-contained executable here (see sidecar/).
        const bundled = path.join(process.resourcesPath, 'sidecar', EXE);
        return { command: bundled, args: ['serve'], source: 'packaged' };
    }

    // Dev: the repo's venv. shell/ is app.getAppPath(); the repo root is its parent.
    const repoRoot = path.join(app.getAppPath(), '..');
    const devScript = isWin
        ? path.join(repoRoot, 'sidecar', '.venv', 'Scripts', EXE)
        : path.join(repoRoot, 'sidecar', '.venv', 'bin', EXE);
    return { command: devScript, args: ['serve'], source: 'dev-venv' };
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
