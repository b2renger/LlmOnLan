// @ts-check
// Builds the two worked examples in this folder THROUGH THE REAL ENGINE, so every part id, port
// name, settings key and wire is exactly what the shipped parts expect.
//
//   node docs/examples/build-examples.mjs           # write the files, then validate them
//   node docs/examples/build-examples.mjs --check   # validate only; fail if a file is out of date
//
// Nothing here is a second implementation of anything: the parts come from
// shell/renderer/chat/graph/parts/index.mjs, the document mutations from graph/model.mjs, the
// layout from graph/tidy.mjs and the file format from graph/serialize.mjs. A wire this script
// cannot add is a wire the canvas would refuse; a settings key the export drops is a key the part
// does not declare. Both are failures here, loudly, rather than a plausible-looking file that
// imports into an empty canvas.
//
// The Code parts' JavaScript is the real thing and is unit-tested at the bottom of this file
// (sRGB -> relative luminance -> (L1+0.05)/(L2+0.05), checked against #000/#fff = 21:1 and
// #777/#fff = 4.48:1). It never reaches the network: a Code part runs in the sandbox.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { specMap } from '../../shell/renderer/chat/graph/parts/index.mjs';
import { createDoc, addPart, addWire } from '../../shell/renderer/chat/graph/model.mjs';
import { tidy } from '../../shell/renderer/chat/graph/tidy.mjs';
import { toText, fromText } from '../../shell/renderer/chat/graph/serialize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPECS = specMap();

