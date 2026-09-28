// @ts-check
// Lesson 6 — a loop that stops (COMPUTER_PLAN §10.3's "a loop that stops", shifted: see "As built" there). DATA
// only, importing nothing. No farm at all: the loop is a Code box and a Toggle, so it costs no generation.
//
// What the learner DOES: closes a ring (Code → Toggle → back into the Code box), runs it and watches the run stop
// BY ITSELF at the per-box ceiling (8 passes: measured 2026-09-28, report ran 16, limited by maxIterations), then
// turns the Toggle off and runs again: one pass, and the loop rests. The ceiling is the floor under every graph,
// the gate box is the brake a person holds — which is why a Trigger, an Agent or a loop can never run away.

export default {
  id: 'l06-a-loop-that-stops',
  n: 6,
  title: 'a loop that stops',
  subtitle: 'A ring of boxes needs a brake — and every run has a ceiling underneath.',
  idea: 'A loop is legal only through a gate box (a Toggle, a Condition, a Confirm…), and every run stops at its ceilings: 8 passes per box, 50 generations, 10 minutes.',
  minutes: 4,
  needsFarm: 'no',
  doc: {
    lolgraph: 1,
    title: 'Lesson 6 — a loop that stops',
    view: { x: 0, y: 0, zoom: 0.75 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 640, h: 106, settings: { text: '6 · a loop that stops', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 140, w: 900, h: 84, settings: { text: 'A ring of boxes needs a brake — and every run has a ceiling underneath.', size: 's' } },
      {
        id: 'n_idea', type: 'sticky', x: 40, y: 250, w: 320, h: 330,
        settings: { colour: 'yellow', text: 'The Computer refuses a ring of boxes unless one of them is a gate — a Toggle, a Condition, a Confirm, a Dialog, a Button or a Timer — something that can stop it. And under every run sit ceilings: 8 passes per box, 50 generations, 10 minutes. That is why a Trigger, an Agent or a loop can never run away with the farm.' },
      },
      { id: 'p_count', type: 'code', x: 440, y: 250, w: 300, h: 170, settings: { code: 'return (Number(inputs.in[0]) || 0) + 1;', about: 'Adds one to whatever comes back around.', folded: false } },
      { id: 'p_tog', type: 'toggle', x: 820, y: 250, w: 240, h: 140, settings: { on: true } },
      {
        id: 'n_brake', type: 'sticky', x: 820, y: 440, w: 240, h: 190,
        settings: { colour: 'slate', text: 'On lets the run through. Off stops it — and still hands its value on, so nothing is lost.' },
      },
      { id: 'n_next', type: 'sticky', x: 440, y: 470, w: 300, h: 120, settings: { colour: 'green', text: 'Next up → 7 · listen and speak. Lesson 10: a graph that runs by itself, with the same brakes.' } },
    ],
    wires: [
      { from: 'p_count', to: 'p_tog', port: 'in' },
    ],
  },
  steps: [
    {
      id: 's1',
      text: 'Close the ring: wire the Toggle back into the Code box. The Computer allows it, because the Toggle can stop it.',
      check: { wire: { from: 'p_tog', to: 'p_count' } },
      show: { partId: 'p_tog' },
    },
    {
      id: 's2',
      text: 'Press ▶ on the Code box. The number goes round and round — and the run stops by itself after 8 passes. No graph can run away.',
      check: { report: { ran: '>=16' } },
      show: { partId: 'p_count' },
    },
    {
      id: 's3',
      text: 'Now pull the brake: switch the Toggle off, then press ▶ on the Code box again. One pass, and the loop rests.',
      check: { all: [{ has: { id: 'p_tog', setting: 'on', equals: false } }, { ran: { partId: 'p_count' } }, { report: { ran: '<=2' } }] },
      show: { partId: 'p_tog' },
    },
  ],
  next: 'l07-listen-and-speak',
};
