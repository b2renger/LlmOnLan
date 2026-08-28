// Shell settings store — a small JSON file in userData. We hand-roll this instead
// of electron-store to avoid its ESM-only friction in a CommonJS main process and
// keep the dependency surface tiny (mirrors ComfyQ's fleet-config.json approach).

import * as fs from 'fs';
import { settingsFile } from './paths';
import { ShellSettings } from './types';

const DEFAULTS: ShellSettings = {
    clientId: null,     // generated on first heartbeat (index.ts getClientId) and persisted
    dataDir: null,
    theme: 'system',
    manualPeers: [],
    autoScan: true,
    scanRange: null,
    selectedFarmId: null,
    lastEndpoint: null,
    lastFarmModel: null,
    lastFarmSearxng: null,
    lastFarmTts: null,
    lastFarmExtract: null,
    lastFarmCtxPerSlot: null,
    farmKeys: {},       // per-farm shared passwords (farm id → password)
    lastFarmKey: null,
    launchAtLogin: false,
    autoUpdate: true,
    keepEngineWarm: true,
    blenderMcp: false,  // Blender assistant tools are OPT-IN (owner call 2026-07-05; was on by default before v0.1.24)
    blenderMcpUserSet: false, // true once the user toggled Blender explicitly → farm recommendations won't override
    blenderPort: 9876,  // BlenderMCP add-on's default socket port (what its panel shows)
};

let cache: ShellSettings | null = null;

export function loadSettings(): ShellSettings {
    if (cache) return cache;
    let loaded: ShellSettings;
    try {
        const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
        loaded = { ...DEFAULTS, ...raw };
    } catch {
        loaded = { ...DEFAULTS };
    }
    cache = loaded;
    return loaded;
}

export function saveSettings(next: ShellSettings): ShellSettings {
    cache = next;
    try {
        fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
    } catch (e) {
        console.warn('[store] could not save settings:', (e as Error).message);
    }
    return cache;
}

// Merge a partial update, persist, and return the new settings.
export function updateSettings(patch: Partial<ShellSettings>): ShellSettings {
    return saveSettings({ ...loadSettings(), ...patch });
}
