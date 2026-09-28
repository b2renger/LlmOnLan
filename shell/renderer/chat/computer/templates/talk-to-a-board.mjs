// @ts-check
// Template — Talk to a board (ecosystem plan v2 §8d, P3a-2). DATA only. GENERATED from
// docs/examples/arduino/lol_serial/lol_serial.ino by shell/scripts/gen-board-templates.cjs (a unit test keeps
// the embedded sketch equal to it).
//
// Both directions over one USB cable, and the round trip: the Computer tells the board a brightness
// (Text → Send); the board reports its light sensor (Receive); a Code box decides "dark? LED on" and a
// Send writes that back. No farm, no model: the whole loop is local. The Arduino sketch rides along in a
// Text box, so a student copies it from the Computer into the Arduino IDE.

export const SKETCH = "// lol_serial — talk to the LlmOnLan Computer over a USB cable, both ways.\n// Works on an Arduino Uno / Nano and on an ESP32. Open it in the Arduino IDE, pick your board and port,\n// press Upload. Then, in the Computer, a Send box (\"Send by: USB serial\") talks TO the board and a\n// Receive box listens to what the board says.\n//\n// THE PROTOCOL — one line = one message, at 115200 baud:\n//   The Computer sends a line:            the board does:\n//     a number 0..1   (e.g. 0.75)         sets the LED's brightness (0 = off, 1 = full)\n//     a number 2..255 (e.g. 128)          sets the LED's brightness on the 0..255 scale\n//     led 1  /  led 0                     switches the LED fully on / off\n//     every 500                           sends a reading every 500 ms (100..10000); \"every 0\" stops\n//   The board sends, on its own, one JSON object per line:\n//     {\"light\":512,\"ms\":12345}            the light sensor on A0 (0..1023 on an Uno, 0..4095 on an ESP32)\n//     {\"ok\":\"led\",\"value\":191}            after each command, what it did\n//     {\"error\":\"unknown: hello\"}          when it did not understand a line\n// A Code box reads a line with JSON.parse(inputs.in[0]).\n//\n// WIRING (optional — without it you still see the built-in LED and a floating reading):\n//   Uno:   an LED + 220 Ω resistor on pin 9 (a PWM pin), a light sensor (LDR + 10 kΩ) divider on A0\n//   ESP32: an LED + 220 Ω resistor on GPIO 2 (the built-in LED on most boards), a sensor on GPIO 34\n\n#if defined(ESP32)\nconst int LED_PIN = 2;\nconst int SENSOR_PIN = 34;\n#else\nconst int LED_PIN = 9;\nconst int SENSOR_PIN = A0;\n#endif\n\nunsigned long everyMs = 500;   // how often a reading is sent (0 = never)\nunsigned long lastSent = 0;\nString line = \"\";\n\nvoid setup() {\n  Serial.begin(115200);\n  pinMode(LED_PIN, OUTPUT);\n  line.reserve(64);\n  Serial.println(\"{\\\"hello\\\":\\\"lol_serial\\\",\\\"every\\\":500}\");\n}\n\nvoid setLed(int value) {           // 0..255\n  value = constrain(value, 0, 255);\n  analogWrite(LED_PIN, value);     // on an ESP32 (core 3.x) analogWrite drives the LED with PWM too\n  Serial.print(\"{\\\"ok\\\":\\\"led\\\",\\\"value\\\":\");\n  Serial.print(value);\n  Serial.println(\"}\");\n}\n\nvoid handle(String cmd) {\n  cmd.trim();\n  if (cmd.length() == 0) return;\n  if (cmd == \"led 1\") { setLed(255); return; }\n  if (cmd == \"led 0\") { setLed(0); return; }\n  if (cmd.startsWith(\"every \")) {\n    long ms = cmd.substring(6).toInt();\n    everyMs = (ms == 0) ? 0 : (unsigned long) constrain(ms, 100, 10000);\n    Serial.print(\"{\\\"ok\\\":\\\"every\\\",\\\"value\\\":\");\n    Serial.print(everyMs);\n    Serial.println(\"}\");\n    return;\n  }\n  // A number: 0..1 is a fraction of full brightness, anything above is already 0..255.\n  char first = cmd.charAt(0);\n  if ((first >= '0' && first <= '9') || first == '.' || first == '-') {\n    float v = cmd.toFloat();\n    setLed(v <= 1.0 ? (int) (v * 255.0 + 0.5) : (int) v);\n    return;\n  }\n  Serial.print(\"{\\\"error\\\":\\\"unknown: \");\n  Serial.print(cmd.substring(0, 40));   // never echo a long line back\n  Serial.println(\"\\\"}\");\n}\n\nvoid loop() {\n  // Read what the Computer sent, one character at a time, until the end of a line.\n  while (Serial.available() > 0) {\n    char c = (char) Serial.read();\n    if (c == '\\n' || c == '\\r') { handle(line); line = \"\"; }\n    else if (line.length() < 60) line += c;   // a line longer than that is cut, not a crash\n  }\n  // Say what the sensor reads, every `everyMs`.\n  if (everyMs > 0 && millis() - lastSent >= everyMs) {\n    lastSent = millis();\n    Serial.print(\"{\\\"light\\\":\");\n    Serial.print(analogRead(SENSOR_PIN));\n    Serial.print(\",\\\"ms\\\":\");\n    Serial.print(lastSent);\n    Serial.println(\"}\");\n  }\n}\n";

const DECIDE = "// The ROUND TRIP: what the board said decides what the Computer tells it back.\n// Dark (a low light reading) → switch the LED on; bright → off. Change 400 to suit your room.\nconst r = inputs.in.find((v) => v && typeof v === \"object\") || {};\nconst light = Number(r.light);\nif (!Number.isFinite(light)) return \"led 0\";\nreturn light < 400 ? \"led 1\" : \"led 0\";";

const SAY = "const r = inputs.in.find((v) => v && typeof v === \"object\") || {};\nconst cmd = inputs.in.find((v) => typeof v === \"string\") || \"\";\nreturn \"## The board says\\nLight: **\" + (r.light ?? \"?\") + \"**\\n\\nThe Computer answers: `\" + cmd + \"`\";";

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
          text: 'How to start\n\n1. Copy the sketch in the Text box on the far right into the Arduino IDE, pick your board (Uno, Nano or ESP32) and its port, and Upload. Close the Serial Monitor afterwards: only one program can hold the board.\n2. On each Send box and on the Receive box, press "Choose the board…" and pick it.\n3. The Send boxes are a DRY RUN until you arm the outputs: press "Outputs: dry run" in the run bar, read the list, then Arm.\n4. Press Run all.\n\nWhat happens\n- Top: the Computer tells the board a brightness (0.75 = three quarters).\n- Bottom: the board says {"light": …} every half second; Receive hands on the latest message; the Code box decides: dark → "led 1", bright → "led 0"; the second Send writes that back. That is the ROUND TRIP.\n\nNo farm, no model: everything stays on this computer and its USB cable.',
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
