// @ts-check
// Getting a typed value out of whatever a local model actually said. PURE (plan §2.6 C, studio
// plan §3.4.2). No DOM, no network, no clock — everything here is a function of its arguments.
//
// Why this file exists: a 12B model on a LAN box does not honour `response_format` the way a
// frontier API does, and LiteLLM may strip it before the engine ever sees it (`drop_params`). The
// same question therefore comes back as, in descending order of luck:
//   a bare object                         → how:'body'
//   prose plus a fenced block             → how:'fence'
//   an object in the middle of a sentence → how:'slice'
//   nothing usable at all                 → how:'none'
// `extractJson` reads all four without ever RUNNING the text (no eval, no Function, no JSON5).
//
// Two deliberate narrownesses:
//   - only an OBJECT or ARRAY root counts as a find. `"Sure."` is valid JSON for a parser that
//     accepts scalars, and accepting it would turn every refusal into a "successful" string answer.
//   - `coerce` NEVER invents a missing required field. Filling one in is how a panel ends up
//     showing a confident empty answer that no model ever produced (§1.2).

/** @param {any} v */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** @param {string} text @returns {{ok: boolean, value: any}} */
function tryParse(text) {
  try {
    const v = JSON.parse(text);
    if (isObj(v) || Array.isArray(v)) return { ok: true, value: v };
    return { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

/**
 * Every fenced block's body, in order. Both fence markers count, with or without a language tag;
 * an UNCLOSED fence yields the rest of the text, because a truncated reply is exactly when we most
 * want to try.
 * @param {string} text @returns {string[]}
 */
function fences(text) {
  /** @type {string[]} */ const out = [];
  const re = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*([a-zA-Z0-9_-]*)[ \t]*\r?\n/g;
  let m;
  while ((m = re.exec(text))) {
    const marker = m[2].slice(0, 3);
    const start = m.index + m[0].length;
    const closeRe = new RegExp(`\\n[ \\t]*${marker[0] === '~' ? '~{3,}' : '`{3,}'}[ \\t]*(?:\\r?\\n|$)`, 'g');
    closeRe.lastIndex = start;
    const close = closeRe.exec(text);
    out.push(close ? text.slice(start, close.index) : text.slice(start));
    if (!close) break;
    // Resume AFTER the closing line, keeping its trailing newline so the next opener still has the
    // `\n` it matches on. Resuming at close.index re-read the CLOSING fence as an opener, which
    // swallowed the next real block's body whole.
    const consumed = close.index + close[0].length;
    re.lastIndex = close[0].endsWith('\n') ? consumed - 1 : consumed;
  }
  return out;
}

/**
 * The balanced object/array spans of `text`, in order, skipping brackets that live inside strings.
 * An unbalanced opener (a truncated reply) yields nothing and the scan moves past it.
 * @param {string} text @returns {string[]}
 */
function balanced(text) {
  /** @type {string[]} */ const out = [];
  for (let i = 0; i < text.length; i++) {
    const open = text[i];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) continue;                    // truncated: nothing balanced starts here
    out.push(text.slice(i, end + 1));
    i = end;                                  // continue AFTER this span, so "two objects" = two
  }
  return out;
}

/**
 * @param {string} raw
 * @returns {{ok: boolean, value: any, how: 'body'|'fence'|'slice'|'none'}}
 */
export function extractJson(raw) {
  const text = (typeof raw === 'string' ? raw : '').replace(/^﻿/, '');
  if (!text.trim()) return { ok: false, value: null, how: 'none' };

  const body = tryParse(text.trim());
  if (body.ok) return { ok: true, value: body.value, how: 'body' };

  for (const block of fences(text)) {
    const p = tryParse(block.trim());
    if (p.ok) return { ok: true, value: p.value, how: 'fence' };
  }

  for (const span of balanced(text)) {
    const p = tryParse(span);
    if (p.ok) return { ok: true, value: p.value, how: 'slice' };
  }
  return { ok: false, value: null, how: 'none' };
}

// ---------------------------------------------------------------------------------------------
// validate: the subset of JSON Schema a panel actually writes (studio plan §3.4.2)
// ---------------------------------------------------------------------------------------------

/** @param {any} v @returns {string} */
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/** @param {any} v @param {string} want */
function typeOk(v, want) {
  if (want === 'integer') return typeof v === 'number' && Number.isInteger(v);
  if (want === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (want === 'array') return Array.isArray(v);
  if (want === 'object') return isObj(v);
  if (want === 'null') return v === null;
  return typeof v === want;                   // string, boolean
}

/** @param {string} path @param {string} key */
const join = (path, key) => `${path}.${key}`;

/** @param {any} value @param {any} schema @param {string} path @param {string[]} errors */
function check(value, schema, path, errors) {
  if (!isObj(schema)) return;

  if (Array.isArray(schema.enum)) {
    const hit = schema.enum.some((e) => e === value || JSON.stringify(e) === JSON.stringify(value));
    if (!hit) errors.push(`${path}: ${JSON.stringify(value)} is not one of the allowed values`);
    return;                                   // an enum fully describes what is allowed here
  }

  const types = typeof schema.type === 'string' ? [schema.type] : (Array.isArray(schema.type) ? schema.type : []);
  if (types.length && !types.some((tp) => typeOk(value, tp))) {
    errors.push(`${path}: expected ${types.join(' or ')}, got ${typeOf(value)}`);
    return;                                   // wrong type: every deeper rule would only repeat it
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path}: ${value} is below the minimum ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path}: ${value} is above the maximum ${schema.maximum}`);
  }
  if (typeof value === 'string' && typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    errors.push(`${path}: longer than ${schema.maxLength} characters`);
  }

  if (Array.isArray(value) && isObj(schema.items)) {
    for (let i = 0; i < value.length; i++) check(value[i], schema.items, `${path}[${i}]`, errors);
  }

  if (isObj(value)) {
    const props = isObj(schema.properties) ? schema.properties : null;
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${join(path, key)}: required, and missing`);
    }
    if (props) {
      for (const [key, sub] of Object.entries(props)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) check(value[key], sub, join(path, key), errors);
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.prototype.hasOwnProperty.call(props, key)) errors.push(`${join(path, key)}: not allowed by the schema`);
        }
      }
    }
  }
}

