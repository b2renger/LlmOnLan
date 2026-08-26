// LlmOnLan shell — Electron main process entry.
//
// Boots the window with ComfyQ-styled chrome, supervises the bundled Open WebUI
// sidecar (pointed at the farm via config-bridge), and loads it in a <webview>.
// Discovery (M3) and full Preferences (M4) layer onto this skeleton.

import { app, BrowserWindow, ipcMain, shell, nativeTheme, dialog, session, powerMonitor } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { loadSettings, updateSettings } from './store';
import { defaultDataDir, bundledOwuiVersion, sidecarRoot } from './paths';
import { SidecarSupervisor } from './sidecar';
import { McpoSupervisor } from './mcpoSupervisor';
import { httpGet, tcpProbe } from './util';
import { Discovery } from './discovery';
import { moveDataDir, dirHasData } from './dataMigration';
import { initAutoUpdate, checkForAppUpdate, quitAndInstallUpdate, setUpdateNotifier } from './updater';
import { OWUI_ENABLED } from './clientMode';
import {
    ensureSidecar, applyPendingSidecar, isSidecarInstalled,
    checkOwuiUpdate, downloadOwuiUpdate, SidecarProgress,
} from './sidecarManager';
import { ShellSettings, DiscoveredFarm, ScanRange, McpoState } from './types';

app.setName('LlmOnLan');

// Default the UI to English. OWUI's frontend picks its language from the webview's
// navigator.language (the OS locale), so we set Chromium's locale to en-US — that
// makes English the default the i18n detector sees. It's still only a DEFAULT: a
// user who picks another language in OWUI's settings overrides it (that choice is
// cached in localStorage, which beats navigator). Must be set before app 'ready'.
app.commandLine.appendSwitch('lang', 'en-US');

// Single-instance: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
    app.quit();
}

let win: BrowserWindow | null = null;
const sidecar = new SidecarSupervisor();
const mcpo = new McpoSupervisor(); // local Blender assistant-tools server (opt-in)
let discovery: Discovery | null = null;

// The farm endpoint OWUI is currently pointed at, and which farm it is.
let currentEndpoint: string | null = null;
let currentModel: string | null = null; // the active farm's default model (→ OWUI DEFAULT_MODELS)
let currentSearxng: string | null = null; // the active farm's SearXNG (→ OWUI web search)
let currentTts: { url: string; voice: string; model: string } | null = null; // active farm's Kokoro (→ OWUI TTS)
let currentExtract: { url: string; key: string } | null = null; // active farm's lol-extract (→ OWUI OCR loader)
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

// The farm's advertised default model (or its first) → OWUI's DEFAULT_MODELS, so
// OWUI always auto-selects whatever the farm serves. null if the farm lists none.
function farmDefaultModel(f: DiscoveredFarm | null): string | null {
    const models = f?.models;
    if (!Array.isArray(models) || !models.length) return null;
    return (models.find((m) => m.default) || models[0])?.id || null;
}

// The farm's shared SearXNG (→ OWUI web search); null when the farm doesn't host one.
function farmSearxng(f: DiscoveredFarm | null): string | null {
    return f?.searxngUrl || null;
}

// The farm's shared Kokoro TTS (→ OWUI AUDIO_TTS_*); null when the farm doesn't host one.
function farmTts(f: DiscoveredFarm | null): { url: string; voice: string; model: string } | null {
    if (!f?.ttsUrl) return null;
    return { url: f.ttsUrl, voice: f.ttsVoice || 'af_heart', model: f.ttsModel || 'kokoro' };
}

// The farm's shared OCR loader (→ OWUI CONTENT_EXTRACTION_ENGINE=external); null when
// the farm doesn't host one. Requires both a url and a key (OWUI's loader mandates the key).
function farmExtract(f: DiscoveredFarm | null): { url: string; key: string } | null {
    if (!f?.extract?.url || !f.extract.key) return null;
    return { url: f.extract.url, key: f.extract.key };
}

// Stable per-install id for the farm presence heartbeat — generated once, persisted.
function getClientId(): string {
    const s = loadSettings();
    if (s.clientId) return s.clientId;
    const id = randomUUID();
    updateSettings({ clientId: id });
    return id;
}

