// @ts-check
// The context budget: what fits, what gets trimmed, and when Send has to ask first (VISION F25–F27).
// PURE (plan §2.6 C) — it imports only ctx/tokens.mjs, which is pure too.
//
//   trustedBudget(caps)          the window we are willing to believe
//   reserveFor(params)           room kept for the ANSWER
//   planTrim(req, o)             which stored messages survive, and whether it still does not fit
//   gateVerdict(o)               ok / confirm / block for one send
//
// Why "trusted": the live farm advertises 1,048,576 tokens per slot (DISCUSS D-F1). A meter that
// believes it would never warn anybody, and the trim would never run, and llama-server would answer
// with a hard context error while the meter said 4 %. So the advertised number is clamped, and a farm
// that advertises nothing gets a conservative default rather than "unlimited".
//
// Why trimming is CLIENT-side and visible: Ollama silently truncates the oldest turns and llama.cpp
// errors. Both are worse than the chat saying "these turns are outside the context" in the thread
// (thread-view paints the dropped rows `.chat-outside`).

import { estimateMessage, newTurnStart, DEFAULT_RATIO } from './tokens.mjs';

/** No advertised context → assume a comfortable window (mirrors net/farm.mjs). */
export const DEFAULT_BUDGET = 32768;
/** The biggest window we will believe, whatever the farm says. */
export const MAX_BUDGET = 262144;
/** Below this a "budget" is a misread field, not a farm. */
export const MIN_BUDGET = 1024;
/** Room kept for the reply when the request sets no `max_tokens`. */
export const DEFAULT_RESERVE = 4096;
/** Prompt tokens above which Send asks first (kv `pref:gateThreshold` overrides it). */
export const DEFAULT_GATE_THRESHOLD = 16000;

/** @param {any} v @param {number} dflt */
const num = (v, dflt) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

/**
 * The token window this farm's slot really has, as far as we are willing to believe it.
 * Accepts the whole FarmCaps, its `budget` object, or a bare number.
 * @param {any} caps
 * @returns {number}
 */
export function trustedBudget(caps) {
  const c = caps || null;
  let raw = null;
  if (typeof c === 'number') raw = c;
  else if (c) {
    if (typeof c.budget === 'number') raw = c.budget;
    else if (c.budget && typeof c.budget.tokens === 'number') raw = c.budget.tokens;
    else if (c.backend && typeof c.backend.contextPerSlot === 'number') raw = c.backend.contextPerSlot;
    else if (typeof c.contextPerSlot === 'number') raw = c.contextPerSlot;
    else if (typeof c.tokens === 'number') raw = c.tokens;
  }
  const n = num(raw, NaN);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BUDGET;
  return Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, Math.floor(n)));
}

/**
 * The tokens kept free for the answer. The RESOLVED params (transform order 250) are what counts:
 * a call-level `max_tokens` beats the thread's, and the reserve has to follow it or a long answer
 * runs into the window the prompt already filled.
 * @param {any} params
 * @returns {number}
 */
export function reserveFor(params) {
  const raw = params && typeof params === 'object' ? params.max_tokens : params;
  const n = num(raw, NaN);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RESERVE;
  return Math.floor(n);
}

/**
 * Group the request into turns: a turn starts at a user message and carries every assistant message
 * that follows it. Trimming drops WHOLE turns, so the model never sees a question without its answer.
 * @param {any[]} messages
 * @returns {number[][]} indexes, oldest turn first
 */
function turnsOf(messages) {
  /** @type {number[][]} */
  const turns = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!turns.length || (m && m.role === 'user')) turns.push([]);
    turns[turns.length - 1].push(i);
  }
  return turns;
}

/**
 * What survives, and whether it still does not fit.
 *
 * Always kept:
 *   - the system prompt (+ `systemAppend`) — it is not in `messages` and is never droppable;
 *   - every **pinned** message (F27: a pin means "this stays in context");
 *   - the last user turn and everything after it (the message being sent, the continue prefill);
 *   - every entry whose `msgId` is null — those are the request-only `extraTurns` of §2.6 AC. They
 *     are never dropped and never appear in `keptIds`/`droppedIds`, which are STORE ids.
 *
 * @param {any} req
 * @param {{budget?: number, reserve?: number, estimate?: (entry: any) => number}} [opts]
 * @returns {{keptIds: string[], droppedIds: string[], total: number, over: boolean,
 *            system: number, allowances: number, newTurn: number, budget: number, reserve: number,
 *            droppedIndexes: number[]}}
 */
