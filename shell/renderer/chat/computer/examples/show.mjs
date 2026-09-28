// @ts-check
// Box examples — the "Show" group (computer/examples/index.mjs says how an example becomes a graph).

import { creativePresets } from '../../graph/parts/creative.mjs';

/** A preset's own settings. @param {string} id @param {object} [extra] */
const preset = (id, extra = {}) => ({ ...(/** @type {any} */ (creativePresets().find((p) => p.id === id)) || { settings: {} }).settings, ...extra });
const view = { mode: 'markdown' };

/** A drawing box on its own, with its starter code. @param {string} key @param {string} title @param {string} what @param {string[]} howto */
const drawing = (key, title, what, howto) => ({
  key,
  title,
  what,
  inputs: [['content (optional)', `code from a "Write …" box: it replaces the box's own code`]],
  output: 'A picture (PNG) of what it drew: wire it into Describe a picture so a model can see it.',
  howto,
  parts: [{ id: 'e_draw', type: 'preview', x: 0, y: 0, w: 400, h: 500, settings: preset(key) }],
  wires: [],
});

export const SHOW = [
  drawing('p5', 'p5.js sketch', 'A p5.js sketch: code that draws, in the sandbox (no network). It shows a picture of its first frame; ▶ Live runs it for real, with the mouse and the keys.', [
    'Change a number in the code: the picture redraws as you type. Edit code opens a big editor.',
    'setup() and draw() as in the p5.js editor; createCanvas(400, 300).',
    'Wired from Write a p5.js sketch, the model\'s code shows here; typing in it makes it yours.',
  ]),
  drawing('three', 'three.js scene', 'A three.js scene (r160) drawn in the sandbox. It shows a picture of its first frame; ▶ Live runs it, and lol.orbit(camera) lets you drag the camera.', [
    'Build the scene with THREE: a scene, a camera, a renderer, lights and meshes.',
    'Call lol.orbit(camera) right after making the camera, for a camera you can drag in Live.',
    'Wired from Write a three.js scene, the model\'s code shows here.',
  ]),
  drawing('svg', 'SVG', 'An SVG drawing. It is cleaned (no scripts, no outside links) and shown as a picture; Save .svg writes exactly what you see.', [
    'Edit the SVG code: the picture follows as you type.',
    'A Code box can build the SVG from data (d3 helps) and wire it in: charts whose numbers come from the data.',
    'Wired from Write an SVG, the model\'s drawing shows here.',
  ]),
  drawing('html', 'HTML page', 'A small web page drawn as a still picture in the sandbox, with nothing loaded from outside. ▶ Live runs it for real, scripts included.', [
    'Write only what goes inside <body>, with one <style> at the top.',
    'Good for a poster, a card, a menu, a small report.',
    'Wired from Write an HTML page, the model\'s page shows here.',
  ]),
  {
    key: 'markdown',
    title: 'Markdown view',
    what: 'Shows markdown as a formatted page: headings, lists, tables, code. Wire an Instruction or a Text box into it to read the answer nicely.',
    inputs: [['content', 'text (markdown) or JSON']],
    output: 'Nothing: a markdown page is for reading. (The drawing modes, SVG, HTML, p5.js and three.js, hand on a picture.)',
    howto: [
      '# heading, **bold**, - lists, | tables | all work.',
      'The easiest end for a graph: whatever arrives is shown readably.',
      'JSON arriving is shown as its text.',
    ],
    parts: [
      { id: 'e_text', type: 'note', x: 0, y: 0, w: 320, h: 220, settings: { text: '# Today\n- **Morning**: reading\n- **Afternoon**: a walk\n\n| day | weather |\n|---|---|\n| Mon | rain |\n| Tue | sun |', locked: false } },
      { id: 'e_md', type: 'preview', x: 380, y: 0, w: 340, h: 360, settings: preset('markdown', { source: '' }) },
    ],
    wires: [{ from: 'e_text', to: 'e_md', port: 'content' }],
  },
  {
    key: 'graph',
    title: 'Graph',
    what: 'Draws a graph from JSON: nodes and the links between them, coloured by community. It reads graphify\'s graph.json (what the IDE\'s graphify skill writes) and any {nodes, links} or {nodes, edges}. ▶ Live lets you drag the nodes, zoom and pan.',
    inputs: [['content (optional)', 'node-link JSON from a File, Fetch or Code box: it replaces the box\'s own']],
    output: 'A picture (PNG) of the graph: wire it into Describe a picture so a model can see it.',
    howto: [
      'A node needs an id (a label and a community colour it); a link needs a source and a target.',
      'A dashed link is INFERRED, a dotted one AMBIGUOUS, a solid one EXTRACTED: graphify\'s confidence.',
      'Up to 1000 nodes and 5000 links; a bigger graph says so instead of drawing. Save .json writes the JSON.',
    ],
    parts: [{ id: 'e_draw', type: 'preview', x: 0, y: 0, w: 400, h: 500, settings: preset('graph') }],
    wires: [],
  },
  {
    key: 'preview',
    title: 'Preview',
    what: 'The box behind all six drawing boxes: "Read it as" picks how to show what arrives: Automatic, Markdown, SVG, web page, three.js, p5.js or a graph.',
    inputs: [['content', 'text or JSON: code, markdown or data']],
    output: 'A picture of what it drew (SVG, HTML, p5.js, three.js); a markdown page hands on nothing.',
    howto: [
      'Automatic reads what arrives: SVG code is drawn as an SVG, a page as HTML, a sketch as p5.js or three.js, anything else as markdown.',
      'Pick a mode to force it, for example SVG for a Code box that returns SVG text.',
      'The ＋ menu\'s p5.js, three.js, SVG, HTML and Markdown boxes are this box with a mode already set.',
    ],
    parts: [
      { id: 'e_text', type: 'note', x: 0, y: 0, w: 320, h: 200, settings: { text: '## Automatic\nText like this is shown as **markdown**. Code from Write an SVG would be drawn as an SVG.', locked: false } },
      { id: 'e_prev', type: 'preview', x: 380, y: 0, w: 340, h: 320, settings: { mode: 'auto' } },
    ],
    wires: [{ from: 'e_text', to: 'e_prev', port: 'content' }],
  },
  {
    key: 'code',
    title: 'Code',
    what: 'Runs plain JavaScript on what arrives, in the sandbox (no network, no files): counting, sorting, picking fields, building an SVG. Exact, instant, and never a model.',
    inputs: [['Inputs', 'text, JSON, a list, a picture or a file: every arrow, in order, as inputs.in'], ['code (optional)', 'a program a "Write code" box wrote: it runs instead of the box\'s own']],
    output: 'JSON: whatever the code returns (text, a number, a list or an object).',
    howto: [
      'inputs.in is an ARRAY: inputs.in[0] is the first arrow\'s value. End with return.',
      'Snippet: return String(inputs.in[0]).split("\\n").length;  counts the lines.',
      'What it does: one line of plain words on top; Hide the code folds the program behind it. d3 is available.',
    ],
    parts: [
      { id: 'e_text', type: 'note', x: 0, y: 0, w: 300, h: 160, settings: { text: 'apple, pear, plum, blackberry', locked: false } },
      {
        id: 'e_code', type: 'code', x: 360, y: 0, w: 360, h: 240,
        settings: {
          code: 'const words = String(inputs.in[0]).split(",").map((w) => w.trim());\nconst longest = words.slice().sort((a, b) => b.length - a.length)[0];\nreturn { count: words.length, longest };',
          about: 'Counts the words and finds the longest one.', folded: false,
        },
      },
      { id: 'e_view', type: 'preview', x: 780, y: 0, w: 300, h: 240, settings: view },
    ],
    wires: [{ from: 'e_text', to: 'e_code', port: 'in' }, { from: 'e_code', to: 'e_view', port: 'content' }],
  },
  {
    key: 'speak',
    title: 'Speak',
    what: 'Says the text that arrives out loud: with the farm\'s voice (Kokoro, when the farm has it) or this computer\'s own voice, which sends nothing anywhere.',
    inputs: [['in', 'text (several arrows are said in order)']],
    output: 'Text: what was said.',
    howto: [
      'Voice: Automatic (the farm\'s if there is one, else this computer\'s), Farm, or This computer.',
      'Instruction → Speak reads the answer aloud; Sound (Listen) → Instruction → Speak answers a recorded question out loud.',
      'Stop stops the voice too.',
    ],
    parts: [
      { id: 'e_text', type: 'note', x: 0, y: 0, w: 320, h: 150, settings: { text: 'Hello! The graph has finished.', locked: false } },
      { id: 'e_speak', type: 'speak', x: 380, y: 0, w: 300, h: 160, settings: { voice: 'auto' } },
    ],
    wires: [{ from: 'e_text', to: 'e_speak', port: 'in' }],
  },
  {
    key: 'send',
    title: 'Send',
    what: 'Sends what arrives to a device: OSC (TouchDesigner, Max), DMX lights over Art-Net, MQTT, a WebSocket (an ESP32) or an HTTP POST. A dry run until you arm the outputs.',
    inputs: [['value', 'text, a number, a list or JSON: what is sent (the target is only ever what you type in the box)']],
    output: 'Text: what was sent, or what would have been (dry run).',
    howto: [
      'The run bar\'s "Outputs: dry run" arms them after asking, and lists every target; Panic stops all and blacks out the lights.',
      'OSC to 127.0.0.1:9000 /lol/level reaches TouchDesigner on this computer; a number typed in a Text box goes as a number. DMX: a list of levels, channel 1 first, like [255, 128, 0].',
      'At most 20 messages a second per target, DMX 3 frames a second per universe; never the farm\'s own ports. This does not limit a fixture\'s own strobe channel: keep strobes off.',
    ],
    parts: [
      { id: 'e_val', type: 'note', x: 0, y: 0, w: 300, h: 150, settings: { text: '0.75', locked: false } },
      { id: 'e_send', type: 'send', x: 360, y: 0, w: 320, h: 260, settings: { transport: 'osc', host: '127.0.0.1', port: 9000, address: '/lol/level', universe: 0, topic: 'lol/computer', url: '' } },
    ],
    wires: [{ from: 'e_val', to: 'e_send', port: 'in' }],
  },
];
