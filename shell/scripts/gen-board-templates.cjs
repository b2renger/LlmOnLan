// node scripts/gen-board-templates.cjs (from shell/) — regenerates the two board templates with their Arduino
// sketch embedded (JSON-escaped): talk-to-a-board.mjs (lol_serial, the USB cable) and board-on-wifi.mjs (lol_mqtt,
// the farm's message bus). Unit tests keep each equal to its docs/examples/arduino/ sketch.
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
// docs/examples/arduino/lol_serial/lol_serial.ino by shell/scripts/gen-board-templates.cjs (a unit test keeps
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
console.log('ok talk-to-a-board', out.length);

// ---- A board on Wi-Fi: the same round trip through the farm's message bus ------------------------------
const mqtt = fs.readFileSync('../docs/examples/arduino/lol_mqtt/lol_mqtt.ino', 'utf8').replace(/\r\n/g, '\n');
const DECIDE_WIFI = [
  '// The Trigger hands on the board\'s latest message: {topic: "lol/board1/light", data: {light: 1234}}.',
  '// Dark (a low reading) → the LED on (1 = full brightness); bright → off (0).',
  '// An ESP32 reads 0..4095: change 1500 to suit your room and your sensor.',
  'const e = inputs.in[0] || {};',
  'const light = Number(e.data && e.data.light);',
  'if (!Number.isFinite(light)) return 0;',
  'return light < 1500 ? 1 : 0;',
].join('\n');
const SAY_WIFI = [
  'const e = inputs.in.find((v) => v && typeof v === "object") || {};',
  'const led = inputs.in.find((v) => typeof v === "number");',
  'const board = String(e.topic || "").split("/")[1] || "?";',
  'return "## " + board + " says\\nLight: **" + ((e.data && e.data.light) ?? "?") + "**\\n\\nThe Computer answers on lol/board1/led: `" + led + "`";',
].join('\n');
const HOW_WIFI = [
  'How to start',
  '',
  '1. On the farm: admin panel ▸ Plugins ▸ Message bus ▸ Enable.',
  '2. Copy the sketch in the Text box on the far right into the Arduino IDE (an ESP32, and the PubSubClient library), fill in YOUR SETTINGS (your Wi-Fi, the farm\'s address, its password, BOARD = board1) and Upload.',
  '3. Arm the outputs: the run bar\'s "Outputs: dry run" button asks first.',
  '',
  'What happens',
  '- The board publishes {"light": …} on lol/board1/light every second. The Receive box at the top shows the latest one live, without running anything.',
  '- The Trigger starts a run BY ITSELF on those messages: at most one every 2 seconds (the ones in between only update what it hands on), at most 1800 an hour, and only while the outputs are armed and the Computer is on screen.',
  '- The Code box decides: dark → 1 (LED on), bright → 0; Send writes it to lol/board1/led and the board sets its LED. That is the ROUND TRIP, over Wi-Fi.',
  '',
  'The farm keeps nothing: a message goes to whoever listens at that moment.',
].join('\n');
const wifi = `// @ts-check
// Template — A board on Wi-Fi (ecosystem plan v2 §8d, P3b). DATA only. GENERATED from
// docs/examples/arduino/lol_mqtt/lol_mqtt.ino by shell/scripts/gen-board-templates.cjs (a unit test keeps
// the embedded sketch equal to it).
//
// The Wi-Fi twin of "Talk to a board": an ESP32 publishes its light sensor on the farm's message bus; a
// Trigger starts a run on each reading by itself (armed and on screen only); a Code box decides and a Send
// writes the LED back on the bus. No model: the farm is only the meeting point.

export const SKETCH = ${JSON.stringify(mqtt)};

const DECIDE = ${JSON.stringify(DECIDE_WIFI)};

const SAY = ${JSON.stringify(SAY_WIFI)};

export default {
  id: 'board-on-wifi',
  title: 'A board on Wi-Fi',
  subtitle: 'An ESP32 on the farm\\u2019s message bus: a Trigger runs the graph on each reading by itself, and a Code box sets the board\\u2019s LED back.',
  needsFarm: 'one',
  generations: 0,
  doc: {
    lolgraph: 2,
    title: 'A board on Wi-Fi',
    view: { x: 16, y: 8, zoom: 0.45 },
    parts: [
      { id: 'b_title', type: 'title', x: 40, y: 24, w: 820, h: 100, settings: { text: 'A board on Wi-Fi', size: 'l' } },
      { id: 'b_how', type: 'sticky', x: 40, y: 140, w: 360, h: 620, settings: { colour: 'yellow', text: ${JSON.stringify(HOW_WIFI)} } },
      { id: 'b_live', type: 'receive', x: 440, y: 140, w: 320, h: 210, settings: { transport: 'bus', topic: 'lol/+/light', take: 'latest' } },
      { id: 'b_trig', type: 'trigger', x: 440, y: 420, w: 320, h: 300, settings: { source: 'bus', topic: 'lol/+/light', every: 10, gapSec: 2, perHour: 1800 } },
      { id: 'b_decide', type: 'code', x: 800, y: 420, w: 340, h: 130, settings: { code: DECIDE, about: 'Dark (light below 1500) → 1, the LED on; bright → 0.', folded: true } },
      { id: 'b_back', type: 'send', x: 1200, y: 420, w: 320, h: 250, settings: { transport: 'bus', topic: 'lol/board1/led' } },
      { id: 'b_say', type: 'code', x: 800, y: 620, w: 340, h: 130, settings: { code: SAY, about: 'Says what the board read and what the Computer answered.', folded: true } },
      { id: 'b_view', type: 'preview', x: 1200, y: 740, w: 340, h: 220, settings: { mode: 'markdown' } },
      { id: 'b_sketch', type: 'note', x: 1600, y: 140, w: 520, h: 820, settings: { text: SKETCH, locked: true } },
    ],
    wires: [
      { from: 'b_trig', to: 'b_decide', port: 'in' },
      { from: 'b_decide', to: 'b_back', port: 'in' },
      { from: 'b_trig', to: 'b_say', port: 'in' },
      { from: 'b_decide', to: 'b_say', port: 'in' },
      { from: 'b_say', to: 'b_view', port: 'content' },
    ],
  },
};
`;
fs.writeFileSync('renderer/chat/computer/templates/board-on-wifi.mjs', wifi);
console.log('ok board-on-wifi', wifi.length);
