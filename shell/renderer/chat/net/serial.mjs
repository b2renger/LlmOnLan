// @ts-check
// The Computer's USB serial door (ecosystem plan v2 §8d, P3a-2): the browser's Web Serial, one open port
// per board, shared by every Send and Receive box that names it. ONE LINE = ONE MESSAGE, the protocol of
// docs/examples/arduino/lol_serial/lol_serial.ino.
//
// Main (src/main/serial.ts) answers which port the person picked: `choosePort` asks the browser for one,
// main forwards the plugged-in boards, and this module shows them in a popover next to the button that
// asked — nothing is ever chosen for the person. Sending still asks main's outputs choke point first (a
// Send box does that before calling `writeLine`), so a disarmed graph never writes to a board.
//
// A board is named by its USB ids (`usb:2341:0043`): what Web Serial can tell apart across reloads.
// ponytail: two identical boards share one name, and the first one found is used. Upgrade path: a
// `#n` suffix picked in the chooser, once Web Serial exposes a serial number.

import { serialDoor } from '../projects/bridge.mjs';

export const DEFAULT_BAUD = 115200;
export const MAX_LINES = 200;
/** A line longer than this is cut (a board that never sends a newline must not grow memory forever). */
export const MAX_LINE = 4096;

const hex4 = (/** @type {any} */ n) => (Number.isInteger(n) ? n.toString(16).padStart(4, '0') : '????');

/** PURE: a port's name from its USB ids. @param {any} info @returns {string} */
export function identityOf(info) {
  return info && (info.usbVendorId !== undefined || info.usbProductId !== undefined)
    ? `usb:${hex4(info.usbVendorId)}:${hex4(info.usbProductId)}` : '';
}

/**
 * PURE: split what arrived into whole lines; the unfinished tail waits for the next chunk.
 * @param {string} buffer @param {string} chunk @returns {{lines: string[], rest: string}}
 */
export function splitLines(buffer, chunk) {
  const text = buffer + chunk;
  const parts = text.split('\n');
  let rest = parts.pop() || '';
  if (rest.length > MAX_LINE) { parts.push(rest.slice(0, MAX_LINE)); rest = ''; }
  return { lines: parts.map((l) => l.replace(/\r$/, '').slice(0, MAX_LINE)).filter((l) => l.length > 0), rest };
}

/** identity -> { port, baud, lines, count, listeners, reader, error } */
const open = new Map();

const serial = () => /** @type {any} */ (globalThis.navigator && /** @type {any} */ (globalThis.navigator).serial) || null;

/** Is USB serial available here at all (Chromium's Web Serial)? */
export function hasSerial() { return !!serial(); }

// Main forwards the plugged-in boards when the browser asks for one; the popover that answers is set up
// by whoever called choosePort (one at a time: a second call replaces the first).
/** @type {null | ((list: any[]) => void)} */
let onList = null;
let listening = false;
function listenForChoices() {
  if (listening) return;
  const door = serialDoor();
  if (!door) return;
  listening = true;
  door.onChoose((list) => {
    const fn = onList;
    onList = null;
    if (fn) fn(Array.isArray(list) ? list : []);
    else void door.chosen('');
  });
}

/**
 * Ask the person which board: the browser's port request, answered by a popover of the boards main
 * found. Resolves {identity, name} or {error} ('no-serial' | 'cancelled' | 'none-found').
 * @param {{show: (list: any[], choose: (portId: string) => void) => void}} ui how to show the list
 * @returns {Promise<{identity: string, name: string}|{error: string}>}
 */
export async function choosePort(ui) {
  const api = serial();
  if (!api) return { error: 'no-serial' };
  listenForChoices();
  let picked = '';
  let found = 0;
  onList = (list) => {
    found = list.length;
    const door = serialDoor();
    if (!list.length) { if (door) void door.chosen(''); return; }
    ui.show(list, (portId) => {
      picked = String(list.find((p) => p.portId === portId)?.name || '');
      if (door) void door.chosen(portId || '');
    });
  };
  try {
    const port = await api.requestPort();
    return { identity: identityOf(port.getInfo()), name: picked || identityOf(port.getInfo()) };
  } catch {
    return { error: found === 0 && !picked ? 'none-found' : 'cancelled' };
  }
}

