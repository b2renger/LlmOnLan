'use strict';
// Electron main process for the CHAT-ONLY harness (plan §2.2). It is deliberately NOT the shell's
// main process: no sidecar, no discovery, no store, no single-instance lock, no tray — just a
// window on chat-harness/page.html with the same webPreferences the shell uses, so LOL Chat runs
// under production-shaped constraints (contextIsolation, sandbox, CSP) while the driver talks CDP.
//
//   electron main.cjs --user-data-dir=<tmp> --remote-debugging-port=9333 [--show] [--query=<qs>]
//
// Never run this against the owner's real userData: the driver always passes a fresh mkdtemp.

const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
// The Computer's microphone and camera (2026-09-28): Chromium's own fake devices — a tone for the microphone, a
// test pattern for the camera — and no permission prompt, so ● Record and Take a picture run for real (k23).
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const argOf = (name, dflt = null) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : dflt;
};
const SHOW = process.argv.includes('--show');
const QUERY = argOf('query', '');
const USER_DATA = argOf('user-data-dir', null);

app.setName('LolChatHarness');
if (USER_DATA) app.setPath('userData', USER_DATA);

const tmpDir = () => app.getPath('userData');
const downloadsDir = () => path.join(tmpDir(), 'downloads');

// ---- the client session in DATA_DIR (mirrors shell/src/main/index.ts prepareClientDataAtBoot) ----
// Owner rule 2026-09-27: LOL Chat's history and the Computer's graphs live in the data folder. The
// shell runs its main window on session.fromPath(<DATA_DIR>/lol-client) and does the file work
// (a pending move, the writability fallback, the v0.1.x import) BEFORE app 'ready'; the harness
// does the same, with the REAL prepareClientData from the compiled main output, so every scenario
// runs on that session. The fake DATA_DIR is <userData>/owui-data, the shell's default layout, so
// <userData>/IndexedDB is where a regression to the default session would show (h1-data-dir).
// Without the build, the same folder is computed here and nothing is migrated (a fresh profile has
// nothing to migrate anyway).
const CLIENTDATA_BUILD = path.join(__dirname, '..', '..', 'build', 'main', 'clientData.js');
const HARNESS_DATA_DIR = path.join(tmpDir(), 'owui-data');
let clientDir = path.join(HARNESS_DATA_DIR, 'lol-client');
const clientFacts = { dataDir: HARNESS_DATA_DIR, clientDir, userData: tmpDir(), built: false, notices: [], log: [] };
try {
    if (fs.existsSync(CLIENTDATA_BUILD)) {
        const { prepareClientData } = require(CLIENTDATA_BUILD);
        const settingsFile = path.join(tmpDir(), 'harness-client-settings.json');
        let settings = { pendingClientMove: null, legacyClientDataImported: false, legacyClientDataStamp: null };
        try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch { /* first run */ }
        const plan = prepareClientData({
            userDataDir: tmpDir(),
            dataDir: HARNESS_DATA_DIR,
            settings,
            save: (patch) => { settings = { ...settings, ...patch }; fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); },
        });
        clientDir = plan.dir;
        Object.assign(clientFacts, { clientDir, built: true, notices: plan.notices, log: plan.log });
    }
} catch (e) {
    console.error('[harness-main] clientData build present but unusable:', e && e.message);
    clientFacts.error = String(e && e.message);
}

/** @type {{url: string, action: 'external' | 'dropped', ts: number}[]} */
const windowOpens = [];
/** Calls the projects API made into `shell` (showItemInFolder / openPath). Nothing is opened. */
const shellCalls = [];
/** @type {any[]} */
const downloads = [];

function writeJson(file, value) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(value, null, 2));
    } catch (e) {
        console.error('[harness-main] cannot write', file, e && e.message);
    }
}

// ---- LOL Studio (S0) ---- (the projects API under test; mirrors shell/src/main/index.ts)
// The REAL createProjectsApi from the compiled main output, rooted at <userData>/projects and
// handed a fake `shell` that only records. When build/main/projects.js is absent the handlers are
// never registered and window.lol.projects is undefined in the page — an un-upgraded client.
const PROJECTS_BUILD = path.join(__dirname, '..', '..', 'build', 'main', 'projects.js');
const PROJECTS_OPS = [
    'root', 'list', 'create', 'meta', 'update', 'forget', 'listFiles', 'read', 'readBinary',
    'write', 'writeBinary', 'remove', 'reveal', 'open', 'path',
];

