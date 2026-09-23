// @ts-check
// The part catalogue: the ONE place that knows which part types exist (plan §2.6 BG-5).
//
// C1 shipped three: Note (a literal), Ask (the farm call) and Collect (the join). C2 adds Split,
// Repeat, Filter, From thread and To thread; C3 adds Code, Render, File — and Image/Look, which
// wait on P3's attachment intake (BH-10). A new part
// is a new file next to these plus one row in `partSpecs()` — nothing else in the Computer knows a
// part type by name, which is the property that keeps C2 and C3 from touching the engine.
//
// The strings file is imported HERE, before any spec is built, because `PartSpec.label` is resolved
// through `t()` at module load (BG-5).

import '../../strings/parts.en.mjs';
// K4 kickoff (COMPUTER_PLAN §6.2 + addendum KD-1): C1's `note.mjs` is GONE and `text.mjs` takes
// its row. THE TYPE ID IS STILL `note` — every stored graph, every fixture and every test that
// says `type:'note'` keeps working; what changes is the file, the label ("Text") and, when K4-U1
// lands it, the input port that lets an Instruction's answer land in a box you can read.
import { textPart } from './text.mjs';
// K2 landing (COMPUTER_PLAN §11 K2): the C1 `ask.mjs` is GONE and `instruction.mjs` takes its
// row. The type id is still `ask`, so every stored graph keeps loading; what changed is the file,
// the label, the single `in` port and the prompt assembly (graph/bind.mjs). The C1 port name
// `context` is carried across by `PORT_ALIASES` in graph/model.mjs, so an existing document's
// wires survive the swap.
import { instruction } from './instruction.mjs';
import { collect } from './collect.mjs';
// C2 (§2.6 BH-1): the fan-out family and the two bridges to the conversation. The rows are here
// from the C2 kickoff so no two builders contend for this file; C2-U3 replaces each part FILE
// wholesale (BH-9), never this catalogue.
import { splitPart } from './split.mjs';
import { repeat } from './repeat.mjs';
import { filter } from './filter.mjs';
import { fromThread } from './from-thread.mjs';
import { toThread } from './to-thread.mjs';
// C3 (§2.6 BJ): the sandbox parts and the one that leaves the graph. Same rule as C2 — the rows
// are here from the C3 kickoff so no two builders contend for this file; C3-U2 replaces each part
// FILE wholesale, never this catalogue.
import { code } from './code.mjs';
import { render } from './render.mjs';
import { file } from './file.mjs';
// K3 (COMPUTER_PLAN §6.6): the six control parts, which are what turns a canvas of literals and
// generations into an agent canvas. The rows are here from the K3 kickoff so no two builders
// contend for this file; K3-U2 replaces each part FILE wholesale, never this catalogue.
// They sit at the END of the palette on purpose: the nine data parts are what a first-time reader
// meets, and the controls are what lesson 9 onwards adds.
import { button } from './button.mjs';
import { condition } from './condition.mjs';
import { confirm } from './confirm.mjs';
import { dialog } from './dialog.mjs';
import { toggle } from './toggle.mjs';
import { timer } from './timer.mjs';
// K4 (COMPUTER_PLAN §6.4, §6.5, §6.7): the picture, the window onto what was made, and the three
// parts that are there for the READER. Same rule as C2/C3/K3 — the rows are here from the K4
// kickoff so no two builders contend for this file; each unit replaces its part FILE wholesale,
// never this catalogue. `render` leaves the palette for `preview` and stays LEGACY-loadable.
import { image } from './image.mjs';
import { preview } from './preview.mjs';
import { sticky } from './sticky.mjs';
import { section } from './section.mjs';
import { title } from './title.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

/**
 * LEGACY (K1 landing, COMPUTER_PLAN §3.2). `from-thread` and `to-thread` existed to move text
 * between a graph and the conversation that owned it. A library document has no conversation, so
 * the two are OUT of the palette — a reader can no longer place one — but they stay in `specMap()`
 * so a MIGRATED graph that contains one still loads instead of tripping `part:unknown-type`. They
 * render a `legacy` badge and `run()` refuses in one sentence (graph/parts/{from,to}-thread.mjs).
 * K4 kickoff (COMPUTER_PLAN §6.5): `render` joins them. Preview is what a reader places now —
 * markdown and SVG for free, html/three/p5 as a snapshot from the one guest — and C3's Render
 * would be a second, worse door to the same sandbox. It stays in `specMap()` because graphs made
 * in C3 contain one.
 * @type {PartSpec[]}
 */
const LEGACY = [fromThread, toThread, render];

/** The catalogue, in palette order — what the ＋ menu offers. The ＋ menu itself sorts by
 * `spec.order`, so this array is the reading order and `order` is the drawn one.
 * @returns {PartSpec[]} */
export function partSpecs() {
  return [textPart, instruction, splitPart, repeat, filter, code, collect, preview, file, image,
    button, condition, confirm, dialog, toggle, timer,
    sticky, section, title];
}

/** Every type the engine can LOAD: the palette plus the legacy parts. @returns {Map<string, PartSpec>} */
export function specMap() {
  return new Map([...partSpecs(), ...LEGACY].map((s) => [s.type, s]));
}
