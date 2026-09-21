// @ts-check
// Strings for the ask spine and the capability probe (S0-U2). Namespace: `ask` (plan §2.6 BD-13).
//
// An ask is not a chat turn, so these sentences are never painted into the transcript: a panel
// shows them in its OWN surface, beside a Retry button. That is the whole reason they exist — the
// studio plan (§3.4.2, §1.2) forbids a silent empty result, so every `ok:false` carries one of
// these, naming what happened and what the reader can do about it.
//
// Reused rather than redefined (§2.6 L): `core.send`, `dialogs.cancel`, and the net.* error titles
// for anything that is an ordinary network failure.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('ask', {
  // ---- refusals, before anything leaves the machine -----------------------------------------
  // The governor said no: the reader's own reply is streaming, or another panel holds the slot.
  // Deliberately not "the farm is busy" — the farm may be perfectly idle; WE are.
  busy: 'The model is answering something else right now — try again when it finishes.',
  // Same shape, different cause: the window is hidden, so we do not spend a seat on nobody.
  hidden: 'Paused while this window is in the background.',
  noFarm: 'No farm is connected, so there is nothing to ask.',
  keyMissing: 'This farm needs its password before it will answer.',
  // The model cannot see images and we know it (studio plan §3.10 / O4). One sentence that names
  // what the OPERATOR has to change, because the reader cannot fix it from here.
  noVision: 'This model cannot read images. Switch the farm to a vision model (gemma4:12b) to use this.',

  // ---- the model answered, but not usefully --------------------------------------------------
  empty: 'The model returned nothing at all.',
  invalid: 'The model did not answer in the shape this panel needs.',
  aborted: 'Cancelled.',
  // Anything net/errors.mjs classified: the panel shows this line and the classified message below.
  farmError: 'The farm could not answer: {message}',
  retry: 'Try again',

  // ---- the batch queue (app.ask.queue; ui/queue.mjs renders the chip) -------------------------
  queueBusy: 'One batch at a time — let the running one finish or cancel it.',
  queueStalled: 'The farm is busy — try again.',
  queueCapped: 'Only the first {max} of {n} were queued.',
});
