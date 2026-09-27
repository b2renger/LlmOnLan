// @ts-check
// The shelf: which lessons and templates this build ships (COMPUTER_PLAN §10; addendum KE-4).
// K5-U4 owns this file. A LEAF with no loader row: computer/tutorial/rail.mjs static-imports it,
// and chat-lint rule 15 imports it in Node to validate every lesson and template.
//
// Order is shelf order. `next` in a lesson must name a lesson listed here, or be absent on the last
// one (rule 15). Adding a lesson is: write `lessons/NN-slug.mjs`, import it here, list it. The Tour
// (`lessons/00-tour.mjs`) is K5-U3's file; this registry only lists it.
//
// The curriculum this build (KE-4): the Tour (no farm), 1 hello, farm · 2 wires carry values ·
// 3 arrow labels are names (tldraw's hello world / building a graph / arrow labels, in spirit) ·
// 4 make a picture (Write an SVG → SVG, the owner's ask). §10.3's "many in, many out" is taught by
// the Research → problematic template; its later lessons shift by one when they are written.
// computer-lessons.test.mjs walks every lesson to its last tick, with and without the farm.

import tour from './lessons/00-tour.mjs';
import l01 from './lessons/01-hello-farm.mjs';
import l02 from './lessons/02-wires.mjs';
import l03 from './lessons/03-labels.mjs';
import l04 from './lessons/04-draw.mjs';
import researchProblematic from '../templates/research-problematic.mjs';
import creativeCoding from '../templates/creative-coding.mjs';

/** @typedef {import('../../core/types.mjs').Lesson} Lesson */
/** @typedef {import('../../core/types.mjs').Template} Template */

/** @type {readonly Lesson[]} */
export const LESSONS = Object.freeze(/** @type {any[]} */ ([tour, l01, l02, l03, l04]));

/** @type {readonly Template[]} */
export const TEMPLATES = Object.freeze(/** @type {any[]} */ ([researchProblematic, creativeCoding]));

/** @param {string} id @returns {Lesson|null} */
export function lessonById(id) {
  return LESSONS.find((l) => l.id === id) || null;
}

/** @param {string} id @returns {Template|null} */
export function templateById(id) {
  return TEMPLATES.find((x) => x.id === id) || null;
}
