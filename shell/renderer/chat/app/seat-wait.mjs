// @ts-check
// Waiting for a seat, the way a colleague would (plan §4 P2-U1, §3.9). A FEATURE: install(app).
//
// The farm's seat gate (farm/src/seats.js) answers a completion on a full farm with 429
// `lol_seats_full` instead of queueing it. v0.1.45 turned that into "[error: HTTP 429]" and left
// the reader to re-press Send — which is the worst possible behaviour on a shared box: everyone
// hammers, nobody is first, and the farm sees a retry storm.
//
// What this does instead:
//   - the failed reply row BECOMES the waiting row (status 'waiting'): the farm's own sentence,
//     plus how many seats are in use right now, with two buttons — Cancel and Try now;
//   - the governor is HELD on that message id, so Send refuses (the composer derives its busy
//     state from the governor, §2.6 AF) and Stop cancels the wait;
//   - NOTHING retries on a timer. The decision is re-evaluated on every FARM_TICK / FARM_CHANGE —
//     i.e. whenever the farm's own snapshot arrives (§3.9) — and the farm's snapshot is what says
//     a seat freed. A small jitter (rng, seeded in tests) is RESOLVED on those same ticks, so two
//     clients waiting on the same farm do not pounce in the same millisecond, and there is still
//     not one setTimeout in the wall-clock path.
//   - a minimised or hidden chat never takes a seat: `app.state.visible && app.state.pageVisible`
//     is the gate, so a window nobody is looking at cannot hold a seat for 15 minutes.
//
// The decision itself is a PURE function (`seatDecision`), which is what the unit test tables
// drive; install(app) is only the wiring that feeds it the live values.

import { EV } from '../core/events.mjs';
import { SLOTS } from '../core/registry.mjs';
import { t } from '../core/i18n.mjs';
import '../strings/etiquette.en.mjs';
import '../strings/core.en.mjs';
import '../strings/dialogs.en.mjs';

/** Stop waiting after this long with no seat (overridable with flags.seatGiveUpMs). */
export const DEFAULT_GIVE_UP_MS = 15 * 60 * 1000;
/** Spread simultaneous waiters over this window (flags.seatJitterMs). */
export const DEFAULT_JITTER_MS = 5000;
/** After this many refused attempts the reader decides, not us. */
export const MAX_ATTEMPTS = 5;

/**
 * PURE. What a waiting message should do at this instant.
 *
 * Order matters and the unit table pins it:
 *   1. give-up beats everything, INCLUDING being hidden (a forgotten tab must not wait for ever);
 *   2. too many refusals → the reader presses Try now;
 *   3. seats unknown → we cannot tell a free farm from a full one, so we never guess;
 *   4. nobody is looking → wait (and the caller drops any pending schedule);
 *   5. a seat is free and nothing is scheduled → schedule one, jittered;
 *   6. a seat is free and the schedule is due → resend.
 *
 * @param {{caps: any, visible: boolean, pageVisible: boolean, waitingSince: number, now: number,
 *          attempts: number, scheduledAt: number|null, giveUpMs?: number}} o
 * @returns {'resend'|'schedule'|'wait'|'giveup'|'manual'}
 */
export function seatDecision(o) {
  const giveUpMs = Number.isFinite(o.giveUpMs) ? Number(o.giveUpMs) : DEFAULT_GIVE_UP_MS;
  if (o.now - o.waitingSince > giveUpMs) return 'giveup';
  if (Number(o.attempts) >= MAX_ATTEMPTS) return 'manual';
  const seats = o.caps && o.caps.seats;
  if (!seats) return 'manual';
  if (!(o.visible && o.pageVisible)) return 'wait';
  const free = Number(seats.used) < Number(seats.slots);
  if (!free) return 'wait';
  if (o.scheduledAt == null) return 'schedule';
  return o.now >= o.scheduledAt ? 'resend' : 'wait';
}

/**
 * The whole sentence in the waiting row, for a wait in a given state.
 *
 * Three states, three sentences, all composed from STORED sources (§2.6 AZ.1):
 *   - waiting, seats known      → the farm's words + the live seat count;
 *   - MANUAL (attempts >= MAX)  → …and "nothing is waiting for you any more, press Try now";
 *   - seats unknown             → the same, because `seatDecision` returns 'manual' there too.
 * The row used to go on saying "Waiting for a seat — 2/2 in use" for the rest of the 15 minutes
 * after the 5th refusal, while nothing was waiting on the reader's behalf at all (P2 review).
 *
 * @param {{farmText: string, attempts: number}} w
 * @param {any} caps
 * @returns {string}
 */
