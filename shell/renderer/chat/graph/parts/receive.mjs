// @ts-check
// Receive (ecosystem plan v2 §8d, P3a-2 + P3b) — what the world says, coming INTO a graph, from:
//   - a board on the USB cable (one line per message, docs/examples/arduino/lol_serial): a JSON line
//     flows on as data, so a Code box reads `inputs.in[0].light`;
//   - the farm's MESSAGE BUS (a topic filter, MQTT wildcards + and #): boards on MQTT, tools on OSC and
//     other Computers meet there; each message flows on as {topic, data}, so a graph listening to
//     `lol/+/light` knows which board spoke.
// It hands on the latest message, or every new one since its last run. It listens while it is on screen,
// so its face shows the last message live. Nothing here sends and nothing here starts a run: that is the
// Trigger box's job, behind the outputs' arming.

import { valueOf, listOf } from '../values.mjs';
import { partFail } from './common.mjs';
import { ensureOpen, linesOf, onLine, DEFAULT_BAUD } from '../../net/serial.mjs';
import { subscribe } from '../../net/bus.mjs';
import { boardRow } from './board-picker.mjs';
import { textField } from './fields.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-receive.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

export const TRANSPORTS = Object.freeze(['serial', 'bus']);
const TRANSPORT_KEY = { serial: 'parts.receiveFrom_serial', bus: 'parts.receiveFrom_bus' };
export const TAKES = Object.freeze(['latest', 'new']);
const TAKE_KEY = { latest: 'parts.receiveTake_latest', new: 'parts.receiveTake_new' };
/** Why the port would not open (net/serial.mjs codes). */
const OPEN_ERR = { 'no-serial': 'parts.boardErrNoSerial', 'not-found': 'parts.boardErrNotFound', busy: 'parts.boardErrBusy' };
/** How long a run waits for a first message from a source that has said nothing yet. */
export const FIRST_LINE_WAIT_MS = 3000;
const MAX_KEPT = 200;

/** partId -> how many messages had arrived at this box's last run (the "since last run" cursor). */
const cursors = new Map();
/** partId -> what the bus brought this box: { filter, items: [{topic, data}], count, off }. */
const heard = new Map();

