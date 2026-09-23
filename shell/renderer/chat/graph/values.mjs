// @ts-check
// C1-U1 — value kinds, port acceptance and the coercion table (spec §2, plan §2.6 BG-4). PURE.
//
// A value is `{kind, data}` and nothing else: no id, no provenance, no farm address. The rules
// here are the whole of "typed but forgiving":
//   - a port declares `accepts: string[]`; `'any'` matches every kind;
//   - a `list` arriving at a port that wants `text` is NOT an error and NOT a silent join — it is
//     a FAN-OUT, reported as its own verdict so C1 can refuse it loudly and C2 can implement it;
//   - everything else that does not match is `'no'`, i.e. a visible error on the part. Nothing is
//     coerced on the way through a wire. `coerceTo()` exists for the parts that ASK for a
//     conversion (Collect joining a list, Ask reading json as text), never for the wire itself.

/** @typedef {import('../core/types.mjs').GraphValue} GraphValue */

/** Every value kind, in the order the UI lists them. */
export const KINDS = Object.freeze(['text', 'image', 'list', 'json', 'file']);

/** @param {any} kind @returns {boolean} */
export function isKind(kind) {
  return typeof kind === 'string' && KINDS.includes(kind);
}

/** The advisory facets (K2 kickoff, COMPUTER_PLAN §6.8). `format` says how a text-ish value READS;
 * `lang` tags a code fence. Neither is part of the routing alphabet: `accepts()` never reads them
 * and `isValue()` never requires them, so every value stored before K2 loads as `plain`. */
export const FORMATS = Object.freeze(['plain', 'markdown', 'code', 'svg', 'html', 'css', 'js']);

/** @param {any} format @returns {boolean} */
export function isFormat(format) {
  return typeof format === 'string' && FORMATS.includes(format);
}

/**
 * The facets of a value, cleaned — the ONE place they are validated, so `valueOf`, `normalisePart`
 * and `serialize` cannot disagree about what survives a round trip. Returns an object to SPREAD:
 * empty when there is nothing to carry, so `{kind, data}` stays exactly `{kind, data}` and every
 * existing deepEqual on a value keeps passing.
 * @param {any} v a value, or a `{format, lang}` bag @returns {{format?: string, lang?: string}}
 */
export function facetsOf(v) {
  if (!v || typeof v !== 'object') return {};
  /** @type {any} */ const out = {};
  if (isFormat(v.format) && v.format !== 'plain') out.format = v.format;
  if (typeof v.lang === 'string' && v.lang) out.lang = v.lang.trim().toLowerCase().slice(0, 24);
  // `lang` is a fact about CODE: the language of `format:'code'`, or the dialect of `format:'js'`
  // (a Write-a-p5.js-sketch answer is {format:'js', lang:'p5'} — KE-3's CODE_FACETS — and a Preview
  // in auto reads that lang to draw it; dropping it on load/export turned the sketch into text).
  // On any other format it is noise from a hand-edited file, not a fact about the value.
  if (out.lang && out.format !== 'code' && out.format !== 'js') delete out.lang;
  return out;
}

/** Build a value. An unknown kind falls back to 'text' rather than producing an unusable value.
 * `o` carries the advisory facets; an unknown or absent format means `plain` and adds no key.
 * @param {string} kind @param {any} data
 * @param {{format?: string, lang?: string}} [o] @returns {GraphValue} */
export function valueOf(kind, data, o) {
  return /** @type {any} */ ({ kind: isKind(kind) ? kind : 'text', data, ...facetsOf(o) });
}

/** @param {any} v @returns {boolean} */
export function isValue(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && isKind(v.kind) && 'data' in v;
}

/**
 * A list value. Items are themselves values; plain data is wrapped as text so a part can never
 * emit a list whose items are not values.
 *
 * `{repeats: true}` is the ONE extra thing a list may say about itself, and it is about money: it
 * marks a list whose identical items are DELIBERATE (Repeat's "four variants"), so the fan-out
 * salts them into four separate generations. Without it two identical items — two identical lines
 * out of a Split, say — are the same question, share one cached answer and cost the reader one unit
 * of the cap instead of two (§2.6 BH-5, fix pass finding 7).
 * @param {any[]} values @param {{repeats?: boolean}} [o] @returns {GraphValue}
 */
