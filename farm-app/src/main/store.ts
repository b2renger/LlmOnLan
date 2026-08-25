// Farm-app settings store — a small JSON file in userData. Hand-rolled (like the
// client shell) to avoid electron-store's ESM friction in a CommonJS main process
// and keep the dependency surface tiny.

import * as fs from 'fs';
import { settingsFile } from './paths';
import { FarmSettings } from './types';

const DEFAULTS: FarmSettings = {
    installed: false,
    farmCodeVersion: null,
    adminToken: null,
    dataDir: null,
    theme: 'system',
    launchAtLogin: false,
    autoUpdate: true,
    modelName: null,         // advertised model name; null = the farm's default alias
    contextLength: 65536,    // matches the farm's own default; raise to 262144 for max-RAG
    shareWithNetwork: false, // private by default — only this machine can use the farm
};

let cache: FarmSettings | null = null;

export function loadSettings(): FarmSettings {
    if (cache) return cache;
    let loaded: FarmSettings;
    try {
        const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
        loaded = { ...DEFAULTS, ...raw };
    } catch {
        loaded = { ...DEFAULTS };
    }
    cache = loaded;
    return loaded;
}

export function saveSettings(next: FarmSettings): FarmSettings {
    cache = next;
    try {
        fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
    } catch (e) {
        console.warn('[store] could not save settings:', (e as Error).message);
    }
    return cache;
}

// Merge a partial update, persist, and return the new settings.
export function updateSettings(patch: Partial<FarmSettings>): FarmSettings {
    return saveSettings({ ...loadSettings(), ...patch });
}
