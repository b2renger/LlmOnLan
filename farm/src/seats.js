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
//   • first gated request from an IP claims a free seat (or 429s when none) —
//     only once the farm password checks out (401 and no seat otherwise);
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
const crypto = require('crypto');

function normIp(ip) {
    return String(ip || '').replace(/^::ffff:/, '');
}

// The routes that GENERATE, and so consume a seat — every one LiteLLM serves
// (read from 1.90/1.97's routers, multi-user plan 0.2): OpenAI chat completions,
// completions and responses under any of its prefixes (none, /v1, /openai/v1,
// /engines/<m>, /openai/deployments/<m>), Anthropic's /v1/messages, and Google's
// :generateContent / :streamGenerateContent and interactions. Only 4 spellings
// were gated before; the others reached the engine with no seat at all.
// Everything else (GET /v1/models, health probes, the panel's checks, embeddings,
// token counting) passes through ungated — a full farm must still be
// discoverable and readable.
const GATED_RX = /(\/completions|\/responses(\/compact)?|\/v1\/messages|:(generateContent|streamGenerateContent)|\/interactions)$/;

function isGated(method, url) {
    if (method !== 'POST') return false;
    let pathOnly = String(url || '').split('?')[0];
    // LiteLLM's server (uvicorn) routes on the percent-DECODED path, so match that:
    // /v1/chat%2Fcompletions must not walk past the gate. Undecodable → gated.
    try { pathOnly = decodeURIComponent(pathOnly); } catch { return true; }
    return GATED_RX.test(pathOnly.replace(/\/+$/, ''));
}

// The farm password (proxy.masterKey), checked BEFORE a seat is claimed (multi-user
// plan 0.1). LiteLLM checks it too, but only after the gate had seated the caller,
// so a keyless POST held a seat for the whole idle window on a passworded farm.
// Read the way LiteLLM reads it for these routes: `Authorization: Bearer`, else
// Anthropic-style `x-api-key`. Both sides hashed first, so the compare is
// constant-time and says nothing about the length. No password → open farm.
function keyOk(req, password) {
    if (!password) return true;
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    const given = m ? m[1].trim() : String(req.headers['x-api-key'] || '');
    const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
    return crypto.timingSafeEqual(h(given), h(password));
}

