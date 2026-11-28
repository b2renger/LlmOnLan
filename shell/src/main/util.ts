// Small main-process utilities: free-port pick, tree-kill, a tiny HTTP GET
// (used to health-poll the sidecar + probe the farm's /lol/self), and an origin test.

import * as net from 'net';
import * as http from 'http';
import { execFile } from 'child_process';

// Find a free localhost TCP port (lets the sidecar bind without collisions).
export function findFreePort(preferred = 0): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.on('error', () => {
            // Preferred port busy → ask the OS for any free one.
            const s2 = net.createServer();
            s2.on('error', reject);
            s2.listen(0, '127.0.0.1', () => {
                const p = (s2.address() as net.AddressInfo).port;
                s2.close(() => resolve(p));
            });
        });
        srv.listen(preferred, '127.0.0.1', () => {
            const p = (srv.address() as net.AddressInfo).port;
            srv.close(() => resolve(p));
        });
    });
}

// Tree-kill a pid + children (uvicorn workers etc.), cross-platform.
export function killTree(pid: number | undefined): Promise<void> {
    return new Promise((resolve) => {
        if (!pid) return resolve();
        if (process.platform === 'win32') {
            execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => resolve());
        } else {
            try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
            setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } resolve(); }, 1500);
        }
    });
}


// What answers on the Blender port (BLENDER_LAB_MCP_PLAN step 3; A31 showed a port-only check say ✓ for an add-on the
// helper could not speak to). Blender Lab's MCP extension reads a request ended by a zero byte and answers JSON ended
// by one (its mcp_to_blender_server.py `_encode_response`, read 2026-11-28 at dbbf836); the community BlenderMCP
// add-on answers bare JSON as soon as a whole object arrives. So the request goes first WITHOUT its zero byte (only
// the community add-on answers that), then the zero byte (Lab's extension answers). The code is empty: it runs nothing.
export type BlenderPeer = 'lab' | 'community' | 'other' | 'none';
export function probeBlender(host: string, port: number, timeoutMs = 2000): Promise<BlenderPeer> {
    return new Promise((resolve) => {
        const sock = new net.Socket();
        let settled = false;
        let connected = false;
        let ended = false;          // the zero byte was sent
        let got = '';
        const timers: NodeJS.Timeout[] = [];
        const finish = (peer: BlenderPeer) => {
            if (settled) return;
            settled = true;
            for (const t of timers) clearTimeout(t);
            try { sock.destroy(); } catch { /* ignore */ }
            resolve(peer);
        };
        const isJson = (s: string) => { try { return typeof JSON.parse(s) === 'object'; } catch { return false; } };
        sock.on('data', (d) => {
            got += d.toString('utf8');
            if (!ended) { if (isJson(got.trim())) finish('community'); return; }
            const at = got.indexOf('\0');
            if (at >= 0) finish(isJson(got.slice(0, at)) ? 'lab' : 'other');
        });
        sock.once('connect', () => {
            connected = true;
            sock.write(JSON.stringify({ type: 'execute', code: '', strict_json: false }));
            timers.push(setTimeout(() => { if (!settled) { ended = true; sock.write('\0'); } }, Math.min(700, timeoutMs / 3)));
            timers.push(setTimeout(() => finish('other'), timeoutMs));   // listens, says nothing either one knows
        });
        // Refused: nothing listens. Accepted, then closed or failed without an answer either one gives: something else.
        sock.once('error', () => finish(connected ? 'other' : 'none'));
        sock.once('close', () => finish(connected ? 'other' : 'none'));
        try { sock.connect(port, host); } catch { finish('none'); }
    });
}

export interface HttpResult { status: number; body: string }

// Minimal HTTP GET with timeout. Resolves { status, body }; rejects on error.
export function httpGet(url: string, timeoutMs = 2500): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; if (body.length > 2_000_000) req.destroy(); });
            res.on('end', () => resolve({ status: res.statusCode || 0, body }));
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
    });
}

// Do two addresses share one web origin (scheme, host and port, exactly)? A prefix test is not enough:
// "http://127.0.0.1:808" is a prefix of "http://127.0.0.1:8080". False for a missing address and for one
// with no origin of its own (about:blank, data:, a sandboxed frame), so two of those never match.
export function sameOrigin(url: string | null | undefined, base: string | null | undefined): boolean {
    try {
        const o = new URL(String(url)).origin;
        return o !== 'null' && o === new URL(String(base)).origin;
    } catch { return false; }
}

// Do two file: URLs name the same file, query and hash aside? On Windows a path ignores case, and so must this: Chromium
// writes file:///C:/…, while pathToFileURL keeps the case app.getAppPath() came with (c:\… when the app was started from
// a folder typed in lowercase), and the exact match then refused the app's own sandbox runner: "The sandbox could not
// start" (review 2026-11-15; the harness's "order-dependent" sandbox failures since 2026-11-12).
export function sameFileUrl(a: string | null | undefined, b: string | null | undefined, platform: string = process.platform): boolean {
    const bare = (u: string | null | undefined) => String(u || '').split('#')[0].split('?')[0];
    const x = bare(a), y = bare(b);
    if (!x || !y) return false;
    return platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

// Poll a URL until it returns 2xx or we time out. Resolves true/false.
export async function waitForHttp(url: string, { timeoutMs = 120000, intervalMs = 750 } = {}): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const r = await httpGet(url, Math.min(intervalMs + 500, 3000));
            if (r.status >= 200 && r.status < 300) return true;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
}
