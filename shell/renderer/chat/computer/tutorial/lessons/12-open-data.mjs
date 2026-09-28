// @ts-check
// Lesson 12 — open data (the night of 2026-09-28). DATA, plus the festivals copy "Analyse a dataset" ships.
//
// What the learner DOES: runs an Open data box (a data.gouv.fr dataset from a pasted link; it holds a copy of the
// festivals list, so offline it hands that on), wires it into a Code box that CHARTS the column named in a Text box
// with the counts data.gouv.fr made over the whole file, wires the chart (a Preview hands on a PNG of what it drew)
// into an Instruction that says what it shows in words only, then charts another column: the chart and the words
// follow the data. Lesson 5's rule on real open data: code counts, the model names.

import { SNAPSHOT } from '../../templates/analyse-a-dataset.mjs';

const DRAW = [
  '// Draws the column named in the Text box: its most common values, with the counts data.gouv.fr made',
  '// over the WHOLE file. Every bar and every number comes from the data, never from a model.',
  'const d = inputs.in.find((v) => v && Array.isArray(v.columns)) || { columns: [], total: 0, dataset: {} };',
  'const want = String(inputs.in.find((v) => typeof v === "string") || "").trim().toLowerCase();',
  'const col = d.columns.find((c) => c.name.toLowerCase() === want);',
  'const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;" }[ch]));',
  'const text = (x, y, size, fill, s) => \'<text x="\' + x + \'" y="\' + y + \'" font-size="\' + size + \'" fill="\' + fill + \'">\' + esc(s) + "</text>";',
  'const svg = (h, body) => \'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 \' + h + \'" font-family="Inter, system-ui, sans-serif">\'',
  '  + \'<rect width="720" height="\' + h + \'" fill="#fafafa"/>\' + body + "</svg>";',
  'if (!col || !(col.tops || []).length) {',
  '  const some = d.columns.filter((c) => (c.tops || []).length > 1 && c.distinct < 50).slice(0, 4).map((c) => c.name);',
  '  return svg(200, text(24, 44, 18, "#18181b", "No column named \\u201c" + want + "\\u201d with values to count.")',
  '    + text(24, 80, 13, "#52525b", "Try one of these:") + some.map((n, i) => text(40, 108 + i * 22, 13, "#52525b", n)).join(""));',
  '}',
  'const bars = col.tops.slice(0, 8);',
  'const max = Math.max(1, ...bars.map((b) => b.count));',
  'let y = 90;',
  'const rows = bars.map((b) => {',
  '  const w = Math.max(2, Math.round((b.count / max) * 380));',
  '  const label = String(b.value).length > 30 ? String(b.value).slice(0, 29) + "\\u2026" : String(b.value);',
  '  const g = \'<text x="218" y="\' + (y + 18) + \'" text-anchor="end" font-size="13" fill="#18181b">\' + esc(label) + "</text>"',
  '    + \'<rect x="230" y="\' + (y + 5) + \'" width="\' + w + \'" height="18" rx="4" fill="#71717a"/>\'',
  '    + text(238 + w, y + 19, 12, "#52525b", b.count);',
  '  y += 30;',
  '  return g;',
  '}).join("");',
  'return svg(y + 50, text(24, 40, 20, "#18181b", col.name) + text(24, 66, 13, "#52525b", "How many festivals have each value \\u2014 the most common ones")',
  '  + rows + text(24, y + 30, 11, "#a1a1aa", "data.gouv.fr \\u00b7 counted over all " + d.total + " rows of the file"));',
].join('\n');

