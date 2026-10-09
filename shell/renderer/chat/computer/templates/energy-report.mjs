// @ts-check
// Template — Energy report (2026-10-09, docs/HOME_ASSISTANT.md). DATA, plus the saved reading the Home box holds.
// A power-measuring plug's last 24 hours (the Home box's History): CODE draws the chart and computes the peak, the
// average and the energy used; a model looks at the chart (the Preview hands on a picture of it) and says in words
// when the device worked and rested. Lesson 12's rule: the numbers come from the data and the code. One generation.

import { POWER } from './home-readings.mjs';

const CHART = String.raw`// Draws the first device that has a history: its values over the hours read, with the peak, the average and,
// for a power in W, the energy used. Every number comes from the reading, never from a model.
const r = inputs.in.find((v) => v && Array.isArray(v.devices)) || { devices: [] };
const d = r.devices.find((x) => Array.isArray(x.history) && x.history.filter((p) => typeof p.value === "number").length > 1);
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]));
const W = 720, H = 360, L = 56, R = 16, T = 70, B = 44;
const svg = (body) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 360" font-family="Inter, system-ui, sans-serif"><rect width="720" height="360" fill="#fafafa"/>' + body + "</svg>";
if (!d) return svg('<text x="24" y="48" font-size="15" fill="#18181b">No history to draw: choose a power sensor on the Home box and set History (hours) to 24.</text>');
const pts = d.history.filter((p) => typeof p.value === "number").map((p) => ({ t: Date.parse(p.at), v: p.value }));
const t0 = pts[0].t;
const t1 = Math.max(pts[pts.length - 1].t, t0 + 1);
const max = Math.max(1, ...pts.map((p) => p.v));
const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
const y = (v) => T + (1 - v / max) * (H - T - B);
let wh = 0;
for (let i = 1; i < pts.length; i++) wh += pts[i - 1].v * (pts[i].t - pts[i - 1].t) / 3600000;
const avg = wh / ((t1 - t0) / 3600000);
const unit = esc(d.unit || "");
const path = pts.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
let ticks = "";
for (let h = Math.ceil(t0 / 3600000) * 3600000; h <= t1; h += 3 * 3600000) {
  const label = new Date(h).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  ticks += '<text x="' + x(h).toFixed(1) + '" y="' + (H - B + 18) + '" font-size="11" text-anchor="middle" fill="#71717a">' + label + "</text>";
}
const used = d.unit === "W" ? " · used " + (wh / 1000).toFixed(2) + " kWh" : "";
return svg('<text x="24" y="30" font-size="18" fill="#18181b">' + esc(d.name) + "</text>"
  + '<text x="24" y="52" font-size="12" fill="#52525b">peak ' + Math.round(max) + " " + unit + " · average " + Math.round(avg) + " " + unit + used + "</text>"
  + '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="#d4d4d8"/>'
  + '<text x="' + (L - 6) + '" y="' + (T + 4) + '" font-size="11" text-anchor="end" fill="#71717a">' + Math.round(max) + "</text>"
  + '<path d="' + path + '" fill="none" stroke="#52525b" stroke-width="2"/>' + ticks);`;

export default {
  id: 'energy-report',
  title: 'Energy report',
  subtitle: 'A plug’s power over the last 24 hours: code draws the chart and the numbers, a model says when the device worked and rested.',
  needsFarm: 'one',
  generations: 1,
  doc: {
    lolgraph: 2,
    title: 'Energy report',
    view: { x: 16, y: 8, zoom: 0.55 },
    parts: [
      { id: 'r_title', type: 'title', x: 40, y: 24, w: 820, h: 100, settings: { text: 'Energy report', size: 'l' } },
      {
        id: 'r_how', type: 'sticky', x: 40, y: 140, w: 320, h: 520,
        settings: {
          colour: 'yellow',
          text: 'How it works\n\n1. Home: press Choose… and tick a plug that measures power (Shelly, Tapo, a Matter plug…) — its sensor ends in “power”. History (hours) is 24. With no home linked, the box hands on a laser cutter’s day it holds.\n2. Press Run all. Code draws the day and writes the peak, the average and the energy used: every number comes from Home Assistant’s history.\n3. A model looks at the chart and says when the device worked, rested, or stayed on at night — in words only.\n\nA model that can see is needed (gemma4 can).',
        },
      },
      {
        id: 'r_home', type: 'home', x: 400, y: 140, w: 340, h: 170,
        settings: { entities: POWER.devices.map((d) => d.id), names: Object.fromEntries(POWER.devices.map((d) => [d.id, d.name])), hours: 24 },
        value: { kind: 'json', data: POWER },
      },
      { id: 'r_chart', type: 'code', x: 400, y: 360, w: 340, h: 170, settings: { code: CHART, about: 'Draws the day, with the peak, the average and the energy used.', folded: true } },
      { id: 'r_view', type: 'preview', x: 800, y: 140, w: 460, h: 300, settings: { mode: 'svg' } },
      {
        id: 'r_ask', type: 'ask', x: 800, y: 480, w: 460, h: 260,
        settings: { instruction: 'Look at this chart of a device’s power over a day. Say when it was working hard, when it rested, and whether it looks left on when nobody needs it. Two or three sentences, in words only — never write a number: the chart holds the numbers.' },
      },
      { id: 'r_words', type: 'preview', x: 1320, y: 480, w: 340, h: 220, settings: { mode: 'markdown' } },
    ],
    wires: [
      { from: 'r_home', to: 'r_chart', port: 'in' },
      { from: 'r_chart', to: 'r_view', port: 'content' },
      { from: 'r_view', to: 'r_ask', port: 'in', label: 'chart' },
      { from: 'r_ask', to: 'r_words', port: 'content' },
    ],
  },
};
