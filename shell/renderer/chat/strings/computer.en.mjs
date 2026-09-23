// @ts-check
// Strings for the Computer SURFACE: the loader, the library sidebar, the run bar, the drawer and
// the surface's own errors (COMPUTER_PLAN §1.2). One namespace per area, and `computer.*` is it —
// part labels stay in `parts.*`, the canvas and its wire refusals stay in `graph.*`, and the
// lessons get `lessons.*` at K5.
//
// Ownership inside the namespace, so two units never contend (integrator-owned file; a unit that
// needs a new key asks for it and the integrator adds it at the next kickoff):
//   computer.loader*      integrator (computer/main.mjs)
//   computer.lib*         K1-U2 (computer/library.mjs)
//   computer.migrate*     K1-U2 (computer/migrate.mjs)
//   computer.run*         K1-U3 (computer/runbar.mjs)
//   computer.drawer*      K1-U3 (computer/drawer.mjs)
//   computer.tx*          K2-U3 (computer/transcript.mjs)
import { registerStrings } from '../core/i18n.mjs';

registerStrings('computer', {
  // ---- the loader (integrator) ---------------------------------------------------------------
  surface: 'Computer',
  loaderFailed: 'Part of the Computer failed to load ({key}) — see the developer console.',

  // ---- the library sidebar (K1-U2) -----------------------------------------------------------
  libTitle: 'Graphs',
  libNew: 'New',
  libSearch: 'Search graphs',
  libEmpty: 'No graphs yet. Press New to start one.',
  libNoMatch: 'No graph matches “{q}”.',
  libUntitled: 'Untitled graph',
  libParts: '{n} parts',
  libPartsOne: '1 part',
  libNeverRun: 'never run',
  libLastRun: 'last run {when}',
  libRename: 'Rename',
  libDuplicate: 'Duplicate',
  libDuplicateTitle: '{title} (copy)',
  libDelete: 'Delete',
  libDeleteAsk: 'Delete “{title}”? This cannot be undone — export it first if you want to keep it.',
  libDeleteConfirm: 'Delete',
  libExport: 'Export…',
  libExportValues: 'Include results',
  libImport: 'Import…',
  libImportFailed: 'That file is not a graph this Computer can open.',
  libImportNewer: 'This graph was made with a newer version of the Computer. Update LlmOnLan and open it again — nothing has been changed.',

  // ---- the migration (K1-U2) -----------------------------------------------------------------
  migrateDone: 'Brought {n} graphs over from your chats.',
  migrateDoneOne: 'Brought one graph over from your chats.',
  migrateFromThread: 'From: {title}',
  migrateFromThreadUnknown: 'From a deleted chat',
  migrateStranded: '{n} graphs could not be brought over from your chats. They are still there — reopen the Computer to try again.',
  migrateStrandedOne: 'One graph could not be brought over from your chats. It is still there — reopen the Computer to try again.',

  // ---- the run bar (K1-U3) -------------------------------------------------------------------
  runAll: 'Run all',
  runStop: 'Stop',
  runParts: '{n} parts',
  runPartsOne: '1 part',
  runGenerations: '{n} generations',
  runGenerationsOne: '1 generation',
  runZoom: '{percent}%',
  runHelp: 'What is this?',
  runNothing: 'Nothing to run — every box is up to date.',

  // ---- the drawer (K1-U3) --------------------------------------------------------------------
  drawerClose: 'Close',
  drawerEmpty: 'Click a value on the canvas to read it here.',

  // ---- the transcript (K2-U3, COMPUTER_PLAN §8.1) ---------------------------------------------
  // Three tabs on one thinking part: what WILL be sent (before a run, and for free), what came
  // back verbatim, and what it cost. Namespace `computer.tx*` is K2-U3's alone.
  txTitle: 'What gets sent',
  txSent: 'Sent',
  txGot: 'Got',
  txCost: 'Cost',
  txSentEmpty: 'Nothing is wired into this box yet, and it has no instruction.',
  txGotEmpty: 'This box has not run yet. Open Sent to read the prompt before you spend a generation.',
  txCostEmpty: 'No run to cost yet.',
  txSystem: 'System',
  txInstruction: 'Instruction',
  txParams: 'model: {model} · response_format: {format} · max_tokens: {maxTokens} · priority: {priority}',
  txParamsAuto: 'automatic',
  txLadderSchema: 'asked with schema',
  txLadderProse: 'model returned prose with a fenced object',
  txLadderExtract: 'extracted',
  txLadderValid: 'validated ✓',
  txLadderFailed: 'could not be validated',
  txCostLine: '{seconds} s · {tokens} tokens · {cached} · farm: {farm}',
  txCached: 'cached',
  txNotCached: 'not cached',
  txUnknownFarm: 'no farm',

  // ---- legacy parts, demoted at K1 (K1-U3) ---------------------------------------------------
  legacyBadge: 'legacy',
  legacyNoThread: 'This part belonged to a chat. The Computer is its own surface now — delete it, or copy the text into a Note.',
});
