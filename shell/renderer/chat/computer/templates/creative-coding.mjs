// @ts-check
// Template — Creative coding (addendum KE-4: "a brief → Write a p5.js sketch → p5.js sketch").
// K5-U4 owns this file. DATA only, importing nothing.
//
// ONE brief, one arrow named `brief`, one "Write a p5.js sketch" (the `ask` preset `write-p5`:
// its `code:'p5'` setting is the match, graph/parts/creative.mjs) and one "p5.js sketch" box (the
// `preview` preset `p5`). The answer lands CLEAN in the box — the markdown fence stripped,
// stamped as p5 — and the box draws it in the sandbox. The box carries its OWN sketch too: it
// draws before anything has run, and whenever the person locks the box. One generation.
//
// Layout: a single lane with NOTHING below the sketch box, which grows with its picture and its
// code editor; the "try next" sticky points at the ＋ menu for the second picture (an SVG
// poster of the same brief), so the template also teaches where boxes come from.

export default {
  id: 'creative-coding',
  title: 'Creative coding',
  subtitle: 'A brief becomes a p5.js sketch you can run, read and edit.',
  needsFarm: 'one',
  generations: 1,
  doc: {
    lolgraph: 2,
    title: 'Creative coding',
    view: { x: 16, y: 8, zoom: 0.75 },
    parts: [
      { id: 'c_title', type: 'title', x: 40, y: 24, w: 600, h: 106, settings: { text: 'Creative coding', size: 'l' } },
      { id: 'c_sub', type: 'title', x: 40, y: 140, w: 680, h: 84, settings: { text: 'Change the brief, press Run: the model writes the sketch.', size: 's' } },
      { id: 'c_brief', type: 'note', x: 40, y: 250, w: 300, h: 170, settings: { text: 'Falling leaves in autumn colours, drifting slowly to the right across a dark blue evening sky.', locked: false } },
      {
        id: 'c_change', type: 'sticky', x: 40, y: 450, w: 300, h: 300,
        settings: {
          colour: 'yellow',
          text: 'What to change first\n\n1. Rewrite the brief above.\n2. Press Run: one generation.\n3. Edit the code in the sketch box and it redraws. Press “Keep my code” to keep your version when the model answers again.',
        },
      },
      {
        id: 'c_write_p5', type: 'ask', x: 400, y: 250, w: 300, h: 280,
        settings: {
          code: 'p5', shape: 'text',
          instruction: 'Write a p5.js sketch of the brief.\n\nReply with only the JavaScript code — no explanation, no markdown. Use p5.js global mode: define setup() and draw(), and call createCanvas(400, 300) in setup().',
        },
      },
      {
        id: 'c_next', type: 'sticky', x: 400, y: 570, w: 300, h: 180,
        settings: { colour: 'green', text: 'Try next: press ＋, add “Write an SVG” and an “SVG” box, and wire the brief through them — a poster of the same idea.' },
      },
      {
        id: 'c_sketch', type: 'preview', x: 820, y: 250, w: 440, h: 600,
        settings: {
          mode: 'p5', w: 400, h: 300, live: false, locked: false,
          source: [
            '// This box\'s own sketch: it draws before the model has answered, and whenever the box is locked.',
            'let leaves = [];',
            '',
            'function setup() {',
            '  createCanvas(lol.size.w, lol.size.h);',
            '  noStroke();',
            '  for (let i = 0; i < 24; i++) {',
            '    leaves.push({ x: random(width), y: random(height), s: random(6, 14), v: random(0.4, 1.2) });',
            '  }',
            '}',
            '',
            'function draw() {',
            '  background(20, 30, 60);',
            '  for (const leaf of leaves) {',
            '    fill(220, 120 + leaf.s * 6, 40);',
            '    ellipse(leaf.x, leaf.y, leaf.s * 1.6, leaf.s);',
            '    leaf.x += leaf.v * 0.6;',
            '    leaf.y += leaf.v;',
            '    if (leaf.y > height + 10) { leaf.y = -10; leaf.x = random(width); }',
            '    if (leaf.x > width + 10) leaf.x = -10;',
            '  }',
            '}',
          ].join('\n'),
        },
      },
    ],
    wires: [
      { from: 'c_brief', to: 'c_write_p5', port: 'in', label: 'brief' },
      { from: 'c_write_p5', to: 'c_sketch', port: 'content' },
    ],
  },
};
