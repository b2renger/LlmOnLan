// @ts-check
// Strings for the workbench (S0-U1). One namespace per unit (§2.6 L / BD-13): `studio.*`.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('studio', {
  // the rail + the body
  railLabel: 'Workbench panels',
  bodyLabel: 'Workbench',
  panelUnavailable: '{panel} — {reason}',

  // the width control (a radiogroup in the head)
  widthLabel: 'Workbench width',
  widthChat: 'Chat',
  widthSplit: 'Split',
  widthWork: 'Panel',
  widthChatHint: 'Chat only',
  widthSplitHint: 'Chat and panel side by side',
  widthWorkHint: 'Panel only',
  gripLabel: 'Resize the workbench',
  gripTip: 'Drag to make the panel wider or narrower (← → when it has the focus)',

  // announcements (one per change, into els.live)
  announceOpen: '{panel} open, {width}',
  announceClose: 'Workbench closed',
  announceWidth: 'Workbench: {width}',

  // shortcuts (their labels show in the palette from P4 on)
  shortcutCycle: 'Chat / split / panel',
  shortcutPanel: 'Open workbench panel {n}',

  // The Computer was planned as the first workbench panel (docs/LOLCHAT_COMPUTER_SPEC.md). Since K1
  // it is its own surface (computer/main.mjs) and does not register a panel here; the label is kept.

  // The header button. The rail lives INSIDE the workbench column, which is 0px wide while the
  // workbench is closed — so with only the rail, a shut workbench can be opened by keyboard alone
  // (Ctrl+\ / Ctrl+1..4). The owner opened the client and could not find the Computer at all.
  // {keys}: the panel's Ctrl+<n> shortcut, in the platform's spelling.
  headerOpen: 'Open the {panel} panel ({keys})',
  headerClose: 'Close the {panel} panel ({keys})',
  headerOpenBare: 'Open the {panel} panel',
  headerCloseBare: 'Close the {panel} panel',
});