export default {
  id: 'l12-open-data',
  n: 12,
  title: 'open data',
  subtitle: 'A real dataset from data.gouv.fr becomes a chart drawn by code, and a model says what the chart shows.',
  idea: 'The numbers come from the data and the code; the model only looks at the chart and chooses the words — lesson 5’s rule, on real open data.',
  minutes: 6,
  needsFarm: 'one',
  doc: {
    lolgraph: 1,
    title: 'Lesson 12 — open data',
    view: { x: 0, y: 0, zoom: 0.6 },
    parts: [
      { id: 'n_title', type: 'title', x: 40, y: 24, w: 560, h: 106, settings: { text: '12 · open data', size: 'l' } },
      { id: 'n_sub', type: 'title', x: 40, y: 140, w: 1400, h: 84, settings: { text: 'A real dataset from data.gouv.fr becomes a chart drawn by code, and a model says what the chart shows.', size: 's' } },
      {
        id: 'n_idea', type: 'sticky', x: 40, y: 250, w: 320, h: 380,
        settings: { colour: 'yellow', text: 'Open data reads a dataset from data.gouv.fr, France’s open-data portal: its description, the counts data.gouv.fr made over the WHOLE file, and a sample of rows. It asks data.gouv.fr only, for the link a person pasted.\n\nThis one holds a copy of the festivals list, so the lesson also works offline.' },
      },
      {
        id: 'p_data', type: 'opendata', x: 400, y: 250, w: 340, h: 180,
        settings: { link: 'https://www.data.gouv.fr/datasets/liste-des-festivals-en-france', rows: 20 },
        value: { kind: 'json', data: SNAPSHOT },
      },
      { id: 'p_col', type: 'note', x: 400, y: 470, w: 340, h: 130, settings: { text: 'Discipline dominante', locked: false } },
      { id: 'p_draw', type: 'code', x: 800, y: 250, w: 300, h: 170, settings: { code: DRAW, about: 'Charts the column named in the Text box, with data.gouv.fr’s counts over the whole file.', folded: true } },
      {
        id: 'p_ask', type: 'ask', x: 800, y: 470, w: 300, h: 300,
        settings: { instruction: 'Look at this chart of an open dataset. Which value leads, and how do the others compare with it? Answer in two sentences, in words only — never write a number: the chart holds the numbers.' },
      },
      { id: 'p_chart', type: 'preview', x: 1160, y: 250, w: 420, h: 440, settings: { mode: 'svg' } },
      {
        id: 'n_rule', type: 'sticky', x: 1160, y: 730, w: 420, h: 130,
        settings: { colour: 'slate', text: 'Every number on the chart was counted by data.gouv.fr and drawn by code. The model only looks and names.' },
      },
      {
        id: 'n_next', type: 'sticky', x: 400, y: 640, w: 340, h: 170,
        settings: { colour: 'green', text: 'Then open the templates “Analyse a dataset” and “Ask a dataset”: paste the link of any dataset from data.gouv.fr.' },
      },
    ],
    wires: [
      { from: 'p_col', to: 'p_draw', port: 'in' },
      { from: 'p_draw', to: 'p_chart', port: 'content' },
    ],
  },
  steps: [
    {
      id: 's1',
      text: 'Press ▶ on Open data: it reads the festivals dataset from data.gouv.fr. Offline, it hands on the copy it holds.',
      check: { ran: { partId: 'p_data' } },
      show: { partId: 'p_data' },
    },
    {
      id: 's2',
      text: 'Wire Open data into the Code box, then press ▶ on the chart: code draws the column named in the Text box, with data.gouv.fr’s counts.',
      check: { all: [{ wire: { from: 'p_data', to: 'p_draw' } }, { ran: { partId: 'p_chart' } }] },
      show: { partId: 'p_draw' },
    },
    {
      id: 's3',
      text: 'Wire the chart into the Instruction and press ▶ on it: the model looks at the chart and says what it shows — in words, never a number.',
      hint: 'No farm? Use the saved answer when it is offered.',
      check: { all: [{ wire: { from: 'p_chart', to: 'p_ask' } }, { ran: { partId: 'p_ask' } }] },
      show: { partId: 'p_ask' },
    },
    {
      id: 's4',
      text: 'Chart another column: type Région principale de déroulement in the Text box and press ▶ on it. The chart and the words follow the data.',
      hint: 'No farm? The chart is still drawn; use the saved answer for the words.',
      check: { all: [{ edited: { partId: 'p_col', setting: 'text' } }, { ran: { partId: 'p_chart' } }, { ran: { partId: 'p_ask' } }] },
      show: { partId: 'p_col' },
    },
  ],
  demo: {
    p_ask: { kind: 'text', data: 'One value clearly leads, well ahead of all the others. The next few follow at a distance and are close to one another, and the rest trail behind.' },
  },
};
