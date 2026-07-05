// Preload — the only bridge between the sandboxed renderer and the main process.
// Exposes a small, explicit `farm` API; no Node access leaks into the renderer.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('farm', {
    // Boot + state.
    getInitState: () => ipcRenderer.invoke('get-init-state'),
    getPrefs: () => ipcRenderer.invoke('get-prefs'),
    getFarmState: () => ipcRenderer.invoke('get-farm-state'),
    getAdminWebview: () => ipcRenderer.invoke('get-admin-webview'),
    onFarmState: (cb: (s: unknown) => void) => ipcRenderer.on('farm-state', (_e, s) => cb(s)),

    // First-run setup wizard.
    startSetup: () => ipcRenderer.invoke('start-setup'),
    onSetupProgress: (cb: (p: unknown) => void) => ipcRenderer.on('setup-progress', (_e, p) => cb(p)),

    // Running-screen controls.
    farmStart: () => ipcRenderer.invoke('farm-start'),
    farmStop: () => ipcRenderer.invoke('farm-stop'),
    refreshLan: () => ipcRenderer.invoke('refresh-lan'),

    // Settings.
    setTheme: (theme: 'dark' | 'light' | 'system') => ipcRenderer.invoke('set-theme', theme),
    setLaunchAtLogin: (on: boolean) => ipcRenderer.invoke('set-launch-at-login', on),
    setAutoUpdate: (on: boolean) => ipcRenderer.invoke('set-auto-update', on),

    // App self-update.
    checkAppUpdate: () => ipcRenderer.invoke('check-app-update'),
    installAppUpdate: () => ipcRenderer.invoke('install-app-update'),
    relaunch: () => ipcRenderer.invoke('relaunch-app'),
    onAppUpdateDownloaded: (cb: (i: unknown) => void) => ipcRenderer.on('app-update-downloaded', (_e, i) => cb(i)),

    // Misc.
    openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
    copyText: (text: string) => ipcRenderer.invoke('copy-text', text),
    openLogs: () => ipcRenderer.invoke('open-logs'),
});
