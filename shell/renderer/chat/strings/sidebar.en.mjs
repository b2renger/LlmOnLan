// @ts-check
// Strings for the thread list (ui/sidebar.mjs). Namespace: `sidebar` (plan §2.6 L).
import { registerStrings } from '../core/i18n.mjs';

registerStrings('sidebar', {
  // groups
  pinned: 'Pinned',
  recent: 'Recent',

  // rows
  untitled: 'New chat',
  loading: 'Loading chats…',
  interrupted: 'This chat has a reply that was cut off.',

  // delete
  delete: 'Delete chat',
  deleteTitle: 'Delete this chat?',
  deleteBody: '“{title}” and its messages are removed from this machine. This cannot be undone.',
  deleteOk: 'Delete',

  // the ⌄ button beside “New chat” (SLOTS.NEW_MENU)
  newMenu: 'More ways to start a chat',
});
