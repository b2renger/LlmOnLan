# Home Assistant in LlmOnLan

Link your [Home Assistant](https://www.home-assistant.io/) once, and assistants can read your home and, when you
allow it, switch its devices:

- **Ask and command** in Open WebUI, typed or spoken: "Is the bed light on? Turn it on at 30 %." Turn on the
  **LlmOnLan Computer** tool for the chat (**Integrations ▸ Tools**, under the message box).
- **Agents act on the home**: in LOL Vibe, a project's agent with **Use the Computer** on reads the home and acts on
  it. This works for one reply, **Keep going** or **On a schedule**, e.g. "every 30 minutes, if it is colder than
  18 °C outside and the living room window is open, close it and add a line to log.md".
- **Graphs on the Computer** (2026-10-09): a **Home** box reads the devices you choose, a **Home command** box switches
  one; lessons 13–14 and the templates *Morning briefing*, *Comfort advisor* and *Energy report* use them (below).

Works best with a model that calls tools well (Qwen 3.8). Built 2026-09-30 (`shell/src/main/homeAssistant.ts`).

## Link it

1. In Home Assistant: your profile ▸ **Security** ▸ **Long-lived access tokens** ▸ Create token. Copy it.
2. In LlmOnLan: **Preferences ▸ Home Assistant**. Type the address (e.g. `http://homeassistant.local:8123`),
   paste the token, click **Link**. LlmOnLan asks Home Assistant before keeping anything; the line then reads
   `Linked: <your home> · Home Assistant <version> · N entities, M devices`.
3. **Test connection** asks again. **Forget** removes the address and the token.

The address and the token stay on this computer, in the app's settings folder (`home-assistant.json`). The token is
encrypted by the operating system and is never handed back to the page. Where the operating system cannot
encrypt (some Linux desktops without a keyring), the token is not kept, and linking says so.

## Reading is free, commands are a dry run until you allow them

Reading the home is always allowed: the list of devices and sensors, and one entity's state, attributes and
actions. A model never gets a coordinate: where people are and where the home is (latitude, longitude) are left out.
Who is home or away is not: it is what "who is home?" asks.

A **command** is a **dry run** until you click **Allow commands…**. The model is told what it would have done
("DRY RUN — nothing was switched. It would be light.turn_on on Bed Light…") and that you can allow commands.

**Allow commands…** opens a dialog from LlmOnLan itself, not a web page, so no page and no model can press it. The
dialog lists the devices a model may then switch, grouped by kind: it names up to 30 of each kind and counts the rest,
and the count at the top is the whole list. Exactly those devices: one added to the home later is refused until you
allow commands again. While commands are allowed, the top bar shows
**Home commands on · N**. Click it, or **Stop commands**, to stop. Allowing is forgotten when LlmOnLan closes, when its
window reloads, and whenever the link changes (a Link that fails changes nothing).

**Never by a model**, even when allowed: unlocking or opening a lock, disarming or triggering an alarm, sounding a
siren, opening a valve (water or gas; a model may close one), opening a door, a gate or a garage. You do those in
Home Assistant. A cover (a garage door is a cover to Home
Assistant) opens only when Home Assistant says it is a blind, a curtain, a shade, a shutter, an awning or a window; one
that does not say what it is can be closed, never opened. Also:

- One command names **one** device, and only with an action on LlmOnLan's list for its kind: turn on/off, brightness,
  temperature, volume, play/pause, position, a script or a scene started… Actions that reach past the one device are
  never used by a model: running another script by name, `scene.apply`/`create`, playing a URL on a speaker, sending a
  remote's raw codes. Area, device or label targets a model adds are dropped.
- Only devices and the helpers that drive them can be commanded (lights, switches, covers, climate, media players,
  fans, vacuums, valves, scenes, scripts, buttons, numbers, selects, and the helpers `input_boolean`, `input_number`,
  `input_select`, `input_button`). Sensors, people, cameras, updates, notifications and Home Assistant itself are
  read-only.
- A command Home Assistant does not confirm within 20 s is reported as "sent, not confirmed": it may still be
  happening, so the model is told to read the device before trying again.
- At most one command a second per device, and 30 a minute in all.

What LlmOnLan cannot know is what a switch, a button, a helper, a number, a select, a scene or a script is **wired**
to in your home: a "switch" can be a gate's relay, a script can unlock a door, a helper such as "alarm bypass" can
disarm through an automation. Allowing commands allows those too, and the dialog says so. If a model
must never touch one of them, keep commands off while it could.

## What leaves this computer

LlmOnLan's main process sends requests to the address **you** typed, with your token (never to another address:
a redirect is refused, not followed): it reads states and the list of actions, and it sends commands, only while you
allow them. Open WebUI and the project's agent reach the home through the Computer's MCP server on 127.0.0.1, which
answers the three home tools (`home_devices`, `home_state`, `home_command`) itself: they work with the Computer
closed.

