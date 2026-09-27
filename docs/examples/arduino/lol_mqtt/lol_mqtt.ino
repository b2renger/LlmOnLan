// lol_mqtt — an ESP32 on Wi-Fi talks to the LlmOnLan farm's message bus (MQTT), both ways.
// The farm is the meeting point: a Computer graph, a browser page or TouchDesigner on the same network
// reads what this board publishes and writes what it listens to.
//
// BEFORE YOU UPLOAD
//   1. On the farm: the admin panel ▸ Plugins ▸ "Message bus (MQTT · WebSocket · OSC)" ▸ Enable
//      (or "bus": { "enabled": true } in lol.config.json).
//   2. Arduino IDE ▸ Tools ▸ Manage Libraries… ▸ install "PubSubClient" by Nick O'Leary.
//   3. Boards Manager: "esp32 by Espressif". Pick your ESP32 board and its port.
//   4. Fill in the six lines under YOUR SETTINGS, then press Upload.
//   5. Tools ▸ Serial Monitor at 115200 baud shows what the board is doing.
//
// THE TOPICS (BOARD is the name you give this board below):
//   The board publishes, every second:   lol/BOARD/light    {"light":1234}   (0..4095 on an ESP32)
//   The board listens to:                 lol/BOARD/led      a number 0..1   = a fraction of full brightness
//                                                            a number 2..255 = the 0..255 scale
//                                                            true / false    = fully on / off
//   The same rule as lol_serial: 0.75 and 191 give the same brightness.
//   Try it from a computer:  mosquitto_pub -h <farm> -t lol/board1/led -m 0.5 -u lol -P <password>
//
// WIRING (optional — without it you still see the built-in LED and a floating reading):
//   an LED + 220 Ω resistor on GPIO 2 (the built-in LED on most boards),
//   a light sensor (LDR + 10 kΩ divider) on GPIO 34.

#include <WiFi.h>
#include <PubSubClient.h>

// ---- YOUR SETTINGS -------------------------------------------------------------------------------
const char* WIFI_NAME     = "your-wifi";
const char* WIFI_PASSWORD = "your-wifi-password";
const char* FARM_HOST     = "192.168.1.20";  // the farm's address (the desktop client's farm card shows it)
const int   FARM_PORT     = 1883;            // the bus's MQTT port (bus.mqttPort on the farm)
const char* FARM_PASSWORD = "";              // the farm password, or "" on a farm without one
const char* BOARD         = "board1";        // give each board its own name: it is part of the topics
// ------------------------------------------------------------------------------------------------

const int LED_PIN = 2;
const int SENSOR_PIN = 34;

WiFiClient wifi;
PubSubClient mqtt(wifi);
String lightTopic;          // lol/BOARD/light
String ledTopic;            // lol/BOARD/led
unsigned long lastSent = 0;
unsigned long lastTry = 0;
bool triedOnce = false;

void setLed(int value) {                    // 0..255
  value = constrain(value, 0, 255);
  analogWrite(LED_PIN, value);              // on an ESP32 (core 3.x) analogWrite drives the LED with PWM
  Serial.print("LED -> ");
  Serial.println(value);
}

// PubSubClient calls this for every message on a topic we subscribed to.
void onMessage(char* topic, byte* payload, unsigned int length) {
  if (ledTopic != topic) return;
  String text = "";
  for (unsigned int i = 0; i < length && i < 32; i++) text += (char) payload[i];   // a long message is cut, not a crash
  text.trim();
  if (text == "true") { setLed(255); return; }
  if (text == "false") { setLed(0); return; }
  // A number: 0..1 is a fraction of full brightness, anything above is already 0..255.
  char first = text.charAt(0);
  if ((first >= '0' && first <= '9') || first == '.' || first == '-') {
    float v = text.toFloat();
    setLed(v <= 1.0 ? (int) (v * 255.0 + 0.5) : (int) v);
  }
}

void joinWifi() {
  Serial.print("Wi-Fi: joining ");
  Serial.println(WIFI_NAME);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.print("\nWi-Fi: connected, this board is ");
  Serial.println(WiFi.localIP());
}

// One try at the farm's broker.
void connectFarm() {
  // A client id unique to this board: two boards with the same id would keep pushing each other off.
  String clientId = String("lol-") + BOARD + "-" + WiFi.macAddress();
  Serial.print("Farm: connecting to ");
  Serial.print(FARM_HOST);
  Serial.print(":");
  Serial.println(FARM_PORT);
  // The username is always "lol"; the password is the farm password (ignored on a farm without one).
  if (mqtt.connect(clientId.c_str(), "lol", FARM_PASSWORD)) {
    mqtt.subscribe(ledTopic.c_str());       // subscribe after EVERY connect: the bus keeps no sessions
    Serial.println("Farm: connected");
  } else {
    // 5 = the farm password is wrong; -2 = the farm cannot be reached (address? bus enabled? same Wi-Fi?)
    Serial.print("Farm: not connected (state ");
    Serial.print(mqtt.state());
    Serial.println("), trying again in 5 s");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  lightTopic = String("lol/") + BOARD + "/light";
  ledTopic = String("lol/") + BOARD + "/led";
  joinWifi();
  mqtt.setServer(FARM_HOST, FARM_PORT);
  mqtt.setCallback(onMessage);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) joinWifi();
  if (!mqtt.connected()) {
    if (!triedOnce || millis() - lastTry >= 5000) {   // never hammer the farm: one try every 5 s
      triedOnce = true;
      lastTry = millis();
      connectFarm();
    }
    return;
  }
  mqtt.loop();                              // reads messages and keeps the connection alive: call it often
  // Say what the sensor reads, every second.
  if (millis() - lastSent >= 1000) {
    lastSent = millis();
    String message = String("{\"light\":") + analogRead(SENSOR_PIN) + "}";
    mqtt.publish(lightTopic.c_str(), message.c_str());
  }
}
