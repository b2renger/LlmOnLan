// @ts-check
// The sandbox message protocol. PURE (lint rule 4): no DOM, no storage, no network — both sides
// import it, the host in the renderer and the guest inside an opaque-origin iframe.
//
// Studio plan §3.7.2, precised at the C3 kickoff (plan §2.6 BJ). Two things the S2 draft did not
// have, added here because the Computer's `Code` part needs them:
//   `compute` / `computed`  a run that RETURNS A VALUE. `run`/`ran` is the visual path (a sketch
//                           that paints); `compute`/`computed` is the deterministic path, and its
//                           result comes back as a JSON STRING so the host can cap the BYTES
//                           before it parses anything.
//   `libs` carries text     unchanged, but stated: nothing is ever fetched by the guest.
//
// The envelope is `{v, tok, id?, cmd|kind, ...}`. A `v` mismatch is a hard error, never a
// best-effort parse. `tok` is a 16-byte nonce the host mints per iframe and hands over in `boot`.
//
// WHY the nonce and not the origin (measured at this kickoff, real Electron, the shipped CSP):
// a `sandbox="allow-scripts"` iframe has an OPAQUE origin, so `event.origin` on the host side is
// the literal string 'null' and `location.origin` inside the guest reads 'file://'. Neither can
// identify anything. The two compensating controls are `event.source === frame.contentWindow`
// (host side) / `event.source === window.parent` (guest side), and the nonce.

export const PROTOCOL_VERSION = 1;

/** Host -> guest. */
export const CMDS = Object.freeze(['boot', 'libs', 'run', 'compute', 'params', 'snapshot', 'stop', 'ping', 'dispose']);

/** Guest -> host. `release` (K-9, the LIVE guest only): the person pressed Escape inside a live
 * sketch, which hands the keyboard back to the canvas. The guest cannot move the focus out of its
 * own frame, so it asks the host to. */
export const KINDS = Object.freeze(['ready', 'libsDone', 'ran', 'computed', 'error', 'log', 'frame', 'pong', 'bye', 'release']);

/** Why a live guest hands the keyboard back. One reason today; a list so a typo is refused. */
export const RELEASE_WHYS = Object.freeze(['escape']);

/** The sketch shapes `run` understands. `compute` has no kind: it returns a value. */
export const RUN_KINDS = Object.freeze(['canvas', 'dom', 'three', 'p5', 'svg']);

/** Every cap in one place, so the host and the guest cannot disagree about a limit. */
export const LIMITS = Object.freeze({
  maxLogs: 200,             // log envelopes per run, then the guest coalesces into {n}
  maxErrors: 20,            // error envelopes per run, same rule
  logBytes: 2048,           // one stringified console argument
  textBytes: 4096,          // message / stack / text, host-side clamp
  dataUrlBytes: 4 * 1024 * 1024,
  arrayMax: 64,
  resultBytes: 1024 * 1024, // `computed.json` — 1 MB of JSON is already a huge graph value
  maxPx: 1024,              // snapshot longest side
});

/** Timeouts (ms). Studio plan §3.7.4. */
export const TIMEOUTS = Object.freeze({
  boot: 3000,
  run: 5000,
  compute: 5000,
  ping: 1000,
  snapshot: 5000,
  hideGrace: 10000,
});

/** The largest guest frame a run may ask for, per side, in CSS pixels (K-4). The Preview's own
 * fields stop at 2048; the guest clamps to this same number (runner.html `SIZE_MAX`). */
export const GUEST_MAX_PX = 4096;

/**
 * A run's `size` (contract K-4, critic R1 A8) as the guest will use it: whole pixels, at least 1,
 * at most GUEST_MAX_PX a side — or null (no size: the frame keeps the mount's own).
 * @param {any} v @returns {{w: number, h: number}|null}
 */
