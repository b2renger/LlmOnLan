// @ts-check
// C1-U1 — the `.lolgraph.json` format: export, import, schema validation (spec §5, plan §2.6 BG-4).
// PURE.
//
// The sharing story on a stateless farm is a FILE: parts, wires, settings, optionally the cached
// values. What a graph file must never carry (spec §5) and what this module therefore never
// writes: a farm address, an API key, a thread id, a client id — anything about who ran it or
// where. `toJson` builds the payload field by field rather than spreading the doc, so a field
// added to GraphDoc by a later phase cannot leak into an exported file by accident.
//
// `fromJson` mints NEW ids for every part and wire: importing the same file twice into one canvas
// must not collide, and an id from someone else's machine means nothing here.

import { normaliseDoc, wireLabel } from './model.mjs';
import { isValue, facetsOf } from './values.mjs';

/** @typedef {import('../core/types.mjs').GraphDoc} GraphDoc */

export const FORMAT = 'lolgraph';
// K2 kickoff (COMPUTER_PLAN §11): v2 carries `wire.label` (§5.1) and a value's advisory
// `format`/`lang` facets (§6.8). A v1 file still opens — every v1 field means in v2 exactly what
// it meant in v1, an absent label is an unlabelled arrow and an absent format is `plain`. The
// `version > FORMAT_VERSION` REFUSAL stays (§7.6): a file from a newer build is refused whole,
// with `unsupported-version`, and nothing is imported. Importing what we happen to understand and
// dropping the rest is the quiet loss §1.3 rule 4 bans — the sentence the reader gets is §8.4's
// "This graph was made with a newer version of the Computer."
export const FORMAT_VERSION = 2;
export const FILE_SUFFIX = '.lolgraph.json';

/** Fields copied out of a part on export. Everything else (state, error, stats, runtime junk) is
 * about one machine's last run and is not part of the program. */
const PART_FIELDS = ['id', 'type', 'x', 'y', 'w', 'h'];

/** Document-level settings that belong in a shared file. EMPTY on purpose, and an allow-list
 * rather than a spread: `doc.settings` is an open bag nothing writes yet, so a field a later
 * phase puts there (a farm name, a model id, a path on someone's disk) would otherwise ride out
 * in every exported graph without anyone deciding it should. Adding one here is the decision. */
const DOC_SETTING_FIELDS = /** @type {string[]} */ ([]);

/** Settings a part DECLARES but must not share. `from-thread.messageId` names a message in the
 * sender's own history: it resolves to nothing on the importing machine, and it is a fact about
 * that person's conversation. */
const NEVER_EXPORTED = /** @type {Record<string, string[]>} */ ({ 'from-thread': ['messageId'] });

/** A part's settings, key by key from what its SPEC declares (fix pass, finding: `{...p.settings}`
 * was an open bag under a header promising field-by-field). Without a spec table — a caller that
 * has no part registry, e.g. a round-trip test — the whole bag is copied, which is why the real
 * export path in graph/canvas.mjs always passes `specs`.
 * @param {any} part @param {Map<string, any>|null} specs @returns {object} */
function exportSettings(part, specs) {
  const bag = part && part.settings && typeof part.settings === 'object' ? part.settings : {};
  const spec = specs ? specs.get(part && part.type) : null;
  if (!spec || typeof spec.defaults !== 'function') return { ...bag };
  const never = NEVER_EXPORTED[String(part && part.type)] || [];
  /** @type {any} */ const out = {};
  for (const key of Object.keys(spec.defaults() || {})) {
    if (never.indexOf(key) >= 0) continue;
    if (Object.prototype.hasOwnProperty.call(bag, key)) out[key] = /** @type {any} */ (bag)[key];
  }
  return out;
}

/** The biggest graph file we will adopt. The sharing story means this file came from someone
 * else's machine BY DESIGN, and `values:true` keeps every cached image data URL verbatim — a few
 * hundred megabytes of them used to be read, parsed and written straight into IndexedDB, leaving
 * the thread's graph unloadable. Refused at the door instead. */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

/** The biggest cached value a part may bring in with it — the same ceiling a Render tile has, so
 * an imported picture can be no larger than one this machine would have made. Over it, the value
 * is dropped (reported as `part:value-too-big`) and the part arrives stale, ready to re-run. */
export const MAX_VALUE_BYTES = 1024 * 1024;

/** Is this object shaped like a graph file at all? Cheap enough for a drop handler.
 * @param {any} o @returns {boolean} */
export function isGraphFile(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o) && Number.isInteger(o[FORMAT]);
}

/**
 * The export payload. `values:true` includes each part's cached value (spec §5: "cached values
 * optional"); images are whatever the value already holds — C3 decides how they are inlined.
 * `specs` (the part registry) makes the settings copy an ALLOW-LIST rather than a spread.
 * @param {GraphDoc} doc
 * @param {{values?: boolean, title?: string, specs?: Map<string, any>}} [o] @returns {object}
 */
