// projects/schedule.mjs: "on a schedule" — the next run's time (pure), and a schedule that sends its message into its
// own thread through the controller, skips (never queues) while a reply runs, and stops when switched off; and, on a
// fake clock, a run more than an hour apart that still comes on time (the hourly re-check keeps the planned time).
import assert from 'node:assert/strict';
import { nextRun, setSchedule, clearSchedule, scheduleOf, resetSchedules, MIN_EVERY_MIN, MARK } from '../../../renderer/chat/projects/schedule.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll until fn() is true (timers are real here, so no fixed sleeps). */
async function until(fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); }
  throw new Error('timed out');
}

export default (test) => {
  test('schedule: the next run — every N minutes (never under the minimum), or each day at a time', () => {
    const now = new Date(2026, 8, 29, 14, 30, 0).getTime();
    assert.equal(nextRun({ every: 10 }, now), now + 10 * 60000);
    assert.ok(Number.isNaN(nextRun({ every: MIN_EVERY_MIN - 1 }, now)), `under ${MIN_EVERY_MIN} minutes it cannot run`);
    assert.equal(nextRun({ at: '16:05' }, now), new Date(2026, 8, 29, 16, 5).getTime(), 'later today');
    assert.equal(nextRun({ at: '08:00' }, now), new Date(2026, 8, 30, 8, 0).getTime(), 'already past: tomorrow');
    assert.equal(nextRun({ at: '14:30' }, now), new Date(2026, 8, 30, 14, 30).getTime(), 'exactly now: tomorrow, never twice');
    for (const at of ['24:00', '9:60', 'noon', '']) assert.ok(Number.isNaN(nextRun({ at }, now)), `"${at}" cannot run`);
  });

  test('schedule: sends its message into its OWN thread, skips while a reply runs, stops when switched off', async () => {
    /** @type {any[]} */ const sent = [];
    let streaming = false;
    const app = { controller: { send: async (/** @type {any} */ d) => { sent.push(d); }, isStreaming: () => streaming } };
    globalThis.window = /** @type {any} */ ({ __lolChatTestFlags: { scheduleMinuteMs: 20 } });   // 5 minutes = 100 ms
    try {
      assert.deepEqual(setSchedule(app, 'p', { spec: { every: 2 }, text: 'x', threadId: 't' }), { ok: false, why: 'spec' });
      assert.deepEqual(setSchedule(app, 'p', { spec: { every: 5 }, text: '  ', threadId: 't' }), { ok: false, why: 'text' });
      assert.equal(scheduleOf('p'), null, 'a refused schedule is not on');

      const r = setSchedule(app, 'p', { spec: { every: 5 }, text: 'Add the time to log.md', threadId: 't1', model: 'qwen3.8:latest' });
      assert.equal(r.ok, true);
      await until(() => sent.length === 1);
      assert.deepEqual(sent[0], { threadId: 't1', text: `${MARK}Add the time to log.md`, model: 'qwen3.8:latest' },
        'marked, into the thread it was set from, with the model chosen when it started (a farm may have no default)');

      streaming = true;
      await until(() => scheduleOf('p').skipped >= 1);
      assert.equal(sent.length, 1, 'while a reply runs the run is skipped, never queued');
      streaming = false;
      await until(() => sent.length === 2);
      assert.equal(scheduleOf('p').runs, 2);

      clearSchedule('p');
      assert.equal(scheduleOf('p'), null);
      await sleep(250);
      assert.equal(sent.length, 2, 'off means off');
    } finally { resetSchedules(); delete globalThis.window; }
  });

  test('schedule: every 90 minutes sends at +90 and +180 minutes (the hourly re-check keeps the planned time)', async () => {
    // A fake clock: Date.now and the timers the module reads, real minutes, nothing waits for real.
    const real = { now: Date.now, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
    const t0 = new Date(2026, 10, 5, 9, 0, 0).getTime();
    let now = t0, seq = 0;
    /** @type {Map<number, {at: number, fn: () => void}>} */ const timers = new Map();
    const advanceTo = async (/** @type {number} */ t) => {
      for (;;) {
        const due = [...timers].filter(([, x]) => x.at <= t).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now = due[1].at; due[1].fn();
        await new Promise((r) => setImmediate(r));   // the tick's await of send, then its next timer
      }
      now = t;
    };
    /** @type {number[]} */ const sentAtMin = [];
    const app = { controller: { send: async () => { sentAtMin.push((Date.now() - t0) / 60000); }, isStreaming: () => false } };
    Date.now = () => now;
    globalThis.setTimeout = /** @type {any} */ ((/** @type {() => void} */ fn, /** @type {number} */ ms) => { timers.set(++seq, { at: now + Math.max(0, ms || 0), fn }); return seq; });
    globalThis.clearTimeout = /** @type {any} */ ((/** @type {number} */ id) => { timers.delete(id); });
    try {
      assert.equal(setSchedule(app, 'p90', { spec: { every: 90 }, text: 'x', threadId: 't' }).ok, true);
      await advanceTo(t0 + 89 * 60000);
      assert.deepEqual(sentAtMin, [], 'nothing before +90 (one re-check at +60 only)');
      await advanceTo(t0 + 90 * 60000);
      assert.deepEqual(sentAtMin, [90]);
      await advanceTo(t0 + 180 * 60000);
      assert.deepEqual(sentAtMin, [90, 180], 'again 90 minutes later');
      assert.equal(scheduleOf('p90').next, t0 + 270 * 60000);
    } finally {
      resetSchedules();
      Date.now = real.now; globalThis.setTimeout = real.setTimeout; globalThis.clearTimeout = real.clearTimeout;
    }
  });
};