function wireProjects() {
    let factory = null;
    try {
        if (fs.existsSync(PROJECTS_BUILD)) factory = require(PROJECTS_BUILD).createProjectsApi;
    } catch (e) {
        console.error('[harness-main] projects build present but unloadable:', e && e.message);
    }
    if (typeof factory !== 'function') return false;
    const rootDir = path.join(tmpDir(), 'projects');
    const record = (call, p) => {
        shellCalls.push({ call, path: String(p), ts: Date.now() });
        writeJson(path.join(tmpDir(), 'shell-calls.json'), shellCalls);
    };
    const api = factory({
        rootDir,
        shellApi: {
            showItemInFolder: (p) => record('showItemInFolder', p),
            openPath: async (p) => { record('openPath', p); return ''; },
        },
    });
    for (const op of PROJECTS_OPS) {
        ipcMain.handle(`lol:projects:${op}`, async (_e, ...args) => {
            if (typeof api[op] !== 'function') return { ok: false, code: 'E_IO', message: `no such op ${op}` };
            return api[op](...args);
        });
    }
    console.log(`[harness-main] projects API wired at ${rootDir}`);
    return true;
}
// ---- /LOL Studio ----

// ---- LOL Studio (S0) ---- (the Computer's debug log, addendum KG; mirrors shell/src/main/index.ts)
// The REAL createDebugLog from the compiled main output, writing under <userData>/logs/computer
// exactly as the shell does, with the SAME recording fake `shell` as the projects API. Absent build
// => no handlers, no `window.lol.debugLog`, and the Record switch must be hidden (k7-recorder).
const DEBUGLOG_BUILD = path.join(__dirname, '..', '..', 'build', 'main', 'debugLog.js');
/** @type {import('electron').BrowserWindow | null} */
let harnessWin = null;

// Ecosystem plan v2 §4.2: the Fetch box's ONE main-side GET, the REAL io.js with loopback allowed —
// the ONLY difference from the shell, because the harness's fixture servers live on 127.0.0.1.
const IO_BUILD = path.join(__dirname, '..', '..', 'build', 'main', 'io.js');
/** h.io.map(): a fixed public address (data.gouv.fr for the Open data box) answered by a scenario's loopback
 * fixture instead — <userData>/io-map.json is {"https://www.data.gouv.fr/": "http://127.0.0.1:P/site/"}. No
 * file: every address goes where it says. @param {string} url */
function mapped(url) {
    let map = {};
    try { map = JSON.parse(fs.readFileSync(path.join(tmpDir(), 'io-map.json'), 'utf8')) || {}; } catch { return url; }
    for (const [from, to] of Object.entries(map)) if (url.startsWith(from)) return to + url.slice(from.length);
    return url;
}
/** The same map for an allowed-hosts list: a mapped host becomes its fixture's `host:port`. @param {string[]} hosts */
function mappedHosts(hosts) {
    let map = {};
    try { map = JSON.parse(fs.readFileSync(path.join(tmpDir(), 'io-map.json'), 'utf8')) || {}; } catch { return hosts; }
    return hosts.map((h) => {
        for (const [from, to] of Object.entries(map)) {
            try { if (new URL(from).host === h) return new URL(String(to)).host; } catch { /* not a URL: skip */ }
        }
        return h;
    });
}
function wireIo() {
    let fetchText = null;
    try { if (fs.existsSync(IO_BUILD)) fetchText = require(IO_BUILD).fetchText; } catch (e) { console.error('[harness-main] io build unloadable:', e && e.message); }
    if (typeof fetchText !== 'function') return false;
    ipcMain.handle('lol:io:fetch', (_e, url, opts) => (typeof url === 'string' && url.length <= 2048
        ? fetchText(mapped(url), { allowLoopback: true, ...(opts && Array.isArray(opts.hosts) ? { hosts: mappedHosts(opts.hosts) } : {}) })
        : { ok: false, code: 'E_URL', message: 'bad arguments' }));
    // The outputs choke point, the REAL outputs.js (it allows this machine anyway: OSC to 127.0.0.1).
    const OUT_BUILD = path.join(__dirname, '..', '..', 'build', 'main', 'outputs.js');
    if (fs.existsSync(OUT_BUILD)) {
        const out = require(OUT_BUILD);
        ipcMain.handle('lol:io:send', (_e, req) => (req && typeof req === 'object' ? out.send(req) : { ok: false, code: 'E_TARGET', message: 'bad arguments' }));
        ipcMain.handle('lol:io:arm', (_e, on) => out.arm(on === true));
        ipcMain.handle('lol:io:armed', () => out.isArmed());
        ipcMain.handle('lol:io:panic', () => out.panic());
    }
    return true;
}

