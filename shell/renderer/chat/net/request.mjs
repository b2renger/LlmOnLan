// @ts-check
// The request draft and its OpenAI body. PURE (§2.6 C, §3.4, §3.6.3).
//
// Three pure steps sit between "a thread" and "bytes on the wire", and they are separate so the
// REQUEST_TRANSFORMS chain (§3.6.3) has something to mutate that is not yet a wire format:
//   draftFromPath(path, opts)  → RequestDraft   (blocks, one list per message, nothing resolved)
//   resolveParams(layers)      → Params         (call > thread > recipe, whitelist only)
//   toOpenAIBody(req, opts)    → the JSON body  (blocks → string or content parts)
//
// Invariants this file enforces and its tests pin:
//   - `reasoning` is NEVER sent back to the farm for any message. It is a rendering artefact; the
//     model re-derives its own thinking, and echoing it wastes context on every turn.
//   - assistant messages with status local/error/waiting, and empty ones, are not history: they are
//     the chat's own notes (chat.js wrote "⏳ The server is busy…" straight into the message text,
//     which meant the farm read its own error back on the next turn).
//   - the context-window key an Ollama client could set is NOT in the whitelist and cannot survive
//     it — the farm sizes its own window (CLAUDE.md: the client never sends one), and chat-lint
//     rule 2 refuses even to let this file name it.
//   - `options` (the Ollama-shaped param bag) is likewise absent: this endpoint is OpenAI-shaped.

/** @typedef {import('../core/types.mjs').RequestDraft} RequestDraft */
/** @typedef {import('../core/types.mjs').Params} Params */
/** @typedef {import('../core/types.mjs').Message} Message */

/** The ONLY parameters that ever reach the farm (plan §3.6.3, order 250). */
export const PARAM_KEYS = ['temperature', 'top_p', 'max_tokens', 'seed', 'stop'];

/** Assistant statuses that are the CHAT's own note, never something the model said. */
const NOT_HISTORY = new Set(['local', 'error', 'waiting']);

/** @param {any} v */
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * call > thread > recipe, then the whitelist. Undefined and null are "not set" at every layer, so a
 * thread can not un-set a recipe value by carrying `null` — it has to carry a real number.
 * @param {{recipe?: Params|null, thread?: Params|null, call?: Params|null}} [layers]
 * @returns {Params}
 */
export function resolveParams(layers) {
  const l = layers || {};
  /** @type {any} */ const out = {};
  // Merged layer by layer rather than with one {...recipe, ...thread, ...call} spread (the plan's
  // sketch): a spread lets a higher layer that happens to carry `seed: null` shadow a real value
  // below it and then lose it to the whitelist, so a thread whose params object has a null field
  // would silently disable a recipe's setting. "Not set" means not set, at every layer.
  for (const layer of [l.recipe, l.thread, l.call]) {
    if (!layer) continue;
    for (const k of PARAM_KEYS) {
      const v = /** @type {any} */ (layer)[k];
      if (v !== undefined && v !== null) out[k] = v;
    }
  }
  return out;
}

/**
 * A root→head path (plan §3.4 getPath) becomes the draft the transforms mutate.
 * @param {Message[]} path
 * `budget` is the token COUNT (FarmCaps.budget.tokens), not the caps' {tokens, advertised, source}
 * object - P2-U2's planTrim/gateVerdict and the §3.9 meter all want the number.
 * @param {{model?: string|null, mode?: 'new'|'continue', engine?: string|null, budget?: number|null,
 *          system?: string|null, paramLayers?: {recipe?: Params, thread?: Params, call?: Params}}} [opts]
 * @returns {RequestDraft}
 */
export function draftFromPath(path, opts) {
  const o = opts || {};
  const mode = o.mode === 'continue' ? 'continue' : 'new';
  const list = Array.isArray(path) ? path : [];
  /** @type {any[]} */ const messages = [];

  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const text = str(m.content);
    const isTail = i === list.length - 1;

    if (m.role === 'assistant') {
      if (NOT_HISTORY.has(/** @type {any} */ (m.status))) continue;
      if (!text.trim()) continue;
      // In continue mode the trailing assistant is the PREFILL the model has to keep writing, so it
      // stays last and is tagged so later stages (trimming, the continue UX) can find it.
      const tag = mode === 'continue' && isTail ? 'continue' : 'assistant';
      messages.push({ msgId: m.id, role: 'assistant', pinned: !!m.pinned, blocks: [{ type: 'text', text, tag }] });
      continue;
    }

    messages.push({
      msgId: m.id,
      role: 'user',
      pinned: !!m.pinned,
      blocks: text ? [{ type: 'text', text, tag: 'user' }] : [],
    });
  }

  const layers = o.paramLayers || {};
  return /** @type {any} */ ({
    model: o.model ?? null,
    system: o.system ?? null,
    systemAppend: [],
    messages,
    paramLayers: {
      recipe: { ...(layers.recipe || {}) },
      thread: { ...(layers.thread || {}) },
      call: { ...(layers.call || {}) },
    },
    params: {},
    responseFormat: null,
    mode,
    meta: {
      engine: o.engine ?? null,
      budget: o.budget ?? null,
      estimate: 0,
      trimmedIds: [],
      newTurnEstimate: 0,
      allowances: [],
    },
  });
}

/**
 * The wire body. Text-only messages get a string `content` (what every engine accepts); a message
 * carrying an image gets the OpenAI content-part array.
 * @param {RequestDraft} req
 * @param {{resolveImage?: (block: any, message: any) => string|null}} [opts]
 * @returns {object}
 */
export function toOpenAIBody(req, opts) {
  const resolveImage = opts && typeof opts.resolveImage === 'function' ? opts.resolveImage : null;
  /** @type {any[]} */ const out = [];

  const system = [req.system, ...(req.systemAppend || [])].filter(Boolean).join('\n\n');
  if (system) out.push({ role: 'system', content: system });

  for (const m of req.messages || []) {
    const blocks = Array.isArray(m.blocks) ? m.blocks : [];
    const hasImage = blocks.some((b) => b && b.type === 'image');
    if (!hasImage) {
      const text = blocks
        .filter((b) => b && b.type === 'text' && str(b.text))
        .map((b) => b.text)
        .join('\n\n');
      out.push({ role: m.role, content: text });
      continue;
    }
    /** @type {any[]} */ const parts = [];
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === 'text') {
        if (str(b.text)) parts.push({ type: 'text', text: b.text });
      } else if (b.type === 'image') {
        const url = b.dataUrl || (resolveImage ? resolveImage(b, m) : null);
        if (url) parts.push({ type: 'image_url', image_url: { url } });
      }
    }
    out.push({ role: m.role, content: parts });
  }

  /** @type {any} */
  const body = {
    model: req.model,
    messages: out,
    stream: true,
    stream_options: { include_usage: true },
  };
  // The whitelist runs again here, so no transform can smuggle a key onto the wire by writing
  // req.params directly.
  Object.assign(body, resolveParams({ call: req.params || {} }));
  if (req.responseFormat) body.response_format = req.responseFormat;
  return body;
}
