// @ts-check
// The local token estimator (VISION F24) — PURE (plan §2.6 C: this whole module is on the frozen
// PURE_MODULES list and must import with the DOM/storage globals trapped).
//
// Why a local estimator at all: the farm has no cheap token counter we are allowed to call. LiteLLM's
// /utils/token_counter is not portable across the three engines, and ANY probe costs a seat someone
// else is waiting for (VISION D-3). So the chat estimates locally and CALIBRATES from the one honest
// number every reply already carries home: `usage.prompt_tokens`.
//
//   estimateText(text, ratio)      chars/token, with CJK counted per character
//   estimateMessage(entry, ratio)  one RequestDraft.messages entry: its blocks + the role envelope
//   breakdown(req, ratioFor)       the whole request, split the way the meter's popover shows it
//   estimateRequest(req, ratioFor) the same thing, total only (§4 P2-U2's named export)
//   calibrate(prev, chars, tokens) the EMA that moves the ratio towards what the farm really counted
//
// The numbers are deliberately CONSERVATIVE rather than clever: a tokeniser per model would be a
// megabyte of vendored data, would still be wrong for the next .gguf someone drops on the farm, and
// the only decision that hangs off it (ask before sending / trim the oldest turns) is safe when it
// errs high.

/** The seed ratio: ~3.6 characters per token for English prose on a BPE tokeniser. */
export const DEFAULT_RATIO = 3.6;
/** Calibration is clamped to this range: a ratio outside it means the sample was nonsense. */
export const MIN_RATIO = 1.5;
export const MAX_RATIO = 6;
/** Per-message wire overhead (role, delimiters) — the same 4 every OpenAI-shaped counter uses. */
export const PER_MESSAGE_TOKENS = 4;
/** One image, conservatively. Real vision models charge 250–2,600; over-counting only trims sooner. */
export const IMAGE_TOKENS = 1600;
/** EMA weight of the newest sample. 0.3 settles in ~10 replies and still follows a model change. */
export const EMA_ALPHA = 0.3;

// CJK ideographs, kana, Hangul (syllables and jamo), CJK punctuation and the fullwidth forms, plus
// the astral ideograph planes. One character ≈ one token in every BPE vocabulary we have measured,
// so dividing them by 3.6 like Latin text under-counts a Japanese paste by ~3x — the exact case
// where an unnoticed overflow is most expensive.
const WIDE_RE = /[\u1100-\u11ff\u2e80-\u303f\u3040-\u318f\u31a0-\u31ef\u3200-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe10-\ufe6f\uff00-\uffef]|[\u{20000}-\u{3ffff}]/gu;

/** @param {any} v @param {number} dflt */
const num = (v, dflt) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

/** @param {number} r */
const clampRatio = (r) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));

/**
 * A ratio argument that may be a number, a function of the model id, or nothing.
 * @param {any} ratioFor
 * @param {string|null} [model]
 * @returns {number}
 */
function resolveRatio(ratioFor, model) {
  let r = ratioFor;
  if (typeof ratioFor === 'function') {
    try { r = ratioFor(model ?? null); } catch { r = DEFAULT_RATIO; }
  }
  const n = num(r, DEFAULT_RATIO);
  return n > 0 ? n : DEFAULT_RATIO;
}

/**
 * Tokens in a piece of text. Wide characters count 1 each; the rest is `chars / ratio`, rounded up.
 * @param {string} text
 * @param {number} [ratio]
 * @returns {number}
 */
export function estimateText(text, ratio = DEFAULT_RATIO) {
  const s = typeof text === 'string' ? text : '';
  if (!s) return 0;
  const r = num(ratio, DEFAULT_RATIO) > 0 ? num(ratio, DEFAULT_RATIO) : DEFAULT_RATIO;
  let wide = 0;
  let wideUnits = 0;
  WIDE_RE.lastIndex = 0;
  let m;
  while ((m = WIDE_RE.exec(s)) !== null) {
    wide++;
    wideUnits += m[0].length;              // an astral ideograph is 2 UTF-16 units, 1 character
  }
  const rest = s.length - wideUnits;
  return wide + (rest > 0 ? Math.ceil(rest / r) : 0);
}

/** @param {any} entry a RequestDraft.messages entry @returns {number} images in it */
export function imageCount(entry) {
  const blocks = entry && Array.isArray(entry.blocks) ? entry.blocks : [];
  let n = 0;
  for (const b of blocks) if (b && b.type === 'image') n++;
  return n;
}

/**
 * One request message: every text block, `IMAGE_TOKENS` per image block, plus the role envelope.
 * @param {any} entry
 * @param {number} [ratio]
 * @returns {number}
 */
export function estimateMessage(entry, ratio = DEFAULT_RATIO) {
  if (!entry) return 0;
  let total = PER_MESSAGE_TOKENS;
  const blocks = Array.isArray(entry.blocks) ? entry.blocks : [];
  for (const b of blocks) {
    if (!b) continue;
    if (b.type === 'image') { total += IMAGE_TOKENS; continue; }
    if (typeof b.text === 'string') total += estimateText(b.text, ratio);
  }
  return total;
}

