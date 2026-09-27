// @ts-check
// Lesson 5 — code counts, the model names (ecosystem plan v2 §3 decision 6: "numbers never come from a
// model"; the rule behind "Read the news", "Analyse a dataset" and the Agent). DATA only, importing nothing.
//
// What the learner DOES: wires a small table into a Code box that adds it up (the program is given, folded
// behind its plain-words line — this lesson is about WHO computes, not about writing code), then wires the
// totals into an Instruction told to answer in words only, and finally changes a number to watch the totals
// and the sentence follow the data. One generation per pass; its saved answer is in the demo pack.

const TOTALS = [
  '// Adds up the crates per fruit. Every number is computed here, from the table — never by a model.',
  'const lines = String(inputs.in[0] || "").trim().split("\\n").slice(1);',
  'const totals = {};',
  'for (const line of lines) {',
  '  const [fruit, crates] = line.split(",");',
  '  const name = String(fruit || "").trim();',
  '  if (name) totals[name] = (totals[name] || 0) + (Number(crates) || 0);',
  '}',
  'return totals;',
].join('\n');

export default {
  id: 'l05-code-counts',
  n: 5,
  title: 'code counts, the model names',
  subtitle: 'When a number matters, a Code box computes it; the model only chooses the words.',
  idea: 'A model can miscount; code cannot. Give the numbers to code and the words to the model.',
  minutes: 5,
  needsFarm: 'one',
  doc: {
    lolgraph: 1,
    title: 'Lesson 5 — code counts, the model names',
    view: { x: 0, y: 0, zoom: 0.7 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 700, h: 106, settings: { text: '5 · code counts, the model names', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 140, w: 900, h: 84, settings: { text: 'When a number matters, a Code box computes it; the model only chooses the words.', size: 's' } },
      {
        id: 'n_idea', type: 'sticky', x: 40, y: 250, w: 320, h: 300,
        settings: { colour: 'yellow', text: 'A model reads numbers well but can miscount them. So when a total, an average or a count matters, a Code box computes it from the data, and the model is asked for words only. "Read the news", "Analyse a dataset" and the Agent all work this way.' },
      },
      { id: 'p_data', type: 'note', x: 460, y: 250, w: 240, h: 220, settings: { text: 'fruit,crates\napples,12\npears,7\napples,5\nplums,9\npears,3', locked: false } },
      { id: 'p_code', type: 'code', x: 760, y: 250, w: 300, h: 170, settings: { code: TOTALS, about: 'Adds up the crates per fruit, from the table.', folded: true } },
      {
        id: 'p_say', type: 'ask', x: 1120, y: 250, w: 260, h: 280,
        settings: { instruction: 'These are the crate totals per fruit. In one sentence, say which fruit leads and how the others compare — in words only, never write a number.' },
      },
      {
        id: 'n_rule', type: 'sticky', x: 460, y: 510, w: 240, h: 190,
        settings: { colour: 'slate', text: 'The numbers under the Code box were counted, not guessed. Change the table and they follow; the model never wrote one.' },
      },
      { id: 'n_next', type: 'sticky', x: 760, y: 480, w: 300, h: 140, settings: { colour: 'green', text: 'Next up → the templates: open "Analyse a dataset" to see the same rule on real open data.' } },
    ],
    wires: [],
  },
  steps: [
    {
      id: 's1',
      text: 'Wire the table (the Text box) into the Code box: drag from its right dot onto the Code box.',
      check: { wire: { from: 'p_data', to: 'p_code' } },
      show: { partId: 'p_data' },
    },
    {
      id: 's2',
      text: 'Press ▶ on the Code box. It adds up the crates per fruit; the totals appear under it. Open “Show the code” if you are curious — you do not need to read it.',
      check: { ran: { partId: 'p_code' } },
      show: { partId: 'p_code' },
    },
    {
      id: 's3',
      text: 'Wire the Code box into the Instruction, then press ▶ on the Instruction: the model reads the totals and answers in words only.',
      hint: 'No farm? Use the saved answer when it is offered.',
      check: { all: [{ wire: { from: 'p_code', to: 'p_say' } }, { ran: { partId: 'p_say' } }] },
      show: { partId: 'p_say' },
    },
    {
      id: 's4',
      text: 'Change a number in the table (make the plums win!), then press ▶ on the Text box: the totals and the sentence follow the data.',
      hint: 'No farm? The Code box still recounts; use the saved answer for the sentence.',
      check: { all: [{ edited: { partId: 'p_data', setting: 'text' } }, { ran: { partId: 'p_code' } }, { ran: { partId: 'p_say' } }] },
      show: { partId: 'p_data' },
    },
  ],
  demo: {
    p_say: { kind: 'text', data: 'Apples lead comfortably, while pears and plums trail well behind and are close to each other.' },
  },
};
