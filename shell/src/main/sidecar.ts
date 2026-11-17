// Sidecar supervisor — owns the Open WebUI child process lifecycle.
//
// Responsibilities (M0): spawn `open-webui serve --host 127.0.0.1 --port <free>`
// with the env from config-bridge, health-wait on /health, expose a live state,
// restart on crash, repoint (restart with a new farm endpoint) and stop cleanly.
// OWUI is a black box: we drive it only via env + its HTTP health surface.

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { bundledOwuiVersion, resolveSidecarCommand, sidecarExists } from './paths';
import { app, net } from 'electron';
import { adoptEmbedding, buildSidecarEnv, embedAnswers, embeddingBlocked, embeddingContract, envProxy, FarmEmbed, FarmStt, folderContract, hubAnswers, miniLmState, repairMiniLm } from './configBridge';
import { findFreePort, killTree, waitForHttp } from './util';
import { SidecarState } from './types';

const HOST = '127.0.0.1';

// Open WebUI migrates webui.db (the chats, folders, settings) forward when a new version first starts on it, and no
// older version opens it again (0.13: "rolling updates are not supported"). So before an Open WebUI version starts on
// a folder for the first time, the database is copied beside itself, once: webui.db.before-owui-<version> (and its -wal,
// which holds the latest writes). The folder records the version that last started on it in lol-owui-version. A copy
// that fails is logged and the start goes on: a chat that does not open on class day is worse than no copy.
// ponytail: one copy per Open WebUI version, never pruned (a few MB each); a Preferences "restore" is the upgrade path.
export function keepDbBeforeEngine(dataDir: string, version: string): string | null {
    const db = path.join(dataDir, 'webui.db');
    const marker = path.join(dataDir, 'lol-owui-version');
    let last = '';
    try { last = fs.readFileSync(marker, 'utf8').trim(); } catch { /* a folder from before this check */ }
    if (last === version || !version || version === 'unknown') return null;
    let kept: string | null = null;
    if (fs.existsSync(db)) {
        const copy = `${db}.before-owui-${version}`;
        try {
            if (!fs.existsSync(copy)) {
                fs.copyFileSync(db, copy);
                if (fs.existsSync(`${db}-wal`)) fs.copyFileSync(`${db}-wal`, `${copy}-wal`);
            }
            kept = copy;
        } catch (e) {
            console.warn(`[sidecar] could not copy the chats before Open WebUI ${version}: ${(e as Error).message}`);
            return null;   // the marker stays: the next start tries again
        }
    }
    try { fs.writeFileSync(marker, version, 'utf8'); } catch { /* tried again next start */ }
    return kept;
}

// Open WebUI builds webui.db at its first start on a folder by running ~72 migrations, and on SQLite they are not
// transactional: a kill inside one leaves the database half-migrated, and every later start exits with code 1
// ("table … already exists", "duplicate column name …"; reproduced 2026-11-17 on 0.13.3, plans/OWUI_START_PLAN.md).
// So a start that finds no webui.db writes FIRST_START_MARKER before Open WebUI runs and removes it once Open WebUI is
// healthy. A start that finds the marker knows the first start never finished: the database cannot hold anything a
// person wrote (Open WebUI never opened), so it is moved into interrupted-<time>/ and Open WebUI builds a new one.
export const FIRST_START_MARKER = 'lol-owui-first-start';
export function setAsideUnfinishedDb(dataDir: string, stamp = new Date().toISOString().replace(/[:.]/g, '-')): string | null {
    if (!fs.existsSync(path.join(dataDir, FIRST_START_MARKER))) return null;
    const files = ['webui.db', 'webui.db-wal', 'webui.db-shm'].filter((n) => fs.existsSync(path.join(dataDir, n)));
    if (!files.length) return null;
    const dest = path.join(dataDir, `interrupted-${stamp}`);
    fs.mkdirSync(dest, { recursive: true });
    for (const n of files) fs.renameSync(path.join(dataDir, n), path.join(dest, n));
    return dest;
}

