// LlmOnLan shell — Electron main process entry.
//
// Boots the window with ComfyQ-styled chrome, supervises the bundled Open WebUI
// sidecar (pointed at the farm via config-bridge), and loads it in a <webview>.
// Discovery (M3) and full Preferences (M4) layer onto this skeleton.

import { app, BrowserWindow, ipcMain, shell, nativeTheme, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { loadSettings, updateSettings } from './store';
import { defaultDataDir, bundledOwuiVersion } from './paths';
import { SidecarSupervisor } from './sidecar';
import { Discovery } from './discovery';
import { moveDataDir, dirHasData } from './dataMigration';
import { ShellSettings, DiscoveredFarm, ScanRange } from './types';

app.setName('LlmOnLan');

// Single-instance: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
    app.quit();
}

let win: BrowserWindow | null = null;
const sidecar = new SidecarSupervisor();
let discovery: Discovery | null = null;

// The farm endpoint OWUI is currently pointed at, and which farm it is.
let currentEndpoint: string | null = null;
let activeFarmId: string | null = null;
let booted = false; // true once the initial sidecar start has been kicked off

// --- endpoint + data-dir resolution -----------------------------------------
// The initial endpoint to boot OWUI with, BEFORE discovery refines it: an env
// pin, then last-known-good. Otherwise null → wait briefly for discovery to find
// a farm (see boot()), so we boot OWUI pointed at the reachable LAN address and
// the active-farm match is exact (no 127.0.0.1-vs-LAN-IP churn).
function resolveEndpoint(): string | null {
    const s = loadSettings();
    return process.env.LOL_ENDPOINT || s.lastEndpoint || null;
}
function resolveDataDir(): string {
    return loadSettings().dataDir || defaultDataDir();
}

// Reach a farm at the address we actually saw it (beacon source / probed host),
// not its self-reported primary IP, which may be a different interface.
function farmEndpoint(f: DiscoveredFarm): string {
    return `http://${f._host}:${f.proxyPort}/v1`;
}

// Pick the farm OWUI should use: the user's pinned choice, else the current one
// if still good (sticky — avoids flapping between equivalents), else first healthy.
function chooseActive(farms: DiscoveredFarm[]): DiscoveredFarm | null {
    const sel = loadSettings().selectedFarmId;
    if (sel) { const f = farms.find((x) => x.id === sel && x.healthy && !x._stale); if (f) return f; }
    if (activeFarmId) { const f = farms.find((x) => x.id === activeFarmId && x.healthy && !x._stale); if (f) return f; }
    return farms.find((x) => x.healthy && !x._stale) || null;
}

// Discovery update → forward to the renderer + auto-connect to the active farm.
function onFarms(payload: { farms: DiscoveredFarm[] } & Record<string, unknown>): void {
    if (win && !win.isDestroyed()) win.webContents.send('farms', payload);
    if (!booted || process.env.LOL_ENDPOINT) return; // pinned endpoint: discovery is informational only
    const chosen = chooseActive(payload.farms);
    if (!chosen) return;
    const endpoint = farmEndpoint(chosen);
    if (endpoint !== currentEndpoint) {
        currentEndpoint = endpoint;
        activeFarmId = chosen.id;
        updateSettings({ lastEndpoint: endpoint });
        sidecar.repoint(endpoint, chosen.requiresKey ? null : null);
    }
}

