// @ts-check
// Farm errors → one classified shape the whole chat reasons about. PURE (§2.6 C, §3.4).
//
// Why this exists: on the real stack a failed send can mean six very different things, and chat.js
// showed all of them as "[error: HTTP 400]". The farm already says which one it is — the seat gate
// answers 429 with code lol_seats_full, the proxy answers 502 lol_upstream_down, LiteLLM refuses a
// wrong farm password with a **400** (not a 401), and a context overflow arrives as a 400 whose
// message names ContextWindowExceededError. classifyHttp reads those bodies (copied verbatim into
// shell/test/mock/seats-body.js from farm/src/seats.js) and describe() turns the verdict into a
// sentence a colleague can act on.
//
// ORDER MATTERS in classifyHttp and the unit tests pin it: the context-overflow message contains
// the word "tokens", so the auth text test must run AFTER it, or every overflow would be reported
// as a password problem.
//
// PARITY (chat.js:296-299): when the farm was advertising a job (caps.busy.label) at the moment the
// request failed, the note is the busy sentence whatever the technical cause — the farm bounces its
// proxy during a model switch and the honest answer is "it is switching models", not "network
// error". That is describe(err, t, {busy}), and it reuses core.busyFailNote verbatim.

import '../strings/core.en.mjs';
import '../strings/net.en.mjs';

/** @typedef {import('../core/types.mjs').ClassifiedError} ClassifiedError */

/** Words that mean "the farm did not accept your credentials". Whole words only: "monkey" is not a key. */
const AUTH_WORDS = /\b(auth|authentication|authorization|authenticate|unauthorized|forbidden|api[_-]?key|key|keys|token|tokens|credential|credentials)\b/i;
const CONTEXT_WORDS = /(contextwindowexceeded|context length|context window|maximum context|too many tokens)/i;
const VISION_WORDS = /\b(image|images|vision|multimodal|image_url)\b/i;
const NETWORK_WORDS = /(failed to fetch|networkerror|network error|load failed|connection (was )?reset|connection closed|econnreset|err_connection|err_network|err_empty_response|terminated)/i;

/** Read one header from a Headers instance, a plain object, or nothing. */
function header(headers, name) {
  if (!headers) return null;
  try {
    if (typeof (/** @type {any} */ (headers).get) === 'function') return /** @type {any} */ (headers).get(name);
  } catch { /* not a Headers */ }
  const want = String(name).toLowerCase();
  for (const k of Object.keys(/** @type {any} */ (headers))) {
    if (k.toLowerCase() === want) return /** @type {any} */ (headers)[k];
  }
  return null;
}

/** @param {any} v @returns {number|null} */
function seconds(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * @param {string} kind
 * @param {{status?: number|null, code?: string|null, message?: string|null, farmMessage?: string|null, retryAfter?: number|null}} [rest]
 * @returns {ClassifiedError}
 */
function make(kind, rest = {}) {
  return /** @type {any} */ ({
    kind,
    status: rest.status ?? null,
    code: rest.code ?? null,
    message: rest.message ?? kind,
    farmMessage: rest.farmMessage ?? null,
    retryAfter: rest.retryAfter ?? null,
  });
}

/**
 * A non-2xx HTTP answer from the farm's OpenAI endpoint.
 * @param {{status: number, headers?: any, bodyText?: string|null, requiresKey?: boolean}} o
 * @returns {ClassifiedError}
 */
export function classifyHttp(o) {
  const status = Number(o && o.status) || 0;
  const bodyText = o && typeof o.bodyText === 'string' ? o.bodyText : '';
  const requiresKey = !!(o && o.requiresKey);

  /** @type {any} */ let body = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = null; }
  const e = body && typeof body.error === 'object' && body.error ? body.error : null;
  const farmMessage = e && typeof e.message === 'string'
    ? e.message
    : (body && typeof body.message === 'string' ? body.message : null);
  const code = e && e.code != null ? String(e.code) : null;
  const retryAfter = seconds(header(o && o.headers, 'retry-after')) ?? seconds(e && /** @type {any} */ (e).retry_after);
  // Search the farm's own sentence when there is one; only fall back to the raw body (a plain-text
  // 502 from a reverse proxy has no JSON at all).
  const text = farmMessage || bodyText || '';
  const rest = { status, code, message: farmMessage || `HTTP ${status}`, farmMessage, retryAfter };

  // 1. the farm's own codes — unambiguous, and the reason seats.js sets them.
  if (status === 429 && code === 'lol_seats_full') return make('seats_full', { ...rest, retryAfter: retryAfter ?? 30 });
  if (code === 'lol_upstream_down') return make('upstream_down', rest);

  // 2. text verdicts, context BEFORE auth ("…16384 tokens" would otherwise read as a password problem).
  if (CONTEXT_WORDS.test(text)) return make('context_overflow', rest);
  if (status === 400 && VISION_WORDS.test(text)) return make('vision_unsupported', rest);
  if ((status === 400 || status === 401 || status === 403) && AUTH_WORDS.test(text)) return make('auth', rest);
  if (status === 500 && requiresKey && AUTH_WORDS.test(text)) return make('auth', rest);

  // 3. status fallbacks.
  if (status === 429) return make('seats_full', { ...rest, retryAfter: retryAfter ?? 30 });
  if (status === 502 || status === 503 || status === 504) return make('upstream_down', rest);
  return make('http', rest);
}

