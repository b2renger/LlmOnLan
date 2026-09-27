// app/studio-state.mjs (S0-U1): the merge / validate / clamp table behind `thread.studio`.
//
// What these assertions protect:
//   - a stored panel id whose module is gone must read as "closed", never as a tab that cannot be
//     built — that is the difference between a thread reopening empty and the workbench throwing;
//   - `panel: null` with `width: 'work'` would collapse the chat to nothing with no panel to show
//     it, so a panel-less studio is forced back to 'chat';
//   - a stale projectId/graphId is dropped ON READ and never rewritten, so the store keeps the only
//     evidence that a folder went missing;
//   - sanitise never mutates its input (the caller passes the repo's CACHED thread row);
//   - the debounced writer coalesces, and flushes the OLD thread's value the instant the reader
//     switches threads — otherwise one conversation's workbench state lands on another's row.
import assert from 'node:assert/strict';
import {
  WIDTHS, DEFAULT_WIDTH, MIN_FRACTION, MAX_FRACTION, DEFAULT_FRACTION,
  emptyStudio, isWidth, nextWidth, clampFraction, parseFraction, formatFraction,
  sanitizeStudio, studioEquals, mergeStudio, createStudioWriter,
} from '../../../renderer/chat/app/studio-state.mjs';

/** A fake timer the writer tests drive by hand. */
function fakeTimers() {
  let seq = 0;
  const jobs = new Map();
  return {
    set: (fn, ms) => { const id = ++seq; jobs.set(id, { fn, ms }); return id; },
    clear: (id) => { jobs.delete(id); },
    pending: () => jobs.size,
    fire: () => {
      const entries = [...jobs.entries()];
      jobs.clear();
      for (const [, job] of entries) job.fn();
      return entries.length;
    },
  };
}

