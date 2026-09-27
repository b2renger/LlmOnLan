// @ts-check
// User-facing strings. PURE.
//
// Contract (plan §1.3 / §3.2, frozen at P0 kickoff):
//   registerStrings(ns, table)
//     - ns: /^[a-z][a-zA-Z0-9-]*$/ (one namespace per unit area: 'core', 'net', 'sidebar', 'stretch-a', …).
//     - table: a FLAT object { key: value }. Keys match /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/, so a
//       full key is '<ns>.<key>' (e.g. 'sidebar.group.today' = ns 'sidebar', key 'group.today').
//     - value: a string with {name} placeholders, OR a plural pair {one: string, other: string}
//       chosen with vars.count === 1 → one, else other.
//     - registering the same ns again merges (later keys win).
//   t(key, vars)
//     - key MUST be a string literal at the call site (lint rule §2.4-5), or LABEL[x] into a
//       same-file literal map.
//     - {name} is replaced by String(vars[name]) when vars has it; otherwise left as is.
//     - missing key → returns the key itself and records it (see missingKeys()).
//   missingKeys() → string[] of keys t() was asked for that were not registered (sorted, unique).
//   hasKey(key), allKeys() → helpers for tests and the lint.

/** @typedef {string | {one: string, other: string}} StringValue */

/** @type {Map<string, StringValue>} */
const table = new Map();
/** @type {Set<string>} */
const missing = new Set();

const NS_RE = /^[a-z][a-zA-Z0-9-]*$/;
const KEY_RE = /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/;

/**
 * @param {string} ns
 * @param {Record<string, StringValue>} strings
 */
export function registerStrings(ns, strings) {
  if (!NS_RE.test(ns)) throw new Error(`registerStrings: bad namespace "${ns}"`);
  if (!strings || typeof strings !== 'object') throw new TypeError(`registerStrings(${ns}): table must be an object`);
  for (const [k, v] of Object.entries(strings)) {
    if (!KEY_RE.test(k)) throw new Error(`registerStrings(${ns}): bad key "${k}"`);
    const ok = typeof v === 'string' || (v && typeof v === 'object' && typeof v.one === 'string' && typeof v.other === 'string');
    if (!ok) throw new TypeError(`registerStrings(${ns}): value of "${k}" must be a string or {one, other}`);
    const full = `${ns}.${k}`;
    table.set(full, v);
    missing.delete(full);
  }
}

/**
 * @param {string} key
 * @param {Record<string, any>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  const v = table.get(key);
  if (v === undefined) {
    missing.add(key);
    return key;
  }
  const s = typeof v === 'string' ? v : (vars && Number(vars.count) === 1 ? v.one : v.other);
  if (!vars) return s;
  return s.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m));
}

/** @returns {string[]} */
export function missingKeys() {
  return [...missing].sort();
}

/** @param {string} key */
export function hasKey(key) {
  return table.has(key);
}

/** @returns {string[]} */
export function allKeys() {
  return [...table.keys()].sort();
}