export function guestSize(v) {
  if (!v || typeof v !== 'object') return null;
  const w = Math.round(Number(v.w));
  const h = Math.round(Number(v.h));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;
  return { w: Math.min(GUEST_MAX_PX, w), h: Math.min(GUEST_MAX_PX, h) };
}

/** How many malformed messages in a row tear the frame down (§3.7.2). */
export const MAX_DROPPED = 10;

/** Three rebuilds inside this window disable the sandbox until the user asks again (§3.7.4). */
export const REBUILD_WINDOW_MS = 60000;
export const MAX_REBUILDS = 3;

/**
 * The runner's Content-Security-Policy, BYTE-FROZEN (lint rule 9 compares this string to the meta
 * in sandbox/runner.html). No `'self'` anywhere: the guest can load NOTHING from disk, which is
 * what stops a generated `<script src="file:///...">` from reading the user's machine and posting
 * what it found back out through `window.onerror`.
 */
export const RUNNER_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; child-src blob:; worker-src blob:; font-src data:; form-action 'none'; base-uri 'none'";

/** The one sandbox attribute value. `allow-same-origin` is never added (lint rule 12). */
export const SANDBOX_ATTR = 'allow-scripts';

const CMD_SET = new Set(CMDS);
const KIND_SET = new Set(KINDS);

