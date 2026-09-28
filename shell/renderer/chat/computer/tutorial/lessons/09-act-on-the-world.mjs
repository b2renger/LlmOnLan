// @ts-check
// Lesson 9 — act on the world (the night of 2026-09-28). DATA only, importing nothing. No farm, no hardware.
//
// What the learner DOES: wires a light level into a Send box (OSC to port 9000 of THIS computer — harmless when
// nothing listens, heard by TouchDesigner / Max / Pure Data when something does), runs it as a DRY RUN (the box says
// what it would send; nothing leaves), arms the outputs in the run bar (a person's choice in a dialog that lists every
// target — no check can see a dialog, so it is a `manual` step), sends a new level for real, then presses Panic.

export default {
  id: 'l09-act-on-the-world',
  n: 9,
  title: 'act on the world',
  subtitle: 'A Send box hands a value to a device — but only once a person has armed the outputs.',
  idea: 'Every run is a dry run until a person arms the outputs: the Send box shows what it would send, and nothing leaves. Panic, reloading the app or opening another graph disarms them.',
  minutes: 4,
  needsFarm: 'no',
  doc: {
    lolgraph: 1,
    title: 'Lesson 9 — act on the world',
    view: { x: 0, y: 0, zoom: 0.75 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 640, h: 106, settings: { text: '9 · act on the world', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 140, w: 1000, h: 84, settings: { text: 'A Send box hands a value to a device — once a person has armed the outputs.', size: 's' } },
      {
        id: 'n_idea', type: 'sticky', x: 40, y: 250, w: 320, h: 260,
        settings: { colour: 'yellow', text: 'A Send box hands what arrives to a device: lights over DMX, a sound tool over OSC, a board over USB or Wi-Fi.\n\nNothing leaves until a PERSON arms the outputs in the run bar. Until then every run is a dry run: the box says what it would send.' },
      },
      { id: 'p_level', type: 'note', x: 420, y: 250, w: 240, h: 150, settings: { text: '0.75', locked: false } },
      {
        id: 'n_level', type: 'sticky', x: 420, y: 430, w: 240, h: 150,
        settings: { colour: 'slate', text: 'A light level: 0 is off, 1 is full.' },
      },
      { id: 'p_send', type: 'send', x: 720, y: 250, w: 320, h: 250, settings: { transport: 'osc', host: '127.0.0.1', port: 9000, address: '/lol/level' } },
      {
        id: 'n_where', type: 'sticky', x: 720, y: 540, w: 320, h: 170,
        settings: { colour: 'slate', text: 'It sends OSC to port 9000 of THIS computer. A tool listening there (TouchDesigner, Max, Pure Data) hears the level; if nothing listens, nothing happens.' },
      },
      { id: 'n_next', type: 'sticky', x: 1080, y: 250, w: 220, h: 170, settings: { colour: 'green', text: 'Next up → 10 · hear the world.' } },
    ],
    wires: [],
  },
  steps: [
    {
      id: 's1',
      text: 'Wire the Text box (a light level) into the Send box.',
      check: { wire: { from: 'p_level', to: 'p_send' } },
      show: { partId: 'p_level' },
    },
    {
      id: 's2',
      text: 'Press ▶ on the Send box. It is a dry run: the box says what it WOULD send, and nothing leaves this computer.',
      check: { ran: { partId: 'p_send' } },
      show: { partId: 'p_send' },
    },
    {
      id: 's3',
      text: 'Press “Outputs: dry run” in the run bar. It asks first and lists every place this graph sends to: read it, then press Arm.',
      check: { manual: true },
    },
    {
      id: 's4',
      text: 'Change the level to 0.2, then press ▶ on the Text box: the Send box now says Sent — a real OSC message left for port 9000.',
      check: { all: [{ edited: { partId: 'p_level', setting: 'text' } }, { ran: { partId: 'p_send' } }] },
      show: { partId: 'p_level' },
    },
    {
      id: 's5',
      text: 'Press Panic in the run bar: the run and every output stop, and the next run is a dry run again. Reloading the app disarms too.',
      check: { manual: true },
    },
  ],
  next: 'l10-hear-the-world',
};
