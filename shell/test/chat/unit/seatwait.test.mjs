// app/seat-wait.mjs (P2-U1): the pure decision table, and the whole wait driven through the REAL
// controller, governor and repo against a stubbed fetch that answers the farm's REAL 429 body.
//
// The decision table is where the etiquette actually lives, so it is tested branch by branch and
// in ORDER (give-up beats a hidden window; the attempts cap beats an idle farm). The integration
// half then proves the three things a table cannot: exactly ONE request goes out per decision, the
// governor is held so the composer refuses a second send, and the waiting row keeps the farm's own
// sentence until the reader (or a freed seat) resolves it.
import assert from 'node:assert/strict';
import { createApp } from '../../../renderer/chat/core/app.mjs';
import { EV } from '../../../renderer/chat/core/events.mjs';
import { openRepoSync } from '../../../renderer/chat/state/repo.mjs';
import { createMemoryBackend } from '../../../renderer/chat/state/backend-memory.mjs';
import { createGovernor } from '../../../renderer/chat/net/governor.mjs';
import { createController } from '../../../renderer/chat/app/controller.mjs';
import { install, seatDecision, waitingNote, composeNote, farmTextOf, MAX_ATTEMPTS, DEFAULT_GIVE_UP_MS } from '../../../renderer/chat/app/seat-wait.mjs';
// The other two P2-U1 modules are DOM features, but each has a pure core worth a table of its own.
// The unit owns exactly two test files (plan §4 P2-U1), so those tables ride here rather than
// claiming a third file the plan did not allot; their DOM halves are proven by p2-strip / p2-notify.
import { stripFields, SILENT_AFTER_MS } from '../../../renderer/chat/ui/strip.mjs';
import { shouldNotify, teaser, BODY_CHARS } from '../../../renderer/chat/ui/notify.mjs';
import '../../../renderer/chat/strings/core.en.mjs';
import '../../../renderer/chat/strings/net.en.mjs';
import '../../../renderer/chat/strings/composer.en.mjs';
import '../../../renderer/chat/strings/etiquette.en.mjs';

const realFetch = globalThis.fetch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Let the repo's write chain and the controller's promise chain drain. */
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await sleep(0);
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

/** The farm's own sentence, copied from shell/test/mock/seats-body.js (= farm/src/seats.js). */
const FARM_SEATS_TEXT = "All 2 seats on this server are in use. A seat frees after ~15 min without activity — try again in a moment, or ask around who's done.";

const seatsFullResponse = () => new Response(
  JSON.stringify({ error: { message: FARM_SEATS_TEXT, type: 'rate_limit_error', code: 'lol_seats_full' } }),
  { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '30' } },
);

const chunk = (delta, finish = null) => ({ id: 'x', object: 'chat.completion.chunk', model: 'assistant', choices: [{ index: 0, delta, finish_reason: finish }] });
const usageChunk = (completion, prompt = 7) => ({ id: 'x', object: 'chat.completion.chunk', model: 'assistant', choices: [], usage: { completion_tokens: completion, prompt_tokens: prompt, total_tokens: completion + prompt } });

/** A tiny SSE body (one content delta + usage + [DONE]). */
function sseOk(text = 'hello') {
  const lines = [chunk({ content: text }), usageChunk(1)]
    .map((ev) => `data: ${JSON.stringify(ev)}\n\n`)
    .join('') + 'data: [DONE]\n\n';
  return new Response(lines, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(calls.length - 1);
  };
  calls.restore = () => { globalThis.fetch = realFetch; };
  return calls;
}

function fakeView() {
  const calls = { upsert: [], ends: [] };
  return {
    calls,
    showPath: () => {},
    upsert: (msg) => calls.upsert.push({ id: msg.id, status: msg.status, note: msg.error && msg.error.message }),
    remove: () => {},
    beginStream: () => ({ paint: () => {}, setStatus: () => {}, end: (msg) => calls.ends.push(msg.status) }),
    scrollToMessage: () => {},
    isStuck: () => true,
    setOutsideContext: () => {},
    rowOf: () => null,
    debug: { paintStats: () => ({ count: 0, p50: 0, p95: 0, max: 0 }), renderOneShot: () => null },
  };
}

function fakeComposer() {
  const calls = { busy: [], send: [], focus: 0 };
  return {
    calls,
    setBusy: (v) => calls.busy.push(!!v),
    setSendState: (s) => calls.send.push(s),
    focus: () => { calls.focus += 1; },
    isLocked: () => false,
  };
}

