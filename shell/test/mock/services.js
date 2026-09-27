// The services listener: the farm snapshot plus the mock's own control API (plan §2.3).
//
// Two listeners share this handler: the services port (default 4011, everything) and the
// `--http-port` one (default 41987 — NOT the live farm's 41997, DISCUSS D-M1), which is
// where the harness bridge reads /lol/self.
'use strict';

const { CORS } = require('./scenario-models');
const { readBody } = require('./proxy');

/**
 * The beacon/self snapshot, built from the LIVE state so POST /mock/state changes it.
 * Field names follow farm/src/snapshot.js so the client's real discovery code reads it.
 */
function snapshot(store, { proxyPort, httpPort, host = '127.0.0.1' } = {}) {
    const s = store.state;
    return {
        v: 1,
        id: s.id,
        name: s.name,
        version: s.version,
        proxyPort,
        httpPort,
        ips: [host],
        endpoint: `http://${host}:${proxyPort}`,
        openaiBaseUrl: `http://${host}:${proxyPort}/v1`,
        requiresKey: !!s.requiresKey,
        coordinator: !!s.coordinator,
        models: s.models,
        backend: s.backend,
        capacity: s.capacity,
        busy: s.busy,
        perf: s.perf,
        usage: s.usage,
        host: s.host,
        health: s.health,
        deployments: s.deployments,
        healthy: !!s.healthy,
        searxngUrl: s.searxngUrl,
        ttsUrl: s.ttsUrl,
        ttsVoice: s.ttsVoice,
        ttsModel: s.ttsModel,
        extract: s.extract,
        plugins: s.plugins,
        recommendedClientPlugins: s.recommendedClientPlugins,
        ts: Date.now(),
    };
}

/** The raw bytes of a request body (the OCR route is binary; readBody decodes text). */
function readBytes(req, limit = 64 * 1024 * 1024) {
    return new Promise((resolve) => {
        const chunks = [];
        let size = 0;
        req.on('data', (c) => { if (size <= limit) { chunks.push(c); size += c.length; } });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', () => resolve(Buffer.concat(chunks)));
    });
}

/**
 * K6 kickoff (LOLCHAT_PLAN 2.6 KF-10): the farm's document extractor, by its own contract
 * (farm/src/pysvc/server.py:312) - PUT /process, `Authorization: Bearer <key>`, `X-Filename`,
 * raw bytes -> a JSON list of {page_content, metadata:{page, source, engine}}. The page count is
 * `X-Mock-Pages`, else `state.ocrPages`, else a decoded `X-Filename` like `pages-<N>.pdf`, else
 * ceil(bytes / 1000). Each page says which page of which file it is, so a scenario can find it.
 */
async function ocrProcess(req, res, store) {
    const s = store.state;
    const body = await readBytes(req);
    const entry = store.log[store.log.length - 1];
    if (entry && entry.path === '/ocr/process') entry.bytes = body.length;
    if (s.extractDown) return json(res, 503, { detail: 'extractor down (mock)' });
    const key = (s.extract && s.extract.key) || 'mock-extract-key';
    if ((req.headers.authorization || '') !== `Bearer ${key}`) return json(res, 401, { detail: 'Unauthorized' });
    if (!body.length) return json(res, 400, { detail: 'Empty request body.' });
    let name = 'upload';
    try { name = decodeURIComponent(String(req.headers['x-filename'] || 'upload')); } catch { name = String(req.headers['x-filename'] || 'upload'); }
    const type = String(req.headers['content-type'] || '').toLowerCase();
    let pages = 0;
    if (type.includes('wordprocessingml')) pages = 1;
    else if (type === 'application/pdf' || /\.pdf$/i.test(name)) {
        const forced = Number(req.headers['x-mock-pages']) || Number(s.ocrPages) || 0;
        const named = /pages-(\d+)\.pdf$/i.exec(name);
        pages = forced || (named ? Number(named[1]) : Math.ceil(body.length / 1000));
    } else {
        return json(res, 415, { detail: `Unsupported file type: ${type || 'unknown'}` });
    }
    pages = Math.max(1, Math.min(pages, 2000));
    const perPage = s.ocrDelayMs !== null && Number.isFinite(Number(s.ocrDelayMs)) ? Number(s.ocrDelayMs) : 200;
    const wait = Math.min(3000, Math.max(0, perPage * pages));
    let closed = false;
    res.on('close', () => { closed = true; });
    await new Promise((r) => setTimeout(r, wait));
    if (closed) return undefined;
    const out = [];
    // Like the real farm (farm/src/pysvc/server.py _extract_pdf), a multi-page document heads
    // every page's content with "[Page N]" on its own line.
    for (let i = 1; i <= pages; i++) {
        out.push({
            page_content: `${pages > 1 ? `[Page ${i}]\n` : ''}Page ${i} of ${name}. The mock farm read this page; its words stand in for the real text.`,
            metadata: { page: i, source: name, engine: 'text' },
        });
    }
    return json(res, 200, out);
}

