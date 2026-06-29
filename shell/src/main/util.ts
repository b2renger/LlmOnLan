// Small main-process utilities: free-port pick, tree-kill, and a tiny HTTP GET
// (used to health-poll the sidecar + probe the farm's /lol/self).

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
