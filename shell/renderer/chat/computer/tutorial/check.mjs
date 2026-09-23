// @ts-check
// K5-U3 (COMPUTER_PLAN §10.1 mechanism 3; addendum KE-5): "the app knows you did it". PURE (in
// PURE_MODULES): every checkpoint is a predicate over (doc, lastRunReport, the lesson's shipped doc)
// — no polling, no heuristics, no model call — so every lesson's steps are unit-tested in Node.
//
// K5-U3. The vocabulary (the eight matcher keys and their fields, core/types.mjs `Check`) and the
// exports' signatures are FROZEN (addendum KE-5): the lessons are written against them, and
// chat-lint rule 15 validates every lesson with `refsOf` + `CHECK_KINDS`. A new matcher is a
// contract request.
//
// Two rules this module holds so the rail does not have to:
//   - a check is an object with EXACTLY ONE key. Two keys is an authoring mistake rule 15 refuses;
//     here it is simply never satisfied, rather than half-evaluated by whichever key came first.
//   - stored progress is never trusted blindly: `step` is clamped to the lesson's real length, so a
//     lesson that loses a step in a later build resumes on a real step instead of past the end.

import { presetOf } from '../../graph/parts/creative.mjs';
import { labelKey } from '../../graph/bind.mjs';

/** @typedef {import('../../core/types.mjs').Check} Check */
/** @typedef {import('../../core/types.mjs').Lesson} Lesson */
/** @typedef {import('../../core/types.mjs').RunReport} RunReport */

/** The matcher keys, frozen. A check is an object with EXACTLY ONE of these keys. */
export const CHECK_KINDS = Object.freeze(['has', 'wire', 'ran', 'report', 'edited', 'all', 'any', 'manual']);

/** The fields each matcher may carry — chat-lint rule 15 refuses any other. Frozen. */
export const CHECK_FIELDS = Object.freeze({
  has: Object.freeze(['id', 'type', 'preset', 'setting', 'nonEmpty', 'equals', 'count']),
  wire: Object.freeze(['from', 'to', 'fromType', 'toType', 'fromPreset', 'toPreset', 'port', 'label', 'count']),
  ran: Object.freeze(['partId', 'type', 'preset', 'state', 'demoOk']),
  report: Object.freeze(['generations', 'ran', 'errors', 'stopped']),
  edited: Object.freeze(['partId', 'setting']),
});

const CMP = /^\s*(>=|<=|==|>|<)?\s*(\d+)\s*$/;

/** Does `n` satisfy `want` — a number (==) or '>=3' '<=2' '>1' '<4' '==0'? A malformed `want` is
 * never satisfied (and rule 15 refuses it before it ships).
 * @param {number} n @param {number|string|undefined} want @param {string} [dflt] */
export function cmp(n, want, dflt = '>=1') {
  const w = want === undefined ? dflt : want;
  if (typeof w === 'number') return n === w;
  const m = CMP.exec(String(w));
  if (!m) return false;
  const k = Number(m[2]);
  switch (m[1] || '==') {
    case '>=': return n >= k;
    case '<=': return n <= k;
    case '>': return n > k;
    case '<': return n < k;
    default: return n === k;
  }
}

/** @param {any} part @param {any} m */
function partMatches(part, m) {
  if (!part) return false;
  if (m.id !== undefined && part.id !== m.id) return false;
  if (m.partId !== undefined && part.id !== m.partId) return false;
  if (m.type !== undefined && part.type !== m.type) return false;
  if (m.preset !== undefined && presetOf(part) !== m.preset) return false;
  return true;
}

