// Shared types for the Farm app's main process + the renderer IPC contract.

// One phase of the first-run setup, as shown in the wizard checklist.
export type SetupPhaseId = 'runtime' | 'farm' | 'deps' | 'model' | 'launch';
export type PhaseStatus = 'pending' | 'active' | 'done' | 'error';

export interface SetupPhase {
    id: SetupPhaseId;
    label: string;
    status: PhaseStatus;
    detail?: string;          // sub-status line (e.g. "Downloading Python… 40 MB / 60 MB")
    percent?: number;         // 0–100 for the two big downloads (runtime + model)
}

// A single setup-progress push to the renderer: the full phase list + an optional
// appended log line. The renderer renders the checklist and appends to the log.
export interface SetupProgress {
    phases: SetupPhase[];
    log?: string;             // a line to append to the collapsible install log
    installed?: boolean;      // true once every phase is done (renderer switches to the running screen)
    error?: string;           // set when a phase failed (renderer shows Retry)
}

// The managed `lol up` farm process lifecycle.
export type FarmStatus = 'idle' | 'starting' | 'ready' | 'restarting' | 'stopped' | 'error';

export interface FarmState {
    status: FarmStatus;
    adminUrl: string | null;     // http://127.0.0.1:<httpPort>/lol/admin once ready
    selfUrl: string | null;      // http://127.0.0.1:<httpPort>/lol/self (health)
    lanUrls: string[];           // the LAN addresses clients reach the OpenAI proxy at
    message?: string;            // human-readable detail (esp. on error)
}

// Download progress for the runtime pieces (Python / Ollama) + the model pull.
export interface DownloadProgress {
    phase: 'check' | 'download' | 'extract' | 'done' | 'error';
    what?: string;               // "python" | "ollama" | "gemma4:12b"
    receivedMB?: number;
    totalMB?: number;
    percent?: number;
    message?: string;
}

export interface FarmSettings {
    installed: boolean;            // first-run setup completed → skip the wizard
    farmCodeVersion: string | null; // app version whose farm code is in userData/farm (re-copy on update)
    adminToken: string | null;     // the pinned admin token written into lol.config.json
    dataDir: string | null;        // reserved: a custom farm data folder (null => userData/farm)
    theme: 'dark' | 'light' | 'system';
    launchAtLogin: boolean;
    autoUpdate: boolean;
    // Model context window (num_ctx) written into lol.config.json's ollama.contextLength
    // — persistent, unlike the admin panel's live change (which resets on restart).
    // Bigger = more of a document considered at once (the point of RAG); 262144 is the
    // native max of gemma4 / qwen3.x and the farm's cap.
    contextLength: number;
    // Share this farm's compute with the LAN. OFF by default = fully private: the
    // proxy + discovery bind 127.0.0.1 only and the beacon is off, so no other
    // machine can reach or use it (even by direct IP / subnet scan). ON = bind
    // 0.0.0.0 + advertise as a compute box for other clients.
    shareWithNetwork: boolean;
}
