// @ts-check
// Send (docs/ECOSYSTEM_PLAN.md v2 §3.5, P3a) — hands what arrives to a device: OSC, DMX over Art-Net,
// an MQTT publish, a WebSocket message or an HTTP POST. The TARGET is typed by a person in the box's
// own fields (no wire can choose where a graph sends); only the VALUE comes from the wire.
//
// The rules live in ONE place, the main process (src/main/outputs.ts), reached through the ONE door
// (projects/bridge.mjs outputsDoor): disarmed by default and after every reload, a dry run shows what
// would be sent; never the farm's ports; a rate limit per target; DMX at most 3 frames a second;
// Panic in the run bar blacks out every universe a graph lit.
//
// What a value becomes: OSC — a number, a string, true/false, or a list of them as the arguments;
// DMX — a list of channel levels (channel 1 first) or an object {"12": 255}; MQTT / WebSocket / HTTP —
// the text, or the JSON of anything else.

import { toPlain, valueOf } from '../values.mjs';
import { partFail } from './common.mjs';
import { textField, numberField } from './fields.mjs';
import { outputsDoor } from '../../projects/bridge.mjs';
import { writeLine, DEFAULT_BAUD } from '../../net/serial.mjs';
import { publish } from '../../net/bus.mjs';
import { boardRow } from './board-picker.mjs';
import { homeTarget } from './home.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-send.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

export const TRANSPORTS = Object.freeze(['bus', 'osc', 'artnet', 'mqtt', 'ws', 'http', 'serial']);
/** Literal maps, so lint rule 5 can see every key a person may read. */
const TRANSPORT_KEY = {
  osc: 'parts.sendTransport_osc', artnet: 'parts.sendTransport_artnet', mqtt: 'parts.sendTransport_mqtt',
  ws: 'parts.sendTransport_ws', http: 'parts.sendTransport_http', serial: 'parts.sendTransport_serial', bus: 'parts.sendTransport_bus',
};
const ERR_KEY = {
  E_TARGET: 'parts.sendErr_E_TARGET', E_FARM: 'parts.sendErr_E_FARM', E_RATE: 'parts.sendErr_E_RATE', E_SEND: 'parts.sendErr_E_SEND',
};
/** Why a USB write failed (net/serial.mjs codes). */
const SERIAL_ERR = {
  'no-serial': 'parts.boardErrNoSerial', 'not-found': 'parts.boardErrNotFound', busy: 'parts.boardErrBusy', lost: 'parts.boardErrLost',
};
/** Why a bus publish failed (net/bus.mjs codes). */
const BUS_ERR = { 'no-bus': 'parts.busErrNoBus', offline: 'parts.busErrOffline' };
/** The default port per transport (Art-Net's own, OSC's usual, MQTT's). */
const DEFAULT_PORT = { osc: 9000, artnet: 6454, mqtt: 1883 };

/** partId -> the face's status line (a render hint, never persisted). */
const notes = new Map();

/** PURE: the request the choke point gets — the person's target, the wire's value. @param {any} s @param {any} value */
export function requestFor(s, value) {
  const transport = TRANSPORTS.includes(String(s.transport)) ? String(s.transport) : 'osc';
  const r = /** @type {any} */ ({ transport, value });
  if (transport === 'ws' || transport === 'http') r.url = String(s.url || '');
  else if (transport === 'serial') r.serialPort = String(s.serialPort || '');
  else if (transport === 'bus') r.topic = String(s.topic || '').trim();
  else {
    r.host = String(s.host || '').trim();
    r.port = Number(s.port) || /** @type {any} */ (DEFAULT_PORT)[transport];
    if (transport === 'osc') r.address = String(s.address || '');
    if (transport === 'artnet') r.universe = Number(s.universe) || 0;
    if (transport === 'mqtt') r.topic = String(s.topic || '');
  }
  return r;
}

/**
 * PURE: what is sent for what arrived. Text that IS a number, a list or an object (a Text box holding
 * `0.75` or `[255, 128, 0]`) is sent as that value: an OSC float, DMX levels. Anything else goes as it
 * came (release critic R5: typed levels used to go out as a string, and DMX read them as a blackout).
 * @param {any} plain @returns {any}
 */
