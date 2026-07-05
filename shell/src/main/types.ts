// Shared types for the shell's main process + the renderer IPC contract.

// The discovery snapshot a farm advertises (UDP beacon / GET /lol/self). Mirrors
// farm/src/snapshot.js buildSnapshot() — keep the two in sync.
export interface FarmSnapshot {
    v: number;
    id: string;
    name: string;
    proxyPort: number;
    httpPort?: number;       // admin/discovery HTTP port → the /lol/admin page lives here
    ips: string[];
    endpoint: string;        // http://<ip>:<proxyPort>
    openaiBaseUrl: string;   // http://<ip>:<proxyPort>/v1  — exactly what OWUI wants
    requiresKey: boolean;
    models: { id: string; default?: boolean; underlying?: string }[];
    healthy: boolean;
    version: string;
    health?: {
        proxyUp: boolean | null;
        hostsUp: number | null;
        hostsTotal: number | null;
        loaded: string[];
    };
    // Static hardware (M6) — null on a farm running an older build.
    host?: { gpu: string; vramGb: number; ramGb: number; cpuCores: number } | null;
    // Live usage (M6) — GPU util + VRAM + loaded models.
    usage?: {
        gpuUtil: number | null;
        vramUsedGb: number | null;
        vramTotalGb: number | null;
        loaded: string[];
        clients?: number | null;   // desktop clients heartbeating this farm (absent on older farms)
    };
    // Coordinator mode — this farm aggregates LAN peers into one balanced proxy,
    // so clients prefer it over the individual box-farms. Absent on a plain farm.
    coordinator?: boolean;
    deployments?: number | null;   // balanced backends behind the endpoint (hosts + peers)
    // Shared SearXNG on the farm box (null/absent when off) — the client points
    // OWUI's web search at it, so every client gets search with zero setup.
    searxngUrl?: string | null;
    // Shared Kokoro TTS on the farm box (null/absent when off) — the client points
    // OWUI's AUDIO_TTS_* at it, so every client gets neural voice with zero setup.
    ttsUrl?: string | null;   // already includes /v1 (OWUI's AUDIO_TTS_OPENAI_API_BASE_URL)
    ttsVoice?: string | null;
    ttsModel?: string | null;
    // Shared OCR / document-extraction on the farm box (null/absent when off) — the
    // client points OWUI's CONTENT_EXTRACTION_ENGINE=external + EXTERNAL_DOCUMENT_LOADER_*
    // at it, so every client gets scanned-doc + image OCR with zero setup. `url` is
    // the loader BASE (OWUI appends /process); `key` is the bearer OWUI must send.
    extract?: { url: string; key: string } | null;
    // Farm-side plugin state (web search / voice / OCR): { id: {label, runsOn, enabled, healthy} }.
    plugins?: Record<string, { label?: string; runsOn?: string; enabled?: boolean; healthy?: boolean }>;
    // Client-side plugins (e.g. "blender") the farm RECOMMENDS — the client auto-applies
    // what it can run (see applyFarmRecommendations); the farm can't run them itself.
    recommendedClientPlugins?: string[];
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

// Local "assistant tools" server (mcpo wrapping the Blender MCP server) lifecycle.
export type McpoStatus = 'idle' | 'installing' | 'starting' | 'ready' | 'stopped' | 'error';
export interface McpoState {
    status: McpoStatus;
    url: string | null;        // http://127.0.0.1:<port> once ready
    message?: string;          // human-readable detail (install progress / error)
}

export interface ShellSettings {
    clientId: string | null;           // stable per-install id for the farm presence heartbeat (generated once)
    dataDir: string | null;            // null => default per-user app-data path
    theme: 'dark' | 'light' | 'system';
    manualPeers: string[];             // host[:httpPort] entries for broadcast-blocked LANs
    autoScan: boolean;
    scanRange: ScanRange | null;
    selectedFarmId: string | null;     // user's pinned farm choice when several are found
    lastEndpoint: string | null;       // last-known-good openaiBaseUrl (fallback before discovery)
    launchAtLogin: boolean;
    autoUpdate: boolean;
    blenderMcp: boolean;               // local Blender assistant-tools server (mcpo) on/off
    blenderMcpUserSet: boolean;        // user toggled Blender explicitly → farm recommendations won't override
    blenderPort: number;               // BlenderMCP add-on socket port (BLENDER_PORT; default 9876)
}
