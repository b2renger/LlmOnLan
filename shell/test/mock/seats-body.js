// The farm's own error bodies, copied verbatim so the client's error mapping is
// tested against the REAL text a colleague would see (plan §2.3).
//
// Source: farm/src/seats.js
//   - line 233-253  the seat-gate 429  (429, `retry-after` = the idle window when every seat is generating, code `lol_seats_full`)
//   - line 288      the upstream 502   (code `lol_upstream_down`)
// shell/test/chat/unit/mock.test.mjs re-reads farm/src/seats.js (read-only) and fails
// if that file's wording drifts from this copy. Never "fix" this file by hand without
// re-reading the farm: the point is that it is a copy, not an interpretation.
'use strict';

/**
 * The body `startSeatGate` returns when no seat is free.
 * farm/src/seats.js:233-253 — the farm says when the soonest IDLE seat frees; the mock has
 * no seat clock, so it always sends the farm's "every seat is generating" variant
 * (`a.retrySec == null` → `retry-after` = the idle window):
 *   const idle = Math.max(60, idleReleaseSec() || 900);
 *   const mins = Math.round(idle / 60);
 *   const when = `Every one is generating right now, and a seat frees about ${mins} min after its holder's last reply: try again later`
 * @param {{cap?: number, idleSec?: number}} [opts]
 */
function seatsFullBody(opts = {}) {
    const cap = opts.cap == null ? 2 : opts.cap;
    const mins = Math.round(Math.max(60, opts.idleSec || 900) / 60);
    const when = `Every one is generating right now, and a seat frees about ${mins} min after its holder's last reply: try again later`;
    return {
        error: {
            message: `All ${cap} seats on this server are in use. ${when}. Whoever runs the farm can free idle seats sooner.`,
            type: 'rate_limit_error',
            code: 'lol_seats_full',
        },
    };
}

/** farm/src/seats.js:288 — the proxy is up but the engine behind it is not answering. */
function upstreamDownBody() {
    return {
        error: {
            message: 'The model server is not answering (it may be restarting) — try again in a few seconds.',
            type: 'api_error',
            code: 'lol_upstream_down',
        },
    };
}

/**
 * The headers the farm sends with that refusal: Retry-After is the idle window, the soonest a generating seat frees.
 * The farm's `access-control-allow-origin: *` is left to the mock's own CORS (two spellings of it would be two headers).
 */
function seatsFullHeaders(idleSec) {
    return {
        'content-type': 'application/json',
        'access-control-expose-headers': 'Retry-After',
        'retry-after': String(Math.max(60, idleSec || 900)),
    };
}

module.exports = { seatsFullBody, upstreamDownBody, seatsFullHeaders };
