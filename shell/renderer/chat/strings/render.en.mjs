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
  // A web page in an answer (render/code.mjs code-page): run here, without the internet.
  pageTabTip: 'Run this page here, with the CSS and JavaScript blocks of this answer (no internet)',
  pageCodeTip: 'Stop the page and show its code',
  pageNoInternet: 'This preview has no internet: what the page loads from {hosts} is missing.',
  pageError: 'The page stopped on an error: {message}',
  pageErrorAt: 'The page stopped on an error in {block}, line {line}: {message}',
  pageStopped: 'The page stopped answering, so it was closed. Press Preview to run it again.',
  pageBeside: 'Side by side',
  pageBesideTip: 'Open this page beside the chat with its code: change the code and watch the page change',
  pageEdited: 'edited',
  pageEditedTip: 'You changed this page\'s code beside the chat: Preview runs your version',
  // The Page panel beside the chat (render/page-panel.mjs, VIBE_PAGE_PLAN).
  pagePanel: 'Page',
  pagePanelEmpty: 'Nothing here yet. On a web page in an answer, press “Side by side” to see the page and its code here, together.',
  pagePanelTitle: 'The page from this answer',
  pageBlockHtml: 'HTML',
  pageBlockCss: 'CSS',
  pageBlockJs: 'JavaScript',
  pageBlockN: '{kind} {n}',
  pageBlocksLabel: 'The blocks of this page',
  pageCodeOf: 'Code of {block}',
  pageRun: '▶ Run',
  pageRunHint: 'Run the page again with this code now (Ctrl+Enter)',
  pageEditHint: 'The page runs again when you pause typing. Ctrl+Enter runs it now · Tab indents.',
  pageEditHintManual: 'Ctrl+Enter or ▶ Run runs the page with this code · Tab indents.',
  pageAuto: 'Run as I type',
  pageAutoTip: 'Run the page again each time you pause typing',
  pageReset: 'Back to the model’s code',
  pageResetTip: 'Throw your changes away and run the code of the answer again',
  pageResetTitle: 'Back to the model’s code?',
  pageResetBody: 'Your changes to this page are thrown away.',
  pageResetOk: 'Throw my changes away',
  pageResult: 'The page, running',
  pageProblems: 'Errors',
  pageNoProblems: 'No errors.',
  pageConsole: 'Console',
  pageNoConsole: 'Nothing written with console.log yet.',
  pageErrAt: '{block}, line {line}',
  pageErrGoTip: 'Show this line in the code',
  pageStalled: 'The page stopped answering (a loop that never ends?), so it was closed. Change the code, or press ▶ Run.',
  pageReplaced: 'This page stopped because another page started (a Preview in the chat). Press ▶ Run to run it here again.',
  pageMore: '{n} more not shown',
  pagePopOut: 'Pop out',
  pagePopOutTip: 'Move this page and its code to a window of its own (for another screen or a projector)',
  pageAway: 'This page is open in its own window. Your changes there are kept with this chat.',
  pageBack: 'Bring it back here',
  pageBackTip: 'Run the page here again (its window keeps what it shows until you close it)',
  pageWindowTitle: 'Page — LlmOnLan',
  pageWindowWaiting: 'Waiting for a page from LOL Vibe…',

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