function wireDebugLog() {
    let factory = null;
    try {
        if (fs.existsSync(DEBUGLOG_BUILD)) factory = require(DEBUGLOG_BUILD).createDebugLog;
    } catch (e) {
        console.error('[harness-main] debugLog build present but unloadable:', e && e.message);
    }
    if (typeof factory !== 'function') return false;
    const dir = path.join(tmpDir(), 'logs', 'computer');
    const record = (call, p) => {
        shellCalls.push({ call, path: String(p), ts: Date.now() });
        writeJson(path.join(tmpDir(), 'shell-calls.json'), shellCalls);
    };
    const log = factory({
        dir,
        facts: () => ({ app: 'harness', electron: process.versions.electron, platform: process.platform }),
        capture: async () => {
            if (!harnessWin || harnessWin.isDestroyed()) return null;
            const img = await harnessWin.webContents.capturePage();
            return img.isEmpty() ? null : img.toPNG();
        },
        shellApi: {
            showItemInFolder: (p) => record('showItemInFolder', p),
            openPath: async (p) => { record('openPath', p); return ''; },
        },
    });
    ipcMain.handle('lol:debugLog:start', (_e, header) => (typeof header === 'string' ? log.start(header) : { ok: false, code: 'E_ARGS' }));
    ipcMain.handle('lol:debugLog:append', (_e, text) => (typeof text === 'string' ? log.append(text) : { ok: false, code: 'E_ARGS' }));
    ipcMain.handle('lol:debugLog:stop', (_e, footer) => log.stop(footer));
    ipcMain.handle('lol:debugLog:mark', () => log.mark());
    ipcMain.handle('lol:debugLog:reveal', () => log.reveal());
    ipcMain.handle('lol:debugLog:status', () => log.status());
    app.on('will-quit', () => log.close('quit'));
    console.log(`[harness-main] debug log wired at ${dir}`);
    return true;
}
// ---- /LOL Studio ----

// The IDE's coding agent (docs/IDE_PLAN.md): the REAL createStudio from the compiled main output, over the
// harness's projects root, with test/mock-dsh.mjs as the runtime (on the harness runner's own Node) — never a real
// dsh or a real farm. The endpoint only lands in the patch file: the mock never calls it.
const STUDIO_BUILD = path.join(__dirname, '..', '..', 'build', 'main', 'studio.js');
/** @type {any} */
let studio = null;
function wireStudio() {
    let factory = null;
    try { if (fs.existsSync(STUDIO_BUILD)) factory = require(STUDIO_BUILD).createStudio; } catch (e) { console.error('[harness-main] studio build unloadable:', e && e.message); }
    if (typeof factory !== 'function' || !process.env.LOL_HARNESS_NODE) return false;
    studio = factory({
        dataDir: () => tmpDir(),
        projectsRoot: () => path.join(tmpDir(), 'projects'),
        farm: () => ({ endpoint: 'http://127.0.0.1:9/v1', key: null, ctxPerSlot: 32768 }),
        runtime: () => ({ node: String(process.env.LOL_HARNESS_NODE), bin: path.join(__dirname, '..', 'mock-dsh.mjs') }),
        emit: (m) => { if (harnessWin && !harnessWin.isDestroyed()) harnessWin.webContents.send('lol:studio:event', m); },
        seedSkills: path.join(__dirname, '..', '..', 'assets', 'skills'),
        // The share listens on loopback in the harness (no firewall prompt) and answers to a TEST-NET name.
        lan: { host: '127.0.0.1', addresses: () => ['192.0.2.10'] },
    });
    ipcMain.handle('lol:studio:prompt', (_e, o) => (o && typeof o === 'object' ? studio.prompt(o) : { ok: false, code: 'E_ARGS', message: 'bad arguments' }));
    ipcMain.handle('lol:studio:stop', () => studio.stop());
    ipcMain.handle('lol:studio:status', () => studio.status());
    ipcMain.handle('lol:studio:serve', (_e, id) => (typeof id === 'string' ? studio.serve(id) : { ok: false, code: 'E_ARGS', message: 'bad arguments' }));
    ipcMain.handle('lol:studio:install', () => ({ ok: false, code: 'E_RUNTIME', message: 'the harness downloads nothing' }));
    ipcMain.handle('lol:studio:share', (_e, id, on) => (typeof id === 'string' ? studio.share(id, on === true) : { ok: false, code: 'E_ARGS', message: 'bad arguments' }));
    app.on('will-quit', () => { void studio.dispose(); });
    console.log('[harness-main] studio wired (mock dsh)');
    return true;
}

