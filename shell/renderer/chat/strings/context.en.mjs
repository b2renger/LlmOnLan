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
  meterTitle: 'This chat fills {percent}% of what the model can read at once (its context window). Click for the details.',
  meterOver: 'Too long: more than the model can read at once (its context window). Click for the details.',

  // ---- the breakdown popover ----------------------------------------------------------------
  breakdownTitle: 'What this send costs',
  breakdownSystem: 'System prompt',
  breakdownPinned: 'Messages kept in context',
  breakdownHistory: 'Earlier turns',
  breakdownNewTurn: 'This message',
  breakdownAttachments: 'Attachments',
  breakdownReserve: 'Kept free for the reply',
  breakdownTotal: 'Prompt total',
  breakdownBudget: 'Context window (all it can read)',
  breakdownAdvertised: 'The farm says how much its model can read at once; LOL Vibe trusts that up to 262,144 tokens.',
  breakdownDefault: 'This farm does not say how much its model can read at once, so LOL Vibe assumes a careful 32,768 tokens.',
  trimmedOne: '1 older turn does not fit and is not sent (it is dimmed in the chat).',
  trimmedMany: '{count} older turns do not fit and are not sent (they are dimmed in the chat).',
  trimmedNone: 'Every turn of this chat fits.',
  overNote: 'This message does not fit, even with the older turns left out. Shorten it, or use "Stop keeping in context" on a kept message.',

  // ---- the send-cost gate (F26) --------------------------------------------------------------
  // The label the Send button wears while the gate is armed: one more click sends.
  sendCost: 'Send · ~{tokens} tokens',
  sendCostSeconds: 'Send · ~{tokens} tokens · ~{seconds}s of shared GPU',
  tooLong: 'Too long for this farm',
  // Tooltips the Send button wears while the gate holds it (app/context.mjs).
  sendCostTip: 'A long message: everyone else on the farm waits while the model reads it. Click again to send it anyway.',
  tooLongTip: 'This message does not fit what the model can read at once. Shorten it: the meter beside it shows what takes the room.',

  // ---- message actions -----------------------------------------------------------------------
  pin: 'Keep in context',
  unpin: 'Stop keeping in context',
  pinTip: 'Keep in context: always send this message to the model, even when older turns no longer fit',
  unpinTip: 'Stop keeping in context: this message may be left out again when the chat gets long',

  // ---- settings ------------------------------------------------------------------------------
  settingsTitle: 'Context',
  gateThresholdLabel: 'Ask before sending more than',
  gateThresholdUnit: 'tokens',
  gateThresholdHelp: 'A long prompt makes everyone else on the farm wait while it is read. Above this, Send says what it costs and asks for a second click.',
});
