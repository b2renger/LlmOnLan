// Sidecar supervisor — owns the Open WebUI child process lifecycle.
//
// Responsibilities (M0): spawn `open-webui serve --host 127.0.0.1 --port <free>`
// with the env from config-bridge, health-wait on /health, expose a live state,
// restart on crash, repoint (restart with a new farm endpoint) and stop cleanly.
// OWUI is a black box: we drive it only via env + its HTTP health surface.

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { resolveSidecarCommand, sidecarExists } from './paths';
import { buildSidecarEnv } from './configBridge';
import { findFreePort, killTree, waitForHttp } from './util';
import { SidecarState } from './types';

const HOST = '127.0.0.1';
const HEALTH_PATH = '/health';
const MAX_CRASH_RESTARTS = 5;

export class SidecarSupervisor extends EventEmitter {
    private child: ChildProcess | null = null;
    private port = 0;
    private dataDir = '';
    private endpoint: string | null = null;
    private apiKey: string | null = null;
    private defaultModel: string | null = null; // farm's default model → OWUI DEFAULT_MODELS
    private searxngUrl: string | null = null;   // farm's shared SearXNG → OWUI web search
    private tts: { url: string; voice: string; model: string } | null = null; // farm Kokoro → OWUI AUDIO_TTS_*
    private extract: { url: string; key: string } | null = null; // farm lol-extract → OWUI external document loader (OCR)
    private contextPerSlot: number | null = null; // farm's per-slot context → whole-doc vs top-k RAG mode
    // Generation token: every start()/stop() bumps it, so an in-flight start()
    // that was superseded (by a repoint/stop/crash-restart) aborts at its awaits
    // instead of clobbering the newer child. The child 'exit' handler compares the
    // exiting process by IDENTITY against this.child, so a late exit from an old
    // child never triggers a spurious restart.
    private gen = 0;
    private crashRestarts = 0;
    private state: SidecarState = { status: 'idle', url: null, dataDir: '', endpoint: null };

    getState(): SidecarState { return this.state; }

    private setState(patch: Partial<SidecarState>): void {
        this.state = { ...this.state, ...patch };
        this.emit('state', this.state);
    }

