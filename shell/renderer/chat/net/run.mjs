// @ts-check
// One generation: fetch → SSE → deltas → a GenerationResult. Plan §3.4, §3.6.2.
//
// NOT pure (it owns the fetch and the clock) but it owns NOTHING else: no DOM, no repo, no bus. The
// controller passes callbacks and decides what to do with them, which is what makes >150 tok/s
// possible — chat.js did the reading and the painting in one loop, so the DOM work throttled the
// stream itself. Here `onTail` is called on every chunk and the caller paints at most once per
// frame; `onCheckpoint` is already throttled to ~1/s because persisting is the one thing the caller
// must not do per chunk.
//
// `done` NEVER rejects. Every failure — a non-2xx body, a dead socket, an abort, an error object
// inside the stream — comes back as a GenerationResult with `error` set, because a rejected promise
// at this layer just means every caller has to write the same try/catch.
//
// Stats parity (chat.js:290-293): tokens = usage.completion_tokens, or the content-delta count when
// the farm sends no usage; tok/s divides by the GENERATION time (total − time to first token), not
// the wall time, so a slow first token does not read as a slow model.

import { createSSEParser } from './sse.mjs';
import { createAccumulator } from './delta.mjs';
import { classifyHttp, classifyThrown } from './errors.mjs';
import '../strings/net.en.mjs';

/** @typedef {import('../core/types.mjs').GenerationResult} GenerationResult */

const MAX_ERROR_BODY = 64 * 1024;
const CHECKPOINT_MS = 1000;

const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * Read at most `limit` characters of an error body and then HANG UP. `res.text()` would buffer
 * whatever the farm decided to send (a proxy melting down can answer a 502 with a megabyte of HTML),
 * so the body is read chunk by chunk and the stream is cancelled the moment there is enough text to
 * classify. The `text()` path is only the fallback for a Response with no readable body.
 */
async function errorBody(res, limit) {
  try {
    const body = /** @type {any} */ (res).body;
    if (body && typeof body.getReader === 'function') {
      const reader = body.getReader();
      const dec = new TextDecoder();
      let out = '';
      let complete = false;
      try {
        while (out.length < limit) {
          const { done, value } = await reader.read();
          if (done) { complete = true; break; }
          if (value) out += typeof value === 'string' ? value : dec.decode(value, { stream: true });
        }
      } finally {
        if (complete) { try { out += dec.decode(); } catch { /* nothing buffered */ } }
        else { try { const c = reader.cancel(); if (c && c.catch) c.catch(() => {}); } catch { /* already closed */ } }
      }
      return out.length > limit ? out.slice(0, limit) : out;
    }
    const text = await res.text();
    return typeof text === 'string' && text.length > limit ? text.slice(0, limit) : text;
  } catch {
    return '';
  }
}

/**
 * @param {{url: string, headers?: Record<string, string>, body: any, requiresKey?: boolean,
 *          fetchImpl?: typeof fetch, now?: () => number,
 *          onFirstToken?: (info: {ttftMs: number, kind: 'content'|'reasoning'}) => void,
 *          onTail?: (state: any) => void,
 *          onCheckpoint?: (state: any) => void}} opts
 * @returns {{abort(reason?: string): void, done: Promise<GenerationResult>}}
 */
