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
  inputs: [['Content (optional)', `code from a "Write …" box: it replaces the box's own code`]],
  output: 'A picture (PNG) of what it drew: wire it into Describe a picture so a model can see it.',
  howto,
  parts: [{ id: 'e_draw', type: 'preview', x: 0, y: 0, w: 400, h: 500, settings: preset(key) }],
  wires: [],
});

export const SHOW = [
  drawing('p5', 'p5.js sketch', 'A p5.js sketch: code that draws, in the sandbox (no network). It shows a picture of its first frame; ▶ Live runs it for real, with the mouse and the keys.', [
    'Press ▶ on the box to draw it, then ▶ Live to see it move. Change a number in the code: the picture redraws as you type. Edit code opens a big editor.',
    'setup() and draw() as in the p5.js editor; createCanvas(400, 300).',
    'Wired from Write a p5.js sketch, the model\'s code shows here; typing in it makes it yours.',
  ]),
  drawing('three', 'three.js scene', 'A three.js scene (r160) drawn in the sandbox. It shows a picture of its first frame; ▶ Live runs it, and lol.orbit(camera) lets you drag the camera.', [
    'Press ▶ on the box to draw it, then ▶ Live and drag to turn around the cube. Build the scene with THREE: a scene, a camera, a renderer, lights and meshes.',
    'Call lol.orbit(camera) right after making the camera, for a camera you can drag in Live.',
    'Wired from Write a three.js scene, the model\'s code shows here.',
  ]),
  drawing('svg', 'SVG', 'An SVG drawing. It is cleaned (no scripts, no outside links) and shown as a picture; Save .svg writes exactly what you see.', [
    'Press ▶ on the box to draw it. Edit the SVG code: the picture follows as you type.',
    'A Code box can build the SVG from data (d3 helps) and wire it in: charts whose numbers come from the data.',
    'Wired from Write an SVG, the model\'s drawing shows here.',
  ]),
  drawing('html', 'HTML page', 'A small web page drawn as a still picture in the sandbox, with nothing loaded from outside. ▶ Live runs it for real, scripts included.', [
    'Press ▶ on the box to draw it. Write only what goes inside <body>, with one <style> at the top.',
    'Good for a poster, a card, a menu, a small report.',
    'Wired from Write an HTML page, the model\'s page shows here.',
  ]),
  {
    key: 'markdown',
    title: 'Markdown view',
    what: 'Shows markdown as a formatted page: headings, lists, tables, code. Wire an Instruction or a Text box into it to read the answer nicely.',
    inputs: [['Content', 'text (markdown) or JSON']],
    output: 'Nothing: a markdown page is for reading. (The drawing boxes — SVG, HTML page, p5.js, three.js and Graph — hand on a picture.)',
    howto: [
      'Press Run all: the Text box\'s list and table show formatted. # heading, **bold**, - lists, | tables | all work.',
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
    inputs: [['Content (optional)', 'node-link JSON from a Text, Fetch or Code box: it replaces the box\'s own']],
    output: 'A picture (PNG) of the graph: wire it into Describe a picture so a model can see it.',
    howto: [
      'Press ▶ on the box to draw it, then ▶ Live to drag the nodes. A node needs an id (a label and a community colour it); a link needs a source and a target.',
      'A dashed link is INFERRED, a dotted one AMBIGUOUS, a solid one EXTRACTED: graphify\'s confidence.',
      'Up to 1000 nodes and 5000 links; a bigger graph says so instead of drawing. Save .json writes the JSON.',
    ],
    parts: [{ id: 'e_draw', type: 'preview', x: 0, y: 0, w: 400, h: 500, settings: preset('graph') }],
    wires: [],
  },
  {
    key: 'preview',
    title: 'Preview',
    what: 'The box behind the ＋ menu\'s p5.js sketch, three.js scene, SVG, HTML page, Markdown view and Graph: those are this box with a mode already set. "Read it as" picks how to show what arrives: Automatic, Markdown, SVG, Web page, three.js, p5.js or Graph (JSON).',
    inputs: [['Content', 'text or JSON: code, markdown or data']],
    output: 'A picture (PNG) of what it drew (SVG, web page, p5.js, three.js, graph); a markdown page hands on nothing.',
    howto: [
      'Automatic goes by what the box before it made: a Write an SVG answer is drawn as an SVG, a Write an HTML page answer as a page, a Write a p5.js sketch or three.js scene answer as that. Anything else (a Text or Code box) is shown as markdown; Graph is never guessed.',
      'Pick a mode to force it, for example SVG for a Code box that returns SVG text.',
      'Press Run all: the Text box\'s words show as markdown.',
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
      'inputs.in is an ARRAY: inputs.in[0] is the first arrow\'s value. End with return. Press Run all: the Markdown view shows the count and the longest word.',
      'Snippet: return String(inputs.in[0]).split("\\n").length;  counts the lines.',
      'What it does: one line of plain words on top; Hide the code folds the program behind it. d3 is there for charts; a run stops after 5 seconds.',
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
    inputs: [['text', 'text (several arrows are said in order)']],
    output: 'Text: what was said.',
    howto: [
      'Press Run all: the box says the Text box\'s words. ▶ Say it again repeats them; the run bar\'s Stop stops the voice.',
      'Voice: Automatic (the farm\'s voice if it has one, else this computer\'s), The farm\'s voice (Kokoro), or This computer\'s voice (works offline, sends nothing).',
      'Instruction → Speak reads the answer aloud; Sound (Listen) → Instruction → Speak answers a recorded question out loud — the "Ask out loud" template.',
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
    what: 'Sends what arrives to a device: OSC (TouchDesigner, Max), DMX lights over Art-Net, MQTT, a WebSocket (an ESP32), an HTTP POST, a board on USB serial, or the farm\'s message bus. Every run is a dry run — the box shows what it would send — until you arm the outputs in the run bar.',
    inputs: [['value', 'text, a number, a list or JSON: what is sent (the target is only ever what you type in the box)']],
    output: 'Text: what was sent, or what would have been (dry run).',
    howto: [
      'Press Run all: the box says "Dry run — would send: …". To send for real, press "Outputs: dry run" in the run bar: it lists every target; then press Arm. Panic stops everything and blacks out the lights; a reload disarms.',
      'OSC to 127.0.0.1:9000 /lol/level reaches TouchDesigner on this computer; a number typed in a Text box goes as a number. DMX: a list of levels, channel 1 first, like [255, 128, 0]. USB serial: press "Choose the board…".',
      'At most 20 messages a second per target, DMX 3 frames a second per universe; never the farm\'s own ports. This does not limit a fixture\'s own strobe channel: keep strobes off.',
    ],
    parts: [
      { id: 'e_val', type: 'note', x: 0, y: 0, w: 300, h: 150, settings: { text: '0.75', locked: false } },
      { id: 'e_send', type: 'send', x: 360, y: 0, w: 320, h: 260, settings: { transport: 'osc', host: '127.0.0.1', port: 9000, address: '/lol/level', universe: 0, topic: 'lol/computer', url: '' } },
    ],
    wires: [{ from: 'e_val', to: 'e_send', port: 'in' }],
  },
  {
    key: 'home-command',
    title: 'Home command',
    what: 'Tells ONE device of your Home Assistant to do ONE thing you choose in the box — turn a light on at 40 %, switch a plug, set a fan — each time something arrives. A dry run until you arm the outputs in the run bar AND allow home commands in Preferences ▸ Home Assistant. Never unlocks a lock, disarms an alarm, sounds a siren, or opens a valve, a door or a garage.',
    inputs: [['go', 'anything: only the signal to act (the details are the box’s own “With”, which only you set)']],
    output: 'Text: what was done and the device’s state after, or what would have been done (dry run).',
    howto: [
      'Press Choose… and pick a light, then the action turn_on; “With” holds {"brightness_pct": 40}. Press Run all: the box says "Dry run — would do light.turn_on on …".',
      'To act for real: in Preferences ▸ Home Assistant press Allow commands… (a dialog lists the devices), then press "Outputs: dry run" in the run bar (it lists this box) and Arm. Run again: the light turns on at 40 %.',
      'Put a Condition before it to act only when something is true (the "Comfort advisor" template turns a fan on when the air is stuffy). At most one command a second per device and 30 a minute. Panic or a reload makes it a dry run again.',
    ],
    parts: [
      { id: 'e_val', type: 'note', x: 0, y: 0, w: 300, h: 150, settings: { text: 'go', locked: false } },
      { id: 'e_cmd', type: 'home-command', x: 360, y: 0, w: 320, h: 220, settings: { entity: 'light.studio_ceiling', name: 'Studio ceiling', action: 'turn_on', data: '{"brightness_pct": 40}' } },
    ],
    wires: [{ from: 'e_val', to: 'e_cmd', port: 'in' }],
  },
];
