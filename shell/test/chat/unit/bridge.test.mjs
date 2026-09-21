// @ts-check
// The harness's app.js bridge (plan §2.2.1): the wrapper built by extract-app-bridge.js is the REAL
// publishFarm, so running it in node:vm against main-shaped farm objects proves the harness
// publishes the same `window.__lolFarm` the shipping renderer does — and catches the day app.js
// changes shape under it.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bridge from '../../chat-harness/extract-app-bridge.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = path.join(HERE, '..', '..', '..', 'renderer', 'app.js');

/**
 * Evaluate the generated wrapper in a fresh vm context with a fake window, then publish.
 * @param {{farms: any[], sidecar: any, source?: string}} o
 */
function publish(o) {
    const source = o.source ?? bridge.extract(APP_JS);
    /** @type {any} */
    const window = { refreshes: 0 };
    window.__lolChatRefresh = () => { window.refreshes++; };
    const ctx = vm.createContext({ window, console });
    // The wrapper is a classic script: it assigns window.__appBridge as its only side effect.
    vm.runInContext(source, ctx, { filename: 'app-bridge.js' });
    assert.ok(window.__appBridge, 'wrapper did not expose window.__appBridge');
    window.__appBridge.set({ farms: o.farms }, o.sidecar);
    window.__appBridge.publishFarm();
    // Objects built inside the vm realm have a foreign prototype; hand back a plain copy so
    // deepEqual compares values, not realms.
    window.lolFarm = window.__lolFarm === null || window.__lolFarm === undefined ? window.__lolFarm : JSON.parse(JSON.stringify(window.__lolFarm));
    return window;
}

const LAST_SEEN = 1_757_000_000_000;

/** A farm object shaped exactly like the one the main process hands the renderer.
 *  The snapshot half mirrors the mock's `/lol/self` (plan §2.3), because that is what
 *  `harness-bridge.js` turns into this object at runtime. */
const mainShaped = (patch = {}) => ({
    v: 1,
    id: 'mockfarm0001',
    name: 'Mock Farm',
    proxyPort: 4009,
    httpPort: 41987,
    openaiBaseUrl: 'http://10.10.16.5:4009/v1',   // the farm's OWN view; publishFarm must ignore it
    models: [
        { id: 'assistant', underlying: 'Qwen3.8-27B-UD-Q2_K_XL', default: true },
        { id: 'gemma4:12b', default: false },
    ],
    backend: { engine: 'llama.cpp', alias: 'assistant', contextLength: 32768, contextPerSlot: 16384, slots: 2 },
    capacity: { slots: 2, clients: 1, seatsUsed: 1, seatIdleSec: 900 },
    perf: { lastGenTokSec: 48 },
    usage: { gpuUtil: 3, vramUsedMb: 9000 },
    searxngUrl: null,
    ttsUrl: null,
    extract: null,
    requiresKey: false,
    healthy: true,
    busy: null,
    _source: 'beacon',
    _host: '127.0.0.1',
    _lastSeen: LAST_SEEN,
    _stale: false,
    _hasKey: false,
    _key: null,
    ...patch,
});

/** The full P1 bridge object for `mainShaped()`, field for field (plan §3.3 FarmBridge). */
const expectedBridge = (patch = {}) => ({
    name: 'Mock Farm',
    openaiBaseUrl: 'http://127.0.0.1:4009/v1',
    defaultModel: 'assistant',
    busy: null,
    apiKey: null,
    id: 'mockfarm0001',
    requiresKey: false,
    healthy: true,
    stale: false,
    lastSeen: LAST_SEEN,
    host: '127.0.0.1',
    httpPort: 41987,
    models: [
        { id: 'assistant', underlying: 'Qwen3.8-27B-UD-Q2_K_XL', default: true },
        { id: 'gemma4:12b', underlying: null, default: false },
    ],
    backend: { engine: 'llama.cpp', alias: 'assistant', contextLength: 32768, contextPerSlot: 16384, slots: 2 },
    capacity: { slots: 2, clients: 1, seatsUsed: 1, seatIdleSec: 900 },
    perf: { lastGenTokSec: 48 },
    usage: { gpuUtil: 3 },                 // ONLY gpuUtil: the chat has no use for the rest
    searxngUrl: null,
    ttsUrl: null,
    ttsVoice: 'af_heart',
    ttsModel: 'kokoro',
    extract: null,
    ...patch,
});