/** Deterministic ids, so re-running this script produces a byte-identical file. */
function counter(prefix) {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** A fixed clock: the file must not change because the day did. */
const NOW = () => 0;

// ---------------------------------------------------------------------------------------------
// a tiny builder over the real mutations
// ---------------------------------------------------------------------------------------------

function builder(title) {
  const newId = counter('p');
  let doc = createDoc({ id: 'example', threadId: null, title, now: NOW });
  return {
    /** @param {string} type @param {object} settings @returns {string} the new part's id */
    add(type, settings) {
      const before = doc;
      const out = addPart(doc, { type, x: 0, y: 0, settings }, { specs: SPECS, newId, now: NOW });
      if (!out.part) throw new Error(`addPart refused type "${type}" — it is not in the catalogue`);
      // A settings key the part does not declare would be dropped on export and the example would
      // silently mean something else. Caught here instead.
      const declared = Object.keys(SPECS.get(type).defaults());
      for (const key of Object.keys(settings || {})) {
        if (!declared.includes(key)) throw new Error(`part "${type}" does not declare a setting "${key}"`);
      }
      doc = out.doc;
      if (doc === before) throw new Error(`addPart("${type}") changed nothing`);
      return out.part.id;
    },
    /** @param {string} from @param {string} to @param {string} port */
    wire(from, to, port) {
      const out = addWire(doc, { from, to, port }, { specs: SPECS, newId, now: NOW });
      if (!out.ok) throw new Error(`the canvas would refuse ${from} -> ${to}.${port}: ${out.reason}`);
      doc = out.doc;
    },
    /** Lay the parts out with the shipped Tidy, so the graph reads left to right and nothing
     * overlaps when it opens. */
    done() {
      doc = tidy(doc, { now: NOW });
      return doc;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// the Code parts' JavaScript
// ---------------------------------------------------------------------------------------------

// A Code part's body is `(inputs) => value`: `inputs.in` is an ORDERED ARRAY (several wires may
// land on one port), and what is returned is JSON-encoded by the guest. A returned string becomes
// a `text` value, a plain object becomes `json`.

const CONTRAST_CODE = `// WCAG 2.x contrast, computed rather than guessed. No network, no library.
const first = inputs.in[0];
const list = Array.isArray(first) ? first
  : (first && Array.isArray(first.palette) ? first.palette : null);
if (!list || !list.length) {
  throw new Error('No palette arrived. Wire the Ask part into this one and set its shape to JSON.');
}

function hexOf(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(/^#/, '');
  const full = /^[0-9a-fA-F]{3}$/.test(s) ? s.split('').map(function (c) { return c + c; }).join('') : s;
  return /^[0-9a-fA-F]{6}$/.test(full) ? '#' + full.toLowerCase() : null;
}

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a, b) {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

const round = function (n) { return Math.round(n * 100) / 100; };
const AA = 4.5;

const rows = list.map(function (entry, i) {
  const item = entry && typeof entry === 'object' ? entry : {};
  const name = String(item.name == null ? 'colour ' + (i + 1) : item.name).trim() || ('colour ' + (i + 1));
  const role = String(item.role == null ? '' : item.role).trim();
  const hex = hexOf(item.hex);
  if (!hex) {
    return {
      name: name, role: role, hex: String(item.hex == null ? '' : item.hex),
      valid: false, onBlack: null, onWhite: null, best: null, bestOn: null,
      passes: false, note: 'not a colour I can read'
    };
  }
  const L = luminance(hex);
  const onBlack = round(ratio(L, 0));
  const onWhite = round(ratio(L, 1));
  const best = Math.max(onBlack, onWhite);
  return {
    name: name, role: role, hex: hex, valid: true,
    onBlack: onBlack, onWhite: onWhite,
    best: best, bestOn: onBlack >= onWhite ? 'black' : 'white',
    passes: best >= AA,
    note: best >= AA ? '' : 'no text colour reaches ' + AA + ':1 on this'
  };
});

const header = '| Name | Hex | Role | On black | On white | Verdict |';
const rule = '| --- | --- | --- | ---: | ---: | --- |';
const body = rows.map(function (r) {
  const verdict = !r.valid ? 'unreadable'
    : (r.passes ? 'pass (' + r.best + ':1 on ' + r.bestOn + ')' : 'FAIL (best ' + r.best + ':1)');
  return '| ' + r.name + ' | ' + r.hex + ' | ' + (r.role || '—') + ' | '
    + (r.valid ? r.onBlack + ':1' : '—') + ' | ' + (r.valid ? r.onWhite + ':1' : '—') + ' | ' + verdict + ' |';
});

return {
  threshold: AA,
  checked: rows.length,
  failing: rows.filter(function (r) { return !r.passes; }).length,
  rows: rows,
  table: [header, rule].concat(body).join('\\n')
};
`;

const SHEET_CODE = `// The swatch sheet, as SVG. Deterministic drawing — no model, no network.
const report = inputs.in[0];
const rows = report && Array.isArray(report.rows) ? report.rows : [];
if (!rows.length) throw new Error('No rows arrived. Wire the contrast part into this one.');

const W = 640;
const HEAD = 64;
const ROW = 64;
const H = HEAD + ROW * rows.length + 24;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const FONT = 'Inter, system-ui, sans-serif';
const out = [];
out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">');
out.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#18181b"/>');
out.push('<text x="24" y="38" font-family="' + FONT + '" font-size="18" fill="#e4e4e7">Palette contrast · '
  + rows.length + ' colours · ' + report.failing + ' below ' + report.threshold + ':1</text>');

rows.forEach(function (r, i) {
  const y = HEAD + i * ROW;
  const fill = r.valid ? r.hex : '#3f3f46';
  out.push('<rect x="24" y="' + (y + 8) + '" width="48" height="48" rx="8" fill="' + esc(fill) + '" stroke="#27272a"/>');
  if (!r.valid) {
    out.push('<text x="48" y="' + (y + 38) + '" text-anchor="middle" font-family="' + FONT
      + '" font-size="20" fill="#a1a1aa">?</text>');
  }
  out.push('<text x="88" y="' + (y + 28) + '" font-family="' + FONT + '" font-size="14" fill="#e4e4e7">'
    + esc(r.name) + '</text>');
  out.push('<text x="88" y="' + (y + 48) + '" font-family="' + FONT + '" font-size="12" fill="#a1a1aa">'
    + esc(r.valid ? r.hex : String(r.hex)) + (r.role ? ' · ' + esc(r.role) : '') + '</text>');
  const numbers = r.valid ? ('on black ' + r.onBlack + ':1   on white ' + r.onWhite + ':1') : esc(r.note);
  out.push('<text x="' + (W - 120) + '" y="' + (y + 28) + '" text-anchor="end" font-family="' + FONT
    + '" font-size="12" fill="#a1a1aa">' + numbers + '</text>');
  const ok = r.passes;
  out.push('<rect x="' + (W - 104) + '" y="' + (y + 16) + '" width="80" height="24" rx="12" fill="'
    + (ok ? '#10b981' : '#ef4444') + '"/>');
  out.push('<text x="' + (W - 64) + '" y="' + (y + 32) + '" text-anchor="middle" font-family="' + FONT
    + '" font-size="12" fill="#fafafa">' + (ok ? 'pass' : 'fail') + '</text>');
});

out.push('</svg>');
return out.join('\\n');
`;

const TOKENS_CODE = `// tokens.css — the palette as custom properties, with the measured contrast in the comment.
const report = inputs.in[0];
const rows = report && Array.isArray(report.rows) ? report.rows : [];
if (!rows.length) throw new Error('No rows arrived. Wire the contrast part into this one.');

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'colour';
}

const seen = {};
const lines = [];
const notes = [];
rows.forEach(function (r, i) {
  let name = slug(r.name);
  if (seen[name]) name = name + '-' + (seen[name] + 1);
  seen[slug(r.name)] = (seen[slug(r.name)] || 0) + 1;
  if (!r.valid) {
    notes.push('  /* ' + name + ': ' + r.note + ' (' + String(r.hex) + ') */');
    return;
  }
  const comment = (r.role ? r.role + ' · ' : '')
    + 'best ' + r.best + ':1 on ' + r.bestOn + (r.passes ? '' : ' — below ' + report.threshold + ':1');
  lines.push('  --' + name + ': ' + r.hex + ';  /* ' + comment + ' */');
});

return [
  '/* Written by the palette-check graph. ' + report.checked + ' colours checked, '
    + report.failing + ' below ' + report.threshold + ':1. */',
  ':root {'
].concat(lines, notes, ['}', '']).join('\\n');
`;

// ---------------------------------------------------------------------------------------------
// example 1 — palette-check: the model judges, JavaScript checks
// ---------------------------------------------------------------------------------------------

const PALETTE_BRIEF = `Atelier Num is a small studio that does VR, projection and installation work.
The site is dark by default, reads as a workshop rather than an agency, and shows a lot of
photography. It needs a page background, a surface for cards, one accent for links and buttons,
and two text colours (body and muted).`;

const PALETTE_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    palette: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          hex: { type: 'string' },
          role: { type: 'string' },
        },
        required: ['name', 'hex', 'role'],
        additionalProperties: false,
      },
    },
  },
  required: ['palette'],
  additionalProperties: false,
});

