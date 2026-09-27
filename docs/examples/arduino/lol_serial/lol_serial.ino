// lol_serial — talk to the LlmOnLan Computer over a USB cable, both ways.
// Works on an Arduino Uno / Nano and on an ESP32. Open it in the Arduino IDE, pick your board and port,
// press Upload. Then, in the Computer, a Send box ("Send by: USB serial") talks TO the board and a
// Receive box listens to what the board says.
//
// THE PROTOCOL — one line = one message, at 115200 baud:
//   The Computer sends a line:            the board does:
//     a number 0..1   (e.g. 0.75)         sets the LED's brightness (0 = off, 1 = full)
//     a number 2..255 (e.g. 128)          sets the LED's brightness on the 0..255 scale
//     led 1  /  led 0                     switches the LED fully on / off
//     every 500                           sends a reading every 500 ms (100..10000); "every 0" stops
//   The board sends, on its own, one JSON object per line:
//     {"light":512,"ms":12345}            the light sensor on A0 (0..1023 on an Uno, 0..4095 on an ESP32)
//     {"ok":"led","value":191}            after each command, what it did
//     {"error":"unknown: hello"}          when it did not understand a line
// A Code box reads a line with JSON.parse(inputs.in[0]).
//
// WIRING (optional — without it you still see the built-in LED and a floating reading):
//   Uno:   an LED + 220 Ω resistor on pin 9 (a PWM pin), a light sensor (LDR + 10 kΩ) divider on A0
//   ESP32: an LED + 220 Ω resistor on GPIO 2 (the built-in LED on most boards), a sensor on GPIO 34

#if defined(ESP32)
const int LED_PIN = 2;
const int SENSOR_PIN = 34;
#else
const int LED_PIN = 9;
const int SENSOR_PIN = A0;
#endif

unsigned long everyMs = 500;   // how often a reading is sent (0 = never)
unsigned long lastSent = 0;
String line = "";

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  line.reserve(64);
  Serial.println("{\"hello\":\"lol_serial\",\"every\":500}");
}

void setLed(int value) {           // 0..255
  value = constrain(value, 0, 255);
  analogWrite(LED_PIN, value);     // on an ESP32 (core 3.x) analogWrite drives the LED with PWM too
  Serial.print("{\"ok\":\"led\",\"value\":");
  Serial.print(value);
  Serial.println("}");
}

void handle(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;
  if (cmd == "led 1") { setLed(255); return; }
  if (cmd == "led 0") { setLed(0); return; }
  if (cmd.startsWith("every ")) {
    long ms = cmd.substring(6).toInt();
    everyMs = (ms == 0) ? 0 : (unsigned long) constrain(ms, 100, 10000);
    Serial.print("{\"ok\":\"every\",\"value\":");
    Serial.print(everyMs);
    Serial.println("}");
    return;
  }
  // A number: 0..1 is a fraction of full brightness, anything above is already 0..255.
  char first = cmd.charAt(0);
  if ((first >= '0' && first <= '9') || first == '.' || first == '-') {
    float v = cmd.toFloat();
    setLed(v <= 1.0 ? (int) (v * 255.0 + 0.5) : (int) v);
    return;
  }
  Serial.print("{\"error\":\"unknown: ");
  Serial.print(cmd.substring(0, 40));   // never echo a long line back
  Serial.println("\"}");
}

void loop() {
  // Read what the Computer sent, one character at a time, until the end of a line.
  while (Serial.available() > 0) {
    char c = (char) Serial.read();
    if (c == '\n' || c == '\r') { handle(line); line = ""; }
    else if (line.length() < 60) line += c;   // a line longer than that is cut, not a crash
  }
  // Say what the sensor reads, every `everyMs`.
  if (everyMs > 0 && millis() - lastSent >= everyMs) {
    lastSent = millis();
    Serial.print("{\"light\":");
    Serial.print(analogRead(SENSOR_PIN));
    Serial.print(",\"ms\":");
    Serial.print(lastSent);
    Serial.println("}");
  }
}
