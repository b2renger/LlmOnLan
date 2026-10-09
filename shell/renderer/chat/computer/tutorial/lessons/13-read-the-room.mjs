// @ts-check
// Lesson 13 — read the room (2026-10-09, docs/HOME_ASSISTANT.md). DATA, plus the saved reading the Home box holds.
//
// What the learner DOES: runs a Home box (the studio's temperature, humidity and CO2 from Home Assistant; with no home
// linked it hands on the reading it holds, and says so), wires it into an Instruction that says in plain words how the
// room feels, then into Speak, which says it out loud. Last, with a home linked, they pick their own sensors (a manual
// step: a person without a home presses Got it).

import { STUDIO } from '../../templates/home-readings.mjs';

const names = Object.fromEntries(STUDIO.devices.map((d) => [d.id, d.name]));

export default {
  id: 'l13-read-the-room',
  n: 13,
  title: 'read the room',
  subtitle: 'A Home box reads the room’s sensors from Home Assistant; a model says how the room feels, and the Computer says it out loud.',
  idea: 'Reading the home changes nothing in it, and only the devices a person chose are read. The model gets the numbers and puts them in words.',
  minutes: 4,
  needsFarm: 'one',
  doc: {
    lolgraph: 1,
    title: 'Lesson 13 — read the room',
    view: { x: 0, y: 0, zoom: 0.6 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 640, h: 106, settings: { text: '13 · read the room', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 140, w: 1400, h: 84, settings: { text: 'A Home box reads the room’s sensors; a model says how the room feels, and the Computer says it out loud.', size: 's' } },
      {
        id: 'n_idea', type: 'sticky', x: 40, y: 250, w: 320, h: 420,
        settings: { colour: 'yellow', text: 'The Home box reads your Home Assistant (a Home Assistant Green, for example): the devices and sensors YOU choose with Choose…. Reading changes nothing in the home.\n\nNo Home Assistant linked? The box holds a reading of a studio — 23.8 °C, 41 % humidity, CO2 at 1180 ppm — and hands that on, saying so.\n\nLink yours in Preferences ▸ Home Assistant: its address and a long-lived token.' },
      },
      {
        id: 'p_home', type: 'home', x: 400, y: 250, w: 340, h: 170,
        settings: { entities: STUDIO.devices.map((d) => d.id), names, hours: 0 },
        value: { kind: 'json', data: STUDIO },
      },
      {
        id: 'p_ask', type: 'ask', x: 800, y: 250, w: 320, h: 300,
        settings: { instruction: 'These are the sensors of a room. In two or three short sentences, say how the room feels to the people working in it — warm or cool, dry or damp, fresh or stuffy (CO2: under 800 ppm is fresh, over 1200 ppm is stuffy) — and give one piece of advice if it needs one. Plain words, the way you would say it out loud.' },
      },
      { id: 'p_speak', type: 'speak', x: 1180, y: 250, w: 300, h: 160, settings: { voice: 'auto' } },
      { id: 'p_view', type: 'preview', x: 1180, y: 450, w: 320, h: 220, settings: { mode: 'markdown' } },
      {
        id: 'n_where', type: 'sticky', x: 400, y: 460, w: 340, h: 200,
        settings: { colour: 'slate', text: 'What leaves this computer: the reading goes to the farm inside the Instruction’s request, like any text you wire in. Where the home and its people are (coordinates) is never in it.' },
      },
      { id: 'n_next', type: 'sticky', x: 800, y: 590, w: 320, h: 120, settings: { colour: 'green', text: 'Next up → 14 · switch the home.' } },
    ],
    wires: [
      { from: 'p_ask', to: 'p_view', port: 'content' },
    ],
  },
  steps: [
    {
      id: 's1',
      text: 'Press ▶ on the Home box. No home linked: it hands on the reading it holds, and says so. Yours linked? Pick its sensors with Choose… first.',
      check: { ran: { partId: 'p_home' } },
      show: { partId: 'p_home' },
    },
    {
      id: 's2',
      text: 'Wire the Home box into the Instruction, then press ▶ on the Instruction: the model says how the room feels.',
      hint: 'No farm? Use the saved answer when it is offered.',
      check: { all: [{ wire: { from: 'p_home', to: 'p_ask' } }, { ran: { partId: 'p_ask' } }] },
      show: { partId: 'p_ask' },
    },
    {
      id: 's3',
      text: 'Wire the Instruction into Speak and press ▶ on Speak: it says the answer out loud, with the farm’s voice or this computer’s.',
      check: { all: [{ wire: { from: 'p_ask', to: 'p_speak' } }, { ran: { partId: 'p_speak' } }] },
      show: { partId: 'p_speak' },
    },
    {
      id: 's4',
      text: 'Linked your Home Assistant? Try other sensors: Choose… on the Home box, tick them, Done, then Run all. No home? Press Got it.',
      check: { manual: true },
      show: { partId: 'p_home' },
    },
  ],
  next: 'l14-switch-the-home',
  demo: {
    p_ask: { kind: 'text', data: 'The room is comfortably warm and the air is on the dry side, but it is getting stuffy: the CO2 is high. Open a window for ten minutes, or take a short break outside.' },
  },
};
