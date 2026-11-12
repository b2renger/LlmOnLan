// @ts-check
// The usage report (docs/plans/INSIGHTS_PLAN.md §6.5 and §7.1, approved by the owner 2026-11-12). Counts and timings
// per day, kept in this window's own storage, which lives in the data folder (DATA_DIR/lol-client), for 30 days. Nothing
// is sent anywhere: a person saves the report to a file from Preferences, and gives it to whom they choose.
//
// Nothing a person wrote can enter it. A name is recorded only when it is EXACTLY one of the frozen lists below (never
// built from data: an imported graph's box type is checked against the list the code passes in); a value only when it is
// a finite number. The report is BUILT by walking those lists, never copied from storage, so what storage holds cannot
// leak either. Recording never throws: a failed write (a full disk, a private window) loses a count, nothing else.
// PURE: storage and clock are passed in (chat-lint rule 4).

export const KEY = 'lol:usage:v1';
export const KEEP_DAYS = 30;
const MAX_TIMINGS_A_DAY = 1000;

/** What is counted, by name. Each name is a fixed string; the report holds no other. */
export const COUNTS = Object.freeze([
  'open.owui', 'open.vibe', 'open.computer',            // a surface shown
  'vibe.reply', 'vibe.reply.stopped', 'vibe.agent.reply', // a reply ended (done or stopped); one by the coding agent
  // a reply that failed, by the kind net/errors.mjs gave it
  'vibe.error.seats_full', 'vibe.error.upstream_down', 'vibe.error.auth', 'vibe.error.key_missing',
  'vibe.error.context_overflow', 'vibe.error.vision_unsupported', 'vibe.error.stream_error', 'vibe.error.network',
  'vibe.error.http',
  'run.done', 'run.error', 'run.cancelled', 'run.capped', 'run.limited',
  'run.generations',
]);
/** What is timed: one number a time, summed up in the report as count, median and worst. */
export const TIMINGS = Object.freeze(['vibe.first_word_ms', 'vibe.reply_ms', 'vibe.tokens_per_s', 'run.ms']);

const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_RX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * @param {{storage: {getItem(k: string): string|null, setItem(k: string, v: string): void}|null, now?: () => number}} o
 */
