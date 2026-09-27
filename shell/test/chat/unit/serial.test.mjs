// @ts-check
// P3a-2, USB serial: the line framing, the shared open port, the Receive box and the Send box's USB
// path, against a FAKE Web Serial (a port whose readable stream "says" lines and whose writable stream
// records what was sent). No hardware, no main process.
import assert from 'node:assert/strict';
import { identityOf, splitLines, ensureOpen, writeLine, linesOf, onLine, closeAll, MAX_LINE } from '../../../renderer/chat/net/serial.mjs';
import { receivePart, valueOfLine } from '../../../renderer/chat/graph/parts/receive.mjs';
import { requestFor, lineOf } from '../../../renderer/chat/graph/parts/send.mjs';

/** A fake board on a fake Web Serial. */
function fakeBoard(vid = 0x2341, pid = 0x0043) {
  /** @type {any} */ let ctl = null;
  const written = /** @type {string[]} */ ([]);
  const port = {
    opened: 0,
    getInfo: () => ({ usbVendorId: vid, usbProductId: pid }),
    open: async (/** @type {any} */ o) => { port.opened += 1; port.baud = o.baudRate; },
    close: async () => {},
    readable: new ReadableStream({ start(c) { ctl = c; } }),
    writable: new WritableStream({ write(chunk) { written.push(new TextDecoder().decode(chunk)); } }),
    written,
    say: (/** @type {string} */ s) => ctl.enqueue(new TextEncoder().encode(s)),
    baud: 0,
  };
  return port;
}
function install(/** @type {any[]} */ ports) {
  Object.defineProperty(globalThis.navigator, 'serial', {
    configurable: true,
    value: { getPorts: async () => ports, requestPort: async () => ports[0] },
  });
}
const tick = () => new Promise((r) => setTimeout(r, 20));

export default (test) => {
  test('serial: a board is named by its USB ids; lines are cut at newlines, the tail waits, a runaway line is capped', () => {
    assert.equal(identityOf({ usbVendorId: 0x2341, usbProductId: 0x43 }), 'usb:2341:0043');
    assert.equal(identityOf({}), '');
    assert.deepEqual(splitLines('', '{"light":1}\r\n{"li'), { lines: ['{"light":1}'], rest: '{"li' });
    assert.deepEqual(splitLines('{"li', 'ght":2}\n\n'), { lines: ['{"light":2}'], rest: '' });
    assert.equal(splitLines('', 'x'.repeat(MAX_LINE + 10)).lines[0].length, MAX_LINE, 'a board that never sends a newline cannot grow memory');
  });

  test('serial: ONE open port per board, shared; what it says is kept and heard; a write is one line', async () => {
    const board = fakeBoard();
    install([board]);
    const id = 'usb:2341:0043';
    const a = await ensureOpen(id, 115200);
    const b = await ensureOpen(id, 115200);
    assert.ok(a.ok && b.ok);
    assert.equal(board.opened, 1, 'two boxes, one open port');
    assert.equal(board.baud, 115200);
    /** @type {string[]} */ const heard = [];
    const off = onLine(id, (l) => heard.push(l));
    board.say('{"light":512,"ms":1}\n{"light":');
    await tick();
    board.say('500,"ms":2}\n');
    await tick();
    assert.deepEqual(linesOf(id), { lines: ['{"light":512,"ms":1}', '{"light":500,"ms":2}'], count: 2 });
    assert.deepEqual(heard, ['{"light":512,"ms":1}', '{"light":500,"ms":2}']);
    off();
    assert.deepEqual(await writeLine(id, 115200, 'led 1\nand more'), { ok: true });
    assert.deepEqual(board.written, ['led 1 and more\n'], 'one line: an embedded newline cannot split a message in two');
    assert.deepEqual(await ensureOpen('usb:dead:beef', 115200), { ok: false, code: 'not-found' });
    await closeAll();
  });

  test('Receive: a JSON line is data, anything else text; the latest line, or every new one since the last run', async () => {
    assert.deepEqual(valueOfLine('{"light": 5}'), { kind: 'json', data: { light: 5 } });
    assert.deepEqual(valueOfLine('42'), { kind: 'json', data: 42 });
    assert.deepEqual(valueOfLine('hello board'), { kind: 'text', data: 'hello board' });
    const board = fakeBoard(0x10c4, 0xea60);
    install([board]);
    const part = (/** @type {string} */ take) => ({ id: `r-${take}`, settings: { transport: 'serial', serialPort: 'usb:10c4:ea60', serialLabel: 'CP2102', baud: 115200, take } });
    await ensureOpen('usb:10c4:ea60', 115200);
    board.say('{"light":1}\n{"light":2}\n');
    await tick();
    const latest = /** @type {any} */ (await receivePart.run(/** @type {any} */ ({ part: part('latest'), inputs: {} })));
    assert.deepEqual(latest, { kind: 'json', data: { light: 2 } });
    const first = /** @type {any} */ (await receivePart.run(/** @type {any} */ ({ part: part('new'), inputs: {} })));
    assert.equal(first.kind, 'list');
    assert.deepEqual(first.data.map((/** @type {any} */ v) => v.data.light), [1, 2], 'the first run hands on what is buffered');
    board.say('{"light":3}\n');
    await tick();
    const next = /** @type {any} */ (await receivePart.run(/** @type {any} */ ({ part: part('new'), inputs: {} })));
    assert.deepEqual(next.data.map((/** @type {any} */ v) => v.data.light), [3], 'then only what came since');
    await assert.rejects(receivePart.run(/** @type {any} */ ({ part: part('new'), inputs: {} })), /No new line/);
    await assert.rejects(receivePart.run(/** @type {any} */ ({ part: { id: 'x', settings: { take: 'latest' } }, inputs: {} })), /Choose the board/);
    await closeAll();
  });

  test('Talk to a board: the sketch in the template IS the repo\'s sketch; the round trip decides from the reading', async () => {
    const fs = await import('node:fs');
    const url = new URL('../../../../docs/examples/arduino/lol_serial/lol_serial.ino', import.meta.url);
    const { SKETCH, default: tpl } = await import('../../../renderer/chat/computer/templates/talk-to-a-board.mjs');
    assert.equal(SKETCH, fs.readFileSync(url, 'utf8').replace(/\r\n/g, '\n'), 'the sketch changed: run node scripts/gen-board-templates.cjs');
    const decide = new Function('inputs', tpl.doc.parts.find((/** @type {any} */ p) => p.id === 'b_decide').settings.code);
    assert.equal(decide({ in: [{ light: 120 }] }), 'led 1', 'dark: the LED goes on');
    assert.equal(decide({ in: [{ light: 800 }] }), 'led 0');
    assert.equal(decide({ in: ['garbage'] }), 'led 0', 'no reading: off, never a guess');
    assert.equal(tpl.needsFarm, 'no');
  });

  test('Send by USB: the request names the board (for main\'s arm/rate check); a value goes out as one line', () => {
    assert.deepEqual(requestFor({ transport: 'serial', serialPort: 'usb:2341:0043', host: 'ignored' }, 0.5), { transport: 'serial', value: 0.5, serialPort: 'usb:2341:0043' });
    assert.equal(lineOf('led 1'), 'led 1');
    assert.equal(lineOf(0.75), '0.75');
    assert.equal(lineOf({ led: 1 }), '{"led":1}');
  });
};