    // Start (or no-op if already running with the same endpoint+dataDir).
    async start(opts: { endpoint: string | null; dataDir: string; apiKey?: string | null; defaultModel?: string | null; searxngUrl?: string | null; tts?: { url: string; voice: string; model: string } | null; extract?: { url: string; key: string } | null; contextPerSlot?: number | null }): Promise<void> {
        this.endpoint = opts.endpoint;
        this.dataDir = opts.dataDir;
        this.apiKey = opts.apiKey ?? null;
        this.defaultModel = opts.defaultModel ?? null;
        this.searxngUrl = opts.searxngUrl ?? null;
        this.tts = opts.tts ?? null;
        this.extract = opts.extract ?? null;
        this.contextPerSlot = opts.contextPerSlot ?? null;
        const myGen = ++this.gen;

        const { command, args, source } = resolveSidecarCommand();
        if (!sidecarExists(command)) {
            this.setState({
                status: 'error', url: null, dataDir: this.dataDir, endpoint: this.endpoint,
                message: `Open WebUI sidecar not found at: ${command}\n(${source}) — build it (see sidecar/) or set LOL_SIDECAR_CMD.`,
            });
            return;
        }

        // Reap any still-running child before spawning a new one — defends against
        // a crash-restart racing a repoint, which would otherwise orphan a process.
        if (this.child) { const old = this.child; this.child = null; await killTree(old.pid); }
        if (myGen !== this.gen) return; // superseded while awaiting the kill

        this.port = await findFreePort(8080);
        if (myGen !== this.gen) return;
        const url = `http://${HOST}:${this.port}`;
        this.setState({ status: 'starting', url: null, dataDir: this.dataDir, endpoint: this.endpoint, message: undefined });

        const env = {
            ...process.env,
            ...buildSidecarEnv({ endpoint: this.endpoint, dataDir: this.dataDir, apiKey: this.apiKey, defaultModel: this.defaultModel, searxngUrl: this.searxngUrl, tts: this.tts, extract: this.extract, contextPerSlot: this.contextPerSlot }),
            // OWUI logs Unicode (loguru/rich) → force UTF-8 so it doesn't crash a
            // Windows cp1252 console (same class of bug as LiteLLM's banner).
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
        };

        const fullArgs = [...args, '--host', HOST, '--port', String(this.port)];
        console.log(`[sidecar] spawning (${source}): ${command} ${fullArgs.join(' ')}  DATA_DIR=${this.dataDir} endpoint=${this.endpoint}`);

        const child = spawn(command, fullArgs, {
            windowsHide: true,
            detached: process.platform !== 'win32',
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.child = child;

        child.stdout?.on('data', (d) => this.logChild(d));
        child.stderr?.on('data', (d) => this.logChild(d));
        child.on('error', (e) => {
            this.setState({ status: 'error', message: `Failed to launch sidecar: ${e.message}` });
        });
        // Compare by identity: only THIS child's unexpected exit matters.
        child.on('exit', (code) => this.onChildExit(child, code));

        // Health-wait (first run downloads the embedding model → allow generous time).
        // 300 ms polling: OWUI comes up between polls, so a coarse interval adds
        // its own tail latency to every boot the user is staring at.
        const healthy = await waitForHttp(`${url}${HEALTH_PATH}`, { timeoutMs: 180000, intervalMs: 300 });
        if (myGen !== this.gen) return; // a newer start()/stop() superseded us
        if (healthy) {
            this.crashRestarts = 0;
            this.setState({ status: 'ready', url, message: undefined });
            console.log(`[sidecar] ready at ${url} (DATA_DIR=${this.dataDir})`);
        } else {
            this.setState({ status: 'error', url: null, message: 'Open WebUI did not become healthy in time. See logs.' });
        }
    }

    // No-OWUI build: record the chosen farm endpoint WITHOUT starting any process.
    // repoint() would stop/start the OWUI sidecar — on a machine upgraded from an
    // OWUI build that sidecar is still installed, so repointing silently boots a
    // whole Python+OWUI stack nothing uses; on a fresh install it just errors.
    // Going straight to 'ready' keeps the renderer's pill/overlay logic unchanged
    // (the farm name shows as soon as a farm is chosen).
    pointTo(endpoint: string | null): void {
        if (endpoint === this.endpoint && this.state.status === 'ready') return;
        this.endpoint = endpoint;
        this.setState({ status: 'ready', url: null, endpoint });
    }

    // Repoint at a different farm endpoint (and/or its default model / SearXNG).
    // No-op if all unchanged; else restart so the env (OPENAI_API_BASE_URL /
    // DEFAULT_MODELS / SEARXNG_QUERY_URL) takes effect — env is authoritative
    // (config-bridge). Model + searxng are in the change check so switching either
    // on the farm (same endpoint) still restarts to re-apply.
    async repoint(endpoint: string | null, apiKey: string | null = null, defaultModel: string | null = null, searxngUrl: string | null = null, tts: { url: string; voice: string; model: string } | null = null, extract: { url: string; key: string } | null = null, contextPerSlot: number | null = null): Promise<void> {
        if (endpoint === this.endpoint && apiKey === this.apiKey && defaultModel === this.defaultModel
            && searxngUrl === this.searxngUrl && JSON.stringify(tts) === JSON.stringify(this.tts)
            && JSON.stringify(extract) === JSON.stringify(this.extract)
            && contextPerSlot === this.contextPerSlot) return;
        // A restart costs a full OWUI boot (~10-30 s of Python imports), so restart
        // only when the EFFECTIVE launch env differs — not when an input differs.
        // E.g. the farm growing its context 65536 → 131072 changes contextPerSlot
        // but not the RAG mode it selects, so the running sidecar is already
        // correct; adopt the new inputs and keep it alive.
        const oldEnv = buildSidecarEnv({ endpoint: this.endpoint, dataDir: this.dataDir, apiKey: this.apiKey, defaultModel: this.defaultModel, searxngUrl: this.searxngUrl, tts: this.tts, extract: this.extract, contextPerSlot: this.contextPerSlot });
        const newEnv = buildSidecarEnv({ endpoint, dataDir: this.dataDir, apiKey, defaultModel, searxngUrl, tts, extract, contextPerSlot });
        if (this.child && JSON.stringify(oldEnv) === JSON.stringify(newEnv)) {
            this.endpoint = endpoint; this.apiKey = apiKey; this.defaultModel = defaultModel;
            this.searxngUrl = searxngUrl; this.tts = tts; this.extract = extract;
            this.contextPerSlot = contextPerSlot;
            console.log(`[sidecar] repoint: inputs changed but the launch env is identical — keeping the running sidecar (ctx/slot now ${contextPerSlot})`);
            return;
        }
        console.log(`[sidecar] repoint ${this.endpoint} → ${endpoint} (model ${this.defaultModel} → ${defaultModel}, search ${this.searxngUrl} → ${searxngUrl}, tts ${this.tts?.url} → ${tts?.url}, ocr ${this.extract?.url} → ${extract?.url}, ctx/slot ${this.contextPerSlot} → ${contextPerSlot})`);
        this.setState({ status: 'restarting', endpoint });
        await this.stop({ keepState: true });
        await this.start({ endpoint, dataDir: this.dataDir, apiKey, defaultModel, searxngUrl, tts, extract, contextPerSlot });
    }

    // Move to a new data folder (restart pointing at it).
    async setDataDir(dataDir: string): Promise<void> {
        if (dataDir === this.dataDir) return;
        this.setState({ status: 'restarting', dataDir });
        await this.stop({ keepState: true });
        await this.start({ endpoint: this.endpoint, dataDir, apiKey: this.apiKey, defaultModel: this.defaultModel, searxngUrl: this.searxngUrl, tts: this.tts, extract: this.extract, contextPerSlot: this.contextPerSlot });
    }

    async stop(opts: { keepState?: boolean } = {}): Promise<void> {
        this.gen++;                 // supersede any in-flight start()
        const child = this.child;
        this.child = null;          // null BEFORE killing so the exit event is ignored
        if (child) await killTree(child.pid);
        if (!opts.keepState) this.setState({ status: 'stopped', url: null });
    }

    private onChildExit(child: ChildProcess, code: number | null): void {
        // Ignore exits from a child that's already been replaced/stopped (we null
        // this.child on stop/restart, so an intentional teardown never reaches here).
        if (child !== this.child) return;
        this.child = null;
        // Unexpected crash → bounded auto-restart so a transient failure self-heals.
        if (this.crashRestarts < MAX_CRASH_RESTARTS) {
            this.crashRestarts++;
            console.warn(`[sidecar] exited (code ${code}); restart ${this.crashRestarts}/${MAX_CRASH_RESTARTS}`);
            this.setState({ status: 'restarting', url: null, message: `Sidecar restarted (${this.crashRestarts}/${MAX_CRASH_RESTARTS})` });
            this.start({ endpoint: this.endpoint, dataDir: this.dataDir, apiKey: this.apiKey, defaultModel: this.defaultModel, searxngUrl: this.searxngUrl, tts: this.tts, extract: this.extract });
        } else {
            this.setState({ status: 'error', url: null, message: `Open WebUI keeps exiting (code ${code}). Check logs.` });
        }
    }

    private logChild(d: Buffer): void {
        const text = d.toString();
        for (const line of text.split(/\r?\n/)) if (line.trim()) console.log(`[owui] ${line}`);
    }
}
