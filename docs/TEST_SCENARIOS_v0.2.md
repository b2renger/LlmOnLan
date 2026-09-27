# Test scenarios — LlmOnLan v0.2.x

Hands-on checks for everything new since v0.1.45, for a person with the real apps, a farm and (for some)
a board. Each scenario says what to do and what you should see. Tick the box when it holds; write down
what you saw when it does not.

**What was already tested without you:** unit tests, the scripted harness (a fake farm), and on 2026-09-27
a dev farm plus a dev client on this box (see [NIGHT_LOG_2026-09-27.md](NIGHT_LOG_2026-09-27.md)). What only
you can check: the installers and the update, real boards and lights, and how it all feels.

**You need:** the farm box with the Farm app, one client computer (two for the LAN scenarios), and for some
scenarios an Arduino Uno/Nano or an ESP32 with a USB **data** cable, a microphone recording (any .wav/.mp3),
and TouchDesigner or Max (OSC). Scenarios marked **(no farm)** work with the farm switched off.

---

## 1. Install, update, data

- [ ] **1.1 Client auto-update.** On a machine with v0.1.45, open the app; Preferences ▸ Startup & updates ▸
  *Check for app updates* → *Restart & install*. It restarts as v0.2.x (Preferences ▸ About).
- [ ] **1.2 Your history survives the update.** The LOL Vibe history (the old LOL Chat conversations) and the
  Computer's graphs are all there after 1.1. Preferences ▸ Data location says everything lives in that folder.
- [ ] **1.3 Farm app update.** Download farm-v0.0.39 (or newer) from GitHub Releases and install it over the
  old one. The panel opens; the model and its settings are as before.