/** PURE: one line → a value: JSON (an object, a list, a number) as data, anything else as text. @param {string} line */
export function valueOfLine(line) {
  const s = String(line).trim();
  if (/^(-?\d|\[|\{)/.test(s)) {
    try {
      const v = JSON.parse(s);
      if (typeof v === 'number' || (v && typeof v === 'object')) return valueOf('json', v);
    } catch { /* not JSON: text */ }
  }
  return valueOf('text', String(line));
}

/** Listen to the bus for this box (idempotent per filter). @param {string} id @param {any} caps @param {string} filter */
export function listenBus(id, caps, filter) {
  const cur = heard.get(id);
  if (cur && cur.filter === filter) return cur;
  if (cur) cur.off();
  const entry = { filter, items: /** @type {{topic: string, data: any}[]} */ ([]), count: 0, off: () => {}, listeners: new Set() };
  entry.off = subscribe(caps, filter, (topic, data) => {
    entry.items.push({ topic, data });
    entry.count += 1;
    if (entry.items.length > MAX_KEPT) entry.items.shift();
    for (const fn of entry.listeners) { try { fn(topic, data); } catch { /* a listener's own problem */ } }
  });
  heard.set(id, entry);
  return entry;
}

/** What a run of this box hands on, from `items` (oldest first) and the cursor. PURE.
 * @param {string} take @param {any[]} items @param {number} count @param {number|undefined} since
 * @returns {{items: any[], cursor: number}} */
export function takeFrom(take, items, count, since) {
  if (take !== 'new') return { items: items.length ? [items[items.length - 1]] : [], cursor: count };
  const from = since === undefined ? count - items.length : since;
  return { items: items.slice(Math.max(0, items.length - (count - from))), cursor: count };
}

/** @type {PartSpec} */
export const receivePart = /** @type {any} */ ({
  type: 'receive',
  order: 34,
  label: t('parts.receiveLabel'),
  thinks: false,
  size: { w: 320, h: 220 },
  inputs: [],
  output: 'json',
  defaults: () => ({ transport: 'serial', serialPort: '', serialLabel: '', baud: DEFAULT_BAUD, topic: 'lol/#', take: 'latest' }),

  render(host, part, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'graph-receive';
    wrap.title = t('parts.receiveHint');
    const from = document.createElement('select');
    from.className = 'graph-receive-take';
    from.setAttribute('aria-label', t('parts.receiveFrom'));
    from.title = t('parts.receiveFromHint');
    for (const k of TRANSPORTS) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = t(/** @type {any} */ (TRANSPORT_KEY)[k]);
      from.appendChild(o);
    }
    from.addEventListener('change', () => { ctx.update({ transport: from.value }); ctx.commit(t('parts.receiveFrom')); });
    const board = boardRow(ctx, part);
    const topicF = textField(t('parts.receiveTopic'), part.settings.topic, { onInput: (v) => ctx.update({ topic: v }), onCommit: () => ctx.commit(t('parts.receiveTopic')), placeholder: 'lol/+/light' });
    topicF.input.title = t('parts.receiveTopicHint');
    const take = document.createElement('select');
    take.className = 'graph-receive-take';
    take.setAttribute('aria-label', t('parts.receiveTake'));
    take.title = t('parts.receiveTakeHint');
    for (const k of TAKES) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = t(/** @type {any} */ (TAKE_KEY)[k]);
      take.appendChild(o);
    }
    take.addEventListener('change', () => { ctx.update({ take: take.value }); ctx.commit(t('parts.receiveTake')); });
    const live = document.createElement('p');
    live.className = 'graph-receive-live';
    wrap.append(from, board.node, topicF.node, take, live);
    host.replaceChildren(wrap);

    let listeningTo = '';
    let off = () => {};
    const show = (/** @type {string} */ what) => { live.textContent = t('parts.receiveLast', { line: what.slice(0, 120) }); };
    /** Listen to what this box names and show it as it comes. @param {any} s */
    const listen = async (s) => {
      const tr = TRANSPORTS.includes(String(s.transport)) ? String(s.transport) : 'serial';
      const key = tr === 'bus' ? `bus:${s.topic}` : `${s.serialPort}@${Number(s.baud) || DEFAULT_BAUD}`;
      if (key === listeningTo) return;
      off(); off = () => {};
      listeningTo = key;
      if (tr === 'bus') {
        const caps = ctx.app && ctx.app.farm && typeof ctx.app.farm.get === 'function' ? ctx.app.farm.get() : null;
        const filter = String(s.topic || '').trim();
        if (!filter) { live.textContent = t('parts.receiveNoTopic'); return; }
        if (!caps || !caps.bus) { live.textContent = t('parts.busErrNoBus'); return; }
        const e = listenBus(String(part.id), caps, filter);
        const last = e.items[e.items.length - 1];
        if (last) show(`${last.topic} ${JSON.stringify(last.data)}`); else live.textContent = t('parts.receiveListening', { name: filter });
        const fn = (/** @type {string} */ topic, /** @type {any} */ data) => show(`${topic} ${JSON.stringify(data)}`);
        e.listeners.add(fn);
        off = () => e.listeners.delete(fn);
        return;
      }
      const id = String(s.serialPort || '');
      if (!id) { live.textContent = ''; return; }
      const o = await ensureOpen(id, Number(s.baud) || DEFAULT_BAUD);
      if (listeningTo !== key) return;
      if (!o.ok) { live.textContent = t(/** @type {any} */ (OPEN_ERR)[o.code] || OPEN_ERR['not-found']); return; }
      const lastLine = linesOf(id).lines.slice(-1)[0];
      if (lastLine) show(lastLine); else live.textContent = t('parts.receiveListening', { name: String(s.serialLabel || id) });
      off = onLine(id, (line) => show(line));
    };
    /** @param {any} p */
    const paint = (p) => {
      const s = p.settings || {};
      const tr = TRANSPORTS.includes(String(s.transport)) ? String(s.transport) : 'serial';
      if (document.activeElement !== from) from.value = tr;
      board.node.hidden = tr !== 'serial';
      topicF.node.hidden = tr !== 'bus';
      board.update(p);
      topicF.update(s.topic);
      if (document.activeElement !== take) take.value = TAKES.includes(String(s.take)) ? String(s.take) : 'latest';
      void listen(s);
    };
    paint(part);
    return { update: paint, destroy() { off(); wrap.remove(); } };
  },

  async run(input) {
    const id = String(input.part.id);
    const s = input.part.settings || {};
    const wait = async (/** @type {() => boolean} */ ready, /** @type {string} */ nothing) => {
      const deadline = Date.now() + FIRST_LINE_WAIT_MS;
      while (!ready() && Date.now() < deadline) {
        if (input.signal && input.signal.aborted) throw partFail(nothing, 'aborted');
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    if (s.transport === 'bus') {
      const filter = String(s.topic || '').trim();
      if (!filter) throw partFail(t('parts.receiveNoTopic'), 'empty');
      const caps = input.app && input.app.farm && typeof input.app.farm.get === 'function' ? input.app.farm.get() : null;
      if (!caps || !caps.bus) throw partFail(t('parts.busErrNoBus'), 'part');
      const e = listenBus(id, caps, filter);
      await wait(() => e.count > 0, t('parts.receiveNothingBus', { topic: filter }));
      const out = takeFrom(String(s.take), e.items, e.count, cursors.get(id));
      cursors.set(id, out.cursor);
      const vals = out.items.map((m) => valueOf('json', { topic: m.topic, data: m.data }));
      if (s.take === 'new') {
        if (!vals.length) throw partFail(t('parts.receiveNothingNewBus', { topic: filter }), 'empty');
        return listOf(vals);
      }
      if (!vals.length) throw partFail(t('parts.receiveNothingBus', { topic: filter }), 'empty');
      return vals[0];
    }
    const port = String(s.serialPort || '');
    if (!port) throw partFail(t('parts.receiveNoBoard'), 'empty');
    const baud = Number(s.baud) || DEFAULT_BAUD;
    const o = await ensureOpen(port, baud);
    if (!o.ok) throw partFail(t(/** @type {any} */ (OPEN_ERR)[o.code] || OPEN_ERR['not-found']), 'part');
    // A board that has said nothing yet gets a few seconds (lol_serial speaks every 500 ms).
    await wait(() => linesOf(port).count > 0, t('parts.receiveNothing', { baud }));
    const { lines, count } = linesOf(port);
    const out = takeFrom(String(s.take), lines, count, cursors.get(id));
    cursors.set(id, out.cursor);
    if (s.take === 'new') {
      if (!out.items.length) throw partFail(t('parts.receiveNothingNew'), 'empty');
      return listOf(out.items.map((l) => valueOfLine(l)));
    }
    if (!out.items.length) throw partFail(t('parts.receiveNothing', { baud }), 'empty');
    return valueOfLine(out.items[0]);
  },
});