export function composeNote(w, caps) {
  const base = waitingNote(w && w.farmText, caps);
  const attempts = Number(w && w.attempts) || 0;
  const seats = caps && caps.seats;
  if (attempts >= MAX_ATTEMPTS) return [base, t('etiquette.waitingManual', { attempts })].filter(Boolean).join(' ');
  if (!seats) return [base, t('etiquette.waitingUnknown')].filter(Boolean).join(' ');
  return base;
}

/**
 * The sentence in the waiting row: the farm's own words, plus what the client knows.
 *
 * `farm` is the farm's OWN sentence and nothing else — never the note this function produced last
 * time. Passing the composed note back in is what made the seat line re-append itself on every
 * snapshot (found in the P2 review: ~225 appends over one 15-minute wait, one store write each),
 * so the caller keeps the farm text verbatim and recomposes from it.
 *
 * @param {string|null|undefined} farm the farm's 429 sentence
 * @param {any} caps
 * @returns {string}
 */
export function waitingNote(farm, caps) {
  const farmText = typeof farm === 'string' ? farm : '';
  const seats = caps && caps.seats;
  const mine = seats ? t('etiquette.waitingSeats', { used: seats.used, slots: seats.slots }) : '';
  return [farmText, mine].filter(Boolean).join(' ');
}

/** The farm's own sentence out of a classified error (never our composed note). @param {any} err */
export function farmTextOf(err) {
  if (!err) return '';
  const raw = err.farmMessage != null ? err.farmMessage : err.message;
  return typeof raw === 'string' ? raw : '';
}

