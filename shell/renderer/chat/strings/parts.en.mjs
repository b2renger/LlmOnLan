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
  insModelHint: 'Which of the farm’s models answers. Automatic: the farm’s default model.',
  insModelAuto: 'Automatic',
  insModelAutoNamed: 'Model: automatic',
  insShape: 'Answer shape',
  insShapeHint: 'Text: one answer. List: a list of items, and the boxes after it run once for each item. JSON: data in the shape the JSON schema below describes.',
  insShapeText: 'Answer: text',
  insShapeList: 'Answer: list',
  insShapeJson: 'Answer: JSON',
  insSchema: 'JSON schema',
  insSchemaHint: 'The JSON schema the answer must follow: the fields it has and their types. The model answers in exactly this shape.',
  insSchemaPlaceholder: '{"type":"object","properties":{…}}',
  insOpen: 'Read what will be sent',
  insStrip: 'sends {words} words · {n} named inputs',
  insStripOne: 'sends {words} words · 1 named input',
  insStripNone: 'sends {words} words · no named inputs',
  insNoInstruction: 'no instruction yet',
  insUnused: 'not named, still sent: {name}',
  insUnwired: '{name} — not wired',
  insFanout: 'runs {n} times, once per item — the count above is the first run’s',
  insTruncated: 'shortened: {cut} of {of} characters cut to fit the model’s {tokens} tokens',
  insTruncatedAssumed: 'shortened: {cut} of {of} characters cut to fit an assumed {tokens} tokens',
  // Critic S1-13: {model} is THIS box's model, and the fix is this box's own Model menu — not the
  // farm. Said the way takes.* says it: what the farm lists, never more.
  errNoVision: 'The farm does not list {model} as able to see pictures. Pick one that can in this box’s Model menu.',

  // Collect (C1)
  collectLabel: 'Collect',
  collectHint: 'Joins every item of the list into one, the way chosen above.',
  collectModeHint: 'How the items are joined: a bullet list, a numbered list, a JSON array (data), or your own template, one line per item.',
  collectTemplateHint: 'The line written for each item: {item} is the item’s text, {i} its number, {n} how many there are.',
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
  splitModeHint: 'Where to cut: at each line, at each numbered point (1. 2. 3.), at each entry of a JSON array, at a separator you type, or at each blank line between paragraphs.',
  splitSeparatorHint: 'The characters to cut at, exactly as typed.',
  splitLimitHint: 'Keep only the first items; 0 keeps them all.',
  repeatTemplate: 'Each item',
  repeatTemplatePlaceholder: 'Leave empty to repeat the input. {item} {i} {n}',
  repeatTimesHint: 'How many copies to hand on (at most {max}). The boxes after it run once for each copy; each Instruction run is a new answer and counts toward the Cap.',
  repeatTemplateHint: 'Optional: the text of each copy. {item} is what arrives, {i} the copy’s number, {n} how many copies. Empty: every copy is what arrives.',
  filterMin: 'At least (characters)',
  filterMax: 'At most (characters)',
  filterMaxHint: '0: no upper limit.',
  filterModel: 'Model',
  filterModeHint: 'Contains: the item holds these words (any case). Matches: a pattern (a regular expression). Length is: between two numbers of characters. The model says yes: the model reads each item — one generation per item, counted toward the Cap.',
  filterInvertHint: 'Keep the items that do NOT match instead.',
  filterModelHint: 'Which of the farm’s models judges the items. Automatic: the farm’s default model.',
  filterCriterionHint: 'What to look for. A text wired into “Criterion” is used instead.',
  filterCriterionPlaceholder: 'What must an item be?',

  // how many items a list carries — the half the canvas preview cannot say
  itemsOne: '1 item',
  itemsCount: '{n} items',

  // fan-out, on the part
  itemsRunning: '{i}/{n}',
  itemsFailed: '{n} of {total} items failed',
  itemError: 'Item {i}: {message}',

  // failures a part reports on itself (never a silent empty, §1.2)
  errNoFarm: 'No farm is connected, so this box cannot run.',
  errNoInput: 'Nothing is wired into its “{port}” input yet: draw a wire into it.',
  errBadInput: '{port} got {kind}, which this box does not take.',
  // The ask spine's own sentence already names the farm ('The farm could not answer: …'), so a
  // second prefix here stuttered on screen (C2 landing). Pass it through; errFarmSilent is for
  // the only case that needs words of its own — a refusal that came with none.
  errFarm: '{message}',
  errFarmSilent: 'The farm refused this, and said nothing about why.',
  errEmpty: 'The model answered with nothing.',
  errInvalid: 'The answer did not match the shape you asked for.',
  errBusy: 'The farm is busy with someone else. Press Run all (or ▶ on this box) again in a moment.',
  errFanoutMany: 'Two inputs are lists at once. Join one of them with Collect before this box.',
  errAllItems: 'Every item failed. The first said: {message}',
  errCapped: 'This run reached its Cap of {cap} generations (answers from the model). Raise the Cap in the toolbar to go further.',
  errNoItems: 'Splitting the text this way produced no items.',
  errNotJson: 'That text is not JSON, so it cannot be split as a JSON array.',
  errNoSeparator: 'Type a separator before splitting this way.',
  errBadPattern: 'That pattern is not a valid regular expression.',
  errUnsafePattern: 'That pattern could run for ever. Simplify it, or choose Contains in Keep when.',
  errWiredPattern: 'A wired criterion cannot be a pattern. Type the pattern in this box, or choose Contains in Keep when.',
  errTooMany: 'Repeat makes at most {max} copies. Lower Times.',
  errNoCriterion: 'Write a criterion, or wire one in, before running this filter.',
  errNoThread: 'This box needs an open conversation.',
  errNoMessage: 'There is no such message in this conversation yet.',
  errNothingToPost: 'There is nothing to post.',
  errStillWriting: 'That answer is still being written. Run again once it has finished.',
  errEmptyMessage: 'That message has no text to take.',
  errAborted: 'Stopped before the farm answered.',
  errNoInstruction: 'Write an instruction, or wire something in, before running this box.',
  errNoSchema: 'The answer is set to JSON, so this box needs a JSON schema: write one in the box.',
  errBadSchema: 'That schema is not valid JSON.',
  errNoValue: 'This box produced nothing, so there is nothing to pass on.',

  // ---- C3 (§2.6 BJ): the sandbox parts and the one that writes a file. Seeded by the integrator
  // so the three stubs resolve at module load; C3-U2 owns every key below from here.
  codeLabel: 'Code',
  codeIn: 'Inputs',
  // Owner, 2026-09-27: a model can write the code (the `code` port), and the code can hide behind
  // what it does, in plain words.
  codeCodeIn: 'code',
  codeAbout: 'What it does',
  codeAboutPlaceholder: 'What this code does, in plain words',
  codeShow: 'Show the code ({n} lines)',
  codeHide: 'Hide the code',
  codeWhoseModel: 'Written by the model wired into “code”. Type in it to make it yours.',
  codeWhoseMine: 'Your code: the model’s is ignored while you keep it.',
  codeUseModel: 'Use the model’s code',
  codeUseModelHint: 'Run the code the model wrote into “code” again, instead of your edits.',
  codeAboutHint: 'Say what this code does, in plain words. It stays in view when the code is hidden.',
  codeFoldHint: 'Hide the code behind its “What it does” line, or show it again.',
  codeHint: 'Plain JavaScript, run in the sandbox (no network). `inputs.in` is an array of what arrives on Inputs; return text, a number, an array or an object.',
  renderLabel: 'Render',
  renderIn: 'Text',
  renderAlt: 'What this box drew',
  renderMode: 'Read as',
  renderModeMarkdown: 'Markdown',
  renderModeSvg: 'SVG',
  renderModeHtml: 'HTML page',
  fileLabel: 'File',
  fileIn: 'Value',
  filePath: 'Path in the project',
  filePathHint: 'Where to write, inside this graph’s own folder (LOL Studio Projects, in your data folder). Text goes in a text file (.md, .txt, .json, .css, .html…); a picture needs .png or .jpg (.svg for an SVG).',
  fileReveal: 'Show folder',
  fileRevealHint: 'Show this graph’s folder, where the file was written, in Explorer or Finder.',
  fileWrote: 'Wrote {path}',
  fileProjectFallback: 'Graph output',

  errCodeNoValue: 'That code returned nothing. Return text, a number, an array or an object.',
  errCodeList: 'A list arrived here whole, not item by item: Code gets the whole list on purpose, so read inputs.in as the array it is.',
  errRenderEmpty: 'There is nothing to draw yet.',
  errRenderNoPicture: 'The sandbox drew nothing that could be captured.',
  errFileEmpty: 'There is nothing to write.',
  errFileNoThread: 'This box writes into its graph’s own folder, so it needs a graph open from the library.',
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
  btnFaceHint: 'Press to run the boxes after this one.',
  btnTextHint: 'The words on the button. Empty, it says “Run this”.',
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
  condBranchHint: 'The boxes after this one run only when what arrives reads as this answer.',
  condModeHint: 'Reading the words is free: yes, true or oui is yes; no, false or non is no; anything else is maybe. Asking the model costs one generation.',
  condQuestionHint: 'What the model is asked about what arrives. Used only when it decides by asking the model.',
  condModelHint: 'Which model on the farm gives the verdict.',
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
  confirmTimeoutHint: 'If nobody answers in time, it counts as Cancel.',
  confirmMessageHint: 'The question shown on the box while it waits. Empty, it asks “Continue?”.',
  confirmOk: 'OK',
  confirmCancel: 'Cancel',
  confirmOkHint: 'Go on: the boxes after this one run.',
  confirmCancelHint: 'Stop this branch here. The rest of the run goes on.',
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
  dlgQuestionHint: 'The question shown on the box while it waits for your answer.',
  dlgPlaceholderHint: 'Grey words shown in the answer field before anyone types.',
  dlgDefaultHint: 'The answer passed on if the run is stopped before anyone answers.',
  dlgMultilineHint: 'A bigger answer field. Ctrl+Enter sends.',
  dlgAskEveryRunHint: 'On: it asks again on every run. Off: once answered, your answer is reused until something before it changes.',
  dlgSendHint: 'Pass your answer on (Enter).',

  togLabel: 'Toggle',
  togOn: 'On',
  togOnHint: 'On — what arrives goes on to the boxes after this one.',
  togOffHint: 'Off — the boxes after this one do not run.',
  togSwitchHint: 'Untick to stop the boxes after this one from running.',

  timerLabel: 'Timer',
  timerSeconds: 'Wait (seconds)',
  timerRepeats: 'Repeats',
  timerSecondsHint: 'How long each wait lasts: 0.1 to 3600 seconds.',
  timerRepeatsHint: 'How many times it waits in a row (at most 8). What comes after runs once, after the last wait.',
  timerHint: 'Waits {seconds} s, {repeats}×, then lets the run through.',
  timerWaiting: 'waiting {seconds} s…',

  errCodeEmpty: 'This box has no code yet: write some, or wire a Write code Instruction into its “code” port.',
  errCodeEmptyWire: 'The box wired into “code” sent no code. Run it again, or write the code here.',
  errCodeLine: 'Line {line}: {message}',
  errRenderNotSvg: 'That text does not start with <svg>, so it cannot be drawn as SVG.',
  errRenderTooBig: 'That picture is too large to keep on the canvas. Draw it smaller.',
  errFileNoPath: 'Type a path, like out/value.md, before writing.',
  errFileImageExt: 'A picture needs a picture file name — end the path with .png.',
  errFileBinary: 'That value is text, so it cannot be written to a picture file. End the path with .md, .txt or .json.',
});
