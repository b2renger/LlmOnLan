// @ts-check
// Template — Comfort advisor (2026-10-09, docs/HOME_ASSISTANT.md). DATA, plus the saved reading the Home box holds.
// The room's CO2, temperature and humidity: CODE decides what is comfortable (lesson 5's rule: code counts, the model
// names), a model turns the findings into a suggestion that Speak says, and — only when code says the air is stuffy —
// a Condition lets a Home command turn the fan's plug on. That command is a dry run until a person allows home commands
// AND arms the outputs. One generation.

import { STUDIO } from './home-readings.mjs';

const CHECK = String.raw`// Decides from the numbers what is comfortable. The model after it only puts this in words.
// It finds each sensor by its kind (Home Assistant's device_class), so it works with the sensors you choose.
const r = inputs.in.find((v) => v && Array.isArray(v.devices)) || { devices: [] };
const kind = (cls, unit) => r.devices.find((d) => d.attributes && d.attributes.device_class === cls && typeof d.value === "number")
  || r.devices.find((d) => d.unit === unit && typeof d.value === "number");
const lines = [];
const co2 = kind("carbon_dioxide", "ppm");
if (co2) lines.push("- CO2 " + co2.value + " ppm: " + (co2.value > 1200 ? "stuffy, the room needs air" : co2.value > 800 ? "getting stuffy" : "fresh"));
const t = kind("temperature", "°C");
if (t) lines.push("- Temperature " + t.value + " °C: " + (t.value < 19 ? "cool" : t.value > 25 ? "warm" : "comfortable"));
const h = kind("humidity", "%");
if (h) lines.push("- Humidity " + h.value + " %: " + (h.value < 35 ? "dry" : h.value > 65 ? "damp" : "comfortable"));
return lines.length ? lines.join("\n") : "No CO2, temperature or humidity sensor in the reading: choose them on the Home box.";`;

const STUFFY = String.raw`// Is the air stuffy? true above 1000 ppm of CO2. The Condition after it lets the fan command through only then.
const r = inputs.in.find((v) => v && Array.isArray(v.devices)) || { devices: [] };
const co2 = r.devices.find((d) => d.attributes && d.attributes.device_class === "carbon_dioxide") || r.devices.find((d) => d.unit === "ppm");
return !!(co2 && typeof co2.value === "number" && co2.value > 1000);`;

export default {
  id: 'comfort-advisor',
  title: 'Comfort advisor',
  subtitle: 'The room’s CO2, temperature and humidity: code decides what is comfortable, a model suggests what to do, and a stuffy room turns the fan on.',
  needsFarm: 'one',
  generations: 1,
  doc: {
    lolgraph: 2,
    title: 'Comfort advisor',
    view: { x: 16, y: 8, zoom: 0.5 },
    parts: [
      { id: 'c_title', type: 'title', x: 40, y: 24, w: 820, h: 100, settings: { text: 'Comfort advisor', size: 'l' } },
      {
        id: 'c_how', type: 'sticky', x: 40, y: 140, w: 320, h: 600,
        settings: {
          colour: 'yellow',
          text: 'How it works\n\n1. Home: press Choose… and tick the room’s CO2, temperature and humidity sensors (an AirGradient, an Aqara…). With no home linked, the box hands on the studio reading it holds.\n2. Press Run all. Code decides what is comfortable — every threshold is in the code, change them there — and a model turns that into a suggestion that Speak says.\n3. When code says the air is stuffy (CO2 over 1000 ppm), the Condition lets the Home command through: choose YOUR fan or its plug on it. It is a dry run until you allow home commands (Preferences ▸ Home Assistant) AND arm the outputs in the run bar.\n\nTo check every 10 minutes, add a Trigger (every 600 seconds) before the Home box and arm the outputs.',
        },
      },
      {
        id: 'c_home', type: 'home', x: 400, y: 140, w: 340, h: 170,
        settings: { entities: STUDIO.devices.map((d) => d.id), names: Object.fromEntries(STUDIO.devices.map((d) => [d.id, d.name])), hours: 0 },
        value: { kind: 'json', data: STUDIO },
      },
      { id: 'c_check', type: 'code', x: 800, y: 140, w: 320, h: 170, settings: { code: CHECK, about: 'Decides from the numbers what is comfortable: CO2, temperature, humidity.', folded: true } },
      {
        id: 'c_ask', type: 'ask', x: 1180, y: 140, w: 320, h: 280,
        settings: { instruction: 'These are findings about a room, decided from its sensors. Turn them into one or two friendly, practical suggestions for the people working there (open a window, take a break, a jumper…). Keep the numbers exactly as given. Two sentences at most, the way you would say it.' },
      },
      { id: 'c_speak', type: 'speak', x: 1560, y: 140, w: 300, h: 160, settings: { voice: 'auto' } },
      { id: 'c_stuffy', type: 'code', x: 800, y: 380, w: 320, h: 170, settings: { code: STUFFY, about: 'Is the air stuffy? true above 1000 ppm of CO2.', folded: true } },
      { id: 'c_cond', type: 'condition', x: 1180, y: 460, w: 300, h: 200, settings: { branch: 'yes', mode: 'text', question: '', model: '' } },
      { id: 'c_fan', type: 'home-command', x: 1560, y: 460, w: 320, h: 220, settings: { entity: 'switch.studio_fan_plug', name: 'Studio fan plug', action: 'turn_on', data: '' } },
    ],
    wires: [
      { from: 'c_home', to: 'c_check', port: 'in' },
      { from: 'c_check', to: 'c_ask', port: 'in', label: 'findings' },
      { from: 'c_ask', to: 'c_speak', port: 'in' },
      { from: 'c_home', to: 'c_stuffy', port: 'in' },
      { from: 'c_stuffy', to: 'c_cond', port: 'in' },
      { from: 'c_cond', to: 'c_fan', port: 'in' },
    ],
  },
};
