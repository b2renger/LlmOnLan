// @ts-check
// The Trigger box (P3b). One file per unit, same namespace pattern: see strings/parts-text.en.mjs for why.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  triggerLabel: 'Trigger',
  triggerHint: 'Starts a run by itself: on each message on a topic of the farm’s message bus, or every few seconds. Only while you have armed the outputs (the run bar) and the Computer is on screen.',
  triggerSource: 'Start on',
  triggerSourceHint: 'What starts a run: each message on a topic of the farm’s bus, or a clock.',
  triggerTopicHint: 'The bus topic to listen to. + stands for one level, # for everything below.',
  triggerEveryHint: 'How often the clock starts a run, in seconds (2 or more).',
  triggerGapHint: 'Messages that come sooner start no run of their own; the next run takes the latest one.',
  triggerPerHourHint: 'Once this many runs have started in the last hour, it pauses.',
  triggerSource_bus: 'a message on the farm’s bus',
  triggerSource_schedule: 'a schedule',
  triggerEvery: 'Every (seconds)',
  triggerGap: 'At most one run every (seconds)',
  triggerPerHour: 'At most runs per hour',
  triggerCounts: '{events} events · {runs} runs this hour · {merged} skipped',
  triggerWhy_unarmed: 'not armed: arm the outputs in the run bar to let it start runs',
  triggerWhy_hidden: 'the Computer is not on screen: no run starts',
  triggerWhy_budget: 'paused: this hour’s runs are used up',
  triggerWhy_gap: 'too soon after the last run: skipped (the next run takes the latest)',
  triggerNothingYet: 'Nothing has started it yet: no message has arrived and the clock has not ticked. Arm the outputs in the run bar and wait.',
});
