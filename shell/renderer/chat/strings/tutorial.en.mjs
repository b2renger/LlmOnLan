// @ts-check
// K5-U3's strings: the tutorial's CHROME — the Learn shelf, the step rail, the demo-answer offer and
// the run bar's `?` card (COMPUTER_PLAN §10.1, §10.2, §8.5; addendum KE-5, KE-6). One strings file
// per K5 unit (KE-9). A lesson's own prose (title, step text) is DATA inside its module, not a key
// here: a lesson is authored on the canvas and round-tripped whole (§10.1 mechanism 5).
import { registerStrings } from '../core/i18n.mjs';

registerStrings('tutorial', {
  // ---- the Learn shelf (library sidebar) ----
  learn: 'Learn',
  learnHint: 'Lessons and templates: learn the Computer by building with it.',
  learnCount: '{lessons} lessons · {templates} templates',
  shelfLessons: 'Lessons',
  shelfTemplates: 'Templates',
  lessonTitle: 'Lesson {n} — {title}',
  lessonRow: '{n}. {title}',
  tourTitle: 'The tour',
  minutes: '{n} min',
  chipOffline: 'works offline',
  chipFarm: 'needs the farm',
  progressNew: 'not started',
  progressSome: '{done} of {n} steps',
  progressDone: 'done',
  templateMeta: '~{n} generations',
  templateOpened: 'Opened “{title}” as a new graph in your library. Change anything: the original stays on the shelf.',

  // ---- the step rail ----
  stepOf: 'Step {i} of {n}',
  ticks: '{done} of {n} steps done',
  showMe: 'Show me',
  showMeHint: 'Point at the box this step is about',
  showMenuHint: 'Open the menu with the right row picked out',
  putBack: 'Put it back',
  putBackHint: 'This box was deleted. Put it back where the lesson had it.',
  gotIt: 'Got it',
  collapse: 'Fold the steps away',
  expand: 'Show the steps',
  pill: 'Step {i} of {n} · {title}',
  pillDone: '{title} · done',
  reset: 'Reset lesson',
  resetAsk: 'Put this lesson back the way it shipped? Your changes to it are lost (Undo brings them back).',
  resetDone: 'The lesson is back the way it shipped.',
  close: 'Hide the steps',
  done: 'Lesson complete.',
  doneIdea: 'The idea: {idea}',
  next: 'Next: {title}',
  lastLesson: 'That is every lesson in this version. A template is a good next step.',
  openTemplates: 'Open a template',
  farmAbsent: 'No farm is connected. You can still finish this lesson: when a box cannot get an answer, use the saved one.',

  // ---- never a dead end (§10.2) ----
  demoOffer: 'The farm could not answer “{part}”. Continue with the lesson’s saved answer?',
  demoUse: 'Use the saved answer',
  demoTicked: 'done with the saved answer — not generated',
  demoNoteOne: 'One box shows the lesson’s saved answer. It is marked “demo answer — not generated”.',
  demoNoteMany: '{n} boxes show the lesson’s saved answers. Each is marked “demo answer — not generated”.',

  notShipped: 'That lesson is not in this version yet.',

  // ---- the run bar's ? card (§8.5) ----
  explainTitle: 'What is this?',
  explainBody: 'Each box does one thing; the arrows carry what it made to the next box. Press ▶ on a box to run it, or Run to run everything. The Learn shelf in the sidebar has lessons that build a graph with you.',
  explainLesson: 'This lesson: {idea}',
  explainTour: 'Take the tour',
  explainLearn: 'Lessons and templates',
  explainClose: 'Close',
});
