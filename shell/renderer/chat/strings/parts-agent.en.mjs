// @ts-check
// The Agent box (ecosystem plan v2 P4). One file per unit, same namespace: see strings/parts-text.en.mjs for why.
// The agent* prompt lines are what the MODEL reads: one sentence per tool, names and uses that cannot be
// confused (the P4 spike's only miss was two overlapping tools).
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  agentLabel: 'Agent',
  agentIn: 'Anything (labelled)',
  agentTask: 'Task',
  agentPlaceholder: 'What should it find out or make? It works in steps: runs code over what is wired in, reads the web hosts you allow, asks Laya — then answers.',
  agentHosts: 'Web hosts it may read',
  agentHostsPlaceholder: 'none — e.g. tabular-api.data.gouv.fr',
  agentHostsHint: 'The agent may GET addresses on these hosts only (exactly these names, separated by spaces). Empty: it cannot read the web.',
  agentSteps: 'Steps at most',
  agentNoTask: 'Write the task first.',
  agentThinking: 'Step {k} of {max}: thinking…',
  agentUsing: 'Step {k} of {max}: {tool}…',
  agentDone: 'Answered after {n} steps.',
  agentNoAnswer: 'No answer after {max} steps ({tools}). Give it more steps, a smaller task, or the data it needs.',
  agentBadStep: 'your answer was not the JSON object asked for (it began: {raw}). Answer with the JSON object only.',
  agentHow: '**How it got there** — {n} steps (each result is what the tool gave back):',
  agentNoInputs: '(nothing is wired in)',
  agentNoSteps: '(none yet)',
  agentNoSandbox: 'the code sandbox is not available',
  agentEmptyCode: 'the code is empty',
  agentCodeFailed: 'the code failed',
  agentReturnedNothing: 'the code returned nothing (null): console.log shows nothing here — end the code with return <the value>',
  agentHostRefused: 'not an allowed host; you may only fetch from: {hosts}',
  agentLayaFrom: 'step {from} has no list of texts to classify: point "from" at a step whose result is a list',
  agentNotATool: '"{tool}" is not one of the tools you can use now',
  agentSystem: 'You are an agent inside the LlmOnLan Computer. You work in short steps. At each step you choose ONE tool and fill in only the fields it uses (leave the others empty: "" or [] or 0). Numbers must come from tool results — compute them with run_code, never guess or estimate them. Answer with the JSON object only.',
  agentToolCode: 'run JavaScript in a sandbox with no network. `inputs["<name>"]` is each input listed above; `results[i]` (also `inputs.results[i]`) is the result of step i+1. Put the code in "code"; it must `return` a value (a number, text, a list or an object) — that is the step\'s result; console.log shows nothing. JavaScript only.',
  agentToolFetch: 'GET one web address (JSON or text, at most 1 MB) and see what came back. Put it in "url". Allowed hosts, and no others: {hosts}.',
  agentToolLaya: 'ask Laya, the farm\'s fast classifier, ONE multiple-choice question about every text of a list an earlier step returned. Put the question in "question", 2 to 20 answers in "options", and that step\'s number in "from".',
  agentToolAnswer: 'finish: write the answer for the person in "answer" (markdown). Quote only numbers that appear in the results above, and say what they count. If the steps could not find what the task asks, say so plainly — never present other numbers as the answer.',
  agentNextStep: 'This is step {k} of at most {max}. Choose the next tool; when you have what the task needs, use answer.',
  agentLastStep: 'This is step {k} of {max}, the LAST: use answer now, with what the results above show.',
});
