// Auto-update via electron-updater (GitHub Releases). Auto-checks on launch when
// enabled (no-op in dev). Also exposes a manual "Check for updates" + an explicit
// "Restart & install" for the Preferences buttons. Downloads in the background and
// installs on quit — a LAN tool shouldn't interrupt a chat.

import { app } from 'electron';

type AutoUpdater = typeof import('electron-updater').autoUpdater;

let autoUpdater: AutoUpdater | null = null;
let wired = false;
let started = false;
let onDownloaded: ((version: string) => void) | null = null;

// Renderer is notified when a downloaded update is ready to install.
export function setUpdateNotifier(cb: (version: string) => void): void { onDownloaded = cb; }

function getUpdater(): AutoUpdater | null {
    if (autoUpdater) return autoUpdater;
    try { ({ autoUpdater } = require('electron-updater')); } // lazy: dev may prune it
    catch (e) { console.warn('[updater] electron-updater unavailable:', (e as Error).message); return null; }
    return autoUpdater;
}

function wire(u: AutoUpdater): void {
    if (wired) return;
    wired = true;
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.on('error', (e) => console.warn('[updater] error:', e?.message || e));
    u.on('checking-for-update', () => console.log('[updater] checking…'));
    u.on('update-available', (i) => console.log(`[updater] update available: v${i.version}`));
    u.on('update-not-available', () => console.log('[updater] up to date'));
    u.on('update-downloaded', (i) => { console.log(`[updater] v${i.version} downloaded`); onDownloaded?.(i.version); });
}

export function initAutoUpdate(enabled: boolean): void {
    if (started || !enabled || !app.isPackaged) return;
    const u = getUpdater();
    if (!u) return;
    started = true;
    wire(u);
    u.checkForUpdates().catch((e) => console.warn('[updater] check failed:', e?.message || e));
}

// Manual check — returns whether a newer app version is available.
export async function checkForAppUpdate(): Promise<{ current: string; available: boolean; version?: string; error?: string }> {
    const current = app.getVersion();
    if (!app.isPackaged) return { current, available: false, error: 'Updates only apply to an installed build.' };
    const u = getUpdater();
    if (!u) return { current, available: false, error: 'Updater unavailable.' };
    wire(u);
    try {
        const r = await u.checkForUpdates(); // autoDownload:true → downloads in the background if newer
        const v = r?.updateInfo?.version;
        return { current, available: !!(v && v !== current), version: v };
    } catch (e: any) {
        return { current, available: false, error: e?.message || String(e) };
    }
}

export function quitAndInstallUpdate(): void {
    const u = getUpdater();
    if (!u) return;
    try { u.quitAndInstall(); } catch (e) { console.warn('[updater] quitAndInstall failed:', (e as Error).message); }
}
