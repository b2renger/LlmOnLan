// @ts-check
// The Classify box (docs/ECOSYSTEM_PLAN.md v2 §3.2). One file per unit, same namespace: see
// strings/parts-text.en.mjs for why.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  classifyLabel: 'Classify',
  classifyItemsIn: 'items',
  classifyOptionsIn: 'options',
  classifyQuestionIn: 'question',
  classifyAsked: 'Asked (from the wire): “{question}” — {options}',
  classifyQuestion: 'Question',
  classifyQuestionPlaceholder: 'What is each item mainly about?',
  classifyOptions: 'Options',
  classifyOptionsPlaceholder: 'One option per line — or wire a Text box into “options”',
  classifyThreshold: 'Sure above',
  classifyThresholdHint: 'An answer whose confidence is below this is passed on as unsure, for the model or a person to check. Laya’s confidence is uncalibrated: 0.6 separated right from wrong in our first test.',
  classifyStatus: '{n} items · {unsure} unsure · {sec} s · Laya (uncalibrated)',
  classifyNoLaya: 'No Laya on this farm — every item is passed on as unsure.',
  classifyNoItems: 'Nothing to classify: wire in a list, an object holding a list, or lines of text.',
  classifyBadOptions: 'Give between 2 and 20 options (one per line).',
  classifyNoQuestion: 'Write the question first.',
  classifyTooMany: 'Too many items for one call ({n}); the farm takes at most {max}.',
  classifyErr_unauthorized: 'The farm refused the Classify key — the farm may have restarted. Run again in a few seconds.',
  classifyErr_busy: 'Laya is busy (maybe with your previous run). Run again in a moment — nothing was lost.',
  classifyErr_warming: 'Laya is still warming up on the farm. Run again in a few seconds.',
  classifyErr_tooMany: 'The farm refused that many items in one call.',
  classifyErr_farm: 'The farm’s Classify service answered badly ({message}).',
  classifyErr_timeout: 'Laya did not answer within two minutes.',
  classifyErr_network: 'The farm’s Classify service could not be reached: {message}',
});
