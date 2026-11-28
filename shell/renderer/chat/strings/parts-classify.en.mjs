// @ts-check
// The Classify box (docs/archive/plans/ECOSYSTEM_PLAN.md v2 §3.2). One file per unit, same namespace: see
// strings/parts-text.en.mjs for why.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  classifyLabel: 'Classify',
  // COMPUTER_DOTS_PLAN (2026-11-28): the dots' names, as each row starts, capitalised like the box's other captions.
  classifyItemsIn: 'Items',
  classifyOptionsIn: 'Options',
  classifyQuestionIn: 'Question',
  classifyItemsEmpty: 'Wire a list, or lines of text, here',
  classifyAsked: 'Asked (from the wire): “{question}” — {options}',
  classifyQuestion: 'Question',
  classifyQuestionHint: 'The one question the farm answers for every item. A question wired into “Question” (a model can write one) is used instead of this one.',
  classifyQuestionPlaceholder: 'What is each item mainly about?',
  classifyOptions: 'Options',
  classifyOptionsHint: 'The answers the farm may pick from, one per line (2 to 20). A list wired into “Options” is used instead.',
  classifyOptionsPlaceholder: 'One option per line — or wire a Text box into “Options”',
  classifyThreshold: 'Sure above',
  classifyThresholdHint: 'The farm says how sure it is of each answer, from 0 to 1. Below this number the item is marked unsure, and its text goes on in the “check” list for a model or a person to look at again. That sureness is only a rough guide: 0.6 split right from wrong answers in our first test.',
  classifyStatus: '{n} items · {unsure} unsure (below {thr}) · {sec} s · {who}',
  classifyByModel: '{model}, the farm’s model',
  classifyNoLaya: 'No Classify on this farm, so every item is passed on as unsure. The farm’s operator can turn on Classify (Laya) in the farm panel.',
  classifyNoItems: 'Nothing to classify: wire in a list, an object holding a list, or lines of text.',
  classifyBadOptions: 'Give between 2 and 20 options (one per line).',
  classifyNoQuestion: 'Write the question first.',
  classifyTooMany: 'Too many items for one call ({n}); the farm takes at most {max}.',
  classifyErr_unauthorized: 'The farm refused the Classify key — the farm may have restarted. Run again in a few seconds.',
  classifyErr_busy: 'The farm is busy classifying (maybe your previous run). Run again in a moment — nothing was lost.',
  classifyErr_warming: 'Classify is still warming up on the farm. Run again in a few seconds.',
  classifyErr_tooMany: 'The farm refused that many items in one call.',
  classifyErr_farm: 'The farm’s Classify service answered badly ({message}).',
  classifyErr_timeout: 'The farm’s Classify did not answer within two minutes.',
  classifyErr_network: 'The farm’s Classify service could not be reached: {message}',
});
