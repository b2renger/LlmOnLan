// net/farm.mjs (P1-U1): window.__lolFarm → FarmCaps, the two events, and the model catalog.
// The bridge fixtures mirror what shell/renderer/app.js publishFarm() really writes (pinned field
// for field by bridge.test.mjs) — including its FALLBACK branch, which carries no key at all.
import assert from 'node:assert/strict';
import { capsFromBridge, createFarmModel } from '../../../renderer/chat/net/farm.mjs';
import { createBus, EV } from '../../../renderer/chat/core/events.mjs';

/** The full farm branch of publishFarm(), with the mock farm's values. */
const fullBridge = (over = {}) => ({
  name: 'Mock Farm',
  openaiBaseUrl: 'http://127.0.0.1:4009/v1',
  defaultModel: 'assistant',
  busy: null,
  apiKey: null,
  id: 'mockfarm0001',
  requiresKey: false,
  healthy: true,
  stale: false,
  lastSeen: 1700000000000,
  host: '127.0.0.1',
  httpPort: 41987,
  models: [
    { id: 'assistant', underlying: 'Qwen3.8-27B-UD-Q2_K_XL', default: true },
    { id: 'gemma4:12b', underlying: 'gemma4:12b', default: false },
  ],
  backend: { engine: 'llama.cpp', alias: 'assistant', contextLength: 32768, contextPerSlot: 16384, slots: 2 },
  capacity: { slots: 2, clients: 3, seatsUsed: 1, seatIdleSec: 900 },
  perf: { lastGenTokSec: 48 },
  usage: { gpuUtil: 3 },
  searxngUrl: null,
  ttsUrl: null,
  ttsVoice: 'af_heart',
  ttsModel: 'kokoro',
  extract: null,
  ...over,
});

/** app.js's fallback branch, verbatim (§2.6 H). */
const fallbackBridge = () => ({ name: 'farm', openaiBaseUrl: 'http://127.0.0.1:4010/v1', defaultModel: null });

function stubApp() {
  const bus = createBus();
  /** @type {any[]} */ const events = [];
  bus.on(EV.FARM_CHANGE, (p) => events.push({ type: 'change', changed: p.changed, caps: p.caps, prev: p.prev }));
  bus.on(EV.FARM_TICK, (p) => events.push({ type: 'tick', now: p.now }));
  return { app: /** @type {any} */ ({ bus, now: () => 1234 }), events };
}

/** A fetch stub that records its calls. */
function stubFetch(handler) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), headers: (opts && opts.headers) || {} });
    return handler(String(url), opts);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

