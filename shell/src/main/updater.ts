// Auto-update via electron-updater (GitHub Releases). Checks on launch when the
// user has it enabled and the app is packaged (no-op in dev). Downloads in the
// background and installs on quit — a LAN tool shouldn't interrupt a chat.

import { app } from 'electron';

let started = false;

export function initAutoUpdate(enabled: boolean): void {
    if (started || !enabled || !app.isPackaged) return;
    started = true;
    // Lazy require so dev (where the dep may be pruned/unused) never loads it.
    let autoUpdater: typeof import('electron-updater').autoUpdater;
    try {
        ({ autoUpdater } = require('electron-updater'));
    } catch (e) {
        console.warn('[updater] electron-updater unavailable:', (e as Error).message);
        return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (e) => console.warn('[updater] error:', e?.message || e));
    autoUpdater.on('checking-for-update', () => console.log('[updater] checking…'));
    autoUpdater.on('update-available', (i) => console.log(`[updater] update available: v${i.version}`));
    autoUpdater.on('update-not-available', () => console.log('[updater] up to date'));
    autoUpdater.on('update-downloaded', (i) => console.log(`[updater] v${i.version} downloaded; will install on quit`));

    autoUpdater.checkForUpdates().catch((e) => console.warn('[updater] check failed:', e?.message || e));
}