/** The granted port with this name, or null. @param {string} identity */
async function findPort(identity) {
  const api = serial();
  if (!api || !identity) return null;
  const ports = await api.getPorts();
  return ports.find((/** @type {any} */ p) => identityOf(p.getInfo()) === identity) || null;
}

/**
 * The open board, opening it (and starting its reader) on first use.
 * @param {string} identity @param {number} [baud]
 * @returns {Promise<{ok: true, entry: any}|{ok: false, code: 'no-serial'|'not-found'|'busy'}>}
 */
export async function ensureOpen(identity, baud = DEFAULT_BAUD) {
  const cur = open.get(identity);
  if (cur && !cur.error && cur.baud === baud) return { ok: true, entry: cur };
  if (cur) await closePort(identity);
  if (!serial()) return { ok: false, code: 'no-serial' };
  const port = await findPort(identity);
  if (!port) return { ok: false, code: 'not-found' };
  try { await port.open({ baudRate: baud }); } catch { return { ok: false, code: 'busy' }; }
  const entry = { port, baud, lines: /** @type {string[]} */ ([]), count: 0, listeners: new Set(), reader: null, error: '' };
  open.set(identity, entry);
  void readLoop(identity, entry);
  return { ok: true, entry };
}

/** @param {string} identity @param {any} entry */
async function readLoop(identity, entry) {
  const decoder = new TextDecoder();
  let rest = '';
  try {
    entry.reader = entry.port.readable.getReader();
    for (;;) {
      const { value, done } = await entry.reader.read();
      if (done) break;
      const out = splitLines(rest, decoder.decode(value, { stream: true }));
      rest = out.rest;
      for (const line of out.lines) {
        entry.lines.push(line);
        entry.count += 1;
        if (entry.lines.length > MAX_LINES) entry.lines.shift();
        for (const fn of entry.listeners) { try { fn(line); } catch { /* a listener's own problem */ } }
      }
    }
  } catch {
    entry.error = 'lost';   // unplugged: the next use reopens
  } finally {
    try { entry.reader && entry.reader.releaseLock(); } catch { /* released */ }
  }
}

/** Write one line (a newline is added). @param {string} identity @param {number} baud @param {string} text */
export async function writeLine(identity, baud, text) {
  const o = await ensureOpen(identity, baud);
  if (!o.ok) return o;
  const writer = o.entry.port.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode(`${String(text).replace(/[\r\n]+/g, ' ')}\n`));
    return { ok: true };
  } catch {
    return { ok: false, code: 'lost' };
  } finally {
    try { writer.releaseLock(); } catch { /* released */ }
  }
}

/** What a board said: the last lines, and how many ever arrived (a cursor for "since last run"). */
export function linesOf(/** @type {string} */ identity) {
  const e = open.get(identity);
  return e ? { lines: e.lines.slice(), count: e.count } : { lines: [], count: 0 };
}

/** Hear every new line. @param {string} identity @param {(line: string) => void} fn @returns {() => void} */
export function onLine(identity, fn) {
  const e = open.get(identity);
  if (!e) return () => {};
  e.listeners.add(fn);
  return () => { e.listeners.delete(fn); };
}

/** @param {string} identity */
export async function closePort(identity) {
  const e = open.get(identity);
  open.delete(identity);
  if (!e) return;
  try { if (e.reader) await e.reader.cancel(); } catch { /* already */ }
  try { await e.port.close(); } catch { /* already */ }
}

/** Panic and tests: every board let go. */
export async function closeAll() {
  for (const id of Array.from(open.keys())) await closePort(id);
}