export default (test) => {
    test('open farm: __lolFarm is built from _host + proxyPort, not the snapshot url', () => {
        const farm = mainShaped();
        const w = publish({ farms: [farm], sidecar: { endpoint: 'http://127.0.0.1:4009/v1' } });
        assert.deepEqual(w.lolFarm, expectedBridge());
        assert.equal(w.refreshes, 1, 'publishFarm must call window.__lolChatRefresh');
    });

    test('P1 fields: the catalog, backend, capacity and plugin urls all ride along', () => {
        const farm = mainShaped({
            searxngUrl: 'http://127.0.0.1:4011/searxng',
            ttsUrl: 'http://127.0.0.1:4011/tts/v1',
            ttsVoice: 'af_sky',
            ttsModel: 'kokoro-v1',
            extract: { url: 'http://127.0.0.1:4011/ocr', key: 'mock-extract-key' },
        });
        const w = publish({ farms: [farm], sidecar: { endpoint: 'http://127.0.0.1:4009/v1' } });
        assert.deepEqual(w.lolFarm, expectedBridge({
            searxngUrl: 'http://127.0.0.1:4011/searxng',
            ttsUrl: 'http://127.0.0.1:4011/tts/v1',
            ttsVoice: 'af_sky',
            ttsModel: 'kokoro-v1',
            extract: { url: 'http://127.0.0.1:4011/ocr', key: 'mock-extract-key' },
        }));
    });

    test('P1 fields: a half-configured extract is dropped, not half-published', () => {
        const w = publish({
            farms: [mainShaped({ extract: { url: 'http://127.0.0.1:4011/ocr' } })],
            sidecar: { endpoint: 'http://127.0.0.1:4009/v1' },
        });
        assert.equal(w.lolFarm.extract, null);
    });

    test('P1 fields: a bare snapshot (no backend/capacity/usage) publishes nulls, never undefined', () => {
        const farm = mainShaped({ backend: undefined, capacity: undefined, perf: undefined, usage: undefined, models: undefined });
        const w = publish({ farms: [farm], sidecar: { endpoint: 'http://127.0.0.1:4009/v1' } });
        // JSON.parse(JSON.stringify()) would DROP an undefined, so assert on the raw object too.
        for (const k of ['backend', 'capacity', 'perf', 'usage']) {
            assert.equal(w.__lolFarm[k], null, `${k} must be null, got ${String(w.__lolFarm[k])}`);
        }
        assert.deepEqual(w.lolFarm.models, []);
        assert.equal(w.lolFarm.defaultModel, null);
        assert.equal(w.lolFarm.healthy, true, 'healthy is true unless the farm says otherwise');
    });

    test('P1 fields: an unhealthy, stale farm is published as such', () => {
        const farm = mainShaped({ healthy: false, _stale: true, _lastSeen: null });
        const w = publish({ farms: [farm], sidecar: { endpoint: 'http://127.0.0.1:4009/v1' } });
        assert.equal(w.lolFarm.healthy, false);
        assert.equal(w.lolFarm.stale, true);
        assert.equal(w.lolFarm.lastSeen, null);
    });

    test('open farm: the advertised default wins over list order', () => {
        const farm = mainShaped({ models: [{ id: 'gemma4:12b' }, { id: 'assistant', default: true }] });
        const w = publish({ farms: [farm], sidecar: { endpoint: 'http://127.0.0.1:4009/v1' } });
        assert.equal(w.__lolFarm.defaultModel, 'assistant');
    });

    test('keyed farm: _key rides along as apiKey and busy is carried', () => {
        const farm = mainShaped({ proxyPort: 4010, requiresKey: true, _hasKey: true, _key: 'harness-pw', busy: { label: 'loading the model', percent: 40 } });
        const w = publish({ farms: [farm], sidecar: { endpoint: 'http://127.0.0.1:4010/v1' } });
        assert.equal(w.__lolFarm.openaiBaseUrl, 'http://127.0.0.1:4010/v1');
        assert.equal(w.__lolFarm.apiKey, 'harness-pw');
        assert.deepEqual(w.lolFarm.busy, { label: 'loading the model', percent: 40 });
    });

    test('fallback branch: no farms but a sidecar endpoint → an anonymous, keyless farm', () => {
        const w = publish({ farms: [], sidecar: { endpoint: 'http://127.0.0.1:4010/v1' } });
        assert.deepEqual(w.lolFarm, { name: 'farm', openaiBaseUrl: 'http://127.0.0.1:4010/v1', defaultModel: null });
        assert.equal('apiKey' in w.lolFarm, false, 'the fallback branch carries no key (the farm may still demand one)');
        assert.equal(w.refreshes, 1);
    });

    test('no farm and no sidecar → __lolFarm is null', () => {
        const w = publish({ farms: [], sidecar: null });
        assert.equal(w.__lolFarm, null);
    });

    test('a farm whose endpoint the sidecar is NOT pointed at is not active', () => {
        const farm = mainShaped({ proxyPort: 4009 });
        const w = publish({ farms: [farm], sidecar: { endpoint: 'http://127.0.0.1:4010/v1' } });
        // activeFarm() finds nothing → the fallback branch takes over with the sidecar endpoint.
        assert.equal(w.__lolFarm.name, 'farm');
        assert.equal(w.__lolFarm.openaiBaseUrl, 'http://127.0.0.1:4010/v1');
    });

    test('a missing anchor throws loudly instead of testing a stale bridge', () => {
        const src = fs.readFileSync(APP_JS, 'utf8');
        assert.throws(() => bridge.buildWrapper(src.replace('function publishFarm() {', 'function publishFarmRenamed() {')), /anchor not found/);
        assert.throws(() => bridge.buildWrapper(src.replace('const farmEndpoint = ', 'const farmEndpointX = ')), /anchor not found/);
        assert.throws(() => bridge.buildWrapper(src.replace('// ---- topbar connection pill', '// ---- topbar pill')), /end anchor not found/);
        assert.throws(() => bridge.buildWrapper(''), /empty/);
    });

    test('the extracted slices are verbatim app.js, not a copy that can drift', () => {
        const src = fs.readFileSync(APP_JS, 'utf8');
        const wrapper = bridge.buildWrapper(src);
        for (const line of ['const farmEndpoint = (f) =>', 'const activeFarm = () =>', 'window.__lolFarm = f']) {
            const inApp = src.split('\n').find((l) => l.includes(line));
            assert.ok(inApp, `app.js no longer contains ${line}`);
            assert.ok(wrapper.includes(inApp.trim()), `the wrapper lost the verbatim line: ${line}`);
        }
        assert.ok(!/require\(|import /.test(wrapper), 'the wrapper must stay a classic script');
    });
};
