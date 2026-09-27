// @ts-check
// Server-Sent Events framing. PURE (plan §2.6 C PURE_MODULES, §3.4).
//
// The transport half of the stream: bytes → text (done by the caller) → EVENTS. It knows nothing
// about OpenAI chunks; net/delta.mjs owns their meaning. Written to the WHATWG event-stream rules
// that actually bite on a farm:
//   - a line terminator is LF, CRLF or a lone CR, and a CRLF may be SPLIT ACROSS CHUNKS (a bare
//     trailing '\r' is therefore held back until the next feed);
//   - ':' starts a comment line (LiteLLM and llama-server both send keep-alive comments);
//   - a field is `name: value`, with ONE optional leading space removed from the value;
//   - repeated `data:` lines are joined with '\n' (a JSON payload containing a newline arrives this
//     way from some proxies);
//   - the event is dispatched by a BLANK line; a block with no data field at all dispatches nothing.
// `[DONE]` is passed through verbatim as data — deciding what it means is the consumer's job.
//
// chat.js:256-262 did none of this: it split on '\n', trimmed, and took anything starting with
// "data:". That works until a chunk boundary lands inside a CRLF or a data payload holds a newline.
//
//   const p = createSSEParser((data, meta) => …);   p.feed(textChunk); …; p.end();
//
// `end()` flushes a trailing event that never got its blank line (a server that just closes).

/** @typedef {{event: string|null, id: string|null}} SSEMeta */

/**
 * @param {(data: string, meta: SSEMeta) => void} onData
 * @returns {{feed(chunk: string): void, end(): void}}
 */
export function createSSEParser(onData) {
  if (typeof onData !== 'function') throw new TypeError('createSSEParser(onData): onData must be a function');

  let buf = '';
  /** @type {string[]} */ let dataLines = [];
  /** @type {string|null} */ let eventName = null;
  /** @type {string|null} */ let lastId = null;
  let sawData = false;

  function reset() {
    dataLines = [];
    eventName = null;
    sawData = false;
  }

  function dispatch() {
    if (!sawData) { reset(); return; }
    const data = dataLines.join('\n');
    const meta = { event: eventName, id: lastId };
    reset();
    onData(data, meta);
  }

  /** @param {string} raw one complete line, terminator already removed */
  function line(raw) {
    if (raw === '') { dispatch(); return; }
    if (raw.charCodeAt(0) === 58) return;                  // ':' → comment / keep-alive
    const i = raw.indexOf(':');
    const field = i < 0 ? raw : raw.slice(0, i);
    let value = i < 0 ? '' : raw.slice(i + 1);
    if (value.charCodeAt(0) === 32) value = value.slice(1); // exactly one leading space
    if (field === 'data') { dataLines.push(value); sawData = true; }
    else if (field === 'event') eventName = value;
    else if (field === 'id') lastId = value;
    // `retry` and unknown fields are ignored, per the spec.
  }

  return {
    /** @param {string} chunk */
    feed(chunk) {
      if (chunk == null || chunk === '') return;
      buf += chunk;
      let start = 0;
      for (let i = 0; i < buf.length; i++) {
        const c = buf[i];
        if (c === '\n') {
          line(buf.slice(start, i));
          start = i + 1;
        } else if (c === '\r') {
          // A '\r' at the very end may be the first half of a CRLF: wait for more text.
          if (i === buf.length - 1) break;
          line(buf.slice(start, i));
          if (buf[i + 1] === '\n') { start = i + 2; i++; } else { start = i + 1; }
        }
      }
      buf = buf.slice(start);
    },

    end() {
      if (buf) {
        const rest = buf.charCodeAt(buf.length - 1) === 13 ? buf.slice(0, -1) : buf;
        buf = '';
        if (rest !== '') line(rest);
      }
      dispatch();
    },
  };
}
