// @ts-check
// C2-U1 — fan-out, as pure data (spec §2 "Fan-out", plan §2.6 BH-2). PURE: no DOM, no clock, no
// farm. KICKOFF STUB: working code, replaced wholesale by C2-U1 (BH-9).
//
// One rule, and everything else here serves it: when a `list` arrives at a port that accepts
// `text`, the part runs ONCE PER ITEM and its output is a `list`. This module answers three
// questions and nothing else, so the runner stays a loop and the parts stay ignorant:
//
//   planFan(spec, inputs)   is this run one execution or n? which port fans, and what does
//                           execution i receive? (every other input BROADCASTS unchanged)
//   joinResults(results)    what is the part's value afterwards? (the items that succeeded, in
//                           order — a failed item is not a hole in the list, it is an entry in…)
//   fanoutRecord(results)   …the per-item record the canvas paints as `7/40` plus the failures.
//
// TWO ports fanning at once is REFUSED (`{kind:'refuse', reason:'many'}`), never zipped: pairing
// two lists by index is a guess, and a guess that silently drops the tail of the longer one is
// exactly the kind of quiet loss §1.2 bans. Say so, and let the graph say which pairing it meant
// with a Collect or a Code part.

import { accepts, itemsOf, listOf, isValue, isRepeatList } from './values.mjs';

/** @typedef {import('../core/types.mjs').GraphValue} GraphValue */
/** @typedef {import('../core/types.mjs').FanPlan} FanPlan */
/** @typedef {import('../core/types.mjs').PartSpec} PartSpec */

/** Stable enough to tell two item values apart; never throws. @param {any} v @returns {string} */
function keyOf(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

/**
 * What one part's gathered inputs mean for one run.
 * @param {PartSpec} spec
 * @param {Record<string, GraphValue[]>} inputs  keyed by port name, in wire order
 * @returns {FanPlan}
 */
export function planFan(spec, inputs) {
  /** @type {{port: string, at: number, items: GraphValue[]}[]} */ const fans = [];
  for (const port of (spec && spec.inputs) || []) {
    const values = (inputs && inputs[port.name]) || [];
    for (let at = 0; at < values.length; at++) {
      if (accepts(port.accepts, values[at]) === 'fanout') {
        fans.push({ port: port.name, at, items: itemsOf(values[at]), repeats: isRepeatList(values[at]) });
      }
    }
  }
  if (!fans.length) return /** @type {any} */ ({ kind: 'single' });
  if (fans.length > 1) return /** @type {any} */ ({ kind: 'refuse', reason: 'many' });

  const fan = fans[0];
  const items = fan.items;
  // WHO repeated? (fix pass, finding 7.) Two identical items mean opposite things depending on the
  // part that made the list: `Repeat`'s four copies are four DELIBERATE generations, while two
  // identical lines out of a `Split` or a `Filter` are the same question asked twice and deserve
  // one cached answer, one generation and ONE unit off the reader's cap. Only the producer knows,
  // so only the producer says so — `listOf(items, {repeats: true})`, which Repeat alone passes.
  const seen = new Map();
  /** @type {(number|null)[]} */ const salts = fan.repeats
    ? items.map((item, i) => {
      const k = keyOf(item);
      if (seen.has(k)) return i;        // an identical item: the caller MEANS a second generation
      seen.set(k, i);
      return null;
    })
    : items.map(() => null);

  return /** @type {any} */ ({
    kind: 'fan',
    port: fan.port,
    n: items.length,
    /** @param {number} i */
    inputsFor(i) {
      /** @type {Record<string, GraphValue[]>} */ const out = {};
      for (const [name, values] of Object.entries(inputs || {})) {
        out[name] = name === fan.port
          ? values.map((v, at) => (at === fan.at ? items[i] : v))
          : values.slice();
      }
      return out;
    },
    /** @param {number} i */
    saltFor(i) { return salts[i] === undefined ? null : salts[i]; },
  });
}

/** @typedef {{ok: true, value: GraphValue}|{ok: false, message: string}} ItemResult */

/** The part's value after a fan-out: the items that SUCCEEDED, in order. An all-failed fan has no
 * value at all — the runner turns that into one error on the part.
 * @param {ItemResult[]} results @returns {GraphValue} */
export function joinResults(results) {
  const ok = (Array.isArray(results) ? results : [])
    .filter((r) => r && /** @type {any} */ (r).ok && isValue(/** @type {any} */ (r).value))
    .map((r) => /** @type {any} */ (r).value);
  return listOf(ok);
}

/** How many per-item failures the record KEEPS. The canvas paints five; the rest are kept for the
 * report and the inspector. Past this the record counts them in `hidden` instead of storing them:
 * this record is written to the graph row once per item, so an unbounded array would make a
 * 2000-item fan that fails write 2000 messages into IndexedDB, over and over (fix pass, finding 4). */
export const MAX_ITEM_ERRORS = 50;

/** The per-item record the canvas paints. @param {ItemResult[]} results @param {number} [n]
 * @returns {{n: number, done: number, ok: number, failed: number, hidden: number, errors: {i: number, message: string}[]}} */
export function fanoutRecord(results, n) {
  const list = Array.isArray(results) ? results : [];
  /** @type {{i: number, message: string}[]} */ const errors = [];
  let good = 0;
  let failed = 0;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r && /** @type {any} */ (r).ok) { good++; continue; }
    failed++;
    if (errors.length < MAX_ITEM_ERRORS) errors.push({ i, message: String((r && /** @type {any} */ (r).message) || '') });
  }
  return {
    n: Number.isFinite(n) ? Number(n) : list.length,
    done: list.length,
    ok: good,
    failed,
    hidden: failed - errors.length,
    errors,
  };
}