const text = (/** @type {any} */ v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * Is this check satisfied now? `manual` is never satisfied here — only its button ticks it.
 * @param {Check|any} check
 * @param {{doc: any, report?: RunReport|null, base?: any}} ctx  `base` is the lesson's SHIPPED doc
 * @returns {boolean}
 */
export function evaluate(check, ctx) {
  if (!check || typeof check !== 'object' || Array.isArray(check)) return false;
  if (Object.keys(check).length !== 1) return false;
  const doc = ctx && ctx.doc ? ctx.doc : { parts: [], wires: [] };
  const parts = Array.isArray(doc.parts) ? doc.parts : [];
  const wires = Array.isArray(doc.wires) ? doc.wires : [];
  const byId = new Map(parts.map((/** @type {any} */ p) => [p.id, p]));

  if ('all' in check) return Array.isArray(check.all) && check.all.length > 0 && check.all.every((/** @type {any} */ c) => evaluate(c, ctx));
  if ('any' in check) return Array.isArray(check.any) && check.any.some((/** @type {any} */ c) => evaluate(c, ctx));
  if ('manual' in check) return false;

  if ('has' in check) {
    const m = check.has || {};
    const hits = parts.filter((/** @type {any} */ p) => {
      if (!partMatches(p, m)) return false;
      if (m.setting === undefined) return true;
      const v = (p.settings || {})[m.setting];
      if (m.nonEmpty && !text(v).trim()) return false;
      if (m.equals !== undefined && v !== m.equals) return false;
      return true;
    });
    return cmp(hits.length, m.count);
  }

  if ('wire' in check) {
    const m = check.wire || {};
    const hits = wires.filter((/** @type {any} */ w) => {
      const from = byId.get(w.from);
      const to = byId.get(w.to);
      if (!from || !to) return false;
      if (m.from !== undefined && w.from !== m.from) return false;
      if (m.to !== undefined && w.to !== m.to) return false;
      if (m.fromType !== undefined && from.type !== m.fromType) return false;
      if (m.toType !== undefined && to.type !== m.toType) return false;
      if (m.fromPreset !== undefined && presetOf(from) !== m.fromPreset) return false;
      if (m.toPreset !== undefined && presetOf(to) !== m.toPreset) return false;
      if (m.port !== undefined && w.port !== m.port) return false;
      if (m.label !== undefined) {
        const label = String(w.label || '').trim();
        if (m.label === 'nonEmpty') { if (!label) return false; }
        else if (m.label === 'blank') { if (label) return false; }
        else if (labelKey(label) !== labelKey(String(m.label))) return false;
      }
      return true;
    });
    return cmp(hits.length, m.count);
  }

  if ('ran' in check) {
    const m = check.ran || {};
    const want = m.state || 'done';
    return parts.some((/** @type {any} */ p) => partMatches(p, m)
      && p.state === want
      && (m.demoOk === false ? p.demo !== true : true));
  }

  if ('report' in check) {
    const r = /** @type {any} */ (ctx && ctx.report);
    if (!r) return false;
    const m = check.report || {};
    if (m.generations !== undefined && !cmp(Number(r.generations) || 0, m.generations)) return false;
    if (m.ran !== undefined && !cmp(Number(r.ran) || 0, m.ran)) return false;
    if (m.errors !== undefined && !cmp(Array.isArray(r.errors) ? r.errors.length : 0, m.errors)) return false;
    if (m.stopped === 'capped' && !r.capped) return false;
    if (m.stopped === 'cancelled' && !r.cancelled) return false;
    if (m.stopped === 'yielded' && !r.yielded) return false;
    return true;
  }

  if ('edited' in check) {
    const m = check.edited || {};
    const now = byId.get(m.partId);
    const baseParts = ctx && ctx.base && Array.isArray(ctx.base.parts) ? ctx.base.parts : [];
    const was = baseParts.find((/** @type {any} */ p) => p && p.id === m.partId);
    if (!now || !was) return false;
    return text((now.settings || {})[m.setting]) !== text((was.settings || {})[m.setting]);
  }

  return false;
}

/** A lesson's progress before anything happened. */
export function freshProgress() {
  return { step: 0, ticks: /** @type {string[]} */ ([]), forkedDocId: /** @type {string|null} */ (null), doneAt: /** @type {number|null} */ (null), demo: /** @type {string[]} */ ([]) };
}

/** A clean copy of stored progress: every field present, arrays copied, `step` clamped.
 * @param {Lesson} lesson @param {any} prog */
function settle(lesson, prog) {
  const src = prog && typeof prog === 'object' ? prog : {};
  const n = Array.isArray(lesson && lesson.steps) ? lesson.steps.length : 0;
  const p = { ...freshProgress(), ...src };
  p.ticks = Array.isArray(src.ticks) ? src.ticks.filter((/** @type {any} */ x) => typeof x === 'string') : [];
  p.demo = Array.isArray(src.demo) ? src.demo.filter((/** @type {any} */ x) => typeof x === 'string') : [];
  const step = Math.floor(Number(src.step));
  p.step = Number.isFinite(step) ? Math.min(Math.max(step, 0), n) : 0;
  return p;
}

/**
 * Tick every step that is satisfied NOW, in order, starting at the current one. Ticks LATCH: a
 * later edit that breaks an earlier step never un-ticks it (§10.1 mechanism 4). A step further on
 * that happens to be true is NOT ticked while an earlier one is open — the rail teaches in order.
 * A step already in `ticks` (latched before) is passed over. Returns a NEW progress object; never
 * mutates. `ctx.base` is the lesson's SHIPPED doc as the fork opened it (normalised — so a setting
 * the author left to its default compares against that default); `lesson.doc` when absent.
 * @param {Lesson} lesson @param {any} prog
 * @param {{doc: any, report?: RunReport|null, base?: any, now?: number}} ctx
 */
export function advance(lesson, prog, ctx) {
  const p = settle(lesson, prog);
  const steps = Array.isArray(lesson && lesson.steps) ? lesson.steps : [];
  const base = ctx && ctx.base ? ctx.base : lesson && lesson.doc;
  while (p.step < steps.length) {
    const s = steps[p.step];
    const ok = p.ticks.indexOf(s.id) >= 0 || evaluate(s.check, { ...ctx, base });
    if (!ok) break;
    if (p.ticks.indexOf(s.id) < 0) p.ticks.push(s.id);
    p.step++;
  }
  if (p.step >= steps.length && steps.length && !p.doneAt) p.doneAt = Number(ctx && ctx.now) || Date.now();
  return p;
}

/** The `Got it` button of a `{manual:true}` step (and only of the CURRENT step). Returns a NEW
 * progress object; a press for any other step returns the progress unchanged. It does not tick
 * the steps after it — the caller runs `advance()` next, which does.
 * @param {Lesson} lesson @param {any} prog @param {string} stepId */
export function tickManual(lesson, prog, stepId) {
  const p = settle(lesson, prog);
  const steps = Array.isArray(lesson && lesson.steps) ? lesson.steps : [];
  const s = steps[p.step];
  if (!s || s.id !== stepId || !s.check || !('manual' in s.check)) return p;
  if (p.ticks.indexOf(s.id) < 0) p.ticks.push(s.id);
  p.step++;
  return p;
}

/**
 * Every name a check refers to, for chat-lint rule 15: part ids must exist in the lesson's doc,
 * presets in the catalogue, types in specMap(). Walks `all`/`any`.
 * @param {Check|any} check
 * @returns {{kinds: string[], fields: string[], parts: string[], presets: string[], types: string[], cmps: any[]}}
 */
export function refsOf(check) {
  const out = { kinds: /** @type {string[]} */ ([]), fields: /** @type {string[]} */ ([]), parts: /** @type {string[]} */ ([]), presets: /** @type {string[]} */ ([]), types: /** @type {string[]} */ ([]), cmps: /** @type {any[]} */ ([]) };
  /** @param {any} c */
  const walk = (c) => {
    if (!c || typeof c !== 'object') { out.kinds.push(String(c)); return; }
    for (const kind of Object.keys(c)) {
      out.kinds.push(kind);
      const body = c[kind];
      if (kind === 'all' || kind === 'any') { (Array.isArray(body) ? body : []).forEach(walk); continue; }
      if (kind === 'manual' || !body || typeof body !== 'object') continue;
      for (const [f, v] of Object.entries(body)) {
        out.fields.push(`${kind}.${f}`);
        if (['id', 'partId', 'from', 'to'].indexOf(f) >= 0) out.parts.push(String(v));
        if (['preset', 'fromPreset', 'toPreset'].indexOf(f) >= 0) out.presets.push(String(v));
        if (['type', 'fromType', 'toType'].indexOf(f) >= 0) out.types.push(String(v));
        if (['count', 'generations', 'ran', 'errors'].indexOf(f) >= 0 && kind !== 'ran') out.cmps.push(v);
      }
    }
  };
  walk(check);
  return out;
}
