// @ts-check
// Box examples — the "Control" and "Annotate" groups (computer/examples/index.mjs says how an example
// becomes a graph).

const view = { mode: 'markdown' };
const note = (/** @type {string} */ id, /** @type {string} */ text, x = 0, y = 0) => ({ id, type: 'note', x, y, w: 300, h: 150, settings: { text, locked: false } });

export const CONTROL = [
  {
    key: 'button',
    title: 'Button',
    needsFarm: 'only for the Instruction after it.',
    what: 'A gate you press. Run all never presses it: the run stops before it, and the run bar says a button is waiting. Press its face and what comes after it runs.',
    inputs: [['in', 'anything: passed on when pressed']],
    output: 'What arrived, unchanged.',
    howto: [
      'Put it before an expensive branch (a long generation), so that branch runs only when you choose.',
      'Press the button itself (its face), not the ▶ in its title bar.',
      'Label: the words on the button.',
    ],
    parts: [
      note('e_text', 'Tell me a short joke about computers.'),
      { id: 'e_btn', type: 'button', x: 360, y: 0, w: 260, h: 150, settings: { text: 'Go on' } },
      { id: 'e_ask', type: 'ask', x: 680, y: 0, w: 340, h: 280, settings: { instruction: 'Answer the request in two lines.' } },
    ],
    wires: [{ from: 'e_text', to: 'e_btn', port: 'in' }, { from: 'e_btn', to: 'e_ask', port: 'in' }],
  },
  {
    key: 'condition',
    title: 'Condition',
    what: 'Reads what arrives as yes, no or maybe, and lets the run through only on ITS branch. Put two or three side by side for a yes / no / maybe fork: the other branches go grey.',
    inputs: [['in', 'anything']],
    output: 'What arrived, unchanged (on its branch only).',
    howto: [
      'Continue when: which answer this box lets through.',
      'Text mode (free) reads the first word: yes, true, oui → yes; no, false, non → no; anything else → maybe.',
      'Model mode: write a question ("Is this a complaint?"); one small generation, remembered.',
    ],
    parts: [
      note('e_text', 'yes'),
      { id: 'e_yes', type: 'condition', x: 360, y: 0, w: 280, h: 200, settings: { branch: 'yes', mode: 'text' } },
      { id: 'e_no', type: 'condition', x: 360, y: 260, w: 280, h: 200, settings: { branch: 'no', mode: 'text' } },
      { id: 'e_pyes', type: 'preview', x: 700, y: 0, w: 280, h: 200, settings: view },
      { id: 'e_pno', type: 'preview', x: 700, y: 260, w: 280, h: 200, settings: view },
    ],
    wires: [
      { from: 'e_text', to: 'e_yes', port: 'in' },
      { from: 'e_text', to: 'e_no', port: 'in' },
      { from: 'e_yes', to: 'e_pyes', port: 'content' },
      { from: 'e_no', to: 'e_pno', port: 'content' },
    ],
  },
  {
    key: 'confirm',
    title: 'Confirm',
    what: 'Stops THIS branch and asks OK or Cancel right on the box. OK lets the run go on; Cancel stops it there, while other branches keep going.',
    inputs: [['in', 'anything']],
    output: 'What arrived, unchanged (onward only after OK).',
    howto: [
      'Message: what you are asked, like "Save this to a file?"',
      'Give up after (seconds) cancels by itself when nobody answers; 0 waits.',
      'Put it before a Send or a File box: nothing leaves until you say so.',
    ],
    parts: [
      note('e_text', 'Hello, world'),
      { id: 'e_conf', type: 'confirm', x: 360, y: 0, w: 300, h: 200, settings: { message: 'Save this text to a file?', timeoutSec: 0 } },
      { id: 'e_file', type: 'file', x: 720, y: 0, w: 300, h: 160, settings: { path: 'out/hello.md' } },
    ],
    wires: [{ from: 'e_text', to: 'e_conf', port: 'in' }, { from: 'e_conf', to: 'e_file', port: 'in' }],
  },
  {
    key: 'dialog',
    title: 'Dialog',
    needsFarm: 'only for the Instruction after it.',
    what: 'Asks YOU a question in the box, with a field and Send, and hands your answer on. The rest of the graph keeps running while it waits.',
    inputs: [['Context (optional)', 'anything: it decides WHEN the question is asked (its words are not shown)']],
    output: 'Text: your answer.',
    howto: [
      'Question and Hint text are what you read. If the run is stopped before you answer, "If nobody answers" is handed on and the branch stops there.',
      'Ask again every run off: asked once, the answer is kept. On: asked each time.',
      'Name the arrow out of it (animal); an Instruction with "Fill in {names} with their values" ticked puts the answer where it says {animal}.',
    ],
    parts: [
      { id: 'e_dlg', type: 'dialog', x: 0, y: 0, w: 320, h: 220, settings: { question: 'What is your favourite animal?', placeholder: 'a fox', multiline: false, default: '', askEveryRun: false } },
      { id: 'e_ask', type: 'ask', x: 380, y: 0, w: 340, h: 280, settings: { instruction: 'Write one surprising fact about {animal}.', inlineVars: true } },
    ],
    wires: [{ from: 'e_dlg', to: 'e_ask', port: 'in', label: 'animal' }],
  },
  {
    key: 'toggle',
    title: 'Toggle',
    what: 'A switch: on lets the run through, off stops it and still hands its value on. Like every gate box, it makes a loop legal: a ring of boxes needs something that can stop it.',
    inputs: [['in', 'anything']],
    output: 'What arrived, unchanged.',
    howto: [
      'Flip it to switch a branch off without deleting it.',
      'A loop (Write an SVG → SVG → Describe a picture → back) must pass through a gate box: a Toggle, Button, Condition, Confirm, Dialog or Timer. With a Toggle, turn it off to stop the rounds.',
      'Flipping it marks what comes after as out of date; it does not run by itself.',
    ],
    parts: [
      note('e_text', 'This goes through while the Toggle is on.'),
      { id: 'e_tog', type: 'toggle', x: 360, y: 0, w: 240, h: 140, settings: { on: true } },
      { id: 'e_view', type: 'preview', x: 660, y: 0, w: 300, h: 220, settings: view },
    ],
    wires: [{ from: 'e_text', to: 'e_tog', port: 'in' }, { from: 'e_tog', to: 'e_view', port: 'content' }],
  },
  {
    key: 'timer',
    title: 'Timer',
    what: 'Waits a few seconds, then lets the run through. There is no "forever".',
    inputs: [['in', 'anything']],
    output: 'What arrived, unchanged, after the wait.',
    howto: [
      'Wait (seconds): 0.1 to 3600.',
      'Repeats: how many times the wait happens; what comes after runs once, after all of them. A run whose waits add up past its time limit is refused before it starts.',
      'Put it before a step that must not come too soon: a Send to a device, a question to a person.',
    ],
    parts: [
      note('e_text', 'tick'),
      { id: 'e_timer', type: 'timer', x: 360, y: 0, w: 260, h: 170, settings: { seconds: 2, repeats: 3 } },
      { id: 'e_view', type: 'preview', x: 680, y: 0, w: 300, h: 220, settings: view },
    ],
    wires: [{ from: 'e_text', to: 'e_timer', port: 'in' }, { from: 'e_timer', to: 'e_view', port: 'content' }],
  },
  {
    key: 'trigger',
    title: 'Trigger',
    needsFarm: 'one with the Message bus plugin, for a trigger on a topic (a schedule needs nothing).',
    what: 'Starts a run by itself: on each message on a topic of the farm\'s message bus (a board\'s button, a sensor), or every few seconds. Only while you have armed the outputs and the Computer is on screen.',
    inputs: [],
    output: 'The message that started the run, as {topic, data} (or {tick, at} on a schedule).',
    howto: [
      'Arm the outputs in the run bar first: until then it only counts the messages.',
      'Topic lol/+/button fires on any board\'s button; a Code box reads inputs.in[0].data.',
      'At most one run every N seconds (the messages in between only update the value: latest wins), and at most N runs an hour.',
    ],
    parts: [
      { id: 'e_trig', type: 'trigger', x: 0, y: 0, w: 320, h: 250, settings: { source: 'schedule', every: 10, gapSec: 2, perHour: 60 } },
      {
        id: 'e_code', type: 'code', x: 380, y: 0, w: 340, h: 200,
        settings: { code: 'const e = inputs.in[0] || {};\nreturn "Tick " + (e.tick ?? "?") + " at " + (e.at || "");', about: 'Says which tick started this run.', folded: false },
      },
      { id: 'e_view', type: 'preview', x: 380, y: 260, w: 340, h: 200, settings: view },
    ],
    wires: [{ from: 'e_trig', to: 'e_code', port: 'in' }, { from: 'e_code', to: 'e_view', port: 'content' }],
  },
  {
    key: 'sticky',
    title: 'Sticky note',
    what: 'A note on the canvas for people: what a part of the graph does, a to-do, a warning. It never runs and is never sent anywhere.',
    inputs: [],
    output: 'None.',
    howto: [
      'Pick a colour to group ideas.',
      'Every example you open with ? starts with a yellow one like this.',
    ],
    parts: [{ id: 'e_s', type: 'sticky', x: 0, y: 0, w: 320, h: 220, settings: { colour: 'rose', text: 'To do: check the chart numbers come from the Code box, never from a model.' } }],
    wires: [],
  },
  {
    key: 'section',
    title: 'Section',
    what: 'A labelled frame that groups boxes: drag boxes into it to show they belong together.',
    inputs: [],
    output: 'None.',
    howto: [
      'Name it for the step it holds: "Getting the data", "Drawing".',
      'It never runs; it only makes a big graph easier to read.',
    ],
    parts: [
      { id: 'e_sec', type: 'section', x: 0, y: 0, w: 560, h: 320, settings: { text: 'Getting the data' } },
      note('e_text', 'A box inside the section.', 40, 80),
    ],
    wires: [],
  },
  {
    key: 'title',
    title: 'Title',
    what: 'A big heading on the canvas: the graph\'s name, or a chapter of it. Size S, M or L.',
    inputs: [],
    output: 'None.',
    howto: ['Put one at the top of every graph you share.', 'Pair it with a Sticky that says what the graph is for.'],
    parts: [{ id: 'e_t', type: 'title', x: 0, y: 0, w: 520, h: 90, settings: { text: 'My first graph', size: 'm' } }],
    wires: [],
  },
];
