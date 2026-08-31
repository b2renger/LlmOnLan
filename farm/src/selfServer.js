// Unicast discovery fallback + the farm ADMIN control API, on one built-in http
// server (no framework). Routes:
//   GET  /lol/self               → the discovery snapshot JSON (open; CORS *)
//   GET  /lol/admin              → the static admin page (open — it's just HTML/JS)
//   GET  /lol/admin/state        → richer admin view (token)   → control.getAdminState()
//   POST /lol/admin/model/start  → serve + warm a model (token) → control.startModel(id)
//   POST /lol/admin/model/stop   → unserve + evict a model (token) → control.stopModel(id)
//   POST /lol/admin/backend      → switch inference engine (token)
//   POST /lol/admin/name         → the model name users see (token)
//   POST /lol/admin/security     → set/clear the shared farm password (token)
//   POST /lol/admin/slots        → how many people served at once (token)
//   POST /lol/admin/llamacpp/model          → load another .gguf (token)
//   POST /lol/admin/llamacpp/library/add    → add a .gguf to the library (token)
//   POST /lol/admin/llamacpp/library/remove → drop one from the library (token)
//   POST /lol/admin/ollama/pull   → download an Ollama model (token)
//   POST /lol/admin/ollama/remove → delete an Ollama model (token)
//
// `GET /lol/self` is the unicast discovery path (mirrors ComfyQ's /federation/self):
// on managed Wi-Fi, client isolation drops broadcast+multicast so the UDP beacon
// never arrives even though unicast HTTP works — the shell's subnet sweep probes it.
// The admin routes MUTATE the live farm, so every one except the open page requires
// `Authorization: Bearer <adminToken>` (the token `lol up` prints). The whole server
// binds `config.proxy.host` (0.0.0.0), so the token is what gates control on the LAN.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ADMIN_PAGE = path.join(__dirname, 'admin', 'index.html');
let _pageCache = null;
function adminPage() {
    if (_pageCache == null) {
        try { _pageCache = fs.readFileSync(ADMIN_PAGE, 'utf8'); }
        catch { _pageCache = '<!doctype html><meta charset="utf-8"><title>lol admin</title><p>Admin page missing.</p>'; }
    }
    return _pageCache;
}

// Constant-time bearer check against the admin token.
function authOk(req, adminToken) {
    if (!adminToken) return false;
    const h = req.headers['authorization'] || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (!m) return false;
    const a = Buffer.from(m[1]);
    const b = Buffer.from(adminToken);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readJson(req, limit = 1 << 20) {
    return new Promise((resolve) => {
        let buf = '';
        req.on('data', (c) => { buf += c; if (buf.length > limit) { buf = ''; req.destroy(); resolve(null); } });
        req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve(null); } });
        req.on('error', () => resolve(null));
    });
}

function sendJson(res, status, obj) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
}

