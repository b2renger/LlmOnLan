// node scripts/gen-talk-to-a-board.cjs (from shell/) — regenerates renderer/chat/computer/templates/talk-to-a-board.mjs with the Arduino sketch embedded
// (JSON-escaped). A unit test keeps it equal to docs/examples/arduino/lol_serial/lol_serial.ino. From shell/.
const fs = require('fs');
const sketch = fs.readFileSync('../docs/examples/arduino/lol_serial/lol_serial.ino', 'utf8').replace(/\r\n/g, '\n');
const DECIDE = [
  '// The ROUND TRIP: what the board said decides what the Computer tells it back.',
  '// Dark (a low light reading) → switch the LED on; bright → off. Change 400 to suit your room.',
  'const r = inputs.in.find((v) => v && typeof v === "object") || {};',
  'const light = Number(r.light);',
  'if (!Number.isFinite(light)) return "led 0";',
  'return light < 400 ? "led 1" : "led 0";',
].join('\n');
const SAY = [
  'const r = inputs.in.find((v) => v && typeof v === "object") || {};',
  'const cmd = inputs.in.find((v) => typeof v === "string") || "";',
  'return "## The board says\\nLight: **" + (r.light ?? "?") + "**\\n\\nThe Computer answers: `" + cmd + "`";',
].join('\n');
const out = `// @ts-check
// Template — Talk to a board (ecosystem plan v2 §8d, P3a-2). DATA only. GENERATED from
// docs/examples/arduino/lol_serial/lol_serial.ino by shell/scripts/gen-talk-to-a-board.cjs (a unit test keeps
// the embedded sketch equal to it).
//
// Both directions over one USB cable, and the round trip: the Computer tells the board a brightness
// (Text → Send); the board reports its light sensor (Receive); a Code box decides "dark? LED on" and a
// Send writes that back. No farm, no model: the whole loop is local. The Arduino sketch rides along in a
// Text box, so a student copies it from the Computer into the Arduino IDE.

export const SKETCH = ${JSON.stringify(sketch)};

const DECIDE = ${JSON.stringify(DECIDE)};

const SAY = ${JSON.stringify(SAY)};

export default {
  id: 'talk-to-a-board',
  title: 'Talk to a board',
  subtitle: 'An Arduino or ESP32 over USB, both ways: the Computer sets its LED, the board reports its light sensor, and a Code box closes the loop.',
  needsFarm: 'no',
  generations: 0,
  doc: {
    lolgraph: 2,
    title: 'Talk to a board',
    view: { x: 16, y: 8, zoom: 0.45 },
    parts: [
      { id: 'b_title', type: 'title', x: 40, y: 24, w: 820, h: 100, settings: { text: 'Talk to a board', size: 'l' } },
      {
        id: 'b_how', type: 'sticky', x: 40, y: 140, w: 360, h: 560,
        settings: {
          colour: 'yellow',
          text: 'How to start\\n\\n1. Copy the sketch in the Text box on the far right into the Arduino IDE, pick your board (Uno, Nano or ESP32) and its port, and Upload. Close the Serial Monitor afterwards: only one program can hold the board.\\n2. On each Send box and on the Receive box, press "Choose the board…" and pick it.\\n3. The Send boxes are a DRY RUN until you arm them: the run bar\\u2019s "Outputs: dry run" button asks first.\\n4. Press Run all.\\n\\nWhat happens\\n- Top: the Computer tells the board a brightness (0.75 = three quarters).\\n- Bottom: the board says {"light": …} every half second; Receive hands on the latest line; the Code box decides: dark → "led 1", bright → "led 0"; the second Send writes that back. That is the ROUND TRIP.\\n\\nNo farm, no model: everything stays on this computer and its USB cable.',
        },
      },
      { id: 'b_level', type: 'note', x: 440, y: 140, w: 300, h: 130, settings: { text: '0.75', locked: false } },
      { id: 'b_send', type: 'send', x: 800, y: 140, w: 320, h: 250, settings: { transport: 'serial', baud: 115200 } },
      { id: 'b_recv', type: 'receive', x: 440, y: 440, w: 320, h: 210, settings: { transport: 'serial', baud: 115200, take: 'latest' } },
      { id: 'b_decide', type: 'code', x: 800, y: 440, w: 340, h: 130, settings: { code: DECIDE, about: 'Dark (light below 400) → "led 1", bright → "led 0".', folded: true } },
      { id: 'b_back', type: 'send', x: 1200, y: 440, w: 320, h: 250, settings: { transport: 'serial', baud: 115200 } },
      { id: 'b_say', type: 'code', x: 800, y: 620, w: 340, h: 130, settings: { code: SAY, about: 'Says what the board read and what the Computer answered.', folded: true } },
      { id: 'b_view', type: 'preview', x: 1200, y: 740, w: 340, h: 220, settings: { mode: 'markdown' } },
      { id: 'b_sketch', type: 'note', x: 1600, y: 140, w: 520, h: 820, settings: { text: SKETCH, locked: true } },
    ],
    wires: [
      { from: 'b_level', to: 'b_send', port: 'in' },
      { from: 'b_recv', to: 'b_decide', port: 'in' },
      { from: 'b_decide', to: 'b_back', port: 'in' },
      { from: 'b_recv', to: 'b_say', port: 'in' },
      { from: 'b_decide', to: 'b_say', port: 'in' },
      { from: 'b_say', to: 'b_view', port: 'content' },
    ],
  },
};
`;
fs.writeFileSync('renderer/chat/computer/templates/talk-to-a-board.mjs', out);
console.log('ok', out.length);
