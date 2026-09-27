// @ts-check
// Strings for the core skeleton (layout, loader banner, development fakes).
import { registerStrings } from '../core/i18n.mjs';

registerStrings('core', {
  // layout (ui/layout.mjs)
  newChat: 'New chat',
  send: 'Send',
  stop: 'Stop',
  inputPlaceholder: 'Ask something…  (Enter to send, Shift+Enter for a new line)',
  inputLabel: 'Message',
  modelTitle: 'Model served by the farm',
  emptyTitle: 'Chat directly with the farm.',
  emptyDetail: 'Your chats stay on this machine.',
  jumpLatest: 'Jump to latest',
  threadsLabel: 'Chats',
  messagesLabel: 'Conversation',

  // loader (main.mjs)
  loaderFailed: 'Part of LOL Chat failed to load ({key}).',
  loaderFallback: 'LOL Chat failed to load — see the developer console.',

  // development fakes (core/fakes.mjs) — harness only, never shown in production
  reasoning: 'reasoning',
  noFarm: 'no farm',
  noModels: 'no models',
  unreachable: 'unreachable',
  passwordRefused: 'password refused',
  busyNote: '⏳ The server is busy: {label}{percent}. Try again in a moment.',
  busyPercent: ' ({percent}%)',
  errorNote: '[error: {message}]',
  busyFailNote: '⏳ The server is busy: {label}. Try again in a moment.',
  stats: '{tokens} tok · {tokPerSec} tok/s · first token {ttft}s',
  alreadyRunning: 'A reply is already running.',
  deleteThread: 'Delete',
});
