// The farm snapshot contract, client side (multi-user plan 4.4). Farms are updated by hand, so the
// client must read every farm in the field: today's (each engine, built by the farm's own
// buildSnapshot in farm/contract/examples.js), farm-v0.0.41's (before the multi-user work: no
// capacity.mine), the oldest farm the contract allows (farm/contract/snapshot.schema.json's required
// fields alone) and a newer farm with fields this client does not know. Each goes the real way:
// JSON over GET /lol/self and a beacon into discovery.ts, farmSelect.ts's choice and Open WebUI
// context, app.js's publishFarm and capacity line, and LOL Vibe's capsFromBridge. farm/test/run.js
// checks the same examples against the schema.
// Needs the compiled main (npm --prefix shell run build) and the farm's node_modules (the examples
// run farm/src).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import bridge from '../../chat-harness/extract-app-bridge.js';
import { capsFromBridge } from '../../../renderer/chat/net/farm.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.join(HERE, '..', '..', '..');
const BUILD = path.join(SHELL, 'build', 'main');
const CONTRACT = path.join(SHELL, '..', 'farm', 'contract');
const QUIET = { autoScan: false, scanRange: { base: '10.0', third: [0, 0], fourth: [1, 1] } };

/** app.js's REAL publishFarm (the harness's extraction), run in a vm: farms in, window.__lolFarm out. */
function publishFarm(farms, sidecar) {
  const window = {};
  vm.runInContext(bridge.extract(), vm.createContext({ window, console }), { filename: 'app-bridge.js' });
  window.__appBridge.set({ farms }, sidecar);
  window.__appBridge.publishFarm();
  return JSON.parse(JSON.stringify(window.__lolFarm));
}

/** app.js's capacity helpers (the pill and the card's line), by the anchors test/unit.js uses. */
function capacityHelpers() {
  const src = fs.readFileSync(bridge.APP_JS, 'utf8');
  const slice = bridge.sliceBetween(src, 'function readCapacity', '// ---- sidecar → webview + overlay ----', 'capacity helpers');
  return new Function(`${slice}; return { readCapacity, capacityPill, capacityText };`)();
}

