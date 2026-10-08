# Test scenarios — LlmOnLan v0.2.x

Hands-on checks for everything new since v0.1.45, for a person with the real apps, a farm and (for some)
a board. Each scenario says what to do and what you should see. Tick the box when it holds; write down
what you saw when it does not.

**What was already tested without you:** unit tests, the scripted harness (a fake farm), and on 2026-09-27
a dev farm plus a dev client on this box (see [NIGHT_LOG_2026-09-27.md](NIGHT_LOG_2026-09-27.md)). What only
you can check: the installers and the update, real boards and lights, and how it all feels.

**You need:** the farm box with the Farm app, one client computer (two for the LAN scenarios), and for some
scenarios an Arduino Uno/Nano or an ESP32 with a USB **data** cable, a microphone and a webcam (or a .wav/.mp3),
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
- [ ] **1.6 Web search off by default.** On a profile that v0.2.7 used with a farm hosting web search, update and
  open the app: in Open WebUI a new chat has the globe off, and the Integrations menu's **Web Search** switch turns
  it on. Settings ▸ Interface ▸ **Web Search in Chat** reads *Default*; set it to *Always*, quit and reopen: still
  *Always*. A brand-new profile: *Default*, globe off.

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
- [ ] **3.7b Ask out loud** (v0.2.2). Learn ▸ Templates ▸ *Ask out loud*: on the Sound box press **● Record**,
  ask a question, **■ Stop**; turn Listen on, Run all — the answer shows and is spoken through the speakers.
- [ ] **3.7c Microphone and webcam (no farm).** A Sound box: **● Record** — the first time, nothing asks (the app
  grants its own page); the button counts the seconds; **■ Stop** — the box holds *recording <date>.webm*,
  ▶ Play plays it back. An Image box: **Take a picture** — the camera shows in the box (the webcam light goes
  on); **Capture** — the picture is in the box and the light goes **off**. **Cancel** instead keeps nothing and
  the light goes off too. Then wire the Image into an Instruction "What is in this picture?" (farm on): the
  model describes what the camera saw. No camera plugged in: the box says so in words.
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
- [ ] **3.15 Lessons 5 and 6** (v0.2.2). Learn ▸ Lessons ▸ *5 · code counts, the model names*: wire the table into
  the Code box, ▶ — the totals appear (apples 17, pears 10, plums 9); wire them into the Instruction, ▶ — an answer
  in words, no digits; change a number, ▶ the Text box — the totals follow. Then *6 · a loop that stops* (no farm):
  close the ring, ▶ the Code box — it counts to 8 and stops by itself; Toggle off, ▶ — one pass (9). Each step
  ticks on the rail.
- [ ] **3.16 Lessons 7–12** (v0.2.3). Learn ▸ Lessons; each step ticks on the rail. *7 · listen and speak*: ● Record
  a question, ■ Stop, tick Listen, wire the Sound box into the Instruction, ▶ it — with the farm's Speech to text on,
  the question is written down, answered and said out loud (without it, the rail offers the saved transcript); pick
  *This computer's voice*, ▶ Speak. *8 · a picture to a model*: Take a picture ▸ Capture (the camera light goes off),
  wire, ▶ — the answer describes the real frame; change the question, ▶. *9 · act on the world* (no farm): wire, ▶
  Send — "Dry run — would send: OSC /lol/level 0.75"; **Outputs: dry run** lists `127.0.0.1:9000 /lol/level (this
  computer)` ▸ Arm, Got it; level 0.2, ▶ the Text box — "Sent: …" (a tool listening on UDP 9000 receives it);
  Panic, Got it. *10 · hear the world* (no farm): wire — the Trigger says *not armed*; arm — every 3 s the Code box
  says "Tick N, heard at …"; gap 6 — *merged* grows; disarm — no more runs. *11 · an agent with tools*: wire, name
  the arrow `readings`, ▶ the Agent — average about 14.7, largest 30, its run_code steps under *How it got there*;
  Steps at most 2, ▶ — it answers by step 2. *12 · open data*: ▶ Open data (online: data.gouv.fr now; offline: the
  copy), wire it into the Code box, ▶ the chart (on the copy: Musique 3229); wire the chart into the Instruction, ▶
  — words, no digits; type `Région principale de déroulement`, ▶ the Text box — a new chart, new words.
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
  decision, 2026-09-27); reading needs it. On farm-v0.0.41, a password typed as a NUMBER in TouchDesigner
  (`/lol/listen # 1234`) works too, and does not become the reply port.
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

## 7b. LOL Vibe's IDE — the coding agent (v0.2.3+; docs/IDE_PLAN.md)

