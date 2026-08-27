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
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
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

// The model's native maximum context, from /api/show's GGUF header echo
// (`<arch>.context_length`). Returns { architecture, contextLength } with nulls
// where the header doesn't carry the key; null if the host/model is unreachable.
// Deliberately does NOT return KV geometry: sliding-window architectures (Gemma)
// make the naive KV estimate several times too high — context auto-sizing PROBES
// the real load instead (see resolveOllamaContext in up.js).
async function showModel(baseUrl, id, timeoutMs = 15000) {
    try {
        const { status, json } = await request('POST', baseUrl, '/api/show', { body: { model: id }, timeoutMs });
        if (status !== 200 || !json) return null;
        const mi = json.model_info || {};
        const arch = mi['general.architecture'] || (json.details && json.details.family) || null;
        const ctx = arch != null ? mi[`${arch}.context_length`] : null;
        return {
            architecture: arch || null,
            contextLength: typeof ctx === 'number' && ctx > 0 ? ctx : null,
        };
    } catch { return null; }
}

// Loaded models WITH memory placement: [{ name, size, sizeVram }]. size is the
// total the model needs at its current num_ctx; sizeVram is the part that made it
// into VRAM — sizeVram < size means Ollama spilled layers to system RAM (the
// "works at a few tok/s" failure). Empty array when unreachable.
async function psModels(baseUrl, timeoutMs = 4000) {
    try {
        const { status, json } = await request('GET', baseUrl, '/api/ps', { timeoutMs });
        if (status !== 200 || !json || !Array.isArray(json.models)) return [];
        return json.models
            .filter((m) => m && m.name)
            .map((m) => ({ name: m.name, size: m.size || 0, sizeVram: m.size_vram || 0 }));
    } catch { return []; }
}

// Warm a model into VRAM (admin "start" — so the first real request isn't slow).
// A zero-token generate with keep_alive loads + pins it. Best-effort: resolves
// true/false, never throws. Ollama's own MAX_LOADED_MODELS governs eviction of others.
// `numCtx` loads it with the SAME context window LiteLLM requests (num_ctx in the
// routing) — warming without it would load a 4096-ctx instance that the first real
// request immediately reloads at the bigger window, defeating the warm-up.
// Ollama's REQUEST-level keep_alive is Go's api.Duration: a JSON NUMBER is seconds
// (negative = forever) but a JSON STRING must carry a unit ("5m") — a bare "-1"
// string fails with `time: missing unit in duration "-1"`. The ENV var
// OLLAMA_KEEP_ALIVE does accept "-1" (its parser falls back to plain numbers),
// which is why the config keeps the string spelling. Coerce at the request edge.
function keepAliveValue(v) {
    return /^-?\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : v;
}

async function warmModel(baseUrl, id, keepAlive = '-1', numCtx = null, timeoutMs = 120000) {
    try {
        const body = { model: id, prompt: '', stream: false, keep_alive: keepAliveValue(keepAlive) };
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
// Delete a model from a host, freeing its disk. The counterpart to pullModel and
// the reason the admin panel can offer "Remove": without it an operator who tried
// three 20 GB models has no way back short of a terminal, and the box fills up.
// 404 counts as success — the goal state is "not there", and Ollama 404s a delete
// of an already-absent tag.
async function deleteModel(baseUrl, id, timeoutMs = 60000) {
    try {
        const r = await request('DELETE', baseUrl, '/api/delete', { body: { model: id }, timeoutMs });
        if (r.status === 200 || r.status === 404) return { ok: true };
        return { ok: false, error: (r.json && r.json.error) || `HTTP ${r.status}` };
    } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
    }
}

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

// Where separate draft/MTP modules are cached. Gitignored; safe to delete (it is
// re-downloaded on the next install/up).
function draftDir() {
    return path.join(__dirname, '..', '.models');
}

// Local path a draft URL caches to. Stable, so a second run is a no-op.
function draftPathFor(url) {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'draft.gguf');
    return path.join(draftDir(), name.replace(/[^A-Za-z0-9._-]/g, '_'));
}

