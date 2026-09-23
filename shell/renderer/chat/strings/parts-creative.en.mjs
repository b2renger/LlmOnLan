// @ts-check
// K5-U1's strings: the creative boxes and the Write-… instructions (addendum KE-3). One strings
// file per K5 unit (KE-9); this one decorates the `parts` namespace like the K4 files do.
//
// Every key below is FROZEN BY NAME (graph/parts/creative.mjs resolves them, the ＋ menu shows
// them, lessons name the boxes by them). K5-U1 owns the WORDING and may add keys.
//
// The four `writeAsk*` strings are what a Write-… preset puts in the Instruction's text box — the
// words the person SEES and can edit, and exactly what the transcript's Sent tab shows. They ask
// for code only, in the shape the sandbox guest runs, in words short enough for a 12B model to
// follow. The guest takes the code as models usually write it (p5 global mode, a three.js renderer
// appended to the page, a fenced block) — graph/unfence.mjs — so the asks do not have to fight
// the model's habits, only name the canvas size and forbid imports.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  // the Show group: boxes with their own code editor
  creativeP5Label: 'p5.js sketch',
  creativeP5Desc: 'Draw and animate with p5.js code. Starts with a bouncing ball you can change.',
  creativeThreeLabel: 'three.js scene',
  creativeThreeDesc: 'A 3D scene written with three.js. Starts with a spinning cube.',
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
  writeAskP5: 'Write a p5.js sketch of a slow, colourful spiral.\n\nReply with only the JavaScript code, no explanation. Use p5.js global mode: define setup() and draw(), and call createCanvas(400, 300) in setup(). Do not import anything.',
  writeAskThree: 'Write a three.js scene with a few floating shapes and soft light.\n\nReply with only the JavaScript code, no explanation. THREE is already loaded as a global, so do not import anything. Make a 400 by 300 renderer, and call renderer.render(scene, camera) once before any animation loop.',
  writeAskSvg: 'Draw a simple landscape: a sun, two hills and a house.\n\nReply with only the SVG code, no explanation. Start with <svg and include xmlns and a viewBox of 0 0 400 300.',
  writeAskHtml: 'Make a small web page that introduces a museum exhibition, with a title, a short paragraph and a list of three highlights.\n\nReply with only the HTML, no explanation. Put any CSS in a <style> element; no scripts, no external links or images.',
});
