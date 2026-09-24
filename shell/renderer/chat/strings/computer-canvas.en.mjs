// @ts-check
// Package B's strings (critic R1: the canvas, the mouse and the trackpad). A SEPARATE FILE in the
// SAME namespace as graph.en.mjs — `registerStrings` merges — so three builders never share one
// strings file. Existing `graph.*` keys stay in graph.en.mjs; every key below is new in R1.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('graph', {
  // A3: the resize handle in every box's bottom-right corner.
  resizeHandle: 'Drag to resize (Alt+Shift+arrow keys also work)',
  saidResized: '{part} resized to {w} × {h}',

  // A4: the zoom cluster. The % button opens the menu; each row names its shortcut.
  zoomIn: 'Zoom in (Ctrl +)',
  zoomOut: 'Zoom out (Ctrl −)',
  zoomMenu: 'Zoom: fit, selection or 100%',
  zoomFit: 'Zoom to fit',
  zoomSelection: 'Zoom to selection',
  zoom100: 'Zoom to 100%',
  zoomKeyFit: 'Shift+1',
  zoomKeySelection: 'Shift+2',
  zoomKey100: 'Ctrl+0',
  saidZoomSelection: 'Zoomed to the selection',
  saidNothingToZoom: 'Select a box first, then zoom to it',

  // A4: the two canvas tools (tldraw's V and H).
  toolsLabel: 'Canvas tools',
  toolSelect: 'Select',
  toolSelectHint: 'Select and move boxes (V). Drag on empty canvas to draw a selection box.',
  toolHand: 'Hand',
  toolHandHint: 'Drag to move around the canvas (H). Hold Shift to draw a selection box instead.',
  saidToolHand: 'Hand tool: drag to move around',
  saidToolSelect: 'Select tool',

  // A5: unplugging a wire, by its ✕ or by dragging its end off the input.
  wireUnplug: 'Unplug this wire (Delete)',
  portInWired: '{label} in — drag the wire off this dot to unplug it',
  saidWireUnplugged: 'Wire from {from} to {to} removed. Ctrl+Z puts it back.',
  saidWireReplugged: '{from} now feeds {to} instead',

  // Duplicate (Ctrl+D) and pasting plain text onto the canvas.
  saidDuplicated: { one: '1 part duplicated', other: '{count} parts duplicated' },
  saidPastedText: 'Text box made from the pasted text',

  // The right-click menus (tldraw tool #6): every keyboard-only action gets a visible door.
  ctxPartMenu: 'Box actions',
  ctxWireMenu: 'Wire actions',
  ctxCopyText: 'Copy text',
  ctxEdit: 'Edit',
  ctxDuplicate: 'Duplicate',
  ctxCopy: 'Copy box',
  ctxZoom: 'Zoom to this box',
  ctxDelete: 'Delete box',
  ctxWireName: 'Name this arrow',
  ctxWireUnplug: 'Unplug',
  keyCopy: 'Ctrl+C',
  keyEdit: 'Enter',
  keyDuplicate: 'Ctrl+D',
  keyDelete: 'Delete',
  keyRename: 'F2',
});