function paletteCheck() {
  const b = builder('Palette check');
  const note = b.add('note', { text: PALETTE_BRIEF });
  const ask = b.add('ask', {
    instruction:
      'Propose exactly five colours for this site. Give each one a short name, a six-digit hex '
      + 'value starting with #, and the role it plays. Do not explain them.',
    model: '',
    shape: 'json',
    schema: PALETTE_SCHEMA,
  });
  const contrast = b.add('code', { code: CONTRAST_CODE });
  const sheet = b.add('code', { code: SHEET_CODE });
  const tokens = b.add('code', { code: TOKENS_CODE });
  const draw = b.add('render', { mode: 'svg', width: 640, height: 480 });
  const write = b.add('file', { path: 'out/tokens.css' });

  b.wire(note, ask, 'context');
  b.wire(ask, contrast, 'in');
  b.wire(contrast, sheet, 'in');
  b.wire(contrast, tokens, 'in');
  b.wire(sheet, draw, 'in');
  b.wire(tokens, write, 'in');
  return b.done();
}

// ---------------------------------------------------------------------------------------------
// example 2 — fanout-pitches: one Run, six generations
// ---------------------------------------------------------------------------------------------

const TOPICS = [
  'A lamp that gets brighter the longer the room stays quiet',
  'A VR piece you can only finish with a stranger',
  'A projection that redraws itself from the weather outside',
  'A printer that only prints what nobody read',
  'A room-scale map of the building as it was ten years ago',
  'A speaker that plays the sound of the room an hour ago',
];