A Computer **Home** box asks the same address for the devices you ticked; what it reads stays on the canvas, and goes to
the farm only inside an Instruction you wire it into (like any text). A **Home command** box sends its one command only
when the outputs are armed and commands are allowed.

What a model read about your home is in that chat: it goes to the farm with the chat, like anything said in it, and
the chat's history on this computer keeps it (LlmOnLan keeps no copy of its own). It can also leave **with the
model's other tools in the same chat**. In Open WebUI, web search (off by default; the globe button turns it on for a
chat) gives the model a tool that fetches any web address; a web page, a document or even a text in Home Assistant
could steer it into fetching an address that carries what it read (who is away, the alarm's state). **Leave web search
off in a chat that uses your home** (Integrations, under the message box). A project's agent can likewise write what it read into a file of the
project, and a page there runs when you open its Preview.

## On the Computer: the Home boxes (design, 2026-10-09)

Until 2026-10-09 a graph could not reach the home at all: the three tools were answered in main for MCP only (Open
WebUI, the project's agent), the Agent box's `fetch` goes through `io.ts` with no token, and a Fetch of the home's
address gets a 401. Two boxes now reach it through the SAME main module (`homeAssistant.ts`), so every rule above
holds unchanged and none is copied into the page:

- **Home** (*bring*, type `home`): reads the devices and sensors a **person** picked (Choose… lists the home; at most
  30). Its value is JSON: `{ home, at, devices: [{ id, name, state, value, unit, attributes, … }], missing }`, the
  attributes without coordinates or places (`HIDDEN_ATTRS`, compared without case: `latitude`, `Location`,
  `coordinates`…). A **weather** entity also brings its forecast for the next days (`weather.get_forecasts`, a
  read-only action main calls with the entity the person picked), a **calendar** its events of the next 24 hours
  (`/api/calendars/<id>`; summary, times and description, not the place), and "History" (1–168 hours) adds each one's
  past values (`/api/history/period`, at most 240 points per device) — never for `person`, `device_tracker` or `zone`,
  at most 720 device-hours in one read (4 devices × 168 h, 30 × 24 h), one history read every 5 s, an 8 MB answer at
  most: Home Assistant's history query has no limit of its own and a Green has 4 GB. Reading stays free. Only with
  **no home linked** does the box hand on the copy it holds (a lesson's or template's, or its last reading), saying so
  on its face; a linked home that does not answer, or lacks the devices, is an error, so a template's made-up reading
  can never drive a real device.
- **Home command** (*show*, type `home-command`): ONE action on ONE device, both picked by a **person** in the box
  (Choose… then the action list, which holds only what `ACTIONS` and `neverByModel` allow for that device), with the
  details in its own **With** (`{"brightness_pct": 40}`; `entity_id`, `area_id`… dropped, as for a model). What arrives
  on its arrow is ONLY the go signal, never the details. It is a **dry run** unless BOTH:
  1. a person **armed the outputs** in the Computer's run bar — whose question lists every Home command of the graph
     (the device id first, the action and the details) beside the Send targets; which cannot be done while a run is
     going (a run never turns live half-way); and which a reload, Panic or another graph undoes; and
  2. a person **allowed home commands** in Preferences ▸ Home Assistant (main's native dialog), and the device is on
     that list.
  Main checks both: `lol:home:command` reads `outputs.ts`'s `isArmed()` itself and takes only the device, the action
  and the details from the page. The outputs are armed by the page's own question (as for a Send box), so the gate a
  compromised page cannot pass is the native Allow list. The never-list (locks, alarms, sirens, valves, covers that do
  not say they are blinds-like), the per-domain allowlist, one command a second per device and 30 a minute (shared
  with the MCP tools) all apply. Why both: allowing home commands lasts until LlmOnLan closes, so without the outputs'
  arming a graph someone hands you could switch an allowed device the moment you press Run all, without you seeing
  which. Panic stops further commands; it does not undo what was switched.
- **A model never picks the device.** The MCP tools drop `entities` (Home) and `entity`, `action`, `data` (Home
  command) from a model's settings and say they are left for a person (`PERSON_ONLY`). And while the outputs are
  armed no MCP tool changes or runs a graph, so a graph a model runs is always a dry run for the home.
- The token never reaches the page: the page asks main for states, entities, actions and commands; main holds the
  link.

Not done, on purpose: a Trigger on a home state change (it would need Home Assistant's WebSocket API, the upgrade
path below; a Trigger "every N seconds" in front of a Home box polls instead), and a Home box choosing its devices
from a wire.

### The research behind them (2026-10-09)

- **The Home Assistant Green** (Nabu Casa): Rockchip RK3566 (4 × Cortex-A55 at 1.8 GHz), 4 GB RAM, 32 GB eMMC, Gigabit
  Ethernet, 2 × USB 2.0, HDMI for diagnostics only, ~1.7 W idle; **no Wi-Fi, Bluetooth, Zigbee or Thread radio**. It runs
  Home Assistant OS with its 1,000+ integrations, reaches network (Wi-Fi/Ethernet) devices and Matter over Wi-Fi out of
  the box, and Zigbee/Thread (and Matter over Thread) only with the **Connect ZBT-2** USB dongle. Home Assistant Cloud
  (Nabu Casa) is optional — LlmOnLan never uses it: a LAN address and a long-lived token only.
  Sources: [home-assistant.io/green](https://www.home-assistant.io/green/),
  [home-assistant.io/connect/zbt-2](https://www.home-assistant.io/connect/zbt-2),
  [CNX Software on the Green](https://www.cnx-software.com/?p=160185).
- **The REST API** the boxes use (all with the long-lived token): `GET /api/states`, `/api/states/<id>`,
  `/api/services`, `/api/history/period/<start>?filter_entity_id=…&minimal_response&no_attributes`,
  `/api/calendars/<id>?start=…&end=…`, and `POST /api/services/weather/get_forecasts?return_response` (the forecast is
  no longer a weather attribute since 2024). Source:
  [developers.home-assistant.io/docs/api/rest](https://developers.home-assistant.io/docs/api/rest/). All checked against
  Home Assistant 2026.9 in WSL (below).

### The lessons and templates (what an office's Green really has)

A Home Assistant Green is Ethernet only, with no radio: out of the box it reaches what is on the network (Wi-Fi and
Ethernet devices: smart plugs that measure power, Hue lights through their bridge, Chromecast/Sonos speakers,
printers, Matter-over-Wi-Fi), and Zigbee/Thread sensors only through a Connect ZBT-1/ZBT-2 dongle. Every install has
the met.no **weather** (made at onboarding) and the sun; a **calendar** (Local Calendar, CalDAV) is one integration
away. So the shelf uses what an office or a school is most likely to have: temperature, humidity, CO2 (AirGradient
and similar are local), a power-measuring plug, a light, the weather and a calendar.

- **Lesson 13 · read the room** — Home → an Instruction writes a plain summary → Speak.
- **Lesson 14 · switch the home** — Home command: a dry run, then the outputs armed and home commands allowed.
- **Template: Morning briefing** — weather + calendar + room → a few sentences, shown and said.
- **Template: Comfort advisor** — CO2 and temperature → code decides (the numbers rule) → a suggestion, and the fan
  or plug turned on through a Home command.
- **Template: Energy report** — a power sensor's last 24 hours → a chart drawn by code → a model says what it shows.

Every one ships a saved reading, so it walks without a home (and without a farm, with the saved answers).

## Rig checks on the real Green (a person, with the installed client)

They are test **H4** in [HUMAN_TESTS.md](HUMAN_TESTS.md) (the one list of what a person still has to do; moved there
2026-10-09). Use the office Green, linked by its owner (never a shared token).

## Not built

- Live changes: LlmOnLan asks Home Assistant when a model or a box asks (REST). Its WebSocket API, which pushes changes
  as they happen, is the upgrade path for a loop that must react faster than it polls (and for a Trigger on a state).
- LOL Vibe's plain chat (outside a project) has no tools, so it cannot reach the home.

## A private test home (how it was verified)

Home Assistant Core with its **demo** devices (123 entities: lights, locks, covers, an alarm panel…) on this machine
only, in WSL:

```bash
# in WSL (Ubuntu); uv brings its own Python, no sudo needed
uv venv --managed-python --python 3.14 ~/lol-ha && VIRTUAL_ENV=~/lol-ha uv pip install homeassistant
mkdir -p ~/lol-ha-config   # configuration.yaml: homeassistant (name, time zone…), api, onboarding, frontend, config, person, demo
~/lol-ha/bin/hass -c ~/lol-ha-config   # keep this wsl.exe in the foreground
```

Home Assistant 2026.9 keeps its HTTP settings in `.storage/http`, not in YAML, and a changed setting must be
confirmed within 5 minutes or it reverts and restarts. To keep it on loopback, set `stable.server_host` to
`["127.0.0.1"]` (and `pending` to null) in `~/lol-ha-config/.storage/http` while it is stopped. With WSL's mirrored
networking, Windows reaches it at `http://127.0.0.1:8123`. Onboarding and a long-lived token can be done through its
API (`POST /api/onboarding/users`, `/auth/token`, then the WebSocket's `auth/long_lived_access_token`).

What was checked on 2026-09-30, with qwen3.8 on a private farm and an isolated client:

- Linking through Preferences (the `/api` suffix forgiven); the token encrypted on disk.
- The native dialog listing the 59 devices; commands allowed by a real click.
- Open WebUI, "Is the bed light on? Turn it on at 30 %, then tell me the outside temperature": two tool calls; the
  light went from off to on at 30 % and 15.6 °C was the sensor's real value.
- Commands stopped from the top bar: "Turn off the kitchen lights" came back as a dry run and the lights stayed on.
  "Unlock the front door" was refused and the door stayed locked.
- A project's agent with **Use the Computer**: it read the temperature and the window, closed the open living room
  window (open 70 → closed 0) and wrote `home-report.md`, in 6 steps and 18 s.

What was checked on 2026-10-09 against the same test home (harness `k26-home`: the real `homeAssistant.js` and
`outputs.js` in a chat-only Electron, the demo's creds in `LOL_HARNESS_HA`): Choose… listed the home and its search found
the CO2 sensor; a reading of five devices brought the met.no forecast, the calendar's events and an hour of history, with
no coordinate; a Home command on the bed light said "Arm the outputs" (not armed), then "Allow home commands" (armed, not
allowed) while the light stayed off, then turned it on at 30 % (brightness 76 of 255) once both were done; "unlock" on the
front door was refused and it stayed locked; after Panic the next run was a dry run.

Not tried yet: speaking the request (Open WebUI turns speech into text on this computer, then it is the same chat), a
real Home Assistant with real devices, and a schedule driving the home.