/** @param {any} s @param {number} max @returns {string} */
export function clampText(s, max) {
  const str = s === null || s === undefined ? '' : String(s);
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

/** A 16-byte nonce as hex. `rand` is injectable so the unit test is deterministic.
 * @param {(n: number) => number[]} [rand] @returns {string} */
export function mintToken(rand) {
  const bytes = rand
    ? rand(16)
    : Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join('');
}

/**
 * Host -> guest envelope. Throws on an unknown cmd: a typo must not become a silently ignored
 * message that leaves the host waiting for a reply that can never come.
 * @param {string} cmd @param {string} tok @param {object} [payload] @returns {object}
 */
export function command(cmd, tok, payload = {}) {
  if (!CMD_SET.has(cmd)) throw new Error(`sandbox: unknown cmd "${cmd}"`);
  return { v: PROTOCOL_VERSION, tok: String(tok || ''), cmd, ...payload };
}

/** Guest -> host envelope. Same rule for an unknown kind.
 * @param {string} kind @param {string} tok @param {object} [payload] @returns {object} */
export function message(kind, tok, payload = {}) {
  if (!KIND_SET.has(kind)) throw new Error(`sandbox: unknown kind "${kind}"`);
  return { v: PROTOCOL_VERSION, tok: String(tok || ''), kind, ...payload };
}

/**
 * Validate and COERCE one guest -> host message. Never throws; a bad message is dropped with a
 * reason the host counts (MAX_DROPPED in a row tears the frame down).
 *
 * `sameSource` is the host's `event.source === frame.contentWindow` verdict, passed in rather than
 * computed here so this module stays pure.
 * @param {any} raw @param {{tok: string, sameSource: boolean}} o
 * @returns {{ok: true, msg: any} | {ok: false, why: string}}
 */
export function readMessage(raw, o) {
  if (!o || o.sameSource !== true) return { ok: false, why: 'source' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, why: 'shape' };
  if (raw.v !== PROTOCOL_VERSION) return { ok: false, why: 'version' };
  if (typeof raw.kind !== 'string' || !KIND_SET.has(raw.kind)) return { ok: false, why: 'kind' };
  if (String(raw.tok || '') !== String(o.tok || '')) return { ok: false, why: 'token' };

  const k = raw.kind;
  /** @type {any} */ const msg = { v: PROTOCOL_VERSION, kind: k };
  const num = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  const err = (e) => (e && typeof e === 'object'
    ? {
      message: clampText(e.message, LIMITS.textBytes),
      stack: clampText(e.stack, LIMITS.textBytes),
      line: num(e.line, 0),
      col: num(e.col, 0),
    }
    : null);

  if (k === 'ready') { msg.ua = clampText(raw.ua, 64); return { ok: true, msg }; }
  if (k === 'pong') { msg.seq = num(raw.seq, -1); return { ok: true, msg }; }
  if (k === 'bye') return { ok: true, msg };
  if (k === 'release') {
    const why = String(raw.why || '');
    msg.why = RELEASE_WHYS.indexOf(why) >= 0 ? why : RELEASE_WHYS[0];
    return { ok: true, msg };
  }
  if (k === 'libsDone') {
    const rows = Array.isArray(raw.results) ? raw.results.slice(0, LIMITS.arrayMax) : [];
    msg.results = rows.map((r) => ({
      name: clampText(r && r.name, 64),
      ok: !!(r && r.ok),
      error: r && r.error ? clampText(r.error, LIMITS.textBytes) : null,
    }));
    return { ok: true, msg };
  }
  if (k === 'ran') {
    msg.id = clampText(raw.id, 64);
    msg.ok = !!raw.ok;
    msg.ms = num(raw.ms, 0);
    msg.error = err(raw.error);
    return { ok: true, msg };
  }
  if (k === 'computed') {
    msg.id = clampText(raw.id, 64);
    msg.ok = !!raw.ok;
    msg.ms = num(raw.ms, 0);
    msg.error = err(raw.error);
    const json = raw.json === null || raw.json === undefined ? null : String(raw.json);
    if (json !== null && json.length > LIMITS.resultBytes) return { ok: false, why: 'result-too-big' };
    msg.json = json;
    return { ok: true, msg };
  }
  if (k === 'error') {
    const phase = String(raw.phase || '');
    msg.phase = ['run', 'runtime', 'rejection', 'lib', 'compute'].indexOf(phase) >= 0 ? phase : 'runtime';
    msg.message = clampText(raw.message, LIMITS.textBytes);
    msg.stack = clampText(raw.stack, LIMITS.textBytes);
    msg.line = num(raw.line, 0);
    msg.col = num(raw.col, 0);
    msg.n = num(raw.n, 0);
    return { ok: true, msg };
  }
  if (k === 'log') {
    const level = String(raw.level || 'log');
    msg.level = ['log', 'info', 'warn', 'error'].indexOf(level) >= 0 ? level : 'log';
    msg.text = clampText(raw.text, LIMITS.textBytes);
    msg.n = num(raw.n, 0);
    return { ok: true, msg };
  }
  if (k === 'frame') {
    const url = String(raw.dataUrl || '');
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(url)) return { ok: false, why: 'data-url' };
    if (url.length > LIMITS.dataUrlBytes) return { ok: false, why: 'data-url-too-big' };
    msg.id = clampText(raw.id, 64);
    msg.dataUrl = url;
    msg.w = num(raw.w, 0);
    msg.h = num(raw.h, 0);
    return { ok: true, msg };
  }
  return { ok: false, why: 'kind' };
}

/**
 * The guest's own side of the same check. The guest INLINES an equivalent of this (runner.html
 * cannot import anything — `default-src 'none'`), and the unit test asserts the two agree.
 * @param {any} raw @param {{tok: string|null, sameSource: boolean}} o
 * @returns {{ok: true, msg: any} | {ok: false, why: string}}
 */
export function readCommand(raw, o) {
  if (!o || o.sameSource !== true) return { ok: false, why: 'source' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, why: 'shape' };
  if (raw.v !== PROTOCOL_VERSION) return { ok: false, why: 'version' };
  if (typeof raw.cmd !== 'string' || !CMD_SET.has(raw.cmd)) return { ok: false, why: 'cmd' };
  // Before `boot` the guest has no token yet; `boot` is the message that brings it.
  if (o.tok === null || o.tok === undefined) {
    if (raw.cmd !== 'boot') return { ok: false, why: 'unbooted' };
  } else if (String(raw.tok || '') !== String(o.tok)) {
    return { ok: false, why: 'token' };
  }
  return { ok: true, msg: raw };
}
