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

function createWindow(hasProjects, hasDebugLog) {
    const win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 860,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.cjs'),
            additionalArguments: [hasProjects && '--lol-projects=1', hasDebugLog && '--lol-debuglog=1'].filter(Boolean),
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

    session.defaultSession.on('will-download', (event, item) => {
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
    createWindow(wireProjects(), wireDebugLog());
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