function fanoutPitches() {
  const b = builder('Fan-out pitches');
  const note = b.add('note', { text: TOPICS.join('\n') });
  const split = b.add('split', { mode: 'lines', separator: ',', limit: 0 });
  const ask = b.add('ask', {
    instruction:
      'Write one paragraph pitching this idea to a gallery: what the visitor does, what they '
      + 'see, and why it is worth making. Four sentences at most. No heading, no bullet points.',
    model: '',
    shape: 'text',
    schema: '',
  });
  const collect = b.add('collect', { mode: 'numbered', template: '{item}', separator: '\n' });
  const write = b.add('file', { path: 'out/pitches.md' });

  b.wire(note, split, 'text');
  b.wire(split, ask, 'context');
  b.wire(ask, collect, 'items');
  b.wire(collect, write, 'in');
  return b.done();
}

// ---------------------------------------------------------------------------------------------
// validation — round-trip through the real import, and assert nothing was dropped
// ---------------------------------------------------------------------------------------------

/** @param {any} doc @param {string} text @param {string} name */
function validate(doc, text, name) {
  const newId = counter('i');
  const back = fromText(text, { specs: SPECS, newId, now: NOW, id: 'round-trip', threadId: 't' });
  if (!back.ok || !back.doc) throw new Error(`${name}: the file does not import: ${back.errors.join(', ')}`);
  if (back.errors.length) throw new Error(`${name}: the import dropped ${back.errors.join(', ')}`);
  if (back.doc.parts.length !== doc.parts.length) {
    throw new Error(`${name}: ${doc.parts.length} parts went in, ${back.doc.parts.length} came back`);
  }
  if (back.doc.wires.length !== doc.wires.length) {
    throw new Error(`${name}: ${doc.wires.length} wires went in, ${back.doc.wires.length} came back`);
  }

  // Ids are re-minted on import (by design), so the comparison is positional: same types in the
  // same order, same settings key for key, and the same wires once the ids are mapped.
  const map = new Map(doc.parts.map((p, i) => [p.id, back.doc.parts[i].id]));
  doc.parts.forEach((p, i) => {
    const q = back.doc.parts[i];
    if (p.type !== q.type) throw new Error(`${name}: part ${i} is a ${q.type}, was a ${p.type}`);
    for (const key of Object.keys(p.settings)) {
      const a = JSON.stringify(p.settings[key]);
      const bb = JSON.stringify(q.settings[key]);
      if (a !== bb) throw new Error(`${name}: ${p.type}.${key} did not survive the round trip`);
    }
    if (!(q.x === p.x && q.y === p.y)) throw new Error(`${name}: part ${i} moved`);
  });
  const want = doc.wires.map((w) => `${map.get(w.from)}>${map.get(w.to)}.${w.port}`).sort();
  const got = back.doc.wires.map((w) => `${w.from}>${w.to}.${w.port}`).sort();
  if (want.join('|') !== got.join('|')) throw new Error(`${name}: the wires changed`);

  // Nothing overlaps, and the graph reads left to right.
  for (let i = 0; i < doc.parts.length; i++) {
    for (let j = i + 1; j < doc.parts.length; j++) {
      const a = doc.parts[i];
      const c = doc.parts[j];
      const apart = a.x + a.w <= c.x || c.x + c.w <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y;
      if (!apart) throw new Error(`${name}: ${a.type} and ${c.type} overlap on the canvas`);
    }
  }
  for (const w of doc.wires) {
    const from = doc.parts.find((p) => p.id === w.from);
    const to = doc.parts.find((p) => p.id === w.to);
    if (!(to.x > from.x)) throw new Error(`${name}: ${from.type} -> ${to.type} runs backwards`);
  }
  return back.doc;
}

