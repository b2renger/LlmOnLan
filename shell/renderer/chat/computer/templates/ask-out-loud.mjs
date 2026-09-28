// @ts-check
// Template — Ask out loud (ecosystem plan v2 P2, speech; the Learn shelf's missing speech template). DATA only.
// A question recorded in the Sound box, written down by the farm's speech to text (only once a person turns
// Listen on: an opened template, like any imported graph, starts with it off), answered by a model, shown and
// said by Speak (the farm's voice when it has one, else this computer's). One generation.

export default {
  id: 'ask-out-loud',
  title: 'Ask out loud',
  subtitle: 'Record a question: the farm writes it down, a model answers, and the Computer says the answer out loud.',
  needsFarm: 'one',
  generations: 1,
  doc: {
    lolgraph: 2,
    title: 'Ask out loud',
    view: { x: 16, y: 8, zoom: 0.6 },
    parts: [
      { id: 'o_title', type: 'title', x: 40, y: 24, w: 820, h: 100, settings: { text: 'Ask out loud', size: 'l' } },
      {
        id: 'o_how', type: 'sticky', x: 40, y: 140, w: 320, h: 460,
        settings: {
          colour: 'yellow',
          text: 'How it works\n\n1. Sound: press ● Record, ask your question, then ■ Stop (or drop a sound file on the box).\n2. Turn on Listen on the Sound box: the farm’s speech to text writes the recording down. Only then does it leave this computer — it is written down and dropped, never kept.\n3. Press Run all: a model answers in a few sentences, the Preview shows the answer and Speak says it.\n\nSpeak uses the farm’s voice when the farm has one, otherwise this computer’s own voice (which sends nothing). Stop stops the voice too.',
        },
      },
      { id: 'o_snd', type: 'audio', x: 400, y: 140, w: 320, h: 220, settings: {} },
      { id: 'o_ask', type: 'ask', x: 780, y: 140, w: 340, h: 300, settings: { instruction: 'Answer the question asked in the recording in two or three short sentences, the way you would say it out loud.' } },
      { id: 'o_view', type: 'preview', x: 1180, y: 140, w: 360, h: 240, settings: { mode: 'markdown' } },
      { id: 'o_speak', type: 'speak', x: 1180, y: 420, w: 300, h: 160, settings: { voice: 'auto' } },
    ],
    wires: [
      { from: 'o_snd', to: 'o_ask', port: 'in', label: 'recording' },
      { from: 'o_ask', to: 'o_view', port: 'content' },
      { from: 'o_ask', to: 'o_speak', port: 'in' },
    ],
  },
};
