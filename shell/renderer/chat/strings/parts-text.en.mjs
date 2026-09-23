// @ts-check
// K4-U1's strings: the Text part (COMPUTER_PLAN §6.2, amended by the K4 kickoff addendum KD-4).
//
// A SEPARATE FILE in the SAME namespace. `registerStrings` merges (core/i18n.mjs), and the four
// K4 units all decorate `parts.*` — one file each is what keeps four builders off one file. A
// unit may add keys to ITS OWN file and to no other; `strings/parts.en.mjs` (C1/K2/K3's keys) is
// frozen for this phase.
//
// `parts.note*` stays in parts.en.mjs and stays REGISTERED: the type id is still `note`, and a
// string a stored graph never reads is cheaper than a migration.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  // The box itself. tldraw calls it Text and so does the owner ("text boxes with input and
  // output"); the TYPE ID is still `note`, so every stored graph, every fixture and every test
  // that says `type:'note'` keeps working.
  textLabel: 'Text',
  textPlaceholder: 'Write something…',

  // The port. Its `accepts` is text/json/list, so the wire refusal for an image or a file is the
  // canvas's standard one and names this label.
  textIn: 'text',

  // What a received value looks like, and how to get your own words back (§6.2).
  textFromInput: 'from input',
  textClear: '↺ Clear',
  textClearHint: 'Show what you typed instead of what arrived',
  textEditing: 'editing',

  // The lock — "keep what I typed" (§6.2, reference capture §3 lesson 1: it "prevents a text
  // block's text from changing").
  textLock: 'Lock',
  textLockOn: 'Locked — what arrives will not replace this',
  textLockOff: 'Unlocked — what arrives replaces this',
  textLocked: 'locked',

  // Why a run left the box alone. Quiet, one line, and never an error: nothing went wrong.
  textRefused: 'Locked, so what arrived was not used.',
  textRefusedUnsaved: 'You were typing, so this box kept your words.',
});
