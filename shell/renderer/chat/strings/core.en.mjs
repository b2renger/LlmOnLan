// @ts-check
// Strings for the core skeleton (layout, loader banner, development fakes).
import { registerStrings } from '../core/i18n.mjs';

registerStrings('core', {
  // layout (ui/layout.mjs)
  newChat: 'New chat',
  send: 'Send',
  stop: 'Stop',
  // Tooltips naming the key (LOL Vibe has no shortcut list). {keys} is the platform's spelling.
  newChatTitle: 'New chat ({keys})',
  stopTitle: 'Stop the reply (Esc)',
  inputPlaceholder: 'Ask something…  (Enter to send, Shift+Enter for a new line)',
  inputLabel: 'Message',
  modelTitle: 'The farm’s model that answers this chat',
  emptyTitle: 'Chat directly with the farm.',
  emptyDetail: 'Your chats stay on this computer. To build a web page with the coding agent, press Project at the top.',
  jumpLatest: 'Jump to latest',
  threadsLabel: 'Chats',
  messagesLabel: 'Conversation',

  // loader (main.mjs)
  loaderFailed: 'Part of LOL Vibe failed to load ({key}).',

  // development fakes (core/fakes.mjs) — harness only, never shown in production
  reasoning: 'reasoning',
  // The model picker's states (ui/model-picker.mjs) — shown in production (the fakes reuse them).
  noFarm: 'no farm',
  noModels: 'no models',
  unreachable: 'unreachable',
  passwordRefused: 'password refused',
  // v0.1.45 parity strings used by the real controller/composer (and reused by the fakes).
  busyNote: '⏳ The server is busy: {label}{percent}. Try again in a moment.',
  busyPercent: ' ({percent}%)',
  errorNote: '[error: {message}]',
  busyFailNote: '⏳ The server is busy: {label}. Try again in a moment.',
  stats: '{tokens} tok · {tokPerSec} tok/s · first token {ttft}s',
  // A reply from the IDE's coding agent: its time is mostly tool work, so tokens per second would mislead.
  agentStats: '{steps} steps · {seconds} s',
  agentStatsOne: '1 step · {seconds} s',
  alreadyRunning: 'A reply is already running.',
  deleteThread: 'Delete',
});
