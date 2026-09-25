// @ts-check
// K5-U1's strings: the creative boxes and the Write-… instructions (addendum KE-3). One strings
// file per K5 unit (KE-9); this one decorates the `parts` namespace like the K4 files do.
//
// Every key below is FROZEN BY NAME (graph/parts/creative.mjs resolves them, the ＋ menu shows
// them, lessons name the boxes by them). K5-U1 owns the WORDING and may add keys.
//
// The four `writeAsk*` strings are what a Write-… preset puts in the Instruction's text box — the
// words the person SEES and can edit, and exactly what the transcript's Sent tab shows. Since
// critic R1 (A8) they are the TASK only: how to answer (one fenced block, the sandbox's rules, a
// skeleton) is the per-kind system message graph/bind.mjs adds for the Instruction's `code`
// setting. The guest still takes code as models usually write it (p5 global mode, a three.js
// renderer appended to the page, a fenced block, a page with an inline <script>) —
// graph/unfence.mjs — so the prompt does not have to fight every habit.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  // the Show group: boxes with their own code editor
  creativeP5Label: 'p5.js sketch',
  creativeP5Desc: 'Draw and animate with p5.js code. Starts with a bouncing ball you can change; press Live and it follows your mouse.',
  creativeThreeLabel: 'three.js scene',
  creativeThreeDesc: 'A 3D scene written with three.js. Starts with a spinning cube; press Live and drag to orbit around it.',
  creativeSvgLabel: 'SVG',
  creativeSvgDesc: 'A vector picture written in SVG. Redraws as you type.',
  creativeHtmlLabel: 'HTML page',
  creativeHtmlDesc: 'A small web page you write in HTML, drawn safely in the sandbox.',
  creativeMarkdownLabel: 'Markdown view',
  creativeMarkdownDesc: 'Shows markdown as a formatted page: headings, lists, tables.',
  // the Think group: an Instruction that answers in code
  writeP5Label: 'Write a p5.js sketch',
  writeP5Desc: 'Ask the model for a p5.js sketch. Wire it into a p5.js sketch box to see it.',
  writeThreeLabel: 'Write a three.js scene',
  writeThreeDesc: 'Ask the model for a three.js scene. Wire it into a three.js scene box to see it.',
  writeSvgLabel: 'Write an SVG',
  writeSvgDesc: 'Ask the model to draw an SVG picture. Wire it into an SVG box to see it.',
  writeHtmlLabel: 'Write an HTML page',
  writeHtmlDesc: 'Ask the model for a small web page. Wire it into an HTML page box to see it.',
  // Critic R1 A8: the TASK only. The rules the sandbox imposes (strict mode, p5 globals only
  // inside setup/draw, no network, one fenced block…) ride the SYSTEM message the Instruction
  // sends for its code kind (strings/computer-gen.en.mjs `genSystem*`), which the transcript's
  // Sent tab shows — so the person edits what they want drawn, not the sandbox's small print.
  writeAskP5: 'A slow, colourful spiral that turns.',
  writeAskThree: 'A few floating shapes in soft light.',
  writeAskSvg: 'A simple landscape: a sun, two hills and a house.',
  writeAskHtml: 'A small page introducing a museum exhibition: a title, a short paragraph and three highlights.',
});
