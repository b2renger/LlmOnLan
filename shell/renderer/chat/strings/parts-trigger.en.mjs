// @ts-check
// The Trigger box (P3b). One file per unit, same namespace pattern: see strings/parts-text.en.mjs for why.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  triggerLabel: 'Trigger',
  triggerHint: 'Starts a run by itself: on each message on a topic of the farm’s message bus, or every few seconds. Only while you have armed the outputs (the run bar) and the Computer is on screen.',
  triggerSource: 'Start on',
  triggerSource_bus: 'a message on the farm’s bus',
  triggerSource_schedule: 'a schedule',
  triggerEvery: 'Every (seconds)',
  triggerGap: 'At most one run every (seconds)',
  triggerPerHour: 'At most runs per hour',
  triggerCounts: '{events} events · {runs} runs this hour · {merged} merged',
  triggerWhy_unarmed: 'not armed: arm the outputs in the run bar to let it start runs',
  triggerWhy_hidden: 'the Computer is not on screen: no run starts',
  triggerWhy_budget: 'paused: this hour’s runs are used up',
  triggerWhy_gap: 'merged into the next run (latest wins)',
  triggerNothingYet: 'Nothing has triggered yet: no message, no tick.',
});
