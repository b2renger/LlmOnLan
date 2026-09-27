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
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-send.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

export const TRANSPORTS = Object.freeze(['osc', 'artnet', 'mqtt', 'ws', 'http']);
/** Literal maps, so lint rule 5 can see every key a person may read. */
const TRANSPORT_KEY = {
  osc: 'parts.sendTransport_osc', artnet: 'parts.sendTransport_artnet', mqtt: 'parts.sendTransport_mqtt',
  ws: 'parts.sendTransport_ws', http: 'parts.sendTransport_http',
};
const ERR_KEY = {
  E_TARGET: 'parts.sendErr_E_TARGET', E_FARM: 'parts.sendErr_E_FARM', E_RATE: 'parts.sendErr_E_RATE', E_SEND: 'parts.sendErr_E_SEND',
};
/** The default port per transport (Art-Net's own, OSC's usual, MQTT's). */
const DEFAULT_PORT = { osc: 9000, artnet: 6454, mqtt: 1883 };

/** partId -> the face's status line (a render hint, never persisted). */
const notes = new Map();

/** PURE: the request the choke point gets — the person's target, the wire's value. @param {any} s @param {any} value */
export function requestFor(s, value) {
  const transport = TRANSPORTS.includes(String(s.transport)) ? String(s.transport) : 'osc';
  const r = /** @type {any} */ ({ transport, value });
  if (transport === 'ws' || transport === 'http') r.url = String(s.url || '');
  else {
    r.host = String(s.host || '').trim();
    r.port = Number(s.port) || /** @type {any} */ (DEFAULT_PORT)[transport];
    if (transport === 'osc') r.address = String(s.address || '');
    if (transport === 'artnet') r.universe = Number(s.universe) || 0;
    if (transport === 'mqtt') r.topic = String(s.topic || '');
  }
  return r;
}

/** Every target the Send boxes of `doc` name, for the arming question. @param {any} doc @returns {string[]} */
export function targetsIn(doc) {
  const out = [];
  for (const p of (doc && Array.isArray(doc.parts) ? doc.parts : [])) {
    if (p.type !== 'send') continue;
    const r = requestFor(p.settings || {}, null);
    const where = r.url || `${r.host}:${r.port}${r.address ? ' ' + r.address : ''}${r.topic ? ' ' + r.topic : ''}${r.transport === 'artnet' ? ' universe ' + r.universe : ''}`;
    const name = t(/** @type {any} */ (TRANSPORT_KEY)[r.transport]);
    out.push(`${name} → ${where}`);
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
  defaults: () => ({ transport: 'osc', host: '127.0.0.1', port: 9000, address: '/lol', universe: 0, topic: 'lol/computer', url: '' }),

  render(host, part, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'graph-send';
    wrap.title = t('parts.sendHint');
    const select = document.createElement('select');
    select.className = 'graph-send-transport';
    select.setAttribute('aria-label', t('parts.sendTransport'));
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
    const status = document.createElement('p');
    status.className = 'graph-send-status';
    select.addEventListener('change', () => {
      const tr = select.value;
      const patch = /** @type {any} */ ({ transport: tr });
      if (/** @type {any} */ (DEFAULT_PORT)[tr]) patch.port = /** @type {any} */ (DEFAULT_PORT)[tr];
      ctx.update(patch);
      commit(t('parts.sendTransport'));
    });
    wrap.append(select, hostF.node, portF.node, addrF.node, uniF.node, topicF.node, urlF.node, status);
    host.replaceChildren(wrap);

    /** @param {any} p */
    const paint = (p) => {
      const s = p.settings || {};
      const tr = TRANSPORTS.includes(String(s.transport)) ? String(s.transport) : 'osc';
      if (document.activeElement !== select) select.value = tr;
      const byUrl = tr === 'ws' || tr === 'http';
      hostF.node.hidden = byUrl; portF.node.hidden = byUrl; urlF.node.hidden = !byUrl;
      addrF.node.hidden = tr !== 'osc'; uniF.node.hidden = tr !== 'artnet'; topicF.node.hidden = tr !== 'mqtt';
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
    const r = await door.send(requestFor(input.part.settings || {}, toPlain(arrived)));
    if (!r || r.ok !== true) {
      notes.delete(id);
      const code = r && Object.prototype.hasOwnProperty.call(ERR_KEY, r.code) ? r.code : 'E_SEND';
      throw partFail(t(/** @type {any} */ (ERR_KEY)[code], { message: String((r && r.message) || '') }), 'part');
    }
    const line = r.sent ? t('parts.sendSent', { summary: r.summary }) : t('parts.sendDry', { summary: r.summary });
    notes.set(id, line);
    return valueOf('text', line);
  },
});
