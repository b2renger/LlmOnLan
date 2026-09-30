# Home Assistant in LlmOnLan

Link your [Home Assistant](https://www.home-assistant.io/) once, and assistants can read your home and, when you
allow it, switch its devices:

- **Ask and command** in Open WebUI, typed or spoken: "Is the bed light on? Turn it on at 30 %." Turn on the
  **LlmOnLan Computer** tool for the chat (**Integrations ▸ Tools**, under the message box).
- **Agents act on the home**: in LOL Vibe, a project's agent with **Use the Computer** on reads the home and acts on
  it. This works for one reply, **Keep going** or **On a schedule**, e.g. "every 30 minutes, if it is colder than
  18 °C outside and the living room window is open, close it and add a line to log.md".

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
actions.

A **command** is a **dry run** until you click **Allow commands…**. The model is told what it would have done
("DRY RUN — nothing was switched. It would be light.turn_on on Bed Light…") and that you can allow commands.

**Allow commands…** opens a dialog from LlmOnLan itself, not a web page, so no page and no model can press it. The
dialog lists **every device** a model may then switch, grouped by kind. Exactly those devices: one added to the
home later is refused until you allow commands again. While commands are allowed, the top bar shows
**Home commands on · N**. Click it, or **Stop commands**, to stop. Allowing is forgotten when LlmOnLan closes and
whenever the link changes.

**Never by a model**, even when allowed: unlocking or opening a lock, disarming or triggering an alarm, sounding a
siren, opening a door, a gate or a garage. You do those in Home Assistant. A cover (a garage door is a cover to Home
Assistant) opens only when Home Assistant says it is a blind, a curtain, a shade, a shutter, an awning or a window; one
that does not say what it is can be closed, never opened. Also:

- One command names **one** device, and only with an action on LlmOnLan's list for its kind: turn on/off, brightness,
  temperature, volume, play/pause, position, a script or a scene started… Actions that reach past the one device are
  never used by a model: running another script by name, `scene.apply`/`create`, playing a URL on a speaker, sending a
  remote's raw codes. Area, device or label targets a model adds are dropped.
- Only kinds of devices can be commanded (lights, switches, covers, climate, media players, fans, vacuums, valves,
  scenes, scripts, buttons…). Sensors, updates, notifications and Home Assistant itself are read-only.
- At most one command a second per device, and 30 a minute in all.

What LlmOnLan cannot know is what a switch, a button, a scene or a script is **wired** to in your home: a "switch" can
be a gate's relay, a script can unlock a door. Allowing commands allows those too, and the dialog says so. If a model
must never touch one of them, keep commands off while it could.

## What leaves this computer

LlmOnLan's main process sends requests to the address **you** typed, with your token: it reads states and the list
of actions, and it sends commands, only while you allow them. Nothing about the home is stored: a model sees what
it asked for, inside that chat's context (which goes to the farm like any chat). Open WebUI and the project's agent
reach the home through the Computer's MCP server on 127.0.0.1, which answers the three home tools
(`home_devices`, `home_state`, `home_command`) itself: they work with the Computer closed.

## Not built

- A Computer **box** that reads the home or sends a command (a graph that watches a sensor). For now a project's
  agent with **Use the Computer**, **On a schedule**, covers "watch and act".
- Live changes: LlmOnLan asks Home Assistant when a model asks (REST). Its WebSocket API, which pushes changes as
  they happen, is the upgrade path for a loop that must react faster than it polls.
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

Not tried yet: speaking the request (Open WebUI turns speech into text on this computer, then it is the same chat), a
real Home Assistant with real devices, and a schedule driving the home.
