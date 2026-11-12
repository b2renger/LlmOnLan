// The usage report (INSIGHTS_PLAN §6.5, owner 2026-11-12): nothing a person wrote can reach it, whatever is thrown at it.
import assert from 'node:assert/strict';
import { createUsage, COUNTS, TIMINGS, KEY, KEEP_DAYS } from '../../../renderer/chat/core/usage.mjs';

const mem = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, raw: m };
};
const DAY = Date.UTC(2026, 10, 12, 12);
const SECRET = 'Alice wrote this private sentence';
const FIELDS = new Set(['kind', 'format', 'app', 'made', 'keptDays', 'days', 'day', 'counts', 'timings', 'boxesRun', 'n', 'median', 'worst']);

/** Every string in `o`, keys and values. */
function strings(o, out = []) {
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => strings(x, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.push(k); strings(v, out); }
  return out;
}
/** The report holds no string but the allowed ones. */
function onlyAllowed(rep, boxTypes) {
  const allowed = new Set([...FIELDS, ...COUNTS, ...TIMINGS, ...boxTypes, 'lol-usage-report', 'unknown', rep.app]);
  for (const s of strings(rep)) assert.ok(allowed.has(s) || /^\d{4}-\d{2}-\d{2}$/.test(s), `a string that is not allowed: ${JSON.stringify(s)}`);
}

export default (test) => {
  test('usage: a name off the lists, or a value that is not a finite number, is never recorded', () => {
    const st = mem();
    const u = createUsage({ storage: st, now: () => DAY });
    for (const name of [SECRET, 'open.owui ', 'vibe.error.' + SECRET, '__proto__', 'constructor', 'computer.box.text', 42, null, {}])
      assert.equal(u.record(/** @type {any} */ (name)), false, String(name));
    for (const v of [NaN, Infinity, -1, '5', {}, [], null]) {
      assert.equal(u.record('open.owui', /** @type {any} */ (v)), false, String(v));
      assert.equal(u.time('vibe.reply_ms', /** @type {any} */ (v)), false, String(v));
    }
    assert.equal(u.time(SECRET, 5), false);
    assert.equal(st.raw.has(KEY), false, 'nothing written at all');
    assert.equal(u.record('open.owui'), true);
    assert.equal(u.time('vibe.reply_ms', 1234.6), true);
    const rep = u.report({ appVersion: '0.2.17' });
    assert.deepEqual(rep.days[0].counts, { 'open.owui': 1 });
    assert.deepEqual(rep.days[0].timings, { 'vibe.reply_ms': { n: 1, median: 1235, worst: 1235 } });
    onlyAllowed(rep, []);
  });

  test('usage: a graph\'s box types count only when the code listed them; its words never', () => {
    const u = createUsage({ storage: mem(), now: () => DAY });
    u.setBoxTypes(['text', 'agent', SECRET, 'Bad Type', '']);
    const doc = { parts: [{ type: 'text' }, { type: SECRET }, { type: 'agent' }, { type: 'agent' }, { type: '__proto__' }], title: SECRET };
    assert.equal(u.run({ ran: 3, errors: [{ message: SECRET }], cancelled: true, capped: { cap: 50 }, generations: 7, ms: 900 }, doc), true);
    const d = u.report({ appVersion: '0.2.17' }).days[0];
    assert.deepEqual(d.boxesRun, { text: 1, agent: 1 }, 'a type once per run, only listed ones');
    assert.deepEqual(d.counts, { 'run.done': 1, 'run.error': 1, 'run.cancelled': 1, 'run.capped': 1, 'run.generations': 7 });
    onlyAllowed(u.report({ appVersion: '0.2.17' }), ['text', 'agent']);
  });

  test('usage: garbage in storage never reaches the report; a hostile version reads unknown', () => {
    const planted = {
      v: 1,
      days: {
        '2026-11-12': { c: { 'open.vibe': 2, [SECRET]: 99, 'vibe.reply': SECRET }, t: { 'vibe.reply_ms': [100, SECRET, 300, null], [SECRET]: [1] }, b: { [SECRET]: 4, text: 2 } },
        [SECRET]: { c: { 'open.vibe': 1 } },
        '2026-11-11': SECRET,
      },
      note: SECRET,
    };
    const u = createUsage({ storage: mem({ [KEY]: JSON.stringify(planted) }), now: () => DAY });
    u.setBoxTypes(['text']);
    const rep = u.report({ appVersion: `0.2.17 ${SECRET}` });
    assert.equal(rep.app, 'unknown');
    assert.ok(!JSON.stringify(rep).includes('Alice'));
    onlyAllowed(rep, ['text']);
    const d = rep.days.find((x) => x.day === '2026-11-12');
    assert.deepEqual(d.counts, { 'open.vibe': 2 });
    assert.deepEqual(d.timings['vibe.reply_ms'], { n: 2, median: 300, worst: 300 });
    assert.deepEqual(d.boxesRun, { text: 2 });
    // Unreadable storage is a fresh start, not a crash.
    assert.deepEqual(createUsage({ storage: mem({ [KEY]: '{not json' }), now: () => DAY }).report().days, []);
  });

  test('usage: recording never throws, and days past the kept 30 go', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('QuotaExceededError'); } };
    const u = createUsage({ storage: broken, now: () => DAY });
    assert.equal(u.record('open.owui'), false);
    assert.equal(u.reply({}, { status: 'done', ttftMs: 5 }), true, 'still answers');
    let t = DAY - (KEEP_DAYS + 3) * 86400000;
    const st = mem();
    const v = createUsage({ storage: st, now: () => t });
    v.record('open.vibe');
    t = DAY;
    v.record('open.vibe');
    assert.deepEqual(v.report().days.map((d) => d.day), ['2026-11-12']);
  });

  test('usage: a LOL Vibe reply is counted once, by how it ended', () => {
    const u = createUsage({ storage: mem(), now: () => DAY });
    assert.equal(u.reply({}, { status: 'error', local: true, error: { kind: 'local' } }), false, 'a local row is not a reply');
    u.reply({}, { status: 'done', ttftMs: 400, durationMs: 3000, tokPerSec: 55.5 });
    u.reply({ changes: [] }, { status: 'done', ttftMs: 900 });
    u.reply({}, { status: 'aborted' });
    u.reply({}, { status: 'error', error: { kind: 'seats_full', code: 'lol_seats_full' } });
    u.reply({}, { status: 'error', error: { kind: SECRET } });
    const d = u.report().days[0];
    assert.deepEqual(d.counts, { 'vibe.reply': 2, 'vibe.reply.stopped': 1, 'vibe.agent.reply': 1, 'vibe.error.seats_full': 1, 'vibe.error.http': 1 });
    assert.deepEqual(d.timings['vibe.first_word_ms'], { n: 2, median: 900, worst: 900 });
  });
};
