// @ts-check
// P3b, the Computer's side of the farm's message bus: the topic rules, the hub address, the page's bus
// door against the REAL farm bus (farm/src/bus.js, on ephemeral loopback ports), the Trigger's rules and
// the outputs choke point for a bus publish.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { topicMatches, hubUrl, subscribe, publish, close as closeBus } from '../../../renderer/chat/net/bus.mjs';
import { mayFire } from '../../../renderer/chat/graph/parts/trigger.mjs';
import { takeFrom } from '../../../renderer/chat/graph/parts/receive.mjs';
import { requestFor } from '../../../renderer/chat/graph/parts/send.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FARM_BUS = path.join(HERE, '..', '..', '..', '..', 'farm', 'src', 'bus.js');
const OUTPUTS = path.join(HERE, '..', '..', '..', 'build', 'main', 'outputs.js');
const until = async (/** @type {() => boolean} */ ok, ms = 3000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); return ok(); };

export default (test) => {
  test('bus: MQTT-style filters (+ one level, # the rest); the hub address carries the farm password only when asked', () => {
    assert.ok(topicMatches('lol/+/light', 'lol/b1/light'));
    assert.ok(!topicMatches('lol/+/light', 'lol/b1/led'));
    assert.ok(topicMatches('lol/#', 'lol/b1/light') && topicMatches('#', 'anything/at/all'));
    assert.ok(!topicMatches('lol/b1', 'lol/b1/light'));
    assert.equal(hubUrl({ bus: { ws: 'ws://10.0.0.5:8893', auth: false }, apiKey: 'pw' }), 'ws://10.0.0.5:8893/');
    assert.equal(hubUrl({ bus: { ws: 'ws://10.0.0.5:8893', auth: true }, apiKey: 'p w&' }), 'ws://10.0.0.5:8893/?key=p%20w%26');
    assert.equal(hubUrl({ bus: null }), '');
  });

  test('bus: the page\'s door against the REAL farm bus — subscribe, publish, the password; a wrong one hears nothing', async () => {
    if (!fs.existsSync(FARM_BUS)) { assert.fail('farm/src/bus.js is missing'); }
    const { startBus } = require(FARM_BUS);
    const bus = startBus({ host: '127.0.0.1', mqttPort: 0, wsPort: 0, oscPort: 0, key: 'pw', log: () => {} });
    const ports = await bus.ready;
    const caps = { bus: { ws: `ws://127.0.0.1:${ports.ws}`, auth: true }, apiKey: 'pw' };
    try {
      /** @type {any[]} */ const got = [];
      const off = subscribe(caps, 'lol/+/light', (topic, data) => got.push({ topic, data }));
      await new Promise((r) => setTimeout(r, 300));   // the subscription reaches the hub
      assert.deepEqual(await publish(caps, 'lol/b1/light', { light: 512 }), { ok: true });
      assert.ok(await until(() => got.length === 1), 'the message came back through the hub');
      assert.deepEqual(got[0], { topic: 'lol/b1/light', data: { light: 512 } });
      await publish(caps, 'lol/b1/led', 1);
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(got.length, 1, 'a topic the filter does not match is not heard');
      off();
      closeBus();
      const wrong = { ...caps, apiKey: 'nope' };
      assert.deepEqual(await publish(wrong, 'lol/b1/light', 1), { ok: false, code: 'offline' }, 'a wrong password: the hub refuses the connection');
      closeBus();
      assert.deepEqual(await publish({ bus: null }, 'x', 1), { ok: false, code: 'no-bus' });
    } finally { closeBus(); await bus.close(); }
  });

  test('Trigger: armed AND on screen, at most one run every N seconds (latest wins), at most N runs an hour', () => {
    const base = { armed: true, shown: true, now: 10_000_000, runs: /** @type {number[]} */ ([]), gapSec: 2, perHour: 3 };
    assert.deepEqual(mayFire(base), { go: true, why: '' });
    assert.equal(mayFire({ ...base, armed: false }).why, 'unarmed', 'never without a person\'s arming');
    assert.equal(mayFire({ ...base, shown: false }).why, 'hidden', 'never while the Computer is not on screen');
    assert.equal(mayFire({ ...base, runs: [base.now - 1000] }).why, 'gap', 'one second after a run: merged');
    assert.equal(mayFire({ ...base, runs: [base.now - 2500] }).go, true);
    const hour = [base.now - 3000_000, base.now - 2000_000, base.now - 1000_000];
    assert.equal(mayFire({ ...base, runs: hour }).why, 'budget', 'three runs this hour, a budget of three');
    assert.equal(mayFire({ ...base, runs: [base.now - 3700_000, ...hour.slice(1)] }).go, true, 'a run older than an hour no longer counts');
  });

  test('Receive: the latest message, or every new one since the last run (the cursor)', () => {
    assert.deepEqual(takeFrom('latest', ['a', 'b'], 2, undefined), { items: ['b'], cursor: 2 });
    assert.deepEqual(takeFrom('new', ['a', 'b'], 2, undefined), { items: ['a', 'b'], cursor: 2 });
    assert.deepEqual(takeFrom('new', ['a', 'b', 'c'], 3, 2), { items: ['c'], cursor: 3 });
    assert.deepEqual(takeFrom('new', ['b', 'c'], 5, 3), { items: ['b', 'c'], cursor: 5 }, 'a cursor older than what is kept: all that is kept');
    assert.deepEqual(takeFrom('new', ['c'], 3, 3), { items: [], cursor: 3 });
  });

  test('Send to the bus: the choke point decides (a dry run disarmed, a topic without wildcards), the page publishes', async () => {
    assert.deepEqual(requestFor({ transport: 'bus', topic: ' lol/b1/led ', host: 'ignored' }, 1), { transport: 'bus', value: 1, topic: 'lol/b1/led' });
    if (!fs.existsSync(OUTPUTS)) { assert.fail('build/main/outputs.js is missing (npm --prefix shell run build)'); }
    const O = require(OUTPUTS);
    O.resetForTests();
    const deps = { now: () => 1000, transportImpl: { udp: async () => { throw new Error('the bus must not touch UDP'); } } };
    assert.deepEqual(await O.send({ transport: 'bus', topic: 'lol/b1/led', value: 1 }, deps), { ok: true, sent: false, summary: 'bus lol/b1/led ← 1' });
    O.arm(true);
    assert.equal((await O.send({ transport: 'bus', topic: 'lol/b1/led', value: 1 }, deps)).sent, true);
    assert.equal((await O.send({ transport: 'bus', topic: 'lol/+/led', value: 1 }, deps)).code, 'E_TARGET', 'a publish names one topic');
    O.resetForTests();
  });
};
