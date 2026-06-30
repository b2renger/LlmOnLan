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
    addManualPeer: (host: string) => ipcRenderer.invoke('add-manual-peer', host),
    removeManualPeer: (host: string) => ipcRenderer.invoke('remove-manual-peer', host),
    setAutoScan: (on: boolean) => ipcRenderer.invoke('set-auto-scan', on),
    setScanRange: (r: unknown) => ipcRenderer.invoke('set-scan-range', r),
    rescan: () => ipcRenderer.invoke('rescan'),

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
});