// Fetch a draft module over HTTPS, following redirects (Hugging Face `resolve/`
// URLs redirect to a CDN). Skips the download when the file is already cached.
// `onProgress(pct, mb)` is called as bytes arrive.
function downloadDraft(url, onProgress = () => {}, timeoutMs = 30 * 60 * 1000) {
    const dest = draftPathFor(url);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return Promise.resolve({ path: dest, cached: true });
    fs.mkdirSync(draftDir(), { recursive: true });
    const tmp = dest + '.part';

    const get = (u, redirectsLeft) => new Promise((resolve, reject) => {
        if (redirectsLeft < 0) return reject(new Error('too many redirects'));
        const req = https.get(u, { timeout: timeoutMs }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                const next = new URL(res.headers.location, u).toString();
                return resolve(get(next, redirectsLeft - 1));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`download HTTP ${res.statusCode}`));
            }
            const total = Number(res.headers['content-length']) || 0;
            let seen = 0;
            let lastPct = -1;
            const out = fs.createWriteStream(tmp);
            res.on('data', (c) => {
                seen += c.length;
                // Only report when the whole percent CHANGES. Firing per chunk emits
                // tens of thousands of lines for a multi-GB file.
                const pct = total ? Math.floor((seen / total) * 100) : 0;
                if (pct !== lastPct) { lastPct = pct; onProgress(pct, seen / 1024 / 1024); }
            });
            res.pipe(out);
            out.on('finish', () => out.close(() => {
                // 'finish' also fires on a cleanly-truncated response (server hung
                // up mid-body) — without this check a half .gguf got renamed into
                // the cache and poisoned it until someone deleted it by hand:
                // llama-server fails to load it, the farm falls back to Ollama, and
                // every retry "finds" the cached file.
                if (total && seen !== total) {
                    try { fs.unlinkSync(tmp); } catch { /* best-effort */ }
                    return reject(new Error(`download truncated: got ${seen} of ${total} bytes`));
                }
                fs.renameSync(tmp, dest);          // atomic: a killed download never looks complete
                resolve({ path: dest, cached: false });
            }));
            out.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error('download timeout')));
        req.on('error', reject);
    });

    return get(url, 5).catch((e) => {
        try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
        throw e;
    });
}

// Create a derived model WITH a separate draft module attached.
//
// This is the one place the CLI is used instead of the REST API, and it is forced:
// /api/create silently DROPS a `draft` field (verified on Ollama 0.32.15 — it
// returns success and no DRAFT line appears in the result), and the Modelfile
// `DRAFT` instruction resolves its argument as a path on the machine running
// ollama. Consequence: draft modules only work on a LOCAL host. Remote hosts fall
// back to createModel() and simply run without speculative decoding.
function createModelWithDraft(name, from, draftFile, parameters = {}, timeoutMs = 10 * 60 * 1000) {
    return new Promise((resolve, reject) => {
        const lines = [`FROM ${from}`, `DRAFT ${draftFile}`];
        for (const [k, v] of Object.entries(parameters)) lines.push(`PARAMETER ${k} ${v}`);
        fs.mkdirSync(draftDir(), { recursive: true });
        const mfPath = path.join(draftDir(), `.Modelfile.${name.replace(/[^A-Za-z0-9._-]/g, '_')}`);
        fs.writeFileSync(mfPath, lines.join('\n') + '\n', 'utf8');
        execFile('ollama', ['create', name, '-f', mfPath], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
            if (err) return reject(new Error(String(stderr || err.message).trim().split('\n').pop()));
            resolve(true);
        });
    });
}

module.exports = {
    normalizeHost, version, listModels, listModelsDetailed, loadedModels, warmModel, evictModel,
    hasModel, pullModel, deleteModel, createModel, createModelWithDraft, downloadDraft, draftPathFor, draftDir, request,
    keepAliveValue, showModel, psModels,
    // Same fetcher under names that read correctly at the other call sites: the
    // llama.cpp backend uses it for full model weights and release archives, not
    // just draft modules.
    downloadGguf: downloadDraft, ggufPathFor: draftPathFor, modelsDir: draftDir,
};