export function startGeneration(opts) {
  const o = opts || /** @type {any} */ ({});
  const doFetch = o.fetchImpl || ((...a) => fetch(...a));
  const now = typeof o.now === 'function' ? o.now : clock;
  const controller = new AbortController();
  const acc = createAccumulator({});

  const started = now();
  /** @type {number|null} */ let ttftMs = null;
  /** @type {number|null} */ let reasoningStart = null;
  /** @type {number|null} */ let reasoningEnd = null;
  /** @type {'user'|'observer'|null} */ let abortedBy = null;
  let finished = false;
  let lastCheckpoint = 0;

  function abort(reason) {
    if (finished) return;
    abortedBy = reason === 'observer' ? 'observer' : 'user';
    try { controller.abort(); } catch { /* already gone */ }
  }

  /** @param {'done'|'aborted'|'error'} status @param {any} error */
  function result(status, error) {
    finished = true;
    acc.end();
    const s = acc.state;
    const durationMs = now() - started;
    const tokens = s.usage && s.usage.completion_tokens != null
      ? Number(s.usage.completion_tokens)
      : s.contentDeltas;
    const genSec = Math.max(0.001, (durationMs - (ttftMs || 0)) / 1000);
    const reasoningMs = reasoningStart == null
      ? null
      : Math.max(0, (reasoningEnd == null ? durationMs + started : reasoningEnd) - reasoningStart);
    return /** @type {GenerationResult} */ ({
      status,
      abortedBy: status === 'aborted' ? (abortedBy || 'user') : null,
      content: s.content,
      reasoning: s.reasoning || null,
      reasoningMs,
      usage: s.usage,
      finishReason: s.finishReason,
      ttftMs: ttftMs == null ? null : Math.round(ttftMs),
      durationMs: Math.round(durationMs),
      tokPerSec: tokens > 0 ? tokens / genSec : 0,
      error: error || null,
      sawToolCalls: s.sawToolCalls,
    });
  }

  const done = (async () => {
    /** @type {Response} */ let res;
    try {
      res = await doFetch(o.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(o.headers || {}) },
        body: JSON.stringify(o.body),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (err) {
      const e = classifyThrown(err);
      return e.kind === 'aborted' ? result('aborted', null) : result('error', e);
    }

    if (!res.ok) {
      const bodyText = await errorBody(res, MAX_ERROR_BODY);
      return result('error', classifyHttp({
        status: res.status, headers: res.headers, bodyText, requiresKey: !!o.requiresKey,
      }));
    }

    const before = { content: '', reasoning: '' };
    const onChunk = (/** @type {string} */ data) => {
      if (data === '[DONE]') return;
      /** @type {any} */ let obj;
      try { obj = JSON.parse(data); } catch { return; }      // a keep-alive or a truncated payload
      before.content = acc.state.content;
      before.reasoning = acc.state.reasoning;
      const s = acc.push(obj);

      const grewReasoning = s.reasoning.length > before.reasoning.length;
      const grewContent = s.content.length > before.content.length;
      if (grewReasoning && reasoningStart == null) reasoningStart = now();
      if (grewContent && reasoningStart != null && reasoningEnd == null) reasoningEnd = now();
      if ((grewContent || grewReasoning) && ttftMs == null) {
        ttftMs = now() - started;
        if (o.onFirstToken) o.onFirstToken({ ttftMs, kind: grewContent ? 'content' : 'reasoning' });
      }
      if (o.onTail) o.onTail(s);
      if (o.onCheckpoint) {
        const t = now();
        if (t - lastCheckpoint >= CHECKPOINT_MS) { lastCheckpoint = t; o.onCheckpoint(s); }
      }
    };

    const parser = createSSEParser(onChunk);
    try {
      const body = /** @type {any} */ (res.body);
      if (!body) return result('error', classifyThrown(new TypeError('the farm sent no body')));
      // TextDecoderStream keeps multi-byte characters intact across chunk boundaries; the manual
      // fallback does the same with a streaming TextDecoder for runtimes that lack it.
      if (typeof TextDecoderStream === 'function' && typeof body.pipeThrough === 'function') {
        const reader = body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          if (value) parser.feed(value);
        }
      } else {
        const reader = body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          if (value) parser.feed(dec.decode(value, { stream: true }));
        }
      }
      parser.end();
    } catch (err) {
      parser.end();
      const e = classifyThrown(err);
      return e.kind === 'aborted' ? result('aborted', null) : result('error', e);
    }

    if (acc.state.error) return result('error', acc.state.error);
    return result('done', null);
  })();

  return { abort, done };
}
