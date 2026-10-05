// @ts-check
// Strings for the network core (P1-U1). Namespace: net.*
//
// The PARITY strings live in strings/core.en.mjs and are REUSED, never redefined here
// (plan §2.6 L): core.busyFailNote, core.errorNote, core.stats, core.alreadyRunning.
// Everything below is new vNext wording — the readable half of "readable farm errors".
//
// Every body is written for the person in front of the screen: what happened, and what to do now.
// When the farm sent its own sentence (the seat gate, the context overflow), describe() prefers the
// farm's text and these bodies are the fallback.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('net', {
  // describe() titles
  busyTitle: 'The server is busy',
  seatsFullTitle: 'The farm is full',
  upstreamDownTitle: 'The model server is not answering',
  authTitle: 'The farm refused the password',
  keyMissingTitle: 'This farm needs a password',
  contextOverflowTitle: 'This conversation is too long',
  visionUnsupportedTitle: 'This model cannot read images',
  streamErrorTitle: 'The answer stopped early',
  networkTitle: 'The farm is unreachable',
  abortedTitle: 'Stopped',
  httpTitle: 'The farm refused the request',
  localTitle: 'LOL Vibe could not send this',

  // describe() bodies ({message} = the classified message, {status} = the HTTP status,
  // {seconds} = retry-after)
  seatsFullBody: 'Every seat on this server is in use. A seat frees once its holder has been idle a while: try again in about {seconds} s.',
  upstreamDownBody: 'The farm answered, but the model behind it did not — it may be restarting. Try again in a few seconds.',
  // The password is entered on the farm's card in the connection popover (the top bar's pill) —
  // Preferences › Connection has no password field.
  authBody: 'The farm did not accept the password this client is sending. Click the connection pill in the top bar and enter it again on the farm’s card.',
  keyMissingBody: 'This farm needs a password. Click the connection pill in the top bar, enter it on the farm’s card, then send again.',
  contextOverflowBody: 'This chat is more than the model can read at once. Start a new chat, shorten your message, or use "Stop keeping in context" on the messages you kept.',
  visionUnsupportedBody: 'The model this farm is serving takes text only. Pick a vision model in the picker, or send the question without the image.',
  streamErrorBody: 'The farm stopped sending mid-answer: {message}. What arrived is kept above.',
  networkBody: 'No answer from the farm ({message}). It may have gone off the network, or be restarting. Try again in a moment; the connection pill in the top bar shows when it is back.',
  abortedBody: 'You stopped this answer.',
  httpBody: 'The farm answered {status}: {message}',
  // A throw on THIS machine (a transform, the read loop) — not something the farm said.
  localBody: 'Something failed on this computer, not on the farm: {message}',
});
