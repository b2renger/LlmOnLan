// Preload — the only bridge between the sandboxed renderer and the main process.
// Exposes a small, explicit `lol` API; no Node access leaks into the renderer.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lol', {
    // Sidecar (Open WebUI) lifecycle state — push + pull.
    onSidecarState: (cb: (s: unknown) => void) =>
        ipcRenderer.on('sidecar-state', (_e, s) => cb(s)),
    getSidecarState: () => ipcRenderer.invoke('get-sidecar-state'),

    // Shell settings.
    getSettings: () => ipcRenderer.invoke('get-settings'),
    setTheme: (theme: 'dark' | 'light' | 'system') => ipcRenderer.invoke('set-theme', theme),

    // LAN farm discovery (M3).
    onFarms: (cb: (data: unknown) => void) => ipcRenderer.on('farms', (_e, data) => cb(data)),
    getFarms: () => ipcRenderer.invoke('get-farms'),
    selectFarm: (id: string | null) => ipcRenderer.invoke('select-farm', id),
    setFarmKey: (farmId: string, key: string) => ipcRenderer.invoke('set-farm-key', { farmId, key }),
    addManualPeer: (host: string) => ipcRenderer.invoke('add-manual-peer', host),
    removeManualPeer: (host: string) => ipcRenderer.invoke('remove-manual-peer', host),
    setAutoScan: (on: boolean) => ipcRenderer.invoke('set-auto-scan', on),
    setScanRange: (r: unknown) => ipcRenderer.invoke('set-scan-range', r),
    rescan: () => ipcRenderer.invoke('rescan'),

    // Local Blender assistant-tools server (mcpo).
    getBlenderState: () => ipcRenderer.invoke('get-blender-state'),
    getBlenderConnection: () => ipcRenderer.invoke('get-blender-connection'),
    setBlenderEnabled: (on: boolean) => ipcRenderer.invoke('set-blender-enabled', on),
    setBlenderPort: (port: number) => ipcRenderer.invoke('set-blender-port', port),
    testBlenderConnection: () => ipcRenderer.invoke('test-blender-connection'),
    onBlenderState: (cb: (s: unknown) => void) => ipcRenderer.on('blender-state', (_e, s) => cb(s)),

    // Preferences (M4).
    getPrefs: () => ipcRenderer.invoke('get-prefs'),
    chooseDataDir: () => ipcRenderer.invoke('choose-data-dir'),
    setDataDir: (payload: { path: string; mode: 'move' | 'fresh' }) => ipcRenderer.invoke('set-data-dir', payload),
    // What boot did with LOL Chat's data (a move landed, a fallback, an import) — once.
    getDataNotices: () => ipcRenderer.invoke('get-data-notices'),
    setLaunchAtLogin: (on: boolean) => ipcRenderer.invoke('set-launch-at-login', on),
    setAutoUpdate: (on: boolean) => ipcRenderer.invoke('set-auto-update', on),

    // Sidecar download (first run) + updates.
    onSidecarInstall: (cb: (p: unknown) => void) => ipcRenderer.on('sidecar-install', (_e, p) => cb(p)),
    installSidecar: () => ipcRenderer.invoke('install-sidecar'),
    // App self-update (electron-updater).
    checkAppUpdate: () => ipcRenderer.invoke('check-app-update'),
    installAppUpdate: () => ipcRenderer.invoke('install-app-update'),
    onAppUpdateDownloaded: (cb: (i: unknown) => void) => ipcRenderer.on('app-update-downloaded', (_e, i) => cb(i)),
    // OWUI (chat engine) update — independent of the app binary.
    checkOwuiUpdate: () => ipcRenderer.invoke('check-owui-update'),
    downloadOwuiUpdate: () => ipcRenderer.invoke('download-owui-update'),
    onOwuiUpdateProgress: (cb: (p: unknown) => void) => ipcRenderer.on('owui-update-progress', (_e, p) => cb(p)),

    // Misc.
    openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
    reloadWebview: () => ipcRenderer.invoke('reload-webview'),
    restartSidecar: () => ipcRenderer.invoke('restart-sidecar'),
    relaunch: () => ipcRenderer.invoke('relaunch-app'),
    projects: {
        // The scratch-projects API (studio plan §3.8): ONE additive property, every method a thin
        // ipcRenderer.invoke that resolves to {ok:true,...} or {ok:false,code,message} — nothing
        // throws across the bridge. No event channels and no on* subscriptions: the renderer polls
        // on its own actions, and there is no watcher. The renderer never sends an absolute path;
        // `id` always comes from create()/list(), `rel` is always relative and re-validated in main.
        root: () => ipcRenderer.invoke('lol:projects:root'),
        list: () => ipcRenderer.invoke('lol:projects:list'),
        create: (input: unknown) => ipcRenderer.invoke('lol:projects:create', input),
        meta: (id: string) => ipcRenderer.invoke('lol:projects:meta', id),
        update: (id: string, patch: unknown) => ipcRenderer.invoke('lol:projects:update', id, patch),
        forget: (id: string) => ipcRenderer.invoke('lol:projects:forget', id),
        listFiles: (id: string) => ipcRenderer.invoke('lol:projects:listFiles', id),
        read: (id: string, rel: string) => ipcRenderer.invoke('lol:projects:read', id, rel),
        readBinary: (id: string, rel: string) => ipcRenderer.invoke('lol:projects:readBinary', id, rel),
        write: (id: string, rel: string, text: string, o?: unknown) =>
            ipcRenderer.invoke('lol:projects:write', id, rel, text, o),
        writeBinary: (id: string, rel: string, base64: string) =>
            ipcRenderer.invoke('lol:projects:writeBinary', id, rel, base64),
        remove: (id: string, rel: string) => ipcRenderer.invoke('lol:projects:remove', id, rel),
        reveal: (id: string) => ipcRenderer.invoke('lol:projects:reveal', id),
        open: (id: string) => ipcRenderer.invoke('lol:projects:open', id),
        path: (id: string) => ipcRenderer.invoke('lol:projects:path', id),
    },
    debugLog: {
        // The Computer's debug log (COMPUTER_PLAN addendum KG): ONE additive property, the same
        // rules as `projects` — thin invokes, {ok:...} answers, no events, and no path in or out
        // except the one main chose. The renderer appends text; it never reads a file back.
        start: (header: string) => ipcRenderer.invoke('lol:debugLog:start', header),
        append: (text: string) => ipcRenderer.invoke('lol:debugLog:append', text),
        stop: (footer?: string) => ipcRenderer.invoke('lol:debugLog:stop', footer),
        mark: () => ipcRenderer.invoke('lol:debugLog:mark'),
        reveal: () => ipcRenderer.invoke('lol:debugLog:reveal'),
        status: () => ipcRenderer.invoke('lol:debugLog:status'),
    },
    io: {
        // The Computer's Fetch box (ecosystem plan v2 §4.2): one capped GET, checked in main (io.ts).
        get: (url: string, opts?: { hosts?: string[] }) => ipcRenderer.invoke('lol:io:fetch', url, opts),
        // Outputs to the world (plan v2 §3.5): the ONE choke point is in main (outputs.ts).
        send: (req: unknown) => ipcRenderer.invoke('lol:io:send', req),
        arm: (on: boolean) => ipcRenderer.invoke('lol:io:arm', on),
        armed: () => ipcRenderer.invoke('lol:io:armed'),
        panic: () => ipcRenderer.invoke('lol:io:panic'),
    },
    // USB serial (P3a-2): main forwards the plugged-in boards when the page asks for one; the page
    // answers with the person's pick ('' = cancelled). The bytes go through the page's own Web Serial.
    // The Computer's MCP server (src/main/mcp.ts): main carries a tool call here, the page answers it.
    mcp: {
        onCall: (fn: (msg: unknown) => void) => { ipcRenderer.on('lol:mcp:call', (_e, msg) => fn(msg)); },
        answer: (id: string, out: unknown) => ipcRenderer.invoke('lol:mcp:answer', id, out),
    },
    serial: {
        onChoose: (fn: (list: unknown) => void) => { ipcRenderer.on('lol:serial:choose', (_e, list) => fn(list)); },
        chosen: (portId: string) => ipcRenderer.invoke('lol:serial:chosen', portId),
    },
    // The IDE's coding agent (src/main/studio.ts): a prompt names a project id, a thread and a model — never a path
    // or a URL; the farm and the password stay in main. A turn's records arrive on onEvent.
    studio: {
        prompt: (o: unknown) => ipcRenderer.invoke('lol:studio:prompt', o),
        stop: () => ipcRenderer.invoke('lol:studio:stop'),
        status: () => ipcRenderer.invoke('lol:studio:status'),
        serve: (projectId: string) => ipcRenderer.invoke('lol:studio:serve', projectId),
        share: (projectId: string, on: boolean) => ipcRenderer.invoke('lol:studio:share', projectId, on),
        history: (projectId: string) => ipcRenderer.invoke('lol:studio:history', projectId),
        changes: (projectId: string, oid: string) => ipcRenderer.invoke('lol:studio:changes', projectId, oid),
        commit: (projectId: string, message: string) => ipcRenderer.invoke('lol:studio:commit', projectId, message),
        restore: (projectId: string, oid: string) => ipcRenderer.invoke('lol:studio:restore', projectId, oid),
        remote: (projectId: string, url?: string) => ipcRenderer.invoke('lol:studio:remote', projectId, url),
        token: (projectId: string, token: string | null) => ipcRenderer.invoke('lol:studio:token', projectId, token),
        push: (projectId: string) => ipcRenderer.invoke('lol:studio:push', projectId),
        pull: (projectId: string) => ipcRenderer.invoke('lol:studio:pull', projectId),
        install: () => ipcRenderer.invoke('lol:studio:install'),
        onEvent: (fn: (msg: unknown) => void) => { ipcRenderer.on('lol:studio:event', (_e, msg) => fn(msg)); },
    },
});