// ---------------------------------------------------------------------------------------------
// the contrast maths, checked in plain Node against known values
// ---------------------------------------------------------------------------------------------

function checkContrastMaths() {
  // The SAME source the Code part carries, compiled the way the sandbox compiles it.
  const run = new Function('inputs', CONTRAST_CODE);
  const out = run({
    in: [{
      palette: [
        { name: 'Ink', hex: '#000000', role: 'text' },
        { name: 'Paper', hex: '#ffffff', role: 'page' },
        { name: 'Grey', hex: '#777777', role: 'muted' },
        { name: 'Short', hex: '#fff', role: 'shorthand' },
        { name: 'Nonsense', hex: 'periwinkle', role: 'broken' },
      ],
    }],
    item: null,
  });
  const by = Object.fromEntries(out.rows.map((r) => [r.name, r]));
  const near = (got, want, why) => {
    if (Math.abs(got - want) > 0.01) throw new Error(`contrast maths: ${why} — got ${got}, wanted ${want}`);
  };
  near(by.Ink.onWhite, 21, '#000 against white is 21:1');
  near(by.Paper.onBlack, 21, '#fff against black is 21:1');
  near(by.Paper.onWhite, 1, '#fff against white is 1:1');
  near(by.Grey.onWhite, 4.48, '#777 against white is 4.48:1');
  near(by.Grey.onBlack, 4.69, '#777 against black is 4.69:1');
  if (by.Short.hex !== '#ffffff') throw new Error('contrast maths: #fff shorthand was not expanded');
  if (by.Nonsense.valid !== false) throw new Error('contrast maths: a non-colour was accepted');
  if (by.Nonsense.passes !== false) throw new Error('contrast maths: a non-colour passed');
  if (by.Grey.passes !== true) throw new Error('contrast maths: #777 should pass on black');
  if (out.failing !== 1) throw new Error(`contrast maths: expected 1 failure, got ${out.failing}`);
  if (!out.table.startsWith('| Name |')) throw new Error('contrast maths: no table came back');

  // The two formatters must survive the same report.
  const svg = new Function('inputs', SHEET_CODE)({ in: [out], item: null });
  if (!svg.startsWith('<svg ') || !svg.includes('#777777')) throw new Error('the sheet is not an SVG of the palette');
  if (svg.includes('<script')) throw new Error('the sheet must not carry a script');
  const css = new Function('inputs', TOKENS_CODE)({ in: [out], item: null });
  if (!css.includes(':root {') || !css.includes('--grey: #777777;')) throw new Error('tokens.css is not the palette');
  if (!css.includes('periwinkle')) throw new Error('tokens.css must say which colour it could not use');
  return { rows: out.rows.length, svgBytes: svg.length, cssBytes: css.length };
}

// ---------------------------------------------------------------------------------------------

const EXAMPLES = [
  { file: 'palette-check.lolgraph.json', title: 'Palette check', build: paletteCheck },
  { file: 'fanout-pitches.lolgraph.json', title: 'Fan-out pitches', build: fanoutPitches },
];

function main() {
  const check = process.argv.includes('--check');
  const maths = checkContrastMaths();
  console.log(`ok   contrast maths: ${maths.rows} rows, ${maths.svgBytes} bytes of SVG, ${maths.cssBytes} bytes of CSS`);

  let failed = 0;
  for (const ex of EXAMPLES) {
    const doc = ex.build();
    const text = toText(doc, { specs: SPECS, values: false, title: ex.title });
    const target = path.join(HERE, ex.file);
    const onDisk = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (check) {
      if (onDisk !== text) {
        console.log(`FAIL ${ex.file} is out of date — run: node docs/examples/build-examples.mjs`);
        failed++;
        continue;
      }
    } else if (onDisk !== text) {
      fs.writeFileSync(target, text);
    }
    const back = validate(doc, text, ex.file);
    console.log(`ok   ${ex.file}: ${back.parts.length} parts, ${back.wires.length} wires, nothing dropped`);
  }
  if (failed) process.exit(1);
}

main();