function createWindow(hasProjects, hasDebugLog, hasIo, hasStudio) {
    // The same session the shell gives its main window (see the client-session block above).
    const chatSession = clientDir ? session.fromPath(clientDir, { cache: false }) : session.defaultSession;
    clientFacts.sessionPath = chatSession.getStoragePath();
    writeJson(path.join(tmpDir(), 'client-data.json'), clientFacts);
    const win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 860,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.cjs'),
            session: chatSession,
            additionalArguments: [hasProjects && '--lol-projects=1', hasDebugLog && '--lol-debuglog=1', hasIo && '--lol-io=1', hasStudio && '--lol-studio=1'].filter(Boolean),
        },
    });
    harnessWin = win;

    // ---- LOL Studio (S0) ---- (navigation veto; mirrored in shell/src/main/index.ts)
    // A SUBFRAME (the sandbox runner, S2) may load itself once and never navigate again; the
    // app's own main-frame navigation is unaffected and stays the business of will-navigate above.
    // EXACT MATCH against the app's own runner, never a substring of the URL (S0 review, finding
    // 3): a project folder may itself contain sandbox/runner.html, and the loose regex let that
    // through. Mirrors the rule in shell/src/main/index.ts exactly, so the harness can SEE it.
    const RUNNER_URL = pathToFileURL(path.join(__dirname, '..', '..', 'renderer', 'chat', 'sandbox', 'runner.html')).href;
    const bareUrl = (u) => u.split('#')[0].split('?')[0];
    win.webContents.on('will-frame-navigate', (e) => {
        if (e.isMainFrame) return;
        const u = String(e.url || '');
        if (bareUrl(u) === RUNNER_URL) return;
        if (studio && studio.serves(u)) return;   // the IDE's Preview (mirrors shell/src/main/index.ts)
        e.preventDefault();
        windowOpens.push({ url: u, action: 'dropped', ts: Date.now(), frameNavigate: true });
        writeJson(path.join(tmpDir(), 'window-opens.json'), windowOpens);
    });
    // ---- /LOL Studio ----

    // The same split as shell/src/main/index.ts: http(s) would go to the system browser, everything
    // else is dropped on the floor. The harness only RECORDS it — it never opens anything.
    win.webContents.setWindowOpenHandler(({ url }) => {
        const external = /^https?:\/\//i.test(String(url));
        windowOpens.push({ url: String(url), action: external ? 'external' : 'dropped', ts: Date.now() });
        writeJson(path.join(tmpDir(), 'window-opens.json'), windowOpens);
        return { action: 'deny' };
    });

    // A navigation attempt inside the harness window is always a bug in the code under test (a raw
    // <a href> without target=_blank, a form post, a dropped file). Record and block it.
    win.webContents.on('will-navigate', (e, url) => {
        const u = String(url);
        if (u === 'about:blank') return;                                        // h.fresh()
        if (u.startsWith('file://') && u.includes('chat-harness')) return;       // the driver's own reloads
        e.preventDefault();
        windowOpens.push({ url: String(url), action: 'dropped', ts: Date.now(), navigate: true });
        writeJson(path.join(tmpDir(), 'window-opens.json'), windowOpens);
    });

    chatSession.on('will-download', (event, item) => {
        const file = path.join(downloadsDir(), item.getFilename());
        fs.mkdirSync(downloadsDir(), { recursive: true });
        item.setSavePath(file);
        item.once('done', (_e, state) => {
            downloads.push({
                name: item.getFilename(),
                path: file,
                mime: item.getMimeType(),
                bytes: item.getReceivedBytes(),
                url: item.getURL().slice(0, 120),
                state,
                ts: Date.now(),
            });
            writeJson(path.join(tmpDir(), 'downloads.json'), downloads);
        });
    });

    ipcMain.handle('harness:blender', () => {
        try {
            return JSON.parse(fs.readFileSync(path.join(tmpDir(), 'blender.json'), 'utf8'));
        } catch {
            return null;
        }
    });
    ipcMain.handle('harness:windowOpens', () => windowOpens);

    const file = path.join(__dirname, 'page.html');
    win.loadFile(file, QUERY ? { search: QUERY.startsWith('?') ? QUERY : `?${QUERY}` } : undefined);
    if (SHOW) win.showInactive();
    return win;
}

app.whenReady().then(() => {
    writeJson(path.join(tmpDir(), 'window-opens.json'), windowOpens);
    writeJson(path.join(tmpDir(), 'downloads.json'), downloads);
    writeJson(path.join(tmpDir(), 'shell-calls.json'), shellCalls);
    createWindow(wireProjects(), wireDebugLog(), wireIo(), wireStudio());
});

// Nothing here should ever reach the system browser.
app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
        windowOpens.push({ url: String(url), action: /^https?:\/\//i.test(String(url)) ? 'external' : 'dropped', ts: Date.now() });
        writeJson(path.join(tmpDir(), 'window-opens.json'), windowOpens);
        return { action: 'deny' };
    });
});

app.on('window-all-closed', () => app.quit());
void shell;