// Wait up to ms for discovery to surface a healthy farm; return its endpoint.
function waitForFirstFarm(ms: number): Promise<string | null> {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const tick = () => {
            const f = discovery ? chooseActive(discovery.getFarms()) : null;
            if (f) { activeFarmId = f.id; return resolve(farmEndpoint(f)); }
            if (Date.now() - t0 > ms) return resolve(null);
            setTimeout(tick, 300);
        };
        tick();
    });
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
        await sidecar.start({ endpoint: currentEndpoint, dataDir: resolveDataDir() });
        return sidecar.getState();
    });

    // --- discovery (M3) ---
    ipcMain.handle('get-farms', () => ({
        farms: discovery?.getFarms() ?? [],
        manualPeers: discovery?.getManualPeers() ?? [],
        autoScan: discovery?.getAutoScan() ?? true,
        scanRange: discovery?.getScanRange() ?? null,
        selfIps: [],
    }));
    ipcMain.handle('add-manual-peer', (_e, host: string) => {
        const peers = discovery?.addManualPeer(host) ?? [];
        updateSettings({ manualPeers: peers });
        return peers;
    });
    ipcMain.handle('remove-manual-peer', (_e, host: string) => {
        const peers = discovery?.removeManualPeer(host) ?? [];
        updateSettings({ manualPeers: peers });
        return peers;
    });
    ipcMain.handle('set-auto-scan', (_e, on: boolean) => {
        const v = discovery?.setAutoScan(on) ?? on;
        updateSettings({ autoScan: v });
        return v;
    });
    ipcMain.handle('set-scan-range', (_e, r: ScanRange) => {
        const v = discovery?.setScanRange(r) ?? null;
        updateSettings({ scanRange: v });
        return v;
    });
    ipcMain.handle('rescan', () => { discovery?.rescan(); return true; });

    // --- preferences (M4) ---
    ipcMain.handle('get-prefs', () => {
        const s = loadSettings();
        return {
            dataDir: resolveDataDir(),
            dataDirDefault: defaultDataDir(),
            dataDirIsDefault: !s.dataDir,
            theme: s.theme,
            launchAtLogin: s.launchAtLogin,
            autoUpdate: s.autoUpdate,
            shellVersion: app.getVersion(),
            owuiVersion: bundledOwuiVersion(),
            scanRange: discovery?.getScanRange() ?? null,
            manualPeers: discovery?.getManualPeers() ?? [],
            autoScan: discovery?.getAutoScan() ?? true,
            endpoint: currentEndpoint,
        };
    });

    // Pick a new data folder. Returns { path, hasData } or { canceled: true }.
    ipcMain.handle('choose-data-dir', async () => {
        if (!win) return { canceled: true };
        const res = await dialog.showOpenDialog(win, {
            title: 'Choose a folder for your LlmOnLan data',
            properties: ['openDirectory', 'createDirectory'],
            defaultPath: resolveDataDir(),
        });
        if (res.canceled || !res.filePaths[0]) return { canceled: true };
        const chosen = res.filePaths[0];
        return { canceled: false, path: chosen, hasData: dirHasData(chosen), oldHasData: dirHasData(resolveDataDir()) };
    });

    // Apply a data-folder change. mode: 'move' (copy old→new) | 'fresh' (start empty).
    ipcMain.handle('set-data-dir', async (_e, payload: { path: string; mode: 'move' | 'fresh' }) => {
        const oldDir = resolveDataDir();
        const newDir = payload.path;
        if (!newDir || path.resolve(newDir) === path.resolve(oldDir)) return { ok: false, error: 'Same folder.' };
        await sidecar.stop({ keepState: true });
        let result: { ok: boolean; error?: string } = { ok: true };
        if (payload.mode === 'move') result = moveDataDir(oldDir, newDir);
        if (result.ok) updateSettings({ dataDir: newDir });
        await sidecar.start({ endpoint: currentEndpoint, dataDir: result.ok ? newDir : oldDir });
        return result;
    });

    ipcMain.handle('set-launch-at-login', (_e, on: boolean) => {
        const v = !!on;
        updateSettings({ launchAtLogin: v });
        try { app.setLoginItemSettings({ openAtLogin: v }); } catch { /* unsupported platform */ }
        return v;
    });

    ipcMain.handle('set-auto-update', (_e, on: boolean) => updateSettings({ autoUpdate: !!on }).autoUpdate);

    // User pins a specific farm → persist + repoint immediately.
    ipcMain.handle('select-farm', (_e, farmId: string | null) => {
        updateSettings({ selectedFarmId: farmId });
        const farms = discovery?.getFarms() ?? [];
        const chosen = chooseActive(farms);
        if (chosen) {
            const endpoint = farmEndpoint(chosen);
            currentEndpoint = endpoint;
            activeFarmId = chosen.id;
            updateSettings({ lastEndpoint: endpoint });
            sidecar.repoint(endpoint, chosen.requiresKey ? null : null);
        }
        return chosen?.id ?? null;
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
                    // Optionally click an element by id (e.g. open the connection
                    // popover or the Preferences modal) before capturing — for
                    // verifying specific UI in a smoke run.
                    const clickId = process.env.LOL_SMOKE_CLICK || (process.env.LOL_SMOKE_POPOVER ? 'status' : '');
                    if (clickId) {
                        await win.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(clickId)})?.click()`).catch(() => {});
                        await new Promise((r) => setTimeout(r, 700));
                    }
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

    // Start LAN discovery (beacon listener + sweep + manual peers).
    discovery = new Discovery({ manualPeers: settings.manualPeers, autoScan: settings.autoScan, scanRange: settings.scanRange });
    discovery.on('farms', onFarms);
    discovery.start();

    // Decide the initial endpoint. If none known, give discovery a short grace
    // period to find a farm so we boot OWUI pointed at it the first time (no
    // restart). Then `onFarms` keeps it repointed as the LAN changes.
    let initial = resolveEndpoint();
    if (!initial) initial = await waitForFirstFarm(4500);
    currentEndpoint = initial;
    booted = true;
    sidecar.start({ endpoint: initial, dataDir: resolveDataDir() });

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

let quitting = false;
app.on('before-quit', async (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    discovery?.stop();
    await sidecar.stop();
    app.exit(0);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
