// @ts-check
// C1-U3's strings: the part catalogue's labels, port labels, settings and the failures a part
// reports about ITSELF. One namespace per unit (§2.6 L / BD-13): `parts.*` is C1-U3's, the panel's
// own chrome (`graph.*`) is C1-U2's.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  // Note (C1)
  noteLabel: 'Note',
  noteHint: 'Typed text. Wire it into anything, or leave it as a comment.',
  notePlaceholder: 'Write something…',

  // Instruction (K2 — the part `ask.mjs` becomes; COMPUTER_PLAN §6.3). The TYPE ID stays `ask`
  // so every stored graph loads; the label, the file and these keys become `instruction`. The
  // `ask*` keys are GONE with `ask.mjs` (the K2 landing swapped the catalogue row).
  //
  // The first block is PROMPT TEXT, not chrome: these strings are what the model reads (§5.3),
  // and they are frozen — changing one changes every answer the Computer has ever given.
  insSystem: [
    'You are one component in a visual workflow. You are given named inputs and one instruction.',
    'Use every input the instruction refers to by name. Reply with the result only — no preamble,',
    'no restatement of the inputs, no commentary about the workflow.',
  ].join('\n'),
  insInputsHeading: '# Inputs',
  insInstructionHeading: '# Instruction',
  insPositional: 'Input {n}',
  insEmpty: '*(empty)*',
  insImageHeading: '{name} (image, attached)',
  insOmitted: '…[{n} characters omitted]…',
  insFallback: 'Combine the inputs above into a single coherent result.',
  insPending: '⟨{name} — has not run yet⟩',

  // …and the chrome the box itself shows.
  insLabel: 'Instruction',
  insHint: 'Names the arrows feeding it, then tells the model what to do with them.',
  insPlaceholder: 'What should the model do with these inputs?',
  insIn: 'Inputs',
  // Critic R1 A2: the owner could not tell what "Substitute short values in place" meant. The
  // checkbox fills ONLY the explicit `{name}` forms — a bare word is never replaced — and the
  // hint says so in one line. `{names}`/`{topic}` below are literal text: t() leaves a
  // placeholder it has no value for exactly as written.
  insInline: 'Fill in {names} with their values',
  insInlineHint: 'Where your instruction writes {topic}, put the topic’s text right there instead of listing it under Inputs. Only for short text (up to 200 characters).',
  // The box's own controls (K2-U2, within the `parts.ins*` prefix KB-6 assigns it).
  insModel: 'Model',
  insModelAuto: 'Automatic',
  insShape: 'Answer shape',
  insShapeText: 'Text',
  insShapeList: 'List',
  insShapeJson: 'JSON',
  insSchema: 'JSON schema',
  insSchemaPlaceholder: '{"type":"object","properties":{…}}',
  insOpen: 'Read what will be sent',
  insStrip: 'sends {words} words · {n} named inputs',
  insStripOne: 'sends {words} words · 1 named input',
  insStripNone: 'sends {words} words · no named inputs',
  insNoInstruction: 'no instruction yet',
  insUnused: 'unused: {name}',
  insUnwired: '{name} — not wired',
  insFanout: 'runs {n} times — this is generation 1 of {n}',
  insTruncated: 'truncated: {cut} of {of} characters cut to fit {tokens} tokens',
  insTruncatedAssumed: 'truncated: {cut} of {of} characters cut to fit an assumed {tokens} tokens',
  errNoVision: 'This farm’s model cannot read images. It is serving {alias}. Switch the farm to a vision model, or remove the image.',

  // Collect (C1)
  collectLabel: 'Collect',
  collectHint: 'Joins a list back into one value.',
  collectItems: 'Items',
  collectMode: 'Join as',
  collectBullets: 'Bullet list',
  collectNumbered: 'Numbered list',
  collectJson: 'JSON array',
  collectTemplate: 'Template per item',
  collectTemplateText: 'Template',
  collectSeparator: 'Separator',

  // ---- C2 (§2.6 BH): the fan-out family and the two bridges to the conversation -------------

  // Split
  splitLabel: 'Split',
  splitHint: 'Text into items. The entry point to fan-out.',
  splitInput: 'Text',
  splitMode: 'Split by',
  splitMode_lines: 'Lines',
  splitMode_numbered: 'Numbered list',
  splitMode_json: 'JSON array',
  splitMode_separator: 'Separator',
  splitMode_paragraphs: 'Paragraphs',
  splitSeparator: 'Separator',
  splitLimit: 'Keep at most',

  // Repeat
  repeatLabel: 'Repeat',
  repeatHint: 'Runs whatever is downstream N times — the four-variants button.',
  repeatInput: 'Value',
  repeatTimes: 'Times',

  // Filter
  filterLabel: 'Filter',
  filterHint: 'Keeps the items that match. Model mode spends one small generation per item.',
  filterItems: 'Items',
  filterCriterion: 'Criterion',
  filterMode: 'Keep when',
  filterMode_contains: 'Contains',
  filterMode_matches: 'Matches',
  filterMode_length: 'Length is',
  filterMode_model: 'The model says yes',
  filterInvert: 'Keep the others instead',
  filterSystem: 'Answer only with whether the item matches the criterion.',

  // From thread / To thread
  fromThreadLabel: 'From thread',
  fromThreadHint: 'Pulls a message out of this conversation onto the canvas.',
  fromThreadSource: 'Take',
  fromThreadSource_lastAnswer: 'The last answer',
  fromThreadSource_lastQuestion: 'The last question',
  fromThreadSource_message: 'A chosen message',
  toThreadLabel: 'To thread',
  toThreadHint: 'Posts this value into the conversation.',
  toThreadInput: 'Value',
  toThreadRole: 'Post as',
  toThreadPosted: 'Posted into the conversation.',

  // C2-U3 additions: the two bridges' own controls and refusals.
  fromThreadMessage: 'Which message',
  fromThreadNoMessages: 'Nothing has been said yet',
  fromThreadOption: '{who}: {text}',
  fromThreadWhoYou: 'You',
  fromThreadWhoAssistant: 'Assistant',
  toThreadRoleAssistant: 'The assistant',
  toThreadRoleYou: 'You',
  toThreadPrefix: 'Line above',
  toThreadPrefixPlaceholder: 'Optional, e.g. Here is the summary:',

  // C2-U2 additions: the fan-out family's own settings and refusals.
  splitSeparatorPlaceholder: ', or ; or |',
  repeatTemplate: 'Each item',
  repeatTemplatePlaceholder: 'Leave empty to repeat the input. {item} {i} {n}',
  filterMin: 'At least (characters)',
  filterMax: 'At most (characters)',
  filterModel: 'Model',
  filterCriterionPlaceholder: 'What must an item be?',

  // how many items a list carries — the half the canvas preview cannot say
  itemsOne: '1 item',
  itemsCount: '{n} items',

  // fan-out, on the part
  itemsRunning: '{i}/{n}',
  itemsFailed: '{n} of {total} items failed',
  itemError: 'Item {i}: {message}',

  // failures a part reports on itself (never a silent empty, §1.2)
  errNoFarm: 'No farm is connected, so this part cannot run.',
  errNoInput: 'Nothing is wired into {port}.',
  errBadInput: '{port} got {kind}, which this part does not accept.',
  // The ask spine's own sentence already names the farm ('The farm could not answer: …'), so a
  // second prefix here stuttered on screen (C2 landing). Pass it through; errFarmSilent is for
  // the only case that needs words of its own — a refusal that came with none.
  errFarm: '{message}',
  errFarmSilent: 'The farm refused this, and said nothing about why.',
  errEmpty: 'The model answered with nothing.',
  errInvalid: 'The answer did not match the shape you asked for.',
  errBusy: 'The farm is busy with someone else. Press Run again in a moment.',
  errFanoutMany: 'Two inputs are lists at once. Join one of them with Collect before this part.',
  errAllItems: 'Every item failed. The first said: {message}',
  errCapped: 'This run reached its limit of {cap} generations.',
  errNoItems: 'Splitting the text this way produced no items.',
  errNotJson: 'That text is not JSON, so it cannot be split as a JSON array.',
  errNoSeparator: 'Type a separator before splitting this way.',
  errBadPattern: 'That pattern is not a valid regular expression.',
  errUnsafePattern: 'That pattern could run for ever. Simplify it, or filter with contains.',
  errWiredPattern: 'A wired criterion cannot be a regular expression. Type the pattern here, or switch to contains.',
  errTooMany: 'Repeat is limited to {max} passes.',
  errNoCriterion: 'Write a criterion, or wire one in, before running this filter.',
  errNoThread: 'This part needs an open conversation.',
  errNoMessage: 'There is no such message in this conversation yet.',
  errNothingToPost: 'There is nothing to post.',
  errStillWriting: 'That answer is still being written. Run again once it has finished.',
  errEmptyMessage: 'That message has no text to take.',
  errAborted: 'Stopped before the farm answered.',
  errNoInstruction: 'Write an instruction, or wire something in, before running this part.',
  errNoSchema: 'Answer shape is JSON, so this part needs a schema.',
  errBadSchema: 'That schema is not valid JSON.',
  errNoValue: 'This part produced nothing, which is a failure, not a value.',

  // ---- C3 (§2.6 BJ): the sandbox parts and the one that writes a file. Seeded by the integrator
  // so the three stubs resolve at module load; C3-U2 owns every key below from here.
  codeLabel: 'Code',
  codeIn: 'Inputs',
  codeHint: 'Plain JavaScript. `inputs.in` is an array; return text, a number, an array or an object.',
  renderLabel: 'Render',
  renderIn: 'Text',
  renderAlt: 'What this part drew',
  renderMode: 'Read as',
  renderModeMarkdown: 'Markdown',
  renderModeSvg: 'SVG',
  renderModeHtml: 'HTML page',
  fileLabel: 'File',
  fileIn: 'Value',
  filePath: 'Path in the project',
  fileReveal: 'Reveal in Explorer',
  fileWrote: 'Wrote {path}',
  fileProjectFallback: 'Graph output',

  errCodeNoValue: 'That code returned nothing. Return text, a number, an array or an object.',
  errCodeList: 'A list arrived here whole, not item by item. Code takes the whole list on purpose — fan out before it, or read inputs.in as the array it is.',
  errRenderEmpty: 'There is nothing to draw yet.',
  errRenderNoPicture: 'The sandbox drew nothing that could be captured.',
  errFileEmpty: 'There is nothing to write.',
  errFileNoThread: 'This part writes into the conversation’s own folder, so it needs an open conversation.',
  errFileNoProjects: 'This build cannot reach the project folder, so nothing was written.',
  errFileWrite: 'The file was not written: {message}',

  // C3-U2's own keys. The four `codeSend*` keys went out at the K1 landing with the chat-fence
  // bridge (COMPUTER_PLAN §3.2): the Computer is a surface now, not a panel inside a conversation.
  // `codeLine*` is the editor pointing at the line that broke, and stays.
  codeLineChip: 'Line {line}',
  codeLineTitle: 'Show the line that failed',
  renderNothingYet: 'Nothing drawn yet. Run to draw it.',
  renderSaveSvg: 'Save as SVG',
  renderSavePng: 'Save as PNG',
  renderWidth: 'Width',
  renderHeight: 'Height',

  // ---- K3: the six control parts (COMPUTER_PLAN §6.6) -----------------------------------------
  // Namespace ownership inside `parts.*` for this phase: every key below is K3-U2's, and the
  // integrator adds new ones at a kickoff. The two halves a learner must be able to tell apart —
  // ACTIVATION and VALUE (§4.5) — are named apart here too: a Toggle that is off BARS and still
  // PUBLISHES, and neither word is "stopped".
  ctlIn: 'In',

  btnLabel: 'Button',
  btnText: 'Label',
  btnPress: 'Run this',
  btnHint: 'Nothing runs until you press it. Press it and everything after it runs.',
  btnNotPressed: '{n} buttons not pressed',
  btnNotPressedOne: '1 button not pressed',
  btnReady: 'ready — click to continue',

  condLabel: 'Condition',
  condBranch: 'Continue when',
  condMode: 'Decide by',
  condModeText: 'reading the words (free)',
  condModeModel: 'asking the model (1 generation)',
  condQuestion: 'Question',
  cond_yes: 'yes',
  cond_no: 'no',
  cond_maybe: 'maybe',
  condVerdict: 'read as {verdict}',
  condHint: 'Anything it cannot read is “maybe”, never “no”.',
  // K3-U2: `mode:'model'` — one cheap generation with a fixed {verdict} shape. The prompt is built
  // from exactly the question and the text, which is what lets the ask cache answer the second
  // Condition of a fan for free.
  condModel: 'Model',
  condAsking: 'Does this answer yes, no, or maybe?',
  condSystem: 'You are a classifier. Read the text and answer the question with exactly one of: yes, no, maybe. Answer “maybe” whenever the text does not clearly say yes or no.',
  condPrompt: 'Question: {question}\n\nText:\n{text}',

  confirmLabel: 'Confirm',
  confirmMessage: 'Message',
  confirmTimeout: 'Give up after (seconds, 0 = never)',
  confirmOk: 'OK',
  confirmCancel: 'Cancel',
  confirmAsking: 'Continue?',
  confirmCancelled: 'Cancelled — this branch stopped here.',
  confirmTimedOut: 'Nobody answered, so this branch stopped here.',

  dlgLabel: 'Dialog',
  dlgQuestion: 'Question',
  dlgContext: 'Context',
  dlgPlaceholder: 'Hint text',
  dlgMultiline: 'Several lines',
  dlgDefault: 'If nobody answers',
  dlgAskEveryRun: 'Ask again every run',
  dlgSend: 'Send',
  dlgAsking: 'Your answer?',

  togLabel: 'Toggle',
  togOn: 'On',
  togOnHint: 'On — what arrives here carries on.',
  togOffHint: 'Off — the value still flows, but nothing after this runs.',

  timerLabel: 'Timer',
  timerSeconds: 'Wait (seconds)',
  timerRepeats: 'Repeats',
  timerHint: 'Waits {seconds} s, {repeats}×.',
  timerWaiting: 'waiting {seconds} s…',

  errCodeEmpty: 'This part has no code yet, so there is nothing to run.',
  errCodeLine: 'Line {line}: {message}',
  errRenderNotSvg: 'That text does not start with <svg>, so it cannot be drawn as SVG.',
  errRenderTooBig: 'That picture is too large to keep on the canvas. Draw it smaller.',
  errFileNoPath: 'Type a path, like out/value.md, before writing.',
  errFileImageExt: 'A picture needs a picture file name — end the path with .png.',
  errFileBinary: 'That value is text, so it cannot be written to a picture file. End the path with .md, .txt or .json.',
});
