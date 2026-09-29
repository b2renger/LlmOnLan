// @ts-check
// "On a schedule" (owner, 2026-09-29 — agent loops, docs/IDE_PLAN.md §6): a person switches on, per project, a message
// LOL Vibe sends by itself every N minutes or every day at a time. The rules are the Trigger box's:
//   1. only a person switches one on, and it is FORGOTTEN AT RESTART (like Share on the LAN and Keep going): nothing
//      ever runs because the app was reopened;
//   2. it runs only while LlmOnLan is open (close means close);
//   3. a run is an ordinary message in the thread it was set from, sent through the controller, so the reply, Stop,
//      the seat and Keep going until done all work as for a typed one; while a reply is running it is SKIPPED (counted),
//      never queued;
//   4. at most one run every MIN_EVERY_MIN minutes.
// dsh has its own scheduler, but it needs dsh's web host and cannot run under the SDK (the P5-L spike): hence this.

/** At most one run every this many minutes (each run is a whole agent turn, or a loop, on the farm). */
export const MIN_EVERY_MIN = 5;
/** What a scheduled message starts with, so the thread (and the agent) can tell it from a typed one. */
export const MARK = '⏰ ';

/** @typedef {{every: number} | {at: string}} Spec  every = minutes; at = "HH:MM", local time, each day */

/** A minute, in ms — the harness shortens it (window.__lolChatTestFlags.scheduleMinuteMs); never the app. */
function minuteMs() {
  const f = typeof window !== 'undefined' ? /** @type {any} */ (window).__lolChatTestFlags : null;
  const v = f && Number(f.scheduleMinuteMs);
  return Number.isFinite(v) && v > 0 ? v : 60000;
}

/**
 * PURE: the time of the next run after `now` (ms since the epoch), or NaN for a spec that cannot run.
 * @param {Spec} spec @param {number} now @param {number} [minute] ms per minute (tests)
 */
export function nextRun(spec, now, minute = 60000) {
  if (spec && 'every' in spec) {
    const n = Math.floor(Number(spec.every));
    return Number.isFinite(n) && n >= MIN_EVERY_MIN ? now + n * minute : NaN;
  }
  const m = spec && 'at' in spec ? /^(\d{1,2}):(\d{2})$/.exec(String(spec.at)) : null;
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return NaN;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** projectId → one schedule. Never saved. */
const schedules = new Map();
/** @type {Set<() => void>} */
const listeners = new Set();
const notify = () => { for (const fn of listeners) { try { fn(); } catch { /* a panel that went away */ } } };

/**
 * Switch a schedule on (or replace it). `app` needs `controller.send` and `controller.isStreaming`.
 * @param {any} app @param {string} projectId
 * @param {{spec: Spec, text: string, threadId: string, model?: string}} o  model: the picker's choice when it was started
 * @returns {{ok: true, next: number} | {ok: false, why: 'spec'|'text'|'thread'}}
 */
export function setSchedule(app, projectId, o) {
  const text = String((o && o.text) || '').trim();
  if (!text) return { ok: false, why: 'text' };
  if (!o.threadId) return { ok: false, why: 'thread' };
  if (!Number.isFinite(nextRun(o.spec, Date.now()))) return { ok: false, why: 'spec' };
  clearSchedule(projectId);
  const entry = { app, projectId: String(projectId), spec: o.spec, text, threadId: o.threadId, model: String(o.model || ''), timer: /** @type {any} */ (null), next: 0, runs: 0, skipped: 0, last: 0 };
  schedules.set(entry.projectId, entry);
  arm(entry);
  notify();
  return { ok: true, next: entry.next };
}

/** @param {any} entry */
function arm(entry) {
  entry.next = nextRun(entry.spec, Date.now(), minuteMs());
  // setTimeout, re-armed after each run (chat-lint rule 13: no setInterval); a far-off daily time is re-checked hourly
  // so a computer that slept does not fire a day late.
  const wait = Math.max(0, Math.min(entry.next - Date.now(), 3600000));
  entry.timer = setTimeout(() => { void tick(entry); }, wait);
}

/** @param {any} entry */
async function tick(entry) {
  if (schedules.get(entry.projectId) !== entry) return;
  if (Date.now() < entry.next - 50) { arm(entry); return; }   // an hourly re-check before a daily time
  const ctl = entry.app && entry.app.controller;
  if (!ctl || (typeof ctl.isStreaming === 'function' && ctl.isStreaming())) {
    entry.skipped += 1;
  } else {
    entry.runs += 1;
    entry.last = Date.now();
    try { await ctl.send({ threadId: entry.threadId, text: MARK + entry.text, ...(entry.model ? { model: entry.model } : {}) }); } catch (e) { console.warn('[lolchat] a scheduled message failed', e); }
  }
  if (schedules.get(entry.projectId) === entry) arm(entry);
  notify();
}

/** Switch a project's schedule off. @param {string} projectId */
export function clearSchedule(projectId) {
  const e = schedules.get(String(projectId));
  if (!e) return;
  clearTimeout(e.timer);
  schedules.delete(String(projectId));
  notify();
}

/** What the panel shows. @param {string} projectId */
export function scheduleOf(projectId) {
  const e = schedules.get(String(projectId));
  return e ? { spec: e.spec, text: e.text, threadId: e.threadId, model: e.model, next: e.next, runs: e.runs, skipped: e.skipped, last: e.last } : null;
}

/** @param {() => void} fn @returns {() => void} */
export function onSchedules(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Tests: switch every schedule off. */
export function resetSchedules() { for (const id of [...schedules.keys()]) clearSchedule(id); }
