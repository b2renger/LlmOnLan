// Seat gate — WHO may generate, enforced in FRONT of LiteLLM (owner ask
// 2026-09-04: "if the user hasn't been typing or generating for a certain
// amount of time, its slot should be free... if he starts generating he'll
// need to find a free slot beforehand").
//
// Why a front proxy at all: the farm's Node process never saw chat traffic —
// completions went straight to LiteLLM — so nothing could tell an idle-for-an-
// hour client from an active one, and presence heartbeats can't BLOCK anything
// (OWUI is a black box; the only enforceable point is the serving path).
// With the gate, the public `proxy.port` is OUR listener and LiteLLM binds
// loopback-only behind it. Reading chats / notes / navigating never touches
// this port (all of that is client-local by design), so an evicted idler loses
// exactly one thing: the ability to start a NEW generation while the farm is
// full — which is the point.
//
// A seat is an IP holding the right to generate:
//   • first gated request from an IP claims a free seat (or 429s when none);
//   • every gated request refreshes the seat's lastActive;
//   • a seat with no in-flight request and no activity for idleReleaseSec is
//     reclaimed LAZILY (pruned on the next admit/view — no sweeper needed);
//   • capacity = the engine's "people served at once" (llamacpp.parallel /
//     ollama numParallel × hosts), read through a thunk so panel slot changes
//     apply live without touching the gate.
// IP-keyed on purpose: it needs no client cooperation (raw API users are
// gated too) and the office LAN is NAT-free. Known coarse edges, accepted:
// several people behind one IP share a seat; a coordinator peer farm counts
// as ONE seat here (its own gate does the per-user work on its side); hitting
// the engine's own port directly bypasses the gate (trusted LAN, same stance
// as the open proxy).

const http = require('http');

function normIp(ip) {
    return String(ip || '').replace(/^::ffff:/, '');
}

// The completion routes that consume a seat. Everything else (GET /v1/models,
// health probes, the panel's checks) passes through ungated — a full farm must
// still be discoverable and readable. LiteLLM serves both spellings.
const GATED_PATHS = new Set(['/v1/chat/completions', '/chat/completions', '/v1/completions', '/completions']);

function isGated(method, url) {
    if (method !== 'POST') return false;
    const pathOnly = String(url || '').split('?')[0].replace(/\/+$/, '');
    return GATED_PATHS.has(pathOnly);
}

// capacity/idleReleaseSec are THUNKS: slots and the timeout are panel-tunable
// at runtime and the registry must always see the current value.
function createSeats({ capacity, idleReleaseSec, now = Date.now }) {
    const seats = new Map(); // ip → { since, lastActive, inFlight }
    const prune = () => {
        const cutoff = now() - Math.max(60, idleReleaseSec() || 900) * 1000;
        // Never reap a seat mid-generation, however long it streams.
        for (const [ip, s] of seats) if (s.inFlight <= 0 && s.lastActive < cutoff) seats.delete(ip);
    };
    return {
        admit(rawIp) {
            const ip = normIp(rawIp);
            prune();
            const cap = Math.max(1, capacity() || 1);
            let s = seats.get(ip);
            if (!s) {
                if (seats.size >= cap) return { ok: false, cap, used: seats.size };
                s = { since: now(), lastActive: now(), inFlight: 0 };
                seats.set(ip, s);
            }
            s.lastActive = now();
            s.inFlight += 1;
            return { ok: true, cap, used: seats.size };
        },
        release(rawIp) {
            const s = seats.get(normIp(rawIp));
            if (!s) return;
            s.inFlight = Math.max(0, s.inFlight - 1);
            s.lastActive = now();
        },
        view() {
            prune();
            const t = now();
            return [...seats.entries()].map(([ip, s]) => ({
                ip,
                inFlight: s.inFlight,
                idleSec: Math.round((t - s.lastActive) / 1000),
            }));
        },
    };
}

// The gate itself: a dependency-free streaming pass-through to LiteLLM on
// loopback. SSE streams ride the pipe untouched; a client that disconnects
// mid-stream destroys the upstream request so the engine slot frees too.
function startSeatGate({ host, port, upstreamPort, seats, idleReleaseSec }) {
    const server = http.createServer((req, res) => {
        const ip = (req.socket && req.socket.remoteAddress) || '';
        const gated = isGated(req.method || '', req.url);
        if (gated) {
            const a = seats.admit(ip);
            if (!a.ok) {
                const mins = Math.max(1, Math.round((idleReleaseSec() || 900) / 60));
                res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '30' });
                return res.end(JSON.stringify({
                    error: {
                        message: `All ${a.cap} seats on this server are in use. A seat frees after ~${mins} min without activity — try again in a moment, or ask around who's done.`,
                        type: 'rate_limit_error',
                        code: 'lol_seats_full',
                    },
                }));
            }
        }
        // One release per gated request, however the response ends ('close'
        // fires after both a clean finish and an abort).
        let released = false;
        const releaseOnce = () => { if (gated && !released) { released = true; seats.release(ip); } };

        const up = http.request({
            host: '127.0.0.1',
            port: upstreamPort,
            method: req.method,
            path: req.url,
            headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` },
        }, (ur) => {
            res.writeHead(ur.statusCode || 502, ur.headers);
            ur.pipe(res);
        });
        up.on('error', () => {
            releaseOnce();
            if (!res.headersSent) {
                res.writeHead(502, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'The model server is not answering (it may be restarting) — try again in a few seconds.', type: 'api_error', code: 'lol_upstream_down' } }));
            } else {
                res.destroy();
            }
        });
        req.on('error', () => { up.destroy(); });
        res.on('close', () => {
            releaseOnce();
            // Abandoned mid-stream → cancel upstream so llama-server/Ollama stop
            // generating for a reader who left. After a clean finish this is a no-op
            // guard (writableEnded), not a keep-alive socket kill.
            if (!res.writableEnded) up.destroy();
        });
        req.pipe(up);
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            server.removeListener('error', reject);
            resolve(server);
        });
    });
}

module.exports = { createSeats, startSeatGate, isGated, normIp };