export function listOf(values, o) {
  const items = (Array.isArray(values) ? values : [])
    .map((v) => (isValue(v) ? v : valueOf('text', v == null ? '' : String(v))));
  const value = valueOf('list', items);
  if (o && o.repeats) /** @type {any} */ (value).repeats = true;
  return value;
}

/** Does this list say its identical items are deliberate? @param {any} value @returns {boolean} */
export function isRepeatList(value) {
  return !!value && typeof value === 'object' && value.kind === 'list' && value.repeats === true;
}

/** The items of a list value, always as values. @param {GraphValue|null} value @returns {GraphValue[]} */
export function itemsOf(value) {
  if (!isValue(value) || /** @type {any} */ (value).kind !== 'list') return [];
  const data = /** @type {any} */ (value).data;
  return (Array.isArray(data) ? data : [])
    .map((v) => (isValue(v) ? v : valueOf('text', v == null ? '' : String(v))));
}

/**
 * Does `value` fit this port?
 *   'ok'     — the kind is accepted (or the port accepts 'any')
 *   'fanout' — a list reached a port that wants text: run once per item (C2). C1 refuses it.
 *   'no'     — a mismatch, which is a visible error on the part.
 * @param {string[]} accept the port's `accepts`
 * @param {GraphValue|null} value
 * @returns {'ok'|'fanout'|'no'}
 */
export function accepts(accept, value) {
  if (!isValue(value)) return 'no';
  const list = Array.isArray(accept) ? accept : [];
  const kind = /** @type {any} */ (value).kind;
  if (list.includes('any') || list.includes(kind)) return 'ok';
  if (kind === 'list' && list.includes('text')) return 'fanout';
  return 'no';
}

/** @param {any} data @returns {string} */
function stringifyJson(data) {
  try {
    const s = JSON.stringify(data, null, 2);
    return s === undefined ? String(data) : s;
  } catch { return String(data); }
}

/** How every kind converts to every other kind. An ABSENT entry means "there is no honest
 * conversion", which the caller reports as an error. Read by the tests as a table (coercionTable),
 * so the rules live in exactly one place.
 * @type {Record<string, Record<string, (data: any) => GraphValue|null>>} */
const COERCE = {
  text: {
    // A list becomes its items' texts, one per line: what Collect does by hand, available to any
    // part that explicitly asks for text.
    list: (data) => valueOf('text', (Array.isArray(data) ? data : []).map((v) => {
      const item = isValue(v) ? v : valueOf('text', v == null ? '' : String(v));
      const asText = coerceTo('text', item);
      return asText ? String(/** @type {any} */ (asText).data) : '';
    }).join('\n')),
    json: (data) => valueOf('text', stringifyJson(data)),
    file: (data) => valueOf('text', String((data && data.path) || '')),
    // `image` is deliberately ABSENT: an image is not text, and describing one is the Look part's
    // job (C2). An absent entry is the table's way of saying "there is no honest conversion".
  },
  json: {
    text: (data) => {
      try { return valueOf('json', JSON.parse(String(data))); } catch { return null; }
    },
    list: (data) => valueOf('json', (Array.isArray(data) ? data : []).map((v) => {
      const item = isValue(v) ? v : valueOf('text', v == null ? '' : String(v));
      const asJson = coerceTo('json', item);
      return asJson ? /** @type {any} */ (asJson).data : /** @type {any} */ (item).data;
    })),
  },
  // Wrapping a single value in a one-item list is always honest, so Collect works on one input.
  list: {
    text: (data) => listOf([valueOf('text', data)]),
    json: (data) => (Array.isArray(data)
      ? listOf(data.map((d) => valueOf('json', d)))
      : listOf([valueOf('json', data)])),
    image: (data) => listOf([valueOf('image', data)]),
    file: (data) => listOf([valueOf('file', data)]),
  },
  // `image` and `file` have no row at all: nothing becomes an image or a file by conversion —
  // they are produced, not derived.
};

/** Convert a value to `kind`, or null when there is no honest conversion.
 * @param {string} kind @param {GraphValue|null} value @returns {GraphValue|null} */
export function coerceTo(kind, value) {
  if (!isValue(value) || !isKind(kind)) return null;
  const v = /** @type {any} */ (value);
  if (v.kind === kind) return v;
  const fn = (COERCE[kind] || {})[v.kind];
  return fn ? fn(v.data) : null;
}

/** The coercion table as data: `{[to]: {[from]: boolean}}`. The tests walk it; the UI may explain
 * it. @returns {Record<string, Record<string, boolean>>} */
