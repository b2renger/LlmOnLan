# Arduino and ESP32 examples for the Computer

Code to put on a microcontroller so it can talk with the LlmOnLan **Computer**. `lol_serial` runs on the
board and on this computer only, over the USB cable. `lol_mqtt` goes over Wi-Fi to the farm's message bus
on your own network. Nothing here goes to the internet.

| Folder | Board | What it shows |
|---|---|---|
| [`lol_serial/`](lol_serial/lol_serial.ino) | Arduino Uno / Nano, ESP32 | Both ways over the USB cable: the Computer sets an LED; the board sends a light-sensor reading as one JSON line every 500 ms. |
| [`lol_mqtt/`](lol_mqtt/lol_mqtt.ino) | ESP32 | Both ways over Wi-Fi, through the farm's message bus (MQTT): the board publishes `{"light":…}` on `lol/<board>/light` every second and sets its LED from `lol/<board>/led`. Needs the **PubSubClient** library and the farm's *Message bus* plugin. |

**Compile-checked** on 2026-09-27 with arduino-cli 1.5.2, all warnings on, none in these sketches (not yet
uploaded to a board): `lol_serial` on the Uno and the Nano (arduino:avr 1.8.8 — 7 KB of 32 KB, 352 bytes of
RAM) and on an ESP32 (esp32:esp32 3.3.12); `lol_mqtt` on an ESP32 with PubSubClient 2.8.0 (70% of the flash).

## Using `lol_serial`

1. Install the [Arduino IDE](https://www.arduino.cc/en/software) (for an ESP32, add the *esp32 by
   Espressif* boards in the Boards Manager).
2. Open `lol_serial/lol_serial.ino`, pick your board and its port, press **Upload**.
3. Check it: **Tools → Serial Monitor** at **115200** baud, line ending **Newline**. You see
   `{"light":…}` lines; type `led 1` and the LED switches on. **Close the Serial Monitor** before the
   Computer uses the port: only one program can hold it.
4. In the Computer: a **Send** box with *Send by: USB serial* talks to the board (a dry run until you arm
   the outputs), a **Receive** box (＋ → Bring in) hands on each line the board writes. Press **Choose the
   board…** on each and pick it. The **Talk to a board** template on the Learn shelf wires the round trip,
   with this sketch in a Text box.

The protocol is written at the top of the sketch: one line = one message, 115200 baud. Change it freely;
the Computer only sends what you wire into Send and hands on whatever line the board writes.

## Using `lol_mqtt`

1. On the farm, turn on the **Message bus**: admin panel ▸ *Plugins* ▸ *Message bus (MQTT · WebSocket ·
   OSC)* ▸ **Enable** (for the session), or `"bus": { "enabled": true }` in `lol.config.json` (for good).
2. In the Arduino IDE: *esp32 by Espressif* in the Boards Manager, and **PubSubClient** by Nick O'Leary in
   *Tools → Manage Libraries…*.
3. Open `lol_mqtt/lol_mqtt.ino` and fill in the six lines under *YOUR SETTINGS*: your Wi-Fi, the farm's
   address, the farm password (or `""` on a farm without one) and a name for this board. Press **Upload**.
4. Check it: **Tools → Serial Monitor** at **115200** baud says *Farm: connected*. From any computer on the
   network, `mosquitto_sub -h <farm> -t 'lol/#' -v -u lol -P <password>` shows the readings, and
   `mosquitto_pub -h <farm> -t lol/board1/led -m 0.5 -u lol -P <password>` lights the LED at half.
5. In the Computer: a **Send** box with *Send by: the farm's message bus* writes to `lol/<board>/led`, a
   **Receive** box on `lol/+/light` hands on the readings, and a **Trigger** box on a topic starts a run on
   each message (only while you have armed the outputs).

**Learn → Templates → A board on Wi-Fi** in the Computer wires this round trip, with the sketch in a Text box.

The farm keeps nothing: a message goes to whoever is subscribed at that moment, and is gone. With a farm
password, the board needs it too (username `lol`); a board with the wrong one sees state `5` in the Serial
Monitor.
