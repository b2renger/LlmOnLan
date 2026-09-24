// @ts-check
// K6-U3's strings: what a file dropped on the canvas becomes (addendum KF-7). Keys frozen BY NAME:
// `drops.hint`, `drops.refusedKind`, `drops.refusedNoDoc`; K6-U3 owns the words. A file the
// Computer does not use is REFUSED WITH A SENTENCE — never dropped silently (build rule 6).
import { registerStrings } from '../core/i18n.mjs';

registerStrings('drops', {
  hint: 'Drop a picture, a PDF, a sound file, a text file — or a .lolgraph.json to open it',
  refusedKind: 'The Computer cannot use “{name}” ({type}). Drop a picture, a PDF, a sound file, or a text file (.txt, .md, .csv, .json).',
  refusedNoDoc: 'Open or create a graph first, then drop “{name}” on it.',
  typeUnknown: 'a file of unknown type',
  tooMany: '{n} files were dropped; the Computer takes {max} at a time, so the first {max} were used. Drop the rest again.',
  textTooBig: '“{name}” is {kb} KB, over the {capKb} KB a Text box holds. Split it, or keep it as a file in a project folder.',
  notText: '“{name}” is not plain text (it has binary bytes in it), so it was not put in a Text box.',
  unreadable: '“{name}” could not be read.',
  oneGraph: '“{name}” is a second graph file. One graph opens at a time — drop it again on its own.',
  noGraphDoor: '“{name}” is a graph file, and this canvas cannot open one right now.',
  cannotKeep: 'This build of the Computer cannot keep “{name}”.',
  notPlaced: '“{name}” could not be placed on the canvas.',
  refusedMore: '{n} more files were not used.',
});
