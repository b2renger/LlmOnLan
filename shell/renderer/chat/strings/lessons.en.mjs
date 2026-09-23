// @ts-check
// K5-U4's strings (addendum KE-9). Lesson and template PROSE is data inside each module (a lesson
// is authored on the canvas and round-tripped whole, COMPUTER_PLAN §10.1 mechanism 5), so this file
// holds only what is said ABOUT the shelf. K5-U4 owns the wording and may add keys; the tutorial's
// chrome (the rail, the chips, the buttons) is `tutorial.*`, K5-U3's.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('lessons', {
  shelfNote: '{lessons} lessons · {templates} templates · your graphs stay in this app',
  lessonsBlurb: 'Build a small graph with the app watching: each step ticks when you have done it.',
  templatesBlurb: 'Ready-made graphs to open, run and change. Each opens as a new graph in your library.',
  templateCost: 'about {n} generations',
  templateCostOne: 'about 1 generation',
});
