// @ts-check
// The drawer's code editor (COMPUTER_LIVE_PLAN K-8, Builder E): its heading, its Run button, the
// key hints, the caret readout and the error's "Go to line". A NEW file for the new feature,
// registered into the `computer` namespace the drawer already speaks — so no other table moves.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('computer', {
  codeTitle: '{title} — code',
  codeTitleNone: 'Code',
  codeField: 'Code of {title}',
  codeRun: '▶ Run code',
  codeRunHint: 'Draw the box again with this code now (Ctrl+Enter)',
  codeHint: 'The box redraws as you type. Ctrl+Enter runs it now · Tab indents · Esc closes.',
  codeCaret: 'Ln {line}, Col {col}',
  codeGoto: 'Go to line {line}',
  codeGotoHint: 'Select that line in the code',
});
