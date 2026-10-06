// @ts-check
// Strings for the Computer panel's canvas, toolbar and wire refusals. One namespace per unit
// (§2.6 L / BD-13): `graph.*` belongs to C1-U2. Part labels live in `parts.*` (C1-U3).
import { registerStrings } from '../core/i18n.mjs';

registerStrings('graph', {
  empty: 'Add a box to start: press ＋ Add a box, or double-click the canvas. Wire boxes together, then press Run all.',
  // K1 landing: a graph no longer belongs to a conversation, it belongs to a LIBRARY DOCUMENT.
  // (`noThread` was 'Open a chat to build a program…'; the Computer has no chat to open.)
  // Docs review B-2: the library button reads "New" (computer.libNew), with no ＋.
  noDoc: 'Open a graph from the library, or press New, to start building.',

  // toolbar
  run: 'Run',
  running: 'Running {i}/{n}',
  stop: 'Stop',
  add: '＋ Add a box',
  // Review 2026-09-28: the toolbar's hovers, each with its key where it has one.
  addHint: 'Add a box. You can also double-click or right-click the canvas to add one right where you click.',
  undo: 'Undo',
  undoHint: 'Undo (Ctrl+Z)',
  redo: 'Redo',
  redoHint: 'Redo (Ctrl+Y or Ctrl+Shift+Z)',
  fit: 'Fit',
  zoom: '{percent}%',

  // wire refusals — one per reason code returned by graph/model.mjs addWire() (frozen, §2.6 BG-4).
  // Review 2026-09-28: each says WHY and what to do instead, in box/wire/loop words.
  wireSelf: 'A box cannot feed itself. To run it again on its own result, make a loop through a Toggle or a Condition, which can stop it.',
  // K3 kickoff (COMPUTER_PLAN §4.6): a loop is now LEGAL and declared — `wireCycle` survives for
  // a self-wire and for an old file. What a loop may not be is unstoppable.
  wireCycle: 'That would make a loop with nothing in it that can stop it. Put a Toggle or a Condition inside the loop first.',
  wireLoopUngated: 'That would make a loop with nothing in it that can stop it. Put a Toggle, Condition, Button, Confirm, Dialog or Timer inside the loop, then draw this wire again.',
  // `duplicate` is also what a one-wire input that is already taken answers (graph/model.mjs).
  wireDuplicate: 'That input already has this wire, or it takes only one. To swap it, unplug the old wire first (its ✕).',
  wireNoOutput: '{from} hands nothing on, so no wire can start from it.',
  wireUnknownPort: '{to} has no input there. Drop the wire on a dot on its left edge, or on the box itself.',
  wireType: '{to} cannot take {kind}, which is what {from} hands on. Wire {from} into a box that takes {kind} instead.',
  wireUnknownPart: 'One of those boxes is gone, so the wire was not made.',
  wireRefused: 'That wire cannot go there. Try another input or another box.',
  // What a box hands on, in words (runner.mjs KIND_WORD / kindWord): the {kind} of the sentences
  // above and of parts.errBadInput, never the engine's own kind name.
  kindText: 'text',
  kindImage: 'a picture',
  kindList: 'a list',
  kindJson: 'data (JSON)',
  kindFile: 'a file',
  kindOther: 'something',

  // run reporting. The run bar now speaks for a run (computer.runOutcome*); these three stay
  // registered because c1-landing and k10-run-outcomes still read them.
  runNothing: 'Nothing to run — every box is up to date.',
  // C1 landing: two REAL run outcomes the runner reports that had no sentence of their own and were
  // announcing as runNothing. A yield is not a failure and not a stop — the person took the seat.

  // part states, as the label next to the colour (never colour alone)
  stateIdle: 'Not run',
  stateStale: 'Needs a re-run',
  stateQueued: 'Queued',
  stateRunning: 'Running',
  // K3 kickoff (COMPUTER_PLAN §4.1): PARKED on a human or a clock. `queued` had this word until
  // K3 and had to give it up — "Waiting" is what a person reading a Dialog's question sees, and
  // a box merely standing in line is queued.
  stateWaiting: 'Waiting for you',
  stateDone: 'Done',
  stateError: 'Error',

  // canvas affordances
  canvasLabel: 'Graph canvas',
  valueOpen: 'Show this box’s whole result',
  valueMore: '… {n} more characters',
  portIn: 'Input “{label}”: drop a wire here, from the dot on another box’s right edge',
  portOut: 'Output: drag from this dot to another box to wire them together',
  partAria: '{label} — {state}',
  wireAria: 'Wire from {from} to {to}',

  // ---- K2-U1 (COMPUTER_PLAN §5.1, §8.2): the arrow's name -------------------------------------
  // An arrow's label is not decoration: it is the NAME the instruction below refers to. The
  // placeholder is a plea, not a field name — an unnamed wire is the commonest cause of a mushy
  // answer, and the empty pill is where a reader finds that out.
  wireNameMe: 'name me',
  wireLabelAria: 'Name this arrow',
  // The pill's hover (graph/wires.mjs).
  wireLabelHint: 'Name this arrow: click here, or select the wire and press F2. The box it feeds can use the name to tell its inputs apart.',
  saidWireNamed: 'Arrow named {name}',
  saidWireUnnamed: 'Arrow name cleared',

  // the live region: one line per change
  saidPlaced: '{part} placed',
  saidDeleted: { one: '1 box deleted', other: '{count} boxes deleted' },
  saidWired: '{from} now feeds {to}',
  saidWireDeleted: 'Wire deleted',
  saidSelected: { one: '1 box selected', other: '{count} boxes selected' },
  saidNothingSelected: 'Nothing selected',
  saidMoved: '{part} moved to {x}, {y}',
  saidUndo: 'Undone',
  saidRedo: 'Redone',
  saidNothingToUndo: 'Nothing to undo',
  saidNothingToRedo: 'Nothing to redo',
  saidFit: 'Fitted to the graph',
  saidZoom: 'Zoom {percent}%',
  saidCopied: { one: '1 box copied', other: '{count} boxes copied' },
  saidPasted: { one: '1 box pasted', other: '{count} boxes pasted' },
  saidNothingToPaste: 'Nothing to paste',

  // ---- C2 (§2.6 BH): fan-out, the cap, costs, and the chat-column inspector -------------------
  runningItems: 'Running {i}/{n} · item {item}/{items}',
  fanout: '{done}/{n}',
  fanoutHint: '{done} of {n} items done',
  capTitle: 'This run stopped at its Cap of {cap} generations',
  // Review 2026-09-28: `count` = the boxes left; canvas.mjs setCapped passes it.
  capBody: {
    one: '1 box was left for later. A generation is one answer from the model; the Cap keeps a graph from quietly spending the farm. Raise it for this run, or change Cap in the toolbar for every run.',
    other: '{count} boxes were left for later. A generation is one answer from the model; the Cap keeps a graph from quietly spending the farm. Raise it for this run, or change Cap in the toolbar for every run.',
  },
  capRaise: 'Raise the Cap for this run',
  capLabel: 'Cap',
  capHint: 'Cap: the most generations (answers from the model) one run may use, and the most items of a list one box may run through. A run that reaches it stops, keeps what it made, and offers to go on.',
  capSaid: 'Cap set to {cap} generations',
  // Owner, 2026-10-05: the toolbar box beside Cap (canvas.mjs). Its default is core/types.mjs
  // DEFAULT_THINK, so no sentence here says which way it starts. Yes/no decisions think either way
  // (core/types.mjs THINKING_TASKS): the box only adds the rest. The label stays this short: at the
  // harness window the toolbar has 0.4 px to spare with "Think first", and any label wider than
  // ~48 px wraps it to two rows (k5-lessons-every-lesson-and-template-opens-readable-and-framed).
  thinkLabel: 'Think all',
  thinkHint: 'Think all. Unticked, the model may still think (its own default) before a yes/no decision (Condition, Filter) and before writing text or code, and answers lists, JSON and agent steps straight away. Ticked, it thinks before all of them: more careful, but several times slower and heavier on the farm. It applies from the next run.',
  thinkOn: 'Think all is on: from the next run, lists, JSON and agent steps think too',
  thinkOff: 'Think all is off: from the next run, lists, JSON and agent steps answer straight away; yes/no decisions still think',
  capItemsTitle: 'One box would run {items} times',
  capItemsBody: 'That is more than the Cap of {cap}, so nothing ran. Raise it to {raise} to run them all: for this run with the button, or for every run with Cap in the toolbar.',
  cost: '{sec}s · {tokens} tokens',
  costCalls: '{sec}s · {tokens} tokens · {calls} calls',
  costHint: 'This box’s last run: how long it took, how many tokens the model read and wrote, and (when more than one) how many answers it asked for',
  // Review 2026-09-28: the second line of the run-notice strip for each ceiling (canvas.mjs
  // setLimited) — what the limit is for and what to do. The first line is computer.limit*.
  limitIterationsBody: 'A box may run at most {limit} times in one run, so a loop always ends. Check what should stop the loop, or raise the limit for this run.',
  limitGenerationsBody: 'A generation is one answer from the model. Raise the limit for this run, or change Cap in the toolbar for every run.',
  limitWallBody: 'A run may last {minutes} minutes, waits included. Raise the limit for this run to give it longer.',
  limitWallParkBody: 'Answer it sooner next time, or raise the limit for this run.',
  limitActivationsBody: 'A run may take {limit} steps (one step is one box running once), so a graph cannot run forever. Raise the limit for this run to let it finish.',
  inspectTitle: 'Result',
  inspectClose: 'Close',
  inspectFrom: 'From {part}',
  inspectItem: 'Item {i} of {n}',
  inspectEmpty: 'Nothing to show: this box has no result yet, or its result is empty. Run it to make one.',

  // ---- C3 (§2.6 BJ): tidy, and the sharing story. Seeded by the integrator; C3-U3 owns them.
  tidy: 'Tidy',
  tidyHint: 'Lay the boxes out left to right. One undo (Ctrl+Z) takes it back.',
  tidyMoved: { one: 'Moved 1 box', other: 'Moved {count} boxes' },
  tidyNothing: 'Everything is already in place.',

  exportGraph: 'Export…',
  exportHint: 'Save this graph as a .lolgraph.json file, to keep a copy or share it.',
  exportDone: 'Saved {name}',
  importDone: 'Imported: {n} boxes, {w} wires',
  importDropped: 'Imported, but {n} things were dropped: {why}',
  errImportNotGraph: 'That file is not a LOL graph.',
  errImportVersion: 'That file was written by a newer version of the Computer. Update LlmOnLan, then open it again.',
  errImportUnreadable: 'That file could not be read.',
  errImportTooBig: 'That file is too big to open. A graph file has to stay under 8 MB.',
  // Docs review B-4: a dropped graph file REPLACES the open graph (after the replaceTitle question),
  // like the toolbar's "Replace from file…" — it does not open beside it.
  dropHint: 'Drop a .lolgraph.json file to put it in place of this graph.',

  // C3-U3: the export popover, and what an import has to be able to SAY. A graph file is the whole
  // sharing story on a stateless farm, so every way it can go wrong gets a sentence of its own —
  // and an import that succeeded but left something behind says what it left (importDropped), in
  // words rather than in the engine's reason codes.
  exportMenu: 'Export options',
  exportSave: 'Save the file',
  exportImages: 'Pictures it has already made are saved inside the file, which makes it bigger.',
  exportFailed: 'That file could not be saved.',
  importCancelled: 'Import cancelled — nothing on the canvas changed.',
  importEmpty: 'That file is a graph, but it has no boxes in it.',
  dropPartUnknown: 'a box this version does not have',
  dropPartDuplicate: 'a box that was in the file twice',
  dropWireEnd: 'a wire with nothing on one end',
  dropWireCycle: 'a wire that would have made a loop with nothing to stop it',
  dropWireType: 'a wire between two boxes that do not fit',
  dropValueTooBig: 'a saved picture too big to keep',
  dropOther: 'something this version could not read',
});