// Presence heartbeat → the ACTIVE farm's admin panel ("who's connected, how idle").
// Every 10 s, fire-and-forget POST to the farm's open /lol/client-ping with a stable
// id, hostname, platform, app version and the machine's input-idle seconds
// (powerMonitor — "is a human at this machine", not just "is the app open"). Farms
// without httpPort (pre-admin builds) are skipped; an old farm that has httpPort but
// no route just 404s harmlessly. Must never throw or block anything.
function startClientHeartbeat(): void {
    const timer = setInterval(() => {
        try {
            const farm = discovery?.getFarms().find((f) => f.id === activeFarmId) ?? null;
            if (!farm || !farm.httpPort || farm._stale) return;
            const ctl = new AbortController();
            const t = setTimeout(() => ctl.abort(), 3000);
            fetch(`http://${farm._host}:${farm.httpPort}/lol/client-ping`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    id: getClientId(),
                    name: os.hostname(),
                    platform: process.platform,
                    version: app.getVersion(),
                    idleSec: powerMonitor.getSystemIdleTime(),
                }),
                signal: ctl.signal,
            }).catch(() => {}).finally(() => clearTimeout(t));
        } catch { /* presence is best-effort — never let it break the app */ }
    }, 10000);
    timer.unref();
}

// Auto-apply the active farm's CLIENT-side plugin recommendations (e.g. Blender). A
// recommendation is a positive hint: we only ever turn a client plugin ON, and never
// override an explicit per-machine choice (blenderMcpUserSet), and never auto-disable —
// the user may rely on it. The farm can't run a per-client plugin, only recommend it.
function applyFarmRecommendations(farm: DiscoveredFarm | null): void {
    const recs = Array.isArray(farm?.recommendedClientPlugins) ? farm!.recommendedClientPlugins! : [];
    const s = loadSettings();
    if (recs.includes('blender') && !s.blenderMcpUserSet && !mcpo.isEnabled()) {
        updateSettings({ blenderMcp: true });
        mcpo.setEnabled(true);
    }
}

// Load metric for a farm, from the telemetry the beacon already carries. Lower =
// more free. GPU utilisation (0–100) is the best proxy for "busy"; a farm that
// doesn't report it (no nvidia-smi) is treated as mid-load so a box we CAN measure
// and see idle beats an unknown one.
function farmLoad(f: DiscoveredFarm): number {
    const util = f.usage?.gpuUtil;
    return typeof util === 'number' ? util : 50;
}

// Pick the least-loaded healthy farm, scattering ties randomly so a fleet of
// clients booting at once doesn't stampede the same box (at cold start they all
// see every box idle, so jitter spreads them). This runs only when we're actually
// CHOOSING a farm — chooseActive keeps a healthy current farm sticky, so load-aware
// selection never repoints OWUI mid-session (that churn would cost more than the
// imbalance it fixes); it kicks in at first connect and on failover.
//
// If a coordinator farm is present it "absorbs" the fleet — we route through it
// (it balances every request across the boxes centrally), so the candidate pool
// is the coordinators. With no coordinator, the pool is all healthy farms and we
// balance client-side. One rule cleanly covers both deployment styles.
const LOAD_BAND = 15; // farms within 15 util-points of the minimum count as "equally free"
function pickLeastLoaded(farms: DiscoveredFarm[]): DiscoveredFarm | null {
    const healthy = farms.filter((x) => x.healthy && !x._stale);
    if (!healthy.length) return null;
    const coordinators = healthy.filter((x) => x.coordinator);
    const pool = coordinators.length ? coordinators : healthy;
    if (pool.length === 1) return pool[0];
    const min = Math.min(...pool.map(farmLoad));
    const contenders = pool.filter((x) => farmLoad(x) <= min + LOAD_BAND);
    return contenders[Math.floor(Math.random() * contenders.length)];
}

