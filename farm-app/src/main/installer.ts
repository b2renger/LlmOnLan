// installer — the first-run setup orchestrator. Turns a clean box into a ready farm
// in five phases, emitting a checklist + progress + log to the wizard:
//
//   1 runtime  download portable CPython + Ollama              (runtimeManager)
//   2 farm     copy the bundled farm code → userData/farm (writable) + write config
//   3 model    pull gemma4:12b (~8 GB) with a real % bar       (app-owned Ollama)
//   4 deps     `lol install` → LiteLLM / SearXNG / OCR venvs   (reuses that Ollama)
//   5 launch   handed back to index.ts (start the FarmSupervisor, health-wait)
//
// Why model BEFORE deps: `lol install` also pulls the configured model, but if it's
// already present install just skips it — so pulling first gives the 8 GB download
// its own clean progress bar and avoids a double pull. The app owns the Ollama used
// for the pull and STOPS it before launch, so `lol up` starts Ollama itself with the
// right concurrency + context-length env (a reused bare Ollama would default to a
// 4096 context that truncates documents — see farm config.js).

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { spawn, ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import {
    farmRoot, farmConfigFile, lolEntry, bundledFarmSource,
    bundledPython, bundledOllamaBin, pythonDir, ollamaDir,
} from './paths';
import { loadSettings, updateSettings } from './store';
import { ensureRuntime } from './runtimeManager';
import { killTree, findFreePort } from './util';
import { SetupPhase, SetupPhaseId, SetupProgress, DownloadProgress } from './types';

const MODEL_ID = 'gemma4:12b';
const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const OLLAMA_BASE = `http://${OLLAMA_HOST}:${OLLAMA_PORT}`;

// Runtime dirs a dev checkout's ../farm may carry — never copy them into the app's
// writable farm (they're rebuilt on THIS box by `lol install`).
const FARM_COPY_SKIP = new Set(['.venv', '.searxng', '.extract', '.kokoro', '.git', '.lol-runtime.json', '.lol-id', 'lol.config.json']);

type Emit = (p: SetupProgress) => void;

const PHASE_LABELS: Record<SetupPhaseId, string> = {
    runtime: 'Runtime — Python & Ollama',
    farm: 'Farm code',
    model: `AI model — ${MODEL_ID}`,
    deps: 'Services — proxy, search, OCR',
    launch: 'Launch the farm',
};
const PHASE_ORDER: SetupPhaseId[] = ['runtime', 'farm', 'model', 'deps', 'launch'];

// A tiny phase-list state machine so every emit carries the full checklist.
class Phases {
    private list: SetupPhase[];
    current: SetupPhaseId = 'runtime';   // the phase in flight (for error attribution)
    constructor(private emit: Emit) {
        this.list = PHASE_ORDER.map((id) => ({ id, label: PHASE_LABELS[id], status: 'pending' as const }));
    }
    private find(id: SetupPhaseId): SetupPhase { return this.list.find((p) => p.id === id)!; }
    private push(extra: Partial<SetupProgress> = {}): void { this.emit({ phases: this.list.map((p) => ({ ...p })), ...extra }); }
    log(line: string): void { this.push({ log: line }); }
    start(id: SetupPhaseId): void { this.current = id; this.find(id).status = 'active'; this.find(id).detail = undefined; this.find(id).percent = undefined; this.push(); }
    detail(id: SetupPhaseId, detail: string, percent?: number): void { const p = this.find(id); p.detail = detail; p.percent = percent; this.push(); }
    done(id: SetupPhaseId): void { const p = this.find(id); p.status = 'done'; p.detail = undefined; p.percent = undefined; this.push(); }
    error(id: SetupPhaseId, message: string): void { this.find(id).status = 'error'; this.push({ error: message }); }
    installed(): void { this.push({ installed: true }); }
}

// --- persistent admin token -------------------------------------------------

// Pinned once + persisted. Written into lol.config.json so `lol up` uses it (not an
// ephemeral per-run token) and the app can seed it into the admin webview so the
// panel unlocks with no prompt.
function ensureAdminToken(): string {
    const s = loadSettings();
    if (s.adminToken) return s.adminToken;
    const tok = randomBytes(24).toString('hex');
    updateSettings({ adminToken: tok });
    return tok;
}

// --- farm copy + config -----------------------------------------------------

function copyFarm(): void {
    const src = bundledFarmSource();
    if (!fs.existsSync(src)) throw new Error(`Bundled farm code not found at ${src}`);
    fs.mkdirSync(farmRoot(), { recursive: true });
    fs.cpSync(src, farmRoot(), {
        recursive: true,
        // Skip the on-box runtime/state dirs (a dev checkout's) + the generated proxy config.
        filter: (from) => {
            const rel = path.relative(src, from);
            if (!rel) return true;
            const top = rel.split(path.sep)[0];
            if (FARM_COPY_SKIP.has(top)) return false;
            if (rel.replace(/\\/g, '/') === 'litellm/config.generated.yaml') return false;
            return true;
        },
    });
}

// `share` picks the network posture: private (false) binds the proxy + discovery to
// 127.0.0.1 and turns the beacon OFF (no other machine can reach/use the farm);
// shared (true) binds 0.0.0.0 + advertises via the beacon. Everything else is left to
// the farm's zod defaults (SearXNG/OCR on, TTS off, ports, 16k context).
export function writeFarmConfig(adminToken: string, share: boolean): void {
    const config = {
        name: `${require('os').hostname()} Farm`,
        models: [{ id: MODEL_ID, default: true }],
        admin: { token: adminToken },
        beacon: { enabled: share },
        proxy: { host: share ? '0.0.0.0' : '127.0.0.1' },
    };
    fs.writeFileSync(farmConfigFile(), JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// Route the farm's plugins off taken ports before launch. SearXNG (default 8888 —
// JupyterLab's port, commonly occupied on a DGX) and the OCR service (8890) both fail
// hard with "address already in use" if their port is taken, which disables the plugin.
// We check each and, if occupied, patch lol.config.json to a free port; the client
// adapts automatically because the port is advertised in the beacon snapshot. Called
// before every farm start. No-op when the defaults are free (the common case).
export async function ensurePluginPorts(): Promise<void> {
    if (!fs.existsSync(farmConfigFile())) return;
    let cfg: any;
    try { cfg = JSON.parse(fs.readFileSync(farmConfigFile(), 'utf8')); } catch { return; }
    let changed = false;
    for (const [key, def] of [['websearch', 8888], ['ocr', 8890]] as [string, number][]) {
        const wanted = (cfg[key] && cfg[key].port) || def;
        const free = await findFreePort(wanted);
        if (free !== wanted) {
            cfg[key] = { ...(cfg[key] || {}), port: free };
            changed = true;
            console.log(`[ports] ${key}: ${wanted} is in use — using ${free} instead`);
        }
    }
    if (changed) fs.writeFileSync(farmConfigFile(), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

// Live toggle: patch ONLY the share-relevant fields in an existing lol.config.json,
// preserving everything else. No-op if the config doesn't exist yet (first-run
// writeFarmConfig handles that). Takes effect on the next `lol up` (the bind address
// + beacon are read at boot), so the caller restarts the farm.
export function setShareMode(share: boolean): void {
    if (!fs.existsSync(farmConfigFile())) return;
    let cfg: any;
    try { cfg = JSON.parse(fs.readFileSync(farmConfigFile(), 'utf8')); } catch { return; }
    cfg.beacon = { ...(cfg.beacon || {}), enabled: share };
    cfg.proxy = { ...(cfg.proxy || {}), host: share ? '0.0.0.0' : '127.0.0.1' };
    fs.writeFileSync(farmConfigFile(), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

// --- app-owned Ollama for the model pull ------------------------------------

function childEnv(): NodeJS.ProcessEnv {
    const sep = path.delimiter;
    return {
        ...process.env,
        LOL_PYTHON: bundledPython(),
        PATH: `${pythonDir()}${sep}${ollamaDir()}${sep}${process.env.PATH || ''}`,
    };
}

function ollamaVersion(timeoutMs = 3000): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.get(`${OLLAMA_BASE}/api/version`, { timeout: timeoutMs }, (res) => {
            res.resume();
            resolve((res.statusCode || 0) === 200);
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(false));
    });
}

async function startOllama(): Promise<ChildProcess | null> {
    if (await ollamaVersion()) return null; // one's already up (reuse it, don't own it)
    const child = spawn(bundledOllamaBin(), ['serve'], {
        env: { ...childEnv(), OLLAMA_HOST: `${OLLAMA_HOST}:${OLLAMA_PORT}` },
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: 'ignore',
    });
    child.on('error', () => { /* surfaced by the version wait below */ });
    for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 750));
        if (await ollamaVersion()) return child;
    }
    throw new Error('Ollama did not become reachable after starting it.');
}

// Pull a model with a REAL percent bar (Ollama's /api/pull NDJSON carries
// completed/total bytes; the farm's ollama.js only forwards the status text, so we
// read the stream ourselves here).
function pullModel(id: string, onPct: (pct: number | undefined, status: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const data = Buffer.from(JSON.stringify({ model: id, stream: true }));
        const req = http.request(`${OLLAMA_BASE}/api/pull`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': data.length },
            timeout: 60 * 60 * 1000,
        }, (res) => {
            let buf = '';
            let failed: string | null = null;
            res.on('data', (chunk) => {
                buf += chunk;
                let nl: number;
                while ((nl = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, nl).trim();
                    buf = buf.slice(nl + 1);
                    if (!line) continue;
                    try {
                        const o = JSON.parse(line);
                        if (o.error) { failed = o.error; continue; }
                        const pct = o.total ? Math.round((o.completed || 0) / o.total * 100) : undefined;
                        onPct(pct, String(o.status || ''));
                    } catch { /* ignore partial */ }
                }
            });
            res.on('end', () => {
                if (failed) return reject(new Error(failed));
                if (res.statusCode !== 200) return reject(new Error(`pull HTTP ${res.statusCode}`));
                resolve();
            });
        });
        req.on('timeout', () => req.destroy(new Error('pull timeout')));
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// --- `lol install` (venvs + plugins) ----------------------------------------

function runLolInstall(onLine: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [lolEntry(), 'install'], {
            cwd: farmRoot(),
            env: { ...childEnv(), ELECTRON_RUN_AS_NODE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const feed = (d: Buffer) => { for (const l of d.toString().split(/\r?\n/)) if (l.trim()) onLine(l.trim()); };
        child.stdout?.on('data', feed);
        child.stderr?.on('data', feed);
        child.on('error', reject);
        child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`lol install exited with code ${code}`)));
    });
}

