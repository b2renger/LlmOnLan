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

    // Misc.
    openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
    reloadWebview: () => ipcRenderer.invoke('reload-webview'),
    restartSidecar: () => ipcRenderer.invoke('restart-sidecar'),
});
