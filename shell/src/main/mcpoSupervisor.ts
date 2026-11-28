// mcpo supervisor — owns the LOCAL "assistant tools" server that lets the chat
// drive Blender on THIS machine. It runs Open WebUI's own MCP→OpenAPI proxy
// (`mcpo`) wrapping Blender Lab's MCP server (`blender-mcp`, BLENDER_LAB_MCP_PLAN,
// the owner 2026-11-27: "use the 'official' blender lab MCP"), and OWUI consumes it
// as an OpenAPI tool server, by env (configBridge.ts, BLENDER_TOOLS_ENV_PLAN). The
// person owns the Blender side (Blender 5.1+, Get Extensions ▸ MCP, Allow Online
// Access: the extension starts its server itself); we own making OWUI turnkey —
// flip the toggle and the Blender tools appear.
//
// Blender Lab's server (2026-11-28): not on PyPI, so it ships as a wheel in assets/blender-mcp (GPL-3.0-or-later,
// its LICENSE and SOURCE.md beside it), built from its repository at dbbf836, checked by its sha256 and installed
// from that file; its dependencies (docutils, mcp[cli] < 2, pyyaml) and mcpo come from PyPI. mcpo runs it from a
// config file (`--config`), which mounts it at /blender and drops the tools in `disabledTools` (mcpo 0.0.20
// main.py: never listed, never callable):
//   • its `_for_cli` twins run Python in a background Blender the person never opened (BLENDER_PATH, else
//     `blender` on the PATH): off, and BLENDER_PATH names a path that never exists, as a second layer;
//   • its two screenshot tools send pixels of the person's Blender window: off until a check shows the picture
//     reaching the farm as an image, with privacy.md's line (the owner's yes, 2026-11-27 16:04).
//
// Design decisions (all validated by a live spike on Windows before writing this):
//   • Reuse the sidecar's standalone CPython (it ships pip) to build a DEDICATED
//     venv under userData/mcp-tools/ — never the OWUI env, so it can't perturb it.
//     Install on FIRST activation (opt-in), mirroring the farm's SearXNG/Kokoro.
//   • Bind mcpo to 127.0.0.1 + a random --api-key. `execute_blender_code` is
//     arbitrary code execution, and mcpo defaults to 0.0.0.0 — localhost-only bind
//     is the containment; the bearer key (OWUI sends it via the connection) is
//     defense-in-depth. No --strict-auth so /openapi.json stays fetchable.
//   • DISABLE_TELEMETRY in the child env — the community blender-mcp POSTed telemetry to
//     a Supabase endpoint. Blender Lab's server sends nothing (its source read 2026-11-28:
//     no HTTP client, only BLENDER_MCP_HOST/PORT and BLENDER_PATH read); kept, harmless.
//   • Health-wait on /openapi.json: mcpo serves the full tool schema even when
//     Blender ISN'T running (connection is per-call/lazy), so the tool server
//     registers immediately and the user can start Blender whenever.