/**
 * A {error: {...}} object that arrived INSIDE the stream (the farm died mid-answer). The partial
 * text is kept by the caller; this only names what happened.
 * @param {any} obj
 * @returns {ClassifiedError}
 */
export function classifyStreamError(obj) {
  const e = obj && typeof obj.error === 'object' && obj.error ? obj.error : null;
  const msg = e && typeof e.message === 'string'
    ? e.message
    : (typeof (obj && obj.error) === 'string' ? String(obj.error) : null);
  return make('stream_error', {
    status: null,
    code: e && e.code != null ? String(e.code) : null,
    message: msg || 'stream error',
    farmMessage: msg,
  });
}

/**
 * Anything fetch (or the read loop) threw.
 * @param {any} err
 * @returns {ClassifiedError}
 */
export function classifyThrown(err) {
  const name = err && err.name ? String(err.name) : '';
  const msg = err && err.message ? String(err.message) : String(err ?? '');
  if (name === 'AbortError' || name === 'TimeoutError') return make('aborted', { message: msg || 'aborted' });
  if (name === 'TypeError' || NETWORK_WORDS.test(msg)) return make('network', { message: msg || 'network error' });
  return make('http', { message: msg || 'request failed' });
}

// Titles/bodies per kind. Literal maps so chat-lint rule 5 can prove every key exists.
const TITLE = {
  seats_full: 'net.seatsFullTitle',
  upstream_down: 'net.upstreamDownTitle',
  auth: 'net.authTitle',
  key_missing: 'net.keyMissingTitle',
  context_overflow: 'net.contextOverflowTitle',
  vision_unsupported: 'net.visionUnsupportedTitle',
  stream_error: 'net.streamErrorTitle',
  network: 'net.networkTitle',
  aborted: 'net.abortedTitle',
  http: 'net.httpTitle',
};
const BODY = {
  seats_full: 'net.seatsFullBody',
  upstream_down: 'net.upstreamDownBody',
  auth: 'net.authBody',
  key_missing: 'net.keyMissingBody',
  context_overflow: 'net.contextOverflowBody',
  vision_unsupported: 'net.visionUnsupportedBody',
  stream_error: 'net.streamErrorBody',
  network: 'net.networkBody',
  aborted: 'net.abortedBody',
  http: 'net.httpBody',
};

/**
 * The two lines a human reads. `busy` is the farm's advertised job AT FAILURE TIME (chat.js:296).
 * @param {ClassifiedError|null} err
 * @param {(key: string, vars?: Record<string, any>) => string} t
 * @param {{busy?: {label?: string|null, percent?: number|null}|null}} [opts]
 * @returns {{title: string, body: string}}
 */
export function describe(err, t, opts) {
  const busy = opts && opts.busy;
  if (busy && busy.label) {
    return { title: t('net.busyTitle'), body: t('core.busyFailNote', { label: busy.label }) };
  }
  const kind = err && err.kind && TITLE[/** @type {keyof typeof TITLE} */ (err.kind)] ? err.kind : 'http';
  const k = /** @type {keyof typeof TITLE} */ (kind);
  const vars = {
    message: (err && err.message) || '',
    status: err && err.status != null ? err.status : '',
    seconds: err && err.retryAfter != null ? err.retryAfter : 30,
  };
  // The farm's own sentence beats ours whenever it wrote one (seats.js and the context overflow
  // both say exactly what to do); ours is the fallback for the kinds that carry no farm message.
  // `auth` is the exception: a refused password reaches us as LiteLLM's own jargon ("Authentication
  // Error, Invalid proxy server token passed. Received Key=…"), which says nothing about WHERE to
  // fix it — so our line comes first and the farm's is appended for the operator.
  const useFarm = !!(err && err.farmMessage) && k !== 'aborted' && k !== 'auth';
  let body = useFarm ? err.farmMessage : t(BODY[k], vars);
  if (k === 'auth' && err && err.farmMessage) body = `${body} (${err.farmMessage})`;
  return { title: t(TITLE[k]), body };
}
