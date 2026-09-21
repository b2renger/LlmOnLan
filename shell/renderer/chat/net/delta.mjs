// @ts-check
// OpenAI streaming deltas → {content, reasoning, usage, finishReason, error}. PURE (§2.6 C, §3.4).
//
// The semantic half of the stream (net/sse.mjs did the framing). What the real farm sends:
//   - Ollama streams reasoning as `delta.reasoning`, llama.cpp as `delta.reasoning_content`
//     (chat.js:271 already handled both);
//   - some models emit no reasoning field at all and write <think>…</think> INTO the content, and
//     the tag is regularly split across chunk boundaries ("<th" + "ink>"). The parser must
//     therefore hold text back: the longest proper prefix of "</think>" is 7 characters, so at most
//     7 characters are ever withheld, and end() flushes whatever is left;
//   - LiteLLM sends usage in a choices-EMPTY chunk when stream_options.include_usage is set;
//   - the farm can inject a top-level {error:{…}} mid-stream and then just stop (no [DONE]).
//
// The <think> split is deliberately HEAD-ONLY, and one block per reply. llama.cpp and Ollama emit
// the thinking block first and exactly once, so that is the only place a bare tag is a marker;
// anywhere else it is the model TALKING about the tag — and an LLM-tooling audience asks about
// thinking tags often. Splitting anywhere used to eat the model's own text: "The `<think>` tag is
// used by some models. `</think>` closes it." was stored as "The `` closes it.", a fenced EXAMPLE
// of a thinking block was stored as an empty fence, and a stream cut before its `</think>` was
// stored as an empty body behind a collapsed Thought block. So: the tag opens a reasoning block
// only while everything seen so far is whitespace, the parser disarms for good as soon as real
// content lands or the block closes, and an unclosed block is given BACK to the content in end().
// Nothing the model produced is ever deleted.
//
// tool_calls are deliberately NOT accumulated (plan §6 opt): nothing in LOL Chat can execute them,
// so the only fact worth keeping is that the model tried — `sawToolCalls`, which the controller
// turns into a note.
//
// `contentDeltas` counts chunks that carried content; net/run.mjs uses it as the token count when
// the farm sends no usage. chat.js:290 counted reasoning chunks in that fallback too, which
// inflated "N tok" on a thinking model; the plan (§ P1-U1 run) says content deltas, so this counts
// content only. `reasoningDeltas` is kept for the same fallback on reasoning-only streams.

import { classifyStreamError } from './errors.mjs';

/** @typedef {{content: string, reasoning: string, sawToolCalls: boolean, usage: any,
 *   finishReason: string|null, error: import('../core/types.mjs').ClassifiedError|null,
 *   contentDeltas: number, reasoningDeltas: number}} DeltaState */

const OPEN = '<think>';
const CLOSE = '</think>';

/** Longest suffix of `s` that is a proper prefix of `tag` (what must be held back). */
function heldBack(s, tag) {
  const max = Math.min(s.length, tag.length - 1);
  for (let n = max; n > 0; n--) {
    if (s.charCodeAt(s.length - n) === tag.charCodeAt(0) && s.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

/**
 * @param {{splitThinkTags?: boolean}} [opts]
 * @returns {{push(obj: any): DeltaState, end(): DeltaState, state: DeltaState}}
 */
export function createAccumulator(opts = {}) {
  const splitThinkTags = opts.splitThinkTags !== false;

  /** @type {DeltaState} */
  const state = {
    content: '', reasoning: '', sawToolCalls: false, usage: null, finishReason: null, error: null,
    contentDeltas: 0, reasoningDeltas: 0,
  };

  let pending = '';        // text withheld because it may be the start of a think tag
  let inThink = false;
  let armed = splitThinkTags;  // a leading <think> may still open a reasoning block
  let thinkAt = -1;            // state.reasoning.length when the open tag was consumed (-1: none open)

  /** Route one content chunk, splitting a LEADING <think>…</think> into reasoning. */
  function consume(chunk) {
    let buf = pending + chunk;
    pending = '';
    for (;;) {
      if (inThink) {
        const j = buf.indexOf(CLOSE);
        if (j >= 0) {
          state.reasoning += buf.slice(0, j);
          buf = buf.slice(j + CLOSE.length);
          inThink = false;
          thinkAt = -1;          // it closed: there is nothing left to give back
          continue;              // `armed` is already false — the rest of the reply is plain text
        }
        const hold = heldBack(buf, CLOSE);
        state.reasoning += hold ? buf.slice(0, buf.length - hold) : buf;
        pending = hold ? buf.slice(buf.length - hold) : '';
        return;
      }
      // Past the head (or past the one block): every character is the model's own text.
      if (!armed) { state.content += buf; return; }

      const i = buf.indexOf(OPEN);
      if (i >= 0) {
        if (!state.content.trim() && !buf.slice(0, i).trim()) {
          state.content += buf.slice(0, i);
          buf = buf.slice(i + OPEN.length);
          inThink = true;
          armed = false;
          thinkAt = state.reasoning.length;
          continue;
        }
        armed = false;           // a tag the model TYPED, mid-reply: leave it alone, for good
        state.content += buf;
        return;
      }
      const hold = heldBack(buf, OPEN);
      const head = hold ? buf.slice(0, buf.length - hold) : buf;
      if (hold && !state.content.trim() && !head.trim()) {
        state.content += head;   // still only whitespace: the tag may yet open the reply
        pending = buf.slice(buf.length - hold);
        return;
      }
      if ((state.content + buf).trim()) armed = false;   // real text arrived first: never split
      state.content += buf;
      return;
    }
  }

  return {
    state,

    /** @param {any} obj one parsed SSE payload (never the literal "[DONE]") */
    push(obj) {
      if (!obj || typeof obj !== 'object') return state;

      // A top-level error object: the farm gave up mid-stream.
      if (obj.error) { state.error = classifyStreamError(obj); return state; }

      if (obj.usage && typeof obj.usage === 'object') state.usage = obj.usage;

      const ch = Array.isArray(obj.choices) ? obj.choices[0] : null;
      if (!ch) return state;

      if (ch.finish_reason) {
        state.finishReason = String(ch.finish_reason);
        if (state.finishReason === 'tool_calls') state.sawToolCalls = true;
      }

      // `delta` while streaming; `message` when a proxy answers a whole turn in one chunk.
      const d = (ch.delta && typeof ch.delta === 'object') ? ch.delta
        : ((ch.message && typeof ch.message === 'object') ? ch.message : null);
      if (!d) return state;

      if (d.tool_calls) state.sawToolCalls = true;

      const r = typeof d.reasoning === 'string' && d.reasoning ? d.reasoning
        : (typeof d.reasoning_content === 'string' ? d.reasoning_content : '');
      if (r) { state.reasoning += r; state.reasoningDeltas++; }

      const c = typeof d.content === 'string' ? d.content : '';
      if (c) {
        state.contentDeltas++;
        if (splitThinkTags) consume(c); else state.content += c;
      }
      return state;
    },

    /** Flush anything held back for a possible think tag. Safe to call more than once. */
    end() {
      if (pending) {
        if (inThink) state.reasoning += pending; else state.content += pending;
        pending = '';
      }
      // An opening <think> whose </think> never arrived (a cut or aborted stream): give the text
      // back to the body, so the reader sees what was produced instead of an empty message behind
      // a collapsed Thought block.
      if (inThink && thinkAt >= 0) {
        const held = state.reasoning.slice(thinkAt);
        state.reasoning = state.reasoning.slice(0, thinkAt);
        state.content += held;
        inThink = false;
        thinkAt = -1;
      }
      return state;
    },
  };
}
