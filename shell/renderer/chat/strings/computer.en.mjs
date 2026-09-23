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

  // ---- K3: the scheduler, the ceilings, the waits and the journal (§4.6, §7.5, §8.3) ----------
  // Ownership: `computer.run*` stays K1-U3's file (computer/runbar.mjs), extended by K3-U3;
  // `computer.limit*` and `computer.resume*` are read by K3-U1's report and K3-U3's bar alike.
  // The rule §4.6 insists on: a ceiling is a STOP, never an error, and every sentence says what
  // was kept and offers the one button that raises it for this run.
  runRange: '{min}–{max} generations',
  runWaiting: '{n} questions waiting',
  runWaitingOne: '1 question waiting',
  runWaitFor: 'Waiting for {part}',
  runShowWaiting: 'Show me',
  runBarred: '{n} boxes were stopped by a gate',
  runBarredOne: '1 box was stopped by a gate',
  runLeftStale: 'left stale by edits: {n}',
  runMerged: 'Added to the run.',
  runFrom: 'Run this box',
  runPlayTitle: 'Run this box and everything after it',

  limitIterations: 'This run reached its limit of {limit} passes through “{part}”. Nothing was lost.',
  limitGenerations: 'This run reached its limit of {limit} generations. Nothing was lost.',
  limitWall: 'The run stopped after {minutes} minutes.',
  limitWallPark: 'Nobody answered the question in “{part}”, so the run stopped after {minutes} minutes.',
  limitActivations: 'This run reached its limit of {limit} steps. Nothing was lost.',
  limitTimerPlan: 'That run would wait {minutes} minutes before it finished — longer than the {limitMinutes} minute limit. Shorten a Timer, or raise the limit for this run.',
  limitRaise: 'Raise it for this run',
  limitShowSpend: 'Show me what spent it',

  resumeBanner: 'The last run stopped when the app closed — {done} of {total} boxes finished.',
  resumeAction: 'Resume',
  resumeDismiss: 'Start fresh',

  loopUngated: 'A loop needs something that can stop it. Put a Toggle in the way — see lesson 10.',
  loopLesson: 'Open lesson 10',

  // ---- legacy parts, demoted at K1 (K1-U3) ---------------------------------------------------
  legacyBadge: 'legacy',
  legacyNoThread: 'This part belonged to a chat. The Computer is its own surface now — delete it, or copy the text into a Note.',
});
