// @ts-check
// Template — Morning briefing (2026-10-09, docs/HOME_ASSISTANT.md). DATA, plus the saved reading the Home box holds.
// The weather Home Assistant makes at onboarding (met.no) with its forecast, today's calendar and the room, read by one
// Home box; a model writes a few spoken sentences, shown and said by Speak. One generation.

import { MORNING } from './home-readings.mjs';

export default {
  id: 'morning-briefing',
  title: 'Morning briefing',
  subtitle: 'Your Home Assistant’s weather, today’s calendar and the room become a short briefing, shown and said out loud.',
  needsFarm: 'one',
  generations: 1,
  doc: {
    lolgraph: 2,
    title: 'Morning briefing',
    view: { x: 16, y: 8, zoom: 0.6 },
    parts: [
      { id: 'm_title', type: 'title', x: 40, y: 24, w: 820, h: 100, settings: { text: 'Morning briefing', size: 'l' } },
      {
        id: 'm_how', type: 'sticky', x: 40, y: 140, w: 320, h: 500,
        settings: {
          colour: 'yellow',
          text: 'How it works\n\n1. Home: press Choose… and tick your weather (on most homes “Forecast Home”, made by Home Assistant itself), your calendar (Local Calendar, CalDAV…) and a sensor or two of the room. With no home linked, the box hands on the studio reading it holds.\n2. Press Run all: a model writes a short briefing from the forecast, the day’s events and the room, and Speak says it.\n\nTo hear it every morning, keep the Computer open and add a Trigger (every 3600 seconds) before the Home box, then arm the outputs: a Trigger starts runs only while armed and on screen.',
        },
      },
      {
        id: 'm_home', type: 'home', x: 400, y: 140, w: 340, h: 170,
        settings: { entities: MORNING.devices.map((d) => d.id), names: Object.fromEntries(MORNING.devices.map((d) => [d.id, d.name])), hours: 0 },
        value: { kind: 'json', data: MORNING },
      },
      {
        id: 'm_ask', type: 'ask', x: 800, y: 140, w: 340, h: 320,
        settings: { instruction: 'Write a short morning briefing for the people of this place, from the reading: the weather today (the forecast’s first day: the sky, the high and the low, rain or wind worth knowing), then today’s events in time order with their times as written, then how the room is right now. Four or five short sentences, spoken style, no list, no heading.' },
      },
      { id: 'm_view', type: 'preview', x: 1200, y: 140, w: 360, h: 260, settings: { mode: 'markdown' } },
      { id: 'm_speak', type: 'speak', x: 1200, y: 440, w: 300, h: 160, settings: { voice: 'auto' } },
    ],
    wires: [
      { from: 'm_home', to: 'm_ask', port: 'in', label: 'reading' },
      { from: 'm_ask', to: 'm_view', port: 'content' },
      { from: 'm_ask', to: 'm_speak', port: 'in' },
    ],
  },
};