// capacity/idleReleaseSec are THUNKS: slots and the timeout are panel-tunable
// at runtime and the registry must always see the current value.
function createSeats({ capacity, idleReleaseSec, now = Date.now }) {
    const seats = new Map(); // ip → { since, lastActive, inFlight }
    const windowMs = () => Math.max(60, idleReleaseSec() || 900) * 1000;
    const prune = () => {
        const cutoff = now() - windowMs();
        // Never reap a seat mid-generation, however long it streams.
        for (const [ip, s] of seats) if (s.inFlight <= 0 && s.lastActive < cutoff) seats.delete(ip);
    };
    // Seconds until the soonest IDLE seat is reclaimed (if its holder stays quiet),
    // for an honest Retry-After. null when every seat is generating: those free only
    // a whole idle window after their stream ends, which nothing here can predict.
    const nextFreeSec = () => {
        let soonest = Infinity;
        for (const s of seats.values()) if (s.inFlight <= 0) soonest = Math.min(soonest, s.lastActive);
        return soonest === Infinity ? null : Math.max(1, Math.ceil((soonest + windowMs() - now()) / 1000));
    };
    return {
        admit(rawIp) {
            const ip = normIp(rawIp);
            prune();
            const cap = Math.max(1, capacity() || 1);
            let s = seats.get(ip);
            if (!s) {
                if (seats.size >= cap) return { ok: false, cap, used: seats.size, retrySec: nextFreeSec() };
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

// What people met at the gate (multi-user plan 3.3), for the owner's open question
// (plan §13, decision 2: keep the 429, or queue?): how many generations were let in or
// turned away, how full the seats got and when, how long the first word took, and how
// many replies were stopped. COUNTS ONLY: the gate hands these hooks no address, id or
// content, so nothing here can say who did what (§13b, identity privacy). In memory,
// lost at restart: the farm stays stateless.
// First-byte times land in bins (upper edges in ms, plus one bin for anything longer),
// so a percentile reads "within X", capped by the slowest time actually seen.
const TTFB_EDGES_MS = [250, 500, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 60000, 120000, 300000];
const COUNTS = ['admitted', 'refused', 'unauthorized', 'cancelled', 'cancelledBeforeFirstByte'];
const emptyCounts = () => ({
    admitted: 0, refused: 0, unauthorized: 0, cancelled: 0, cancelledBeforeFirstByte: 0,
    peakSeats: 0, peakAt: null, peakOf: null,
    ttfb: new Array(TTFB_EDGES_MS.length + 1).fill(0), ttfbMaxMs: 0,
});

function ttfbPercentile(c, p) {
    const n = c.ttfb.reduce((a, b) => a + b, 0);
    let seen = 0;
    for (let i = 0; n && i < c.ttfb.length; i++) {
        seen += c.ttfb[i];
        if (seen >= p * n - 1e-9) return Math.min(TTFB_EDGES_MS[i] ?? Infinity, c.ttfbMaxMs);
    }
    return null;
}

function createGateStats({ now = Date.now } = {}) {
    const startedAt = now();
    // ponytail: a ring of 60 one-minute buckets plus the since-start totals, the same few
    // hundred numbers whatever the traffic. A longer window = more buckets; exact
    // percentiles would need kept samples, which choosing queue-or-429 does not.
    const minutes = Array.from({ length: 60 }, () => ({ minute: -1, ...emptyCounts() }));
    const total = emptyCounts();
    const bump = (fn) => {
        const m = Math.floor(now() / 60000);
        const b = minutes[m % 60];
        if (b.minute !== m) Object.assign(b, emptyCounts(), { minute: m });
        fn(b); fn(total);
    };
    // Seats held, read at every generation request (the only moment the count grows).
    // >= keeps the LATEST time it was that full.
    const seated = (c, used, cap) => {
        if (used >= c.peakSeats) { c.peakSeats = used; c.peakAt = now(); c.peakOf = cap; }
    };
    const summary = (c) => {
        const timed = c.ttfb.reduce((a, b) => a + b, 0);
        return {
            ...Object.fromEntries(COUNTS.map((k) => [k, c[k]])),
            peakSeats: c.peakSeats, peakAt: c.peakAt, peakOf: c.peakOf,
            timed, ttfbP50Ms: ttfbPercentile(c, 0.5), ttfbP95Ms: ttfbPercentile(c, 0.95), ttfbMaxMs: timed ? c.ttfbMaxMs : null,
        };
    };
    return {
        minutes, total, // the whole state, readable so a test can prove it holds no address
        admitted(used, cap) { bump((c) => { c.admitted++; seated(c, used, cap); }); },
        refused(used, cap) { bump((c) => { c.refused++; seated(c, used, cap); }); },
        unauthorized() { bump((c) => { c.unauthorized++; }); },
        firstByte(ms) {
            const i = TTFB_EDGES_MS.findIndex((e) => ms <= e);
            bump((c) => { c.ttfb[i < 0 ? TTFB_EDGES_MS.length : i]++; c.ttfbMaxMs = Math.max(c.ttfbMaxMs, Math.round(ms)); });
        },
        cancelled(beforeFirstByte) { bump((c) => { c.cancelled++; if (beforeFirstByte) c.cancelledBeforeFirstByte++; }); },
        view() {
            const m = Math.floor(now() / 60000);
            const hour = emptyCounts();
            for (const b of minutes) {
                if (b.minute <= m - 60 || b.minute > m) continue;
                for (const k of COUNTS) hour[k] += b[k];
                b.ttfb.forEach((v, i) => { hour.ttfb[i] += v; });
                hour.ttfbMaxMs = Math.max(hour.ttfbMaxMs, b.ttfbMaxMs);
                if (b.peakAt != null && (b.peakSeats > hour.peakSeats || (b.peakSeats === hour.peakSeats && b.peakAt > hour.peakAt))) {
                    Object.assign(hour, { peakSeats: b.peakSeats, peakAt: b.peakAt, peakOf: b.peakOf });
                }
            }
            return { startedAt, lastHour: summary(hour), sinceStart: summary(total) };
        },
    };
}

// The gate itself: a dependency-free streaming pass-through to LiteLLM on
// loopback. SSE streams ride the pipe untouched; a client that disconnects
// mid-stream destroys the upstream request so the engine slot frees too.
// `password` is a thunk like the others: the panel sets the farm password at runtime.
function startSeatGate({ host, port, upstreamPort, seats, idleReleaseSec, password = () => null, stats = createGateStats() }) {
    const server = http.createServer((req, res) => {
        const t0 = Date.now();
        const ip = (req.socket && req.socket.remoteAddress) || '';
        const gated = isGated(req.method || '', req.url);
        if (gated) {
            if (!keyOk(req, password())) {
                stats.unauthorized();
                res.writeHead(401, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({
                    error: {
                        message: 'Wrong or missing farm password. Send it as the API key (Authorization: Bearer <password>).',
                        type: 'invalid_request_error',
                        code: 'invalid_api_key',
                    },
                }));
            }
            const a = seats.admit(ip);
            if (!a.ok) {
                stats.refused(a.used, a.cap);
                const mins = Math.max(1, Math.round((idleReleaseSec() || 900) / 60));
                // Retry-After says when the soonest idle seat is reclaimed; with every
                // seat generating nothing is predictable, so it is a short poll interval.
                const wait = a.retrySec == null ? 30 : a.retrySec;
                const when = a.retrySec == null
                    ? `Every one is generating right now, and a seat frees ~${mins} min after its last reply — try again in a moment`
                    : `The next one frees in about ${wait < 90 ? `${wait} s` : `${Math.round(wait / 60)} min`} if its holder stays quiet — try again then`;
                res.writeHead(429, { 'content-type': 'application/json', 'retry-after': String(wait) });
                return res.end(JSON.stringify({
                    error: {
                        message: `All ${a.cap} seats on this server are in use. ${when}, or ask around who's done.`,
                        type: 'rate_limit_error',
                        code: 'lol_seats_full',
                    },
                }));
            }
            stats.admitted(a.used, a.cap);
        }
        // One release per gated request, however the response ends ('close'
        // fires after both a clean finish and an abort).
        let released = false;
        const releaseOnce = () => { if (gated && !released) { released = true; seats.release(ip); } };
        let firstByte = false;
        let upFailed = false;

        const up = http.request({
            host: '127.0.0.1',
            port: upstreamPort,
            method: req.method,
            path: req.url,
            headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` },
        }, (ur) => {
            res.writeHead(ur.statusCode || 502, ur.headers);
            ur.pipe(res);
            // A stream's first byte is the person's wait for the first word, queueing and
            // prompt reading included. A non-streamed reply's first byte is the whole
            // answer (and an error is JSON), so only streams are timed.
            if (gated) {
                ur.once('data', () => {
                    firstByte = true;
                    if (/event-stream/i.test(ur.headers['content-type'] || '')) stats.firstByte(Date.now() - t0);
                });
            }
        });
        up.on('error', () => {
            upFailed = true;
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
            if (!res.writableEnded) {
                // The person left before the reply ended (Stop, a closed window), not a
                // model server that failed.
                if (gated && !upFailed) stats.cancelled(!firstByte);
                up.destroy();
            }
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

module.exports = { createSeats, createGateStats, startSeatGate, isGated, normIp };
