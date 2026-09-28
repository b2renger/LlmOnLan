// @ts-check
// The Send box and the run bar's outputs control (docs/ECOSYSTEM_PLAN.md v2 §3.5, P3a). One file per
// unit, same namespace pattern: see strings/parts-text.en.mjs for why.
import { registerStrings } from '../core/i18n.mjs';

registerStrings('parts', {
  sendLabel: 'Send',
  sendIn: 'value',
  sendTransport: 'Send by',
  sendTransport_osc: 'OSC (UDP)',
  sendTransport_artnet: 'DMX over Art-Net',
  sendTransport_mqtt: 'MQTT publish',
  sendTransport_ws: 'WebSocket',
  sendTransport_http: 'HTTP POST',
  sendTransport_serial: 'USB serial (Arduino, ESP32)',
  sendTransport_bus: 'The farm’s message bus',
  busErrOffline: 'The farm’s message bus did not answer.',
  sendHost: 'Host',
  sendPort: 'Port',
  sendAddress: 'OSC address',
  sendUniverse: 'Universe',
  sendTopic: 'Topic',
  sendUrl: 'Address',
  sendThisComputer: 'this computer',
  sendHint: 'Sends what arrives to a device. Nothing leaves until a person arms the outputs in the run bar; until then every run is a dry run that shows what would be sent. At most 20 messages a second to one target, and 3 DMX frames a second.',
  sendTransportHint: 'How to reach the device: pick what it understands.',
  sendHostHint: 'The device’s address on the network, like 192.168.1.40. 127.0.0.1 is this computer.',
  sendPortHint: 'The device’s port. The farm’s own ports are refused.',
  sendAddressHint: 'The OSC address the device listens on. It starts with /.',
  sendUniverseHint: 'The DMX universe to light, from 0.',
  sendTopicHint: 'The topic to publish on, like lol/computer (no + or #).',
  sendUrlHint: 'A ws:// or http:// address. No user name or password in it.',
  sendDry: 'Dry run — would send: {summary}',
  sendSent: 'Sent: {summary}',
  sendNoDoor: 'This version of the app cannot send to devices — update LlmOnLan.',
  sendEmpty: 'Nothing to send: wire something into this box.',
  sendErr_E_TARGET: 'Check the target: {message}.',
  sendErr_E_FARM: 'Port {message} is one of the farm’s own ports; outputs never go there.',
  sendErr_E_RATE: 'Held back: {message}. Slow the graph down (a Timer), and the next message goes.',
  sendErr_E_SEND: 'The device did not take it: {message}',
});

registerStrings('computer', {
  outputsDry: 'Outputs: dry run',
  outputsLive: 'Outputs: LIVE',
  outputsDryHint: 'Dry run: Send boxes only show what they would send, and Trigger boxes start no run. Press to arm the outputs.',
  outputsLiveHint: 'Armed: Send boxes send to devices, and Trigger boxes can start runs by themselves. Press to go back to a dry run.',
  outputsArmTitle: 'Arm the outputs?',
  outputsArmBody: 'From now on this graph acts for real: its Send boxes send to real devices, and its Trigger boxes can start runs by themselves while the Computer is on screen.\n{targets}\nDMX is capped at 3 frames a second per universe. That does not limit a fixture\u2019s own strobe channel, or lights driven any other way (OSC, MQTT, WebSocket, HTTP, USB, the farm\u2019s bus): keep strobes off. Panic stops the run and blacks out the lights.\nPress Outputs again to go back to a dry run. Opening another graph, or restarting the app, does that too.',
  outputsArmOk: 'Arm',
  outputsPanic: 'Panic',
  outputsPanicHint: 'Stop the run and every output now, send a blackout to every DMX universe a graph lit, and go back to a dry run.',
  outputsPanicked: 'Outputs stopped and back to a dry run. {n} DMX universe(s) blacked out.',
});
