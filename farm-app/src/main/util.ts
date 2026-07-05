// Small main-process utilities: tree-kill, a tiny HTTP GET, and a health poller
// (used to wait on the farm's /lol/self endpoint).

import * as http from 'http';
import { execFile } from 'child_process';

// Tree-kill a pid + children (LiteLLM's uvicorn workers, a spawned Ollama, etc.),
// cross-platform. The farm's `lol up` supervises its own children, so killing the
// `lol up` process group reaps the whole tree.
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

// Fetch a URL and parse JSON, or null on any failure. Used to read /lol/self for the
// LAN addresses to show in the chrome.
export async function httpGetJson<T = any>(url: string, timeoutMs = 2500): Promise<T | null> {
    try {
        const r = await httpGet(url, timeoutMs);
        if (r.status < 200 || r.status >= 300) return null;
        return JSON.parse(r.body) as T;
    } catch { return null; }
}
