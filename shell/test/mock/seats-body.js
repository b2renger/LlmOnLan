// The farm's own error bodies, copied verbatim so the client's error mapping is
// tested against the REAL text a colleague would see (plan §2.3).
//
// Source: farm/src/seats.js
//   - line 101-108  the seat-gate 429  (429, `retry-after: 30`, code `lol_seats_full`)
//   - line 126-130  the upstream 502   (code `lol_upstream_down`)
// shell/test/chat/unit/mock.test.mjs re-reads farm/src/seats.js (read-only) and fails
// if that file's wording drifts from this copy. Never "fix" this file by hand without
// re-reading the farm: the point is that it is a copy, not an interpretation.
'use strict';

/**
 * The body `startSeatGate` returns when no seat is free.
 * farm/src/seats.js:101-108 —
 *   const mins = Math.max(1, Math.round((idleReleaseSec() || 900) / 60));
 *   res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '30' });
 * @param {{cap?: number, idleSec?: number}} [opts]
 */
function seatsFullBody(opts = {}) {
    const cap = opts.cap == null ? 2 : opts.cap;
    const mins = Math.max(1, Math.round((opts.idleSec || 900) / 60));
    return {
        error: {
            message: `All ${cap} seats on this server are in use. A seat frees after ~${mins} min without activity — try again in a moment, or ask around who's done.`,
            type: 'rate_limit_error',
            code: 'lol_seats_full',
        },
    };
}

/** farm/src/seats.js:130 — the proxy is up but the engine behind it is not answering. */
function upstreamDownBody() {
    return {
        error: {
            message: 'The model server is not answering (it may be restarting) — try again in a few seconds.',
            type: 'api_error',
            code: 'lol_upstream_down',
        },
    };
}

/** The headers the farm sends with a seat-gate refusal. */
const SEATS_FULL_HEADERS = { 'content-type': 'application/json', 'retry-after': '30' };

module.exports = { seatsFullBody, upstreamDownBody, SEATS_FULL_HEADERS };
