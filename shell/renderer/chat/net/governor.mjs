// @ts-check
// Who is allowed to talk to the farm right now. Plan §3.4.
//
// The farm has a fixed number of seats and llama.cpp often has exactly ONE slot, so two concurrent
// generations from one client do not go twice as fast — they queue, and the second one makes the
// user's own answer slower. The governor is the single place that says no.
//
// One foreground slot, three states:
//   idle      nothing running
//   streaming a generation owns the slot
//   held      something is KEEPING the slot without streaming (P2's seat-wait, which is waiting for
//             a seat to free and must not let a second send jump in front of it)
// `acquire('foreground', {holder})` succeeds from idle, and from `held` WHEN THE HOLDER IS THE SAME
// — that is the seat-wait finally getting its seat and turning its own hold into the stream.
// Anything else is refused with null and the caller shows "A reply is already running."
//
// `background` (title generation, tag generation, a future summariser) is the P2 half of the policy
// (plan §4 P2-U1). Nothing in this release USES it — it is API readiness with the rule already
// enforced, so the first background caller cannot invent a friendlier one:
//   - background is allowed ONLY when the farm actually advertises a free seat
//     (`caps.seats && used < slots`), the foreground is idle, and NOTHING ELSE IS ALREADY IN THE
//     BACKGROUND LANE (one at a time — see BACKGROUND_LIMIT). Seats UNKNOWN allow the one slot
//     (K1, COMPUTER_PLAN §3.5): a farm with no seat gate would otherwise mean the Computer could
//     never run at all. It stays politer than the foreground lane, which would block a colleague
//     instead of yielding to them.
//   - the user always wins: a successful `acquire('foreground')` ABORTS every in-flight background
//     acquisition through the `abort` callback it registered, and forgets it.
// A background acquisition never changes `state()` — the foreground slot is what the composer and
// the controller reason about, and a summariser must never make Send say "a reply is already
// running".

import { EV } from '../core/events.mjs';

/** @typedef {'idle'|'streaming'|'held'} Foreground */

/**
 * @param {import('../core/types.mjs').App} app
 * @returns {import('../core/types.mjs').Governor}
 */
