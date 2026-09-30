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
//   computer.dropSwitched, computer.pasteSwitched   critic R1 Package C (drops.mjs, intake.mjs)
import { registerStrings } from '../core/i18n.mjs';

registerStrings('computer', {
  // ---- the loader (integrator) ---------------------------------------------------------------
  surface: 'Computer',
  loaderFailed: 'Part of the Computer did not load ({key}), so some of it may not work. Restart LlmOnLan to try again.',

  // ---- the library sidebar (K1-U2) -----------------------------------------------------------
  libTitle: 'Graphs',
  libNew: 'New',
  libNewHint: 'Start a new, empty graph',
  libSearch: 'Search graphs',
  libSearchHint: 'Find a graph by its title',
  libEmpty: 'No graphs yet. Press New to start one, or open a lesson or a template from Learn.',
  libNoMatch: 'No graph title has “{q}” in it. Clear the search to see every graph.',
  libUntitled: 'Untitled graph',
  libOpenHint: 'Open this graph. Double-click to rename it.',
  libGripHint: 'Drag to make the list wider or narrower',
  libParts: '{n} boxes',
  libPartsOne: '1 box',
  libNeverRun: 'never run',
  libLastRun: 'last run {when}',
  libRename: 'Rename',
  libRenameHint: 'Give this graph a new name',
  libRenameKeys: 'Type the new name. Enter keeps it, Esc cancels.',
  libDuplicate: 'Duplicate',
  libDuplicateHint: 'Make a copy of this graph, answers included',
  libDuplicateTitle: '{title} (copy)',
  libDelete: 'Delete',
  libDeleteHint: 'Delete this graph from this computer (it asks first)',
  libDeleteAsk: 'Delete “{title}”? This cannot be undone — export it first if you want to keep it.',
  libDeleteConfirm: 'Delete',
  libExport: 'Export…',
  libExportHint: 'Save this graph as a .lolgraph.json file, to keep or to share',
  libExportValues: 'Include results',
  libImport: 'Import…',
  libImportFailed: 'That file is not a graph this Computer can open. Pick a .lolgraph.json file (the kind Export… saves).',
  libImportNewer: 'This graph was made with a newer version of the Computer. Update LlmOnLan and open it again — nothing has been changed.',

  // ---- the migration (K1-U2) -----------------------------------------------------------------
  migrateFromThread: 'From: {title}',
  migrateFromThreadUnknown: 'From a deleted chat',
  migrateStranded: '{n} graphs could not be brought over from your chats. They are still there — restart LlmOnLan to try again.',
  migrateStrandedOne: 'One graph could not be brought over from your chats. It is still there — restart LlmOnLan to try again.',

  // ---- the run bar (K1-U3) -------------------------------------------------------------------
  runAll: 'Run all',
  runAllHint: 'Run every box that is not up to date (Ctrl+Enter). Finished boxes keep their answers and are not asked again.',
  runStop: 'Stop',
  runStopHint: 'Stop the run (Esc). Finished boxes keep their answers.',
  runParts: '{n} boxes',
  runPartsOne: '1 box',
  runPartsHint: 'Before a run: the boxes on the canvas. After a run: how many boxes ran.',
  runGenerations: '{n} generations',
  runGenerationsOne: '1 generation',
  runGensHint: 'A generation is one answer written by the farm’s model. Before a run: how many the next run may ask for (a range when the graph has a loop). After a run: how many it asked for.',
  runCapHint: 'Generations used, out of the Cap: the most model answers one run may ask for (amber past 80 %). Set the Cap in the canvas toolbar.',
  runHelp: 'What is this?',
  runNothing: 'Nothing to run — every box is up to date.',

  // ---- the drawer (K1-U3) --------------------------------------------------------------------
  drawerLabel: 'Side panel: a result, what a box sent, or its code',
  drawerClose: 'Close',
  drawerCloseHint: 'Close this panel (Esc)',
  drawerGripHint: 'Drag to make this panel wider or narrower',
  drawerEmpty: 'Click the result at the foot of a box to read it here.',

  // ---- the transcript (K2-U3, COMPUTER_PLAN §8.1) ---------------------------------------------
  // Three tabs on one thinking part: what WILL be sent (before a run, and for free), what came
  // back verbatim, and what it cost. Namespace `computer.tx*` is K2-U3's alone.
  txTitle: 'What gets sent',
  txSent: 'Sent',
  txSentHint: 'The prompt, word for word, as it goes to the farm. You can read it before a run: it costs nothing.',
  txGot: 'Got',
  txGotHint: 'The model’s answer, word for word',
  txCost: 'Cost',
  txCostHint: 'How long the answer took, how many tokens it used, and which farm wrote it',
  txSentEmpty: 'Nothing is wired into this box yet, and it has no instruction. Type an instruction in the box, or wire something into it.',
  txGotEmpty: 'This box has not run yet. Press ▶ on it to ask the farm; Sent shows the prompt first, for free.',
  txCostEmpty: 'This box has not run yet, so it has cost nothing.',
  txSystem: 'System message',
  txInstruction: 'Instruction',
  txParamsAuto: 'automatic',
  txLadderSchema: 'asked for JSON of a set shape',
  txLadderProse: 'the model wrapped the JSON in words',
  txLadderExtract: 'the JSON was taken out',
  txLadderValid: 'it fits the shape ✓',
  txLadderFailed: 'it does not fit the shape',
  txCostLine: '{seconds} s · {tokens} tokens · {cached} · farm: {farm}',
  txCached: 'answer reused, nothing sent',
  txNotCached: 'new answer',
  txUnknownFarm: 'no farm',

  // ---- K3: the scheduler, the ceilings, the waits and the journal (§4.6, §7.5, §8.3) ----------
  // Ownership: `computer.run*` stays K1-U3's file (computer/runbar.mjs), extended by K3-U3;
  // `computer.limit*` and `computer.resume*` are read by K3-U1's report and K3-U3's bar alike.
  // The rule §4.6 insists on: a ceiling is a STOP, never an error, and every sentence says what
  // was kept and offers the one button that raises it for this run.
  runRange: '{min}–{max} generations',
  // v0.2.3 review: a Timer waits too (control-bus park), so the count says boxes, not questions.
  runWaiting: '{n} boxes waiting',
  runWaitingOne: '1 box waiting',
  runWaitFor: 'Waiting on the {part} box',
  runShowWaiting: 'Show me',
  runShowWaitingHint: 'Go to the box that has waited longest: a question for you, or a Timer',
  runBarred: '{n} boxes were skipped: a box before them closed the way (the grey arrows)',
  runBarredOne: '1 box was skipped: a box before it closed the way (the grey arrow)',
  runLeftStale: 'boxes changed during the run: {n} — Run all again to update them',
  runMerged: 'Added to the run.',
  // Critic S1-1: what a finished run SAYS — one sentence, the same in the bar and the live region
  // (computer/runbar.mjs outcomeOf). A yield is not "up to date": it says why nothing was sent.
  runOutcomeHidden: 'Paused: this window was in the background, so nothing was sent to the farm. Press Run all to carry on.',
  runOutcomeBusy: 'Paused: the farm was busy with someone else. Press Run all to carry on.',
  runOutcomeAlready: 'A run is already going. Wait for it, or press Stop.',
  runOutcomeStopped: 'Stopped. Finished boxes kept their answers.',
  runOutcomeCycle: 'This graph has a loop with nothing to stop it, so it cannot run. Put a Toggle, a Condition or a Button in the loop.',
  runOutcomeErrors: '{n} boxes failed — each one says why.',
  runOutcomeErrorsOne: '1 box failed — it says why.',
  runOutcomeCapped: 'Stopped at the Cap of {cap} generations, {n} boxes still to run. Raise the Cap to finish them.',
  runOutcomeCappedItems: 'Stopped: one box would run {items} times, over the Cap of {cap}. Raise the Cap, or send it fewer items.',
  runOutcomeLimited: 'Stopped at one of this run’s limits. Nothing was lost.',
  runOutcomePlanned: 'Nothing ran: its Timers would take longer than this run’s time limit.',
  runOutcomeDone: '{n} boxes ran in {sec}s.',
  runOutcomeDoneOne: '1 box ran in {sec}s.',
  // Critic S2-2: a box behind a Button nobody pressed is waiting for a press, not "up to date".
  // {button} is what the Button's face reads.
  runOutcomeHeld: 'Waiting for a press: press “{button}” to run the {n} boxes after it.',
  runOutcomeHeldOne: 'Waiting for a press: press “{button}” to run the box after it.',
  runFrom: 'Run this box',
  runPlayTitle: 'Run this box and everything after it',
  boxHelpTitle: 'Example: what this box does, its inputs and output, and how to use it',

  limitIterations: 'This run reached its limit of {limit} passes through “{part}”. Nothing was lost.',
  limitGenerations: 'This run reached its limit of {limit} generations. Nothing was lost.',
  limitWall: 'The run stopped at its time limit of {minutes} minutes. Nothing was lost.',
  limitWallPark: 'Nobody answered the question in “{part}”, so the run stopped after {minutes} minutes.',
  limitActivations: 'This run reached its limit of {limit} steps. Nothing was lost.',
  limitTimerPlan: 'That run would wait {minutes} minutes before it finished — longer than the {limitMinutes} minute limit. Shorten a Timer, or raise the limit for this run.',
  limitRaise: 'Raise it for this run',
  limitShowSpend: 'Show me what spent it',

  resumeBanner: 'The last run stopped when the app closed — {done} of {total} boxes finished. Resume runs only the rest.',
  resumeAction: 'Resume',
  resumeActionHint: 'Run the boxes that did not finish. The finished ones keep their answers and are not asked again.',
  // v0.2.3 review: it was "Start fresh", but it resets nothing — it only closes the offer for good.
  resumeDismiss: 'Dismiss',
  resumeDismissHint: 'Hide this for good. Nothing runs and nothing is deleted: Run all finishes the other boxes whenever you like.',

  // Critic S2-5: the canvas (sayLoopUngated) draws the loopLesson button only when the Learn shelf
  // has the loops lesson, and then it opens that lesson — so its label says what the click does.
  // The gate boxes named are graph/topo.mjs GATE_TYPES' commonest; lesson 6 builds one with a Toggle.
  loopUngated: 'A loop needs a box that can stop it. Put a Toggle, a Condition or a Button in the loop.',
  loopLesson: 'Open lesson 6 · a loop that stops',

  // ---- legacy parts, demoted at K1 (K1-U3) ---------------------------------------------------
  legacyBadge: 'legacy',
  legacyNoThread: 'This box belonged to a chat. The Computer is its own surface now — delete it, or copy the text into a Text box.',

  // ---- K5 kickoff (addendum KE-7): a lesson's recorded answer, badged for good ----------------
  demoBadge: 'demo answer — not generated',
  demoBadgeHint: 'This is the lesson’s saved answer, put here because the farm could not answer. Run the box again to ask the farm.',

  // ---- K7 (addendum KG): the debug-log switch, computer/recorder.mjs --------------------------
  recOff: 'Record log',
  recOn: 'Recording · {n} events',
  recOffHint: 'Record what you do here, every run and every error, into a log file in the LlmOnLan logs folder on this computer — to hand over with a bug report. It starts with what happened just before you pressed it, and keeps recording after a restart until you press it again. What you type and what is sent to the farm go in the file; passwords and keys never do. While it records, press Mark bug when something goes wrong.',
  recOnHint: 'Recording to {name}. Press to stop. When something goes wrong, press Mark bug.',
  recStarting: 'Starting…',
  recMark: 'Mark bug',
  recMarkHint: 'Put a marker in the log right now, with a screenshot and a snapshot of this graph, and say in a sentence what went wrong.',
  recMarkTitle: 'What went wrong?',
  recMarkBody: 'A screenshot and a snapshot of the graph are already in the log. One sentence about what you expected helps the most.',
  recMarkPlaceholder: 'e.g. the wire disappeared when I undid the move',
  recMarkOk: 'Save marker',
  recMarked: 'Marker {i} saved in the log.',
  recFolder: 'Show log files',
  recFolderHint: 'Open the folder with the log files, with the latest one selected.',
  recStarted: 'Recording to {name}.',
  recSaved: 'Log saved: {name}',
  recSavedPartial: 'Log saved as {name}, but {n} batch(es) of lines could not be written to it.',
  recStopFailed: 'The log could not be closed properly: {message}',
  recMarkFailed: 'The marker could not be written to the log. Press Mark bug again.',
  recFull: 'The log reached its size limit (25 MB) and stopped. It is saved as {name}. Press Record log to start a new one.',
  recFailed: 'Could not start the log: {message}. Press Record log to try again.',

  // ---- a drop or a paste that finished after a graph switch (critic R1 B17, Package C) ------
  // A big file takes a moment to read; the boxes it makes belong to the graph it was dropped on.
  dropSwitched: '“{name}” was read after you switched graphs, so it was not placed. Drop it again on this graph.',
  pasteSwitched: '“{name}” was read after you switched graphs, so it was not pasted. Paste it again here.',
});
