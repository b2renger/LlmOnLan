// @ts-check
// The outputs choke point (src/main/outputs.ts, ecosystem plan v2 §3.5), against the COMPILED main
// module: the wire formats byte for byte, the dry run, the arming, the farm-port refusal, the rate and
// 3 Hz DMX caps, and Panic's blackout. No socket is opened: the transports are injected.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { requestFor, targetsIn, sendValue } from '../../../renderer/chat/graph/parts/send.mjs';

const require = createRequire(import.meta.url);
const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'build', 'main', 'outputs.js');

export default (test) => {
  if (!fs.existsSync(BUILD)) {
    test('outputs: build/main/outputs.js exists (run npm --prefix shell run build)', () => assert.fail('not built'));
    return;
  }
  const O = require(BUILD);

  test('outputs: OSC — address and type tags padded to 4 bytes; int, float, string, bool', () => {
    const b = O.encodeOsc('/lol', [1, 0.5, 'hi', true]);
    assert.equal(b.length % 4, 0);
    assert.equal(b.subarray(0, 8).toString('latin1'), '/lol\0\0\0\0');
    assert.equal(b.subarray(8, 16).toString('latin1'), ',ifsT\0\0\0');
    assert.equal(b.readInt32BE(16), 1);
    assert.equal(b.readFloatBE(20), 0.5);
    assert.equal(b.subarray(24, 28).toString('latin1'), 'hi\0\0');
    assert.equal(O.encodeOsc('/x', 3).subarray(4, 8).toString('latin1'), ',i\0\0', 'one value is one argument');
  });

  test('outputs: Art-Net — ArtDmx header, universe split into SubUni/Net, 512 channels clamped 0..255', () => {
    const ch = O.dmxChannels([255, 300, -4, '128']);
    assert.deepEqual([...ch.slice(0, 5)], [255, 255, 0, 128, 0]);
    assert.deepEqual([...O.dmxChannels({ 12: 200, 600: 9, x: 5 }).slice(10, 13)], [0, 200, 0], 'channel numbers from an object; out-of-range ignored');
    const p = O.encodeArtDmx(0x0123, ch, 7);
    assert.equal(p.subarray(0, 8).toString('latin1'), 'Art-Net\0');
    assert.equal(p.readUInt16LE(8), 0x5000);
    assert.equal(p.readUInt16BE(10), 14);
    assert.deepEqual([p[12], p[14], p[15]], [7, 0x23, 0x01]);
    assert.equal(p.readUInt16BE(16), 512);
    assert.equal(p.length, 18 + 512);
  });

  test('outputs: MQTT 3.1.1 — CONNECT, QoS-0 PUBLISH, DISCONNECT', () => {
    const m = O.encodeMqtt('cid', 'a/b', Buffer.from('hi'));
    assert.equal(m.connect[0], 0x10);
    assert.equal(m.connect.subarray(4, 8).toString('latin1'), 'MQTT');
    assert.deepEqual([...m.publish], [0x30, 2 + 3 + 2, 0, 3, 0x61, 0x2f, 0x62, 0x68, 0x69]);
    assert.deepEqual([...m.disconnect], [0xe0, 0]);
  });

  test('outputs: DISARMED is a dry run (nothing leaves); armed sends; the farm ports are refused either way', async () => {
    O.resetForTests();
    let sent = 0;
    const deps = { transportImpl: { udp: async () => { sent++; } } };
    let r = await O.send({ transport: 'osc', host: '127.0.0.1', port: 9000, address: '/lol', value: 1 }, deps);
    assert.deepEqual([r.ok, r.sent, sent], [true, false, 0]);
    assert.match(r.summary, /OSC \/lol 1/);
    O.arm(true);
    r = await O.send({ transport: 'osc', host: '127.0.0.1', port: 9000, address: '/lol', value: 1 }, deps);
    assert.deepEqual([r.ok, r.sent, sent], [true, true, 1]);
    r = await O.send({ transport: 'osc', host: '10.0.0.5', port: 41997, address: '/x', value: 1 }, deps);
    assert.equal(r.code, 'E_FARM');
    r = await O.send({ transport: 'http', url: 'http://10.0.0.5:4000/v1/models', value: 'x' }, deps);
    assert.equal(r.code, 'E_FARM');
    r = await O.send({ transport: 'osc', host: '127.0.0.1', port: 9000, address: 'no-slash', value: 1 }, deps);
    assert.equal(r.code, 'E_TARGET');
    O.resetForTests();
  });

  test('outputs: 20 messages a second per target, DMX 3 frames a second, and Panic blacks out what was lit', async () => {
    O.resetForTests();
    O.arm(true);
    /** @type {any[]} */ const packets = [];
    let clock = 1000;
    const deps = { now: () => clock, transportImpl: { udp: async (h, p, b) => { packets.push({ h, p, b }); } } };
    const dmx = { transport: 'artnet', host: '10.0.0.9', port: 6454, universe: 1, value: [255] };
    assert.equal((await O.send(dmx, deps)).sent, true);
    clock += 200;
    assert.equal((await O.send(dmx, deps)).code, 'E_RATE', 'a second frame 200 ms later is held: > 3 Hz');
    clock += 200;
    assert.equal((await O.send(dmx, deps)).sent, true, '400 ms after the first: allowed');
    // Release critic R4: the node's address and a broadcast address reach the same lights, so they
    // share ONE budget per universe.
    clock += 170;
    assert.equal((await O.send({ ...dmx, host: '10.0.0.255' }, deps)).code, 'E_RATE', 'the same universe by another address: held');
    clock += 170;
    const osc ={ transport: 'osc', host: '127.0.0.1', port: 9000, address: '/a', value: 1 };
    assert.equal((await O.send(osc, deps)).sent, true);
    assert.equal((await O.send(osc, deps)).code, 'E_RATE', 'the same instant: held');
    clock += 60;
    assert.equal((await O.send(osc, deps)).sent, true);
    packets.length = 0;
    const p = await O.panic(deps);
    assert.equal(p.blackouts, 1);
    assert.equal(packets.length, 1);
    assert.equal(packets[0].h, '10.0.0.9');
    assert.ok(packets[0].b.subarray(18).every((/** @type {number} */ v) => v === 0), 'a blackout: every channel 0');
    assert.equal(O.isArmed(), false, 'and the outputs are disarmed');
    O.resetForTests();
  });

  test('outputs: USB serial goes through the same choke point — dry run disarmed, allowed armed, rate-capped, a board needed', async () => {
    O.resetForTests();
    let clock = 5000;
    const deps = { now: () => clock, transportImpl: { udp: async () => { throw new Error('serial must not touch the network'); } } };
    const usb = { transport: 'serial', serialPort: 'usb:2341:0043', value: 'led 1' };
    assert.deepEqual(await O.send(usb, deps), { ok: true, sent: false, summary: 'USB ← led 1' }, 'disarmed: a dry run');
    O.arm(true);
    assert.equal((await O.send(usb, deps)).sent, true, 'armed: the page may write the line');
    assert.equal((await O.send(usb, deps)).code, 'E_RATE', 'the same instant: held (20 a second per board)');
    clock += 60;
    assert.equal((await O.send(usb, deps)).sent, true);
    assert.equal((await O.send({ transport: 'serial', value: 1 }, deps)).code, 'E_TARGET', 'no board chosen');
    O.resetForTests();
  });

  test('send box: typed numbers and lists go out as numbers and lists (release critic R5); a local target is named', () => {
    assert.equal(sendValue('0.75'), 0.75, 'an OSC float, not the string "0.75"');
    assert.deepEqual(sendValue(' [255, 128, 0] '), [255, 128, 0], 'DMX levels, not a blackout');
    assert.deepEqual(sendValue('{"12": 255}'), { 12: 255 });
    assert.equal(sendValue('hello'), 'hello');
    assert.equal(sendValue('12 apples'), '12 apples', 'not JSON: sent as it came');
    assert.equal(sendValue('true'), 'true', 'a word stays a word');
    assert.deepEqual(sendValue([1, 2]), [1, 2], 'a list arrives as a list');
    const doc = { parts: [{ type: 'send', settings: { transport: 'http', url: 'http://127.0.0.1:8188/prompt' } }, { type: 'send', settings: { transport: 'osc', host: '10.0.0.5', port: 9000, address: '/a' } }] };
    const list = targetsIn(doc);
    assert.match(list[0], /\(this computer\)$/);
    assert.doesNotMatch(list[1], /this computer/);
  });

  test('send box: the request carries the PERSON\'s target and the wire\'s value; the arming question lists every target', () => {
    const r = requestFor({ transport: 'artnet', host: ' 10.0.0.9 ', port: 0, universe: 2 }, [1, 2]);
    assert.deepEqual(r, { transport: 'artnet', value: [1, 2], host: '10.0.0.9', port: 6454, universe: 2 });
    assert.equal(requestFor({ transport: 'http', url: 'http://x/y' }, 'v').url, 'http://x/y');
    assert.equal(requestFor({ transport: 'nope' }, 1).transport, 'osc');
    const list = targetsIn({ parts: [{ type: 'send', settings: { transport: 'osc', host: 'h', port: 9000, address: '/a' } }, { type: 'note', settings: {} }] });
    assert.equal(list.length, 1);
    assert.match(list[0], /OSC.*h:9000 \/a/);
  });
};
