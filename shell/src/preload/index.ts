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
});
