// Shared types for the shell's main process + the renderer IPC contract.

// The discovery snapshot a farm advertises (UDP beacon / GET /lol/self). Mirrors
// farm/src/snapshot.js buildSnapshot() — keep the two in sync.
export interface FarmSnapshot {
    v: number;
    id: string;
    name: string;
    proxyPort: number;
    ips: string[];
    endpoint: string;        // http://<ip>:<proxyPort>
    openaiBaseUrl: string;   // http://<ip>:<proxyPort>/v1  — exactly what OWUI wants
    requiresKey: boolean;
    models: { id: string; default?: boolean }[];
    healthy: boolean;
    version: string;
    health?: {
        proxyUp: boolean | null;
        hostsUp: number | null;
        hostsTotal: number | null;
        loaded: string[];
    };
    ts: number;
}

// A farm in the shell's discovered map, annotated with how/when we saw it.
export interface DiscoveredFarm extends FarmSnapshot {
    _source: 'beacon' | 'scan' | 'added';
    _host: string;        // the address we actually reach it at (beacon source / probed host)
    _lastSeen: number;
    _stale: boolean;
}

export type SidecarStatus = 'idle' | 'starting' | 'ready' | 'restarting' | 'stopped' | 'error';

export interface SidecarState {
    status: SidecarStatus;
    url: string | null;        // http://127.0.0.1:<port> once ready
    dataDir: string;
    endpoint: string | null;   // the farm OpenAI base URL it's pointed at
    message?: string;          // human-readable detail (esp. on error)
}

export interface ScanRange {
    base: string;              // first two octets, e.g. "10.10"
    third: [number, number];
    fourth: [number, number];
}

export interface ShellSettings {
    dataDir: string | null;            // null => default per-user app-data path
    theme: 'dark' | 'light' | 'system';
    manualPeers: string[];             // host[:httpPort] entries for broadcast-blocked LANs
    autoScan: boolean;
    scanRange: ScanRange | null;
    selectedFarmId: string | null;     // user's pinned farm choice when several are found
    lastEndpoint: string | null;       // last-known-good openaiBaseUrl (fallback before discovery)
    launchAtLogin: boolean;
    autoUpdate: boolean;
}
