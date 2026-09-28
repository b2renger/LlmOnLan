// @ts-check
// Lesson 8 — a picture to a model (the night of 2026-09-28). DATA only, importing nothing.
//
// What the learner DOES: takes a webcam picture in the Image box (Take a picture → Capture: one frame, then the
// camera closes; no camera → drop or paste one), wires it into an Instruction and runs it — the picture rides the
// request to a model that can see — then asks the same picture another question. The picture is kept in the graph
// on this computer; it leaves only inside a run's request. A saved description is in the demo pack, and it says it
// did not see the learner's picture.

export default {
  id: 'l08-a-picture-to-a-model',
  n: 8,
  title: 'a picture to a model',
  subtitle: 'Take a picture with the webcam and let a model that can see describe it.',
  idea: 'A picture wired into an Instruction travels with the words, inside the request, to a model that can see. It is kept on this computer; the farm keeps nothing.',
  minutes: 4,
  needsFarm: 'one',
  doc: {
    lolgraph: 1,
    title: 'Lesson 8 — a picture to a model',
    view: { x: 0, y: 0, zoom: 0.7 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 760, h: 106, settings: { text: '8 · a picture to a model', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 140, w: 1000, h: 84, settings: { text: 'Take a picture with the webcam and let a model that can see describe it.', size: 's' } },
      {
        id: 'n_idea', type: 'sticky', x: 40, y: 250, w: 320, h: 300,
        settings: { colour: 'yellow', text: 'The Image box keeps ONE picture: a webcam frame, a file you drop, or one you paste. It stays in this graph, on this computer.\n\nWired into an Instruction, the picture travels with the words, inside the request, to a model that can see. The farm keeps nothing.' },
      },
      { id: 'p_img', type: 'image', x: 420, y: 250, w: 320, h: 300, settings: {} },
      {
        id: 'p_look', type: 'ask', x: 800, y: 250, w: 320, h: 300,
        settings: { instruction: 'Look at the picture. In two or three sentences, say what you see: the things in it, their colours, and the light.' },
      },
      {
        id: 'n_blind', type: 'sticky', x: 800, y: 590, w: 320, h: 150,
        settings: { colour: 'slate', text: 'A model that cannot see refuses BEFORE anything is sent: pick another in the Instruction’s Model menu.' },
      },
      { id: 'n_next', type: 'sticky', x: 1180, y: 250, w: 200, h: 200, settings: { colour: 'green', text: 'Next up → 9 · act on the world.' } },
    ],
    wires: [],
  },
  steps: [
    {
      id: 's1',
      text: 'Press Take a picture on the Image box, then Capture: one frame is kept and the camera closes. No camera? Drop or paste a picture.',
      check: { has: { id: 'p_img', setting: 'dataUrl', nonEmpty: true } },
      show: { partId: 'p_img' },
    },
    {
      id: 's2',
      text: 'Wire the Image into the Instruction, then press ▶ on the Instruction: the picture rides with the words to a model that can see.',
      hint: 'No farm? Use the saved answer when it is offered.',
      check: { all: [{ wire: { from: 'p_img', to: 'p_look' } }, { ran: { partId: 'p_look' } }] },
      show: { partId: 'p_look' },
    },
    {
      id: 's3',
      text: 'Ask the same picture something else — change the instruction (what is the mood? what is missing?) — and press ▶ again.',
      hint: 'No farm? The saved answer is offered again.',
      check: { all: [{ edited: { partId: 'p_look', setting: 'instruction' } }, { ran: { partId: 'p_look' } }] },
      show: { partId: 'p_look' },
    },
  ],
  demo: {
    p_look: { kind: 'text', data: 'This is a saved answer, so it did not see your picture. A typical one reads: a person faces the camera at a desk, a window behind them lets in soft daylight, and a shelf and a plant stand in the background.' },
  },
  next: 'l09-act-on-the-world',
};