/**
 * @param {any} value @param {any} schema
 * @returns {{ok: boolean, value: any, errors: string[]}}
 */
export function validate(value, schema) {
  /** @type {string[]} */ const errors = [];
  check(value, schema, '$', errors);
  return { ok: errors.length === 0, value, errors };
}

// ---------------------------------------------------------------------------------------------
// coerce: the repairs that add no information
// ---------------------------------------------------------------------------------------------

/** @param {string} s @returns {number|null} */
function numFromString(s) {
  const trimmed = s.trim();
  if (!trimmed || !/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Repairs that cannot invent meaning: drop what the schema does not know, wrap a lone value into
 * the array the schema asked for, read "3" as 3 and "true" as true. A missing required field stays
 * missing — `validate` then says so and the ladder retries or reports.
 * @param {any} value @param {any} schema @returns {any}
 */
export function coerce(value, schema) {
  if (!isObj(schema)) return value;

  const type = typeof schema.type === 'string' ? schema.type : null;

  if (type === 'array') {
    if (value === null || value === undefined) return value;
    const list = Array.isArray(value) ? value : [value];
    return isObj(schema.items) ? list.map((v) => coerce(v, schema.items)) : list;
  }

  if (type === 'object' || (!type && isObj(schema.properties))) {
    if (!isObj(value)) return value;
    const props = isObj(schema.properties) ? schema.properties : null;
    if (!props) return value;
    const keepUnknown = schema.additionalProperties === true;
    /** @type {any} */ const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(props, key)) out[key] = coerce(v, props[key]);
      else if (keepUnknown) out[key] = v;
    }
    return out;
  }

  if ((type === 'number' || type === 'integer') && typeof value === 'string') {
    const n = numFromString(value);
    if (n === null) return value;
    if (type === 'integer' && !Number.isInteger(n)) return value;
    return n;
  }

  if (type === 'boolean' && typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }

  return value;
}

// ---------------------------------------------------------------------------------------------
// prompt mode
// ---------------------------------------------------------------------------------------------

/**
 * JSON with object keys in sorted order, so the same schema always produces the same prompt (and
 * the same cache key). Arrays keep their order — that is data, not layout.
 * @param {any} v @returns {string}
 */
export function stableStringify(v) {
  const seen = new WeakSet();
  /** @param {any} x @returns {any} */
  const norm = (x) => {
    if (!x || typeof x !== 'object') return x === undefined ? null : x;
    if (seen.has(x)) return null;
    seen.add(x);
    if (Array.isArray(x)) return x.map(norm);
    /** @type {any} */ const out = {};
    for (const key of Object.keys(x).sort()) out[key] = norm(x[key]);
    return out;
  };
  return JSON.stringify(norm(v));
}

/**
 * A 32-bit FNV-1a of a string, as 8 hex digits. Not a security hash — it keys the ask spine's
 * in-memory result cache, which stores the FULL key beside the value and compares it, so a
 * collision costs one repeated request, never a wrong answer.
 * @param {string} s @returns {string}
 */
export function hashKey(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The prompt-mode instruction: what we say when `response_format` is not available (or was
 * stripped on the way). Deterministic — same schema in, same text out, byte for byte — because it
 * is part of the request body, and therefore part of the cache key and of every scenario's
 * assertions.
 *
 * It is addressed to the MODEL, not to the reader, so it is deliberately not a t() string (§1.3):
 * translating it would change what the farm is asked, not what a person reads.
 * @param {any} schema @param {{example?: any}} [opts]
 * @returns {string}
 */
export function promptFor(schema, opts) {
  const lines = [
    'Answer with JSON only. No prose, no explanation, no code fence.',
    'The answer must match this JSON Schema exactly:',
    stableStringify(schema),
  ];
  const example = opts && opts.example !== undefined ? opts.example : undefined;
  if (example !== undefined) {
    lines.push('A valid answer looks like this:');
    lines.push(stableStringify(example));
  }
  lines.push('Every required field must be present. Do not add fields the schema does not list.');
  return lines.join('\n');
}