function fakeFarm(seats = { used: 2, slots: 2, clients: 3, idleSec: 900 }) {
  const caps = {
    present: true, id: 'mockfarm0001', name: 'Mock Farm', baseUrl: 'http://farm.test/v1',
    proxyRoot: 'http://farm.test', apiKey: null, requiresKey: false, keyMissing: false,
    healthy: true, stale: false, lastSeen: null, defaultModel: 'assistant',
    models: [{ id: 'assistant', underlying: 'Qwen3.8-27B-UD-Q2_K_XL', default: true }],
    engine: 'llama.cpp', budget: { tokens: 16384, advertised: 16384, source: 'advertised' },
    seats, busy: null, perf: null, gpuUtil: null, search: null, tts: null, ocr: null,
  };
  return {
    caps,
    update: () => {},
    get: () => caps,
    headers: () => ({}),
    fetchModels: async () => ({ ids: ['assistant'], state: 'ok' }),
    modelInfo: (id) => caps.models.find((m) => m.id === id) || null,
    setCapResolver: () => {},
    cap: () => 'unknown',
  };
}

/** Real app + real repo + real governor + real controller, with seat-wait installed on top. */
async function makeWorld({ flags = {}, seats } = {}) {
  const els = { live: { textContent: '' }, strip: null };
  const app = createApp({ root: null, els: /** @type {any} */ (els) });
  app.flags = /** @type {any} */ ({ ...flags });
  app.state.visible = true;
  app.state.pageVisible = true;
  app.repo = openRepoSync({ openPersistent: () => createMemoryBackend({ kind: 'idb' }), bus: app.bus, now: app.now, newId: app.newId });
  const farm = fakeFarm(seats);
  app.farm = /** @type {any} */ (farm);
  app.gov = createGovernor(app);
  app.view = /** @type {any} */ (fakeView());
  app.composer = /** @type {any} */ (fakeComposer());
  app.sidebar = /** @type {any} */ ({ render: () => {}, highlight: () => {} });
  const toasts = [];
  app.dialogs = /** @type {any} */ ({ confirm: async () => true, prompt: async () => '', popover: () => ({ close() {} }), toast: (text) => toasts.push(text) });
  await app.repo.ready;
  app.controller = /** @type {any} */ (createController(app));
  install(app);
  const tick = () => app.bus.emit(EV.FARM_TICK, { caps: farm.caps, now: app.now() });
  return { app, farm, toasts, tick, view: /** @type {any} */ (app.view), composer: /** @type {any} */ (app.composer) };
}

/** The last assistant message in the open thread, straight out of the store. */
async function lastAssistant(app) {
  const path = await app.repo.getPath(app.state.threadId);
  for (let i = path.length - 1; i >= 0; i--) if (path[i].role === 'assistant') return path[i];
  return null;
}

const base = {
  caps: { seats: { used: 0, slots: 2 } },
  visible: true,
  pageVisible: true,
  waitingSince: 1000,
  now: 2000,
  attempts: 1,
  scheduledAt: null,
};

