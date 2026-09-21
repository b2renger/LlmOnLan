// @ts-check
// Strings for the library: the sidebar's groups, search and row menu, the settings popover, and
// export/import. Namespace: `library` (plan §2.6 AO). P2-U4 owns this file.
//
// It deliberately REUSES rather than redefines: `sidebar.*` for the row chrome P1-U4 named
// (Pinned, New chat, Delete chat), `dialogs.*` for OK/Cancel, `core.*` for the parity strings.
// Month group headings are not here at all — they come from the platform's own month names.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('library', {
  // ---- groups (the Pinned heading is sidebar.pinned) ----
  groupToday: 'Today',
  groupYesterday: 'Yesterday',
  groupWeek: 'Previous 7 days',
  groupMonth: 'Previous 30 days',

  // ---- search ----
  searchPlaceholder: 'Search chats',
  searchLabel: 'Search chats and messages',
  searchClear: 'Clear the search',
  searchNone: 'Nothing matches “{q}”',
  searchHits: '{n} in this chat',
  searchResults: 'Results',
  searchWorking: 'Searching…',

  // ---- the row … menu ----
  menu: 'More for this chat',
  rename: 'Rename',
  renameLabel: 'Chat name',
  pin: 'Pin',
  unpin: 'Unpin',
  exportMd: 'Export Markdown',
  exportJson: 'Export .lolchat.json',
  deleteChat: 'Delete',

  // ---- ephemeral ----
  newEphemeral: 'New ephemeral chat',
  ephemeral: 'Not saved — this chat disappears when LOL Chat closes.',

  // ---- settings ----
  settings: 'Settings',
  settingsTitle: 'LOL Chat settings',
  storage: 'Storage',
  storeIdb: 'Saved on this computer',
  storePending: 'Opening the local database…',
  storeMemory: 'Not saved yet — still opening the local database',
  storeMemoryFinal: 'Cannot be saved on this machine',
  usage: '{used} of {quota} used',
  usageUnknown: 'This machine does not report how much space is used.',
  exportAll: 'Export all chats',
  importChats: 'Import chats…',
  removeV1: 'Remove the old v1 copy',
  removeV1Pending: 'Bring over {n} remaining chats first',
  removeV1Title: 'Remove the old copy?',
  removeV1Body: 'Every chat from the previous version has been brought over. The old copy is only taking up space, and removing it cannot be undone.',
  removeV1Done: 'The old copy was removed.',
  removeV1Kept: 'The old copy was kept.',
  about: 'About',
  aboutBody: 'LOL Chat keeps everything on this computer.',
  aboutWhere: 'Chats, drafts and attachments live in this app’s own local database. Nothing is uploaded: only the text of the conversation you send goes to the farm, so it can answer.',

  // ---- transfer ----
  exported: 'Exported {name}',
  exportedSkipped: 'Exported {name} — {count} temporary chat left out',
  exportedSkippedMany: 'Exported {name} — {count} temporary chats left out',
  exportEmpty: 'There is nothing to export yet.',
  imported: 'Imported {n} chats',
  importNothing: 'Nothing was imported.',
  importProblems: '{n} problems in that file',
  importFailedTitle: 'That file could not be imported',
  copyTitle: 'Copy this export',
  copyBody: 'This build could not hand you a file, so here is the text. Copy it and save it yourself.',
  copyOk: 'Copy',
  copied: 'Copied to the clipboard.',
  copyFailed: 'Copying failed.',
});
