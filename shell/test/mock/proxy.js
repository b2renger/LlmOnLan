// The OpenAI-compatible listeners (plan §2.3 "Proxy endpoints").
//
// Two listeners share this handler: the OPEN one (default 4009) and the KEYED one
// (default 4010, `Authorization: Bearer <pw>` required). The keyed refusal is LiteLLM's
// real shape — a 400, not a 401 — because that is what the client must learn to read.
'use strict';

const { CORS, modelList, modelGroupInfo, handleCompletion } = require('./scenario-models');
const { seatsFullBody, SEATS_FULL_HEADERS } = require('./seats-body');

const MAX_BODY = 32 * 1024 * 1024;   // images and documents are big; 32 MB is plenty

/** LiteLLM's rejection when the proxy master key is wrong or missing. */
function authErrorBody() {
    return {
        error: {
            message: 'Authentication Error, Invalid proxy server token passed. Received Key=None, Expected Key=sk-…',
            type: 'auth_error',
            param: 'None',
            code: '400',
        },
    };
}

function bearer(req) {
    const h = req.headers.authorization || req.headers.Authorization || '';
    const m = /^Bearer\s+(.*)$/i.exec(String(h).trim());
    return m ? m[1].trim() : null;
}

function readBody(req, limit = MAX_BODY) {
    return new Promise((resolve) => {
        let raw = '';
        let over = false;
        req.on('data', (c) => {
            if (over) return;
            raw += c;
            if (raw.length > limit) { over = true; raw = raw.slice(0, limit); }
        });
        req.on('end', () => resolve(raw));
        req.on('error', () => resolve(raw));
    });
}

function json(res, status, obj, extra) {
    res.writeHead(status, { 'content-type': 'application/json', ...CORS, ...(extra || {}) });
    res.end(JSON.stringify(obj));
}

/**
 * @param {object} opts
 * @param {import('./state').createStore extends (...a:any)=>infer S ? S : any} opts.store
 * @param {'proxy'|'keyed'} opts.role
 * @param {string|null} opts.key  the required bearer key (keyed listener only)
 */
function createProxyHandler({ store, role, key }) {
    return async function handler(req, res) {
        // A "down" farm does not answer politely: it drops the connection, which is what
        // a killed LiteLLM looks like to fetch() (TypeError, not an HTTP status).
        if (store.state.proxyDown) { try { req.socket.destroy(); } catch { /* gone */ } return; }

        const url = req.url || '/';
        const pathOnly = url.split('?')[0];
        const method = (req.method || 'GET').toUpperCase();

        if (method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }

        const raw = method === 'POST' || method === 'PUT' ? await readBody(req) : '';
        let parsed = null;
        if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = null; } }

        const entry = store.push({
            role,
            method,
            path: pathOnly,
            query: url.includes('?') ? url.slice(url.indexOf('?') + 1) : '',
            headers: {
                authorization: req.headers.authorization || null,
                'content-type': req.headers['content-type'] || null,
                'x-filename': req.headers['x-filename'] || null,
            },
            body: parsed,
            model: parsed && parsed.model ? String(parsed.model) : null,
            status: null,
        });
        // 'close' fires once the response is finished OR the client walked away mid-stream.
        res.on('close', () => { if (!res.writableFinished) entry.closedEarly = true; });
        const writeHead = res.writeHead.bind(res);
        res.writeHead = (status, ...rest) => { entry.status = status; return writeHead(status, ...rest); };

        // ---- key gate ------------------------------------------------------------------
        if (key) {
            const got = bearer(req);
            if (got !== key) return json(res, 400, authErrorBody());
        }

        if (method === 'GET' && pathOnly === '/v1/models') return json(res, 200, modelList());
        if (method === 'GET' && (pathOnly === '/model_group/info' || pathOnly === '/v1/model_group/info')) {
            return json(res, 200, modelGroupInfo(store));
        }
        if (method === 'GET' && pathOnly === '/health/liveliness') return json(res, 200, { status: 'healthy' });

        if (method === 'POST' && (pathOnly === '/v1/chat/completions' || pathOnly === '/chat/completions')) {
            store.lastBody = raw;
            // Seat gate: a full farm refuses EVERY completion, whatever the model.
            if (store.seatsFull()) {
                const cap = (store.state.capacity && store.state.capacity.slots) || 0;
                const idleSec = (store.state.capacity && store.state.capacity.seatIdleSec) || 900;
                res.writeHead(429, { ...SEATS_FULL_HEADERS, ...CORS });
                return res.end(JSON.stringify(seatsFullBody({ cap, idleSec })));
            }
            // state.structuredDrop (S0 kickoff) reproduces LiteLLM's drop_params on a deployment
            // that does not claim schema support: response_format is stripped BEFORE dispatch and
            // the model answers prose. store.lastBody keeps what the CLIENT sent, untouched.
            if (store.state.structuredDrop && parsed && parsed.response_format) delete parsed.response_format;
            const model = parsed && parsed.model;
            const known = handleCompletion({ model, req, res, body: parsed || {}, store });
            if (!known) {
                return json(res, 400, {
                    error: {
                        message: `Invalid model name passed in model=${model} — the mock serves: see GET /v1/models`,
                        type: 'invalid_request_error', param: 'model', code: '400',
                    },
                });
            }
            return undefined;
        }

        // /v1/embeddings must never be called by the client (prime directive): answering
        // 418 makes an accidental call unmissable in a test instead of silently working.
        if (pathOnly === '/v1/embeddings') {
            return json(res, 418, { error: { message: 'the client must never call /v1/embeddings', type: 'mock_violation', code: '418' } });
        }

        return json(res, 404, { error: { message: `no mock route for ${method} ${pathOnly}`, type: 'not_found', code: '404' } });
    };
}

module.exports = { createProxyHandler, authErrorBody, readBody, bearer, MAX_BODY };