The agent is DeepSeek Harness on the farm's model. It works only inside one project folder, with file tools
(no shell, no web). Best with qwen3.8 or nemotron on the farm.

- [ ] **7b.1 Install.** LOL Vibe ▸ a chat ▸ **Project** (the button beside *System prompt*). The panel says the
  agent is not installed: **Install the coding agent** — about 120 MB from GitHub, a progress line, then
  *installed*. Quit and reopen the app: it is still installed (nothing downloads again).
- [ ] **7b.2 A project.** Type a name, **New project**. The panel shows its name; the chat's model is qwen3.8 or
  nemotron if the farm serves one (on a gemma4-only farm the model line warns that gemma4 is weak at edits).
- [ ] **7b.3 It builds.** Ask: *"Make index.html: a three.js page with a slowly rotating cube, three 0.160.0 from
  cdn.jsdelivr.net."* Within ~30 s: the reply says what it did, the stats say *N steps · s*, **Thought for…**
  opens on the steps (*→ write index.html ✓*), the file list shows index.html and **Preview** shows the cube.
- [ ] **7b.4 It edits.** Ask: *"Add a speed slider in a corner; change nothing else."* The **Changes** tab shows
  the old and new text of each edit; the Preview reloads with the slider.
- [ ] **7b.5 You edit.** **Code** tab ▸ index.html ▸ change a colour ▸ **Save** (or Ctrl+S) ▸ **Preview**: it
  changed. **Open folder** shows the files in `<data folder>/LOL Studio Projects/`; **Open in browser** opens the
  page (only this computer can reach it).
- [ ] **7b.6 Stop.** Ask for something long, press **Stop**: the reply stops at once and says so. Ask again: it
  works, and it still knows the earlier turns (it gets a recap).
- [ ] **7b.7 Another model.** Pick nemotron in the model menu and ask for a small change: it works (the agent
  restarts on the new model). Pick gemma4: the model line warns.
- [ ] **7b.8 Nothing else leaves.** With a password on the farm (2.3), the agent still works. A normal chat (a
  thread with no project) is answered by the farm as before, not by the agent.
- [ ] **7b.9 It stays in its project.** Ask: *"Read C:/Windows/win.ini and tell me its first line."* (on a Mac:
  */etc/hosts*). The step log shows the read **refused** (*only files inside this project…*) and the answer says it
  could not read it. A read of a project file still works. (~0.4 s more per file step on Windows: expected.)
- [ ] **7b.10 History.** After two replies that changed files: **History** lists them newest first; pick the older
  one, **Go back to this version**: the Preview shows the older page, and a *Back to: …* line is on top. Code tab,
  change a word, **Save**: a *You: index.html* line appears.
- [ ] **7b.11 Share on the LAN.** **Share on the LAN** (Windows may ask about the firewall: allow on private
  networks): the panel shows `http://<this computer>:<port>/`. From a phone or another computer on the same network,
  open it: the page shows. **Stop sharing**: that address stops answering. Quit and reopen LlmOnLan: not shared.
- [ ] **7b.12 GitHub.** Make an empty repository and a fine-grained token (*Contents: read and write* on it). History ▸
  GitHub: save the `https://…git` address and the token (the field clears; the note says a token is kept). **Push**:
  the files are on GitHub. Edit a file on GitHub's website, **Pull**: the change is here. Change the same file in
  both places, **Pull**: refused with a sentence, your version kept. A wrong token: a sentence, never a crash.
- [ ] **7b.13 graphify.** Ask: *"Use the graphify skill to make a knowledge graph of this project."* Within ~2 min:
  `graphify-out/graph.json` and `GRAPH_REPORT.md` appear; click the graph: the Preview draws it (drag a node). The
  same file pasted into a Computer **Graph** box draws the same map.
- [ ] **7b.14 Keep going until done** (v0.2.6+, qwen3.8). In a new project press **Keep going until done** (the note
  says *at most 10*). Ask for the 8-point Snake game of docs/research/p5-loop-spike (score, restart, best score, arrows
  + WASD, pause, levels, a Web Audio beep with mute, swipe). One reply: *◎ Goal set* … *◎ Goal done*; the eight points
  are in the files; History has one commit. Then ask for it **one point per round**: the steps show *◎ Round 1 of 10*,
  *◎ Round 2 of 10*… in the same reply. Press **Stop** mid-loop: it ends at once. Close and reopen LlmOnLan: the switch
  is off again.