export function createUsage({ storage, now = () => Date.now() }) {
  /** @type {readonly string[]} */ let boxTypes = Object.freeze([]);
  const dayOf = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  function load() {
    try {
      const o = JSON.parse((storage && storage.getItem(KEY)) || 'null');
      return o && typeof o === 'object' && o.days && typeof o.days === 'object' ? o : { v: 1, days: {} };
    } catch { return { v: 1, days: {} }; }
  }
  /** One change to today's record, written at once; days older than KEEP_DAYS go. Never throws. @param {(day: any) => void} fn */
  function change(fn) {
    try {
      const all = load();
      const today = dayOf(now());
      const day = all.days[today] && typeof all.days[today] === 'object' ? all.days[today] : (all.days[today] = {});
      for (const k of ['c', 't', 'b']) if (!day[k] || typeof day[k] !== 'object') day[k] = {};
      fn(day);
      const oldest = dayOf(now() - KEEP_DAYS * 86400000);
      for (const d of Object.keys(all.days)) if (!DAY_RX.test(d) || d < oldest) delete all.days[d];
      if (storage) storage.setItem(KEY, JSON.stringify(all));
      return true;
    } catch { return false; }
  }
  const num = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Count `name` (one of COUNTS) by `n`. @param {string} name @param {number} [n] */
  function record(name, n = 1) {
    if (typeof name !== 'string' || !COUNTS.includes(name) || !num(n) || n < 0) return false;
    return change((day) => { day.c[name] = (num(day.c[name]) ? day.c[name] : 0) + n; });
  }
  /** One value of `name` (one of TIMINGS). @param {string} name @param {number} v */
  function time(name, v) {
    if (typeof name !== 'string' || !TIMINGS.includes(name) || !num(v) || v < 0) return false;
    return change((day) => {
      const list = Array.isArray(day.t[name]) ? day.t[name] : (day.t[name] = []);
      if (list.length < MAX_TIMINGS_A_DAY) list.push(Math.round(v));
    });
  }
  /** The Computer's box types, from its parts registry (code, never a graph). @param {string[]} list */
  function setBoxTypes(list) { boxTypes = Object.freeze((list || []).filter((s) => typeof s === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(s))); }

  /** A LOL Vibe reply ended (EV.STREAM_END). @param {any} message @param {any} result */
  function reply(message, result) {
    if (!result || result.local) return false;                       // a local row (a note, an error shown) is not a reply
    if (result.status === 'error') {
      const kind = result.error && typeof result.error.kind === 'string' ? result.error.kind : 'http';
      return record(COUNTS.includes(`vibe.error.${kind}`) ? `vibe.error.${kind}` : 'vibe.error.http');
    }
    record(result.status === 'aborted' ? 'vibe.reply.stopped' : 'vibe.reply');
    if (message && Array.isArray(message.changes)) record('vibe.agent.reply');
    if (num(result.ttftMs)) time('vibe.first_word_ms', result.ttftMs);
    if (num(result.durationMs)) time('vibe.reply_ms', result.durationMs);
    if (num(result.tokPerSec)) time('vibe.tokens_per_s', result.tokPerSec);
    return true;
  }
  /** A Computer run ended (host.mjs start). @param {any} report the runner's report @param {any} doc the graph run */
  function run(report, doc) {
    if (!report || typeof report !== 'object') return false;
    record('run.done');
    if ((Array.isArray(report.errors) ? report.errors.length : Number(report.errors)) > 0) record('run.error');
    if (report.cancelled) record('run.cancelled');
    if (report.capped) record('run.capped');
    if (report.limited) record('run.limited');
    if (num(report.generations)) record('run.generations', report.generations);
    if (num(report.ms)) time('run.ms', report.ms);
    const types = new Set(((doc && Array.isArray(doc.parts)) ? doc.parts : []).map((p) => p && p.type));
    const known = [...types].filter((t) => boxTypes.includes(t));
    if (known.length) change((day) => { for (const t of known) day.b[t] = (num(day.b[t]) ? day.b[t] : 0) + 1; });
    return true;
  }

  /**
   * The report: built from the lists, never copied. Strings in it: the kind, the app version (if it looks like one),
   * dates, and the listed names and box types.
   * @param {{appVersion?: string}} [o]
   */
  function report(o = {}) {
    const all = load();
    const stat = (list) => {
      const v = (Array.isArray(list) ? list : []).filter(num).sort((a, b) => a - b);
      return v.length ? { n: v.length, median: v[Math.floor(v.length / 2)], worst: v[v.length - 1] } : null;
    };
    const days = Object.keys(all.days).filter((d) => DAY_RX.test(d)).sort().map((d) => {
      const day = all.days[d] && typeof all.days[d] === 'object' ? all.days[d] : {};
      const c = day.c && typeof day.c === 'object' ? day.c : {};
      const t = day.t && typeof day.t === 'object' ? day.t : {};
      const b = day.b && typeof day.b === 'object' ? day.b : {};
      /** @type {Record<string, any>} */ const counts = {};
      for (const k of COUNTS) if (has(c, k) && num(c[k]) && c[k] > 0) counts[k] = c[k];
      /** @type {Record<string, any>} */ const timings = {};
      for (const k of TIMINGS) { const s = has(t, k) ? stat(t[k]) : null; if (s) timings[k] = s; }
      /** @type {Record<string, any>} */ const boxes = {};
      for (const k of boxTypes) if (has(b, k) && num(b[k]) && b[k] > 0) boxes[k] = b[k];
      return { day: d, counts, timings, boxesRun: boxes };
    });
    const v = typeof o.appVersion === 'string' && VERSION_RX.test(o.appVersion) ? o.appVersion : 'unknown';
    return { kind: 'lol-usage-report', format: 1, app: v, made: dayOf(now()), keptDays: KEEP_DAYS, days };
  }

  return { record, time, reply, run, setBoxTypes, report };
}
