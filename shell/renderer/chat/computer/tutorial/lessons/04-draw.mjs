// @ts-check
// Lesson 4 — make a picture (addendum KE-4: the creative lesson the owner asked for — "the svg
// write and svg render nodes"; it takes the slot COMPUTER_PLAN §10.3 gave "many in, many out",
// which the research template now teaches). K5-U4 owns this file. DATA only, importing nothing.
//
// It teaches WHERE BOXES COME FROM: the lesson ships the SVG box (named by its part id, `p_svg`)
// and the learner adds "Write an SVG" from the ＋ menu — so that box is named by its PRESET
// (`preset:'write-svg'`), `Show me` opens the ＋ menu with its row highlighted (`show:{menu}`),
// and its recorded answer is keyed `@write-svg` because nobody knows its part id in advance.
//
// s1–s2 need no farm (the SVG box draws its own code, and redraws as it is edited); s5's one
// generation is in the demo pack. The middle of the view is left EMPTY: a box picked from the
// toolbar's ＋ lands at the view centre (canvas.mjs placeEntry), which is where "Write an SVG"
// belongs, to the left of the picture it will feed. Nothing sits below the SVG box: a creative
// box grows with its picture and its code editor. The last lesson has no "next up" sticky — the
// rail's own last-lesson card points at the templates.

export default {
  id: 'l04-draw',
  n: 4,
  title: 'make a picture',
  subtitle: 'Ask the model for an SVG, and watch it drawn.',
  idea: 'The model writes code; a creative box runs it in the sandbox, which cannot reach the network or your files.',
  minutes: 6,
  needsFarm: 'one',
  doc: {
    lolgraph: 1,
    title: 'Lesson 4 — make a picture',
    view: { x: 0, y: 0, zoom: 0.85 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 560, h: 106, settings: { text: '4 · make a picture', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 140, w: 700, h: 84, settings: { text: 'The model writes code; an SVG box draws it.', size: 's' } },
      {
        id: 'n_idea', type: 'sticky', x: 40, y: 250, w: 300, h: 250,
        settings: { colour: 'yellow', text: 'An SVG box draws the code inside it. Wire an Instruction into it and it draws the model’s code instead.\n\nThe code runs in a sandbox: it cannot reach the network or your files.' },
      },
      {
        id: 'n_menu', type: 'sticky', x: 390, y: 590, w: 320, h: 120,
        settings: { colour: 'slate', text: 'Boxes come from ＋ at the top of the canvas — or double-click an empty spot. “Write an SVG” is under Think.' },
      },
      {
        id: 'p_svg', type: 'preview', x: 780, y: 140, w: 380, h: 560,
        settings: {
          mode: 'svg', w: 300, h: 225, live: false, locked: false,
          source: [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">',
            '  <rect width="320" height="240" fill="#f5efe4"/>',
            '  <circle cx="160" cy="120" r="60" fill="#e4572e"/>',
            '  <text x="160" y="215" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#333333">my picture</text>',
            '</svg>',
          ].join('\n'),
        },
      },
    ],
    wires: [],
  },
  steps: [
    {
      id: 's1',
      text: 'Press ▶ on the SVG box: it draws the code inside it.',
      check: { ran: { partId: 'p_svg' } },
      show: { partId: 'p_svg' },
    },
    {
      id: 's2',
      text: 'Change the circle’s colour in the code — try fill="#2e86ab" — and the box redraws as you type.',
      check: { edited: { partId: 'p_svg', setting: 'source' } },
      show: { partId: 'p_svg' },
    },
    {
      id: 's3',
      text: 'Press ＋ and add “Write an SVG” — it is under Think.',
      check: { has: { preset: 'write-svg' } },
      show: { menu: 'write-svg' },
    },
    {
      id: 's4',
      text: 'Wire “Write an SVG” into the SVG box: drag from the dot on its right edge onto the SVG box (its left dot).',
      check: { wire: { fromPreset: 'write-svg', to: 'p_svg' } },
      show: { partId: 'p_svg' },
    },
    {
      id: 's5',
      text: 'Press ▶ on the SVG box. The Instruction runs first, then the box draws the model’s picture instead of your code.',
      check: { all: [{ ran: { preset: 'write-svg' } }, { ran: { partId: 'p_svg' } }] },
      show: { partId: 'p_svg' },
    },
    {
      id: 's6',
      text: 'Your code is not gone: press “Keep my code” on the SVG box, then ▶ — it draws your code again, whatever arrives.',
      check: { has: { id: 'p_svg', setting: 'locked', equals: true } },
      show: { partId: 'p_svg' },
    },
  ],
  demo: {
    '@write-svg': {
      kind: 'text', format: 'svg',
      data: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#bfe3f2"/><circle cx="320" cy="70" r="36" fill="#f2b134"/><path d="M0 230 Q100 150 200 220 T400 210 V300 H0 Z" fill="#5b8c5a"/><path d="M0 260 Q120 200 260 250 T400 240 V300 H0 Z" fill="#4a7a49"/><rect x="150" y="170" width="70" height="55" fill="#e8d8c0"/><path d="M140 172 L185 135 L230 172 Z" fill="#b3452c"/><rect x="176" y="195" width="18" height="30" fill="#7a5a3a"/></svg>',
    },
  },
};