// Open WebUI's own output, kept on this computer in <userData>/logs/owui.log (1 MB, then the old one as .1), so an
// error a person saw can be read from a file: in the class of 2026-11-17 it went to the console only.
export function owuiLog(lines: string[]): void {
    try {
        const dir = path.join(app.getPath('userData'), 'logs');
        fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, 'owui.log');
        try { if (fs.statSync(f).size > 1 << 20) fs.renameSync(f, `${f}.1`); } catch { /* no file yet */ }
        const at = new Date().toISOString();
        fs.appendFileSync(f, lines.map((l) => `${at} ${l}\n`).join(''));
    } catch { /* the log is a convenience */ }
}

// What start() takes — and what launchOpts() hands back, field for field.
export interface SidecarStartOpts {
    endpoint: string | null;
    dataDir: string;
    apiKey?: string | null;
    defaultModel?: string | null;
    searxngUrl?: string | null;
    tts?: { url: string; voice: string; model: string } | null;
    extract?: { url: string; key: string } | null;
    embed?: FarmEmbed | null;
    stt?: FarmStt | null;
    contextPerSlot?: number | null;
}
// Told once when a launch is ready (app.js toasts it). Plain words: the person acts on them.
const REINDEX_NOTICE = 'Documents are now indexed on the farm, with a model that understands many languages. The documents you added before need indexing again, once: in Open WebUI open Admin Panel ▸ Settings ▸ Documents, then press Reindex next to "Reindex Knowledge and Memory Vectors". A file attached straight to an older chat: attach it again.';
const BLOCKED_NOTICE = 'This farm does not index documents the way your documents are indexed, so uploading a document fails here: nothing is indexed with another model. Chat works. Uploads work again on a farm that indexes documents.';
const HEALTH_PATH = '/health';
const MAX_CRASH_RESTARTS = 5;
// A fresh Mac's first start took more than 137 s in the class of 2026-11-17. Past the first 3 minutes the panel says it
// is still starting and the wait goes on, up to 10 minutes in all: an error there invited a Retry, and a Retry kills.
const FIRST_WAIT_MS = 180_000;
const MORE_WAIT_MS = 420_000;
const SLOW_START = 'Open WebUI is still starting. The first start on a computer can take several minutes: leave LlmOnLan open.';

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
    private embed: FarmEmbed | null = null;         // farm document search → OWUI's embedding engine (configBridge)
    private stt: FarmStt | null = null;             // farm speech to text → OWUI AUDIO_STT_* (configBridge)
    private contextPerSlot: number | null = null; // farm's per-slot context → whole-doc vs top-k RAG mode
    // Generation token: every start()/stop() bumps it, so an in-flight start()
    // that was superseded (by a repoint/stop/crash-restart) aborts at its awaits
    // instead of clobbering the newer child. The child 'exit' handler compares the
    // exiting process by IDENTITY against this.child, so a late exit from an old
    // child never triggers a spurious restart.
    private gen = 0;
    private crashRestarts = 0;
    // True from the spawn until Open WebUI is healthy, gives up, or exits: a kill then can land inside a migration.
    // A repoint meanwhile is kept in `deferred` (only the latest) and applied when the start ends.
    private booting = false;
    private deferred: SidecarStartOpts | null = null;
    private notice: string | undefined;   // told to the person once this launch is ready (an offline start)
    private state: SidecarState = { status: 'idle', url: null, dataDir: '', endpoint: null };

    getState(): SidecarState { return this.state; }

    private setState(patch: Partial<SidecarState>): void {
        this.state = { ...this.state, ...patch };
        this.emit('state', this.state);
    }

    // Everything the sidecar is launched with, as start() takes it. The ONE place that re-reads the
    // stored inputs: every restart path (crash restart, data-folder move, the repoint env diff)
    // goes through here, so a field added to start() cannot be dropped by one of them again. The
    // crash restart used to rebuild the list by hand and left out contextPerSlot — after any OWUI
    // crash a 16k farm was relaunched with RAG_FULL_CONTEXT=true (docs review SA-1).
    private launchOpts(): SidecarStartOpts {
        return {
            endpoint: this.endpoint, dataDir: this.dataDir, apiKey: this.apiKey, defaultModel: this.defaultModel,
            searxngUrl: this.searxngUrl, tts: this.tts, extract: this.extract, embed: this.embed, stt: this.stt, contextPerSlot: this.contextPerSlot,
        };
    }

    // Start (or no-op if already running with the same endpoint+dataDir).
    async start(opts: SidecarStartOpts): Promise<void> {
        this.endpoint = opts.endpoint;
        this.dataDir = opts.dataDir;
        this.apiKey = opts.apiKey ?? null;
        this.defaultModel = opts.defaultModel ?? null;
        this.searxngUrl = opts.searxngUrl ?? null;
        this.tts = opts.tts ?? null;
        this.extract = opts.extract ?? null;
        this.embed = opts.embed ?? null;
        this.stt = opts.stt ?? null;
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

        // The first meeting of this data folder with a farm that indexes documents: the folder adopts its contract for
        // good (configBridge EMBEDDING_CONTRACTS), before the env is built from it — once one search answered from
        // this computer (a firewall closing the farm's port would otherwise switch the folder and fail every upload;
        // this launch then stays on MiniLM). A folder MiniLM had indexed is told to Reindex once; the app never presses
        // it (Open WebUI's admin API is not ours to call). Per launch, like hubOffline: repoint's comparison never sees it.
        let embed = this.embed;
        if (embed && !folderContract(this.dataDir) && embeddingContract(this.dataDir, embed) && !(await embedAnswers(embed))) {
            console.warn(`[sidecar] the farm's document search at ${embed.url} does not answer from this computer: this launch indexes documents here, as before`);
            embed = null;
        }
        if (myGen !== this.gen) return;
        let adopted: ReturnType<typeof adoptEmbedding> = null;
        try {
            adopted = adoptEmbedding(this.dataDir, embed);
            if (adopted) console.log(`[sidecar] this data folder now indexes documents on the farm (${folderContract(this.dataDir)})`);
        } catch (e) { console.warn(`[sidecar] could not record the data folder's document search: ${(e as Error).message}`); }
        // MiniLM only matters to a folder still on it: Open WebUI never loads it with the farm's engine.
        const onMiniLm = !embeddingContract(this.dataDir, embed);
        const blocked = embeddingBlocked(this.dataDir, embed);
        if (blocked) console.log('[sidecar] this farm does not offer the document search this data folder uses: uploads fail rather than mix two models');
        // No Open WebUI runs now (the old child is gone): the one moment a broken embedding model can be removed.
        if (onMiniLm) {
            try { const did = repairMiniLm(); if (did) console.log(`[sidecar] ${did}`); }
            catch (e) { console.warn(`[sidecar] could not remove a broken embedding model: ${(e as Error).message}`); }
        }
        // A MiniLM not on disk can only come from huggingface.co. Where that site does not answer (a closed LAN),
        // the hub's own retries (5 per file, each up to the system's connect timeout) held the boot 123-466 s, past
        // the 180 s wait below, so the chat never opened (measured 2026-10-08). Asked once, 3 s: no answer → this
        // launch runs hub-offline, the chat opens in ~12 s and uploads wait for a start with the network. Per launch,
        // outside buildSidecarEnv, so repoint()'s comparison never sees it. Probed through Electron's network stack
        // (the system proxy, which the hub's httpx also reads), and not at all behind an env proxy.
        const hubOffline = onMiniLm && miniLmState() !== 'cached' && !envProxy()
            && !(await hubAnswers(undefined, undefined, (u, init) => net.fetch(u, init)));
        if (myGen !== this.gen) return;
        if (hubOffline) console.log('[sidecar] huggingface.co does not answer and the embedding model is not on disk: starting offline (uploads wait for a start with the network)');
        this.notice = [
            hubOffline ? 'Document uploads need one start with internet access: the search model (about 92 MB) is not on this computer yet, and huggingface.co does not answer. Chat works. Quit and reopen LlmOnLan once this computer is online.' : '',
            adopted === 'reindex' ? REINDEX_NOTICE : '',
            blocked ? BLOCKED_NOTICE : '',
        ].filter(Boolean).join(' ') || undefined;

        const env = {
            ...process.env,
            ...buildSidecarEnv({ ...this.launchOpts(), embed }),
            ...(hubOffline ? { HF_HUB_OFFLINE: '1' } : {}),
            // OWUI logs Unicode (loguru/rich) → force UTF-8 so it doesn't crash a
            // Windows cp1252 console (same class of bug as LiteLLM's banner).
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
        };

        // Before keepDbBeforeEngine: a half-built first database is not worth a copy.
        try {
            const aside = setAsideUnfinishedDb(this.dataDir);
            if (aside) console.warn(`[sidecar] Open WebUI's first start on this folder never finished: its unfinished database was moved to ${aside}`);
        } catch (e) { console.warn(`[sidecar] could not move an unfinished database aside: ${(e as Error).message}`); }
        const marker = path.join(this.dataDir, FIRST_START_MARKER);
        if (!fs.existsSync(path.join(this.dataDir, 'webui.db'))) {
            try { fs.writeFileSync(marker, new Date().toISOString(), 'utf8'); } catch { /* the folder is checked elsewhere */ }
        }
        const kept = keepDbBeforeEngine(this.dataDir, bundledOwuiVersion());
        if (kept) console.log(`[sidecar] the chats were copied to ${kept} before this Open WebUI's first start on the folder`);

        const fullArgs = [...args, '--host', HOST, '--port', String(this.port)];
        console.log(`[sidecar] spawning (${source}): ${command} ${fullArgs.join(' ')}  DATA_DIR=${this.dataDir} endpoint=${this.endpoint}`);
        owuiLog([`--- start: Open WebUI ${bundledOwuiVersion()}, farm ${this.endpoint}${fs.existsSync(marker) ? ', first start on this folder' : ''}`]);

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
        this.booting = true;

        // Health-wait (first run downloads the embedding model → allow generous time).
        // 300 ms polling: OWUI comes up between polls, so a coarse interval adds
        // its own tail latency to every boot the user is staring at.
        let healthy = await waitForHttp(`${url}${HEALTH_PATH}`, { timeoutMs: FIRST_WAIT_MS, intervalMs: 300 });
        if (myGen !== this.gen) return; // a newer start()/stop() superseded us
        if (!healthy && this.child === child) {
            this.setState({ status: 'starting', message: SLOW_START });
            healthy = await waitForHttp(`${url}${HEALTH_PATH}`, { timeoutMs: MORE_WAIT_MS, intervalMs: 1000 });
            if (myGen !== this.gen) return;
        }
        this.booting = false;
        if (healthy) {
            this.crashRestarts = 0;
            try { fs.rmSync(marker, { force: true }); } catch { /* removed at the next healthy start */ }
            this.setState({ status: 'ready', url, message: undefined, notice: this.notice });
            console.log(`[sidecar] ready at ${url} (DATA_DIR=${this.dataDir})`);
        } else {
            this.setState({ status: 'error', url: null, message: 'Open WebUI did not become healthy in time. See logs.' });
        }
        this.applyDeferred();
    }

    // A repoint that arrived while Open WebUI was starting, applied now that the start is over.
    private takeDeferred(): SidecarStartOpts | null { const d = this.deferred; this.deferred = null; return d; }
    private applyDeferred(): void {
        const d = this.takeDeferred();
        if (d) void this.repoint(d.endpoint, d.apiKey ?? null, d.defaultModel ?? null, d.searxngUrl ?? null, d.tts ?? null, d.extract ?? null, d.contextPerSlot ?? null, d.embed ?? null, d.stt ?? null);
    }

    // True while a kill could land inside Open WebUI's start (index.ts's Retry waits instead of killing).
    isBooting(): boolean { return this.booting && !!this.child; }

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
    async repoint(endpoint: string | null, apiKey: string | null = null, defaultModel: string | null = null, searxngUrl: string | null = null, tts: { url: string; voice: string; model: string } | null = null, extract: { url: string; key: string } | null = null, contextPerSlot: number | null = null, embed: FarmEmbed | null = null, stt: FarmStt | null = null): Promise<void> {
        if (endpoint === this.endpoint && apiKey === this.apiKey && defaultModel === this.defaultModel
            && searxngUrl === this.searxngUrl && JSON.stringify(tts) === JSON.stringify(this.tts)
            && JSON.stringify(extract) === JSON.stringify(this.extract)
            && JSON.stringify(embed) === JSON.stringify(this.embed)
            && JSON.stringify(stt) === JSON.stringify(this.stt)
            && contextPerSlot === this.contextPerSlot) { this.deferred = null; return; }   // back where it runs: drop a waiting move
        // A restart costs a full OWUI boot (~10-30 s of Python imports), so restart
        // only when the EFFECTIVE launch env differs — not when an input differs.
        // E.g. the farm growing its context 65536 → 131072 changes contextPerSlot
        // but not the RAG mode it selects, so the running sidecar is already
        // correct; adopt the new inputs and keep it alive.
        const oldEnv = buildSidecarEnv(this.launchOpts());
        const newEnv = buildSidecarEnv({ endpoint, dataDir: this.dataDir, apiKey, defaultModel, searxngUrl, tts, extract, embed, stt, contextPerSlot });
        if (this.child && JSON.stringify(oldEnv) === JSON.stringify(newEnv)) {
            this.endpoint = endpoint; this.apiKey = apiKey; this.defaultModel = defaultModel;
            this.searxngUrl = searxngUrl; this.tts = tts; this.extract = extract; this.embed = embed; this.stt = stt;
            this.contextPerSlot = contextPerSlot;
            this.deferred = null;
            console.log(`[sidecar] repoint: inputs changed but the launch env is identical — keeping the running sidecar (ctx/slot now ${contextPerSlot})`);
            return;
        }
        if (this.isBooting()) {
            // Never kill Open WebUI while it starts: a kill inside a migration breaks its database for good.
            this.deferred = { endpoint, dataDir: this.dataDir, apiKey, defaultModel, searxngUrl, tts, extract, embed, stt, contextPerSlot };
            console.log(`[sidecar] repoint to ${endpoint} waits until Open WebUI has finished starting`);
            return;
        }
        console.log(`[sidecar] repoint ${this.endpoint} → ${endpoint} (model ${this.defaultModel} → ${defaultModel}, search ${this.searxngUrl} → ${searxngUrl}, tts ${this.tts?.url} → ${tts?.url}, ocr ${this.extract?.url} → ${extract?.url}, documents ${this.embed?.url} → ${embed?.url}, speech ${this.stt?.url} → ${stt?.url}, ctx/slot ${this.contextPerSlot} → ${contextPerSlot})`);
        this.setState({ status: 'restarting', endpoint });
        await this.stop({ keepState: true });
        await this.start({ endpoint, dataDir: this.dataDir, apiKey, defaultModel, searxngUrl, tts, extract, embed, stt, contextPerSlot });
    }

    // Move to a new data folder (restart pointing at it).
    async setDataDir(dataDir: string): Promise<void> {
        if (dataDir === this.dataDir) return;
        this.setState({ status: 'restarting', dataDir });
        await this.stop({ keepState: true });
        await this.start({ ...this.launchOpts(), dataDir });
    }

    async stop(opts: { keepState?: boolean } = {}): Promise<void> {
        this.gen++;                 // supersede any in-flight start()
        const child = this.child;
        this.child = null;          // null BEFORE killing so the exit event is ignored
        this.booting = false;
        this.deferred = null;       // whoever stops decides what starts next
        if (child) await killTree(child.pid);
        if (!opts.keepState) this.setState({ status: 'stopped', url: null });
    }

    private onChildExit(child: ChildProcess, code: number | null): void {
        // Ignore exits from a child that's already been replaced/stopped (we null
        // this.child on stop/restart, so an intentional teardown never reaches here).
        if (child !== this.child) return;
        this.child = null;
        this.booting = false;
        // Unexpected crash → bounded auto-restart so a transient failure self-heals (with a repoint that was waiting).
        if (this.crashRestarts < MAX_CRASH_RESTARTS) {
            this.crashRestarts++;
            console.warn(`[sidecar] exited (code ${code}); restart ${this.crashRestarts}/${MAX_CRASH_RESTARTS}`);
            this.setState({ status: 'restarting', url: null, message: `Sidecar restarted (${this.crashRestarts}/${MAX_CRASH_RESTARTS})` });
            this.start(this.takeDeferred() ?? this.launchOpts());
        } else {
            this.setState({ status: 'error', url: null, message: `Open WebUI keeps exiting (code ${code}). Check logs.` });
        }
    }

    private logChild(d: Buffer): void {
        const text = d.toString();
        const keep: string[] = [];
        for (const line of text.split(/\r?\n/)) {
            if (!line.trim()) continue;
            console.log(`[owui] ${line}`);
            // Into owui.log: all of a start (Open WebUI has opened nothing a person wrote yet); once it runs, only what is
            // not INFO (warnings, errors, tracebacks), so no request line or chat id is kept (docs/context/privacy.md).
            if (!this.booting && /\bINFO\b/.test(line)) continue;
            keep.push(line.replace(/\x1b\[[0-9;]*m/g, ''));
        }
        if (keep.length) owuiLog(keep);
    }
}