- [ ] **7b.15 On a schedule** (v0.2.6+). **Schedule…** ▸ Every **5** minutes ▸ *"Add ONE line at the end of log.md: the run
  number, a dash, one short fact about snakes you have not written yet."* ▸ **Start**. The note says the next run. Wait
  ~6 min in another chat: two ⏰ messages and two replies appear in the project's chat (none in the one you read);
  log.md has lines 1 and 2. **Stop the schedule**: no more. Set one again, close and reopen LlmOnLan: it is gone.
- [ ] **7b.16 Use the Computer** (v0.2.6+). In a project press **Use the Computer**; ask the agent to build a
  "Room monitor" graph (a Text box with a temperature, a Code box: "too hot" above 26 else "fine", a Preview) and run it
  with 24 and 29. The steps show *→ Computer: new_graph Room monitor ✓*…; the answer gives fine / too hot; the graph is
  in the Computer's library. Ask it to add a Send box (OSC to 127.0.0.1:9000): the run says it stayed a dry run. Arm the
  outputs yourself and ask for another run: the agent is refused (it may read, not run, while armed).
- [ ] **7b.17 An agent page** (v0.2.6+). Ask: *"Make an agent page: a dice coach — I ask something about dice, it rolls
  and adds with tools and shows each step."* In the Preview ask *"roll 3 dice and tell me the total"*: the steps list
  shows `roll_dice` then `sum` (or similar), and the answer's total is the sum of the faces shown. **Stop** mid-run ends
  it. On a farm with a password: the page asks for it once, then works.

## 7c. Home Assistant (v0.2.7+; docs/HOME_ASSISTANT.md)

Needs a Home Assistant: your own, or the private demo home in HOME_ASSISTANT.md. Use a tool-calling model (qwen3.8).

- [ ] **7c.1 Link.** Preferences ▸ Home Assistant: the address, a long-lived token, **Link**. The line reads
  `Linked: <home> · Home Assistant <version> · N entities, M devices`; the token field empties. A wrong token says
  Home Assistant refused it, and nothing is kept.
- [ ] **7c.2 Ask.** In Open WebUI, turn on **LlmOnLan Computer** (Integrations ▸ Tools) and ask *"Which lights are
  on at home?"*: the answer matches Home Assistant.
- [ ] **7c.3 A dry run.** Ask *"Turn off the kitchen lights."* without allowing commands: the answer says nothing
  was switched and where to allow commands; the lights did not change.
- [ ] **7c.4 Allow.** **Allow commands…**: LlmOnLan's own dialog lists the devices by kind, Cancel is the default.
  Allow: the top bar shows **Home commands on · N**. Ask again: the lights change.
- [ ] **7c.5 Never.** Ask *"Unlock the front door"* (or open the garage, or open a water valve): refused, even while
  allowed. Ask *"Where is <a person>?"*: presence (home / away), never coordinates.
- [ ] **7c.5b Web search off.** Preferences ▸ Home Assistant says to leave web search off in a chat that uses the home;
  Open WebUI's Integrations menu under the message box has that chat's Web Search switch.
- [ ] **7c.6 Stop.** Click **Home commands on** in the top bar: it disappears; a command is a dry run again. Close
  and reopen LlmOnLan: still linked, commands not allowed.
- [ ] **7c.7 An agent acts.** In a project turn on **Use the Computer** (commands allowed) and ask: *"Read the
  outside temperature; if it is below 18 °C and the living room window is open, close it, then write
  home-report.md."* The window and the report match.

## 7d. v0.2.8 and farm-v0.0.42 — seats, web search, thinking (docs/DEVLOG.md, 2026-10-04 to 10-06)

What the tests cannot show: the installed client, an updated Farm app, real engines under load. Install the client
from the release, not a dev build, on Windows and on macOS or Linux: web search reads its pages in a worker started
from inside the installed app, and if that fails it quietly falls back to the search engines' one-line snippets. For
the Computer use a thinking model (Qwen3.6 on vLLM, or qwen3.8). Put back every farm setting a check changes. The
`curl` lines are for a bash shell (Git Bash, macOS, Linux).

- [ ] **7d.1 Web search off, once.** Do 1.6 with the installed v0.2.8 updated from v0.2.7, on Windows and on macOS or
  Linux. On the first launch Open WebUI reloads once by itself; on the next launch it does not.
- [ ] **7d.2 The date line.** On a profile whose Open WebUI system prompt was empty (Settings ▸ General ▸ **System
  Prompt**), after the update it reads `Today is {{CURRENT_WEEKDAY}} {{CURRENT_DATE}}.`, and in a new chat with the
  globe off *"What is today's date?"* gets today's weekday and date. On a profile where you had written a system
  prompt before the update, it is unchanged. Empty it, quit and reopen: it stays empty.
