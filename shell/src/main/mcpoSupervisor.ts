// mcpo supervisor — owns the LOCAL "assistant tools" server that lets the chat
// drive Blender on THIS machine. It runs Open WebUI's own MCP→OpenAPI proxy
// (`mcpo`) wrapping the Blender MCP server (`blender-mcp`), and OWUI consumes it
// as an OpenAPI tool server (config-bridge injects TOOL_SERVER_CONNECTIONS). The
// user owns the Blender side (install the BlenderMCP addon + Start the server);
// we own making OWUI turnkey — flip the toggle and the Blender tools appear.
//
// Design decisions (all validated by a live spike on Windows before writing this):
//   • Reuse the sidecar's standalone CPython (it ships pip) to build a DEDICATED
//     venv under userData/mcp-tools/ — never the OWUI env, so it can't perturb it.
//     Install on FIRST activation (opt-in), mirroring the farm's SearXNG/Kokoro.
//   • Bind mcpo to 127.0.0.1 + a random --api-key. `execute_blender_code` is
//     arbitrary code execution, and mcpo defaults to 0.0.0.0 — localhost-only bind
//     is the containment; the bearer key (OWUI sends it via the connection) is
//     defense-in-depth. No --strict-auth so /openapi.json stays fetchable.
//   • DISABLE_TELEMETRY in the child env — blender-mcp otherwise POSTs telemetry to
//     a Supabase endpoint (verified in its source); this honors the privacy invariant.
//   • Health-wait on /openapi.json: mcpo serves the full tool schema even when
//     Blender ISN'T running (connection is per-call/lazy), so the tool server
//     registers immediately and the user can start Blender whenever.

