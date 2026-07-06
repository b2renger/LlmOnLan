// LlmOnLan Farm — Electron main process entry.
//
// Two lives:
//   • First run  → a setup wizard downloads the runtime (Python + Ollama), copies the
//                  farm code, pulls gemma4:12b, builds the service venvs, and launches
//                  the farm (installer.ts / runtimeManager.ts).
//   • Steady     → the window IS the farm's admin panel (/lol/admin in a <webview>,
//                  token auto-seeded), with thin chrome: status dot, Start/Stop, the
//                  LAN address, settings + self-update. The FarmSupervisor keeps
//                  `lol up` alive.

import { app, BrowserWindow, ipcMain, shell, nativeTheme, session, clipboard } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as url from 'url';
import { loadSettings, updateSettings } from './store';
import { runtimeReady } from './runtimeManager';
import { farmInstalled } from './paths';
import { runSetup, setShareMode, ensurePluginPorts } from './installer';
import { reapStaleFarm } from './farmProcess';
import { FarmSupervisor } from './farmSupervisor';
import { initUpdateCheck, checkFarmUpdate, setUpdateNotifier } from './updater';
import { FarmSettings, FarmState, SetupProgress } from './types';

app.setName('LlmOnLan Farm');
app.commandLine.appendSwitch('lang', 'en-US');

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
const supervisor = new FarmSupervisor();
let setupRunning = false;

// Start the farm: reap any leftover processes from a prior run, route the plugins off
// taken ports (e.g. 8888/Jupyter), then start. Reaping first frees ports the last run's
// orphans may still hold, so ensurePluginPorts can keep the defaults.
async function startFarm(): Promise<void> {
    await reapStaleFarm();
    await ensurePluginPorts();
    await supervisor.start();
}

// --- renderer push ----------------------------------------------------------

