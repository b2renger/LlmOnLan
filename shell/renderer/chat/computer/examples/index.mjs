// @ts-check
// The box examples (owner, 2026-09-27): "one example per box — a small ? on the box opens a simple
// example that says what it does, its inputs and outputs, and snippets of how to use it on the
// Computer". PURE: data and one builder, so a unit test proves that every entry of the ＋ menu has
// one and that each one opens without losing a part or a wire.
//
// An example is DATA, not a graph file: what the box does, its ports and output in words, a few
// "how to use it" lines, and a tiny working setup (`parts`/`wires`, laid out from 0,0). `exampleDoc`
// composes the graph the ? opens: a Title, a yellow Sticky holding the words, and the setup to its
// right, zoomed so the whole thing fits the canvas. One layout for all of them, so they read alike;
// the Sticky's title is the ＋ menu's own name for the box (a unit test holds the two equal).
//
// Keys are the ＋ menu's entry ids: a part type (`code`, `classify`) or a preset (`svg`,
// `write-code`), because "a p5.js sketch" and "an SVG" are the same part type with different jobs.

import { presetOf } from '../../graph/parts/creative.mjs';
import { BRING } from './bring.mjs';
import { THINK } from './think.mjs';
import { SHOW } from './show.mjs';
import { CONTROL } from './control.mjs';

/**
 * @typedef {{
 *   key: string, title: string, needsFarm?: string,
 *   what: string, inputs: string[][], output: string, howto: string[],
 *   parts: any[], wires: any[],
 * }} BoxExample
 */

/** Every example, in ＋ menu order. @type {ReadonlyArray<BoxExample>} */
export const EXAMPLES = Object.freeze([...BRING, ...THINK, ...SHOW, ...CONTROL]);

/** @param {string} key @returns {BoxExample|null} */
export function exampleByKey(key) {
  return EXAMPLES.find((x) => x.key === key) || null;
}

/** Which example a placed box asks for: its preset (an SVG box, "Write code"), else its type.
 * @param {{type: string, settings?: any}} part @returns {string} */
export function exampleKeyOf(part) {
  return presetOf(part) || String(part && part.type);
}

const STICKY_W = 380;
const SETUP_X = 460;
const TOP = 130;

/** The words on the Sticky: what it does, its ports, its output, how to use it. @param {BoxExample} ex */
export function exampleText(ex) {
  const lines = ['What it does', ex.what, ''];
  if (ex.inputs.length) {
    lines.push('Inputs');
    for (const [port, words] of ex.inputs) lines.push(`• ${port} — ${words}`);
  } else lines.push('Inputs: none — it brings something in.');
  lines.push('', 'Output', ex.output, '', 'How to use it');
  for (const h of ex.howto) lines.push(`• ${h}`);
  if (ex.needsFarm) lines.push('', `Needs the farm: ${ex.needsFarm}`);
  return lines.join('\n');
}

/**
 * The graph the ? opens: Title, Sticky, then the setup shifted right of the Sticky. The view zoom is
 * the largest that shows it all on a 1000 × 705 canvas (the size the lessons are fitted to).
 * @param {BoxExample} ex @returns {any}
 */
export function exampleDoc(ex) {
  const text = exampleText(ex);
  const stickyH = Math.max(420, 60 + text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 44)), 0) * 19);
  const parts = [
    { id: 'x_title', type: 'title', x: 40, y: 24, w: 820, h: 90, settings: { text: `Example — ${ex.title}`, size: 'l' } },
    { id: 'x_about', type: 'sticky', x: 40, y: TOP, w: STICKY_W, h: stickyH, settings: { colour: 'yellow', text } },
    ...ex.parts.map((p) => ({ ...p, x: p.x + SETUP_X, y: p.y + TOP })),
  ];
  const right = Math.max(...parts.map((p) => p.x + p.w));
  const bottom = Math.max(...parts.map((p) => p.y + p.h));
  const zoom = Math.max(0.3, Math.floor(Math.min(1, 1000 / (right + 40), 705 / (bottom + 30)) * 20) / 20);
  return { lolgraph: 2, title: `Example — ${ex.title}`, view: { x: 16, y: 8, zoom }, parts, wires: ex.wires.map((w) => ({ ...w })) };
}
