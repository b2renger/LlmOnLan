// LlmOnLan shell — Electron main process entry.
//
// Boots the window with ComfyQ-styled chrome, supervises the bundled Open WebUI
// sidecar (pointed at the farm via config-bridge), and loads it in a <webview>.
// Discovery (M3) and full Preferences (M4) layer onto this skeleton.

import { app, BrowserWindow, ipcMain, shell, nativeTheme, dialog, session, powerMonitor, Session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { pathToFileURL } from 'url';
import { loadSettings, updateSettings } from './store';
import { defaultDataDir, bundledOwuiVersion, sidecarRoot } from './paths';
import { SidecarSupervisor } from './sidecar';
import { McpoSupervisor } from './mcpoSupervisor';
import { httpGet, tcpProbe } from './util';
import { Discovery } from './discovery';
import { moveDataDir, dirHasData } from './dataMigration';
import { clientDataDir, prepareClientData, isInside, CLIENT_DIR_NAME, ClientDataNotice } from './clientData';
import { initAutoUpdate, checkForAppUpdate, quitAndInstallUpdate, setUpdateNotifier } from './updater';
import { OWUI_ENABLED } from './clientMode';
import {
    ensureSidecar, applyPendingSidecar, isSidecarInstalled,
    checkOwuiUpdate, downloadOwuiUpdate, SidecarProgress,
} from './sidecarManager';
import { ShellSettings, DiscoveredFarm, ScanRange, McpoState } from './types';
import {
    farmEndpoint, chooseActive as pickActive, farmContext, sameContext, persistedContext, FarmContext,
} from './farmSelect';

app.setName('LlmOnLan');

// Default the UI to English. OWUI's frontend picks its language from the webview's
// navigator.language (the OS locale), so we set Chromium's locale to en-US — that
// makes English the default the i18n detector sees. It's still only a DEFAULT: a
// user who picks another language in OWUI's settings overrides it (that choice is
// cached in localStorage, which beats navigator). Must be set before app 'ready'.
app.commandLine.appendSwitch('lang', 'en-US');

// Single-instance: a second launch focuses the existing window.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
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
let currentCtxPerSlot: number | null = null; // active farm's per-slot context (→ whole-doc vs top-k RAG)
let currentKey: string | null = null; // the password OWUI was launched with for the active farm (null = open farm)
let activeFarmId: string | null = null;
let booted = false; // true once the initial sidecar start has been kicked off

// ---- LOL Studio (S0) ---- (the Computer's debug log, COMPUTER_PLAN addendum KG; mirrored in chat-harness/main.cjs)
// ONE recorder for the app, created on first use. Its folder is fixed HERE: the renderer never
// names a path. createWindow() reports a crashed or hung renderer into the open recording, because
// the renderer cannot do that for itself, and registerIpc() wires the lol:debugLog:* channels.
const { createDebugLog } = require('./debugLog') as typeof import('./debugLog');
let computerLog: ReturnType<typeof createDebugLog> | null = null;
function debugLog(): ReturnType<typeof createDebugLog> {
    if (!computerLog) {
        computerLog = createDebugLog({
            dir: path.join(app.getPath('userData'), 'logs', 'computer'),
            facts: () => ({
                app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
                node: process.versions.node, platform: process.platform, arch: process.arch, os: os.release(),
                cpus: os.cpus().length, ramGB: Math.round(os.totalmem() / 2 ** 30),
            }),
            capture: async () => {
                if (!win || win.isDestroyed()) return null;
                const img = await win.webContents.capturePage();
                return img.isEmpty() ? null : img.toPNG();
            },
            shellApi: {
                showItemInFolder: (target: string) => shell.showItemInFolder(target),
                openPath: (target: string) => shell.openPath(target),
            },
        });
    }
    return computerLog;
}
// `before-quit`, not `will-quit`: the shell's own before-quit handler ends in app.exit(0), which
// never emits will-quit. A beat of delay lets the page's last lines (sent from its pagehide as the
// window closes) land first; the handler below waits for the sidecar for longer than that.
app.on('before-quit', () => {
    const log = computerLog;
    if (log) setTimeout(() => log.close('quit'), 250);
});
// ---- /LOL Studio ----

// Single place that records which farm is active, so discovery's fast poll always
// follows it (see ACTIVE_POLL_MS). Assigning activeFarmId directly is how the two
// drifted apart before.
function setActiveFarm(id: string | null): void {
    activeFarmId = id;
    discovery?.setActiveFarm(id);
}

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

// --- the client's own data, in DATA_DIR ---------------------------------------
// Owner rule 2026-09-27: ALL data lives in the data folder — LOL Chat's history and the
// Computer's graphs and media too, not only OWUI's. Those are the main window's Chromium
// storage (IndexedDB `lol-chat` + localStorage), so the window runs on a session rooted in
// <DATA_DIR>/lol-client instead of the default session under userData (clientData.ts).
// The OWUI <webview> keeps its own `persist:owui` partition under userData: that is a global
// partition whatever the embedder's session, and it holds only OWUI's token and caches.
//
// The file work runs HERE, at module load: before app 'ready', before any session exists, so
// Chromium holds none of these files yet — (1) a Preferences move saved by the last run,
// (2) a DATA_DIR that cannot be written falls back to <userData>/lol-client, (3) a history
// such a fallback kept is brought back, (4) the one-time import of a v0.1.x profile.
// A second instance (no lock) touches nothing.
let clientDir: string | null = null;          // where the main window's session lives; null = the default session
let clientSession: Session | null = null;     // created on first use, after 'ready'
let clientNotices: ClientDataNotice[] = [];   // told to the user once the window asks (get-data-notices)

function clientDataLog(lines: string[]): void {
    if (!lines.length) return;
    for (const l of lines) console.log('[client-data]', l);
    try {
        const dir = path.join(app.getPath('userData'), 'logs');
        fs.mkdirSync(dir, { recursive: true });
        const at = new Date().toISOString();
        fs.appendFileSync(path.join(dir, 'client-data.log'), lines.map((l) => `${at} ${l}\n`).join(''));
    } catch { /* the log is a convenience */ }
}

function prepareClientDataAtBoot(): void {
    const sleepSync = (ms: number) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no wait */ } };
    try {
        const s = loadSettings();
        const plan = prepareClientData({
            userDataDir: app.getPath('userData'),
            dataDir: resolveDataDir(),
            settings: {
                pendingClientMove: s.pendingClientMove ?? null,
                legacyClientDataImported: !!s.legacyClientDataImported,
                legacyClientDataStamp: s.legacyClientDataStamp ?? null,
            },
            save: (patch) => { updateSettings(patch); },
            // The last run may still be letting go of its files for a moment after a relaunch.
            attempts: 6,
            sleep: sleepSync,
        });
        clientDir = plan.dir;
        clientNotices = plan.notices;
        clientDataLog(plan.log.concat(`session: ${plan.dir ?? 'default (userData)'}`));
    } catch (e) {
        // Never lose data silently: the default session still holds whatever it held.
        clientDir = null;
        clientNotices = [{ level: 'warn', text: `LlmOnLan could not open its data folder (${(e as Error).message}). This session uses the app's own folder.` }];
        clientDataLog([`prepare failed: ${(e as Error).message}; using the default session`]);
    }
}
if (gotSingleInstanceLock) prepareClientDataAtBoot();