export default (test) => {
  test('the full bridge becomes caps', () => {
    const c = capsFromBridge(fullBridge());
    assert.equal(c.present, true);
    assert.equal(c.baseUrl, 'http://127.0.0.1:4009/v1');
    assert.equal(c.proxyRoot, 'http://127.0.0.1:4009', 'the admin surfaces live one level up');
    assert.equal(c.engine, 'llama.cpp');
    assert.equal(c.defaultModel, 'assistant');
    assert.equal(c.models.length, 2);
    assert.deepEqual(c.seats, { used: 1, slots: 2, clients: 3, idleSec: 900 });
    assert.equal(c.gpuUtil, 3);
    assert.equal(c.healthy, true);
    assert.equal(c.stale, false);
    assert.equal(c.search, null);
    assert.equal(c.tts, null);
    assert.equal(c.ocr, null);
  });

  test('the budget is the advertised context per slot', () => {
    const c = capsFromBridge(fullBridge());
    assert.deepEqual(c.budget, { tokens: 16384, advertised: 16384, source: 'advertised' });
  });

  test('a farm advertising 1,048,576 is clamped to 262,144', () => {
    const c = capsFromBridge(fullBridge({ backend: { engine: 'ollama', alias: null, contextLength: 1048576, contextPerSlot: 1048576, slots: 1 } }));
    assert.equal(c.budget.tokens, 262144);
    assert.equal(c.budget.advertised, 1048576, 'what the farm said is kept, so the UI can say so');
    assert.equal(c.budget.source, 'advertised');
  });

  test('a farm that advertises no backend gets the 32,768 default', () => {
    const c = capsFromBridge(fullBridge({ backend: null }));
    assert.deepEqual(c.budget, { tokens: 32768, advertised: null, source: 'default' });
  });

  test('the fallback bridge (no key, no models, no backend) still produces usable caps', () => {
    const c = capsFromBridge(fallbackBridge());
    assert.equal(c.present, true);
    assert.equal(c.name, 'farm');
    assert.equal(c.baseUrl, 'http://127.0.0.1:4010/v1');
    assert.deepEqual(c.models, [], 'never undefined');
    assert.equal(c.defaultModel, null);
    assert.equal(c.apiKey, null);
    assert.equal(c.requiresKey, false);
    assert.equal(c.keyMissing, false, 'the bridge cannot know a key is needed — the 400 teaches us');
    assert.equal(c.budget.source, 'default');
    assert.equal(c.seats, null);
    assert.equal(c.busy, null);
  });

  test('no farm at all', () => {
    for (const nothing of [null, undefined, {}]) {
      const c = capsFromBridge(/** @type {any} */ (nothing));
      assert.equal(c.present, false);
      assert.equal(c.baseUrl, null);
      assert.equal(c.proxyRoot, null);
      assert.deepEqual(c.models, []);
    }
  });

  test('keyMissing is true only when the farm needs a key and we have none', () => {
    assert.equal(capsFromBridge(fullBridge({ requiresKey: true, apiKey: null })).keyMissing, true);
    assert.equal(capsFromBridge(fullBridge({ requiresKey: true, apiKey: 'pw' })).keyMissing, false);
    assert.equal(capsFromBridge(fullBridge({ requiresKey: false, apiKey: null })).keyMissing, false);
  });

  test('busy, plugins and health ride along', () => {
    const c = capsFromBridge(fullBridge({
      busy: { label: 'switching to gemma4:12b', percent: 40 },
      healthy: false,
      stale: true,
      searxngUrl: 'http://127.0.0.1:4011/searxng',
      ttsUrl: 'http://127.0.0.1:4011/tts',
      extract: { url: 'http://127.0.0.1:4011/extract', key: 'k' },
    }));
    assert.deepEqual(c.busy, { label: 'switching to gemma4:12b', percent: 40 });
    assert.equal(c.healthy, false);
    assert.equal(c.stale, true);
    assert.deepEqual(c.search, { url: 'http://127.0.0.1:4011/searxng' });
    assert.deepEqual(c.tts, { url: 'http://127.0.0.1:4011/tts', voice: 'af_heart', model: 'kokoro' });
    assert.deepEqual(c.ocr, { url: 'http://127.0.0.1:4011/extract', key: 'k' });
  });

  test('a busy object with no label is not busy', () => {
    assert.equal(capsFromBridge(fullBridge({ busy: { percent: 10 } })).busy, null);
  });

  test('FARM_TICK fires on EVERY update, FARM_CHANGE only when something changed', () => {
    const { app, events } = stubApp();
    const farm = createFarmModel(app);
    farm.update(fullBridge());
    farm.update(fullBridge());
    farm.update(fullBridge());
    assert.equal(events.filter((e) => e.type === 'tick').length, 3, 'a heartbeat for the wall-clock rules');
    assert.equal(events.filter((e) => e.type === 'change').length, 1, 'three identical publishes, one change');
    assert.equal(events[0].type, 'change');
    assert.equal(events[0].now, undefined);
    assert.equal(events[1].now, 1234, 'the tick carries app.now()');
  });

  test('FARM_CHANGE names the fields that moved and carries the previous caps', () => {
    const { app, events } = stubApp();
    const farm = createFarmModel(app);
    farm.update(fullBridge());
    events.length = 0;
    farm.update(fullBridge({ busy: { label: 'pulling', percent: 5 } }));
    const change = events.find((e) => e.type === 'change');
    assert.deepEqual(change.changed, ['busy']);
    assert.equal(change.prev.busy, null);
    assert.equal(change.caps.busy.label, 'pulling');
  });

  test('losing the farm is a change, and get() reports no farm', () => {
    const { app, events } = stubApp();
    const farm = createFarmModel(app);
    farm.update(fullBridge());
    events.length = 0;
    farm.update(null);
    assert.equal(events.filter((e) => e.type === 'change').length, 1);
    assert.equal(farm.get().present, false);
  });

  test('headers() reads the key at CALL time, so a rotation is picked up', () => {
    const { app } = stubApp();
    const farm = createFarmModel(app);
    farm.update(fullBridge({ requiresKey: true, apiKey: null }));
    assert.deepEqual(farm.headers(), {}, 'an open farm gets no header at all');
    const send = farm.headers;
    farm.update(fullBridge({ requiresKey: true, apiKey: 'harness-pw' }));
    assert.deepEqual(send(), { authorization: 'Bearer harness-pw' });
  });

  test('fetchModels: no farm', async () => {
    const { app } = stubApp();
    const farm = createFarmModel(app);
    assert.deepEqual(await farm.fetchModels(), { ids: [], state: 'no-farm' });
  });

  test('fetchModels: ok, and the result is cached until the endpoint or the key changes', async () => {
    const { app } = stubApp();
    const farm = createFarmModel(app);
    farm.update(fullBridge());
    const f = stubFetch(async () => jsonResponse(200, { data: [{ id: 'assistant' }, { id: 'gemma4:12b' }] }));
    try {
      const first = await farm.fetchModels();
      assert.deepEqual(first, { ids: ['assistant', 'gemma4:12b'], state: 'ok' });
      assert.equal(f.calls[0].url, 'http://127.0.0.1:4009/v1/models');
      await farm.fetchModels();
      assert.equal(f.calls.length, 1, 'the second call is served from the cache');
      await farm.fetchModels({ force: true });
      assert.equal(f.calls.length, 2, 'force refetches');
      farm.update(fullBridge({ apiKey: 'pw', requiresKey: true }));
      await farm.fetchModels();
      assert.equal(f.calls.length, 3, 'a key rotation refetches');
      assert.deepEqual(f.calls[2].headers, { authorization: 'Bearer pw' });
      farm.update(fullBridge({ openaiBaseUrl: 'http://127.0.0.1:4010/v1' }));
      await farm.fetchModels();
      assert.equal(f.calls.length, 4, 'a new endpoint refetches');
    } finally { f.restore(); }
  });

  test('fetchModels: no-models, auth and unreachable are never cached', async () => {
    const { app } = stubApp();
    const farm = createFarmModel(app);
    farm.update(fullBridge());

    let mode = 'empty';
    const f = stubFetch(async () => {
      if (mode === 'empty') return jsonResponse(200, { data: [] });
      if (mode === 'auth') return jsonResponse(400, {});
      if (mode === 'down') return jsonResponse(503, {});
      throw new TypeError('Failed to fetch');
    });
    try {
      assert.deepEqual(await farm.fetchModels(), { ids: [], state: 'no-models' });
      mode = 'auth';
      assert.deepEqual(await farm.fetchModels(), { ids: [], state: 'auth' }, 'a wrong password is a 400 here too');
      mode = 'down';
      assert.deepEqual(await farm.fetchModels(), { ids: [], state: 'unreachable' });
      mode = 'throw';
      assert.deepEqual(await farm.fetchModels(), { ids: [], state: 'unreachable' });
      mode = 'ok';
      assert.equal(f.calls.length, 4, 'every failure retried rather than sticking');
    } finally { f.restore(); }
  });

  test('fetchModels: a junk answer is no-models, not a crash', async () => {
    const { app } = stubApp();
    const farm = createFarmModel(app);
    farm.update(fullBridge());
    const f = stubFetch(async () => jsonResponse(200, { nope: true }));
    try {
      assert.deepEqual(await farm.fetchModels(), { ids: [], state: 'no-models' });
    } finally { f.restore(); }
  });

  test('modelInfo and the capability resolver', () => {
    const { app } = stubApp();
    const farm = createFarmModel(app);
    farm.update(fullBridge());
    assert.deepEqual(farm.modelInfo('assistant'), { id: 'assistant', underlying: 'Qwen3.8-27B-UD-Q2_K_XL', default: true });
    assert.equal(farm.modelInfo('nope'), null);
    assert.equal(farm.cap('gemma4:12b', 'vision'), 'unknown', 'no resolver installed yet');
    farm.setCapResolver((underlying, name) => (underlying === 'gemma4:12b' && name === 'vision' ? 'yes' : 'no'));
    assert.equal(farm.cap('gemma4:12b', 'vision'), 'yes');
    assert.equal(farm.cap('Qwen3.8-27B-UD-Q2_K_XL', 'vision'), 'no');
    farm.setCapResolver(() => { throw new Error('probe exploded'); });
    assert.equal(farm.cap('x', 'vision'), 'unknown', 'a throwing probe is unknown, not a crash');
    farm.setCapResolver(null);
    assert.equal(farm.cap('gemma4:12b', 'vision'), 'unknown');
  });
};
