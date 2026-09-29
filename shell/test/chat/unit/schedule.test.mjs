// projects/schedule.mjs: "on a schedule" — the next run's time (pure), and a schedule that sends its message into its
// own thread through the controller, skips (never queues) while a reply runs, and stops when switched off.
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
};
