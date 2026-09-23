// @ts-check
// K4-U3's strings: the Preview family (COMPUTER_PLAN §6.5). One file per K4 unit; see
// strings/parts-text.en.mjs for why. `parts.render*` stays in parts.en.mjs for the legacy part.
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
  previewEmpty: 'Nothing wired in yet.',
  previewAlt: 'What the sandbox drew',
  previewSnapshot: 'A picture, drawn in the sandbox.',
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
});
