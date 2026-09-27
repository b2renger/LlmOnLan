// @ts-check
// Receive (ecosystem plan v2 §8d, P3a-2) — what a board says, coming INTO a graph. USB serial for now
// (P3b adds the farm's message bus): the board writes one line per message (docs/examples/arduino/
// lol_serial), and this box hands on the latest line, or every new line since its last run. A line that
// is JSON flows on as data, so a Code box reads `inputs.in[0].light`.
//
// The port opens when the box has a board and is on screen, so its face shows the last line live (an
// instrument a student can watch). Nothing here sends: reading a board is local and needs no arming.

import { valueOf, listOf } from '../values.mjs';
import { partFail } from './common.mjs';
import { ensureOpen, linesOf, onLine, DEFAULT_BAUD } from '../../net/serial.mjs';
import { boardRow } from './board-picker.mjs';
import { t } from '../../core/i18n.mjs';
import '../../strings/parts-receive.en.mjs';

/** @typedef {import('../../core/types.mjs').PartSpec} PartSpec */

export const TAKES = Object.freeze(['latest', 'new']);
const TAKE_KEY = { latest: 'parts.receiveTake_latest', new: 'parts.receiveTake_new' };
/** Why the port would not open (net/serial.mjs codes). */
const OPEN_ERR = { 'no-serial': 'parts.boardErrNoSerial', 'not-found': 'parts.boardErrNotFound', busy: 'parts.boardErrBusy' };
/** How long a run waits for a first line from a board that has said nothing yet. */
export const FIRST_LINE_WAIT_MS = 3000;

/** partId -> how many lines the board had sent at this box's last run (the "since last run" cursor). */
const cursors = new Map();

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

/** @type {PartSpec} */
export const receivePart = /** @type {any} */ ({
  type: 'receive',
  order: 34,
  label: t('parts.receiveLabel'),
  thinks: false,
  size: { w: 320, h: 200 },
  inputs: [],
  output: 'json',
  defaults: () => ({ transport: 'serial', serialPort: '', serialLabel: '', baud: DEFAULT_BAUD, take: 'latest' }),

  render(host, part, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'graph-receive';
    wrap.title = t('parts.receiveHint');
    const board = boardRow(ctx, part);
    const take = document.createElement('select');
    take.className = 'graph-receive-take';
    take.setAttribute('aria-label', t('parts.receiveTake'));
    for (const k of TAKES) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = t(/** @type {any} */ (TAKE_KEY)[k]);
      take.appendChild(o);
    }
    take.addEventListener('change', () => { ctx.update({ take: take.value }); ctx.commit(t('parts.receiveTake')); });
    const live = document.createElement('p');
    live.className = 'graph-receive-live';
    wrap.append(board.node, take, live);
    host.replaceChildren(wrap);

    let listeningTo = '';
    let off = () => {};
    /** Open the board this box names and show its lines as they come. @param {any} s */
    const listen = async (s) => {
      const id = String(s.serialPort || '');
      const key = `${id}@${Number(s.baud) || DEFAULT_BAUD}`;
      if (key === listeningTo) return;
      off(); off = () => {};
      listeningTo = key;
      if (!id) { live.textContent = ''; return; }
      const o = await ensureOpen(id, Number(s.baud) || DEFAULT_BAUD);
      if (listeningTo !== key) return;
      if (!o.ok) { live.textContent = t(/** @type {any} */ (OPEN_ERR)[o.code] || OPEN_ERR['not-found']); return; }
      const last = linesOf(id).lines.slice(-1)[0];
      live.textContent = last ? t('parts.receiveLast', { line: last.slice(0, 120) }) : t('parts.receiveListening', { name: String(s.serialLabel || id) });
      off = onLine(id, (line) => { live.textContent = t('parts.receiveLast', { line: line.slice(0, 120) }); });
    };
    /** @param {any} p */
    const paint = (p) => {
      const s = p.settings || {};
      board.update(p);
      if (document.activeElement !== take) take.value = TAKES.includes(String(s.take)) ? String(s.take) : 'latest';
      void listen(s);
    };
    paint(part);
    return { update: paint, destroy() { off(); wrap.remove(); } };
  },

  async run(input) {
    const id = String(input.part.id);
    const s = input.part.settings || {};
    const port = String(s.serialPort || '');
    if (!port) throw partFail(t('parts.receiveNoBoard'), 'empty');
    const baud = Number(s.baud) || DEFAULT_BAUD;
    const o = await ensureOpen(port, baud);
    if (!o.ok) throw partFail(t(/** @type {any} */ (OPEN_ERR)[o.code] || OPEN_ERR['not-found']), 'part');
    // A board that has said nothing yet gets a few seconds (lol_serial speaks every 500 ms).
    const deadline = Date.now() + FIRST_LINE_WAIT_MS;
    while (!linesOf(port).count && Date.now() < deadline) {
      if (input.signal && input.signal.aborted) throw partFail(t('parts.receiveNothing', { baud }), 'aborted');
      await new Promise((r) => setTimeout(r, 100));
    }
    const { lines, count } = linesOf(port);
    if (s.take === 'new') {
      const since = cursors.has(id) ? Number(cursors.get(id)) : count - lines.length;
      cursors.set(id, count);
      const fresh = lines.slice(Math.max(0, lines.length - (count - since)));
      if (!fresh.length) throw partFail(t('parts.receiveNothingNew'), 'empty');
      return listOf(fresh.map((l) => valueOfLine(l)));
    }
    if (!lines.length) throw partFail(t('parts.receiveNothing', { baud }), 'empty');
    return valueOfLine(lines[lines.length - 1]);
  },
});
