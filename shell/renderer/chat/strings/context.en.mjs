// @ts-check
// Strings for the context budget: the meter, its breakdown popover, the send-cost gate, the pin
// action and the Context settings section (P2-U2, namespace 'context').
//
// Plan §2.6 AO: one namespace per unit. The Send button's resting label is `core.send` and is REUSED
// from here — the gate only borrows the button while it is armed and must hand back the same text.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('context', {
  // ---- the meter (els.meter, in the composer row) -------------------------------------------
  meterLabel: '~{estimate} / {budget}',
  meterAdvertised: 'advertised',
  // the accessible name of the meter button; {percent} is a whole number and may exceed 100
  meterTitle: 'Context: {percent}% of the window',
  meterOver: 'Over the context window',

  // ---- the breakdown popover ----------------------------------------------------------------
  breakdownTitle: 'What this send costs',
  breakdownSystem: 'System prompt',
  breakdownPinned: 'Pinned messages',
  breakdownHistory: 'Earlier turns',
  breakdownNewTurn: 'This message',
  breakdownAttachments: 'Attachments',
  breakdownReserve: 'Kept free for the reply',
  breakdownTotal: 'Prompt total',
  breakdownBudget: 'Window',
  breakdownAdvertised: 'The farm advertises this window; LOL Chat believes it up to 262,144 tokens.',
  breakdownDefault: 'This farm advertises no window, so LOL Chat assumes a careful default.',
  trimmedOne: '1 older turn is outside the context and is not sent.',
  trimmedMany: '{count} older turns are outside the context and are not sent.',
  trimmedNone: 'Every turn of this thread fits.',
  overNote: 'This message alone does not fit the window. Shorten it, or unpin something.',

  // ---- the send-cost gate (F26) --------------------------------------------------------------
  // The label the Send button wears while the gate is armed: one more click sends.
  sendCost: 'Send · ~{tokens} tokens',
  sendCostSeconds: 'Send · ~{tokens} tokens · ~{seconds}s of shared GPU',
  tooLong: 'Too long for this farm',

  // ---- message actions -----------------------------------------------------------------------
  pin: 'Keep in context',
  unpin: 'Stop keeping in context',

  // ---- settings ------------------------------------------------------------------------------
  settingsTitle: 'Context',
  gateThresholdLabel: 'Ask before sending more than',
  gateThresholdUnit: 'tokens',
  gateThresholdHelp: 'A long prompt makes everyone else on the farm wait while it is read. Above this, Send says what it costs and asks for a second click.',
});
