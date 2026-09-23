// @ts-check
// Lesson 2 — wires carry values (COMPUTER_PLAN §10.3; tldraw's "building a graph" in spirit:
// "a component will run when its input components are finished running"). K5-U4 owns this file
// (addendum KE-4). DATA only, importing nothing.
//
// What the learner DOES: wires a Text box into an Instruction, reads what will be sent (the Text
// box is IN the prompt, word for word), presses ▶ on the LAST box and watches the story run first
// (the §4.2 prologue pulls a missing ancestor), then edits the Text box and presses ▶ on IT —
// a push, so everything below the edit runs again. (▶ on the title after the edit would NOT
// re-run the story: an ancestor that holds a value is read, not re-run — so s4 says press ▶ on
// the box you changed.) Two generations per pass; both are in the demo pack.

export default {
  id: 'l02-wires',
  n: 2,
  title: 'wires carry values',
  subtitle: 'A box runs when the boxes that feed it have finished.',
  idea: 'The model remembers nothing: it knows only what the wires delivered into the prompt.',
  minutes: 5,
  needsFarm: 'one',
  doc: {
    lolgraph: 1,
    title: 'Lesson 2 — wires carry values',
    view: { x: 0, y: 0, zoom: 0.8 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 600, h: 106, settings: { text: '2 · wires carry values', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 140, w: 760, h: 84, settings: { text: 'A box runs when the boxes that feed it have finished.', size: 's' } },
      {
        id: 'n_idea', type: 'sticky', x: 40, y: 250, w: 300, h: 250,
        settings: { colour: 'yellow', text: 'The model remembers nothing between runs. It knows only what the arrows deliver — so what a Text box holds becomes part of the question, word for word.' },
      },
      { id: 'p_note', type: 'note', x: 400, y: 250, w: 200, h: 170, settings: { text: 'A lighthouse keeper who is afraid of the dark.', locked: false } },
      {
        id: 'n_sent', type: 'sticky', x: 400, y: 450, w: 220, h: 200,
        settings: { colour: 'slate', text: 'Under every Instruction, a grey line says how many words it will send. Click it to read the prompt before you spend a generation.' },
      },
      {
        id: 'p_story', type: 'ask', x: 680, y: 250, w: 240, h: 260,
        settings: { instruction: 'Write the opening paragraph of a story about this character, in three sentences.' },
      },
      {
        id: 'p_title', type: 'ask', x: 990, y: 250, w: 240, h: 260,
        settings: { instruction: 'Give this story a short, strange title. Reply with the title only.' },
      },
      {
        id: 'n_pull', type: 'sticky', x: 990, y: 540, w: 240, h: 160,
        settings: { colour: 'yellow', text: 'The title cannot be written before the story exists — so pressing ▶ here runs the story first.' },
      },
      { id: 'n_next', type: 'sticky', x: 680, y: 540, w: 240, h: 110, settings: { colour: 'green', text: 'Next up → 3 · arrow labels are names' } },
    ],
    wires: [
      { from: 'p_story', to: 'p_title', port: 'in' },
    ],
  },
  steps: [
    {
      id: 's1',
      text: 'Wire the Text box into the first Instruction: drag from the dot on its right edge onto the Instruction.',
      check: { wire: { from: 'p_note', to: 'p_story' } },
      show: { partId: 'p_note' },
    },
    {
      id: 's2',
      text: 'Click the grey line under the story’s instruction to read what will be sent: your Text box is in the prompt, word for word.',
      check: { manual: true },
      show: { partId: 'p_story' },
    },
    {
      id: 's3',
      text: 'Press ▶ on the LAST box, the title. It cannot run before the story exists, so the story runs first.',
      check: { all: [{ ran: { partId: 'p_story' } }, { ran: { partId: 'p_title' } }] },
      show: { partId: 'p_title' },
    },
    {
      id: 's4',
      text: 'Change the character in the Text box, then press ▶ on the Text box: everything below your change runs again, in order.',
      check: { all: [{ edited: { partId: 'p_note', setting: 'text' } }, { ran: { partId: 'p_story' } }, { ran: { partId: 'p_title' } }] },
      show: { partId: 'p_note' },
    },
  ],
  demo: {
    p_story: { kind: 'text', data: 'Every night Elsie climbed the ninety steps with her eyes shut, lit the lamp by touch, and only then looked out — because by then the dark had somewhere to go. The ships never knew their light was kept by someone who could not bear the night. Tonight, for the first time in eleven years, the lamp would not catch.' },
    p_title: { kind: 'text', data: 'The Keeper Who Closed Her Eyes' },
  },
  next: 'l03-labels',
};
