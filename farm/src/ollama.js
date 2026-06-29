// Talk to Ollama hosts over their HTTP API (no SDK dependency).
//
// Ollama is a PREREQUISITE the operator installs — the CLI orchestrates it, it
// doesn't reimplement it. We use the documented REST API:
//   GET  /api/version   reachability + version
//   GET  /api/tags      models present on the host
//   GET  /api/ps        models currently loaded in VRAM
//   POST /api/pull      pull a model (streams progress)
// Ref: github.com/ollama/ollama/blob/main/docs/api.md

const http = require('http');
const { URL } = require('url');

// Normalize a host entry to a base URL string (adds default port/scheme).
function normalizeHost(entry) {
    let s = String(entry).trim();
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    const u = new URL(s);
    if (!u.port) u.port = '11434';
    return `${u.protocol}//${u.hostname}:${u.port}`;
}

// Minimal JSON GET/POST with a timeout. Resolves { status, json } or rejects.
function request(method, baseUrl, apiPath, { body, timeoutMs = 4000 } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(apiPath, baseUrl);
        const data = body ? Buffer.from(JSON.stringify(body)) : null;
        const req = http.request(
            {
                method,
                hostname: u.hostname,
                port: u.port,
                path: u.pathname + u.search,
                timeout: timeoutMs,
                headers: data
                    ? { 'content-type': 'application/json', 'content-length': data.length }
                    : {},
            },
            (res) => {
                let buf = '';
                res.on('data', (c) => { buf += c; });
                res.on('end', () => {
                    let json = null;
                    try { json = buf ? JSON.parse(buf) : null; } catch { /* non-JSON */ }
                    resolve({ status: res.statusCode, json, raw: buf });
                });
            }
        );
        req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

// Returns the Ollama version string, or null if unreachable.
async function version(baseUrl, timeoutMs = 4000) {
    try {
        const { status, json } = await request('GET', baseUrl, '/api/version', { timeoutMs });
        return status === 200 && json ? json.version || 'unknown' : null;
    } catch {
        return null;
    }
}

// Models present on a host (their full `name:tag`), or [] if unreachable.
async function listModels(baseUrl, timeoutMs = 4000) {
    try {
        const { status, json } = await request('GET', baseUrl, '/api/tags', { timeoutMs });
        if (status !== 200 || !json || !Array.isArray(json.models)) return [];
        return json.models.map((m) => m.name).filter(Boolean);
    } catch {
        return [];
    }
}

// Models currently loaded in VRAM on a host.
async function loadedModels(baseUrl, timeoutMs = 4000) {
    try {
        const { status, json } = await request('GET', baseUrl, '/api/ps', { timeoutMs });
        if (status !== 200 || !json || !Array.isArray(json.models)) return [];
        return json.models.map((m) => m.name).filter(Boolean);
    } catch {
        return [];
    }
}

// True if a host already has the given model (tolerant of an implicit :latest).
function hasModel(present, id) {
    if (present.includes(id)) return true;
    if (!id.includes(':')) return present.some((m) => m === `${id}:latest`);
    return false;
}

// Pull a model on a host, streaming progress lines to onLine(statusText).
// Resolves true on success, throws on failure. /api/pull streams NDJSON.
function pullModel(baseUrl, id, onLine = () => {}, timeoutMs = 30 * 60 * 1000) {
    return new Promise((resolve, reject) => {
        const u = new URL('/api/pull', baseUrl);
        const data = Buffer.from(JSON.stringify({ model: id, stream: true }));
        const req = http.request(
            {
                method: 'POST',
                hostname: u.hostname,
                port: u.port,
                path: u.pathname,
                timeout: timeoutMs,
                headers: { 'content-type': 'application/json', 'content-length': data.length },
            },
            (res) => {
                let buf = '';
                let lastStatus = '';
                let failed = null;
                res.on('data', (chunk) => {
                    buf += chunk;
                    let nl;
                    while ((nl = buf.indexOf('\n')) >= 0) {
                        const line = buf.slice(0, nl).trim();
                        buf = buf.slice(nl + 1);
                        if (!line) continue;
                        try {
                            const obj = JSON.parse(line);
                            if (obj.error) { failed = obj.error; continue; }
                            const s = obj.status || '';
                            if (s && s !== lastStatus) { lastStatus = s; onLine(s); }
                        } catch { /* ignore partial */ }
                    }
                });
                res.on('end', () => {
                    if (failed) return reject(new Error(failed));
                    if (res.statusCode !== 200) return reject(new Error(`pull HTTP ${res.statusCode}`));
                    resolve(true);
                });
            }
        );
        req.on('timeout', () => req.destroy(new Error(`pull timeout after ${timeoutMs}ms`)));
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

module.exports = { normalizeHost, version, listModels, loadedModels, hasModel, pullModel, request };