- [ ] **7d.3 Web search reads the pages.** A farm with web search on. In Open WebUI, Admin Panel ▸ Settings ▸ **Web
  Search** shows the engine *external* at `http://127.0.0.1:41995/web/search`. Turn the globe on and ask about
  something from this week (a match result, a software release): the answer is right and names its sources. Open the
  search's results under the answer: each is several paragraphs of its page, often with a *(published …)* line, not
  a one-line snippet (one-liners on every result: the page reader failed, write down the OS). The first word comes a
  few seconds later than with the globe off.
- [ ] **7d.4 Web search when its port is taken.** Quit LlmOnLan, take the port in a terminal
  (`python -m http.server 41995 --bind 127.0.0.1`) and open LlmOnLan. Admin Panel ▸ Settings ▸ Web Search shows
  *searxng* and the farm's address; a question with the globe on still gets an answer with sources (shorter: the
  engines' snippets); the tools menu has no *LlmOnLan Computer* this time. Stop the server, quit and reopen:
  *external* again.
- [ ] **7d.5 The queue in the pill.** On a vLLM farm, from the farm box:
  `lol bench --users 140 --rounds 1 --max-tokens 1000` (vLLM runs 128 at once; on llama.cpp with one slot,
  `--users 3`). While it runs, a client's pill is amber and reads *<farm> · 47/48 free · 12 waiting* (the numbers vary), and its tooltip says the messages are
  queued at the model and a new one waits its turn. When the bench ends, it goes back. On Ollama it never shows
  (Ollama does not report a queue).
- [ ] **7d.6 Think all.** The Computer's toolbar has **Think all** beside Cap, unticked. A Text box *"A train leaves at
  9:40 and the trip takes 2 h 35 min. The meeting starts at 12:20."* → a Condition, *Decide by: asking the model*,
  question *"Does the train arrive before the meeting starts?"*: ▶ — it reads **yes** (12:15), and its cost line shows
  several seconds and hundreds of tokens (a yes/no decision thinks either way). An Instruction, *Answer shape: List*,
  *"The prime numbers between 1 and 30"*: ▶ — fast, few tokens. Tick **Think all** and ▶ the list again: several
  times the time and tokens, the same list. Untick it, quit and reopen: still unticked.
- [ ] **7d.7 An agent page waits for a seat.** Farm panel: *People served at once* **1** ▸ **Apply changes** (on
  Ollama, then restart the farm; under vLLM, `"parallel": 1` in `external` and a farm restart), and *Free an idle
  seat after* **1 min**. A second computer chats once in LOL Vibe: it holds the only seat. Here, ask the agent page
  of 7b.17 something: its status line says *The farm is full: a seat frees in about …; checking again in …*, and
  about a minute after the other computer's reply the page goes on by itself and answers. Ask again and press
  **Stop** during the wait: it ends at once.
- [ ] **7d.8 An agent page and a wrong password.** On a farm with a password, give the agent page a wrong one: it
  says the farm did not accept the password and asks again (never *Failed to fetch*). The right one works.
- [ ] **7d.9 The Farm app update.** On a test box first. Copy the `secret_key` line of `.searxng/settings.yml` in the
  Farm app's farm folder (`%APPDATA%\LlmOnLan Farm\farm\` on Windows), then install farm-v0.0.42 over farm-v0.0.41
  and open it. The panel shows the model, its settings and the password as before. The first line of settings.yml
  now says *lol-settings v4* (or later), the `secret_key` is the same, and the engine list has Swisscows and no
  Yandex; a search on the farm box's `http://127.0.0.1:8888` names Swisscows beside some results. Each connected
  client's Open WebUI restarts once (the plugin keys become permanent), and not again at the next farm restart
  (7d.15).
- [ ] **7d.10 The seat gate's answers.** On a farm with a password, from a client:
  `curl -i http://<farm>:4000/v1/chat/completions -H "content-type: application/json" -d '{"model":"assistant","messages":[{"role":"user","content":"hi"}]}'`
  → **401**, *Wrong or missing farm password…*, and the panel's *Generation seats* line shows no new seat. With one
  seat (as in 7d.7) held by another computer, the same with `-H "Authorization: Bearer <password>"` → **429**, *All 1
  seats on this server are in use…*, and a `Retry-After` header.
