// @ts-check
// Box examples — the "Think" group (computer/examples/index.mjs says how an example becomes a graph).

import { creativePresets } from '../../graph/parts/creative.mjs';

/** A preset's own settings (a Write… box, a drawing box), so the example IS that preset.
 * @param {string} id @param {object} [extra] */
const preset = (id, extra = {}) => ({ ...(/** @type {any} */ (creativePresets().find((p) => p.id === id)) || { settings: {} }).settings, ...extra });
const view = { mode: 'markdown' };
const FARM = 'one: every run of the Instruction is a generation.';

/** A "Write a … → drawing box" pair. @param {string} key @param {string} title @param {string} mode @param {string} ask @param {string[]} extra */
const writeFor = (key, title, mode, ask, extra) => ({
  key,
  title,
  needsFarm: FARM,
  what: `An Instruction that answers with ${title.replace(/^Write /, '')}: the model writes the code, and the box wired after it draws it. The sandbox's rules ride along, so you only say what to draw.`,
  inputs: [['in (optional)', 'words or data to draw from, each arrow under its name']],
  output: 'Code, ready for the drawing box.',
  howto: [
    `Say what to draw: "${ask}"`,
    ...extra,
    'Wire the drawing box into Describe a picture, and that back here through a Toggle: the model sees what it drew and fixes it.',
  ],
  parts: [
    { id: 'e_write', type: 'ask', x: 0, y: 0, w: 340, h: 300, settings: preset(key, { instruction: ask }) },
    { id: 'e_draw', type: 'preview', x: 400, y: 0, w: 380, h: 480, settings: preset(mode) },
  ],
  wires: [{ from: 'e_write', to: 'e_draw', port: 'content' }],
});

