// @ts-check
// The Tour (COMPUTER_PLAN §10.3: unnumbered, ~90 s, NO FARM) — K5-U3 owns this file (addendum KE-4).
//
// It exists so lesson 1 can be about the model instead of about the mouse: look around, add a box
// from the ＋ menu, type in it, wire it into another, run it, delete, undo, and know where the
// library is. Every step completes with the farm absent — nothing in this graph thinks: a Text box
// and a Markdown view draw without a model, which is itself the first thing worth knowing.
//
// FORMAT (frozen, core/types.mjs `Lesson`): a lesson is DATA. `doc` is the canvas's Export (values
// off) with AUTHORED part ids; every `check`/`show` names ids from that doc, presets from
// graph/parts/creative.mjs and rows of the ＋ menu. No imports, and no lint-forbidden token even
// inside a string.
//
// LAYOUT: the step rail docks bottom-left (~300 px), so the furniture sits along the TOP of the
// view and the right-hand side — nothing a step points at is under the rail. The ＋ menu places a
// new box at the centre of the view, which is left empty on purpose.

export default {
  id: 'l00-tour',
  n: 0,
  title: 'the tour',
  subtitle: 'Move around, add a box, wire two together, run, delete, undo. No farm needed.',
  idea: 'Every box does one thing, and a wire carries what one box made into the next.',
  minutes: 2,
  needsFarm: 'no',
  doc: {
    lolgraph: 1,
    title: 'The tour',
    view: { x: 0, y: 0, zoom: 1 },
    parts: [
      { id: 'p_title', type: 'title', x: 40, y: 24, w: 420, h: 88, settings: { text: 'The tour', size: 'l' } },
      {
        id: 'p_bin', type: 'sticky', x: 40, y: 124, w: 220, h: 170,
        settings: { text: 'I am a sticky note: words on the canvas that nothing reads.\n\nNear the end of the tour you will delete me. Do not worry, I come back.' },
      },
      {
        id: 'p_view', type: 'preview', x: 620, y: 40, w: 340, h: 380,
        settings: {
          mode: 'markdown',
          source: '# Show it here\n\nWire a **Text** box into me, then press ▶ in my title bar.\n\nWhatever you wrote appears here, *formatted*.',
          w: 320, h: 240, live: false, locked: false,
        },
      },
    ],
    wires: [],
  },
  steps: [
    {
      id: 's-look',
      text: 'Look around: drag the empty canvas to move, and hold Ctrl (⌘ on a Mac) while you scroll to zoom.',
      hint: 'Lost? “Fit” in the toolbar above the canvas brings everything back into view.',
      check: { manual: true },
    },
    {
      id: 's-add',
      text: 'Add a box: press “＋ Add a box” in the toolbar above the canvas (or double-click empty canvas), then pick Text.',
      hint: 'The menu is grouped. Text is under “Bring in”, and you can type to search.',
      check: { has: { type: 'note' } },
      show: { menu: 'note' },
    },
    {
      id: 's-type',
      text: 'Click into your new Text box and type a sentence.',
      check: { has: { type: 'note', setting: 'text', nonEmpty: true } },
    },
    {
      id: 's-wire',
      text: 'Wire it: drag from the dot on the right edge of your Text box to the dot on the left edge of the Markdown view.',
      check: { wire: { fromType: 'note', to: 'p_view' } },
      show: { partId: 'p_view' },
    },
    {
      id: 's-run',
      text: 'Press ▶ in the title bar of the Markdown view. Your sentence travels down the wire and shows up in it.',
      hint: 'No model was asked: a Text box and a view need no farm at all.',
      check: { ran: { partId: 'p_view' } },
      show: { partId: 'p_view' },
    },
    {
      id: 's-delete',
      text: 'Delete the sticky note: click it once to select it, then press Delete. (A double-click would open it for typing instead.)',
      check: { has: { id: 'p_bin', count: 0 } },
      show: { partId: 'p_bin' },
    },
    {
      id: 's-undo',
      text: 'Changed your mind? Press Ctrl+Z (⌘Z on a Mac) and the note comes back.',
      hint: 'Every change on the canvas can be undone, one step at a time.',
      check: { has: { id: 'p_bin' } },
      show: { partId: 'p_bin' },
    },
    {
      id: 's-library',
      text: 'Everything you make is saved in the library on the left. This tour is there too, as “The tour”.',
      check: { manual: true },
    },
  ],
  next: 'l01-hello-farm',
};