// Pick the farm OWUI should use: the user's pinned choice, else the current one
// if still good (sticky — avoids flapping between equivalents), else the
// least-loaded healthy farm (spreads a fleet of clients across the boxes).
function chooseActive(farms: DiscoveredFarm[]): DiscoveredFarm | null {
    const sel = loadSettings().selectedFarmId;
    if (sel) { const f = farms.find((x) => x.id === sel && x.healthy && !x._stale); if (f) return f; }
    if (activeFarmId) { const f = farms.find((x) => x.id === activeFarmId && x.healthy && !x._stale); if (f) return f; }
    // Cold boot on a multi-farm LAN: stay with LAST session's farm while it's
    // healthy. The boot sidecar was already started against its endpoint
    // (lastEndpoint), so re-rolling the load dice here would repoint — a full
    // second OWUI boot — for no gain. Load-aware spreading still applies to
    // first-ever connects and to failover (this farm gone/unhealthy).
    if (currentEndpoint) {
        const f = farms.find((x) => x.healthy && !x._stale && farmEndpoint(x) === currentEndpoint);
        if (f) return f;
    }
    return pickLeastLoaded(farms);
}

// Discovery update → forward to the renderer + auto-connect to the active farm.
function onFarms(payload: { farms: DiscoveredFarm[] } & Record<string, unknown>): void {
    if (win && !win.isDestroyed()) win.webContents.send('farms', payload);
    if (!booted || process.env.LOL_ENDPOINT) return; // pinned endpoint: discovery is informational only
    const chosen = chooseActive(payload.farms);
    if (!chosen) return;
    // Honor the farm's client-plugin recommendations (Blender) — independent of the
    // endpoint change-check below, since recommendations can change on a stable endpoint.
    applyFarmRecommendations(chosen);
    const endpoint = farmEndpoint(chosen);
    const model = farmDefaultModel(chosen);
    const searxng = farmSearxng(chosen);
    const tts = farmTts(chosen);
    const extract = farmExtract(chosen);
    if (endpoint !== currentEndpoint || model !== currentModel || searxng !== currentSearxng
        || JSON.stringify(tts) !== JSON.stringify(currentTts)
        || JSON.stringify(extract) !== JSON.stringify(currentExtract)) {
        currentEndpoint = endpoint;
        currentModel = model;
        currentSearxng = searxng;
        currentTts = tts;
        currentExtract = extract;
        activeFarmId = chosen.id;
        // Persist the whole farm context, not just the endpoint — it seeds the next
        // cold launch so the first sidecar boot is already correctly configured and
        // the first beacon doesn't force a restart (see ShellSettings.lastFarmModel).
        updateSettings({ lastEndpoint: endpoint, lastFarmModel: model, lastFarmSearxng: searxng, lastFarmTts: tts, lastFarmExtract: extract });
        // Keyless LAN proxy for now; a keyed farm (requiresKey) needs a key-entry
        // UX we haven't built, so we don't send a (wrong) placeholder key. The farm's
        // default model + SearXNG + TTS + OCR ride along so OWUI auto-selects the model
        // and gets web search + neural voice + document OCR, all with zero clicks.
        // No-OWUI build: record the endpoint only — repoint would (re)start the OWUI
        // sidecar, which this build must never run even where one is installed.
        if (OWUI_ENABLED) sidecar.repoint(endpoint, null, model, searxng, tts, extract);
        else sidecar.pointTo(endpoint);
    }
}