export function createGovernor(app) {
  /** @type {Foreground} */ let foreground = 'idle';
  /** @type {string|null} */ let holder = null;
  /** @type {string|null} */ let heldNote = null;      // set by hold(): what to say when a send is refused
  /** @type {Function|null} */ let activeAbort = null;  // set by acquire(), used by abortActive()
  /** @type {Set<Function>} */ const subs = new Set();
  /** In-flight background work: one entry per live acquire('background'), with its abort. */
  /** @type {Set<{abort: Function|null}>} */ const background = new Set();

  /** The farm's own seat count, read at CALL time (the snapshot moves every few seconds). */
  function freeSeat() {
    const caps = app && app.farm && typeof app.farm.get === 'function' ? app.farm.get() : null;
    const seats = caps && caps.seats;
    // K1 (COMPUTER_PLAN §3.5), was `return false`. Seats UNKNOWN now allows the ONE background
    // slot. Every graph run is background, and a farm that advertises no seats — an older farm
    // build, an `external` engine, a snapshot that has not arrived yet — used to mean the Computer
    // could never run at all. This stays the polite choice: BACKGROUND_LIMIT = 1 still bounds the
    // client to one background request in flight, canStart('background') still requires
    // `foreground === 'idle'`, and a foreground Send still aborts every background call. The
    // reader always wins, unchanged.
    if (!seats) return true;
    return Number(seats.used) < Number(seats.slots);
  }

  /**
   * ONE background acquisition in flight, ever (S0 review, finding 1). `freeSeat()` reads the FARM
   * TICK snapshot, which does not move between two calls in the same frame, so five asks fired in
   * one `Promise.all` all saw the same free seat and all went out — five generations from one
   * client on a two-seat farm. The seat count is the FARM's arithmetic, not ours: a seat the
   * snapshot still calls free may already be ours. So the lane is a single file, and a fan-out
   * (the Computer panel's graph run) goes through `app.ask.queue`, which is serial by construction.
   */
  const BACKGROUND_LIMIT = 1;
  const backgroundRoom = () => background.size < BACKGROUND_LIMIT;

  /** The user just took the slot: nothing background may still be talking to the farm. */
  function abortBackground(reason) {
    if (!background.size) return 0;
    const entries = [...background];
    background.clear();
    let stopped = 0;
    for (const entry of entries) {
      if (!entry.abort) continue;
      stopped++;
      try { entry.abort(reason); } catch (err) { console.error('[lolchat] background abort threw', err); }
    }
    return stopped;
  }

  const state = () => ({ foreground, holder });

  /** @param {Foreground} nextForeground @param {string|null} nextHolder */
  function set(nextForeground, nextHolder) {
    if (foreground === nextForeground && holder === nextHolder) return;
    foreground = nextForeground;
    holder = nextHolder;
    const snap = state();
    app.bus.emit(EV.GOV_CHANGE, { ...snap });
    for (const fn of [...subs]) {
      try { fn({ ...snap }); } catch (err) { console.error('[lolchat] governor listener threw', err); }
    }
  }

  return /** @type {any} */ ({
    /** @param {string} kind */
    canStart(kind) {
      if (kind === 'foreground') return foreground === 'idle';
      if (kind === 'background') return foreground === 'idle' && backgroundRoom() && freeSeat();
      return false;
    },

    /**
     * @param {string} kind
     * @param {{holder?: string, abort?: Function}} [o]
     * @returns {(() => void)|null} release, or null when refused
     */
    acquire(kind, o) {
      if (kind === 'background') {
        // Allowed only while the user is idle AND the farm says a seat is spare (§4 P2-U1).
        if (foreground !== 'idle' || !backgroundRoom() || !freeSeat()) return null;
        /** @type {{abort: Function|null}} */
        const entry = { abort: o && typeof o.abort === 'function' ? o.abort : null };
        background.add(entry);
        return () => { background.delete(entry); };
      }
      if (kind !== 'foreground') return null;
      const want = (o && o.holder) || 'send';
      if (foreground === 'streaming') return null;
      if (foreground === 'held' && holder !== want) return null;
      if (foreground === 'held') heldNote = null;          // the hold BECAME the stream
      abortBackground('foreground');                      // the user always wins
      activeAbort = o && typeof o.abort === 'function' ? o.abort : null;
      set('streaming', want);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        // A handler may have placed a NEW hold during the stream (seat-wait re-arming after a 429);
        // that hold survives this release — §3.6.2 "a hold placed by a handler survives".
        if (foreground === 'streaming' && holder === want) {
          activeAbort = null;
          set('idle', null);
        }
      };
    },

    /**
     * Keep the slot without streaming. `note` is the ONE sentence a refused send should show
     * instead of "A reply is already running" — which is false while a seat wait is queued and
     * nothing is running at all (P2 review). The holder owns the sentence; the composer only
     * reads it, so the governor never has to know what a seat is.
     * @param {string} who @param {{note?: string}} [o]
     */
    hold(who, o) {
      heldNote = o && typeof o.note === 'string' && o.note ? o.note : null;
      set('held', who);
    },

    /** What the current HOLD wants a refused send to say, or null. @returns {string|null} */
    holdNote() {
      return foreground === 'held' ? heldNote : null;
    },

    /**
     * Drop a HOLD. Deliberately a no-op on a STREAMING slot even when the ids match: the stream's
     * own release closure owns that transition, and forcing 'idle' from outside made the governor
     * lie mid-finalize — seat-wait's STREAM_END listener fires BEFORE the controller's finally, so
     * the composer swapped Stop back to Send and the slot advertised itself free while the
     * generation was still running (P2 review).
     * @param {string} who
     */
    release(who) {
      if (holder !== who) return;
      if (foreground === 'streaming') return;
      heldNote = null;
      activeAbort = null;
      set('idle', null);
    },

    state,

    /** @param {Function} fn @returns {() => void} */
    onChange(fn) {
      if (typeof fn !== 'function') throw new TypeError('governor.onChange: listener must be a function');
      subs.add(fn);
      return () => { subs.delete(fn); };
    },

    // ---- additive to §3.4 --------------------------------------------------------------------
    // There is deliberately NO `cancelHold()`. Cancelling a hold has exactly one door — the
    // registry's CANCEL_HANDLERS, which `controller.stop()` runs — and the governor's own version
    // was never called by anything but its unit test (P2 review). One contract, not two.
    /** Abort the running generation through the abort callback acquire() was given. */
    abortActive(reason) {
      if (foreground !== 'streaming' || !activeAbort) return false;
      try { activeAbort(reason); } catch (err) { console.error('[lolchat] governor abort threw', err); return false; }
      return true;
    },
  });
}
