// @ts-check
// The Preview family's strings (COMPUTER_PLAN §6.5): K4-U3's, extended by K5-U1 for the box's own
// code editor (addendum KE-3). One file per unit; see strings/parts-text.en.mjs for why.
// `parts.render*` stays in parts.en.mjs for the legacy part.
//
// `previewRefused` is FROZEN at the K4 kickoff (addendum KD-6) and is reproduced verbatim: it
// names the port, what arrived, what the port takes, and an action that exists. The `previewKind*`
// keys are what fills its `{got}` — a kind spelled the way a reader would say it out loud, not
// the routing alphabet's token.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  previewLabel: 'Preview',
  previewHint: 'Shows what arrives: markdown, SVG, a web page, three.js or p5.js.',
  previewIn: 'Content',
  previewMode: 'Read it as',
  previewAuto: 'Automatic',
  previewMarkdown: 'Markdown',
  previewSvg: 'SVG',
  previewHtml: 'Web page',
  previewThree: 'three.js',
  previewP5: 'p5.js',
  previewWidth: 'Width',
  previewHeight: 'Height',
  previewEmpty: 'Nothing to show yet: write code below, or wire something in.',
  previewAlt: 'What the sandbox drew',
  previewSnapshot: 'A picture, drawn in the sandbox. ▶ Live runs it for real.',
  previewExport: 'Save…',
  // §6.5: a refusal names the port, what arrived, what the port takes, AND an action that exists.
  previewRefused: 'Preview: got {got} on `content`, which takes text or json. To look at a picture, put it in an Image box; to ask about it, wire it into an Instruction.',
  previewKindText: 'text',
  previewKindJson: 'json',
  previewKindList: 'a list',
  previewKindImage: 'an image',
  previewKindFile: 'a file',
  previewError: '{message} (line {line})',
  previewNotSvg: 'Preview: that is not an SVG. An SVG starts with `<svg` — pick another way to read it, or fix what makes it.',
  previewTooBig: 'Preview: the picture came back bigger than a megabyte. Make the box smaller, or draw less.',
  previewNoPicture: 'Preview: the sandbox ran it but there was nothing to photograph.',

  // ---- K5-U1: the box's own code (addendum KE-3) ------------------------------------------
  previewSource: 'Code',
  previewSourceHint: 'Write code here, or wire an Instruction into this box.',
  previewPress: 'Press ▶ to draw this code.',
  previewDrawing: 'Drawing…',
  previewLock: 'Keep my code',
  previewLockOn: 'Kept: what arrives on the wire is not drawn over your code. Click to let it through.',
  previewLockOff: 'Click to keep your code when something arrives on the wire.',
  previewFromInput: 'Drawing what arrived on the wire',
  previewLocked: 'Your code is kept',
  // Critic S1-12: a Preview has no Unlock; its control is “Keep my code” (previewLock).
  previewKept: 'Kept your code: what arrived was not drawn. Press “Keep my code” again to draw it.',
  previewKeptEditing: 'Kept your code while you were typing. Press ▶ again to draw what arrived.',
  previewShowCode: 'Show code',
  previewHideCode: 'Hide code',
  previewSaveAs: 'Save .{ext}',
  previewSaveHint: 'Save as a .{ext} file',
  previewGoto: 'Go to line {line}',
  previewGotoHint: 'Select that line in the code',
  previewSvgBroken: 'That SVG does not parse: {reason}.',

  // ---- K-9 (docs/COMPUTER_LIVE_PLAN.md): live previews, Run code, Edit code ------------------
  previewLive: '▶ Live',
  previewStop: '■ Stop',
  previewLiveHint: 'Run this sketch for real, right here: the mouse, the wheel and the keys go to it. Esc gives them back.',
  previewStopHint: 'Stop the live sketch and show its picture again.',
  previewLiveStarting: 'Going live…',
  previewLiveNote: 'Live: the mouse and keys go to the sketch — Esc gives them back. Ctrl+Enter runs your edits.',
  previewLiveStalled: 'The live sketch stopped answering, so it was stopped. Fix the code and press ▶ Live again.',
  previewLiveUnavailable: 'The sandbox could not start, so this sketch cannot go live.',
  previewRunCode: 'Run code',
  previewRunCodeHint: 'Draw the code as it is now (Ctrl+Enter in the code)',
  previewRunLiveHint: 'Restart the live sketch with the code as it is now (Ctrl+Enter in the code)',
  previewEditCode: 'Edit code',
  previewEditCodeHint: 'Open this code in a large editor beside the canvas',
});