/**
 * The wire system message: `system` plus everything later transforms pushed to `systemAppend`
 * (plan §3.6.3 — `toOpenAIBody` joins them with a blank line, so the estimate must too).
 * @param {any} req
 * @returns {string}
 */
export function systemTextOf(req) {
  const r = req || {};
  return [r.system, ...(Array.isArray(r.systemAppend) ? r.systemAppend : [])].filter(Boolean).join('\n\n');
}

/** The characters actually sent, for calibration against `usage.prompt_tokens`. @param {any} req */
export function promptChars(req) {
  const r = req || {};
  let chars = systemTextOf(r).length;
  for (const m of Array.isArray(r.messages) ? r.messages : []) {
    for (const b of (m && Array.isArray(m.blocks) ? m.blocks : [])) {
      if (b && typeof b.text === 'string') chars += b.text.length;
    }
  }
  return chars;
}

/**
 * Index of the last STORED user entry — where "this message" starts. Everything at or after it is
 * the new turn, which in continue mode includes the assistant prefill and the request-only turns
 * appended after it (§2.6 AC's extraTurns carry msgId null and are part of this send, not history).
 * @param {any[]} messages
 * @returns {number}
 */
export function newTurnStart(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m && m.role === 'user' && m.msgId != null) return i;
  }
  // A request with no stored user turn at all (a bare extraTurn, a preview of an empty draft): the
  // first request-only user turn starts it.
  for (let i = list.length - 1; i >= 0; i--) if (list[i] && list[i].role === 'user') return i;
  return list.length;                     // no user turn at all: nothing counts as "new"
}

/**
 * The whole request, split the way the meter's popover shows it. `allowances` are the reservations a
 * transform makes for content it has not produced yet (a web search in preview, plan §3.6.3 order 350).
 * @param {any} req
 * @param {number|((model: string|null) => number)} [ratioFor]
 * @returns {{ratio: number, system: number, pinned: number, history: number, newTurn: number,
 *            images: number, allowances: number, total: number,
 *            perMessage: {index: number, msgId: string|null, role: string, pinned: boolean, tokens: number}[]}}
 */
export function breakdown(req, ratioFor) {
  const r = req || {};
  const ratio = resolveRatio(ratioFor, r.model ?? null);
  const messages = Array.isArray(r.messages) ? r.messages : [];
  const sysText = systemTextOf(r);
  const system = sysText ? estimateText(sysText, ratio) + PER_MESSAGE_TOKENS : 0;

  const newFrom = newTurnStart(messages);
  let pinned = 0;
  let history = 0;
  let newTurn = 0;
  let images = 0;
  /** @type {any[]} */
  const perMessage = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const tokens = estimateMessage(m, ratio);
    images += imageCount(m) * IMAGE_TOKENS;
    perMessage.push({
      index: i,
      msgId: m && m.msgId != null ? m.msgId : null,
      role: (m && m.role) || 'user',
      pinned: !!(m && m.pinned),
      tokens,
    });
    if (i >= newFrom) newTurn += tokens;
    else if (m && m.pinned) pinned += tokens;
    else history += tokens;
  }

  let allowances = 0;
  for (const a of (r.meta && Array.isArray(r.meta.allowances) ? r.meta.allowances : [])) {
    allowances += num(a && a.tokens, 0);
  }

  return {
    ratio,
    system,
    pinned,
    history,
    newTurn,
    images,
    allowances,
    total: system + pinned + history + newTurn + allowances,
    perMessage,
  };
}

/**
 * The prompt this request would cost, in tokens.
 * @param {any} req
 * @param {number|((model: string|null) => number)} [ratioFor]
 * @returns {number}
 */
export function estimateRequest(req, ratioFor) {
  return breakdown(req, ratioFor).total;
}

/**
 * Move the chars-per-token ratio towards what the farm really counted. EMA with alpha 0.3, clamped:
 * one weird reply (a huge image, a farm that counts differently) can never send the estimator to a
 * ratio that would silently overflow the next send.
 * @param {number|null|undefined} prev
 * @param {number} promptCharCount characters we sent
 * @param {number} promptTokens `usage.prompt_tokens` from the reply
 * @returns {number}
 */
export function calibrate(prev, promptCharCount, promptTokens) {
  const base = num(prev, DEFAULT_RATIO) > 0 ? num(prev, DEFAULT_RATIO) : DEFAULT_RATIO;
  const chars = num(promptCharCount, 0);
  const tokens = num(promptTokens, 0);
  if (chars <= 0 || tokens <= 0) return clampRatio(base);
  const observed = chars / tokens;
  return clampRatio(base * (1 - EMA_ALPHA) + observed * EMA_ALPHA);
}
