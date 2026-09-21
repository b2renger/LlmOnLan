// @ts-check
// Ids and fingerprints. PURE (no window/document/storage access).
//
// Contract (plan §3.2, frozen at P0 kickoff):
//   newId()   → 17 chars: 9-char zero-padded base36 millisecond timestamp + 8 random base36 chars.
//               Lexicographic order == creation order at millisecond resolution (ties: random).
//               Optional `{now, rng}` injects the clock/RNG (tests, seeded harness runs).
//   hash(str) → FNV-1a 32-bit over the string's UTF-16 code units (one FNV step per code unit),
//               as 8 lowercase hex chars. Used for fingerprints and v1 migration hashes.
//               NOT cryptographic. Stable forever: v1 migration hashes are persisted in kv.

const TS_LEN = 9;
const RAND_LEN = 8;

/**
 * @param {{now?: number | (() => number), rng?: () => number}} [opts]
 * @returns {string}
 */
export function newId(opts = {}) {
  const t = typeof opts.now === 'function' ? opts.now() : (typeof opts.now === 'number' ? opts.now : Date.now());
  const r = typeof opts.rng === 'function' ? opts.rng : Math.random;
  const ts = Math.max(0, Math.floor(t)).toString(36).padStart(TS_LEN, '0').slice(-TS_LEN);
  let rand = '';
  for (let i = 0; i < RAND_LEN; i++) rand += Math.floor(r() * 36).toString(36).slice(-1);
  return ts + rand;
}

/**
 * FNV-1a 32-bit over UTF-16 code units → 8-char lowercase hex.
 * @param {string} str
 * @returns {string}
 */
export function hash(str) {
  const s = String(str);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
