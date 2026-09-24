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

  // A very long arrival is rendered down to its first {kb} KB — the box scrolls, but a megabyte of
  // markdown is most of a second of main-thread work per run. The WHOLE value still goes
  // downstream and is still what Save… writes.
  textTruncated: 'Showing the first {kb} KB — the whole text still passes on, and Save… writes all of it.',

  // Critic R1 A6/A7: the ways in to a box that is SHOWING text, and the way its words out.
  textEdit: '✎ Edit',
  textEditHint: 'Edit this text (or double-click it, or select the box and press Enter)',
  textCopy: 'Copy',
  textCopyHint: 'Copy this text',
  textCopied: 'Copied',
  textCopyFailed: 'Could not copy',
  // The first keystroke on a box something is wired into locks it, so the next run cannot put the
  // arrival back over the edit. The box says so once, plainly, and how to undo it.
  textAutoLocked: 'Locked so the next run keeps your edit. Press Lock again to take what arrives.',
});