// The main window's session (after 'ready'). `cache: false`: the window loads file:// only and
// talks to the farm with streaming requests, so an HTTP cache in the data folder buys nothing.
function mainWindowSession(): Session | undefined {
    if (!clientDir) return undefined;
    if (!clientSession) {
        try {
            clientSession = session.fromPath(clientDir, { cache: false });
        } catch (e) {
            clientDataLog([`session.fromPath(${clientDir}) failed: ${(e as Error).message}; using the default session`]);
            clientNotices.push({ level: 'warn', text: `LOL Chat could not open ${clientDir} (${(e as Error).message}). This session uses the app's own folder.` });
            clientDir = null;
            return undefined;
        }
    }
    return clientSession;
}

// Restart the app after a data-folder change: the next boot moves the client session (see
// above). The user confirmed the change in Preferences, so the "Quit LlmOnLan?" prompt is
// skipped the way "Restart & install" skips it. A beat of delay lets the renderer show it.
function relaunchForDataDir(): void {
    quitConfirmed = true;
    setTimeout(() => { app.relaunch(); app.quit(); }, 900);
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

// The stored password for a keyed farm (null when open, or none entered yet).
function farmKey(f: { id: string; requiresKey?: boolean } | null): string | null {
    if (!f || !f.requiresKey) return null;
    return loadSettings().farmKeys?.[f.id] || null;
}

// A farm we cannot AUTHENTICATE to is not a candidate for auto-connect —
// pointing OWUI at it would just loop 401s. It stays in the list with a lock;
// entering its password there makes it eligible.
function farmUsable(f: DiscoveredFarm): boolean {
    return !(f as { requiresKey?: boolean }).requiresKey || !!farmKey(f as { id: string; requiresKey?: boolean });
}

// Async check that a stored farm password still works; wrong → forget it, so
// selection skips the farm and its card re-prompts. Rate-limited per farm so
// the beacon cadence cannot turn this into a request storm.
const keyCheckAt = new Map<string, number>();
function verifyStoredFarmKey(f: DiscoveredFarm, key: string): void {
    const last = keyCheckAt.get(f.id) || 0;
    if (Date.now() - last < 60000) return;
    keyCheckAt.set(f.id, Date.now());
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    fetch(`${farmEndpoint(f)}/models`, { headers: { authorization: `Bearer ${key}` }, signal: ctrl.signal })
        .then((res) => {
            if (res.ok) return;
            const s = loadSettings();
            const next = { ...(s.farmKeys || {}) };
            delete next[f.id];
            updateSettings({ farmKeys: next, lastFarmKey: s.lastFarmKey === key ? null : s.lastFarmKey });
            if (discovery) onFarms({ farms: discovery.getFarms() });
        })
        .catch(() => { /* unreachable ≠ wrong password — keep the key */ })
        .finally(() => clearTimeout(t));
}

// Pick the farm OWUI should use (farmSelect.ts holds the rules): the user's pin, else
// the current farm while it is healthy, else last session's, else the least busy.
function chooseActive(farms: DiscoveredFarm[]): DiscoveredFarm | null {
    return pickActive(farms, {
        selectedFarmId: loadSettings().selectedFarmId,
        activeFarmId,
        currentEndpoint,
        usable: farmUsable,
    });
}

// What OWUI is running with right now, in farmContext()'s shape (null before any farm).
function currentContext(): FarmContext | null {
    if (currentEndpoint == null) return null;
    return {
        endpoint: currentEndpoint, key: currentKey, model: currentModel, searxng: currentSearxng,
        tts: currentTts, extract: currentExtract, ctxPerSlot: currentCtxPerSlot,
    };
}

// Point OWUI at `chosen` — the ONE path for both discovery's auto-connect and the user's
// pin. The whole context (password included) is compared and persisted together: the pin
// path used to save only lastEndpoint and to leave the password out of the change check,
// so a pinned keyed farm cold-booted with the previous farm's password (docs review SA-4).
function connectTo(chosen: DiscoveredFarm): void {
    setActiveFarm(chosen.id);
    const next = farmContext(chosen, farmKey(chosen as { id: string; requiresKey?: boolean }));
    if (sameContext(next, currentContext())) return;
    currentEndpoint = next.endpoint;
    currentKey = next.key;
    currentModel = next.model;
    currentSearxng = next.searxng;
    currentTts = next.tts;
    currentExtract = next.extract;
    currentCtxPerSlot = next.ctxPerSlot;
    // Persist the whole farm context, not just the endpoint — it seeds the next
    // cold launch so the first sidecar boot is already correctly configured and
    // the first beacon doesn't force a restart (see ShellSettings.lastFarmModel).
    updateSettings(persistedContext(next));
    // A keyed farm connects with its stored password (farmKey); an open farm sends none. The
    // default model + SearXNG + TTS + OCR ride along so OWUI auto-selects the model
    // and gets web search + neural voice + document OCR, all with zero clicks.
    // No-OWUI build: record the endpoint only — repoint would (re)start the OWUI
    // sidecar, which this build must never run even where one is installed.
    if (OWUI_ENABLED) sidecar.repoint(next.endpoint, next.key, next.model, next.searxng, next.tts, next.extract, next.ctxPerSlot);
    else sidecar.pointTo(next.endpoint);
}

// Discovery update → forward to the renderer + auto-connect to the active farm.
function onFarms(payload: { farms: DiscoveredFarm[] } & Record<string, unknown>): void {
    // Decorate for the renderer: which keyed farms already have a stored password
    // (the card shows a lock + input for the others), and the key itself so LOL
    // Chat can authenticate its direct fetches. Same-user process boundary — the
    // password was typed in this very app. `selectedFarmId` marks the pinned card and
    // lights the "Automatic" row when nothing is pinned.
    const decorated = {
        ...payload,
        farms: payload.farms.map((f) => {
            const k = farmKey(f as { id: string; requiresKey?: boolean });
            return { ...f, _hasKey: !!k, _key: k };
        }),
        selectedFarmId: loadSettings().selectedFarmId,
    };
    if (win && !win.isDestroyed()) win.webContents.send('farms', decorated);
    if (!booted || process.env.LOL_ENDPOINT) return; // pinned endpoint: discovery is informational only
    const chosen = chooseActive(payload.farms);
    if (!chosen) return;
    // Rotation detection must not hide inside the context-CHANGED check: the operator
    // rotating the password changes nothing in that comparison, and the stored key
    // silently 401-loops. Verify on every beacon — verifyStoredFarmKey rate-limits
    // itself to one probe per farm per minute. A wrong key is dropped, the farm falls
    // out of auto-connect and its card grows the password prompt again.
    {
        const k = farmKey(chosen as { id: string; requiresKey?: boolean });
        if (k) verifyStoredFarmKey(chosen as DiscoveredFarm, k);
    }
    // Honor the farm's client-plugin recommendations (Blender) — independent of the
    // context change-check, since recommendations can change on a stable endpoint.
    applyFarmRecommendations(chosen);
    connectTo(chosen);
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
            if (f) { setActiveFarm(f.id); return resolve(farmEndpoint(f)); }
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
    const clientSes = mainWindowSession();
    win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#09090b',
        title: 'LlmOnLan',
        icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
        show: true,
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload', 'index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true, // the main area embeds OWUI in a <webview>
            // LOL Chat + the Computer keep their data in this session: <DATA_DIR>/lol-client.
            ...(clientSes ? { session: clientSes } : {}),
        },
    });
    win.removeMenu();
    win.loadFile(path.join(app.getAppPath(), 'renderer', 'index.html'));
    win.webContents.on('did-finish-load', pushSidecarState);

    // ---- LOL Studio (S0) ---- (navigation veto; mirrored in shell/test/chat-harness/main.cjs)
    // The sandbox runner (S2) is a SUBFRAME: it may load itself once and must never navigate
    // again, whatever the guest code tries. The app's own main-frame navigation is unaffected.
    //
    // EXACT MATCH, not a substring test (S0 review, finding 3). A regex over the whole URL also
    // matched .../LOL Studio Projects/<id>/sandbox/runner.html — a two-segment .html path the
    // projects API happily writes — so a project could host its own "runner" and the veto would
    // wave it through. Only the app's own file is allowed, compared after query/hash are stripped.
    const RUNNER_URL = pathToFileURL(path.join(app.getAppPath(), 'renderer', 'chat', 'sandbox', 'runner.html')).href;
    const bareUrl = (u: string) => u.split('#')[0].split('?')[0];
    win.webContents.on('will-frame-navigate', (e) => {
        if (e.isMainFrame) return;
        if (bareUrl(String(e.url || '')) === RUNNER_URL) return;
        e.preventDefault();
    });
    // ---- /LOL Studio ----

    // ---- LOL Studio (S0) ---- (the Computer's debug log: what the renderer cannot write itself)
    // note() writes only while a recording is open, and synchronously: the renderer may be gone.
    win.webContents.on('render-process-gone', (_e, d) => {
        if (computerLog) computerLog.note({ k: 'main.renderer-gone', reason: d.reason, exitCode: d.exitCode });
    });
    win.webContents.on('preload-error', (_e, _p, error) => {
        if (computerLog) computerLog.note({ k: 'main.preload-error', message: String(error && error.message) });
    });
    win.on('unresponsive', () => { if (computerLog) computerLog.note({ k: 'main.unresponsive' }); });
    win.on('responsive', () => { if (computerLog) computerLog.note({ k: 'main.responsive' }); });
    // ---- /LOL Studio ----

    configureWebviewPermissions();
    // Closing the window closes EVERYTHING (owner decision 2026-09-04): no
    // hide-to-tray, no background sidecar, no lingering farm presence. A client
    // that keeps heartbeating after "close" still looks connected on the farm
    // and holds a seat other people could use — incompatible with how the farm
    // shares slots. The close falls through to window-all-closed → app.quit()
    // → before-quit, which stops the sidecar/mcpo gracefully (data flushed)
    // before the process exits. (This replaces the keep-warm/tray behavior that
    // shipped v0.1.x–v0.1.43; reopening now pays the ~10-20 s OWUI boot again.)
    //
    // And ASK first (owner ask 2026-09-10). Quitting is now genuinely
    // destructive of time — the next launch pays the OWUI boot again — so the X
    // deserves the same confirmation any other irreversible button would get.
    // The prompt is skipped for quits the user already confirmed elsewhere
    // (the updater's "Restart & install", the OWUI-update relaunch).
    win.on('close', (e) => {
        if (quitting || quitConfirmed || !win) return;
        e.preventDefault();
        const { response } = dialog.showMessageBoxSync
            ? { response: dialog.showMessageBoxSync(win, {
                type: 'question',
                buttons: ['Quit', 'Cancel'],
                defaultId: 0,
                cancelId: 1,
                title: 'Quit LlmOnLan',
                message: 'Quit LlmOnLan?',
                detail: 'This stops the chat engine and frees your seat on the server. '
                    + 'Your chats and documents stay on this machine. Opening the app again takes a few seconds while the engine restarts.',
                noLink: true,
            }) }
            : { response: 0 };
        if (response !== 0) return;      // Cancel — stay open, nothing stopped
        quitConfirmed = true;
        app.quit();                      // → before-quit does the cleanup
    });

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

    // ---- LOL Studio (S0) ---- (the scratch-projects API, studio plan 3.8; reviewed separately)
    // The projects root is computed HERE, in main, from the shell's own data folder: the renderer
    // never sends an absolute path and only ever learns the string back from root()/path(), for
    // display and "Copy path". The API is re-created when the user moves the data folder, so the
    // projects follow it without a relaunch.
    //
    // Every handler checks arity and argument TYPES before the call, so a compromised renderer
    // still cannot hand write() a number. What is deliberately NOT here: any absolute path as an
    // input, directory creation/removal as such, openExternal, vscode://, child_process, watching.
    const { createProjectsApi } = require('./projects') as typeof import('./projects');
    type ProjectsApi = ReturnType<typeof createProjectsApi>;
    let projectsApi: ProjectsApi | null = null;
    let projectsRoot = '';
    function projects(): ProjectsApi {
        const rootDir = path.join(resolveDataDir(), 'LOL Studio Projects');
        if (!projectsApi || projectsRoot !== rootDir) {
            projectsRoot = rootDir;
            projectsApi = createProjectsApi({
                rootDir,
                shellApi: {
                    showItemInFolder: (target: string) => shell.showItemInFolder(target),
                    openPath: (target: string) => shell.openPath(target),
                },
            });
        }
        return projectsApi;
    }
    const badArgs = Promise.resolve({ ok: false, code: 'E_PATH', message: 'bad arguments' });
    const isStr = (v: unknown): v is string => typeof v === 'string';
    const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

    ipcMain.handle('lol:projects:root', () => projects().root());
    ipcMain.handle('lol:projects:list', () => projects().list());
    ipcMain.handle('lol:projects:create', (_e, input: unknown) => (
        isObj(input) && isStr(input.name) && isStr(input.kind)
            ? projects().create(input as never) : badArgs));
    ipcMain.handle('lol:projects:meta', (_e, id: unknown) => (isStr(id) ? projects().meta(id) : badArgs));
    ipcMain.handle('lol:projects:update', (_e, id: unknown, patch: unknown) => (
        isStr(id) && isObj(patch) ? projects().update(id, patch as never) : badArgs));
    ipcMain.handle('lol:projects:forget', (_e, id: unknown) => (isStr(id) ? projects().forget(id) : badArgs));
    ipcMain.handle('lol:projects:listFiles', (_e, id: unknown) => (isStr(id) ? projects().listFiles(id) : badArgs));
    ipcMain.handle('lol:projects:read', (_e, id: unknown, rel: unknown) => (
        isStr(id) && isStr(rel) ? projects().read(id, rel) : badArgs));
    ipcMain.handle('lol:projects:readBinary', (_e, id: unknown, rel: unknown) => (
        isStr(id) && isStr(rel) ? projects().readBinary(id, rel) : badArgs));
    ipcMain.handle('lol:projects:write', (_e, id: unknown, rel: unknown, text: unknown, o: unknown) => {
        if (!isStr(id) || !isStr(rel) || !isStr(text)) return badArgs;
        const ifMtime = isObj(o) && typeof o.ifMtime === 'number' ? o.ifMtime : undefined;
        return projects().write(id, rel, text, ifMtime === undefined ? undefined : { ifMtime });
    });
    ipcMain.handle('lol:projects:writeBinary', (_e, id: unknown, rel: unknown, base64: unknown) => (
        isStr(id) && isStr(rel) && isStr(base64) ? projects().writeBinary(id, rel, base64) : badArgs));
    ipcMain.handle('lol:projects:remove', (_e, id: unknown, rel: unknown) => (
        isStr(id) && isStr(rel) ? projects().remove(id, rel) : badArgs));
    ipcMain.handle('lol:projects:reveal', (_e, id: unknown) => (isStr(id) ? projects().reveal(id) : badArgs));
    ipcMain.handle('lol:projects:open', (_e, id: unknown) => (isStr(id) ? projects().open(id) : badArgs));
    ipcMain.handle('lol:projects:path', (_e, id: unknown) => (isStr(id) ? projects().path(id) : badArgs));
    // ---- /LOL Studio ----

    // ---- LOL Studio (S0) ---- (the Computer's debug log, COMPUTER_PLAN addendum KG)
    // Text in, nothing out: no channel reads a file back, and none takes a path. Types are checked
    // here as well as in debugLog.ts, so a garbled call never reaches the fs.
    const badLog = Promise.resolve({ ok: false, code: 'E_ARGS', message: 'bad arguments' });
    ipcMain.handle('lol:debugLog:start', (_e, header: unknown) => (isStr(header) ? debugLog().start(header) : badLog));
    ipcMain.handle('lol:debugLog:append', (_e, text: unknown) => (isStr(text) ? debugLog().append(text) : badLog));
    ipcMain.handle('lol:debugLog:stop', (_e, footer: unknown) => (
        footer === undefined || isStr(footer) ? debugLog().stop(footer) : badLog));
    ipcMain.handle('lol:debugLog:mark', () => debugLog().mark());
    ipcMain.handle('lol:debugLog:reveal', () => debugLog().reveal());
    ipcMain.handle('lol:debugLog:status', () => debugLog().status());
    // ---- /LOL Studio ----

    // Manual reload of the embedded OWUI (e.g. after a repoint).
    ipcMain.handle('reload-webview', () => { pushSidecarState(); return true; });

    // Retry a failed/stopped sidecar (the connection screen's Retry button).
    ipcMain.handle('restart-sidecar', async () => {
        // Preserve the farm password across a manual Retry — start() without
        // apiKey nulls it and a keyed farm then 401-loops (the change-check in
        // onFarms compares globals that did not change, so nothing self-heals).
        const activeF = discovery?.getFarms().find((f) => f.id === activeFarmId) ?? null;
        const retryKey = activeF ? farmKey(activeF as { id: string; requiresKey?: boolean }) : loadSettings().lastFarmKey;
        await sidecar.stop({ keepState: true });
        await sidecar.start({ endpoint: currentEndpoint, dataDir: resolveDataDir(), apiKey: retryKey, defaultModel: currentModel, searxngUrl: currentSearxng, tts: currentTts, extract: currentExtract, contextPerSlot: currentCtxPerSlot });
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
        farms: (discovery?.getFarms() ?? []).map((f) => {
            const k = farmKey(f as { id: string; requiresKey?: boolean });
            return { ...f, _hasKey: !!k, _key: k };
        }),
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

    // Enter a keyed farm's password: VERIFY it against the real endpoint first
    // (a stored-but-wrong password would 401-loop OWUI), store it per farm, then
    // make the farm immediately eligible — selected if the user asked for it.
    ipcMain.handle('set-farm-key', async (_e, payload: { farmId: string; key: string }) => {
        const f = (discovery?.getFarms() ?? []).find((x) => x.id === payload?.farmId);
        if (!f) return { ok: false, error: 'Farm not found — is it still on the network?' };
        const key = String(payload.key || '').trim();
        if (!key) return { ok: false, error: 'Enter the password.' };
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(`${farmEndpoint(f)}/models`, {
                headers: { authorization: `Bearer ${key}` }, signal: ctrl.signal,
            });
            clearTimeout(t);
            // LiteLLM without a DB cannot answer a clean 401 for a wrong key — it
            // tries to look the token up as a virtual key and fails with 400/500
            // (verified live). So: exactly 200 with the key = accepted; anything
            // else on a farm that ANSWERS = the password was not accepted.
            if (!res.ok) return { ok: false, error: 'That password was not accepted.' };
        } catch {
            return { ok: false, error: 'Could not reach the farm to check the password.' };
        }
        const s = loadSettings();
        updateSettings({ farmKeys: { ...(s.farmKeys || {}), [f.id]: key } });
        // Re-run selection so the newly-usable farm connects without another click.
        if (discovery) onFarms({ farms: discovery.getFarms() });
        return { ok: true };
    });

    // --- preferences (M4) ---
    ipcMain.handle('get-prefs', () => {
        const s = loadSettings();
        return {
            dataDir: resolveDataDir(),
            dataDirDefault: defaultDataDir(),
            dataDirIsDefault: !s.dataDir,
            // Where LOL Chat + the Computer actually live this session. It differs from
            // <dataDir>/lol-client only when the data folder could not be used at boot.
            clientDataDir: clientDir,
            clientDataInDataDir: !!clientDir && path.resolve(clientDir) === path.resolve(clientDataDir(resolveDataDir())),
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
    // Either way the app RESTARTS to finish: the client session (<DATA_DIR>/lol-client, LOL Chat
    // + the Computer) is held open by Chromium while the app runs, so 'move' copies OWUI's data
    // now, leaves lol-client where it is, and saves `pendingClientMove` — the next boot moves it
    // before the window opens (prepareClientDataAtBoot). 'fresh' just switches: the old data stays
    // where it was, as OWUI's always has.
    ipcMain.handle('set-data-dir', async (_e, payload: { path: string; mode: 'move' | 'fresh' }) => {
        const oldDir = resolveDataDir();
        const newDir = payload && typeof payload.path === 'string' ? payload.path : '';
        if (!newDir || path.resolve(newDir) === path.resolve(oldDir)) return { ok: false, error: 'Same folder.' };
        if (!path.isAbsolute(newDir)) return { ok: false, error: 'Pick a full folder path.' };
        // A data folder inside the client's own session folder would nest one Chromium profile in another.
        for (const held of [clientDataDir(oldDir), clientDir].filter((d): d is string => !!d)) {
            if (isInside(held, newDir)) return { ok: false, error: `Pick a folder outside ${held}.` };
        }
        const mode = payload.mode === 'move' ? 'move' : 'fresh';
        await sidecar.stop({ keepState: true });
        let result: { ok: boolean; error?: string } = { ok: true };
        if (mode === 'move') result = moveDataDir(oldDir, newDir, { exclude: [CLIENT_DIR_NAME] });
        if (!result.ok) {
            // Nothing moved: OWUI comes back on the old folder, exactly as before.
            // Re-thread the farm's model + SearXNG + TTS + OCR so a failed change doesn't drop
            // web search / the default model / voice / OCR (they'd reset to null otherwise). apiKey
            // rides along or a keyed farm 401-loops — sidecar.start NULLS any field not passed.
            const f = discovery?.getFarms().find((x) => x.id === activeFarmId) ?? null;
            const key = f ? farmKey(f as { id: string; requiresKey?: boolean }) : loadSettings().lastFarmKey;
            if (OWUI_ENABLED) {
                await sidecar.start({ endpoint: currentEndpoint, dataDir: oldDir, apiKey: key, defaultModel: currentModel, searxngUrl: currentSearxng, tts: currentTts, extract: currentExtract, contextPerSlot: currentCtxPerSlot });
            }
            return result;
        }
        // 'move' hands the client session over to the next boot. With no clientDir (this session
        // runs on the default session because the v0.1.x import failed) there is nothing to hand
        // over: that import simply runs again, into the new folder. 'fresh' drops any older
        // pending move, so the data it names stays where it is.
        const pendingClientMove = mode === 'move' && clientDir
            ? { from: clientDir, to: clientDataDir(newDir) }
            : null;
        updateSettings({ dataDir: newDir, pendingClientMove });
        clientDataLog([`data folder ${oldDir} -> ${newDir} (${mode}); ${pendingClientMove ? `client move pending ${pendingClientMove.from} -> ${pendingClientMove.to}` : 'no client move'}; relaunching`]);
        relaunchForDataDir();
        return { ok: true, error: result.error, restarting: true, dataDir: newDir };
    });

    // What happened to the client's data at boot (a move landed, a fallback, an import) — told
    // to the user once, as toasts. Pull, not push: the window may not be listening yet at boot.
    ipcMain.handle('get-data-notices', () => {
        const out = clientNotices;
        clientNotices = [];
        return out;
    });

    ipcMain.handle('set-launch-at-login', (_e, on: boolean) => {
        const v = !!on;
        updateSettings({ launchAtLogin: v });
        // A login start opens the window normally. (--hidden/openAsHidden died
        // with keep-warm: a hidden window with no tray would be unreachable.)
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
        const seed = activeNow ? farmContext(activeNow, farmKey(activeNow as { id: string; requiresKey?: boolean })) : null;
        currentModel = seed ? seed.model : null;
        currentSearxng = seed ? seed.searxng : null;
        currentTts = seed ? seed.tts : null;
        currentExtract = seed ? seed.extract : null;
        currentCtxPerSlot = seed ? seed.ctxPerSlot : null;
        // Same key logic as the cold boot — a keyed farm must come back
        // authenticated after the first-run download too.
        currentKey = seed ? seed.key : loadSettings().lastFarmKey;
        booted = true;
        sidecar.start({
            endpoint: initial, dataDir: resolveDataDir(),
            apiKey: currentKey,
            defaultModel: currentModel, searxngUrl: currentSearxng, tts: currentTts, extract: currentExtract, contextPerSlot: currentCtxPerSlot,
        });
        return res;
    });
    // App self-update (electron-updater). check → status; install → quitAndInstall.
    ipcMain.handle('check-app-update', () => checkForAppUpdate());
    // macOS Squirrel closes the windows before quitting; with close-means-quit
    // there is no close interception left to swallow them (the old keep-warm
    // handler once deadlocked "Restart and reinstall" — live mac report 2026-09-02).
    ipcMain.handle('install-app-update', () => { quitConfirmed = true; quitAndInstallUpdate(); return true; });
    // OWUI (sidecar) update — independent of the app binary. check → versions;
    // download → stage to userData/sidecar.pending (applied on next launch).
    ipcMain.handle('check-owui-update', () => checkOwuiUpdate());
    ipcMain.handle('download-owui-update', () =>
        downloadOwuiUpdate((p) => { if (win && !win.isDestroyed()) win.webContents.send('owui-update-progress', p); }));
    // Relaunch the app (applies a staged OWUI update via applyPendingSidecar at boot).
    ipcMain.handle('relaunch-app', () => { quitConfirmed = true; app.relaunch(); app.quit(); return true; });

    // User pins a specific farm (a card click) → persist + repoint immediately; null
    // unpins ("Automatic — least busy"): the current farm stays while it is healthy
    // (sticky, no needless OWUI restart) and least-busy selection applies again on the
    // next boot or failover. Before this, a pin could never be removed (docs review SA-5).
    ipcMain.handle('select-farm', (_e, farmId: string | null) => {
        updateSettings({ selectedFarmId: typeof farmId === 'string' && farmId ? farmId : null });
        const chosen = chooseActive(discovery?.getFarms() ?? []);
        if (chosen) connectTo(chosen);
        discovery?.notify(); // the popover re-marks the pinned card / the Automatic row now
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
    // Second launch: surface the existing window instead of a second process.
    if (win) { win.show(); if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(async () => {
    if (!gotSingleInstanceLock) return; // quitting: the running instance owns the data folder
    const settings = loadSettings();
    applyTheme(settings.theme);
    registerIpc();
    createWindow();

    // Migration from the keep-warm era: installs that enabled launch-at-login
    // before v0.1.44 registered the login item with `--hidden`/openAsHidden —
    // with no tray, a hidden login start would be an unreachable window.
    // Re-register plainly so a login start opens visible.
    if (settings.launchAtLogin) {
        try { app.setLoginItemSettings({ openAtLogin: true }); } catch { /* unsupported platform */ }
    }

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
    const seed = activeNow ? farmContext(activeNow, farmKey(activeNow as { id: string; requiresKey?: boolean })) : null;
    currentModel = seed ? seed.model : settings.lastFarmModel;
    currentSearxng = seed ? seed.searxng : settings.lastFarmSearxng;
    currentTts = seed ? seed.tts : settings.lastFarmTts;
    currentExtract = seed ? seed.extract : settings.lastFarmExtract;
    currentCtxPerSlot = seed ? seed.ctxPerSlot : settings.lastFarmCtxPerSlot;
    // The cold-boot seed rides with lastEndpoint: a keyed farm boots
    // authenticated instead of 401-looping until the first beacon.
    currentKey = seed ? seed.key : settings.lastFarmKey;
    booted = true;
    // LOL Chat talks straight to the farm's OpenAI endpoint, so there is no local
    // process to supervise — discovery alone is enough to be usable.
    if (OWUI_ENABLED) {
        sidecar.start({
            endpoint: initial, dataDir: resolveDataDir(),
            apiKey: currentKey,
            defaultModel: currentModel, searxngUrl: currentSearxng, tts: currentTts, extract: currentExtract, contextPerSlot: currentCtxPerSlot,
        });
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

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
        else if (win) { win.show(); win.focus(); }
    });
});

let quitting = false;
// Set once the user has said yes (or a flow that already asked is quitting), so
// the close handler does not ask a second time on the way out.
let quitConfirmed = false;
app.on('before-quit', async (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    discovery?.stop();
    // A guaranteed exit. This used to be a bare `await` on the cleanup, which is
    // fine until it is not: killTree resolves from a taskkill callback, and
    // anything that wedges there (an unkillable python child, a stuck driver
    // call) left the process ALIVE with no window — indistinguishable, from the
    // outside, from the app refusing to quit. Try to stop cleanly, but exit
    // either way: a lingering background process is the exact thing the owner
    // asked to be rid of (2026-09-10).
    const cleanup = Promise.allSettled([sidecar.stop(), mcpo.stop()]);
    const deadline = new Promise((r) => setTimeout(r, 4000));
    await Promise.race([cleanup, deadline]);
    app.exit(0);
});

app.on('window-all-closed', () => {
    // ALL platforms, macOS included (a deliberate break from the mac convention,
    // owner decision 2026-09-04): a windowless app still running the sidecar
    // keeps heartbeating the farm and looks like a connected user holding a
    // seat. Close = everything stops (before-quit above does the cleanup).
    app.quit();
});
