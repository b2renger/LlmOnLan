// @ts-check
// Lesson 10 — hear the world (the night of 2026-09-28). DATA only, importing nothing. No farm, no hardware.
//
// What the learner DOES: wires a Trigger into a Code box. The Trigger ticks on a SCHEDULE (every 3 s) — the one
// source that works on any computer; its other source, a message on the farm's message bus, needs a farm with the
// bus plugin on (the templates "A board on Wi-Fi" and "Talk to a board", and the sticky, say so). It starts runs only
// once the outputs are armed — the run bar's "Outputs" control, which a graph shows only with a Send box, hence the
// Send box (OSC to this computer, like lesson 9). Then the learner slows it (latest wins) and disarms it.
// A check sees the doc and the last run, never who pressed ▶: after a tick, a hand ▶ on the Code box also shows the
// tick (the Trigger remembers it even disarmed), so s2–s3 tick on it too. Arming itself is a dialog: s4 is `manual`.

const HEARD = [
  '// The Trigger hands on {tick, at}: which tick, and when.',
  'const e = inputs.in[0] || {};',
  'return "Tick " + e.tick + ", heard at " + new Date(e.at).toLocaleTimeString();',
].join('\n');

export default {
  id: 'l10-hear-the-world',
  n: 10,
  title: 'hear the world',
  subtitle: 'A Trigger presses ▶ for you: on a clock here, on a board’s message on a farm with the message bus.',
  idea: 'A Trigger starts runs by itself, but only while a person has armed the outputs and the Computer is on screen — and at most one run every few seconds.',
  minutes: 4,
  needsFarm: 'no',
  doc: {
    lolgraph: 1,
    title: 'Lesson 10 — hear the world',
    view: { x: 0, y: 0, zoom: 0.65 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 640, h: 106, settings: { text: '10 · hear the world', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 140, w: 1200, h: 84, settings: { text: 'A Trigger presses ▶ for you: on a clock here, on a board’s message on a farm with the message bus.', size: 's' } },
      {
        id: 'n_idea', type: 'sticky', x: 40, y: 250, w: 320, h: 330,
        settings: { colour: 'yellow', text: 'A Trigger presses ▶ for you: every few seconds, or on each message on the farm’s message bus.\n\nIt starts runs ONLY while a person has armed the outputs (the Send box’s arming, in the run bar) and the Computer is on screen — at most one run every few seconds, and so many an hour.' },
      },
      { id: 'p_trig', type: 'trigger', x: 420, y: 250, w: 320, h: 300, settings: { source: 'schedule', topic: 'lol/#', every: 3, gapSec: 2, perHour: 60 } },
      { id: 'p_heard', type: 'code', x: 800, y: 250, w: 300, h: 180, settings: { code: HEARD, about: 'Says which tick it heard, and when.', folded: false } },
      { id: 'p_send', type: 'send', x: 800, y: 470, w: 300, h: 250, settings: { transport: 'osc', host: '127.0.0.1', port: 9000, address: '/lol/tick' } },
      {
        id: 'n_bus', type: 'sticky', x: 1160, y: 250, w: 300, h: 290,
        settings: { colour: 'slate', text: 'On a farm with the message bus on, set Start on to “a message on the farm’s bus”: a board or another Computer presses ▶ for you, and a Receive box shows what they say, live. The templates “A board on Wi-Fi” and “Talk to a board” do it.' },
      },
      { id: 'n_next', type: 'sticky', x: 1160, y: 580, w: 300, h: 120, settings: { colour: 'green', text: 'Next up → 11 · an agent with tools.' } },
    ],
    wires: [
      { from: 'p_heard', to: 'p_send', port: 'in' },
    ],
  },
  steps: [
    {
      id: 's1',
      text: 'Wire the Trigger into the Code box. The Trigger ticks every 3 seconds but starts nothing yet: its face says why.',
      check: { wire: { from: 'p_trig', to: 'p_heard' } },
      show: { partId: 'p_trig' },
    },
    {
      id: 's2',
      text: 'Arm the outputs in the run bar (it asks first). Now each tick presses ▶ for you: the Code box says which tick it heard.',
      check: { all: [{ ran: { partId: 'p_heard' } }, { ran: { partId: 'p_send' } }] },
      show: { partId: 'p_heard' },
    },
    {
      id: 's3',
      text: 'Slow it down: set “At most one run every” to 6 seconds. The ticks in between only update the value (latest wins); the face counts them.',
      check: { all: [{ edited: { partId: 'p_trig', setting: 'gapSec' } }, { ran: { partId: 'p_heard' } }] },
      show: { partId: 'p_trig' },
    },
    {
      id: 's4',
      text: 'Disarm: press “Outputs: LIVE” in the run bar. The clock keeps ticking, but no run starts — and none starts while the Computer is hidden.',
      check: { manual: true },
    },
  ],
  next: 'l11-an-agent-with-tools',
};
