// @ts-check
// Strings for farm etiquette (P2-U1: seat wait, the farm strip, completion notifications).
// Namespace: `etiquette` (plan §2.6 AO).
//
// The parity strings stay where they are and are REUSED, never redefined (§2.6 L): `core.send`
// for the Send label this unit restores, `core.busyPercent` for the ` (N%)` fragment of a busy
// farm, `dialogs.cancel` for the Cancel button.
//
// Tone: the seat gate is a SOCIAL fact, not a failure. The farm's own sentence ("All 2 seats on
// this server are in use…") is shown verbatim and these strings only add what the client knows on
// top — how many seats are taken right now, and what the reader can do about it.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('etiquette', {
  // ---- seat wait (app/seat-wait.mjs) --------------------------------------------------------
  waitingSeats: 'Waiting for a seat — {used}/{slots} in use.',
  // After MAX_ATTEMPTS refused resends nothing is queued on the reader's behalf any more, so the
  // row must stop saying it is waiting: `seatDecision` returns 'manual' and only Try now moves it.
  waitingManual: 'Asked {attempts} times and lost the race each time — nothing is queued now, press Try now for another go.',
  // Same state, other cause: a farm with no seat gate never tells us a seat freed, so we never guess.
  waitingUnknown: 'This farm does not report its seats, so nothing is queued — press Try now for another go.',
  sendWaiting: 'Waiting for a seat…',
  // What a send refused while the wait holds the slot says (gov.hold({note}) → the composer).
  refusedWaiting: 'Still waiting for a seat — nothing is running yet. Stop to give up the wait.',
  tryNow: 'Try now',
  cancelled: 'Stopped waiting for a seat.',
  gaveUp: 'Gave up waiting for a seat after {minutes} min. Nothing was sent — try again, or ask around who is still generating.',

  // ---- the farm strip (ui/strip.mjs) --------------------------------------------------------
  // One line under the topline. Every field is omitted when its value is unknown — never a dash.
  stripModelUnderlying: '{model} ({underlying})',
  stripSeats: '{used}/{slots} seats',
  stripGpu: 'GPU {percent}%',
  stripTokSec: '{tokPerSec} tok/s',
  stripBusy: '{label}{percent}',
  stripSilent: 'farm silent',
  stripPasswordNeeded: 'password needed',
  stripLabel: 'Farm status',

  // ---- notifications (ui/notify.mjs) --------------------------------------------------------
  notifyTitle: 'Notifications',
  // The desktop toast's own title, used when the chat has no title yet. NOT notifyTitle:
  // sharing that key announced the notification as "Notifications" (P2 review).
  notifyFallbackTitle: 'LOL Chat — your reply is ready',
  notifyToggle: 'Tell me when a long reply is done',
  notifyHint: 'Only when LOL Chat is in the background and the answer took a while.',
});
