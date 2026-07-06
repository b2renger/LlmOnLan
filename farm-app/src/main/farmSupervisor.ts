// FarmSupervisor — owns the `lol up` farm process lifecycle. A clone of the client
// shell's SidecarSupervisor, pointed at the farm instead of Open WebUI.
//
// It spawns the bundled farm's `bin/lol.js up` as an Electron-as-Node child
// (ELECTRON_RUN_AS_NODE=1 → process.execPath runs as plain Node), with the bundled
// Python + Ollama prepended to PATH and $LOL_PYTHON set so the farm's own supervision
// (LiteLLM, a spawned Ollama, SearXNG/OCR) uses the bundled runtime. Health = the
// farm's unicast discovery endpoint GET /lol/self returning 200. Bounded crash-restart
// self-heals a transient failure; killTree on stop reaps LiteLLM's uvicorn tree + any
// Ollama `lol up` started (the child is its own process group on POSIX).

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { farmRoot, lolEntry, bundledPython, pythonDir, ollamaDir } from './paths';
import { killTree, waitForHttp, httpGetJson } from './util';
import { reapStaleFarm } from './farmProcess';
import { FarmState } from './types';

// The farm's admin/discovery HTTP port (config.beacon.httpPort default). The farm
// binds it on 0.0.0.0, so 127.0.0.1 reaches it locally.
const SELF_PORT = 41997;
const HOST = '127.0.0.1';
const MAX_CRASH_RESTARTS = 5;

interface SelfSnapshot { ips?: string[]; proxyPort?: number; httpPort?: number }

export class FarmSupervisor extends EventEmitter {
    private child: ChildProcess | null = null;
    private gen = 0;
    private crashRestarts = 0;
    private state: FarmState = { status: 'idle', adminUrl: null, selfUrl: null, lanUrls: [] };

    getState(): FarmState { return this.state; }

    private setState(patch: Partial<FarmState>): void {
        this.state = { ...this.state, ...patch };
        this.emit('state', this.state);
    }

    private selfUrl(): string { return `http://${HOST}:${SELF_PORT}/lol/self`; }
    private adminUrl(): string { return `http://${HOST}:${SELF_PORT}/lol/admin`; }

    // Start (or no-op if already ready).
    async start(): Promise<void> {
        if (this.state.status === 'ready' && this.child) return;
        const myGen = ++this.gen;

        // Reap any still-running child before spawning a new one.
        if (this.child) { const old = this.child; this.child = null; await killTree(old.pid); }
        if (myGen !== this.gen) return;

        this.setState({ status: 'starting', message: undefined });

        const sep = path.delimiter;
        const env = {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            LOL_PYTHON: bundledPython(),
            PATH: `${pythonDir()}${sep}${ollamaDir()}${sep}${process.env.PATH || ''}`,
            // The farm's LiteLLM/Ollama banners log Unicode → force UTF-8 so a Windows
            // cp1252 console can't crash them (same class of bug the farm guards on).
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
        };
        // --no-pick → serve the configured catalog (gemma4:12b) with no prompt. (stdin
        // is already ignored so the picker's TTY check would skip too; --no-pick is
        // belt-and-suspenders.)
        const args = [lolEntry(), 'up', '--no-pick'];
        console.log(`[farm] spawning: node ${args.join(' ')}  (cwd=${farmRoot()})`);

        const child = spawn(process.execPath, args, {
            cwd: farmRoot(),
            env,
            windowsHide: true,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.child = child;
        child.stdout?.on('data', (d) => this.logChild(d));
        child.stderr?.on('data', (d) => this.logChild(d));
        child.on('error', (e) => this.setState({ status: 'error', message: `Failed to launch the farm: ${e.message}` }));
        child.on('exit', (code) => this.onChildExit(child, code));

        // Health-wait: /lol/self answers once the proxy is healthy + the discovery
        // server is up (near the end of `lol up`). First run also warms the model, so
        // allow generous time.
        const healthy = await waitForHttp(this.selfUrl(), { timeoutMs: 180000, intervalMs: 1200 });
        if (myGen !== this.gen) return; // superseded by a newer start()/stop()
        if (healthy) {
            this.crashRestarts = 0;
            const snap = await httpGetJson<SelfSnapshot>(this.selfUrl());
            const proxyPort = snap?.proxyPort || 4000;
            const lanUrls = (snap?.ips || []).map((ip) => `http://${ip}:${proxyPort}/v1`);
            this.setState({ status: 'ready', adminUrl: this.adminUrl(), selfUrl: this.selfUrl(), lanUrls, message: undefined });
            console.log(`[farm] ready — admin ${this.adminUrl()} · LAN ${lanUrls.join('  ') || '(no LAN address)'}`);
        } else {
            this.setState({ status: 'error', message: 'The farm did not become healthy in time. See the log.' });
        }
    }

    async stop(opts: { keepState?: boolean } = {}): Promise<void> {
        this.gen++;                 // supersede any in-flight start()
        const child = this.child;
        this.child = null;          // null BEFORE killing so the exit event is ignored
        if (child) await killTree(child.pid);
        // `lol up`'s plugins spawn detached, so the group-kill above may miss them and its
        // own graceful teardown can race our SIGKILL — reap any survivors by recorded PID.
        await reapStaleFarm();
        if (!opts.keepState) this.setState({ status: 'stopped', adminUrl: null, selfUrl: null });
    }

    // Refresh the LAN addresses from /lol/self (the machine may gain/lose an interface).
    async refreshLan(): Promise<void> {
        if (this.state.status !== 'ready') return;
        const snap = await httpGetJson<SelfSnapshot>(this.selfUrl());
        if (!snap) return;
        const proxyPort = snap.proxyPort || 4000;
        this.setState({ lanUrls: (snap.ips || []).map((ip) => `http://${ip}:${proxyPort}/v1`) });
    }

    private onChildExit(child: ChildProcess, code: number | null): void {
        if (child !== this.child) return; // an already-replaced/stopped child
        this.child = null;
        if (this.crashRestarts < MAX_CRASH_RESTARTS) {
            this.crashRestarts++;
            console.warn(`[farm] exited (code ${code}); restart ${this.crashRestarts}/${MAX_CRASH_RESTARTS}`);
            this.setState({ status: 'restarting', message: `Farm restarted (${this.crashRestarts}/${MAX_CRASH_RESTARTS})` });
            this.start();
        } else {
            this.setState({ status: 'error', message: `The farm keeps exiting (code ${code}). Check the log.` });
        }
    }

    private logChild(d: Buffer): void {
        const text = d.toString();
        for (const line of text.split(/\r?\n/)) if (line.trim()) console.log(`[lol] ${line}`);
    }
}
