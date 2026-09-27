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
  sendHint: 'Sends what arrives to a device. Nothing leaves until a person arms the outputs in the run bar; until then every run is a dry run that shows what would be sent.',
  sendDry: 'Dry run — would send: {summary}',
  sendSent: 'Sent: {summary}',
  sendNoDoor: 'This version of the app cannot send to devices — update LlmOnLan.',
  sendEmpty: 'Nothing to send: wire a value into this box.',
  sendErr_E_TARGET: 'Check the target: {message}.',
  sendErr_E_FARM: 'Port {message} is one of the farm’s own ports; outputs never go there.',
  sendErr_E_RATE: 'Held back: {message}. Slow the graph down (a Timer), and the next message goes.',
  sendErr_E_SEND: 'The device did not take it: {message}',
});

registerStrings('computer', {
  outputsDry: 'Outputs: dry run',
  outputsLive: 'Outputs: LIVE',
  outputsDryHint: 'Send boxes only show what they would send. Press to arm the outputs.',
  outputsLiveHint: 'Send boxes are sending to devices. Press to go back to a dry run.',
  outputsArmTitle: 'Arm the outputs?',
  outputsArmBody: 'From now on, the Send boxes of this graph send to real devices:\n{targets}\nDMX is capped at 3 frames a second per universe. That does not limit a fixture\u2019s own strobe channel, or lights driven over OSC, MQTT, WebSocket or HTTP: keep strobes off. Panic stops the run and blacks out the lights.',
  outputsArmOk: 'Arm',
  outputsPanic: 'Panic',
  outputsPanicHint: 'Stop the run and every output now, and send a blackout to every DMX universe a graph lit.',
  outputsPanicked: 'Outputs stopped. {n} DMX universe(s) blacked out.',
});