- [ ] **1.4 The engine update.** Preferences ▸ About shows Open WebUI **0.11.4**. A chat in Open WebUI works;
  a PDF attached in Open WebUI is read (the farm's OCR).
- [ ] **1.5 The name.** The topbar says **LOL Vibe** (not LOL Chat). An old `.lolchat.json` export still
  imports.

## 2. The farm

- [ ] **2.1 New plugins are off by default.** Farm panel ▸ Plugins lists *Classify (Laya)*, *Speech to text*
  and *Message bus (MQTT · WebSocket · OSC)*, all off.
- [ ] **2.2 Turning one on does not block the farm.** Enable *Classify*. The first time it installs ~1 GB:
  meanwhile the farm keeps answering chats (a client chats normally), and Classify shows healthy once ready.
- [ ] **2.3 Password → plugin keys.** Set a farm password (panel ▸ Apply). A v0.2 client asks for it once;
  after that, OCR, Classify and Listen work on that client. `http://<farm>:41997/lol/self` shows `"key": null`
  for the plugins (no key in clear). *Known:* a v0.1.45 client on a farm with a password loses the farm's
  OCR until it updates.
- [ ] **2.4 Restart keeps working.** Restart the farm (the Farm app's **Stop**, then **Start**). Within ~30 s,
  open clients use OCR/Classify again without restarting.

## 3. The Computer — the new boxes

- [ ] **3.1 The ? on every box (no farm).** Place a few boxes (Text, Code, Split, Send). Each has a small
  **?** next to ▶. Click it: a graph *Example — <box>* opens with a yellow note (what it does, inputs,
  output, how to use it) and a small working setup. *Run all* on Code, Split, Collect, Repeat works with no
  farm. Click the same ? again: the same example graph opens (not a copy).
- [ ] **3.2 Read the news.** Learn ▸ Templates ▸ *Read the news* ▸ Run all. It ends in a bar chart. With
  Classify off: the footer says *0 by Laya*. With Classify on (2.2): most stories *by Laya*. No digit
  written by the model appears in the title/subtitle/insight (they show *…*). Change *Topics*, run again.
- [ ] **3.3 Fetch.** A Fetch box with an open-data address (a JSON API) returns data. `http://localhost:…`
  and `http://<farm>:4000/…` are refused with a sentence. Unplug the network: it hands on its last copy and
  says *Offline*.
- [ ] **3.4 Classify directly.** Text box with 5 headlines (one per line) → Classify, options *hardware,
  science, politics, other*. Each gets a label and a confidence; the unsure ones are listed under *check*.
- [ ] **3.5 Write code.** ＋ Think ▸ *Write code*, instruction "count the words of each line". Wire a Text
  box into it and into a Code box; wire *Write code* into the Code box's **code** port. Run: the Code box
  shows the model's program and its result. Type in the code: it says *Your code*; *Use the model's code*
  gives it back. *Hide the code* folds it behind *What it does*.
- [ ] **3.6 See what it drew.** An SVG box → ＋ Think ▸ *Describe a picture*. Run: the model describes the
  drawing.
- [ ] **3.7 Listen (speech to text on).** A Sound box with a recording, *Listen* on → an Instruction
  "answer the question in the recording". Run: the words flow on. Export the graph, import it: Listen is
  **off** after the import.
- [ ] **3.7b Ask out loud** (on main after v0.2.1, in the next release). Learn ▸ Templates ▸ *Ask out loud*: record a
  question, turn Listen on, Run all — the answer shows and is spoken.
- [ ] **3.8 Speak.** Text → Speak (*This computer*): you hear it, nothing leaves. *Farm* voice (Kokoro on):
  the farm's voice. Stop during speech: it stops.
- [ ] **3.9 d3.** A Code box: `const x = d3.scaleLinear().domain([0,10]).range([0,100]); return x(5);`
  → 50.
- [ ] **3.10 Open data.** ＋ Bring in ▸ **Open data**. On www.data.gouv.fr open any dataset with a CSV (e.g.
  search "festivals"), copy the address, paste it, ▶. The face says *<title> · N rows · N columns · read 200*.
  Also try a **file** link (a file's "copy link") and a dataset with only PDFs (it names the formats it has).
  A link from another site is refused in words.
- [ ] **3.11 Analyse a dataset.** Learn ▸ Templates ▸ *Analyse a dataset* ▸ Run all: a page (the model's
  reading, then a table of every column), a bar chart, and an answer to the question. Paste another dataset's
  link and change the question, run again. Check: numbers in the page's table and on the chart match the
  dataset's page on data.gouv.fr; the model's text has no digits (they show *…*); the answer starts *In the
  first 200 rows of …*. Unplug the network: it still runs from its copy and says *Offline*.
- [ ] **3.13 The Agent.** ＋ Think ▸ **Agent**. (a) The **?** example (readings → Agent): ▶ — the answer gives
  the average and the largest, and *How it got there* shows the run_code step with the numbers it computed.
  (b) Wire an **Open data** box on *Fréquentation des Musées de France* (▶ it first) into an Agent, *Web hosts
  it may read* = `tabular-api.data.gouv.fr`, task: *"Over the whole file, which 5 regions had the most museum
  visitors in total? The tabular API …/api/resources/<file id>/data/?<column>__groupby&<column>__sum groups and
  sums the whole file."* — expect Île-de-France first (≈ 362.7 million), in 3–4 steps. (c) Empty the hosts
  field: fetch is no longer offered, and it can only work from what is wired in (the 200-row sample) — check
  its answer says so rather than claiming whole-file totals. The run bar says *1–6 generations*.
- [ ] **3.14 Ask a dataset.** Learn ▸ Templates ▸ *Ask a dataset*: ▶ the Open data box, then ▶ the Agent on the
  default question (the 5 regions with the most music festivals). Expect Provence-Alpes-Côte d'Azur 416,
  Auvergne-Rhône-Alpes 408, Occitanie 386, Nouvelle-Aquitaine 345, Bretagne 315 (whole file, 2026-09-28),
  with every step shown. Ask your own question; paste another dataset.
- [ ] **3.12 Different models.** Run *Analyse a dataset* and *Read the news* with gemma4:12b, then with
  qwen3.8 and nemotron if the farm serves them (each Instruction's model picker). Note which one writes a
  working program for 3.11's question.

## 4. Acting on the world (be careful with real lights)

- [ ] **4.1 Dry run by default.** Text "0.75" → Send (OSC 127.0.0.1:9000 `/lol/level`). Run: *Dry run —
  would send: OSC …*. TouchDesigner receives nothing.
- [ ] **4.2 Arming asks.** Run bar ▸ *Outputs: dry run*: a question lists **every** target (one per line;
  local ones say *this computer*). Arm: the button reads *Outputs: LIVE* (amber). Run: TouchDesigner's OSC In
  gets **0.75 as a number**.
- [ ] **4.3 Disarm on reload and graph switch.** Armed → open another graph → back: a dry run again.
  Armed → reload the window (Ctrl+R): a dry run again.
- [ ] **4.4 Panic.** With a DMX node (Art-Net) and a light: a Text `[255, 128, 0]` → Send (DMX, universe 0).
  Arm, run: the light turns on. Press **Panic** (visible whenever the graph has a Send box): the run stops
  and the light goes dark. Quitting the app also blacks it out.
- [ ] **4.5 The 3-per-second DMX cap.** Two Send boxes to the same universe (the node's IP and the broadcast
  address). A fast graph cannot send more than 3 frames a second to that universe in total; the box says
  *Held back*.

## 5. A board on the USB cable (Arduino Uno/Nano or ESP32)

- [ ] **5.1 The sketch.** Upload `docs/examples/arduino/lol_serial/lol_serial.ino` (also in the template's Text
  box). Serial Monitor at 115200: `{"light":…}` every half second; `led 1` lights the LED. **Close the
  Serial Monitor.**
- [ ] **5.2 Receive.** ＋ Bring in ▸ **Receive** ▸ *Choose the board…*: the popover lists the board; pick it.
  The face shows *Last line: {"light":…}* updating live.
- [ ] **5.3 Talk to a board.** Learn ▸ Templates ▸ *Talk to a board*. Choose the board on the three boxes,
  arm the outputs, Run all: the LED takes the 0.75 brightness; cover the sensor, run again: the Code box
  says `led 1` and the LED switches on (the round trip).
- [ ] **5.4 Busy port.** Open the Arduino Serial Monitor, then run: the box says the board is busy (close
  the Serial Monitor).

## 6. Boards on Wi-Fi — the farm's message bus

- [ ] **6.1 Turn it on.** Farm panel ▸ Plugins ▸ *Message bus* ▸ Enable.
- [ ] **6.2 An ESP32 on the bus.** Upload `docs/examples/arduino/lol_mqtt/lol_mqtt.ino` with your Wi-Fi, the
  farm's address and password. Serial Monitor: *Farm: connected*. From a PC: `mosquitto_sub -h <farm> -t
  'lol/#' -v -u lol -P <password>` shows the readings.
- [ ] **6.3 Receive from the bus.** A Receive box, *From: the farm's message bus*, topic `lol/+/light`: the
  face shows the ESP32's readings live.
- [ ] **6.4 Trigger, disarmed.** ＋ Control ▸ **Trigger** on `lol/+/light`, → Code → Send (the farm's bus,
  `lol/<board>/led`). Disarmed: its face counts events, *0 runs*, *not armed*.
- [ ] **6.5 Trigger, armed.** Arm the outputs: each reading starts a run (at most one every *N* seconds),
  the LED follows what the Code box decides. Hide the Computer (switch to Open WebUI): runs stop; come back:
  they resume. The hourly cap stops runs and says so.
- [ ] **6.6 OSC.** TouchDesigner sends `/light 0.5` to `<farm>:9001`: a Receive box on `osc/light` gets
  0.5. On a farm with a password, OSC **writes** need no password but land only under `osc/…` (owner
  decision, 2026-09-27); reading needs it.
- [ ] **6.7 A board on Wi-Fi.** Learn ▸ Templates ▸ *A board on Wi-Fi* with the ESP32 of 6.2 (BOARD =
  board1). Arm the outputs: the Trigger runs the graph on each reading, the page shows *board1 says …*,
  covering the sensor switches the LED on (the answer goes back on `lol/board1/led`).

## 7. Open WebUI drives the Computer (MCP)

- [ ] **7.1 The tool is there.** In Open WebUI, a new chat ▸ the tools menu under the message field lists
  **LlmOnLan Computer**; turn it on.
- [ ] **7.2 A model builds a graph.** Ask: *"On my Computer, create a graph called Test with a note that says
  hello, then run it."* Switch to the Computer: the graph is there, with the note, and has run.
- [ ] **7.3 Never the outputs.** Arm the outputs in the Computer, then ask Open WebUI to run a graph: it
  answers that only a person may run it while the outputs are armed.

## 8. After testing

- [ ] Everything above is ticked, or each failure is written down with what you saw.
- [ ] Farm panel: turn off the plugins you do not want on for users (Classify, Speech to text, Message bus
  are off by default).