function json(res, status, obj) {
    res.writeHead(status, { 'content-type': 'application/json', ...CORS });
    res.end(obj === undefined ? '' : JSON.stringify(obj));
}

/**
 * @param {object} opts
 * @param {any} opts.store
 * @param {() => object} opts.snapshotFn
 * @param {'services'|'http'} opts.role
 */
function createServicesHandler({ store, snapshotFn, role }) {
    return async function handler(req, res) {
        const url = req.url || '/';
        const method = (req.method || 'GET').toUpperCase();
        const q = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
        const pathOnly = url.split('?')[0];

        if (method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }

        // Control traffic is deliberately NOT logged: a test that asserts on the log would
        // otherwise see its own h.mock.log() call.
        const isControl = pathOnly.startsWith('/mock/');
        if (!isControl) {
            store.push({
                role, method, path: pathOnly,
                query: q.toString(),
                headers: {
                    authorization: req.headers.authorization || null,
                    'content-type': req.headers['content-type'] || null,
                    'x-filename': req.headers['x-filename'] || null,
                },
                body: null, model: null, status: 200,
            });
        }

        if (pathOnly === '/lol/self') return json(res, 200, snapshotFn());

        if (pathOnly === '/mock/health') return json(res, 200, { ok: true, beacon: !!store.beacon });

        if (pathOnly === '/mock/log') {
            const since = Number(q.get('since') || 0);
            const wantPath = q.get('path');
            const wantModel = q.get('model');
            const wantRole = q.get('role');
            const entries = store.log.filter((e) => e.ts >= since
                && (!wantPath || e.path === wantPath)
                && (!wantModel || e.model === wantModel)
                && (!wantRole || e.role === wantRole));
            // A bare JSON ARRAY: h.mock.log() hands it straight to the scenario.
            return json(res, 200, entries);
        }

        if (pathOnly === '/mock/last-body') {
            // The RAW text of the last completion POST, verbatim (null when there was none).
            res.writeHead(200, { 'content-type': 'application/json', ...CORS });
            return res.end(store.lastBody === null || store.lastBody === undefined ? 'null' : store.lastBody);
        }

        if (pathOnly === '/mock/warnings') return json(res, 200, store.warnings.slice());

        if (pathOnly === '/mock/reset' && method === 'POST') {
            store.reset();
            return json(res, 200, { ok: true });
        }

        if (pathOnly === '/mock/state') {
            if (method === 'POST') {
                const raw = await readBody(req);
                let patch = null;
                try { patch = raw ? JSON.parse(raw) : null; } catch { patch = null; }
                if (patch === null) return json(res, 400, { ok: false, error: 'body must be a JSON object' });
                store.merge(patch);
                return json(res, 200, store.state);
            }
            return json(res, 200, store.state);
        }

        if (pathOnly === '/ocr/health') return json(res, 200, { status: 'ok', model: 'mock-ocr', docling: false });
        if (pathOnly === '/ocr/process' && method === 'PUT') return ocrProcess(req, res, store);

        return json(res, 404, { ok: false, error: `no mock route for ${method} ${pathOnly}` });
    };
}

module.exports = { createServicesHandler, snapshot };
