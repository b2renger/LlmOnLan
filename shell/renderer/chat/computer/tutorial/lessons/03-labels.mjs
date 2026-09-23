// @ts-check
// Lesson 3 — arrow labels are names (COMPUTER_PLAN §10.3, THE HINGE; tldraw's "arrow labels work
// like named parameters"). K5-U4 owns this file (addendum KE-4). DATA only, importing nothing.
//
// Why these two texts: either could be "before". With the arrows blank the prompt carries
// `## Input 1` / `## Input 2` (graph/bind.mjs rule 1) and the model has to GUESS which way the
// street went; named, the inputs arrive as `## before` / `## after`, in the order the instruction
// mentions them (rule 9). Then the learner SWAPS the names and the story runs backwards — same
// boxes, same words, only the names changed: a label is a variable, not decoration.
//
// Every rename marks p_ask stale (model.mjs setWireLabel), so each `ran` below needs a real press.
// The demo pack has ONE answer for p_ask (the format keys demo by part), written for the named
// direction; it is badged "demo answer — not generated" wherever it is used.

export default {
  id: 'l03-labels',
  n: 3,
  title: 'arrow labels are names',
  subtitle: 'Name an arrow, and the Instruction can use that name.',
  idea: 'A label is a variable, not decoration: rename it and the prompt changes with it.',
  minutes: 6,
  needsFarm: 'one',
  doc: {
    lolgraph: 1,
    title: 'Lesson 3 — arrow labels are names',
    view: { x: 0, y: 0, zoom: 0.85 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 640, h: 106, settings: { text: '3 · arrow labels are names', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 140, w: 760, h: 84, settings: { text: 'Name an arrow, and the Instruction can use that name.', size: 's' } },
      {
        id: 'n_idea', type: 'sticky', x: 40, y: 250, w: 300, h: 260,
        settings: { colour: 'yellow', text: 'The instruction talks about “before” and “after”. Until the arrows carry those names, the model receives Input 1 and Input 2 — and has to guess which street came first.' },
      },
      { id: 'p_cars', type: 'note', x: 390, y: 250, w: 250, h: 140, settings: { text: 'A street full of cars: vans parked on both kerbs, engines idling, nowhere to sit.', locked: false } },
      { id: 'p_trees', type: 'note', x: 390, y: 420, w: 250, h: 140, settings: { text: 'A street with young trees, benches in the shade and children drawing on the ground in chalk.', locked: false } },
      {
        id: 'p_ask', type: 'ask', x: 720, y: 280, w: 280, h: 270,
        settings: { instruction: 'Describe how the street changed from before to after, in three sentences. Who gained something, and who lost something?' },
      },
      {
        id: 'n_try', type: 'sticky', x: 1020, y: 280, w: 150, h: 290,
        settings: { colour: 'slate', text: 'After your first ▶, click an arrow to name it. Then click the grey line under the instruction: the prompt now has a heading for each name.' },
      },
      { id: 'n_next', type: 'sticky', x: 720, y: 590, w: 280, h: 100, settings: { colour: 'green', text: 'Next up → 4 · make a picture' } },
    ],
    wires: [
      { from: 'p_cars', to: 'p_ask', port: 'in' },
      { from: 'p_trees', to: 'p_ask', port: 'in' },
    ],
  },
  steps: [
    {
      id: 's1',
      text: 'Press ▶ on the Instruction while both arrows are blank: the model gets Input 1 and Input 2 and must guess which is before. Named them already? Clear the names.',
      // The blank run IS the point (the contrast the lesson teaches), so naming first does not skip
      // it. The sticky beside the box therefore says "after your first ▶", and this step says how
      // to get back if the learner named them anyway — never a dead end.
      check: { all: [{ wire: { to: 'p_ask', label: 'blank', count: 2 } }, { ran: { partId: 'p_ask' } }] },
      show: { partId: 'p_ask' },
    },
    {
      id: 's2',
      text: 'Name the arrows: click the arrow from the busy street and type before, then click the other one and type after.',
      check: { all: [{ wire: { from: 'p_cars', to: 'p_ask', label: 'before' } }, { wire: { from: 'p_trees', to: 'p_ask', label: 'after' } }] },
      show: { wire: { from: 'p_cars', to: 'p_ask' } },
    },
    {
      id: 's3',
      text: 'Click the grey line under the instruction to read what will be sent: the inputs are now headed before and after.',
      check: { manual: true },
      show: { partId: 'p_ask' },
    },
    {
      id: 's4',
      text: 'Press ▶ again. Same boxes, same words — only the names changed, and now the answer knows which way the street went.',
      check: { all: [{ wire: { from: 'p_cars', to: 'p_ask', label: 'before' } }, { wire: { from: 'p_trees', to: 'p_ask', label: 'after' } }, { ran: { partId: 'p_ask' } }] },
      show: { partId: 'p_ask' },
    },
    {
      id: 's5',
      text: 'Swap the names — before on the tree-lined street, after on the busy one — and press ▶. The story runs backwards.',
      check: { all: [{ wire: { from: 'p_trees', to: 'p_ask', label: 'before' } }, { wire: { from: 'p_cars', to: 'p_ask', label: 'after' } }, { ran: { partId: 'p_ask' } }] },
      show: { wire: { from: 'p_trees', to: 'p_ask' } },
    },
  ],
  demo: {
    p_ask: { kind: 'text', data: 'Before, the street belonged to cars: vans on both kerbs, engines running and nowhere to stop. After, it belongs to people — trees, shaded benches and children drawing in chalk. Drivers lost their parking; everyone who walks, sits or plays gained a place to stay a while.' },
  },
  next: 'l04-draw',
};