export function sendValue(plain) {
  if (typeof plain !== 'string') return plain;
  const s = plain.trim();
  if (!/^(-?\d|\[|\{)/.test(s)) return plain;
  try {
    const v = JSON.parse(s);
    return typeof v === 'number' || (v && typeof v === 'object') ? v : plain;
  } catch { return plain; }
}

/** PURE: what a USB line carries: text as it is, anything else as JSON. @param {any} v @returns {string} */
export function lineOf(v) {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** Every target the Send boxes of `doc` name, for the arming question. @param {any} doc @returns {string[]} */
export function targetsIn(doc) {
  const out = [];
  for (const p of (doc && Array.isArray(doc.parts) ? doc.parts : [])) {
    // A Home command acts on the home once the outputs are armed (and home commands allowed): the question names it too.
    if (p.type === 'home-command') { const line = homeTarget(p); if (line) out.push(line); continue; }
    if (p.type !== 'send') continue;
    const r = requestFor(p.settings || {}, null);
    // A board: its label AND its id (critic S2) — a label is free text; the id is the port a person picked.
    const board = [String((p.settings && p.settings.serialLabel) || ''), String(r.serialPort || '')].filter(Boolean);
    const where = r.transport === 'serial' ? (board.length === 2 && board[0] !== board[1] ? `${board[0]} (${board[1]})` : board[0] || '?') : r.transport === 'bus' ? String(r.topic || '?') : r.url || `${r.host}:${r.port}${r.address ? ' ' + r.address : ''}${r.topic ? ' ' + r.topic : ''}${r.transport === 'artnet' ? ' universe ' + r.universe : ''}`;
    const name = t(/** @type {any} */ (TRANSPORT_KEY)[r.transport]);
    // A target on this very computer is said so: arming a shared graph must not hide a POST to a local service.
    let host = String(r.host || '');
    if (r.url) { try { host = new URL(r.url).hostname; } catch { host = ''; } }
    const local = /^(127\.|localhost$|\[?::1\]?$|0\.0\.0\.0$)/i.test(host);
    out.push(`${name} → ${where}${local ? ` (${t('parts.sendThisComputer')})` : ''}`);
  }
  return out;
}

/** @type {PartSpec} */
export const sendPart = /** @type {any} */ ({
  type: 'send',
  order: 895,
  label: t('parts.sendLabel'),
  thinks: false,
  size: { w: 320, h: 250 },
  inputs: [{ name: 'in', label: t('parts.sendIn'), accepts: ['text', 'json', 'list'] }],
  output: 'text',
  defaults: () => ({ transport: 'osc', host: '127.0.0.1', port: 9000, address: '/lol', universe: 0, topic: 'lol/computer', url: '', serialPort: '', serialLabel: '', baud: DEFAULT_BAUD }),

  render(host, part, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'graph-send';
    wrap.title = t('parts.sendHint');
    const select = document.createElement('select');
    select.className = 'graph-send-transport';
    select.setAttribute('aria-label', t('parts.sendTransport'));
    select.title = t('parts.sendTransportHint');
    for (const tr of TRANSPORTS) {
      const o = document.createElement('option');
      o.value = tr;
      o.textContent = t(/** @type {any} */ (TRANSPORT_KEY)[tr]);
      select.appendChild(o);
    }
    const commit = (/** @type {string} */ label) => ctx.commit(label);
    const hostF = textField(t('parts.sendHost'), part.settings.host, { onInput: (v) => ctx.update({ host: v }), onCommit: () => commit(t('parts.sendHost')) });
    const portF = numberField(t('parts.sendPort'), Number(part.settings.port) || 9000, 1, (n) => { ctx.update({ port: n }); commit(t('parts.sendPort')); }, 65535);
    const addrF = textField(t('parts.sendAddress'), part.settings.address, { onInput: (v) => ctx.update({ address: v }), onCommit: () => commit(t('parts.sendAddress')), placeholder: '/lol' });
    const uniF = numberField(t('parts.sendUniverse'), Number(part.settings.universe) || 0, 0, (n) => { ctx.update({ universe: n }); commit(t('parts.sendUniverse')); }, 32767);
    const topicF = textField(t('parts.sendTopic'), part.settings.topic, { onInput: (v) => ctx.update({ topic: v }), onCommit: () => commit(t('parts.sendTopic')), placeholder: 'lol/computer' });
    const urlF = textField(t('parts.sendUrl'), part.settings.url, { onInput: (v) => ctx.update({ url: v }), onCommit: () => commit(t('parts.sendUrl')), placeholder: 'ws://192.168.1.40:81/ or http://…' });
    hostF.node.title = t('parts.sendHostHint');
    portF.node.title = t('parts.sendPortHint');
    addrF.node.title = t('parts.sendAddressHint');
    uniF.node.title = t('parts.sendUniverseHint');
    topicF.node.title = t('parts.sendTopicHint');
    urlF.node.title = t('parts.sendUrlHint');
    const board = boardRow(ctx, part);
    const status = document.createElement('p');
    status.className = 'graph-send-status';
    select.addEventListener('change', () => {
      const tr = select.value;
      const patch = /** @type {any} */ ({ transport: tr });
      if (/** @type {any} */ (DEFAULT_PORT)[tr]) patch.port = /** @type {any} */ (DEFAULT_PORT)[tr];
      ctx.update(patch);
      commit(t('parts.sendTransport'));
    });
    wrap.append(select, hostF.node, portF.node, addrF.node, uniF.node, topicF.node, urlF.node, board.node, status);
    host.replaceChildren(wrap);

    /** @param {any} p */
    const paint = (p) => {
      const s = p.settings || {};
      const tr = TRANSPORTS.includes(String(s.transport)) ? String(s.transport) : 'osc';
      if (document.activeElement !== select) select.value = tr;
      const byUrl = tr === 'ws' || tr === 'http';
      const bySerial = tr === 'serial';
      const byBus = tr === 'bus';
      hostF.node.hidden = byUrl || bySerial || byBus; portF.node.hidden = byUrl || bySerial || byBus; urlF.node.hidden = !byUrl;
      board.node.hidden = !bySerial;
      board.update(p);
      addrF.node.hidden = tr !== 'osc'; uniF.node.hidden = tr !== 'artnet'; topicF.node.hidden = tr !== 'mqtt' && !byBus;
      hostF.update(s.host); portF.update(Number(s.port) || 1); addrF.update(s.address); uniF.update(Number(s.universe) || 0);
      topicF.update(s.topic); urlF.update(s.url);
      status.textContent = notes.get(String(p.id)) || '';
    };
    paint(part);
    return { update: paint, destroy() { wrap.remove(); } };
  },

  async run(input) {
    const id = String(input.part.id);
    const arrived = ((input.inputs && input.inputs.in) || [])[0];
    if (!arrived) throw partFail(t('parts.sendEmpty'), 'empty');
    const door = outputsDoor();
    if (!door) throw partFail(t('parts.sendNoDoor'), 'part');
    const r = await door.send(requestFor(input.part.settings || {}, sendValue(toPlain(arrived))));
    if (!r || r.ok !== true) {
      notes.delete(id);
      const code = r && Object.prototype.hasOwnProperty.call(ERR_KEY, r.code) ? r.code : 'E_SEND';
      throw partFail(t(/** @type {any} */ (ERR_KEY)[code], { message: String((r && r.message) || '') }), 'part');
    }
    // USB serial: main said it may go (armed, within the rate); the page writes the line itself.
    const st = input.part.settings || {};
    if (r.sent && st.transport === 'serial') {
      const w = await writeLine(String(st.serialPort || ''), Number(st.baud) || DEFAULT_BAUD, lineOf(sendValue(toPlain(arrived))));
      if (!w.ok) { notes.delete(id); throw partFail(t(/** @type {any} */ (SERIAL_ERR)[/** @type {any} */ (w).code] || SERIAL_ERR.lost), 'part'); }
    }
    // The farm's bus: main said it may go; the page publishes through the farm's hub.
    if (r.sent && st.transport === 'bus') {
      const caps = input.app && input.app.farm && typeof input.app.farm.get === 'function' ? input.app.farm.get() : null;
      const p = await publish(caps, String(st.topic || '').trim(), sendValue(toPlain(arrived)));
      if (!p.ok) { notes.delete(id); throw partFail(t(/** @type {any} */ (BUS_ERR)[/** @type {any} */ (p).code] || BUS_ERR.offline), 'part'); }
    }
    const line = r.sent ? t('parts.sendSent', { summary: r.summary }) : t('parts.sendDry', { summary: r.summary });
    notes.set(id, line);
    return valueOf('text', line);
  },
});
