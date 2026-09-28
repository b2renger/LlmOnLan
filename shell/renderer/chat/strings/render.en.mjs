// @ts-check
// Strings for the message list, the reasoning block and the code chrome (P1-U3, namespace 'render').
//
// Plan §2.6 L: one namespace per unit. The verbatim v0.1.45 PARITY strings stay in
// strings/core.en.mjs and are REUSED from here (core.stats, core.reasoning, …) so a harness
// assertion reads the same text whether it hit the real module or a fake.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('render', {
  // reasoning (details/summary). The live label counts up from the first reasoning token; the
  // settled one reports what it took. {s} is whole seconds.
  thinking: 'Thinking… {s}s',
  thoughtFor: 'Thought for {s}s',
  thought: 'Reasoning',

  // message notes (.chat-msg-note)
  noteAborted: 'You stopped this reply.',
  noteInterrupted: 'This reply was cut short — LOL Vibe closed while it was still streaming.',
  noteError: 'The reply failed.',

  // message actions (.chat-actions)
  copyMessage: 'Copy message',
  copied: 'Copied',

  // code chrome (render/code.mjs)
  codePlain: 'text',
  copyCode: 'Copy',
  wrapOn: 'Wrap',
  wrapOff: 'No wrap',
  tabPreview: 'Preview',
  tabCode: 'Code',
  svgAlt: 'The SVG in this code block, drawn',
  // Tooltips (wrap is one setting for every code block, kept across launches).
  copyCodeTip: 'Copy this code',
  wrapOnTip: 'Wrap long lines, in every code block',
  wrapOffTip: 'Stop wrapping: long lines stay on one line and scroll sideways',
  tabPreviewTip: 'Draw this SVG',
  tabCodeTip: 'Show the code of this SVG',

  // branch bar (.chat-branch)
  branchPrev: 'Previous version',
  branchNext: 'Next version',
  branchAt: '{position}/{count}',
  branchKeyTitle: '{label} ({keys} on the last reply)',

  // live region
  replyFinished: 'Reply finished',

  // context (P2 fills setOutsideContext; the title is needed as soon as a row can carry the mark)
  outsideContext: 'Not sent with the next message: the chat is longer than the model can read at once (Keep in context sends it anyway)',
});