function send(channel: string, payload: unknown): void {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function pushFarmState(s: FarmState): void { send('farm-state', s); }
function pushSetupProgress(p: SetupProgress): void { send('setup-progress', p); }

// --- theme ------------------------------------------------------------------

function applyTheme(theme: FarmSettings['theme']): void {
    nativeTheme.themeSource = theme === 'system' ? 'system' : theme;
}

// --- admin webview ----------------------------------------------------------

// The URL + preload the renderer points the <webview> at. The admin token rides in
// the URL hash (#tok=…); webviewPreload.js reads it into localStorage.lolAdminToken
// BEFORE the admin page's own script runs, so the panel unlocks with no prompt (and
// the preload strips the hash immediately after). Null until the farm is ready.
function adminWebview(): { url: string; preloadUrl: string } | null {
    const adminUrl = supervisor.getState().adminUrl;
    const token = loadSettings().adminToken;
    if (!adminUrl || !token) return null;
    const preloadUrl = url.pathToFileURL(path.join(app.getAppPath(), 'renderer', 'webviewPreload.js')).href;
    return { url: `${adminUrl}#tok=${encodeURIComponent(token)}`, preloadUrl };
}

// --- window -----------------------------------------------------------------

function createWindow(): void {
    win = new BrowserWindow({
        width: 1180,
        height: 820,
        minWidth: 900,
        minHeight: 620,
        backgroundColor: '#09090b',
        title: 'LlmOnLan Farm',
        icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload', 'index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true, // the running screen embeds /lol/admin in a <webview>
        },
    });
    win.removeMenu();
    win.loadFile(path.join(app.getAppPath(), 'renderer', 'index.html'));

    // Keep external links (the "Schedule a job" style openExternal, docs, …) in the
    // system browser.
    win.webContents.setWindowOpenHandler(({ url: u }) => {
        if (/^https?:\/\//i.test(u)) shell.openExternal(u);
        return { action: 'deny' };
    });

    // Grant the embedded admin webview clipboard (its copy buttons) on its partition.
    configureWebviewPermissions();
}

const ADMIN_ALLOWED_PERMS = new Set(['clipboard-read', 'clipboard-sanitized-write']);
function configureWebviewPermissions(): void {
    const ses = session.fromPartition('persist:lol-admin');
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ADMIN_ALLOWED_PERMS.has(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => ADMIN_ALLOWED_PERMS.has(permission));
}

// --- IPC --------------------------------------------------------------------

function currentPrefs() {
    const s = loadSettings();
    return {
        installed: s.installed,
        theme: s.theme,
        launchAtLogin: s.launchAtLogin,
        autoUpdate: s.autoUpdate,
        shareWithNetwork: s.shareWithNetwork,
        appVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        ramGb: Math.round(os.totalmem() / 1e9),
        hostname: os.hostname(),
    };
}

function registerIpc(): void {
    // Boot: which screen to show + everything the renderer needs to render it.
    ipcMain.handle('get-init-state', () => ({
        prefs: currentPrefs(),
        farmState: supervisor.getState(),
        adminWebview: adminWebview(),
    }));
    ipcMain.handle('get-prefs', () => currentPrefs());
    ipcMain.handle('get-farm-state', () => supervisor.getState());
    ipcMain.handle('get-admin-webview', () => adminWebview());

    // First-run setup (also the Retry path — idempotent). Runs the wizard, then
    // launches the farm (phase 5) and, on success, flips `installed` so the next
    // boot skips straight to the running screen.
    ipcMain.handle('start-setup', async () => {
        if (setupRunning) return { ok: false, error: 'Setup already running.' };
        setupRunning = true;
        try {
            const res = await runSetup(pushSetupProgress, async () => {
                updateSettings({ installed: true }); // all downloads done — mark it before launch
                await startFarm();
                if (supervisor.getState().status !== 'ready') {
                    throw new Error(supervisor.getState().message || 'The farm did not start.');
                }
            });
            return res;
        } finally {
            setupRunning = false;
        }
    });

    // Start/Stop the farm from the running screen.
    ipcMain.handle('farm-start', async () => { await startFarm(); return supervisor.getState(); });
    ipcMain.handle('farm-stop', async () => { await supervisor.stop(); return supervisor.getState(); });
    ipcMain.handle('refresh-lan', async () => { await supervisor.refreshLan(); return supervisor.getState(); });

    // Settings.
    ipcMain.handle('set-theme', (_e, theme: FarmSettings['theme']) => {
        const s = updateSettings({ theme }); applyTheme(s.theme); return s.theme;
    });
    ipcMain.handle('set-launch-at-login', (_e, on: boolean) => {
        const v = !!on;
        updateSettings({ launchAtLogin: v });
        try { app.setLoginItemSettings({ openAtLogin: v }); } catch { /* unsupported */ }
        return v;
    });
    ipcMain.handle('set-auto-update', (_e, on: boolean) => {
        const v = updateSettings({ autoUpdate: !!on }).autoUpdate;
        if (v) initUpdateCheck(true);
        return v;
    });

    // Share the farm's compute with the LAN (default off = fully private: localhost
    // bind + no beacon). Rewrites lol.config.json's beacon/proxy and restarts the
    // farm so the new bind address + beacon take effect (they're read at `lol up` boot).
    ipcMain.handle('set-share-network', async (_e, on: boolean) => {
        const share = !!on;
        updateSettings({ shareWithNetwork: share });
        setShareMode(share);
        const st = supervisor.getState().status;
        if (st === 'ready' || st === 'starting' || st === 'restarting') {
            await supervisor.stop({ keepState: true });
            await startFarm();
        }
        return { share, farmState: supervisor.getState() };
    });

    // App update — MANUAL (see updater.ts): report whether a newer farm-v* release
    // exists; the renderer opens the download page (no in-place install in a shared repo).
    ipcMain.handle('check-app-update', () => checkFarmUpdate());
    ipcMain.handle('relaunch-app', () => { app.relaunch(); app.quit(); return true; });

    // Misc.
    ipcMain.handle('open-external', (_e, u: string) => {
        if (typeof u === 'string' && /^https?:\/\//i.test(u)) return shell.openExternal(u);
        return false;
    });
    ipcMain.handle('copy-text', (_e, text: string) => { clipboard.writeText(String(text ?? '')); return true; });
    ipcMain.handle('open-logs', () => shell.openPath(app.getPath('userData')));
}

// --- lifecycle --------------------------------------------------------------

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
    const settings = loadSettings();
    applyTheme(settings.theme);
    registerIpc();
    createWindow();

    supervisor.on('state', pushFarmState);
    setUpdateNotifier((info) => send('update-available', info));
    initUpdateCheck(settings.autoUpdate);

    // Already set up → auto-start the farm (the renderer shows the running screen and
    // watches farm-state go starting → ready). A missing runtime/farm copy (e.g. a
    // wiped userData) falls back to the wizard.
    if (settings.installed && runtimeReady() && farmInstalled()) {
        setShareMode(settings.shareWithNetwork); // enforce the persisted posture (also migrates a pre-toggle 0.0.0.0 config to private)
        startFarm();
    } else if (settings.installed) {
        // Marked installed but the on-disk runtime is gone — re-run setup.
        updateSettings({ installed: false });
    }

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

let quitting = false;
app.on('before-quit', async (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    await supervisor.stop();
    app.exit(0);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