import { EventEmitter } from 'events';
import { spawn, ChildProcess, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { resolveSidecarPython, mcpToolsDir, blenderWheelPath } from './paths';
import { findFreePort, killTree, waitForHttp } from './util';
import { McpoState } from './types';

const HOST = '127.0.0.1';
const IS_WIN = process.platform === 'win32';
const MAX_CRASH_RESTARTS = 3;
// Installed into the tools venv: mcpo (OWUI's proxy) and FastAPI as they ran here together on 2026-11-27, and Blender
// Lab's server from the shipped wheel. A different set (the community helper's, before 2026-11-28) rebuilds the venv
// from nothing. FastAPI is pinned because mcpo 0.0.20 passes `ssl_certfile` to FastAPI(), which FastAPI 0.165.0
// (2026-11-18) refuses: mcpo then cannot start at all (seen 2026-11-28 in scratch). ponytail: upgrade path, mcpo 0.0.21
// (2026-11-25) dropped that argument and keeps `disabledTools`; pin it alone once it has run here.
export const MCPO_PIN = 'mcpo==0.0.20';
export const FASTAPI_PIN = 'fastapi==0.139.0';
export const LAB_WHEEL = 'blender_mcp-1.0.2-py3-none-any.whl';
export const LAB_WHEEL_SHA256 = 'c304518555427a29eb1be08f63601f94e4db0a0a4f4b43caaf76e8c14d93a7ff';
const MARKER_TAG = `${MCPO_PIN},${FASTAPI_PIN},blender-mcp-lab@dbbf836`;
// The server's name in mcpo's config: its tools are served under /blender.
export const SERVER_NAME = 'blender';
// The tools mcpo keeps out of the chat (see the header), by their names in Lab's server at dbbf836.
export const HIDDEN_TOOLS = [
    'execute_blender_code_for_cli',
    'get_blendfile_summary_datablocks_for_cli',
    'get_blendfile_summary_missing_files_for_cli',
    'get_blendfile_summary_of_linked_libraries_for_cli',
    'get_blendfile_summary_path_info_for_cli',
    'get_blendfile_summary_usage_guess_for_cli',
    'get_screenshot_of_area_as_image',
    'get_screenshot_of_window_as_image',
];

// The environment Lab's server runs in. Which Blender: this computer's MCP extension, on the port Preferences says
// (the extension's own preference, 9876 by default). BLENDER_PATH: a path that never exists, so a `_for_cli` tool
// that got through would fail with Lab's own error (blender_cli.py: os.environ.get("BLENDER_PATH", "blender"), and
// FileNotFoundError → its RuntimeError) instead of running the `blender` on the PATH.
export function helperEnv(blenderPort: number, toolsDir: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    return {
        ...base,
        BLENDER_MCP_HOST: '127.0.0.1',
        BLENDER_MCP_PORT: String(blenderPort),
        BLENDER_PATH: path.join(toolsDir, 'no-background-blender', 'blender'),
        // Privacy: the community helper's telemetry switches (all three names it read); Lab's sends none.
        DISABLE_TELEMETRY: 'true', BLENDER_MCP_DISABLE_TELEMETRY: 'true', MCP_DISABLE_TELEMETRY: 'true',
        // Same UTF-8 guard the OWUI/LiteLLM children use against a cp1252 console.
        PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
    };
}

// mcpo's config file: Lab's server, by its console script, with the hidden tools.
export function helperConfig(serverBin: string): object {
    return { mcpServers: { [SERVER_NAME]: { command: serverBin, args: [], disabledTools: HIDDEN_TOOLS } } };
}

function sha256Of(file: string): string | null {
    try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
}

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
    // Stable per-session bearer key: it is in Open WebUI's env (configBridge setBlenderTools), so keeping it
    // constant across mcpo restarts keeps that env, and Open WebUI, as they are.
    private readonly apiKey = crypto.randomBytes(24).toString('hex');
    // Generation token: a superseding start()/stop() bumps it so an in-flight start
    // aborts at its awaits instead of clobbering a newer child (same discipline as
    // the OWUI SidecarSupervisor).
    private gen = 0;
    private crashRestarts = 0;
    // The Blender MCP extension's port (BLENDER_MCP_PORT). Lab's server connects to Blender
    // at 127.0.0.1:<this>; it must match the extension's own preference (9876 by default).
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
        if (this.enabled) this.start();   // respawn with the new BLENDER_MCP_PORT
    }

    // The connection Preferences' "Test" probes — null unless actually ready.
    getConnection(): { url: string; apiKey: string } | null {
        return this.state.status === 'ready' && this.state.url ? { url: this.state.url, apiKey: this.apiKey } : null;
    }

    // The port mcpo will listen on, chosen once and kept while it is free (a restart reuses it), so the address in
    // Open WebUI's env (configBridge setBlenderTools) is known before mcpo starts and does not change at each
    // start: a change restarts Open WebUI (BLENDER_TOOLS_ENV_PLAN).
    async reservePort(): Promise<void> {
        if (!this.port) this.port = await findFreePort(8765);
    }

    // What Open WebUI's env carries for the Blender tools: while they are on and a port is chosen, whether or not
    // mcpo answers yet (Open WebUI fetches its spec again at each tool listing).
    plannedConnection(): { url: string; apiKey: string } | null {
        return this.enabled && this.port ? { url: `http://${HOST}:${this.port}/${SERVER_NAME}`, apiKey: this.apiKey } : null;
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
        // The shipped server, as it was built (SOURCE.md): never install a file that changed.
        const wheel = blenderWheelPath(LAB_WHEEL);
        if (sha256Of(wheel) !== LAB_WHEEL_SHA256) return 'The Blender tools in this installation are damaged. Reinstall LlmOnLan.';

        try { fs.mkdirSync(mcpToolsDir(), { recursive: true }); } catch { /* handled below */ }
        this.setState({ status: 'installing', url: null, message: 'Setting up the Blender tools (first time only, ~1 min)…' });
        // Another set of packages (the community helper, before 2026-11-28): its venv goes, so nothing of it stays.
        if (readMarker() !== MARKER_TAG && fs.existsSync(venvDir())) {
            try { fs.rmSync(venvDir(), { recursive: true, force: true }); } catch { return 'Could not replace the old Blender tools. Restart LlmOnLan and turn them on again.'; }
        }

        if (!fs.existsSync(venvPython())) {
            const r = await run(base.cmd, [...base.args, '-m', 'venv', venvDir()]);
            if (r !== 0 || !fs.existsSync(venvPython())) return 'Could not create the Python environment for the Blender tools.';
        }
        // pip self-upgrade is best-effort (old pip still installs fine).
        await run(venvPython(), ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', 'pip']);
        const r2 = await run(venvPython(), ['-m', 'pip', 'install', '--disable-pip-version-check', MCPO_PIN, FASTAPI_PIN, wheel]);
        if (r2 !== 0 || !fs.existsSync(venvBin('mcpo')) || !fs.existsSync(venvBin('blender-mcp'))) {
            return 'Could not install the Blender tools (mcpo + Blender Lab’s MCP server). Check the internet connection and try again.';
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

        this.port = await findFreePort(this.port || 8765);   // the kept port while it is free (reservePort)
        if (myGen !== this.gen) return;
        const url = `http://${HOST}:${this.port}/${SERVER_NAME}`;
        this.setState({ status: 'starting', url: null, message: undefined });

        // mcpo --host 127.0.0.1 --port <p> --api-key <k> --config <file>: Lab's server at /blender, its hidden tools out.
        const cfg = path.join(mcpToolsDir(), 'mcpo-config.json');
        try { fs.writeFileSync(cfg, JSON.stringify(helperConfig(venvBin('blender-mcp')), null, 2), 'utf8'); }
        catch (e) { this.setState({ status: 'error', url: null, message: `Could not write the Blender tools' settings: ${(e as Error).message}` }); return; }
        const args = ['--host', HOST, '--port', String(this.port), '--api-key', this.apiKey, '--config', cfg];
        const env = helperEnv(this.blenderPort, mcpToolsDir());
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
