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

  // "Keep going until done" (dsh's goal loop): the goal, each round dsh starts on its own, and how it ended.
  goalSet: '◎ Goal set: it keeps working round after round until it has checked the job is done.',
  round: '◎ Round {n} of {max}',
  goalDone: '◎ Goal done — the agent checked its work and marked it complete.',
  goalBlocked: '◎ The agent says it is blocked: {why}',
  loopMaxTokens: 'The loop stopped: one of the agent\'s replies was longer than the model may write at once. What it did so far is kept; send a message to go on.',
  loopStalled: 'The loop stopped: the agent did not start its next round. What it did so far is kept; send a message to go on.',
  loopRoundLimit: 'The loop stopped after {max} rounds, its limit. What it did so far is kept; send a message to go on.',
  loopBlocked: 'The agent stopped because it is blocked: {why}. What it did so far is kept.',

  // When a turn does not end with an answer.
  noApp: 'The coding agent runs in the LlmOnLan app, not here.',
  outOfRoom: 'The model ran out of room before it finished. Ask for a smaller change, or pick a model that is good at editing code (the Project panel says which).',
  endedEarly: 'The coding agent stopped before it answered ({reason}).',
  noAnswer: 'The coding agent finished without a word. The Changes tab shows what it did.',
});
