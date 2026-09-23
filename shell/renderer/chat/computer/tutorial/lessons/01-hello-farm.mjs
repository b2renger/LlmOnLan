// @ts-check
// Lesson 1 — hello, farm (COMPUTER_PLAN §10.3; tldraw's "hello world" in spirit). K5-U4 owns this
// file (addendum KE-4). DATA only, importing nothing (rule 15 imports it in Node).
//
// What the learner DOES: types an instruction, presses ▶, watches the answer travel along the one
// arrow into a Text box, and locks that box. The only generation is p_ask's; the demo pack has its
// answer, so the lesson completes with the farm absent (§10.2).
//
// Layout: authored for the rail (bottom-left, ~300 px) at the view's zoom — the left column holds
// only the title and one sticky above the rail; every box a step points at sits right of it.

export default {
  id: 'l01-hello-farm',
  n: 1,
  title: 'hello, farm',
  subtitle: 'An Instruction is a prompt you can point at and run.',
  idea: 'The model is not in this window: your laptop asks a machine on the network — the farm.',
  minutes: 4,
  needsFarm: 'one',
  doc: {
    lolgraph: 1,
    title: 'Lesson 1 — hello, farm',
    view: { x: 0, y: 0, zoom: 0.85 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 560, h: 106, settings: { text: '1 · hello, farm', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 140, w: 700, h: 84, settings: { text: 'An Instruction is a prompt you can point at and run.', size: 's' } },
      {
        id: 'n_idea', type: 'sticky', x: 40, y: 250, w: 300, h: 240,
        settings: { colour: 'yellow', text: 'An Instruction sends its words to a model on your farm — a machine on the network, not this laptop.\n\nPress ▶ in a box’s title bar to run it.' },
      },
      { id: 'p_ask', type: 'ask', x: 390, y: 250, w: 300, h: 260, settings: { instruction: '' } },
      { id: 'p_answer', type: 'note', x: 810, y: 250, w: 280, h: 220, settings: { text: '', locked: false } },
      {
        id: 'n_arrow', type: 'sticky', x: 810, y: 500, w: 280, h: 150,
        settings: { colour: 'yellow', text: 'A box that has run sends what it made along its arrows. This Text box shows whatever arrives — unless you lock it.' },
      },
      { id: 'n_next', type: 'sticky', x: 390, y: 550, w: 300, h: 100, settings: { colour: 'green', text: 'Next up → 2 · wires carry values' } },
    ],
    wires: [
      { from: 'p_ask', to: 'p_answer', port: 'in' },
    ],
  },
  steps: [
    {
      id: 's1',
      text: 'Click into the Instruction and type what you want — for example: Write a haiku about the sea.',
      check: { has: { id: 'p_ask', setting: 'instruction', nonEmpty: true } },
      show: { partId: 'p_ask' },
    },
    {
      id: 's2',
      text: 'Press ▶ in the Instruction’s title bar. It goes queued, running, done: a model on the farm is writing, not this laptop.',
      check: { ran: { partId: 'p_ask' } },
      show: { partId: 'p_ask' },
    },
    {
      id: 's3',
      text: 'The answer travels along the arrow into the Text box. If it has not arrived, press ▶ on the Text box.',
      check: { ran: { partId: 'p_answer' } },
      show: { partId: 'p_answer' },
    },
    {
      id: 's4',
      text: 'Press the lock on the Text box. A locked box keeps what it shows, whatever arrives next.',
      check: { has: { id: 'p_answer', setting: 'locked', equals: true } },
      show: { partId: 'p_answer' },
    },
  ],
  demo: {
    p_ask: { kind: 'text', data: 'Grey water folding\nover and over the stones —\nthe tide keeps its word.' },
  },
  next: 'l02-wires',
};
