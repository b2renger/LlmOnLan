// @ts-check
// Strings for the conversation tree and the generation actions (P2-U3, namespace 'tree').
//
// Plan §2.6 AO: one namespace per unit. `core.*` (the v0.1.45 parity strings) and `dialogs.*`
// (OK / Cancel / Close) are REUSED from here rather than redefined, so a harness assertion reads
// the same text whatever rendered it.
//
// `continuePrompt` is the one string in this file that goes ON THE WIRE: it is the extra user turn
// the continue fallback appends (§4 P2-U3 / §2.6 AC). The mock's `mock-restart-on-prefill` model
// recognises a continuation by the substring "Continue exactly where you stopped", so the wording
// is a contract with the farm-side prompt, not only with the reader.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('tree', {
  // message actions (ui/message-actions.mjs)
  regenerate: 'Regenerate',
  regenerateWith: 'Regenerate with…',
  regenerateCreative: 'More creative',
  regeneratePrecise: 'More precise',
  edit: 'Edit',
  fork: 'Fork from here',
  delete: 'Delete from here',
  continueReply: 'Continue',
  // Tooltips (the actions are icons): what each one does.
  regenerateTip: 'Regenerate: write this reply again (the old one is kept: ◀ ▶)',
  regenerateWithTip: 'Regenerate with…: write it again, more creative or more precise',
  editTip: 'Edit: change your message and send it again (the old one is kept: ◀ ▶)',
  forkTip: 'Fork from here: copy this chat, up to this message, into a new chat',
  deleteTip: 'Delete from here: remove this message and every reply below it',
  continueTip: 'Continue: carry on a reply that was cut short',

  // inline edit (ui/edit-inline.mjs)
  editLabel: 'Edit your message',
  editSave: 'Save & send',
  editCancel: 'Cancel',
  editHint: 'Ctrl+Enter sends · Esc cancels',

  // fork / delete
  forkTitle: '{title} (fork)',
  deleteTitle: 'Delete this message?',
  deleteBody: 'This message and every reply below it are removed from this chat. It cannot be undone.',
  deleteOk: 'Delete',

  // thread header (ui/thread-header.mjs)
  renameTitle: 'Rename this chat',
  renamePlaceholder: 'A name you will recognise',
  titleHint: 'Click to rename',
  // The whole name too: beside the Project panel the header shows only its first letters.
  titleHintNamed: '{title} — click to rename',
  systemPrompt: 'System prompt',
  systemPromptTitle: 'System prompt for this chat',
  systemPromptHint: 'Sent to the model before every message of this chat: tell it how to answer. Leave it empty for the model\'s own default. A project chat does not use it (the coding agent has its own instructions).',
  systemPromptPlaceholder: 'You are a Blender assistant. Answer in French.',
  systemSave: 'Save',
  systemClear: 'Clear',
  systemOn: 'System prompt · on',

  // continue (app/continue.mjs) — continuePrompt goes on the wire
  continuePrompt: 'Continue exactly where you stopped, without repeating anything.',

  // shortcuts (ui/shortcuts.mjs)
  shortcutStop: 'Stop the reply',
  shortcutEditLast: 'Edit the last message you sent',
  shortcutBranchPrev: 'Previous version of the last reply',
  shortcutBranchNext: 'Next version of the last reply',
  shortcutNewChat: 'New chat',
});
