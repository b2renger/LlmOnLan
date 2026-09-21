// @ts-check
// LOL Chat environment: test flags, the (offsettable) clock and the (seedable) RNG.
//
// NOT a pure module: it reads `window.__lolChatTestFlags` once at import time. Pure modules must
// never import this file; they take `now`/`rng` as injected parameters instead.
//
// Contract (plan §3.2, frozen at P0 kickoff):
//   flags  — window.__lolChatTestFlags || {} (frozen copy). Known keys:
//            allowFakes, skipModules, forceMemoryStore, idbOpenDelayMs, forcePageVisible,
//            seatJitterMs, seatGiveUpMs, notifyAfterMs, downloadMode, rngSeed, clockOffsetMs.
//            Unknown keys are kept (harness scenarios may pass their own).
//   now()  — Date.now() + (flags.clockOffsetMs || 0)
//   rng()  — Math.random(), or mulberry32(flags.rngSeed) when rngSeed is a finite number.
//
// `flags` is a FROZEN SNAPSHOT taken at import time. The harness may mutate the LIVE object
// (`window.__lolChatTestFlags`) after boot — today only `forcePageVisible`, via h.setPageVisible().
// Any rule that must see such a change re-reads `window.__lolChatTestFlags` at event time (main.mjs
// does this in its visibilitychange handler); everything else reads the snapshot.

/** @typedef {{
 *   allowFakes?: boolean, skipModules?: string[], forceMemoryStore?: boolean, idbOpenDelayMs?: number,
 *   forcePageVisible?: boolean, seatJitterMs?: number, seatGiveUpMs?: number, notifyAfterMs?: number,
 *   downloadMode?: string, rngSeed?: number, clockOffsetMs?: number, [k: string]: any }} Flags */

/** @returns {Flags} */
function readFlags() {
  try {
    const w = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis);
    const raw = w && w.__lolChatTestFlags;
    return raw && typeof raw === 'object' ? { ...raw } : {};
  } catch {
    return {};
  }
}

/** @type {Readonly<Flags>} */
export const flags = Object.freeze(readFlags());

/** Wall clock used by every time-based rule (seat wait, "farm silent", migration timestamps). */
export function now() {
  return Date.now() + (Number(flags.clockOffsetMs) || 0);
}

/**
 * mulberry32: a tiny deterministic PRNG. Exported so tests (and pure modules via injection) can use
 * the same generator as `rng()` with an explicit seed.
 * @param {number} seed
 * @returns {() => number} a function returning floats in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seeded = Number.isFinite(flags.rngSeed) ? mulberry32(/** @type {number} */ (flags.rngSeed)) : null;

/** Math.random(), or the seeded mulberry32 stream when `flags.rngSeed` is set. */
export function rng() {
  return seeded ? seeded() : Math.random();
}