function startSelfServer({ httpPort, getSnapshot, host = '0.0.0.0', control = null, adminToken = null, onClientPing = null }) {
    const server = http.createServer(async (req, res) => {
        const pathOnly = (req.url || '').split('?')[0].replace(/\/+$/, '') || '/';
        const method = req.method || 'GET';

        // Discovery snapshot (open, cross-origin fetchable).
        if (method === 'GET' && (pathOnly === '/lol/self')) {
            let body;
            try { body = JSON.stringify(getSnapshot()); }
            catch { res.writeHead(500); return res.end('{"error":"snapshot"}'); }
            res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
            return res.end(body);
        }

        // Desktop-client presence heartbeat (open, like /lol/self — trusted LAN; the
        // handler caps/sanitizes every field and bounds the map). The shell POSTs
        // { id, name, platform, version, idleSec } every ~10 s; feeds the admin
        // panel's Clients card + the snapshot's usage.clients count.
        if (method === 'POST' && pathOnly === '/lol/client-ping') {
            if (!onClientPing) return sendJson(res, 404, { error: 'not supported' });
            const body = await readJson(req, 4096);
            if (!body) return sendJson(res, 400, { error: 'bad json' });
            return sendJson(res, 200, onClientPing(body, (req.socket && req.socket.remoteAddress) || ''));
        }

        // Admin page (open — it prompts for the token client-side).
        if (method === 'GET' && pathOnly === '/lol/admin') {
            if (!control) { res.writeHead(404); return res.end('admin disabled'); }
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            return res.end(adminPage());
        }

        // Everything below is admin control — token required.
        if (pathOnly.startsWith('/lol/admin/')) {
            if (!control) return sendJson(res, 404, { error: 'admin disabled' });
            if (!authOk(req, adminToken)) return sendJson(res, 401, { error: 'unauthorized' });
            try {
                if (method === 'GET' && pathOnly === '/lol/admin/state') {
                    return sendJson(res, 200, await control.getAdminState());
                }
                if (method === 'POST' && pathOnly === '/lol/admin/model/start') {
                    const body = await readJson(req);
                    if (!body) return sendJson(res, 400, { error: 'bad json' });
                    return sendJson(res, 200, await control.startModel(body.id));
                }
                if (method === 'POST' && pathOnly === '/lol/admin/model/stop') {
                    const body = await readJson(req);
                    if (!body) return sendJson(res, 400, { error: 'bad json' });
                    return sendJson(res, 200, await control.stopModel(body.id));
                }
                // Make a served model the fleet default (drives clients' DEFAULT_MODELS).
                if (method === 'POST' && pathOnly === '/lol/admin/model/default') {
                    const body = await readJson(req);
                    if (!body) return sendJson(res, 400, { error: 'bad json' });
                    return sendJson(res, 200, await control.setDefaultModel(body.id));
                }
                // Change the model context window (num_ctx) live: POST {tokens}.
                if (method === 'POST' && pathOnly === '/lol/admin/context') {
                    const body = await readJson(req);
                    if (!body) return sendJson(res, 400, { error: 'bad json' });
                    return sendJson(res, 200, await control.setContextLength(body.tokens));
                }
                // --- backend + model management -------------------------------
                // These change what the farm SERVES, not just what it serves right
                // now: each persists into lol.config.json. The ones that reload a
                // model return immediately with a job id — the panel polls
                // /lol/admin/state for progress rather than holding a request open
                // across a multi-gigabyte download.
                const POSTS = {
                    '/lol/admin/backend': (b) => control.setBackend(b.engine),
                    '/lol/admin/name': (b) => control.setAdvertisedName(b.name),
                    '/lol/admin/model/alias': (b) => control.setModelAlias(b.id, b.alias),
                    '/lol/admin/security': (b) => control.setFarmPassword(b.password),
                    '/lol/admin/slots': (b) => control.setSlots(b.slots),
                    '/lol/admin/llamacpp/model': (b) => control.setLlamacppModel(b),
                    '/lol/admin/llamacpp/library/add': (b) => control.addLibraryModel(b),
                    '/lol/admin/llamacpp/library/remove': (b) => control.removeLibraryModel(b.id),
                    // One Apply for the settings block: {name?, slots?, password?, context?} in one restart.
                    '/lol/admin/apply': (b) => control.applyFarmSettings(b),
                    '/lol/admin/ollama/pull': (b) => control.pullOllamaModel(b.id),
                    '/lol/admin/ollama/remove': (b) => control.removeOllamaModel(b.id),
                };
                if (method === 'POST' && POSTS[pathOnly]) {
                    const body = await readJson(req);
                    if (!body) return sendJson(res, 400, { error: 'bad json' });
                    return sendJson(res, 200, await POSTS[pathOnly](body));
                }
                // Toggle a farm plugin: POST /lol/admin/plugin/<id>/enable|disable
                const pm = /^\/lol\/admin\/plugin\/([^/]+)\/(enable|disable)$/.exec(pathOnly);
                if (method === 'POST' && pm) {
                    return sendJson(res, 200, await control.setPlugin(decodeURIComponent(pm[1]), pm[2] === 'enable'));
                }
                // Recommend a client-side plugin to the fleet: POST /lol/admin/plugin/recommend {id,on}
                if (method === 'POST' && pathOnly === '/lol/admin/plugin/recommend') {
                    const body = await readJson(req);
                    if (!body) return sendJson(res, 400, { error: 'bad json' });
                    return sendJson(res, 200, await control.recommendClientPlugin(body.id, !!body.on));
                }
            } catch (e) {
                return sendJson(res, 500, { error: String((e && e.message) || e) });
            }
            return sendJson(res, 404, { error: 'not found' });
        }

        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
    });

    server.on('error', (e) => {
        console.warn(`[self] HTTP server error on :${httpPort} — ${e.message} (unicast discovery + admin disabled)`);
    });
    server.listen(httpPort, host);
    return server;
}

module.exports = { startSelfServer };
