// @ts-check
// Strings for the IDE's coding agent in LOL Vibe (projects/agent.mjs, docs/IDE_PLAN.md): what a reply says about
// its steps, and the sentences for a turn that could not run or did not finish.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('agent', {
  // The recap a fresh agent session starts with (the thread is the durable history; the files are the state).
  recapHead: 'Earlier in this conversation (the project\'s files already hold the result):',
  recapPerson: 'Person: {text}',
  recapYou: 'You: {text}',
  recapNow: 'Now:',

  // The step log, in the reply's collapsible block.
  stepOk: '→ {name} {target} ✓',
  stepFailed: '→ {name} {target} ✗ {error}',
  stepChanges: '({n} change)',
  stepChangesMany: '({n} changes)',

  // When a turn does not end with an answer.
  noApp: 'The coding agent runs in the LlmOnLan app, not here.',
  outOfRoom: 'The model ran out of room before it finished. Ask for a smaller change, or pick a model that is good at editing code (the Project panel says which).',
  endedEarly: 'The coding agent stopped before it answered ({reason}).',
  noAnswer: 'The coding agent finished without a word. The Changes tab shows what it did.',
});
