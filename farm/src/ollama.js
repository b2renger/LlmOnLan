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

// Like listModels but with per-model detail: { name, size (bytes), family, paramSize }.
// Used by the `lol up` model picker to show sizes. [] if unreachable.
async function listModelsDetailed(baseUrl, timeoutMs = 4000) {
    try {
        const { status, json } = await request('GET', baseUrl, '/api/tags', { timeoutMs });
        if (status !== 200 || !json || !Array.isArray(json.models)) return [];
        return json.models
            .filter((m) => m && m.name)
            .map((m) => ({
                name: m.name,
                size: m.size || 0,
                family: m.details?.family || null,
                paramSize: m.details?.parameter_size || null,
            }));
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

// Warm a model into VRAM (admin "start" — so the first real request isn't slow).
// A zero-token generate with keep_alive loads + pins it. Best-effort: resolves
// true/false, never throws. Ollama's own MAX_LOADED_MODELS governs eviction of others.
// `numCtx` loads it with the SAME context window LiteLLM requests (num_ctx in the
// routing) — warming without it would load a 4096-ctx instance that the first real
// request immediately reloads at the bigger window, defeating the warm-up.
async function warmModel(baseUrl, id, keepAlive = '-1', numCtx = null, timeoutMs = 120000) {
    try {
        const body = { model: id, prompt: '', stream: false, keep_alive: keepAlive };
        if (numCtx) body.options = { num_ctx: numCtx };
        const { status } = await request('POST', baseUrl, '/api/generate', { body, timeoutMs });
        return status === 200;
    } catch { return false; }
}

// Evict a model from VRAM (admin "stop" — frees GPU memory). keep_alive:0 tells
// Ollama to unload it immediately. Best-effort; resolves true/false, never throws.
async function evictModel(baseUrl, id, timeoutMs = 10000) {
    try {
        const { status } = await request('POST', baseUrl, '/api/generate',
            { body: { model: id, prompt: '', stream: false, keep_alive: 0 }, timeoutMs });
        return status === 200;
    } catch { return false; }
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

// Derive a local model from another one, applying Modelfile PARAMETERs.
//
// Why this exists: a raw `hf.co/...` pull carries the WEIGHTS but none of the
// launch parameters Ollama's own library models ship with. The one that matters is
// `draft_num_predict`, which enables Qwen3.8's built-in MTP (multi-token
// prediction) head — measured at ~1.8x throughput on an RTX PRO 6000 (73 -> 132
// tok/s). Serving an HF tag directly silently forfeits that, so the CLI creates a
// derived model with the parameters applied and serves THAT.
//
// Uses POST /api/create (NDJSON stream) rather than the `ollama create` CLI so it
// works against remote hosts, consistent with the rest of this module.
function createModel(baseUrl, name, from, parameters = {}, timeoutMs = 10 * 60 * 1000) {
    return new Promise((resolve, reject) => {
        const u = new URL('/api/create', baseUrl);
        const data = Buffer.from(JSON.stringify({ model: name, from, parameters, stream: true }));
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
                            if (obj.error) failed = obj.error;
                        } catch { /* ignore partial */ }
                    }
                });
                res.on('end', () => {
                    if (failed) return reject(new Error(failed));
                    if (res.statusCode !== 200) return reject(new Error(`create HTTP ${res.statusCode}`));
                    resolve(true);
                });
            }
        );
        req.on('timeout', () => req.destroy(new Error(`create timeout after ${timeoutMs}ms`)));
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

module.exports = { normalizeHost, version, listModels, listModelsDetailed, loadedModels, warmModel, evictModel, hasModel, pullModel, createModel, request };
