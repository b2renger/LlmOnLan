// @ts-check
// K5-U2's strings: the ＋ menu (grouped, searchable) and the first-run offer on an empty canvas
// (addendum KE-2, KE-6). One strings file per K5 unit (KE-9).
//
// The `desc*` and `group*` keys are FROZEN BY NAME — graph/parts/index.mjs resolves them for the
// nineteen plain parts, so renaming one would blank a row of the menu. K5-U2 owns the WORDING.
// The `kw*` keys are search words for a plain part (graph/palette-menu.mjs `partKeywords`): comma
// separated, never shown, the words a person might type for that box when they are not its name.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('palette', {
  // the five groups, in menu order (COMPUTER_PLAN §6)
  groupBring: 'Bring in',
  groupThink: 'Think',
  groupShow: 'Show',
  groupControl: 'Control',
  groupAnnotate: 'Annotate',
  // one line per plain part: what it DOES, in the reader's words
  descNote: 'A box of text. Type into it, or let an answer land in it.',
  descImage: 'A picture: drop, paste or choose one. The model can look at it.',
  descFile: 'Writes what arrives into a file in this graph’s project folder.',
  descAsk: 'Tells the model what to do with whatever is wired into it.',
  descSplit: 'Cuts text into a list, so each item runs on its own.',
  descFilter: 'Keeps only the items of a list that match.',
  descCollect: 'Joins a list back into one value.',
  descRepeat: 'Runs what comes after it several times, for variations.',
  descPreview: 'Shows whatever arrives, and picks how: markdown, SVG, a web page, three.js or p5.js.',
  descCode: 'Plain JavaScript that runs in the sandbox, on what arrives.',
  descButton: 'Nothing after it runs until you press it.',
  descCondition: 'Sends what arrives down Yes, No or Maybe.',
  descConfirm: 'Stops and asks you OK or Cancel before going on.',
  descDialog: 'Stops and asks you a question; your answer flows on.',
  descToggle: 'A switch: off lets values through without running what follows.',
  descTimer: 'Waits a few seconds, and can repeat.',
  descSticky: 'A coloured note for the reader. Never runs.',
  descSection: 'A labelled region to group the parts of one idea.',
  descTitle: 'Big words on the canvas. Never runs.',
  // search words for the plain parts (never shown)
  kwNote: 'text, words, write, paste, type, input, paragraph, topic',
  kwImage: 'picture, photo, png, jpg, reference, vision, look, see',
  kwFile: 'save, export, disk, folder, output, txt',
  kwAsk: 'prompt, model, llm, ai, generate, question, answer, gemma, chat, instruction',
  kwSplit: 'list, lines, items, divide, each, separate, map',
  kwFilter: 'keep, match, select, where, only, list',
  kwCollect: 'join, merge, combine, gather, reduce, list',
  kwRepeat: 'loop, again, variations, times, many, batch',
  kwPreview: 'render, renderer, view, viewer, display, show, output, visualise, visualize',
  kwCode: 'javascript, js, script, function, program, transform',
  kwButton: 'start, click, press, trigger, go, run',
  kwCondition: 'if, branch, yes, no, maybe, decide, boolean, switch',
  kwConfirm: 'ok, cancel, approve, check, pause',
  kwDialog: 'question, reply, input, form, user',
  kwToggle: 'switch, on, off, gate, enable',
  kwTimer: 'wait, delay, interval, seconds, clock, pause',
  kwSticky: 'note, comment, memo, annotation, postit',
  kwSection: 'group, frame, region, area',
  kwTitle: 'heading, header, label, big',
  // the menu's own chrome
  menuLabel: 'Add a box',
  searchPlaceholder: 'Search boxes — try “p5”, “picture”, “model”…',
  searchLabel: 'Search the boxes you can add',
  noMatch: 'No box matches “{query}”.',
  noMatchHint: 'Try a word for what it does: picture, list, model, code, wait.',
  footKeys: '↑ ↓ to choose · Enter to add · Esc to close',
  footTip: 'Tip: double-click the canvas to add a box right where you click.',
  // the strip at the top of the unsearched menu: the boxes that draw with code, no farm needed
  quickLabel: 'Draw with code — no farm needed',
  quickHint: 'Add a {name}: {desc}',
  // the first-run offer (KE-6, COMPUTER_PLAN §10.4)
  welcomeTitle: 'The Computer',
  welcomeBody: 'A canvas where you wire small programs out of text, instructions and the model on your farm. Everything you make stays on this machine.',
  welcomeTour: 'Take the tour',
  welcomeTourHint: 'about 90 seconds · no model needed',
  welcomeTemplate: 'Open a template',
  welcomeTemplateHint: 'a working graph to change',
  welcomeAdd: 'Add your first box',
  welcomeAddHint: 'text, instructions, p5.js, SVG…',
  welcomePicks: 'Or start with',
  welcomePickHint: 'Add a {name} to the middle of the canvas',
  welcomeTip: 'Double-click or right-click anywhere on the canvas to add a box right there.',
});
