// @ts-check
// Template — Research → problematic (COMPUTER_PLAN §10.5 #1; docs/COMPUTER_REFERENCE_CAPTURE.md
// §1, the owner's OWN museum graph, generalised). K5-U4 owns this file (addendum KE-4). DATA only.
//
// The shape is the owner's Graph A + Graph B: ONE topic fans out along five arrows all named
// `topic` into five research Instructions; each research then converges into ONE "write a
// problematic" through an arrow named for what it carries (`societal research`, …); the
// problematic fans out again into two design concepts — one as JSON (the owner's
// {title, problem, solutions, visualRepresentation}), one in prose. The labels are pre-written
// because the labels ARE the teaching: every one is mentioned, word for word, in the instruction
// it feeds, so the prompt carries a `## societal research` heading and no `unused:` chip shows
// (computer-lessons.test.mjs asserts it through graph/bind.mjs).
//
// 5 + 1 + 2 = 8 generations, well inside the 50-generation cap. It opens as a NEW library
// document with fresh ids (app.library.importText), so the ids below are only for reading.

const MD = ' Answer in markdown, with headings and short bullet lists.';

export default {
  id: 'research-problematic',
  title: 'Research → problematic',
  subtitle: 'One topic, five angles of research, one problematic, two design concepts.',
  needsFarm: 'one',
  generations: 8,
  doc: {
    lolgraph: 2,
    title: 'Research → problematic',
    view: { x: 16, y: 8, zoom: 0.43 },
    parts: [
      { id: 't_title', type: 'title', x: 40, y: 24, w: 760, h: 106, settings: { text: 'Research → problematic', size: 'l' } },
      { id: 't_sub', type: 'title', x: 40, y: 140, w: 1100, h: 84, settings: { text: 'Change the topic, press Run: five researches, one problematic, two design concepts.', size: 's' } },
      {
        id: 't_change', type: 'sticky', x: 40, y: 250, w: 300, h: 460,
        settings: {
          colour: 'yellow',
          text: 'What to change first\n\n1. Write your own topic in the Text box below.\n2. Press Run: eight generations on the farm.\n3. Click the strip under a box to read its answer.\n\nEvery research box reads the arrow named topic. The problematic reads each research by the name on its arrow — rename an arrow and the heading in its prompt changes with it.',
        },
      },
      { id: 't_topic', type: 'note', x: 40, y: 740, w: 300, h: 170, settings: { text: 'Accessibility in museums for autistic visitors.', locked: false } },

      { id: 't_soc', type: 'ask', x: 400, y: 250, w: 320, h: 260, settings: { instruction: 'Do some societal research on the topic: who is concerned, what they need, and what stands in their way today.' + MD } },
      { id: 't_env', type: 'ask', x: 400, y: 520, w: 320, h: 260, settings: { instruction: 'Do some environmental research on the topic: the physical and sensory environment — light, sound, crowds, space and signage.' + MD } },
      { id: 't_tech', type: 'ask', x: 400, y: 790, w: 320, h: 260, settings: { instruction: 'Do some technological research on the topic: the tools and technologies that exist or could help, and their limits.' + MD } },
      { id: 't_biz', type: 'ask', x: 400, y: 1060, w: 320, h: 260, settings: { instruction: 'Do some business research on the topic: who pays, who decides, what it costs, and why institutions act or do not.' + MD } },
      { id: 't_exist', type: 'ask', x: 400, y: 1330, w: 320, h: 260, settings: { instruction: 'List the existing initiatives, companies and technologies working on the topic, with one line each on what they do and what they miss. Answer in markdown.' } },

      {
        id: 't_prob', type: 'ask', x: 960, y: 780, w: 320, h: 280,
        settings: { instruction: 'Write a problematic about the topic, taking into account the societal research, the environmental research, the technological research, the business research and the existing initiatives. One dense paragraph that ends on a question.' },
      },

      {
        id: 't_concept_json', type: 'ask', x: 1400, y: 600, w: 330, h: 300,
        settings: {
          instruction: 'Develop a design concept about the problematic: a title, the problem it answers, three solutions, and how it would look.',
          shape: 'json',
          schema: JSON.stringify({
            type: 'object',
            properties: {
              title: { type: 'string' },
              problem: { type: 'string' },
              solutions: { type: 'array', items: { type: 'string' } },
              visualRepresentation: { type: 'string' },
            },
            required: ['title', 'problem', 'solutions', 'visualRepresentation'],
          }, null, 2),
        },
      },
      {
        id: 't_concept', type: 'ask', x: 1400, y: 940, w: 330, h: 280,
        settings: { instruction: 'Develop a design concept about the problematic, in prose: its name, the idea in two sentences, and what a visitor would experience, step by step.' },
      },
    ],
    wires: [
      { from: 't_topic', to: 't_soc', port: 'in', label: 'topic' },
      { from: 't_topic', to: 't_env', port: 'in', label: 'topic' },
      { from: 't_topic', to: 't_tech', port: 'in', label: 'topic' },
      { from: 't_topic', to: 't_biz', port: 'in', label: 'topic' },
      { from: 't_topic', to: 't_exist', port: 'in', label: 'topic' },
      { from: 't_topic', to: 't_prob', port: 'in', label: 'topic' },
      { from: 't_soc', to: 't_prob', port: 'in', label: 'societal research' },
      { from: 't_env', to: 't_prob', port: 'in', label: 'environmental research' },
      { from: 't_tech', to: 't_prob', port: 'in', label: 'technological research' },
      { from: 't_biz', to: 't_prob', port: 'in', label: 'business research' },
      { from: 't_exist', to: 't_prob', port: 'in', label: 'existing initiatives' },
      { from: 't_prob', to: 't_concept_json', port: 'in', label: 'problematic' },
      { from: 't_prob', to: 't_concept', port: 'in', label: 'problematic' },
    ],
  },
};
