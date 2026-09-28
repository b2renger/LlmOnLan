// @ts-check
// Lesson 11 — an agent with tools (the night of 2026-09-28). DATA only, importing nothing.
//
// What the learner DOES: wires a list of readings into an Agent and names the arrow (the Agent reads each input by
// its name), runs it — step by step it picks ONE tool, here run_code in the sandbox, then answers — reads "How it got
// there" in a Preview, and finally sets the Agent's brake (Steps at most: one generation per step, the last step must
// answer) and runs it again. No web host is listed, so it cannot read the web. The saved answer is a real
// two-step report, in the exact shape the box writes (parts/agent.mjs reportOf).

export default {
  id: 'l11-an-agent-with-tools',
  n: 11,
  title: 'an agent with tools',
  subtitle: 'A model that works in short steps: it runs code over what you wire in, then answers — and shows every step.',
  idea: 'An Agent picks ONE tool per step: code in the sandbox, a web host a person listed, the farm’s Laya, or the answer. Its numbers come from code, and every step is shown.',
  minutes: 5,
  needsFarm: 'one',
  doc: {
    lolgraph: 1,
    title: 'Lesson 11 — an agent with tools',
    view: { x: 0, y: 0, zoom: 0.65 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 760, h: 106, settings: { text: '11 · an agent with tools', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 140, w: 1200, h: 84, settings: { text: 'A model that works in short steps: code over what you wire in, then the answer — every step shown.', size: 's' } },
      {
        id: 'n_idea', type: 'sticky', x: 40, y: 250, w: 320, h: 330,
        settings: { colour: 'yellow', text: 'An Agent works in short steps. Each step it picks ONE tool: run code over what is wired in (in the sandbox, no network), read a web host a PERSON listed on it, ask the farm’s Laya — or answer.\n\nIts numbers come from code, never from the model, and under its answer “How it got there” lists every step.' },
      },
      { id: 'p_data', type: 'note', x: 420, y: 250, w: 260, h: 150, settings: { text: '[12, 7, 30, 5, 18, 22, 9]', locked: false } },
      {
        id: 'n_label', type: 'sticky', x: 420, y: 440, w: 260, h: 180,
        settings: { colour: 'slate', text: 'A sensor’s readings. Name the arrow “readings”: the Agent’s code reads it as inputs["readings"].' },
      },
      {
        id: 'p_agent', type: 'agent', x: 740, y: 250, w: 320, h: 460,
        settings: { task: 'What are the average and the largest of the readings? Compute them with code.', hosts: '', maxSteps: 4, model: '' },
      },
      { id: 'p_view', type: 'preview', x: 1120, y: 250, w: 340, h: 400, settings: { mode: 'markdown' } },
      { id: 'n_next', type: 'sticky', x: 1120, y: 690, w: 340, h: 110, settings: { colour: 'green', text: 'Next up → 12 · open data.' } },
    ],
    wires: [
      { from: 'p_agent', to: 'p_view', port: 'content' },
    ],
  },
  steps: [
    {
      id: 's1',
      text: 'Wire the readings (the Text box) into the Agent, click the arrow’s “name me” tag and type readings: the Agent finds each input by its name.',
      check: { wire: { from: 'p_data', to: 'p_agent', label: 'readings' } },
      show: { partId: 'p_agent' },
    },
    {
      id: 's2',
      text: 'Press ▶ on the Agent. Step by step it picks one tool — here, code over the readings — and then answers.',
      hint: 'No farm? Use the saved answer when it is offered.',
      check: { ran: { partId: 'p_agent' } },
      show: { partId: 'p_agent' },
    },
    {
      id: 's3',
      text: 'Read “How it got there” in the Markdown view (empty? press its ▶): each number is a step’s result, computed by code. The model chose the code and the words.',
      check: { ran: { partId: 'p_view' } },
      show: { partId: 'p_view' },
    },
    {
      id: 's4',
      text: '“Steps at most” is its brake: each step spends one generation of the toolbar’s Cap. Set it to 2 and press ▶ on the Agent: it must answer by step 2.',
      hint: 'No farm? Use the saved answer again.',
      check: { all: [{ has: { id: 'p_agent', setting: 'maxSteps', equals: 2 } }, { ran: { partId: 'p_agent' } }] },
      show: { partId: 'p_agent' },
    },
  ],
  demo: {
    p_agent: {
      kind: 'text',
      data: 'The average of the seven readings is about 14.7, and the largest is 30.\n\n---\n**How it got there** — 2 steps (each result is what the tool gave back):\n1. **run_code** — read the readings as a list of numbers\n   → [12,7,30,5,18,22,9]\n2. **run_code** — add them up, divide by how many there are, and take the largest\n   → {"average":14.714285714285714,"largest":30}',
    },
  },
  next: 'l12-open-data',
};