// Local Blender assistant-tools server (mcpo) state → forward to the renderer. The
// renderer registers/unregisters the tool server via OWUI's SUPPORTED API (POST
// /api/v1/users/user/settings/update, writing ui.toolServers) from the authed webview when ready /
// stopped — the sidecar is NOT restarted (env-configured tool servers are
// unreliable upstream; see configBridge + app.js seedBlenderToolServer).
function onMcpoState(s: McpoState): void {
    if (win && !win.isDestroyed()) win.webContents.send('blender-state', { ...s, enabled: mcpo.isEnabled() });
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

// First-run / update download progress for the OWUI sidecar.
function pushSidecarInstall(p: SidecarProgress): void {
    if (win && !win.isDestroyed()) win.webContents.send('sidecar-install', p);
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
    configureWebviewPermissions();

    // Keep external links (OWUI "Powered by" etc.) in the system browser, not in
    // a new Electron window.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
}

// Grant the embedded OWUI <webview> the permissions it needs. Electron DENIES these
// by default for a partition, which is why (a) voice mode silently did nothing —
// the MICROPHONE (getUserMedia) was blocked — and (b) OWUI's "copy" buttons didn't
// reach the system clipboard: `navigator.clipboard.writeText` requests the
// `clipboard-sanitized-write` permission, which our handler was refusing. The
// webview runs on the `persist:owui` partition over loopback (127.0.0.1 = a secure
// context), so these APIs are otherwise available; we scope the grant to that
// partition and to this explicit allow-list, not app-wide.
const OWUI_ALLOWED_PERMS = new Set([
    'media', 'audioCapture', 'videoCapture',      // voice / camera
    'clipboard-read', 'clipboard-sanitized-write', // OWUI copy buttons → system clipboard
]);
function configureWebviewPermissions(): void {
    const ses = session.fromPartition('persist:owui');
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
        callback(OWUI_ALLOWED_PERMS.has(permission));
    });
    // Some Chromium code paths consult the synchronous check handler instead of
    // firing a request; keep the two in lockstep so the mic isn't half-granted.
    ses.setPermissionCheckHandler((_wc, permission) => OWUI_ALLOWED_PERMS.has(permission));
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
        await sidecar.start({ endpoint: currentEndpoint, dataDir: resolveDataDir(), defaultModel: currentModel, searxngUrl: currentSearxng, tts: currentTts, extract: currentExtract });
        return sidecar.getState();
    });

    // --- local Blender assistant-tools server (mcpo) ---
    // Toggling this installs (first time) + runs a local mcpo that exposes the
    // Blender MCP server to OWUI. Non-blocking: the install/start progress streams
    // to the renderer over 'blender-state', and onMcpoState repoints OWUI when ready.
    ipcMain.handle('get-blender-state', () => ({ ...mcpo.getState(), enabled: mcpo.isEnabled(), blenderPort: mcpo.getBlenderPort() }));
    // The renderer registers the tool server with OWUI itself (authed webview API);
    // it needs the local mcpo url + bearer key. Null until mcpo is ready.
    ipcMain.handle('get-blender-connection', () => mcpo.getConnection());
    ipcMain.handle('set-blender-enabled', (_e, on: boolean) => {
        const v = !!on;
        // Mark it a user choice so a farm's Blender recommendation won't override it.
        updateSettings({ blenderMcp: v, blenderMcpUserSet: true });
        mcpo.setEnabled(v);
        return { ...mcpo.getState(), enabled: v };
    });
    // Change the Blender add-on socket port (must match the number the add-on shows).
    // Persists + restarts mcpo so blender-mcp reconnects on the new BLENDER_PORT.
    ipcMain.handle('set-blender-port', (_e, port: number) => {
        const p = Math.max(1, Math.min(65535, Math.floor(Number(port)) || 9876));
        updateSettings({ blenderPort: p });
        mcpo.setBlenderPort(p);
        return p;
    });
    // Test the two hops: (1) the local mcpo proxy serves its OpenAPI spec (tools),
    // (2) something is actually listening on the Blender add-on socket port. Lets the
    // user tell "proxy not up" from "Blender add-on not started / wrong port" at a glance.
    ipcMain.handle('test-blender-connection', async () => {
        const port = mcpo.getBlenderPort();
        const conn = mcpo.getConnection();
        let mcpoUp = false, toolCount = 0;
        if (conn) {
            try {
                const r = await httpGet(`${conn.url}/openapi.json`, 2500);
                mcpoUp = r.status === 200;
                if (mcpoUp) { try { toolCount = Object.keys(JSON.parse(r.body).paths || {}).length; } catch { /* not JSON */ } }
            } catch { /* mcpoUp stays false */ }
        }
        const blenderReachable = await tcpProbe('127.0.0.1', port, 1500);
        return { mcpoUp, blenderReachable, port, toolCount, enabled: mcpo.isEnabled() };
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
            sidecarInstalled: isSidecarInstalled(),
            scanRange: discovery?.getScanRange() ?? null,
            manualPeers: discovery?.getManualPeers() ?? [],
            autoScan: discovery?.getAutoScan() ?? true,
            endpoint: currentEndpoint,
            blenderMcp: s.blenderMcp,
            blenderPort: s.blenderPort,
            blenderState: mcpo.getState(),
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
        // Re-thread the farm's model + SearXNG + TTS + OCR so a data-folder change
        // doesn't drop web search / the default model / voice / OCR (they'd reset to
        // null otherwise, and the no-op change-check in onFarms would never repoint to
        // restore them).
        await sidecar.start({ endpoint: currentEndpoint, dataDir: result.ok ? newDir : oldDir, defaultModel: currentModel, searxngUrl: currentSearxng, tts: currentTts, extract: currentExtract });
        return result;
    });

    ipcMain.handle('set-launch-at-login', (_e, on: boolean) => {
        const v = !!on;
        updateSettings({ launchAtLogin: v });
        try { app.setLoginItemSettings({ openAtLogin: v }); } catch { /* unsupported platform */ }
        return v;
    });

    ipcMain.handle('set-auto-update', (_e, on: boolean) => {
        const v = updateSettings({ autoUpdate: !!on }).autoUpdate;
        if (v) initAutoUpdate(true); // start checking now if just enabled
        return v;
    });

    // --- sidecar install + updates (small installer / download-on-first-run) ---
    // Retry the first-run sidecar download (the install-error overlay's button),
    // then resume the boot that was aborted (resolve endpoint + start OWUI).
    ipcMain.handle('install-sidecar', async () => {
        const res = await ensureSidecar(pushSidecarInstall);
        if (!res.ok) return res;
        let initial = resolveEndpoint();
        if (!initial) initial = await waitForFirstFarm(4500);
        currentEndpoint = initial;
        const activeNow = discovery?.getFarms().find((f) => f.id === activeFarmId) ?? null;
        currentModel = farmDefaultModel(activeNow);
        currentSearxng = farmSearxng(activeNow);
        currentTts = farmTts(activeNow);
        currentExtract = farmExtract(activeNow);
        booted = true;
        sidecar.start({ endpoint: initial, dataDir: resolveDataDir(), defaultModel: currentModel, searxngUrl: currentSearxng, tts: currentTts, extract: currentExtract });
        return res;
    });
    // App self-update (electron-updater). check → status; install → quitAndInstall.
    ipcMain.handle('check-app-update', () => checkForAppUpdate());
    ipcMain.handle('install-app-update', () => { quitAndInstallUpdate(); return true; });
    // OWUI (sidecar) update — independent of the app binary. check → versions;
    // download → stage to userData/sidecar.pending (applied on next launch).
    ipcMain.handle('check-owui-update', () => checkOwuiUpdate());
    ipcMain.handle('download-owui-update', () =>
        downloadOwuiUpdate((p) => { if (win && !win.isDestroyed()) win.webContents.send('owui-update-progress', p); }));
    // Relaunch the app (applies a staged OWUI update via applyPendingSidecar at boot).
    ipcMain.handle('relaunch-app', () => { app.relaunch(); app.quit(); return true; });

    // User pins a specific farm → persist + repoint immediately.
    ipcMain.handle('select-farm', (_e, farmId: string | null) => {
        updateSettings({ selectedFarmId: farmId });
        const farms = discovery?.getFarms() ?? [];
        const chosen = chooseActive(farms);
        if (chosen) {
            const endpoint = farmEndpoint(chosen);
            currentEndpoint = endpoint;
            currentModel = farmDefaultModel(chosen);
            currentSearxng = farmSearxng(chosen);
            currentTts = farmTts(chosen);
            currentExtract = farmExtract(chosen);
            activeFarmId = chosen.id;
            updateSettings({ lastEndpoint: endpoint });
            // Keyless LAN proxy for now; a keyed farm (requiresKey) needs a key-entry
            // UX we haven't built, so we don't send a (wrong) placeholder key. Thread
            // the pinned farm's model + SearXNG + TTS + OCR so pinning doesn't drop
            // DEFAULT_MODELS / web search / voice / OCR (and leave the globals stale so
            // onFarms never restores them).
            sidecar.repoint(endpoint, null, currentModel, currentSearxng, currentTts, currentExtract);
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
                    // Optionally resize before capturing — verifies the <webview>
                    // re-layouts (the guest viewport must track the element on resize).
                    const resize = process.env.LOL_SMOKE_RESIZE; // "WxH"
                    if (resize && /^\d+x\d+$/.test(resize)) {
                        const [w, h] = resize.split('x').map(Number);
                        win.setContentSize(w, h);
                        await new Promise((r) => setTimeout(r, 1800));
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
    mcpo.on('state', onMcpoState);
    maybeSmokeShot();

    // Apply a staged OWUI update (downloaded last run) BEFORE anything uses the
    // sidecar — the old OWUI is stopped now, so its files aren't locked (Windows).
    // No sidecar in this build — nothing staged, nothing to apply.
    if (OWUI_ENABLED) applyPendingSidecar();

    setUpdateNotifier((version) => { if (win && !win.isDestroyed()) win.webContents.send('app-update-downloaded', { version }); });
    initAutoUpdate(settings.autoUpdate); // no-op in dev / when disabled

    // Start LAN discovery (beacon listener + sweep + manual peers).
    discovery = new Discovery({ manualPeers: settings.manualPeers, autoScan: settings.autoScan, scanRange: settings.scanRange });
    discovery.on('farms', onFarms);
    discovery.start();
    startClientHeartbeat(); // presence pings to the active farm's admin panel

    // First run of a packaged build: the OWUI sidecar isn't bundled — download it
    // (with progress to the renderer) before starting it. Dev / already-installed
    // returns immediately.
    // Skipped entirely when OWUI is not part of this build: no several-hundred-MB
    // sidecar download on first run, which is most of the client's install weight.
    if (OWUI_ENABLED && app.isPackaged && !isSidecarInstalled()) {
        const res = await ensureSidecar(pushSidecarInstall);
        if (!res.ok) return; // install-error overlay stays up; "Retry" re-runs install-sidecar
    }

    // Decide the initial endpoint. If none known, give discovery a short grace
    // period to find a farm so we boot OWUI pointed at it the first time (no
    // restart). Then `onFarms` keeps it repointed as the LAN changes.
    let initial = resolveEndpoint();
    if (!initial) initial = await waitForFirstFarm(4500);
    currentEndpoint = initial;
    // If discovery already identified the active farm, boot OWUI with its default
    // model + SearXNG pre-wired. Otherwise fall back to the PERSISTED context from
    // the last session (saved alongside lastEndpoint): booting with nulls here
    // guaranteed the first beacon differed from current*, which forced a repoint —
    // i.e. a full second OWUI boot on nearly every cold launch. With the persisted
    // context, an unchanged farm confirms what we booted with and OWUI starts ONCE;
    // a genuinely changed farm still repoints exactly as before.
    const activeNow = discovery?.getFarms().find((f) => f.id === activeFarmId) ?? null;
    currentModel = activeNow ? farmDefaultModel(activeNow) : settings.lastFarmModel;
    currentSearxng = activeNow ? farmSearxng(activeNow) : settings.lastFarmSearxng;
    currentTts = activeNow ? farmTts(activeNow) : settings.lastFarmTts;
    currentExtract = activeNow ? farmExtract(activeNow) : settings.lastFarmExtract;
    booted = true;
    // LOL Chat talks straight to the farm's OpenAI endpoint, so there is no local
    // process to supervise — discovery alone is enough to be usable.
    if (OWUI_ENABLED) {
        sidecar.start({ endpoint: initial, dataDir: resolveDataDir(), defaultModel: currentModel, searxngUrl: currentSearxng, tts: currentTts, extract: currentExtract });
    } else {
        sidecar.pointTo(initial);
    }

    // Blender assistant tools are OPT-IN (off by default since v0.1.24): enabling it
    // in Settings — or a farm recommendation — brings mcpo up in the background
    // (first launch installs it, ~1 min); when ready the renderer registers the tool
    // server with OWUI via its API — no sidecar restart. One-time migration: installs
    // that carry the old on-by-default WITHOUT an explicit user choice
    // (blenderMcpUserSet=false) adopt the new default; an explicit choice is kept.
    let blenderOn = settings.blenderMcp;
    if (blenderOn && !settings.blenderMcpUserSet) {
        updateSettings({ blenderMcp: false });
        blenderOn = false;
    }
    mcpo.setBlenderPort(settings.blenderPort);
    if (blenderOn) mcpo.setEnabled(true);

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

let quitting = false;
app.on('before-quit', async (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    discovery?.stop();
    await Promise.allSettled([sidecar.stop(), mcpo.stop()]);
    app.exit(0);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
