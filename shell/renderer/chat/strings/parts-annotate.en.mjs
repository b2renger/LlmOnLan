// @ts-check
// K4-U4's strings: the three annotation parts (COMPUTER_PLAN §6.7). One file per K4 unit; see
// strings/parts-text.en.mjs for why.
//
// The five sticky TINTS are named for what they are in THIS palette, not for a colour the palette
// does not have. §9's honest constraint: tokens.css makes `--blue` byte-identical to `--accent`
// and to a grey in both themes, so a tint called "Blue" would be a lie a reader can see. The five
// below map 1:1 onto --sticky-1..5 in css/computer-look.css.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  stickyLabel: 'Sticky',
  stickyHint: 'A note for the reader. Double-click to write in it. It never runs and never costs anything.',
  stickyPlaceholder: 'Say what this bit does…',
  stickyColour: 'Colour',
  stickyTintYellow: 'Yellow',
  stickyTintGreen: 'Green',
  stickyTintRose: 'Rose',
  stickyTintSlate: 'Slate',
  stickyTintPlain: 'Plain',

  sectionLabel: 'Section',
  sectionHint: 'A labelled region. Lay the boxes of one idea inside it. It never runs.',
  sectionPlaceholder: 'Name this part of the canvas…',

  titleLabel: 'Title',
  titleHint: 'Big words written on the canvas. It never runs.',
  titlePlaceholder: 'Write a heading…',
  titleSize: 'Size',
  titleSizeS: 'Small',
  titleSizeM: 'Medium',
  titleSizeL: 'Large',

  annotateInert: 'A note on the canvas — never runs, never costs a generation',
});