/** @param {any} app */
export function install(app) {
  /**
   * The ONE wait in flight (there is one foreground slot, so there can only be one).
   * @type {{msg: any, threadId: string, since: number, attempts: number, scheduledAt: number|null,
   *         resending: boolean, farmText: string}|null}
   */
  let waiting = null;
  /** Harness-visible bookkeeping (never a behaviour input). */
  let ticks = 0;
  /** @type {string|null} */ let lastDecision = null;
  /** @type {any} */ let lastInput = null;

  const flags = (app.flags || {});
  const giveUpMs = Number.isFinite(Number(flags.seatGiveUpMs)) ? Number(flags.seatGiveUpMs) : DEFAULT_GIVE_UP_MS;
  const jitterMs = Number.isFinite(Number(flags.seatJitterMs)) ? Number(flags.seatJitterMs) : DEFAULT_JITTER_MS;

  const caps = () => (app.farm && typeof app.farm.get === 'function' ? app.farm.get() : null);

  /** Write the row through the store AND the view, so a repaint and a reload agree. */
  async function paint(msg) {
    msg.updatedAt = app.now();
    if (app.repo && typeof app.repo.putMessage === 'function') {
      try { await app.repo.putMessage(msg); } catch (err) { console.warn('[lolchat] seat-wait: putMessage failed', err); }
    }
    // Only paint into the thread that is on screen. The wait outlives a thread switch (the hold
    // does too), and an unguarded upsert dropped the waiting row into whatever conversation the
    // reader had moved to — including a brand new, empty one (found at the P2 landing).
    if (app.view && (!msg.threadId || msg.threadId === app.state.threadId)) app.view.upsert(msg);
  }

  /**
   * The Send label the composer had before the wait took it over. Captured rather than assumed,
   * because another feature owns that label too: P2-U2's cost gate writes "Send · ~3 338 tokens"
   * there, and coming back from a seat wait must not silently reset it to the bare word.
   * @type {string|null}
   */
  let labelBeforeWait = null;

  /**
   * Is the message this wait is about still in the store?
   *
   * A wait holds a captured object, and the reader can delete the row (or the whole thread) out
   * from under it. Without this, cancelling wrote the deleted record back, and a freed seat had
   * `resend()` generate INTO a message nobody can see — the row came back from the dead (P2 review).
   * Unknowable (no repo, a throwing read) counts as "still there": we never abandon on a guess.
   * @param {any} w @returns {Promise<boolean>}
   */
  async function stillThere(w) {
    const repo = app.repo;
    if (!w || !repo || typeof repo.getMessages !== 'function') return true;
    try {
      const rows = await repo.getMessages(w.threadId);
      if (!Array.isArray(rows)) return true;
      return rows.some((m) => m && m.id === w.msg.id);
    } catch (err) {
      console.warn('[lolchat] seat-wait: could not re-read the waiting message', err);
      return true;
    }
  }

  /** The row (or its thread) is gone: drop the wait silently and hand the composer back. */
  function abandon(w) {
    if (!w || waiting !== w) return;
    waiting = null;
    releaseHold(w.msg.id);
  }

  /** Hand the foreground slot back and let the composer's Send label come home. */
  function releaseHold(msgId) {
    if (app.gov) app.gov.release(msgId);
    if (app.composer) app.composer.setSendState({ label: labelBeforeWait || t('core.send'), disabled: false });
    labelBeforeWait = null;
  }

  /** @param {'cancel'|'giveup'} how */
  async function stopWaiting(how) {
    const w = waiting;
    if (!w) return false;
    waiting = null;
    const msg = w.msg;
    if (how === 'giveup') {
      const minutes = Math.max(1, Math.round((app.now() - w.since) / 60000));
      msg.status = 'error';
      msg.error = { kind: 'seats_full', code: 'lol_seats_full', message: t('etiquette.gaveUp', { minutes }), retryAfter: null };
    } else {
      msg.status = 'aborted';
      // The note is KEPT (plan §4 P2-U1): the reader must still see WHY nothing was answered.
      const previous = msg.error && msg.error.message ? String(msg.error.message) : '';
      msg.error = {
        kind: 'seats_full',
        code: 'lol_seats_full',
        message: [previous, t('etiquette.cancelled')].filter(Boolean).join(' '),
        retryAfter: null,
      };
    }
    releaseHold(msg.id);
    // The reader may have deleted the row while it waited; painting it would write it back.
    if (await stillThere(w)) await paint(msg);
    return true;
  }

  /** Ask again, right now: the hold becomes the stream (governor: same holder). */
  async function resend(w) {
    if (!w || w.resending || !app.controller) return null;
    // Claimed SYNCHRONOUSLY, before the first await: two snapshots landing back to back must not
    // both get past this line and send the same turn twice.
    w.resending = true;
    if (!(await stillThere(w))) { w.resending = false; abandon(w); return null; }
    w.scheduledAt = null;
    try {
      return await app.controller.generate({ threadId: w.threadId, into: w.msg, holder: w.msg.id });
    } catch (err) {
      console.warn('[lolchat] seat-wait: resend failed', err);
      return null;
    } finally {
      // A 429 re-enters the error handler below and re-arms `waiting` with attempts+1; anything
      // else (a real answer, a different error) has already left the waiting state behind.
      if (waiting === w) w.resending = false;
    }
  }

  // ---- the 429 handler ------------------------------------------------------------------------
  app.registry.add(SLOTS.ERROR_HANDLERS, {
    id: 'seats-full',
    order: 100,
    /** @param {any} err @param {any} msg @returns {Promise<boolean>} */
    async handle(err, msg, _app) {
      if (!err || err.kind !== 'seats_full' || !msg) return false;
      const c = caps();
      const already = waiting && waiting.msg === msg ? waiting : null;
      // The farm's OWN sentence, kept verbatim and separately: the composed note goes into
      // msg.error.message and must never be fed back into waitingNote() (see refreshNote).
      const farmText = farmTextOf(err) || (already ? already.farmText : '');
      waiting = {
        msg,
        threadId: msg.threadId,
        since: already ? already.since : app.now(),
        attempts: (already ? already.attempts : 0) + 1,
        scheduledAt: null,
        resending: false,
        farmText,
      };
      msg.status = 'waiting';
      msg.error = {
        kind: 'seats_full',
        code: err.code || 'lol_seats_full',
        farmMessage: farmText,
        message: composeNote(waiting, c),
        retryAfter: err.retryAfter == null ? null : err.retryAfter,
      };
      // Held on the MESSAGE id: the composer refuses a second send (§2.6 AF), Stop cancels through
      // the cancel handler below, and the resend's acquire() — same holder — turns the hold into
      // the stream instead of being refused.
      // The note the COMPOSER shows when the reader presses Enter anyway: "a reply is already
      // running" is false here — nothing is running, this client is queued (P2 review).
      if (app.gov) app.gov.hold(msg.id, { note: t('etiquette.refusedWaiting') });
      if (app.composer) {
        if (labelBeforeWait == null) {
          const send = app.els && app.els.send;
          labelBeforeWait = send && send.textContent ? String(send.textContent) : null;
        }
        app.composer.setSendState({ label: t('etiquette.sendWaiting'), disabled: true });
      }
      await paint(msg);
      return true;
    },
  });

  // ---- Stop / Esc while nothing streams --------------------------------------------------------
  app.registry.add(SLOTS.CANCEL_HANDLERS, {
    id: 'seat-wait',
    order: 100,
    active: () => !!waiting,
    cancel: () => { void stopWaiting('cancel'); },
  });

  // ---- the two buttons on the waiting row ------------------------------------------------------
  const onWaitingRow = (/** @type {any} */ msg) => !!(msg && msg.status === 'waiting');

  app.registry.add(SLOTS.MESSAGE_ACTIONS, {
    id: 'seat-try-now',
    order: 40,
    icon: null,
    label: t('etiquette.tryNow'),
    visible: onWaitingRow,
    run: (/** @type {any} */ msg) => {
      // Only the row that IS the current wait can resend: a 'waiting' row left in the store by a
      // previous session has no wait behind it any more.
      if (waiting && msg && waiting.msg.id === msg.id) void resend(waiting);
    },
  });

  app.registry.add(SLOTS.MESSAGE_ACTIONS, {
    id: 'seat-cancel',
    order: 41,
    icon: null,
    label: t('dialogs.cancel'),
    visible: onWaitingRow,
    run: () => { void stopWaiting('cancel'); },
  });

  // ---- the heartbeat: every farm snapshot, and nothing else ------------------------------------
  async function onTick() {
    ticks += 1;
    const w = waiting;
    if (!w || w.resending) return;
    const c = caps();
    const input = {
      caps: c,
      visible: !!app.state.visible,
      pageVisible: !!app.state.pageVisible,
      waitingSince: w.since,
      now: app.now(),
      attempts: w.attempts,
      scheduledAt: w.scheduledAt,
      giveUpMs,
    };
    const decision = seatDecision(input);
    lastDecision = decision;
    lastInput = {
      seats: input.caps && input.caps.seats, visible: input.visible, pageVisible: input.pageVisible,
      attempts: input.attempts, scheduledAt: input.scheduledAt, waitedMs: input.now - input.waitingSince, giveUpMs,
    };
    if (decision === 'giveup') { await stopWaiting('giveup'); return; }
    if (decision === 'manual') { w.scheduledAt = null; return; }
    if (decision === 'wait') {
      // 'wait' covers THREE situations and only two of them cancel a pending resend: nobody is
      // looking any more, or the farm filled up again. The third — a jittered schedule that is
      // simply not due yet — must survive, or the wait never fires at all.
      //
      // This is not theoretical: one publish emits FARM_CHANGE *and* FARM_TICK back to back, so a
      // blanket `scheduledAt = null` here made the pair "schedule, then immediately forget" and the
      // resend never happened (caught by p2-seat-wait, 4 runs out of 5).
      const seats = c && c.seats;
      const free = !!seats && Number(seats.used) < Number(seats.slots);
      const lookedAt = !!(app.state.visible && app.state.pageVisible);
      if (!free || !lookedAt) w.scheduledAt = null;
      return;
    }
    if (decision === 'schedule') {
      w.scheduledAt = app.now() + Math.floor(app.rng() * jitterMs);
      return;
    }
    if (decision === 'resend') await resend(w);
  }

  // The note carries the live seat count, so it is rewritten whenever the snapshot moves
  // (thread-view's revOf includes error.message — §2.6 AG — so the cached row really repaints).
  function refreshNote() {
    const w = waiting;
    if (!w || w.resending || w.msg.status !== 'waiting') return;
    // Recomposed from the STORED farm sentence, never from the note we wrote last tick — that is
    // what appended "Waiting for a seat — 2/2 in use." once per snapshot (P2 review).
    const text = composeNote(w, caps());
    if (!text || text === (w.msg.error && w.msg.error.message)) return;
    w.msg.error = { ...w.msg.error, message: text };
    void paint(w.msg);
  }

  // ONE pass per snapshot: check the row is still there, then refresh its note, then decide.
  // (refreshNote before the check would repaint — and so re-create — a row the reader just deleted.)
  let inSnapshot = false;
  async function onSnapshot() {
    if (inSnapshot) return;          // one pass at a time: the store read is awaited
    inSnapshot = true;
    try {
      const w = waiting;
      if (w && !w.resending && !(await stillThere(w))) { abandon(w); ticks += 1; return; }
      refreshNote();
      await onTick();
    } finally {
      inSnapshot = false;
    }
  }

  app.bus.on(EV.FARM_TICK, () => { void onSnapshot(); });
  app.bus.on(EV.FARM_CHANGE, () => { void onSnapshot(); });

  // A stream that ended for ANY other reason (the resend answered, the reader deleted the thread)
  // leaves no waiter behind.
  app.bus.on(EV.STREAM_END, (/** @type {any} */ p) => {
    const msg = p && p.message;
    if (!waiting || !msg || msg !== waiting.msg) return;
    if (msg.status !== 'waiting') {
      releaseHold(msg.id);
      waiting = null;
    }
  });

  // Debug surface for the harness (read-only; production never looks at it).
  app.seatWait = {
    seatDecision,
    /** @returns {null|{msgId: string, attempts: number, since: number, scheduledAt: number|null, resending: boolean}} */
    state: () => (waiting
      ? {
        msgId: waiting.msg.id, attempts: waiting.attempts, since: waiting.since,
        scheduledAt: waiting.scheduledAt, resending: waiting.resending,
      }
      : null),
    debug: () => ({ ticks, lastDecision, lastInput }),
    tryNow: () => (waiting ? resend(waiting) : null),
    cancel: () => stopWaiting('cancel'),
  };
}