export function toJson(doc, o = {}) {
  const withValues = o.values === true;
  const specs = o.specs instanceof Map ? o.specs : null;
  const d = doc && typeof doc === 'object' ? doc : /** @type {any} */ ({});
  /** @type {any} */ const out = {
    [FORMAT]: FORMAT_VERSION,
    title: typeof o.title === 'string' ? o.title : (d.title || ''),
    view: d.view ? { x: d.view.x, y: d.view.y, zoom: d.view.zoom } : undefined,
    settings: pickDocSettings(d.settings),
    parts: (Array.isArray(d.parts) ? d.parts : []).map((p) => {
      /** @type {any} */ const part = {};
      for (const f of PART_FIELDS) part[f] = /** @type {any} */ (p)[f];
      part.settings = exportSettings(p, specs);
      if (withValues && isValue(p.value)) part.value = { kind: p.value.kind, data: p.value.data, ...facetsOf(p.value) };
      return part;
    }),
    // K2-U1 (§5.1, §7.6): v2 carries `wire.label` — but only when there IS one. An unlabelled
    // arrow writes exactly the three v1 keys, so a graph with no labels round-trips to the same
    // bytes it did in v1 and a v1 reader loses nothing it ever had.
    wires: (Array.isArray(d.wires) ? d.wires : []).map((w) => {
      const label = wireLabel(/** @type {any} */ (w).label);
      /** @type {any} */ const out = { from: w.from, to: w.to, port: w.port };
      if (label) out.label = label;
      return out;
    }),
  };
  if (!out.view) delete out.view;
  return out;
}

/** @param {any} settings @returns {object} */
function pickDocSettings(settings) {
  const bag = settings && typeof settings === 'object' ? settings : {};
  /** @type {any} */ const out = {};
  for (const key of DOC_SETTING_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(bag, key)) out[key] = /** @type {any} */ (bag)[key];
  }
  return out;
}

/** The whole file as text, which is what the export button writes.
 * @param {GraphDoc} doc
 * @param {{values?: boolean, title?: string, specs?: Map<string, any>}} [o] @returns {string} */
export function toText(doc, o = {}) {
  return `${JSON.stringify(toJson(doc, o), null, 2)}\n`;
}

/**
 * Validate and adopt a graph file. Never throws.
 *   ok:false  — `errors` says why: 'not-an-object' · 'not-a-graph' · 'unsupported-version'
 *   ok:true   — `doc` is a fresh, runnable document; `errors` carries whatever normaliseDoc
 *               dropped ('part:unknown-type', 'wire:cycle', …), so an import is never silent.
 * @param {any} obj
 * @param {{specs: Map<string, any>, newId: () => string, now?: () => number,
 *   id?: string, threadId?: string|null, values?: boolean}} o
 * @returns {{ok: boolean, doc: GraphDoc|null, errors: string[]}}
 */
export function fromJson(obj, o) {
  const specs = o && o.specs instanceof Map ? o.specs : new Map();
  const newId = o && typeof o.newId === 'function' ? o.newId : () => '';
  const now = ((o && o.now) || Date.now)();
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, doc: null, errors: ['not-an-object'] };
  }
  if (!(FORMAT in obj)) return { ok: false, doc: null, errors: ['not-a-graph'] };
  const version = /** @type {any} */ (obj)[FORMAT];
  if (!Number.isInteger(version) || version < 1) return { ok: false, doc: null, errors: ['not-a-graph'] };
  if (version > FORMAT_VERSION) return { ok: false, doc: null, errors: ['unsupported-version'] };

  /** @type {string[]} */ const errors = [];
  /** @type {Map<string, string>} */ const ids = new Map();
  const rawParts = Array.isArray(/** @type {any} */ (obj).parts) ? /** @type {any} */ (obj).parts : [];
  const parts = rawParts.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const fresh = newId();
    if (typeof p.id === 'string' && p.id && !ids.has(p.id)) ids.set(p.id, fresh);
    /** @type {any} */ const next = { ...p, id: fresh };
    if (o && o.values === false) delete next.value;
    else if (next.value !== undefined && valueBytes(next.value) > MAX_VALUE_BYTES) {
      delete next.value;
      errors.push('part:value-too-big');
    }
    delete next.state;
    delete next.error;
    delete next.stats;
    delete next.fanout;                 // a run's per-item record is not part of the PROGRAM, and an
                                        // imported one could be arbitrarily large (fix pass, finding 6)
    if (next.value !== undefined) next.state = 'stale';   // a cached value survives, but it is not
    return next;                                          // proof this machine ran this graph
  });
  const rawWires = Array.isArray(/** @type {any} */ (obj).wires) ? /** @type {any} */ (obj).wires : [];
  const wires = [];
  for (const w of rawWires) {
    if (!w || typeof w !== 'object') { errors.push('wire:malformed'); continue; }
    const from = ids.get(w.from);
    const to = ids.get(w.to);
    if (!from || !to) { errors.push('wire:unknown-part'); continue; }
    wires.push({ id: newId(), from, to, port: w.port, label: wireLabel(w.label) });
  }

  const { doc, dropped } = normaliseDoc({
    id: (o && o.id) || newId(),
    threadId: o && o.threadId !== undefined ? o.threadId : null,
    title: typeof /** @type {any} */ (obj).title === 'string' ? /** @type {any} */ (obj).title : '',
    createdAt: now,
    updatedAt: now,
    rev: 1,
    parts,
    wires,
    settings: /** @type {any} */ (obj).settings,
    view: /** @type {any} */ (obj).view,
  }, { specs, now: () => now });

  return { ok: true, doc, errors: [...errors, ...dropped] };
}

/** Parse a file's TEXT. A JSON syntax error is reported as 'not-json', never thrown at the drop
 * handler. @param {string} text
 * @param {{specs: Map<string, any>, newId: () => string, now?: () => number, id?: string,
 *   threadId?: string|null, values?: boolean}} o
 * @returns {{ok: boolean, doc: GraphDoc|null, errors: string[]}} */
export function fromText(text, o) {
  const raw = String(text);
  if (raw.length > MAX_IMPORT_BYTES) return { ok: false, doc: null, errors: ['too-big'] };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, doc: null, errors: ['not-json'] }; }
  return fromJson(parsed, o);
}

/** How big one cached value is, without throwing on a cycle. @param {any} v @returns {number} */
function valueBytes(v) {
  try { return JSON.stringify(v).length; } catch { return MAX_VALUE_BYTES + 1; }
}
