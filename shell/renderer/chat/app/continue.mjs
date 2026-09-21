// @ts-check
// CONTINUE (P2-U3): pick a reply back up where the farm stopped writing.
//
// Why it exists: llama.cpp answers `finish_reason: 'length'` the moment the slot's token budget is
// spent, and a stopped or interrupted reply leaves half an answer on screen. "Continue" asks for the
// REST of that same message — the text keeps growing in place, no second bubble.
//
// Two ways to ask, because models disagree:
//   'prefill'  (the default) — the request ends with the half-written ASSISTANT turn, tagged
//              `continue` by net/request.mjs, and the model simply keeps typing. Cheap and exact.
//   'userTurn' — some models ignore an assistant prefill and start the whole answer over. For those
//              we append ONE extra wire turn: a user message saying "Continue exactly where you
//              stopped, without repeating anything." (plan §2.6 AC `extraTurns`; nothing is stored).
//
// Which one a model needs is DISCOVERED, once, and remembered in kv `continueMode:<underlying>`:
// the first-chunk observer below reads the opening of the new text, and if it looks like a restart
// it aborts before a single character is painted, then the same click retries with the user turn.
// "new-continue" is not a controller mode — it is continue mode plus that one extra turn.

import { SLOTS } from '../core/registry.mjs';
import { t } from '../core/i18n.mjs';
import { KV_KEYS } from '../core/types.mjs';
import '../strings/tree.en.mjs';

/** Lucide-style "fast forward": the action is "keep going". */
const CONTINUE_ICON = ['m13 19 9-7-9-7v14z', 'm2 19 9-7-9-7v14z'];

/** How many characters of the new text are compared against the partial's opening. */
const OVERLAP_CHARS = 40;

/** Openers a model uses when it has decided to answer from scratch. */
const GREETING = /^(Hello|Hi|Sure|Certainly|Of course|Bonjour|Here)([\s,.!?:;—-]|$)/;

/** Whitespace-normalised, for comparing two renderings of the same sentence. */
const norm = (/** @type {string} */ s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/**
 * An ODD number of fence lines means the partial stopped INSIDE a code block. Anything the model
 * writes next belongs to that block, and code legitimately repeats itself — never call it a restart.
 * @param {string} text
 */
function insideOpenFence(text) {
  let fences = 0;
  for (const line of String(text || '').split('\n')) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) fences += 1;
  }
  return fences % 2 === 1;
}

/**
 * Did the partial stop in the middle of a sentence? A partial that ended on a full stop (or a line
 * break) can be followed by a fresh sentence with no suspicion at all.
 * @param {string} text
 */