export default (test) => {
  test('the width vocabulary is the three states, in cycle order', () => {
    assert.deepEqual([...WIDTHS], ['chat', 'split', 'work']);
    assert.equal(DEFAULT_WIDTH, 'chat');
    assert.equal(isWidth('split'), true);
    assert.equal(isWidth('Split'), false);
    assert.equal(isWidth(null), false);
    assert.equal(nextWidth('chat'), 'split');
    assert.equal(nextWidth('split'), 'work');
    assert.equal(nextWidth('work'), 'chat');
    assert.equal(nextWidth('nonsense'), 'split');   // an unknown state reads as 'chat', so → 'split'
  });

  test('an empty studio is a closed workbench', () => {
    const s = emptyStudio(7);
    assert.deepEqual(s, { panel: null, width: 'chat', graphId: null, projectId: null, boardId: null, updatedAt: 7 });
  });

  test('sanitise: an unknown panel id closes the workbench', () => {
    const s = sanitizeStudio({ panel: 'ghost', width: 'work' }, { panels: ['computer'] });
    assert.equal(s.panel, null);
    assert.equal(s.width, 'chat');
  });

  test('sanitise: a known panel keeps its width', () => {
    const s = sanitizeStudio({ panel: 'computer', width: 'work' }, { panels: new Set(['computer']) });
    assert.equal(s.panel, 'computer');
    assert.equal(s.width, 'work');
  });

  test('sanitise: an unknown width falls back to chat', () => {
    const s = sanitizeStudio({ panel: 'computer', width: 'huge' }, { panels: ['computer'] });
    assert.equal(s.width, 'chat');
  });

  test('sanitise: no panel forces the chat width even when a width was stored', () => {
    const s = sanitizeStudio({ panel: null, width: 'split' });
    assert.equal(s.width, 'chat');
  });

  test('sanitise: a stale projectId / graphId / boardId is dropped on read', () => {
    const raw = { panel: 'computer', width: 'split', graphId: 'g1', projectId: 'p-gone', boardId: 'b1' };
    const s = sanitizeStudio(raw, { panels: ['computer'], graphs: ['g1'], projects: ['p-live'], boards: new Set(['b1']) });
    assert.equal(s.graphId, 'g1');
    assert.equal(s.projectId, null, 'a project that no longer resolves must read as null');
    assert.equal(s.boardId, 'b1');
    assert.equal(raw.projectId, 'p-gone', 'the INPUT must keep the stale id: sanitise never rewrites');
  });

  test('sanitise: an id set that is not supplied is not checked', () => {
    const s = sanitizeStudio({ panel: 'computer', projectId: 'p1', graphId: 'g1' }, { panels: ['computer'] });
    assert.equal(s.projectId, 'p1');
    assert.equal(s.graphId, 'g1');
  });

  test('sanitise never mutates its input, and survives junk', () => {
    const raw = Object.freeze({ panel: 'computer', width: 'split', updatedAt: 12 });
    const s = sanitizeStudio(raw, { panels: ['computer'] });
    s.panel = 'other';
    assert.equal(raw.panel, 'computer');
    assert.equal(s.updatedAt, 12);
    assert.deepEqual(sanitizeStudio(null), emptyStudio(0));
    assert.deepEqual(sanitizeStudio('nope', { now: 5 }), emptyStudio(5));
    assert.deepEqual(sanitizeStudio({ panel: 42, width: 3 }), emptyStudio(0));
  });

  test('the split fraction clamps, parses and formats', () => {
    assert.equal(clampFraction(0.9), MAX_FRACTION);
    assert.equal(clampFraction(0.01), MIN_FRACTION);
    assert.equal(clampFraction('nope'), DEFAULT_FRACTION);
    assert.equal(parseFraction('46%'), 0.46);
    assert.equal(parseFraction('0.46'), 0.46);
    assert.equal(parseFraction(0.46), 0.46);
    assert.equal(parseFraction('52'), 0.52, 'a bare number over 1 is a percentage');
    assert.equal(parseFraction('320px'), null, 'pixels are not a fraction: keep the default');
    assert.equal(parseFraction(''), null);
    assert.equal(parseFraction(null), null);
    assert.equal(parseFraction('99%'), MAX_FRACTION, 'a parsed value is clamped too');
    assert.equal(formatFraction(0.4612345), '0.4612');
    assert.equal(parseFraction(formatFraction(0.37)), 0.37, 'round trip');
  });

  test('studioEquals ignores updatedAt', () => {
    const a = sanitizeStudio({ panel: 'computer', width: 'split', updatedAt: 1 }, { panels: ['computer'] });
    const b = sanitizeStudio({ panel: 'computer', width: 'split', updatedAt: 999 }, { panels: ['computer'] });
    assert.equal(studioEquals(a, b), true);
    assert.equal(studioEquals(a, { ...b, width: 'work' }), false);
    assert.equal(studioEquals(a, null), false);
  });

  test('merge: no change keeps the identity, so the caller can skip the write', () => {
    const prev = sanitizeStudio({ panel: 'computer', width: 'split', updatedAt: 100 }, { panels: ['computer'] });
    const same = mergeStudio(prev, { panel: 'computer', width: 'split' }, { now: 500, panels: ['computer'] });
    assert.equal(same, prev, 'same object: nothing moved');
    assert.equal(same.updatedAt, 100, 'and updatedAt did not move either');
  });

  test('merge: a change produces a new record with a fresh updatedAt', () => {
    const prev = sanitizeStudio({ panel: 'computer', width: 'split', updatedAt: 100 }, { panels: ['computer'] });
    const next = mergeStudio(prev, { width: 'work' }, { now: 500, panels: ['computer'] });
    assert.notEqual(next, prev);
    assert.equal(next.width, 'work');
    assert.equal(next.updatedAt, 500);
    assert.equal(prev.width, 'split', 'the previous record is untouched');
  });

  test('merge: the patch is validated like anything else', () => {
    const prev = emptyStudio(1);
    const next = mergeStudio(prev, { panel: 'ghost', width: 'work' }, { now: 9, panels: ['computer'] });
    assert.equal(next.panel, null);
    assert.equal(next.width, 'chat');
    // closing (panel → null) from an open state is a real change
    const open = sanitizeStudio({ panel: 'computer', width: 'work' }, { panels: ['computer'] });
    const closed = mergeStudio(open, { panel: null }, { now: 42, panels: ['computer'] });
    assert.equal(closed.panel, null);
    assert.equal(closed.width, 'chat');
    assert.equal(closed.updatedAt, 42);
  });

  test('the writer coalesces every put for one thread into a single save', () => {
    const timers = fakeTimers();
    const saves = [];
    const w = createStudioWriter({
      save: (id, studio) => { saves.push([id, studio.width]); },
      setTimer: timers.set, clearTimer: timers.clear,
    });
    w.put('t1', { width: 'split' });
    w.put('t1', { width: 'work' });
    w.put('t1', { width: 'chat' });
    assert.equal(saves.length, 0, 'nothing is written before the debounce elapses');
    assert.equal(timers.pending(), 1, 'and only ONE timer is ever outstanding');
    timers.fire();
    assert.deepEqual(saves, [['t1', 'chat']], 'the last value wins, once');
  });

  test('the writer flushes the old thread the moment another one is put', () => {
    const timers = fakeTimers();
    const saves = [];
    const w = createStudioWriter({
      save: (id, studio) => { saves.push([id, studio.width]); },
      setTimer: timers.set, clearTimer: timers.clear,
    });
    w.put('t1', { width: 'split' });
    w.put('t2', { width: 'work' });
    assert.deepEqual(saves, [['t1', 'split']], "the leaving thread's value is written immediately");
    assert.deepEqual(w.pending(), { id: 't2', studio: { width: 'work' } });
    timers.fire();
    assert.deepEqual(saves, [['t1', 'split'], ['t2', 'work']]);
    assert.equal(w.pending(), null);
  });

  test('the writer can be flushed and cancelled by hand', () => {
    const timers = fakeTimers();
    const saves = [];
    const w = createStudioWriter({
      save: (id) => { saves.push(id); },
      setTimer: timers.set, clearTimer: timers.clear,
    });
    w.put('', { width: 'split' });
    assert.equal(w.pending(), null, 'no thread id, nothing to write');
    w.put('t1', { width: 'split' });
    w.flush();
    assert.deepEqual(saves, ['t1']);
    assert.equal(timers.pending(), 0, 'flush clears the timer');
    w.put('t2', { width: 'work' });
    w.cancel();
    timers.fire();
    assert.deepEqual(saves, ['t1'], 'a cancelled write never lands');
    assert.equal(w.flush(), null);
  });
};
