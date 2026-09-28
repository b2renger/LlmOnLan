// @ts-check
// Lesson 7 — listen and speak (the night of 2026-09-28: every capability since lesson 6 becomes a lesson). DATA only,
// importing nothing. The "Ask out loud" template, taken apart one box at a time.
//
// What the learner DOES: records a question with the Sound box's ● Record (this computer's microphone), turns
// Listen on (only then may the recording leave, to the farm's speech to text, which keeps nothing), wires it into
// an Instruction that answers — Speak, already wired, says the answer — then picks this computer's own voice, which
// sends nothing. Most farms ship with speech to text OFF, so the Sound box's saved transcript is in the demo pack
// beside the answer: the lesson finishes on any farm, or none.

export default {
  id: 'l07-listen-and-speak',
  n: 7,
  title: 'listen and speak',
  subtitle: 'Ask a question out loud; the farm writes it down, a model answers, and the Computer says the answer.',
  idea: 'A recording stays on this computer until you turn Listen on. Then the farm writes it down and keeps nothing: the words flow on, not the sound.',
  minutes: 5,
  needsFarm: 'one',
  doc: {
    lolgraph: 1,
    title: 'Lesson 7 — listen and speak',
    view: { x: 0, y: 0, zoom: 0.65 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 700, h: 106, settings: { text: '7 · listen and speak', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 140, w: 1100, h: 84, settings: { text: 'Ask a question out loud; the farm writes it down, a model answers, the Computer says it.', size: 's' } },
      {
        id: 'n_idea', type: 'sticky', x: 40, y: 250, w: 320, h: 330,
        settings: { colour: 'yellow', text: 'The Sound box records this computer’s microphone. The recording stays here until you turn on Listen: then the farm’s speech to text writes it down and keeps nothing, and the WORDS flow on, not the sound.\n\nSpeak says what arrives: with the farm’s voice, or this computer’s own voice, which sends nothing.' },
      },
      { id: 'p_snd', type: 'audio', x: 420, y: 250, w: 320, h: 230, settings: {} },
      {
        id: 'p_ask', type: 'ask', x: 800, y: 250, w: 300, h: 300,
        settings: { instruction: 'Answer the question asked in the recording in two or three short sentences, the way you would say it out loud.' },
      },
      { id: 'p_speak', type: 'speak', x: 1160, y: 250, w: 300, h: 160, settings: { voice: 'auto' } },
      {
        id: 'n_farm', type: 'sticky', x: 800, y: 600, w: 300, h: 170,
        settings: { colour: 'slate', text: 'Listen needs the farm’s Speech to text plugin; many farms have it off. Then the rail offers a saved transcript, and the lesson goes on.' },
      },
      { id: 'n_next', type: 'sticky', x: 1160, y: 460, w: 300, h: 130, settings: { colour: 'green', text: 'Next up → 8 · a picture to a model. The template “Ask out loud” is this graph, ready to use.' } },
    ],
    wires: [
      { from: 'p_ask', to: 'p_speak', port: 'in' },
    ],
  },
  steps: [
    {
      id: 's1',
      text: 'Press ● Record on the Sound box, ask a question out loud (“why is the sky blue?”), then ■ Stop. No microphone? Drop a sound file on it.',
      check: { has: { id: 'p_snd', setting: 'fileId', nonEmpty: true } },
      show: { partId: 'p_snd' },
    },
    {
      id: 's2',
      text: 'Tick “Listen: write down what is said” on the Sound box. Now a run may send the recording to the farm, which writes it down and keeps nothing.',
      check: { has: { id: 'p_snd', setting: 'listen', equals: true } },
      show: { partId: 'p_snd' },
    },
    {
      id: 's3',
      text: 'Wire the Sound box into the Instruction, then press ▶ on the Instruction: your question is written down, answered, and Speak says the answer.',
      hint: 'The farm cannot listen, or no farm? Use the saved answers the rail offers, then press ▶ on Speak.',
      check: { all: [{ wire: { from: 'p_snd', to: 'p_ask' } }, { ran: { partId: 'p_snd' } }, { ran: { partId: 'p_ask' } }, { ran: { partId: 'p_speak' } }] },
      show: { partId: 'p_ask' },
    },
    {
      id: 's4',
      text: 'In Speak, pick “This computer’s voice” and press ▶ on it: the same answer, said without sending anything anywhere.',
      check: { all: [{ has: { id: 'p_speak', setting: 'voice', equals: 'local' } }, { ran: { partId: 'p_speak' } }] },
      show: { partId: 'p_speak' },
    },
  ],
  demo: {
    p_snd: { kind: 'text', data: 'Why is the sky blue?' },
    p_ask: { kind: 'text', data: 'Sunlight holds every colour, and the air scatters blue light much more than red. So blue reaches your eyes from all over the sky.' },
  },
  next: 'l08-a-picture-to-a-model',
};