function endsMidSentence(text) {
  const s = String(text || '');
  if (!s.trim()) return false;
  if (/\n\s*$/.test(s)) return false;                 // ended on a line break: a new block is normal
  if (/[.!?:]["'’)\]]?\s*$/.test(s)) return false;    // ended on a full stop: likewise
  return true;
}

/**
 * Did the model IGNORE the prefill and start over? PURE — the whole continue fallback hangs on it,
 * and it is deliberately conservative: a false positive costs an extra request, a false negative
 * shows the reader a duplicated answer.
 *
 * Rules (plan §4 P2-U3):
 *   - NEVER inside an open fence;
 *   - the new text repeating the partial's own opening (overlap) is a restart;
 *   - a greeting word right after a partial that stopped mid-sentence is a restart;
 *   - a capital letter on its own is NOT ("…the" + "Blender window" is a normal continuation).
 * @param {string} partial the text already on screen
 * @param {string} firstChunk the opening of what the farm is sending now
 */
export function looksLikeRestart(partial, firstChunk) {
  const p = String(partial == null ? '' : partial);
  const c = String(firstChunk == null ? '' : firstChunk);
  if (!p.trim() || !c.trim()) return false;
  if (insideOpenFence(p)) return false;

  const np = norm(p);
  const nc = norm(c);
  if (nc.length >= OVERLAP_CHARS && np.length >= OVERLAP_CHARS
    && nc.slice(0, OVERLAP_CHARS) === np.slice(0, OVERLAP_CHARS)) return true;

  if (endsMidSentence(p) && GREETING.test(c.replace(/^\s+/, ''))) return true;
  return false;
}

/**
 * Is "Continue" worth offering on this message? (plan §4 P2-U3: a length stop, or something
 * half-written that was interrupted or stopped.)
 * @param {any} msg
 */
export function canContinue(msg) {
  if (!msg || msg.role !== 'assistant') return false;
  if (msg.status === 'streaming' || msg.status === 'waiting' || msg.status === 'local') return false;
  const finish = msg.stats && msg.stats.finishReason;
  if (finish === 'length') return true;
  const hasText = !!String(msg.content || '').trim();
  return hasText && (msg.status === 'interrupted' || msg.status === 'aborted');
}

/** @param {any} app */
export function install(app) {
  const repo = () => app.repo;
  const ctl = () => app.controller;

  /** Continues this module started, by message id: {watch, restarted, underlying}. */
  /** @type {Map<string, {watch: boolean, restarted: boolean, underlying: string}>} */
  const runs = new Map();

  /** The kv identity of "the model that wrote this message" (its underlying weights when known). */
  function underlyingOf(msg) {
    if (msg && msg.underlying) return String(msg.underlying);
    const model = (msg && msg.model) || null;
    const info = model && app.farm && typeof app.farm.modelInfo === 'function' ? app.farm.modelInfo(model) : null;
    return String((info && info.underlying) || model || 'unknown');
  }

  /** The ONE extra wire turn of the fallback (§2.6 AC): request-only, never stored. */
  const continueTurn = () => ({
    role: 'user',
    blocks: [{ type: 'text', tag: 'continue', text: t('tree.continuePrompt') }],
  });

  /**
   * Continue `msg`, discovering the model's mode if we do not know it yet.
   * @param {any} msg
   */
  async function run(msg) {
    if (!ctl() || !msg || !canContinue(msg)) return null;
    // The governor, not just `isStreaming()`: a seat wait HOLDS the foreground slot without
    // streaming, and a Continue issued then was refused by generate() after the observers had
    // already been armed (P2 review). `canStart` is false for 'streaming' AND 'held'.
    if (typeof ctl().isStreaming === 'function' && ctl().isStreaming()) return null;
    if (app.gov && !app.gov.canStart('foreground')) return null;
    const underlying = underlyingOf(msg);
    let mode = null;
    if (repo() && typeof repo().kvGet === 'function') {
      try { mode = await repo().kvGet(KV_KEYS.continueMode(underlying), null); } catch (err) { void err; }
    }
    const asUserTurn = mode === 'userTurn';
    const state = { watch: !asUserTurn, restarted: false, underlying };
    runs.set(msg.id, state);
    try {
      const first = await ctl().generate({
        into: msg,
        mode: 'continue',
        holder: 'continue',
        ...(asUserTurn ? { extraTurns: [continueTurn()] } : {}),
      });
      if (!state.restarted) return first;
      // The model started over and the observer aborted before anything was painted. Ask again —
      // once — the way this model apparently wants to be asked. `onDone` has already written the
      // verdict to kv, so the next Continue on this model skips straight to the user turn.
      state.watch = false;
      return await ctl().generate({
        into: msg,
        mode: 'continue',
        holder: 'continue',
        extraTurns: [continueTurn()],
      });
    } finally {
      runs.delete(msg.id);
    }
  }

  app.registry.add(SLOTS.MESSAGE_ACTIONS, {
    id: 'continue',
    order: 150,
    icon: CONTINUE_ICON,
    label: t('tree.continueReply'),
    visible: (/** @type {any} */ msg) => canContinue(msg),
    run: (/** @type {any} */ msg) => { void run(msg); },
  });

  app.registry.add(SLOTS.STREAM_OBSERVERS, {
    id: 'continue-restart',
    /**
     * The controller holds the brush in continue mode until every observer has spoken, so returning
     * 'abort' here means NOTHING of the restart is ever painted and the partial stays whole.
     * @param {{msg: any, text: string, mode: string, partial: string}} o
     */
    onFirstChunk(o) {
      if (!o || o.mode !== 'continue' || !o.msg) return undefined;
      const state = runs.get(o.msg.id);
      if (!state || !state.watch) return undefined;
      if (!looksLikeRestart(o.partial, o.text)) return undefined;
      state.restarted = true;
      return 'abort';
    },
    /** Remember the verdict per model, so the discovery happens once per underlying. */
    async onDone(msg, result) {
      const state = msg ? runs.get(msg.id) : null;
      if (!state || !state.restarted) return;
      if (!result || result.abortedBy !== 'observer') return;
      if (!repo() || typeof repo().kvSet !== 'function') return;
      try {
        await repo().kvSet(KV_KEYS.continueMode(state.underlying), 'userTurn');
      } catch (err) {
        console.warn('[lolchat] continue: kvSet failed', err);
      }
    },
  });

  // Exposed for the shortcuts/actions surfaces and the harness; `continue` is a keyword, so the
  // property carries the full name.
  app.continueReply = { run, canContinue, looksLikeRestart };
  return app.continueReply;
}
