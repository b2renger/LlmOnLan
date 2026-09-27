// @ts-check
// Strings for the workbench (S0-U1). One namespace per unit (§2.6 L / BD-13): `studio.*`.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('studio', {
  // the rail + the body
  railLabel: 'Workbench panels',
  bodyLabel: 'Workbench',
  panelUnavailable: '{panel} — {reason}',
  closeHint: 'Close',

  // the width control (a radiogroup in the head)
  widthLabel: 'Workbench width',
  widthChat: 'Chat',
  widthSplit: 'Split',
  widthWork: 'Panel',
  widthChatHint: 'Chat only',
  widthSplitHint: 'Chat and panel side by side',
  widthWorkHint: 'Panel only',
  gripLabel: 'Resize the workbench',

  // announcements (one per change, into els.live)
  announceOpen: '{panel} open, {width}',
  announceClose: 'Workbench closed',
  announceWidth: 'Workbench: {width}',

  // shortcuts (their labels show in the palette from P4 on)
  shortcutCycle: 'Chat / split / panel',
  shortcutPanel: 'Open workbench panel {n}',

  // The Computer panel (docs/LOLCHAT_COMPUTER_SPEC.md) is the first real panel; it registers itself
  // in the next phase. Its label lives here so the rail and the string gate are ready for it.
  panelComputer: 'Computer',

  // The header button. The rail lives INSIDE the workbench column, which is 0px wide while the
  // workbench is closed — so with only the rail, a shut workbench can be opened by keyboard alone
  // (Ctrl+\ / Ctrl+1..4). The owner opened the client and could not find the Computer at all.
  headerOpen: 'Open {panel}',
  headerClose: 'Close {panel}',
});