export function planTrim(req, opts) {
  const o = opts || {};
  const r = req || {};
  const messages = Array.isArray(r.messages) ? r.messages : [];
  const estimate = typeof o.estimate === 'function'
    ? o.estimate
    : (/** @type {any} */ entry) => estimateMessage(entry, DEFAULT_RATIO);
  const budget = num(o.budget, 0) > 0 ? Math.floor(num(o.budget, 0)) : DEFAULT_BUDGET;
  const reserve = Math.max(0, num(o.reserve, DEFAULT_RESERVE));

  const sysText = [r.system, ...(Array.isArray(r.systemAppend) ? r.systemAppend : [])].filter(Boolean).join('\n\n');
  const system = sysText ? estimate({ role: 'system', msgId: null, pinned: true, blocks: [{ type: 'text', text: sysText }] }) : 0;

  let allowances = 0;
  for (const a of (r.meta && Array.isArray(r.meta.allowances) ? r.meta.allowances : [])) {
    allowances += Math.max(0, num(a && a.tokens, 0));
  }

  const tokens = messages.map((m) => estimate(m));

  // Where "the last user turn" starts. It must be the last STORED user message, not the last user
  // entry: in continue mode §2.6 AC appends a request-only "continue exactly where you stopped"
  // turn AFTER the assistant prefill, and taking that as the boundary would leave the prefill and
  // its question droppable — the two messages the continue is FOR.
  const lastUser = newTurnStart(messages);
  const keep = messages.map((m, i) => (
    !m || m.msgId == null || !!m.pinned || i >= lastUser
  ));

  let newTurn = 0;
  for (let i = lastUser; i < messages.length; i++) newTurn += tokens[i];

  let total = system + allowances;
  for (const n of tokens) total += n;

  // The prompt has to leave room for the answer, so the trim target is the budget MINUS the reserve.
  const target = Math.max(0, budget - reserve);
  /** @type {Set<number>} */
  const dropped = new Set();
  if (total > target) {
    for (const turn of turnsOf(messages)) {
      if (total <= target) break;
      // A whole turn at a time, oldest first — and a turn made only of must-keeps is simply
      // skipped, so a pin deep in the history costs its own tokens and nothing else.
      for (const i of turn) {
        if (keep[i] || dropped.has(i)) continue;
        dropped.add(i);
        total -= tokens[i];
      }
    }
  }

  /** @type {string[]} */ const keptIds = [];
  /** @type {string[]} */ const droppedIds = [];
  for (let i = 0; i < messages.length; i++) {
    const id = messages[i] && messages[i].msgId;
    if (id == null) continue;                 // request-only turns are not store ids
    if (dropped.has(i)) droppedIds.push(id); else keptIds.push(id);
  }

  return {
    keptIds,
    droppedIds,
    total,
    over: total + reserve > budget,
    system,
    allowances,
    newTurn,
    budget,
    reserve,
    droppedIndexes: [...dropped].sort((a, b) => a - b),
  };
}

/**
 * Should this send go straight out, ask first, or be refused?
 *
 *   block   — it cannot fit: even after trimming, the prompt plus the reply's reserve overflows the
 *             window. Sending would be an error on llama.cpp and a silent truncation on Ollama.
 *   confirm — it fits but it is expensive: the prefill is the part of a generation that makes
 *             everyone else on the farm wait, so above `threshold` tokens Send says what it costs
 *             and needs a second click (F26).
 *   ok      — send it.
 *
 * `seconds` is an estimate of the PREFILL time from `perf.lastPromptTokSec` (or the local EMA), and
 * is null when nothing has measured it yet — the label then shows tokens only, never a made-up time.
 *
 * @param {{total?: number, newTurn?: number, budget?: number, threshold?: number,
 *          promptTokSec?: number|null, reserve?: number}} o
 * @returns {{kind: 'ok'|'confirm'|'block', seconds: number|null}}
 */
export function gateVerdict(o) {
  const opts = o || {};
  const cost = Math.max(num(opts.total, 0), num(opts.newTurn, 0));
  const budget = num(opts.budget, 0);
  const reserve = Math.max(0, num(opts.reserve, 0));
  const threshold = num(opts.threshold, DEFAULT_GATE_THRESHOLD) > 0
    ? num(opts.threshold, DEFAULT_GATE_THRESHOLD)
    : DEFAULT_GATE_THRESHOLD;
  const rate = num(opts.promptTokSec, 0);
  const seconds = rate > 0 ? Math.max(1, Math.round(cost / rate)) : null;

  if (budget > 0 && cost + reserve > budget) return { kind: 'block', seconds };
  if (cost >= threshold) return { kind: 'confirm', seconds };
  return { kind: 'ok', seconds: null };
}
