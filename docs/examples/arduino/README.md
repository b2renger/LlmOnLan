# Arduino and ESP32 examples for the Computer

Code to put on a microcontroller so it can talk with the LlmOnLan **Computer**. Everything here runs on the
board and on this computer only: nothing goes through the farm or the internet.

| Folder | Board | What it shows |
|---|---|---|
| [`lol_serial/`](lol_serial/lol_serial.ino) | Arduino Uno / Nano, ESP32 | Both ways over the USB cable: the Computer sets an LED; the board sends a light-sensor reading as one JSON line every 500 ms. |

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