export default (test) => {
  /** @type {{label: string, snap: any}[]} */
  let farms = [];
  let FS, Discovery;
  test('contract: the farm\'s examples, the schema and the compiled client load', () => {
    assert.ok(fs.existsSync(path.join(BUILD, 'discovery.js')), 'missing build/main — run: npm --prefix shell run build');
    FS = require(path.join(BUILD, 'farmSelect.js'));
    ({ Discovery } = require(path.join(BUILD, 'discovery.js')));
    const schema = JSON.parse(fs.readFileSync(path.join(CONTRACT, 'snapshot.schema.json'), 'utf8'));
    let examples;
    try { examples = require(path.join(CONTRACT, 'examples.js'))(); } catch (e) {
      assert.fail(`farm/contract/examples.js runs the farm's own code — run npm ci in farm/ (${e.message})`);
    }
    const old = examples.find((e) => e.snap.version === '0.0.41');
    assert.ok(old && !('mine' in old.snap.capacity), 'farm-v0.0.41 is among them, without capacity.mine');
    const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
    const oldest = pick(old.snap, schema.required);
    oldest.models = old.snap.models.map((m) => pick(m, schema.properties.models.items.required));
    const today = examples[0].snap;
    const newer = { ...today, queueUrl: 'http://10.0.0.5:41997/lol/queue', capacity: { ...today.capacity, waitSec: 12 }, backend: { ...today.backend, engine: 'sglang' } };
    farms = [...examples, { label: 'the schema\'s required fields alone', snap: oldest }, { label: 'a newer farm with fields this client does not know', snap: newer }]
      // One farm per entry: today's examples all carry this box's farm id.
      .map((e, i) => ({ label: e.label, snap: { ...e.snap, id: `farm-${i}` } }));
  });

  const byId = (id) => farms.find((e) => e.snap.id === id).label;
  /** Every farm the way index.ts gets them: through discovery's merge. */
  function listed() {
    const d = new Discovery(QUIET);
    farms.forEach(({ snap }, i) => d.merge(JSON.parse(JSON.stringify(snap)), `10.0.0.${i + 1}`, 'scan'));
    return d.getFarms();
  }

  test('contract: discovery takes every farm in, over GET /lol/self and over the beacon', async () => {
    let answer = null;
    const server = http.createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(answer)); });
    await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
    try {
      const port = server.address().port;
      const d = new Discovery(QUIET);
      const beacons = new Discovery(QUIET);
      for (const [i, { label, snap }] of farms.entries()) {
        answer = snap;
        const got = await d.fetchSelf('127.0.0.1', port, 1500);
        assert.ok(got, `${label}: GET /lol/self was dropped`);
        if (got.capacity) assert.equal(typeof got.capacity.mine, 'boolean', `${label}: a unicast answer always says whether the seat is ours`);
        d.merge(got, `10.0.0.${i + 1}`, 'scan');
        // The socket handler's path: parse, check v, file it under the host the farm advertises.
        const beacon = JSON.parse(JSON.stringify(snap));
        beacons.merge(beacon, beacons.endpointHost(beacon) || `10.0.1.${i + 1}`, 'beacon');
      }
      for (const list of [d.getFarms(), beacons.getFarms()]) {
        assert.equal(list.length, farms.length, 'every farm listed once');
        assert.ok(list.every((f) => typeof f.name === 'string' && f._host && !f._stale));
      }
      const mine = Object.fromEntries(d.getFarms().map((f) => [byId(f.id), f.capacity ? f.capacity.mine : 'no capacity']));
      assert.equal(mine['farm-v0.0.41, GET /lol/self'], false, 'an older farm does not say: a definite no');
      assert.equal(mine['Ollama, open, GET /lol/self from the seat holder'], true);
      assert.equal(mine['the schema\'s required fields alone'], 'no capacity');
    } finally { server.close(); }
  });

  test('contract: farmSelect chooses among every farm and builds Open WebUI\'s context from each', () => {
    const list = listed();
    for (const f of list) {
      const label = byId(f.id);
      const load = FS.farmLoad(f);
      assert.ok(Number.isFinite(load) && load >= 0 && load <= 100, `${label}: load ${load}`);
      const ctx = FS.farmContext(f, null);
      assert.equal(ctx.endpoint, `http://${f._host}:${f.proxyPort}/v1`, label);
      assert.equal(ctx.model, (f.models.find((m) => m.default) || f.models[0]).id, label);
      assert.ok(ctx.ctxPerSlot === null || (Number.isInteger(ctx.ctxPerSlot) && ctx.ctxPerSlot > 0), `${label}: ctxPerSlot ${ctx.ctxPerSlot}`);
      assert.ok(FS.sameContext(ctx, JSON.parse(JSON.stringify(ctx))), `${label}: the persisted context compares equal after a relaunch`);
      const needKeys = !!f.requiresKey && FS.PLUGIN_KEYS.some((k) => f[k] && f[k].url && !f[k].key);
      assert.equal(FS.applyPluginKeys(f, 'pw', undefined, 0).fetchSig !== null, needKeys, `${label}: plugin keys from /lol/plugin-keys only when hidden`);
    }
    const all = { selectedFarmId: null, activeFarmId: null, currentEndpoint: null, usable: (f) => !f.requiresKey, rng: () => 0 };
    assert.equal(byId(FS.chooseActive(list, all).id), 'external vLLM, coordinator', 'the coordinator absorbs the fleet, whatever the others run');
    const pick = FS.pickLeastLoaded(list.filter((f) => !f.coordinator), all.usable, () => 0);
    assert.ok(pick.healthy && !pick.requiresKey, 'never an unhealthy farm, never one without its password');

    const ctxOf = (label) => FS.farmContext(list.find((f) => byId(f.id) === label), null);
    const old = ctxOf('farm-v0.0.41, GET /lol/self');
    assert.deepEqual([old.model, old.ctxPerSlot, old.extract && old.extract.url, !!old.searxng], ['gemma4:12b', 32768, 'http://10.0.0.5:8890', true]);
    const oldest = ctxOf('the schema\'s required fields alone');
    assert.deepEqual([oldest.model, oldest.ctxPerSlot, oldest.searxng, oldest.tts, oldest.extract], ['gemma4:12b', null, null, null, null],
      'no backend: Open WebUI keeps whole-document answers (configBridge)');
    assert.equal(FS.farmLoad(list.find((f) => byId(f.id) === 'the schema\'s required fields alone')), 50, 'nothing measured: mid-load');
    const newer = ctxOf('a newer farm with fields this client does not know');
    const today = ctxOf('Ollama, open, GET /lol/self from the seat holder');
    assert.deepEqual({ ...newer, endpoint: null }, { ...today, endpoint: null }, 'unknown fields change nothing');
  });

  test('contract: the renderer reads every farm — publishFarm, the capacity line and LOL Vibe\'s caps', () => {
    const { readCapacity, capacityPill, capacityText } = capacityHelpers();
    const seen = {};
    for (const f of listed()) {
      const label = byId(f.id);
      // index.ts onFarms adds the stored-password marks before the renderer sees a farm.
      const lolFarm = publishFarm([{ ...f, _hasKey: false, _key: null }], { endpoint: FS.farmEndpoint(f) });
      const caps = capsFromBridge(lolFarm);
      assert.equal(caps.baseUrl, FS.farmEndpoint(f), label);
      assert.ok(Number.isFinite(caps.budget.tokens) && caps.budget.tokens > 0, `${label}: budget ${caps.budget.tokens}`);
      if (caps.seats) {
        assert.ok([caps.seats.used, caps.seats.slots, caps.seats.clients, caps.seats.idleSec].every(Number.isFinite), `${label}: seats ${JSON.stringify(caps.seats)}`);
        assert.equal(typeof caps.seats.mine, 'boolean', label);
      }
      const c = readCapacity(f);
      const line = `${capacityPill(c)} | ${capacityText(c).join(' · ')}`;
      assert.doesNotMatch(line, /undefined|NaN|null/, `${label}: ${line}`);
      seen[label] = { caps, line };
    }
    const old = seen['farm-v0.0.41, GET /lol/self'];
    assert.equal(old.caps.seats.mine, false);
    assert.equal(old.line, ' · 1/2 free | 1 of 2 seats free · 3 connected');
    assert.equal(seen['Ollama, open, GET /lol/self from the seat holder'].caps.seats.mine, true);
    const oldest = seen['the schema\'s required fields alone'];
    assert.deepEqual([oldest.caps.seats, oldest.caps.engine, oldest.caps.budget.source, oldest.line], [null, null, 'default', ' | ']);
    const switching = seen['llama.cpp, password, every plugin, seats full, a model switch'];
    assert.deepEqual(switching.caps.busy, { label: 'Loading Qwen3.8-27B-UD-IQ2_S', percent: 40 });
    assert.match(switching.line, /all 2 seats busy — one frees after 15 min idle/);
    assert.equal(seen['a newer farm with fields this client does not know'].caps.engine, 'sglang', 'an engine it does not know is shown as named');
  });
};