import { EventEmitter } from 'events';
import { spawn, ChildProcess, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { resolveSidecarPython, mcpToolsDir } from './paths';
import { findFreePort, killTree, waitForHttp } from './util';
import { McpoState } from './types';

const HOST = '127.0.0.1';
const IS_WIN = process.platform === 'win32';
const MAX_CRASH_RESTARTS = 3;
// Installed into the tools venv. blender-mcp = the MCP server that talks to the
// user's Blender addon; mcpo = OWUI's proxy that exposes it as an OpenAPI server.
const PACKAGES = ['mcpo', 'blender-mcp'];
const MARKER_TAG = PACKAGES.join(','); // changing the set re-triggers install

function venvDir(): string { return path.join(mcpToolsDir(), 'venv'); }
function venvBin(name: string): string {
    return IS_WIN ? path.join(venvDir(), 'Scripts', `${name}.exe`) : path.join(venvDir(), 'bin', name);
}
function venvPython(): string { return venvBin('python'); }
function markerFile(): string { return path.join(mcpToolsDir(), '.installed'); }
function readMarker(): string | null {
    try { return fs.readFileSync(markerFile(), 'utf8').trim(); } catch { return null; }
}

// A base Python WITH pip to build the venv from: the sidecar's standalone CPython
// first, else a system Python (dev, or before the OWUI download). Mirrors the
// farm's install ladder. `py -3.x` on Windows, `python3.x` elsewhere.
function probe(cmd: string, args: string[]): boolean {
    try { execFileSync(cmd, [...args, '--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
function resolveBasePython(): { cmd: string; args: string[] } | null {
    const preferred = resolveSidecarPython();
    if (fs.existsSync(preferred)) return { cmd: preferred, args: [] };
    const ladder: Array<[string, string[]]> = IS_WIN
        ? [['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3']], ['python', []], ['python3', []]]
        : [['python3.12', []], ['python3.11', []], ['python3', []], ['python', []]];
    for (const [cmd, args] of ladder) if (probe(cmd, args)) return { cmd, args };
    return null;
}

function logLines(tag: string, d: Buffer): void {
    for (const line of d.toString().split(/\r?\n/)) if (line.trim()) console.log(`[mcpo:${tag}] ${line}`);
}

// Run a setup command to completion, piping output to the log. Resolves its exit code.
function run(cmd: string, args: string[]): Promise<number> {
    return new Promise((resolve) => {
        const p = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        p.stdout?.on('data', (d) => logLines('setup', d));
        p.stderr?.on('data', (d) => logLines('setup', d));
        p.on('error', () => resolve(-1));
        p.on('exit', (code) => resolve(code ?? -1));
    });
}

export class McpoSupervisor extends EventEmitter {
    private child: ChildProcess | null = null;
    private port = 0;
    private enabled = false;
    // Stable per-session bearer key: OWUI holds it in TOOL_SERVER_CONNECTIONS, so
    // keeping it constant across restarts avoids re-wiring the sidecar each bounce.
    private readonly apiKey = crypto.randomBytes(24).toString('hex');
    // Generation token: a superseding start()/stop() bumps it so an in-flight start
    // aborts at its awaits instead of clobbering a newer child (same discipline as
    // the OWUI SidecarSupervisor).
    private gen = 0;
    private crashRestarts = 0;
    // The Blender add-on's socket port (BLENDER_PORT). blender-mcp connects to Blender
    // at 127.0.0.1:<this>; it must match the number the BlenderMCP add-on panel shows.
    private blenderPort = 9876;
    private state: McpoState = { status: 'idle', url: null };

    getState(): McpoState { return this.state; }
    isEnabled(): boolean { return this.enabled; }
    getBlenderPort(): number { return this.blenderPort; }

    // Change the Blender socket port. The env is fixed at spawn, so a change while
    // running restarts mcpo (start() reaps the old child) to re-point blender-mcp.
    setBlenderPort(port: number): void {
        const p = Number(port);
        const next = Number.isFinite(p) && p >= 1 && p <= 65535 ? Math.floor(p) : 9876;
        if (next === this.blenderPort) return;
        this.blenderPort = next;
        if (this.enabled) this.start();   // respawn with the new BLENDER_PORT
    }

    // The tool-server connection config-bridge injects — null unless actually ready.
    getConnection(): { url: string; apiKey: string } | null {
        return this.state.status === 'ready' && this.state.url ? { url: this.state.url, apiKey: this.apiKey } : null;
    }

    private setState(patch: Partial<McpoState>): void {
        this.state = { ...this.state, ...patch };
        this.emit('state', this.state);
    }

    // Toggle the feature. On → install (first time) + spawn; off → stop.
    async setEnabled(on: boolean): Promise<void> {
        this.enabled = on;
        if (on) await this.start();
        else await this.stop();
    }

    // Idempotent install into the dedicated venv. Returns null on success, else a
    // human-readable message. Skipped fast when the venv + scripts + marker exist.
    private async ensureInstalled(): Promise<string | null> {
        if (fs.existsSync(venvPython()) && fs.existsSync(venvBin('mcpo'))
            && fs.existsSync(venvBin('blender-mcp')) && readMarker() === MARKER_TAG) return null;

        const base = resolveBasePython();
        if (!base) return 'No Python found to set up the Blender tools (need Python 3.10–3.12 installed).';

        try { fs.mkdirSync(mcpToolsDir(), { recursive: true }); } catch { /* handled below */ }
        this.setState({ status: 'installing', url: null, message: 'Setting up the Blender tools (first time only, ~1 min)…' });

        if (!fs.existsSync(venvPython())) {
            const r = await run(base.cmd, [...base.args, '-m', 'venv', venvDir()]);
            if (r !== 0 || !fs.existsSync(venvPython())) return 'Could not create the Python environment for the Blender tools.';
        }
        // pip self-upgrade is best-effort (old pip still installs fine).
        await run(venvPython(), ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', 'pip']);
        const r2 = await run(venvPython(), ['-m', 'pip', 'install', '--disable-pip-version-check', ...PACKAGES]);
        if (r2 !== 0 || !fs.existsSync(venvBin('mcpo')) || !fs.existsSync(venvBin('blender-mcp'))) {
            return 'Could not install the Blender tools (mcpo + blender-mcp). Check the internet connection and try again.';
        }
        try { fs.writeFileSync(markerFile(), MARKER_TAG, 'utf8'); } catch { /* non-fatal; re-checks each start */ }
        return null;
    }

    async start(): Promise<void> {
        const myGen = ++this.gen;
        const installErr = await this.ensureInstalled();
        if (myGen !== this.gen) return;             // superseded during install
        if (installErr) { this.setState({ status: 'error', url: null, message: installErr }); return; }

        // Reap any still-running child before spawning a new one.
        if (this.child) { const old = this.child; this.child = null; await killTree(old.pid); }
        if (myGen !== this.gen) return;

        this.port = await findFreePort(8765);
        if (myGen !== this.gen) return;
        const url = `http://${HOST}:${this.port}`;
        this.setState({ status: 'starting', url: null, message: undefined });

        // mcpo --host 127.0.0.1 --port <p> --api-key <k> -- <blender-mcp>
        const args = ['--host', HOST, '--port', String(this.port), '--api-key', this.apiKey, '--', venvBin('blender-mcp')];
        const env = {
            ...process.env,
            // Which Blender to drive: this machine's BlenderMCP add-on socket. The port
            // is user-configurable (Settings) so it can match what the add-on panel shows.
            BLENDER_HOST: '127.0.0.1',
            BLENDER_PORT: String(this.blenderPort),
            // Privacy: stop blender-mcp's telemetry POSTs (all three aliases it checks).
            DISABLE_TELEMETRY: 'true', BLENDER_MCP_DISABLE_TELEMETRY: 'true', MCP_DISABLE_TELEMETRY: 'true',
            // Same UTF-8 guard the OWUI/LiteLLM children use against a cp1252 console.
            PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
        };
        console.log(`[mcpo] spawning: ${venvBin('mcpo')} ${args.join(' ')}`);
        const child = spawn(venvBin('mcpo'), args, {
            windowsHide: true, detached: !IS_WIN, env, stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.child = child;
        child.stdout?.on('data', (d) => this.log(d));
        child.stderr?.on('data', (d) => this.log(d));
        child.on('error', (e) => this.setState({ status: 'error', message: `Failed to launch the Blender tools: ${e.message}` }));
        child.on('exit', (code) => this.onChildExit(child, code));

        // Health-wait on the OpenAPI spec (public without --strict-auth). Blender need
        // NOT be running — mcpo introspects + serves the schema regardless.
        const healthy = await waitForHttp(`${url}/openapi.json`, { timeoutMs: 45000, intervalMs: 1000 });
        if (myGen !== this.gen) return;
        if (healthy) {
            this.crashRestarts = 0;
            this.setState({ status: 'ready', url, message: undefined });
            console.log(`[mcpo] ready at ${url}`);
        } else {
            this.setState({ status: 'error', url: null, message: 'The Blender tool server did not start in time. See logs.' });
        }
    }

    async stop(): Promise<void> {
        this.gen++;                 // supersede any in-flight start()
        const child = this.child;
        this.child = null;          // null BEFORE killing so the exit event is ignored
        if (child) await killTree(child.pid);
        this.setState({ status: 'stopped', url: null, message: undefined });
    }

    private onChildExit(child: ChildProcess, code: number | null): void {
        if (child !== this.child) return;   // already replaced/stopped
        this.child = null;
        if (!this.enabled) return;          // intentional teardown
        if (this.crashRestarts < MAX_CRASH_RESTARTS) {
            this.crashRestarts++;
            console.warn(`[mcpo] exited (code ${code}); restart ${this.crashRestarts}/${MAX_CRASH_RESTARTS}`);
            this.setState({ status: 'starting', url: null, message: `Blender tools restarted (${this.crashRestarts}/${MAX_CRASH_RESTARTS})` });
            this.start();
        } else {
            this.setState({ status: 'error', url: null, message: `The Blender tool server keeps exiting (code ${code}). Check logs.` });
        }
    }

    private log(d: Buffer): void {
        for (const line of d.toString().split(/\r?\n/)) if (line.trim()) console.log(`[mcpo] ${line}`);
    }
}