export default (test) => {
  // ------------------------------------------------------------------ the pure decision table
  test('seatDecision: a free seat with nothing scheduled schedules a jittered resend', () => {
    assert.equal(seatDecision({ ...base }), 'schedule');
  });

  test('seatDecision: a schedule that is not due yet waits; a due one resends', () => {
    assert.equal(seatDecision({ ...base, scheduledAt: 2500 }), 'wait');
    assert.equal(seatDecision({ ...base, scheduledAt: 2000 }), 'resend', 'due exactly now counts');
    assert.equal(seatDecision({ ...base, scheduledAt: 1900 }), 'resend');
  });

  test('seatDecision: a full farm waits, however long it has been waiting', () => {
    assert.equal(seatDecision({ ...base, caps: { seats: { used: 2, slots: 2 } } }), 'wait');
    assert.equal(seatDecision({ ...base, caps: { seats: { used: 3, slots: 2 } }, scheduledAt: 1000 }), 'wait');
  });

  test('seatDecision: a hidden chat never takes a seat, and a minimised one does not either', () => {
    assert.equal(seatDecision({ ...base, visible: false }), 'wait', 'the chat surface is hidden');
    assert.equal(seatDecision({ ...base, pageVisible: false }), 'wait', 'the window is minimised');
    assert.equal(seatDecision({ ...base, visible: false, scheduledAt: 1000 }), 'wait',
      'a schedule that came due while hidden must not fire');
  });

  test('seatDecision: seats unknown → manual only (we cannot tell a free farm from a full one)', () => {
    assert.equal(seatDecision({ ...base, caps: { seats: null } }), 'manual');
    assert.equal(seatDecision({ ...base, caps: null }), 'manual');
  });

  test(`seatDecision: ${MAX_ATTEMPTS} refusals hand the decision back to the reader`, () => {
    assert.equal(seatDecision({ ...base, attempts: MAX_ATTEMPTS - 1 }), 'schedule');
    assert.equal(seatDecision({ ...base, attempts: MAX_ATTEMPTS }), 'manual');
    assert.equal(seatDecision({ ...base, attempts: MAX_ATTEMPTS + 3 }), 'manual');
  });

  test('seatDecision: give-up is checked FIRST — it beats hidden, minimised and the attempts cap', () => {
    const old = { ...base, waitingSince: 0, now: DEFAULT_GIVE_UP_MS + 1 };
    assert.equal(seatDecision(old), 'giveup');
    assert.equal(seatDecision({ ...old, visible: false, pageVisible: false }), 'giveup',
      'a forgotten window must not wait for ever');
    assert.equal(seatDecision({ ...old, attempts: 99 }), 'giveup');
    assert.equal(seatDecision({ ...old, caps: { seats: null } }), 'giveup');
    assert.equal(seatDecision({ ...base, waitingSince: 0, now: DEFAULT_GIVE_UP_MS }), 'schedule',
      'exactly at the limit is not yet a give-up');
  });

  test('seatDecision: giveUpMs is overridable (flags.seatGiveUpMs)', () => {
    assert.equal(seatDecision({ ...base, waitingSince: 0, now: 3000, giveUpMs: 2000 }), 'giveup');
    assert.equal(seatDecision({ ...base, waitingSince: 0, now: 1000, giveUpMs: 2000 }), 'schedule');
  });

  // ------------------------------------------------------------------ the note
  test('waitingNote: the farm sentence verbatim, plus the live seat count', () => {
    const note = waitingNote(FARM_SEATS_TEXT, { seats: { used: 2, slots: 2 } });
    assert.ok(note.startsWith(FARM_SEATS_TEXT), `the farm speaks first: ${note}`);
    assert.ok(note.includes('2/2 in use'), note);
    assert.equal(waitingNote(FARM_SEATS_TEXT, { seats: null }), FARM_SEATS_TEXT, 'no seat count → no invented one');
    assert.equal(waitingNote('', { seats: null }), '', 'nothing to say → nothing said');
    assert.equal(waitingNote(null, { seats: null }), '', 'and a missing sentence is not "null"');
  });

  test('waitingNote: recomposing from its own output is IDEMPOTENT by construction', () => {
    // The P2 review's blocker: refreshNote() fed the composed note back in, so every farm snapshot
    // appended the seat sentence again (~225 times over one 15-minute wait). The farm text is a
    // STRING argument now, so feeding the note back in is not even expressible — and the caller
    // keeps it separately. Ten recompositions, one sentence.
    const caps = { seats: { used: 2, slots: 2 } };
    let note = waitingNote(FARM_SEATS_TEXT, caps);
    const first = note;
    for (let i = 0; i < 10; i++) note = waitingNote(FARM_SEATS_TEXT, caps);
    assert.equal(note, first);
    assert.equal(note.split('Waiting for a seat').length - 1, 1, `exactly one seat sentence: ${note}`);
  });

  test('composeNote: the MANUAL states say so, and only the manual states', () => {
    // P2 review, major: `seatDecision` returns 'manual' after MAX_ATTEMPTS (and whenever the farm
    // reports no seats at all), and from then on NOTHING is waiting on the reader's behalf — but
    // refreshNote() went on recomposing "Waiting for a seat — 2/2 in use." for up to the full
    // 15-minute give-up window. The row was lying about its own state.
    const caps = { seats: { used: 2, slots: 2 } };
    const waiting = composeNote({ farmText: FARM_SEATS_TEXT, attempts: 1 }, caps);
    assert.equal(waiting, waitingNote(FARM_SEATS_TEXT, caps), 'while it really is waiting, nothing is added');

    const manual = composeNote({ farmText: FARM_SEATS_TEXT, attempts: MAX_ATTEMPTS }, caps);
    assert.notEqual(manual, waiting, 'the 5th refusal changes what the row says');
    assert.ok(manual.startsWith(FARM_SEATS_TEXT), 'the farm still speaks first');
    assert.ok(/Try now/.test(manual), `and the reader is told what to do: ${manual}`);
    assert.equal(manual.split('Waiting for a seat').length - 1, 1, `still exactly one seat sentence: ${manual}`);
    // It only ever moves again when the READER presses Try now and loses that race too, which is
    // the one time a changed number is news; nothing on the tick path can move it.
    assert.equal(composeNote({ farmText: FARM_SEATS_TEXT, attempts: MAX_ATTEMPTS }, caps), manual, 'deterministic');
    const later = composeNote({ farmText: FARM_SEATS_TEXT, attempts: MAX_ATTEMPTS + 3 }, caps);
    assert.ok(/Try now/.test(later), 'and it is still the manual sentence after more refusals');
    assert.equal(later.split('Waiting for a seat').length - 1, 1, later);

    // Same dead end, other cause: seatDecision('manual') when the farm reports no seats at all.
    const unknown = composeNote({ farmText: FARM_SEATS_TEXT, attempts: 1 }, { seats: null });
    assert.notEqual(unknown, FARM_SEATS_TEXT, 'a farm with no seat gate is not silently waited on');
    assert.ok(/Try now/.test(unknown), unknown);
  });

  test('farmTextOf: the farm own words out of a classified error, never ours', () => {
    assert.equal(farmTextOf({ message: FARM_SEATS_TEXT }), FARM_SEATS_TEXT);
    assert.equal(farmTextOf({ farmMessage: 'farm', message: 'ours' }), 'farm', 'farmMessage wins');
    assert.equal(farmTextOf(null), '');
    assert.equal(farmTextOf({ message: 42 }), '', 'a non-string is not a sentence');
  });

  // ------------------------------------------------------------------ the real thing
  test('a 429 turns the reply into a waiting row, holds the governor, and sends nothing more', async () => {
    const { app, tick, composer } = await makeWorld({ flags: { seatJitterMs: 0 } });
    const calls = stubFetch(() => seatsFullResponse());
    try {
      await app.controller.send({ text: 'hello farm', parts: [], model: 'assistant' });
      await settle();

      const msg = await lastAssistant(app);
      assert.equal(msg.status, 'waiting');
      assert.ok(msg.error.message.includes(FARM_SEATS_TEXT), msg.error.message);
      assert.ok(msg.error.message.includes('2/2 in use'), msg.error.message);
      assert.deepEqual(app.gov.state(), { foreground: 'held', holder: msg.id }, 'the seat wait owns the slot');
      assert.equal(app.gov.acquire('foreground', { holder: 'send' }), null, 'a second send cannot jump the queue');
      assert.equal(composer.calls.busy[composer.calls.busy.length - 1], true, 'Stop stays on screen');
      assert.ok(composer.calls.send.some((s) => s.label === 'Waiting for a seat…' && s.disabled === true),
        `the Send label says what is happening: ${JSON.stringify(composer.calls.send)}`);

      // Five ticks on a still-full farm: not one extra request.
      for (let i = 0; i < 5; i++) { tick(); await settle(); }
      assert.equal(calls.length, 1, 'zero timer retries — the snapshot decides');
      assert.equal(app.seatWait.state().attempts, 1);
    } finally { calls.restore(); }
  });

  test('a freed seat resends exactly once, on a later tick, and the answer lands', async () => {
    const { app, farm, tick } = await makeWorld({ flags: { seatJitterMs: 0 } });
    const calls = stubFetch((n) => (n === 0 ? seatsFullResponse() : sseOk('at last')));
    try {
      await app.controller.send({ text: 'hello farm', parts: [], model: 'assistant' });
      await settle();
      assert.equal(calls.length, 1);

      farm.caps.seats = { used: 1, slots: 2, clients: 2, idleSec: 900 };
      tick();                                   // schedules (jitter 0)
      await settle();
      assert.equal(calls.length, 1, 'the jitter is resolved on the NEXT tick, not with a timer');
      assert.ok(app.seatWait.state().scheduledAt != null, 'a resend is scheduled');

      tick();                                   // due → resend
      await settle();
      assert.equal(calls.length, 2, 'exactly one more request');

      const msg = await lastAssistant(app);
      assert.equal(msg.status, 'done');
      assert.equal(msg.content, 'at last');
      assert.equal(msg.error, null, 'the waiting note is gone');
      assert.equal(app.seatWait.state(), null, 'nothing is waiting any more');
      assert.deepEqual(app.gov.state(), { foreground: 'idle', holder: null }, 'the slot came back');

      for (let i = 0; i < 3; i++) { tick(); await settle(); }
      assert.equal(calls.length, 2, 'and the wait does not restart itself');
    } finally { calls.restore(); }
  });

  test('a hidden or minimised chat does not take the freed seat; coming back does', async () => {
    const { app, farm, tick } = await makeWorld({ flags: { seatJitterMs: 0 } });
    const calls = stubFetch((n) => (n === 0 ? seatsFullResponse() : sseOk('welcome back')));
    try {
      await app.controller.send({ text: 'hello farm', parts: [], model: 'assistant' });
      await settle();
      app.state.pageVisible = false;                       // the window was minimised
      farm.caps.seats = { used: 0, slots: 2, clients: 1, idleSec: 900 };
      for (let i = 0; i < 4; i++) { tick(); await settle(); }
      assert.equal(calls.length, 1, 'a window nobody is looking at must not hold a seat');
      assert.equal(app.seatWait.state().scheduledAt, null, 'no schedule survives going away');

      app.state.pageVisible = true;
      tick(); await settle();                              // schedule
      tick(); await settle();                              // resend
      assert.equal(calls.length, 2);
      assert.equal((await lastAssistant(app)).status, 'done');
    } finally { calls.restore(); }
  });

  test('Stop cancels the wait, keeps the note, and gives the slot back', async () => {
    const { app, farm, tick } = await makeWorld({ flags: { seatJitterMs: 0 } });
    const calls = stubFetch(() => seatsFullResponse());
    try {
      await app.controller.send({ text: 'hello farm', parts: [], model: 'assistant' });
      await settle();
      assert.equal(app.controller.stop(), true, 'Stop found the cancel handler');
      await settle();

      const msg = await lastAssistant(app);
      assert.equal(msg.status, 'aborted');
      assert.ok(msg.error.message.includes(FARM_SEATS_TEXT), `the reason is kept: ${msg.error.message}`);
      assert.ok(msg.error.message.includes('Stopped waiting'), msg.error.message);
      assert.deepEqual(app.gov.state(), { foreground: 'idle', holder: null });
      assert.equal(app.seatWait.state(), null);

      farm.caps.seats = { used: 0, slots: 2, clients: 1, idleSec: 900 };
      for (let i = 0; i < 4; i++) { tick(); await settle(); }
      assert.equal(calls.length, 1, 'a cancelled wait never wakes up again');
      assert.equal(app.controller.stop(), false, 'and the cancel handler is no longer active');
    } finally { calls.restore(); }
  });

  test('give-up: after seatGiveUpMs the row becomes a readable error and Send comes back', async () => {
    const { app, tick } = await makeWorld({ flags: { seatJitterMs: 0, seatGiveUpMs: 1 } });
    const calls = stubFetch(() => seatsFullResponse());
    try {
      await app.controller.send({ text: 'hello farm', parts: [], model: 'assistant' });
      await settle();
      assert.equal((await lastAssistant(app)).status, 'waiting');
      await sleep(5);
      tick(); await settle();

      const msg = await lastAssistant(app);
      assert.equal(msg.status, 'error');
      assert.ok(/Gave up waiting for a seat/.test(msg.error.message), msg.error.message);
      assert.deepEqual(app.gov.state(), { foreground: 'idle', holder: null }, 'Send is usable again');
      assert.equal(app.seatWait.state(), null);
      assert.equal(calls.length, 1);
    } finally { calls.restore(); }
  });

  test('“Try now” resends immediately, and a second 429 counts as another attempt', async () => {
    const { app } = await makeWorld({ flags: { seatJitterMs: 0 } });
    const calls = stubFetch((n) => (n < 2 ? seatsFullResponse() : sseOk('finally')));
    try {
      await app.controller.send({ text: 'hello farm', parts: [], model: 'assistant' });
      await settle();
      assert.equal(app.seatWait.state().attempts, 1);

      await app.seatWait.tryNow();
      await settle();
      assert.equal(calls.length, 2);
      assert.equal(app.seatWait.state().attempts, 2, 'the refusal came back to the same handler');
      assert.equal((await lastAssistant(app)).status, 'waiting');
      assert.equal(app.gov.state().foreground, 'held', 'still holding the slot for this reader');

      await app.seatWait.tryNow();
      await settle();
      assert.equal(calls.length, 3);
      assert.equal((await lastAssistant(app)).status, 'done');
      assert.equal(app.seatWait.state(), null);
    } finally { calls.restore(); }
  });

  test('a FARM_CHANGE + FARM_TICK pair does not forget the schedule it just made', async () => {
    // One publish emits BOTH events back to back. The first schedules the jittered resend; the
    // second used to see "scheduled, not due yet" (a 'wait' verdict) and clear it, so the resend
    // never fired at all — p2-seat-wait caught it 4 runs out of 5.
    const { app, farm } = await makeWorld({ flags: { seatJitterMs: 5000 } });
    const calls = stubFetch((n) => (n === 0 ? seatsFullResponse() : sseOk('at last')));
    try {
      await app.controller.send({ text: 'hello farm', parts: [], model: 'assistant' });
      await settle();
      farm.caps.seats = { used: 0, slots: 2, clients: 1, idleSec: 900 };

      app.bus.emit(EV.FARM_CHANGE, { caps: farm.caps, prev: null, changed: ['seats'] });
      await settle();
      const scheduled = app.seatWait.state().scheduledAt;
      assert.ok(scheduled != null, 'the change scheduled a resend');

      app.bus.emit(EV.FARM_TICK, { caps: farm.caps, now: app.now() });
      await settle();
      assert.equal(app.seatWait.state().scheduledAt, scheduled, 'the twin event kept it');
      assert.equal(calls.length, 1, 'and did not fire it early either');

      // A full farm, or a chat nobody is looking at, DOES cancel it.
      farm.caps.seats = { used: 2, slots: 2, clients: 3, idleSec: 900 };
      app.bus.emit(EV.FARM_TICK, { caps: farm.caps, now: app.now() });
      await settle();
      assert.equal(app.seatWait.state().scheduledAt, null, 'the reason to hurry is gone');
    } finally { calls.restore(); }
  });

  test('the note NEVER grows: ten snapshots on a still-full farm leave it byte-identical', async () => {
    // The P2 review's blocker, end to end. refreshNote() used to recompose from msg.error.message
    // — which IS the note — so the equality guard could never fire: every FARM_TICK appended
    // "Waiting for a seat — 2/2 in use." again AND wrote the message to the store.
    const { app, tick, view } = await makeWorld({ flags: { seatJitterMs: 0 } });
    const calls = stubFetch(() => seatsFullResponse());
    try {
      await app.controller.send({ text: 'hello farm', parts: [], model: 'assistant' });
      await settle();
      const first = (await lastAssistant(app)).error.message;
      const upsertsAfterFirst = view.calls.upsert.length;

      for (let i = 0; i < 10; i++) { tick(); await settle(); }

      const after = (await lastAssistant(app)).error.message;
      assert.equal(after, first, `byte-identical after ten ticks (was ${after.length} chars, ${first.length} expected)`);
      assert.equal(after.split('Waiting for a seat').length - 1, 1, `exactly one seat sentence: ${after}`);
      assert.equal(view.calls.upsert.length, upsertsAfterFirst,
        'and an unchanged sentence costs neither a repaint nor a store write');
      assert.equal(calls.length, 1);
    } finally { calls.restore(); }
  });

  test('the note changes exactly ONCE — at the fifth refusal — and is stable on both sides of it', async () => {
    // The end-to-end half of composeNote: five lost races (every resend gets the farm's 429 back)
    // and the row must stop claiming a seat is being waited for. A 4-6 person office farm loses
    // five jitter races routinely, which is the very situation this unit exists for.
    // The farm advertises a free seat throughout (the seat count in the note therefore never moves
    // on its own), and every resend still comes back 429 — this client keeps losing the race.
    const { app, tick } = await makeWorld({ flags: { seatJitterMs: 0 }, seats: { used: 0, slots: 2, clients: 1, idleSec: 900 } });
    const calls = stubFetch(() => seatsFullResponse());
    try {
      await app.controller.send({ text: 'hello farm', parts: [], model: 'assistant' });
      await settle();
      assert.equal(app.seatWait.state().attempts, 1);
      const waitingText = (await lastAssistant(app)).error.message;

      /** @type {string[]} */ const seen = [];
      for (let i = 0; i < 14; i++) {
        tick();
        await settle();
        seen.push((await lastAssistant(app)).error.message);
      }

      const state = app.seatWait.state();
      assert.equal(state.attempts, MAX_ATTEMPTS, `five attempts and then nothing automatic: ${JSON.stringify(state)}`);
      assert.equal(calls.length, MAX_ATTEMPTS, 'exactly one request per attempt, and no sixth');

      const distinct = [waitingText, ...seen].filter((text, i, all) => i === 0 || text !== all[i - 1]);
      assert.equal(distinct.length, 2, `the note changes exactly once: ${JSON.stringify(distinct)}`);
      assert.equal(distinct[0], waitingText);
      assert.ok(/Try now/.test(distinct[1]), `and the new sentence says what to do: ${distinct[1]}`);
      assert.equal(seen[seen.length - 1], distinct[1], 'then it is stable for the rest of the wait');
      assert.equal(app.gov.state().foreground, 'held', 'the slot is still held, so Stop still works');
    } finally { calls.restore(); }
  });

  test('deleting the waiting row abandons the wait: no lock, no resurrection, no request', async () => {
    // P2 review, major: realTurn() offered Delete on a waiting row, and the wait held a captured
    // object. Deleting it left the governor held for ever (Send gone, Stop showing, on a message
    // that no longer exists), and a freed seat then generated INTO the deleted row and wrote it
    // back through paint(). Both halves are closed here — this test drives the store directly, so
    // it still fails if the UI ever offers Delete on a waiting row again.
    const { app, farm, tick } = await makeWorld({ flags: { seatJitterMs: 0 } });
    const calls = stubFetch((n) => (n === 0 ? seatsFullResponse() : sseOk('should never be asked')));
    try {
      await app.controller.send({ text: 'hello farm', parts: [], model: 'assistant' });
      await settle();
      const msg = await lastAssistant(app);
      assert.equal(msg.status, 'waiting');
      assert.equal(app.gov.state().foreground, 'held');

      await app.repo.deleteSubtree(msg.id);
      await settle();
      tick(); await settle();

      assert.equal(app.seatWait.state(), null, 'the wait let go of a message that is gone');
      assert.deepEqual(app.gov.state(), { foreground: 'idle', holder: null }, 'the composer is free again');

      // A seat frees: nothing may be sent, and the deleted row must stay deleted.
      farm.caps.seats = { used: 0, slots: 2, clients: 1, idleSec: 900 };
      for (let i = 0; i < 4; i++) { tick(); await settle(); }
      assert.equal(calls.length, 1, 'a deleted turn is never re-sent');
      const rows = await app.repo.getMessages(app.state.threadId);
      assert.deepEqual(rows.map((m) => `${m.role}:${m.status}`), ['user:done'],
        `the deleted assistant row did not come back: ${JSON.stringify(rows.map((m) => m.id))}`);
    } finally { calls.restore(); }
  });

  test('cancelling a wait whose row was deleted writes nothing back', async () => {
    const { app } = await makeWorld({ flags: { seatJitterMs: 0 } });
    const calls = stubFetch(() => seatsFullResponse());
    try {
      await app.controller.send({ text: 'hello farm', parts: [], model: 'assistant' });
      await settle();
      const msg = await lastAssistant(app);
      await app.repo.deleteSubtree(msg.id);
      await settle();

      await app.seatWait.cancel();                 // Stop, before any tick noticed the delete
      await settle();

      const rows = await app.repo.getMessages(app.state.threadId);
      assert.deepEqual(rows.map((m) => m.role), ['user'], 'Stop did not resurrect the row');
      assert.deepEqual(app.gov.state(), { foreground: 'idle', holder: null });
    } finally { calls.restore(); }
  });

  test('the note is rewritten as the seat count moves (so the cached row repaints)', async () => {
    const { app, farm, tick, view } = await makeWorld({ flags: { seatJitterMs: 0 } });
    const calls = stubFetch(() => seatsFullResponse());
    try {
      await app.controller.send({ text: 'hello farm', parts: [], model: 'assistant' });
      await settle();
      const before = (await lastAssistant(app)).error.message;
      assert.ok(before.includes('2/2 in use'));

      farm.caps.seats = { used: 3, slots: 3, clients: 4, idleSec: 900 };
      tick(); await settle();
      const after = (await lastAssistant(app)).error.message;
      assert.ok(after.includes('3/3 in use'), after);
      assert.ok(view.calls.upsert.some((u) => u.note && u.note.includes('3/3 in use')), 'the view was told');
      assert.equal(calls.length, 1, 'rewriting a sentence is not a retry');
    } finally { calls.restore(); }
  });

  test('a message action pair rides on the waiting row only', async () => {
    const { app } = await makeWorld();
    const items = app.registry.list(app.SLOTS.MESSAGE_ACTIONS).filter((a) => a.id.startsWith('seat-'));
    assert.deepEqual(items.map((a) => a.id), ['seat-try-now', 'seat-cancel']);
    assert.deepEqual(items.map((a) => a.label), ['Try now', 'Cancel']);
    for (const a of items) {
      assert.equal(a.visible({ status: 'waiting' }), true);
      assert.equal(a.visible({ status: 'error' }), false);
      assert.equal(a.visible({ status: 'done' }), false);
      assert.equal(a.visible(null), false);
    }
  });

  // ------------------------------------------------------------------ ui/strip.mjs (pure half)
  test('stripFields: only what is KNOWN, in order, and never a dash', () => {
    const caps = {
      present: true, stale: false, lastSeen: null, keyMissing: false, engine: 'llama.cpp',
      models: [{ id: 'assistant', underlying: 'Qwen3.8-27B-UD-Q2_K_XL', default: true }],
      seats: { used: 1, slots: 2 }, gpuUtil: 3, perf: { lastGenTokSec: 48 }, busy: null,
    };
    const fields = stripFields({ caps, model: 'assistant', now: 1000 });
    assert.deepEqual(fields.map((f) => f.id), ['model', 'engine', 'seats', 'gpu', 'tokSec']);
    assert.deepEqual(fields.map((f) => f.text), [
      'assistant (Qwen3.8-27B-UD-Q2_K_XL)', 'llama.cpp', '1/2 seats', 'GPU 3%', '48 tok/s',
    ]);

    const bare = stripFields({ caps: { ...caps, gpuUtil: null, perf: null, seats: null, engine: null }, model: 'assistant', now: 1000 });
    assert.deepEqual(bare.map((f) => f.id), ['model']);
    assert.ok(!bare.some((f) => /[—–-]\s*$/.test(f.text)), 'a missing value is ABSENT, not a dash');

    assert.deepEqual(stripFields({ caps: null, model: 'assistant', now: 1 }), []);
    assert.deepEqual(stripFields({ caps: { present: false }, model: 'assistant', now: 1 }), []);
  });

  test('stripFields: a model whose underlying is the same name is shown once', () => {
    const caps = { present: true, models: [{ id: 'gemma4:12b', underlying: 'gemma4:12b' }], seats: null, perf: null, gpuUtil: null, engine: 'ollama' };
    const fields = stripFields({ caps, model: 'gemma4:12b', now: 1 });
    assert.equal(fields.find((f) => f.id === 'model').text, 'gemma4:12b');
  });

  test('stripFields: "farm silent" comes from _stale OR an old lastSeen, and leads the line', () => {
    const base2 = { present: true, models: [], seats: { used: 1, slots: 2 }, perf: null, gpuUtil: null, engine: 'llama.cpp' };
    const stale = stripFields({ caps: { ...base2, stale: true }, model: null, now: 1000 });
    assert.equal(stale[0].id, 'silent');
    assert.equal(stale[0].text, 'farm silent');

    const old2 = { ...base2, stale: false, lastSeen: 1000 };
    assert.equal(stripFields({ caps: old2, model: null, now: 1000 + SILENT_AFTER_MS })[0].id, 'engine',
      'exactly at the limit the farm is not yet silent');
    assert.equal(stripFields({ caps: old2, model: null, now: 1001 + SILENT_AFTER_MS })[0].id, 'silent');
  });

  test('stripFields: password needed, and the busy label with its percent', () => {
    const caps = {
      present: true, keyMissing: true, models: [], seats: null, perf: null, gpuUtil: null,
      engine: null, busy: { label: 'switching model', percent: 42 },
    };
    const fields = stripFields({ caps, model: null, now: 1 });
    assert.deepEqual(fields.map((f) => f.id), ['key', 'busy']);
    assert.equal(fields[0].text, 'password needed');
    assert.equal(fields[1].text, 'switching model (42%)');
    const noPercent = stripFields({ caps: { ...caps, busy: { label: 'restarting', percent: null } }, model: null, now: 1 });
    assert.equal(noPercent[1].text, 'restarting');
  });

  // ------------------------------------------------------------------ ui/notify.mjs (pure half)
  test('shouldNotify: only a finished answer, only in the background, only when it took a while', () => {
    const on = { status: 'done', durationMs: 9000, focused: false, enabled: true, afterMs: 8000 };
    assert.equal(shouldNotify(on), true);
    assert.equal(shouldNotify({ ...on, status: 'aborted' }), true, 'the reader stopped it and may be elsewhere');
    assert.equal(shouldNotify({ ...on, status: 'error' }), false, 'an error needs the screen, not a toast');
    assert.equal(shouldNotify({ ...on, focused: true }), false, 'never for a window you are looking at');
    assert.equal(shouldNotify({ ...on, enabled: false }), false);
    assert.equal(shouldNotify({ ...on, durationMs: 8000 }), false, 'exactly at the threshold is not "a while"');
    assert.equal(shouldNotify({ ...on, durationMs: null }), false);
  });

  test('teaser: one line, at most 80 characters', () => {
    assert.equal(teaser('  hello \n  there  '), 'hello there');
    const long = 'x'.repeat(200);
    assert.equal(teaser(long).length, BODY_CHARS + 1, 'the ellipsis is the 81st character');
    assert.ok(teaser(long).endsWith('…'));
    assert.equal(teaser(null), '');
  });

  test('install(app) survives a half-built app (a feature may never throw the chat down)', () => {
    const app = createApp({ root: null, els: /** @type {any} */ ({}) });
    assert.doesNotThrow(() => install(/** @type {any} */ (app)));
    app.bus.emit(EV.FARM_TICK, { caps: null, now: 1 });
    app.bus.emit(EV.FARM_CHANGE, { caps: null, prev: null, changed: [] });
    assert.equal(app.seatWait.state(), null);
  });
};