// --- orchestrate ------------------------------------------------------------

// Run all five phases. `doLaunch` starts the FarmSupervisor + resolves once it's
// healthy (throws otherwise) — passed in so index.ts owns the supervisor while the
// wizard still drives the checklist's launch phase. Returns the pinned admin token
// on success. Idempotent + resumable: every phase skips work already done, so a Retry
// after a failure only redoes what's missing.
export async function runSetup(emit: Emit, doLaunch: () => Promise<void>): Promise<{ ok: boolean; adminToken?: string; error?: string }> {
    const ph = new Phases(emit);
    const adminToken = ensureAdminToken();
    let ownedOllama: ChildProcess | null = null;

    try {
        // 1. Runtime.
        ph.start('runtime');
        const rt = await ensureRuntime((p: DownloadProgress) => {
            if (p.phase === 'download') {
                const mb = p.totalMB ? ` ${p.receivedMB}/${p.totalMB} MB` : '';
                ph.detail('runtime', `Downloading ${p.what}…${mb}`, p.percent);
            } else if (p.phase === 'extract') {
                ph.detail('runtime', `Unpacking ${p.what}…`);
            } else if (p.phase === 'check') {
                ph.detail('runtime', p.message || 'Locating…');
            }
            if (p.message) ph.log(`[runtime] ${p.message}`);
        });
        if (!rt.ok) { ph.error('runtime', rt.error || 'Runtime download failed.'); return { ok: false, error: rt.error }; }
        ph.done('runtime');

        // 2. Farm code + config.
        ph.start('farm');
        ph.log('[farm] copying farm code to a writable location…');
        copyFarm();
        writeFarmConfig(adminToken, loadSettings().shareWithNetwork); // private by default
        if (!fs.existsSync(lolEntry())) throw new Error('farm copy did not produce bin/lol.js');
        ph.done('farm');

        // 3. Model — start an app-owned Ollama, pull gemma4:12b with a bar.
        ph.start('model');
        ph.log('[model] starting Ollama…');
        ownedOllama = await startOllama();
        let lastStatus = '';
        await pullModel(MODEL_ID, (pct, status) => {
            ph.detail('model', status || `Pulling ${MODEL_ID}…`, pct);
            if (status && status !== lastStatus) { lastStatus = status; ph.log(`[model] ${status}`); }
        });
        ph.done('model');

        // 4. Deps — `lol install` builds the LiteLLM/SearXNG/OCR venvs (it reuses the
        //    Ollama above and finds gemma4:12b present, so it doesn't re-pull).
        ph.start('deps');
        await runLolInstall((line) => { ph.detail('deps', line); ph.log(`[deps] ${line}`); });
        ph.done('deps');

        // 5. Launch — hand off to the FarmSupervisor (owned by index.ts). Release the
        //    app-owned Ollama FIRST (in finally we'd race the launch) so `lol up` owns
        //    Ollama with the right env; do it here explicitly before doLaunch.
        if (ownedOllama) { await killTree(ownedOllama.pid); ownedOllama = null; }
        ph.start('launch');
        ph.log('[launch] starting the farm…');
        await doLaunch();
        ph.done('launch');
        ph.installed();

        return { ok: true, adminToken };
    } catch (e: any) {
        ph.error(ph.current, e.message || String(e)); // attribute to the phase that was in flight
        return { ok: false, error: e.message || String(e) };
    } finally {
        // Release the Ollama we started so `lol up` owns it with the right env
        // (concurrency, keep-alive, 16k context). Leave a pre-existing one alone.
        if (ownedOllama) await killTree(ownedOllama.pid);
    }
}
