// @ts-check
// Strings for the Computer panel's canvas, toolbar and wire refusals. One namespace per unit
// (§2.6 L / BD-13): `graph.*` belongs to C1-U2. Part labels live in `parts.*` (C1-U3).
import { registerStrings } from '../core/i18n.mjs';

registerStrings('graph', {
  panelLabel: 'Computer',
  empty: 'Place a part to start. Wire it up, then press Run.',
  // K1 landing: a graph no longer belongs to a conversation, it belongs to a LIBRARY DOCUMENT.
  // (`noThread` was 'Open a chat to build a program…'; the Computer has no chat to open.)
  noDoc: 'Open a graph from the library, or press ＋ New, to start building.',

  // toolbar
  run: 'Run',
  running: 'Running {i}/{n}',
  stop: 'Stop',
  add: '＋ Add a box',
  addPart: 'Add {part}',
  undo: 'Undo',
  redo: 'Redo',
  fit: 'Fit',
  zoom: '{percent}%',
  zoomLabel: 'Zoom',

  // wire refusals — one per reason code returned by graph/model.mjs addWire() (frozen, §2.6 BG-4)
  wireSelf: 'A part cannot feed itself.',
  wireCycle: 'That would make a loop. Use Repeat instead of feeding a value back.',
  // K3 kickoff (COMPUTER_PLAN §4.6): a loop is now LEGAL and declared — `wireCycle` survives for
  // a self-wire and for an old file. What a loop may not be is unstoppable.
  wireLoopUngated: 'A loop needs something that can stop it. Add a Toggle.',
  wireBack: 'loops back',
  wireBackAria: '{from} loops back into {to}',
  wireDuplicate: 'Those two are already wired together.',
  wireNoOutput: 'That part has no output.',
  wireUnknownPort: 'That input does not exist on this part.',
  wireType: '{from} produces {kind}, which {to} does not accept.',
  wireUnknownPart: 'One end of that wire is gone.',
  wireRefused: 'That wire was refused.',

  // run reporting
  runDone: '{n} parts ran in {sec}s',
  runNothing: 'Nothing to run — every part is up to date.',
  runStopped: 'Stopped. Finished parts kept their values.',
  runCycle: 'This graph has a loop and cannot run.',
  runErrors: '{n} parts failed',
  // C1 landing: two REAL run outcomes the runner reports that had no sentence of their own and were
  // announcing as runNothing. A yield is not a failure and not a stop — the person took the seat.
  runBusy: 'The farm went to someone else — press Run to pick up where it stopped.',
  runCapped: 'Stopped at {cap} generations, {n} parts still to run.',

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
  selectionCount: '{n} selected',
  valueOpen: 'Open this value',
  valueTitle: 'Value',
  valueMore: '… {n} more characters',
  portIn: '{label} in',
  portOut: 'Output',
  partAria: '{label} — {state}',
  wireAria: 'Wire from {from} to {to}',

  // ---- K2-U1 (COMPUTER_PLAN §5.1, §8.2): the arrow's name -------------------------------------
  // An arrow's label is not decoration: it is the NAME the instruction below refers to. The
  // placeholder is a plea, not a field name — an unnamed wire is the commonest cause of a mushy
  // answer, and the empty pill is where a reader finds that out.
  wireNameMe: 'name me',
  wireLabelAria: 'Name this arrow',
  wireLabelHint: 'Click an arrow’s name to rename it. The instruction below refers to it by that name.',
  saidWireNamed: 'Arrow named {name}',
  saidWireUnnamed: 'Arrow name cleared',

  // the live region: one line per change
  saidPlaced: '{part} placed',
  saidDeleted: { one: '1 part deleted', other: '{count} parts deleted' },
  saidWired: '{from} now feeds {to}',
  saidWireDeleted: 'Wire deleted',
  saidSelected: { one: '1 part selected', other: '{count} parts selected' },
  saidNothingSelected: 'Nothing selected',
  saidMoved: '{part} moved to {x}, {y}',
  saidUndo: 'Undone',
  saidRedo: 'Redone',
  saidNothingToUndo: 'Nothing to undo',
  saidNothingToRedo: 'Nothing to redo',
  saidFit: 'Fitted to the graph',
  saidZoom: 'Zoom {percent}%',
  saidCopied: { one: '1 part copied', other: '{count} parts copied' },
  saidPasted: { one: '1 part pasted', other: '{count} parts pasted' },
  saidNothingToPaste: 'Nothing to paste',

  // ---- C2 (§2.6 BH): fan-out, the cap, costs, and the chat-column inspector -------------------
  runningItems: 'Running {i}/{n} · item {item}/{items}',
  fanout: '{done}/{n}',
  fanoutErrors: '{n} failed',
  capTitle: 'This run stopped at {cap} generations',
  capBody: '{n} parts were left for later, so a graph cannot quietly spend the farm.',
  capRaise: 'Raise the cap for this run',
  capLabel: 'Cap',
  capHint: 'How many generations one Run may spend.',
  capSaid: 'Cap set to {cap} generations',
  runCappedShort: 'Stopped at the cap of {cap}.',
  capItemsTitle: 'One part would run {items} times',
  capItemsBody: 'Your cap is {cap} items a run, so nothing ran. Raising it to {raise} runs them all.',
  runCappedItems: 'Stopped: one part would run {items} times, over the cap of {cap}.',
  cost: '{sec}s · {tokens} tokens',
  costCalls: '{sec}s · {tokens} tokens · {calls} calls',
  inspectTitle: 'Value',
  inspectClose: 'Close',
  inspectFrom: 'From {part}',
  inspectItem: 'Item {i} of {n}',
  inspectEmpty: 'This part has no value yet.',

  // ---- C3 (§2.6 BJ): tidy, and the sharing story. Seeded by the integrator; C3-U3 owns them.
  tidy: 'Tidy',
  tidyHint: 'Lay the parts out left to right. One undo takes it back.',
  tidyMoved: 'Moved {n} parts',
  tidyNothing: 'Everything is already in place.',

  exportGraph: 'Export…',
  exportWithValues: 'Include the values it has already computed',
  exportDone: 'Saved {name}',
  importGraph: 'Import…',
  importReplaceTitle: 'Replace this canvas?',
  importReplaceBody: 'This conversation already has {n} parts. Importing replaces them; one undo takes it back.',
  importDone: 'Imported {n} parts and {w} wires',
  importDropped: 'Imported, but {n} things were dropped: {why}',
  errImportNotGraph: 'That file is not a LOL graph.',
  errImportVersion: 'That file was written by a newer version of LOL Chat.',
  errImportUnreadable: 'That file could not be read.',
  errImportTooBig: 'That file is too big to open. A graph file has to stay under 8 MB.',
  dropHint: 'Drop a .lolgraph.json file to open it here.',

  // C3-U3: the export popover, and what an import has to be able to SAY. A graph file is the whole
  // sharing story on a stateless farm, so every way it can go wrong gets a sentence of its own —
  // and an import that succeeded but left something behind says what it left (importDropped), in
  // words rather than in the engine's reason codes.
  exportMenu: 'Export options',
  exportSave: 'Save the file',
  exportImages: 'Pictures it has already made are saved inside the file, which makes it bigger.',
  exportFailed: 'That file could not be saved.',
  importCancelled: 'Import cancelled — nothing on the canvas changed.',
  importEmpty: 'That file is a graph, but it has no parts in it.',
  dropPartUnknown: 'a part this version does not have',
  dropPartDuplicate: 'a part that was in the file twice',
  dropWireEnd: 'a wire with nothing on one end',
  dropWireCycle: 'a wire that would have made a loop',
  dropWireType: 'a wire between two parts that do not fit',
  dropValueTooBig: 'a saved picture too big to keep',
  dropOther: 'something this version could not read',
});
