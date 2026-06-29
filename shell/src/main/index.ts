// LlmOnLan shell — Electron main process entry.
//
// Boots the window with ComfyQ-styled chrome, supervises the bundled Open WebUI
// sidecar (pointed at the farm via config-bridge), and loads it in a <webview>.
// Discovery (M3) and full Preferences (M4) layer onto this skeleton.

import { app, BrowserWindow, ipcMain, shell, nativeTheme } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { loadSettings, updateSettings } from './store';
import { defaultDataDir } from './paths';
import { SidecarSupervisor } from './sidecar';
import { ShellSettings } from './types';

app.setName('LlmOnLan');

// Single-instance: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
    app.quit();
}

let win: BrowserWindow | null = null;
const sidecar = new SidecarSupervisor();

// --- endpoint + data-dir resolution -----------------------------------------
// M0: endpoint from env override / last-known-good / dev default. M3's discovery
// replaces the default by feeding a discovered farm into sidecar.repoint().
function resolveEndpoint(): string | null {
    const s = loadSettings();
    return process.env.LOL_ENDPOINT || s.lastEndpoint || 'http://127.0.0.1:4000/v1';
}
function resolveDataDir(): string {
    return loadSettings().dataDir || defaultDataDir();
}

// --- theme ------------------------------------------------------------------
function applyTheme(theme: ShellSettings['theme']): void {
    nativeTheme.themeSource = theme === 'system' ? 'system' : theme;
}

// --- renderer push ----------------------------------------------------------
function pushSidecarState(): void {
    if (win && !win.isDestroyed()) win.webContents.send('sidecar-state', sidecar.getState());
}

function createWindow(): void {
    win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#09090b',
        title: 'LlmOnLan',
        icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload', 'index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true, // the main area embeds OWUI in a <webview>
        },
    });
    win.removeMenu();
    win.loadFile(path.join(app.getAppPath(), 'renderer', 'index.html'));
    win.webContents.on('did-finish-load', pushSidecarState);

    // Keep external links (OWUI "Powered by" etc.) in the system browser, not in
    // a new Electron window.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
}

// --- IPC --------------------------------------------------------------------
function registerIpc(): void {
    ipcMain.handle('get-sidecar-state', () => sidecar.getState());
    ipcMain.handle('get-settings', () => loadSettings());

    ipcMain.handle('set-theme', (_e, theme: ShellSettings['theme']) => {
        const s = updateSettings({ theme });
        applyTheme(s.theme);
        return s;
    });

    ipcMain.handle('open-external', (_e, url: string) => {
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url);
        return false;
    });

    // Manual reload of the embedded OWUI (e.g. after a repoint).
    ipcMain.handle('reload-webview', () => { pushSidecarState(); return true; });

    // Retry a failed/stopped sidecar (the connection screen's Retry button).
    ipcMain.handle('restart-sidecar', async () => {
        await sidecar.stop({ keepState: true });
        await sidecar.start({ endpoint: resolveEndpoint(), dataDir: resolveDataDir() });
        return sidecar.getState();
    });
}

// --- dev smoke test ---------------------------------------------------------
// LOL_SMOKE_SHOT=<png> + (optional) LOL_SMOKE_WAIT=<ms>: once the sidecar is
// ready (webview has had time to load OWUI), capture the whole window to the PNG
// and quit. A repeatable visual smoke test for CI / manual verification.
function maybeSmokeShot(): void {
    const out = process.env.LOL_SMOKE_SHOT;
    if (!out) return;
    const waitMs = Number(process.env.LOL_SMOKE_WAIT || 9000);
    let shot = false;
    sidecar.on('state', (s) => {
        if (shot || s.status !== 'ready') return;
        shot = true;
        setTimeout(async () => {
            try {
                if (win && !win.isDestroyed()) {
                    const img = await win.capturePage();
                    fs.writeFileSync(out, img.toPNG());
                    console.log(`[smoke] captured window → ${out}`);
                }
            } catch (e) {
                console.error('[smoke] capture failed:', (e as Error).message);
            } finally {
                app.quit();
            }
        }, waitMs);
    });
    // Also bail out (with whatever we have) if it never goes ready.
    const hardCap = Number(process.env.LOL_SMOKE_TIMEOUT || 200000);
    setTimeout(() => { if (!shot) { console.error('[smoke] sidecar never ready; quitting'); app.quit(); } }, hardCap);
}

// --- lifecycle --------------------------------------------------------------
app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(async () => {
    const settings = loadSettings();
    applyTheme(settings.theme);
    registerIpc();
    createWindow();

    sidecar.on('state', pushSidecarState);
    maybeSmokeShot();
    // Fire-and-forget: the renderer shows the connection screen until 'ready'.
    sidecar.start({ endpoint: resolveEndpoint(), dataDir: resolveDataDir() });

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

let quitting = false;
app.on('before-quit', async (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    await sidecar.stop();
    app.exit(0);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