export function coercionTable() {
  /** @type {Record<string, Record<string, boolean>>} */ const out = {};
  for (const to of KINDS) {
    out[to] = {};
    for (const from of KINDS) {
      out[to][from] = from === to || typeof (COERCE[to] || {})[from] === 'function';
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The sandbox boundary (C3 kickoff, plan §2.6 BJ). A GraphValue is OUR envelope; the guest that
// runs a reader's JavaScript must never see it — a `Code` part is `(inputs) => value`, plain data
// in and plain data out, or every sketch in the office starts with `.data.data`.
//
// The mapping is deliberately TOTAL in one direction and STRICT in the other: everything we hold
// has an honest plain form, but a returned `undefined`/`null` is a FAILURE (BG-5: "no value" is a
// failure, not a state) and a function or a cycle never reaches us at all — the guest JSON-encodes
// before it posts, so those die guest-side with a sentence the part shows.
// ---------------------------------------------------------------------------------------------

/** A GraphValue as the plain JS the guest sees. @param {GraphValue|null} value @returns {any} */
export function toPlain(value) {
  if (!isValue(value)) return null;
  const v = /** @type {any} */ (value);
  if (v.kind === 'text') return String(v.data == null ? '' : v.data);
  if (v.kind === 'json') return v.data;
  if (v.kind === 'list') return itemsOf(v).map(toPlain);
  if (v.kind === 'image') return { dataUrl: String((v.data && v.data.dataUrl) || ''), name: String((v.data && v.data.name) || '') };
  if (v.kind === 'file') return { path: String((v.data && v.data.path) || '') };
  return null;
}

/**
 * What came back from the guest, as a GraphValue. The rule, frozen so `Code` in one graph means
 * what it means in another:
 *   string                    -> text
 *   number | boolean          -> json   (a number is data, not prose: it wires into Code again)
 *   array                     -> list   (each item mapped by the same rule, so it can fan out)
 *   plain object              -> json
 *   null | undefined | NaN    -> null   (the caller throws; the part fails visibly)
 * @param {any} plain @returns {GraphValue|null}
 */
export function fromPlain(plain) {
  if (plain === null || plain === undefined) return null;
  if (typeof plain === 'string') return { kind: 'text', data: plain };
  if (typeof plain === 'number') return Number.isFinite(plain) ? { kind: 'json', data: plain } : null;
  if (typeof plain === 'boolean') return { kind: 'json', data: plain };
  if (Array.isArray(plain)) {
    const items = plain.map(fromPlain).filter((x) => x !== null);
    return { kind: 'list', data: items };
  }
  if (typeof plain === 'object') return { kind: 'json', data: plain };
  return null;
}

/** One line of preview for the canvas. Never throws, never returns a huge string.
 * @param {GraphValue|null} value @param {number} [max] @returns {string} */
export function preview(value, max = 120) {
  if (!isValue(value)) return '';
  const v = /** @type {any} */ (value);
  let s = '';
  if (v.kind === 'text') s = String(v.data == null ? '' : v.data);
  else if (v.kind === 'list') s = itemsOf(v).map((item) => preview(item, 40)).join(' · ');
  else if (v.kind === 'image') s = String((v.data && (v.data.name || v.data.id)) || 'image');
  else if (v.kind === 'file') s = String((v.data && v.data.path) || 'file');
  else s = stringifyJson(v.data);
  s = s.replace(/\s+/g, ' ').trim();
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 120;
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

/** Which REVISION of a value a cheap signature is looking at.
 *
 * A value object is made once, by whoever produced it, and never edited: a part that re-runs writes
 * a NEW one. So object identity answers "did this move?" exactly, for every kind, in constant time
 * — where the length of `data` (what the Instruction's strip used to fingerprint, fix pass, finding
 * 4) answers it only for text, and answers it wrong for a `list` or a `json` that changed without
 * changing size. Numbers are handed out on first sight and remembered weakly, so nothing here keeps
 * a value alive.
 * @param {any} value @returns {number} 0 for anything that is not an object */
const STAMPS = new WeakMap();
let stamped = 0;
export function valueStamp(value) {
  if (!value || typeof value !== 'object') return 0;
  const seen = STAMPS.get(value);
  if (seen) return seen;
  stamped += 1;
  STAMPS.set(value, stamped);
  return stamped;
}