- [ ] **7d.11 Only the routes clients use.** On the vLLM farm:
  `curl -i --path-as-is -X POST http://<farm>:4000/vllm/../invocations -H "content-type: application/json" -d '{"model":"assistant"}'`,
  then the same with `/vllm/%2E%2E/tokenize`: the farm refuses both (never a 200), and vLLM's log
  (`~/lol-vllm/logs/vllm.log`) shows no request for them. Then everything still works through the farm: an Open WebUI
  chat and its title, a PDF attached, LOL Vibe, a Computer Instruction, the coding agent (7b.3), an agent page
  (7b.17), `lol status` and `lol bench`.
- [ ] **7d.12 Seats against context, before Apply.** Farm panel, under *People served at once* and *Context window*: a
  line says what each person gets (*Each person gets 32k of context…*) and what Open WebUI does with it. Change
  *People served at once* without applying: it reads *After Apply, each person gets…*. On llama.cpp, pick a number
  that takes each person under 24k: it says Open WebUI reads the 8 most relevant passages of a document, and that
  every connected Open WebUI restarts once. Put it back: that warning goes. Under an external vLLM the line shows
  the declared values.
- [ ] **7d.13 The workshop setting.** Farm panel ▸ *Free an idle seat after* ▸ **2 min** ▸ **Apply changes**: it
  applies at once (the farm does not restart, no client reloads). Chat once from a client and wait: about 2 min after
  the reply the panel's *Generation seats* line drops it and the client's pill shows one more free seat. Restart the
  farm: still 2 min (`"seatIdleSec": 120` in lol.config.json). Put it back to 15 min.
- [ ] **7d.14 The reply limit.** On an Ollama farm, add `"maxReplyTokens": 1024` to `proxy` in lol.config.json and
  restart the farm. In Open WebUI ask *"Write a 3,000-word story about a lighthouse."*: the reply stops mid-sentence
  after about 750 words. The same request in a Computer Instruction writes on past that (a request's own limit wins on
  Ollama and llama.cpp). Remove the line and restart. On vLLM the limit is serve.sh's: the start of vLLM's log names
  `max_new_tokens` 32768 among its settings.
- [ ] **7d.15 Plugin keys: the same after a restart, new after a password change.** On a farm with no password, note
  `extract.key` in `http://<farm>:41997/lol/self`. Restart the farm (Stop, then Start): the same key, and no connected
  client's Open WebUI restarts. Set a password ▸ Apply changes: after its restart `extract.key` is `null` and
  `extract.keyId` is new; a client given the password reads PDFs again (2.3), and the old key is refused:
  `curl -i -X PUT http://<farm>:8890/process -H "Authorization: Bearer <old key>" --data-binary @notes.txt` → **401**.
  Restart again: the same `keyId`. Change the password: a new `keyId`.
- [ ] **7d.16 vLLM on the Windows PRO 6000.** On farm-v0.0.42 (update the Farm app first: an older farm refuses
  `presencePenalty` and does not start), follow farm/README *External: a vLLM you run yourself* (*On Windows (WSL2)*): the vLLM window
  prints *ready*, the panel names the external engine with its declared seats and a Performance card, a client chats,
  and **Stop** in LOL Vibe ends a reply at once. Close the vLLM window: `nvidia-smi` is back to the desktop's ~1.5 GB,
  the farm goes unhealthy within 10 s and clients fail over, and it serves again once serve.sh is back, with no farm
  restart. Reboot the box: the startup task brings vLLM back, and it keeps running (serve.sh stops when its input
  closes); a farm that started before *ready* serves its built-in engine until it is restarted.
- [ ] **7d.17 vLLM on a DGX Spark.** On the Spark (Linux, no WSL): farm/vllm's `install.sh`, then
  `serve.sh --max-model-len 32768`, with `"contextLength": 32768, "parallel": 8` in `external` (the Spark serves about
  8 people on Qwen3.6, docs/spike/RESULTS.md). Start serve.sh at boot (a systemd unit; it must keep serve.sh's input
  open) and reboot: vLLM comes back before the farm, and a client chats. Write down anything the recipe needed on the
  Spark.
- [ ] **7d.18 The GB10 clock.** On the Spark under load (`lol bench --users 8`),
  `nvidia-smi --query-gpu=clocks.sm,power.draw --format=csv -l 5` shows at least 1,400 MHz and 40 W. Near 700 MHz the
  GPU is latched after an out-of-memory crash: a reboot does not clear it, a cold power drain does (RESULTS.md,
  finding 6). Check that the warning is where an operator setting up a Spark reads it.

## 8. After testing

- [ ] Everything above is ticked, or each failure is written down with what you saw.
- [ ] Farm panel: turn off the plugins you do not want on for users (Classify, Speech to text, Message bus
  are off by default).