export const THINK = [
  {
    key: 'ask',
    title: 'Instruction',
    needsFarm: FARM,
    what: 'Asks the farm\'s model to do ONE thing with what arrives: write, summarise, judge, translate. The answer flows on as text, or as a list or JSON when you pick that answer shape.',
    inputs: [['in', 'text, JSON, a picture or a file: every arrow, each under its name']],
    output: 'Text (or a list, or JSON, by Answer shape).',
    howto: [
      'Name the arrows coming in and mention the names in the instruction. Tick "Fill in {names} with their values" and {name} is replaced by that value, exactly there.',
      'Answer shape List: one item per line, and the next box runs once per item. JSON: give a schema.',
      'Pick a model in the box, or keep the farm\'s default. One run = one generation.',
    ],
    parts: [
      { id: 'e_topic', type: 'note', x: 0, y: 0, w: 320, h: 160, settings: { text: 'the first warm day of spring', locked: false } },
      { id: 'e_ask', type: 'ask', x: 380, y: 0, w: 340, h: 300, settings: { instruction: 'Write a haiku about {topic}.', inlineVars: true } },
      { id: 'e_view', type: 'preview', x: 780, y: 0, w: 320, h: 260, settings: view },
    ],
    wires: [{ from: 'e_topic', to: 'e_ask', port: 'in', label: 'topic' }, { from: 'e_ask', to: 'e_view', port: 'content' }],
  },
  writeFor('write-p5', 'Write a p5.js sketch', 'p5', 'A slow, colourful spiral that turns.', ['Wire it into a p5.js sketch box; press ▶ Live there to see it move (and react to the mouse, if the code does).']),
  writeFor('write-three', 'Write a three.js scene', 'three', 'A few floating shapes in soft light.', ['Wire it into a three.js scene box; ▶ Live lets you orbit the camera.']),
  writeFor('write-svg', 'Write an SVG', 'svg', 'A simple landscape: a sun, two hills and a house.', ['Wire it into an SVG box: the drawing is cleaned (no scripts) and shown as a picture.']),
  writeFor('write-html', 'Write an HTML page', 'html', 'A small page introducing a museum exhibition: a title, a paragraph and three highlights.', ['Wire it into an HTML page box: shown as a still picture (▶ Live runs it for real).']),
  {
    key: 'describe-image',
    title: 'Describe a picture',
    needsFarm: 'one with a model that can see (the farm\'s gemma4 can).',
    what: 'An Instruction for a model that can SEE: it looks at a picture and says what it shows and what to change. Wired after a drawing box, the model sees what it drew.',
    inputs: [['in', 'a picture: an Image box, or a drawing box (SVG, p5.js, three.js, HTML hand on a picture of what they drew)']],
    output: 'Text: the description, and what to change.',
    howto: [
      'SVG box → Describe a picture: the model reads the drawing.',
      'Close the loop: Write an SVG → SVG → Describe a picture → Toggle → back into Write an SVG. Turn the Toggle off to stop.',
      'Rewrite the question for your own check: "Is the text readable? Are the colours accessible?"',
    ],
    parts: [
      { id: 'e_svg', type: 'preview', x: 0, y: 0, w: 380, h: 460, settings: preset('svg') },
      { id: 'e_desc', type: 'ask', x: 440, y: 0, w: 340, h: 320, settings: preset('describe-image') },
    ],
    wires: [{ from: 'e_svg', to: 'e_desc', port: 'in' }],
  },
  {
    key: 'write-code',
    title: 'Write code',
    needsFarm: FARM,
    what: 'Say in plain words what to compute; the model writes the program and a Code box wired after it runs it. The numbers then come from the data, never from the model.',
    inputs: [['in', 'the data the code will run on, so the model sees its shape']],
    output: 'Code (JavaScript) for a Code box\'s code port.',
    howto: [
      'Wire the data into BOTH this box and the Code box\'s Inputs port; wire this box into the Code box\'s code port.',
      'Say it plainly: "add up the numbers at the end of each line".',
      'The model is TOLD to compute every number from the data; the Code box shows the program, so read it. Type in it to make it yours; "Use the model\'s code" gives it back.',
    ],
    parts: [
      { id: 'e_data', type: 'note', x: 0, y: 0, w: 300, h: 180, settings: { text: 'apples 3\npears 5\nplums 2', locked: false } },
      { id: 'e_write', type: 'ask', x: 360, y: 0, w: 340, h: 300, settings: preset('write-code', { instruction: 'Add up the numbers at the end of each line of the data and return the total.' }) },
      { id: 'e_code', type: 'code', x: 760, y: 0, w: 340, h: 260, settings: { code: '', about: 'Written by the model on its left.', folded: false } },
      { id: 'e_view', type: 'preview', x: 760, y: 320, w: 340, h: 220, settings: view },
    ],
    wires: [
      { from: 'e_data', to: 'e_write', port: 'in', label: 'data' },
      { from: 'e_data', to: 'e_code', port: 'in' },
      { from: 'e_write', to: 'e_code', port: 'code' },
      { from: 'e_code', to: 'e_view', port: 'content' },
    ],
  },
  {
    key: 'write-laya',
    title: 'Write a Laya question',
    needsFarm: 'one; the Classify box after it also wants the farm\'s Laya.',
    what: 'The model writes the multiple-choice question Laya (Classify) answers for every item, from your topics and a look at the items.',
    inputs: [['in', 'your topics and the items, each under its name']],
    output: 'JSON {question, options} for a Classify box\'s question port.',
    howto: [
      'Wire it into Classify\'s question port, and your topics into Classify\'s options port too: the options stay exactly yours.',
      'Laya reads one item at a time, so the question must be answerable from one item alone.',
      'The Read the news template uses exactly this.',
    ],
    parts: [
      { id: 'e_items', type: 'note', x: 0, y: 0, w: 300, h: 180, settings: { text: 'apple\ncarrot\nbanana\nleek', locked: false } },
      { id: 'e_topics', type: 'note', x: 0, y: 240, w: 300, h: 150, settings: { text: 'fruit\nvegetable\nother', locked: false } },
      { id: 'e_write', type: 'ask', x: 360, y: 0, w: 340, h: 320, settings: preset('write-laya', { instruction: 'Look at the items and the topics. Write the question Laya will answer for each item, one at a time, in under 12 words. The options are the topics, exactly as given.' }) },
      { id: 'e_cls', type: 'classify', x: 760, y: 0, w: 320, h: 240, settings: { question: 'What is this?', options: '', threshold: 0.6 } },
    ],
    wires: [
      { from: 'e_items', to: 'e_write', port: 'in', label: 'items' },
      { from: 'e_topics', to: 'e_write', port: 'in', label: 'topics' },
      { from: 'e_items', to: 'e_cls', port: 'items' },
      { from: 'e_write', to: 'e_cls', port: 'question' },
      { from: 'e_topics', to: 'e_cls', port: 'options' },
    ],
  },
  {
    key: 'classify',
    title: 'Classify (Laya)',
    needsFarm: 'one with the Classify (Laya) plugin, off by default; without it every item comes out unsure and nothing is sent.',
    what: 'Asks Laya, the farm\'s fast decision model, ONE multiple-choice question about every item of a list, with a confidence. One quick pass per item: not a generation, no seat.',
    inputs: [
      ['items', 'a list, an object holding a list, or lines of text'],
      ['options', 'the choices, one per line (or type them in the box)'],
      ['question', 'optional: a question a model wrote (Write a Laya question)'],
    ],
    output: 'JSON: a label and a confidence per item, the unsure ones, and under check the unsure items\' text.',
    howto: [
      'Sure above (0.6) splits sure from unsure; an unsure answer is for a model or a person to check.',
      'For a second opinion, wire it AND the topics into an Instruction: "For each item under check, pick one of the topics." The model re-reads only the unsure ones.',
      'Then a Code box counts: the labels are in inputs.in[0].labels.',
    ],
    parts: [
      { id: 'e_items', type: 'note', x: 0, y: 0, w: 320, h: 200, settings: { text: 'A new graphics card doubles the speed\nA comet is visible this weekend\nThe city council votes on bike lanes', locked: false } },
      { id: 'e_opts', type: 'note', x: 0, y: 260, w: 320, h: 170, settings: { text: 'hardware\nscience\npolitics\nother', locked: false } },
      { id: 'e_cls', type: 'classify', x: 380, y: 0, w: 320, h: 240, settings: { question: 'What is this headline mainly about?', options: '', threshold: 0.6 } },
      { id: 'e_view', type: 'preview', x: 760, y: 0, w: 340, h: 300, settings: view },
    ],
    wires: [
      { from: 'e_items', to: 'e_cls', port: 'items' },
      { from: 'e_opts', to: 'e_cls', port: 'options' },
      { from: 'e_cls', to: 'e_view', port: 'content' },
    ],
  },
  {
    key: 'agent',
    title: 'Agent',
    needsFarm: 'one: every step is a generation (the run bar counts up to "Steps at most").',
    what: 'A model that works in SHORT STEPS. Each step it picks one tool — run code over what is wired in, read a web host you allowed, ask Laya — and sees the result, until it answers. The answer comes with every step it took, so you can check where each number came from. It never sends to a device.',
    inputs: [['in', 'anything: text, data, lists — each arrow under its name (the agent reads inputs["that name"])']],
    output: 'Text (markdown): the answer, then "How it got there", one line per step with what the tool gave back.',
    howto: [
      'Say the task in plain words, and what to compute: the agent computes numbers with code, it does not guess them.',
      'Web hosts it may read: exactly the names you list (e.g. tabular-api.data.gouv.fr for French open data). Empty: no web at all.',
      'Steps at most (6): each step is one generation. A small task needs 2 or 3 — run code, then answer.',
    ],
    parts: [
      { id: 'e_nums', type: 'note', x: 0, y: 0, w: 320, h: 170, settings: { text: '[12, 7, 30, 5, 18, 22, 9]', locked: false } },
      { id: 'e_agent', type: 'agent', x: 380, y: 0, w: 340, h: 460, settings: { task: 'What are the average and the largest of these readings? Compute them with code, then answer in one sentence.', hosts: '', maxSteps: 4, model: '' } },
      { id: 'e_view', type: 'preview', x: 760, y: 0, w: 380, h: 320, settings: view },
    ],
    wires: [
      { from: 'e_nums', to: 'e_agent', port: 'in', label: 'readings' },
      { from: 'e_agent', to: 'e_view', port: 'content' },
    ],
  },
  {
    key: 'split',
    title: 'Split',
    what: 'Cuts text into a list of items. A box after it that takes text (an Instruction) runs once PER ITEM; Collect, Filter, Code and Classify take the whole list. No model, no farm.',
    inputs: [['text', 'text or JSON to cut']],
    output: 'A list.',
    howto: [
      'Modes: lines · numbered (a model\'s "1. …" list) · json (an array) · separator (like a comma) · paragraphs.',
      'Into an Instruction: it runs once per item. Into Collect: the items come back together.',
      'Separator: the character(s) between items, like a comma.',
    ],
    parts: [
      { id: 'e_text', type: 'note', x: 0, y: 0, w: 300, h: 150, settings: { text: 'red, green, blue', locked: false } },
      { id: 'e_split', type: 'split', x: 360, y: 0, w: 300, h: 200, settings: { mode: 'separator', separator: ',', limit: 0 } },
      { id: 'e_col', type: 'collect', x: 720, y: 0, w: 300, h: 200, settings: { mode: 'numbered' } },
      { id: 'e_view', type: 'preview', x: 720, y: 260, w: 300, h: 220, settings: view },
    ],
    wires: [
      { from: 'e_text', to: 'e_split', port: 'text' },
      { from: 'e_split', to: 'e_col', port: 'items' },
      { from: 'e_col', to: 'e_view', port: 'content' },
    ],
  },
  {
    key: 'filter',
    title: 'Filter',
    what: 'Keeps the items of a list that match. contains, matches and length are free and instant; model asks a yes/no question per item (a small generation each, remembered).',
    inputs: [['items', 'a list'], ['criterion (optional)', 'the words to look for, instead of typing them in the box']],
    output: 'A list: the items that passed.',
    howto: [
      'Keep when Contains "rain" keeps the lines that mention rain; "Keep the others instead" turns it around.',
      'Length is keeps the items between min and max characters.',
      'The model says yes: "Is this a question?" asks the farm, one yes/no per item.',
    ],
    parts: [
      { id: 'e_text', type: 'note', x: 0, y: 0, w: 300, h: 180, settings: { text: 'rain on Monday\nsun on Tuesday\nrain and wind on Friday', locked: false } },
      { id: 'e_split', type: 'split', x: 360, y: 0, w: 300, h: 200, settings: { mode: 'lines' } },
      { id: 'e_filter', type: 'filter', x: 720, y: 0, w: 300, h: 240, settings: { mode: 'contains', text: 'rain' } },
      { id: 'e_col', type: 'collect', x: 720, y: 300, w: 300, h: 200, settings: { mode: 'bullets' } },
      { id: 'e_view', type: 'preview', x: 360, y: 300, w: 300, h: 220, settings: view },
    ],
    wires: [
      { from: 'e_text', to: 'e_split', port: 'text' },
      { from: 'e_split', to: 'e_filter', port: 'items' },
      { from: 'e_filter', to: 'e_col', port: 'items' },
      { from: 'e_col', to: 'e_view', port: 'content' },
    ],
  },
  {
    key: 'collect',
    title: 'Collect',
    what: 'Joins many values back into one: the end of a fan-out, or several arrows made into one text or one JSON list.',
    inputs: [['items', 'a list, texts or JSON: every arrow, in order']],
    output: 'Text (bullets, numbered, or your template) or JSON (a list).',
    howto: [
      'Template per item: {item} is the value, {i} its number, {n} how many, like "{i}/{n}: {item}".',
      'After Split → Instruction, Collect puts the answers back together, in order.',
      'JSON keeps data as data for a Code box.',
    ],
    parts: [
      { id: 'e_text', type: 'note', x: 0, y: 0, w: 300, h: 160, settings: { text: 'one\ntwo\nthree', locked: false } },
      { id: 'e_split', type: 'split', x: 360, y: 0, w: 300, h: 200, settings: { mode: 'lines' } },
      { id: 'e_col', type: 'collect', x: 720, y: 0, w: 300, h: 220, settings: { mode: 'template', template: '{i}/{n}: {item}', separator: '\n' } },
      { id: 'e_view', type: 'preview', x: 720, y: 280, w: 300, h: 220, settings: view },
    ],
    wires: [
      { from: 'e_text', to: 'e_split', port: 'text' },
      { from: 'e_split', to: 'e_col', port: 'items' },
      { from: 'e_col', to: 'e_view', port: 'content' },
    ],
  },
  {
    key: 'repeat',
    title: 'Repeat',
    what: 'Makes a list of N copies of what arrives, so the next box runs N times: four variants of a poem, five sketches. Each pass is a real, separate run.',
    inputs: [['value', 'anything']],
    output: 'A list of N items (its template can number them: {item} {i} {n}).',
    howto: [
      'Times 4 before an Instruction: 4 different answers.',
      'Each item "Idea {i} of {n}: {item}" tells each pass which one it is.',
      'Mind the cap: N passes over an Instruction are N generations.',
    ],
    parts: [
      { id: 'e_text', type: 'note', x: 0, y: 0, w: 300, h: 150, settings: { text: 'a name for a cat', locked: false } },
      { id: 'e_rep', type: 'repeat', x: 360, y: 0, w: 300, h: 200, settings: { times: 3, template: 'Idea {i} of {n}: {item}' } },
      { id: 'e_col', type: 'collect', x: 720, y: 0, w: 300, h: 200, settings: { mode: 'bullets' } },
      { id: 'e_view', type: 'preview', x: 720, y: 260, w: 300, h: 220, settings: view },
    ],
    wires: [
      { from: 'e_text', to: 'e_rep', port: 'value' },
      { from: 'e_rep', to: 'e_col', port: 'items' },
      { from: 'e_col', to: 'e_view', port: 'content' },
    ],
  },
];

