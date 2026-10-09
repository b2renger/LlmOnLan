// @ts-check
// Lesson 14 — switch the home (2026-10-09, docs/HOME_ASSISTANT.md). DATA only, importing nothing. No farm.
//
// What the learner DOES: wires a Text box (the signal to act) into a Home command box (the studio's ceiling light,
// turn_on, with {"brightness_pct": 40} in its own "With": only a person sets the details), runs it as a DRY RUN (the box says what it would do), then — only
// with their own Home Assistant linked — chooses one of their lights, allows home commands (main's native dialog) and
// arms the outputs (the run bar's question lists the Home command): two people-only gestures no check can see, so they
// are `manual` steps. Last, a new brightness in "With", and Panic.

export default {
  id: 'l14-switch-the-home',
  n: 14,
  title: 'switch the home',
  subtitle: 'A Home command box tells one device to do one thing — but only once a person has allowed home commands and armed the outputs.',
  idea: 'A Home command is a dry run until a person does two things: allows home commands in Preferences, and arms the outputs in the run bar. Locks, alarms, sirens, valves, doors and garages are never switched from LlmOnLan.',
  minutes: 5,
  needsFarm: 'no',
  doc: {
    lolgraph: 1,
    title: 'Lesson 14 — switch the home',
    view: { x: 0, y: 0, zoom: 0.7 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 640, h: 106, settings: { text: '14 · switch the home', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 140, w: 1200, h: 84, settings: { text: 'A Home command tells one device to do one thing — once a person has allowed it.', size: 's' } },
      {
        id: 'n_idea', type: 'sticky', x: 40, y: 250, w: 320, h: 400,
        settings: { colour: 'yellow', text: 'A Home command box does ONE action on ONE device, both chosen in the box by a person. What arrives on its arrow is only the signal to act; the details (here {"brightness_pct": 40}) are in the box’s own “With”.\n\nIt is a dry run until you do BOTH:\n1. Preferences ▸ Home Assistant ▸ Allow commands… (a dialog lists the devices);\n2. Outputs in the run bar ▸ Arm (it lists this box).\n\nNever from LlmOnLan: unlocking, disarming an alarm, a siren, opening a valve, a door or a garage.' },
      },
      { id: 'p_how', type: 'note', x: 420, y: 250, w: 260, h: 150, settings: { text: 'go', locked: false } },
      {
        id: 'n_how', type: 'sticky', x: 420, y: 430, w: 260, h: 140,
        settings: { colour: 'slate', text: 'The signal to act: press ▶ on this box and the Home command runs.' },
      },
      { id: 'p_cmd', type: 'home-command', x: 740, y: 250, w: 320, h: 220, settings: { entity: 'light.studio_ceiling', name: 'Studio ceiling', action: 'turn_on', data: '{"brightness_pct": 40}' } },
      {
        id: 'n_mine', type: 'sticky', x: 740, y: 510, w: 320, h: 180,
        settings: { colour: 'slate', text: 'With your own home linked, press Choose… and pick one of YOUR lights (light.studio_ceiling is the lesson’s), then the action turn_on.' },
      },
      { id: 'n_next', type: 'sticky', x: 1100, y: 250, w: 260, h: 200, settings: { colour: 'green', text: 'Then try the templates “Morning briefing”, “Comfort advisor” and “Energy report” on the Learn shelf.' } },
    ],
    wires: [],
  },
  steps: [
    {
      id: 's1',
      text: 'Wire the Text box (the signal to act) into the Home command box.',
      check: { wire: { from: 'p_how', to: 'p_cmd' } },
      show: { partId: 'p_how' },
    },
    {
      id: 's2',
      text: 'Press ▶ on the Home command box. It is a dry run: the box says what it WOULD do, and nothing in the home changes.',
      check: { ran: { partId: 'p_cmd' } },
      show: { partId: 'p_cmd' },
    },
    {
      id: 's3',
      text: 'Home linked? Choose… one of your lights and turn_on, then Preferences ▸ Home Assistant ▸ Allow commands…: read the list, allow. No home? Press Got it.',
      check: { manual: true },
      show: { partId: 'p_cmd' },
    },
    {
      id: 's4',
      text: 'Press “Outputs: dry run” in the run bar: its list names this Home command. Read it, press Arm, then press ▶ on the Text box: the light turns on at 40 %.',
      check: { manual: true },
    },
    {
      id: 's5',
      text: 'In the Home command’s “With”, change 40 to 100, then press ▶ on the Text box: the light goes to full. (No home? It says what it would do.)',
      check: { all: [{ edited: { partId: 'p_cmd', setting: 'data' } }, { ran: { partId: 'p_cmd' } }] },
      show: { partId: 'p_cmd' },
    },
    {
      id: 's6',
      text: 'Press Panic: the next run is a dry run again (what was switched stays). Click “Home commands on” in the top bar to stop those too; quitting stops both.',
      check: { manual: true },
    },
  ],
};
