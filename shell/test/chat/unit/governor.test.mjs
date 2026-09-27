// net/governor.mjs (P1-U1, taken over by P2-U1): one foreground slot, the hold the seat-wait
// depends on, and P2's background policy — background work is allowed ONLY when the farm says a
// seat is spare, and the user's own send aborts it.
import assert from 'node:assert/strict';
import { createGovernor } from '../../../renderer/chat/net/governor.mjs';
import { createBus, EV } from '../../../renderer/chat/core/events.mjs';

/**
 * @param {{seats?: {used: number, slots: number}|null}} [o] the farm as the governor sees it
 *   (no farm at all = `app.farm` null, which is what a boot with no discovery looks like).
 */
function stubApp(o) {
  const bus = createBus();
  /** @type {any[]} */ const events = [];
  bus.on(EV.GOV_CHANGE, (p) => events.push(p));
  const caps = { seats: o && o.seats !== undefined ? o.seats : null };
  const farm = o === undefined ? null : { get: () => caps };
  return { app: /** @type {any} */ ({ bus, now: () => 1, farm }), events, caps };
}

export default (test) => {
  test('a fresh governor is idle and can start', () => {
    const { app } = stubApp();
    const gov = createGovernor(app);
    assert.deepEqual(gov.state(), { foreground: 'idle', holder: null });
    assert.equal(gov.canStart('foreground'), true);
  });

  test('the second foreground acquire is refused while the first streams', () => {
    const { app } = stubApp();
    const gov = createGovernor(app);
    const release = gov.acquire('foreground', { holder: 'send' });
    assert.equal(typeof release, 'function');
    assert.deepEqual(gov.state(), { foreground: 'streaming', holder: 'send' });
    assert.equal(gov.canStart('foreground'), false);
    assert.equal(gov.acquire('foreground', { holder: 'regenerate' }), null);
    assert.equal(gov.acquire('foreground', { holder: 'send' }), null, 'not even the same holder twice');
  });

  test('release returns the slot, and is idempotent', () => {
    const { app, events } = stubApp();
    const gov = createGovernor(app);
    const release = gov.acquire('foreground', { holder: 'send' });
    release();
    assert.deepEqual(gov.state(), { foreground: 'idle', holder: null });
    release();
    release();
    assert.equal(events.length, 2, 'one change in, one change out — no repeats');
    assert.ok(gov.acquire('foreground', {}), 'the slot is usable again');
  });

  // K1 (COMPUTER_PLAN §3.5), the one amendment to this file. This case used to assert the
  // opposite — "seats unknown → never background". Every graph run is background, and on a farm
  // with no seat gate (an older farm build, an `external` engine, a snapshot that has not arrived
  // yet) that rule meant the Computer could never run at all. Amended, not loosened: the three
  // guards that make background polite are all still here, and the next two cases prove it.
  test('seats unknown: the ONE background slot is allowed, and a second is still refused', () => {
    const { app } = stubApp();                       // no farm at all — a boot before discovery
    const gov = createGovernor(app);
    assert.equal(gov.canStart('background'), true);
    const first = gov.acquire('background', { holder: 'graph' });
    assert.equal(typeof first, 'function', 'the one background slot is available');
    assert.equal(gov.canStart('background'), false, 'BACKGROUND_LIMIT = 1 still bounds it');
    assert.equal(gov.acquire('background', { holder: 'graph2' }), null);
    assert.deepEqual(gov.state(), { foreground: 'idle', holder: null }, 'background never moves the foreground slot');
    first();
    assert.equal(gov.canStart('background'), true, 'releasing gives the slot back');
  });

  test('seats unknown: a foreground Send still aborts the background call', () => {
    const { app } = stubApp();
    const gov = createGovernor(app);
    let aborted = 0;
    const release = gov.acquire('background', { holder: 'graph', abort: () => { aborted++; } });
    assert.equal(typeof release, 'function');
    const fg = gov.acquire('foreground', { holder: 'send' });
    assert.equal(typeof fg, 'function', 'the reader always wins');
    assert.equal(aborted, 1, 'the in-flight background acquisition was aborted');
    assert.equal(gov.canStart('background'), false, 'and the foreground is no longer idle');
  });

  test('background needs a FREE seat: a full farm refuses, a spare one allows', () => {
    const full = stubApp({ seats: { used: 2, slots: 2 } });
    const gfull = createGovernor(full.app);
    assert.equal(gfull.canStart('background'), false);
    assert.equal(gfull.acquire('background', {}), null, 'the user’s own seat is not spare capacity');

    const { app, caps } = stubApp({ seats: { used: 1, slots: 2 } });
    const gov = createGovernor(app);
    assert.equal(gov.canStart('background'), true);
    const release = gov.acquire('background', {});
    assert.equal(typeof release, 'function');
    assert.deepEqual(gov.state(), { foreground: 'idle', holder: null },
      'background never shows up as foreground busy — Send must not say "a reply is already running"');
    release();
    release();

    // The seat count is read at CALL time: the snapshot moves every few seconds.
    caps.seats = { used: 2, slots: 2 };
    assert.equal(gov.canStart('background'), false);
    assert.equal(gov.acquire('background', {}), null);
  });

  test('background is refused while the foreground is busy or held', () => {
    const { app } = stubApp({ seats: { used: 0, slots: 2 } });
    const gov = createGovernor(app);
    const release = gov.acquire('foreground', { holder: 'send' });
    assert.equal(gov.canStart('background'), false);
    assert.equal(gov.acquire('background', {}), null);
    release();
    gov.hold('seat-wait', { cancel: () => {} });
    assert.equal(gov.canStart('background'), false, 'a seat wait owns this client’s turn');
    assert.equal(gov.acquire('background', {}), null);
  });

  test('the background lane is a SINGLE FILE, even with seats to spare', () => {
    // S0 review, finding 1. freeSeat() reads the FARM_TICK snapshot, which does not move between
    // two calls in the same frame — so "used < slots" alone let N concurrent asks all through and
    // put N generations on a 2-seat farm. The seat count is the farm's arithmetic, not ours.
    const { app } = stubApp({ seats: { used: 0, slots: 4 } });
    const gov = createGovernor(app);
    const first = gov.acquire('background', {});
    assert.ok(first, 'the first background acquisition takes the lane');
    assert.equal(gov.canStart('background'), false, 'and canStart says so BEFORE anyone tries');
    for (let i = 0; i < 4; i++) assert.equal(gov.acquire('background', {}), null, 'nobody joins it');
    first();
    assert.equal(gov.canStart('background'), true, 'releasing frees the lane again');
    assert.ok(gov.acquire('background', {}), 'and the next one may have it');
  });

  test('the user always wins: a foreground acquire ABORTS in-flight background work', () => {
    const { app } = stubApp({ seats: { used: 0, slots: 2 } });
    const gov = createGovernor(app);
    /** @type {string[]} */ const aborted = [];
    const releaseA = gov.acquire('background', { abort: (r) => aborted.push(`a:${r}`) });
    assert.ok(releaseA, 'one summariser holds the spare seat');

    const release = gov.acquire('foreground', { holder: 'send' });
    assert.deepEqual(aborted, ['a:foreground'], 'it was stopped');
    release();

    // Its release is still safe to call, and nothing is aborted twice.
    releaseA();
    const again = gov.acquire('foreground', { holder: 'send' });
    assert.deepEqual(aborted, ['a:foreground']);
    again();
  });

  test('a throwing background abort does not stop the foreground from starting', () => {
    const { app } = stubApp({ seats: { used: 0, slots: 2 } });
    const gov = createGovernor(app);
    gov.acquire('background', { abort: () => { throw new Error('boom'); } });
    const release = gov.acquire('foreground', { holder: 'send' });
    assert.ok(release, 'the send got its slot anyway');
    assert.deepEqual(gov.state(), { foreground: 'streaming', holder: 'send' });
    release();
  });

  test('an unknown kind is refused outright', () => {
    const { app } = stubApp({ seats: { used: 0, slots: 2 } });
    const gov = createGovernor(app);
    assert.equal(gov.canStart('sideways'), false);
    assert.equal(gov.acquire('sideways', {}), null);
  });

  test('a hold blocks everyone else, and the SAME holder turns it into a stream', () => {
    const { app } = stubApp();
    const gov = createGovernor(app);
    let cancelled = 0;
    gov.hold('seat-wait', { cancel: () => { cancelled++; } });
    assert.deepEqual(gov.state(), { foreground: 'held', holder: 'seat-wait' });
    assert.equal(gov.canStart('foreground'), false);
    assert.equal(gov.acquire('foreground', { holder: 'send' }), null, 'a new send cannot jump the queue');

    const release = gov.acquire('foreground', { holder: 'seat-wait' });
    assert.ok(release, 'the waiter finally got its seat');
    assert.deepEqual(gov.state(), { foreground: 'streaming', holder: 'seat-wait' });
    release();
    assert.deepEqual(gov.state(), { foreground: 'idle', holder: null });
    assert.equal(cancelled, 0, 'a hold that became a stream is not cancelled');
  });

  test('release(holder) frees a hold only for its own holder', () => {
    const { app } = stubApp();
    const gov = createGovernor(app);
    gov.hold('seat-wait', { cancel: () => {} });
    gov.release('someone-else');
    assert.deepEqual(gov.state(), { foreground: 'held', holder: 'seat-wait' });
    gov.release('seat-wait');
    assert.deepEqual(gov.state(), { foreground: 'idle', holder: null });
  });

  test('a hold placed DURING a stream survives that stream\'s release (§3.6.2)', () => {
    const { app } = stubApp();
    const gov = createGovernor(app);
    const release = gov.acquire('foreground', { holder: 'send' });
    gov.hold('seat-wait', { cancel: () => {} });     // an error handler re-arms while the stream unwinds
    release();
    assert.deepEqual(gov.state(), { foreground: 'held', holder: 'seat-wait' }, 'the new hold is not clobbered');
  });

  // P2 review, minor: `cancelHold()` was documented as "the composer's Stop while a seat-wait is
  // pending" and had exactly one caller in the whole tree — this test. Stop really goes through
  // SLOTS.CANCEL_HANDLERS, so the second door is gone; what a hold DOES carry is the sentence a
  // refused send should show, because "A reply is already running" is false while one is queued.
  test('a hold carries the sentence a refused send must show, and drops it when it streams', () => {
    const { app } = stubApp();
    const gov = createGovernor(app);
    assert.equal(gov.holdNote(), null, 'an idle slot has nothing to say');
    gov.hold('seat-wait', { note: 'Still waiting for a seat.' });
    assert.equal(gov.holdNote(), 'Still waiting for a seat.');

    const release = gov.acquire('foreground', { holder: 'seat-wait' });
    assert.ok(release);
    assert.equal(gov.holdNote(), null, 'the hold became the stream: a reply really IS running now');
    release();
    assert.equal(gov.holdNote(), null);
    assert.equal(typeof (/** @type {any} */ (gov).cancelHold), 'undefined', 'one cancel door, not two');
  });

  // P2 review, minor: seat-wait's STREAM_END listener calls release(msgId) from inside the
  // controller's stream tail — BEFORE the controller's own finally. Forcing 'idle' there made the
  // governor advertise a free slot, and the composer swap Stop back to Send, while the generation
  // was still running. Only the stream's own release closure may end a stream.
  test('release() never force-idles a STREAMING slot, even for the right holder', () => {
    const { app, events } = stubApp();
    const gov = createGovernor(app);
    gov.hold('msg-1', { note: 'waiting' });
    const release = gov.acquire('foreground', { holder: 'msg-1' });
    assert.deepEqual(gov.state(), { foreground: 'streaming', holder: 'msg-1' });

    const before = events.length;
    gov.release('msg-1');
    assert.deepEqual(gov.state(), { foreground: 'streaming', holder: 'msg-1' }, 'still streaming');
    assert.equal(events.length, before, 'and it did not even emit a change');

    release();
    assert.deepEqual(gov.state(), { foreground: 'idle', holder: null }, 'the stream itself frees it');
  });

  test('abortActive calls the abort the stream registered', () => {
    const { app } = stubApp();
    const gov = createGovernor(app);
    let aborted = null;
    assert.equal(gov.abortActive('x'), false, 'nothing streaming');
    const release = gov.acquire('foreground', { holder: 'send', abort: (r) => { aborted = r; } });
    assert.equal(gov.abortActive('stop-button'), true);
    assert.equal(aborted, 'stop-button');
    release();
    assert.equal(gov.abortActive('again'), false);
  });

  test('GOV_CHANGE and onChange see the same transitions', () => {
    const { app, events } = stubApp();
    const gov = createGovernor(app);
    /** @type {any[]} */ const seen = [];
    const off = gov.onChange((s) => seen.push(s));
    const release = gov.acquire('foreground', { holder: 'send' });
    release();
    off();
    gov.acquire('foreground', { holder: 'send' });
    assert.deepEqual(seen, [{ foreground: 'streaming', holder: 'send' }, { foreground: 'idle', holder: null }]);
    assert.equal(events.length, 3, 'the bus kept getting them after the direct listener left');
    assert.equal(gov.onChange(() => {}) instanceof Function, true);
    assert.throws(() => gov.onChange(/** @type {any} */ (null)), /must be a function/);
  });

  test('a throwing listener does not break the governor', () => {
    const { app } = stubApp();
    const gov = createGovernor(app);
    gov.onChange(() => { throw new Error('boom'); });
    let saw = 0;
    gov.onChange(() => { saw++; });
    const release = gov.acquire('foreground', { holder: 'send' });
    assert.equal(saw, 1);
    release();
    assert.deepEqual(gov.state(), { foreground: 'idle', holder: null });
  });
};
